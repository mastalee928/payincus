/**
 * Caddy API 客户端
 * 通过 8444 端口 Basic Auth 保护的通道调用 Caddy Admin API
 */

import { Agent, request as undiciRequest } from 'undici'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { formatHostForUrl } from './network-address.js'

// 请求超时配置（毫秒）
const REQUEST_TIMEOUT = 30000 // 30秒
const CONNECT_TIMEOUT = 10000 // 10秒
const caddyAgentCache = new Map<string, Agent>()
const MAX_CADDY_AGENT_CACHE = 100

export async function closeCaddyClients(): Promise<void> {
  const agents = [...caddyAgentCache.values()]
  caddyAgentCache.clear()
  await Promise.allSettled(agents.map(agent => agent.close()))
}

export interface CaddyClientConfig {
  host: string // 宿主机 IP 或域名
  port: number // Caddy API 端口 (默认 8444)
  username: string // Basic Auth 用户名
  password: string // Basic Auth 密码
  caPath?: string // Caddy 管理端 TLS CA PEM 路径（未传时使用 CADDY_CA_PATH）
  serverName?: string // TLS 证书名称（默认匹配安装脚本生成的 caddy-admin）
}

export interface CaddyRoute {
  '@id'?: string
  match?: Array<{ host?: string[]; protocol?: string; not?: Array<{ host?: string[]; path?: string[] }> }>
  handle?: Array<{
    handler: string
    status_code?: number
    upstreams?: Array<{ dial: string }>
    routes?: CaddyRoute[]
  }>
  terminal?: boolean
}

class CaddyApiError extends Error {
  constructor(
    readonly statusCode: number,
    responseBody: string
  ) {
    super(`Caddy API error: ${statusCode} ${responseBody}`)
    this.name = 'CaddyApiError'
  }
}

function siteRouteId(domain: string): string {
  return `site-v2-${Buffer.from(domain.toLowerCase()).toString('base64url')}`
}

function routeMatchesOnlyDomain(route: CaddyRoute, domain: string): boolean {
  return route.match?.length === 1 && route.match[0]?.host?.length === 1 && route.match[0].host[0]?.toLowerCase() === domain.toLowerCase()
}

export interface ManagedCaddySite {
  siteKey: string
  revision: number
  domain: string
  targetIp: string
  targetPort: number
  httpsEnabled: boolean
  action: 'upsert' | 'disable' | 'delete'
  adoptLegacy: boolean
}

export class CaddyManagedSiteConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'CaddyManagedSiteConflictError' }
}

const MANAGED_ROUTE_ID = /^site-v3-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-(\d+)-(active|off|deleted)$/

function allRoutes(routes: CaddyRoute[]): CaddyRoute[] {
  return routes.flatMap(route => [route, ...(route.handle?.flatMap(handler => allRoutes(handler.routes || [])) ?? [])])
}

function filterRoutes(routes: CaddyRoute[], remove: (route: CaddyRoute) => boolean): CaddyRoute[] {
  return routes.filter(route => !remove(route)).map(route => ({ ...route, ...(route.handle ? {
    handle: route.handle.map(handler => ({ ...handler, ...(handler.routes ? { routes: filterRoutes(handler.routes, remove) } : {}) }))
  } : {}) }))
}

/**
 * Caddy API 客户端类
 */
export class CaddyClient {
  private baseUrl: string
  private authHeader: string
  private agent!: Agent
  private agentKey: string
  private ca: Buffer
  private serverName: string

