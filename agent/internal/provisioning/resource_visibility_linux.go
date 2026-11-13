//go:build linux

package provisioning

import (
	"context"
	"fmt"
	"os"
	"strings"
)

// Start LXCFS without restarting Incus or customer guests. New starts use the
// packaged LXC hooks; the controller separately follows existing guest limits.
func ensureResourceVisibility(ctx context.Context) error {
	if _, err := systemTool("lxcfs"); err != nil {
		return err
	}
	release, err := releaseFile()
	if err != nil {
		return err
	}
	if strings.Contains(release, "ID=alpine") || strings.Contains(release, "ID=\"alpine\"") {
		if _, err = run(ctx, "rc-update", "add", "lxcfs", "default"); err != nil {
			return err
		}
		if _, err = run(ctx, "rc-service", "lxcfs", "status"); err != nil {
			if _, err = run(ctx, "rc-service", "lxcfs", "start"); err != nil {
				return err
			}
		}
	} else {
		if _, err = run(ctx, "systemctl", "enable", "lxcfs"); err != nil {
			return err
		}
		if _, err = run(ctx, "systemctl", "is-active", "--quiet", "lxcfs"); err != nil {
			if _, err = run(ctx, "systemctl", "start", "lxcfs"); err != nil {
				return err
			}
		}
	}
	for _, path := range []string{"/var/lib/lxcfs/proc/meminfo", "/usr/share/lxc/config/common.conf.d/00-lxcfs.conf"} {
		if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("LXCFS resource visibility is not ready")
		}
	}
	return nil
}
