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

export class IncusClient {
  private serverCertificate: string | null
  private serverFingerprint: string | null
  baseUrl: string
  certPath: string | null
  keyPath: string | null
  agent: Agent | null = null
  connected: boolean = false

  constructor(options: IncusClientOptions) {
    this.serverCertificate = options.serverCertificate || null
    this.serverFingerprint = options.serverFingerprint || null
    if (this.serverCertificate && new X509Certificate(this.serverCertificate).fingerprint256 !== this.serverFingerprint) {
      throw new Error('Incus TLS pin does not match the stored certificate')
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
  private static normalizeUrl(url: string): string {
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
   * 初始化 mTLS 连接
   */
  async connect(): Promise<unknown> {
    try {
      if (!this.certPath || !this.keyPath) {
        throw new Error('Certificate or key path is missing')
      }

      const cert = readFileSync(this.certPath)
      const key = readFileSync(this.keyPath)

      this.agent = new Agent({
        connect: {
          cert,
          key,
          ...(this.serverCertificate ? {
            ca: this.serverCertificate,
            rejectUnauthorized: true,
            checkServerIdentity: (_hostname: string, peer: { fingerprint256: string }) => peer.fingerprint256 === this.serverFingerprint
              ? undefined : new Error('Incus TLS fingerprint changed')
          } : { rejectUnauthorized: false }) // Preserve existing manually registered hosts.
        },
        // 超时配置，防止 Headers Timeout Error
        headersTimeout: 120000, // 2分钟
        bodyTimeout: 300000     // 5分钟（对于大数据传输）
      })

      // 测试连接
      const info = await this.getServerInfo()
      this.connected = true
      return info
    } catch (error) {
      this.connected = false
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`无法连接到 Incus: ${message}`)
    }
  }

  /**
   * 发送 API 请求
   * @param timeout 异步操作的超时时间（毫秒），默认 120 秒。对于长时间操作（如复制实例），建议使用 300000（5分钟）
   */
  async request<T = unknown>(method: string, path: string, body: unknown = null, timeout: number = 120000, signal?: AbortSignal): Promise<T> {
    if (!this.agent) {
      throw new Error('Incus 客户端未连接')
    }

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
          'Content-Type': 'application/json'
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
        throw new Error(text || `HTTP ${response.statusCode}`)
      }

      // Incus API 返回格式: { type: "sync/async", status: "Success", metadata: {...} }
      if (data.type === 'error') {
        // 记录错误日志
        console.error('[Incus API Error]', {
          method,
          url,
          error: data.error || 'Incus API 错误'
        })
        throw new Error(data.error || 'Incus API 错误')
      }

      // 异步操作需要等待完成
      if (data.type === 'async' && data.operation) {
        const remaining = timeout - (Date.now() - startedAt)
        if (remaining <= 0) throw new Error(`Incus request timeout (${timeout} ms)`)
        return await waitForOperation(this, data.operation, remaining, requestSignal) as T
      }

      return (data.metadata || data) as T
    } finally { clearTimeout(timer) }
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
  async readFile(path: string, signal?: AbortSignal): Promise<{ content: string; statusCode: number }> {
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
    const content = await response.body.text()

    return { content, statusCode: response.statusCode }
  }

  // ==================== 服务器信息 ====================

  async getServerInfo(): Promise<unknown> {
    return this.request('GET', '/1.0')
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
