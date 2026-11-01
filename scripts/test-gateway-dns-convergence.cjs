// Real endpoint/queue services with controlled storage and SSH boundaries.
// This does not claim PostgreSQL, Linux file ownership or WireGuard evidence.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('../server/node_modules/typescript')
function load(relative, imports = {}) {
  const file = path.resolve(__dirname, '..', relative), module = { exports: {} }
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', output)(name => {
    if (name in imports) return imports[name]
    if (name.startsWith('node:') || name === 'net') return require(name)
    throw new Error('Unexpected dependency ' + name)
  }, module, module.exports)
  return module.exports
}
const onboarding = load('server/src/lib/host-onboarding.ts')
const domain = load('server/src/lib/onboarding-gateway-endpoint.ts', { './host-onboarding.js': onboarding })
const queue = load('server/src/lib/gateway-dns-queue.ts')
const records = new Map()
const node = { id: '11111111-1111-4111-8111-111111111111', name: 'isolated fixture', deletedAt: null, status: 'succeeded',
  managementIp: '10.253.240.2', sshPort: 22, sshFingerprint: 'fixture', nodePublicKey: 'fixture',
  host: { id: 1, managementSshHost: '10.253.240.2', managementSshPort: 22 } }
let administrator = { role: 'admin', status: 'active' }, hold = false, transactions = Promise.resolve()
const prisma = {
  systemConfig: {
    findUnique: async ({ where }) => records.get(where.key) || null,
    findMany: async ({ where }) => [...records.values()].filter(row => where.key.in ? where.key.in.includes(row.key) : row.key.startsWith(where.key.startsWith)),
    upsert: async ({ where, create, update }) => {
      const row = { ...(records.get(where.key) || create), ...update, updatedAt: new Date() }
      records.set(where.key, row); return row
    }
  },
  user: { findUnique: async () => administrator },
  hostOnboardingNode: { findMany: async () => [node], findUnique: async () => node },
  instanceTask: { count: async () => 0 }, restoreTask: { count: async () => 0 },
  $executeRaw: async () => 1,
  $transaction: work => {
    if (Array.isArray(work)) return Promise.all(work)
    const next = transactions.catch(() => {}).then(() => work(prisma)); transactions = next; return next
  }
}
const endpoint = load('server/src/services/onboarding-gateway-endpoint.ts', {
  '../db/prisma.js': { prisma }, '../lib/host-onboarding.js': onboarding, '../lib/onboarding-gateway-endpoint.js': domain,
  '../db/user-write-authorization.js': { authorizeUserWrite: () => { throw new Error('Web session authorization belongs to the real PostgreSQL channel test') } }
})
const imports = { '../db/prisma.js': { prisma }, '../lib/host-onboarding.js': onboarding,
  './platform-backup-core.js': { recoveryHeld: () => hold }, './onboarding-gateway-endpoint.js': endpoint,
  './onboarding-ssh.js': { gatewayConfigured: () => true, installGatewayHostDns: () => { throw new Error('Unexpected real deployment') } },
  '../lib/gateway-dns-queue.js': queue }
const createService = () => load('server/src/services/host-gateway-dns.ts', imports)
const key = 'onboarding_gateway_dns_host_' + node.id
const state = () => JSON.parse(records.get(key).value)
const setState = value => records.set(key, { key, value: JSON.stringify(value), updatedAt: new Date() })
const deploy = async (id, input) => ({ nodeId: id, endpoint: input.hostname + ':' + input.port, revision: input.revision,
  dnsRefreshInstalled: true, keysAndRoutesPreserved: true })
