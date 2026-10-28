//go:build linux

package upgrade

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSystemdFallbackQueuesBeforeContextCancellation(t *testing.T) {
	dir := t.TempDir()
	log := filepath.Join(dir, "queued")
	for name, script := range map[string]string{
		"systemd-run": "#!/bin/sh\nexit 1\n",
		"systemctl":   "#!/bin/sh\nprintf '%s %s %s\\n' \"$1\" \"$2\" \"$3\" > \"$INCUDAL_TEST_RESTART_LOG\"\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", dir)
	t.Setenv("INCUDAL_TEST_RESTART_LOG", log)
	ctx, cancel := context.WithCancel(context.Background())
	if err := restartSystemdService(ctx, "incudal-agent"); err != nil {
		cancel()
		t.Fatal(err)
	}
	cancel()
	value, err := os.ReadFile(log)
	if err != nil || string(value) != "--no-block restart incudal-agent\n" {
		t.Fatalf("restart was not acknowledged before return: %q %v", value, err)
	}
	if err := os.Remove(log); err != nil {
		t.Fatal(err)
	}
	if err := restartSystemdService(ctx, "incudal-agent"); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled upgrade queued restart: %v", err)
	}
	if _, err := os.Stat(log); !os.IsNotExist(err) {
		t.Fatal("canceled request executed systemctl")
	}
}

func TestSystemdFallbackHasFiniteDeadline(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "systemd-run"), []byte("#!/bin/sh\nexit 1\n"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "systemctl"), []byte("#!/bin/sh\nwhile :; do :; done\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	started := time.Now()
	err := restartSystemdServiceWithin(context.Background(), "incudal-agent", 100*time.Millisecond)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected finite manager deadline: %v", err)
	}
	if time.Since(started) > 3*time.Second {
		t.Fatal("fallback did not return within its deadline")
	}
	for _, service := range []string{"../agent", "agent;bad", "-bad", ""} {
		if err := restartSystemdService(context.Background(), service); err == nil || !strings.Contains(err.Error(), "invalid") {
			t.Fatalf("unsafe service accepted: %q %v", service, err)
		}
	}
}
