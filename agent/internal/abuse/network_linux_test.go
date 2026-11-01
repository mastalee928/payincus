//go:build linux

package abuse

import (
	"context"
	_ "embed"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

//go:embed network_probe.py
var networkProbe string

// All probe descendants inherit this new process group. Canceling the command
// must terminate the whole group, including processes holding output pipes open.
func namespaceTestCommand(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = append(os.Environ(), "INCUDAL_ABUSE_NETNS_INNER=1")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		if err == syscall.ESRCH {
			return os.ErrProcessDone
		}
		return err
	}
	// A descendant must not hold CombinedOutput open indefinitely, even if a
	// future probe explicitly detaches from the original process group.
	cmd.WaitDelay = time.Second
	return cmd.CombinedOutput()
}

// unshare creates a fresh network namespace before Python can issue any network
// command. There is only one subprocess group, including guest/server children.
func TestFirewallLinuxNamespace(t *testing.T) {
	if os.Getenv("INCUDAL_ABUSE_NETNS_TEST") != "1" {
		t.Skip("requires opt-in dedicated Linux network test host")
	}
	directory := t.TempDir()
	rules, err := Rules(Instruction{Revision: 1, BlockBT: true, BlockMining: true}, []string{"incusbr0", "tenant1"})
	if err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{"enable.rules": replacement("", rules), "disable.rules": replacement(strings.Join(rules, "\n"), nil), "probe.py": networkProbe} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	out, err := namespaceTestCommand(ctx, "unshare", "--net", "python3", filepath.Join(directory, "probe.py"), directory)
	if err != nil {
		t.Fatalf("packet assertions: %v\n%s", err, out)
	}
	for _, family := range []string{"iptables", "ip6tables"} {
		snapshot, err := os.ReadFile(filepath.Join(directory, family+".saved"))
		if err != nil || !matches(string(snapshot), rules) {
			t.Fatalf("real %s serialization mismatch: %v\n%s", family, err, snapshot)
		}
	}
	t.Log(string(out))
}

func TestNamespaceCommandTimeoutTerminatesDescendants(t *testing.T) {
	path := filepath.Join(t.TempDir(), "processes")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		// Both processes ignore TERM, so the assertion covers forced cleanup of
		// a child that keeps inherited stdout/stderr pipes open.
		_, err := namespaceTestCommand(ctx, "sh", "-c", `trap '' TERM; sleep 30 & child=$!; printf '%s %s\n' "$$" "$child" > "$1"; wait`, "namespace-test", path)
		done <- err
	}()
	var pids []int
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if data, err := os.ReadFile(path); err == nil {
			fields := strings.Fields(string(data))
			if len(fields) == 2 {
				for _, field := range fields {
					pid, err := strconv.Atoi(field)
					if err != nil || pid <= 1 {
						t.Fatalf("invalid child process identity: %q", data)
					}
					pids = append(pids, pid)
				}
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(pids) != 2 {
		t.Fatal("test process group did not become ready")
	}
	for _, pid := range pids {
		group, err := syscall.Getpgid(pid)
		if err != nil || group != pids[0] || group == syscall.Getpgrp() {
			t.Fatalf("child was not isolated from the test runner: pid=%d group=%d err=%v", pid, group, err)
		}
	}
	started := time.Now()
	select {
	case err := <-done:
		if err == nil || !errors.Is(ctx.Err(), context.DeadlineExceeded) {
			t.Fatalf("timed-out probe did not fail at its deadline: err=%v context=%v", err, ctx.Err())
		}
	case <-time.After(7 * time.Second):
		t.Fatal("canceled probe blocked on a surviving child or output pipe")
	}
	for _, pid := range pids {
		deadline = time.Now().Add(time.Second)
		for {
			data, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
			if os.IsNotExist(err) {
				break
			}
			// A zombie has exited and released its namespace/file descriptors;
			// its final PID removal belongs to the container or host init reaper.
			end := strings.LastIndexByte(string(data), ')')
			if err == nil && end >= 0 && len(data) > end+2 && (data[end+2] == 'Z' || data[end+2] == 'X') {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("canceled probe retained a live descendant: pid=%d err=%v", pid, err)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	t.Logf("isolated leader and descendant terminated after cancellation in %s", time.Since(started))
}
