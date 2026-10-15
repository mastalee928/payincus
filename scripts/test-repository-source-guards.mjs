import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = path => readFileSync(resolve(root, path), 'utf8')
const repository = 'mastalee928/payincus'
for (const path of ['README.md', 'scripts/install-panel.sh', 'scripts/init-env.sh', 'deploy/incudal-online-task.sh.example', 'server/src/lib/system-version.ts', 'server/src/routes/agent.ts', 'docs/fork-release.md']) {
  const content = read(path)
  assert.ok(content.includes(repository), `${path} must use the maintained repository`)
  assert.ok(!/VipMaxxxx\/payincus/i.test(content), `${path} must not direct installations or updates to the upstream repository`)
}
const readme = read('README.md')
assert.ok(!/https:\/\/(?:[a-z]+\.)?payincus\.com|t\.me\/Payincus/.test(readme), 'README links must belong to this project')
for (const match of readme.matchAll(/\]\(([^)]+)\)|href="([^"]+)"/g)) {
  const link = match[1] || match[2]
  if (/^(https?:|#)/.test(link)) continue
  assert.ok(existsSync(resolve(root, link.split('#')[0])), `README target must exist: ${link}`)
}
assert.match(read('LICENSE'), /Copyright \(c\) 2026, VipMaxxxx/, 'original copyright must be retained')
const workflow = read('.github/workflows/release.yml')
for (const path of ['probe-onboarding-resources.py', 'ensure-host-swap.py', 'configure-oci-node-network.sh', 'onboarding-gateway.py', 'install-onboarding-gateway.sh', 'setup-onboarding-control.py', 'refresh-onboarding-gateway.sh', 'install-panel.sh']) {
  assert.ok(workflow.includes(`cp scripts/${path} release/scripts/`), `release must include ${path}`)
}
assert.ok(workflow.includes('fresh-install:'), 'publication must depend on fresh installation checks')
assert.ok(workflow.includes('- fresh-install'), 'Release must wait for fresh installation checks')
const installer = read('scripts/install-panel.sh')
assert.ok(installer.includes('configure_host_pool_gateway'), 'installer must configure the management gateway')
assert.ok(installer.includes('--configure-host-pool'), 'existing installations need an explicit gateway setup entry')
assert.ok(installer.includes('python3 openssh-client openssh-server wireguard-tools'), 'installer must install gateway dependencies')
const gatewayInstaller = read('scripts/install-onboarding-gateway.sh')
const keyMode = gatewayInstaller.indexOf('chmod 600 "$app_key_path"')
const keyRead = gatewayInstaller.indexOf('app_public_key=$(ssh-keygen -y -f "$app_key_path")')
assert.ok(keyMode >= 0 && keyRead > keyMode, 'gateway installer must restrict the application key before OpenSSH reads it')
assert.ok(!existsSync(resolve(root, 'docs-site/docs/public/CNAME')), 'do not claim an upstream domain')
console.log('Repository source and fresh installation guards passed')
