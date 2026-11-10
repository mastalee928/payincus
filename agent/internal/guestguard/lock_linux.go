//go:build linux

package guestguard

import (
	"os"
	"path/filepath"
	"syscall"
)

func processLock(path string) (func(), error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	var stat syscall.Stat_t
	if err = syscall.Fstat(int(f.Fd()), &stat); err != nil {
		f.Close()
		return nil, err
	}
	if stat.Uid != uint32(os.Geteuid()) || stat.Mode&syscall.S_IFMT != syscall.S_IFREG || stat.Mode&0022 != 0 {
		f.Close()
		return nil, syscall.EPERM
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, err
	}
	return func() { syscall.Flock(int(f.Fd()), syscall.LOCK_UN); f.Close() }, nil
}
