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
func TestCompatibilityEmptyAndActiveOperations(t *testing.T) {
	for _, response := range []string{`{"type":"sync","status_code":200,"metadata":{}}`, `{"type":"sync","status_code":200,"metadata":{"success":[{"status":"Success"}]}}`} {
		if !compatOperationsIdle([]byte(response)) {
			t.Fatal("idle response rejected")
		}
	}
	for _, response := range []string{"", `{}`, `{"type":"error","status_code":500,"metadata":{}}`, `{"type":"sync","status_code":200,"metadata":null}`, `{"type":"sync","status_code":200,"metadata":{"running":[{"status":"Running"}]}}`, `{"type":"sync","status_code":200,"metadata":{"unknown":[{}]}}`} {
		if compatOperationsIdle([]byte(response)) {
			t.Fatal("unconfirmed response accepted")
		}
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
	if os.Getenv("INCUDAL_COMPAT_RELOAD_SCENARIO") == "prepared-resume" {
		original, readErr := os.ReadFile("/usr/sbin/incusd")
		fixed, payloadErr := compatibilityBinary()
		start, startErr := compatProcessStart(pid)
		if readErr != nil || payloadErr != nil || startErr != nil {
			t.Fatal("prepared fixture", readErr, payloadErr, startErr)
		}
		if e = os.WriteFile(compatBackupPath, original, 0700); e != nil {
			t.Fatal(e)
		}
		j := compatJournal{Version: 1, OldHash: compatHash(original), NewHash: compatHash(fixed), PID: pid, ProcessStart: start, RequestID: p.RequestID, HostIdentity: p.HostIdentity, Phase: "prepared", Guests: before}
		if e = saveCompatJournal(j); e != nil {
			t.Fatal(e)
		}
		if e = replaceCompatBinary(fixed); e != nil {
			t.Fatal(e)
		}
		if e = prepareIncusCompatibility(ctx, p); e != nil {
			t.Fatal("prepared recovery", e)
		}
		current, _ := os.ReadFile("/usr/sbin/incusd")
		if compatHash(current) != j.OldHash {
			t.Fatal("prepared recovery did not restore original binary")
		}
	}
	if os.Getenv("INCUDAL_COMPAT_RELOAD_SCENARIO") == "rollback-retry" {
		// An invalid networking dependency makes the first real OpenRC start
		// fail. Repair the disposable dependency and let the saved reloading
		// journal resume, with the original guest still present.
		path := "/etc/network/interfaces"
		original, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if e = os.Remove(path); e != nil {
			t.Fatal(e)
		}
		e = prepareIncusCompatibility(ctx, p)
		if restoreErr := os.WriteFile(path, original, 0644); restoreErr != nil {
			t.Fatal(restoreErr)
		}
		if e == nil {
			t.Fatal("failed service startup reported success")
		}
		journalData, readErr := os.ReadFile(compatJournalPath)
		var j compatJournal
		if readErr != nil || json.Unmarshal(journalData, &j) != nil || j.Phase != "rolling-back" {
			t.Fatal("failed service lost durable reload intent", readErr)
		}
		if e = prepareIncusCompatibility(ctx, p); e == nil || !strings.Contains(e.Error(), "rolled back; retry pending") {
			t.Fatal("automatic rollback", e)
		}
		current, _ := os.ReadFile("/usr/sbin/incusd")
		if compatHash(current) != j.OldHash {
			t.Fatal("rollback binary not restored")
		}
		restored, readErr := compatGuests(ctx)
		if readErr != nil || !sameCompatGuests(before, restored) {
			t.Fatal("rollback changed guest", readErr)
		}
	}
	for {
		e = prepareIncusCompatibility(ctx, p)
		if e == nil || !strings.Contains(e.Error(), "waits for active operations") {
			break
		}
		// A recovered original daemon can still be settling its real Incus
		// operations. Exercise the same bounded retry as the Agent; do not
		// cancel operations or waive the product's idle requirement.
		select {
		case <-ctx.Done():
			diagnosticCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
			operations, _ := run(diagnosticCtx, "incus", "query", "/1.0/operations?recursion=1")
			stop()
			t.Log("disposable operations", string(operations))
			t.Fatal("automatic reload did not become idle", ctx.Err())
		case <-time.After(time.Second):
		}
	}
	if e != nil {
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
func TestNativeCompatibilityEmptyPoolReload(t *testing.T) {
	if os.Getenv("INCUDAL_SYSINFO_COMPAT_TEST") != "disposable" || os.Getenv("INCUDAL_COMPAT_RELOAD_SCENARIO") != "empty-pool" {
		t.Skip("disposable empty pool only")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	rows, err := compatGuests(ctx)
	if err != nil || len(rows) != 0 {
		t.Fatal("pool not empty", err)
	}
	for {
		raw, queryErr := run(ctx, "incus", "query", "--raw", "/1.0/operations?recursion=1")
		if queryErr != nil {
			t.Fatal(queryErr)
		}
		var response struct {
			Metadata map[string][]json.RawMessage `json:"metadata"`
		}
		if json.Unmarshal(raw, &response) != nil {
			t.Fatal("empty-pool response invalid")
		}
		if len(response.Metadata) == 0 {
			if !compatOperationsIdle(raw) {
				t.Fatal("real empty envelope rejected")
			}
			plain, queryErr := run(ctx, "incus", "query", "/1.0/operations?recursion=1")
			if queryErr != nil || len(strings.TrimSpace(string(plain))) != 0 {
				t.Fatal("real suppressed empty query response", queryErr)
			}
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("fixture setup operations did not settle")
		case <-time.After(time.Second):
		}
	}
	p := &CompatPermit{RequestID: "11111111-1111-4111-8111-111111111111", HostIdentity: strings.Repeat("a", 64), ExpiresAt: time.Now().Add(240 * time.Second).UTC().Format(time.RFC3339Nano)}
	if err = prepareIncusCompatibility(ctx, p); err != nil {
		t.Fatal("empty pool automatic reload", err)
	}
	if err = prepareIncusCompatibility(ctx, p); err != nil {
		t.Fatal("empty pool idempotency", err)
	}
	status, request, _ := incusCompatibilityStatus(ctx)
	if status != "verified" || request != p.RequestID {
		t.Fatal("empty pool receipt missing")
	}
}
