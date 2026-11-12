/**
 * Incus API 客户端 - 主类
 * 使用 mTLS (双向 TLS) 与 Incus 服务器通信
 */

import { Agent, request } from 'undici'
import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'fs'
import type {
  IncusClientOptions,
  IncusApiResponse
} from '../../types/incus.js'
import { waitForOperation } from './incus-utils.js'
import { resolveCertificatePair } from './certificate-paths.js'
import { assertHostNotMaintaining } from '../host-maintenance-gate.js'
import type { Prisma } from '@prisma/client'
import { beginHostMutation } from '../host-operation-lane.js'
import { alpineSshFingerprintInspectionCommand } from '../alpine-ssh-security.js'

export class IncusApiError extends Error {
  constructor(message: string, readonly statusCode: number, readonly path: string) { super(message) }
}

export interface IncusRequestConditions {
  onResponseDate?: (date: string | undefined) => void
  ifMatch?: string
  onEtag?: (etag: string | undefined) => void
  onOperation?: (path: string) => Promise<void>
}

export class IncusClient {
  private hostId?: number
  private maintenanceDatabase?: Pick<Prisma.TransactionClient,'host'>
  private maintenanceStart?: {path:string;allowed:()=>Promise<void>}
  private maintenanceStop?: {path:string;allowed:()=>Promise<void>}
  private maintenanceSshInspection?: {path:string;allowed:()=>Promise<void>}
  private serverCertificate: string | null
  private serverFingerprint: string | null
  baseUrl: string
  certPath: string | null
  keyPath: string | null
  agent: Agent | null = null
  connected: boolean = false

  constructor(options: IncusClientOptions, maintenanceDatabase?: Pick<Prisma.TransactionClient, 'host'>) {
    // Owned transports may live inside a transaction that already holds the
    // only DB connection. Keep the final mutation gate on that same connection.
    this.maintenanceDatabase = maintenanceDatabase
    this.hostId = options.id
    this.serverCertificate = options.serverCertificate || null
    this.serverFingerprint = options.serverFingerprint || null
    if (this.serverCertificate && new X509Certificate(this.serverCertificate).fingerprint256 !== this.serverFingerprint) {
      throw Object.assign(new Error('Incus TLS pin does not match the stored certificate'), { code: 'INCUS_CERTIFICATE_MISMATCH' })
    }
    this.baseUrl = IncusClient.normalizeUrl(options.url)
    const certificatePair = resolveCertificatePair(options.certPath, options.keyPath)
    this.certPath = certificatePair.certPath
    this.keyPath = certificatePair.keyPath
  }

  /**
   * 规范化 URL，确保 IPv6 地址被方括号包裹
   * 例如 https://2a06:de04:10:1250:::8443 → https://[2a06:de04:10:1250::]:8443
   */
  static normalizeUrl(url: string): string {
    try {
      // 如果 new URL() 能正常解析，说明格式已经正确
      new URL(url)
      return url
    } catch {
      // URL 解析失败，可能是裸 IPv6 地址未加方括号
      // 策略：从末尾找到 :PORT（纯数字），前面的部分就是 IPv6 地址
      const schemeMatch = url.match(/^(https?:\/\/)(.+)$/)
      if (!schemeMatch) return url

      const scheme = schemeMatch[1]
      const rest = schemeMatch[2] // 例如 "2a06:de04:10:1250:::8443"

      // 从末尾找最后一个冒号，检查冒号后面是否全是数字（即端口号）
      const lastColon = rest.lastIndexOf(':')
      if (lastColon === -1) return url

      const afterLastColon = rest.substring(lastColon + 1)
      if (/^\d+$/.test(afterLastColon)) {
        // afterLastColon 是端口号，前面的是 IPv6 地址
        const addr = rest.substring(0, lastColon)
        if (addr.includes(':')) {
          return `${scheme}[${addr}]:${afterLastColon}`
        }
      }
      return url
    }
  }

  /**
   * Dedicated streams must retain the same registered TLS identity as API
   * requests, even when they need their own connection and timeout settings.
   */
  createTransport(options: { connectTimeout?: number; headersTimeout?: number; bodyTimeout?: number } = {}): Agent {
    if (!this.certPath || !this.keyPath) {
      throw new Error('Certificate or key path is missing')
    }
    return new Agent({
      connect: {
        cert: readFileSync(this.certPath),
        key: readFileSync(this.keyPath),
        timeout: options.connectTimeout,
        ...(this.serverCertificate ? {
          ca: this.serverCertificate,
          rejectUnauthorized: true,
          checkServerIdentity: (_hostname: string, peer: { fingerprint256: string }) => peer.fingerprint256 === this.serverFingerprint
            ? undefined : Object.assign(new Error('Incus TLS fingerprint changed'), { code: 'INCUS_FINGERPRINT_MISMATCH' })
        } : { rejectUnauthorized: false }) // Preserve existing manually registered hosts.
      },
      headersTimeout: options.headersTimeout ?? 120000,
      bodyTimeout: options.bodyTimeout ?? 300000
    })
  }

