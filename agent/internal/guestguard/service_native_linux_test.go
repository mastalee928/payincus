//go:build linux

package guestguard

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Explicit opt-in on a disposable machine. Exercise the real init manager
// with a harmless stand-in daemon, never replace an installed Incus service.
func TestNativeBootDependencyContinuation(t *testing.T) {
	if os.Getenv("INCUDAL_GUEST_GUARD_SERVICE_TEST") != "1" {
		t.Skip("requires disposable init-system machine")
	}
	binary := os.Getenv("INCUDAL_GUEST_GUARD_AGENT_BINARY")
	if !filepath.IsAbs(binary) {
		t.Fatal("explicit built agent path required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	systemd := false
	if _, err := os.Stat("/run/systemd/system"); err == nil {
		systemd = true
	}
	for _, path := range []string{statePath, bootPendingPath, "/etc/incudal-onboarding-id", "/etc/init.d/incusd", "/etc/init.d/incus", "/etc/systemd/system/incus.service", "/etc/systemd/system/incus.socket", "/usr/lib/systemd/system/incus.service", "/lib/systemd/system/incus.service", "/etc/init.d/incudal-guest-guard", "/etc/systemd/system/incudal-guest-guard.service"} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatal("test refuses existing host configuration", path, err)
		}
	}
	manager := "rc-service"
	unit := "incusd"
	fixture := "/etc/init.d/incusd"
	contents := "#!/sbin/openrc-run\ndescription=\"Disposable dependency probe\"\nstart() { return 0; }\nstop() { return 0; }\n"
	if systemd {
		manager = "systemctl"
		unit = "incus.service"
		fixture = "/etc/systemd/system/incus.service"
		contents = "[Unit]\nDescription=Disposable dependency probe\n[Service]\nType=oneshot\nExecStart=/bin/true\nRemainAfterExit=yes\n[Install]\nWantedBy=multi-user.target\n"
	}
	action := func(verb string) (string, error) {
		// Real init startup includes several subprocesses; do not cut it off at
		// the individual nft command's production deadline.
		run := func(args ...string) (string, error) {
			c := exec.CommandContext(ctx, manager, args...)
			out, err := c.CombinedOutput()
			if err != nil {
				return string(out), fmt.Errorf("%s: %w", out, err)
			}
			return string(out), nil
		}
		if systemd {
			return run(verb, unit)
		}
		return run(unit, verb)
	}
	write := func(path, stringValue string, mode os.FileMode) {
		t.Helper()
		if err := os.WriteFile(path, []byte(stringValue), mode); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Dir(statePath), 0700); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = action("stop")
		if systemd {
			_, _ = command(ctx, manager, "", "stop", "incudal-guest-guard.service")
			_, _ = command(ctx, manager, "", "disable", unit, "incudal-guest-guard.service")
		} else {
			_, _ = command(ctx, manager, "", "incudal-guest-guard", "stop")
			_, _ = command(ctx, "rc-update", "", "del", unit, "default")
			_, _ = command(ctx, "rc-update", "", "del", "incudal-guest-guard", "boot")
		}
		for _, path := range []string{fixture, statePath, bootPendingPath, statePath + ".lock", "/etc/incudal-onboarding-id", "/etc/init.d/incudal-guest-guard", "/etc/conf.d/incusd", "/etc/systemd/system/incudal-guest-guard.service", "/etc/systemd/system/incus.service.d/30-incudal-guest-guard.conf", "/etc/systemd/system/incus.socket.d/30-incudal-guest-guard.conf"} {
			_ = os.Remove(path)
		}
		_, _ = command(ctx, "nft", "", "delete", "table", "inet", Table)
		if systemd {
			_, _ = command(ctx, manager, "", "daemon-reload")
		}
	}()
	write(fixture, contents, 0755)
	write("/etc/incudal-onboarding-id", "disposable-guest-guard-test\n", 0600)
	write(statePath, "invalid-policy", 0600)
	if err := ensureServiceForBinary(ctx, binary); err != nil {
		t.Fatal(err)
	}
	if systemd {
		if _, err := command(ctx, manager, "", "enable", unit); err != nil {
			t.Fatal(err)
		}
	} else {
		if _, err := command(ctx, "rc-update", "", "add", unit, "default"); err != nil {
			t.Fatal(err)
		}
	}
	if output, err := action("start"); err == nil {
		t.Fatal("daemon started despite failed protection")
	} else {
		t.Log("expected initial dependency failure", output, err)
	}
	if _, err := os.Stat(bootPendingPath); err != nil {
		t.Fatal("failed restore lost continuation receipt", err)
	}
	p, _ := json.Marshal(Policy{Bridges: []string{"incusbr0"}, Management: []string{"192.0.2.20"}})
	write(statePath, string(p), 0600)
	e := New()
	var last error
	for i := 0; i < 12; i++ {
		last = e.RecoverBoot(ctx)
		if last == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if last != nil {
		t.Fatal("repaired boot did not resume", last)
	}
	activeVerb := "status"
	if systemd {
		activeVerb = "is-active"
	}
	if output, err := action(activeVerb); err != nil {
		t.Fatal("daemon still blocked", output, err)
	}
	if _, err := os.Stat(bootPendingPath); !os.IsNotExist(err) {
		t.Fatal("completed boot receipt retained", err)
	}
	if _, err := action("stop"); err != nil {
		t.Fatal(err)
	}
	if err := e.RecoverBoot(ctx); err != nil {
		t.Fatal(err)
	}
	if output, err := action(activeVerb); err == nil || systemd && strings.TrimSpace(output) == "active" {
		t.Fatal("manual stop was undone")
	}
	t.Log("PASS real init dependency failure -> protected automatic continuation -> manual stop retained")
}
