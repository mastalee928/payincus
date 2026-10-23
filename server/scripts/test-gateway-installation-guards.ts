import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { authenticator } from 'otplib'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Prisma } from '@prisma/client'
import { GatewayTaskError, gatewayTaskHash, type GatewayTaskPlan } from '../src/lib/gateway-task-plan.js'
import { signGatewayTransport } from '../src/lib/gateway-transport.js'
import { validateGatewayInstallationDesired, validateGatewayInstallationRequest, validateGatewayInstallationPreview,
  validateGatewayInstallationReceipt, validateGatewayBootstrapMaterial } from '../src/lib/gateway-installation.js'
import { authorizeGatewayAdministration, decryptGatewayTaskSecret, encryptGatewayTaskSecret, gatewayCredentialHash } from '../src/services/gateway-admin-authorization.js'
import { currentGatewayRecoveryContext } from '../src/lib/gateway-recovery-context.js'
import { retryGatewayJournal } from '../src/services/gateway-journal-retry.js'

let journalCalls = 0
assert.equal(await retryGatewayJournal(async () => {
  journalCalls++; if (journalCalls < 3) throw new GatewayTaskError('GATEWAY_TASK_JOURNAL_BUSY'); return 'acquired'
}, undefined, async () => {}), 'acquired')
assert.equal(journalCalls, 3)
journalCalls = 0
await assert.rejects(retryGatewayJournal(async () => { journalCalls++; throw new GatewayTaskError('GATEWAY_TASK_LEASE_LOST') }, undefined, async () => {}), /LEASE_LOST/)
assert.equal(journalCalls, 1)

const contextDirectory = await mkdtemp(join(tmpdir(), 'gateway-context-'))
const previousStateDirectory = process.env.PLATFORM_BACKUP_STATE_DIR, previousMode = process.env.NODE_ENV
process.env.PLATFORM_BACKUP_STATE_DIR = contextDirectory; process.env.NODE_ENV = 'test'
try {
  assert.equal(currentGatewayRecoveryContext(), null)
  const recoveryId = randomUUID()
  await writeFile(join(contextDirectory, 'recovery-hold.json'), JSON.stringify({ taskId: recoveryId }), { mode: 0o600 })
  assert.equal(currentGatewayRecoveryContext(), recoveryId)
  await writeFile(join(contextDirectory, 'recovery-hold.json'), '{"taskId":"invalid"}')
  assert.throws(currentGatewayRecoveryContext, /RECOVERY_CONTEXT_INVALID/)
} finally {
  if (previousStateDirectory === undefined) delete process.env.PLATFORM_BACKUP_STATE_DIR; else process.env.PLATFORM_BACKUP_STATE_DIR = previousStateDirectory
  if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode
  assert.equal(dirname(resolve(contextDirectory)), resolve(tmpdir())); await rm(contextDirectory, { recursive: true, force: true })
}

const identity = { platformId: randomUUID(), gatewayId: randomUUID(), machineId: 'a'.repeat(32) }
const desired = { slot: 'a' as const, network: '10.249.80.0/24', address: '10.249.80.1', listenPort: 51980, consolePort: 18480, consoleOrigin: 'https://gateway.example.test:18480' }
assert.deepEqual(validateGatewayInstallationDesired(desired, identity), desired)
for (const mutation of [{ consoleOrigin: 'http://gateway.example.test:18480' }, { consoleOrigin: 'https://gateway.example.test:18481' },
  { consoleOrigin: 'https://user@gateway.example.test:18480' }, { consoleOrigin: 'https://gateway.example.test:18480/' },
  { consoleOrigin: 'https://gateway..example.test:18480' }, { network: '172.20.0.0/24', address: '172.20.0.1' }, { command: 'unusable-test-value' }]) {
  assert.throws(() => validateGatewayInstallationDesired({ ...desired, ...mutation }, identity))
}
const pair = generateKeyPairSync('ed25519'), now = Date.now()
const publicKey = createPublicKey(pair.privateKey).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
const signedTransport = signGatewayTransport({ schemaVersion: 1, purpose: 'gateway-transport', platformId: identity.platformId, gatewayId: identity.gatewayId,
  epoch: '1', sequence: '1', issuedAt: now, expiresAt: now + 600000, slot: 'a', address: desired.address, listenPort: desired.listenPort, mtu: 1380, peers: [] }, pair.privateKey)
const configuration = { ...desired, signedTransport }
const task: GatewayTaskPlan = { schemaVersion: 1, taskId: randomUUID(), platformId: identity.platformId, gatewayId: identity.gatewayId, kind: 'install',
  basedOnRevision: '0', target: { mode: 'local', machineId: identity.machineId, ssh: null }, configurationHash: gatewayTaskHash(configuration), componentHash: 'b'.repeat(64), observedStateHash: 'c'.repeat(64) }
const request = { task, configuration, expiresAt: now + 300000 }
assert.deepEqual(validateGatewayInstallationRequest(request, publicKey, now), request)
for (const invalid of [{ ...request, expiresAt: now }, { ...request, expiresAt: now + 600001 },
  { ...request, configuration: { ...configuration, consolePort: 19480 } }, { ...request, task: { ...task, gatewayId: randomUUID() } },
  { ...request, task: { ...task, kind: 'update' } }]) assert.throws(() => validateGatewayInstallationRequest(invalid, publicKey, now))
