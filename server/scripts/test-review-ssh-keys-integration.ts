import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { generateKeyPair, randomUUID, createPrivateKey, createPublicKey } from 'node:crypto'
import { promisify } from 'node:util'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/ssh-keys.js')
const keygen = promisify(generateKeyPair)
const user = await prisma.user.create({ data: { username: `ssh-review-${randomUUID()}`, passwordHash: 'unusable-fixture' } })
const app = Fastify()
const session = { id: user.id, username: user.username, role: 'user', sid: 'fixture-ssh-session', iat: Math.floor(Date.now() / 1000) + 1 }
app.decorate('authenticateUser', async (request: any) => { request.user = { ...session } })
await app.register(routes, { prefix: '/keys' })
const add = (publicKey: string, name = 'Verification key') => app.inject({ method: 'POST', url: '/keys', payload: { name, publicKey } })
function sshPublic(pem: string): string {
  const jwk = createPublicKey(pem).export({ format: 'jwk' })
  const field = (value: Buffer | string) => {
    const buffer = typeof value === 'string' ? Buffer.from(value) : value
    const length = Buffer.alloc(4); length.writeUInt32BE(buffer.length)
    return Buffer.concat([length, buffer])
  }
  const mpint = (value: string) => {
    const buffer = Buffer.from(value, 'base64url')
    return field(buffer[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buffer]) : buffer)
  }
  const type = jwk.kty === 'RSA' ? 'ssh-rsa' : jwk.kty === 'EC' ? 'ecdsa-sha2-nistp256' : 'ssh-ed25519'
  const parts = jwk.kty === 'RSA' ? [mpint(jwk.e!), mpint(jwk.n!)] : jwk.kty === 'EC'
    ? [field('nistp256'), field(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]))]
    : [field(Buffer.from(jwk.x!, 'base64url'))]
  return `${type} ${Buffer.concat([field(type), ...parts]).toString('base64')}`
}
try {
  const valid: string[] = []
  for (const type of ['rsa', 'ed25519', 'ec'] as const) {
    const pair = await keygen(type as 'rsa', { ...(type === 'rsa' ? { modulusLength: 2048 } : type === 'ec' ? { namedCurve: 'prime256v1' } : {}),
      publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
    valid.push(sshPublic(pair.privateKey))
  }
  for (const publicKey of valid) {
    const response = await add(`  ${publicKey} fixture comment\n`)
    assert.equal(response.statusCode, 201, response.body)
  }
  assert.equal(await prisma.sshKey.count({ where: { userId: user.id } }), 3)
  const [kind, blob] = valid[0].split(' ')
  for (const invalid of [
    'ssh-rsa AAAAAAAAAAAAAAAAAAAA', `ssh-ed25519 ${blob}`, `${kind} ${blob.slice(0, -16)}`,
    `${kind} ${Buffer.concat([Buffer.from(blob, 'base64'), Buffer.from([0])]).toString('base64')}`,
    `${kind} =${blob}`, `${valid[0]}\n${valid[1]}`, `${valid[0]}\r${valid[1]}`, `${valid[0]}\u0000bad`
  ]) assert.equal((await add(invalid)).statusCode, 400, 'malformed/multiple/type-mismatched SSH key is rejected')
  assert.equal(await prisma.sshKey.count({ where: { userId: user.id } }), 3)
  await prisma.sshKey.deleteMany({ where: { userId: user.id } })
  const duplicates = await Promise.all(Array.from({ length: 10 }, (_, i) => add(`${valid[0]} comment-${i}`)))
  assert.equal(duplicates.filter(r => r.statusCode === 201).length, 1, 'same blob with different comments cannot duplicate under concurrency')
  assert.ok(duplicates.every(r => r.statusCode === 201 || r.statusCode === 400))
  await prisma.sshKey.deleteMany({ where: { userId: user.id } })
  await prisma.sshKey.createMany({ data: Array.from({ length: 19 }, (_, i) => ({ userId: user.id, name: 'Capacity fixture',
    publicKey: valid[0], fingerprint: `fixture-${i}` })) })
  const lastSlots = await Promise.all(Array.from({ length: 9 }, (_, i) => add(valid[i % 3])))
  assert.equal(lastSlots.filter(r => r.statusCode === 201).length, 1, 'only one concurrent request can take the final slot')
  assert.equal(await prisma.sshKey.count({ where: { userId: user.id } }), 20)
  assert.equal((await app.inject({ method: 'POST', url: '/keys/generate' })).statusCode, 400)
  await prisma.sshKey.deleteMany({ where: { userId: user.id } })
  await prisma.user.update({ where: { id: user.id }, data: { status: 'banned' } })
  assert.equal((await add(valid[0])).statusCode, 403, 'write checks current user status even when request authentication is stale')
  assert.equal(await prisma.sshKey.count({ where: { userId: user.id } }), 0)
  await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } })
  await prisma.tokenInvalidation.create({ data: { userId: user.id, sessionId: session.sid, invalidatedAt: session.iat } })
  assert.equal((await add(valid[0])).statusCode, 403, 'logout blocks an in-flight key write')
  await prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })
  let ticks = 0
  const timer = setInterval(() => ticks++, 5)
  let response
  try { response = await app.inject({ method: 'POST', url: '/keys/generate' }) }
  finally { clearInterval(timer) }
  assert.equal(response.statusCode, 200, response.body)
  assert.ok(ticks >= 2, 'event loop remains responsive while generating RSA-4096')
  const generated = response.json()
  const privateKey = createPrivateKey(generated.privateKey)
  assert.equal(privateKey.asymmetricKeyDetails?.modulusLength, 4096)
  const stored = await prisma.sshKey.findUniqueOrThrow({ where: { id: generated.key.id } })
  assert.equal(stored.publicKey, sshPublic(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()))
  assert.ok(createPublicKey(privateKey))
  assert.equal((await add(stored.publicKey)).statusCode, 400, 'generated public key shares the duplicate check')
  console.log('PASS real PostgreSQL/Fastify SSH keys: RSA/Ed25519/ECDSA parsing, malformed input, duplicate/limit races, stale banned user, responsive RSA-4096 generation')
} finally {
  await app.close()
  await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
process.exit(0)
