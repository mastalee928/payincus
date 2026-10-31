import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID, X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:https'
import pg from 'pg'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'),
  'Use an isolated local *_pool_test database')
process.env.JWT_SECRET ||= 'batch-port-range-isolated-fixture-secret'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: instanceRoutes } = await import('../src/routes/instances.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const tag = `port-range-${randomUUID().slice(0, 12)}`
const root = await mkdtemp(join(tmpdir(), 'payincus-batch-port-range-'))
const certificatePath = join(root, 'cert.pem'), keyPath = join(root, 'key.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=localhost', '-keyout', keyPath, '-out', certificatePath], { stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certificatePath, 'utf8')
const calls: string[] = []
let devices: Record<string, Record<string, string>> = {}
let rejectNextDeviceWrite = false
const server = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate,
  requestCert: true, rejectUnauthorized: true }, async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk
  calls.push(`${request.method} ${request.url}`)
  const send = (metadata: unknown, code = 200) => {
    response.writeHead(code, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ type: code === 200 ? 'sync' : 'error', metadata, error: code === 200 ? '' : 'Unknown fixture path' }))
  }
  if (request.url === '/1.0') return send({ api_version: '1.0' })
  if (request.url === `/1.0/instances/${tag}` && request.method === 'GET') return send({ name: tag, devices, config: {}, status: 'Running' })
  if (request.url === `/1.0/instances/${tag}` && request.method === 'PUT') {
    if (rejectNextDeviceWrite) {
      rejectNextDeviceWrite = false
      return send({}, 500)
    }
    devices = JSON.parse(body).devices
    return send({})
  }
  return send({}, 404)
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture', balance: 100 } })
const host = await prisma.host.create({ data: { userId: user.id, name: tag, url: `https://127.0.0.1:${port}`,
  certPath: certificatePath, keyPath, serverCertificate: certificate, serverFingerprint: new X509Certificate(certificate).fingerprint256,
  natPortStart: 10000, natPortEnd: 10100, natPublicIp: '127.0.0.1', status: 'online' } })
const instance = await prisma.instance.create({ data: { userId: user.id, hostId: host.id, name: tag, incusId: tag,
  image: 'fixture/debian', status: 'running', cpu: 100, memory: 512, disk: 1024, networkMode: 'nat', portLimit: 12 } })
