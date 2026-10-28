//go:build !linux

package upgrade

import (
	"errors"
	"fmt"
	"os"
	"sync"
)

// Release artifacts target Linux. Preserve the conservative legacy behavior on
// other platforms for local tests; do not infer process liveness or remove an
// existing lock there.
func acquireLock(lockPath string) (func(), error) {
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return nil, ErrUpgradeInProgress
		}
		return nil, err
	}
	_, writeErr := fmt.Fprintf(file, "%d\n", os.Getpid())
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		_ = os.Remove(lockPath)
		if writeErr != nil {
			return nil, writeErr
		}
		return nil, closeErr
	}
	var once sync.Once
	return func() { once.Do(func() { _ = os.Remove(lockPath) }) }, nil
}
