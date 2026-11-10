package guestguard

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"
)

const statePath = "/var/lib/incudal-agent/guest-guard.json"

type runner func(context.Context, string, string, ...string) (string, error)
type Status struct {
	Applied   bool   `json:"applied"`
	CheckedAt string `json:"checkedAt"`
	Error     string `json:"error,omitempty"`
}
type Engine struct {
	mu           sync.Mutex
	statusMu     sync.Mutex
	path         string
	run          runner
	persist      func(string, []byte) error
	service      func(context.Context) error
	legacy       func(context.Context, runner, Policy) error
	discover     func(context.Context, string) (Policy, error)
	status       Status
	serviceReady bool
	serviceAt    time.Time
	lock         func(string) (func(), error)
	managed      func() bool
}

func New() *Engine {
	return &Engine{path: statePath, run: command, persist: atomicWrite, service: ensureService, legacy: repairLegacyReplies, discover: discover, lock: processLock,
		managed: func() bool { _, err := os.Stat("/etc/incudal-onboarding-id"); return err == nil }}
}
func (e *Engine) Status() Status { e.statusMu.Lock(); defer e.statusMu.Unlock(); return e.status }

type limitedBuffer struct{ bytes.Buffer }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 1024*1024 {
		return 0, fmt.Errorf("guest protection output limit")
	}
	return b.Buffer.Write(p)
}
func command(ctx context.Context, name, input string, args ...string) (string, error) {
	return commandWithin(ctx, 5*time.Second, name, input, args...)
}
func commandWithin(ctx context.Context, limit time.Duration, name, input string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, limit)
	defer cancel()
	c := exec.CommandContext(ctx, name, args...)
	c.Stdin = strings.NewReader(input)
	var out, errout limitedBuffer
	c.Stdout = &out
	c.Stderr = &errout
	if err := c.Run(); err != nil {
		return "", fmt.Errorf("guest protection command %s failed", name)
	}
	return out.String(), nil
}
func atomicWrite(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".guest-guard-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, err = f.Write(data)
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
	return syncDirectory(filepath.Dir(path))
}
func digest(rules string) string { s := sha256.Sum256([]byte(rules)); return hex.EncodeToString(s[:]) }
func (e *Engine) apply(ctx context.Context, p Policy) error {
	rules, err := Rules(p)
	if err != nil {
		return err
	}
	// add is idempotent; create/delete/recreate are one nft transaction, including
	// first installation. No observable empty table or global ruleset flush.
	echo, err := e.run(ctx, "nft", "add table inet "+Table+"\ndelete table inet "+Table+"\n"+rules, "-f", "-", "-j", "-e")
	if err != nil {
		return err
	}
	// Read back the actual kernel object, not just a successful shell exit.
	live, err := e.run(ctx, "nft", "", "-j", "list", "table", "inet", Table)
	if err != nil {
		return err
	}
	var data struct {
		Nftables []map[string]json.RawMessage `json:"nftables"`
	}
	if json.Unmarshal([]byte(live), &data) != nil {
		return fmt.Errorf("invalid firewall readback")
	}
	chains, rulesCount := 0, 0
	for _, item := range data.Nftables {
		if item["chain"] != nil {
			chains++
		}
		if item["rule"] != nil {
			rulesCount++
		}
	}
	expected := strings.Count(rules, " counter drop") + strings.Count(rules, " return") + strings.Count(rules, " masquerade")
	if chains != 4 || rulesCount != expected {
		return fmt.Errorf("incomplete firewall readback")
	}
	// Compare every compiled match, verdict, NAT action and hook with nft's
	// transaction echo. Counts alone cannot detect a changed destination/verdict.
	applied, err := firewallObjects(echo, true)
	if err != nil {
		return err
	}
	observed, err := firewallObjects(live, false)
	if err != nil || !reflect.DeepEqual(applied, observed) {
		return fmt.Errorf("firewall readback differs from transaction")
	}
	return nil
}

