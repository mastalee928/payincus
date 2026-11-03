import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { prisma } from '../db/prisma.js'
import type { Prisma } from '@prisma/client'
import { authorizeUserWrite, type WriteActor } from '../db/user-write-authorization.js'
import { OnboardingError } from '../lib/host-onboarding.js'
import { connectOnboardingSsh, gatewayCommand, gatewayConfigured, sshExec, type OnboardingGateway } from './onboarding-ssh.js'

const local = () => ['127.0.0.1', 'localhost', '::1'].includes(process.env.ONBOARDING_GATEWAY_HOST || '')
export async function gatewayDnsChannelStatus() {
  const channelTarget = local() ? 'local' as const : 'remote' as const
  if (!gatewayConfigured()) return { needsChannelUpgrade: false, channelTarget, channelError: null }
  try {
    const status = await gatewayCommand()
    return { needsChannelUpgrade: status.dnsProtocolVersion !== 2, channelTarget, channelError: null }
  } catch (error) {
    return { needsChannelUpgrade: false, channelTarget, channelError: error instanceof OnboardingError ? error.code : 'GATEWAY_DNS_CHANNEL_CHECK_FAILED' }
  }
}
const identity = (gateway: OnboardingGateway) => ({ publicKey: gateway.publicKey, controlIp: gateway.controlIp,
  network: gateway.network, managementSshPublicKey: gateway.managementSshPublicKey })

export async function withGatewayDnsWriteAuthorization<T>(actor: WriteActor, apply: () => Promise<T>) {
  const authorize = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
    if (!await authorizeUserWrite(tx, actor.id, actor) ||
        (await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }))?.role !== 'admin') {
      throw new OnboardingError('GATEWAY_WEB_SESSION_REQUIRED')
    }
  }
  const audit = await prisma.$transaction(async tx => {
    await authorize(tx)
    return tx.log.create({ data: { userId: actor.id, module: 'host', action: 'gateway.dns.channel.updated', result: 'pending',
      content: 'Updating existing remote gateway DNS helpers while preserving original SSH and WireGuard identity' } })
  }, { maxWait: 2000, timeout: 5000 })
  try {
    // Keep the same account lock through the bounded fixed-helper write so
    // logout, session revocation and role changes serialize with this action.
    const result = await prisma.$transaction(async tx => {
      await authorize(tx)
      return apply()
    }, { maxWait: 2000, timeout: 55000 })
    await prisma.log.update({ where: { id: audit.id }, data: { result: 'success',
      content: 'Updated existing remote gateway DNS helpers; original SSH and WireGuard identity preserved' } })
    return result
  } catch (error) {
    // The durable pending row survives remote errors, lost receipts and DB
    // rollback. If final audit storage is unavailable it remains pending.
    await prisma.log.update({ where: { id: audit.id }, data: { result: 'failed',
      content: 'Gateway DNS helper update did not complete verification; recheck the pinned gateway before retrying' } }).catch(() => {})
    throw error
  }
}
export async function ensureGatewayDnsChannel(gateway: OnboardingGateway, password: string | undefined, actor: WriteActor) {
  if (gateway.dnsProtocolVersion === 2) return
  // The normal local installation hook refreshes these same three helpers.
  // Never ask for local SSH or credentials if a partial installation left old code.
  if (local()) throw new OnboardingError('GATEWAY_DNS_LOCAL_HELPER_OUTDATED')
  if (!password) throw new OnboardingError('GATEWAY_DNS_HELPER_UPGRADE_REQUIRED')
  if (password.length > 1024) throw new OnboardingError('GATEWAY_DNS_INVALID')
  await withGatewayDnsWriteAuthorization(actor, () => refreshPinnedGatewayHelpers(gateway, password))
  const current = await gatewayCommand()
  if (current.dnsProtocolVersion !== 2 || JSON.stringify(identity(current)) !== JSON.stringify(identity(gateway))) {
    throw new OnboardingError('GATEWAY_DNS_HOST_IDENTITY_CHANGED')
  }
}

// Callers supply their own current Web/recovery authorization before entering.
// Only fixed, packaged helpers are copied; pins, peers and keys remain intact.
export async function refreshPinnedGatewayHelpers(gateway: OnboardingGateway, password: string) {
  if (local()) throw new OnboardingError('GATEWAY_DNS_LOCAL_HELPER_OUTDATED')
  if (typeof password !== 'string' || !password || password.length > 1024) throw new OnboardingError('GATEWAY_DNS_HELPER_UPGRADE_REQUIRED')
  const sources: Record<string, string> = {}
  for (const name of ['onboarding-gateway.py', 'refresh-host-gateway-endpoint.py', 'install-host-gateway-dns.sh']) {
    const source = await readFile(fileURLToPath(new URL('../../../scripts/' + name, import.meta.url)))
    if (source.length > 131072 || source.length === 0) throw new OnboardingError('GATEWAY_DNS_UPGRADE_FAILED')
    sources[name] = source.toString('base64')
  }
  const executor = await readFile(fileURLToPath(new URL('../../../scripts/upgrade-onboarding-gateway.py', import.meta.url)), 'utf8')
  const payload = Buffer.from(JSON.stringify({ executor, request: { identity: identity(gateway), sources } })).toString('base64')
  const script = `import base64,json\nD=json.loads(base64.b64decode('${payload}'))\ntry:\n scope={'__name__':'gateway_dns_upgrade'};exec(compile(D['executor'],'upgrade-onboarding-gateway.py','exec'),scope)\n result=scope['upgrade'](D['request'])\n print(json.dumps(result,separators=(',',':')))\nexcept Exception as error:\n code=str(error)\n print('INCUDAL_ERROR:'+ (code if code.startswith('GATEWAY_DNS_') and code.replace('_','').isalpha() else 'GATEWAY_DNS_UPGRADE_FAILED'))\n raise SystemExit(1)\n`
  const client = await connectOnboardingSsh({ host: process.env.ONBOARDING_GATEWAY_HOST!, port: Number(process.env.ONBOARDING_GATEWAY_PORT || 22), password },
    async fingerprint => fingerprint === process.env.ONBOARDING_GATEWAY_FINGERPRINT)
  try {
      const result = JSON.parse(await sshExec(client, '/usr/bin/python3 -I -B -', script, 45000, 8192)) as Record<string, unknown>
      if (!result || Object.keys(result).sort().join(',') !== 'dnsProtocolVersion,keysAndRoutesPreserved' ||
          result.dnsProtocolVersion !== 2 || result.keysAndRoutesPreserved !== true) throw new OnboardingError('GATEWAY_DNS_UPGRADE_FAILED')
  } finally { client.end() }
}
