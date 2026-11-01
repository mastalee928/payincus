package abuse

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestDependencyPlanUsesFixedPackagesAndKnownOS(t *testing.T) {
	for _, os := range []string{"debian", "ubuntu", "alpine"} {
		for _, ipv6 := range []bool{false, true} {
			plan, err := dependencyPlan("ID=\""+os+"\"\nPRETTY_NAME=anything\n", ipv6)
			if err != nil || len(plan) == 0 {
				t.Fatal(plan, err)
			}
			for _, step := range plan {
				args := strings.Join(step.args, " ")
				if step.name != "apt-get" && step.name != "apk" {
					t.Fatal("arbitrary executable", step)
				}
				for _, forbidden := range []string{"curl", "bash", "autoremove", "--allow-unauthenticated", "--allow-untrusted", "dist-upgrade", "systemctl"} {
					if strings.Contains(args, forbidden) {
						t.Fatal("unsafe dependency action", step)
					}
				}
			}
			last := strings.Join(plan[len(plan)-1].args, " ")
			if !strings.Contains(last, "iptables") || (os == "alpine" && strings.Contains(last, "ip6tables") != ipv6) {
				t.Fatal(plan)
			}
			if os != "alpine" && (!strings.Contains(last, "--no-upgrade") || !strings.Contains(last, "--no-remove")) {
				t.Fatal(plan)
			}
		}
	}
	for _, id := range []string{"", "ID=custom\nID_LIKE=debian", "ID=debian;touch /x", "ID=$(curl example)"} {
		if _, err := dependencyPlan(id, true); err == nil {
			t.Fatal("untrusted OS accepted", id)
		}
	}
}

func TestDependencyRepairDoesNotBlockHeartbeatAndConverges(t *testing.T) {
	f := newFixture(t)
	missing := true
	f.e.lookPath = func(name string) (string, error) {
		if missing && strings.HasPrefix(name, "ip") {
			return "", exec.ErrNotFound
		}
		return name, nil
	}
	started, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	f.e.repairDependencies = func(ctx context.Context, ipv6, module bool) error {
		if !ipv6 || module {
			t.Error("wrong repair scope")
		}
		close(started)
		select {
		case <-release:
		case <-ctx.Done():
			return ctx.Err()
		}
		f.e.mu.Lock()
		missing = false
		f.e.mu.Unlock()
		close(finished)
		return nil
	}
	p := Instruction{Revision: 1, BlockBT: true}
	s := f.e.Sync(context.Background(), &p)
	if s.Applied || s.ErrorCode != "DEPENDENCY_MISSING" {
		t.Fatal(s)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("repair was not started")
	}
	start := time.Now()
	if s = f.e.Sync(context.Background(), nil); s.Applied || time.Since(start) > time.Second {
		t.Fatal("repair blocked status heartbeat", s)
	}
	close(release)
	<-finished
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if f.e.Status().Applied {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("successful dependency repair did not apply policy", f.e.Status())
}

func TestDependencyRepairFailureBacksOffAndDisabledNeverInstalls(t *testing.T) {
	f := newFixture(t)
	calls := 0
	f.e.lookPath = func(name string) (string, error) {
		if strings.HasPrefix(name, "ip") {
			return "", exec.ErrNotFound
		}
		return name, nil
	}
	f.e.repairDependencies = func(context.Context, bool, bool) error {
		f.e.mu.Lock()
		calls++
		f.e.mu.Unlock()
		return errors.New("package mirror unavailable")
	}
	if f.e.Sync(context.Background(), nil) != nil {
		t.Fatal("unconfigured policy reported work")
	}
	p := Instruction{Revision: 1}
	f.e.Sync(context.Background(), &p)
	if calls != 0 {
		t.Fatal("disabled policy installed packages")
	}
	p.Revision++
	p.BlockMining = true
	f.e.Sync(context.Background(), &p)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		f.e.mu.Lock()
		done := !f.e.repairing && calls == 1
		f.e.mu.Unlock()
		if done {
			break
		}
		time.Sleep(time.Millisecond)
	}
	s := f.e.Sync(context.Background(), nil)
	f.e.mu.Lock()
	defer f.e.mu.Unlock()
	if calls != 1 || s.Applied || s.ErrorCode != "DEPENDENCY_MISSING" || s.NextRetryAt == "" {
		t.Fatal(calls, s)
	}
}

func TestUndurableDesiredPolicyCannotInstallDependencies(t *testing.T) {
	f := newFixture(t)
	f.failSave = true
	f.e.lookPath = func(name string) (string, error) {
		if strings.HasPrefix(name, "ip") {
			return "", exec.ErrNotFound
		}
		return name, nil
	}
	f.e.repairDependencies = func(context.Context, bool, bool) error {
		t.Error("installed packages without durable desired policy")
		return nil
	}
	p := Instruction{Revision: 1, BlockMining: true}
	s := f.e.Sync(context.Background(), &p)
	if s.ErrorCode != "PERSIST_FAILED" || f.e.repairing {
		t.Fatal(s)
	}
}

func TestSuccessfulRepairWithUnresolvedDependencyStillBacksOff(t *testing.T) {
	f := newFixture(t)
	f.e.lookPath = func(name string) (string, error) {
		if strings.HasPrefix(name, "ip") {
			return "", exec.ErrNotFound
		}
		return name, nil
	}
	calls := 0
	f.e.repairDependencies = func(context.Context, bool, bool) error { f.e.mu.Lock(); calls++; f.e.mu.Unlock(); return nil }
	p := Instruction{Revision: 1, BlockBT: true}
	f.e.Sync(context.Background(), &p)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		f.e.mu.Lock()
		done := calls == 1 && !f.e.repairing
		f.e.mu.Unlock()
		if done {
			break
		}
		time.Sleep(time.Millisecond)
	}
	s := f.e.Sync(context.Background(), nil)
	f.e.mu.Lock()
	defer f.e.mu.Unlock()
	if calls != 1 || s.Applied || s.ErrorCode != "DEPENDENCY_MISSING" || s.NextRetryAt == "" {
		t.Fatal("repair loop bypassed backoff", calls, s)
	}
}
