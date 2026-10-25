import { prisma } from '../db/prisma.js'
import { OnboardingError } from '../lib/host-onboarding.js'
import { recoveryHeld } from './platform-backup-core.js'
import { loadStableGatewayEndpoint } from './onboarding-gateway-endpoint.js'
import { installGatewayHostDns, gatewayConfigured } from './onboarding-ssh.js'
import { gatewayDnsRetry, resumeGatewayDnsState, type GatewayDnsQueueState } from '../lib/gateway-dns-queue.js'

const active = new Set<string>()
let dispatching = false
const statusKey = (id: string) => 'onboarding_gateway_dns_host_' + id
const recordStatus = (id: string, value: object) => prisma.systemConfig.upsert({ where: { key: statusKey(id) },
  create: { key: statusKey(id), value: JSON.stringify(value), type: 'json' }, update: { value: JSON.stringify(value) } })
export async function listHostGatewayDns(nodeId?: string) {
  const nodes = await prisma.hostOnboardingNode.findMany({ where: { deletedAt: null, hostId: { not: null }, ...(nodeId ? { id: nodeId } : {}) },
    select: { id: true, name: true, managementIp: true, sshPort: true, sshFingerprint: true, nodePublicKey: true, status: true,
      host: { select: { managementSshHost: true, managementSshPort: true } } }, orderBy: { createdAt: 'asc' } })
  const records = await prisma.systemConfig.findMany({ where: { key: { in: nodes.map(node => statusKey(node.id)) } }, select: { key: true, value: true, updatedAt: true } })
  const endpoint = await loadStableGatewayEndpoint()
  const indexed = new Map(records.map(record => [record.key, record]))
  return nodes.map(node => {
    const stored = indexed.get(statusKey(node.id))
    let state: GatewayDnsQueueState & { endpoint?: string; nodePublicKey?: string; sshFingerprint?: string; managementIp?: string } = {}
    try { state = stored ? JSON.parse(stored.value) : {} } catch {}
    return { id: node.id, name: node.name, managementIp: node.managementIp,
      eligible: node.status === 'succeeded' && !!node.managementIp && !!node.sshFingerprint && !!node.nodePublicKey &&
        node.host?.managementSshHost === node.managementIp && node.host.managementSshPort === node.sshPort,
      running: active.has(node.id), state: active.has(node.id) ? 'running' : state.state || (state.installed ? 'succeeded' : state.code ? 'failed' : 'not_started'),
      step: state.step || 'connect', attempt: state.attempt || 0, installed: state.installed === true && !!endpoint && state.endpoint === `${endpoint.hostname}:${endpoint.port}` &&
        state.nodePublicKey === node.nodePublicKey && state.sshFingerprint === node.sshFingerprint && state.managementIp === node.managementIp, endpoint: state.endpoint || null,
      error: state.code || null, updatedAt: stored?.updatedAt.toISOString() || null }
  })
}
export async function installHostGatewayDns(nodeId: string, actor: number, deploy = installGatewayHostDns) {
  if (active.has(nodeId)) throw new OnboardingError('GATEWAY_DNS_HOST_BUSY')
  active.add(nodeId)
  let recordedFailure = false
  let attempts = 0
  const record = (value: object) => recordStatus(nodeId, { attempt: attempts + 1, ...value })
  const recordFailure = async (code: string, step: string) => {
    const retryAt = gatewayDnsRetry(code, attempts + 1)
    await record({ installed: false, state: retryAt === null ? 'failed' : 'queued', step, code, actor, retryAt })
  }
  try {
    const previous = await prisma.systemConfig.findUnique({ where: { key: statusKey(nodeId) }, select: { value: true } })
    try { attempts = Number(JSON.parse(previous?.value || '{}').attempt) || 0 } catch {}
    const administrator = await prisma.user.findUnique({ where: { id: actor }, select: { role: true, status: true } })
    if (administrator?.role !== 'admin' || administrator.status !== 'active') throw new OnboardingError('GATEWAY_DNS_ADMIN_REQUIRED')
    const endpoint = await loadStableGatewayEndpoint()
    if (!endpoint || recoveryHeld()) throw new OnboardingError('GATEWAY_DNS_NOT_READY')
    const node = await prisma.hostOnboardingNode.findUnique({ where: { id: nodeId }, include: { host: true } })
    if (!node || node.deletedAt || node.status !== 'succeeded' || !node.host || !node.managementIp || !node.sshFingerprint || !node.nodePublicKey ||
        node.host.managementSshHost !== node.managementIp || node.host.managementSshPort !== node.sshPort) throw new OnboardingError('GATEWAY_DNS_MANAGEMENT_REQUIRED')
    const busy = await prisma.instanceTask.count({ where: { hostId: node.host.id, status: { in: ['PENDING', 'PROCESSING'] } } }) ||
      await prisma.restoreTask.count({ where: { hostId: node.host.id, status: { in: ['PENDING', 'PROCESSING'] } } })
    if (busy) throw new OnboardingError('GATEWAY_DNS_HOST_BUSY')
    await record({ installed: false, state: 'running', step: 'connect', code: null, actor })
    try {
      if (recoveryHeld()) throw new OnboardingError('GATEWAY_RECOVERY_HELD')
      const result = await deploy(nodeId, { ...endpoint, sshPort: node.sshPort, sshFingerprint: node.sshFingerprint, nodePublicKey: node.nodePublicKey })
      await record({ installed: true, state: 'succeeded', step: 'complete', endpoint: result.endpoint, actor, nodePublicKey: node.nodePublicKey, sshFingerprint: node.sshFingerprint, managementIp: node.managementIp })
      return result
    } catch (error) {
      const code = error instanceof OnboardingError ? error.code : 'GATEWAY_DNS_INSTALL_FAILED'
      await recordFailure(code, code.includes('UNREACHABLE') || code.includes('CONNECT') || code.includes('IDENTITY') ? 'connect' : 'install')
      recordedFailure = true
      throw new OnboardingError(code)
    }
  } catch (error) {
    if (!recordedFailure) await recordFailure(error instanceof OnboardingError ? error.code : 'GATEWAY_DNS_INSTALL_FAILED', 'connect')
    throw error
  } finally { active.delete(nodeId) }
}

