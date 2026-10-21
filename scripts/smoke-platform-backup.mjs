// Real database/systemd recovery on disposable GitHub VMs. Only OSS transport
// is replaced with local files; no cloud credentials or customer hosts are used.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chown, copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { promisify } from 'node:util'

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Disposable GitHub runner required')
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
assert.equal(process.platform, 'linux')
assert.equal(process.getuid(), 0)
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
  await runPlatformBackupTask({ id, kind, createdBy: 0, createdAt: new Date().toISOString(), config, ...extras })
  const result = await core.readJson(core.statePath('results', `${id}.json`))
  assert.equal(result?.status, 'success', `${kind}: ${result?.stage} ${result?.error || ''}`)
  console.log(`Platform backup drill: ${kind} passed`)
  return result
}
async function health(held) {
  const response = await fetch('http://127.0.0.1:3001/api/health')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).recoveryHeld, held)
}
try {
  for (const entry of ['user', 'admin']) {
    assert.equal(await readFile(`/opt/incudal/client/dist/${entry}/recovery/payincus-recovery.py`, 'utf8'), await readFile('/opt/incudal/scripts/platform-backup-recovery.py', 'utf8'))
    assert.equal(await readFile(`/opt/incudal/client/dist/${entry}/recovery/恢复说明.md`, 'utf8'), await readFile('/opt/incudal/scripts/platform-backup-recovery-guide.md', 'utf8'))
  }
  await exec('python3', ['/opt/incudal/scripts/platform-backup-recovery.py', 'status'])
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
  const targetEnv = { ...initialEnv, ENCRYPTION_KEY: targetKey }
  await writeFile('/opt/incudal/.env', Object.entries(targetEnv).map(([name, value]) => `${name}='${value}'`).join('\n') + '\n')
  process.env.ENCRYPTION_KEY = targetKey
  config.accessKeySecret = core.sealSecret(sourceSecret); config.backupPassword = core.sealSecret(password)
  await saveConfig()
  const preview = await task('preview', { sourcePrefix: backup.objectPrefix, password: core.sealSecret(password) })
  const gatewayEndpoints = (await exec('/usr/bin/wg', ['show', 'incudal-mgmt', 'endpoints'])).stdout
  const gatewayIfindex = (await readFile('/sys/class/net/incudal-mgmt/ifindex', 'utf8')).trim()
  await task('restore', { previewId: preview.id, confirmation: `RESTORE ${preview.id}` })
  assert.equal((await readFile('/sys/class/net/incudal-mgmt/ifindex', 'utf8')).trim(), gatewayIfindex, 'same-controller recovery must not recreate the management interface')
  assert.equal((await exec('/usr/bin/wg', ['show', 'incudal-mgmt', 'endpoints'])).stdout, gatewayEndpoints, 'same-controller recovery must preserve learned peer endpoints')
  await health(true)
  assert.equal((await pgQuery('SELECT value FROM system_configs WHERE key=$1', [key]))[0].value, 'snapshot')
  assert.equal(core.openSecret((await core.readBackupConfig()).backupPassword), password)
  assert.equal(process.env.ENCRYPTION_KEY, initialEnv.ENCRYPTION_KEY)
  for (const path of ['/api/host-onboarding/inventory', '/api/instances', '/api/oauth/github/callback']) assert.equal((await fetch(`http://127.0.0.1:3001${path}`)).status, 503)
  assert.equal((await fetch('http://127.0.0.1:3001/api/system-config/public')).status, 200)
  const login = await fetch('http://127.0.0.1:3001/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: initialEnv.ADMIN_PASSWORD }) })
  assert.equal(login.status, 200, 'administrator can log in while recovery is held')
  await exec('/usr/bin/sudo', ['-u', 'incudal', 'test', '-r', '/opt/incudal/server/certs/onboarding-gateway.key'])
  await task('rollback', { confirmation: 'ROLLBACK RESTORE' })
  assert.equal((await readFile('/sys/class/net/incudal-mgmt/ifindex', 'utf8')).trim(), gatewayIfindex, 'rollback must preserve the unchanged management interface')
  assert.equal((await exec('/usr/bin/wg', ['show', 'incudal-mgmt', 'endpoints'])).stdout, gatewayEndpoints, 'rollback must preserve learned peer endpoints')
  await health(true)
  assert.equal((await pgQuery('SELECT value FROM system_configs WHERE key=$1', [key]))[0].value, 'before-restore')
  assert.equal(process.env.ENCRYPTION_KEY, targetKey)
  assert.equal(core.openSecret((await core.readBackupConfig()).backupPassword), password)
  await task('resume', { confirmation: 'RESUME AFTER RECONCILIATION' })
  await health(false)
  assert.equal((await exec('/usr/bin/systemctl', ['show', 'incudal-backend', '-p', 'NRestarts', '--value'])).stdout.trim(), '0')
  console.log('Linux backup/preview/restore/rollback/resume and key consistency passed; OSS transport was simulated.')
} finally { await rm(storage, { recursive: true, force: true }) }
