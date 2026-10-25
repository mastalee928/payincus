import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '../db/prisma.js'
import { gatewayCredentialHash, gatewayCredentialSelect, encryptGatewayTaskSecret } from './gateway-admin-authorization.js'
import { loadStableGatewayEndpoint } from './onboarding-gateway-endpoint.js'
import { recoveryHeld } from './platform-backup-core.js'
import { normalizeOnboardingAddress, OnboardingError } from '../lib/host-onboarding.js'
import { gatewayConfigured, gatewayCommand } from './onboarding-ssh.js'
import { LocalGatewaySetupError, localGatewaySetupId, validateSimpleGatewayRequest } from '../lib/local-gateway-setup.js'

export const SIMPLE_GATEWAY_ROOT = '/var/lib/incudal-local-gateway'
export const SIMPLE_GATEWAY_ADMIN_SELECT = { ...gatewayCredentialSelect, username: true } as const
const exec = promisify(execFile)
const latestKey = (actor: number) => 'onboarding_gateway_setup_latest_' + actor
export interface SimpleGatewayInput { requestId: string; sshAddress: string; password: string }
export function simpleGatewayExecutorAvailable() { return existsSync('/etc/systemd/system/incudal-local-gateway@.service') }
export async function simpleGatewayStatus() {
  if (!gatewayConfigured()) return { ready: false, code: 'GATEWAY_NOT_CONFIGURED' }
  try {
    const gateway = await gatewayCommand()
    return { ready: true, gateway: { controlIp: gateway.controlIp, network: gateway.network, sshHost: gateway.sshHost } }
  } catch (error) { return { ready: false, code: error instanceof OnboardingError ? error.code : 'GATEWAY_UNREACHABLE' } }
}
export async function requestSimpleGatewaySetup(input: SimpleGatewayInput, actorId: number, sessionId: string) {
  const id = localGatewaySetupId(input.requestId)
  const user = await prisma.user.findUnique({ where: { id: actorId }, select: SIMPLE_GATEWAY_ADMIN_SELECT })
  if (!user || user.role !== 'admin' || user.status !== 'active') throw new LocalGatewaySetupError('SIMPLE_GATEWAY_ADMIN_REQUIRED')
  if (!sessionId || recoveryHeld()) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_RECOVERY_HELD')
  if (!simpleGatewayExecutorAvailable()) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_EXECUTOR_UNAVAILABLE')
  if (typeof input.password !== 'string' || !input.password || Buffer.byteLength(input.password) > 1024) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_CREDENTIAL_REQUIRED')
  let sshAddress: string
  try { sshAddress = normalizeOnboardingAddress(input.sshAddress) } catch { throw new LocalGatewaySetupError('SIMPLE_GATEWAY_ADDRESS_INVALID') }
  const domain = await loadStableGatewayEndpoint()
  const request = { schemaVersion: 1, operation: 'prepare', id, actorId, createdAt: Date.now(), sshAddress, publicHost: domain?.hostname || sshAddress,
    approvedCredentialHash: gatewayCredentialHash(user), approvedSessionId: sessionId, passwordEncrypted: encryptGatewayTaskSecret(input.password) }
  const path = join(SIMPLE_GATEWAY_ROOT, 'inbox', id + '.json')
  if (existsSync(path)) {
    const saved = JSON.parse(await readFile(path, 'utf8'))
    if (saved.actorId !== actorId || saved.sshAddress !== sshAddress || saved.approvedSessionId !== sessionId) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_REQUEST_CONFLICT')
    return readSimpleGatewaySetup(id)
  }
  await mkdir(join(SIMPLE_GATEWAY_ROOT, 'inbox'), { recursive: true, mode: 0o700 })
  await writeFile(path, JSON.stringify(request), { mode: 0o600, flag: 'wx' })
  await prisma.systemConfig.upsert({ where: { key: latestKey(actorId) }, create: { key: latestKey(actorId), value: id }, update: { value: id } })
  try {
    await exec('/usr/bin/sudo', ['-n', '/usr/local/libexec/incudal/systemctl', 'start', '--no-block', `incudal-local-gateway@${id}.service`], { timeout: 10000 })
  } catch {
    await writeFile(path, JSON.stringify({ ...request, passwordEncrypted: null }), { mode: 0o600 })
    throw new LocalGatewaySetupError('SIMPLE_GATEWAY_EXECUTOR_UNAVAILABLE')
  }
  return { id, actorId, state: 'queued', step: 'connect', errorCode: null, updatedAt: new Date().toISOString() }
}
export async function confirmSimpleGatewaySetup(input: string, planHash: string, actorId: number, sessionId: string) {
  const id = localGatewaySetupId(input), state = await readSimpleGatewaySetup(id)
  if (recoveryHeld()) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_RECOVERY_HELD')
  if (state.actorId !== actorId || state.state !== 'awaiting_confirmation' || state.plan?.planHash !== planHash || state.plan.expiresAt <= Date.now()) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_PLAN_EXPIRED')
  const path = join(SIMPLE_GATEWAY_ROOT, 'inbox', id + '.json')
  const request = validateSimpleGatewayRequest(JSON.parse(await readFile(path, 'utf8')))
  if (request.actorId !== actorId || request.approvedSessionId !== sessionId) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_ADMIN_REQUIRED')
  const user = await prisma.user.findUnique({ where: { id: actorId }, select: SIMPLE_GATEWAY_ADMIN_SELECT })
  if (!user || user.role !== 'admin' || user.status !== 'active' || gatewayCredentialHash(user) !== request.approvedCredentialHash) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_ADMIN_REQUIRED')
  const temporary = path + '.apply'
  await writeFile(temporary, JSON.stringify({ ...request, operation: 'apply', planHash }), { flag: 'wx', mode: 0o600 })
  await rename(temporary, path)
  try { await exec('/usr/bin/sudo', ['-n', '/usr/local/libexec/incudal/systemctl', 'start', '--no-block', `incudal-local-gateway@${id}.service`], { timeout: 10000 }) }
  catch { await writeFile(path, JSON.stringify({ ...request, passwordEncrypted: null }), { mode: 0o600 }); throw new LocalGatewaySetupError('SIMPLE_GATEWAY_EXECUTOR_UNAVAILABLE') }
  return { id, actorId, state: 'queued', step: 'configure', errorCode: null, updatedAt: new Date().toISOString() }
}
export async function readSimpleGatewaySetup(input: string) {
  const id = localGatewaySetupId(input)
  try {
    const state = JSON.parse(await readFile(join(SIMPLE_GATEWAY_ROOT, 'results', id + '.json'), 'utf8'))
    if (state.state === 'awaiting_confirmation') {
      const request = JSON.parse(await readFile(join(SIMPLE_GATEWAY_ROOT, 'inbox', id + '.json'), 'utf8'))
      if (request.operation === 'apply') {
        const service = await exec('/usr/bin/systemctl', ['show', `incudal-local-gateway@${id}.service`, '--property=ActiveState', '--value'], { timeout: 5000 })
        const active = ['active', 'activating', 'reloading'].includes(service.stdout.trim())
        return { ...state, plan: undefined, state: active ? 'queued' : 'failed', step: 'configure', errorCode: active ? null : 'SIMPLE_GATEWAY_EXECUTOR_UNAVAILABLE' }
      }
    }
    if (state.state === 'running' && Date.now() - Date.parse(state.updatedAt) > 10000) {
      const service = await exec('/usr/bin/systemctl', ['show', `incudal-local-gateway@${id}.service`, '--property=ActiveState', '--value'], { timeout: 5000 })
      if (!['active', 'activating', 'reloading'].includes(service.stdout.trim())) return { ...state,
        state: state.step === 'connect' ? 'failed' : 'needs_review', errorCode: 'SIMPLE_GATEWAY_INTERRUPTED' }
    }
    if (state.state === 'awaiting_confirmation' && state.plan?.expiresAt <= Date.now()) {
      const path = join(SIMPLE_GATEWAY_ROOT, 'inbox', id + '.json')
      const request = JSON.parse(await readFile(path, 'utf8'))
      await writeFile(path, JSON.stringify({ ...request, passwordEncrypted: null }), { mode: 0o600 })
      return { ...state, state: 'failed', errorCode: 'SIMPLE_GATEWAY_PLAN_EXPIRED', plan: undefined }
    }
    return state
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const request = JSON.parse(await readFile(join(SIMPLE_GATEWAY_ROOT, 'inbox', id + '.json'), 'utf8'))
    const service = await exec('/usr/bin/systemctl', ['show', `incudal-local-gateway@${id}.service`, '--property=ActiveState', '--value'], { timeout: 5000 })
    const unitRunning = ['active', 'activating', 'reloading'].includes(service.stdout.trim())
    const expired = !unitRunning && Date.now() - request.createdAt > 30000
    if (expired && request.passwordEncrypted) await writeFile(join(SIMPLE_GATEWAY_ROOT, 'inbox', id + '.json'), JSON.stringify({ ...request, passwordEncrypted: null }), { mode: 0o600 })
    return { id, actorId: request.actorId, state: expired ? 'failed' : 'queued', step: 'connect', errorCode: expired ? 'SIMPLE_GATEWAY_EXECUTOR_UNAVAILABLE' : null, updatedAt: new Date(request.createdAt).toISOString() }
  }
}
export async function latestSimpleGatewaySetup(actorId: number) {
  const saved = await prisma.systemConfig.findUnique({ where: { key: latestKey(actorId) }, select: { value: true } })
  if (!saved) return null
  try { const state = await readSimpleGatewaySetup(saved.value); return state.actorId === actorId ? state : null } catch { return null }
}
