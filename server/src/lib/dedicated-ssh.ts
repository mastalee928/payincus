import { createHash } from 'node:crypto'
import { Client } from 'ssh2'

const sshVerificationReasons = {
  timeout: '连接客户公网 SSH 超时',
  unreachable: '无法连接客户公网 SSH',
  identity: '客户公网 SSH 身份与实例内登记身份不一致',
  authentication: '客户 SSH 密码认证被拒绝',
  passwordDisabled: '镜像初始化后 SSH 仍禁用密码登录（PasswordAuthentication no）',
  securityPatch: 'Alpine SSH 安全补丁尚未安装，保留密码登录并等待安全初始化完成',
  identityUnavailable: '实例内尚未取得 SSH 主机公钥',
  inspection: '无法通过已认证的管理通道检查实例 SSH',
  networkProtection: '宿主客户网络防护尚未就绪，等待自动修复后继续公网验收',
  command: '客户 SSH 登录后无法执行验证命令',
  root: '客户 SSH 登录后的身份不是 root'
} as const

export class DedicatedSshVerificationError extends Error {
  constructor(public reason: keyof typeof sshVerificationReasons) { super(sshVerificationReasons[reason]) }
}

/** Keep an authenticated customer session open across a package reload. Password
 * is only sent after the Incus-pinned key matches; no password reset is attempted.
 */
export async function holdCustomerSshSession(host: string, password: string, fingerprints: string[], port = 22) {
  const client = new Client()
  let closed = false
  client.on('error', () => { closed = true })
  client.on('close', () => { closed = true })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { client.destroy(); reject(new DedicatedSshVerificationError('timeout')) }, 12000)
    client.once('error', () => { clearTimeout(timer); reject(new DedicatedSshVerificationError('unreachable')) })
    client.once('ready', () => { clearTimeout(timer); resolve() })
    client.connect({ host, port, username: 'root', password, readyTimeout: 10000,
      keepaliveInterval: 5000, keepaliveCountMax: 2,
      hostVerifier: (key: Buffer) => fingerprints.includes(`SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`) })
  })
  const verify = () => new Promise<void>((resolve, reject) => {
    if (closed) { reject(new DedicatedSshVerificationError('unreachable')); return }
    const timer = setTimeout(() => { client.destroy(); reject(new DedicatedSshVerificationError('timeout')) }, 12000)
    client.exec('id -u', (error, stream) => {
      if (error) { clearTimeout(timer); reject(new DedicatedSshVerificationError('command')); return }
      let output = ''
      stream.on('data', (data: Buffer) => { output = (output + data.toString()).slice(0, 128) })
      stream.once('error', () => { clearTimeout(timer); reject(new DedicatedSshVerificationError('command')) })
      stream.once('close', (code: number) => {
        clearTimeout(timer)
        if (closed || code !== 0 || output.trim() !== '0') reject(new DedicatedSshVerificationError('command'))
        else resolve()
      })
    })
  })
  try { await verify() } catch (error) { client.destroy(); throw error }
  return { verify, close: () => client.end() }
}

/** Verify the exact customer password only after the Incus-pinned key matches. */
export function checkSshLogin(host: string, password: string, fingerprint: string | string[], port = 22): Promise<void> {
  const fingerprints = Array.isArray(fingerprint) ? fingerprint : [fingerprint]
  return new Promise((resolve, reject) => {
    const client = new Client()
    let finished = false
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      client.end()
      error ? reject(error) : resolve()
    }
    const timer = setTimeout(() => finish(new DedicatedSshVerificationError('timeout')), 12000)
    // ssh2 can emit a protocol error after its initial handshake/socket error.
    // Keep the idempotent handler for the entire client lifetime, including end.
    client.on('error', (error: Error & { level?: string }) => finish(new DedicatedSshVerificationError(
      error.level === 'client-authentication' ? 'authentication' : 'unreachable')))
    client.once('ready', () => client.exec('id -u', (error, stream) => {
      if (error) return finish(new DedicatedSshVerificationError('command'))
      let output = ''
      stream.on('data', (data: Buffer) => { output = (output + data.toString()).slice(0, 128) })
      stream.on('error', () => finish(new DedicatedSshVerificationError('command')))
      stream.on('close', (code: number) => finish(code !== 0 ? new DedicatedSshVerificationError('command') :
        output.trim() === '0' ? undefined : new DedicatedSshVerificationError('root')))
    }))
    client.connect({ host, port, username: 'root', password, readyTimeout: 10000,
      hostVerifier: (key: Buffer) => {
        const matched = fingerprints.includes(`SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`)
        if (!matched) finish(new DedicatedSshVerificationError('identity'))
        return matched
      } })
  })
}
