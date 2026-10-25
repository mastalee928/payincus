import '../config/env.js'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, lstat, open, rename, type FileHandle } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { prisma, closePrismaDatabase } from '../db/prisma.js'
import { gatewayCredentialHash, decryptGatewayTaskSecret } from '../services/gateway-admin-authorization.js'
import { connectOnboardingSsh, sshExec } from '../services/onboarding-ssh.js'
import { SIMPLE_GATEWAY_ROOT, SIMPLE_GATEWAY_ADMIN_SELECT } from '../services/simple-gateway-setup.js'
import { localGatewaySetupId, LocalGatewaySetupError, validateSimpleGatewayRequest, simpleGatewayPlanHash, SIMPLE_GATEWAY_PLAN_TTL } from '../lib/local-gateway-setup.js'
import { recoveryHeld } from '../services/platform-backup-core.js'
import { loadStableGatewayEndpoint, saveStableGatewayEndpoint } from '../services/onboarding-gateway-endpoint.js'
import { queueHostGatewayDns } from '../services/host-gateway-dns.js'

const id = localGatewaySetupId(process.argv[2]), exec = promisify(execFile)
const requestPath = join(SIMPLE_GATEWAY_ROOT, 'inbox', id + '.json'), resultPath = join(SIMPLE_GATEWAY_ROOT, 'results', id + '.json')
let actorId = 0, step = 'connect', writing = false
let requestFile: FileHandle | undefined, keepSecret = false, verifiedRequestFile = false
async function state(status: string, errorCode: string | null = null, extra: object = {}) {
  const temporary = resultPath + '.tmp'
  await writeFile(temporary, JSON.stringify({ id, actorId, state: status, step, errorCode, updatedAt: new Date().toISOString(), ...extra }), { mode: 0o640, flag: 'wx' })
  await rename(temporary, resultPath)
}
async function observedStateHash() {
  const digest = createHash('sha256')
  for (const path of ['/etc/machine-id', '/opt/incudal/.env', '/etc/wireguard/incudal-mgmt.conf',
    '/root/.ssh/incudal-host-management', '/opt/incudal/server/certs/onboarding-gateway.key', '/var/lib/incudal-gateway-controller/enrollment.json']) {
    digest.update(path + '\n')
    try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022) || info.size > 4 * 1024 * 1024) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_INVALID'); digest.update(await readFile(path)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; digest.update('absent') }
  }
  return digest.digest('hex')
}
try {
  if (process.getuid?.() !== 0 || recoveryHeld()) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_RECOVERY_HELD')
  requestFile = await open(requestPath, constants.O_RDWR | constants.O_NOFOLLOW)
  const info = await requestFile.stat()
  const owner = Number((await exec('/usr/bin/id', ['-u', 'incudal'])).stdout.trim())
  if (!info.isFile() || info.nlink !== 1 || info.size > 10000 || info.uid !== owner || (info.mode & 0o777) !== 0o600) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_INVALID')
  verifiedRequestFile = true
  const request = validateSimpleGatewayRequest(JSON.parse(await requestFile.readFile('utf8')))
  actorId = request.actorId
  if (request.id !== id) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_INVALID')
  const user = await prisma.user.findUnique({ where: { id: actorId }, select: SIMPLE_GATEWAY_ADMIN_SELECT })
  if (!user || user.role !== 'admin' || user.status !== 'active' || gatewayCredentialHash(user) !== request.approvedCredentialHash) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_ADMIN_REQUIRED')
  const revoked = await prisma.tokenInvalidation.findFirst({ where: { userId: actorId, OR: [
    { sessionId: request.approvedSessionId }, { sessionId: { in: ['__USER_LEVEL__'] }, invalidatedAt: { gte: Math.floor(request.createdAt / 1000) } },
    { sessionId: null, invalidatedAt: { gte: Math.floor(request.createdAt / 1000) } }
  ] }, select: { id: true } })
  if (revoked) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_ADMIN_REQUIRED')
  const oldState = request.operation === 'apply' ? JSON.parse(await readFile(resultPath, 'utf8')) : null
  const observed = await observedStateHash()
  const planHash = simpleGatewayPlanHash(request, observed)
  if (request.operation === 'apply' && (oldState?.state !== 'awaiting_confirmation' || oldState.actorId !== actorId ||
    oldState.plan?.expiresAt <= Date.now() || oldState.plan?.planHash !== request.planHash || planHash !== request.planHash)) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_PLAN_EXPIRED')
  await state('running')
  const fingerprints = new Set<string>()
  for (const algorithm of ['ed25519', 'rsa', 'ecdsa']) {
    try {
      const hostKey = (await readFile(`/etc/ssh/ssh_host_${algorithm}_key.pub`, 'utf8')).trim().split(/\s+/)[1]
      fingerprints.add('SHA256:' + createHash('sha256').update(Buffer.from(hostKey, 'base64')).digest('base64').replace(/=+$/, ''))
    } catch {}
  }
  if (!fingerprints.size) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_HOST_IDENTITY_MISSING')
  const client = await connectOnboardingSsh({ host: request.sshAddress, port: Number(process.env.ONBOARDING_GATEWAY_PORT || 22), password: decryptGatewayTaskSecret(request.passwordEncrypted) }, async observed => fingerprints.has(observed))
  try {
    const remoteId = (await sshExec(client, 'cat /etc/machine-id')).trim()
    if (remoteId !== (await readFile('/etc/machine-id', 'utf8')).trim()) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_CURRENT_CONTROLLER_REQUIRED')
  } finally { client.end() }
  if (recoveryHeld()) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_RECOVERY_HELD')
  const app = process.env.INCUDAL_APP_DIR || '/opt/incudal'
  if (request.operation === 'prepare') {
    const preview = await exec('/usr/bin/python3', ['-I', '-B', join(app, 'scripts/setup-onboarding-control.py'), '--auto-network', '--plan-only', '--public-host', request.publicHost], { timeout: 30000, maxBuffer: 32768 })
    const plan = JSON.parse(preview.stdout)
    if (!Number.isSafeInteger(plan.hostCapacity) || plan.hostCapacity < 1000 || plan.identitiesPreserved !== true) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_CONFIGURE_FAILED')
    step = 'confirm'
    await state('awaiting_confirmation', null, { plan: { ...plan, sshAddress: request.sshAddress, planHash, expiresAt: request.createdAt + SIMPLE_GATEWAY_PLAN_TTL } })
    keepSecret = true
  } else {
  if (await observedStateHash() !== observed) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_PLAN_EXPIRED')
  step = 'configure'; writing = true; await state('running')
  try {
    await exec('/usr/bin/python3', ['-I', '-B', join(app, 'scripts/setup-onboarding-control.py'), '--auto-network', '--public-host', request.publicHost,
      '--ssh-port', String(Number(process.env.ONBOARDING_GATEWAY_PORT || 22))], { timeout: 180000, maxBuffer: 32768 })
  } catch (error) {
    const code = (error as { stdout?: string }).stdout?.match(/INCUDAL_ERROR:([A-Z_]+)/)?.[1]
    throw new LocalGatewaySetupError(code || 'SIMPLE_GATEWAY_CONFIGURE_FAILED')
  }
  const controller = '/var/lib/incudal-gateway-controller/enrollment.json'
  try { await lstat(controller) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await exec('/usr/bin/bash', [join(app, 'scripts/install-gateway-controller.sh'), '--initialize-release'], { timeout: 120000 })
  }
  step = 'verify'; await state('running')
  await exec('/usr/bin/systemctl', ['restart', 'incudal-backend'], { timeout: 120000 })
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    try { const response = await fetch('http://127.0.0.1:3001/api/health', { signal: AbortSignal.timeout(2000) }); const health = await response.json() as { status?: string; recoveryHeld?: boolean }; if (response.ok && health.status === 'ok' && health.recoveryHeld === false) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!ready) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_BACKEND_NOT_READY')
  const config = await readFile('/etc/wireguard/incudal-mgmt.conf', 'utf8'), port = Number(/ListenPort\s*=\s*(\d+)/.exec(config)?.[1])
  const domain = await loadStableGatewayEndpoint()
  if (domain) { await saveStableGatewayEndpoint({ hostname: domain.hostname, port }); await queueHostGatewayDns(actorId) }
  const prefix = Number(/Address\s*=\s*[^\r\n]+\/(\d+)/.exec(config)?.[1])
  step = 'complete'; await state('succeeded', null, { hostCapacity: 2 ** (32 - prefix) - 3 })
  }
} catch (error) {
  const code = (error as { code?: string }).code
  await state(writing ? 'needs_review' : 'failed', error instanceof LocalGatewaySetupError ? error.code : code?.startsWith('SSH_') ? code : 'SIMPLE_GATEWAY_FAILED').catch(() => {})
  process.exitCode = 1
} finally {
  if (requestFile) {
    if (verifiedRequestFile && !keepSecret) { try { await requestFile.truncate(0); await requestFile.write(JSON.stringify({ id, actorId, passwordEncrypted: null }), 0, 'utf8'); await requestFile.sync() } catch {} }
    await requestFile.close()
  }
  await closePrismaDatabase()
}
