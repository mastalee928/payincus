import { createHash } from 'node:crypto'
import { Client } from 'ssh2'
import { prisma } from '../db/prisma.js'
import { decryptSensitiveData } from '../lib/security.js'
import { ensureDedicatedForward } from '../lib/incus/dedicated-network.js'
import { execWithOutput } from '../lib/incus/incus-instances.js'
import type { IncusClient } from '../lib/incus/incus-client.js'
import { portProtocolSelect, portProtocolView, PORT_PROTOCOL_CAPABILITY } from './host-port-protocol.js'

export const DEDICATED_BANDWIDTH = '100000Mbit'

export function checkSshLogin(host: string, password: string, fingerprint: string): Promise<void> {
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
    const timer = setTimeout(() => finish(new Error('SSH connection timed out')), 12000)
    client.once('error', () => finish(new Error('Public SSH login failed')))
    client.once('ready', () => client.exec('id -u', (error, stream) => {
      if (error) return finish(new Error('SSH verification command failed'))
      let output = ''
      stream.on('data', (data: Buffer) => { output += data.toString() })
      stream.on('close', (code: number) => finish(code === 0 && output.trim() === '0' ? undefined : new Error('SSH user verification failed')))
    }))
    client.connect({ host, port: 22, username: 'root', password, readyTimeout: 10000,
      hostVerifier: (key: Buffer) => `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}` === fingerprint })
  })
}

/** Verify the credentials shown to the customer, with the host key read over pinned Incus TLS. */
export async function verifyDedicatedSsh(client: IncusClient, name: string, publicIp: string, password: string): Promise<void> {
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const result = await execWithOutput(client, name, ['sh', '-c',
        'for key in /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_rsa_key.pub; do [ ! -f "$key" ] || ssh-keygen -lf "$key" -E sha256; done'], {}, 15000)
      const fingerprints = result.stdout.match(/SHA256:[A-Za-z0-9+/]+/g) || []
      if (fingerprints.length) {
        // ssh2 prefers ed25519 when available; pin exactly that public host key.
        await checkSshLogin(publicIp, password, fingerprints[0]!)
        return
      }
    } catch { /* SSH and cloud-init may not be ready on the first attempt. */ }
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  throw new Error('公网 SSH 验证失败，实例尚未交付')
}

export async function prepareDedicatedDelivery(client: IncusClient, instanceId: number, options?: {
  hostId: number; name: string; ipv4: string; password: string
}): Promise<boolean> {
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } })
  if (!instance.dedicatedIpv4) return false
  const host = await prisma.host.findUniqueOrThrow({ where: { id: options?.hostId ?? instance.hostId }, select: {
    id: true, singleTenant: true, natPublicIp: true, natBindIp: true, poolFaulted: true,
    ...portProtocolSelect, onboardingNode: { select: { status: true, managementIp: true } },
    agent: { select: { enabled: true, capabilities: true, lastSeenAt: true } }
  } })
  if (!host.singleTenant || (host.poolFaulted && !options) || !host.natPublicIp || !host.natBindIp ||
      host.onboardingNode?.status !== 'succeeded' || !host.onboardingNode.managementIp) {
    throw new Error('独占主机管理通道或公网配置未就绪')
  }
  if (!host.agent?.enabled || !Array.isArray(host.agent.capabilities) || !host.agent.capabilities.includes(PORT_PROTOCOL_CAPABILITY)) {
    throw new Error('请先更新宿主机 Agent 以启用独占交付')
  }
  // Never expose UDP before the requested TCP-only policy is acknowledged.
  for (let attempt = 0; ; attempt++) {
    const current = await prisma.host.findUniqueOrThrow({ where: { id: host.id }, select: portProtocolSelect })
    if (portProtocolView(current).status === 'applied') break
    if (attempt >= 20 || current.portProtocolError) throw new Error('宿主机公网协议尚未应用')
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  const name = options?.name ?? instance.incusId
  const ipv4 = options?.ipv4 ?? instance.ipv4
  const password = options?.password ?? (instance.rootPassword ? decryptSensitiveData(instance.rootPassword) : null)
  if (!ipv4 || !password) throw new Error('实例地址或 SSH 密码未就绪')
  await ensureDedicatedForward(client, name, host.natBindIp, ipv4)
  await verifyDedicatedSsh(client, name, host.natPublicIp, password)
  return true
}
