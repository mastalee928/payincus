import { portProtocolSelect, portProtocolView } from '../services/host-port-protocol.js'
import { getPublicIpSync, publicIpView, syncHostPublicIp } from '../services/host-public-ip-sync.js'
import { PublicIpSyncError } from '../lib/host-public-ip.js'
import { publicIpv6View, syncHostPublicIpv6 } from '../services/host-public-ipv6-sync.js'
import { PublicIpv6SyncError } from '../lib/host-public-ipv6.js'
import { HostRecoveryError, inspectHostRecovery, recoverPoolHost } from '../services/host-pool-recovery.js'
import type { FastifyInstance } from 'fastify'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { OnboardingError, isOnboardingPublicIPv4, RESOURCE_PRESETS, type ResourcePreset } from '../lib/host-onboarding.js'
import { presetQuota } from '../lib/onboarding-resources.js'
import { deleteHost, HostRemovalError } from '../db/hosts.js'
import { removeIncusClient } from '../lib/incus/index.js'
import { hostSshConnection } from '../lib/host-ssh.js'
import { lockHostGroups, resolveHostGroups, type HostGroupInput } from '../services/host-groups.js'
import { HOST_OCCUPIED_INSTANCE_WHERE, dedicatedHostReadyWhere } from '../lib/host-resource-usage.js'
import { poolCapacityReady, poolCapacitySelect, poolKeyOf, poolKeyString, priceKeyOf, unsellableReason, type UnsellableReason } from '../lib/pool-stock.js'

