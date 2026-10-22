//go:build !linux

package controllerconfig

func ObservePrepareConfig(directory string, encoded []byte, ctx Context) (Result, error) {
	return Result{}, failure("CONTROLLER_CONFIG_STATE_PLATFORM_UNSUPPORTED")
}
