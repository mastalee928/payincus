package controllerconfig

import (
	"os"
	"path/filepath"
	"syscall"
)

func validateIncusQuiescenceSocket(path string) error {
	current := filepath.Dir(path)
	for {
		info, err := os.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return failure("CONTROLLER_QUIESCENCE_SOCKET_INVALID")
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || (stat.Uid != 0 && int(stat.Uid) != os.Geteuid()) || (info.Mode().Perm()&0022 != 0 && !(stat.Uid == 0 && info.Mode()&os.ModeSticky != 0)) {
			return failure("CONTROLLER_QUIESCENCE_SOCKET_INVALID")
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSocket == 0 || info.Mode().Perm()&0007 != 0 {
		return failure("CONTROLLER_QUIESCENCE_SOCKET_INVALID")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != 0 && int(stat.Uid) != os.Geteuid() {
		return failure("CONTROLLER_QUIESCENCE_SOCKET_INVALID")
	}
	return nil
}