func firewallObjects(raw string, echo bool) ([]any, error) {
	var data struct {
		Nftables []map[string]json.RawMessage `json:"nftables"`
	}
	if json.Unmarshal([]byte(raw), &data) != nil {
		return nil, fmt.Errorf("invalid firewall objects")
	}
	var result []any
	for _, entry := range data.Nftables {
		if len(entry) != 1 {
			return nil, fmt.Errorf("invalid firewall object")
		}
		if entry["metainfo"] != nil {
			continue
		}
		if echo {
			if entry["delete"] != nil {
				result = nil
				continue
			}
			encoded := entry["add"]
			entry = nil
			if encoded == nil || json.Unmarshal(encoded, &entry) != nil {
				return nil, fmt.Errorf("invalid firewall echo")
			}
		}
		if len(entry) != 1 {
			return nil, fmt.Errorf("invalid firewall object")
		}
		for kind, encoded := range entry {
			if kind != "table" && kind != "chain" && kind != "rule" {
				return nil, fmt.Errorf("unexpected firewall object")
			}
			var row map[string]any
			if json.Unmarshal(encoded, &row) != nil || row["family"] != "inet" {
				return nil, fmt.Errorf("invalid firewall family")
			}
			if kind == "table" && row["name"] != Table || kind != "table" && row["table"] != Table {
				return nil, fmt.Errorf("invalid firewall table")
			}
			if kind == "table" && echo {
				// nft may omit delete from an atomic replacement's echo and emit
				// both the temporary table and its final recreation.
				result = nil
			}
			if kind == "chain" {
				if name, ok := row["name"].(string); !ok || name == "" {
					return nil, fmt.Errorf("invalid firewall chain")
				}
			}
			if kind == "rule" {
				if name, ok := row["chain"].(string); !ok || name == "" {
					return nil, fmt.Errorf("invalid firewall rule chain")
				}
				if exprs, ok := row["expr"].([]any); !ok || len(exprs) == 0 {
					return nil, fmt.Errorf("invalid firewall expression")
				}
			}
			delete(row, "handle")
			delete(row, "use")
			if exprs, ok := row["expr"].([]any); ok {
				for _, expr := range exprs {
					if item, ok := expr.(map[string]any); ok && item["counter"] != nil {
						item["counter"] = nil
					}
				}
			}
			canonicalSets(row)
			result = append(result, map[string]any{kind: row})
		}
	}
	if len(result) < 5 {
		return nil, fmt.Errorf("incomplete firewall objects")
	}
	// Echo follows the source declaration order; list emits chains and their
	// rules grouped differently. Keep rule order within each chain significant.
	key := func(value any) string {
		entry := value.(map[string]any)
		for kind, encoded := range entry {
			row := encoded.(map[string]any)
			switch kind {
			case "table":
				return "0"
			case "chain":
				return "1" + row["name"].(string)
			case "rule":
				return "2" + row["chain"].(string)
			}
		}
		return ""
	}
	sort.SliceStable(result, func(i, j int) bool { return key(result[i]) < key(result[j]) })
	return result, nil
}

