package upgrade

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestOpenRCRestartRejectsUnsafeService(t *testing.T) {
	for _, name := range []string{"../sshd", "agent;touch /tmp/unwanted", "-bad"} {
		if err := restartOpenRCService(context.Background(), name); err == nil {
			t.Fatalf("accepted unsafe service name %q", name)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := restartOpenRCService(ctx, "incudal-agent"); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation before scheduling, got %v", err)
	}
}

func TestOpenRCRestartSurvivesCompletedUpgradeContext(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("OpenRC restart uses Linux sessions")
	}
	if _, err := exec.LookPath("setsid"); err != nil {
		t.Skip("setsid is unavailable")
	}
	dir := t.TempDir()
	logPath := filepath.Join(dir, "restart.log")
	script := "#!/bin/sh\nprintf '%s %s\\n' \"$1\" \"$2\" > \"$RESTART_TEST_LOG\"\n"
	if err := os.WriteFile(filepath.Join(dir, "rc-service"), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("RESTART_TEST_LOG", logPath)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := restartOpenRCService(ctx, "incudal-agent"); err != nil {
		t.Fatal(err)
	}
	cancel()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if content, err := os.ReadFile(logPath); err == nil {
			if string(content) != "incudal-agent restart\n" {
				t.Fatalf("unexpected restart: %q", content)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("scheduled restart was lost when the upgrade context completed")
}
