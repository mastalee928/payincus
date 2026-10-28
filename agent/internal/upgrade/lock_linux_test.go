//go:build linux

package upgrade

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestUpgradeLockChild(t *testing.T) {
	path := os.Getenv("INCUDAL_TEST_UPGRADE_LOCK")
	if path == "" {
		return
	}
	unlock, err := acquireLock(path)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	fmt.Println("lock-held")
	for {
		time.Sleep(time.Second)
	}
}

func TestUpgradeLockOwnerDeathAndStableInode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "upgrade.lock")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestUpgradeLockChild$")
	child.Env = append(os.Environ(), "INCUDAL_TEST_UPGRADE_LOCK="+path)
	stdout, err := child.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	defer func() {
		_ = child.Process.Kill()
		if !waited {
			_ = child.Wait()
		}
	}()
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "lock-held" {
		t.Fatalf("child did not hold lock: %q %v", line, err)
	}
	if _, err := acquireLock(path); !errors.Is(err, ErrUpgradeInProgress) {
		t.Fatalf("live lock stolen: %v", err)
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := child.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = child.Wait()
	waited = true
	// Simulate death just after initial marker publication, before unlinking the
	// creator's temporary hard link. It must not make the fixed lock unusable.
	if err := os.Link(path, filepath.Join(filepath.Dir(path), "orphan-initialization-link")); err != nil {
		t.Fatal(err)
	}
	metadata, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	unlock, err := acquireLock(path)
	if err != nil {
		t.Fatalf("dead process retained kernel lock: %v", err)
	}
	unlock()
	second, err := acquireLock(path)
	if err != nil {
		t.Fatal(err)
	}
	defer second()
	unlock() // An old duplicate unlock cannot close the replacement's descriptor.
	if _, err := acquireLock(path); !errors.Is(err, ErrUpgradeInProgress) {
		t.Fatalf("old unlock released replacement: %v", err)
	}
	after, err := os.Stat(path)
	if err != nil || !os.SameFile(before, after) {
		t.Fatalf("lock inode was removed/replaced: %v", err)
	}
	if current, err := os.ReadFile(path); err != nil || string(current) != string(metadata) {
		t.Fatalf("existing lock metadata was rewritten: %q %v", current, err)
	}
}

func TestUpgradeLockLegacyOwnerAndUnsafePaths(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "upgrade.lock")
	for _, pid := range []string{"", "0\n", "-1\n", "not-a-pid\n", "2147483648\n"} {
		if err := os.WriteFile(path, []byte(pid), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := acquireLock(path); err == nil {
			t.Fatalf("accepted invalid PID %q", pid)
		}
	}
	live := fmt.Sprintf("%d\n", os.Getpid())
	if err := os.WriteFile(path, []byte(live), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := acquireLock(path); !errors.Is(err, ErrUpgradeInProgress) {
		t.Fatalf("legacy live owner was not protected: %v", err)
	}
	if value, err := os.ReadFile(path); err != nil || string(value) != live {
		t.Fatalf("legacy live metadata changed: %q %v", value, err)
	}
	// Obtain a known exited PID rather than assuming a constant PID is unused.
	child := exec.Command(os.Args[0], "-test.run=^TestUpgradeLockChild$")
	child.Env = append(os.Environ(), "INCUDAL_TEST_UPGRADE_LOCK=")
	if err := child.Run(); err != nil {
		t.Fatal(err)
	}
	pid := child.ProcessState.Pid()
	if !errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) {
		t.Skip("exited PID was reused; recovery must remain conservative")
	}
	if err := os.WriteFile(path, []byte(fmt.Sprintf("%d\n", pid)), 0600); err != nil {
		t.Fatal(err)
	}
	unlock, err := acquireLock(path)
	if err != nil {
		t.Fatalf("confirmed dead legacy owner not recovered: %v", err)
	}
	unlock()
	if err := os.Chmod(path, 0666); err != nil {
		t.Fatal(err)
	}
	if _, err := acquireLock(path); err == nil {
		t.Fatal("world-writable lock accepted")
	}
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "lock-link")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if _, err := acquireLock(link); err == nil {
		t.Fatal("symlink lock accepted")
	}
}
