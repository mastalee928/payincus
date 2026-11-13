//go:build !linux

package provisioning

import (
	"context"
	"fmt"
)

func repair(context.Context) error                                      { return fmt.Errorf("Linux host required") }
func ensureResourceVisibility(context.Context) error                    { return fmt.Errorf("Linux host required") }
func repairGuestVisibility(context.Context, []Guest) error              { return fmt.Errorf("Linux host required") }
func ResourceMountHelper() (bool, error)                                { return false, nil }
func incusCompatibilityStatus(context.Context) (string, string, string) { return "", "", "" }
func prepareIncusCompatibility(context.Context, *CompatPermit) error    { return nil }
func validCompatPermit(*CompatPermit) bool                              { return false }
