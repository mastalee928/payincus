//go:build !linux

package controllerconfig

import "context"

func ApplyManagementChannels(context.Context, []byte, Context, string, []ChannelLocalIdentity) ([]ChannelApplyResult, error) {
	return nil, failure("CONTROLLER_CHANNELS_PLATFORM_UNSUPPORTED")
}
func RestoreManagementChannels(context.Context, Context, string, []ChannelLocalIdentity) ([]ChannelApplyResult, error) {
	return nil, failure("CONTROLLER_CHANNELS_PLATFORM_UNSUPPORTED")
}
func ReadProtectedChannelFile(string, int) ([]byte, error) {
	return nil, failure("CONTROLLER_CHANNELS_PLATFORM_UNSUPPORTED")
}
func ReadProtectedGatewayFile(string) ([]byte, error) {
	return nil, failure("CONTROLLER_CHANNELS_PLATFORM_UNSUPPORTED")
}
func LockChannelService(string) (func(), error) {
	return nil, failure("CONTROLLER_CHANNELS_PLATFORM_UNSUPPORTED")
}
