import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import ssh2 from '../server/node_modules/ssh2/lib/index.js'
const { Client } = ssh2
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')

assert.equal(process.platform, 'linux', 'Native Alpine test requires disposable Linux and Docker')
const baselines = {
  '3.19': ['9.6_p1-r2', '9.6_p1-r3'], '3.20': ['9.7_p1-r5', '9.7_p1-r6'],
  '3.21': ['9.9_p2-r0', '9.9_p2-r1'], '3.22': ['10.0_p1-r10', '10.0_p1-r11'],
  '3.23': ['10.2_p1-r0', '10.2_p1-r1'], '3.24': ['10.3_p1-r1', '10.3_p1-r2']
}
const branch = process.argv[2] || '3.22'
assert.ok(baselines[branch], 'Test branch needs a verified official patch baseline')
const [oldRevision, fixedRevision] = baselines[branch]
const name = `incudal-alpine-ssh-${randomUUID().slice(0, 8)}`
const docker = (args, input) => execFileSync('docker', args, { input, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
const password = 'Native-Alpine-Original-Password-Only-2026!'
let connection, echoStream, sftp, file, pump, pumpError, pumping = true, echoClosed = false, transferClosed = false
const received = []
const sent = []
const blocks = []
try {
  docker(['run', '-d', '--name', name, '-p', '127.0.0.1::2222', '-v', `${root}/server/templates/alpine-ssh-security.sh:/opt/alpine-ssh-security.sh:ro`, `alpine:${branch}`, 'sleep', '600'])
  // Old signed revision is fetched through the branch's package trust keys.
  docker(['exec', '-i', name, 'sh', '-s'], `set -eu
apk add --no-cache openrc openssh-server-common-openrc ca-certificates
mkdir /opt/old-ssh
for package in openssh-server openssh-server-common openssh-keygen; do
  wget -T 20 -O "/opt/old-ssh/$package.apk" "https://dl-cdn.alpinelinux.org/alpine/v${branch}/main/$(apk --print-arch)/$package-${oldRevision}.apk"
done
apk add --no-cache /opt/old-ssh/openssh-server.apk /opt/old-ssh/openssh-server-common.apk /opt/old-ssh/openssh-keygen.apk
## Legacy OpenRC expects boot to create its state and exclusive-lock directories.
## This disposable container has no init; do not fabricate a started sshd state.
for state in exclusive started starting stopping inactive wasinactive failed hotplugged scheduled options daemons; do
  mkdir -p "/run/openrc/$state"
done
touch /run/openrc/softlevel
# Docker has no boot runlevel or service-managed networking/cgroups.
printf '%s\\n' 'rc_depend_strict="NO"' 'rc_sys="docker"' 'rc_cgroup_mode="none"' >> /etc/rc.conf
printf '%s\\n' 'root:${password}' | chpasswd
cat > /etc/ssh/sshd_config <<'CONF'
Port 2222
PermitRootLogin yes
PasswordAuthentication yes
PubkeyAuthentication yes
UsePAM no
Subsystem sftp internal-sftp
CONF
ssh-keygen -A
echo 'sshd_disable_keygen="yes"' >> /etc/conf.d/sshd
echo 'rc_need="!net"' >> /etc/conf.d/sshd
if ! rc-service sshd start; then
  ls -ld /run/openrc /run/openrc/exclusive >&2
  rc-service sshd status >&2 || true
  exit 1
fi
`)
  const mapping = docker(['port', name, '2222/tcp']).trim()
  const port = Number(mapping.split(':').at(-1))
  const fingerprint = docker(['exec', name, 'ssh-keygen', '-lf', '/etc/ssh/ssh_host_ed25519_key.pub', '-E', 'sha256']).match(/SHA256:[A-Za-z0-9+/]+/)[0]
  const connect = (candidate, username = 'root') => new Promise((resolve, reject) => {
    const client = new Client()
    client.on('error', error => { client.destroy(); reject(error) })
    client.once('ready', () => resolve(client))
    client.connect({ host: '127.0.0.1', port, username, password: candidate, readyTimeout: 8000,
      algorithms: { serverHostKey: ['ssh-ed25519'] },
      hostVerifier: key => `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}` === fingerprint })
  })
  connection = await connect(password)
  echoStream = await new Promise((resolve, reject) => connection.exec('cat', (error, stream) => error ? reject(error) : resolve(stream)))
  echoStream.on('data', data => received.push(data))
  echoStream.on('close', () => { echoClosed = true })
  sftp = await new Promise((resolve, reject) => connection.sftp((error, value) => error ? reject(error) : resolve(value)))
  sftp.on('close', () => { transferClosed = true })
  file = await new Promise((resolve, reject) => sftp.open('/root/continuous-transfer', 'w', (error, handle) => error ? reject(error) : resolve(handle)))
  pump = (async () => {
    let position = 0
    while (pumping) {
      const token = Buffer.from(`session-${blocks.length}\n`); sent.push(token); echoStream.write(token)
      const block = Buffer.alloc(32768, blocks.length % 251); blocks.push(block)
      await new Promise((resolve, reject) => sftp.write(file, block, 0, block.length, position, error => error ? reject(error) : resolve()))
      position += block.length
      await delay(10)
    }
  })().catch(error => { pumpError = error; pumping = false })
  // Run package update asynchronously so real SSH/SFTP traffic continues.
  const { execFile } = await import('node:child_process')
  await new Promise((resolve, reject) => execFile('docker', ['exec', name, 'sh', '-c', '. /opt/alpine-ssh-security.sh; alpine_ssh_security_update update'], { timeout: 90000 }, (error, stdout) => {
    if (error) { reject(error); return }
    try { assert.match(stdout, /^INCUDAL_ALPINE_SSH_PATCH_INSTALLED$/m); resolve() } catch (error) { reject(error) }
  }))
  const fixed = docker(['exec', name, 'apk', 'info', '-v']).split('\n').find(x => /^openssh-server-[0-9]/.test(x))
  assert.equal(fixed, `openssh-server-${fixedRevision}`)
  const newConnection = await connect(password); newConnection.end()
  for (const candidate of ['wrong-original-password', 'x'.repeat(300), 'x'.repeat(1024), '']) {
    await assert.rejects(connect(candidate), 'invalid credentials must be refused after patch')
  }
  await assert.rejects(connect(password, 'incudal-nonexistent-user'))
  await delay(100)
  pumping = false; await pump
  if (pumpError) throw pumpError
  assert.ok(!echoClosed && !transferClosed && blocks.length > 3, 'original SSH and SFTP sessions survive the update')
  echoStream.end()
  await new Promise(resolve => echoStream.once('close', resolve))
  assert.deepEqual(Buffer.concat(received), Buffer.concat(sent), 'continuous SSH byte stream preserved')
  await new Promise((resolve, reject) => sftp.close(file, error => error ? reject(error) : resolve()))
  const expected = createHash('sha256').update(Buffer.concat(blocks)).digest('hex')
  assert.equal(docker(['exec', name, 'sha256sum', '/root/continuous-transfer']).split(' ')[0], expected, 'active SFTP file remains byte-exact')
  const again = docker(['exec', name, 'sh', '-c', '. /opt/alpine-ssh-security.sh; alpine_ssh_security_update update'])
  assert.match(again, /^INCUDAL_ALPINE_SSH_ALREADY_FIXED$/m)
  // A killed reload after package install must recover on the next update,
  // rather than accepting the new package while serving the deleted old binary.
  const recovery = docker(['exec', '-i', name, 'sh', '-s'], `set -eu
. /opt/alpine-ssh-security.sh
apk add --no-cache /opt/old-ssh/openssh-server.apk /opt/old-ssh/openssh-server-common.apk /opt/old-ssh/openssh-keygen.apk
env sshd_disable_keygen=yes rc-service sshd reload
sleep 1
mkdir /tmp/fail-reload-bin
cat > /tmp/fail-reload-bin/rc-service <<'FAIL'
#!/bin/sh
case "$2" in reload) exit 1 ;; *) exec /sbin/rc-service "$@" ;; esac
FAIL
chmod 755 /tmp/fail-reload-bin/rc-service
original_path=$PATH
PATH=/tmp/fail-reload-bin:$PATH
if alpine_ssh_security_update update; then echo 'failed reload was incorrectly accepted'; exit 1; fi
alpine_ssh_assert_fixed
PATH=$original_path
alpine_ssh_security_update update
alpine_ssh_listener_current
`)
  assert.match(recovery, /^INCUDAL_ALPINE_SSH_ALREADY_FIXED$/m)
  const recovered = await connect(password); recovered.end()
  console.log(`PASS native Alpine ${branch} ${docker(['exec', name, 'apk', '--print-arch']).trim()}: signed ${oldRevision}→${fixedRevision} patch; original password/new login; incorrect/long/empty/unknown-user refused; live SSH/SFTP ${blocks.length * 32768} bytes preserved; idempotent check; failed reload recovered with installed patch`)
} finally {
  pumping = false
  if (pump) await pump.catch(() => {})
  connection?.destroy()
  try { docker(['rm', '-f', name]) } catch {}
}
