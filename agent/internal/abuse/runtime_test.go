package abuse

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fixture struct {
	e          *Engine
	saved      []byte
	snapshots  map[string]string
	calls      int
	clock      time.Time
	failFamily string
	failSave   bool
	incusDown  bool
	ipv6       bool
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{snapshots: map[string]string{}, clock: time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), ipv6: true}
	e := newEngine(filepath.Join(t.TempDir(), "state.json"))
	f.e = e
	e.repairDependencies = nil
	e.now = func() time.Time { return f.clock }
	e.lookPath = func(name string) (string, error) { return name, nil }
	e.ipv6Available = func() bool { return f.ipv6 }
	e.ensureService = func(context.Context) error { return nil }
	e.persist = func(_ string, data []byte) error {
		if f.failSave {
			return errors.New("disk full")
		}
		f.saved = append([]byte(nil), data...)
		return nil
	}
	e.run = func(_ context.Context, name, input string, args ...string) (string, error) {
		f.calls++
		if name == "incus" {
			if f.incusDown {
				return "", errors.New("incus unavailable")
			}
			if args[0] == "network" {
				return `[{"name":"incusbr0","type":"bridge","managed":true,"config":{"ipv6.address":"none"}}]`, nil
			}
			return `[{"project":"default","expanded_devices":{"eth0":{"type":"nic","network":"incusbr0"}}}]`, nil
		}
		family := strings.TrimSuffix(strings.TrimSuffix(name, "-save"), "-restore")
		if strings.HasSuffix(name, "-save") {
			return f.snapshots[family], nil
		}
		if strings.Contains(strings.Join(args, " "), "--test") {
			return "", nil
		}
		if family == f.failFamily {
			f.failFamily = ""
			return "", errors.New("injected family failure")
		}
		var rules []string
		for _, line := range strings.Split(input, "\n") {
			if strings.HasPrefix(line, "-I FORWARD 1 ") {
				rules = append([]string{strings.Replace(line, "-I FORWARD 1", "-A FORWARD", 1)}, rules...)
			}
			if strings.HasPrefix(line, "-A ") {
				rules = append(rules, line)
			}
		}
		f.snapshots[family] = strings.Join(rules, "\n")
		return "", nil
	}
	return f
}

func TestNeverConfiguredDoesNotTouchFirewall(t *testing.T) {
	f := newFixture(t)
	if status := f.e.Sync(context.Background(), nil); status != nil || f.calls != 0 || len(f.saved) != 0 {
		t.Fatal(status, f.calls)
	}
	if err := f.e.Restore(context.Background()); err != nil || f.calls != 0 {
		t.Fatal(err, f.calls)
	}
}

func TestApplyDriftOfflineRestoreAndRemoval(t *testing.T) {
	f := newFixture(t)
	p := Instruction{Revision: 1, BlockBT: true, BlockMining: true}
	if s := f.e.Sync(context.Background(), &p); s == nil || !s.Applied {
		t.Fatal(s)
	}
	original := f.snapshots["iptables"]
	f.snapshots["iptables"] = "-A FORWARD -j ACCEPT\n" + original
	if s := f.e.Sync(context.Background(), nil); !s.Applied || f.snapshots["iptables"] != original {
		t.Fatal("offline drift not repaired", s)
	}
	var persisted diskState
	if err := json.Unmarshal(f.saved, &persisted); err != nil || persisted.Policy == nil || len(persisted.Bridges) != 1 {
		t.Fatal(persisted, err)
	}
	if err := os.WriteFile(f.e.path, f.saved, 0600); err != nil {
		t.Fatal(err)
	}
	f.e.loaded = false
	f.e.state = diskState{}
	f.snapshots = map[string]string{}
	f.incusDown = true
	if err := f.e.Restore(context.Background()); err != nil || !f.e.Status().Applied {
		t.Fatal("boot restore required Incus", err)
	}
	if f.snapshots["iptables"] != original || f.snapshots["ip6tables"] != original {
		t.Fatal("boot did not restore both families")
	}
	p.Revision++
	p.BlockBT = false
	p.BlockMining = false
	if s := f.e.Sync(context.Background(), &p); !s.Applied || f.snapshots["iptables"] != "" || f.snapshots["ip6tables"] != "" {
		t.Fatal("disable failed", s)
	}
}

