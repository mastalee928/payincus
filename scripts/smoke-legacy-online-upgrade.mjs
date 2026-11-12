// Disposable GitHub VM only. Runs the shipped v1.8.8 worker with real PG,
// filesystem, systemd, migration, helper installation and health checks.
// Only the not-yet-published candidate Release HTTP response is local.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile, realpath, lstat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'

assert.equal(process.env.GITHUB_ACTIONS, 'true')
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0)
const [mode, archiveArg] = process.argv.slice(2)
assert.ok(['migrate', 'before', 'worker', 'rolled-back', 'after'].includes(mode))
const archive = resolve(archiveArg), stateFile = '/root/incudal-legacy-upgrade.json'
const atomic = await lstat('/opt/incudal/current').then(info => info.isSymbolicLink()).catch(() => false)
const app = await realpath(atomic ? '/opt/incudal/current' : '/opt/incudal')
const require = createRequire(app + '/server/package.json')
const env = require('dotenv').parse(await readFile('/opt/incudal/.env'))
const exec = promisify(execFile)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const identities = ['/var/lib/incudal-gateway-controller/signing.pem', '/var/lib/incudal-gateway-controller/identity.json',
  '/etc/wireguard/incudal-mgmt.conf', '/root/.ssh/incudal-host-management', '/opt/incudal/.env']
const { Client } = require('pg')

