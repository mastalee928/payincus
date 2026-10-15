import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Only run on a disposable CI machine')
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
const require = createRequire('/opt/incudal/server/package.json')
const env = require('dotenv').parse(await readFile('/opt/incudal/.env'))
assert.equal(env.SYSTEM_UPDATE_RELEASE_REPOSITORY, 'mastalee928/payincus')
assert.equal(env.INCUDAL_AGENT_RELEASE_REPOSITORY, 'mastalee928/payincus')
assert.equal(env.INCUDAL_AGENT_RELEASE_DIR, '')
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
console.log('Both frontends, administrator login, machine pool API and backend gateway access passed')
process.exit(0)