const occupied = HOST_OCCUPIED_INSTANCE_WHERE
const count = () => ({ total: 0, available: 0, assigned: 0, unavailable: 0 })
type Counts = ReturnType<typeof count>
type StockState = 'available' | 'assigned' | 'unavailable'
export default async function hostInventoryRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { page?: number; search?: string; machineGroup?: string; regionGroup?: string; machineGroupId?: number; regionGroupId?: number; stock?: StockState } }>('/inventory', {
    onRequest: [fastify.authenticateAdmin],
    schema: { querystring: { type: 'object', properties: {
      page: { type: 'integer', minimum: 1, maximum: 100000 }, search: { type: 'string', maxLength: 100 },
      machineGroup: { type: 'string', maxLength: 60 }, regionGroup: { type: 'string', maxLength: 60 },
      machineGroupId: { type: 'integer', minimum: 0 }, regionGroupId: { type: 'integer', minimum: 0 },
      stock: { enum: ['available', 'assigned', 'unavailable'] }
    } } }
  }, async (request, reply) => {
    const page = Number(request.query.page) || 1
    const search = request.query.search?.trim()
    const where: Prisma.HostWhereInput = {
      ...(request.query.machineGroup ? { machineGroup: request.query.machineGroup } : {}),
      ...(request.query.regionGroup ? { regionGroup: request.query.regionGroup } : {}),
      ...(request.query.machineGroupId !== undefined ? { machineGroupId: request.query.machineGroupId || null } : {}),
      ...(request.query.regionGroupId !== undefined ? { regionGroupId: request.query.regionGroupId || null } : {}),
      ...(search ? { OR: [
        { name: { contains: search, mode: 'insensitive' } }, { natPublicIp: { contains: search } },
        { location: { contains: search, mode: 'insensitive' } },
        { instances: { some: { ...occupied, user: { username: { contains: search, mode: 'insensitive' } } } } },
        { onboardingNode: { batch: { accountLabel: { contains: search, mode: 'insensitive' } } } }
      ] } : {})
    }
    // A compact snapshot makes counts independent of the current page and search.
    const [inventory, groups, moves, priceRows, readyHosts] = await Promise.all([
      prisma.host.findMany({ select: { ...poolCapacitySelect, id: true, machineGroupId: true, regionGroupId: true, resourcePreset: true, customerDiskGiB: true, singleTenant: true, status: true, isInstalled: true, poolFaulted: true, publicIpSyncBlocked: true,
        _count: { select: { instances: { where: occupied } } }, onboardingNode: { select: { status: true } }, agent: { select: { enabled: true, lastSeenAt: true } } } }),
      prisma.hostMachineGroup.findMany({ orderBy: { id: 'asc' }, include: { regions: { orderBy: { id: 'asc' } } } }),
      prisma.instanceTask.findMany({ where: { taskType: { in: ['change_host', 'replace_host'] }, status: { in: ['PENDING', 'PROCESSING'] }, targetHostId: { not: null } }, select: { targetHostId: true } }),
      prisma.hostPoolPrice.findMany({ where: { active: true }, select: { machineGroupId: true, resourcePreset: true, regionGroupId: true, diskGiB: true } }),
      prisma.host.findMany({ where: dedicatedHostReadyWhere(), select: { id: true } })
    ])
    // 「真正可售」与客户公开目录同一套判据：有定价行 + 单租户 + 就绪 + 未占用 + 已设规格。
    // 只按「在线空闲」判定会让人以为机器能卖，其实客户侧对不上池子。
    const pricedPoolKeys = new Set(priceRows.map(price => priceKeyOf(price)))
    const ready = new Set(readyHosts.map(host => host.id))
    const summary = count(), ungrouped = count()
    const machineCounts = new Map<number, Counts>(), regionCounts = new Map<number, Counts>()
    const stateById = new Map<number, StockState>()
    const reasonById = new Map<number, UnsellableReason | null>()
    const increment = (target: Counts, state: StockState) => { target.total++; target[state]++ }
    const reserved = new Set(moves.map(task => task.targetHostId))
    for (const host of inventory) {
      const reason = unsellableReason({
        occupied: host._count.instances > 0, reserved: reserved.has(host.id), quarantined: host.poolFaulted,
        ipPending: host.publicIpSyncBlocked,
        resourcePreset: host.resourcePreset, customerDiskGiB: host.customerDiskGiB,
        singleTenant: host.singleTenant, ready: ready.has(host.id), capacityReady: poolCapacityReady(host),
        hasPrice: pricedPoolKeys.has(poolKeyString(poolKeyOf(host)))
      })
      const state: StockState = reason === 'assigned' ? 'assigned' : reason === null ? 'available' : 'unavailable'
      stateById.set(host.id, state)
      reasonById.set(host.id, reason)
      increment(summary, state)
      if (host.machineGroupId === null) increment(ungrouped, state)
      else {
        if (!machineCounts.has(host.machineGroupId)) machineCounts.set(host.machineGroupId, count())
        increment(machineCounts.get(host.machineGroupId)!, state)
      }
      if (host.regionGroupId !== null) {
        if (!regionCounts.has(host.regionGroupId)) regionCounts.set(host.regionGroupId, count())
        increment(regionCounts.get(host.regionGroupId)!, state)
      }
    }
    if (request.query.stock) where.id = { in: inventory.filter(host => stateById.get(host.id) === request.query.stock).map(host => host.id) }
    const [hosts, total] = await Promise.all([
      prisma.host.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * 20, take: 20, select: {
        id: true, name: true, location: true, url: true, countryCode: true, natPublicIp: true, ipAddress: true,
        natBindIp: true, publicIpSync: true, publicIpSyncBlocked: true, publicIpv6Sync: true, ipv6Mode: true, ipv6Subnet: true,
        machineGroup: true, regionGroup: true, machineGroupId: true, regionGroupId: true,
        machineGroupEntry: { select: { name: true } }, regionGroupEntry: { select: { name: true } },
        architecture: true, status: true, isInstalled: true, resourcePreset: true, customerDiskGiB: true,
        cpuAllowanceMax: true, memoryMax: true, storageSize: true, resourceSnapshot: true, singleTenant: true, poolFaulted: true, ...portProtocolSelect,
        agent: { select: { lastSeenAt: true } },
        instances: { where: occupied, select: { id: true, name: true, status: true, cpu: true, memory: true, disk: true, user: { select: { id: true, username: true } } }, orderBy: { id: 'asc' } },
        onboardingNode: { select: { publicIp: true, status: true, managementIp: true, batch: { select: { accountLabel: true } } } }
      } }),
      prisma.host.count({ where })
    ])
    reply.header('Cache-Control', 'no-store')
    return { hosts: hosts.map(host => {
      let managementAddress = ''
      try { managementAddress = new URL(host.url).hostname } catch { /* Legacy URLs may be invalid. */ }
      return {
        id: host.id, name: host.name, accountLabel: host.onboardingNode?.batch.accountLabel || host.location,
        publicIp: host.natPublicIp || host.onboardingNode?.publicIp || (isOnboardingPublicIPv4(host.ipAddress) ? host.ipAddress : null),
        managementAddress, countryCode: host.countryCode, poolFaulted: host.poolFaulted, portProtocol: portProtocolView(host),
        publicIpSync: publicIpView(host),
        publicIpv6Sync: publicIpv6View(host),
        machineGroup: host.machineGroupEntry?.name || host.machineGroup, regionGroup: host.regionGroupEntry?.name || host.regionGroup,
        machineGroupId: host.machineGroupId, regionGroupId: host.regionGroupId,
        architecture: host.architecture, status: host.status, isInstalled: host.isInstalled,
        instanceCount: host.instances.length, instances: host.instances, stock: stateById.get(host.id) || 'unavailable', sellReason: reasonById.get(host.id) ?? null,
        resourcePreset: host.resourcePreset, customerDiskGiB: host.customerDiskGiB, cpuAllowanceMax: host.cpuAllowanceMax,
        memoryMax: host.memoryMax, storageSize: host.storageSize, resourceSnapshot: host.resourceSnapshot, singleTenant: host.singleTenant,
        agentLastSeenAt: host.agent?.lastSeenAt || null
      }
    }), total, page, pageSize: 20, summary, ungrouped, sellable: [...reasonById.values()].filter(reason => reason === null).length,
    groups: groups.map(group => ({ ...group, counts: machineCounts.get(group.id) || count(),
      regions: group.regions.map(region => ({ ...region, counts: regionCounts.get(region.id) || count() })) })),
    machineGroups: groups.map(group => group.name), regionGroups: [...new Set(groups.flatMap(group => group.regions.map(region => region.name)))] }
  })

  fastify.patch<{ Body: HostGroupInput & { hostIds: number[] } }>('/inventory/groups', {
    onRequest: [fastify.authenticateAdmin], config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['hostIds'], properties: {
      hostIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'integer', minimum: 1 } },
      machineGroup: { type: ['string', 'null'], maxLength: 60 }, regionGroup: { type: ['string', 'null'], maxLength: 60 },
      machineGroupId: { type: ['integer', 'null'], minimum: 1 }, regionGroupId: { type: ['integer', 'null'], minimum: 1 }
    } } }
  }, async (request, reply) => {
    if (Object.keys(request.body).length < 2) return reply.code(400).send({ code: 'HOST_GROUP_INVALID' })
    const ids = request.body.hostIds
    try {
      const updated = await prisma.$transaction(async tx => {
        await lockHostGroups(tx)
        const hosts = await tx.host.findMany({ where: { id: { in: ids } } })
        if (hosts.length !== ids.length) return null
        for (const host of hosts) {
          const data = await resolveHostGroups(tx, request.body, host)
          await tx.host.update({ where: { id: host.id }, data })
          await tx.hostOnboardingNode.updateMany({ where: { hostId: host.id }, data })
        }
        return hosts.length
      })
      if (updated === null) return reply.code(404).send({ code: 'HOST_NOT_FOUND' })
      await createLog(request.user.id, 'host', 'host.groups.update', 'Updated groups for host IDs ' + ids.join(', '), 'success')
      return { success: true, updated }
    } catch (error) {
      if (error instanceof OnboardingError) return reply.code(400).send({ code: error.code })
      throw error
    }
  })

  /**
   * 给已接入的机器补设规格：机型/核心预设 + 客户磁盘档。
   * CPU 与内存配额按预设自动算，与接入时的口径完全一致；这是机器进入池子（可定价、可售）的前提。
   * 接入前就能选，接入后一直没地方改——这个接口补上这个缺口。
   */
  fastify.patch<{ Body: { hostIds: number[]; resourcePreset: ResourcePreset; customerDiskGiB: number } }>('/inventory/spec', {
    onRequest: [fastify.authenticateAdmin], config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['hostIds', 'resourcePreset', 'customerDiskGiB'], properties: {
      hostIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'integer', minimum: 1 } },
      resourcePreset: { type: 'string', enum: [...RESOURCE_PRESETS] },
      customerDiskGiB: { type: 'integer', minimum: 10, maximum: 10000 }
    } } }
  }, async (request, reply) => {
    const { hostIds, resourcePreset, customerDiskGiB } = request.body
    const quota = presetQuota(resourcePreset)
    const expectedArchitecture = resourcePreset === 'E2' ? 'x86_64' : 'aarch64'
    try {
      const updated = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM hosts WHERE id = ANY(${hostIds}::int[]) ORDER BY id FOR UPDATE`
        const hosts = await tx.host.findMany({ where: { id: { in: hostIds } }, select: {
          id: true, architecture: true, resourceSnapshot: true, cpuAllowanceMax: true, memoryMax: true, storageSize: true, instances: { where: occupied, select: { cpu: true, memory: true, disk: true } }
        } })
        if (hosts.length !== hostIds.length) return null
        for (const host of hosts) {
          if (host.instances.length > 1) throw new OnboardingError('HOST_HAS_INSTANCES')
          const snapshot = host.resourceSnapshot as { probe?: { cpuCount?: number; memoryMiB?: number } } | null
          const cpuCapacity = snapshot?.probe?.cpuCount ? snapshot.probe.cpuCount * 100 : host.cpuAllowanceMax
          const physicalMemory = snapshot?.probe?.memoryMiB
          const memoryCapacity = physicalMemory ? physicalMemory - (physicalMemory < 1024 ? 128 : 192) : host.memoryMax
          if (quota.cpuAllowanceMax > cpuCapacity) throw new OnboardingError('RESOURCE_CPU_INSUFFICIENT')
          if (quota.memoryMax > memoryCapacity) throw new OnboardingError('RESOURCE_MEMORY_INSUFFICIENT')
          if (customerDiskGiB + Math.max(4, Math.ceil(customerDiskGiB * 0.1)) > host.storageSize) throw new OnboardingError('RESOURCE_DISK_INSUFFICIENT')
          if (host.architecture !== expectedArchitecture) throw new OnboardingError('RESOURCE_ARCHITECTURE_MISMATCH')
          // 已有实例不能超出新配额：否则单租户触发器会在下一次改动实例时拦住，留下半套状态
          if (host.instances.some(i => i.cpu > quota.cpuAllowanceMax || i.memory > quota.memoryMax || i.disk > customerDiskGiB * 1024)) {
            throw new OnboardingError('HOST_SPEC_INSTANCE_EXCEEDS')
          }
          await tx.host.update({ where: { id: host.id }, data: {
            resourcePreset, customerDiskGiB, cpuAllowanceMax: quota.cpuAllowanceMax, memoryMax: quota.memoryMax,
            // 一机一卖的库存单位：最多一个客户实例的机器才标成单租户
            ...(host.instances.length <= 1 ? { singleTenant: true } : {})
          } })
          await tx.hostOnboardingNode.updateMany({ where: { hostId: host.id }, data: { resourcePreset, customerDiskGiB } })
        }
        return hosts.length
      })
      if (updated === null) return reply.code(404).send({ code: 'HOST_NOT_FOUND' })
      await createLog(request.user.id, 'host', 'host.spec.update',
        `Set spec ${resourcePreset} / ${customerDiskGiB} GiB for host IDs ${hostIds.join(', ')}`, 'success')
      return { success: true, updated }
    } catch (error) {
      if (error instanceof OnboardingError) return reply.code(400).send({ code: error.code })
      throw error
    }
  })

  const hostIdSchema = { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1, maximum: 2147483647 } } } }
  fastify.post<{ Params: { id: number } }>('/inventory/:id/ipv6/sync', {
    onRequest: [fastify.authenticateAdmin], schema: hostIdSchema,
    config: { rateLimit: { max: 6, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try { return await syncHostPublicIpv6(Number(request.params.id), { force: true }) }
    catch (error) {
      if (error instanceof PublicIpv6SyncError) return reply.code(error.code === 'HOST_NOT_FOUND' ? 404 : 409).send({ code: error.code })
      throw error
    }
  })
  fastify.get<{ Params: { id: number } }>('/inventory/:id/public-ip', {
    onRequest: [fastify.authenticateAdmin], schema: hostIdSchema
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try { return await getPublicIpSync(Number(request.params.id)) }
    catch (error) {
      if (error instanceof PublicIpSyncError) return reply.code(error.code === 'HOST_NOT_FOUND' ? 404 : 409).send({ code: error.code })
      throw error
    }
  })
  fastify.post<{ Params: { id: number }; Body: { settings?: unknown } }>('/inventory/:id/public-ip/sync', {
    onRequest: [fastify.authenticateAdmin], config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    schema: { ...hostIdSchema, body: { type: 'object', additionalProperties: false, properties: {
      settings: { type: 'object', additionalProperties: false, required: ['mode'], properties: {
        mode: { enum: ['auto', 'manual'] }, publicIp: { type: ['string', 'null'], maxLength: 15 },
        bindIp: { type: ['string', 'null'], maxLength: 15 }, sshPort: { type: 'integer', minimum: 1, maximum: 65535 }
      } }
    } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try { return await syncHostPublicIp(Number(request.params.id), { settings: request.body.settings, actorId: request.user.id, force: true }) }
    catch (error) {
      if (error instanceof PublicIpSyncError) return reply.code(error.code === 'HOST_NOT_FOUND' ? 404 : 409).send({ code: error.code })
      throw error
    }
  })
  fastify.get<{ Params: { id: number } }>('/inventory/:id/recovery', {
    onRequest: [fastify.authenticateAdmin], schema: hostIdSchema,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try { return await inspectHostRecovery(Number(request.params.id)) }
    catch (error) {
      if (error instanceof HostRecoveryError) return reply.code(error.code === 'HOST_NOT_FOUND' ? 404 : 409).send({ code: error.code })
      throw error
    }
  })
  fastify.post<{ Params: { id: number }; Body: { confirmation: string; acknowledgeCleanup: boolean } }>('/inventory/:id/recover', {
    onRequest: [fastify.authenticateAdmin], config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { ...hostIdSchema, body: { type: 'object', additionalProperties: false,
      required: ['confirmation', 'acknowledgeCleanup'], properties: {
        confirmation: { type: 'string', pattern: '^[a-f0-9]{64}$' }, acknowledgeCleanup: { type: 'boolean' }
      } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try { return await recoverPoolHost(Number(request.params.id), request.user.id, request.body) }
    catch (error) {
      if (error instanceof HostRecoveryError) return reply.code(error.code === 'HOST_NOT_FOUND' ? 404 : 409).send({ code: error.code, report: error.report })
      throw error
    }
  })
  fastify.get<{ Params: { id: number } }>('/inventory/:id/ssh', { onRequest: [fastify.authenticateAdmin], schema: hostIdSchema }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const host = await prisma.host.findUnique({ where: { id: Number(request.params.id) }, select: {
      managementSshHost: true, managementSshPort: true, managementSshUser: true,
      onboardingNode: { select: { managementIp: true, sshPort: true } }
    } })
    if (!host) return reply.code(404).send({ code: 'HOST_NOT_FOUND' })
    return hostSshConnection(host, { host: process.env.ONBOARDING_SSH_JUMP_HOST || process.env.ONBOARDING_GATEWAY_HOST,
      port: Number(process.env.ONBOARDING_SSH_JUMP_PORT || 22), username: process.env.ONBOARDING_SSH_JUMP_USER || 'root' })
  })

  fastify.patch<{ Params: { id: number }; Body: { host: string; port: number; username: string } }>('/inventory/:id/ssh', {
    onRequest: [fastify.authenticateAdmin], schema: { ...hostIdSchema, body: { type: 'object', additionalProperties: false,
      required: ['host', 'port', 'username'], properties: {
        host: { type: 'string', minLength: 1, maxLength: 253, pattern: '^[a-zA-Z0-9][a-zA-Z0-9.:-]*$' },
        port: { type: 'integer', minimum: 1, maximum: 65535 }, username: { type: 'string', minLength: 1, maxLength: 32, pattern: '^[a-zA-Z_][a-zA-Z0-9_-]*$' }
      } } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const result = await prisma.host.updateMany({ where: { id: Number(request.params.id) }, data: {
      managementSshHost: request.body.host, managementSshPort: request.body.port, managementSshUser: request.body.username
    } })
    if (!result.count) return reply.code(404).send({ code: 'HOST_NOT_FOUND' })
    await createLog(request.user.id, 'host', 'host.ssh.update', `Updated SSH connection for host #${request.params.id}`, 'success')
    return { success: true }
  })

  fastify.delete<{ Params: { id: number } }>('/inventory/:id', {
    onRequest: [fastify.authenticateAdmin], schema: hostIdSchema, config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const id = Number(request.params.id)
    try { await deleteHost(id) } catch (error) {
      if (error instanceof HostRemovalError) return reply.code(error.code === 'HOST_NOT_FOUND' ? 404 : 409).send({ code: error.code })
      throw error
    }
    await removeIncusClient(id).catch(() => {})
    await createLog(request.user.id, 'host', 'host.pool.delete', `Removed host #${id} from inventory`, 'success')
    return { success: true }
  })

}
