package dedicatedipv6

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestOCIAllocationPlans(t *testing.T) {
	mac, _ := net.ParseMAC("02:00:17:00:00:01")
	nic := net.Interface{Name: "eth0", HardwareAddr: mac}
	addresses := []string{"2603:C020::2", "2603:c020::1", "2603:c020:0:0:0:0:0:2"}
	vnic := ociVNIC{ID: "ocid1.vnic.oc1.test", MAC: "02:00:17:00:00:01", Addresses: &addresses, Gateway: "fe80::1"}
	plans, err := planOCIUplinks([]ociVNIC{vnic}, []net.Interface{nic})
	if err != nil || len(plans) != 1 || !reflect.DeepEqual(plans[0].Addresses, []string{"2603:c020::1", "2603:c020::2"}) {
		t.Fatalf("explicit multi-address allocation: %v, %v", plans, err)
	}
	unattached, err := planOCIUplinks([]ociVNIC{vnic}, nil)
	if err != nil || len(unattached) != 0 {
		t.Fatal("unattached VNIC was configured")
	}
	missing := vnic
	missing.Addresses = nil
	if plans, err := planOCIUplinks([]ociVNIC{missing}, []net.Interface{nic}); err != nil || len(plans) != 0 {
		t.Fatal("missing metadata is not address removal")
	}
	empty := []string{}
	removed := vnic
	removed.Addresses = &empty
	removed.Gateway = ""
	if plans, err := planOCIUplinks([]ociVNIC{removed}, []net.Interface{nic}); err != nil || len(plans) != 1 || len(plans[0].Addresses) != 0 {
		t.Fatal("explicit removal not recognized")
	}
	for _, bad := range []string{"::1", "fd42::1", "2001:db8::1", "fe80::1", "2603:c020::1%eth0", "2603:c020::1;echo injected"} {
		values := []string{bad}
		invalid := vnic
		invalid.Addresses = &values
		if _, err := planOCIUplinks([]ociVNIC{invalid}, []net.Interface{nic}); err == nil {
			t.Fatalf("accepted allocation %s", bad)
		}
	}
	invalidRouter := vnic
	invalidRouter.Gateway = "2603:c020::dead"
	if _, err := planOCIUplinks([]ociVNIC{invalidRouter}, []net.Interface{nic}); err == nil {
		t.Fatal("non-link-local gateway accepted")
	}
	if _, err := planOCIUplinks([]ociVNIC{vnic, vnic}, []net.Interface{nic}); err == nil {
		t.Fatal("ambiguous VNIC accepted")
	}
	tooMany := make([]string, 257)
	excessive := vnic
	excessive.Addresses = &tooMany
	if _, err := planOCIUplinks([]ociVNIC{excessive}, []net.Interface{nic}); err == nil {
		t.Fatal("unbounded allocation accepted")
	}
}

type ociTestTransport func(*http.Request) (*http.Response, error)

func (fn ociTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestOCIMetadataBoundaries(t *testing.T) {
	if ociHTTPClient.Transport.(*http.Transport).Proxy != nil || ociHTTPClient.CheckRedirect == nil || ociHTTPClient.Timeout > 3*time.Second {
		t.Fatal("unbounded or proxyable IMDS client")
	}
	client := &http.Client{Transport: ociTestTransport(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != ociMetadataURL || request.Header.Get("Authorization") != "Bearer Oracle" {
			t.Fatal("unexpected metadata destination or authorization")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`[{"vnicId":"ocid1.vnic.test","macAddr":"02:00:17:00:00:01","ipv6SubnetCidrBlock":"2603:c020::/64"}]`)), Header: make(http.Header)}, nil
	})}
	rows, err := readOCIVNICs(context.Background(), client)
	if err != nil || len(rows) != 1 || rows[0].Addresses != nil {
		t.Fatal("subnet was incorrectly treated as an address allocation")
	}
	client.Transport = ociTestTransport(func(_ *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(strings.Repeat(" ", 1024*1024+1))), Header: make(http.Header)}, nil
	})
	if _, err := readOCIVNICs(context.Background(), client); err == nil {
		t.Fatal("oversized response accepted")
	}
	client.Transport = ociTestTransport(func(_ *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader("unavailable")), Header: make(http.Header)}, nil
	})
	if _, err := readOCIVNICs(context.Background(), client); err == nil {
		t.Fatal("metadata failure interpreted as empty allocation")
	}
	if err := ociHTTPClient.CheckRedirect(nil, nil); err != http.ErrUseLastResponse {
		t.Fatal("IMDS redirects are allowed")
	}
}

