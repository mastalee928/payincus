// Real database/systemd recovery on disposable GitHub VMs. Only OSS transport
// is replaced with local files; no cloud credentials or customer hosts are used.
import assert from 'node:assert/strict'
import childProcess, { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chown, copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Disposable GitHub runner required')
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
assert.equal(process.platform, 'linux')
assert.equal(process.getuid(), 0)
// Preserve real child execution, but report only fixed operation labels and
// exit metadata when the worker sanitizes an OS error. Never log argv or stderr:
// gateway commands and database utilities can carry identity/credential data.
const originalExec = childProcess.execFile
const originalPromisifiedExec = originalExec[promisify.custom]
const diagnosticExec = (...args) => originalExec(...args)
diagnosticExec[promisify.custom] = (...args) => {
  const pending = originalPromisifiedExec(...args)
  const result = pending.catch(error => {
    const operation = ['is-active', 'restart', 'start', 'stop', 'show', 'strip', 'syncconf', '-u', '-g'].includes(args[1]?.[0]) ? args[1][0] : 'other'
    console.error('Backup drill child failure', JSON.stringify({ program: basename(args[0]), operation,
      exitCode: Number.isInteger(error.code) ? error.code : null,
      signal: ['SIGTERM', 'SIGKILL'].includes(error.signal) ? error.signal : null,
      deviceMissing: /(?:Cannot find device|does not exist|No such device)/i.test(error.stderr || ''),
      deviceExists: /(?:already exists|File exists)/i.test(error.stderr || ''),
      serviceFailed: /Job for .* failed/i.test(error.stderr || '') }))
    throw error
  })
  result.child = pending.child
  return result
}
childProcess.execFile = diagnosticExec
syncBuiltinESMExports()
const exec = promisify(execFile)
const require = createRequire('/opt/incudal/server/package.json')
const initialEnv = require('dotenv').parse(await readFile('/opt/incudal/.env'))
Object.assign(process.env, initialEnv, { NODE_ENV: 'production', INCUDAL_APP_DIR: '/opt/incudal' })
const uid = Number((await exec('/usr/bin/id', ['-u', 'incudal'])).stdout.trim())
const gid = Number((await exec('/usr/bin/id', ['-g', 'incudal'])).stdout.trim())
process.setgid(gid) // Match the installed root:incudal oneshot's file ownership.
const core = await import('/opt/incudal/server/dist/services/platform-backup-core.js')
const { AliyunOssClient } = await import('/opt/incudal/server/dist/services/aliyun-oss-client.js')
const { runPlatformBackupTask } = await import('/opt/incudal/server/dist/services/platform-backup-worker.js')
const { pgQuery } = await import('/opt/incudal/server/dist/services/platform-backup-database.js')
const controllerRoot = '/var/lib/incudal-gateway-controller'
const controllerKeyBefore = createHash('sha256').update(await readFile(`${controllerRoot}/signing.pem`)).digest('hex')
const controllerIdentityBefore = await readFile(`${controllerRoot}/identity.json`, 'utf8')
const storage = await mkdtemp('/var/tmp/incudal-backup-drill-')
const records = new Map()
let config = core.normalizeConfig({ enabled: false, region: 'oss-cn-hangzhou', bucket: 'local-drill-only', prefix: 'drill/',
  accessKeyId: 'LocalDrillOnly', accessKeySecret: randomUUID(), backupPassword: randomUUID(), intervalHours: 24, retention: 3 })
const password = core.openSecret(config.backupPassword)
const saveConfig = async () => { await core.writeBackupConfig(config); await chown(core.statePath('inbox', 'config.json'), uid, gid) }
await saveConfig()
// Local object storage stubs are in this CI process only, never in production code.
AliyunOssClient.prototype.assertBackupBucket = async () => {}
AliyunOssClient.prototype.retain = async () => {}
AliyunOssClient.prototype.upload = async function (settings, source, metadata, verification, _checkpoint, readablePath) {
  const prefix = `${settings.prefix}${settings.installationId}/${metadata.id}/`
  const path = join(storage, metadata.id)
  await copyFile(source, path); await copyFile(path, verification)
  assert.equal(createHash('sha256').update(await readFile(verification)).digest('hex'), metadata.sha256)
  assert.ok(metadata.readableZip && readablePath)
  const zipCopy = join(storage, metadata.readableZip.name)
  await copyFile(readablePath, zipCopy)
  assert.equal(createHash('sha256').update(await readFile(zipCopy)).digest('hex'), metadata.readableZip.sha256)
  records.set(prefix, { ...metadata, prefix, path }); return prefix
}
AliyunOssClient.prototype.index = async prefix => { assert.ok(records.has(prefix)); return records.get(prefix) }
AliyunOssClient.prototype.download = async (record, destination) => { await copyFile(record.path, destination) }
async function task(kind, extras = {}) {
  config = await core.readBackupConfig()
  const id = randomUUID()
  const request = { id, kind, createdBy: 0, createdAt: new Date().toISOString(), config, ...extras }
  if (['restore', 'rollback', 'resume'].includes(kind)) {
    // Run the shipped oneshot with its actual PID/task argv and operation flock.
    // Startup recovery must recognize the live owner, not mistake this smoke
    // process for an interrupted restore and roll its activation back.
    await core.writeJson(core.statePath('inbox', `${id}.json`), request)
    await exec('/usr/local/libexec/incudal/incudal-online-task', ['platform-backup', id], { timeout: 180000 })
    Object.assign(process.env, require('dotenv').parse(await readFile('/opt/incudal/.env')))
  } else {
    await runPlatformBackupTask(request)
  }
  const result = await core.readJson(core.statePath('results', `${id}.json`))
  if (result?.status !== 'success') {
    const hold = await core.readJson(join(core.backupRoot(), 'recovery-hold.json'))
    const journal = hold?.taskId && await core.readJson(core.statePath('private', `${core.validateId(hold.taskId)}/journal.json`))
    const stage = ['prepared', 'switching', 'database_switched', 'files_switched', 'awaiting_review', 'rolled_back_review'].includes(journal?.stage) ? journal.stage : 'unknown'
    console.error('Backup drill recovery state', JSON.stringify({ kind, held: Boolean(hold), journalStage: stage }))
  }
  assert.equal(result?.status, 'success', `${kind}: ${result?.stage} ${result?.error || ''}`)
  console.log(`Platform backup drill: ${kind} passed`)
  return result
}
async function health(held) {
  const response = await fetch('http://127.0.0.1:3001/api/health')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).recoveryHeld, held)
}
async function gatewayState() {
  const links = JSON.parse((await exec('/usr/sbin/ip', ['-j', 'address', 'show', 'dev', 'incudal-mgmt'])).stdout)
  assert.equal(links.length, 1)
  return {
    mtu: links[0].mtu,
    addresses: links[0].addr_info.map(item => `${item.family}:${item.local}/${item.prefixlen}`).sort(),
    publicKey: (await exec('/usr/bin/wg', ['show', 'incudal-mgmt', 'public-key'])).stdout.trim(),
    listenPort: (await exec('/usr/bin/wg', ['show', 'incudal-mgmt', 'listen-port'])).stdout.trim(),
    peers: (await exec('/usr/bin/wg', ['show', 'incudal-mgmt', 'allowed-ips'])).stdout.trim()
  }
}
try {
  for (const entry of ['user', 'admin']) {
    assert.equal(await readFile(`/opt/incudal/client/dist/${entry}/recovery/payincus-recovery.py`, 'utf8'), await readFile('/opt/incudal/scripts/platform-backup-recovery.py', 'utf8'))
    assert.equal(await readFile(`/opt/incudal/client/dist/${entry}/recovery/恢复说明.md`, 'utf8'), await readFile('/opt/incudal/scripts/platform-backup-recovery-guide.md', 'utf8'))
  }
  await exec('python3', ['/opt/incudal/scripts/platform-backup-recovery.py', 'status'], { timeout: 15000 })
  for (const path of ['/etc/systemd/system/incudal-platform-backup@.service', '/etc/systemd/system/incudal-backend.service.d/platform-backup.conf']) assert.ok((await stat(path)).isFile())
  await exec('/usr/bin/sudo', ['-u', 'incudal', 'test', '-w', '/var/lib/incudal-backup/inbox'])
  await assert.rejects(exec('/usr/bin/sudo', ['-u', 'incudal', 'test', '-r', '/var/lib/incudal-backup/private']))
  const key = `backup_drill_${randomUUID()}`
  await pgQuery('INSERT INTO system_configs (key, value, updated_at) VALUES ($1, $2, NOW())', [key, 'snapshot'])
  const backup = await task('backup')
  await pgQuery('UPDATE system_configs SET value=$1 WHERE key=$2', ['before-restore', key])
  // Restore across different environment keys and verify explicit rollback also
  // recovers the destination key and its encrypted backup configuration.
  const targetKey = randomUUID() + randomUUID()
  const sourceSecret = core.openSecret(config.accessKeySecret)
  const originalEndpoint = initialEnv.ONBOARDING_WG_ENDPOINT
  assert.ok(originalEndpoint && /:51820$/.test(originalEndpoint), 'fresh-install management endpoint expected')
  const targetEnv = { ...initialEnv, ENCRYPTION_KEY: targetKey, ONBOARDING_WG_ENDPOINT: originalEndpoint.replace(/:51820$/, ':51999') }
  await writeFile('/opt/incudal/.env', Object.entries(targetEnv).map(([name, value]) => `${name}='${value}'`).join('\n') + '\n')
  process.env.ENCRYPTION_KEY = targetKey
  config.accessKeySecret = core.sealSecret(sourceSecret); config.backupPassword = core.sealSecret(password)
  await saveConfig()
  const preview = await task('preview', { sourcePrefix: backup.objectPrefix, password: core.sealSecret(password) })
  const gatewayEndpoints = (await exec('/usr/bin/wg', ['show', 'incudal-mgmt', 'endpoints'])).stdout
  const gatewayIfindex = (await readFile('/sys/class/net/incudal-mgmt/ifindex', 'utf8')).trim()
  const gatewayBefore = await gatewayState()
  await task('restore', { previewId: preview.id, confirmation: `RESTORE ${preview.id}` })
  for (const name of ['recovery-hold.json', 'recovery-operator.json']) {
    assert.equal((await stat(join(core.backupRoot(), name))).mode & 0o777, 0o640, 'restored public state retains exact service-read mode under umask077')
    await exec('/usr/bin/sudo', ['-u', 'incudal', 'test', '-r', join(core.backupRoot(), name)])
  }
  const legacyHold = await core.readJson(join(core.backupRoot(), 'recovery-hold.json'))
  await core.writeJson(join(core.backupRoot(), 'recovery-hold.json'), { ...legacyHold, autoResume: false }, 0o640)
  assert.equal((await readFile('/sys/class/net/incudal-mgmt/ifindex', 'utf8')).trim(), gatewayIfindex, 'same-controller recovery must not recreate the management interface')
  assert.equal((await exec('/usr/bin/wg', ['show', 'incudal-mgmt', 'endpoints'])).stdout, gatewayEndpoints, 'same-controller recovery must preserve learned peer endpoints')
  await health(true)
  assert.equal((await pgQuery('SELECT value FROM system_configs WHERE key=$1', [key]))[0].value, 'snapshot')
  assert.equal(core.openSecret((await core.readBackupConfig()).backupPassword), password)
  assert.equal(process.env.ENCRYPTION_KEY, initialEnv.ENCRYPTION_KEY)
  const restoredEnv = require('dotenv').parse(await readFile('/opt/incudal/.env'))
  assert.equal(restoredEnv.ONBOARDING_WG_ENDPOINT, originalEndpoint, 'restored UDP listen port must replace fresh-machine environment default')
  assert.equal(restoredEnv.ONBOARDING_GATEWAY_FINGERPRINT, initialEnv.ONBOARDING_GATEWAY_FINGERPRINT, 'destination SSH host identity must remain pinned')
  assert.equal(createHash('sha256').update(await readFile(`${controllerRoot}/signing.pem`)).digest('hex'), controllerKeyBefore)
  assert.equal(await readFile(`${controllerRoot}/identity.json`, 'utf8'), controllerIdentityBefore)
  await exec('/usr/bin/python3', ['-I', '-B', '/opt/incudal/scripts/enroll-gateway-controller.py', '--verify'])
  for (const path of ['/api/host-onboarding/inventory', '/api/instances', '/api/oauth/github/callback']) assert.equal((await fetch(`http://127.0.0.1:3001${path}`)).status, 503)
  assert.equal((await fetch('http://127.0.0.1:3001/api/system-config/public')).status, 200)
  const login = await fetch('http://127.0.0.1:3001/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: initialEnv.ADMIN_PASSWORD }) })
  assert.equal(login.status, 200, 'administrator can log in while recovery is held')
  console.log('PASS installed recovery state: service-readable 0640 files and administrator login while held')
  await exec('/usr/bin/sudo', ['-u', 'incudal', 'test', '-r', '/opt/incudal/server/certs/onboarding-gateway.key'])
  // Model an interrupted worker whose files already match but whose live
  // network still differs. Rollback must reconcile the kernel, not the ifindex.
  await exec('/usr/sbin/ip', ['link', 'set', 'dev', 'incudal-mgmt', 'mtu', gatewayBefore.mtu === 1280 ? '1380' : '1280'])
  await exec('/usr/bin/wg', ['set', 'incudal-mgmt', 'listen-port', gatewayBefore.listenPort === '51998' ? '51997' : '51998'])
  assert.notDeepEqual(await gatewayState(), gatewayBefore, 'drill must actually change live gateway state')
  await task('rollback', { confirmation: 'ROLLBACK RESTORE' })
  assert.deepEqual(await gatewayState(), gatewayBefore, 'rollback must restore live addresses, MTU, identity, listen port and peers')
  await health(true)
  assert.equal((await pgQuery('SELECT value FROM system_configs WHERE key=$1', [key]))[0].value, 'before-restore')
  assert.equal(process.env.ENCRYPTION_KEY, targetKey)
  assert.equal(require('dotenv').parse(await readFile('/opt/incudal/.env')).ONBOARDING_WG_ENDPOINT, targetEnv.ONBOARDING_WG_ENDPOINT, 'rollback preserves destination environment bytes')
  assert.equal(createHash('sha256').update(await readFile(`${controllerRoot}/signing.pem`)).digest('hex'), controllerKeyBefore)
  assert.equal(core.openSecret((await core.readBackupConfig()).backupPassword), password)
  // The legacy rollback drill must supply the current batch and real review
  // receipts, just like the protected route. It is not the one-click contract.
  Object.assign(process.env, require('dotenv').parse(await readFile('/opt/incudal/.env')))
  const recoveryState = await import('/opt/incudal/server/dist/services/platform-recovery-state.js')
  const { recordRecoveryEvidence } = await import('/opt/incudal/server/dist/services/platform-recovery-evidence.js')
  const { verifyRecoveryGateway } = await import('/opt/incudal/server/dist/services/platform-recovery-gateway.js')
  const rollbackBatch = await recoveryState.activeRecoveryBatch()
  assert.equal(rollbackBatch.mode, 'rollback')
  assert.equal((await pgQuery('SELECT count(*)::int count FROM hosts'))[0].count, 0, 'fresh fixture must have no customer hosts')
  for (const category of ['finance', 'access', 'tasks']) {
    await recordRecoveryEvidence(category, { reference: `fresh-rollback-${category}`, observedAt: new Date().toISOString(),
      sourceHash: await recoveryState.recoveryDatasetHash(category), evidenceHash: createHash('sha256').update(`empty-fixture-${category}`).digest('hex') },
    rollbackBatch.operator_id, { password: initialEnv.ADMIN_PASSWORD })
  }
  await verifyRecoveryGateway(rollbackBatch, rollbackBatch.operator_id)
  await task('resume', { confirmation: 'RESUME AFTER RECONCILIATION', recoveryBatchId: rollbackBatch.id })
  await health(false)
  assert.equal((await exec('/usr/bin/systemctl', ['show', 'incudal-backend', '-p', 'NRestarts', '--value'])).stdout.trim(), '0')
  console.log('Linux backup/preview/restore/rollback/resume and key consistency passed; OSS transport was simulated.')

  // Exercise the current snapshot policy independently. The installed protected
  // backend must verify the real local gateway and dispatch its own root resume;
  // no finance/access receipt or second operator confirmation is provided.
  const automaticPreview = await task('preview', { sourcePrefix: backup.objectPrefix, password: core.sealSecret(password) })
  const automaticRestore = await task('restore', { previewId: automaticPreview.id,
    confirmation: `RESTORE ${automaticPreview.id}`, restorePolicy: 'snapshot-v1' })
  const until = Date.now() + 120000
  let complete = false
  while (Date.now() < until) {
    const [batch] = await pgQuery('SELECT completed_at FROM platform_recovery_batches WHERE id=$1', [automaticRestore.id])
    if (batch?.completed_at && !await core.readJson(join(core.backupRoot(), 'recovery-hold.json')) &&
        !await core.readJson(join(core.backupRoot(), 'recovery-activation.json'))) { complete = true; break }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!complete) {
    const checks = await pgQuery("SELECT category,payload FROM platform_recovery_evidence WHERE batch_id=$1 AND category IN ('gateway-check','auto-resume') ORDER BY created_at DESC LIMIT 4", [automaticRestore.id])
    console.error('Snapshot continuation checks', JSON.stringify(checks.map(({category,payload}) => ({category,
      status: ['retry','blocked','dispatched','success','running'].includes(payload?.status) ? payload.status : 'unknown',
      code: /^[A-Z0-9_]{1,100}$/.test(payload?.code || '') ? payload.code : null,
      attempt: Number.isSafeInteger(payload?.attempt) ? payload.attempt : null}))))
  }
  assert.ok(complete, 'snapshot recovery must finish through installed automatic review and root resume')
  await health(false)
  assert.equal((await pgQuery('SELECT value FROM system_configs WHERE key=$1', [key]))[0].value, 'snapshot')
  assert.equal(createHash('sha256').update(await readFile(`${controllerRoot}/signing.pem`)).digest('hex'), controllerKeyBefore)
  assert.equal(await readFile(`${controllerRoot}/identity.json`, 'utf8'), controllerIdentityBefore)
  const [{ count: manualReceipts }] = await pgQuery("SELECT count(*)::int count FROM platform_recovery_evidence WHERE batch_id=$1 AND category IN ('finance','access','tasks')", [automaticRestore.id])
  assert.equal(manualReceipts, 0, 'snapshot policy must not require manual review evidence')
  console.log('PASS installed snapshot policy: real database and gateway identity restored; automatic root resume; zero manual financial/access/task receipts; OSS transport simulated; no customer hosts.')
} finally { await rm(storage, { recursive: true, force: true }) }
const { closePrismaDatabase } = await import('/opt/incudal/server/dist/db/prisma.js')
await closePrismaDatabase()
process.exit(0)
