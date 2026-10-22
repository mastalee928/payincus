//go:build !linux

package controllerconfig

import "context"

func ReadLocalProcessAudit(ctx context.Context) (ProcessAudit, error) {
	return ProcessAudit{}, failure("CONTROLLER_PROCESS_AUDIT_PLATFORM_UNSUPPORTED")
}
