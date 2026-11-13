import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { prisma, closePrismaDatabase } from '../src/db/prisma.js'
import { createInstanceAsync } from '../src/routes/instances.js'
import { generateIncusConfig } from '../src/lib/incus-config-generator.js'
import { getHostById } from '../src/db/hosts.js'
import { getIncusClient, closeAllClients } from '../src/lib/incus/incus-pool.js'
import { execWithOutput } from '../src/lib/incus/incus-instances.js'
import { checkSshLogin } from '../src/lib/dedicated-ssh.js'
import { failPoolProvision } from '../src/services/pool-provisioning.js'
import { syncHostPublicIp } from '../src/services/host-public-ip-sync.js'
import { verifyPublicSshIdentity } from '../src/lib/host-public-ip.js'
import { encryptSensitiveData, decryptSensitiveData } from '../src/lib/security.js'
import { createInstanceTask } from '../src/db/instance-tasks.js'
import { executeTask } from '../src/workers/instanceTaskWorker.js'
import { transferHostIdentity } from '../src/lib/transfer-host-identity.js'
import { assertRebuildBootReady } from '../src/lib/instance-rebuild-state.js'
import { acceptGuestProtectionStatus } from '../src/lib/guest-network-protection.js'
import { acceptHostProvisioningStatus } from '../src/lib/host-provisioning-tools.js'
import { instanceSshFingerprints, dedicatedIpv6InstallScript } from '../src/lib/incus/dedicated-ipv6.js'

assert.equal(process.env.GITHUB_ACTIONS, 'true')
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
assert.equal(process.platform, 'linux')
const database = new URL(process.env.DATABASE_URL!)
assert.equal(database.hostname, '127.0.0.1')
assert.ok(database.pathname.endsWith('_pool_test'))
const cert = readFileSync('/var/lib/incus/server.crt', 'utf8')
const user = await prisma.user.create({ data: { username: `native-${randomUUID()}`, role: 'admin', balance: 100, passwordHash: 'unusable-native-fixture' } })
const batch = await prisma.hostOnboardingBatch.create({ data: { id: randomUUID(), createdById: user.id, name: 'native-pool', accountLabel: 'disposable', defaults: {} } })
const host = await prisma.host.create({ data: { userId: user.id, name: 'native-incus', url: 'https://127.0.0.1:18443',
  certPath: process.env.INCUDAL_PROVISIONING_CERT!, keyPath: process.env.INCUDAL_PROVISIONING_KEY!,
  serverCertificate: cert, serverFingerprint: new X509Certificate(cert).fingerprint256,
  singleTenant: true, status: 'online', isInstalled: true, instanceType: 'container', architecture: process.arch === 'arm64' ? 'aarch64' : 'x86_64',
  cpuAllowanceMax: 100, memoryMax: 1024, customerDiskGiB: 4,
  natPublicIp: '11.0.0.99', natBindIp: '11.0.0.99', natPortStart: 1, natPortEnd: 65535,
  portProtocol: 'tcp_udp', portProtocolRevision: 1, portProtocolApplied: 'tcp_udp', portProtocolAppliedRevision: 1,
  onboardingNode: { create: { batchId: batch.id, name: 'native-pool-node', publicIp: '11.0.0.99', managementIp: '10.253.240.2',
    sshPort: 22, sshFingerprint: 'SHA256:' + createHash('sha256').update(Buffer.from(readFileSync('/etc/ssh/ssh_host_ed25519_key.pub', 'utf8').split(/\s+/)[1], 'base64')).digest('base64').replace(/=+$/, ''),
    status: 'succeeded', step: 'done', credentialsExpireAt: new Date(0) } },
  agent: { create: { agentId: randomUUID(), secretHash: 'unused-native', secretEncrypted: 'unused-native', enabled: true } },
  storagePools: { create: { name: 'default', driver: 'dir', purpose: 'instance_data' } }
} })
let refreshTimer: ReturnType<typeof setInterval> | undefined
let refreshing = false
const updateRealReceipts = async () => {
  if (refreshing) return
  refreshing = true
  try {
    const report = JSON.parse(readFileSync(process.env.INCUDAL_POOL_GUARD_REPORT!, 'utf8'))
    const now = Date.now()
    const guest = acceptGuestProtectionStatus(report.guestProtectionStatus, now, now)
    const tools = acceptHostProvisioningStatus(report.hostProvisioningStatus, now, now)
    if (!guest?.applied || !tools?.ready) return
    await prisma.hostAgent.update({ where: { hostId: host.id }, data: { version: 'native-current', lastSeenAt: new Date(now),
      capabilities: ['guest-network-protection-v1', 'host-provisioning-tools-v1', 'ingress-port-protocol-v1', 'dedicated-ipv6-v1'],
      lastReport: { guestProtectionStatus: guest, hostProvisioningStatus: tools } } })
  } finally { refreshing = false }
}

