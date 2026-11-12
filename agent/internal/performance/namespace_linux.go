//go:build linux

package performance

import (
	"bytes"
	"fmt"
	"os"
	"syscall"
)

func rootOwned(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && stat.Uid == 0
}
func writeModules(path string, expected, data []byte) error {
	fd, err := syscall.Open(path, syscall.O_RDWR|syscall.O_CREAT|syscall.O_APPEND|syscall.O_NOFOLLOW, 0644)
	if err != nil {
		return err
	}
	file := os.NewFile(uintptr(fd), path)
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || !rootOwned(info) || info.Mode()&0022 != 0 {
		return fmt.Errorf("unsafe modules file")
	}
	if err = syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return fmt.Errorf("modules file busy")
	}
	defer syscall.Flock(fd, syscall.LOCK_UN)
	info, err = file.Stat()
	if err != nil {
		return err
	}
	if info.Size() > 65536 {
		return fmt.Errorf("modules file too large")
	}
	current := make([]byte, info.Size())
	if len(current) > 0 {
		if _, err = file.ReadAt(current, 0); err != nil {
			return err
		}
	}
	if !bytes.Equal(current, expected) || !bytes.HasPrefix(data, expected) {
		return fmt.Errorf("modules file changed")
	}
	// Append only fixed missing module names; never truncate administrator data.
	if _, err = file.Write(data[len(expected):]); err != nil {
		return err
	}
	return file.Sync()
}
