package controllerconfig

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os/exec"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"
)

// ManagementFencePorts come from protected, local enrollment. Remote permits
// cannot add arbitrary ports or interfaces. Only host-local management TCP is
// affected; customer DNAT/FORWARD and outbound WireGuard remain unchanged.
type ManagementFencePorts struct {
	SSH   int `json:"ssh"`
	Incus int `json:"incus"`
}

var managementFenceMutex sync.Mutex

func ManagementFenceRules(ports ManagementFencePorts, existing bool) (string, error) {
	if !validPort(ports.SSH) || !validPort(ports.Incus) || ports.SSH == ports.Incus {
		return "", failure("CONTROLLER_NETWORK_FENCE_INVALID")
	}
	values := []int{ports.SSH, ports.Incus}
	sort.Ints(values)
	prefix := "create table inet incudal_controller_fence\n"
	if existing {
		prefix = "delete table inet incudal_controller_fence\n"
	}
	// Deny every external source while preparing. Candidate access is opened only
	// by a later lease-enforced proxy, never by preparation or a successful ping.
	return prefix + fmt.Sprintf(`table inet incudal_controller_fence {
 chain input {
  type filter hook input priority -200; policy accept; comment "payincus-controller-prepare-v1";
  iifname != "lo" tcp dport { %d, %d } counter reject with tcp reset
 }
}
`, values[0], values[1]), nil
}

type fenceCommand func(context.Context, []string, string) (string, error)

func fixedNftCommand(ctx context.Context, args []string, input string) (string, error) {
	bounded, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(bounded, "/usr/sbin/nft", args...)
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL=C"}
	cmd.Stdin = strings.NewReader(input)
	// nft responses contain only rules, not WG/SSH secrets. Bound stdout anyway.
	var output boundedFenceOutput
	cmd.Stdout = &output
	if err := cmd.Run(); err != nil {
		return "", failure("CONTROLLER_NETWORK_FENCE_IO")
	}
	return output.String(), nil
}

type boundedFenceOutput struct{ strings.Builder }

func (b *boundedFenceOutput) Write(raw []byte) (int, error) {
	if b.Len()+len(raw) > 65536 {
		return 0, failure("CONTROLLER_NETWORK_FENCE_INVALID")
	}
	return b.Builder.Write(raw)
}

// ApplyManagementPreparationFence validates both signatures and reloads the
// protected highest candidate watermark before an atomic deny-only input table.
// It does not sign a success receipt, cancel jobs, revoke keys or grant writes.
func ApplyManagementPreparationFence(ctx context.Context, candidate, permit []byte, trust Context, witnessID string, witnessKeys map[string]string, ports ManagementFencePorts, stateDirectory string) error {
	observed, release, err := lockNetworkFenceState(stateDirectory)
	if err != nil {
		return err
	}
	defer release()
	trust.Previous = &observed
	trust.Now = time.Now().UnixMilli()
	if _, err = VerifyMaintenancePreparation(candidate, permit, trust, witnessID, witnessKeys); err != nil {
		return err
	}
	if _, err := ManagementFenceRules(ports, false); err != nil {
		return err
	}
	// Persist a deny-only recovery instruction before touching the kernel. If
	// execution is interrupted, startup can restore the denial without granting
	// any new lease or requiring an expired preparation permit to be renewed.
	if err = saveNetworkFenceRecord(stateDirectory, candidate, permit, ports); err != nil {
		return err
	}
	return applyManagementPreparationFence(ctx, candidate, permit, trust, witnessID, witnessKeys, ports, fixedNftCommand)
}
func applyManagementPreparationFence(ctx context.Context, candidate, permit []byte, trust Context, witnessID string, witnessKeys map[string]string, ports ManagementFencePorts, command fenceCommand) error {
	if trust.Previous == nil {
		return failure("CONTROLLER_NETWORK_FENCE_STATE_REQUIRED")
	}
	checked, err := VerifyMaintenancePreparation(candidate, permit, trust, witnessID, witnessKeys)
	if err != nil {
		return err
	}
	if !checked.Duplicate {
		return failure("CONTROLLER_NETWORK_FENCE_STATE_REQUIRED")
	}
	return applyDenyOnlyFence(ctx, ports, command, func() error {
		trust.Now = time.Now().UnixMilli()
		_, err := VerifyMaintenancePreparation(candidate, permit, trust, witnessID, witnessKeys)
		return err
	})
}

