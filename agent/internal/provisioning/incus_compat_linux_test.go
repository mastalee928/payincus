//go:build linux

package provisioning

import (
	"context"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestCompatPermitAndGuestIdentity(t *testing.T) {
	good := &CompatPermit{RequestID: "11111111-1111-4111-8111-111111111111", HostIdentity: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ExpiresAt: time.Now().Add(60 * time.Second).UTC().Format(time.RFC3339Nano)}
	if !validCompatPermit(good) || validCompatPermit(nil) {
		t.Fatal("permit validation")
	}
	for _, v := range []CompatPermit{{}, {RequestID: good.RequestID, HostIdentity: good.HostIdentity, ExpiresAt: time.Now().Add(-time.Second).Format(time.RFC3339Nano)}} {
		if validCompatPermit(&v) {
			t.Fatal("expired/missing permit accepted")
		}
	}
	a := []compatGuest{{Name: "one", Status: "Running", Config: map[string]string{"volatile.uuid": "original"}}}
	if !sameCompatGuests(a, a) || sameCompatGuests(a, []compatGuest{{Name: "one", Status: "Running", Config: map[string]string{"volatile.uuid": "other"}}}) {
		t.Fatal("guest identity must be preserved")
	}
	if !compatibleCurrentGuests(a, []compatGuest{{Name: "one", Status: "Stopped", Config: map[string]string{"volatile.uuid": "original"}}}) || compatibleCurrentGuests([]compatGuest{{Name: "one", Status: "Stopped", Config: map[string]string{"volatile.uuid": "original"}}}, a) {
		t.Fatal("new expiry stop respected without resurrecting guest")
	}
	if _, e := compatProcessStart(os.Getpid()); e != nil {
		t.Fatal(e)
	}
}
func TestEmbeddedCompatibilityPayload(t *testing.T) {
	if os.Getenv("INCUDAL_COMPAT_PAYLOAD_TEST") != "1" {
		t.Skip("release payload only")
	}
	b, e := compatibilityBinary()
	if e != nil || len(b) < 1000000 {
		t.Fatal("payload", e)
	}
}
func TestNativeCompatibilityAutomaticReload(t *testing.T) {
	if os.Getenv("INCUDAL_SYSINFO_COMPAT_TEST") != "disposable" {
		t.Skip("disposable Alpine root only")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	before, e := compatGuests(ctx)
	if e != nil || len(before) != 1 || before[0].Name != "native-sysinfo" {
		t.Fatal("disposable guest scope", e)
	}
	// The fixture launched a real original daemon rather than OpenRC. Record
	// that actual PID as an installed service would, without replacing the guest.
	raw, e := os.ReadFile("/run/incus/incusd.pid")
	if e != nil {
		t.Fatal(e)
	}
	part := strings.TrimSpace(string(raw))
	pid, e := strconv.Atoi(part)
	exe, _ := os.Readlink("/proc/" + part + "/exe")
	cgroup, _ := os.ReadFile("/proc/" + part + "/cgroup")
	var state struct {
		PID int `json:"pid"`
	}
	data, readErr := run(ctx, "incus", "query", "/1.0/instances/native-sysinfo/state")
	if e != nil || pid < 2 || exe != "/usr/sbin/incusd" || readErr != nil || json.Unmarshal(data, &state) != nil || pid == state.PID || strings.Contains(string(cgroup), "lxc.monitor.") {
		t.Fatal("original daemon pid")
	}
	if e = os.MkdirAll("/var/lib/incudal-agent", 0700); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile("/run/incus/incusd.pid", []byte(strconv.Itoa(pid)), 0600); e != nil {
		t.Fatal(e)
	}
	p := &CompatPermit{RequestID: "11111111-1111-4111-8111-111111111111", HostIdentity: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ExpiresAt: time.Now().Add(240 * time.Second).UTC().Format(time.RFC3339Nano)}
	for _, g := range before {
		p.Guests = append(p.Guests, CompatGuestPermit{Name: g.Name, UUID: g.Config["volatile.uuid"], State: g.Status})
	}
	if e = prepareIncusCompatibility(ctx, p); e != nil {
		t.Fatal("automatic reload", e)
	}
	after, e := compatGuests(ctx)
	if e != nil || !sameCompatGuests(before, after) {
		t.Fatal("guest changed", e)
	}
	if e = prepareIncusCompatibility(ctx, p); e != nil {
		t.Fatal("idempotency", e)
	}
}
