// Package provisioning repairs only the host tools required by Incus image
// unpacking. It never enters guests, restarts services or changes host identity.
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
	Version   int    `json:"version"`
	Ready     bool   `json:"ready"`
	CheckedAt string `json:"checkedAt"`
	Error     string `json:"error,omitempty"`
}
type Engine struct {
	mu      sync.Mutex
	enabled *bool
	status  Status
}

func New() *Engine                   { return &Engine{} }
func (e *Engine) SetPoolHost(v bool) { e.mu.Lock(); e.enabled = &v; e.mu.Unlock() }
func (e *Engine) Status() Status     { e.mu.Lock(); defer e.mu.Unlock(); return e.status }
func (e *Engine) Run(ctx context.Context) {
	for ctx.Err() == nil {
		e.mu.Lock()
		enabled := e.enabled != nil && *e.enabled
		e.mu.Unlock()
		if enabled {
			c, cancel := context.WithTimeout(ctx, 55*time.Second)
			err := repair(c)
			cancel()
			s := Status{Version: 1, Ready: err == nil, CheckedAt: time.Now().UTC().Format(time.RFC3339)}
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
		return []string{"apparmor-utils", "tar", "gzip", "xz", "squashfs-tools", "rsync"}, nil
	case "debian", "ubuntu":
		return []string{"apparmor", "tar", "gzip", "xz-utils", "squashfs-tools", "rsync"}, nil
	default:
		return nil, fmt.Errorf("host distribution unsupported")
	}
}

var required = []string{"aa-exec", "tar", "gzip", "xz", "unsquashfs", "rsync"}

func releaseFile() (string, error) { b, e := os.ReadFile("/etc/os-release"); return string(b), e }
