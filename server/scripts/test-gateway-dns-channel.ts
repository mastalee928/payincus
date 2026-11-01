import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from 'pg'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && /_test$/.test(database.pathname), 'Use isolated local test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { withGatewayDnsWriteAuthorization, ensureGatewayDnsChannel } = await import('../src/services/gateway-dns-channel.js')
const { saveStableGatewayEndpoint } = await import('../src/services/onboarding-gateway-endpoint.js')
const holder = new Client({ connectionString: database.href }), observer = new Client({ connectionString: database.href })
const admin = await prisma.user.create({ data: { username: 'gateway-channel-' + randomUUID(), passwordHash: 'unusable', role: 'admin' } })
const actor = { id: admin.id, sid: randomUUID(), iat: Math.floor(Date.now() / 1000) + 1 }
let calls = 0
const apply = async () => { calls++; return { preserved: true } }
const env = process.env.ONBOARDING_GATEWAY_HOST
const gateway = { endpoint: 'old.example.com:51820', sshHost: '8.8.4.4', publicKey: 'fixture', controlIp: '10.253.240.1', network: '10.253.240.0/20', managementSshPublicKey: 'fixture' }
try {
  await holder.connect(); await observer.connect()
  const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number
  assert.deepEqual(await withGatewayDnsWriteAuthorization(actor, apply), { preserved: true })
  assert.equal(calls, 1)
  for (const session of [{ id: admin.id }, { ...actor, sid: undefined }, { ...actor, iat: undefined }]) {
    await assert.rejects(withGatewayDnsWriteAuthorization(session, apply), /WEB_SESSION_REQUIRED/)
  }
  await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
  await assert.rejects(withGatewayDnsWriteAuthorization(actor, apply), /WEB_SESSION_REQUIRED/)
  await assert.rejects(saveStableGatewayEndpoint({ hostname: 'new.example.com', port: 51820 }, actor.id, undefined, undefined, actor), /WEB_SESSION_REQUIRED/)
  assert.equal(calls, 1)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
  await assert.rejects(withGatewayDnsWriteAuthorization(actor, apply), /WEB_SESSION_REQUIRED/)
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  // A revocation that holds the account lock wins over a request already waiting.
  await holder.query('BEGIN')
  await holder.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [admin.id])
  const waiting = assert.rejects(withGatewayDnsWriteAuthorization(actor, apply), /WEB_SESSION_REQUIRED/)
  let deadline = Date.now() + 1500
  while (!(await observer.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting', [pid])).rows[0].waiting) {
    assert.ok(Date.now() < deadline, 'helper write must wait for the administrator lock'); await delay(10)
  }
  await holder.query('UPDATE users SET role=$1 WHERE id=$2', ['user', admin.id]); await holder.query('COMMIT'); await waiting
  assert.equal(calls, 1)
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  // Once authorized, the lock stays held until the fixed remote operation ends.
  let begin!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { begin = resolve }), paused = new Promise<void>(resolve => { release = resolve })
  const running = withGatewayDnsWriteAuthorization(actor, async () => { calls++; begin(); await paused; return true })
  await started
  const revocation = holder.query('UPDATE users SET role=$1 WHERE id=$2', ['user', admin.id])
  deadline = Date.now() + 1500
  try {
    while (!(await observer.query('SELECT cardinality(pg_blocking_pids($1))>0 AS waiting', [pid])).rows[0].waiting) {
      assert.ok(Date.now() < deadline, 'role revocation must wait for the in-flight remote operation'); await delay(10)
    }
  } finally { release() }
  assert.equal(await running, true); await revocation
  await assert.rejects(withGatewayDnsWriteAuthorization(actor, apply), /WEB_SESSION_REQUIRED/)
  assert.equal(calls, 2)
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  const auditCount = await prisma.log.count({ where: { userId: admin.id, action: 'gateway.dns.channel.updated' } })
  await assert.rejects(withGatewayDnsWriteAuthorization(actor, async () => { throw new Error('controlled lost remote receipt') }), /controlled lost remote receipt/)
  assert.equal(await prisma.log.count({ where: { userId: admin.id, action: 'gateway.dns.channel.updated' } }), auditCount + 1,
    'a remote failure must not roll back the durable operation audit')
  assert.equal((await prisma.log.findFirstOrThrow({ where: { userId: admin.id, action: 'gateway.dns.channel.updated' }, orderBy: { id: 'desc' } })).result, 'failed')
  process.env.ONBOARDING_GATEWAY_HOST = '8.8.4.4'
  await assert.rejects(ensureGatewayDnsChannel(gateway, undefined, actor), /HELPER_UPGRADE_REQUIRED/)
  process.env.ONBOARDING_GATEWAY_HOST = '127.0.0.1'
  await assert.rejects(ensureGatewayDnsChannel(gateway, 'must-not-use-local-ssh', actor), /LOCAL_HELPER_OUTDATED/)
  console.log('Gateway DNS helper upgrade: real PG sid/iat and role revocation, both lock orderings, zero unauthorized remote actions, local/remote credential boundary passed')
} finally {
  if (env === undefined) delete process.env.ONBOARDING_GATEWAY_HOST; else process.env.ONBOARDING_GATEWAY_HOST = env
  await holder.query('ROLLBACK').catch(() => {})
  await holder.end(); await observer.end()
  await prisma.log.deleteMany({ where: { userId: admin.id } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  await prisma.user.delete({ where: { id: admin.id } })
  await closePrismaDatabase()
}
