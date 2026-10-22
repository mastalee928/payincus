package controllerconfig

import (
	"io"
	"os"
	"path/filepath"
	"syscall"
)

func lockNetworkFenceState(directory string) (ObservedState, func(), error) {
	empty := ObservedState{}
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		return empty, nil, failure("CONTROLLER_NETWORK_FENCE_PERMISSION")
	}
	current := directory
	for {
		info, err := os.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return empty, nil, failure("CONTROLLER_NETWORK_FENCE_PERMISSION")
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 || info.Mode().Perm()&0022 != 0 {
			return empty, nil, failure("CONTROLLER_NETWORK_FENCE_PERMISSION")
		}
		if current == directory && info.Mode().Perm() != 0700 {
			return empty, nil, failure("CONTROLLER_NETWORK_FENCE_PERMISSION")
		}
		parent := filepath.Dir(current)
		if current == parent {
			break
		}
		current = parent
	}
	lock, err := openStateFile(filepath.Join(directory, "network-fence.lock"), syscall.O_CREAT|syscall.O_RDWR)
	if err != nil {
		return empty, nil, err
	}
	if syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		lock.Close()
		return empty, nil, failure("CONTROLLER_NETWORK_FENCE_BUSY")
	}
	releaseFence := func() { syscall.Flock(int(lock.Fd()), syscall.LOCK_UN); lock.Close() }
	// Use the same lock as ObservePrepareConfig and keep it until nft verification
	// ends. A concurrent higher observation cannot race an older preparation.
	observe, err := openStateFile(filepath.Join(directory, "observe.lock"), syscall.O_CREAT|syscall.O_RDWR)
	if err != nil {
		releaseFence()
		return empty, nil, err
	}
	if syscall.Flock(int(observe.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		observe.Close()
		releaseFence()
		return empty, nil, failure("CONTROLLER_NETWORK_FENCE_BUSY")
	}
	release := func() {
		syscall.Flock(int(observe.Fd()), syscall.LOCK_UN)
		observe.Close()
		releaseFence()
	}
	file, err := openStateFile(filepath.Join(directory, "observed.json"), syscall.O_RDONLY)
	if err != nil {
		release()
		return empty, nil, failure("CONTROLLER_NETWORK_FENCE_STATE_REQUIRED")
	}
	raw, err := io.ReadAll(io.LimitReader(file, 2049))
	file.Close()
	var state ObservedState
	if err != nil || len(raw) > 2048 || decodeStrict(raw, &state) != nil {
		release()
		return empty, nil, failure("CONTROLLER_NETWORK_FENCE_STATE_REQUIRED")
	}
	return state, release, nil
}
func validateNetworkFenceRuntime() error {
	if os.Geteuid() != 0 {
		return failure("CONTROLLER_NETWORK_FENCE_PERMISSION")
	}
	info, err := os.Lstat("/usr/sbin/nft")
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0022 != 0 {
		return failure("CONTROLLER_NETWORK_FENCE_PERMISSION")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != 0 {
		return failure("CONTROLLER_NETWORK_FENCE_PERMISSION")
	}
	return nil
}

func saveNetworkFenceRecord(directory string, candidate, permit []byte, ports ManagementFencePorts) error {
	// Never replace an unsafe planted record, even though rename itself does
	// not follow a link. A prior persisted authorization must remain private.
	existing, err := openStateFile(filepath.Join(directory, "network-fence.json"), syscall.O_RDONLY)
	if err == nil {
		existing.Close()
	} else if !os.IsNotExist(err) {
		return err
	}
	raw, err := canonical(networkFenceRecord{1, string(candidate), string(permit), ports})
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(directory, ".network-fence-")
	if err != nil {
		return failure("CONTROLLER_NETWORK_FENCE_IO")
	}
	name := file.Name()
	defer os.Remove(name)
	if _, err = file.Write(raw); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		return failure("CONTROLLER_NETWORK_FENCE_IO")
	}
	if err = os.Rename(name, filepath.Join(directory, "network-fence.json")); err != nil {
		return failure("CONTROLLER_NETWORK_FENCE_IO")
	}
	parent, err := os.Open(directory)
	if err != nil {
		return failure("CONTROLLER_NETWORK_FENCE_IO")
	}
	defer parent.Close()
	if parent.Sync() != nil {
		return failure("CONTROLLER_NETWORK_FENCE_IO")
	}
	return nil
}

func readNetworkFenceRecord(directory string) (networkFenceRecord, error) {
	var result networkFenceRecord
	file, err := openStateFile(filepath.Join(directory, "network-fence.json"), syscall.O_RDONLY)
	if err != nil {
		return result, err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, 22001))
	if err != nil || len(raw) > 22000 || ValidateProtocolJSON(raw, 22000) != nil || decodeStrict(raw, &result) != nil {
		return result, failure("CONTROLLER_NETWORK_FENCE_STATE_REQUIRED")
	}
	return result, nil
}
