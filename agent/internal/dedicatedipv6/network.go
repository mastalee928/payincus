// Package dedicatedipv6 maintains the host side of one-customer IPv6 delivery.
// It consumes only Incus-owned forwards, never commands or rules from a guest.
package dedicatedipv6

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const Table = "incudal_dedicated_ipv6"
const ReadyKey = "user.payincus.ipv6.ready"
const statePath = "/var/lib/incudal-agent/dedicated-ipv6.nft"
const bridge = "incusbr0"

var reconcileMutex sync.Mutex

type Forward struct {
	ListenAddress string            `json:"listen_address"`
	Description   string            `json:"description"`
	Config        map[string]string `json:"config"`
	Ports         []struct {
		TargetAddress string `json:"target_address"`
	} `json:"ports"`
}

type Mapping struct {
	Public string
	Target string
}

func publicAddress(text string) (netip.Addr, bool) {
	address, err := netip.ParseAddr(text)
	if err != nil || address.Zone() != "" || !address.Is6() || address.Is4In6() {
		return netip.Addr{}, false
	}
	for _, prefix := range []string{"2001:db8::/32", "2001:2::/48", "3fff::/20"} {
		if netip.MustParsePrefix(prefix).Contains(address) {
			return netip.Addr{}, false
		}
	}
	return address, netip.MustParsePrefix("2000::/3").Contains(address)
}

// Ignore unrelated forwards. Reject ambiguous owned rules rather than SNAT a
// different customer's source, and retire addresses no longer on the uplink.
func Mappings(forwards []Forward, local []string) ([]Mapping, error) {
	assigned := map[netip.Addr]bool{}
	for _, value := range local {
		if address, ok := publicAddress(value); ok {
			assigned[address] = true
		}
	}
	byTarget := map[netip.Addr]netip.Addr{}
	for _, forward := range forwards {
		if !strings.HasPrefix(forward.Description, "payincus-dedicated:") {
			continue
		}
		public, ok := publicAddress(forward.ListenAddress)
		if !ok || !assigned[public] {
			continue
		}
		targets := []string{forward.Config["target_address"]}
		for _, port := range forward.Ports {
			targets = append(targets, port.TargetAddress)
		}
		for _, value := range targets {
			target, err := netip.ParseAddr(value)
			if err != nil || target.Zone() != "" || !netip.MustParsePrefix("fd00::/8").Contains(target) {
				return nil, fmt.Errorf("invalid dedicated IPv6 target")
			}
			if previous, exists := byTarget[target]; exists && previous != public {
				return nil, fmt.Errorf("dedicated IPv6 target has two owners")
			}
			byTarget[target] = public
		}
	}
	if len(byTarget) > 512 {
		return nil, fmt.Errorf("too many dedicated IPv6 targets")
	}
	mappings := make([]Mapping, 0, len(byTarget))
	for target, public := range byTarget {
		mappings = append(mappings, Mapping{public.String(), target.String()})
	}
	sort.Slice(mappings, func(i, j int) bool {
		return mappings[i].Public+"="+mappings[i].Target < mappings[j].Public+"="+mappings[j].Target
	})
	return mappings, nil
}

func Digest(mappings []Mapping) string {
	lines := make([]string, 0, len(mappings))
	for _, mapping := range mappings {
		lines = append(lines, mapping.Public+"="+mapping.Target)
	}
	sort.Strings(lines)
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	return hex.EncodeToString(sum[:])
}

func Rules(mappings []Mapping) (string, error) {
	lines := []string{"table ip6 " + Table + " {",
		// Before Incus's generic masquerade (100), independently of chain
		// creation order. Whole-address SNAT also covers ICMP, not just ports.
		" chain outbound { type nat hook postrouting priority 90; policy accept;"}
	for _, mapping := range mappings {
		public, ok := publicAddress(mapping.Public)
		target, err := netip.ParseAddr(mapping.Target)
		if !ok || err != nil || target.Zone() != "" || !netip.MustParsePrefix("fd00::/8").Contains(target) {
			return "", fmt.Errorf("invalid dedicated IPv6 mapping")
		}
		lines = append(lines, fmt.Sprintf(" iifname %q oifname != %q ip6 saddr %s snat to %s", bridge, bridge, target, public))
	}
	return strings.Join(append(lines, " }", "}"), "\n") + "\n", nil
}

func query(ctx context.Context, path string, result any) error {
	output, err := exec.CommandContext(ctx, "incus", "query", path).Output()
	if err != nil {
		return fmt.Errorf("read Incus IPv6 network: %w", err)
	}
	return json.Unmarshal(output, result)
}

func neighbours(ctx context.Context) error {
	// Existing auto-onboarded hosts already have this owned chain. Do not
	// create a new INPUT policy or touch another administrator's firewall.
	if err := exec.CommandContext(ctx, "ip6tables", "-w", "-S", "INCUDAL_OCI_IN").Run(); err != nil {
		return fmt.Errorf("managed IPv6 firewall is unavailable")
	}
	for _, kind := range []string{"135", "136"} {
		rule := []string{"INCUDAL_OCI_IN", "-i", bridge, "-p", "ipv6-icmp", "--icmpv6-type", kind, "-m", "hl", "--hl-eq", "255", "-j", "ACCEPT"}
		if exec.CommandContext(ctx, "ip6tables", append([]string{"-w", "-C"}, rule...)...).Run() == nil {
			continue
		}
		if err := exec.CommandContext(ctx, "ip6tables", append([]string{"-w", "-I"}, rule...)...).Run(); err != nil {
			return fmt.Errorf("enable managed IPv6 neighbour discovery: %w", err)
		}
	}
	return nil
}

