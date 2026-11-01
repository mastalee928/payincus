//go:build !linux

package abuse

import (
	"context"
	"fmt"
	"os/exec"
)

func dependencyLock(string) (func(), error) {
	return nil, fmt.Errorf("dependency repair requires Linux")
}
func runDependencyProcess(context.Context, *exec.Cmd) error {
	return fmt.Errorf("dependency repair requires Linux")
}
