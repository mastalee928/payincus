//go:build !linux

package controllerconfig

import "context"

func ApplyGatewayTransport(context.Context, []byte, Context, string, string, bool) error {
	return failure("GATEWAY_TRANSPORT_PLATFORM_UNSUPPORTED")
}
