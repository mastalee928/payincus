package abuse

import (
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

func TestSpeedTestLegacyAndStrictPolicy(t *testing.T) {
	var p Instruction
	if err := json.Unmarshal([]byte(`{"revision":4,"blockBt":true,"blockMining":true,"retryNonce":2}`), &p); err != nil || p.BlockSpeedTest || !p.BlockBT || !p.BlockMining {
		t.Fatal("legacy protections lost", p, err)
	}
	for _, flag := range []string{"null", `"true"`, "1", "{}"} {
		if json.Unmarshal([]byte(`{"revision":4,"blockBt":true,"blockMining":true,"retryNonce":2,"blockSpeedTest":`+flag+`}`), &p) == nil {
			t.Fatal("invalid speed switch accepted", flag)
		}
	}
	rules, err := Rules(Instruction{Revision: 1, BlockSpeedTest: true}, []string{"incusbr0"})
	if err != nil {
		t.Fatal(err)
	}
	text := strings.Join(rules, "\n")
	if strings.Count(text, "-j DROP") != 28 || strings.Contains(text, "OUTPUT") || strings.Contains(text, "--algo bm") {
		t.Fatal(text)
	}
	for _, signature := range []string{".speed", "speed.", ".speed.", "fast.com", "speedtest.net", "speedtest.com", "speedtest.cn", "test.ustc.edu.cn", "10000.gd.cn", "db.laomoe.com", "jiyou.cloud", "ovo.speedtestcustom.com", "speed.cloudflare.com", "speedtest"} {
		for _, protocol := range []string{"tcp", "udp"} {
			if !strings.Contains(text, "-p "+protocol+" -m string --hex-string \"|"+hex.EncodeToString([]byte(signature))+"|\" --algo kmp") {
				t.Fatal("missing speed match", signature, protocol)
			}
		}
	}
}

func TestRejectIncompletePolicy(t *testing.T) {
	for _, data := range []string{`{"revision":1}`, `{"revision":1,"blockBt":true,"blockMining":false}`, `{"revision":1,"blockBt":null,"blockMining":false,"retryNonce":0}`} {
		var p Instruction
		if json.Unmarshal([]byte(data), &p) == nil {
			t.Fatal("partial response accepted", data)
		}
	}
	var p Instruction
	if err := json.Unmarshal([]byte(`{"revision":1,"blockBt":false,"blockMining":false,"retryNonce":0}`), &p); err != nil {
		t.Fatal(err)
	}
}

func TestOnlyManagedCustomerEgressSignatures(t *testing.T) {
	rules, err := Rules(Instruction{Revision: 1, BlockBT: true, BlockMining: true}, []string{"tenant1", "incusbr0", "incusbr0"})
	if err != nil {
		t.Fatal(err)
	}
	text := strings.Join(rules, "\n")
	for _, token := range []string{"OUTPUT", "INPUT", "--dport", "--sport", "torrent", "--algo bm", "-j ACCEPT", "flush"} {
		if strings.Contains(text, token) {
			t.Fatalf("unsafe/broad rule %q", token)
		}
	}
	if !strings.Contains(text, "-o incudal-mgmt -j RETURN") || strings.Count(text, "-i incusbr0 -j") != 1 {
		t.Fatal(text)
	}
	if strings.Count(text, "-j DROP") != 12 {
		t.Fatal("missing high specificity protocol matches", text)
	}
	for _, p := range []Instruction{{}, {Revision: -1}, {Revision: 1, RetryNonce: -1}} {
		if _, err := Rules(p, nil); err == nil {
			t.Fatal("invalid policy accepted")
		}
	}
	for _, bridge := range []string{"", "incudal-mgmt", "lo", "bridge;touch /x", "bridge\n-A OUTPUT -j DROP"} {
		if _, err := Rules(Instruction{Revision: 1, BlockBT: true}, []string{bridge}); err == nil {
			t.Fatalf("unsafe bridge accepted: %q", bridge)
		}
	}
	if rules, err := Rules(Instruction{Revision: 1}, nil); err != nil || len(rules) != 0 {
		t.Fatal(rules, err)
	}
}

func TestDriftCanonicalizationPreservesRuleSemantics(t *testing.T) {
	a := `-A INCUDAL_ABUSE_SCAN -p tcp -m string --hex-string "|226d696e696e672e73756273637269626522|" --algo kmp --to 65535 -j DROP`
	b := `-A INCUDAL_ABUSE_SCAN -p tcp -m string --string "\"mining.subscribe\"" --algo kmp --from 0 --to 65535 -j DROP`
	if canonicalRule(a) != canonicalRule(b) {
		t.Fatal(canonicalRule(a), canonicalRule(b))
	}
	for _, changed := range []string{strings.Replace(a, "kmp", "bm", 1), strings.Replace(a, "65535", "100", 1), strings.Replace(a, "DROP", "RETURN", 1)} {
		if canonicalRule(a) == canonicalRule(changed) {
			t.Fatal("undetected drift", changed)
		}
	}
	rules, _ := Rules(Instruction{Revision: 1, BlockBT: true}, []string{"incusbr0"})
	snapshot := strings.Join(rules, "\n")
	if !matches(snapshot, rules) || matches("-A FORWARD -j ACCEPT\n"+snapshot, rules) || matches(snapshot+"\n"+jump, rules) {
		t.Fatal("hook ordering or duplicate drift was ignored")
	}
	restore := replacement("*mangle\n:UNRELATED - [0:0]\n-A UNRELATED -j ACCEPT\n"+snapshot+"\nCOMMIT", nil)
	if strings.Contains(restore, "UNRELATED") || strings.Contains(restore, "-F FORWARD") || !strings.Contains(restore, "-D FORWARD") {
		t.Fatal("replacement modified unrelated rules", restore)
	}
}

func TestNetworkCoverageIsExplicit(t *testing.T) {
	networks := []network{{Name: "incusbr0", Type: "bridge", Managed: true, Config: map[string]string{"ipv6.address": "none"}}}
	instances := []instance{{Project: "default", ExpandedDevices: map[string]map[string]string{"eth0": {"type": "nic", "network": "incusbr0"}}}}
	if bridges, v6, err := discoverNetworks(networks, instances); err != nil || v6 || len(bridges) != 1 {
		t.Fatal(bridges, v6, err)
	}
	instances[0].ExpandedDevices["eth0"]["ipv6.address"] = "fd42::2"
	if _, v6, err := discoverNetworks(networks, instances); err != nil || !v6 {
		t.Fatal(v6, err)
	}
	for _, nic := range []map[string]string{{"type": "nic", "nictype": "macvlan", "parent": "incusbr0"}, {"type": "nic", "nictype": "routed"}, {"type": "nic", "parent": "external0"}, {"type": "nic", "network": "incusbr0", "vlan": "3"}} {
		instances[0].ExpandedDevices["eth0"] = nic
		if _, _, err := discoverNetworks(networks, instances); err == nil {
			t.Fatal("unsupported NIC accepted", nic)
		}
	}
}