func replace(ctx context.Context, rules string) error {
	if exec.CommandContext(ctx, "nft", "list", "table", "ip6", Table).Run() == nil {
		rules = "delete table ip6 " + Table + "\n" + rules
	}
	command := exec.CommandContext(ctx, "nft", "-f", "-")
	command.Stdin = strings.NewReader(rules)
	if err := command.Run(); err != nil {
		return fmt.Errorf("apply dedicated IPv6 rules: %w", err)
	}
	return nil
}

func apply(ctx context.Context, rules string) error {
	if err := os.MkdirAll(filepath.Dir(statePath), 0700); err != nil {
		return err
	}
	current, err := os.ReadFile(statePath)
	// Reapply even when a firewall reload emptied, but did not delete, the table.
	if err == nil && string(current) == rules {
		return replace(ctx, rules)
	}
	file, err := os.CreateTemp(filepath.Dir(statePath), ".dedicated-ipv6-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.WriteString(rules); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := replace(ctx, rules); err != nil {
		return err
	}
	return os.Rename(file.Name(), statePath)
}

// Reconcile also runs while the panel is unavailable, so host reboots and
// address changes cannot depend on a successful heartbeat to recover networking.
func Reconcile(ctx context.Context) (err error) {
	reconcileMutex.Lock()
	defer reconcileMutex.Unlock()
	if _, err := os.Stat("/usr/local/sbin/incudal-oci-network"); os.IsNotExist(err) {
		return nil
	}
	var network struct {
		Config map[string]string `json:"config"`
	}
	if err := query(ctx, "/1.0/networks/"+bridge, &network); err != nil {
		return err
	}
	defer func() {
		if err != nil && ctx.Err() == nil && network.Config[ReadyKey] != "" {
			_ = exec.CommandContext(ctx, "incus", "network", "unset", bridge, ReadyKey).Run()
		}
	}()
	var forwards []Forward
	if err := query(ctx, "/1.0/networks/"+bridge+"/forwards?recursion=1", &forwards); err != nil {
		return err
	}
	var interfaces []struct {
		Name    string `json:"name"`
		Type    string `json:"type"`
		Managed bool   `json:"managed"`
	}
	if err := query(ctx, "/1.0/networks?recursion=1", &interfaces); err != nil {
		return err
	}
	var physicalNames []string
	for _, nic := range interfaces {
		if !nic.Managed && nic.Type == "physical" {
			physicalNames = append(physicalNames, nic.Name)
		}
	}
	if err := reconcileOCIUplinks(ctx, physicalNames); err != nil && ctx.Err() == nil {
		// A temporary metadata failure must not withdraw working manual or
		// previously discovered IPv6 addresses and their forwarding rules.
		log.Printf("OCI public IPv6 allocation: %v", err)
	}
	var local []string
	physical := 0
	for _, nic := range interfaces {
		if nic.Managed || nic.Type != "physical" {
			continue
		}
		physical++
		// Use the kernel rather than interpolating an interface name into a URL.
		output, err := exec.CommandContext(ctx, "ip", "-j", "-6", "addr", "show", "dev", nic.Name).Output()
		if err != nil {
			return fmt.Errorf("read public IPv6 addresses: %w", err)
		}
		var rows []struct {
			Addresses []struct {
				Local     string `json:"local"`
				Scope     string `json:"scope"`
				Tentative bool   `json:"tentative"`
				DadFailed bool   `json:"dadfailed"`
			} `json:"addr_info"`
		}
		if err := json.Unmarshal(output, &rows); err != nil {
			return err
		}
		for _, row := range rows {
			for _, address := range row.Addresses {
				if address.Scope == "global" && !address.Tentative && !address.DadFailed {
					local = append(local, address.Local)
				}
			}
		}
	}
	if physical == 0 {
		return fmt.Errorf("no physical interface available for IPv6 discovery")
	}
	mappings, err := Mappings(forwards, local)
	if err != nil {
		return err
	}
	if len(mappings) == 0 && network.Config[ReadyKey] == "" {
		if _, err := os.Stat(statePath); os.IsNotExist(err) {
			return nil
		}
	}
	if err := neighbours(ctx); err != nil {
		return err
	}
	rules, err := Rules(mappings)
	if err != nil {
		return err
	}
	if err := apply(ctx, rules); err != nil {
		return err
	}
	digest := Digest(mappings)
	if network.Config[ReadyKey] != digest {
		if err := exec.CommandContext(ctx, "incus", "network", "set", bridge, ReadyKey, digest).Run(); err != nil {
			return fmt.Errorf("record applied IPv6 network: %w", err)
		}
	}
	return nil
}

// Called by the existing network restoration service before Incus starts.
func Restore(ctx context.Context) error {
	rules, err := os.ReadFile(statePath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	return replace(ctx, string(rules))
}
