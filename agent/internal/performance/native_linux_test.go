//go:build linux

package performance

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestNativeHostBBR(t *testing.T) {
	if os.Getenv("INCUDAL_BBR_NATIVE_TEST") != "1" {
		t.Skip("isolated Linux VM required")
	}
	if os.Geteuid() != 0 {
		t.Fatal("root required in isolated VM")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	before, _ := exec.CommandContext(ctx, "sysctl", "-n", "net.ipv4.tcp_congestion_control").Output()
	qdisc, _ := exec.CommandContext(ctx, "sysctl", "-n", "net.core.default_qdisc").Output()
	defer func() {
		_ = exec.Command("sysctl", "-w", "net.ipv4.tcp_congestion_control="+strings.TrimSpace(string(before)), "net.core.default_qdisc="+strings.TrimSpace(string(qdisc))).Run()
	}()
	// A disposable customer-like network namespace must retain its algorithm
	// when the host runs BBR reconciliation. Production never enters it.
	childCtx, childCancel := context.WithTimeout(context.Background(), 80*time.Second)
	defer childCancel()
	child := exec.CommandContext(childCtx, "unshare", "--net", "sleep", "70")
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = child.Process.Kill(); _ = child.Wait() }()
	hostNS, _ := os.Readlink("/proc/self/ns/net")
	for n := 0; n < 100; n++ {
		ns, _ := os.Readlink("/proc/" + strconv.Itoa(child.Process.Pid) + "/ns/net")
		if ns != "" && ns != hostNS {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	guestArgs := []string{"-t", strconv.Itoa(child.Process.Pid), "--net", "--", "sysctl", "-n", "net.ipv4.tcp_congestion_control"}
	guestBefore, err := exec.CommandContext(ctx, "nsenter", guestArgs...).Output()
	if err != nil {
		t.Fatal(err)
	}
	e := New()
	e.SetPoolHost(true)
	e.modules = nil
	e.tools = nil
	e.persist = func(string, string) error { return nil }
	status := e.Reconcile(ctx)
	if status.State != "applied" || !status.HostApplied {
		t.Fatalf("host BBR not verified: %+v", status)
	}
	actual, err := exec.CommandContext(ctx, "sysctl", "-n", "net.ipv4.tcp_congestion_control").Output()
	if err != nil || strings.TrimSpace(string(actual)) != "bbr" {
		t.Fatal("host kernel BBR not active")
	}
	guestAfter, err := exec.CommandContext(ctx, "nsenter", guestArgs...).Output()
	if err != nil || string(guestAfter) != string(guestBefore) {
		t.Fatal("host BBR changed customer namespace algorithm")
	}
	t.Log("PASS real host kernel BBR apply/readback; no Incus or customer namespace operation")
}
func TestNativeModulePersistence(t *testing.T) {
	if os.Getenv("INCUDAL_BBR_NATIVE_TEST") != "1" {
		t.Skip("isolated Linux VM required")
	}
	root, err := os.MkdirTemp("/root", "bbr-files-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	target := filepath.Join(root, "modules")
	if err = os.WriteFile(target, []byte("existing_module\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err = writeModules(target, []byte("existing_module\n"), []byte("existing_module\ntcp_bbr\n")); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(target)
	if string(data) != "existing_module\ntcp_bbr\n" {
		t.Fatal("module contents changed")
	}
	// Simulate an administrator update between the module-list read and the
	// writer opening it. The stale append must not erase that newer entry.
	newer := []byte("existing_module\ntcp_bbr\nadmin_new_module\n")
	if err = os.WriteFile(target, newer, 0644); err != nil {
		t.Fatal(err)
	}
	if writeModules(target, []byte("existing_module\ntcp_bbr\n"), []byte("existing_module\ntcp_bbr\nsch_fq\n")) == nil {
		t.Fatal("stale module snapshot overwrote an administrator update")
	}
	data, _ = os.ReadFile(target)
	if string(data) != string(newer) {
		t.Fatal("administrator module was lost")
	}
	link := filepath.Join(root, "link")
	if err = os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if writeModules(link, nil, []byte("must not overwrite")) == nil {
		t.Fatal("symlink accepted")
	}
	if persist(filepath.Join(root, "settings"), "# Incudal managed TCP BBR\nnet.ipv4.tcp_congestion_control=bbr\n") != nil {
		t.Fatal("safe configuration failed")
	}
	settings := filepath.Join(root, "settings")
	custom := []byte("# Incudal managed TCP BBR\nnet.ipv4.tcp_congestion_control=bbr\n# administrator addition\nnet.ipv4.tcp_keepalive_time=123\n")
	if err = os.WriteFile(settings, custom, 0644); err != nil {
		t.Fatal(err)
	}
	if persist(settings, "# Incudal managed TCP BBR\nnet.ipv4.tcp_congestion_control=bbr\n") != nil {
		t.Fatal("administrator additions blocked compatible persistence")
	}
	kept, _ := os.ReadFile(settings)
	if string(kept) != string(custom) {
		t.Fatal("administrator settings lost")
	}
	// A changed managed key is corrected by append, never by discarding extras.
	drift := append(custom, []byte("net.ipv4.tcp_congestion_control=cubic\n")...)
	if err = os.WriteFile(settings, drift, 0644); err != nil {
		t.Fatal(err)
	}
	if err = persist(settings, "# Incudal managed TCP BBR\nnet.ipv4.tcp_congestion_control=bbr\n"); err != nil {
		t.Fatal(err)
	}
	repaired, _ := os.ReadFile(settings)
	if !strings.HasPrefix(string(repaired), string(drift)) || !strings.HasSuffix(string(repaired), "net.ipv4.tcp_congestion_control=bbr\n") {
		t.Fatal("managed key drift not safely repaired")
	}
	t.Log("PASS compatible additions preserved, managed drift repaired, stale snapshot and symlink denied")
}

func TestNativeFixedHostAndToolBoundaries(t *testing.T) {
	if os.Getenv("INCUDAL_BBR_NATIVE_TEST") != "1" {
		t.Skip("isolated Linux VM required")
	}
	for _, args := range [][]string{{"-w", "net.ipv4.ip_forward=0"}, {"-w", "net.ipv4.tcp_congestion_control=cubic"}, {"-w", "net.core.default_qdisc=pfifo_fast"}, {"-n", "../etc/shadow"}} {
		if _, err := hostSysctl(context.Background(), args...); err == nil {
			t.Fatal("non-BBR host mutation accepted", args)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := hostSysctl(ctx, "-w", "net.ipv4.tcp_congestion_control=bbr"); err == nil {
		t.Fatal("cancelled host write accepted")
	}
	dir, err := os.MkdirTemp("/root", "bbr-tool-lock-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	unlock, err := performanceLock(filepath.Join(dir, "lock"))
	if err != nil {
		t.Fatal(err)
	}
	if other, err := performanceLock(filepath.Join(dir, "lock")); err == nil {
		other()
		t.Fatal("parallel repair acquired same lock")
	}
	unlock()
	if err = os.Symlink(filepath.Join(dir, "lock"), filepath.Join(dir, "symlink")); err != nil {
		t.Fatal(err)
	}
	if other, err := performanceLock(filepath.Join(dir, "symlink")); err == nil {
		other()
		t.Fatal("repair lock followed symlink")
	}
	bounded, stop := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer stop()
	if err = runToolInstall(bounded, exec.Command("sh", "-c", "sleep 30 & wait")); err == nil || bounded.Err() == nil {
		t.Fatal("repair subprocess ignored bound")
	}
	t.Log("PASS fixed host key/value limits, cancelled write, exclusive no-follow repair lock, child process timeout")
	// Execute the exact dependency controller with a disposable package-manager
	// adapter: first install fails, signed-index refresh permits exact retry.
	adapter := filepath.Join(dir, "apt-get")
	text := "#!/bin/sh\ncase \" $* \" in *' update '*) touch \"$BBR_TOOL_TEST_DIR/index\";; *' install '*) [ -f \"$BBR_TOOL_TEST_DIR/index\" ] || exit 1; touch \"$BBR_TOOL_TEST_DIR/installed\";; *) exit 1;; esac\n"
	if err = os.WriteFile(adapter, []byte(text), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+":"+os.Getenv("PATH"))
	t.Setenv("BBR_TOOL_TEST_DIR", dir)
	name, args, err := toolPackages("ID=debian", []string{"modprobe"})
	if err != nil {
		t.Fatal(err)
	}
	if err = installTools(context.Background(), name, args...); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(dir, "installed")); err != nil {
		t.Fatal("exact dependency retry did not finish")
	}
	t.Log("PASS actual bounded tool subprocess: failed install -> configured index refresh -> exact install succeeds; real package manager untouched")
}
