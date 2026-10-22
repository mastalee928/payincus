//go:build !linux

package controllerconfig

func validateNetworkFenceRuntime() error {
	return failure("CONTROLLER_NETWORK_FENCE_PLATFORM_UNSUPPORTED")
}
func lockNetworkFenceState(directory string) (ObservedState, func(), error) {
	return ObservedState{}, nil, failure("CONTROLLER_NETWORK_FENCE_PLATFORM_UNSUPPORTED")
}
func saveNetworkFenceRecord(directory string, candidate, permit []byte, ports ManagementFencePorts) error {
	return failure("CONTROLLER_NETWORK_FENCE_PLATFORM_UNSUPPORTED")
}
func readNetworkFenceRecord(directory string) (networkFenceRecord, error) {
	return networkFenceRecord{}, failure("CONTROLLER_NETWORK_FENCE_PLATFORM_UNSUPPORTED")
}
