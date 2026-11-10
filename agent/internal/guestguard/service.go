package guestguard

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const bootPendingPath = "/var/lib/incudal-agent/guest-guard-boot-pending"

// This receipt records a failed boot restore, not a general desire to run
// Incus. A manually stopped daemon without that receipt is never started.
func (e *Engine) RestoreAtBoot(ctx context.Context) error {
	err := e.Restore(ctx)
	if err != nil {
		boot, readErr := os.ReadFile("/proc/sys/kernel/random/boot_id")
		if readErr == nil {
			if saveErr := atomicWrite(bootPendingPath, boot); saveErr != nil {
				return fmt.Errorf("guest protection restore and recovery receipt failed")
			}
		}
	}
	return err
}

func (e *Engine) RecoverBoot(ctx context.Context) error {
	return recoverBoot(ctx, bootPendingPath, "/proc/sys/kernel/random/boot_id", e.Restore, resumeBootServices)
}

func recoverBoot(ctx context.Context, pending, bootPath string, restore, resume func(context.Context) error) error {
	saved, err := os.ReadFile(pending)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	boot, err := os.ReadFile(bootPath)
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(saved)) != strings.TrimSpace(string(boot)) || len(boot) < 16 {
		return os.Remove(pending)
	}
	// Restore releases its flock before the service manager starts the boot
	// unit, which runs the same restore command and must acquire that lock.
	if err := restore(ctx); err != nil {
		return err
	}
	if err := resume(ctx); err != nil {
		return err
	}
	return os.Remove(pending)
}

func resumeBootServices(ctx context.Context) error {
	run := func(ctx context.Context, name, input string, args ...string) (string, error) {
		// OpenRC waits for the bounded 20s restore child. The normal 5s nft
		// command deadline must not kill its supervising service manager first.
		return commandWithin(ctx, 30*time.Second, name, input, args...)
	}
	return resumeServices(ctx, run, func(path string) bool { _, err := os.Stat(path); return err == nil })
}

func resumeServices(ctx context.Context, run runner, exists func(string) bool) error {
	if exists("/run/systemd/system") {
		for _, unit := range []string{"incudal-guest-guard.service", "incus.socket", "incus.service"} {
			if unit != "incudal-guest-guard.service" {
				if _, err := run(ctx, "systemctl", "", "is-enabled", "--quiet", unit); err != nil {
					continue
				}
			}
			if _, err := run(ctx, "systemctl", "", "is-active", "--quiet", unit); err == nil {
				continue
			}
			if _, err := run(ctx, "systemctl", "", "start", "--no-block", unit); err != nil {
				return err
			}
			if _, err := run(ctx, "systemctl", "", "is-active", "--quiet", unit); err != nil {
				return fmt.Errorf("guest protection boot recovery pending")
			}
		}
		return nil
	}
	for _, service := range []string{"incudal-guest-guard", "incus", "incusd"} {
		if service != "incudal-guest-guard" && !exists("/etc/runlevels/default/"+service) && !exists("/etc/runlevels/boot/"+service) {
			continue
		}
		if _, err := run(ctx, "rc-service", "", service, "status"); err == nil {
			continue
		}
		if _, err := run(ctx, "rc-service", "", service, "start"); err != nil {
			return err
		}
		if _, err := run(ctx, "rc-service", "", service, "status"); err != nil {
			return err
		}
	}
	return nil
}

func serviceContent(binary string, openRC bool) (string, error) {
	if !regexp.MustCompile(`^/[A-Za-z0-9_./-]+$`).MatchString(binary) {
		return "", fmt.Errorf("invalid guest protection executable")
	}
	if openRC {
		return "#!/sbin/openrc-run\ndescription=\"Restore Incudal customer network protection\"\ndepend() {\n  need localmount\n  after firewall nftables iptables ip6tables\n  before incus incusd incudal-agent\n}\nstart() {\n  ebegin \"Restoring customer network protection\"\n  " + binary + " -restore-guest-guard\n  eend $?\n}\n", nil
	}
	return "[Unit]\nDescription=Restore Incudal customer network protection\nDefaultDependencies=no\nAfter=local-fs.target nftables.service netfilter-persistent.service\nBefore=network-pre.target incus.service incus.socket incudal-agent.service\nWants=network-pre.target\n\n[Service]\nType=oneshot\nExecStart=" + binary + " -restore-guest-guard\nRemainAfterExit=yes\n\n[Install]\nWantedBy=multi-user.target\n", nil
}
func ensureService(ctx context.Context) error {
	binary, err := os.Executable()
	if err != nil {
		return err
	}
	return ensureServiceForBinary(ctx, binary)
}

func ensureServiceForBinary(ctx context.Context, binary string) error {
	var err error
	path := "/etc/systemd/system/incudal-guest-guard.service"
	openRC := false
	mode := os.FileMode(0644)
	if _, err := os.Stat("/run/systemd/system"); err != nil {
		if _, err := exec.LookPath("rc-update"); err != nil {
			return fmt.Errorf("guest protection requires systemd or OpenRC")
		}
		path = "/etc/init.d/incudal-guest-guard"
		openRC = true
		mode = 0755
	}
	content, err := serviceContent(binary, openRC)
	if err != nil {
		return err
	}
	old, readErr := os.ReadFile(path)
	changed := readErr != nil || string(old) != content
	if changed {
		if err = atomicWrite(path, []byte(content)); err != nil {
			return err
		}
	}
	if err = os.Chmod(path, mode); err != nil {
		return err
	}
	if openRC {
		// OpenRC's "before" only orders services; it does not prevent Incus
		// starting after a failed restore. Add a real dependency, preserving
		// administrator configuration and avoiding any daemon restart.
		for _, name := range []string{"incus", "incusd"} {
			if _, statErr := os.Stat("/etc/init.d/" + name); statErr != nil {
				continue
			}
			config := "/etc/conf.d/" + name
			configMode := os.FileMode(0644)
			if info, statErr := os.Stat(config); statErr == nil {
				configMode = info.Mode().Perm()
			} else if !os.IsNotExist(statErr) {
				return statErr
			}
			data, readErr := os.ReadFile(config)
			if readErr != nil && !os.IsNotExist(readErr) {
				return readErr
			}
			line := "\n# incudal customer network protection dependency\nrc_need=\"${rc_need} incudal-guest-guard\"\n"
			if !strings.Contains(string(data), line) {
				if err = atomicWrite(config, append(data, []byte(line)...)); err != nil {
					return err
				}
				if err = os.Chmod(config, configMode); err != nil {
					return err
				}
			}
		}
		_, err = command(ctx, "rc-update", "", "add", filepath.Base(path), "boot")
	} else {
		for _, name := range []string{"incus.service", "incus.socket"} {
			dropin := "/etc/systemd/system/" + name + ".d/30-incudal-guest-guard.conf"
			content := "[Unit]\nRequires=incudal-guest-guard.service\nAfter=incudal-guest-guard.service\n"
			data, readErr := os.ReadFile(dropin)
			if readErr != nil || string(data) != content {
				if err = atomicWrite(dropin, []byte(content)); err != nil {
					return err
				}
			}
			if err = os.Chmod(dropin, 0644); err != nil {
				return err
			}
		}
		// Retrying daemon-reload also covers an interruption after writing the unit.
		if _, err = command(ctx, "systemctl", "", "daemon-reload"); err != nil {
			return err
		}
		_, err = command(ctx, "systemctl", "", "enable", filepath.Base(path))
	}
	return err
}
