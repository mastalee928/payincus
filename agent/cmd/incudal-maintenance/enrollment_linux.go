package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

func bytesReader(raw []byte) *bytes.Reader { return bytes.NewReader(raw) }
func readEnrollment(path string) ([]byte, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, os.ErrPermission
	}
	current := filepath.Dir(path)
	for {
		info, err := os.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, os.ErrPermission
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || (stat.Uid != 0 && int(stat.Uid) != os.Geteuid()) || (info.Mode().Perm()&0022 != 0 && !(stat.Uid == 0 && info.Mode()&os.ModeSticky != 0)) {
			return nil, os.ErrPermission
		}
		if current == filepath.Dir(path) && (int(stat.Uid) != os.Geteuid() || info.Mode().Perm() != 0700) {
			return nil, os.ErrPermission
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), path)
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() > 16384 {
		return nil, os.ErrPermission
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(stat.Uid) != os.Geteuid() || stat.Nlink != 1 {
		return nil, os.ErrPermission
	}
	raw, err := io.ReadAll(io.LimitReader(file, 16385))
	if err != nil || len(raw) > 16384 {
		return nil, os.ErrPermission
	}
	return raw, nil
}
