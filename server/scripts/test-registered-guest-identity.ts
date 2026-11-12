import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Host } from '@prisma/client'
import { registeredGuestIdentity } from '../src/lib/registered-guest-identity.js'
import { transferHostIdentity } from '../src/lib/transfer-host-identity.js'
const host = { id: 24, userId: 1, url: 'https://127.0.0.1:1', certPath: 'original.cert', keyPath: 'original.key',
  serverCertificate: 'original-cert', serverFingerprint: 'original-pin' } as Host
const saved = { uuid: randomUUID(), createdAt: '2026-11-03T23:44:48.661380516Z', project: 'default' }
const instance = { id: 28, incusId: 'original', snapshottedSpecs: { recoveryIdentity: saved } }
let task: any = { taskType: 'rebuild', status: 'COMPLETED', hostId: host.id, targetHostId: null, replacementState: {} }
const db: any = { instanceTask: { findFirst: async () => task } }
assert.deepEqual(await registeredGuestIdentity(db, instance, host), { uuid: saved.uuid, createdAt: saved.createdAt }, 'legacy in-place rebuild preserves original identity')
for (const mutation of [{ taskType: 'recreate' }, { taskType: 'change_host' }, { hostId: 999 }, { targetHostId: 999 },
  { replacementState: { targetUuid: randomUUID() } }, { replacementState: [] },
  { replacementState: 'corrupted' }, { status: 'PROCESSING' }]) {
  const before = task; task = { ...task, ...mutation }
  assert.deepEqual(await registeredGuestIdentity(db, instance, host), { uuid: null, createdAt: null }, 'unknown/partial switch must not adopt saved identity')
  task = before
}
task.replacementState=null
assert.deepEqual(await registeredGuestIdentity(db,instance,host),{uuid:saved.uuid,createdAt:saved.createdAt},'SQL/JSON null legacy in-place rebuild retains original identity')
task = { ...task, taskType: 'replace_host', targetHostId: host.id, replacementState: { targetUuid: saved.uuid,
  targetCreatedAt: saved.createdAt, targetIncusId: instance.incusId, targetHostIdentity: transferHostIdentity(host) } }
assert.deepEqual(await registeredGuestIdentity(db, instance, host), { uuid: saved.uuid, createdAt: saved.createdAt })
console.log('Registered guest identity passed: legacy in-place rebuild, full replacement proof and unknown/partial/changed host rejection')
