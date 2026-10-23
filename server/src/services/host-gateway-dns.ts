import { prisma } from '../db/prisma.js'
import { OnboardingError } from '../lib/host-onboarding.js'
import { recoveryHeld } from './platform-backup-core.js'
import { loadStableGatewayEndpoint } from './onboarding-gateway-endpoint.js'
import { installGatewayHostDns } from './onboarding-ssh.js'

const active = new Set<string>()
const statusKey = (id: string) => 'onboarding_gateway_dns_host_' + id
export async function listHostGatewayDns() {
  const nodes = await prisma.hostOnboardingNode.findMany({ where: { deletedAt: null, hostId: { not: null } },
    select: { id: true, name: true, managementIp: true, sshFingerprint: true, nodePublicKey: true, status: true }, orderBy: { createdAt: 'asc' } })
  const records = await prisma.systemConfig.findMany({ where: { key: { in: nodes.map(node => statusKey(node.id)) } }, select: { key: true, value: true, updatedAt: true } })
  const endpoint = await loadStableGatewayEndpoint()
  return nodes.map(node => {
    const stored = records.find(record => record.key === statusKey(node.id))
    let state: { installed?: boolean; endpoint?: string; code?: string; nodePublicKey?: string; sshFingerprint?: string; managementIp?: string } = {}
    try { state = stored ? JSON.parse(stored.value) : {} } catch {}
    return { id: node.id, name: node.name, managementIp: node.managementIp,
      eligible: node.status === 'succeeded' && !!node.managementIp && !!node.sshFingerprint && !!node.nodePublicKey,
      running: active.has(node.id), installed: state.installed === true && !!endpoint && state.endpoint === `${endpoint.hostname}:${endpoint.port}` &&
        state.nodePublicKey === node.nodePublicKey && state.sshFingerprint === node.sshFingerprint && state.managementIp === node.managementIp, endpoint: state.endpoint || null,
      error: state.code || null, updatedAt: stored?.updatedAt.toISOString() || null }
  })
}
export async function installHostGatewayDns(nodeId: string, actor: number, deploy = installGatewayHostDns) {
  if (active.has(nodeId)) throw new OnboardingError('GATEWAY_DNS_HOST_BUSY')
  active.add(nodeId)
  try {
    const endpoint = await loadStableGatewayEndpoint()
    if (!endpoint || recoveryHeld()) throw new OnboardingError('GATEWAY_DNS_NOT_READY')
    const node = await prisma.hostOnboardingNode.findUnique({ where: { id: nodeId }, include: { host: true } })
    if (!node || node.deletedAt || node.status !== 'succeeded' || !node.host || !node.managementIp || !node.sshFingerprint || !node.nodePublicKey ||
        node.host.managementSshHost !== node.managementIp || node.host.managementSshPort !== node.sshPort) throw new OnboardingError('GATEWAY_DNS_MANAGEMENT_REQUIRED')
    const busy = await prisma.instanceTask.count({ where: { hostId: node.host.id, status: { in: ['PENDING', 'PROCESSING'] } } }) ||
      await prisma.restoreTask.count({ where: { hostId: node.host.id, status: { in: ['PENDING', 'PROCESSING'] } } })
    if (busy) throw new OnboardingError('GATEWAY_DNS_HOST_BUSY')
    const record = async (value: object) => prisma.systemConfig.upsert({ where: { key: statusKey(nodeId) },
      create: { key: statusKey(nodeId), value: JSON.stringify(value), type: 'json' }, update: { value: JSON.stringify(value) } })
    await record({ installed: false, code: 'GATEWAY_DNS_INSTALL_PENDING', actor })
    try {
      if (recoveryHeld()) throw new OnboardingError('GATEWAY_RECOVERY_HELD')
      const result = await deploy(nodeId, { ...endpoint, sshPort: node.sshPort, sshFingerprint: node.sshFingerprint, nodePublicKey: node.nodePublicKey })
      await record({ installed: true, endpoint: result.endpoint, actor, nodePublicKey: node.nodePublicKey, sshFingerprint: node.sshFingerprint, managementIp: node.managementIp })
      return result
    } catch (error) {
      const code = error instanceof OnboardingError ? error.code : 'GATEWAY_DNS_INSTALL_FAILED'
      await record({ installed: false, code, actor })
      throw new OnboardingError(code)
    }
  } finally { active.delete(nodeId) }
}
