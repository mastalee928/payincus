//go:build linux

package provisioning

import (
	"context"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

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
		t.Fatal(err)
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
}
