//go:build linux

package upgrade

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

const upgradeLockMarker = "incudal-agent-upgrade-flock-v1\n"

func acquireLock(lockPath string) (func(), error) {
	if err := initializeUpgradeLock(lockPath); err != nil {
		return nil, err
	}
	fd, err := syscall.Open(lockPath, syscall.O_RDWR|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), lockPath)
	accepted := false
	defer func() {
		if !accepted {
			_ = file.Close()
		}
	}()
	var stat syscall.Stat_t
	if err := syscall.Fstat(fd, &stat); err != nil {
		return nil, err
	}
	if stat.Mode&syscall.S_IFMT != syscall.S_IFREG || stat.Uid != uint32(os.Geteuid()) || stat.Mode&0022 != 0 {
		return nil, errors.New("upgrade lock must be a regular file owned by the current user without group/other write access")
	}
	if err := syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) {
			return nil, ErrUpgradeInProgress
		}
		return nil, err
	}
	content, err := io.ReadAll(io.LimitReader(file, 4097))
	if err != nil {
		return nil, err
	}
	if len(content) > 4096 {
		return nil, errors.New("upgrade lock metadata is too large")
	}
	text := string(content)
	// New locks are published with complete metadata and use flock as authority.
	// An existing empty file may be a live legacy holder before its PID write.
	modern := strings.HasPrefix(text, upgradeLockMarker)
	if !modern {
		pid, err := strconv.ParseInt(strings.TrimSpace(text), 10, 32)
		if err != nil || pid <= 0 {
			return nil, errors.New("legacy upgrade lock contains an invalid owner PID; refusing recovery")
		}
		// A legacy O_EXCL holder cannot participate in flock. Keep a live or
		// unverifiable PID blocked, including possible PID reuse; never kill it.
		if err := syscall.Kill(int(pid), 0); !errors.Is(err, syscall.ESRCH) {
			return nil, fmt.Errorf("%w: legacy owner PID %d is alive or cannot be verified", ErrUpgradeInProgress, pid)
		}
	}
	// Never rewrite legacy metadata: a crash during migration must not turn it
	// into an ambiguous empty file. PID reuse remains conservatively blocked.
	accepted = true
	var once sync.Once
	return func() {
		once.Do(func() {
			_ = syscall.Flock(fd, syscall.LOCK_UN)
			_ = file.Close()
		})
	}, nil
}

func initializeUpgradeLock(lockPath string) error {
	if _, err := os.Lstat(lockPath); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	// Publish a complete new marker without replacing an existing lock inode.
	// A process killed before Link leaves only its own unused temporary file.
	file, err := os.CreateTemp(filepath.Dir(lockPath), ".incudal-agent-upgrade-lock-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := fmt.Fprintf(file, "%screator_pid=%d\n", upgradeLockMarker, os.Getpid()); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Link(file.Name(), lockPath); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	return nil
}
