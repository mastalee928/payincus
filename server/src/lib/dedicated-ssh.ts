import { createHash } from 'node:crypto'
import { Client } from 'ssh2'

const sshVerificationReasons = {
  timeout: '连接客户公网 SSH 超时',
  unreachable: '无法连接客户公网 SSH',
  identity: '客户公网 SSH 身份与实例内登记身份不一致',
  authentication: '客户 SSH 密码认证被拒绝',
  passwordDisabled: '镜像初始化后 SSH 仍禁用密码登录（PasswordAuthentication no）',
  identityUnavailable: '实例内尚未取得 SSH 主机公钥',
  inspection: '无法通过已认证的管理通道检查实例 SSH',
  command: '客户 SSH 登录后无法执行验证命令',
  root: '客户 SSH 登录后的身份不是 root'
} as const

export class DedicatedSshVerificationError extends Error {
  constructor(public reason: keyof typeof sshVerificationReasons) { super(sshVerificationReasons[reason]) }
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
    client.once('error', (error: Error & { level?: string }) => finish(new DedicatedSshVerificationError(
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
