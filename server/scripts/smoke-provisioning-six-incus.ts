import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { prisma, closePrismaDatabase } from '../src/db/prisma.js'
import { createInstanceAsync } from '../src/routes/instances.js'
import { generateIncusConfig } from '../src/lib/incus-config-generator.js'
import { getHostById } from '../src/db/hosts.js'
import { getIncusClient, closeAllClients } from '../src/lib/incus/incus-pool.js'
import { execWithOutput } from '../src/lib/incus/incus-instances.js'
import { checkSshLogin } from '../src/lib/dedicated-ssh.js'
import { failManagedProvision } from '../src/lib/managed-provisioning-lifecycle.js'

assert.equal(process.env.GITHUB_ACTIONS, 'true')
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
assert.equal(process.platform, 'linux')
const database = new URL(process.env.DATABASE_URL!)
assert.equal(database.hostname, '127.0.0.1')
assert.ok(database.pathname.endsWith('_pool_test'))
const cert = readFileSync('/var/lib/incus/server.crt', 'utf8')
const user = await prisma.user.create({ data: { username: `native-${randomUUID()}`, passwordHash: 'unusable-native-fixture' } })
const host = await prisma.host.create({ data: { userId: user.id, name: 'native-incus', url: 'https://127.0.0.1:18443',
  certPath: process.env.INCUDAL_PROVISIONING_CERT!, keyPath: process.env.INCUDAL_PROVISIONING_KEY!,
  serverCertificate: cert, serverFingerprint: new X509Certificate(cert).fingerprint256 } })
try {
  const transport = await getIncusClient((await getHostById(host.id))!)
  for (const [index, image] of ['alpine/3.24/cloud', 'debian/14/cloud', 'ubuntu/24.04/cloud', 'rockylinux/9/cloud', 'almalinux/9/cloud', 'centos/9-Stream/cloud'].entries()) {
    if (process.env.INCUDAL_NATIVE_IMAGE && image !== process.env.INCUDAL_NATIVE_IMAGE) continue
    const name = `native-delivery-${index}`, password = randomUUID() + '-Aa1!', ip = `10.198.0.${100 + index}`
    const generated = generateIncusConfig({ instanceName: name, imageAlias: `images:${image}`, rootPassword: password,
      type: 'container', networkMode: 'nat', network: { ipAddress: `${ip}/24`, gateway: '10.198.0.1', dns: ['10.198.0.1'] } })
    const instance = await prisma.instance.create({ data: { userId: user.id, hostId: host.id, incusId: name, name,
      image: `images:${image}`, status: 'creating', networkMode: 'nat', cpu: 100, memory: 1024, disk: 4096, portLimit: 0 } })
    await prisma.host.update({ where: { id: host.id }, data: { cpuUsed: 100, memoryUsed: 1024, diskUsed: 4096 } })
    const diagnostics = setInterval(() => {
      try {
        const output = execFileSync('incus', ['exec', name, '--', 'sh', '-c',
          'cloud-init status --long; cloud-init schema --system; cat /var/lib/cloud/instance/scripts/runcmd; grep -E \"runcmd|scripts-user|ERROR|failed|WARN\" /var/log/cloud-init.log | tail -n 20; grep -E \"INCUDAL_INIT|INCUDAL_SETUP|error|Error|not found|Missing|failed|apt|Get:|Hit:|sshd|Permission\" /var/log/cloud-init-output.log | tail -n 45; tail -n 15 /var/log/cloud-init-output.log; ls -l /etc/ssl/cert.pem /etc/ssl/certs/ca-certificates.crt /var/lib/incudal /usr/local/bin/incudal-required-init.sh /usr/local/bin/incus-setup.sh; cat /var/lib/incudal/ssh-setup-failed /var/lib/incudal/initialization-failed; head -n 25 /var/lib/incudal/sshd-effective-config; /usr/sbin/sshd -t; /usr/sbin/sshd -T -C user=root,host=localhost,addr=127.0.0.1 | grep -E \"^(passwordauthentication|permitrootlogin) \"; date -u; ps | head -n 16; cat /etc/resolv.conf; cat /sys/class/net/eth0/mtu; python3 -c \"import ssl,urllib.request; print(ssl.get_default_verify_paths()); print(urllib.request.urlopen(\\\"https://dl-cdn.alpinelinux.org/alpine/v3.24/main/\\\", timeout=3).status)\"'],
          { encoding: 'utf8', timeout: 5000, maxBuffer: 32768 })
        console.log(output.replaceAll(password, '[redacted]').replace(/(password|passwd|secret|token)[^\n]*/gi, '[redacted line]'))
      } catch { console.log('Native init diagnostic is not yet available') }
    }, 30000)
    try {
    await createInstanceAsync(instance.id, (await getHostById(host.id))!, { name, image: `images:${image}`, cpu: 100, memory: 1024,
      disk: 4096, cloudInitConfig: generated.configPayload, networkMode: 'nat', ipv4Address: ip, autoRemotePort: false }, user.id,
    { cpu: 100, memory: 1024, disk: 4096 })
    } catch (error) {
      try {
        const output = execFileSync('incus', ['exec', name, '--', 'sh', '-c',
          'cloud-init status --long; cat /var/lib/cloud/data/result.json; tail -n 70 /var/log/cloud-init-output.log; ls -l /var/lib/incudal /usr/local/bin/incudal-required-init.sh'],
          { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 })
        console.log(output.replaceAll(password, '[redacted]').replace(/(password|passwd|secret|token)[^\n]*/gi, '[redacted line]'))
      } catch { console.log('Native initialization diagnostics unavailable after cleanup') }
      throw error
    } finally { clearInterval(diagnostics) }
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).status, 'running')
    let verified = false
    const sshDeadline = Date.now() + 180000
    for (let attempt = 0; Date.now() < sshDeadline; attempt++) {
      try {
        const inspection = await execWithOutput(transport, name, ['sh', '-c',
          'test -f /var/lib/incudal/initialization-ready && for key in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$key" -E sha256; done'], {}, 10000)
        assert.equal((inspection.metadata as { return?: number }).return, 0)
        const pins = inspection.stdout.match(/SHA256:[A-Za-z0-9+/]+/g) || []
        assert.ok(pins.length)
        await checkSshLogin(ip, password, pins)
        verified = true
        break
      } catch (error) {
        if (attempt % 5 === 0) console.log(`Native ${image} SSH verification attempt ${attempt}: ${error instanceof Error ? error.message.replaceAll(password, '[redacted]') : 'unverified'}`)
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    }
    assert.equal(verified, true, `${image}: generated initialization and real password SSH`)
    await prisma.instance.update({ where: { id: instance.id }, data: { status: 'error' } })
    await failManagedProvision(instance.id, (await getHostById(host.id))!)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).status, 'deleted')
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).diskUsed, 0)
    console.log(`PASS native ${process.arch} ${image}: current create entry, original password SSH, complete cleanup`)
  }
} finally {
  await closeAllClients()
  await prisma.instance.deleteMany({ where: { hostId: host.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
// Route imports own process-level interval caches; the disposable smoke has
// awaited all DB/transport cleanup and must not wait for those application timers.
console.log('PASS native provisioning and database/transport cleanup completed')
process.exit(0)
