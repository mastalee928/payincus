package guestguard

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

//go:embed testdata/*.json
var nftFixtures embed.FS

func TestProtectionScope(t *testing.T) {
	p := Policy{Bridges: []string{"incusbr0", "tenant1", "incusbr0"}, Management: []string{"192.0.2.20", "2001:db8::20"}}
	rules, err := Rules(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"priority -110", `iifname "tenant1" ip daddr 169.254.0.0/16 counter drop`, "fc00::/7", `oifname "incudal-mgmt"`, "ct direction original", "ct status dnat ip saddr 192.0.2.20 masquerade", "tcp dport != { 80, 443 }", "udp dport { 53, 67, 547 } return", "ip6 hoplimit 255"} {
		if !strings.Contains(rules, want) {
			t.Fatal("missing", want)
		}
	}
	for _, bad := range []string{"hook output", "flush ruleset", "ct state established", "10.0.3.0/24", "accept\n"} {
		if strings.Contains(rules, bad) {
			t.Fatal("unsafe", bad)
		}
	}
	if strings.Count(rules, "ip daddr 169.254.0.0/16 counter drop") != 4 {
		t.Fatal("dedup or pre/post DNAT metadata check missing")
	}
	for _, invalid := range []Policy{{}, {Bridges: []string{"incusbr0; flush ruleset"}}, {Bridges: []string{"incudal-mgmt"}}, {Bridges: []string{"incusbr0"}, Management: []string{"0.0.0.0/0"}}, {Bridges: []string{"incusbr0"}, Management: []string{"::ffff:127.0.0.1"}}} {
		if _, err := Rules(invalid); err == nil {
			t.Fatal("accepted invalid", invalid)
		}
	}
	for _, rc := range []bool{true, false} {
		s, err := serviceContent("/usr/local/bin/incudal-agent", rc)
		if err != nil || !strings.Contains(s, "-restore-guest-guard") {
			t.Fatal(s, err)
		}
	}
	if _, err := serviceContent("/tmp/bad path", false); err == nil {
		t.Fatal("unsafe executable")
	}
}

func TestUnsupportedTopologyNeverReportsProtection(t *testing.T) {
	networks := []Network{{Name: "incusbr0", Type: "bridge", Managed: true, Config: map[string]string{}}}
	instance := Instance{ExpandedDevices: map[string]map[string]string{"eth0": {"type": "nic", "network": "incusbr0"}}}
	if _, err := customerBridges(networks, []Instance{instance}); err != nil {
		t.Fatal(err)
	}
	for _, change := range []map[string]string{{"nictype": "macvlan"}, {"vlan": "3"}, {"network": "incudal-mgmt"}, {"vlan.tagged": "1-4094"}} {
		nic := map[string]string{"type": "nic", "network": "incusbr0"}
		for k, v := range change {
			nic[k] = v
		}
		if _, err := customerBridges(networks, []Instance{{ExpandedDevices: map[string]map[string]string{"eth0": nic}}}); err == nil {
			t.Fatal("unsupported NIC acknowledged")
		}
	}
	networks[0].Config["bridge.external_interfaces"] = "eth0"
	if _, err := customerBridges(networks, nil); err == nil {
		t.Fatal("external uplink could bypass host routing")
	}
}

