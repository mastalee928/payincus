//go:build !linux

package controllerconfig

func readMaintenanceBootID() (string, error) {
	return "", failure("CONTROLLER_RUNTIME_PLATFORM_UNSUPPORTED")
}
