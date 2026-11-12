//go:build linux

package performance

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// Fixed host procfs keys avoid installing/reloading procps services. No key,
// path, namespace or value can be supplied by a customer/controller request.
func hostSysctl(ctx context.Context, args ...string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(args) != 2 {
		return nil, fmt.Errorf("BBR fixed host sysctl required")
	}
	key, value, write := strings.Cut(args[1], "=")
	path := ""
	switch key {
	case "net.ipv4.tcp_available_congestion_control":
		if write {
			return nil, fmt.Errorf("read only")
		}
		path = "/proc/sys/net/ipv4/tcp_available_congestion_control"
	case "net.ipv4.tcp_congestion_control":
		if write && value != "bbr" {
			return nil, fmt.Errorf("fixed BBR value required")
		}
		path = "/proc/sys/net/ipv4/tcp_congestion_control"
	case "net.core.default_qdisc":
		if write && value != "fq" {
			return nil, fmt.Errorf("fixed qdisc required")
		}
		path = "/proc/sys/net/core/default_qdisc"
	default:
		return nil, fmt.Errorf("BBR sysctl key not allowed")
	}
	if write && args[0] == "-w" {
		return nil, os.WriteFile(path, []byte(value+"\n"), 0644)
	}
	if !write && args[0] == "-n" {
		return os.ReadFile(path)
	}
	return nil, fmt.Errorf("BBR sysctl operation not allowed")
}

func performanceLock(path string) (func(), error) {
	dir := filepath.Dir(path)
	if info, err := os.Lstat(dir); err == nil {
		if !info.IsDir() || !rootOwned(info) || info.Mode()&0022 != 0 {
			return nil, fmt.Errorf("BBR repair directory unsafe")
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	fd, err := syscall.Open(path, syscall.O_CREAT|syscall.O_RDWR|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), path)
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || !rootOwned(info) || info.Mode()&0022 != 0 {
		file.Close()
		return nil, fmt.Errorf("BBR repair lock unsafe")
	}
	if err = syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, fmt.Errorf("BBR tool repair busy")
	}
	return func() { _ = syscall.Flock(fd, syscall.LOCK_UN); _ = file.Close() }, nil
}

func runToolInstall(ctx context.Context, cmd *exec.Cmd) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		<-done
		return ctx.Err()
	}
}
