import assert from 'node:assert/strict'

// Exercise the real recovery service and connector with a controlled database
// boundary and clock. The PostgreSQL integration test covers the actual pool.
process.env.DATABASE_URL = 'postgresql://fixture:fixture@127.0.0.1:1/recovery_pool_test'
process.env.NODE_ENV = 'test'
const originalNow = Date.now
const originalSetTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout
const originalSetInterval = globalThis.setInterval
const importedIntervals: ReturnType<typeof setInterval>[] = []
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
  const timer = (originalSetInterval as any)(...args)
  importedIntervals.push(timer)
  return timer
}) as typeof setInterval
let now = originalNow(), held = false, failAudit = false, transactions = 0
let enterHook: (() => void) | undefined, lockHook: (() => void) | undefined
let requestHook: ((method: string, path: string) => Promise<void> | void) | undefined
let host: any, names: string[] = [], remote: any[] = [], forwards: any[] = [], history: any[] = []
const audits: any[] = []
const calls: Array<{ method: string; path: string; at: number; timeout: number; signal: AbortSignal }> = []
const timers = new Map<object, { due: number; callback: () => void }>()
const db: any = {
  $disconnect: async () => {},
  host: { findUnique: async () => {
    assert.equal(held, false, 'connector must not borrow a global connection inside the transaction')
    return structuredClone(host)
  } },
  instance: { findMany: async () => [] },
  instanceTask: { count: async () => 0, findMany: async () => structuredClone(history) },
  hostOnboardingNode: { count: async () => 0 },
  log: { create: async ({ data }: any) => {
    assert.equal(held, false, 'durable audit must not require a second transaction connection')
    if (failAudit) throw new Error('fixture audit unavailable')
    audits.push(structuredClone(data))
    return { id: audits.length, ...data }
  } }
}
const tx: any = { ...db,
  $queryRaw: async () => { const hook = lockHook; lockHook = undefined; hook?.(); return [{ id: host.id }] },
  host: {
    findUnique: async () => structuredClone(host),
    update: async ({ data }: any) => { Object.assign(host, data); return structuredClone(host) }
  }
}
db.$transaction = async (callback: any) => {
  transactions++
  enterHook?.()
  const before = structuredClone(host)
  held = true
  try { return await callback(tx) }
  catch (error) { host = before; throw error }
  finally { held = false }
}
;(globalThis as any).prisma = db
const { closePrismaDatabase } = await import('../src/db/prisma.js')
const { IncusClient } = await import('../src/lib/incus/incus-client.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const { inspectHostRecovery, recoverPoolHost, HostRecoveryError } = await import('../src/services/host-pool-recovery.js')
const originalConnect = IncusClient.prototype.connect
const originalClose = IncusClient.prototype.close
const originalRequest = IncusClient.prototype.request
IncusClient.prototype.connect = async function () { this.connected = true; return {} }
IncusClient.prototype.close = async function () { this.connected = false }
IncusClient.prototype.request = async function (method, path, _body, timeout, signal): Promise<any> {
  assert.ok(signal, 'every remote request must receive the shared cancellation signal')
  assert.ok(timeout && timeout <= 8000, 'each request must be limited by its remaining budget')
  signal.throwIfAborted()
  calls.push({ method, path, at: now, timeout, signal })
  await requestHook?.(method, path)
  if (method === 'GET') {
    if (path.startsWith('/1.0/instances?')) return structuredClone(remote)
    if (path.startsWith('/1.0/instances/')) return structuredClone(remote.find(row => path.endsWith(row.name)))
    if (path.startsWith('/1.0/projects?')) return [{ name: 'default' }]
    if (path.startsWith('/1.0/networks?')) return [{ name: 'incusbr0', managed: true, type: 'bridge' }]
    if (path.startsWith('/1.0/operations?')) return { running: [] }
    if (path.startsWith('/1.0/storage-pools?')) return [{ name: 'default', status: 'Created' }]
    if (path.includes('/volumes?')) return remote.map(row => ({ name: row.name, type: 'container' }))
    if (path.includes('/forwards?')) return structuredClone(forwards)
  }
  if (method === 'DELETE') {
    assert.ok(audits.some(row => row.action === 'host.pool.recovery_start'), 'audit must exist before the first deletion')
    if (path.startsWith('/1.0/instances/')) remote = remote.filter(row => !path.endsWith(row.name))
    else forwards = forwards.filter(row => !path.endsWith(row.listen_address))
    return {}
  }
  throw new Error(`Unexpected fixture request: ${method} ${path}`)
}
Date.now = () => now
globalThis.setTimeout = ((callback: () => void, delay: number) => {
  const handle = {}
  timers.set(handle, { callback, due: now + delay })
  return handle
}) as unknown as typeof setTimeout
globalThis.clearTimeout = ((handle: object) => { timers.delete(handle) }) as unknown as typeof clearTimeout
function advance(ms: number) {
  now += ms
  for (const [handle, timer] of timers) {
    if (timer.due <= now) { timers.delete(handle); timer.callback() }
  }
}
function deferred() {
  let resolve!: () => void
  return { promise: new Promise<void>(done => { resolve = done }), resolve: () => resolve() }
}
function reset(count = 1) {
  assert.equal(timers.size, 0, 'finished calls must dispose deadline timers')
  now = originalNow()
  failAudit = false; enterHook = undefined; lockHook = undefined; requestHook = undefined
  calls.length = 0; audits.length = 0; transactions = 0
  names = Array.from({ length: count }, (_, index) => `recovery-old-${index}`)
  remote = names.map(name => ({ name, status: 'Stopped', created_at: '2020-01-01T00:00:00Z', project: 'default' }))
  forwards = names.map((name, index) => ({ listen_address: `192.0.2.${index + 1}`, description: `payincus-dedicated:${name}`, config: {}, ports: [] }))
  history = names.map((name, id) => ({ id, status: 'COMPLETED', targetHostId: 902, createdAt: new Date(now),
    finishedAt: new Date(now), instance: { hostId: 902 }, replacementState: { sourceHostId: 901, sourceIncusId: name, stage: 'delivered' } }))
  host = { id: 901, url: 'https://127.0.0.1:1', certPath: null, keyPath: null, serverCertificate: null, serverFingerprint: null,
    status: 'online', poolFaulted: true, singleTenant: true, isInstalled: true, instanceType: 'container',
    natPublicIp: '192.0.2.1', natBindIp: '10.0.0.1', portProtocol: 'tcp', portProtocolRevision: 1,
    portProtocolApplied: 'tcp', portProtocolAppliedRevision: 1, portProtocolError: null,
    resourcePreset: 'E2', customerDiskGiB: 30, architecture: 'x86_64', cpuAllowanceMax: 200, memoryMax: 768,
    storageSize: 34, cpuUsed: 200, memoryUsed: 768, diskUsed: 30720, natPortStart: 20000, natPortEnd: 30000,
    natPortsUsedCount: 0, agent: { enabled: true, lastSeenAt: new Date(now), capabilities: ['ingress-port-protocol-v1'] },
    onboardingNode: null, storagePools: [{ name: 'default', purpose: 'instance_data' }] }
}
async function options() {
  const report = await inspectHostRecovery(host.id)
  assert.equal(report.canRecover, true)
  calls.length = 0
  return { confirmation: report.confirmation, acknowledgeCleanup: true }
}
const isCode = (code: string) => (error: unknown) => error instanceof HostRecoveryError && error.code === code
try {
  reset()
  await recoverPoolHost(host.id, 101, await options())
  assert.equal(host.poolFaulted, false)
  assert.equal(remote.length + forwards.length, 0)
  assert.equal(audits.filter(row => row.action === 'host.pool.recovery_start').length, 1)
  assert.equal(audits[0].result, 'pending', 'request intent must not claim successful cleanup')
  console.log('PASS default connector uses transaction; durable audit precedes cleanup')

  reset()
  const auditOptions = await options()
  failAudit = true
  await assert.rejects(recoverPoolHost(host.id, 101, auditOptions), isCode('HOST_RECOVERY_FAILED'))
  assert.equal(transactions, 0)
  assert.equal(calls.length, 0)
  assert.equal(host.poolFaulted, true)
  console.log('PASS audit failure prevents transaction and all remote work')

  for (const delayPoint of ['connection-acquisition', 'row-lock']) {
    reset()
    const queuedOptions = await options()
    if (delayPoint === 'row-lock') lockHook = () => advance(60001)
    else enterHook = () => advance(60001)
    await assert.rejects(recoverPoolHost(host.id, 101, queuedOptions), isCode('HOST_RECOVERY_UNREACHABLE'))
    assert.equal(calls.length, 0)
    assert.equal(host.poolFaulted, true)
    assert.equal(audits.length, 1, 'committed request audit survives rollback')
    console.log(`PASS ${delayPoint} consumes the total budget; zero remote calls after expiry`)
  }

  for (const stage of ['instance-recheck', 'forward-cleanup']) {
    reset()
    const lateOptions = await options(), entered = deferred(), release = deferred()
    let forwardReads = 0
    requestHook = async (method, path) => {
      if (method !== 'GET') return
      if (path.includes('/forwards?')) forwardReads++
      if ((stage === 'instance-recheck' && path.startsWith('/1.0/instances/')) ||
          (stage === 'forward-cleanup' && path.includes('/forwards?') && forwardReads === 2)) {
        entered.resolve()
        await release.promise // Deliberately ignore AbortSignal like a late transport.
      }
    }
    const pending = recoverPoolHost(host.id, 101, lateOptions)
    const rejected = assert.rejects(pending, isCode('HOST_RECOVERY_UNREACHABLE'))
    await entered.promise
    advance(8001)
    await rejected
    const mutationsAtFailure = calls.filter(call => call.method === 'DELETE').length
    release.resolve()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(calls.filter(call => call.method === 'DELETE').length, mutationsAtFailure, 'late GET must not start any further DELETE')
    assert.equal(calls.filter(call => call.method === 'DELETE' && call.path.includes('/forwards/')).length, 0)
    assert.ok(calls.every(call => call.signal.aborted))
    assert.equal(host.poolFaulted, true)
    assert.equal(host.cpuUsed, 200)
    assert.equal(audits.length, 1)
    console.log(`PASS late ${stage}: cancellation, quarantine and audit retained; zero late DELETE`)
  }

  reset(6)
  const cumulativeOptions = await options(), started = now
  requestHook = (method, path) => {
    if (method === 'DELETE' || path.startsWith('/1.0/instances/')) advance(6500)
  }
  await assert.rejects(recoverPoolHost(host.id, 101, cumulativeOptions), isCode('HOST_RECOVERY_UNREACHABLE'))
  assert.ok(now - started > 60000)
  assert.ok(calls.every(call => call.at - started < 60000), 'no request starts after the total deadline')
  assert.equal(calls.at(-1)?.timeout, 1500, 'last request receives only the remaining total budget')
  assert.equal(host.poolFaulted, true)
  assert.equal(remote.length, 1, 'later obsolete systems are untouched after expiry')
  console.log('PASS individually bounded requests cannot extend the shared total deadline')
} finally {
  globalThis.setTimeout = originalSetTimeout
  globalThis.clearTimeout = originalClearTimeout
  Date.now = originalNow
  await closeAllClients()
  IncusClient.prototype.connect = originalConnect
  IncusClient.prototype.close = originalClose
  IncusClient.prototype.request = originalRequest
  await closePrismaDatabase()
  for (const interval of importedIntervals) clearInterval(interval)
  globalThis.setInterval = originalSetInterval
  delete (globalThis as any).prisma
}
