import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { constants } from 'node:fs'
import { open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { ControllerConfigError } from '../lib/controller-config.js'
import { acquireDiscoveryMutationLock, readDiscoveryPrivateFile, readGatewayPrivateFile, validateDiscoveryPrivateDirectory } from './controller-discovery.js'

const MAGIC = Buffer.from('PICGWB01')
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const HASH = /^[a-f0-9]{64}$/
const MAX_BYTES = 8 * 1024 * 1024
const ASSETS = ['gateway-identity.json', 'gateway-transport.json', 'wireguard.key', 'gateway-auth.json', 'tls.crt', 'tls.key', 'console-enrollment.json']
export function readGatewaySnapshotSource(name: string, path: string): Promise<string> {
  require(ASSETS.includes(name))
  return name === 'gateway-transport.json' ? readGatewayPrivateFile(path) : readDiscoveryPrivateFile(path, 65536)
}
export interface GatewaySnapshot {
  schemaVersion: 1; purpose: 'gateway-backup'; platformId: string; gatewayId: string; id: string
  createdAt: number; epoch: string; sequence: string; componentVersion: string
  files: Array<{ name: string; base64: string; sha256: string }>
}
export interface GatewayBackupStore {
  put(key: string, value: Buffer): Promise<void>
  get(key: string, maxBytes: number): Promise<Buffer>
  list(prefix: string): Promise<string[]>
  delete(key: string): Promise<void>
}
interface Completion {
  schemaVersion: 1; purpose: 'gateway-backup-complete'; platformId: string; gatewayId: string; id: string
  createdAt: number; epoch: string; sequence: string; bytes: number; sha256: string
}
function require(condition: unknown): asserts condition { if (!condition) throw new ControllerConfigError('GATEWAY_BACKUP_REJECTED') }
function sha(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
function validateSnapshot(input: unknown): GatewaySnapshot {
  require(input && typeof input === 'object' && !Array.isArray(input))
  const row = input as GatewaySnapshot
  const fields=['schemaVersion','purpose','platformId','gatewayId','id','createdAt','epoch','sequence','componentVersion','files']
  require(Object.keys(row).length === fields.length && fields.every(field=>Object.hasOwn(row,field)) && row.schemaVersion === 1 && row.purpose === 'gateway-backup' && UUID.test(row.platformId) && UUID.test(row.gatewayId) && UUID.test(row.id))
  require(Number.isSafeInteger(row.createdAt) && row.createdAt > 0 && typeof row.componentVersion === 'string' && row.componentVersion.length <= 80)
  for (const counter of [row.epoch, row.sequence]) require(typeof counter === 'string' && /^[1-9][0-9]{0,18}$/.test(counter) && BigInt(counter) <= 9223372036854775807n)
  require(Array.isArray(row.files) && row.files.length >= 3 && row.files.length <= ASSETS.length)
  const names = new Set<string>(); let total = 0
  for (const file of row.files) {
    require(file && Object.keys(file).length === 3 && ['name','base64','sha256'].every(field=>Object.hasOwn(file,field)) && ASSETS.includes(file.name) && !names.has(file.name) && typeof file.base64 === 'string' && HASH.test(file.sha256))
    const raw = Buffer.from(file.base64, 'base64')
    require(raw.length <= 1024 * 1024 && raw.toString('base64') === file.base64 && sha(raw) === file.sha256)
    names.add(file.name); total += raw.length
  }
  require(total <= MAX_BYTES && ['gateway-identity.json', 'gateway-transport.json', 'wireguard.key'].every(name => names.has(name)))
  return row
}
async function key(password: string, salt: Buffer): Promise<Buffer> {
  require(typeof password === 'string' && password.length >= 12 && Buffer.byteLength(password) <= 256)
  return new Promise((resolve,reject)=>scrypt(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)))
}
export async function encryptGatewaySnapshot(snapshot: GatewaySnapshot, password: string): Promise<Buffer> {
  const raw = Buffer.from(JSON.stringify(validateSnapshot(snapshot))); require(raw.length <= MAX_BYTES)
  const salt = randomBytes(16), nonce = randomBytes(12), header = Buffer.concat([MAGIC, salt, nonce])
  const cipher = createCipheriv('aes-256-gcm', await key(password, salt), nonce); cipher.setAAD(header)
  return Buffer.concat([header, cipher.update(gzipSync(raw)), cipher.final(), cipher.getAuthTag()])
}
export async function decryptGatewaySnapshot(encoded: Buffer, password: string, identity: { platformId: string; gatewayId: string; id?: string }): Promise<GatewaySnapshot> {
  require(Buffer.isBuffer(encoded) && encoded.length >= 52 && encoded.length <= MAX_BYTES && encoded.subarray(0, 8).equals(MAGIC))
  try {
    const header = encoded.subarray(0, 36), salt = header.subarray(8, 24), nonce = header.subarray(24, 36)
    const decipher = createDecipheriv('aes-256-gcm', await key(password, salt), nonce)
    decipher.setAAD(header); decipher.setAuthTag(encoded.subarray(-16))
    const compressed = Buffer.concat([decipher.update(encoded.subarray(36, -16)), decipher.final()])
    const raw = gunzipSync(compressed, { maxOutputLength: MAX_BYTES }), snapshot = validateSnapshot(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(raw)))
    require(raw.equals(Buffer.from(JSON.stringify(snapshot))) && snapshot.platformId === identity.platformId && snapshot.gatewayId === identity.gatewayId && (!identity.id || snapshot.id === identity.id))
    return snapshot
  } catch { throw new ControllerConfigError('GATEWAY_BACKUP_AUTHENTICATION_FAILED') }
}
export function gatewayBackupPrefix(prefix: string, platformId: string, gatewayId: string): string {
  require(UUID.test(platformId) && UUID.test(gatewayId) && typeof prefix === 'string' && /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/$/.test(prefix) && prefix.length <= 200)
  return `${prefix}${platformId}/${gatewayId}/`
}

