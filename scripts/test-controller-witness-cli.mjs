#!/usr/bin/env node
// Explicit Linux integration test of the built standalone witness. All state,
// keys and certificates remain in a fresh protected test directory; no system
// service, business database, firewall or customer resource is modified.
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { createPublicKey, generateKeyPairSync, X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { request } from 'node:https'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

if (process.platform !== 'linux' || process.env.INCUDAL_WITNESS_CLI_TEST !== '1' || process.argv.length !== 4) {
  throw new Error('Explicit Linux test only: INCUDAL_WITNESS_CLI_TEST=1 node scripts/test-controller-witness-cli.mjs <built-server-directory> <protected-test-parent>')
}
const built = resolve(process.argv[2]), parent = resolve(process.argv[3]), exec = promisify(execFile)
const { signControllerPrepareConfig, controllerSigningKeyId } = await import(pathToFileURL(join(built, 'lib/controller-config.js')))
const entry = join(built, 'scripts/run-controller-witness.js')
const dir = await mkdtemp(join(parent, 'witness-cli-'))
const processes = new Set()
const write = async (name, value) => { const path = join(dir, name); await writeFile(path, value, { mode: 0o600 }); return path }
const command = async args => { const { stdout } = await exec(process.execPath, [entry, ...args], { timeout: 10000 }); return stdout }
const freePort = async () => {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port
}
const start = async configPath => {
  const child = spawn(process.execPath, [entry, '--serve', configPath], { stdio: ['ignore', 'pipe', 'pipe'] }); processes.add(child)
  await new Promise((resolve, reject) => {
    let text = ''; const timer = setTimeout(() => reject(new Error('startup timed out')), 5000)
    child.stdout.on('data', data => { text += data; if (text.includes('is listening')) { clearTimeout(timer); resolve() } })
    child.once('error', reject); child.once('exit', code => { clearTimeout(timer); reject(new Error('startup failed: ' + code)) })
  })
  return child
}
const stop = async child => {
  const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM')
  const code = await done; processes.delete(child); assert.equal(code, 0)
}
try {
  const root = generateKeyPairSync('ed25519'), signer = generateKeyPairSync('ed25519'), node = generateKeyPairSync('ed25519'), holder = generateKeyPairSync('ed25519')
  const pub = key => createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
  const privateKey = await write('witness-signing.key', signer.privateKey.export({ type: 'pkcs8', format: 'pem' }))
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'ca.key'), '-out', join(dir, 'ca.crt'), '-days', '1', '-subj', '/CN=witness-cli-test-ca'])
  for (const name of ['server', 'client']) {
    await exec('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, name+'.key'), '-out', join(dir, name+'.csr'), '-subj', '/CN=localhost'])
    await write(name+'.ext', 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage='+(name==='server'?'serverAuth':'clientAuth'))
    await exec('openssl', ['x509', '-req', '-in', join(dir, name+'.csr'), '-CA', join(dir, 'ca.crt'), '-CAkey', join(dir, 'ca.key'), '-CAcreateserial', '-out', join(dir, name+'.crt'), '-days', '1', '-extfile', join(dir, name+'.ext')])
  }
  // readDiscoveryPrivateFile requires all TLS material to stay mode 0600.
  const { chmod } = await import('node:fs/promises')
  for (const name of ['ca.crt','server.crt','server.key','client.crt','client.key']) await chmod(join(dir,name),0o600)
  const platformId='11111111-1111-4111-8111-111111111111',nodeId='22222222-2222-4222-8222-222222222222',controllerId='33333333-3333-4333-8333-333333333333'
  const now = Date.now(), port = await freePort(), authority='witness.example.test:'+port
  const candidate = signControllerPrepareConfig({schemaVersion:1,purpose:'controller-prepare',platformId,nodeId,controllerId,
    requestId:'44444444-4444-4444-8444-444444444444',epoch:'2',sequence:'1',issuedAt:now,expiresAt:now+600000,panelBaseUrl:'https://panel.example.com',
    gateway:{gatewayId:'55555555-5555-4555-8555-555555555555',endpointHost:'gateway.example.com',endpointPort:51820,publicKey:Buffer.alloc(32,7).toString('base64'),nodeAddress:'10.253.240.2',controlAddress:'10.253.240.1'}},root.privateKey)
  const clientCert=await readFile(join(dir,'client.crt')), clientKey=await readFile(join(dir,'client.key')), ca=await readFile(join(dir,'ca.crt'))
  const fingerprint = (await import('node:crypto')).createHash('sha256').update(new X509Certificate(clientCert).raw).digest('hex')
  const config={schemaVersion:1,authority,listenHost:'127.0.0.1',listenPort:port,stateDirectory:join(dir,'authority'),
    enrollment:{platformId,witnessId:'77777777-7777-4777-8777-777777777777',candidateKeys:{[controllerSigningKeyId(pub(root.privateKey))]:pub(root.privateKey)},nodes:{[nodeId]:pub(node.privateKey)}},
    signingKey:privateKey,tlsKey:join(dir,'server.key'),tlsCertificate:join(dir,'server.crt'),clientCA:join(dir,'ca.crt'),
    clients:{[fingerprint]:{controllerId,holderKeyId:controllerSigningKeyId(pub(holder.privateKey)),nodeIds:[nodeId]}},initialCandidates:{[nodeId]:candidate}}
  const path=await write('config.json',JSON.stringify(config))
  await assert.rejects(command(['--serve',path]))
  await command(['--initialize',path]); await assert.rejects(command(['--initialize',path]))
  const send = async (client=true) => new Promise((resolve,reject)=>{
    const r=request({hostname:'127.0.0.1',port,path:'/v1/witness/status',method:'POST',ca,servername:'localhost',agent:false,
      ...(client?{key:clientKey,cert:clientCert}:{}),headers:{Host:authority,'Content-Type':'application/json'}},response=>{
      let body='';response.on('data',data=>body+=data);response.on('end',()=>resolve({status:response.statusCode,value:JSON.parse(body)}))
    });r.setTimeout(3000,()=>r.destroy(new Error('timeout')));r.once('error',reject);r.end(JSON.stringify({nodeId}))
  })
  let child=await start(path)
  assert.equal((await send()).status,200);await assert.rejects(send(false))
  const rssText=await readFile('/proc/'+child.pid+'/status','utf8'),rssKiB=Number(rssText.match(/^VmRSS:\s+(\d+) kB/m)[1])
  const duplicate=await write('duplicate.json',JSON.stringify({...config,listenPort:await freePort()}))
  await assert.rejects(command(['--serve',duplicate]))
  await stop(child);child=await start(path)
  assert.equal((await send()).value.epoch,'2')
  // Kernel-owned flock must release after an unclean process exit as well.
  const killed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await killed;processes.delete(child)
  child=await start(path);assert.equal((await send()).value.epoch,'2');await stop(child)
  await writeFile(join(config.stateDirectory,'identity.json'),'corrupt',{mode:0o600})
  await assert.rejects(command(['--serve',path]));await assert.rejects(command(['--initialize',path]))
  console.log(JSON.stringify({passed:true,standaloneProcess:true,restartsKeepEpoch:true,mTLS:true,duplicateAuthorityRejected:true,
    missingOrCorruptStateRejected:true,gracefulShutdown:true,uncleanRestartKeepsEpoch:true,signingKeyFixed:true,rssKiB,physicalHostFencing:false}))
} finally {
  for(const child of processes)child.kill('SIGKILL')
}
