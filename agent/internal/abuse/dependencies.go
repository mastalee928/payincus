package abuse

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

type dependencyCommand struct {
	name string
	args []string
}

func dependencyPlan(osRelease string, ipv6 bool) ([]dependencyCommand, error) {
	id := ""
	for _, line := range strings.Split(osRelease, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if ok && key == "ID" {
			id = strings.Trim(value, "\"'")
		}
	}
	switch id {
	case "debian", "ubuntu":
		options := []string{"-o", "DPkg::Lock::Timeout=5", "-o", "Acquire::Retries=1", "-o", "Acquire::http::Timeout=15", "-o", "Acquire::https::Timeout=15"}
		return []dependencyCommand{
			{"apt-get", append(append([]string{}, options...), "update", "-qq")},
			{"apt-get", append(append([]string{}, options...), "install", "-y", "--no-install-recommends", "--no-upgrade", "--no-remove", "iptables")},
		}, nil
	case "alpine":
		args := []string{"add", "--no-cache", "--wait", "5", "iptables"}
		if ipv6 {
			args = append(args, "ip6tables")
		}
		return []dependencyCommand{{"apk", args}}, nil
	default:
		return nil, fmt.Errorf("automatic dependency repair is unsupported on this OS")
	}
}

func repairDependencies(ctx context.Context, ipv6, module bool) error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("dependency repair requires root")
	}
	unlock, err := dependencyLock("/var/lib/incudal-agent/abuse-dependencies.lock")
	if err != nil {
		return err
	}
	defer unlock()
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return fmt.Errorf("cannot identify dependency package manager")
	}
	plan, err := dependencyPlan(string(data), ipv6)
	if err != nil {
		return err
	}
	if module {
		// No module name or executable is accepted from the controller.
		if _, err := exec.LookPath("modprobe"); err != nil {
			return fmt.Errorf("xt_string module loader is unavailable")
		}
		return dependencyRun(ctx, dependencyCommand{"modprobe", []string{"xt_string"}})
	}
	for _, step := range plan {
		if err := dependencyRun(ctx, step); err != nil {
			return err
		}
	}
	families := []string{"iptables"}
	if ipv6 {
		families = append(families, "ip6tables")
	}
	for _, family := range families {
		for _, suffix := range []string{"-save", "-restore"} {
			if _, err := exec.LookPath(family + suffix); err != nil {
				return fmt.Errorf("installed package did not provide required firewall tools")
			}
		}
	}
	return nil
}

func dependencyRun(ctx context.Context, step dependencyCommand) error {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	cmd := exec.Command(step.name, step.args...)
	// Preserve configured package mirrors; suppress service restarts and prompts.
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "DEBIAN_FRONTEND=") && !strings.HasPrefix(entry, "NEEDRESTART_MODE=") && !strings.HasPrefix(entry, "UCF_FORCE_CONFFOLD=") {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "DEBIAN_FRONTEND=noninteractive", "NEEDRESTART_MODE=l", "UCF_FORCE_CONFFOLD=1")
	var output boundedBuffer
	cmd.Stdout, cmd.Stderr = &output, &output
	if err := runDependencyProcess(ctx, cmd); err != nil {
		// Package repository diagnostics may contain private mirror credentials.
		return fmt.Errorf("dependency command %s failed: %w", step.name, err)
	}
	return nil
}