  constructor(config: CaddyClientConfig) {
    this.baseUrl = `https://${formatHostForUrl(config.host)}:${config.port}`
    this.authHeader = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64')

    const caPath = config.caPath?.trim() || process.env.CADDY_CA_PATH?.trim()
    if (!caPath) {
      throw new Error('Caddy TLS trust material is missing: configure caPath or CADDY_CA_PATH')
    }

    let ca: Buffer
    try {
      ca = readFileSync(caPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Unable to read Caddy TLS CA: ${message}`)
    }
    const serverName = config.serverName?.trim() || process.env.CADDY_TLS_SERVER_NAME?.trim() || 'caddy-admin'
    this.agentKey = JSON.stringify([config.host, config.port, serverName, createHash('sha256').update(ca).digest('hex')])
    this.ca = ca
    this.serverName = serverName
    this.acquireAgent()
  }

  /** A client can outlive its cache entry, including between GET and POST. */
  private acquireAgent(): Agent {
    const { agentKey, ca, serverName } = this
    const cachedAgent = caddyAgentCache.get(agentKey)

    // Basic Auth 凭证只能通过由固定 CA 验证的 TLS 连接发送。
    if (cachedAgent && !cachedAgent.closed && !cachedAgent.destroyed) {
      this.agent = cachedAgent
      caddyAgentCache.delete(agentKey)
      caddyAgentCache.set(agentKey, cachedAgent)
    } else {
      this.agent = new Agent({
        connect: {
          ca,
          servername: serverName,
          rejectUnauthorized: true,
          timeout: CONNECT_TIMEOUT
        }
      })
      caddyAgentCache.set(agentKey, this.agent)
      if (caddyAgentCache.size > MAX_CADDY_AGENT_CACHE) {
        const oldestKey = caddyAgentCache.keys().next().value!
        const oldest = caddyAgentCache.get(oldestKey)!
        caddyAgentCache.delete(oldestKey)
        void oldest.close().catch(() => {})
      }
    }
    return this.agent
  }

  /**
   * 发起 API 请求
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { ifMatch?: string; onEtag?: (etag: string | undefined) => void; deadline?: number }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    
    const controller = new AbortController()
    const remaining = options?.deadline === undefined ? REQUEST_TIMEOUT : Math.min(REQUEST_TIMEOUT, options.deadline - Date.now())
    if (remaining <= 0) throw new Error('Caddy configuration operation timed out')
    const timeoutId = setTimeout(() => controller.abort(), remaining)

    try {
      const response = await undiciRequest(url, {
        method,
        // Acquire synchronously immediately before dispatch. Eviction drains an
        // already dispatched request; the next request reacquires a live Agent.
        dispatcher: this.acquireAgent(),
        signal: controller.signal,
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json',
          ...(options?.ifMatch ? { 'If-Match': options.ifMatch } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      })

      if (response.statusCode >= 400) {
        const errorText = await response.body.text()
        throw new CaddyApiError(response.statusCode, errorText)
      }

      // 某些请求没有响应体
      const text = await response.body.text()
      const etag = response.headers.etag
      options?.onEtag?.(typeof etag === 'string' ? etag : undefined)
      if (!text) {
        return {} as T
      }
      
      return JSON.parse(text) as T
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * 获取 Caddy 配置
   */
  async getConfig(): Promise<unknown> {
    return this.request('GET', '/config/')
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<boolean> {
    try {
      console.log(`[Caddy Client] 测试连接: ${this.baseUrl}/config/`)
      await this.getConfig()
      console.log(`[Caddy Client] 连接成功: ${this.baseUrl}`)
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      // 检查是否是超时错误
      const isTimeout = errorMessage.includes('abort') || errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')
      console.error(`[Caddy Client] 连接失败: ${this.baseUrl}`, {
        error: errorMessage,
        isTimeout,
        stack: error instanceof Error ? error.stack : undefined
      })
      return false
    }
  }

  /** Apply one durable generation. Tombstones never match traffic, but fence a
   * late enable/update even after the database site has been deleted/recreated.
   */
  async reconcileManagedSite(input: ManagedCaddySite, assertCurrent?: () => Promise<void>): Promise<'applied' | 'unchanged'> {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.siteKey) ||
      !Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('Invalid managed site identity')
    const mode = input.action === 'upsert' ? 'active' : input.action === 'delete' ? 'deleted' : 'off'
    const id = `site-v3-${input.siteKey}-${input.revision}-${mode}`
    const desired: CaddyRoute = input.action === 'upsert' ? {
      '@id': id,
      match: [{ host: [input.domain], ...(!input.httpsEnabled ? { protocol: 'http' } : {}) }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `${formatHostForUrl(input.targetIp)}:${input.targetPort}` }] }],
      terminal: true
    } : { '@id': id, match: [{ host: [input.domain], not: [{ host: [input.domain] }] }],
      handle: [{ handler: 'static_response', status_code: 404 }], terminal: true }
    const deadline = Date.now() + 90000
    for (let attempt = 0; attempt < 3; attempt++) {
      await assertCurrent?.()
      let etag: string | undefined
      const config = await this.request<any>('GET', '/config/', undefined, { deadline, onEtag: value => { etag = value } })
      if (!etag) throw new Error('Caddy config response is missing ETag; cannot safely reconcile site')
      const http = structuredClone(config.apps?.http ?? {})
      http.servers ??= {}
      const routes = (Object.values(http.servers) as any[]).flatMap(server => allRoutes(server.routes || []))
      const owned = routes.filter(route => MANAGED_ROUTE_ID.exec(route['@id'] || '')?.[1] === input.siteKey)
      for (const route of owned) {
        const revision = Number(MANAGED_ROUTE_ID.exec(route['@id'] || '')![2])
        if (revision > input.revision) throw new CaddyManagedSiteConflictError('Caddy 已存在更新的站点代次，旧操作已阻止')
        if (revision === input.revision && !isDeepStrictEqual(route, desired)) {
          throw new CaddyManagedSiteConflictError('Caddy 当前代次配置与已接受意图不符，请核对远端配置')
        }
      }
      const sameDomain = routes.filter(route => routeMatchesOnlyDomain(route, input.domain))
      for (const route of sameDomain) {
        const remoteIdentity = MANAGED_ROUTE_ID.exec(route['@id'] || '')
        if (remoteIdentity && remoteIdentity[1] !== input.siteKey) throw new CaddyManagedSiteConflictError('域名已属于另一站点身份，禁止覆盖')
        if (!remoteIdentity && (!input.adoptLegacy || !route['@id']?.startsWith('site-'))) {
          throw new CaddyManagedSiteConflictError('域名存在未授权接管的远端配置，请核对')
        }
      }
      if (owned.some(route => !isDeepStrictEqual(route, desired) && Number(MANAGED_ROUTE_ID.exec(route['@id'] || '')?.[2]) === input.revision)) {
        throw new CaddyManagedSiteConflictError('同一站点代次存在多个不同远端配置，禁止覆盖')
      }
      if (owned.length === 1 && isDeepStrictEqual(owned[0], desired) && sameDomain.every(route => route === owned[0])) return 'unchanged'
      const remove = (route: CaddyRoute) => {
        const identity = MANAGED_ROUTE_ID.exec(route['@id'] || '')
        return identity ? identity[1] === input.siteKey : input.adoptLegacy && Boolean(route['@id']?.startsWith('site-')) && routeMatchesOnlyDomain(route, input.domain)
      }
      for (const server of Object.values(http.servers) as any[]) server.routes = filterRoutes(server.routes || [], remove)
      const server = http.servers.sites ??= { listen: [':80'], routes: [] }
      server.routes ??= []
      server.routes.push(desired)
      server.listen ??= [':80']
      if (input.action === 'upsert' && !server.listen.some((address: string) => address.endsWith(':80'))) server.listen.push(':80')
      if (input.action === 'upsert' && input.httpsEnabled && !server.listen.some((address: string) => address.endsWith(':443'))) server.listen.push(':443')
      server.automatic_https ??= {}
      server.automatic_https.disable_redirects = true
      const skip: string[] = Array.isArray(server.automatic_https.skip) ? server.automatic_https.skip : []
      server.automatic_https.skip = [...new Set(skip.filter(domain => domain.toLowerCase() !== input.domain.toLowerCase()))]
      if (input.action === 'upsert' && !input.httpsEnabled) server.automatic_https.skip.push(input.domain)
      await assertCurrent?.()
      try {
        if (config.apps) await this.request('POST', '/config/apps/http', http, { ifMatch: etag, deadline })
        else await this.request('POST', '/config/apps', { http }, { ifMatch: etag, deadline })
        const verified = await this.request<any>('GET', '/config/', undefined, { deadline })
        const verifiedRoutes = (Object.values(verified.apps?.http?.servers || {}) as any[]).flatMap(server => allRoutes(server.routes || []))
        const verifiedOwned = verifiedRoutes.filter(route => MANAGED_ROUTE_ID.exec(route['@id'] || '')?.[1] === input.siteKey)
        if (verifiedOwned.length !== 1 || !isDeepStrictEqual(verifiedOwned[0], desired) ||
          verifiedRoutes.some(route => routeMatchesOnlyDomain(route, input.domain) && route !== verifiedOwned[0])) {
          throw new CaddyManagedSiteConflictError('Caddy 写入后配置核验不一致，未确认站点操作成功')
        }
        return 'applied'
      } catch (error) {
        if (!(error instanceof CaddyApiError) || error.statusCode !== 412 || attempt === 2) throw error
      }
    }
    throw new Error('Caddy reconciliation retry limit reached')
  }

  /**
   * 添加反代站点
   * 
   * 架构说明：
   * - 复用 sites 服务器，按需添加 :80 和 :443
   * - HTTPS 站点：正常配置，Caddy 自动处理证书和重定向
   * - HTTP 站点：protocol 匹配和自动证书 skip 同次提交
   * 
   * @param domain 域名
   * @param targetIp 目标 IP (实例内网 IP)
   * @param targetPort 目标端口
   * @param httpsEnabled 是否启用 HTTPS（自动申请 Let's Encrypt 证书）
   */
  async addSite(domain: string, targetIp: string, targetPort: number, httpsEnabled: boolean = true): Promise<void> {
    const deadline = Date.now() + 90000
    const routeId = siteRouteId(domain)
    const route: CaddyRoute = {
      '@id': routeId,
      match: [{ host: [domain], ...(!httpsEnabled ? { protocol: 'http' } : {}) }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `${formatHostForUrl(targetIp)}:${targetPort}` }] }],
      terminal: true
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      let etag: string | undefined
      const config = await this.request<any>('GET', '/config/', undefined, { deadline, onEtag: value => { etag = value } })
      if (!etag) throw new Error('Caddy config response is missing ETag; cannot safely update it')
      const http = structuredClone(config.apps?.http ?? {})
      http.servers ??= {}
      // Remove only managed routes for this exact domain from the copied config.
      // The old lossy ID may also belong to a different tenant and must stay intact.
      for (const server of Object.values(http.servers) as any[]) {
        if (Array.isArray(server.routes)) server.routes = server.routes.filter((existing: CaddyRoute) =>
          !(existing['@id']?.startsWith('site-') && routeMatchesOnlyDomain(existing, domain)))
      }
      const server = http.servers.sites ??= { listen: [':80'], routes: [] }
      server.routes ??= []
      server.routes.push(route)
      server.listen ??= [':80']
      // Preserve explicit listener bindings instead of adding a wildcard duplicate.
      if (!server.listen.some((address: string) => address.endsWith(':80'))) server.listen.push(':80')
      if (httpsEnabled && !server.listen.some((address: string) => address.endsWith(':443'))) server.listen.push(':443')
      server.automatic_https ??= {}
      server.automatic_https.disable_redirects = true
      const skip: string[] = Array.isArray(server.automatic_https.skip) ? server.automatic_https.skip : []
      server.automatic_https.skip = [...new Set(skip.filter(value => value.toLowerCase() !== domain.toLowerCase()))]
      if (!httpsEnabled) server.automatic_https.skip.push(domain)
      try {
        // Caddy atomically validates/reloads this scoped change; a rejected config
        // keeps all old routes. If-Match protects concurrent changes in the read scope.
        if (config.apps) await this.request('POST', '/config/apps/http', http, { ifMatch: etag, deadline })
        else await this.request('POST', '/config/apps', { http }, { ifMatch: etag, deadline })
        return
      } catch (error) {
        if (!(error instanceof CaddyApiError) || error.statusCode !== 412 || attempt === 2) throw error
      }
    }
  }

  /**
   * 删除反代站点
   * @param domain 域名
   */
  async deleteSite(domain: string): Promise<void> {
    const routeId = siteRouteId(domain)
    try {
      await this.request('DELETE', `/id/${routeId}`)
    } catch (error) {
      if (!(error instanceof CaddyApiError) || error.statusCode !== 404) throw error
    }
    // Older releases used a lossy ID. Verify its exact host before deleting it,
    // since a-b.example and a.b-example can share that legacy ID.
    const legacyId = `site-${domain.replace(/\./g, '-')}`
    let legacy: CaddyRoute
    let etag: string | undefined
    try { legacy = await this.request<CaddyRoute>('GET', `/id/${legacyId}`, undefined, { onEtag: value => { etag = value } }) } catch (error) {
      if (error instanceof CaddyApiError && error.statusCode === 404) return
      throw error
    }
    if (!routeMatchesOnlyDomain(legacy, domain)) return
    if (!etag) throw new Error('Caddy legacy route response is missing ETag; cannot safely delete it')
    try { await this.request('DELETE', `/id/${legacyId}`, undefined, { ifMatch: etag }) } catch (error) {
      if (!(error instanceof CaddyApiError) || error.statusCode !== 404) throw error
    }
  }

  /**
   * 获取所有反代站点
   */
  async getSites(): Promise<string[]> {
    try {
      const config = await this.getConfig() as {
        apps?: {
          http?: {
            servers?: Record<string, {
              routes?: CaddyRoute[]
            }>
          }
        }
      }

      const servers = config?.apps?.http?.servers || {}
      const domains: string[] = []

      // 从所有服务器收集域名
      for (const serverName of Object.keys(servers)) {
        const routes = servers[serverName]?.routes || []
        for (const route of routes) {
          if (route.match?.[0]?.host) {
            domains.push(...route.match[0].host)
          }
        }
      }

      return domains
    } catch {
      return []
    }
  }

  /**
   * 重新加载配置
   */
  async reload(): Promise<void> {
    // Caddy 会自动应用配置更改，不需要显式 reload
    // 这个方法保留用于兼容性
  }
}

/**
 * 创建 Caddy 客户端实例
 */
export function createCaddyClient(config: CaddyClientConfig): CaddyClient {
  return new CaddyClient(config)
}
