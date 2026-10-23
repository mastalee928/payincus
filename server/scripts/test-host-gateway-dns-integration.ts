// The database is real; the remote installation boundary is a controlled fixture.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_expiry_test'))
assert.equal(process.env.HOST_GATEWAY_DNS_INTEGRATION_TEST, '1')
process.env.NODE_ENV = 'test'
process.env.PLATFORM_BACKUP_STATE_DIR = await mkdtemp(join(tmpdir(), 'incudal-host-dns-integration-'))
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { saveStableGatewayEndpoint } = await import('../src/services/onboarding-gateway-endpoint.js')
const { installHostGatewayDns, listHostGatewayDns } = await import('../src/services/host-gateway-dns.js')
const { OnboardingError } = await import('../src/lib/host-onboarding.js')
assert.equal(await prisma.host.count(), 0, 'empty isolated test database required')
const prefix = randomUUID(), user = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-test-hash', role: 'admin' } })
const host = await prisma.host.create({ data: { userId: user.id, name: 'dns-integration-host', url: 'https://10.253.240.2:8443',
  managementSshHost: '10.253.240.2', managementSshPort: 22, managementSshUser: 'root' } })
const batch = await prisma.hostOnboardingBatch.create({ data: { id: prefix, createdById: user.id, name: prefix, accountLabel: 'test-only', defaults: {} } })
const node = await prisma.hostOnboardingNode.create({ data: { batchId: batch.id, name: 'dns-integration-host', publicIp: prefix, hostId: host.id,
  managementIp: '10.253.240.2', sshPort: 22, sshFingerprint: 'SHA256:' + 'a'.repeat(43), nodePublicKey: 'A'.repeat(43) + '=', status: 'succeeded', credentialsExpireAt: new Date() } })
const hold = join(process.env.PLATFORM_BACKUP_STATE_DIR, 'recovery-hold.json')
let deployments = 0
const deploy = async (id: string, input: { hostname: string; nodePublicKey: string }) => {
  deployments++; assert.equal(id, node.id); assert.equal(input.nodePublicKey, node.nodePublicKey)
  return { nodeId: id, dnsRefreshInstalled: true as const, endpoint: input.hostname + ':51820', keysAndRoutesPreserved: true as const }
}
try {
  await saveStableGatewayEndpoint({ hostname: 'gateway.example.com', port: 51820 })
  await prisma.host.update({ where: { id: host.id }, data: { managementSshHost: null } })
  await assert.rejects(installHostGatewayDns(node.id, user.id, deploy), /GATEWAY_DNS_MANAGEMENT_REQUIRED/)
  assert.equal(deployments, 0)
  await prisma.host.update({ where: { id: host.id }, data: { managementSshHost: node.managementIp } })
  await writeFile(hold, '{}')
  await assert.rejects(installHostGatewayDns(node.id, user.id, deploy), /GATEWAY_DNS_NOT_READY/)
  await unlink(hold)
  await assert.rejects(installHostGatewayDns(node.id, user.id, async () => { throw new OnboardingError('SSH_HOST_KEY_CHANGED') }), /SSH_HOST_KEY_CHANGED/)
  let view = (await listHostGatewayDns())[0]
  assert.equal(view.installed, false); assert.equal(view.error, 'SSH_HOST_KEY_CHANGED')
  let enter: () => void = () => {}, release: () => void = () => {}
  const entered = new Promise<void>(resolve => { enter = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  const first = installHostGatewayDns(node.id, user.id, async (...args) => { enter(); await gate; return deploy(...args) })
  await entered
  await assert.rejects(installHostGatewayDns(node.id, user.id, deploy), /GATEWAY_DNS_HOST_BUSY/)
  assert.equal((await listHostGatewayDns())[0].running, true)
  release(); await first
  view = (await listHostGatewayDns())[0]
  assert.equal(view.installed, true); assert.equal(view.running, false); assert.equal(view.error, null); assert.equal(deployments, 1)
  await prisma.hostOnboardingNode.update({ where: { id: node.id }, data: { sshFingerprint: 'SHA256:' + 'b'.repeat(43) } })
  assert.equal((await listHostGatewayDns())[0].installed, false, 'changed host identity invalidates a historical installation receipt')
  await prisma.hostOnboardingNode.update({ where: { id: node.id }, data: { sshFingerprint: node.sshFingerprint } })
  await saveStableGatewayEndpoint({ hostname: 'new.example.com', port: 51820 })
  assert.equal((await listHostGatewayDns())[0].installed, false, 'changing settings must not claim old host deployment matches')
  console.log(JSON.stringify({ passed: true, realPostgres: true, remoteFixture: true, pinnedIdentityPassed: true,
    recoveryHeld: true, failurePersisted: true, retrySucceeded: true, concurrentDeploymentDenied: true, staleEndpointNotReady: true }))
} finally {
  await prisma.systemConfig.deleteMany({ where: { key: { in: ['onboarding_gateway_dns_endpoint', 'onboarding_gateway_dns_host_' + node.id] } } })
  await prisma.hostOnboardingBatch.delete({ where: { id: batch.id } })
  await prisma.host.delete({ where: { id: host.id } }); await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
process.exit(0)
