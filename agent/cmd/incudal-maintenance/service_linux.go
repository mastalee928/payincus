package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// Keep the lock for the service lifetime. A different port cannot open a
// second control endpoint for the same protected host identity.
func lockMaintenanceService(directory string) (func(), error) {
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		return nil, os.ErrPermission
	}
	for current := directory; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, os.ErrPermission
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 || info.Mode().Perm()&0022 != 0 || (current == directory && info.Mode().Perm() != 0700) {
			return nil, os.ErrPermission
		}
		if filepath.Dir(current) == current {
			break
		}
	}
	fd, err := syscall.Open(filepath.Join(directory, "maintenance-service.lock"), syscall.O_CREAT|syscall.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), "maintenance-service.lock")
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != 0 || stat.Nlink != 1 || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
		file.Close()
		return nil, os.ErrPermission
	}
	if syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		file.Close()
		return nil, fmt.Errorf("maintenance service already owns this identity")
	}
	return func() { syscall.Flock(fd, syscall.LOCK_UN); file.Close() }, nil
}
