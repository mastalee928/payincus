//go:build !linux

package controllerconfig

import "context"

func ReadLocalWriterAudit(context.Context, WriterAuditPolicy) (LocalWriterAudit, error) {
	return LocalWriterAudit{}, failure("CONTROLLER_WRITER_AUDIT_PLATFORM_UNSUPPORTED")
}
