//go:build linux

package provisioning

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var guestName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)
var guestUUID = regexp.MustCompile(`^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$`)

func repairGuestVisibility(ctx context.Context, guests []Guest) error {
	if len(guests) > 2 {
		return fmt.Errorf("resource guest limit")
	}
	for _, guest := range guests {
		if !guestName.MatchString(guest.Name) || !guestUUID.MatchString(guest.UUID) || guest.MemoryMiB <= 0 || guest.MemoryMiB > 16777216 {
			return fmt.Errorf("resource guest invalid")
		}
		out, err := run(ctx, "incus", "query", "/1.0/instances/"+guest.Name)
		if err != nil {
			return err
		}
		var current struct {
			Type, Status string
			Config       map[string]string
		}
		if json.Unmarshal(out, &current) != nil || current.Type != "container" || current.Status != "Running" || current.Config["volatile.uuid"] != guest.UUID {
			continue
		}
		state, err := run(ctx, "incus", "query", "/1.0/instances/"+guest.Name+"/state")
		if err != nil {
			return err
		}
		var runtime struct {
			Status string
			Pid    int
		}
		if json.Unmarshal(state, &runtime) != nil || runtime.Status != "Running" || runtime.Pid <= 1 {
			continue
		}
		pid := strconv.Itoa(runtime.Pid)
		for _, name := range []string{"meminfo", "cpuinfo", "stat", "uptime", "swaps", "loadavg"} {
			source := filepath.Join("/var/lib/lxcfs/proc", name)
			if _, err = os.Stat(source); err != nil {
				continue
			}
			target := "/proc/" + pid + "/root/proc/" + name
			info, err := os.Lstat(target)
			if err != nil || !info.Mode().IsRegular() {
				return fmt.Errorf("resource target invalid")
			}
			mounts, err := os.ReadFile("/proc/" + pid + "/mountinfo")
			if err != nil {
				return err
			}
			mounted := false
			for _, line := range strings.Split(string(mounts), "\n") {
				if strings.Contains(line, " /proc/"+name+" ") && strings.Contains(line, " - fuse.lxcfs ") {
					mounted = true
					break
				}
			}
			if mounted {
				continue
			}
			// Recheck Incus UUID and PID directly before each mount. The only
			// writes are packaged read-only resource files, never guest disks.
			check, err := run(ctx, "incus", "query", "/1.0/instances/"+guest.Name)
			if err != nil || json.Unmarshal(check, &current) != nil || current.Config["volatile.uuid"] != guest.UUID || current.Status != "Running" {
				break
			}
			check, err = run(ctx, "incus", "query", "/1.0/instances/"+guest.Name+"/state")
			var latest struct{ Pid int }
			if err != nil || json.Unmarshal(check, &latest) != nil || latest.Pid != runtime.Pid {
				break
			}
			if _, err = run(ctx, "mount", "--bind", source, target); err != nil {
				return err
			}
			if _, err = run(ctx, "mount", "-o", "remount,bind,ro", target); err != nil {
				return err
			}
		}
	}
	return nil
}
