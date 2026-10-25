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
const { installHostGatewayDns, listHostGatewayDns, queueHostGatewayDns, dispatchHostGatewayDns } = await import('../src/services/host-gateway-dns.js')
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
  // A thousand real persisted rows, with the SSH installation boundary injected.
  // Never counted as a thousand real WireGuard hosts.
  const bulk = Array.from({ length: 1000 }, (_, index) => ({ id: randomUUID(), hostId: 10000 + index,
    managementIp: `10.240.${Math.floor(index / 254)}.${index % 254 + 1}`, name: `dns-queue-${index}` }))
  await prisma.host.createMany({ data: bulk.map(item => ({ id: item.hostId, userId: user.id, name: item.name,
    url: `https://${item.managementIp}:8443`, managementSshHost: item.managementIp, managementSshPort: 22, managementSshUser: 'root' })) })
  await prisma.hostOnboardingNode.createMany({ data: bulk.map(item => ({ id: item.id, batchId: batch.id, name: item.name,
    publicIp: item.id, hostId: item.hostId, managementIp: item.managementIp, sshPort: 22, sshFingerprint: node.sshFingerprint,
    nodePublicKey: node.nodePublicKey, status: 'succeeded', credentialsExpireAt: new Date() })) })
  await queueHostGatewayDns(user.id)
  assert.equal((await listHostGatewayDns()).filter(item => item.state === 'queued').length, 1001)
  const keys = bulk.map(item => 'onboarding_gateway_dns_host_' + item.id)
  for (let offset = 0; offset < keys.length; offset += 40) await prisma.$transaction(keys.slice(offset, offset + 40).map(key =>
    prisma.systemConfig.update({ where: { key }, data: { value: JSON.stringify({ state: 'running', actor: user.id, attempt: 1, step: 'install' }) } })))
  Object.assign(process.env, { ONBOARDING_GATEWAY_HOST: 'fixture', ONBOARDING_GATEWAY_KEY_PATH: 'fixture',
    ONBOARDING_GATEWAY_FINGERPRINT: 'fixture', ONBOARDING_WG_ENDPOINT: 'fixture:51820' })
  let inFlight = 0, maximum = 0, completed = 0
  const bulkDeploy = async (id: string, input: { hostname: string }) => {
    inFlight++; maximum = Math.max(maximum, inFlight)
    await new Promise(resolve => setTimeout(resolve, 5))
    inFlight--; completed++
    return { nodeId: id, dnsRefreshInstalled: true as const, endpoint: input.hostname + ':51820', keysAndRoutesPreserved: true as const }
  }
  await dispatchHostGatewayDns(bulkDeploy)
  const resumed = await prisma.systemConfig.findMany({ where: { key: { in: keys } } })
  assert.equal(resumed.filter(item => JSON.parse(item.value).state === 'queued').length, 1000, 'all interrupted jobs resume after restart')
  assert.equal(resumed.filter(item => JSON.parse(item.value).code === 'GATEWAY_DNS_INTERRUPTED').length, 1000)
  for (let offset = 0; offset < resumed.length; offset += 40) await prisma.$transaction(resumed.slice(offset, offset + 40).map(row =>
    prisma.systemConfig.update({ where: { key: row.key }, data: { value: JSON.stringify({ ...JSON.parse(row.value), retryAt: 0 }) } })))
  for (let pass = 0; pass < 251; pass++) await dispatchHostGatewayDns(bulkDeploy)
  assert.equal((await listHostGatewayDns()).filter(item => item.installed).length, 1001)
  assert.equal(maximum, 4, 'exactly four installation lanes at most')
  assert.equal(completed, 1001)
  console.log(JSON.stringify({ passed: true, realPostgres: true, remoteFixture: true, pinnedIdentityPassed: true,
    recoveryHeld: true, failurePersisted: true, retrySucceeded: true, concurrentDeploymentDenied: true, staleEndpointNotReady: true,
    thousandPersistentQueue: true, restartResumed: true, maximumParallelism: maximum }))
} finally {
  await prisma.systemConfig.deleteMany({ where: { OR: [{ key: 'onboarding_gateway_dns_endpoint' }, { key: { startsWith: 'onboarding_gateway_dns_host_' } }] } })
  await prisma.hostOnboardingBatch.delete({ where: { id: batch.id } })
  await prisma.host.deleteMany({ where: { userId: user.id } }); await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
process.exit(0)
