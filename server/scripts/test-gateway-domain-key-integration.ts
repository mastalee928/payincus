/** Disposable Linux/root filesystem + isolated PG. Refuses an existing installation. */
import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, readFile, rename, rmdir, symlink, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
if (process.platform !== 'linux' || process.getuid?.() !== 0) {
  console.log('SKIP: gateway management key filesystem integration requires disposable Linux root')
  process.exit(0)
}
const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_gateway_test'))
assert.equal(await lstat('/opt/incudal').then(() => true, error => { if (error.code === 'ENOENT') return false; throw error }), false,
  'Refuse to operate on an existing installation; use an empty Linux CI worker')
const previous = process.env.ONBOARDING_GATEWAY_KEY_PATH
delete process.env.ONBOARDING_GATEWAY_KEY_PATH
const { loadGatewayDomainManagementKey } = await import('../src/services/gateway-domain-driver.js')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const directories = ['/opt/incudal', '/opt/incudal/server', '/opt/incudal/server/certs']
const key = '/opt/incudal/server/certs/onboarding-gateway.key', saved = '/opt/incudal/server/certs/preserved-fixture.key'
const marker = 'management_gateway_domain_' + randomUUID()
const parent = await lstat('/opt')
assert.ok(parent.isDirectory() && parent.uid === 0, 'Disposable fixture requires a root-owned /opt')
const parentMode = parent.mode & 0o7777
// Hosted runners may grant their toolcache group write access to /opt. The
// production key reader must reject that ancestor, not relax its trust check.
console.log(`Disposable /opt fixture: uid=${parent.uid}, mode=${parentMode.toString(8)}`)
try {
  for (const path of directories) await mkdir(path, { mode: 0o750 })
  if (parentMode & 0o022) await assert.rejects(loadGatewayDomainManagementKey(true), /MANAGEMENT_KEY_MISSING/)
  await chmod('/opt', parentMode & ~0o022)
  await assert.rejects(loadGatewayDomainManagementKey(), /MANAGEMENT_KEY_MISSING/)
  const initial = await loadGatewayDomainManagementKey(true)
  assert.ok(initial.publicKey.startsWith('ssh-ed25519 '))
  const info = await lstat(key)
  assert.equal(info.uid, 0); assert.equal(info.mode & 0o777, 0o600); assert.equal(info.nlink, 1)
  assert.deepEqual((await loadGatewayDomainManagementKey(true)).privateKey, initial.privateKey)
  await chmod(key, 0o640)
  assert.equal((await loadGatewayDomainManagementKey()).publicKey, initial.publicKey)
  await chmod(key, 0o660)
  await assert.rejects(loadGatewayDomainManagementKey(true), /MANAGEMENT_KEY_MISSING/)
  await chmod(key, 0o600)
  await rename(key, saved)
  await symlink(saved, key)
  await assert.rejects(loadGatewayDomainManagementKey(true), /MANAGEMENT_KEY_MISSING/)
  assert.ok((await lstat(key)).isSymbolicLink()); await unlink(key)
  await prisma.systemConfig.create({ data: { key: marker, value: JSON.stringify({ channelReady: true }), type: 'json' } })
  await assert.rejects(loadGatewayDomainManagementKey(true), /MANAGEMENT_KEY_MISSING/)
  await assert.rejects(lstat(key), (error: NodeJS.ErrnoException) => error.code === 'ENOENT')
  assert.deepEqual(await readFile(saved), initial.privateKey)
  // The ordinary OSS restore republishes this exact private file; the next
  // worker must reuse it even when no ONBOARDING_GATEWAY_KEY_PATH was saved.
  await rename(saved, key)
  assert.equal((await loadGatewayDomainManagementKey()).publicKey, initial.publicKey)
  await prisma.systemConfig.delete({ where: { key: marker } })
  await rename(key, saved)
  process.env.ONBOARDING_GATEWAY_KEY_PATH = key
  await assert.rejects(loadGatewayDomainManagementKey(true), /MANAGEMENT_KEY_MISSING/)
  console.log('Gateway management key Linux root integration passed: first external setup, 0640 reuse, unsafe/symlink rejection, lost registered identity refused, original backup identity reused')
} finally {
  await prisma.systemConfig.deleteMany({ where: { key: marker } })
  await closePrismaDatabase()
  for (const path of [key, saved]) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error })
  for (const path of [...directories].reverse()) await rmdir(path)
  await chmod('/opt', parentMode)
  if (previous === undefined) delete process.env.ONBOARDING_GATEWAY_KEY_PATH; else process.env.ONBOARDING_GATEWAY_KEY_PATH = previous
}
