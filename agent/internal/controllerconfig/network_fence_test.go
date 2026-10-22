package controllerconfig

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestManagementFenceRulesDenyOnlyHostInput(t *testing.T) {
	rules, err := ManagementFenceRules(ManagementFencePorts{2200, 8443}, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{`hook input priority -200`, `iifname != "lo"`, `tcp dport { 2200, 8443 }`, `reject with tcp reset`} {
		if !strings.Contains(rules, required) {
			t.Fatal("missing deny-only boundary")
		}
	}
	for _, forbidden := range []string{"forward", "output", "flush ruleset", "accept\n", "wg", "ssh-key"} {
		if strings.Contains(rules, forbidden) {
			t.Fatal("unexpected operation")
		}
	}
	again, err := ManagementFenceRules(ManagementFencePorts{8443, 2200}, true)
	if err != nil || again != "delete table inet incudal_controller_fence\n"+strings.TrimPrefix(rules, "create table inet incudal_controller_fence\n") {
		t.Fatal("non-atomic/noncanonical repeat")
	}
	for _, ports := range []ManagementFencePorts{{0, 8443}, {22, 22}, {22, 65536}} {
		if _, err = ManagementFenceRules(ports, false); err == nil {
			t.Fatal("invalid ports accepted")
		}
	}
	for _, raw := range []string{`{}`, `{"nftables":null}`, `{"nftables":[{"table":{"family":"ip","name":"incudal_controller_fence"}}]}`, `{"nftables":[],"nftables":[]}`} {
		if _, err := hasManagementFenceTable([]byte(raw)); err == nil {
			t.Fatal("invalid table inventory accepted")
		}
	}
	for _, raw := range []string{`{"nftables":[]}`, `{"nftables":[{"metainfo":{}},{"table":{"family":"inet","name":"incudal_controller_fence"}}]}`} {
		if _, err := hasManagementFenceTable([]byte(raw)); err != nil {
			t.Fatal(err)
		}
	}
}

const managementFenceTableFixture = `{"nftables":[{"table":{"family":"inet","name":"incudal_controller_fence"}},{"chain":{"family":"inet","table":"incudal_controller_fence","name":"input","comment":"payincus-controller-prepare-v1","type":"filter","hook":"input","prio":-200,"policy":"accept"}},{"rule":{"family":"inet","table":"incudal_controller_fence","chain":"input","expr":[{"match":{"op":"!=","left":{"meta":{"key":"iifname"}},"right":"lo"}},{"match":{"op":"==","left":{"payload":{"protocol":"tcp","field":"dport"}},"right":{"set":[2200,8443]}}},{"counter":{"packets":0,"bytes":0}},{"reject":{"type":"tcp reset"}}]}}]}`

func TestRejectUnownedOrChangedFenceTable(t *testing.T) {
	raw := managementFenceTableFixture
	if err := verifyManagementFenceTable([]byte(raw), ManagementFencePorts{2200, 8443}); err != nil {
		t.Fatal(err)
	}
	for _, changed := range []string{strings.Replace(raw, "payincus-controller-prepare-v1", "unrelated", 1), strings.Replace(raw, "-200", "0", 1), strings.Replace(raw, "tcp reset", "icmpx", 1), strings.Replace(raw, "2200,8443", "22,8443", 1), strings.Replace(raw, `"prio":-200`, `"prio":-200,"dev":"eth0"`, 1), strings.Replace(raw, `"family":"inet"`, `"family":"inet","flags":["dormant"]`, 1)} {
		if err := verifyManagementFenceTable([]byte(changed), ManagementFencePorts{2200, 8443}); err == nil {
			t.Fatal("unrelated or altered table accepted")
		}
	}
	var decoded map[string]any
	json.Unmarshal([]byte(raw), &decoded)
	entries := decoded["nftables"].([]any)
	decoded["nftables"] = append(entries, entries[2])
	changed, _ := json.Marshal(decoded)
	if err := verifyManagementFenceTable(changed, ManagementFencePorts{2200, 8443}); err == nil {
		t.Fatal("extra rule accepted")
	}
}
