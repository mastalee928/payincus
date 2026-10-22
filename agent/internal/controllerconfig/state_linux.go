package controllerconfig

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// ObservePrepareConfig records the highest verified candidate, not an active
// controller or write lease. Keep this root-private directory outside restores
// of historical platform snapshots so an old database cannot reset the watermark.
func ObservePrepareConfig(directory string, encoded []byte, ctx Context) (Result, error) {
	var empty Result
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		return empty, failure("CONTROLLER_CONFIG_STATE_INVALID")
	}
	current := string(filepath.Separator)
	for _, part := range splitPath(directory) {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return empty, failure("CONTROLLER_CONFIG_STATE_INVALID")
		}
		ancestor, ok := info.Sys().(*syscall.Stat_t)
		if !ok || (ancestor.Uid != 0 && int(ancestor.Uid) != os.Geteuid()) ||
			(info.Mode().Perm()&0022 != 0 && !(ancestor.Uid == 0 && info.Mode()&os.ModeSticky != 0)) {
			return empty, failure("CONTROLLER_CONFIG_STATE_INVALID")
		}
	}
	info, err := os.Lstat(directory)
	if err != nil || info.Mode().Perm() != 0700 {
		return empty, failure("CONTROLLER_CONFIG_STATE_INVALID")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(stat.Uid) != os.Geteuid() {
		return empty, failure("CONTROLLER_CONFIG_STATE_INVALID")
	}
	lock, err := openStateFile(filepath.Join(directory, "observe.lock"), syscall.O_CREAT|syscall.O_RDWR)
	if err != nil {
		return empty, err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return empty, failure("CONTROLLER_CONFIG_STATE_IO")
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	statePath := filepath.Join(directory, "observed.json")
	file, err := openStateFile(statePath, syscall.O_RDONLY)
	ctx.Previous = nil
	if err == nil {
		raw, readErr := io.ReadAll(io.LimitReader(file, 2049))
		file.Close()
		if readErr != nil || len(raw) > 2048 {
			return empty, failure("CONTROLLER_CONFIG_STATE_INVALID")
		}
		var state ObservedState
		if err = decodeStrict(raw, &state); err != nil {
			return empty, failure("CONTROLLER_CONFIG_STATE_INVALID")
		}
		ctx.Previous = &state
	} else if !os.IsNotExist(err) {
		return empty, err
	}
	result, err := VerifyPrepareConfig(encoded, ctx)
	if err != nil {
		return empty, err
	}
	if result.Duplicate {
		return result, nil
	}
	raw, err := canonical(result.Observed)
	if err != nil {
		return empty, failure("CONTROLLER_CONFIG_STATE_IO")
	}
	temp, err := os.CreateTemp(directory, ".observed-")
	if err != nil {
		return empty, failure("CONTROLLER_CONFIG_STATE_IO")
	}
	name := temp.Name()
	defer os.Remove(name)
	if _, err = temp.Write(raw); err == nil {
		err = temp.Sync()
	}
	closeErr := temp.Close()
	if err != nil || closeErr != nil {
		return empty, failure("CONTROLLER_CONFIG_STATE_IO")
	}
	if err = os.Rename(name, statePath); err != nil {
		return empty, failure("CONTROLLER_CONFIG_STATE_IO")
	}
	parent, err := os.Open(directory)
	if err != nil {
		return empty, failure("CONTROLLER_CONFIG_STATE_IO")
	}
	err = parent.Sync()
	parent.Close()
	if err != nil {
		return empty, failure("CONTROLLER_CONFIG_STATE_IO")
	}
	return result, nil
}

func splitPath(directory string) []string {
	return strings.Split(strings.TrimPrefix(directory, string(filepath.Separator)), string(filepath.Separator))
}

func openStateFile(path string, flags int) (*os.File, error) {
	fd, err := syscall.Open(path, flags|syscall.O_NOFOLLOW|syscall.O_CLOEXEC|syscall.O_NONBLOCK, 0600)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, err
		}
		return nil, failure("CONTROLLER_CONFIG_STATE_INVALID")
	}
	file := os.NewFile(uintptr(fd), path)
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
		file.Close()
		return nil, failure("CONTROLLER_CONFIG_STATE_INVALID")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(stat.Uid) != os.Geteuid() || stat.Nlink != 1 {
		file.Close()
		return nil, failure("CONTROLLER_CONFIG_STATE_INVALID")
	}
	return file, nil
}
