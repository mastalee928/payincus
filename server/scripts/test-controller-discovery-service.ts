import assert from 'node:assert/strict'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createTcpServer } from 'node:net'
import { promisify } from 'node:util'
import { controllerSigningKeyId, signControllerPrepareConfig, type ControllerPrepareConfig } from '../src/lib/controller-config.js'
import { acquireDiscoveryProcessLock, createControllerDiscoveryServer, createFileDiscoveryRepository, readDiscoveryPrivateFile } from '../src/services/controller-discovery.js'
import { createControllerCandidateStore } from '../src/services/controller-candidate-store.js'
import { signManagementChannels } from '../src/lib/controller-channels.js'

const exec = promisify(execFile)
const directory = await mkdtemp(join(tmpdir(), 'payincus-discovery-'))
const authority = 'discovery.example.test:8443'
const platformId = '11111111-1111-4111-8111-111111111111', nodeId = '22222222-2222-4222-8222-222222222222'
const unknownNode = '66666666-6666-4666-8666-666666666666'
const rootKeys = generateKeyPairSync('ed25519'), nodeKeys = generateKeyPairSync('ed25519')
const rawPublic = (key: typeof rootKeys.privateKey) => createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(12).toString('base64')
const publicRoot = rawPublic(rootKeys.privateKey), nodePublicKey = rawPublic(nodeKeys.privateKey)
const state = join(directory, 'state'), nodePath = join(state, 'nodes', nodeId + '.json'), nonceDirectory = join(state, 'nonces', nodeId)
const now = Date.now()
const config: ControllerPrepareConfig = { schemaVersion: 1, purpose: 'controller-prepare', platformId, nodeId,
  controllerId: '33333333-3333-4333-8333-333333333333', requestId: '44444444-4444-4444-8444-444444444444',
  epoch: '2', sequence: '1', issuedAt: now, expiresAt: now + 900000, panelBaseUrl: 'https://panel.example.com',
  gateway: { gatewayId: '55555555-5555-4555-8555-555555555555', endpointHost: 'gateway.example.com', endpointPort: 51820,
    publicKey: Buffer.alloc(32, 7).toString('base64'), nodeAddress: '10.253.240.2', controlAddress: '10.253.240.1' } }
