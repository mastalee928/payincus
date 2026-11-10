//go:build linux

package guestguard

import (
	"context"
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

//go:embed network_probe.py
var packetProbe string

func nativeCommand(ctx context.Context, name string, args ...string) ([]byte, error) {
	c := exec.CommandContext(ctx, name, args...)
	c.Env = append(os.Environ(), "INCUDAL_GUEST_GUARD_NETNS=1")
	c.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	c.Cancel = func() error {
		err := syscall.Kill(-c.Process.Pid, syscall.SIGKILL)
		if err == syscall.ESRCH {
			return os.ErrProcessDone
		}
		return err
	}
	c.WaitDelay = time.Second
	return c.CombinedOutput()
}

// TCG has no useful production timing equivalence. An explicit test-only
// multiplier permits packet/serialization validation while preserving the
// production command deadlines and recording that limited evidence scope.
func nativeTestTimeout(t *testing.T) time.Duration {
	if os.Getenv("INCUDAL_GUEST_GUARD_SLOW_VM") == "1" {
		t.Log("TCG functional validation only; production timing not validated")
		return 15 * time.Minute
	}
	return 3 * time.Minute
}

func TestNativeCustomerPackets(t *testing.T) {
	if os.Getenv("INCUDAL_GUEST_GUARD_NATIVE") != "1" {
		t.Skip("requires disposable Linux VM")
	}
	dir := t.TempDir()
	ociPath := os.Getenv("INCUDAL_OCI_NETWORK_SCRIPT")
	if ociPath == "" {
		ociPath = "scripts/configure-oci-node-network.sh"
	}
	oci, err := os.ReadFile(ociPath)
	if err != nil {
		t.Fatal("native coexistence requires actual OCI setup script", err)
	}
	rules, err := Rules(Policy{Bridges: []string{"incusbr0"}, Management: []string{"192.0.2.20", "2001:db8::20"}})
	if err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string]string{"rules.nft": rules, "probe.py": packetProbe, "oci-network.sh": strings.ReplaceAll(string(oci), "\r\n", "\n")} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), nativeTestTimeout(t))
	defer cancel()
	if out, err := nativeCommand(ctx, "unshare", "--net", "python3", filepath.Join(dir, "probe.py"), dir); err != nil {
		files, _ := filepath.Glob(filepath.Join(dir, "*.log"))
		for _, file := range files {
			if data, readErr := os.ReadFile(file); readErr == nil {
				t.Log(filepath.Base(file), string(data))
			}
		}
		t.Fatalf("%s: %v", out, err)
	} else {
		t.Log(string(out))
	}
}

// Explicit opt-in: runs inside a disposable local VM only. No real host rules,
// metadata requests or SSH endpoints are used. Each test gets a new netns.
func TestNativeNftTransaction(t *testing.T) {
	if os.Getenv("INCUDAL_GUEST_GUARD_NATIVE") != "1" {
		t.Skip("requires disposable Linux VM and nftables")
	}
	if os.Getenv("INCUDAL_GUEST_GUARD_NETNS") == "1" {
		ctx, cancel := context.WithTimeout(context.Background(), nativeTestTimeout(t))
		defer cancel()
		e := New()
		var echo, live string
		{
			e.run = func(ctx context.Context, name, input string, args ...string) (string, error) {
				limit := 5 * time.Second
				if os.Getenv("INCUDAL_GUEST_GUARD_SLOW_VM") == "1" {
					limit = nativeTestTimeout(t)
				}
				out, stderr, err := commandOutputWithin(ctx, limit, name, input, args...)
				if err != nil {
					return "", fmt.Errorf("%s: %w", stderr, err)
				}
				if input != "" {
					echo = string(out)
				} else if strings.Contains(strings.Join(args, " "), "list table") {
					live = string(out)
				}
				return string(out), nil
			}
		}
		p := Policy{Bridges: []string{"incusbr0"}, Management: []string{"192.0.2.20", "2001:db8::20"}}
		if err := e.apply(ctx, p); err != nil {
			t.Log("echo", echo, "live", live)
			t.Fatal(err)
		}
		if err := e.apply(ctx, p); err != nil {
			t.Fatal("idempotence", err)
		}
		if _, err := e.run(ctx, "nft", "", "flush", "table", "inet", Table); err != nil {
			t.Fatal(err)
		}
		if err := e.apply(ctx, p); err != nil {
			t.Fatal("flushed table recovery", err)
		}
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), nativeTestTimeout(t))
	defer cancel()
	if out, err := nativeCommand(ctx, "unshare", "--net", os.Args[0], "-test.run=^TestNativeNftTransaction$", "-test.v"); err != nil {
		t.Fatalf("%s: %v", out, err)
	} else {
		t.Log(string(out))
	}
}
