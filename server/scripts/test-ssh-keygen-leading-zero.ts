import assert from 'node:assert/strict'
import * as crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { runInThisContext } from 'node:vm'
import ssh2 from 'ssh2'

// Exercise the installed dependency with deterministic Node/OpenSSL key input.
// ASN.1 BIT STRING has one unused-bits byte; zero bytes in the key are data.
const require = createRequire(import.meta.url)
const path = join(dirname(require.resolve('ssh2')), 'keygen.js')
const dependencyRequire = createRequire(path)
const vectors: Array<{ pub: Buffer; priv: Buffer; leadingZero: boolean }> = []
for (let counter = 0; counter < 4096 && vectors.length < 2; counter++) {
  const seed = crypto.createHash('sha256').update(`payincus-ed25519-regression-${counter}`).digest()
  const privateKey = crypto.createPrivateKey({ format: 'der', type: 'pkcs8',
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]) })
  const pub = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  const leadingZero = pub[12] === 0
  if (!vectors.some(vector => vector.leadingZero === leadingZero)) {
    vectors.push({ pub, priv: privateKey.export({ format: 'der', type: 'pkcs8' }), leadingZero })
  }
}
assert.equal(vectors.length, 2, 'deterministic fixtures include a leading-zero public key')
for (const vector of vectors) {
  const module = { exports: {} as typeof ssh2.utils }
  const wrapped = runInThisContext(`(function(require,module,exports){${readFileSync(path, 'utf8')}\n})`, { filename: path })
  wrapped((name: string) => name === 'crypto' ? { ...crypto,
    generateKeyPairSync: () => ({ publicKey: vector.pub, privateKey: vector.priv }),
    generateKeyPair: (...args: any[]) => args.at(-1)(null, vector.pub, vector.priv),
  } : dependencyRequire(name), module, module.exports)
  const sync = module.exports.generateKeyPairSync('ed25519')
  const asyncKeys = await new Promise<typeof sync>((resolve, reject) => {
    module.exports.generateKeyPair('ed25519', (error, keys) => error ? reject(error) : resolve(keys))
  })
  for (const keys of [sync, asyncKeys]) {
    const parsed = ssh2.utils.parseKey(keys.private)
    assert.ok(!(parsed instanceof Error), `generated Ed25519 key must parse (leadingZero=${vector.leadingZero})`)
    assert.ok(!Array.isArray(parsed) && parsed.isPrivateKey())
    const publicWire = Buffer.from(keys.public.split(' ')[1], 'base64')
    assert.equal(publicWire.readUInt32BE(15), 32, 'public key retains all 32 bytes')
    assert.ok(publicWire.subarray(19).equals(vector.pub.subarray(12)))
    assert.ok(parsed.getPublicSSH().equals(publicWire))
    const payload = Buffer.from('gateway identity regression')
    const signature = parsed.sign(payload)
    assert.ok(Buffer.isBuffer(signature))
    assert.ok(crypto.verify(null, payload, { key: vector.pub, format: 'der', type: 'spki' }, signature),
      'OpenSSH private serialization retains the original signing identity')
  }
}
console.log('PASS Ed25519 sync/async key generation preserves leading-zero public bytes and Node/OpenSSL signing identity')