func applyDenyOnlyFence(ctx context.Context, ports ManagementFencePorts, command fenceCommand, beforeMutation func() error) error {
	managementFenceMutex.Lock()
	defer managementFenceMutex.Unlock()
	if _, err := ManagementFenceRules(ports, false); err != nil {
		return err
	}
	if err := validateNetworkFenceRuntime(); err != nil {
		return err
	}
	raw, err := command(ctx, []string{"-j", "list", "tables"}, "")
	if err != nil {
		return err
	}
	existing, err := hasManagementFenceTable([]byte(raw))
	if err != nil {
		return err
	}
	if existing {
		raw, err = command(ctx, []string{"-j", "list", "table", "inet", "incudal_controller_fence"}, "")
		if err != nil {
			return err
		}
		if err = verifyManagementFenceTable([]byte(raw), ports); err != nil {
			return err
		}
	}
	rules, err := ManagementFenceRules(ports, existing)
	if err != nil {
		return err
	}
	// A single nft transaction eliminates flush/add gaps. Validation failure does
	// not remove the current fence. Repeat is safe but never widens management ACL.
	if _, err = command(ctx, []string{"--check", "-f", "-"}, rules); err != nil {
		return err
	}
	// The inventory and check subprocesses may outlive the short permit. Never
	// start a mutation using the timestamp supplied before those reads.
	if beforeMutation != nil {
		if err = beforeMutation(); err != nil {
			return err
		}
	}
	if _, err = command(ctx, []string{"-f", "-"}, rules); err != nil {
		return err
	}
	applied, err := command(ctx, []string{"-j", "list", "table", "inet", "incudal_controller_fence"}, "")
	if err != nil {
		return err
	}
	if err = verifyManagementFenceTable([]byte(applied), ports); err != nil {
		return err
	}
	return nil
}

type networkFenceRecord struct {
	SchemaVersion int                  `json:"schemaVersion"`
	Candidate     string               `json:"candidate"`
	PreparePermit string               `json:"preparePermit"`
	Ports         ManagementFencePorts `json:"ports"`
}

