//go:build linux

package provisioning

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
)

// Resolve only root-owned system executables. PATH supplied by a service or
// customer cannot substitute an executable for a successful readiness receipt.
func systemTool(name string) (string, error) {
	for _, dir := range []string{"/usr/bin", "/usr/sbin", "/bin", "/sbin"} {
		p := filepath.Join(dir, name)
		resolved, e := filepath.EvalSymlinks(p)
		if e != nil {
			continue
		}
		if !strings.HasPrefix(resolved, "/usr/") && !strings.HasPrefix(resolved, "/bin/") && !strings.HasPrefix(resolved, "/sbin/") {
			continue
		}
		i, e := os.Stat(resolved)
		if e != nil || !i.Mode().IsRegular() || i.Mode()&0111 == 0 || i.Mode()&0022 != 0 {
			continue
		}
		st, ok := i.Sys().(*syscall.Stat_t)
		if !ok || st.Uid != 0 {
			continue
		}
		return p, nil
	}
	return "", fmt.Errorf("required host tool missing")
}
func run(ctx context.Context, name string, args ...string) ([]byte, error) {
	p, e := systemTool(name)
	if e != nil {
		return nil, e
	}
	c := exec.Command(p, args...)
	c.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL=C", "DEBIAN_FRONTEND=noninteractive", "NEEDRESTART_MODE=l", "UCF_FORCE_CONFFOLD=1"}
	c.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// Output is bounded and never placed in heartbeat/logs (mirrors may be private).
	var out limitedBuffer
	c.Stdout = &out
	c.Stderr = &out
	if e = c.Start(); e != nil {
		return nil, e
	}
	done := make(chan error, 1)
	go func() { done <- c.Wait() }()
	select {
	case e = <-done:
		return out.data, e
	case <-ctx.Done():
		_ = syscall.Kill(-c.Process.Pid, syscall.SIGKILL)
		<-done
		return nil, ctx.Err()
	}
}

type limitedBuffer struct{ data []byte }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	if len(b.data) < 262144 {
		left := 262144 - len(b.data)
		if n > left {
			p = p[:left]
		}
		b.data = append(b.data, p...)
	}
	return n, nil
}
func check(ctx context.Context) error {
	for _, n := range required {
		if _, e := systemTool(n); e != nil {
			return e
		}
	}
	// Dynamic-library/executable failures must not mint readiness from file presence.
	for _, n := range required {
		flag := "--help"
		// Older unsquashfs versions exit 1 even on the version path. Require
		// their real version output; missing loaders and crashes still fail.
		if n == "unsquashfs" {
			flag = "-version"
		}
		out, e := run(ctx, n, flag)
		var exit *exec.ExitError
		if n == "unsquashfs" && errors.As(e, &exit) && exit.ExitCode() == 1 && regexp.MustCompile(`(?m)^unsquashfs version [0-9]+\.[0-9]+`).Match(out) {
			e = nil
		}
		if e != nil {
			return fmt.Errorf("host tool %s execution failed", n)
		}
	}
	return nil
}
func lock() (func(), error) {
	dir := "/var/lib/incudal-agent"
	if e := os.MkdirAll(dir, 0700); e != nil {
		return nil, e
	}
	for p := dir; p != "/"; p = filepath.Dir(p) {
		i, e := os.Lstat(p)
		if e != nil || !i.IsDir() || i.Mode()&0022 != 0 {
			return nil, fmt.Errorf("unsafe tool repair directory")
		}
		st, ok := i.Sys().(*syscall.Stat_t)
		if !ok || st.Uid != 0 {
			return nil, fmt.Errorf("unsafe owner")
		}
	}
	fd, e := syscall.Open(dir+"/provisioning-tools.lock", syscall.O_CREAT|syscall.O_RDWR|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, 0600)
	if e != nil {
		return nil, e
	}
	f := os.NewFile(uintptr(fd), "tools-lock")
	i, e := f.Stat()
	if e != nil {
		f.Close()
		return nil, e
	}
	st, owned := i.Sys().(*syscall.Stat_t)
	if !owned || st.Uid != 0 || st.Nlink != 1 || !i.Mode().IsRegular() || i.Mode()&0077 != 0 {
		f.Close()
		return nil, fmt.Errorf("unsafe tool lock")
	}
	if e = syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		f.Close()
		return nil, e
	}
	return func() { _ = syscall.Flock(fd, syscall.LOCK_UN); _ = f.Close() }, nil
}

