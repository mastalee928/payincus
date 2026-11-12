import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { encryptSensitiveData } from '../lib/security.js'
import { readOnboardingCredentials } from '../lib/onboarding-credentials.js'
import { OnboardingError, RESOURCE_PRESETS, validateCredentials, validateOnboardingInput, resolveOnboardingInput, onboardingCredentials, onboardingPanelOrigin, refreshUnprovisionedSshIdentity, type OnboardingRequest, type OnboardingCredentials } from '../lib/host-onboarding.js'
import { gatewayCommand, gatewayConfigured } from '../services/onboarding-ssh.js'
import { resolveHostGroups } from '../services/host-groups.js'
import hostInventoryRoutes from './host-inventory.js'
import hostGroupRoutes from './host-groups.js'
import gatewayManagementRoutes from './gateway-management.js'
import { registerGatewayEndpointRoutes } from './onboarding-gateway-endpoint.js'
import simpleGatewaySetupRoutes from './simple-gateway-setup.js'
import { lockOnboardingLifecycle, pendingPeerRetirement, readPeerRetirement, deletedPeerRetirement } from '../services/onboarding-lifecycle.js'
import { onboardingAddressConflict, lockOnboardingAddresses } from '../services/onboarding-conflicts.js'
import { publicIpState } from '../lib/host-public-ip.js'
import { hardeningPublicView } from '../lib/hardening-view.js'

const nodeSelect = {
  id: true, name: true, publicIp: true, sshPort: true, sshFingerprint: true, managementIp: true,
  machineGroup: true, regionGroup: true, machineGroupId: true, regionGroupId: true, countryCode: true,
  resourcePreset: true, customerDiskGiB: true, resolvedResources: true,
  hostId: true, status: true, step: true, errorCode: true, attempt: true, createdAt: true, updatedAt: true,
  completedAt: true, host: { select: { status: true, isInstalled: true, architecture: true, natPublicIp: true, publicIpSync: true, securityHardening: true, agent: { select: { lastSeenAt: true } } } }
} as const
const batchSelect = {
  id: true, name: true, accountLabel: true, defaults: true, createdAt: true,
  nodes: { where: { deletedAt: null }, select: nodeSelect, orderBy: { createdAt: 'asc' as const } }
} as const
const credentialsSchema = { type: 'object', additionalProperties: false, properties: {
  password: { type: 'string', maxLength: 1024 }, privateKey: { type: 'string', maxLength: 32768 }
} } as const
const groupAndResourceProperties = {
  machineGroupId: { type: ['integer', 'null'], minimum: 1 }, regionGroupId: { type: ['integer', 'null'], minimum: 1 },
  resourcePreset: { enum: [...RESOURCE_PRESETS, null] }, customerDiskGiB: { type: 'integer', minimum: 10, maximum: 10000 }
}