func TestFailureBackoffPersistsAndNewNonceRetries(t *testing.T) {
	f := newFixture(t)
	p := Instruction{Revision: 1, BlockBT: true}
	f.e.lookPath = func(string) (string, error) { return "", exec.ErrNotFound }
	s := f.e.Sync(context.Background(), &p)
	if s.Applied || s.ErrorCode != "DEPENDENCY_MISSING" || s.Attempts != 1 || s.NextRetryAt == "" {
		t.Fatal(s)
	}
	calls := f.calls
	if again := f.e.Sync(context.Background(), &p); again.Attempts != 1 || f.calls != calls {
		t.Fatal("backoff bypassed", again)
	}
	var saved diskState
	json.Unmarshal(f.saved, &saved)
	if saved.Status.NextRetryAt != s.NextRetryAt {
		t.Fatal("retry state not persisted")
	}
	p.RetryNonce++
	f.e.lookPath = func(name string) (string, error) { return name, nil }
	if s = f.e.Sync(context.Background(), &p); !s.Applied {
		t.Fatal("manual retry stayed delayed", s)
	}
	old := p
	old.Revision = 0
	if s = f.e.Sync(context.Background(), &old); s.ErrorCode != "INVALID_POLICY" {
		t.Fatal(s)
	}
	old = p
	old.RetryNonce = 0
	old.BlockBT = false
	if s = f.e.Sync(context.Background(), &old); !s.Applied || !s.BlockBT || s.RetryNonce != 1 {
		t.Fatal("delayed response downgraded desired state", s)
	}
}

func TestFamilyFailureRollsBackOnlyOwnRules(t *testing.T) {
	f := newFixture(t)
	p := Instruction{Revision: 1, BlockBT: true}
	if s := f.e.Sync(context.Background(), &p); !s.Applied {
		t.Fatal(s)
	}
	previous := f.snapshots["iptables"]
	p.Revision++
	p.BlockMining = true
	f.failFamily = "ip6tables"
	if s := f.e.Sync(context.Background(), &p); s.Applied || s.ErrorCode != "APPLY_FAILED" {
		t.Fatal(s)
	}
	if f.snapshots["iptables"] != previous || f.snapshots["ip6tables"] != previous {
		t.Fatal("partially applied families retained")
	}
}

func TestPersistenceFailureDoesNotClaimSuccess(t *testing.T) {
	f := newFixture(t)
	f.failSave = true
	p := Instruction{Revision: 1, BlockMining: true}
	if s := f.e.Sync(context.Background(), &p); s.Applied || s.ErrorCode != "PERSIST_FAILED" {
		t.Fatal(s)
	}
	if f.snapshots["iptables"] != "" {
		t.Fatal("rules changed before desired state was durable")
	}
}

func TestIPv4OnlyAndMissingIPv6Coverage(t *testing.T) {
	f := newFixture(t)
	f.ipv6 = false
	p := Instruction{Revision: 1, BlockBT: true}
	if s := f.e.Sync(context.Background(), &p); !s.Applied || f.snapshots["ip6tables"] != "" {
		t.Fatal(s)
	}
	f.e.state.IPv6 = true
	if err := f.e.Restore(context.Background()); err == nil || f.e.Status().ErrorCode != "UNSUPPORTED_NETWORK" {
		t.Fatal("saved IPv6 falsely covered", err)
	}
	p.Revision++
	p.BlockBT = false
	if s := f.e.Sync(context.Background(), &p); !s.Applied || f.snapshots["iptables"] != "" {
		t.Fatal("IPv6-disabled host could not remove IPv4 policy", s)
	}
}

func TestBackoffIsCappedAndMissingIPv6ToolIsNotSuccess(t *testing.T) {
	f := newFixture(t)
	p := Instruction{Revision: 1, BlockBT: true}
	f.e.lookPath = func(name string) (string, error) {
		if strings.HasPrefix(name, "ip6tables") {
			return "", exec.ErrNotFound
		}
		return name, nil
	}
	for attempt := 1; attempt <= 10; attempt++ {
		s := f.e.Sync(context.Background(), &p)
		if s.Applied || s.ErrorCode != "DEPENDENCY_MISSING" || s.Attempts != attempt {
			t.Fatal(s)
		}
		next, err := time.Parse(time.RFC3339, s.NextRetryAt)
		if err != nil || next.Sub(f.clock) > 15*time.Minute {
			t.Fatal("unbounded retry delay", s, err)
		}
		f.clock = next
	}
	if f.snapshots["iptables"] != "" {
		t.Fatal("IPv4 modified despite unavailable required IPv6")
	}
}

func TestTimeoutRetainsPreviousRulesAndRetries(t *testing.T) {
	f := newFixture(t)
	p := Instruction{Revision: 1, BlockBT: true}
	if s := f.e.Sync(context.Background(), &p); !s.Applied {
		t.Fatal(s)
	}
	before := f.snapshots["iptables"]
	run := f.e.run
	f.e.run = func(ctx context.Context, name, input string, args ...string) (string, error) {
		if name == "incus" {
			return "", context.DeadlineExceeded
		}
		return run(ctx, name, input, args...)
	}
	if s := f.e.Sync(context.Background(), nil); s.Applied || s.ErrorCode != "NETWORK_DISCOVERY_FAILED" || f.snapshots["iptables"] != before {
		t.Fatal(s)
	}
	f.e.run = run
	f.clock = f.clock.Add(16 * time.Second)
	if s := f.e.Sync(context.Background(), nil); !s.Applied {
		t.Fatal("offline local retry failed", s)
	}
}
