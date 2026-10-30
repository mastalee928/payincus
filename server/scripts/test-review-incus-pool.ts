import assert from 'node:assert/strict'
import type { IncusClient as IncusClientType } from '../src/lib/incus/incus-client.js'

process.env.DATABASE_URL = 'postgresql://fixture:fixture@127.0.0.1:1/payincus_pool_test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { IncusClient } = await import('../src/lib/incus/incus-client.js')
const { getIncusClient, removeIncusClient, closeAllClients, getPoolStatus } = await import('../src/lib/incus/incus-pool.js')

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
let configuration = { url: 'https://127.0.0.1:10001', certPath: null, keyPath: null, serverCertificate: null, serverFingerprint: null }
let findHook: (() => Promise<void>) | undefined
let connectGate: ReturnType<typeof deferred> | undefined
let closeGate: ReturnType<typeof deferred> | undefined
const created: IncusClientType[] = []
const closed = new Set<IncusClientType>()
const originalFind = prisma.host.findUnique
const originalConnect = IncusClient.prototype.connect
const originalClose = IncusClient.prototype.close
prisma.host.findUnique = (async () => {
  const result = { ...configuration }
  if (findHook) { const hook = findHook; findHook = undefined; await hook() }
  return result
}) as unknown as typeof originalFind
IncusClient.prototype.connect = async function () {
  created.push(this)
  const gate = connectGate; connectGate = undefined
  if (gate) await gate.promise
  this.connected = true
  return {}
}
IncusClient.prototype.close = async function () {
  closed.add(this)
  const gate = closeGate; closeGate = undefined
  if (gate) await gate.promise
  this.connected = false
}
const host = { id: 1, url: 'https://obsolete.example.test', certPath: null, keyPath: null }
try {
  const first = await Promise.all(Array.from({ length: 12 }, () => getIncusClient(host)))
  assert.equal(new Set(first).size, 1, 'concurrent first lookup must single-flight')
  assert.equal(created.length, 1)
  assert.equal(first[0]!.baseUrl, configuration.url, 'database configuration wins over a stale caller snapshot')

  configuration = { ...configuration, url: 'https://127.0.0.1:10002' }
  const second = await getIncusClient(host)
  assert.notEqual(second, first[0])
  assert.ok(closed.has(first[0]!))
  assert.equal(second.baseUrl, configuration.url)

  // A delayed old lookup cannot evict/re-publish over a newer configuration.
  const lookup = deferred()
  findHook = () => lookup.promise
  const lateLookup = getIncusClient(host)
  const lookupRejected = assert.rejects(lateLookup, /superseded/)
  configuration = { ...configuration, url: 'https://127.0.0.1:10003' }
  const newest = await getIncusClient(host)
  lookup.resolve()
  await lookupRejected
  assert.equal(await getIncusClient(host), newest)

  // Configuration changes during an actual connect must refuse publication.
  await removeIncusClient(host.id)
  const connection = deferred()
  connectGate = connection
  const pending = getIncusClient(host)
  const connectionRejected = assert.rejects(pending, /configuration changed while connecting/)
  await new Promise(resolve => setImmediate(resolve))
  configuration = { ...configuration, url: 'https://127.0.0.1:10004' }
  connection.resolve()
  await connectionRejected
  assert.equal(getPoolStatus().size, 0)

  // Removed pending connections must not reappear when their connect finishes.
  const removed = deferred()
  connectGate = removed
  const pendingRemoved = getIncusClient(host)
  const removedRejected = assert.rejects(pendingRemoved, /invalidated while connecting/)
  await new Promise(resolve => setImmediate(resolve))
  await removeIncusClient(host.id)
  removed.resolve()
  await removedRejected
  assert.equal(getPoolStatus().size, 0)

  const current = await getIncusClient(host)
  const closing = deferred()
  closeGate = closing
  const remove = removeIncusClient(host.id)
  const replacement = await getIncusClient(host)
  closing.resolve()
  await remove
  assert.notEqual(current, replacement)
  assert.equal(await getIncusClient(host), replacement, 'late close must not remove the replacement')

  await removeIncusClient(host.id)
  const shuttingDown = deferred()
  connectGate = shuttingDown
  const pendingShutdown = getIncusClient(host)
  const shutdownRejected = assert.rejects(pendingShutdown, /invalidated while connecting/)
  await new Promise(resolve => setImmediate(resolve))
  await closeAllClients()
  shuttingDown.resolve()
  await shutdownRejected
  assert.equal(getPoolStatus().size, 0)
  assert.ok(created.every(client => closed.has(client)), 'all connected generations must be closed')
  console.log('PASS Incus pool: concurrent first use, current DB configuration, delayed lookup/connect/close, removal and shutdown races')
} finally {
  prisma.host.findUnique = originalFind
  IncusClient.prototype.connect = originalConnect
  IncusClient.prototype.close = originalClose
  await closeAllClients()
  await closePrismaDatabase()
}
process.exit(0)