// Full encrypted snapshots are independent historical archives. Current peer
// synchronization never overwrites an older backup, and retention runs only
// after upload, actual ciphertext readback and authenticated decryption pass.
export async function uploadGatewaySnapshot(store: GatewayBackupStore, prefix: string, snapshot: GatewaySnapshot, password: string): Promise<Completion> {
  validateSnapshot(snapshot)
  const root = gatewayBackupPrefix(prefix, snapshot.platformId, snapshot.gatewayId), target = root + snapshot.id + '/'
  const encoded = await encryptGatewaySnapshot(snapshot, password), digest = sha(encoded)
  await store.put(target + 'payload.enc', encoded)
  const received = await store.get(target + 'payload.enc', MAX_BYTES)
  require(received.length === encoded.length && timingSafeEqual(Buffer.from(sha(received)), Buffer.from(digest)))
  await decryptGatewaySnapshot(received, password, snapshot)
  const completion: Completion = { schemaVersion: 1, purpose: 'gateway-backup-complete', platformId: snapshot.platformId, gatewayId: snapshot.gatewayId,
    id: snapshot.id, createdAt: snapshot.createdAt, epoch: snapshot.epoch, sequence: snapshot.sequence, bytes: encoded.length, sha256: digest }
  await store.put(target + 'complete.json', Buffer.from(JSON.stringify(completion)))
  // Completion itself is checked by rereading. An interrupted publish remains
  // a failed job locally, even if a later list discovers the valid marker.
  require((await store.get(target + 'complete.json', 4096)).equals(Buffer.from(JSON.stringify(completion))))
  return completion
}
export async function restoreGatewaySnapshot(store: GatewayBackupStore, prefix: string, identity: { platformId: string; gatewayId: string }, id: string, password: string): Promise<GatewaySnapshot> {
  require(UUID.test(id))
  const target = gatewayBackupPrefix(prefix, identity.platformId, identity.gatewayId) + id + '/'
  const raw = await store.get(target + 'complete.json', 4096), index = JSON.parse(raw.toString()) as Completion
  const fields=['schemaVersion','purpose','platformId','gatewayId','id','createdAt','epoch','sequence','bytes','sha256']
  require(raw.equals(Buffer.from(JSON.stringify(index))) && Object.keys(index).length === fields.length && fields.every(field=>Object.hasOwn(index,field)) && index.schemaVersion === 1 && index.purpose === 'gateway-backup-complete' &&
    index.platformId === identity.platformId && index.gatewayId === identity.gatewayId && index.id === id && HASH.test(index.sha256) && Number.isSafeInteger(index.bytes) && index.bytes > 52 && index.bytes <= MAX_BYTES)
  require(Number.isSafeInteger(index.createdAt)&&index.createdAt>0)
  for(const value of [index.epoch,index.sequence])require(typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n)
  const encoded = await store.get(target + 'payload.enc', MAX_BYTES)
  require(encoded.length === index.bytes && sha(encoded) === index.sha256)
  const snapshot = await decryptGatewaySnapshot(encoded, password, { ...identity, id })
  require(snapshot.createdAt === index.createdAt && snapshot.epoch === index.epoch && snapshot.sequence === index.sequence)
  return snapshot
}

