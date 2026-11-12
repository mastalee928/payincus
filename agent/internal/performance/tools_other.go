//go:build !linux

package performance

import (
	"context"
	"fmt"
	"os/exec"
)

func performanceLock(string) (func(), error)                { return nil, fmt.Errorf("Linux required") }
func runToolInstall(context.Context, *exec.Cmd) error       { return fmt.Errorf("Linux required") }
func hostSysctl(context.Context, ...string) ([]byte, error) { return nil, fmt.Errorf("Linux required") }