const preview = { schemaVersion: 1, task, planHash: gatewayTaskHash(task), expiresAt: request.expiresAt,
  package: { verified: true, architecture: 'arm64', version: '1.7.1', sourceCommit: 'a'.repeat(40), files: 20, manifestHash: task.componentHash, canWrite: false },
  target: { machineId: identity.machineId, osId: 'debian', architecture: 'arm64' }, configuration: desired,
  transport: { epoch: '1', sequence: '1', mtu: 1380, peerCount: 0 },
  changes: { packageDirectory: '/opt/incudal-gateway/components/' + task.componentHash, stateDirectory: '/var/lib/incudal-management-gateway/' + task.gatewayId,
    services: ['incudal-gateway.service', 'incudal-gateway-console.service'], interface: 'incudal-gw-a', newIndependentIdentity: true,
    consoleCertificate: 'independently-pinned', businessBackendRestart: false, consoleListenAddress: '0.0.0.0', existingFilesOverwritten: false, customerRoutesChanged: false },
  blockers: [], installable: true, canWrite: false }
assert.deepEqual(validateGatewayInstallationPreview(preview, request), preview)
for (const changed of [{ ...preview, canWrite: true }, { ...preview, blockers: ['GATEWAY_PORT_CONFLICT'] },
  { ...preview, package: { ...preview.package, manifestHash: 'd'.repeat(64) } }, { ...preview, changes: { ...preview.changes, stateDirectory: '/etc' } },
  { ...preview, password: 'unusable-test-value' }]) assert.throws(() => validateGatewayInstallationPreview(changed, request))
const receipt = { schemaVersion: 1, taskId: task.taskId, planHash: gatewayTaskHash(task), targetHash: gatewayTaskHash(task.target), configurationHash: task.configurationHash,
  componentHash: task.componentHash, gatewayId: task.gatewayId, publicKey, consoleCertificateSha256: 'e'.repeat(64), installed: true, transportReady: true,
  canWrite: false, bootstrapAvailable: true, blockers: ['backup-not-configured', 'host-write-service-not-ready', 'public-certificate-maintenance-required'] }
assert.deepEqual(validateGatewayInstallationReceipt(receipt, request), receipt)
for (const changed of [{ ...receipt, taskId: randomUUID() }, { ...receipt, canWrite: true }, { ...receipt, blockers: [] },
  { ...receipt, publicKey: Buffer.alloc(32).toString('base64') }, { ...receipt, token: 'unusable-test-value' }]) assert.throws(() => validateGatewayInstallationReceipt(changed, request))
const bootstrap = { username: 'operator', role: 'operator', password: randomBytes(24).toString('base64url'),
  totpSeed: randomBytes(20).toString('base64'), recoveryCodes: Array.from({ length: 7 }, () => randomBytes(24).toString('base64url')) }
assert.ok(JSON.stringify(validateGatewayBootstrapMaterial(bootstrap)) === JSON.stringify(bootstrap))
assert.throws(() => validateGatewayBootstrapMaterial({ ...bootstrap, recoveryCodes: Array(7).fill(bootstrap.recoveryCodes[0]) }))

const previousKey = process.env.ENCRYPTION_KEY
process.env.ENCRYPTION_KEY = 'gateway-authority-guard-not-a-real-credential'
try {
  const password = 'gateway-authority-test-password', secret = authenticator.generateSecret()
  const user = { id: 1, role: 'admin', status: 'active', passwordHash: bcrypt.hashSync(password, 4), twoFactorEnabled: true, twoFactorSecret: encryptGatewayTaskSecret(secret) }
  let highest: bigint | null = null
  const tx = { user: { findUnique: async () => user }, managementGatewayMfaReplay: {
    aggregate: async () => ({ _max: { step: highest } }), create: async ({ data }: { data: { step: bigint } }) => { highest = data.step }, deleteMany: async () => ({ count: 0 })
  } } as unknown as Prisma.TransactionClient
  await assert.rejects(authorizeGatewayAdministration(tx, 1, { password: 'incorrect' }), /REAUTH_REQUIRED/)
  assert.equal(highest, null)
  await assert.rejects(authorizeGatewayAdministration(tx, 1, { password }), /MFA_REQUIRED/)
  const verifier = authenticator.clone({ digits: 6, step: 30, epoch: Date.now() })
  const token = verifier.generate(secret)
  assert.equal(await authorizeGatewayAdministration(tx, 1, { password, totpCode: token }), gatewayCredentialHash(user))
  await assert.rejects(authorizeGatewayAdministration(tx, 1, { password, totpCode: token }), /MFA_REPLAYED/)
  const before = gatewayCredentialHash(user)
  user.passwordHash = bcrypt.hashSync('changed-password', 4)
  assert.notEqual(gatewayCredentialHash(user), before)
  assert.equal(decryptGatewayTaskSecret(encryptGatewayTaskSecret('protected-value')), 'protected-value')
  assert.throws(() => decryptGatewayTaskSecret('plaintext'), /SECRET_INVALID/)
  for (let attempt = 0; attempt < 8; attempt++) await assert.rejects(authorizeGatewayAdministration(tx, 2, { password: 'incorrect' }), /REAUTH_REQUIRED/)
  await assert.rejects(authorizeGatewayAdministration(tx, 2, { password: 'changed-password' }), /REAUTH_LOCKED/)
} finally { if (previousKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previousKey }
const enrollmentSource = readFileSync(new URL('../../scripts/enroll-gateway-controller.py', import.meta.url), 'utf8')
const driverSource = readFileSync(new URL('../src/services/gateway-installation-driver.ts', import.meta.url), 'utf8')
assert.ok(enrollmentSource.includes("action == 'initialize'") && enrollmentSource.includes("package.verify_package"))
assert.ok(enrollmentSource.includes("flock") && enrollmentSource.includes("identity.json") && enrollmentSource.includes('Never silently repair'))
assert.ok(driverSource.includes('config.schemaVersion === 2') && driverSource.includes('identity.signingKeyId === config.signingKeyId'))
console.log('Gateway installation guards passed: signed plan/receipt bindings, safe preview, private bootstrap, password/MFA and persistent step replay contract')
