import { readFile, lstat } from 'node:fs/promises'
import { parse } from 'dotenv'
import { prisma } from '../db/prisma.js'
import { LocalGatewaySetupError } from '../lib/local-gateway-setup.js'

const configuredFields = ['ONBOARDING_GATEWAY_HOST', 'ONBOARDING_GATEWAY_KEY_PATH', 'ONBOARDING_GATEWAY_FINGERPRINT', 'ONBOARDING_WG_ENDPOINT'] as const
type Settings = Record<string, string | undefined>
export function configuredGatewayBlocker(settings: Settings): string | null {
  const host = settings.ONBOARDING_GATEWAY_HOST?.trim()
  if (host && !['127.0.0.1', 'localhost'].includes(host)) return 'SIMPLE_GATEWAY_MIGRATION_REQUIRED'
  return configuredFields.some(key => settings[key]?.trim()) ? 'SIMPLE_GATEWAY_ALREADY_CONFIGURED' : null
}

// Use persistent evidence, never reachability: an offline or partly configured
// gateway must not become eligible for first installation again. The worker calls
// this under the platform operation lock, before invoking any installer.
const installed = {
  settings: () => process.env as Settings,
  diskSettings: async (): Promise<Settings> => {
    try { return parse(await readFile('/opt/incudal/.env')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
  },
  identityExists: async () => {
    // A fresh panel already has controller enrollment. It is not proof that a
    // local gateway was installed. Only the root worker can inspect private WG
    // and management-key directories; the web backend uses its readable key.
    const paths = ['/opt/incudal/server/certs/onboarding-gateway.key',
      ...(process.getuid?.() === 0 ? ['/etc/wireguard/incudal-mgmt.conf', '/root/.ssh/incudal-host-management'] : [])]
    for (const path of paths) {
      try { await lstat(path); return true }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        // Lack of access is not evidence of a clean installation.
        if (code === 'EACCES' || code === 'EPERM') return true
        if (code !== 'ENOENT') throw error
      }
    }
    return false
  },
  registered: async () => !!(await prisma.systemConfig.findUnique({ where: { key: 'onboarding_gateway_dns_endpoint' }, select: { key: true } }) ||
    await prisma.hostOnboardingNode.findFirst({ where: { deletedAt: null, managementIp: { not: null } }, select: { id: true } })),
}
export async function simpleGatewaySetupBlocker(dependencies = installed): Promise<string | null> {
  const memory = configuredGatewayBlocker(dependencies.settings())
  if (memory) return memory
  const disk = configuredGatewayBlocker(await dependencies.diskSettings())
  if (disk) return disk
  if (await dependencies.registered() || await dependencies.identityExists()) return 'SIMPLE_GATEWAY_ALREADY_CONFIGURED'
  return null
}
export async function assertSimpleGatewayUnconfigured(dependencies = installed) {
  const code = await simpleGatewaySetupBlocker(dependencies)
  if (code) throw new LocalGatewaySetupError(code)
}
