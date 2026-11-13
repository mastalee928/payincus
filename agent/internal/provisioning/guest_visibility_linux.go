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
	"syscall"
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
		// Hold the process root/proc directory itself. If the PID exits or is
		// recycled, fd-relative targets cannot resolve into another process.
		proc, err := os.Open("/proc/" + pid + "/root/proc")
		if err != nil {
			return err
		}
		var filesystem syscall.Statfs_t
		if syscall.Fstatfs(int(proc.Fd()), &filesystem) != nil || filesystem.Type != 0x9fa0 {
			proc.Close()
			return fmt.Errorf("resource target is not procfs")
		}
		err = mountGuestResourceFiles(ctx, guest, runtime.Pid, proc)
		proc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func mountGuestResourceFiles(ctx context.Context, guest Guest, pidNumber int, proc *os.File) error {
	pid := strconv.Itoa(pidNumber)
	var err error
	for _, name := range []string{"meminfo", "cpuinfo", "stat", "uptime", "swaps", "loadavg"} {
		source := filepath.Join("/var/lib/lxcfs/proc", name)
		if _, err = os.Stat(source); err != nil {
			continue
		}
		target := "/proc/self/fd/3/" + name
		localTarget := "/proc/self/fd/" + strconv.Itoa(int(proc.Fd())) + "/" + name
		info, err := os.Lstat(localTarget)
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
		var current struct {
			Type, Status string
			Config       map[string]string
		}
		if err != nil || json.Unmarshal(check, &current) != nil || current.Config["volatile.uuid"] != guest.UUID || current.Status != "Running" {
			break
		}
		check, err = run(ctx, "incus", "query", "/1.0/instances/"+guest.Name+"/state")
		var latest struct{ Pid int }
		if err != nil || json.Unmarshal(check, &latest) != nil || latest.Pid != pidNumber {
			break
		}
		if _, err = runWithFiles(ctx, "mount", []*os.File{proc}, "--no-canonicalize", "--bind", source, target); err != nil {
			return err
		}
		if _, err = runWithFiles(ctx, "mount", []*os.File{proc}, "--no-canonicalize", "-o", "remount,bind,ro", target); err != nil {
			return err
		}
	}
	return nil
}