  /**
   * 初始化 mTLS 连接
   */
  async connect(timeout = 120000): Promise<unknown> {
    try {
      this.agent = this.createTransport()

      // 测试连接
      const info = await this.getServerInfo(timeout)
      this.connected = true
      return info
    } catch (error) {
      this.connected = false
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`无法连接到 Incus: ${message}`, { cause: error })
    }
  }

  /**
   * 发送 API 请求
   * @param timeout 异步操作的超时时间（毫秒），默认 120 秒。对于长时间操作（如复制实例），建议使用 300000（5分钟）
   */
  async request<T = unknown>(method: string, path: string, body: unknown = null, timeout: number = 120000, signal?: AbortSignal, conditions?: IncusRequestConditions): Promise<T> {
    if (!this.agent) {
      throw new Error('Incus 客户端未连接')
    }

    const maintenanceStart=this.maintenanceStart
    const allowedStart=maintenanceStart&&method==='PUT'&&path===maintenanceStart.path&&
      JSON.stringify(body)===JSON.stringify({action:'start',timeout:30})
    const maintenanceStop=this.maintenanceStop
    const allowedStop=maintenanceStop&&method==='PUT'&&path===maintenanceStop.path&&
      JSON.stringify(body)===JSON.stringify({action:'stop',timeout:30,force:false})
    const inspection=this.maintenanceSshInspection
    const allowedInspection=inspection&&method==='POST'&&path===inspection.path&&JSON.stringify(body)===JSON.stringify({
      command:['sh','-c',alpineSshFingerprintInspectionCommand],'wait-for-websocket':false,interactive:false,'record-output':true})
    if((maintenanceStart||maintenanceStop||inspection)&&!['GET','HEAD'].includes(method)&&!allowedStart&&!allowedStop&&!allowedInspection)throw new Error('HARDENING_IDENTITY_CHANGED')
    const release=allowedStart?(await maintenanceStart.allowed(),()=>{}):allowedStop?(await maintenanceStop.allowed(),()=>{}):allowedInspection?(await inspection.allowed(),()=>{}):await this.beginMaintenanceAccess(method)
    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`Incus request timeout (${timeout} ms)`)), Math.max(1, timeout))
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    try {
      const url = `${this.baseUrl}${path}`
      const options: {
        method: string
        dispatcher: Agent
        headers: Record<string, string>
        body?: string
        signal?: AbortSignal
      } = {
        method,
        dispatcher: this.agent,
        signal: requestSignal,
        headers: {
          'Content-Type': 'application/json',
          ...(conditions?.ifMatch ? { 'If-Match': conditions.ifMatch } : {})
        }
      }

      if (body) {
        options.body = JSON.stringify(body)
      }

      const response = await request(url, options)
      const text = await response.body.text()

      // Try to parse JSON, handle non-JSON responses (e.g., mTLS errors)
      let data: IncusApiResponse<T>
      try {
        data = JSON.parse(text) as IncusApiResponse<T>
      } catch (e) {
        // 记录错误日志
        console.error('[Incus API Error]', {
          method,
          url,
          statusCode: response.statusCode,
          error: text || `HTTP ${response.statusCode}`
        })
        // Incus returns plain text for some errors (like mTLS failures)
        throw new IncusApiError(text || `HTTP ${response.statusCode}`, response.statusCode, path)
      }

      // Incus API 返回格式: { type: "sync/async", status: "Success", metadata: {...} }
      if (data.type === 'error' || response.statusCode >= 400) {
        // 记录错误日志
        console.error('[Incus API Error]', {
          method,
          url,
          error: data.error || 'Incus API 错误'
        })
        throw new IncusApiError(data.error || 'Incus API 错误', response.statusCode, path)
      }

      const etag = response.headers.etag
      conditions?.onEtag?.(typeof etag === 'string' ? etag : undefined)
      // Legacy manually registered transports may not have a pinned peer.
      // Their clock cannot grant extra freshness to a security receipt.
      conditions?.onResponseDate?.(this.baseUrl.startsWith('https://') && this.serverCertificate && this.serverFingerprint && typeof response.headers.date === 'string' ? response.headers.date : undefined)

      // 异步操作需要等待完成
      if (data.type === 'async' && data.operation) {
        // Persist the receipt before waiting: a timed-out waiter must not
        // submit a second destructive request to discover its result.
        if (!/^\/1\.0\/operations\/[a-z0-9_-]+$/i.test(data.operation)) throw new Error('INCUS_OPERATION_PATH_INVALID')
        await conditions?.onOperation?.(data.operation)
        const remaining = timeout - (Date.now() - startedAt)
        if (remaining <= 0) throw new Error(`Incus request timeout (${timeout} ms)`)
        return await waitForOperation(this, data.operation, remaining, requestSignal) as T
      }

      return (data.metadata || data) as T
    } finally { clearTimeout(timer);release() }
  }

  /** Final gate for mutations, exec and asynchronous cancellation. */
  async assertMaintenanceAccess(method: string, _path: string): Promise<void> {
    if (this.hostId !== undefined && !['GET','HEAD'].includes(method.toUpperCase())) await assertHostNotMaintaining(this.hostId,this.maintenanceDatabase)
  }
  async beginMaintenanceAccess(method:string):Promise<()=>void> {
    if(this.hostId===undefined||['GET','HEAD'].includes(method.toUpperCase()))return ()=>{}
    const release=beginHostMutation(this.hostId)
    try{await assertHostNotMaintaining(this.hostId,this.maintenanceDatabase);return release}
    catch(error){release();throw error}
  }
  withMaintenanceDatabase(database:Pick<Prisma.TransactionClient,'host'>):IncusClient {
    // Borrow the transport, never retain a transaction in the shared pool.
    const scoped=Object.create(this) as IncusClient
    scoped.maintenanceDatabase=database
    // The pool alone owns this transport. Closing a transaction wrapper must
    // neither close its parent's Agent nor leave the pool advertising it alive.
    scoped.close=async()=>{}
    scoped.connect=async()=>{throw new Error('A scoped Incus client cannot replace the pooled transport')}
    return scoped
  }
  /** Internal recovery capability: the caller already holds the host lane and
   * instance/current-authority locks. Borrow only this transport and allow one
   * fixed start path; ordinary methods, exec and files retain the normal fence. */
  withMaintenanceStart(name:string,allowed:()=>Promise<void>):IncusClient {
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(name))throw new Error('HARDENING_IDENTITY_CHANGED')
    const scoped=Object.create(this) as IncusClient
    scoped.maintenanceStart={path:`/1.0/instances/${encodeURIComponent(name)}/state`,allowed}
    scoped.maintenanceStop=undefined
    scoped.maintenanceSshInspection=undefined
    scoped.close=async()=>{}
    scoped.connect=async()=>{throw new Error('A scoped Incus client cannot replace the pooled transport')}
    return scoped
  }

  /** Latest stop/expiry/delete takes precedence even after an earlier recovery
   * start. This grants only graceful stop of the locked original instance. */
  withMaintenanceStop(name:string,allowed:()=>Promise<void>):IncusClient {
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(name))throw new Error('HARDENING_IDENTITY_CHANGED')
    const scoped=Object.create(this) as IncusClient
    scoped.maintenanceStart=undefined
    scoped.maintenanceSshInspection=undefined
    scoped.maintenanceStop={path:`/1.0/instances/${encodeURIComponent(name)}/state`,allowed}
    scoped.close=async()=>{}
    scoped.connect=async()=>{throw new Error('A scoped Incus client cannot replace the pooled transport')}
    return scoped
  }

  /** Recovery probe only: exact original instance and immutable read-only SSH
   * command. Mutating exec/options, files and all other targets stay fenced. */
  withMaintenanceSshInspection(name:string,allowed:()=>Promise<void>):IncusClient {
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(name))throw new Error('HARDENING_IDENTITY_CHANGED')
    const scoped=Object.create(this) as IncusClient
    scoped.maintenanceStart=undefined
    scoped.maintenanceStop=undefined
    scoped.maintenanceSshInspection={path:`/1.0/instances/${encodeURIComponent(name)}/exec`,allowed}
    scoped.close=async()=>{}
    scoped.connect=async()=>{throw new Error('A scoped Incus client cannot replace the pooled transport')}
    return scoped
  }

  /**
   * 检查文件是否存在（用于 Files API，不解析 JSON）
   * @returns true 如果文件存在（HTTP 200），false 如果不存在（HTTP 404）
   */
  async checkFileExists(path: string): Promise<{ exists: boolean; statusCode: number }> {
    const result = await this.readFile(path)
    return {
      exists: result.statusCode === 200,
      statusCode: result.statusCode
    }
  }

  /**
   * 读取实例文件（用于 Files API，不解析 JSON）
   * @returns 文件内容与 HTTP 状态码
   */
  async readFile(path: string, signal?: AbortSignal, maxBytes?:number): Promise<{ content: string; statusCode: number }> {
    if (!this.agent) {
      throw new Error('Incus 客户端未连接')
    }

    const url = `${this.baseUrl}${path}`
    const response = await request(url, {
      method: 'GET',
      dispatcher: this.agent,
      signal,
      headers: {
        'Content-Type': 'application/json'
      }
    })

    // Files API 返回原始文件内容，不是 JSON
    let content:string
    if(maxBytes!==undefined) {
      const chunks:Buffer[]=[];let size=0
      for await (const chunk of response.body) {
        const bytes=Buffer.from(chunk);size+=bytes.length
        if(size>maxBytes){response.body.destroy();throw Object.assign(new Error('INCUS_FILE_TOO_LARGE'),{code:'INCUS_FILE_TOO_LARGE'})}
        chunks.push(bytes)
      }
      content=Buffer.concat(chunks).toString('utf8')
    }else content=await response.body.text()

    return { content, statusCode: response.statusCode }
  }

  // ==================== 服务器信息 ====================

  async getServerInfo(timeout = 120000): Promise<unknown> {
    return this.request('GET', '/1.0', null, timeout)
  }

  async getResources(): Promise<unknown> {
    return this.request('GET', '/1.0/resources')
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    if (this.agent) {
      await this.agent.close()
      this.agent = null
      this.connected = false
    }
  }
}
