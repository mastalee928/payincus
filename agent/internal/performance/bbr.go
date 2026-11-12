// Package performance maintains optional machine-pool host TCP BBR.
// It never enters customer namespaces, installs kernels or restarts guests.
package performance

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Status struct {
	State       string   `json:"state"`
	CheckedAt   string   `json:"checkedAt"`
	Error       string   `json:"error,omitempty"`
	HostApplied bool     `json:"hostApplied"`
	Persistent  bool     `json:"persistent"`
	Warnings    []string `json:"warnings,omitempty"`
}
type Runner func(context.Context, string, ...string) ([]byte, error)
type Engine struct {
	mu         sync.Mutex
	statusMu   sync.Mutex
	modules    func() error
	run        Runner
	persist    func(string, string) error
	status     Status
	tools      func(context.Context) error
	poolHost   *bool
	managed    func() bool
	indexRetry time.Time
}

func New() *Engine {
	return &Engine{run: command, persist: persist, modules: ensureOpenRCModules, tools: ensureTools,
		managed: func() bool { _, err := os.Stat("/etc/incudal-onboarding-id"); return err == nil }}
}
func (e *Engine) Status() Status { e.statusMu.Lock(); defer e.statusMu.Unlock(); return e.status }

// The controller identifies legacy pool hosts without relying on onboarding
// files. An explicit false also overrides an old marker after leaving the pool.
func (e *Engine) SetPoolHost(enabled bool) {
	e.statusMu.Lock()
	e.poolHost = &enabled
	e.statusMu.Unlock()
}
func (e *Engine) poolEnabled() bool {
	e.statusMu.Lock()
	value := e.poolHost
	e.statusMu.Unlock()
	if value != nil {
		return *value
	}
	return e.managed == nil || e.managed()
}

