package guestguard

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBootRecoveryRetainsFailureAndDoesNotUndoManualStop(t *testing.T) {
	dir := t.TempDir()
	pending := filepath.Join(dir, "pending")
	boot := filepath.Join(dir, "boot")
	id := []byte("test-current-boot-identifier\n")
	if err := os.WriteFile(boot, id, 0600); err != nil {
		t.Fatal(err)
	}
	restores, resumes := 0, 0
	failRestore, failResume := true, true
	restore := func(context.Context) error {
		restores++
		if failRestore {
			return errors.New("nft unavailable")
		}
		return nil
	}
	resume := func(context.Context) error {
		resumes++
		if failResume {
			return errors.New("start pending")
		}
		return nil
	}
	recover := func() error { return recoverBoot(context.Background(), pending, boot, restore, resume) }
	if err := recover(); err != nil || restores != 0 || resumes != 0 {
		t.Fatal("manual stop touched", err)
	}
	if err := os.WriteFile(pending, id, 0600); err != nil {
		t.Fatal(err)
	}
	if err := recover(); err == nil || resumes != 0 {
		t.Fatal("started without protection")
	}
	failRestore = false
	if err := recover(); err == nil {
		t.Fatal("lost failed continuation")
	}
	if _, err := os.Stat(pending); err != nil {
		t.Fatal(err)
	}
	failResume = false
	if err := recover(); err != nil {
		t.Fatal(err)
	}
	count := resumes
	if err := recover(); err != nil || resumes != count {
		t.Fatal("restarted after completed receipt")
	}
	if err := os.WriteFile(pending, []byte("another-old-boot-identifier"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := recover(); err != nil || resumes != count {
		t.Fatal("old boot replayed")
	}
}

func TestBootServiceContinuationOnlyStartsEnabledStoppedUnits(t *testing.T) {
	for _, systemd := range []bool{false, true} {
		var starts []string
		active := map[string]bool{}
		exists := func(path string) bool {
			return path == "/run/systemd/system" && systemd || !systemd && path == "/etc/runlevels/default/incusd"
		}
		run := func(_ context.Context, name, input string, args ...string) (string, error) {
			command := strings.Join(args, " ")
			if name == "systemctl" {
				unit := args[len(args)-1]
				switch args[0] {
				case "is-enabled":
					if unit == "incus.service" {
						return "", errors.New("disabled")
					}
				case "is-active":
					if !active[unit] {
						return "", errors.New("inactive")
					}
				case "start":
					starts = append(starts, unit)
					active[unit] = true
				default:
					t.Fatal("unexpected action", command)
				}
			} else {
				unit := args[0]
				switch args[1] {
				case "status":
					if !active[unit] {
						return "", errors.New("stopped")
					}
				case "start":
					starts = append(starts, unit)
					active[unit] = true
				default:
					t.Fatal("unexpected action", command)
				}
			}
			return "", nil
		}
		if err := resumeServices(context.Background(), run, exists); err != nil {
			t.Fatal(err)
		}
		if len(starts) != 2 {
			t.Fatal("did not limit continuation to enabled daemons", starts)
		}
		if err := resumeServices(context.Background(), run, exists); err != nil || len(starts) != 2 {
			t.Fatal("active daemon restarted", starts, err)
		}
	}
}
