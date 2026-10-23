package controllerconfig

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

type CredentialAudit struct {
	SSHAuthenticationDisabled bool `json:"sshAuthenticationDisabled"`
	IncusSocketRootOnly       bool `json:"incusSocketRootOnly"`
	Complete                  bool `json:"complete"`
}

// ReadLocalCredentialAudit requires the effective SSH authentication to be
// disabled, not only removal of one known key. Existing sessions/jobs are
// independently rejected by the writer/process audit. The local Incus socket
// must be root-only; remote mTLS remains blocked by the preparation TCP fence.
func ReadLocalCredentialAudit(ctx context.Context, socketPath string) (CredentialAudit, error) {
	result := CredentialAudit{}
	if os.Geteuid() != 0 || !filepath.IsAbs(socketPath) || filepath.Clean(socketPath) != socketPath {
		return result, failure("CONTROLLER_CREDENTIAL_AUDIT_PERMISSION")
	}
	raw, err := channelCommand(ctx, "/usr/sbin/sshd", []string{"-T"}, "")
	if err != nil {
		return result, err
	}
	result.SSHAuthenticationDisabled, err = sshAuthenticationDisabled(raw)
	if err != nil {
		return result, err
	}
	// Match blocks can override the base -T output. Require all root-owned SSH
	// source files to contain no Match directives; included files are enumerated.
	paths := []string{"/etc/ssh/sshd_config"}
	entries, err := os.ReadDir("/etc/ssh/sshd_config.d")
	if err != nil {
		return result, err
	}
	if len(entries) > 64 {
		return result, failure("CONTROLLER_CREDENTIAL_AUDIT_CONFIG")
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".conf") {
			paths = append(paths, filepath.Join("/etc/ssh/sshd_config.d", entry.Name()))
		}
	}
	for _, path := range paths {
		if _, err := writerFileHash(ctx, path, 1048576); err != nil {
			return result, err
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return result, err
		}
		for _, line := range strings.Split(string(raw), "\n") {
			line = strings.TrimSpace(strings.SplitN(line, "#", 2)[0])
			parts := strings.Fields(line)
			if len(parts) == 0 {
				continue
			}
			if strings.EqualFold(parts[0], "Match") {
				result.SSHAuthenticationDisabled = false
			}
			if strings.EqualFold(parts[0], "Include") && line != "Include /etc/ssh/sshd_config.d/*.conf" {
				return result, failure("CONTROLLER_CREDENTIAL_AUDIT_CONFIG")
			}
		}
	}
	if validateIncusQuiescenceSocket(socketPath) != nil {
		return result, failure("CONTROLLER_CREDENTIAL_AUDIT_SOCKET")
	}
	info, err := os.Lstat(socketPath)
	if err != nil {
		return result, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	result.IncusSocketRootOnly = ok && stat.Uid == 0 && stat.Gid == 0 && info.Mode().Perm() == 0600
	result.Complete = result.SSHAuthenticationDisabled && result.IncusSocketRootOnly
	return result, nil
}

func sshAuthenticationDisabled(raw string) (bool, error) {
	required := map[string]string{"pubkeyauthentication": "no", "passwordauthentication": "no", "kbdinteractiveauthentication": "no", "gssapiauthentication": "no", "hostbasedauthentication": "no", "permitrootlogin": "no", "usepam": "no"}
	fields := map[string]string{}
	for _, line := range strings.Split(raw, "\n") {
		pair := strings.SplitN(line, " ", 2)
		if len(pair) != 2 {
			continue
		}
		if _, securityField := required[pair[0]]; !securityField {
			continue
		}
		if _, exists := fields[pair[0]]; exists {
			return false, failure("CONTROLLER_CREDENTIAL_AUDIT_CONFIG")
		}
		fields[pair[0]] = strings.TrimSpace(pair[1])
	}
	for name, value := range required {
		if fields[name] != value {
			return false, nil
		}
	}
	return true, nil
}
