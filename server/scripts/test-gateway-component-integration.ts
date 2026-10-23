import assert from 'node:assert/strict'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, X509Certificate } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { createServer } from 'node:net'
import { isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { controllerSigningKeyId, signControllerPrepareConfig } from '../src/lib/controller-config.js'
import { signGatewayTransport } from '../src/lib/gateway-transport.js'
import { gatewayTaskHash } from '../src/lib/gateway-task-plan.js'

// Opt-in actual packaged processes. No system service or business DB is started.
// OSS failure is exercised inside a fresh network namespace with no interfaces.
const packageRoot = process.env.GATEWAY_COMPONENT_PACKAGE
assert.ok(process.platform === 'linux' && process.getuid?.() === 0 && packageRoot && isAbsolute(packageRoot), 'requires an explicitly selected Linux package and root test isolation')
const runtime = join(packageRoot, 'bin/node'), entry = (name: string) => join(packageRoot, 'lib', name + '.cjs')
const directory = await mkdtemp('/root/incudal-component-runtime-'), exec = promisify(execFile)
const processes = new Set<ChildProcess>()
const environment = { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8', HOME: directory }
const write = async (name: string, value: string | Buffer) => {
  const path = join(directory, name); await writeFile(path, value, { mode: 0o600 }); return path
}
const invoke = async (program: string, args: string[], timeout = 15000, input?: string) => {
  try {
    const operation = exec(program, args, { cwd: directory, env: environment, timeout, maxBuffer: 65536 })
    operation.child.stdin?.end(input)
    return { code: 0, ...(await operation) }
  }
  catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string; killed?: boolean }
    assert.equal(result.killed, false, 'packaged command exceeded its deadline')
    return { code: result.code, stdout: result.stdout || '', stderr: result.stderr || '' }
  }
}
const freePort = async () => {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address === 'object')
  await new Promise<void>(resolve => server.close(() => resolve())); return address.port
}
const start = async (name: string, args: string[]) => {
  const child = spawn(runtime, [entry(name), ...args], { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  processes.add(child)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(name + ' startup timeout')), 10000)
    let text = ''
    child.stdout!.on('data', chunk => { text += chunk; if (text.includes('is listening')) { clearTimeout(timer); resolve() } })
    child.stderr!.resume()
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(Error(name + ' startup failed: ' + code)) })
  })
  return child
}
const stop = async (child: ChildProcess) => {
  const done = new Promise<number | null>(resolve => child.once('exit', resolve))
  child.kill('SIGTERM'); assert.equal(await done, 0); processes.delete(child)
}
let checks = 0
try {
  assert.equal((await invoke(runtime, ['--version'])).code, 0); checks++
  for (const name of ['incudal-channels', 'incudal-gateway', 'incudal-maintenance']) {
    const rejected = await invoke(join(packageRoot, 'bin', name), [])
    assert.equal(rejected.code, 1); assert.ok(!/Exec format|not found/i.test(rejected.stderr)); checks++
  }
  const root = generateKeyPairSync('ed25519'), node = generateKeyPairSync('ed25519'), witness = generateKeyPairSync('ed25519'), holder = generateKeyPairSync('ed25519')
  const pub = (key: typeof root.privateKey) => createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
  const trustedKeys = { [controllerSigningKeyId(pub(root.privateKey))]: pub(root.privateKey) }
  const platformId = randomUUID(), nodeId = randomUUID(), controllerId = randomUUID(), gatewayId = randomUUID()
  await exec('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'ca.key'), '-out', join(directory, 'ca.crt'), '-days', '1', '-subj', '/CN=package-test-ca'])
  for (const name of ['tls', 'client']) {
    await exec('/usr/bin/openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, name + '.key'), '-out', join(directory, name + '.csr'), '-subj', '/CN=localhost'])
    await write(name + '.ext', 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=' + (name === 'tls' ? 'serverAuth' : 'clientAuth'))
    await exec('/usr/bin/openssl', ['x509', '-req', '-in', join(directory, name + '.csr'), '-CA', join(directory, 'ca.crt'), '-CAkey', join(directory, 'ca.key'), '-CAcreateserial', '-out', join(directory, name + '.crt'), '-days', '1', '-extfile', join(directory, name + '.ext')])
  }
  for (const name of ['ca.crt', 'tls.crt', 'tls.key', 'client.crt', 'client.key']) await chmod(join(directory, name), 0o600)
  const ca = await readFile(join(directory, 'ca.crt')), clientCert = await readFile(join(directory, 'client.crt')), clientKey = await readFile(join(directory, 'client.key'))
  const send = (port: number, path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}, mtls = false) => new Promise<{ status: number; body: string; cookies: string[] }>((resolve, reject) => {
    const r = request({ hostname: '127.0.0.1', port, path, method, ca, servername: 'localhost', agent: false,
      ...(mtls ? { key: clientKey, cert: clientCert } : {}), headers: { Host: 'localhost:' + port, 'Content-Type': 'application/json', ...headers } }, response => {
      let text = ''; response.on('data', data => { text += data }); response.on('end', () => resolve({ status: response.statusCode!, body: text, cookies: response.headers['set-cookie'] || [] }))
    }); r.setTimeout(5000, () => r.destroy(Error('request timeout'))); r.once('error', reject); r.end(body === undefined ? undefined : JSON.stringify(body))
  })
  const now = Date.now()
  const candidate = signControllerPrepareConfig({ schemaVersion: 1, purpose: 'controller-prepare', platformId, nodeId, controllerId,
    requestId: randomUUID(), epoch: '2', sequence: '1', issuedAt: now, expiresAt: now + 600000, panelBaseUrl: 'https://panel.example.test',
    gateway: { gatewayId, endpointHost: 'gateway.example.test', endpointPort: 51820, publicKey: randomBytes(32).toString('base64'), nodeAddress: '10.250.11.2', controlAddress: '10.250.11.1' } }, root.privateKey)

  const consolePort = await freePort(), origin = 'https://localhost:' + consolePort
  await mkdir(join(directory, 'auth'), { mode: 0o700 })
  const initialUser = { username: 'package-test', password: randomBytes(24).toString('base64url'), role: 'operator', totpSeed: randomBytes(20).toString('base64'), recoveryCodes: Array.from({ length: 4 }, () => randomBytes(24).toString('base64url')) }
  const consoleConfig = { schemaVersion: 1, origin, listenHost: '0.0.0.0', listenPort: consolePort,
    authDirectory: join(directory, 'auth'), assetDirectory: join(packageRoot, 'ui'), tlsKey: join(directory, 'tls.key'), tlsCertificate: join(directory, 'tls.crt'),
    transport: { platformId, gatewayId, statePath: join(directory, 'missing-transport.json'), trustedKeys, componentVersion: 'package-test' }, initialUser }
  const consolePath = await write('console.json', JSON.stringify(consoleConfig))
  assert.equal((await invoke(runtime, [entry('gateway-console'), '--initialize', consolePath])).code, 0)
  assert.equal((await invoke(runtime, [entry('gateway-console'), '--initialize', consolePath])).code, 1); checks++
  await write('console.json', JSON.stringify({ ...consoleConfig, initialUser: null }))
  const consoleChild = await start('gateway-console', ['--serve', consolePath])
  assert.equal((await send(consolePort, '/')).status, 200)
  assert.equal((await send(consolePort, '/api/status')).status, 401)
  const login = await send(consolePort, '/api/login', 'POST', { username: initialUser.username, password: initialUser.password, recoveryCode: initialUser.recoveryCodes[0] }, { Origin: origin })
  assert.equal(login.status, 200); checks++
  const cookie = login.cookies[0].split(';')[0], csrf = JSON.parse(login.body).csrf
  assert.equal((await send(consolePort, '/api/status', 'GET', undefined, { Cookie: cookie })).status, 503); checks++
  assert.equal((await send(consolePort, '/api/logout', 'POST', {}, { Origin: origin, Cookie: cookie, 'x-gateway-csrf': csrf })).status, 200)
  assert.equal((await send(consolePort, '/api/session', 'GET', undefined, { Cookie: cookie })).status, 401)
  assert.equal((await send(consolePort, '/api/login', 'POST', { username: initialUser.username, password: initialUser.password, recoveryCode: initialUser.recoveryCodes[0] }, { Origin: origin })).status, 401); checks++
  await stop(consoleChild)

  for (const name of ['discovery', 'discovery/nodes', 'discovery/nonces', 'discovery/nonces/' + nodeId]) await mkdir(join(directory, name), { mode: 0o700 })
  const discoveryPort = await freePort(), authority = 'localhost:' + discoveryPort
  const discoveryPath = await write('discovery.json', JSON.stringify({ schemaVersion: 1, authority, listenHost: '127.0.0.1', listenPort: discoveryPort, stateDirectory: join(directory, 'discovery'), trustedConfigKeys: trustedKeys }))
  await write('discovery/nodes/' + nodeId + '.json', JSON.stringify({ platformId, nodeId, enabled: true, publicKey: pub(node.privateKey), candidate }))
  let discoveryChild = await start('controller-discovery', [discoveryPath])
  const timestamp = String(Date.now()), nonce = randomBytes(24).toString('base64url')
  const signature = sign(null, Buffer.from('payincus/controller-config-read/v1\n' + ['GET', authority, '/v1/controller-config', platformId, nodeId, timestamp, nonce].join('\n')), node.privateKey).toString('base64')
  const proof = { 'x-payincus-platform-id': platformId, 'x-payincus-node-id': nodeId, 'x-payincus-timestamp': timestamp, 'x-payincus-nonce': nonce, 'x-payincus-signature': signature }
  const fetched = await send(discoveryPort, '/v1/controller-config', 'GET', undefined, proof)
  assert.equal(fetched.status, 200); assert.equal(fetched.body, candidate); checks++
  await stop(discoveryChild); discoveryChild = await start('controller-discovery', [discoveryPath])
  assert.equal((await send(discoveryPort, '/v1/controller-config', 'GET', undefined, proof)).status, 401); checks++
  await stop(discoveryChild)

  const witnessPort = await freePort()
  const signingKey = await write('witness.key', witness.privateKey.export({ type: 'pkcs8', format: 'pem' }))
  const fingerprint = createHash('sha256').update(new X509Certificate(clientCert).raw).digest('hex')
  const witnessConfig = { schemaVersion: 1, authority: 'localhost:' + witnessPort, listenHost: '127.0.0.1', listenPort: witnessPort,
    stateDirectory: join(directory, 'witness'), enrollment: { platformId, witnessId: randomUUID(), candidateKeys: trustedKeys, nodes: { [nodeId]: pub(node.privateKey) } }, signingKey,
    tlsKey: join(directory, 'tls.key'), tlsCertificate: join(directory, 'tls.crt'), clientCA: join(directory, 'ca.crt'),
    clients: { [fingerprint]: { controllerId, holderKeyId: controllerSigningKeyId(pub(holder.privateKey)), nodeIds: [nodeId] } }, initialCandidates: { [nodeId]: candidate } }
  const witnessPath = await write('witness.json', JSON.stringify(witnessConfig))
  assert.equal((await invoke(runtime, [entry('controller-witness'), '--serve', witnessPath])).code, 1)
  assert.equal((await invoke(runtime, [entry('controller-witness'), '--initialize', witnessPath])).code, 0)
  let witnessChild = await start('controller-witness', ['--serve', witnessPath])
  assert.equal((await send(witnessPort, '/v1/witness/status', 'POST', { nodeId }, {}, true)).status, 200)
  await assert.rejects(send(witnessPort, '/v1/witness/status', 'POST', { nodeId })); checks++
  const duplicate = await write('duplicate-witness.json', JSON.stringify({ ...witnessConfig, listenPort: await freePort() }))
  assert.equal((await invoke(runtime, [entry('controller-witness'), '--serve', duplicate])).code, 1); checks++
  await stop(witnessChild); witnessChild = await start('controller-witness', ['--serve', witnessPath])
  const persisted = await send(witnessPort, '/v1/witness/status', 'POST', { nodeId }, {}, true)
  assert.equal(persisted.status, 200); assert.equal(JSON.parse(persisted.body).epoch, '2'); checks++
  await stop(witnessChild)

  // Run the actual planner from inside the signed package. Python imports must
  // not create bytecode that would invalidate that same package's fixed list.
  const machineId = (await readFile('/etc/machine-id', 'utf8')).trim()
  const listenPort = await freePort(); let consolePlanPort = await freePort()
  while (consolePlanPort === listenPort) consolePlanPort = await freePort()
  const preflight = { schemaVersion: 1, platformId, gatewayId, slot: 'a', expectedMachineId: machineId,
    network: '10.247.233.0/24', address: '10.247.233.1', listenPort, consolePort: consolePlanPort }
  const probed = await invoke('/usr/bin/python3', [join(packageRoot, 'scripts/probe-management-gateway.py')], 30000, JSON.stringify(preflight))
  assert.equal(probed.code, 0)
  const inspection = JSON.parse(probed.stdout)
  const manifestRaw = await readFile(join(packageRoot, 'manifest.json'))
  const manifest = JSON.parse(Buffer.from(JSON.parse(manifestRaw.toString()).payload, 'base64').toString())
  const configuration = { slot: 'a', network: preflight.network, address: preflight.address, listenPort, consolePort: consolePlanPort,
    consoleOrigin: 'https://gateway.example.test:' + consolePlanPort,
    signedTransport: signGatewayTransport({ schemaVersion: 1, purpose: 'gateway-transport', platformId, gatewayId, epoch: '1', sequence: '1',
      issuedAt: now, expiresAt: now + 600000, slot: 'a', address: preflight.address, listenPort, mtu: 1380, peers: [] }, root.privateKey) }
  const planTask = { schemaVersion: 1, taskId: randomUUID(), platformId, gatewayId, kind: 'install', basedOnRevision: '0',
    target: { mode: 'local', machineId, ssh: null }, configurationHash: gatewayTaskHash(configuration),
    componentHash: createHash('sha256').update(manifestRaw).digest('hex'), observedStateHash: inspection.observedStateHash }
  const pin = (await readFile(process.env.GATEWAY_COMPONENT_SIGNING_KEY || join(packageRoot, '../pinned.pub'), 'utf8')).trim()
  const policyPath = await write('install-policy.json', JSON.stringify({ schemaVersion: 1, platformId, platformSigningKey: pub(root.privateKey),
    packageSigningKey: pin, packageDirectory: packageRoot, componentVersion: manifest.version, componentCommit: manifest.sourceCommit }))
  const planPath = await write('install-request.json', JSON.stringify({ task: planTask, configuration, expiresAt: now + 300000 }))
  const planned = await invoke('/usr/bin/python3', [join(packageRoot, 'scripts/gateway-install-plan.py'), policyPath, planPath], 30000)
  assert.equal(planned.code, 0)
  assert.equal(JSON.parse(planned.stdout).planHash, gatewayTaskHash(planTask))
  assert.equal(JSON.parse(planned.stdout).canWrite, false)
  await assert.rejects(lstat(join(packageRoot, 'scripts/__pycache__')), { code: 'ENOENT' }); checks++

  await mkdir(join(directory, 'backup'), { mode: 0o700 })
  const transport = signGatewayTransport({ schemaVersion: 1, purpose: 'gateway-transport', platformId, gatewayId, epoch: '2', sequence: '1',
    issuedAt: now, expiresAt: now + 600000, slot: 'a', address: '10.250.11.1', listenPort: 51820, mtu: 1380, peers: [] }, root.privateKey)
  const sources = { 'gateway-identity.json': await write('identity.json', JSON.stringify({ platformId, gatewayId })),
    'gateway-transport.json': await write('transport.json', transport), 'wireguard.key': await write('wireguard.key', randomBytes(32).toString('base64')) }
  const backupPath = await write('backup.json', JSON.stringify({ schemaVersion: 1, platformId, gatewayId, stateDirectory: join(directory, 'backup'), componentVersion: 'package-test',
    intervalSeconds: 60, passwordPath: await write('backup-password', randomBytes(32).toString('base64url')), sources, trustedKeys, retention: 3, protectedIds: [],
    oss: { region: 'oss-cn-hangzhou', bucket: 'package-test-fixture', accessKeyId: 'PackageFixtureId', accessKeySecret: 'PackageFixtureSecret', prefix: 'package-test/' } }))
  assert.equal((await invoke('/usr/bin/unshare', ['--net', runtime, entry('gateway-backup'), '--once', backupPath], 30000)).code, 1)
  const failed = JSON.parse(await readFile(join(directory, 'backup/backup-status.json'), 'utf8'))
  assert.equal(failed.phase, 'failed'); assert.equal(failed.lastCompletedAt, null); checks++
  process.stdout.write(JSON.stringify({ passed: true, checks, architecture: process.arch, packagedRuntime: true, standaloneConsoleLogin: true,
    discoveryRestartReplayRejected: true, witnessMtlsAndRestart: true, missingTransportNotReady: true, isolatedOssFailureNotComplete: true, customerResourcesChanged: false }) + '\n')
} finally {
  for (const child of processes) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await done
  }
  assert.ok(resolve(directory).startsWith('/root/incudal-component-runtime-'))
  await rm(directory, { recursive: true, force: true })
}