// RestoreManagementPreparationFence re-establishes a previously authorized
// denial only. It never accepts a lease, signs a receipt or opens management
// access. The local startup service must run it before its network endpoint.
func RestoreManagementPreparationFence(ctx context.Context, trust Context, witnessID string, witnessKeys map[string]string, ports ManagementFencePorts, stateDirectory string) error {
	observed, release, err := lockNetworkFenceState(stateDirectory)
	if err != nil {
		return err
	}
	defer release()
	record, err := readNetworkFenceRecord(stateDirectory)
	if err != nil {
		return err
	}
	if record.SchemaVersion != 1 || record.Ports != ports {
		return failure("CONTROLLER_NETWORK_FENCE_STATE_REQUIRED")
	}
	var env envelope
	if decodeStrict([]byte(record.PreparePermit), &env) != nil {
		return failure("CONTROLLER_NETWORK_FENCE_STATE_REQUIRED")
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(env.Payload)
	if err != nil {
		return failure("CONTROLLER_NETWORK_FENCE_STATE_REQUIRED")
	}
	var permit PreparePermit
	if decodeStrict(raw, &permit) != nil {
		return failure("CONTROLLER_NETWORK_FENCE_STATE_REQUIRED")
	}
	trust.Previous = &observed
	trust.Now = permit.IssuedAt
	checked, err := VerifyMaintenancePreparation([]byte(record.Candidate), []byte(record.PreparePermit), trust, witnessID, witnessKeys)
	if err != nil {
		return err
	}
	if !checked.Duplicate {
		return failure("CONTROLLER_NETWORK_FENCE_STATE_REQUIRED")
	}
	return applyDenyOnlyFence(ctx, ports, fixedNftCommand, nil)
}

// InspectManagementFence checks the current kernel denial and disk watermark.
func InspectManagementFence(ctx context.Context, ports ManagementFencePorts, stateDirectory string) (ObservedState, error) {
	observed, release, err := lockNetworkFenceState(stateDirectory)
	if err != nil {
		return ObservedState{}, err
	}
	defer release()
	if err = validateNetworkFenceRuntime(); err != nil {
		return ObservedState{}, err
	}
	raw, err := fixedNftCommand(ctx, []string{"-j", "list", "table", "inet", "incudal_controller_fence"}, "")
	if err != nil {
		return ObservedState{}, err
	}
	if err = verifyManagementFenceTable([]byte(raw), ports); err != nil {
		return ObservedState{}, err
	}
	return observed, nil
}

func verifyManagementFenceTable(raw []byte, ports ManagementFencePorts) error {
	fail := func() error { return failure("CONTROLLER_NETWORK_FENCE_CONFLICT") }
	if ValidateProtocolJSON(raw, 65536) != nil {
		return fail()
	}
	var response struct {
		NFTables []map[string]json.RawMessage `json:"nftables"`
	}
	if json.Unmarshal(raw, &response) != nil || response.NFTables == nil {
		return fail()
	}
	tables, chains, rules := 0, 0, 0
	for _, entry := range response.NFTables {
		if len(entry) != 1 {
			return fail()
		}
		for kind, encoded := range entry {
			switch kind {
			case "metainfo":
				continue
			case "table":
				if !fenceObjectFields(encoded, "family", "name", "handle", "use") {
					return fail()
				}
				var row struct{ Family, Name string }
				if json.Unmarshal(encoded, &row) != nil || row.Family != "inet" || row.Name != "incudal_controller_fence" {
					return fail()
				}
				tables++
			case "chain":
				if !fenceObjectFields(encoded, "family", "table", "name", "comment", "type", "hook", "prio", "policy", "handle", "use") {
					return fail()
				}
				var row struct {
					Family, Table, Name, Comment, Type, Hook, Policy string
					Prio                                             int
				}
				if json.Unmarshal(encoded, &row) != nil || row.Family != "inet" || row.Table != "incudal_controller_fence" || row.Name != "input" || row.Comment != "payincus-controller-prepare-v1" || row.Type != "filter" || row.Hook != "input" || row.Prio != -200 || row.Policy != "accept" {
					return fail()
				}
				chains++
			case "rule":
				if !fenceObjectFields(encoded, "family", "table", "chain", "expr", "handle") {
					return fail()
				}
				var row struct {
					Family, Table, Chain string
					Expr                 []json.RawMessage
				}
				if json.Unmarshal(encoded, &row) != nil || row.Family != "inet" || row.Table != "incudal_controller_fence" || row.Chain != "input" || len(row.Expr) != 4 {
					return fail()
				}
				expected := []string{`{"match":{"op":"!=","left":{"meta":{"key":"iifname"}},"right":"lo"}}`, fmt.Sprintf(`{"match":{"op":"==","left":{"payload":{"protocol":"tcp","field":"dport"}},"right":{"set":[%d,%d]}}}`, minFencePort(ports), maxFencePort(ports)), `{"reject":{"type":"tcp reset"}}`}
				for index, value := range expected {
					actual := index
					if index == 2 {
						actual = 3
					}
					var got, want any
					if json.Unmarshal(row.Expr[actual], &got) != nil || json.Unmarshal([]byte(value), &want) != nil {
						return fail()
					}
					if !reflect.DeepEqual(got, want) {
						return fail()
					}
				}
				var counter map[string]map[string]json.Number
				decoder := json.NewDecoder(strings.NewReader(string(row.Expr[2])))
				decoder.UseNumber()
				if decoder.Decode(&counter) != nil || len(counter) != 1 || len(counter["counter"]) != 2 {
					return fail()
				}
				for _, key := range []string{"packets", "bytes"} {
					value, err := counter["counter"][key].Int64()
					if err != nil || value < 0 {
						return fail()
					}
				}
				rules++
			default:
				return fail()
			}
		}
	}
	if tables != 1 || chains != 1 || rules != 1 {
		return fail()
	}
	return nil
}
func fenceObjectFields(raw []byte, allowed ...string) bool {
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil || object == nil {
		return false
	}
	for key := range object {
		found := false
		for _, name := range allowed {
			if key == name {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
func minFencePort(p ManagementFencePorts) int {
	if p.SSH < p.Incus {
		return p.SSH
	}
	return p.Incus
}
func maxFencePort(p ManagementFencePorts) int {
	if p.SSH > p.Incus {
		return p.SSH
	}
	return p.Incus
}

// Keep this helper limited to an explicit table inventory from trusted local
// nft. Unexpected table data cannot be interpreted as "no fence".
func hasManagementFenceTable(raw []byte) (bool, error) {
	if ValidateProtocolJSON(raw, 65536) != nil {
		return false, failure("CONTROLLER_NETWORK_FENCE_INVALID")
	}
	var response struct {
		NFTables []struct {
			Table *struct {
				Family string `json:"family"`
				Name   string `json:"name"`
			} `json:"table"`
		} `json:"nftables"`
	}
	if json.Unmarshal(raw, &response) != nil || response.NFTables == nil {
		return false, failure("CONTROLLER_NETWORK_FENCE_INVALID")
	}
	count := 0
	for _, entry := range response.NFTables {
		if entry.Table != nil && entry.Table.Name == "incudal_controller_fence" {
			if entry.Table.Family != "inet" {
				return false, failure("CONTROLLER_NETWORK_FENCE_INVALID")
			}
			count++
		}
	}
	if count > 1 {
		return false, failure("CONTROLLER_NETWORK_FENCE_INVALID")
	}
	return count == 1, nil
}