func TestRepairFailurePersistenceAndRestore(t *testing.T) {
	e := New()
	e.managed = func() bool { return true }
	e.path = filepath.Join(t.TempDir(), "policy.json")
	e.lock = func(string) (func(), error) { return func() {}, nil }
	e.service = func(context.Context) error { return nil }
	e.legacy = func(context.Context, runner, Policy) error { return nil }
	policy := Policy{Bridges: []string{"incusbr0"}, Management: []string{"192.0.2.20"}}
	discoveryFailure := false
	e.discover = func(context.Context, string) (Policy, error) {
		if discoveryFailure {
			return policy, errors.New("offline")
		}
		return policy, nil
	}
	var installed string
	cleared, marked, writes := 0, 0, 0
	failApply, failSave := false, false
	e.persist = func(path string, data []byte) error {
		if failSave {
			return errors.New("disk full")
		}
		writes++
		return os.WriteFile(path, data, 0600)
	}
	e.run = func(_ context.Context, name, input string, args ...string) (string, error) {
		if name == "incus" {
			if args[1] == "set" {
				marked++
			}
			if args[1] == "unset" {
				cleared++
			}
			return "", nil
		}
		if len(args) > 0 && args[0] == "-f" {
			if failApply {
				return "", errors.New("transaction rejected")
			}
			if !strings.HasPrefix(input, "add table inet "+Table+"\ndelete table inet "+Table+"\n") {
				t.Fatal("non atomic update")
			}
			installed = input
			return firewallFixture(installed, true), nil
		}
		return firewallFixture(installed, false), nil
	}
	ctx := context.Background()
	if err := e.Sync(ctx, "https://panel.invalid"); err != nil || !e.Status().Applied {
		t.Fatal(err, e.Status())
	}
	installed = ""
	if err := e.Sync(ctx, "https://panel.invalid"); err != nil || installed == "" || writes != 1 {
		t.Fatal("drift repair/persistence", err, writes)
	}
	previous := installed
	failApply = true
	if err := e.Sync(ctx, ""); err == nil || installed != previous || e.Status().Applied || cleared == 0 {
		t.Fatal("failed transaction published success")
	}
	failApply = false
	policy.Management = []string{"192.0.2.21"}
	failSave = true
	priorMarked := marked
	if err := e.Sync(ctx, ""); err == nil || marked != priorMarked {
		t.Fatal("unsaved policy acknowledged")
	}
	failSave = false
	if err := e.Sync(ctx, ""); err != nil || !strings.Contains(installed, "192.0.2.20") || !strings.Contains(installed, "192.0.2.21") {
		t.Fatal("endpoint rotation lost old protection", err)
	}
	discoveryFailure = true
	installed = ""
	if err := e.Sync(ctx, ""); err == nil || e.Status().Applied || installed == "" {
		t.Fatal("discovery failure marked ready")
	}
	installed = ""
	if err := e.Restore(ctx); err != nil || installed == "" {
		t.Fatal("offline boot restore", err)
	}
	if err := os.WriteFile(e.path, []byte(`{"bridges":["x;flush ruleset"]}`), 0600); err != nil {
		t.Fatal(err)
	}
	before := installed
	if err := e.Restore(ctx); err == nil || before != installed {
		t.Fatal("corrupt state changed firewall")
	}
}

func firewallFixture(rules string, echo bool) string {
	rows := []any{map[string]any{"table": map[string]any{"family": "inet", "name": Table}}}
	for _, name := range []string{"before_nat", "input", "forward", "validation_source"} {
		rows = append(rows, map[string]any{"chain": map[string]any{"family": "inet", "table": Table, "name": name}})
	}
	for i := 0; i < strings.Count(rules, "counter drop")+strings.Count(rules, " return")+strings.Count(rules, " masquerade"); i++ {
		rows = append(rows, map[string]any{"rule": map[string]any{"family": "inet", "table": Table, "chain": "forward", "expr": []any{map[string]any{"drop": nil}}}})
	}
	if echo {
		for i, row := range rows {
			rows[i] = map[string]any{"add": row}
		}
	}
	b, _ := json.Marshal(map[string]any{"nftables": rows})
	return string(b)
}

func TestReadbackRequiresActualVerdicts(t *testing.T) {
	rules, _ := Rules(Policy{Bridges: []string{"incusbr0"}})
	expected, err := firewallObjects(firewallFixture(rules, true), true)
	if err != nil {
		t.Fatal(err)
	}
	changed, err := firewallObjects(strings.ReplaceAll(firewallFixture(rules, false), `"drop":null`, `"accept":null`), false)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(expected)
	b, _ := json.Marshal(changed)
	if string(a) == string(b) {
		t.Fatal("changed verdict passed semantic readback")
	}
}

func TestHeartbeatStatusNeverWaitsForReconcile(t *testing.T) {
	e := New()
	e.mu.Lock()
	done := make(chan Status, 1)
	go func() { done <- e.Status() }()
	select {
	case <-done:
	case <-time.After(time.Second):
		e.mu.Unlock()
		t.Fatal("heartbeat waits for firewall")
	}
	e.mu.Unlock()
}

func TestRealNftSerialization(t *testing.T) {
	echo, err := nftFixtures.ReadFile("testdata/nft-1.1.6-echo.json")
	if err != nil {
		t.Fatal(err)
	}
	live, err := nftFixtures.ReadFile("testdata/nft-1.1.6-live.json")
	if err != nil {
		t.Fatal(err)
	}
	a, err := firewallObjects(string(echo), true)
	if err != nil {
		t.Fatal(err)
	}
	b, err := firewallObjects(string(live), false)
	if err != nil || !reflect.DeepEqual(a, b) {
		t.Fatal("real nft serialization mismatch", err)
	}
	for _, changed := range []string{
		strings.ReplaceAll(string(live), `"drop": null`, `"accept": null`),
		strings.ReplaceAll(string(live), `"prio": -25`, `"prio": 25`),
		strings.ReplaceAll(string(live), `"192.0.2.20"`, `"192.0.2.21"`),
	} {
		b, err := firewallObjects(changed, false)
		if err == nil && reflect.DeepEqual(a, b) {
			t.Fatal("accepted changed protection")
		}
	}
	bad := strings.Replace(string(live), `"chain": "input"`, `"chain": null`, 1)
	if _, err := firewallObjects(bad, false); err == nil {
		t.Fatal("accepted malformed chain")
	}
}
