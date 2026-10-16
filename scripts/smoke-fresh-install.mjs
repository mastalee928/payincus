import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Only run on a disposable CI machine')
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
const require = createRequire('/opt/incudal/server/package.json')
const env = require('dotenv').parse(await readFile('/opt/incudal/.env'))
assert.equal(env.SYSTEM_UPDATE_RELEASE_REPOSITORY, 'mastalee928/payincus')
assert.equal(env.INCUDAL_AGENT_RELEASE_REPOSITORY, 'mastalee928/payincus')
assert.equal(env.INCUDAL_AGENT_RELEASE_DIR, '')
const expectedPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
for (const path of ['/opt/incudal/package.json', '/opt/incudal/server/package.json']) {
  assert.equal(JSON.parse(await readFile(path, 'utf8')).version, expectedPackage.version, 'installed package must match the release source')
}
for (const port of [8080, 8081]) {
  const html = await fetch(`http://127.0.0.1:${port}/`).then(response => {
    assert.equal(response.status, 200, `frontend ${port}`)
    return response.text()
  })
  assert.ok(html.includes('<div id="app">'), 'frontend application must be served')
  const entry = html.match(/src="([^\"]+\.js)"/)
  assert.ok(entry, 'entry script must exist')
  assert.equal((await fetch(new URL(entry[1], `http://127.0.0.1:${port}`))).status, 200, 'entry script must be reachable')
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200, 'API proxy must work')
}
const login = await fetch('http://127.0.0.1:8081/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: env.ADMIN_PASSWORD })
})
assert.equal(login.status, 200, 'generated administrator credentials must work')
const session = await login.json()
assert.equal(typeof session.token, 'string', 'admin login must return a session')
assert.equal((await fetch('http://127.0.0.1:8081/api/host-onboarding/inventory', {
  headers: { Authorization: `Bearer ${session.token}` }
})).status, 200, 'empty machine pool must load')
for (const [key, value] of Object.entries(env)) process.env[key] = value
const { gatewayCommand } = await import('/opt/incudal/server/dist/services/onboarding-ssh.js')
const gateway = await gatewayCommand()
assert.equal(gateway.controlIp, '10.253.240.1', 'backend must reach the restricted gateway with its pinned host key')

// Exercise the same published manifest and checksum-pinned downloads used by a
// newly onboarded host. A panel release must not depend on local test binaries.
const expectedAgentVersion = (await readFile(new URL('../agent/VERSION', import.meta.url), 'utf8')).trim()
const { compareAgentVersions } = await import('/opt/incudal/server/dist/lib/agent-version.js')
const manifestResponse = await fetch('http://127.0.0.1:8081/api/agent/manifest.json', { signal: AbortSignal.timeout(60000) })
assert.equal(manifestResponse.status, 200, 'new installation must resolve a published Agent')
const manifest = await manifestResponse.json()
assert.equal(typeof manifest.version, 'string')
const compared = compareAgentVersions(manifest.version, expectedAgentVersion)
assert.ok(compared !== null && compared >= 0, 'published Agent must include the capabilities required by this panel')
const agentDirectory = await mkdtemp(join(tmpdir(), 'incudal-fresh-agent-'))
try {
  for (const arch of ['amd64', 'arm64']) {
    const file = manifest.files?.[`linux-${arch}`]
    assert.ok(file, `Agent ${arch} must be published`)
    assert.equal(file.name, `incudal-agent-linux-${arch}`)
    assert.equal(file.gzip, false)
    assert.match(file.sha256, /^[a-f0-9]{64}$/)
    const url = new URL(`/api/agent/binary/${file.name}`, 'http://127.0.0.1:8081')
    url.searchParams.set('v', manifest.version)
    url.searchParams.set('sha256', file.sha256)
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
    assert.equal(response.status, 200, `published Agent ${arch} must download through the panel`)
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(bytes.length, file.size, `Agent ${arch} size must match the manifest`)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `Agent ${arch} checksum must match`)
    assert.equal(bytes.subarray(0, 4).toString('hex'), '7f454c46', 'Agent must be a Linux executable')
    if ((arch === 'amd64' && process.arch === 'x64') || (arch === 'arm64' && process.arch === 'arm64')) {
      const binaryPath = join(agentDirectory, file.name)
      await writeFile(binaryPath, bytes, { mode: 0o700 })
      const help = await promisify(execFile)(binaryPath, ['-h'], { timeout: 10000 })
      assert.match(help.stdout + help.stderr, /sync-dedicated-ipv6/, 'installed Agent must include IPv6 reconciliation')
    }
  }
} finally {
  await rm(agentDirectory, { recursive: true, force: true })
}
console.log('Both frontends, administrator login, machine pool API, backend gateway and published IPv6 Agent downloads passed')
process.exit(0)
