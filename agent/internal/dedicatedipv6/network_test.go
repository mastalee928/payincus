package dedicatedipv6

import (
	"context"
	"encoding/json"
	"incudal-agent/internal/ingress"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestMappingsLifecycle(t *testing.T) {
	var forwards []Forward
	if err := json.Unmarshal([]byte(`[
 {"listen_address":"2603:c020:802a:cc00::1","description":"payincus-dedicated:guest","config":{"target_address":"fd42:2::3"},"ports":[{"target_address":"fd42:2::2"},{"target_address":"fd42:2::2"}]},
 {"listen_address":"2603:c020:802a:cc00::2","description":"payincus-dedicated:guest","config":{"target_address":"fd42:2::5"},"ports":[{"target_address":"fd42:2::4"}]},
 {"listen_address":"2603:c020:802a:cc00::3","description":"another-owner","config":{"target_address":"fd42:2::6"}}
]`), &forwards); err != nil {
		t.Fatal(err)
	}
	first, err := Mappings(forwards, []string{"2603:c020:802a:cc00::1", "2603:c020:802a:cc00::2", "2603:c020:802a:cc00::3"})
	if err != nil || len(first) != 4 {
		t.Fatalf("multi-address mappings: %v, %v", first, err)
	}
	second, err := Mappings(forwards, []string{"2603:c020:802a:cc00::2"})
	if err != nil || len(second) != 2 || second[0].Public != "2603:c020:802a:cc00::2" {
		t.Fatalf("withdrawn address retained: %v, %v", second, err)
	}
	empty, err := Mappings(forwards, nil)
	if err != nil || len(empty) != 0 {
		t.Fatalf("all addresses removed: %v, %v", empty, err)
	}
	reversed := []Mapping{first[3], first[2], first[1], first[0]}
	if Digest(reversed) != Digest(first) {
		t.Fatal("digest depends on discovery order")
	}
	forwards[1].Config["target_address"] = "fd42:2::2"
	if _, err := Mappings(forwards, []string{"2603:c020:802a:cc00::1", "2603:c020:802a:cc00::2"}); err == nil {
		t.Fatal("conflicting owner accepted")
	}
}

func TestMappingValidation(t *testing.T) {
	for _, invalid := range []string{"::1", "fd42::1", "fe80::1", "2001:db8::1", "3fff::1", "2603:c020::1; flush ruleset", "2603:c020::1%eth0"} {
		if _, ok := publicAddress(invalid); ok {
			t.Fatalf("accepted public address %s", invalid)
		}
	}
	for _, invalid := range []string{"fe80::1", "2603:c020::1", "fd42::1; flush ruleset", "fd42::1%eth0", ""} {
		if _, err := Rules([]Mapping{{"2603:c020::1", invalid}}); err == nil {
			t.Fatalf("accepted target %s", invalid)
		}
	}
	rules, err := Rules([]Mapping{{"2603:c020::1", "fd42::2"}})
	if err != nil || !strings.Contains(rules, "priority 90") || !strings.Contains(rules, "ip6 saddr fd42::2 snat to 2603:c020::1") || strings.Contains(rules, "sport") || strings.Contains(rules, "flush ruleset") {
		t.Fatalf("incorrect all-protocol SNAT rules: %s, %v", rules, err)
	}
	a, _ := Mappings([]Forward{{ListenAddress: "2603:C020::1", Description: "payincus-dedicated:x", Config: map[string]string{"target_address": "fd42::2"}}}, []string{"2603:c020:0:0:0:0:0:1"})
	if !reflect.DeepEqual(a, []Mapping{{"2603:c020::1", "fd42::2"}}) {
		t.Fatalf("normalization failed: %v", a)
	}
}

// All packets and mutations are inside new network namespaces, never the host.
func TestDedicatedIPv6NetworkNamespaces(t *testing.T) {
	if os.Getenv("INCUDAL_IPV6_NETNS_TEST") != "1" || runtime.GOOS != "linux" {
		t.Skip("set INCUDAL_IPV6_NETNS_TEST=1 on an isolated Linux network test host")
	}
	directory := t.TempDir()
	rules, err := Rules([]Mapping{{"2603:c020:802a:cc00::1", "fd42:2::2"}, {"2603:c020:802a:cc00::2", "fd42:2::4"}})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, "dedicated.nft")
	if err := os.WriteFile(path, []byte(rules), 0600); err != nil {
		t.Fatal(err)
	}
	tcpRules, _ := ingress.Rules("tcp", []string{"incusbr0"})
	bothRules, _ := ingress.Rules("tcp_udp", nil)
	tcpPath, bothPath := filepath.Join(directory, "tcp.nft"), filepath.Join(directory, "both.nft")
	if err := os.WriteFile(tcpPath, []byte(tcpRules), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bothPath, []byte(bothRules), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 55*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "unshare", "--net", "python3", "../../../scripts/test-dedicated-ipv6-network.py", path, tcpPath, bothPath).CombinedOutput()
	if err != nil {
		t.Fatalf("isolated IPv6 network test failed: %v\n%s", err, output)
	}
	t.Log(string(output))
}
