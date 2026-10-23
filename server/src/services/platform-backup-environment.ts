import { parse as parseEnv } from 'dotenv'
import { normalizeOnboardingAddress } from '../lib/host-onboarding.js'
import { ensure, BackupError } from './platform-backup-core.js'

// Only reviewed identity material is restored; destination network/database/
// session settings remain authoritative on the replacement controller.
export function mergeBackupEnvironment(current: string, restored: string, gatewayConfig?: string, controllerPlatformId?: string): string {
  const old = parseEnv(restored), target = parseEnv(current)
  ensure(old.ENCRYPTION_KEY?.length >= 16, 'OSS_ARCHIVE_KEY_MISSING')
  target.ENCRYPTION_KEY = old.ENCRYPTION_KEY
  if (controllerPlatformId !== undefined) {
    ensure(old.GATEWAY_PLATFORM_ID === controllerPlatformId, 'OSS_CONTROLLER_PLATFORM_MISMATCH')
    target.GATEWAY_PLATFORM_ID = controllerPlatformId
  }
  if (gatewayConfig !== undefined) {
    ensure(['localhost', '127.0.0.1', '::1'].includes(target.ONBOARDING_GATEWAY_HOST || ''), 'OSS_GATEWAY_MAPPING_REQUIRED', 409)
    // The archived WireGuard identity includes its listen port. Preserve B's
    // host/domain but use that exact port, rather than B's fresh-install default.
    const interfaces = gatewayConfig.split(/(?=^\s*\[Peer\]\s*$)/m)[0]
    ensure(/^\s*\[Interface\]\s*$/m.test(interfaces) && !/^\s*\[Peer\]\s*$/m.test(interfaces), 'OSS_GATEWAY_CONFIG_UNSUPPORTED')
    const ports = [...interfaces.matchAll(/^\s*ListenPort\s*=\s*(\d+)\s*$/gm)]
    ensure(ports.length === 1 && Number(ports[0][1]) >= 1 && Number(ports[0][1]) <= 65535, 'OSS_GATEWAY_CONFIG_UNSUPPORTED')
    const endpoint = /^([^:]+):([0-9]{1,5})$/.exec(target.ONBOARDING_WG_ENDPOINT || '')
    ensure(endpoint && Number(endpoint[2]) >= 1 && Number(endpoint[2]) <= 65535, 'OSS_GATEWAY_MAPPING_REQUIRED', 409)
    let hostname: string
    try { hostname = normalizeOnboardingAddress(endpoint[1]) } catch { throw new BackupError('OSS_GATEWAY_MAPPING_REQUIRED', 409) }
    ensure(target.ONBOARDING_GATEWAY_FINGERPRINT && /^SHA256:[A-Za-z0-9+/]{43}$/.test(target.ONBOARDING_GATEWAY_FINGERPRINT), 'OSS_GATEWAY_MAPPING_REQUIRED', 409)
    target.ONBOARDING_WG_ENDPOINT = `${hostname}:${Number(ports[0][1])}`
  }
  for (const value of Object.values(target)) ensure(!/[\r\n\x00']/.test(value), 'OSS_ENV_FORMAT_UNSUPPORTED')
  return Object.entries(target).map(([key, value]) => { ensure(/^[A-Z][A-Z0-9_]*$/.test(key), 'OSS_ENV_FORMAT_UNSUPPORTED'); return `${key}='${value}'` }).join('\n') + '\n'
}