export async function queueHostGatewayDns(actor: number, nodeId?: string, onlyFailed = false) {
  if (recoveryHeld()) throw new OnboardingError('GATEWAY_RECOVERY_HELD')
  if (!await loadStableGatewayEndpoint()) throw new OnboardingError('GATEWAY_DNS_NOT_READY')
  const nodes = await listHostGatewayDns(nodeId)
  const selected = nodes.filter(node => (!nodeId || node.id === nodeId) && node.eligible && !node.installed && !node.running && !['queued', 'running'].includes(node.state) && (!onlyFailed || node.state === 'failed'))
  if (nodeId && !nodes.find(node => node.id === nodeId)?.eligible) {
    await recordStatus(nodeId, { installed: false, state: 'failed', step: 'connect', code: 'GATEWAY_DNS_MANAGEMENT_REQUIRED', actor })
    throw new OnboardingError('GATEWAY_DNS_MANAGEMENT_REQUIRED')
  }
  for (let offset = 0; offset < selected.length; offset += 40) {
    await prisma.$transaction(selected.slice(offset, offset + 40).map(node => recordStatus(node.id, { installed: false, state: 'queued', step: 'connect', code: null, actor, attempt: 0 })))
  }
  return { queued: selected.length }
}

export async function dispatchHostGatewayDns(deploy = installGatewayHostDns) {
  if (dispatching || recoveryHeld() || !gatewayConfigured()) return
  dispatching = true
  try {
    const rows = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'onboarding_gateway_dns_host_' } }, select: { key: true, value: true } })
    const pending: { id: string; actor: number }[] = []
    for (const row of rows) {
      let stored: GatewayDnsQueueState
      try { stored = JSON.parse(row.value) } catch { continue }
      const id = row.key.slice('onboarding_gateway_dns_host_'.length)
      const state = resumeGatewayDnsState(stored, active.has(id))
      if (state !== stored) await recordStatus(id, state)
      if (pending.length < 4 && state.state === 'queued' && !active.has(id) &&
        (!state.retryAt || state.retryAt <= Date.now()) && Number.isSafeInteger(state.actor) && Number(state.actor) > 0) {
        pending.push({ id, actor: Number(state.actor) })
      }
    }
    await Promise.allSettled(pending.map(row => installHostGatewayDns(row.id, row.actor, deploy)))
  } finally { dispatching = false }
}
export function startHostGatewayDnsDispatcher() {
  const run = () => { void dispatchHostGatewayDns().catch(() => {}) }
  const timer = setInterval(run, 5000); timer.unref(); run()
  return () => clearInterval(timer)
}
