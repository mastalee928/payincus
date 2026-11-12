//go:build !linux

package performance

import (
	"fmt"
	"os"
)

func rootOwned(info os.FileInfo) bool           { return false }
func writeModules(string, []byte, []byte) error { return fmt.Errorf("Linux required") }
