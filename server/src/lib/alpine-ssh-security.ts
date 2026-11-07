import { readFileSync } from 'node:fs'

/** Revisions containing Alpine's upstream 90f9c2f password-authentication fix.
 * aports main/openssh/pw.patch, corresponding stable branches. Backports retain
 * upstream version numbers, so the SSH banner is not a patch-status check.
 */
export const alpineSshSecurityScript = readFileSync(
  new URL('../../templates/alpine-ssh-security.sh', import.meta.url), 'utf8'
).replace(/\r\n/g, '\n')

/** Read through authenticated Incus before advertising customer password login. */
export const alpineSshSecurityInspection = `${alpineSshSecurityScript}
if [ -f /etc/alpine-release ]; then
  if alpine_ssh_assert_fixed && alpine_ssh_listener_current; then
    printf '%s\\n' 'INCUDAL_ALPINE_SSH_FIXED'
  else
    printf '%s\\n' 'INCUDAL_ALPINE_SSH_UNPATCHED'
  fi
else
  printf '%s\\n' 'INCUDAL_SSH_NOT_ALPINE'
fi`

/** Fixed read-only guest probe. A maintenance capability may execute these
 * exact bytes, never a caller supplied command or environment. */
export const alpineSshFingerprintInspectionCommand = `${alpineSshSecurityInspection}
for key in /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ecdsa_key.pub /etc/ssh/ssh_host_rsa_key.pub; do
  [ ! -f "$key" ] || ssh-keygen -lf "$key" -E sha256
done`

export function assertAlpineSshSecurityInspection(output: string): void {
  if (/^INCUDAL_ALPINE_SSH_UNPATCHED$/m.test(output)) throw new Error('ALPINE_SSH_PATCH_REQUIRED')
  const markers = output.match(/^INCUDAL_(?:ALPINE_SSH_FIXED|SSH_NOT_ALPINE)$/gm)
  if (markers?.length !== 1) throw new Error('ALPINE_SSH_INSPECTION_FAILED')
}