if (mode === 'migrate') {
  const candidateRequire = createRequire(archive + '/server/package.json')
  const cliMetadata = candidateRequire.resolve('prisma/package.json')
  const metadata = JSON.parse(await readFile(cliMetadata))
  const cli = resolve(cliMetadata, '..', typeof metadata.bin === 'string' ? metadata.bin : metadata.bin.prisma)
  await exec(process.execPath, [cli, 'migrate', 'deploy'], { cwd: archive + '/server', env: { ...process.env, ...env }, timeout: 300000 })
  console.log('PASS rollback-state setup: actual candidate Prisma migrations applied while old runtime stays installed')
} else if (mode === 'before') {
  assert.equal(JSON.parse(await readFile(app + '/version.json')).version, 'v1.8.8')
  const client = new Client({ connectionString: env.DATABASE_URL }); await client.connect()
  try {
    const admin = (await client.query("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1")).rows[0]
    assert.ok(admin)
    const { stdout: packageText } = await exec('tar', ['-xOf', archive, './server/package.json'])
    const target = 'v' + JSON.parse(packageText).version
    assert.match(target, /^v\d+\.\d+\.\d+$/)
    const task = (await client.query("INSERT INTO system_update_tasks(target_version,status,started_by_user_id,updated_at) VALUES($1,'pending',$2,NOW()) RETURNING id", [target, admin.id])).rows[0]
    const original = {}
    for (const file of identities) original[file] = hash(await readFile(file))
    const enrollment = JSON.parse(await readFile('/var/lib/incudal-gateway-controller/enrollment.json'))
    for (const component of Object.values(enrollment.components)) {
      assert.equal(component.version, '1.8.8')
      const envelope = JSON.parse(await readFile(component.directory + '/manifest.json'))
      const manifest = JSON.parse(Buffer.from(envelope.payload, 'base64'))
      assert.equal(manifest.files.length, 21)
    }
    const applied = (await client.query("SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name='20261111170000_instance_renewal_price' AND finished_at IS NOT NULL AND rolled_back_at IS NULL")).rows[0].n
    assert.equal(applied, 1)
    await writeFile(stateFile, JSON.stringify({ taskId: task.id, target, original, atomic, oldApp: app, oldComponents: enrollment.components }), { mode: 0o600 })
    console.log('PASS legacy baseline: genuine v1.8.8 installed, original 21-file components and controller/network identity recorded')
  } finally { await client.end() }
} else if (mode === 'worker') {
  const state = JSON.parse(await readFile(stateFile))
  const bytes = await readFile(archive), sha256 = hash(bytes), arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const name = `incudal-${state.target}-linux-${arch}.tar.gz`
  const url = `https://github.com/mastalee928/payincus/releases/download/${state.target}/${name}`
  const manifestUrl = `https://github.com/mastalee928/payincus/releases/download/${state.target}/ota-manifest.json`
  const manifest = { artifacts: [{ name, platform: 'linux', arch, url, sha256, size: bytes.length }] }
  const metadata = { tag_name: state.target, draft: false, assets: [
    { id: 1, name: 'ota-manifest.json', browser_download_url: manifestUrl },
    { id: 2, name, browser_download_url: url, size: bytes.length, digest: 'sha256:' + sha256 }
  ] }
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = async (input, options) => {
    const address = String(input)
    if (address === `https://api.github.com/repos/mastalee928/payincus/releases/tags/${state.target}`) return Response.json(metadata)
    if (address === manifestUrl || address === 'https://api.github.com/repos/mastalee928/payincus/releases/assets/1') return Response.json(manifest)
    if (address === url || address === 'https://api.github.com/repos/mastalee928/payincus/releases/assets/2') {
      return new Response(Readable.toWeb(createReadStream(archive)), { headers: { 'content-length': String(bytes.length) } })
    }
    return fetchOriginal(input, options)
  }
  for (const [key, value] of Object.entries(env)) process.env[key] = value
  process.env.LC_ALL = 'C'
  process.env.INCUDAL_APP_DIR = app; process.env.INSTALL_DIR = '/opt/incudal'
  process.env.SYSTEM_UPDATE_APPLY_MODE = 'artifact'; process.env.SERVICE_NAME = 'incudal-backend'
  process.env.PATH = '/usr/local/libexec/incudal/ota-path:' + process.env.PATH
  process.argv = [process.execPath, app + '/server/dist/scripts/run-system-update-task.js', String(state.taskId), state.target]
  // Same platform maintenance lock as the root wrapper is held by the shell.
  await import(app + '/server/dist/scripts/run-system-update-task.js')
} else if (mode === 'rolled-back') {
  const state = JSON.parse(await readFile(stateFile))
  const client = new Client({ connectionString: env.DATABASE_URL }); await client.connect()
  try {
    const task = (await client.query('SELECT status FROM system_update_tasks WHERE id=$1', [state.taskId])).rows[0]
    assert.equal(task.status, 'rolled_back')
    assert.equal(JSON.parse(await readFile(app + '/server/package.json')).version, '1.8.8')
    for (const file of identities) assert.equal(hash(await readFile(file)), state.original[file])
    const enrollment = JSON.parse(await readFile('/var/lib/incudal-gateway-controller/enrollment.json'))
    assert.ok(Object.values(enrollment.components).every(component => component.version === '1.8.8'))
    await exec('python3', ['-I', '-B', app + '/scripts/enroll-gateway-controller.py', '--verify'])
    await exec('systemctl', ['is-active', '--quiet', 'incudal-backend'])
    console.log('PASS actual old worker recovered after post-install failure: old runtime and component enrollment restored, original identities preserved')
  } finally { await client.end() }
} else {
  const state = JSON.parse(await readFile(stateFile))
  const client = new Client({ connectionString: env.DATABASE_URL }); await client.connect()
  try {
    const task = (await client.query('SELECT status,backup_path FROM system_update_tasks WHERE id=$1', [state.taskId])).rows[0]
    assert.equal(task.status, 'success', 'the actual old online-update worker must finish without rollback')
    assert.equal(atomic, state.atomic)
    if (atomic) { assert.equal(task.backup_path, state.oldApp); assert.notEqual(app, state.oldApp) }
    for (const file of identities) assert.equal(hash(await readFile(file)), state.original[file], 'controller/network/environment identity preserved: ' + file)
    assert.equal((await client.query("SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name='20261111170000_instance_renewal_price' AND finished_at IS NOT NULL AND rolled_back_at IS NULL")).rows[0].n, 1)
    const version = JSON.parse(await readFile(app + '/server/package.json'))
    assert.equal(version.version, state.target.slice(1))
    const enrollment = JSON.parse(await readFile('/var/lib/incudal-gateway-controller/enrollment.json'))
    for (const component of Object.values(enrollment.components)) {
      assert.equal(component.version, state.target.slice(1))
      assert.ok((await readFile(component.directory + '/scripts/ensure-time-sync.py')).length > 0)
    }
    assert.equal(hash(await readFile(app + '/scripts/ensure-time-sync.py')), hash(await readFile('/usr/local/libexec/incudal/ensure-time-sync.py')))
    await exec('systemctl', ['is-active', '--quiet', 'incudal-backend'])
    await exec('systemctl', ['is-enabled', '--quiet', 'incudal-time-sync.timer'])
    const { stdout } = await exec('curl', ['-fsS', '--max-time', '5', 'http://127.0.0.1:3001/api/health'])
    assert.equal(JSON.parse(stdout).status, 'ok')
    console.log('PASS genuine v1.8.8 worker -> new complete archive -> original identities preserved -> migrations/helpers/clock installed -> one healthy backend; candidate HTTP transport was local')
  } finally { await client.end() }
}
