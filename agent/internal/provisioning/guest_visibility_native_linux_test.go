//go:build linux

package provisioning

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func init() {
	if handled, err := ResourceMountHelper(); handled {
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	}
}

func TestNativeGuestResourceVisibility(t *testing.T) {
	name := os.Getenv("INCUDAL_NATIVE_VISIBILITY_GUEST")
	if os.Getenv("GITHUB_ACTIONS") != "true" || os.Getenv("RUNNER_ENVIRONMENT") != "github-hosted" || !strings.HasPrefix(name, "native-delivery-") {
		t.Skip("disposable native guest only")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := ensureResourceVisibility(ctx); err != nil {
		t.Fatal(err)
	}
	raw, err := run(ctx, "incus", "query", "/1.0/instances/"+name)
	if err != nil {
		t.Fatal(err)
	}
	var guest struct{ Config map[string]string }
	if err = json.Unmarshal(raw, &guest); err != nil {
		t.Fatalf("guest identity query bytes=%d: %v", len(raw), err)
	}
	raw, err = run(ctx, "incus", "query", "/1.0/instances/"+name+"/state")
	if err != nil {
		t.Fatal(err)
	}
	var state struct{ Pid int }
	if err = json.Unmarshal(raw, &state); err != nil || state.Pid <= 1 {
		t.Fatal("guest pid unavailable")
	}
	// Simulate an existing customer booted before LXCFS was installed. Only the
	// proc resource view is detached, never its disk or networking.
	_, _ = run(ctx, "nsenter", "-t", strconv.Itoa(state.Pid), "-m", "--", "umount", "/proc/meminfo")
	if err = repairGuestVisibility(ctx, []Guest{{Name: name, UUID: guest.Config["volatile.uuid"], MemoryMiB: 1024}}); err != nil {
		t.Fatal(err)
	}
	result, err := run(ctx, "incus", "exec", name, "--", "head", "-n", "1", "/proc/meminfo")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(result), "1048576 kB") {
		t.Fatal("guest memory must be 1024 MiB after live repair", string(result))
	}
	if err = repairGuestVisibility(ctx, []Guest{{Name: name, UUID: guest.Config["volatile.uuid"], MemoryMiB: 1024}}); err != nil {
		t.Fatal("idempotency", err)
	}
	result, err = run(ctx, "incus", "exec", name, "--", "sh", "-c", "grep ' /proc/meminfo ' /proc/self/mountinfo")
	if err != nil || !strings.Contains(string(result), " ro,") || !strings.Contains(string(result), " - fuse.lxcfs ") {
		t.Fatal("resource mount must remain read-only", err, string(result))
	}
}

func TestGuestSysinfoLimit(t *testing.T) {
	if os.Getenv("INCUDAL_GUEST_SYSINFO_TEST") != "1" {
		t.Skip("native guest only")
	}
	var info syscall.Sysinfo_t
	if err := syscall.Sysinfo(&info); err != nil {
		t.Fatal(err)
	}
	if uint64(info.Totalram)*uint64(info.Unit) != 1073741824 {
		t.Fatal("sysinfo memory must be 1024 MiB", uint64(info.Totalram)*uint64(info.Unit))
	}
}