// Performance errors never end the follow-up loop or block heartbeat locks.
// Wait after each bounded pass, so slow/unavailable hosts cannot busy-loop.
func (e *Engine) Run(ctx context.Context) { e.runLoop(ctx, time.Minute) }
func (e *Engine) runLoop(ctx context.Context, interval time.Duration) {
	previous := ""
	for ctx.Err() == nil {
		bounded, cancel := context.WithTimeout(ctx, 45*time.Second)
		status := e.Reconcile(bounded)
		cancel()
		if ctx.Err() != nil {
			return
		}
		if status.Error != "" && status.Error != previous {
			log.Printf("TCP BBR %s: %s", status.State, status.Error)
		}
		previous = status.Error
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
func command(ctx context.Context, name string, args ...string) ([]byte, error) {
	if name == "sysctl" {
		return hostSysctl(ctx, args...)
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	var out bytes.Buffer
	c := exec.CommandContext(ctx, name, args...)
	c.Stdout = &out
	if err := c.Run(); err != nil {
		return nil, fmt.Errorf("BBR command failed: %s", name)
	}
	if out.Len() > 1024*1024 {
		return nil, fmt.Errorf("BBR output limit")
	}
	return out.Bytes(), nil
}
func words(raw []byte, value string) bool {
	for _, word := range strings.Fields(string(raw)) {
		if word == value {
			return true
		}
	}
	return false
}
func persist(path, text string) error {
	dir := filepath.Dir(path)
	// Check every existing parent before creating anything, never traverse a
	// symlink to prepare a supposedly trusted configuration directory.
	for p := dir; p != "/" && p != "."; p = filepath.Dir(p) {
		info, err := os.Lstat(p)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil || !info.IsDir() || info.Mode()&0022 != 0 || !rootOwned(info) {
			return fmt.Errorf("BBR config directory unsafe")
		}
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	for p := dir; p != "/" && p != "."; p = filepath.Dir(p) {
		info, err := os.Lstat(p)
		if err != nil || !info.IsDir() || info.Mode()&0022 != 0 || !rootOwned(info) {
			return fmt.Errorf("BBR config directory unsafe")
		}
	}
	if info, err := os.Lstat(path); err == nil {
		if !info.Mode().IsRegular() || info.Mode()&0022 != 0 || !rootOwned(info) {
			return fmt.Errorf("BBR config unsafe")
		}
		old, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if string(old) == text {
			return nil
		}
		if !strings.HasPrefix(string(old), "# Incudal managed TCP BBR\n") &&
			string(old) != "net.core.default_qdisc=fq\nnet.ipv4.tcp_congestion_control=bbr\n" && string(old) != "tcp_bbr\nsch_fq\n" {
			return fmt.Errorf("BBR administrator config preserved")
		}
		// Keep all administrator additions. Repair only our fixed keys/modules
		// by appending missing effective values under a snapshot-checked lock.
		next := appendRequired(string(old), text)
		if next == string(old) {
			return nil
		}
		return writeModules(path, old, []byte(next))
	} else if !os.IsNotExist(err) {
		return err
	}
	file, err := os.CreateTemp(dir, ".incudal-bbr-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.WriteString(text); err == nil {
		err = file.Chmod(0644)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	// Publish only if still absent; never replace a concurrently added file.
	return os.Link(file.Name(), path)
}

func (e *Engine) Reconcile(ctx context.Context) (status Status) {
	e.mu.Lock()
	defer e.mu.Unlock()
	status = Status{State: "pending", CheckedAt: time.Now().UTC().Format(time.RFC3339)}
	defer func() { e.statusMu.Lock(); e.status = status; e.statusMu.Unlock() }()
	fail := func(code string) Status { status.Error = code; return status }
	if !e.poolEnabled() {
		status.State = "not-pool"
		return status
	}
	if ctx.Err() != nil {
		return fail("BBR_CANCELLED")
	}
	if _, err := e.run(ctx, "modprobe", "tcp_bbr"); err != nil { /* Built-in BBR can still be available. */
	}
	available, err := e.run(ctx, "sysctl", "-n", "net.ipv4.tcp_available_congestion_control")
	if err != nil {
		return fail("BBR_CAPABILITY_UNAVAILABLE")
	}
	if !words(available, "bbr") {
		if e.tools != nil {
			if err := e.tools(ctx); err != nil {
				status.Warnings = append(status.Warnings, "BBR_TOOL_REPAIR_PENDING")
			}
			_, _ = e.run(ctx, "modprobe", "tcp_bbr")
			available, err = e.run(ctx, "sysctl", "-n", "net.ipv4.tcp_available_congestion_control")
			if err != nil {
				return fail("BBR_CAPABILITY_UNAVAILABLE")
			}
		}
	}
	if !words(available, "bbr") {
		// Existing signed modules can be present while their dependency index
		// is stale. Rebuild only the running kernel's index, then load again.
		if time.Now().After(e.indexRetry) {
			e.indexRetry = time.Now().Add(10 * time.Minute)
			if _, err = e.run(ctx, "depmod", "-a"); err == nil {
				_, _ = e.run(ctx, "modprobe", "tcp_bbr")
				available, err = e.run(ctx, "sysctl", "-n", "net.ipv4.tcp_available_congestion_control")
			}
		}
		if err != nil {
			return fail("BBR_CAPABILITY_UNAVAILABLE")
		}
	}
	if !words(available, "bbr") {
		status.State = "unsupported"
		status.Error = "BBR_KERNEL_UNAVAILABLE"
		return status
	}
	_, _ = e.run(ctx, "modprobe", "sch_fq")
	// An optional qdisc or persistence fault must not prevent supported live
	// host BBR from being enabled and verified independently.
	if _, err = e.run(ctx, "sysctl", "-w", "net.core.default_qdisc=fq"); err != nil {
		status.Warnings = append(status.Warnings, "BBR_QDISC_UNAVAILABLE")
	}
	if _, err = e.run(ctx, "sysctl", "-w", "net.ipv4.tcp_congestion_control=bbr"); err != nil {
		return fail("BBR_HOST_APPLY_FAILED")
	}
	actual, err := e.run(ctx, "sysctl", "-n", "net.ipv4.tcp_congestion_control")
	if err != nil || strings.TrimSpace(string(actual)) != "bbr" {
		return fail("BBR_HOST_NOT_VERIFIED")
	}
	status.HostApplied = true
	status.Persistent = true
	persistenceFailure := func(code string) {
		status.Persistent = false
		if status.Error == "" {
			status.Error = code
		}
	}
	text := "# Incudal managed TCP BBR\nnet.core.default_qdisc=fq\nnet.ipv4.tcp_congestion_control=bbr\n"
	if err = e.persist("/etc/sysctl.d/90-incudal-bbr.conf", text); err != nil {
		persistenceFailure("BBR_CONFIG_CONFLICT")
	}
	if err = e.persist("/etc/modules-load.d/incudal-bbr.conf", "# Incudal managed TCP BBR\ntcp_bbr\nsch_fq\n"); err != nil {
		persistenceFailure("BBR_CONFIG_CONFLICT")
	}
	// OpenRC uses /etc/modules rather than systemd modules-load.d. Keep the
	// existing administrator module list and append only the two fixed names.
	if e.modules != nil {
		if err = e.modules(); err != nil {
			persistenceFailure("BBR_MODULE_CONFIG_CONFLICT")
		}
	}
	if status.Error == "" {
		status.State = "applied"
	}
	return status
}
