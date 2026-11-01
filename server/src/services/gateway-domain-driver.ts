import { constants } from 'node:fs'
import { link, lstat, open, readFile, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'
import { checkServerIdentity } from 'node:tls'
import ssh2, { type Client } from 'ssh2'
import { GatewayTaskError, type GatewayTaskTarget } from '../lib/gateway-task-plan.js'
import { connectOnboardingSsh, sshExec } from './onboarding-ssh.js'
import { verifyRemoteGatewayDomain } from './onboarding-gateway-endpoint.js'
import type { GatewayDomainConfiguration } from './gateway-domain-management.js'

export interface GatewayDomainReceipt {
  schemaVersion: 1; gatewayId: string; requestId: string; revision: string; origin: string
  certificateSha256: string; tlsKeySha256: string; verified: true; transportPreserved: true
}
export interface GatewayDomainRequest {
  schemaVersion: 1; operation: 'enroll' | 'apply' | 'status'; platformId: string; gatewayId: string; machineId: string
  requestId: string; expectedRevision: string; expectedOrigin: string; expectedCertificateSha256: string
  expectedTlsKeySha256: string | null; origin: string
}
function require(value: unknown, code: string): asserts value { if (!value) throw new GatewayTaskError(code) }
export function parseGatewayDomainReceipt(raw: string, request: GatewayDomainRequest): GatewayDomainReceipt {
  require(Buffer.byteLength(raw) <= 8192, 'GATEWAY_DOMAIN_RECEIPT_INVALID')
  let row: Record<string, unknown>
  try { row = JSON.parse(raw) } catch { throw new GatewayTaskError('GATEWAY_DOMAIN_RECEIPT_INVALID') }
  if (row && Object.keys(row).length === 2 && row.canWrite === false && typeof row.code === 'string' && /^GATEWAY_DOMAIN_[A-Z_]+$/.test(row.code)) throw new GatewayTaskError(row.code)
  const fields = ['schemaVersion', 'gatewayId', 'requestId', 'revision', 'origin', 'certificateSha256', 'tlsKeySha256', 'verified', 'transportPreserved']
  require(row && Object.keys(row).length === fields.length && fields.every(field => Object.hasOwn(row, field)) && row.schemaVersion === 1 &&
    row.gatewayId === request.gatewayId && row.requestId === request.requestId && row.origin === request.origin &&
    row.revision === (BigInt(request.expectedRevision) + (request.operation === 'apply' ? 1n : 0n)).toString() &&
    row.verified === true && row.transportPreserved === true &&
    typeof row.certificateSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.certificateSha256) &&
    typeof row.tlsKeySha256 === 'string' && /^[a-f0-9]{64}$/.test(row.tlsKeySha256) &&
    (!request.expectedTlsKeySha256 || request.expectedTlsKeySha256 === row.tlsKeySha256), 'GATEWAY_DOMAIN_RECEIPT_INVALID')
  if (request.operation !== 'apply') require(row.certificateSha256 === request.expectedCertificateSha256, 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
  return row as unknown as GatewayDomainReceipt
}
export async function loadGatewayDomainManagementKey(allowInitialCreation = false) {
  // This exact directory is already included in the OSS identity backup. Never
  // invent another private key whose absence would strand a restored controller.
  const path = process.env.ONBOARDING_GATEWAY_KEY_PATH || '/opt/incudal/server/certs/onboarding-gateway.key'
  require(dirname(resolve(path)) === '/opt/incudal/server/certs', 'GATEWAY_DOMAIN_MANAGEMENT_KEY_MISSING')
  for (const directory of ['/opt', '/opt/incudal', '/opt/incudal/server', '/opt/incudal/server/certs']) {
    const info = await lstat(directory).catch(() => null)
    require(info?.isDirectory() && info.uid === 0 && !(info.mode & 0o022), 'GATEWAY_DOMAIN_MANAGEMENT_KEY_MISSING')
  }
  let file
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
  catch (error) {
    require((error as NodeJS.ErrnoException).code === 'ENOENT' && allowInitialCreation && !process.env.ONBOARDING_GATEWAY_KEY_PATH &&
      process.getuid?.() === 0, 'GATEWAY_DOMAIN_MANAGEMENT_KEY_MISSING')
    const { prisma } = await import('../db/prisma.js')
    const references = await prisma.$queryRaw<Array<{ registered: boolean }>>`SELECT EXISTS(
      SELECT 1 FROM management_gateway_tasks WHERE installation ? 'domainChannel'
      UNION ALL SELECT 1 FROM system_configs WHERE left(key, length('management_gateway_domain_')) = 'management_gateway_domain_' AND value::jsonb->>'channelReady' = 'true'
    ) AS registered`
    require(!references[0]?.registered, 'GATEWAY_DOMAIN_MANAGEMENT_KEY_MISSING')
    // The first external gateway may precede local-gateway setup. Its application
    // SSH key uses the existing OSS certs archive/restore contract. Never replace
    // a missing key once any gateway has recorded that management identity.
    const temporary = `/opt/incudal/server/certs/domain-initial-${randomUUID()}.key`
    const created = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      await created.writeFile(ssh2.utils.generateKeyPairSync('ed25519').private)
      await created.sync()
      await link(temporary, path).catch(cause => { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause })
    } finally { await created.close(); await unlink(temporary) }
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { await directory.sync() } finally { await directory.close() }
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  }
  try {
    const info = await file.stat()
    require(info.isFile() && info.nlink === 1 && info.uid === 0 && (info.mode & 0o137) === 0 && info.size <= 16384, 'GATEWAY_DOMAIN_MANAGEMENT_KEY_MISSING')
    const privateKey = await file.readFile(), parsed = ssh2.utils.parseKey(privateKey)
    require(!(parsed instanceof Error) && !Array.isArray(parsed) && parsed.isPrivateKey(), 'GATEWAY_DOMAIN_MANAGEMENT_KEY_MISSING')
    const publicKey = `${parsed.type} ${parsed.getPublicSSH().toString('base64')}`
    require(/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(publicKey), 'GATEWAY_DOMAIN_MANAGEMENT_KEY_MISSING')
    return { privateKey, publicKey }
  } finally { await file.close() }
}
const installedScript = '/usr/local/libexec/incudal-gateway-domain.py'
export async function enrollGatewayDomainChannel(client: Client, request: GatewayDomainRequest, publicKey?: string) {
  const key = publicKey || (await loadGatewayDomainManagementKey(true)).publicKey
  require(/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(key), 'GATEWAY_DOMAIN_INVALID')
  const source = await readFile(fileURLToPath(new URL('../../../scripts/gateway-domain-control.py', import.meta.url)), 'utf8')
  require(source.length < 100000 && /^[a-f0-9-]{36}$/.test(request.gatewayId), 'GATEWAY_DOMAIN_INVALID')
  const payload = { request: { ...request, operation: 'enroll', origin: request.expectedOrigin }, key, source, script: installedScript }
  // This one-time bootstrap runs over the already pinned, explicitly provided
  // root session. Future calls can execute only the fixed domain command.
  const bootstrap = [
    'import base64,fcntl,json,os,stat,sys,tempfile',
    'from pathlib import Path',
    `D=json.loads(base64.b64decode('${Buffer.from(JSON.stringify(payload)).toString('base64')}'))`,
    "scope={'__name__':'gateway_domain_bootstrap'};exec(compile(D['source'],D['script'],'exec'),scope)",
    'try:',
    " request=scope['validate'](D['request']);state=scope['ROOT']/request['gatewayId'];scope['directories'](state)",
    " scope['inspect'](state,request)",
    " lock=os.open(state/'domain.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)",
    " s=os.fstat(lock);scope['require'](stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600,'GATEWAY_DOMAIN_UNSAFE_FILE')",
    ' fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)',
    " p=Path(D['script']);a=Path('/root/.ssh/authorized_keys')",
    " scope['directories'](p.parent,True);scope['directories'](a.parent,True)",
    " if p.exists() or p.is_symlink():scope['read'](p,100000,False)",
    " old=scope['read'](a,1048576).decode() if a.exists() or a.is_symlink() else ''",
    ` line='restrict,command="/usr/bin/python3 -I -B '+D['script']+' '+request['gatewayId']+'" '+D['key']+' payincus-gateway-domain'`,
    ' for value in old.splitlines():',
    "  if D['key'].split()[1] in value:scope['require'](value==line,'GATEWAY_DOMAIN_CHANNEL_CONFLICT')",
    " result=scope['execute'](request)",
    " for destination,content,mode in [(p,D['source'],0o755),*([(a,old.rstrip('\\n')+'\\n'+line+'\\n',0o600)] if line not in old.splitlines() else [])]:",
    "  fd,temporary=tempfile.mkstemp(prefix='.domain-',dir=destination.parent)",
    "  with os.fdopen(fd,'w') as handle:handle.write(content);handle.flush();os.fchmod(handle.fileno(),mode);os.fsync(handle.fileno())",
    '  os.replace(temporary,destination)',
    '  fd=os.open(destination.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)',
    '  try:os.fsync(fd)',
    '  finally:os.close(fd)',
    " print(json.dumps(result,separators=(',',':')))",
    'except BlockingIOError:',
    ` print('{"code":"GATEWAY_DOMAIN_BUSY","canWrite":false}')`,
    'except Exception as error:',
    " print(json.dumps({'code':getattr(error,'code','GATEWAY_DOMAIN_CHANNEL_FAILED'),'canWrite':False}))",
  ].join('\n')
  return parseGatewayDomainReceipt(await sshExec(client, '/usr/bin/python3 -I -B -', bootstrap, 45000, 16384), payload.request as GatewayDomainRequest)
}
function domainCommand(client: Client, request: GatewayDomainRequest, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '', settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); client.off('close', closed)
      if (error) reject(error); else resolve(output)
    }
    const abort = () => { finish(new GatewayTaskError('GATEWAY_DOMAIN_WORKER_INTERRUPTED')); client.destroy() }
    const closed = () => finish(new GatewayTaskError('SSH_DISCONNECTED'))
    const timer = setTimeout(() => { finish(new GatewayTaskError('SSH_COMMAND_TIMEOUT')); client.destroy() }, 60000)
    signal.addEventListener('abort', abort, { once: true }); client.once('close', closed)
    if (signal.aborted) { abort(); return }
    client.exec('domain', (error, stream) => {
      if (error) { finish(new GatewayTaskError('GATEWAY_DOMAIN_CREDENTIALS_REQUIRED')); return }
      stream.on('data', (data: Buffer) => {
        output += data.toString('utf8')
        if (Buffer.byteLength(output) > 16384) { finish(new GatewayTaskError('GATEWAY_DOMAIN_RECEIPT_INVALID')); stream.close() }
      })
      stream.stderr.on('data', () => {})
      stream.on('error', () => finish(new GatewayTaskError('SSH_DISCONNECTED')))
      stream.on('close', () => finish())
      stream.end(JSON.stringify(request))
    })
  })
}
export async function verifyGatewayDomainHttps(address: string, receipt: GatewayDomainReceipt, signal: AbortSignal) {
  const origin = new URL(receipt.origin)
  await verifyRemoteGatewayDomain(address, origin.hostname)
  await new Promise<void>((resolve, reject) => {
    const request = https.request({ host: address, port: Number(origin.port), servername: origin.hostname,
      rejectUnauthorized: false, method: 'GET', path: '/', signal, headers: { Host: origin.host } }, response => {
      let bytes = 0
      response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) request.destroy() })
      response.on('end', () => response.statusCode === 200 && bytes > 0 && bytes <= 1024 * 1024 ? resolve() : reject(new GatewayTaskError('GATEWAY_DOMAIN_VERIFY_FAILED')))
      response.on('error', () => reject(new GatewayTaskError('GATEWAY_DOMAIN_VERIFY_FAILED')))
    })
    request.on('socket', socket => socket.once('secureConnect', () => {
      const certificate = (socket as import('node:tls').TLSSocket).getPeerCertificate()
      if (!certificate.raw || createHash('sha256').update(certificate.raw).digest('hex') !== receipt.certificateSha256 ||
          checkServerIdentity(origin.hostname, certificate)) request.destroy(new GatewayTaskError('GATEWAY_DOMAIN_IDENTITY_CHANGED'))
    }))
    request.on('error', error => reject(error instanceof GatewayTaskError ? error : new GatewayTaskError('GATEWAY_DOMAIN_VERIFY_FAILED')))
    request.setTimeout(8000, () => request.destroy(new GatewayTaskError('GATEWAY_DOMAIN_VERIFY_FAILED')))
    request.end()
  })
}
export async function executeGatewayDomainChange(input: {
  gatewayId: string; platformId: string; target: GatewayTaskTarget; requestId: string; configuration: GatewayDomainConfiguration
  origin: string; password?: string; signal: AbortSignal; progress: (step: string, enrolled?: GatewayDomainReceipt) => Promise<void>
}): Promise<GatewayDomainReceipt> {
  const { target, configuration, signal } = input
  require(target.mode === 'remote' && target.ssh, 'GATEWAY_DOMAIN_USE_LOCAL_ENDPOINT')
  const key = await loadGatewayDomainManagementKey(!!input.password && !configuration.channelReady), request: GatewayDomainRequest = { schemaVersion: 1, operation: 'apply',
    platformId: input.platformId, gatewayId: input.gatewayId, machineId: target.machineId, requestId: input.requestId,
    expectedRevision: configuration.revision, expectedOrigin: configuration.origin,
    expectedCertificateSha256: configuration.certificateSha256, expectedTlsKeySha256: configuration.tlsKeySha256, origin: input.origin }
  await verifyRemoteGatewayDomain(target.ssh.address, new URL(input.origin).hostname)
  let client: Client | undefined
  const abort = () => client?.destroy()
  signal.addEventListener('abort', abort, { once: true })
  const connect = (credentials: { privateKey?: Buffer; password?: string }) => connectOnboardingSsh({
    host: target.ssh!.address, port: target.ssh!.port, ...credentials }, async fingerprint => fingerprint === target.ssh!.fingerprint)
  try {
    signal.throwIfAborted()
    try { client = await connect({ privateKey: key.privateKey }) }
    catch (error) {
      if ((error as { code?: string }).code !== 'SSH_AUTH_FAILED') throw error
      require(input.password, 'GATEWAY_DOMAIN_CREDENTIALS_REQUIRED')
      client = await connect({ password: input.password })
      signal.throwIfAborted()
      await input.progress('preparing-channel')
      const enrolled = await enrollGatewayDomainChannel(client, request, key.publicKey)
      require(enrolled.certificateSha256 === configuration.certificateSha256, 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
      request.expectedTlsKeySha256 = enrolled.tlsKeySha256
      await input.progress('applying', enrolled)
      client.end(); client = await connect({ privateKey: key.privateKey })
    }
    signal.throwIfAborted()
    if (!request.expectedTlsKeySha256) {
      const status = { ...request, operation: 'status' as const, origin: request.expectedOrigin }
      const enrolled = parseGatewayDomainReceipt(await domainCommand(client, status, signal), status)
      request.expectedTlsKeySha256 = enrolled.tlsKeySha256
      await input.progress('applying', enrolled)
    }
    await input.progress('applying')
    const receipt = parseGatewayDomainReceipt(await domainCommand(client, request, signal), request)
    await input.progress('verifying')
    await verifyGatewayDomainHttps(target.ssh.address, receipt, signal)
    signal.throwIfAborted()
    return receipt
  } finally { signal.removeEventListener('abort', abort); client?.end() }
}