export default async function hostOnboardingRoutes(fastify: FastifyInstance) {
  await fastify.register(hostInventoryRoutes)
  await fastify.register(hostGroupRoutes)
  await fastify.register(gatewayManagementRoutes)
  await registerGatewayEndpointRoutes(fastify)
  await fastify.register(simpleGatewaySetupRoutes)
  fastify.get<{ Querystring: { address: string } }>('/address-check', {
    onRequest: [fastify.authenticateAdmin], config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { querystring: { type: 'object', additionalProperties: false, required: ['address'], properties: { address: { type: 'string', minLength: 1, maxLength: 254 } } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try {
      const input = await resolveOnboardingInput({ requestId: randomUUID(), name: 'address-check', accountLabel: '', defaults: { countryCode: 'us' },
        credentials: { password: 'address-check-only' }, nodes: [{ name: 'address-check', address: request.query.address }] })
      const publicIp = input.nodes[0]!.publicIp
      return { publicIp, conflict: await onboardingAddressConflict(publicIp) }
    } catch (error) {
      if (error instanceof OnboardingError) return reply.code(400).send({ code: error.code })
      throw error
    }
  })
  fastify.get('/gateway', { onRequest: [fastify.authenticateAdmin], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (!gatewayConfigured()) return { ready: false, code: 'GATEWAY_NOT_CONFIGURED' }
    try {
      onboardingPanelOrigin()
      const gateway = await gatewayCommand()
      return { ready: true, gateway: { controlIp: gateway.controlIp, network: gateway.network, sshHost: gateway.sshHost } }
    } catch (error) { return { ready: false, code: error instanceof OnboardingError ? error.code : 'GATEWAY_UNREACHABLE' } }
  })

  fastify.get<{ Querystring: { page?: string; search?: string } }>('/', { onRequest: [fastify.authenticateAdmin] }, async (request, reply) => {
    const page = Math.max(1, Math.min(100000, Math.trunc(Number(request.query.page)) || 1))
    const search = request.query.search?.trim().slice(0, 100)
    const where: Prisma.HostOnboardingBatchWhereInput = { nodes: { some: { deletedAt: null } },
      ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { accountLabel: { contains: search, mode: 'insensitive' } }, { nodes: { some: { deletedAt: null, OR: [
        { name: { contains: search, mode: 'insensitive' } }, { publicIp: { contains: search } }, { activePublicIp: { contains: search } },
        { host: { is: { publicIpSync: { path: ['observedIp'], string_contains: search } } } }
      ] } } }] } : {}) }
    const retirementWhere: Prisma.HostOnboardingNodeWhereInput = { deletedAt: { not: null }, hostId: null,
      OR: [{ peerRetirement: { path: ['status'], equals: 'pending' } }, { peerRetirement: { path: ['status'], equals: 'blocked' } }] }
    const [batches, total, retiredNodes, retirementTotal] = await Promise.all([
      prisma.hostOnboardingBatch.findMany({ where, select: batchSelect, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 10, take: 10 }),
      prisma.hostOnboardingBatch.count({ where }),
      prisma.hostOnboardingNode.findMany({ where: retirementWhere, select: { id: true, name: true, publicIp: true, peerRetirement: true }, orderBy: { updatedAt: 'desc' }, take: 20 }),
      prisma.hostOnboardingNode.count({ where: retirementWhere })
    ])
    reply.header('Cache-Control', 'no-store')
    return { batches: batches.map(batch => ({ ...batch, nodes: batch.nodes.map(node => {
      const state = publicIpState(node.host?.publicIpSync)
      return { ...node, currentPublicIp: node.host ? state.observedIp || node.host.natPublicIp : null,
        host: node.host ? { status: node.host.status, isInstalled: node.host.isInstalled, architecture: node.host.architecture, agent: node.host.agent,
          securityHardening: hardeningPublicView(node.host.securityHardening) } : null }
    }) })), total, page, pageSize: 10, gatewaySshHost: process.env.ONBOARDING_SSH_JUMP_HOST || process.env.ONBOARDING_GATEWAY_HOST || null,
      retirementTotal, retirements: retiredNodes.map(node => { const state = readPeerRetirement(node.peerRetirement)!; return {
        id: node.id, name: node.name, publicIp: node.publicIp, status: state.status, attempts: state.attempts, nextAttemptAt: state.nextAttemptAt, error: state.error
      } }) }
  })

  fastify.post<{ Body: OnboardingRequest }>('/', {
    onRequest: [fastify.authenticateAdmin], bodyLimit: 2 * 1024 * 1024,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['requestId', 'name', 'accountLabel', 'defaults', 'nodes'], properties: {
      requestId: { type: 'string', maxLength: 36 }, name: { type: 'string', maxLength: 80 }, accountLabel: { type: 'string', maxLength: 80 },
      defaults: { type: 'object', additionalProperties: false, required: ['countryCode'], properties: {
        portProtocol: { type: 'string', enum: ['tcp', 'tcp_udp'] },
        countryCode: { type: 'string', pattern: '^[a-z]{2}$' }, storageSize: { type: 'integer', minimum: 10, maximum: 10000 },
        machineGroup: { type: 'string', maxLength: 60 }, regionGroup: { type: 'string', maxLength: 60 },
        cpuAllowanceMax: { type: 'integer', minimum: 1, maximum: 100000 }, memoryMax: { type: 'integer', minimum: 256, maximum: 1048576 },
        ...groupAndResourceProperties
      } }, credentials: credentialsSchema, nodes: { type: 'array', minItems: 1, maxItems: 50, items: {
        type: 'object', additionalProperties: false, required: ['name'], properties: {
          name: { type: 'string', minLength: 2, maxLength: 64 }, publicIp: { type: 'string', maxLength: 15 }, address: { type: 'string', maxLength: 254 },
          sshPort: { type: 'integer', minimum: 1, maximum: 65535 }, sshFingerprint: { type: 'string', maxLength: 50 },
          machineGroup: { type: 'string', maxLength: 60 }, regionGroup: { type: 'string', maxLength: 60 }, countryCode: { type: 'string', pattern: '^[a-z]{2}$' },
          ...groupAndResourceProperties,
          ...credentialsSchema.properties
        }
      } }
    } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try {
      validateOnboardingInput(request.body)
      const existing = await prisma.hostOnboardingBatch.findUnique({ where: { id: request.body.requestId }, select: { id: true, createdById: true } })
      if (existing) {
        if (existing.createdById !== request.user.id) return reply.code(409).send({ code: 'INVALID_REQUEST_ID' })
        return { id: existing.id }
      }
      const input = await resolveOnboardingInput(request.body)
      for (const row of input.nodes) {
        const conflict = await onboardingAddressConflict(row.publicIp)
        if (conflict) return reply.code(409).send(conflict)
      }
      const duplicates = await prisma.host.findMany({ where: { userId: request.user.id, name: { in: input.nodes.map(row => row.name) } }, select: { name: true } })
      if (duplicates.length) return reply.code(409).send({ code: 'HOST_NAME_ALREADY_REGISTERED', conflicts: duplicates.map(host => host.name) })
      onboardingPanelOrigin()
      await gatewayCommand()
      const batch = await prisma.$transaction(async tx => {
        await lockOnboardingAddresses(tx, input.nodes.map(row => row.publicIp))
        await lockOnboardingLifecycle(tx)
        for (const row of input.nodes) {
          const conflict = await onboardingAddressConflict(row.publicIp, tx)
          if (conflict) throw new OnboardingError(conflict.code)
        }
        if (await tx.host.count({ where: { userId: request.user.id, name: { in: input.nodes.map(row => row.name) } } })) throw new OnboardingError('HOST_NAME_ALREADY_REGISTERED')
        const batch = await tx.hostOnboardingBatch.create({ data: {
          id: input.requestId, createdById: request.user.id, name: input.name.trim(), accountLabel: input.accountLabel.trim(),
          defaults: input.defaults as unknown as Prisma.InputJsonObject
        }, select: { id: true } })
        const defaultGroups = await resolveHostGroups(tx, input.defaults)
        for (const row of input.nodes) {
          const groups = await resolveHostGroups(tx, row, defaultGroups)
          const region = groups.regionGroupId ? await tx.hostRegionGroup.findUnique({ where: { id: groups.regionGroupId } }) : null
          const data = {
            batchId: batch.id, name: row.name, publicIp: row.publicIp, sshPort: row.sshPort || 22,
            ...groups, countryCode: row.countryCode || region?.countryCode || input.defaults.countryCode,
            resourcePreset: row.resourcePreset === undefined ? input.defaults.resourcePreset || null : row.resourcePreset,
            customerDiskGiB: row.customerDiskGiB ?? input.defaults.customerDiskGiB ?? null,
            credentialsEncrypted: encryptSensitiveData(JSON.stringify(onboardingCredentials(row, input.credentials))),
            credentialsExpireAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
          }
          const previous = await tx.hostOnboardingNode.findFirst({ where: { publicIp: row.publicIp, hostId: null, deletedAt: { not: null } }, orderBy: { updatedAt: 'desc' } })
          if (previous?.deletedAt && !previous.hostId) {
            const retired = readPeerRetirement(previous.peerRetirement)
            // Keep the historical identity until the current root login and
            // remote preflight pass. The worker retires the old peer first.
            const revived = await tx.hostOnboardingNode.updateMany({ where: { id: previous.id, deletedAt: previous.deletedAt, hostId: null }, data: {
              ...data, deletedAt: null, status: 'queued', step: 'queued', errorCode: null, startedAt: null, completedAt: null,
              leaseToken: null, leaseUntil: null, resolvedResources: Prisma.DbNull,
              identityReset: { version: 1, requestId: randomUUID(), reason: 'new' },
              peerRetirement: (retired ? { ...retired, attempts: 0, nextAttemptAt: new Date().toISOString() } : pendingPeerRetirement(previous.nodePublicKey && previous.managementIp ? { nodePublicKey: previous.nodePublicKey, managementIp: previous.managementIp } : undefined)) as unknown as Prisma.InputJsonValue
            } })
            if (!revived.count) throw new OnboardingError('HOST_ALREADY_REGISTERED')
          } else {
            await tx.hostOnboardingNode.create({ data: { ...data, sshFingerprint: row.sshFingerprint || null } })
          }
        }
        return batch
      })
      await createLog(request.user.id, 'host', 'host.onboarding.create', `Queued batch "${input.name}" (${input.nodes.length} hosts)`, 'success')
      return reply.code(202).send(batch)
    } catch (error) {
      if (error instanceof OnboardingError) return reply.code(400).send({ code: error.code, error: error.code })
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.hostOnboardingBatch.findUnique({ where: { id: request.body.requestId }, select: { id: true, createdById: true } })
        if (existing?.createdById === request.user.id) return { id: existing.id }
        return reply.code(409).send({ code: 'HOST_ALREADY_REGISTERED' })
      }
      request.log.error('Could not create onboarding batch')
      return reply.code(500).send({ code: 'ONBOARDING_CREATE_FAILED' })
    }
  })

  fastify.post<{ Params: { id: string }; Body: OnboardingCredentials }>('/nodes/:id/retry', {
    onRequest: [fastify.authenticateAdmin], bodyLimit: 40000, config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: credentialsSchema }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const node = await prisma.hostOnboardingNode.findUnique({ where: { id: request.params.id } })
    if (!node || node.deletedAt) return reply.code(404).send({ code: 'ONBOARDING_NOT_FOUND' })
    if (!['failed', 'cancelled'].includes(node.status)) return reply.code(409).send({ code: 'ONBOARDING_NOT_RETRYABLE' })
    let encrypted = node.credentialsEncrypted
    if (request.body?.password || request.body?.privateKey) {
      try { validateCredentials(request.body) } catch { return reply.code(400).send({ code: 'SSH_CREDENTIALS_INVALID' }) }
      encrypted = encryptSensitiveData(JSON.stringify({ password: request.body.password, privateKey: request.body.privateKey }))
    } else if (!encrypted || node.credentialsExpireAt < new Date()) return reply.code(400).send({ code: 'SSH_CREDENTIALS_REQUIRED' })
    try { readOnboardingCredentials(encrypted!) } catch { return reply.code(400).send({ code: 'SSH_CREDENTIALS_INVALID' }) }
    const refreshIdentity = refreshUnprovisionedSshIdentity(node) || (node.hostId === null && !node.sshFingerprint)
    const oldRetirement = readPeerRetirement(node.peerRetirement)
    const updated = await prisma.$transaction(async tx => {
      await lockOnboardingAddresses(tx, [node.publicIp])
      await lockOnboardingLifecycle(tx)
      if (node.hostId === null) {
        const conflict = await onboardingAddressConflict(node.publicIp, tx, node.id)
        if (conflict) return { count: 0 }
      }
      const updated = await tx.hostOnboardingNode.updateMany({ where: { id: node.id, status: node.status, deletedAt: null,
        ...(refreshIdentity ? { hostId: null,
          step: node.step, sshFingerprint: node.sshFingerprint, updatedAt: node.updatedAt } : {})
      }, data: {
        status: 'queued', errorCode: null, credentialsEncrypted: encrypted,
        ...(oldRetirement ? { peerRetirement: { ...oldRetirement, attempts: 0, nextAttemptAt: new Date().toISOString(), error: null } as unknown as Prisma.InputJsonValue } : {}),
        ...(refreshIdentity ? { identityReset: { version: 1, requestId: randomUUID(), reason: 'retry' } } : {}),
        credentialsExpireAt: new Date(Date.now() + 24 * 60 * 60 * 1000), startedAt: null, completedAt: null, leaseToken: null, leaseUntil: null
      } })
      if (updated.count && refreshIdentity) await tx.log.create({ data: { userId: request.user.id, module: 'host',
        action: 'host.onboarding.current_system_requested', result: 'success',
        content: `Explicit retry will inspect the current system of unprovisioned host "${node.name}"; previous SSH fingerprint: ${node.sshFingerprint}` } })
      return updated
    })
    if (!updated.count) return reply.code(409).send({ code: 'ONBOARDING_NOT_RETRYABLE' })
    await createLog(request.user.id, 'host', 'host.onboarding.retry', `Retried onboarding host "${node.name}"`, 'success')
    return { success: true }
  })

  fastify.post<{ Params: { id: string } }>('/nodes/:id/cancel', {
    onRequest: [fastify.authenticateAdmin], config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const updated = await prisma.hostOnboardingNode.updateMany({ where: { id: request.params.id, deletedAt: null, status: { in: ['queued', 'failed'] } }, data: {
      status: 'cancelled', credentialsEncrypted: null, completedAt: new Date()
    } })
    if (!updated.count) return reply.code(409).send({ code: 'ONBOARDING_ALREADY_RUNNING' })
    await createLog(request.user.id, 'host', 'host.onboarding.cancel', `Cancelled onboarding task ${request.params.id}`, 'success')
    return { success: true }
  })

  fastify.delete<{ Params: { id: string } }>('/nodes/:id', {
    onRequest: [fastify.authenticateAdmin], config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const updated = await prisma.$transaction(async tx => {
      await lockOnboardingLifecycle(tx)
      const node = await tx.hostOnboardingNode.findUnique({ where: { id: request.params.id } })
      return tx.hostOnboardingNode.updateMany({ where: {
        id: request.params.id, deletedAt: null, status: { in: ['succeeded', 'failed', 'cancelled'] }
      }, data: { deletedAt: new Date(), credentialsEncrypted: null, leaseToken: null, leaseUntil: null,
        ...(node && node.hostId === null ? { peerRetirement: deletedPeerRetirement(node) as unknown as Prisma.InputJsonValue } : {}) } })
    })
    if (!updated.count) {
      const node = await prisma.hostOnboardingNode.findUnique({ where: { id: request.params.id }, select: { deletedAt: true } })
      if (!node) return reply.code(404).send({ code: 'ONBOARDING_NOT_FOUND' })
      if (!node.deletedAt) return reply.code(409).send({ code: 'ONBOARDING_NOT_DELETABLE' })
    } else {
      await createLog(request.user.id, 'host', 'host.onboarding.delete', `Removed onboarding task ${request.params.id}; host retained`, 'success')
    }
    return { success: true }
  })
}
