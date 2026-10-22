import OSS from 'ali-oss'
import { Agent } from 'node:https'
import type { LookupFunction } from 'node:net'
import { resolvePublicHostname } from '../lib/outbound-security.js'
import { gatewayBackupPrefix, type GatewayBackupStore } from './gateway-backup.js'

// Independent raw credentials are read from the gateway's private enrollment,
// not from the business encryption key or platform DB. Prefix is immutable for
// this client; no caller may list/read/write another gateway or platform path.
export function createGatewayOssStore(config: { region: string; bucket: string; accessKeyId: string; accessKeySecret: string;
  prefix: string; platformId: string; gatewayId: string }): GatewayBackupStore & { close(): void } {
  if (!/^oss-[a-z0-9-]{3,40}$/.test(config.region) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket) ||
    !/^[A-Za-z0-9]{8,128}$/.test(config.accessKeyId) || typeof config.accessKeySecret !== 'string' || config.accessKeySecret.length < 8) throw new Error('gateway OSS configuration invalid')
  const namespace = gatewayBackupPrefix(config.prefix, config.platformId, config.gatewayId), host = `${config.region}.aliyuncs.com`
  const lookup: LookupFunction = (hostname, options, callback) => {
    if (hostname !== host && hostname !== `${config.bucket}.${host}`) { callback(new Error('OSS_ENDPOINT_REJECTED'), '', 4); return }
    resolvePublicHostname(hostname).then(records => {
      if ((options as { all?: boolean }).all) (callback as Function)(null, records)
      else { const selected = records.find(row => !options.family || row.family === options.family) || records[0]; callback(null, selected.address, selected.family) }
    }).catch(() => callback(new Error('OSS_DNS_REJECTED'), '', 4))
  }
  const agent = new Agent({ keepAlive: true, maxSockets: 2, lookup })
  const client = new OSS({ region: config.region, endpoint: `https://${host}`, bucket: config.bucket, accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret, authorizationV4: true, secure: true, timeout: 60000, httpsAgent: agent } as OSS.Options & { httpsAgent: Agent })
  const target = (key: string) => {
    if (!key.startsWith(namespace) || key.length > 600 || /[\\\x00-\x1f%]/.test(key) || key.split('/').some(part => part === '..' || part === '.')) throw new Error('gateway OSS namespace denied')
  }
  return {
    async put(key, value) { target(key); if (value.length > 8 * 1024 * 1024) throw new Error('gateway object too large'); await client.put(key, value, { headers: { 'x-oss-forbid-overwrite': 'true' } }) },
    async get(key, maxBytes) {
      target(key); if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) throw new Error('gateway object limit invalid')
      const response = await client.getStream(key), chunks: Buffer[] = []; let size = 0
      try { for await (const chunk of response.stream) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > maxBytes) throw new Error('gateway object too large'); chunks.push(bytes) } }
      finally { response.stream.destroy() }
      return Buffer.concat(chunks)
    },
    async list(prefix) {
      target(prefix); const names: string[] = []; let cursor: string | undefined
      for (let page = 0; page < 20; page++) {
        const response = await client.listV2({ prefix, 'max-keys': 100, ...(cursor ? { 'continuation-token': cursor } : {}) })
        for (const object of response.objects || []) { target(object.name); names.push(object.name) }
        if (!response.isTruncated) return names
        if (!response.nextContinuationToken || response.nextContinuationToken === cursor) throw new Error('gateway cursor rejected')
        cursor = response.nextContinuationToken
      }
      throw new Error('gateway archive listing limit')
    },
    async delete(key) { target(key); await client.delete(key) },
    close() { agent.destroy() }
  }
}