// Only set members are unordered. Expression, concatenation and same-chain
// rule order remain significant for semantic verification.
func canonicalSets(value any) {
	switch v := value.(type) {
	case map[string]any:
		for key, child := range v {
			canonicalSets(child)
			if key == "set" {
				if members, ok := child.([]any); ok {
					sort.SliceStable(members, func(i, j int) bool {
						a, _ := json.Marshal(members[i])
						b, _ := json.Marshal(members[j])
						return string(a) < string(b)
					})
				}
			}
		}
	case []any:
		for _, child := range v {
			canonicalSets(child)
		}
	}
}
func (e *Engine) Sync(ctx context.Context, panelURL string) (err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.managed() {
		return fmt.Errorf("customer protection requires an enrolled host")
	}
	release, err := e.lock(e.path + ".lock")
	if err != nil {
		return err
	}
	defer release()
	var p Policy
	defer func() {
		if err != nil {
			// Remove success even when discovery fails. A separate bounded cleanup
			// context still runs after the main operation's deadline.
			clearCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			names := append([]string{"incusbr0"}, p.Bridges...)
			seen := map[string]bool{}
			for _, b := range names {
				if interfaceName.MatchString(b) && !seen[b] {
					seen[b] = true
					_, _ = e.run(clearCtx, "incus", "", "network", "unset", b, ReadyKey)
				}
			}
		}
	}()
	defer func() {
		e.statusMu.Lock()
		defer e.statusMu.Unlock()
		e.status = Status{Applied: err == nil, CheckedAt: time.Now().UTC().Format(time.RFC3339)}
		if err != nil {
			e.status.Error = "GUEST_NETWORK_PROTECTION_PENDING"
		}
	}()
	p, err = e.discover(ctx, panelURL)
	if err != nil {
		// Restore the last accepted rules even when Incus/WG/DNS is temporarily
		// unavailable. Never leave a flushed table open just because discovery
		// failed; the error still withdraws the success receipt below.
		if data, readErr := os.ReadFile(e.path); readErr == nil && len(data) <= 65536 {
			var saved Policy
			if json.Unmarshal(data, &saved) == nil {
				repairCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				_ = e.apply(repairCtx, saved)
				cancel()
			}
		}
		return err
	}
	p, err = normalize(p)
	if err != nil {
		return err
	}
	// Retain last known management endpoints across DNS rotation/outage. These
	// addresses stay protected without needing a healthy control connection.
	oldBytes, readErr := os.ReadFile(e.path)
	if readErr != nil && !os.IsNotExist(readErr) {
		return readErr
	}
	if readErr == nil {
		var old Policy
		if len(oldBytes) > 65536 || json.Unmarshal(oldBytes, &old) != nil {
			return fmt.Errorf("invalid guest protection state")
		}
		old, err = normalize(old)
		if err != nil {
			return err
		}
		p.Management = append(p.Management, old.Management...)
		p, err = normalize(p)
		if err != nil {
			return err
		}
	}
	if !e.serviceReady || time.Since(e.serviceAt) > 10*time.Minute {
		if err = e.service(ctx); err != nil {
			return err
		}
		e.serviceReady = true
		e.serviceAt = time.Now()
	}
	if err = e.apply(ctx, p); err != nil {
		return err
	}
	if err = e.legacy(ctx, e.run, p); err != nil {
		return err
	}
	data, _ := json.Marshal(p)
	if string(data) != string(oldBytes) {
		if err = e.persist(e.path, data); err != nil {
			return err
		}
	}
	rules, _ := Rules(p)
	// Host-only Incus marker can be read over the already pinned management API.
	// No control addresses, credentials or firewall text are exposed to guests.
	for _, b := range p.Bridges {
		if _, err = e.run(ctx, "incus", "", "network", "set", b, ReadyKey, fmt.Sprintf("v1:%s:%d", digest(rules), time.Now().UnixMilli())); err != nil {
			return err
		}
	}
	return nil
}
func (e *Engine) Restore(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	release, err := e.lock(e.path + ".lock")
	if err != nil {
		return err
	}
	defer release()
	data, err := os.ReadFile(e.path)
	if os.IsNotExist(err) {
		if !e.managed() {
			return nil
		}
		// Missing saved endpoints must never disable metadata/host isolation at
		// boot. The standard customer bridge is known before Incus creates it.
		return e.apply(ctx, Policy{Bridges: []string{"incusbr0"}})
	}
	if err != nil {
		return err
	}
	var p Policy
	if len(data) > 65536 || json.Unmarshal(data, &p) != nil {
		return fmt.Errorf("invalid guest protection state")
	}
	return e.apply(ctx, p)
}
func discover(ctx context.Context, panelURL string) (Policy, error) {
	// incusbr0 is known even before Incus starts. Discover all managed bridges,
	// so changing a customer's source address cannot bypass interface matching.
	p := Policy{Bridges: []string{"incusbr0"}}
	raw, err := command(ctx, "incus", "", "network", "list", "--format=json")
	if err != nil {
		return p, err
	}
	var networks []Network
	if err = json.Unmarshal([]byte(raw), &networks); err != nil {
		return p, err
	}
	raw, err = command(ctx, "incus", "", "list", "--all-projects", "--format=json")
	if err != nil {
		return p, err
	}
	var instances []Instance
	if err = json.Unmarshal([]byte(raw), &instances); err != nil {
		return p, err
	}
	p.Bridges, err = customerBridges(networks, instances)
	if err != nil {
		return p, err
	}
	// Read only endpoints, never wg dump (which contains the private key).
	endpoints, err := command(ctx, "wg", "", "show", "incudal-mgmt", "endpoints")
	if err != nil {
		return p, err
	}
	for _, line := range strings.Split(endpoints, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if len(fields) != 2 {
			return p, fmt.Errorf("invalid management endpoint")
		}
		host, _, err := net.SplitHostPort(fields[1])
		if err != nil {
			return p, fmt.Errorf("management endpoint unavailable")
		}
		a, err := netip.ParseAddr(host)
		if err != nil {
			return p, fmt.Errorf("invalid management endpoint")
		}
		p.Management = append(p.Management, a.String())
	}
	u, err := url.Parse(panelURL)
	if err != nil || u.Hostname() == "" {
		return p, fmt.Errorf("invalid panel endpoint")
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, u.Hostname())
	// WG endpoint remains available when public DNS is temporarily unavailable.
	if err == nil {
		for _, a := range addresses {
			if !a.IP.IsLoopback() && !a.IP.IsUnspecified() {
				p.Management = append(p.Management, a.IP.String())
			}
		}
	}
	if len(p.Management) == 0 {
		return p, fmt.Errorf("management endpoints unavailable")
	}
	return p, nil
}
