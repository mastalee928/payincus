package abuse

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const StatePath = "/var/lib/incudal-agent/abuse-policy.json"

type commandRunner func(context.Context, string, string, ...string) (string, error)

type diskState struct {
	Policy  *Instruction `json:"policy"`
	Bridges []string     `json:"bridges"`
	IPv6    bool         `json:"ipv6"`
	Status  Status       `json:"status"`
}

type Engine struct {
	mu                 sync.Mutex
	path               string
	state              diskState
	loaded             bool
	serviceReady       bool
	loadError          error
	run                commandRunner
	lookPath           func(string) (string, error)
	now                func() time.Time
	ipv6Available      func() bool
	ensureService      func(context.Context) error
	persist            func(string, []byte) error
	repairDependencies func(context.Context, bool, bool) error
	repairing          bool
}

func New() *Engine { return newEngine(StatePath) }
func newEngine(path string) *Engine {
	return &Engine{path: path, run: command, lookPath: exec.LookPath, now: time.Now,
		ipv6Available: func() bool { _, err := os.Stat("/proc/net/if_inet6"); return err == nil },
		ensureService: ensureRestoreService, persist: atomicWrite, repairDependencies: repairDependencies}
}

type boundedBuffer struct{ bytes.Buffer }

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 2*1024*1024 {
		return 0, fmt.Errorf("command output limit exceeded")
	}
	return b.Buffer.Write(p)
}

func command(ctx context.Context, name, input string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdin = strings.NewReader(input)
	var stdout, stderr boundedBuffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%s: %w: %s", name, err, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}

func atomicWrite(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".abuse-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return err
	}
	// Rename is durable across power loss only after the containing directory.
	d, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

func (e *Engine) load() {
	if e.loaded {
		return
	}
	e.loaded = true
	f, err := os.Open(e.path)
	if os.IsNotExist(err) {
		return
	}
	if err != nil {
		e.loadError = err
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 256*1024+1))
	if err == nil && len(data) > 256*1024 {
		err = fmt.Errorf("abuse state exceeds limit")
	}
	var state diskState
	if err == nil {
		err = json.Unmarshal(data, &state)
	}
	if err == nil && (state.Policy == nil || !state.Policy.valid()) {
		err = fmt.Errorf("invalid persisted policy")
	}
	if err == nil {
		_, err = normalizedBridges(state.Bridges)
	}
	if err == nil && (state.Status.Attempts < 0 || state.Status.Attempts > 30) {
		err = fmt.Errorf("invalid retry state")
	}
	if err != nil {
		e.loadError = err
		return
	}
	e.state = state
	e.state.Status.Instruction = *state.Policy
	// Reboot loses the kernel rules; only a fresh check can claim applied.
	e.state.Status.Applied = false
}

func (e *Engine) save() error {
	data, err := json.Marshal(e.state)
	if err != nil {
		return err
	}
	return e.persist(e.path, data)
}

func (e *Engine) Status() *Status {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.load()
	if e.state.Policy == nil {
		return nil
	}
	s := e.state.Status
	return &s
}

// Sync accepts only newer desired state. A missing policy retains the last
// saved protection during panel outages, partial responses and server rollback.
func (e *Engine) Sync(ctx context.Context, instruction *Instruction) *Status {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.load()
	if instruction != nil {
		if !instruction.valid() {
			s := Status{Instruction: *instruction, ErrorCode: "INVALID_POLICY", CheckedAt: e.now().UTC().Format(time.RFC3339)}
			return &s
		}
		current := e.state.Policy
		if current != nil && ((current.BlockSpeedTest && instruction.speedTestMissing) || instruction.Revision < current.Revision ||
			(instruction.Revision == current.Revision && (instruction.BlockBT != current.BlockBT || instruction.BlockMining != current.BlockMining || instruction.BlockSpeedTest != current.BlockSpeedTest || instruction.RetryNonce < current.RetryNonce))) {
			// Never let a delayed/old response remove newer host protection.
			s := e.state.Status
			return &s
		}
		if current == nil || *current != *instruction {
			copy := *instruction
			e.state.Policy = &copy
			e.state.Status = Status{Instruction: copy}
			e.loadError = nil // A fresh authenticated desired policy can repair a corrupt local state.
		}
	}
	return e.reconcile(ctx, false, true)
}