const candidate = signControllerPrepareConfig(config, rootKeys.privateKey)
const record = { platformId, nodeId, enabled: true, publicKey: nodePublicKey, candidate }
const saveRecord = async (value: unknown) => { await writeFile(nodePath, JSON.stringify(value), { mode: 0o600 }); await chmod(nodePath, 0o600) }
const proofHeaders = (node = nodeId, proofAuthority = authority, path = '/v1/controller-config') => {
  const nonce = randomBytes(24).toString('base64url'), timestamp = String(Date.now())
  const message = 'payincus/controller-config-read/v1\n' + ['GET', proofAuthority, path, platformId, node, timestamp, nonce].join('\n')
  return { 'x-payincus-platform-id': platformId, 'x-payincus-node-id': node, 'x-payincus-timestamp': timestamp,
    'x-payincus-nonce': nonce, 'x-payincus-signature': sign(null, Buffer.from(message), nodeKeys.privateKey).toString('base64') }
}
let server: ReturnType<typeof createControllerDiscoveryServer> | undefined
let count = 0
try {
  for (const path of [directory, state, join(state, 'nodes'), join(state, 'nonces'), nonceDirectory]) {
    await mkdir(path, { recursive: true, mode: 0o700 }); await chmod(path, 0o700)
  }
  const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl'
  await exec(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'tls.key'),
    '-out', join(directory, 'tls.crt'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'])
  const key = await readFile(join(directory, 'tls.key')), cert = await readFile(join(directory, 'tls.crt'))
  await saveRecord(record)
  const repository = await createFileDiscoveryRepository(state)
  const options = { authority, trustedConfigKeys: { [controllerSigningKeyId(publicRoot)]: publicRoot }, repository }
  assert.throws(() => createControllerDiscoveryServer({ key, cert }, { ...options, trustedConfigKeys: { wrong: publicRoot } }))
  assert.throws(() => createControllerDiscoveryServer({ key, cert }, { ...options, trustedConfigKeys: {} }))
  count += 2
  const start = async () => {
    server = createControllerDiscoveryServer({ key, cert }, options)
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve) })
  }
  const stop = async () => {
    const old = server; server = undefined
    if (old) await new Promise<void>((resolve, reject) => { old.close(error => error ? reject(error) : resolve()); old.closeAllConnections() })
  }
  const send = async (headers: Record<string, string | string[]> = {}, path = '/v1/controller-config', method = 'GET', host = authority, port?: number) => {
    const address = port ? { port } : server!.address()
    assert.ok(address && typeof address !== 'string')
    return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
      const request = httpsRequest({ hostname: '127.0.0.1', port: address.port, path, method, ca: cert,
        headers: { Host: host, ...headers }, servername: 'localhost', agent: false }, response => {
        let body = ''; response.on('data', chunk => { body += chunk }); response.on('end', () => resolve({ status: response.statusCode!, body, headers: response.headers }))
      })
      request.setTimeout(3000, () => request.destroy(new Error('test request timed out')))
      request.once('error', reject); request.end()
    })
  }
  await start()
  const headers = proofHeaders(), first = await send(headers)
  assert.equal(first.status, 200); assert.equal(first.body, candidate); assert.equal(first.headers['cache-control'], 'no-store'); count++
  const store = await createControllerCandidateStore(state, options.trustedConfigKeys)
  const channels = signManagementChannels({schemaVersion:1,purpose:'host-management-channels',platformId,nodeId,epoch:'2',sequence:'1',issuedAt:now,expiresAt:now+900000,
    channels:[{slot:'a',...config.gateway,mtu:1380}]},rootKeys.privateKey)
  assert.equal((await send(proofHeaders(nodeId,authority,'/v1/management-channels'),'/v1/management-channels')).status,503);count++
  await store.publishChannels(nodeId,channels)
  assert.equal((await send(proofHeaders(nodeId,authority,'/v1/management-channels'),'/v1/management-channels')).body,channels);count++
  assert.equal((await send(proofHeaders(),'/v1/management-channels')).status,401);count++
  assert.equal((await store.publishChannels(nodeId,channels)).duplicate,true);count++
  await assert.rejects(store.publishChannels(nodeId,signManagementChannels({schemaVersion:1,purpose:'host-management-channels',platformId,nodeId,epoch:'1',sequence:'1',issuedAt:now,expiresAt:now+900000,
    channels:[{slot:'a',...config.gateway,mtu:1380}]},rootKeys.privateKey)));count++
  const published = signControllerPrepareConfig({ ...config, sequence: '2' }, rootKeys.privateKey)
  await store.publish(nodeId, published)
  assert.equal((await send(proofHeaders())).body, published); count++
  await store.revoke(nodeId)
  assert.equal((await send(proofHeaders())).status, 401); count++
  // Restore only this isolated fixture for the remaining corruption tests.
  await saveRecord(record)
  assert.equal((await send(headers)).status, 401); count++
  await stop(); await start()
  assert.equal((await send(headers)).status, 401, 'server restart must retain nonce reservations'); count++
  assert.equal((await send()).status, 401); count++
  assert.equal((await send(proofHeaders(unknownNode))).status, 401); count++
  assert.equal((await send(proofHeaders(nodeId, 'wrong.example.test'))).status, 401); count++
  assert.equal((await send(proofHeaders(), '/v1/controller-config', 'POST')).status, 404); count++
  assert.equal((await send(proofHeaders(), '/v1/controller-config?x=1')).status, 404); count++
  assert.equal((await send(proofHeaders(), '/v1/controller-config', 'GET', 'wrong.example.test')).status, 400); count++
  assert.equal((await send({ ...proofHeaders(), 'content-length': '1' })).status, 400); count++
  const duplicates = proofHeaders()
  assert.equal((await send({ ...duplicates, 'x-payincus-node-id': [nodeId, nodeId] })).status, 401); count++
  await saveRecord({ ...record, enabled: false })
  assert.equal((await send(proofHeaders())).status, 401); count++
  await saveRecord({ ...record, candidate: candidate.replace('controller', 'invalid') + '\n' })
  assert.equal((await send(proofHeaders())).status, 503); count++
  await saveRecord({ ...record, candidate: signControllerPrepareConfig({ ...config, issuedAt: now - 10000, expiresAt: now - 1 }, rootKeys.privateKey) })
  assert.equal((await send(proofHeaders())).status, 503); count++
  await saveRecord({ ...record, candidate: signControllerPrepareConfig({ ...config, nodeId: unknownNode }, rootKeys.privateKey) })
  assert.equal((await send(proofHeaders())).status, 401); count++
  await saveRecord({ ...record, publicKey: 'bad' })
  assert.equal((await send(proofHeaders())).status, 503); count++
  await writeFile(nodePath, '{broken', { mode: 0o600 })
  assert.equal((await send(proofHeaders())).status, 503); count++
  await saveRecord(record)
  const nonce = randomBytes(24).toString('base64url'), claim = { platformId, nodeId, nonce, expiresAt: Date.now() + 30000 }
  const claimed = await Promise.all(Array.from({ length: 8 }, () => repository.claimNonce(claim)))
  assert.equal(claimed.filter(Boolean).length, 1); count++
  const reloaded = await createFileDiscoveryRepository(state)
  assert.equal(await reloaded.claimNonce(claim), false); count++
  const expiredFile = join(nonceDirectory, 'f'.repeat(64) + '.json')
  await writeFile(expiredFile, JSON.stringify({ expiresAt: Date.now() - 60000 }), { mode: 0o600 })
  assert.equal(await reloaded.claimNonce({ ...claim, nonce: randomBytes(24).toString('base64url') }), true)
  assert.ok(!(await readdir(nonceDirectory)).includes('f'.repeat(64) + '.json')); count++
  const nonceFiles = await readdir(nonceDirectory)
  await writeFile(join(nonceDirectory, nonceFiles[0]), '{broken', { mode: 0o600 })
  assert.equal((await send(proofHeaders())).status, 503); count++
  await rm(nonceDirectory, { recursive: true }); await mkdir(nonceDirectory, { mode: 0o700 })
  // State changed while authenticated nonce storage was in flight.
  await stop()
  const revokingRepository = { node: repository.node, claimNonce: async (value: Parameters<typeof repository.claimNonce>[0]) => {
    await saveRecord({ ...record, enabled: false }); return repository.claimNonce(value)
  } }
  server = createControllerDiscoveryServer({ key, cert }, { ...options, repository: revokingRepository })
  await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve) })
  assert.equal((await send(proofHeaders())).status, 401, 'revoked node must not receive a previously loaded candidate'); count++
  await saveRecord(record)
  await stop(); await start()
  for (let i = 0; i < 256; i++) await writeFile(join(nonceDirectory, i.toString(16).padStart(64, '0') + '.json'), JSON.stringify({ expiresAt: Date.now() + 30000 }), { mode: 0o600 })
  assert.equal((await send(proofHeaders())).status, 503); count++
  await rm(nonceDirectory, { recursive: true }); await mkdir(nonceDirectory, { mode: 0o700 })
  await writeFile(join(directory, 'large'), ' '.repeat(65), { mode: 0o600 })
  await assert.rejects(readDiscoveryPrivateFile(join(directory, 'large'), 64)); count++
  if (process.platform === 'linux') {
    await chmod(nodePath, 0o644); assert.equal((await send(proofHeaders())).status, 503); count++
    await chmod(nodePath, 0o600)
    const linked = join(directory, 'linked'); await symlink(nodePath, linked)
    await assert.rejects(readDiscoveryPrivateFile(linked, 18000)); count++
    const linkedDirectory = join(directory, 'state-link')
    await symlink(state, linkedDirectory)
    await assert.rejects(createFileDiscoveryRepository(linkedDirectory)); count++
  }
  await stop()
  // Rate limiting must apply to unauthenticated callers as well.
  await start()
  for (let i = 0; i < 120; i++) assert.equal((await send()).status, 401)
  assert.equal((await send()).status, 429); count++
  await stop()
  if (process.platform === 'linux') {
    const release = await acquireDiscoveryProcessLock(state)
    try { await assert.rejects(acquireDiscoveryProcessLock(state), /ALREADY_RUNNING/); count++ }
    finally { await release() }
    const nextRelease = await acquireDiscoveryProcessLock(state); await nextRelease(); count++
    await chmod(join(state, 'service.lock'), 0o644)
    await assert.rejects(acquireDiscoveryProcessLock(state), /STATE_INVALID/); count++
    await chmod(join(state, 'service.lock'), 0o600)
    await chmod(join(directory, 'tls.key'), 0o600); await chmod(join(directory, 'tls.crt'), 0o600)
    // Run the actual independent CLI process, including clean stop and crash.
    const reservePort = async () => {
      const probe = createTcpServer()
      await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
      const address = probe.address(); assert.ok(address && typeof address !== 'string')
      await new Promise<void>(resolve => probe.close(() => resolve()))
      return address.port
    }
    const port = await reservePort(), alternatePort = await reservePort()
    const configuration = { schemaVersion: 1, authority, listenHost: '127.0.0.1', listenPort: port,
      stateDirectory: state, trustedConfigKeys: options.trustedConfigKeys }
    const configPath = join(directory, 'config.json'), alternatePath = join(directory, 'alternate.json')
    await writeFile(configPath, JSON.stringify(configuration), { mode: 0o600 })
    await writeFile(alternatePath, JSON.stringify({ ...configuration, listenPort: alternatePort }), { mode: 0o600 })
    const sourceExtension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'
    const entrypoint = fileURLToPath(new URL(`../src/scripts/run-controller-discovery.${sourceExtension}`, import.meta.url))
    const children: ChildProcess[] = []
    const launch = (path = configPath) => {
      const child = spawn(process.execPath, [...process.execArgv, entrypoint, path], { stdio: ['ignore', 'pipe', 'pipe'] })
      children.push(child)
      let output = ''
      child.stdout!.on('data', chunk => { output += chunk }); child.stderr!.on('data', chunk => { output += chunk })
      const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
      return { child, exited, output: () => output }
    }
    const waitReady = async (run: ReturnType<typeof launch>) => {
      const deadline = Date.now() + 10000
      while (!run.output().includes('is listening')) {
        if (run.child.exitCode !== null || Date.now() > deadline) throw new Error('Independent discovery CLI failed to become ready')
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    const waitExit = (run: ReturnType<typeof launch>) => new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { run.child.kill('SIGKILL'); reject(new Error('CLI did not exit')) }, 10000)
      run.exited.then(code => { clearTimeout(timer); resolve(code) }, error => { clearTimeout(timer); reject(error) })
    })
    try {
      const run = launch(); await waitReady(run)
      const restartProof = proofHeaders()
      assert.equal((await send(restartProof, undefined, undefined, undefined, port)).body, candidate); count++
      const duplicate = launch(alternatePath)
      assert.equal(await waitExit(duplicate), 1, 'different listen port must not bypass the state-directory process lock'); count++
      assert.equal((await send(proofHeaders(), undefined, undefined, undefined, port)).status, 200)
      run.child.kill('SIGKILL'); await waitExit(run)
      const restarted = launch(); await waitReady(restarted)
      assert.equal((await send(restartProof, undefined, undefined, undefined, port)).status, 401, 'unclean restart retains replay protection'); count++
      assert.equal((await send(proofHeaders(), undefined, undefined, undefined, port)).status, 200); count++
      restarted.child.kill('SIGTERM'); assert.equal(await waitExit(restarted), 0); count++
      const cleanRestart = launch(); await waitReady(cleanRestart)
      cleanRestart.child.kill('SIGTERM'); assert.equal(await waitExit(cleanRestart), 0); count++
      await writeFile(alternatePath, JSON.stringify({ ...configuration, listenHost: '0.0.0.0' }), { mode: 0o600 })
      assert.equal(await waitExit(launch(alternatePath)), 1); count++
      await chmod(configPath, 0o644)
      assert.equal(await waitExit(launch()), 1); count++
      await chmod(configPath, 0o600)
    } finally {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  }
  console.log(`Controller standalone discovery service passed: ${count} HTTPS/storage/restart boundary checks`)
} finally {
  if (server) { const old = server; await new Promise<void>(resolve => { old.close(() => resolve()); old.closeAllConnections() }) }
  await rm(directory, { recursive: true, force: true })
}
