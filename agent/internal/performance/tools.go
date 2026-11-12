package performance

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

var toolRepair struct {
	sync.Mutex
	next time.Time
}

func toolPackages(release string, missing []string) (string, []string, error) {
	id := ""
	for _, line := range strings.Split(release, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok && strings.TrimSpace(key) == "ID" {
			id = strings.Trim(strings.TrimSpace(value), "\"'")
		}
	}
	packages := []string{}
	add := func(name string) {
		for _, existing := range packages {
			if existing == name {
				return
			}
		}
		packages = append(packages, name)
	}
	for _, tool := range missing {
		switch tool {
		case "modprobe", "depmod":
			add("kmod")
		default:
			return "", nil, fmt.Errorf("unsupported BBR tool")
		}
	}
	switch id {
	case "alpine":
		return "apk", append([]string{"add", "--no-cache", "--wait", "5"}, packages...), nil
	case "debian", "ubuntu":
		return "apt-get", append([]string{"-o", "DPkg::Lock::Timeout=5", "-o", "Acquire::Retries=1", "-o", "Acquire::http::Timeout=10", "-o", "Acquire::https::Timeout=10",
			"install", "-y", "--no-install-recommends", "--no-upgrade", "--no-remove"}, packages...), nil
	default:
		return "", nil, fmt.Errorf("BBR tool repair OS unsupported")
	}
}

func ensureTools(ctx context.Context) error {
	missing := []string{}
	for _, tool := range []string{"modprobe", "depmod"} {
		if _, err := exec.LookPath(tool); err != nil {
			missing = append(missing, tool)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	toolRepair.Lock()
	defer toolRepair.Unlock()
	if time.Now().Before(toolRepair.next) {
		return fmt.Errorf("BBR tool repair backing off")
	}
	toolRepair.next = time.Now().Add(10 * time.Minute)
	if os.Geteuid() != 0 {
		return fmt.Errorf("BBR tool repair needs root")
	}
	unlock, err := performanceLock("/var/lib/incudal-agent/bbr-tools.lock")
	if err != nil {
		return err
	}
	defer unlock()
	release, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return fmt.Errorf("BBR OS unavailable")
	}
	name, args, err := toolPackages(string(release), missing)
	if err != nil {
		return err
	}
	if err = installTools(ctx, name, args...); err != nil {
		return err
	}
	for _, tool := range missing {
		if _, err = exec.LookPath(tool); err != nil {
			return fmt.Errorf("BBR installed tool unavailable")
		}
	}
	toolRepair.next = time.Time{}
	return nil
}

func installTools(ctx context.Context, name string, args ...string) error {
	ctx, cancel := context.WithTimeout(ctx, 35*time.Second)
	defer cancel()
	run := func(step ...string) error {
		cmd := exec.Command(name, step...)
		for _, entry := range os.Environ() {
			if !strings.HasPrefix(entry, "DEBIAN_FRONTEND=") && !strings.HasPrefix(entry, "NEEDRESTART_MODE=") && !strings.HasPrefix(entry, "UCF_FORCE_CONFFOLD=") {
				cmd.Env = append(cmd.Env, entry)
			}
		}
		cmd.Env = append(cmd.Env, "DEBIAN_FRONTEND=noninteractive", "NEEDRESTART_MODE=l", "UCF_FORCE_CONFFOLD=1")
		return runToolInstall(ctx, cmd)
	}
	// Discard private package-mirror output; existing signed repositories and
	// package locks remain intact. These tool packages have no guest services.
	if err := run(args...); err != nil {
		// A stale/missing signed package index is recoverable. Refresh only the
		// configured index, then retry this exact tool install under one budget.
		if name != "apt-get" || ctx.Err() != nil {
			return fmt.Errorf("BBR tool installation pending")
		}
		position := 0
		for position < len(args) && args[position] != "install" {
			position++
		}
		if position == len(args) || run(append(append([]string{}, args[:position]...), "update", "-qq")...) != nil || run(args...) != nil {
			return fmt.Errorf("BBR tool installation pending")
		}
	}
	return nil
}