// Restore uses saved bridge names before Incus starts. Normal reconciliation
// subsequently rediscovers networks and refuses unprotected NIC types.
func (e *Engine) Restore(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.load()
	if e.loadError != nil {
		return e.loadError
	}
	s := e.reconcile(ctx, true, false)
	if s != nil && !s.Applied {
		return fmt.Errorf("abuse restore: %s", s.ErrorCode)
	}
	return nil
}

func (e *Engine) fail(code string, err error) *Status {
	s := &e.state.Status
	s.Applied, s.ErrorCode = false, code
	if s.Attempts < 30 {
		s.Attempts++
	}
	delay := retryDelay(s.Attempts)
	s.CheckedAt = e.now().UTC().Format(time.RFC3339)
	s.NextRetryAt = e.now().Add(delay).UTC().Format(time.RFC3339)
	if saveErr := e.save(); saveErr != nil {
		s.ErrorCode = "PERSIST_FAILED"
	}
	// Detailed command failures stay on this host, never in the heartbeat.
	log.Printf("abuse policy: %s: %v", s.ErrorCode, err)
	copy := *s
	return &copy
}

func retryDelay(attempts int) time.Duration {
	shift := attempts - 1
	if shift < 0 {
		shift = 0
	}
	if shift > 6 {
		shift = 6
	}
	delay := time.Duration(15*(1<<uint(shift))) * time.Second
	if delay > 15*time.Minute {
		delay = 15 * time.Minute
	}
	return delay
}

// Package repair is asynchronous so package locks, mirrors or DNS timeouts do
// not stop authenticated heartbeats. Desired policy and failures remain durable.
func (e *Engine) scheduleDependencyRepair(parent context.Context, ipv6, module bool) {
	if e.repairing || e.repairDependencies == nil || e.state.Policy == nil || !e.state.Policy.enabled() {
		return
	}
	e.repairing = true
	policy := *e.state.Policy
	go func() {
		ctx, cancel := context.WithTimeout(parent, 2*time.Minute)
		err := e.repairDependencies(ctx, ipv6, module)
		cancel()
		e.mu.Lock()
		e.repairing = false
		current := e.state.Policy != nil && *e.state.Policy == policy
		if current {
			e.state.Status.CheckedAt = e.now().UTC().Format(time.RFC3339)
			if err == nil {
				e.state.Status.NextRetryAt = ""
			} else {
				e.state.Status.NextRetryAt = e.now().Add(retryDelay(e.state.Status.Attempts)).UTC().Format(time.RFC3339)
			}
			if saveErr := e.save(); saveErr != nil {
				e.state.Status.ErrorCode = "PERSIST_FAILED"
			}
			if err == nil {
				// Successful package/module commands do not prove enforcement.
				// If verification still fails, wait for its backoff before trying
				// another repair instead of recursively spawning installers.
				e.reconcile(parent, false, false)
			}
		}
		e.mu.Unlock()
		if err != nil {
			log.Printf("abuse dependency repair: %v", err)
		}
	}()
}

