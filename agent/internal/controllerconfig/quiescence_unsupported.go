//go:build !linux

package controllerconfig

func validateIncusQuiescenceSocket(path string) error {
	return failure("CONTROLLER_QUIESCENCE_PLATFORM_UNSUPPORTED")
}