try {
  const transport = await getIncusClient((await getHostById(host.id))!)
  for (let attempt = 0; attempt < 40; attempt++) {
    await updateRealReceipts()
    if ((await prisma.hostAgent.findUniqueOrThrow({ where: { hostId: host.id } })).lastSeenAt) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  refreshTimer = setInterval(() => { void updateRealReceipts().catch(() => undefined) }, 1000)
  const node = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { hostId: host.id } })
  let addressVerifications = 0
  const ipDependencies = {
    peers: async () => [{ nodeId: node.id, managementIp: node.managementIp!, publicIp: '11.0.0.99', endpoint: '11.0.0.99:51820',
      lastHandshakeAt: Math.floor(Date.now() / 1000), connected: true }],
    connect: async () => transport,
    fingerprints: async () => { throw new Error('IP patrol must not probe an unfinished customer SSH') },
    verify: async (...args: Parameters<typeof verifyPublicSshIdentity>) => { addressVerifications++; return verifyPublicSshIdentity(...args) }
  }
  assert.equal((await syncHostPublicIp(host.id, {}, ipDependencies)).blocked, false)
  for (const [index, image] of ['alpine/3.24/cloud', 'alpine/3.21/tinycloud', 'debian/14/cloud', 'ubuntu/24.04/cloud', 'rockylinux/9/cloud', 'almalinux/9/cloud', 'centos/9-Stream/cloud', 'debian/11/cloud'].entries()) {
    if (process.env.INCUDAL_NATIVE_IMAGE && image !== process.env.INCUDAL_NATIVE_IMAGE) continue
    const name = `native-delivery-${index}`, password = randomUUID() + '-Aa1!', ip = `10.10.1.${100 + index}`
    const generated = generateIncusConfig({ instanceName: name, imageAlias: `images:${image}`, rootPassword: password,
      type: 'container', networkMode: 'nat', network: { ipAddress: `${ip}/22`, gateway: '10.10.0.1', dns: ['10.10.0.1'] } })
    const order = await prisma.poolOrder.create({ data: { id: randomUUID(), userId: user.id, requestHash: name, totalCents: 0 } })
    const instance = await prisma.instance.create({ data: { userId: user.id, hostId: host.id, incusId: name, name,
      image: `images:${image}`, status: 'creating', networkMode: 'nat', cpu: 100, memory: 1024, disk: 4096, portLimit: 0, dedicatedIpv4: true, purchaseBatchId: order.id,
      rootPassword: encryptSensitiveData(password), expiresAt: new Date(Date.now() + 86400000) } })
    await prisma.host.update({ where: { id: host.id }, data: { cpuUsed: 100, memoryUsed: 1024, diskUsed: 4096 } })
    await prisma.instanceBillingRecord.create({ data: { userId: user.id, instanceId: instance.id, type: 'newPurchase', amount: 0,
      months: 1, periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000) } })
    const beforeVerification = addressVerifications
    // Real IP patrol after the paid pool claim but before the new guest is
    // deliverable. This reproduced the owner's #33 failure in v1.8.9.
    assert.equal((await syncHostPublicIp(host.id, {}, ipDependencies)).blocked, false)
    assert.equal(addressVerifications, beforeVerification)
    const patrolDuringCreation = (async () => {
      await new Promise(resolve => setTimeout(resolve, 5000))
      const current = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
      if (current.status === 'creating') {
        assert.equal((await syncHostPublicIp(host.id, {}, ipDependencies)).blocked, false)
      }
    })()
    const diagnostics = setInterval(() => {
      try {
        if (image === 'debian/11/cloud') {
          const bootstrap = execFileSync('incus', ['exec', name, '--', 'sh', '-c',
            'systemctl status payincus-image-bootstrap.service systemd-networkd.service systemd-networkd-wait-online.service --no-pager; journalctl -u payincus-image-bootstrap.service -b --no-pager -n 80; find /var/lib/cloud/seed -type f -printf "%p %s bytes\\n"; ls -l /var/lib/incudal /usr/local/sbin/payincus-image-bootstrap; cat /var/lib/incudal/image-bootstrap-failed; ip -4 addr show; ip -4 route show; cat /etc/resolv.conf'],
            { encoding: 'utf8', timeout: 10000, maxBuffer: 32768 })
          console.log(bootstrap.replaceAll(password, '[redacted]').replace(/(password|passwd|secret|token)[^\n]*/gi, '[redacted line]'))
        }
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
    } finally { clearInterval(diagnostics); await patrolDuringCreation }
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).status, 'running')
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).dedicatedNetworkReady, true)
    let verified = false
    const sshDeadline = Date.now() + 180000
    for (let attempt = 0; Date.now() < sshDeadline; attempt++) {
      try {
        const inspection = await execWithOutput(transport, name, ['sh', '-c',
          'test -f /var/lib/incudal/initialization-ready && for key in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$key" -E sha256; done'], {}, 10000)
        assert.equal((inspection.metadata as { return?: number }).return, 0)
        const pins = inspection.stdout.match(/SHA256:[A-Za-z0-9+/]+/g) || []
        assert.ok(pins.length)
        await checkSshLogin('11.0.0.99', password, pins)
        verified = true
        break
      } catch (error) {
        if (attempt % 5 === 0) console.log(`Native ${image} SSH verification attempt ${attempt}: ${error instanceof Error ? error.message.replaceAll(password, '[redacted]') : 'unverified'}`)
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    }
    assert.equal(verified, true, `${image}: generated initialization and real password SSH`)
    const pinnedKeys = await instanceSshFingerprints(transport, name)
    const scanned = await execWithOutput(transport, name, ['sh', '-c',
      'set -eu; directory=$(mktemp -d); trap \'rm -f "$directory/keys"; rmdir "$directory"\' EXIT; ssh-keyscan -T 4 127.0.0.1 > "$directory/keys" 2>/dev/null; ssh-keygen -lf "$directory/keys" -E sha256'], {}, 15000)
    assert.equal((scanned.metadata as { return?: number }).return, 0)
    const scannedKeys = scanned.stdout.match(/SHA256:[A-Za-z0-9+/]+/g) || []
    assert.ok(scannedKeys.length && scannedKeys.every(key => pinnedKeys.includes(key)), `${image}: every OpenSSH host key is pinned, including newly supported algorithms`)
    const probeTools = await execWithOutput(transport, name, ['sh', '-c', 'set -e; for tool in ssh ssh-keyscan ssh-keygen timeout; do command -v "$tool"; done; command -v curl || command -v python3'], {}, 5000)
    assert.equal((probeTools.metadata as { return?: number }).return, 0, `${image}: IPv4-only controller guest IPv6 probe tools are installed`)
    if (image === 'debian/14/cloud') {
      const install = () => execWithOutput(transport, name, ['sh', '-c', dedicatedIpv6InstallScript(null, [])], {}, 20000)
      const configured = await install()
      assert.equal((configured.metadata as { return?: number }).return, 0, 'initial IPv6 service installation')
      const baseline = await execWithOutput(transport, name, ['sh', '-c', 'stat -c %Y /var/lib/incudal/initialization-ready'], {}, 5000)
      // Reproduce the shipped old cycle on this disposable guest. Debian's new
      // cloud-final is ordered after multi-user.target, so its boot job is dropped.
      const legacy = await execWithOutput(transport, name, ['sh', '-c',
        'systemctl disable payincus-ipv6.service; sed -i s/WantedBy=cloud-init.target/WantedBy=multi-user.target/ /etc/systemd/system/payincus-ipv6.service; systemctl daemon-reload; systemctl enable payincus-ipv6.service'], {}, 10000)
      assert.equal((legacy.metadata as { return?: number }).return, 0)
      execFileSync('incus', ['restart', name, '--force'], { timeout: 30000 })
      let repaired = false
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          const repair = await install()
          if ((repair.metadata as { return?: number }).return === 0) { repaired = true; break }
        } catch { /* Guest management comes back after the restart. */ }
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
      assert.equal(repaired, true, 'old circular IPv6 unit automatically repairs and finishes cloud-init after reboot')
      execFileSync('incus', ['restart', name, '--force'], { timeout: 30000 })
      let booted = false
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          const state = await execWithOutput(transport, name, ['sh', '-c',
            'test -f /var/lib/cloud/instance/boot-finished && systemctl is-active --quiet payincus-ipv6.service && test ! -e /etc/systemd/system/multi-user.target.wants/payincus-ipv6.service && stat -c %Y /var/lib/incudal/initialization-ready'], {}, 6000)
          if ((state.metadata as { return?: number }).return === 0) {
            assert.equal(state.stdout, baseline.stdout, 'recovery must not rerun customer initialization')
            booted = true; break
          }
        } catch { /* Wait for the real second boot. */ }
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
      assert.equal(booted, true, 'new IPv6 service boots without a cloud-final ordering cycle')
      assert.deepEqual(await instanceSshFingerprints(transport, name), pinnedKeys, 'host keys are preserved across repair and reboot')
      await checkSshLogin('11.0.0.99', password, pinnedKeys)
      console.log('PASS real Debian reboot: old IPv6/cloud-init cycle repaired, next boot completes, original initialization/password/keys retained')
    }
    if (image === 'alpine/3.24/cloud' || image === 'debian/11/cloud') {
      // Native Incus failure (not a mocked response) followed by fresh owner
      // consent must unlock and successfully rebuild the same paid instance.
      execFileSync('incus', ['stop', name, '--force'], { timeout: 30000 })
      await prisma.instance.update({ where: { id: instance.id }, data: { status: 'stopped' } })
      const missingAlias = `native-missing-${randomUUID()}`
      const availableAlias = `images:${image}${process.arch === 'arm64' ? '/arm64' : ''}`
      const fixtureImages: Array<{ id: number }> = []
      for (const remoteAlias of [missingAlias, availableAlias]) {
        const seeded = await prisma.systemImage.findUnique({ where: { remoteAlias } })
        if (seeded) { assert.equal(seeded.architecture, host.architecture); assert.equal(seeded.hidden, false); continue }
        fixtureImages.push(await prisma.systemImage.create({ data: {
          name: remoteAlias, remoteAlias, icon: image.startsWith('debian/') ? 'debian' : 'alpine', architecture: host.architecture, instanceType: 'container'
        } }))
      }
      const requestRebuild = async (imageAlias: string) => {
        const admitted = await createInstanceTask({ instanceId: instance.id, hostId: host.id, userId: user.id, taskType: 'rebuild', imageAlias,
          sensitiveAuthorization: { actor: { id: user.id, sid: 'native-acceptance', iat: Math.floor(Date.now() / 1000) }, entry: 'host',
            expectedOwnerId: user.id, expectedIncusId: name, expectedHostIdentity: transferHostIdentity(await prisma.host.findUniqueOrThrow({ where: { id: host.id } })) } })
        const claimed = await prisma.instanceTask.update({ where: { id: admitted.id }, data: { status: 'PROCESSING', startedAt: new Date() } })
        await executeTask(claimed.id, claimed)
        return prisma.instanceTask.findUniqueOrThrow({ where: { id: claimed.id } })
      }
      try {
        const failed = await requestRebuild(missingAlias)
        assert.equal(failed.status, 'FAILED', failed.error || '')
        assert.equal((failed.replacementState as any).targetPhase, 'rebuild_failed')
        await assert.rejects(assertRebuildBootReady(prisma, instance.id), /重新选择镜像重装/)
        assert.equal(JSON.parse(execFileSync('incus', ['query', `/1.0/instances/${name}/state`], { encoding: 'utf8' })).status, 'Stopped')
        const retry = await requestRebuild(availableAlias)
        assert.equal(retry.status, 'COMPLETED', retry.error || '')
        const recovered = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
        assert.equal(recovered.status, 'running'); assert.equal(recovered.expiresAt?.getTime(), instance.expiresAt?.getTime())
        assert.equal(recovered.purchaseBatchId, instance.purchaseBatchId)
        await checkSshLogin('11.0.0.99', decryptSensitiveData(recovered.rootPassword!), await instanceSshFingerprints(transport, name))
        if (image === 'debian/11/cloud') {
          const beforeKeys = await instanceSshFingerprints(transport, name)
          const initial = await execWithOutput(transport, name, ['sh', '-c', 'set -e; . /etc/os-release; test "$VERSION_ID" = 11; test -f /var/lib/incudal/image-bootstrap-complete; test -f /var/lib/cloud/instance/boot-finished; printf original > /root/owner-image-marker; cat /proc/sys/kernel/random/boot_id'], {}, 10000)
          assert.equal((initial.metadata as any).return, 0)
          execFileSync('incus', ['stop', name, '--force'], { timeout: 30000 })
          execFileSync('incus', ['start', name], { timeout: 30000 })
          let newBoot = ''
          for (let step = 0; step < 40; step++) {
            try {
              const check = await execWithOutput(transport, name, ['sh', '-c', 'set -e; test "$(cat /root/owner-image-marker)" = original; test -f /var/lib/cloud/instance/boot-finished; cat /proc/sys/kernel/random/boot_id'], {}, 6000)
              if ((check.metadata as any).return === 0) { newBoot = check.stdout; break }
            } catch { /* Native guest startup is observed, not presumed. */ }
            await new Promise(resolve => setTimeout(resolve, 1500))
          }
          assert.ok(newBoot && newBoot !== initial.stdout)
          assert.deepEqual(await instanceSshFingerprints(transport, name), beforeKeys)
          await checkSshLogin('11.0.0.99', decryptSensitiveData(recovered.rootPassword!), await instanceSshFingerprints(transport, name))
          execFileSync('incus', ['restart', name, '--force'], { timeout: 30000 })
          let restarted = false
          for (let step = 0; step < 40; step++) {
            try {
              const check = await execWithOutput(transport, name, ['sh', '-c', 'set -e; test "$(cat /root/owner-image-marker)" = original; test -f /var/lib/cloud/instance/boot-finished; cat /proc/sys/kernel/random/boot_id'], {}, 6000)
              if ((check.metadata as any).return === 0 && check.stdout !== newBoot) { restarted = true; break }
            } catch { /* Observe restart completion. */ }
            await new Promise(resolve => setTimeout(resolve, 1500))
          }
          assert.equal(restarted, true)
          assert.deepEqual(await instanceSshFingerprints(transport, name), beforeKeys)
          await checkSshLogin('11.0.0.99', decryptSensitiveData(recovered.rootPassword!), await instanceSshFingerprints(transport, name))
          console.log('PASS owner Debian 11 native purchase/create, rebuild, stop/start and restart with retained disk/password and real SSH')
        }
        console.log('PASS native rebuild: genuine missing image failure is terminal, stopped retained, fresh consent rebuild succeeds with real password SSH and unchanged paid term')
      } finally { await prisma.systemImage.deleteMany({ where: { id: { in: fixtureImages.map(row => row.id) } } }) }
    }
    await prisma.instance.update({ where: { id: instance.id }, data: { status: 'error' } })
    await failPoolProvision(instance.id, (await getHostById(host.id))!, 'native completed pool lifecycle cleanup')
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).status, 'deleted')
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).diskUsed, 0)
    console.log(`PASS native ${process.arch} ${image}: current create entry, original password SSH, complete cleanup`)
  }
} finally {
  clearInterval(refreshTimer)
  while (refreshing) await new Promise(resolve => setTimeout(resolve, 10))
  await closeAllClients()
  await prisma.instance.deleteMany({ where: { hostId: host.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.hostOnboardingBatch.delete({ where: { id: batch.id } })
  await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
// Route imports own process-level interval caches; the disposable smoke has
// awaited all DB/transport cleanup and must not wait for those application timers.
console.log('PASS native provisioning and database/transport cleanup completed')
process.exit(0)
