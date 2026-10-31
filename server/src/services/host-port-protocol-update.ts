import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { authorizeUserWrite, type WriteActor } from '../db/user-write-authorization.js'
import { normalizeLogContentForStorage } from '../lib/log-localization.js'
import { PORT_PROTOCOL_CAPABILITY, portProtocolSelect, portProtocolView, type PortProtocol } from './host-port-protocol.js'

export class PortProtocolUpdateError extends Error {
  constructor(readonly statusCode: number, readonly code: string) { super(code) }
}

// Saving the desired mode does not imply that the host has applied its firewall rule.
// Each host and its audit commit together; a batch reports independent host outcomes.
export async function updateHostPortProtocol(hostId: number, protocol: PortProtocol, actor: WriteActor) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM host_agents WHERE host_id = ${hostId} FOR SHARE`
    if (!await authorizeUserWrite(tx, actor.id, actor) ||
      (await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }))?.role !== 'admin') {
      throw new PortProtocolUpdateError(403, 'FORBIDDEN')
    }
    const host = await tx.host.findUnique({ where: { id: hostId }, select: {
      name: true, ...portProtocolSelect, agent: { select: { enabled: true, capabilities: true } }
    } })
    if (!host) throw new PortProtocolUpdateError(404, 'HOST_NOT_FOUND')
    if (!host.agent?.enabled || !Array.isArray(host.agent.capabilities) || !host.agent.capabilities.includes(PORT_PROTOCOL_CAPABILITY)) {
      throw new PortProtocolUpdateError(409, 'HOST_AGENT_UPGRADE_REQUIRED')
    }
    if (host.portProtocolRevision >= 2147483647) throw new PortProtocolUpdateError(409, 'PORT_PROTOCOL_REVISION_LIMIT')
    const updated = await tx.host.update({ where: { id: hostId }, data: {
      portProtocol: protocol, portProtocolRevision: { increment: 1 }, portProtocolError: null
    }, select: portProtocolSelect })
    await tx.log.create({ data: { userId: actor.id, module: 'host', action: 'host.port_protocol.update', result: 'success',
      content: normalizeLogContentForStorage(`Updated public ingress protocol on host "${host.name}" to ${protocol}`) } })
    return portProtocolView(updated)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 10000 })
}