var apkChange = regexp.MustCompile(`(?m)(Installing|Upgrading|Downgrading|Reinstalling) ([a-zA-Z0-9+_.-]+) \(([0-9][a-zA-Z0-9+_.~-]*)\)`)
var aptChange = regexp.MustCompile(`(?m)^Inst ([a-zA-Z0-9+_.:-]+)([^\n]*)`)
var aptRemove = regexp.MustCompile(`(?m)^Remv `)
var aptVersion = regexp.MustCompile(`(?m)^Inst ([a-zA-Z0-9+_.:-]+)(?: \[[^\]]+\])? \(([0-9][a-zA-Z0-9+_.:~-]*) `)

func safePlan(output string, alpine bool) error {
	if strings.Contains(output, "Purging ") || strings.Contains(output, "Removing ") || aptRemove.MatchString(output) {
		return fmt.Errorf("package removal refused")
	}
	allowed := map[string]bool{"apparmor": true, "apparmor-utils": true, "libapparmor": true, "py3-apparmor": true, "py3-libapparmor": true, "perl": true, "tar": true, "gzip": true, "xz": true, "xz-utils": true, "squashfs-tools": true, "rsync": true}
	if alpine {
		for _, m := range apkChange.FindAllStringSubmatch(output, -1) {
			if m[1] != "Installing" && !allowed[m[2]] {
				return fmt.Errorf("unrelated installed package change refused")
			}
		}
	} else {
		for _, m := range aptChange.FindAllStringSubmatch(output, -1) {
			if strings.Contains(m[2], "[") && !allowed[strings.Split(m[1], ":")[0]] {
				return fmt.Errorf("unrelated installed package change refused")
			}
		}
	}
	return nil
}
func repair(ctx context.Context) error {
	if e := check(ctx); e == nil {
		return nil
	}
	if os.Geteuid() != 0 {
		return fmt.Errorf("tool repair requires root")
	}
	unlock, e := lock()
	if e != nil {
		return e
	}
	defer unlock()
	release, e := releaseFile()
	if e != nil {
		return e
	}
	packages, e := packagesFor(release)
	if e != nil {
		return e
	}
	alpine := strings.Contains(release, "ID=alpine") || strings.Contains(release, "ID=\"alpine\"")
	if alpine {
		// Use the configured signed stable branch. Never rewrite repositories or trust.
		out, e := run(ctx, "apk", append([]string{"--simulate", "--no-cache", "--wait", "5", "add"}, packages...)...)
		if e != nil {
			return e
		}
		if e = safePlan(string(out), true); e != nil {
			return e
		}
		pinned := []string{}
		for _, change := range apkChange.FindAllStringSubmatch(string(out), -1) {
			pinned = append(pinned, change[2]+"="+change[3])
		}
		// If files drifted while packages remain installed, fix those exact
		// installed packages. Ordinary add would otherwise never repair them.
		if len(pinned) == 0 {
			out, e = run(ctx, "apk", append([]string{"--simulate", "--no-cache", "--wait", "5", "fix"}, packages...)...)
			if e != nil {
				return e
			}
			if e = safePlan(string(out), true); e != nil {
				return e
			}
			for _, change := range apkChange.FindAllStringSubmatch(string(out), -1) {
				pinned = append(pinned, change[2]+"="+change[3])
			}
			if len(pinned) == 0 {
				return fmt.Errorf("tool repair plan unavailable")
			}
			_, e = run(ctx, "apk", append([]string{"--no-cache", "--wait", "5", "fix"}, pinned...)...)
		} else {
			_, e = run(ctx, "apk", append([]string{"--no-cache", "--wait", "5", "add"}, pinned...)...)
		}
		if e != nil {
			return e
		}
	} else {
		prefix := []string{"-o", "DPkg::Lock::Timeout=5", "-o", "Acquire::Retries=1", "-o", "Acquire::http::Timeout=10", "-o", "Acquire::https::Timeout=10"}
		args := append(append([]string{}, prefix...), "--simulate", "install", "--reinstall", "--no-remove", "--no-install-recommends")
		args = append(args, packages...)
		out, e := run(ctx, "apt-get", args...)
		if e != nil {
			if _, e = run(ctx, "apt-get", append(append([]string{}, prefix...), "update", "-qq")...); e != nil {
				return e
			}
			out, e = run(ctx, "apt-get", args...)
		}
		if e != nil {
			return e
		}
		if e = safePlan(string(out), false); e != nil {
			return e
		}
		pinned := []string{}
		for _, change := range aptVersion.FindAllStringSubmatch(string(out), -1) {
			pinned = append(pinned, change[1]+"="+change[2])
		}
		if len(pinned) == 0 {
			return fmt.Errorf("tool repair plan unavailable")
		}
		args = append(append([]string{}, prefix...), "install", "-y", "--reinstall", "--no-remove", "--no-install-recommends")
		args = append(args, pinned...)
		if _, e = run(ctx, "apt-get", args...); e != nil {
			return e
		}
	}
	return check(ctx)
}