// Run the real ip/nft lifecycle under a new network namespace on either Debian
// or Alpine. No address, route, firewall, or sysctl in the host namespace changes.
func TestOCIIPv6KernelLifecycle(t *testing.T) {
	if runtime.GOOS != "linux" || os.Getenv("INCUDAL_IPV6_NETNS_TEST") != "1" {
		t.Skip("isolated Linux namespace test is opt-in")
	}
	if os.Getenv("INCUDAL_OCI_NETNS_CHILD") != "1" {
		parent, err := os.Readlink("/proc/self/ns/net")
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "unshare", "--net", os.Args[0], "-test.run=^TestOCIIPv6KernelLifecycle$", "-test.v")
		cmd.Env = append(os.Environ(), "INCUDAL_OCI_NETNS_CHILD=1", "INCUDAL_OCI_PARENT_NETNS="+parent)
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("OCI IPv6 namespace: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}
	actual, err := os.Readlink("/proc/self/ns/net")
	if err != nil || actual == os.Getenv("INCUDAL_OCI_PARENT_NETNS") || os.Getenv("INCUDAL_OCI_PARENT_NETNS") == "" {
		t.Fatal("refusing to change the host network namespace")
	}
	ctx := context.Background()
	for _, args := range [][]string{{"link", "set", "lo", "up"}, {"link", "add", "eth0", "type", "dummy"}, {"link", "set", "eth0", "address", "02:00:17:00:00:01"}, {"link", "set", "eth0", "up"}, {"-6", "addr", "add", "2603:c020::99/64", "dev", "eth0"}, {"-6", "route", "add", "default", "via", "fe80::99", "dev", "eth0", "metric", "1234"}} {
		if err := runOCIIP(ctx, args...); err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(t.TempDir(), "oci-ipv6.json")
	plan := ociUplink{Name: "eth0", MAC: "02:00:17:00:00:01", Gateway: "fe80::1", Addresses: []string{"2603:c020::1", "2603:c020::2"}}
	if err := applyOCIUplinks(ctx, []ociUplink{plan}, path); err != nil {
		t.Fatal(err)
	}
	check := func(want, absent []string) {
		t.Helper()
		actual, err := interfaceOCIAddresses("eth0")
		if err != nil {
			t.Fatal(err)
		}
		for _, address := range want {
			if _, ok := actual[address]; !ok {
				t.Fatalf("address missing: %s", address)
			}
		}
		for _, address := range absent {
			if _, ok := actual[address]; ok {
				t.Fatalf("retired address still present: %s", address)
			}
		}
	}
	check([]string{"2603:c020::1", "2603:c020::2", "2603:c020::99"}, nil)
	// Simulated reboot/interface loss is repaired from authoritative allocation.
	if err := runOCIIP(ctx, "-6", "addr", "del", "2603:c020::2/128", "dev", "eth0"); err != nil {
		t.Fatal(err)
	}
	if err := applyOCIUplinks(ctx, []ociUplink{plan}, path); err != nil {
		t.Fatal(err)
	}
	check([]string{"2603:c020::2"}, nil)
	// A pre-existing /64 matching a cloud allocation is adopted and later
	// retired with its actual prefix length; unrelated static addresses remain.
	if err := runOCIIP(ctx, "-6", "addr", "add", "2603:c020::3/64", "dev", "eth0"); err != nil {
		t.Fatal(err)
	}
	plan.Addresses = []string{"2603:c020::2", "2603:c020::3"}
	if err := applyOCIUplinks(ctx, []ociUplink{plan}, path); err != nil {
		t.Fatal(err)
	}
	check([]string{"2603:c020::2", "2603:c020::3", "2603:c020::99"}, []string{"2603:c020::1"})
	plan.Addresses = []string{}
	plan.Gateway = ""
	if err := applyOCIUplinks(ctx, []ociUplink{plan}, path); err != nil {
		t.Fatal(err)
	}
	check([]string{"2603:c020::99"}, []string{"2603:c020::1", "2603:c020::2", "2603:c020::3"})
	routes, err := exec.CommandContext(ctx, "ip", "-6", "route", "show", "default").Output()
	if err != nil || !strings.Contains(string(routes), "metric 1234") || strings.Contains(string(routes), "metric "+ociRouteMetric) {
		t.Fatalf("unrelated route changed or owned route retained: %s, %v", routes, err)
	}
	state, err := loadOCIUplinkState(path)
	if err != nil || len(state.Uplinks) != 1 || len(state.Uplinks[0].Addresses) != 0 {
		t.Fatalf("incorrect final journal: %v, %v", state, err)
	}
	before, _ := json.Marshal(state)
	if err := applyOCIUplinks(ctx, []ociUplink{{Name: "eth0", MAC: "02:00:17:00:00:02", Addresses: []string{"2603:c020::4"}}}, path); err == nil {
		t.Fatal("interface identity change accepted")
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("failed identity check altered ownership")
	}
	t.Log("OCI IPv6 add, multiple addresses, replace, remove, reboot recovery, prefix adoption, MAC validation and manual route/address preservation passed")
}