func (e *Engine) reconcile(ctx context.Context, restoring, allowRepair bool) *Status {
	if e.state.Policy == nil {
		return nil
	}
	if e.repairing && e.state.Policy.enabled() {
		if e.state.Status.CheckedAt == "" {
			e.state.Status.CheckedAt = e.now().UTC().Format(time.RFC3339)
			e.state.Status.ErrorCode = "DEPENDENCY_MISSING"
			if err := e.save(); err != nil {
				e.state.Status.ErrorCode = "PERSIST_FAILED"
			}
		}
		copy := e.state.Status
		return &copy
	}
	if deadline, err := time.Parse(time.RFC3339, e.state.Status.NextRetryAt); !restoring && err == nil && e.now().Before(deadline) {
		copy := e.state.Status
		return &copy
	}
	repairParent := ctx
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	p := *e.state.Policy
	bridges, ipv6 := e.state.Bridges, e.state.IPv6
	if !restoring && p.enabled() {
		var err error
		bridges, ipv6, err = e.discover(ctx)
		if err != nil {
			code := "NETWORK_DISCOVERY_FAILED"
			if errors.Is(err, errUnsupported) {
				code = "UNSUPPORTED_NETWORK"
			}
			if errors.Is(err, exec.ErrNotFound) {
				code = "DEPENDENCY_MISSING"
			}
			return e.fail(code, err)
		}
	}
	if e.ipv6Available() {
		ipv6 = true
	}
	// Disabling the feature must still remove IPv4 rules after an operator has
	// disabled the IPv6 kernel; there can be no live IPv6 table in that state.
	if !p.enabled() && !e.ipv6Available() {
		ipv6 = false
	}
	if ipv6 && !e.ipv6Available() {
		return e.fail("UNSUPPORTED_NETWORK", fmt.Errorf("saved/customer IPv6 cannot be covered by this kernel"))
	}
	families := []string{"iptables"}
	if ipv6 {
		families = append(families, "ip6tables")
	}
	for _, family := range families {
		for _, suffix := range []string{"-save", "-restore"} {
			if _, err := e.lookPath(family + suffix); err != nil {
				status := e.fail("DEPENDENCY_MISSING", err)
				if allowRepair && !restoring && status.ErrorCode == "DEPENDENCY_MISSING" {
					e.scheduleDependencyRepair(repairParent, ipv6, false)
				}
				return status
			}
		}
	}
	rules, err := Rules(p, bridges)
	if err != nil {
		return e.fail("UNSUPPORTED_NETWORK", err)
	}
	if !e.serviceReady {
		if err = e.ensureService(ctx); err != nil {
			return e.fail("RESTORE_FAILED", err)
		}
		e.serviceReady = true
	}
	e.state.Bridges, e.state.IPv6 = bridges, ipv6
	// Persist desired state before changing either family so a reboot can repair
	// even an interrupted update without waiting for the controller.
	if err = e.save(); err != nil {
		return e.fail("PERSIST_FAILED", err)
	}
	snapshots, batches := map[string]string{}, map[string]string{}
	for _, family := range families {
		snapshot, err := e.run(ctx, family+"-save", "", "-t", "mangle")
		if err != nil {
			return e.fail("APPLY_FAILED", err)
		}
		snapshots[family] = snapshot
		if !matches(snapshot, rules) {
			batches[family] = replacement(snapshot, rules)
			if _, err := e.run(ctx, family+"-restore", batches[family], "--wait", "3", "--noflush", "--test"); err != nil {
				code := "APPLY_FAILED"
				message := strings.ToLower(err.Error())
				if strings.Contains(message, "couldn't load match") || strings.Contains(message, "couldn't load target") ||
					strings.Contains(message, "no chain/target/match") || strings.Contains(message, "module is missing") {
					code = "DEPENDENCY_MISSING"
				}
				status := e.fail(code, err)
				if allowRepair && code == "DEPENDENCY_MISSING" && !restoring && status.ErrorCode == "DEPENDENCY_MISSING" {
					e.scheduleDependencyRepair(repairParent, ipv6, true)
				}
				return status
			}
		}
	}
	var changed []string
	rollback := func() {
		// The apply context may have timed out; allow a separate bounded cleanup.
		rollbackCtx, rollbackCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer rollbackCancel()
		for _, family := range changed {
			current, readErr := e.run(rollbackCtx, family+"-save", "", "-t", "mangle")
			if readErr == nil {
				_, readErr = e.run(rollbackCtx, family+"-restore", replacement(current, ownedRules(snapshots[family])), "--wait", "3", "--noflush")
			}
			if readErr != nil {
				log.Printf("abuse rollback %s: %v", family, readErr)
			}
		}
	}
	for _, family := range families {
		if batch, needed := batches[family]; needed {
			changed = append(changed, family)
			if _, err := e.run(ctx, family+"-restore", batch, "--wait", "3", "--noflush"); err != nil {
				rollback()
				return e.fail("APPLY_FAILED", err)
			}
		}
	}
	for _, family := range families {
		actual, err := e.run(ctx, family+"-save", "", "-t", "mangle")
		if err != nil || !matches(actual, rules) {
			rollback()
			return e.fail("APPLY_FAILED", fmt.Errorf("%s verification failed: %v", family, err))
		}
	}
	e.state.Status.Applied, e.state.Status.ErrorCode, e.state.Status.NextRetryAt = true, "", ""
	e.state.Status.CheckedAt = e.now().UTC().Format(time.RFC3339)
	if err := e.save(); err != nil {
		return e.fail("PERSIST_FAILED", err)
	}
	copy := e.state.Status
	return &copy
}
