//go:build !linux

package controllerconfig

import "context"

type CredentialAudit struct {
	SSHAuthenticationDisabled bool `json:"sshAuthenticationDisabled"`
	IncusSocketRootOnly       bool `json:"incusSocketRootOnly"`
	Complete                  bool `json:"complete"`
}

func ReadLocalCredentialAudit(context.Context, string) (CredentialAudit, error) {
	return CredentialAudit{}, failure("CONTROLLER_CREDENTIAL_AUDIT_PLATFORM_UNSUPPORTED")
}