async function main() {
  let service = createService()
  await endpoint.saveStableGatewayEndpoint({ hostname: 'old.example.com', port: 51820 }, 1, '')
  let release, enter
  const gate = new Promise(resolve => { release = resolve }), entered = new Promise(resolve => { enter = resolve })
  const first = service.installHostGatewayDns(node.id, 1, async (id, input) => { enter(); await gate; return deploy(id, input) })
  await entered
  await endpoint.saveStableGatewayEndpoint({ hostname: 'new.example.com', port: 51820 }, 1, 'old.example.com')
  assert.equal((await service.queueHostGatewayDns(1)).queued, 0)
  release(); await first
  let view = (await service.listHostGatewayDns())[0]
  assert.equal(view.installed, false); assert.equal(view.state, 'queued'); assert.equal(view.appliedRevision, 1); assert.equal(view.desiredRevision, 2)
  await service.dispatchHostGatewayDns(deploy)
  assert.equal((await service.listHostGatewayDns())[0].installed, true)
  // A crash after saving settings but before enqueue is recovered from storage.
  await endpoint.saveStableGatewayEndpoint({ hostname: 'third.example.com', port: 51820 }, 1, 'new.example.com')
  service = createService()
  await service.dispatchHostGatewayDns(deploy)
  assert.equal(state().revision, 3); assert.equal(state().state, 'succeeded')
  // Stale admin tabs cannot overwrite a newer accepted domain; unchanged saves
  // are idempotent and preserve the generation needed by host replay protection.
  await assert.rejects(endpoint.saveStableGatewayEndpoint({ hostname: 'late.example.com', port: 51820 }, 1, 'new.example.com'), /SETTINGS_CONFLICT/)
  await endpoint.saveStableGatewayEndpoint({ hostname: 'third.example.com', port: 51820 }, 1, 'third.example.com')
  assert.equal((await endpoint.loadGatewayEndpointPlan()).revision, 3)
  await assert.rejects(endpoint.saveStableGatewayEndpoint({ hostname: 'third.example.com', port: 51821 }, 1), /PORT_CONFLICT/)
  // A transient disconnect resumes after restart and applies precisely once.
  await endpoint.saveStableGatewayEndpoint({ hostname: 'fourth.example.com', port: 51820 }, 1)
  let deployments = 0
  await service.dispatchHostGatewayDns(async () => { deployments++; throw new onboarding.OnboardingError('SSH_DISCONNECTED') })
  assert.equal(state().state, 'queued'); assert.equal(state().attempt, 1); assert.ok(state().retryAt > Date.now())
  await service.dispatchHostGatewayDns(deploy)
  assert.equal(deployments, 1); assert.equal(state().attempt, 1)
  setState({ ...state(), retryAt: 0 })
  service = createService()
  await service.dispatchHostGatewayDns(deploy)
  assert.equal(state().revision, 4); assert.equal(state().state, 'succeeded')
  // Interrupted running work retries without falsely claiming success.
  setState({ ...state(), installed: false, state: 'running', attempt: 1 })
  service = createService()
  await service.dispatchHostGatewayDns(deploy)
  assert.equal(state().state, 'queued'); assert.equal(state().code, 'GATEWAY_DNS_INTERRUPTED')
  setState({ ...state(), retryAt: 0 })
  await service.dispatchHostGatewayDns(deploy)
  assert.equal(state().state, 'succeeded')
  // Lost/mismatched remote receipts never count as applied; fatal identity
  // failures are retained and do not silently reset trust or retry forever.
  await endpoint.saveStableGatewayEndpoint({ hostname: 'fifth.example.com', port: 51820 }, 1)
  await service.dispatchHostGatewayDns(async () => { throw new onboarding.OnboardingError('GATEWAY_DNS_HOST_IDENTITY_CHANGED') })
  assert.equal(state().state, 'failed')
  const failed = records.get(key).value
  await service.dispatchHostGatewayDns(deploy)
  assert.equal(records.get(key).value, failed)
  await service.queueHostGatewayDns(1, node.id)
  await service.dispatchHostGatewayDns(async (id, input) => ({ ...await deploy(id, input), revision: input.revision - 1 }))
  assert.equal(state().code, 'GATEWAY_DNS_INSTALL_FAILED'); assert.equal(state().state, 'failed')
  // Hosts offline longer than the fast burst retain a slower durable retry.
  setState({ ...state(), state: 'queued', attempt: queue.GATEWAY_DNS_MAX_ATTEMPTS - 1, retryAt: 0 })
  await service.dispatchHostGatewayDns(async () => { throw new onboarding.OnboardingError('SSH_CONNECT_FAILED') })
  assert.equal(state().state, 'queued'); assert.equal(state().attempt, queue.GATEWAY_DNS_MAX_ATTEMPTS)
  assert.ok(state().retryAt >= Date.now() + 890000)
  service = createService(); await service.dispatchHostGatewayDns(deploy)
  assert.equal(state().state, 'queued')
  setState({ ...state(), retryAt: 0 })
  await service.dispatchHostGatewayDns(deploy)
  assert.equal(state().state, 'succeeded'); assert.equal(state().revision, 5)
  // Recovery holds and revoked admins produce no remote writes.
  await endpoint.saveStableGatewayEndpoint({ hostname: 'sixth.example.com', port: 51820 }, 1)
  await service.queueHostGatewayDns(1, node.id)
  hold = true
  await service.dispatchHostGatewayDns(async () => { throw new Error('must not run while held') })
  assert.equal(state().state, 'queued'); hold = false
  administrator = { role: 'user', status: 'active' }
  await service.dispatchHostGatewayDns(async () => { throw new Error('must not run after admin revocation') })
  assert.equal(state().code, 'GATEWAY_DNS_ADMIN_REQUIRED')
  const revoked = records.get(key).value
  service = createService(); await service.dispatchHostGatewayDns(deploy)
  assert.equal(records.get(key).value, revoked, 'revocation must not be automatically requeued forever')
  console.log('Gateway domain convergence: concurrent revisions, lost enqueue/restart, bounded retries, stale receipts, identity/recovery/permission protection passed (controlled DB and SSH)')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
