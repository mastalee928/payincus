import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

process.env.DATABASE_URL ||= 'postgresql://review_guard:unused@localhost:5432/review_guard'
const { compareRecoveryInventory, readRecoveryHold } = await import('../src/services/platform-recovery-review.js')
const folder = await mkdtemp(join(tmpdir(), 'incudal-review-'))
process.env.NODE_ENV = 'test'
process.env.PLATFORM_BACKUP_STATE_DIR = folder
try {
  await assert.rejects(readRecoveryHold(), /OSS_RECOVERY_NOT_HELD/)
  const id = randomUUID(), hold = join(folder, 'recovery-hold.json')
  await writeFile(hold, JSON.stringify({ taskId: id, createdAt: new Date().toISOString(), reason: 'restore' }))
  assert.equal((await readRecoveryHold()).snapshot, null, 'legacy restores must not invent a snapshot cutoff')
  const secret = 'never-include-this-private-material'
  await writeFile(hold, JSON.stringify({ taskId: id, createdAt: new Date().toISOString(), privateKey: secret,
    snapshot: { createdAt: '2026-10-23T12:00:00Z', version: '1.7.1', accessKeySecret: secret } }))
  const safe = await readRecoveryHold()
  assert.equal(safe.snapshot?.createdAt, '2026-10-23T12:00:00Z')
  assert.ok(!JSON.stringify(safe).includes(secret), 'only public restore context is returned')
  await writeFile(hold, JSON.stringify({ taskId: id, createdAt: new Date().toISOString(), mode: 'rollback', snapshot: null }))
  assert.equal((await readRecoveryHold()).mode, 'rollback')
  assert.deepEqual(compareRecoveryInventory(['kept', 'paid'], ['paid', 'kept']), { expectedCount: 2, actualCount: 2, missing: [], unexpected: [], inventoryMatched: true })
  const mismatch = compareRecoveryInventory(['kept', 'paid'], ['kept', 'after-snapshot'])
  assert.deepEqual(mismatch.missing, ['paid']); assert.deepEqual(mismatch.unexpected, ['after-snapshot']); assert.equal(mismatch.inventoryMatched, false)
  assert.equal(compareRecoveryInventory([], []).inventoryMatched, true)
  assert.throws(() => compareRecoveryInventory(['same'], ['same', 'same']), /OSS_REVIEW_INVENTORY_INVALID/)
  assert.throws(() => compareRecoveryInventory([''], []), /OSS_REVIEW_INVENTORY_INVALID/)
  assert.throws(() => compareRecoveryInventory([], Array.from({ length: 2001 }, (_, i) => `n${i}`)), /OSS_REVIEW_INVENTORY_INVALID/)
  const root = join(import.meta.dirname, '..')
  const [service, routes, gateway] = await Promise.all([readFile(join(root, 'src/services/platform-recovery-review.ts'), 'utf8'),
    readFile(join(root, 'src/routes/admin-aliyun-oss.ts'), 'utf8'), readFile(join(root, '../scripts/onboarding-gateway.py'), 'utf8')])
  assert.ok(service.includes('SET TRANSACTION READ ONLY'), 'review must not run business reconciliation mutations')
  assert.ok(service.includes('host.managementSshHost !== node.managementIp') && service.includes('host.managementSshPort !== node.sshPort'), 'only reserved management paths may be probed')
  assert.ok(service.includes('!host.serverCertificate || !host.serverFingerprint'), 'review refuses unpinned Incus identities')
  assert.ok(service.includes("'/1.0/instances?recursion=1'"), 'inventory check uses read-only Incus API')
  assert.ok(routes.includes("'/recovery-review'") && routes.includes('fastify.authenticateAdmin, requireBackupAdmin'), 'existing restricted backup administrator boundary stays in place')
  assert.ok(routes.includes('request.user.sid') && routes.includes('origins.includes(origin)') && routes.includes("'OSS_REVIEW_WEB_SESSION_REQUIRED'"), 'recovery review keeps the Web session and admin Origin boundary')
  assert.ok(gateway.includes("'head -c64 /etc/incudal-onboarding-id'") && gateway.includes("allowed.get(peer) != str(address) + '/32'"), 'SSH probe is fixed, bounded, and bound to an enrolled /32')
  console.log('Recovery review guards passed: legacy context, secret omission, inventory gaps, management identity and read-only boundaries.')
} finally { await rm(folder, { recursive: true, force: true }) }
process.exit(0)
