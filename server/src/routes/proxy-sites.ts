/**
 * 反代站点管理路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as tls from 'tls'
import * as dns from 'dns'
import { promisify } from 'util'
import * as db from '../db/index.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { getDnsRecordType } from '../lib/network-address.js'
import { requireInstanceViewPermission } from '../lib/permission.js'
import { resolvePublicHostname } from '../lib/outbound-security.js'
import { getProxySitesByInstanceId, getProxySiteById, isValidDomain } from '../db/proxy-sites.js'
import { withProxySiteMutation, ProxySiteMutationError } from '../db/proxy-site-mutations.js'
import type { ProxySite, Prisma } from '@prisma/client'
import { normalizeLogContentForStorage } from '../lib/log-localization.js'
import { inspectProxySiteCertificate, type ProxySiteCertificateResult } from '../lib/proxy-site-certificate.js'
import { applyProxySiteOperation, loadProxySiteOperationView, prepareProxySiteOperation,
  prepareProxySiteOperationInTransaction, proxySiteOperationFields, proxySiteOperationResponse,
  retryProxySiteOperation, validateProxySiteOperationRequest } from '../db/proxy-site-operations.js'
import { PENDING_PROXY_SITE_OPERATION_STATES } from '../db/proxy-site-operation-guards.js'

// DNS 解析函数
const dnsResolve4 = promisify(dns.resolve4)
const dnsResolve6 = promisify(dns.resolve6)

const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\d*$/

function parsePositiveRouteId(value: string): number | null {
  if (!POSITIVE_ROUTE_ID_PATTERN.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= 2147483647 ? parsed : null
}

async function runMutation<T>(reply: FastifyReply, mutation: () => Promise<T>) {
  try {
    const result = await mutation()
    // Send only after the transaction commits, including persisted remote errors.
    if (result && typeof result === 'object' && 'httpStatus' in result) {
      const { httpStatus, ...body } = result
      return reply.code(Number(httpStatus)).send(body)
    }
    return result
  } catch (error) {
    if (error instanceof ProxySiteMutationError) return reply.code(error.statusCode).send({ error: error.message, code: error.code })
    if ((error as { code?: string }).code === 'P2002') return reply.code(409).send({ error: '该域名已被使用' })
    throw error
  }
}

async function logSiteMutation(tx: Prisma.TransactionClient, userId: number, module: string, action: string,
  content: string, result: string, options: { instanceId: number }) {
  await tx.log.create({ data: { userId, module, action, content: normalizeLogContentForStorage(content), result, instanceId: options.instanceId } })
}

function siteResponse(site: ProxySite) {
  return { id: site.id, domain: site.domain, targetPort: site.targetPort, httpsEnabled: site.httpsEnabled,
    remark: site.remark, status: site.status, enabled: site.enabled, error: site.error, ...proxySiteOperationFields(site) }
}

export default async function proxySitesRoutes(fastify: FastifyInstance) {
  /**
   * 获取实例的反代站点列表
   * GET /instances/:id/sites
   */
  fastify.get<{
    Params: { id: string }
  }>('/instances/:id/sites', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const instanceId = parsePositiveRouteId(request.params.id)

    if (!instanceId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：实例所有者、宿主机所有者、管理员均可查看
    if (!(await requireInstanceViewPermission(user, instance, reply))) {
      return
    }

    // 检查宿主机 Caddy 是否启用
    const host = await db.getHostById(instance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    const sites = await Promise.all((await getProxySitesByInstanceId(instanceId)).map(loadProxySiteOperationView))

    // 获取站点配额信息
    const pkg = instance.package_id ? await db.getPackageById(instance.package_id) : null
    const siteLimit = instance.site_limit ?? pkg?.site_limit ?? 10

    return {
      sites: sites.map(s => ({
        id: s.id,
        domain: s.domain,
        targetPort: s.targetPort,
        httpsEnabled: s.httpsEnabled,
        remark: s.remark,
        status: s.status,
        enabled: s.enabled,
        error: s.error,
        createdAt: s.createdAt,
        siteKey: s.siteKey, revision: s.revision, appliedRevision: s.appliedRevision, syncPending: s.syncPending,
        operationId: s.operationId, operationAction: s.operationAction, operationState: s.operationState, nextRetryAt: s.nextRetryAt
      })),
      caddyEnabled: host.caddy_enabled || false,
      // DNS 解析提示信息
      dnsRecordType: (host.nat_public_ip || host.ip_address) ? getDnsRecordType(host.nat_public_ip || host.ip_address || '') : null,
      dnsRecordValue: host.nat_public_ip || host.ip_address || null,
      // 站点配额信息
      siteQuota: {
        used: sites.length,
        limit: siteLimit
      },
      // 站点增删改仍保持实例所有者能力，管理员/宿主机所有者在详情页只读查看
      canManageSites: user.role !== 'admin' && instance.user_id === user.id
    }
  })

  /** Add a pending site; quota and domain uniqueness use the current locked instance. */
  fastify.post<{
    Params: { id: string }
    Body: { domain: string; targetPort: number; httpsEnabled?: boolean; remark?: string }
  }>('/instances/:id/sites', {
    onRequest: [fastify.authenticateUser],
    schema: { body: { type: 'object', required: ['domain', 'targetPort'], properties: {
      domain: { type: 'string', minLength: 4, maxLength: 253 },
      targetPort: { type: 'integer', minimum: 1, maximum: 65535 },
      httpsEnabled: { type: 'boolean', default: true }, remark: { type: 'string', maxLength: 100 }
    } } }
  }, async (request, reply) => {
    const instanceId = parsePositiveRouteId(request.params.id)
    if (!instanceId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    const domain = request.body.domain.toLowerCase().trim()
    if (!isValidDomain(domain)) return reply.code(400).send({ error: '域名格式无效（不支持泛域名）' })
    return runMutation(reply, () => withProxySiteMutation(instanceId, undefined, request.user, async ({ tx, instance, host }) => {
      if (!host.caddyEnabled) throw new ProxySiteMutationError(400, '请先在宿主机安装 Caddy')
      if (!instance.ipv4) throw new ProxySiteMutationError(400, '实例未分配 IPv4 地址')
      let siteLimit = instance.siteLimit
      if (siteLimit === null && instance.packageId) {
        await tx.$queryRaw`SELECT id FROM packages WHERE id = ${instance.packageId} FOR SHARE`
        siteLimit = (await tx.package.findUnique({ where: { id: instance.packageId } }))?.siteLimit ?? null
      }
      siteLimit ??= 10
      if (siteLimit !== 0 && await tx.proxySite.count({ where: { instanceId } }) >= siteLimit) {
        throw new ProxySiteMutationError(400, `已达到站点数量上限 (${siteLimit})`, 'SITE_LIMIT_EXCEEDED')
      }
      if (await tx.proxySite.findUnique({ where: { hostId_domain: { hostId: host.id, domain } } })) {
        throw new ProxySiteMutationError(400, '该域名已被使用')
      }
      const site = await tx.proxySite.create({ data: { instanceId, hostId: host.id, domain,
        targetPort: request.body.targetPort, httpsEnabled: request.body.httpsEnabled ?? true,
        remark: request.body.remark?.trim() || null, status: 'pending', enabled: true } })
      await logSiteMutation(tx, request.user.id, 'proxy', 'site.create', `Created proxy site "${domain}" (pending DNS)`, 'success', { instanceId })
      const value = host.natPublicIp || host.ipAddress || ''
      return { site: siteResponse(site),
        dnsHint: { type: value ? getDnsRecordType(value) : 'A', host: domain, value },
        message: '站点已创建，请配置 DNS 后点击“检测 DNS”激活' }
    }))
  })

  fastify.delete<{ Params: { id: string; siteId: string }; Body: unknown }>('/instances/:id/sites/:siteId', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const instanceId = parsePositiveRouteId(request.params.id)
    const siteId = parsePositiveRouteId(request.params.siteId)
    if (!instanceId || !siteId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    return runMutation(reply, async () => {
      const operation = await prepareProxySiteOperation(instanceId, siteId, request.user,
        { ...validateProxySiteOperationRequest(request.body), action: 'delete' })
      return proxySiteOperationResponse(await applyProxySiteOperation(operation.id))
    })
  })

  fastify.post<{ Params: { id: string; siteId: string }; Body: unknown }>('/instances/:id/sites/:siteId/check-dns', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const instanceId = parsePositiveRouteId(request.params.id)
    const siteId = parsePositiveRouteId(request.params.siteId)
    if (!instanceId || !siteId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    return runMutation(reply, async () => {
      validateProxySiteOperationRequest(request.body)
      const checked = await withProxySiteMutation(instanceId, siteId, request.user, async ({ tx, site: current, instance, host }) => {
        const site = current!
        const expectedIp = host.natPublicIp || host.ipAddress
        if (!expectedIp) throw new ProxySiteMutationError(400, '宿主机未配置公网 IP')
        const results = await Promise.allSettled([dnsResolve4(site.domain), dnsResolve6(site.domain)])
        const resolvedIps = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
        if (!resolvedIps.length) return { dnsResolved: false, expectedIp, resolvedIps, error: 'DNS 未解析，请检查域名配置', status: site.status }
        if (!resolvedIps.includes(expectedIp)) return { dnsResolved: true, ipMatches: false, expectedIp, resolvedIps,
          error: `DNS 解析到 ${resolvedIps.join(', ')}，但期望的是 ${expectedIp}`, status: site.status }
        if (site.status === 'pending' && site.enabled) {
          const operation = await prepareProxySiteOperationInTransaction(tx, { instance, host, site, actor: request.user },
            { ...validateProxySiteOperationRequest(request.body), action: 'upsert', requireEnabled: true })
          return { dnsResolved: true, ipMatches: true, expectedIp, resolvedIps, operationId: operation.id }
        }
        return { dnsResolved: true, ipMatches: true, expectedIp, resolvedIps, status: site.status,
          message: !site.enabled ? '站点已禁用' : site.status === 'active' ? '站点已激活' : '请点击刷新重试配置' }
      })
      if (checked.operationId) {
        const operation = await applyProxySiteOperation(checked.operationId)
        return { ...checked, ...await proxySiteOperationResponse(operation), activated: operation.state === 'succeeded' }
      }
      return checked
    })
  })

  fastify.post<{ Params: { id: string; siteId: string }; Body: unknown }>('/instances/:id/sites/:siteId/refresh', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const instanceId = parsePositiveRouteId(request.params.id)
    const siteId = parsePositiveRouteId(request.params.siteId)
    if (!instanceId || !siteId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    return runMutation(reply, async () => {
      const operation = await prepareProxySiteOperation(instanceId, siteId, request.user,
        { ...validateProxySiteOperationRequest(request.body), action: 'upsert', requireEnabled: true })
      return proxySiteOperationResponse(await applyProxySiteOperation(operation.id))
    })
  })

  fastify.patch<{
    Params: { id: string; siteId: string }
    Body: { targetPort?: number; httpsEnabled?: boolean; remark?: string; requestId?: string; expectedRevision?: number }
  }>('/instances/:id/sites/:siteId', {
    onRequest: [fastify.authenticateUser],
    schema: { body: { type: 'object', properties: {
      targetPort: { type: 'integer', minimum: 1, maximum: 65535 }, httpsEnabled: { type: 'boolean' },
      remark: { type: 'string', maxLength: 100 }, requestId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 0 }
    } } }
  }, async (request, reply) => {
    const instanceId = parsePositiveRouteId(request.params.id)
    const siteId = parsePositiveRouteId(request.params.siteId)
    if (!instanceId || !siteId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    const { targetPort, httpsEnabled, remark } = request.body
    if (targetPort === undefined && httpsEnabled === undefined && remark === undefined) return reply.code(400).send({ error: '请提供要修改的字段' })
    return runMutation(reply, async () => {
      const prepared = await withProxySiteMutation(instanceId, siteId, request.user, async ({ tx, site: current, instance, host }) => {
        const site = current!
        if (!site.enabled) throw new ProxySiteMutationError(400, '请先启用站点')
        const changes = { targetPort, httpsEnabled, remark: remark === undefined ? undefined : remark.trim() || null }
        const configChanged = targetPort !== undefined && targetPort !== site.targetPort || httpsEnabled !== undefined && httpsEnabled !== site.httpsEnabled
        if (configChanged) {
          const operation = await prepareProxySiteOperationInTransaction(tx, { instance, host, site, actor: request.user },
            { ...validateProxySiteOperationRequest(request.body), action: 'upsert', requireEnabled: true, changes })
          return { operationId: operation.id }
        }
        if (await tx.proxySiteOperation.count({ where: { siteKey: site.siteKey, state: { in: [...PENDING_PROXY_SITE_OPERATION_STATES] } } })) {
          throw new ProxySiteMutationError(409, '站点已有未完成操作，请重试原操作', 'SITE_OPERATION_PENDING')
        }
        if (changes.remark === undefined || changes.remark === site.remark) return { message: '配置无变化', site: siteResponse(site) }
        const saved = await tx.proxySite.update({ where: { id: site.id }, data: { remark: changes.remark } })
        await logSiteMutation(tx, request.user.id, 'proxy', 'site.update', `Updated proxy site remark "${site.domain}"`, 'success', { instanceId })
        return { message: '站点备注已更新', site: siteResponse(saved) }
      })
      if (prepared.operationId) return proxySiteOperationResponse(await applyProxySiteOperation(prepared.operationId))
      return prepared
    })
  })

  fastify.post<{ Params: { id: string; siteId: string }; Body: { enabled?: unknown; requestId?: string; expectedRevision?: number } }>('/instances/:id/sites/:siteId/toggle', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const instanceId = parsePositiveRouteId(request.params.id)
    const siteId = parsePositiveRouteId(request.params.siteId)
    if (!instanceId || !siteId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    return runMutation(reply, async () => {
      if (typeof request.body?.enabled !== 'boolean') throw new ProxySiteMutationError(409, '请刷新站点并明确选择启用或禁用', 'SITE_REVISION_REQUIRED')
      const operation = await prepareProxySiteOperation(instanceId, siteId, request.user,
        { ...validateProxySiteOperationRequest(request.body), action: request.body.enabled ? 'upsert' : 'disable' })
      return proxySiteOperationResponse(await applyProxySiteOperation(operation.id))
    })
  })

  fastify.post<{ Params: { id: string; siteId: string }; Body: unknown }>('/instances/:id/sites/:siteId/retry', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const instanceId = parsePositiveRouteId(request.params.id)
    const siteId = parsePositiveRouteId(request.params.siteId)
    if (!instanceId || !siteId) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    return runMutation(reply, async () => {
      const operation = await retryProxySiteOperation(instanceId, siteId, request.user, validateProxySiteOperationRequest(request.body))
      return proxySiteOperationResponse(await applyProxySiteOperation(operation.id))
    })
  })
  /**
   * 检查站点证书状态
   * GET /instances/:id/sites/:siteId/certificate
   */
  fastify.get<{
    Params: { id: string; siteId: string }
  }>('/instances/:id/sites/:siteId/certificate', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string; siteId: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const instanceId = parsePositiveRouteId(request.params.id)
    const siteId = parsePositiveRouteId(request.params.siteId)

    if (!instanceId || !siteId) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const site = await getProxySiteById(siteId)
    if (!site || site.instanceId !== instanceId) {
      return reply.code(404).send({ error: '站点不存在' })
    }

    // 证书状态属于查看类信息，允许实例所有者、宿主机所有者、管理员查看
    if (!(await requireInstanceViewPermission(user, {
      user_id: site.instance.userId,
      host_id: site.instance.hostId
    }, reply))) {
      return
    }

    // 如果未启用 HTTPS，返回特定状态
    if (!site.httpsEnabled) {
      return {
        httpsEnabled: false,
        status: 'disabled',
        message: 'HTTPS 未启用'
      }
    }

    // 如果站点还是 pending 状态，返回提示
    if (site.status === 'pending') {
      return {
        httpsEnabled: true,
        status: 'pending',
        hint: '站点待激活，请先配置 DNS 并点击“检测 DNS”'
      }
    }

    // 尝试通过 TLS 连接获取证书信息
    try {
      const [certificateAddress] = await resolvePublicHostname(site.domain)
      const result = await new Promise<ProxySiteCertificateResult>((resolve, reject) => {
        const socket = tls.connect({
          host: certificateAddress.address,
          port: 443,
          servername: site.domain,
          rejectUnauthorized: false, // 仅允许读取诊断信息，结果仍须通过日期/域名/信任校验
          timeout: 10000
        }, () => {
          try {
            resolve(inspectProxySiteCertificate(socket, site.domain))
          } catch (error) {
            reject(error)
          } finally {
            socket.destroy()
          }
        })

        socket.on('error', (err) => {
          socket.destroy()
          reject(err)
        })

        socket.on('timeout', () => {
          socket.destroy()
          reject(new Error('连接超时'))
        })
      })

      return {
        httpsEnabled: true,
        ...result
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      
      // 分析错误类型
      let status = 'error'
      let hint = ''
      
      if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
        status = 'dns_error'
        hint = 'DNS 未解析，请检查域名是否正确指向服务器'
      } else if (errorMessage.includes('ECONNREFUSED')) {
        status = 'connection_refused'
        hint = '连接被拒绝，请检查服务器 443 端口是否开放'
      } else if (errorMessage.includes('timeout') || errorMessage.includes('超时')) {
        status = 'timeout'
        hint = '连接超时，请检查网络连接'
      } else if (errorMessage.includes('handshake') || errorMessage.includes('SSL') || errorMessage.includes('TLS')) {
        status = 'cert_pending'
        hint = '证书正在申请中，请稍后重试'
      } else if (errorMessage.includes('certificate') || errorMessage.includes('self signed')) {
        status = 'cert_pending'
        hint = '证书正在申请中，请稍后重试'
      } else if (errorMessage.includes('ECONNRESET')) {
        status = 'cert_pending'
        hint = '证书可能正在申请中，请稍后重试'
      }

      return {
        httpsEnabled: true,
        status,
        error: errorMessage,
        hint
      }
    }
  })
}
