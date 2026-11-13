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
		process, err := os.Open("/proc/" + pid)
		if err != nil {
			return err
		}
		proc, err := os.Open("/proc/self/fd/" + strconv.Itoa(int(process.Fd())) + "/root/proc")
		if err != nil {
			process.Close()
			return err
		}
		var filesystem syscall.Statfs_t
		if syscall.Fstatfs(int(proc.Fd()), &filesystem) != nil || filesystem.Type != 0x9fa0 {
			proc.Close()
			process.Close()
			return fmt.Errorf("resource target is not procfs")
		}
		err = mountGuestResourceFiles(ctx, guest, runtime.Pid, process, proc)
		proc.Close()
		process.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func mountGuestResourceFiles(ctx context.Context, guest Guest, pidNumber int, process, proc *os.File) error {
	original := "/proc/self/fd/" + strconv.Itoa(int(process.Fd()))
	namespace, err := os.Open(original + "/ns/mnt")
	if err != nil {
		return err
	}
	defer namespace.Close()
	pidNamespace, err := os.Open(original + "/ns/pid")
	if err != nil {
		return err
	}
	defer pidNamespace.Close()
	// Execute our held binary through its descriptor after entering the guest
	// namespaces. A host pathname may not exist there; guest files are never run.
	binary, err := os.Open("/proc/self/exe")
	if err != nil {
		return err
	}
	defer binary.Close()
	for _, name := range []string{"meminfo", "cpuinfo", "stat", "uptime", "swaps", "loadavg"} {
		source := filepath.Join("/var/lib/lxcfs/proc", name)
		if _, err = os.Stat(source); err != nil {
			continue
		}
		localTarget := "/proc/self/fd/" + strconv.Itoa(int(proc.Fd())) + "/" + name
		info, err := os.Lstat(localTarget)
		if err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("resource target invalid")
		}
		mounts, err := os.ReadFile(original + "/mountinfo")
		if err != nil {
			return err
		}
		mounted := false
		for _, line := range strings.Split(string(mounts), "\n") {
			if fields := strings.Fields(line); len(fields) > 5 && fields[4] == "/proc/"+name && strings.Contains(line, " - fuse.lxcfs ") && strings.HasPrefix(fields[5], "ro,") {
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
		tree, err := cloneResourceMount(source)
		if err != nil {
			return err
		}
		_, err = runWithFiles(ctx, "nsenter", []*os.File{proc, namespace, tree, binary, pidNamespace},
			"--mount=/proc/self/fd/4", "--pid=/proc/self/fd/7", "--", "/proc/self/fd/6", resourceMountArgument, name)
		tree.Close()
		if err != nil {
			return fmt.Errorf("resource view %s attach failed: %w", name, err)
		}
	}
	return nil
}
