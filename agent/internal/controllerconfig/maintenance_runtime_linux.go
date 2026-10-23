package controllerconfig

import (
	"os"
	"strings"
)

func readMaintenanceBootID() (string, error) {
	raw, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return "", err
	}
	id := strings.TrimSpace(string(raw))
	if !uuidPattern.MatchString(id) {
		return "", failure("CONTROLLER_RUNTIME_BOOT")
	}
	return id, nil
}
