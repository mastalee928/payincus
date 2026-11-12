//go:build !linux

package provisioning

import (
	"context"
	"fmt"
)

func repair(context.Context) error { return fmt.Errorf("Linux host required") }
