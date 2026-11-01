package abuse

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
)

var executableName = regexp.MustCompile(`^/[A-Za-z0-9_./-]+$`)

func ensureRestoreService(ctx context.Context) error {
	binary, err := os.Executable()
	if err != nil || !executableName.MatchString(binary) {
		return fmt.Errorf("invalid agent executable for restoration")
	}
	var path, content string
	mode := os.FileMode(0644)
	openRC := false
	if _, err := os.Stat("/run/systemd/system"); err == nil {
		path = "/etc/systemd/system/incudal-abuse-policy.service"
		content = "[Unit]\nDescription=Restore Incudal customer abuse policy\nDefaultDependencies=no\nAfter=local-fs.target nftables.service netfilter-persistent.service\nBefore=network-pre.target incus.service incus.socket incudal-agent.service\nWants=network-pre.target\n\n[Service]\nType=oneshot\nExecStart=" + binary + " -restore-abuse-policy\nRemainAfterExit=yes\n\n[Install]\nWantedBy=multi-user.target\n"
	} else if _, err := exec.LookPath("rc-update"); err == nil {
		openRC, mode = true, 0755
		path = "/etc/init.d/incudal-abuse-policy"
		content = "#!/sbin/openrc-run\ndescription=\"Restore Incudal customer abuse policy\"\ndepend() {\n  need localmount\n  after firewall nftables iptables ip6tables\n  before incus incusd incudal-agent\n}\nstart() {\n  ebegin \"Restoring Incudal customer abuse policy\"\n  " + binary + " -restore-abuse-policy\n  eend $?\n}\n"
	} else {
		return fmt.Errorf("restoration requires systemd or OpenRC")
	}
	current, readErr := os.ReadFile(path)
	changed := readErr != nil || string(current) != content
	if changed {
		if err := atomicWrite(path, []byte(content)); err != nil {
			return err
		}
	}
	// Retry also repairs a previous write interrupted before executable mode.
	if err := os.Chmod(path, mode); err != nil {
		return err
	}
	if openRC {
		_, err = command(ctx, "rc-update", "", "add", filepath.Base(path), "boot")
	} else {
		if changed {
			if _, err := command(ctx, "systemctl", "", "daemon-reload"); err != nil {
				return err
			}
		}
		_, err = command(ctx, "systemctl", "", "enable", filepath.Base(path))
	}
	return err
}
