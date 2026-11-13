// Package provisioning repairs Incus image tools and LXCFS resource visibility.
// Its scoped compatibility reload preserves running customers and host identity.
package provisioning

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

type Status struct {
	Version       int    `json:"version"`
	Ready         bool   `json:"ready"`
	CheckedAt     string `json:"checkedAt"`
	Error         string `json:"error,omitempty"`
	IncusCompat   string `json:"incusCompat,omitempty"`
	CompatRequest string `json:"compatRequest,omitempty"`
	CompatHash    string `json:"compatHash,omitempty"`
}
type Engine struct {
	mu           sync.Mutex
	enabled      *bool
	status       Status
	guests       []Guest
	compatPermit *CompatPermit
}
type Guest struct {
	Name      string `json:"name"`
	UUID      string `json:"uuid"`
	MemoryMiB int    `json:"memoryMiB"`
}
type CompatPermit struct {
	RequestID    string              `json:"requestId"`
	ExpiresAt    string              `json:"expiresAt"`
	HostIdentity string              `json:"hostIdentity"`
	Guests       []CompatGuestPermit `json:"guests"`
}
type CompatGuestPermit struct {
	Name  string `json:"name"`
	UUID  string `json:"uuid"`
	State string `json:"state"`
}

func (e *Engine) SetCompatPermit(p *CompatPermit) { e.mu.Lock(); e.compatPermit = p; e.mu.Unlock() }

func New() *Engine                   { return &Engine{} }
func (e *Engine) SetPoolHost(v bool) { e.mu.Lock(); e.enabled = &v; e.mu.Unlock() }
func (e *Engine) SetGuests(v []Guest) {
	e.mu.Lock()
	e.guests = append([]Guest(nil), v...)
	e.mu.Unlock()
}
func (e *Engine) Status() Status { e.mu.Lock(); defer e.mu.Unlock(); return e.status }
func (e *Engine) Run(ctx context.Context) {
	for ctx.Err() == nil {
		e.mu.Lock()
		enabled := e.enabled != nil && *e.enabled
		guests := append([]Guest(nil), e.guests...)
		permit := e.compatPermit
		e.mu.Unlock()
		if enabled {
			c, cancel := context.WithTimeout(ctx, 180*time.Second)
			compatStatus, compatRequest, compatHashValue := incusCompatibilityStatus(c)
			if compatStatus == "needed" || compatStatus == "pending" {
				if permit != nil && validCompatPermit(permit) {
					_ = prepareIncusCompatibility(c, permit)
					compatStatus, compatRequest, compatHashValue = incusCompatibilityStatus(c)
				}
			}
			err := repair(c)
			if err == nil {
				err = ensureResourceVisibility(c)
			}
			if err == nil {
				err = repairGuestVisibility(c, guests)
			}
			cancel()
			s := Status{Version: 1, Ready: err == nil, CheckedAt: time.Now().UTC().Format(time.RFC3339), IncusCompat: compatStatus, CompatRequest: compatRequest, CompatHash: compatHashValue}
			if err != nil {
				s.Error = "HOST_PROVISIONING_TOOLS_PENDING"
			}
			e.mu.Lock()
			e.status = s
			e.mu.Unlock()
		}
		timer := time.NewTimer(30 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
func packagesFor(release string) ([]string, error) {
	fields := map[string]string{}
	for _, l := range strings.Split(release, "\n") {
		k, v, ok := strings.Cut(l, "=")
		if ok {
			fields[k] = strings.Trim(v, "\"'")
		}
	}
	switch fields["ID"] {
	case "alpine":
		return []string{"apparmor-utils", "tar", "gzip", "xz", "squashfs-tools", "rsync", "lxcfs", "lxcfs-openrc", "util-linux"}, nil
	case "debian", "ubuntu":
		return []string{"apparmor", "tar", "gzip", "xz-utils", "squashfs-tools", "rsync", "lxcfs", "util-linux"}, nil
	default:
		return nil, fmt.Errorf("host distribution unsupported")
	}
}

var required = []string{"aa-exec", "tar", "gzip", "xz", "unsquashfs", "rsync", "nsenter"}

func releaseFile() (string, error) { b, e := os.ReadFile("/etc/os-release"); return string(b), e }