const actor = { id: user.id, username: tag, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
const app = Fastify()
const auditFailureTrigger = 'port_audit_' + randomUUID().replaceAll('-', '')
const releaseTrigger = 'port_release_' + randomUUID().replaceAll('-', '')
for (const hook of ['authenticate', 'authenticateUser', 'authenticateAdmin', 'requireAdmin']) {
  app.decorate(hook, async (request: any) => { request.user = { ...actor } })
}
const url = `/instances/${instance.id}/ports/batch`
const submit = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url, payload })
// Block the real DELETE, rather than sleeping after a response and hoping cleanup finished.
async function responseAfterRelease<T>(send: () => PromiseLike<T>): Promise<T> {
  const blocker = new pg.Client({ connectionString: database.href })
  await blocker.connect()
  let pending: Promise<T> | undefined
  try {
    await blocker.query('BEGIN')
    await blocker.query('SELECT pg_advisory_xact_lock(904273, $1::integer)', [instance.id])
    const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    let responded = false
    pending = Promise.resolve(send()).then(response => { responded = true; return response })
    const deadline = Date.now() + 5000
    let waiting = false
    while (Date.now() < deadline) {
      // A separate autocommit observer avoids reusing the blocker's statistics snapshot.
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND ${blockerPid}::integer = ANY(pg_blocking_pids(pid))) AS waiting`
      if (rows[0].waiting) { waiting = true; break }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.ok(waiting, 'the actual per-instance lock DELETE must reach the database barrier')
    assert.equal(responded, false, 'HTTP response must await actual per-instance lock release')
    await blocker.query('ROLLBACK')
    const response = await pending
    assert.equal(await prisma.distributedLock.count({ where: { lockKey: `instance:${instance.id}:port-mappings` } }), 0)
    return response
  } finally {
    try {
      await blocker.query('ROLLBACK')
      await pending
    } finally { await blocker.end() }
  }
}
const full = [0, 1, 2].map(offset => ({ privatePort: 10010 + offset, publicPort: 10030 + offset }))
const base = { protocol: 'tcp', privatePortStart: 10010, privatePortEnd: 10012 }
const snapshot = async () => ({
  mappings: await prisma.portMapping.findMany({ where: { instanceId: instance.id }, orderBy: { id: 'asc' } }),
  balance: (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance.toFixed(2),
  hostCount: (await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).natPortsUsedCount,
  logs: await prisma.log.count({ where: { instanceId: instance.id } }),
  billing: await prisma.instanceBillingRecord.count({ where: { instanceId: instance.id } }),
  calls: calls.length, devices: structuredClone(devices)
})
async function rejected(payload: Record<string, unknown>, expectedCode?: string, status = 400, blockRelease = false) {
  const before = await snapshot()
  const response = blockRelease ? await responseAfterRelease(() => submit(payload)) : await submit(payload)
  assert.equal(response.statusCode, status, response.body)
  if (expectedCode) assert.equal(response.json().code || response.json().error, expectedCode, response.body)
  assert.deepEqual(await snapshot(), before, 'rejected input must not change mappings, accounts, logs, host count or remote devices')
  assert.equal(await prisma.distributedLock.count({ where: { lockKey: `instance:${instance.id}:port-mappings` } }), 0,
    'validation releases the per-instance port lock')
  return response
}
try {
  await app.register(instanceRoutes, { prefix: '/instances' })
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${releaseTrigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.lock_key = 'instance:${instance.id}:port-mappings' THEN PERFORM pg_advisory_xact_lock(904273, ${instance.id}); END IF; RETURN OLD; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${releaseTrigger} BEFORE DELETE ON distributed_locks FOR EACH ROW EXECUTE FUNCTION ${releaseTrigger}()`)
  await rejected({ ...base, portMappings: [] })
  await rejected({ ...base, portMappings: null })
  await rejected({ ...base, portMappings: full.slice(0, 2) }, 'PORT_RANGE_MISMATCH')
  await rejected({ ...base, portMappings: [...full, { privatePort: 10013, publicPort: 10033 }] }, 'PORT_RANGE_MISMATCH')
  await rejected({ ...base, portMappings: [{ privatePort: 10009, publicPort: 10030 }, ...full.slice(1)] }, 'PORT_RANGE_MISMATCH')
  await rejected({ ...base, protocol: 'both', portMappings: [full[0], full[1], { privatePort: 10013, publicPort: 10032 }] }, 'PORT_RANGE_MISMATCH')
  await rejected({ ...base, portMappings: [full[0], full[1], { privatePort: 10011, publicPort: 10032 }] }, 'INVALID_PARAMS')
  await rejected({ ...base, portMappings: [full[0], full[1], { privatePort: 10012, publicPort: 10031 }] }, 'INVALID_PARAMS')
  await rejected({ ...base, portMappings: [full[0], full[1], { privatePort: 10012, publicPort: 10101 }] }, 'PORT_RANGE_INVALID')
  for (const protocol of ['tcp', 'udp', 'both']) for (const publicPort of [9999, 10101]) {
    await rejected({ ...base, protocol, portMappings: [full[0], full[1], { privatePort: 10012, publicPort }] }, 'PORT_RANGE_INVALID')
  }
  await rejected({ ...base, portMappings: [{ privatePort: 10010 }, ...full.slice(1)] })
  await rejected({ ...base, portMappings: [{ privatePort: 65536, publicPort: 10030 }, ...full.slice(1)] })
  await rejected({ ...base, privatePortStart: 10012, privatePortEnd: 10010, portMappings: full })
  await rejected({ ...base, portMappings: Array.from({ length: 101 }, (_, index) => ({ privatePort: 10000 + index, publicPort: 10000 + index })) })

  // Both still consumes two rows per mapping; the complete array does not bypass quota.
  await prisma.instance.update({ where: { id: instance.id }, data: { portLimit: 5 } })
  const quota = await rejected({ ...base, protocol: 'both', portMappings: full }, 'QUOTA_PORT_BATCH_EXCEEDED', 400, true)
  assert.equal(quota.json().needed, 6)
  await prisma.instance.update({ where: { id: instance.id }, data: { portLimit: 12 } })
  const both = await responseAfterRelease(() => submit({ ...base, protocol: 'both', portMappings: [full[2], full[0], full[1]] }))
  assert.equal(both.statusCode, 200, both.body)
  assert.equal(both.json().count, 6)
  const saved = await prisma.portMapping.findMany({ where: { instanceId: instance.id } })
  for (const protocol of ['tcp', 'udp']) {
    assert.deepEqual(saved.filter(mapping => mapping.protocol === protocol).map(mapping => [mapping.privatePort, mapping.publicPort]).sort(),
      full.map(mapping => [mapping.privatePort, mapping.publicPort]).sort())
  }
  assert.equal(Object.keys(devices).length, 6)
  for (const mapping of saved) {
    assert.equal(devices[`proxy-${mapping.protocol}-${mapping.publicPort}`].connect, `${mapping.protocol}:0.0.0.0:${mapping.privatePort}`)
  }

  // Reserve the two endpoints before the automatic-allocation check can legitimately consume them.
  await prisma.instance.update({ where: { id: instance.id }, data: { portLimit: 20 } })
  for (const [privatePort, publicPort] of [[10090, 10000], [10091, 10100]]) {
    const boundary = await submit({ protocol: 'both', privatePortStart: privatePort, privatePortEnd: privatePort,
      portMappings: [{ privatePort, publicPort }] })
    assert.equal(boundary.statusCode, 200, boundary.body); assert.equal(boundary.json().count, 2)
    for (const protocol of ['tcp', 'udp'] as const) {
      const mapping = await prisma.portMapping.findFirstOrThrow({ where: { instanceId: instance.id, protocol, publicPort } })
      assert.equal(mapping.privatePort, privatePort)
      assert.equal(devices[`proxy-${protocol}-${publicPort}`].connect, `${protocol}:0.0.0.0:${privatePort}`)
    }
  }
  // Omitting the custom array keeps automatic allocation available.
  const automatic = await submit({ protocol: 'tcp', privatePortStart: 10050, privatePortEnd: 10051 })
  assert.equal(automatic.statusCode, 200, automatic.body)
  assert.deepEqual(automatic.json().mappings.map((row: any) => row.privatePort), [10050, 10051])
  const occupied = await prisma.portMapping.findFirstOrThrow({ where: { instanceId: instance.id, protocol: 'tcp' } })
  // Mirror the UI's full-range conflict resubmission, replacing only a conflicted public port.
  const conflictBase = { protocol: 'tcp', privatePortStart: 10080, privatePortEnd: 10080,
    publicPortStart: occupied.publicPort, publicPortEnd: occupied.publicPort }
  const conflict = await rejected(conflictBase, 'PORT_CONFLICT', 409, true)
  const resolvedMap = new Map<number, number>(conflict.json().conflicts.map((row: any) => [row.publicPort, row.suggestedPort]))
  const resubmission = Array.from({ length: conflictBase.privatePortEnd - conflictBase.privatePortStart + 1 }, (_, offset) => ({
    privatePort: conflictBase.privatePortStart + offset,
    publicPort: resolvedMap.get(conflictBase.publicPortStart + offset) ?? conflictBase.publicPortStart + offset
  }))
  const resolved = await submit({ protocol: conflictBase.protocol, privatePortStart: conflictBase.privatePortStart,
    privatePortEnd: conflictBase.privatePortEnd, portMappings: resubmission })
  assert.equal(resolved.statusCode, 200, resolved.body)
  assert.equal(resolved.json().mappings[0].publicPort, resubmission[0].publicPort)
  assert.equal(await prisma.portMapping.count({ where: { instanceId: instance.id } }), 13)
  assert.equal(Object.keys(devices).length, 13)
  const batchMappings = await prisma.portMapping.findMany({ where: { instanceId: instance.id }, orderBy: { id: 'asc' } })
  const batchDevices = structuredClone(devices)
  // A real audit INSERT failure must not enter the successful helper's device rollback.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${auditFailureTrigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.instance_id = ${instance.id} AND NEW.action = 'port.add' AND NEW.result = 'success' THEN RAISE EXCEPTION 'fixture-port-audit-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${auditFailureTrigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${auditFailureTrigger}()`)
  const originalError = console.error
  let auditFailures = 0
  console.error = (...args: unknown[]) => {
    if (args.some(arg => String(arg).includes('fixture-port-audit-failure'))) auditFailures++
    originalError(...args)
  }
  try {
    for (const [protocol, publicPort, privatePort] of [['tcp', 10095, 22], ['udp', 10096, 53]] as const) {
      const before = await snapshot()
      const single = await responseAfterRelease(() => app.inject({ method: 'POST', url: `/instances/${instance.id}/ports`, payload: { protocol, publicPort, privatePort } }))
      assert.equal(single.statusCode, 200, single.body)
      const saved = await prisma.portMapping.findUniqueOrThrow({ where: { id: single.json().mapping.id } })
      assert.equal(saved.instanceId, instance.id); assert.equal(saved.publicPort, publicPort)
      assert.equal(saved.privatePort, privatePort); assert.equal(saved.protocol, protocol)
      assert.equal(devices[`proxy-${protocol}-${publicPort}`].connect, `${protocol}:0.0.0.0:${privatePort}`)
      assert.equal(calls.slice(before.calls).filter(call => call === `PUT /1.0/instances/${tag}`).length, 1, 'no extra device rollback after audit refusal')
      const after = await snapshot()
      assert.equal(after.mappings.length, before.mappings.length + 1)
      assert.equal(after.logs, before.logs, 'failed audit does not pretend to persist')
      assert.equal(after.balance, before.balance); assert.equal(after.billing, before.billing)
      assert.equal(after.hostCount, before.hostCount, 'single-port helper preserves the host inventory snapshot')
      const replay = await responseAfterRelease(() => app.inject({ method: 'POST', url: `/instances/${instance.id}/ports`, payload: { protocol, publicPort, privatePort } }))
      assert.equal(replay.statusCode, 400); assert.equal(replay.json().code, 'PORT_IN_USE')
      assert.deepEqual(await snapshot(), after)
    }
    assert.equal(auditFailures, 2, 'both requests must reach the injected real audit INSERT failure')
  } finally {
    console.error = originalError
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${auditFailureTrigger} ON logs`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${auditFailureTrigger}()`)
  }
  assert.deepEqual(await prisma.portMapping.findMany({ where: { id: { in: batchMappings.map(row => row.id) } }, orderBy: { id: 'asc' } }), batchMappings)
  for (const [name, value] of Object.entries(batchDevices)) assert.deepEqual(devices[name], value)
  const beforeFailure = await snapshot()
  rejectNextDeviceWrite = true
  const failedDevice = await responseAfterRelease(() => app.inject({ method: 'POST', url: `/instances/${instance.id}/ports`, payload: { protocol: 'tcp', publicPort: 10097, privatePort: 22 } }))
  assert.equal(failedDevice.statusCode, 500)
  assert.equal(rejectNextDeviceWrite, false, 'request must reach the intended Incus write')
  const afterFailure = await snapshot()
  assert.deepEqual(afterFailure.mappings, beforeFailure.mappings)
  assert.deepEqual(afterFailure.devices, beforeFailure.devices)
  assert.equal(afterFailure.hostCount, beforeFailure.hostCount)
  assert.equal(afterFailure.balance, beforeFailure.balance); assert.equal(afterFailure.billing, beforeFailure.billing)
  assert.equal(afterFailure.logs, beforeFailure.logs + 1)
  assert.equal(await prisma.distributedLock.count({ where: { lockKey: `instance:${instance.id}:port-mappings` } }), 0)
  const beforeDelete = await snapshot()
  rejectNextDeviceWrite = true
  const failedDelete = await responseAfterRelease(() => app.inject({ method: 'DELETE', url: `/instances/${instance.id}/ports/${batchMappings[0].id}` }))
  assert.equal(failedDelete.statusCode, 500, failedDelete.body)
  assert.equal(rejectNextDeviceWrite, false)
  const afterDeleteFailure = await snapshot()
  assert.deepEqual(afterDeleteFailure.mappings, beforeDelete.mappings)
  assert.deepEqual(afterDeleteFailure.devices, beforeDelete.devices)
  const deletion = await responseAfterRelease(() => app.inject({ method: 'DELETE', url: `/instances/${instance.id}/ports/${batchMappings[0].id}` }))
  assert.equal(deletion.statusCode, 200, deletion.body)
  assert.equal(await prisma.portMapping.count({ where: { id: batchMappings[0].id } }), 0)
  console.log('PASS blocked real lock DELETE: quota/conflict/replay/device failure and successful batch/single/delete responses wait for release')
  console.log('PASS R273 TCP/UDP audit INSERT failures preserve committed mapping/device and reject replay; real device failure rolls back only its new reservation')
  console.log('PASS real PostgreSQL/Fastify batch ports: empty/missing/extra/out-of-range/duplicate custom mappings reject without side effects; NAT range and Both quota remain enforced; shuffled complete Both, automatic allocation and UI-shaped conflict resubmission work through real mTLS to isolated Incus fixture')
} finally {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${releaseTrigger} ON distributed_locks`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${releaseTrigger}()`)
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${auditFailureTrigger} ON logs`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${auditFailureTrigger}()`)
  await app.close()
  await closeAllClients()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await prisma.log.deleteMany({ where: { instanceId: instance.id } })
  await prisma.portMapping.deleteMany({ where: { instanceId: instance.id } })
  await prisma.distributedLock.deleteMany({ where: { lockKey: `instance:${instance.id}:port-mappings` } })
  await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep), 'remove only this test temporary directory')
  await rm(root, { recursive: true, force: true })
}
process.exit(0)