export async function retainGatewaySnapshots(store:GatewayBackupStore,prefix:string,identity:{platformId:string;gatewayId:string},password:string,retain:number,protectedIds:readonly string[]):Promise<number>{
  require(Number.isInteger(retain)&&retain>=3&&retain<=30&&protectedIds.length<=30&&protectedIds.every(id=>UUID.test(id)))
  const root=gatewayBackupPrefix(prefix,identity.platformId,identity.gatewayId),objects=await store.list(root)
  require(objects.length<=2000&&objects.every(key=>key.startsWith(root)))
  const snapshots:GatewaySnapshot[]=[]
  // Authenticate all completed archives before any deletion. Corruption or
  // unavailable history leaves retention unchanged rather than hiding a gap.
  for(const name of objects){
    if(!name.endsWith('/complete.json'))continue
    const id=name.slice(root.length,-'/complete.json'.length)
    require(UUID.test(id));snapshots.push(await restoreGatewaySnapshot(store,prefix,identity,id,password))
  }
  snapshots.sort((a,b)=>b.createdAt-a.createdAt||b.id.localeCompare(a.id))
  let removed=0
  for(const snapshot of snapshots.slice(retain)){
    if(protectedIds.includes(snapshot.id))continue
    const target=root+snapshot.id+'/'
    // No partial uploads, restore-held snapshots or unrelated objects deleted.
    await store.delete(target+'complete.json');await store.delete(target+'payload.enc');removed++
  }
  return removed
}

export async function collectGatewaySnapshot(config: { platformId: string; gatewayId: string; epoch: string; sequence: string; componentVersion: string;
  sources: Readonly<Record<string, string>> }): Promise<GatewaySnapshot> {
  require(Object.keys(config.sources).length >= 3 && Object.keys(config.sources).length <= ASSETS.length)
  const files: GatewaySnapshot['files'] = []
  for (const [name, path] of Object.entries(config.sources).sort(([a], [b]) => a.localeCompare(b))) {
    require(ASSETS.includes(name))
    const raw = Buffer.from(await readGatewaySnapshotSource(name, path))
    files.push({ name, base64: raw.toString('base64'), sha256: sha(raw) })
  }
  // A concurrent config/credential change cannot produce a complete mixed
  // snapshot; exact protected bytes must still match after all collection.
  for (const file of files) require(sha(Buffer.from(await readGatewaySnapshotSource(file.name, config.sources[file.name]))) === file.sha256)
  return validateSnapshot({ schemaVersion: 1, purpose: 'gateway-backup', platformId: config.platformId, gatewayId: config.gatewayId,
    id: randomUUID(), createdAt: Date.now(), epoch: config.epoch, sequence: config.sequence, componentVersion: config.componentVersion, files })
}

export async function gatewayBackupJob(root: string, store: GatewayBackupStore, prefix: string, snapshot: GatewaySnapshot, password: string,
  retention?:{count:number;protectedIds:readonly string[]}) {
  await validateDiscoveryPrivateDirectory(root)
  const release = process.platform === 'linux' ? await acquireDiscoveryMutationLock(root) : async () => {}
  let previousCompletedAt:number|null=null
  try{const prior=JSON.parse(await readDiscoveryPrivateFile(join(root,'backup-status.json'),4096));
    require(prior&&['running','failed','complete'].includes(prior.phase)&&UUID.test(prior.id)&&Object.keys(prior).length===5&&
      ['id','phase','lastCompletedAt','epoch','sequence'].every(field=>Object.hasOwn(prior,field)))
    for(const value of [prior.epoch,prior.sequence])require(typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n)
    if(prior.lastCompletedAt!==null&&(!Number.isSafeInteger(prior.lastCompletedAt)||prior.lastCompletedAt<=0||prior.lastCompletedAt>Date.now()))throw Error('invalid backup history')
    previousCompletedAt=prior.lastCompletedAt
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'){await release();throw error}}
  const save = async (value: unknown) => {
    const temporary = join(root, '.backup-' + randomBytes(16).toString('hex'))
    try {
      const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      try { await file.writeFile(JSON.stringify(value)); await file.sync() } finally { await file.close() }
      await rename(temporary, join(root, 'backup-status.json'))
      if (process.platform !== 'win32') { const directory = await open(root, constants.O_RDONLY | constants.O_NOFOLLOW); try { await directory.sync() } finally { await directory.close() } }
    } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
  }
  try {
    await save({ id: snapshot.id, phase: 'running', lastCompletedAt: previousCompletedAt, epoch: snapshot.epoch, sequence: snapshot.sequence })
    const complete = await uploadGatewaySnapshot(store, prefix, snapshot, password)
    await save({ id: snapshot.id, phase: 'complete', lastCompletedAt: Date.now(), epoch: complete.epoch, sequence: complete.sequence })
    if(retention)await retainGatewaySnapshots(store,prefix,snapshot,password,retention.count,retention.protectedIds)
    return complete
  } catch {
    await save({ id: snapshot.id, phase: 'failed', lastCompletedAt: previousCompletedAt, epoch: snapshot.epoch, sequence: snapshot.sequence })
    throw new ControllerConfigError('GATEWAY_BACKUP_FAILED')
  } finally { await release() }
}
