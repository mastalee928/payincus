import { prisma } from '../db/prisma.js'
import { decryptSensitiveData } from '../lib/security.js'
import { ensureDedicatedForward } from '../lib/incus/dedicated-network.js'
import { execWithOutput } from '../lib/incus/incus-instances.js'
import type { IncusClient } from '../lib/incus/incus-client.js'
import { portProtocolSelect, portProtocolView, PORT_PROTOCOL_CAPABILITY } from './host-port-protocol.js'
import { prepareDedicatedIpv6Delivery } from './host-public-ipv6-sync.js'
import type { Prisma } from '@prisma/client'
import { checkSshLogin, DedicatedSshVerificationError } from '../lib/dedicated-ssh.js'
export { checkSshLogin } from '../lib/dedicated-ssh.js'

export const DEDICATED_BANDWIDTH = '100000Mbit'

/** Verify the credentials shown to the customer, with the host key read over pinned Incus TLS. */
export async function verifyDedicatedSsh(client: IncusClient, name: string, publicIp: string, password: string): Promise<void> {
  let lastFailure = new DedicatedSshVerificationError('identityUnavailable')
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const result = await execWithOutput(client, name, ['sh', '-c',
        'for key in /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ecdsa_key.pub /etc/ssh/ssh_host_rsa_key.pub; do [ ! -f "$key" ] || ssh-keygen -lf "$key" -E sha256; done; /usr/sbin/sshd -T 2>/dev/null | grep "^passwordauthentication " || true'], {}, 15000)
      const fingerprints = result.stdout.match(/SHA256:[A-Za-z0-9+/]+/g) || []
      if (!fingerprints.length) throw new DedicatedSshVerificationError('identityUnavailable')
      try {
        // Pin all keys read through authenticated Incus, including older images
        // whose negotiated key is ECDSA/RSA rather than Ed25519.
        await checkSshLogin(publicIp, password, fingerprints)
        return
      } catch (error) {
        if (error instanceof DedicatedSshVerificationError && error.reason === 'authentication' &&
            /^passwordauthentication no$/m.test(result.stdout)) throw new DedicatedSshVerificationError('passwordDisabled')
        throw error
      }
    } catch (error) {
      // SSH/cloud-init may still be starting. Retain only controlled reasons,
      // never raw SSH errors, credentials or guest command output.
      lastFailure = error instanceof DedicatedSshVerificationError ? error : new DedicatedSshVerificationError('inspection')
    }
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  throw new Error(`公网 SSH 验证失败，实例尚未交付：${lastFailure.message}`)
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
  if (!options) {
    const ipv6 = await prepareDedicatedIpv6Delivery(client, instanceId, host.id, name)
    if (ipv6) await prisma.instance.updateMany({ where: { id: instanceId, hostId: host.id, incusId: name },
      data: { dedicatedIpv6: ipv6 as unknown as Prisma.InputJsonValue } })
  }
  return true
}
