//go:build linux

package abuse

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestDependencyLockIsExclusiveAndRejectsSymlinks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dependencies.lock")
	unlock, err := dependencyLock(path)
	if err != nil {
		t.Fatal(err)
	}
	if second, err := dependencyLock(path); err == nil {
		second()
		t.Fatal("concurrent dependency installer admitted")
	}
	unlock()
	unlock, err = dependencyLock(path)
	if err != nil {
		t.Fatal("completed installer left stale lock", err)
	}
	unlock()
	if err := os.Chmod(path, 0666); err != nil {
		t.Fatal(err)
	}
	if unsafe, err := dependencyLock(path); err == nil {
		unsafe()
		t.Fatal("untrusted writable lock accepted")
	}
	link := filepath.Join(t.TempDir(), "link.lock")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if unsafe, err := dependencyLock(link); err == nil {
		unsafe()
		t.Fatal("symlink lock accepted")
	}
}

func TestDependencyCommandTimeoutTerminatesItsProcessGroup(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	started := time.Now()
	// Only this test's new process group is signaled; no package manager runs.
	err := runDependencyProcess(ctx, exec.Command("sh", "-c", "sleep 30 & wait"))
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(started) > 6*time.Second {
		t.Fatal(err, time.Since(started))
	}
}
