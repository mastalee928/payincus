import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, createServer, type TLSSocket } from 'node:tls'
import { inspectProxySiteCertificate, type ProxySiteCertificateResult } from '../src/lib/proxy-site-certificate.js'

// All certificates, trust and sockets are isolated. Production DNS pinning is
// unchanged; the test only passes live TLS sockets to the shared evaluator.
const root = await mkdtemp(join(tmpdir(), 'payincus-certificate-review-'))
const openssl = process.env.REVIEW_OPENSSL || 'openssl'
const run = (...args: string[]) => execFileSync(openssl, args, { stdio: 'pipe', windowsHide: true, cwd: root })
const path = (name: string) => join(root, name)
const configPath = path('ca.cnf')
const domain = 'cert.fixture.test'
const day = 86_400_000, now = Date.now()
const asnDate = (time: number) => new Date(time).toISOString().slice(0, 19).replace(/[-:T]/g, '') + 'Z'
try {
  run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=Fixture CA',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    '-keyout', 'ca.key', '-out', 'ca.pem')
  run('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${domain}`, '-keyout', 'leaf.key', '-out', 'leaf.csr')
  await writeFile(path('index.txt'), '')
  await writeFile(path('serial'), '01\n')
  const configRoot = root.replaceAll('\\', '/')
  await writeFile(configPath, `[ca]
default_ca = fixture
[fixture]
database = "${configRoot}/index.txt"
serial = "${configRoot}/serial"
new_certs_dir = "${configRoot}"
certificate = "${configRoot}/ca.pem"
private_key = "${configRoot}/ca.key"
default_md = sha256
policy = names
unique_subject = no
x509_extensions = leaf
[names]
commonName = supplied
[leaf]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:${domain}
`)
  for (const [name, start, end] of [
    ['valid', now - day, now + 3 * day],
    ['expired', now - 4 * day, now - 3 * day],
    ['future', now + 3 * day, now + 4 * day]
  ] as const) {
    run('ca', '-batch', '-notext', '-config', configPath, '-in', 'leaf.csr', '-out', `${name}.pem`,
      '-startdate', asnDate(start), '-enddate', asnDate(end))
  }
  run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', `/CN=${domain}`,
    '-addext', `subjectAltName=DNS:${domain}`, '-keyout', 'self.key', '-out', 'self.pem')
  run('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=Fixture Intermediate',
    '-keyout', 'intermediate.key', '-out', 'intermediate.csr')
  await writeFile(path('intermediate.ext'), 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n')
  run('x509', '-req', '-in', 'intermediate.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
    '-days', '3', '-extfile', 'intermediate.ext', '-out', 'intermediate.pem')
  await writeFile(path('leaf.ext'), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${domain}\n`)
  run('x509', '-req', '-in', 'leaf.csr', '-CA', 'intermediate.pem', '-CAkey', 'intermediate.key', '-CAcreateserial',
    '-days', '1', '-extfile', 'leaf.ext', '-out', 'chained.pem')

  const ca = await readFile(path('ca.pem'))
  async function inspect(certFiles: string[], keyFile = 'leaf.key', requestedDomain = domain, trust = true): Promise<ProxySiteCertificateResult> {
    const sockets = new Set<TLSSocket>()
    const server = createServer({ cert: Buffer.concat(await Promise.all(certFiles.map(file => readFile(path(file))))),
      key: await readFile(path(keyFile)) }, socket => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      return await new Promise<ProxySiteCertificateResult>((resolve, reject) => {
        const socket = connect({ host: '127.0.0.1', port: (server.address() as { port: number }).port,
          servername: requestedDomain, rejectUnauthorized: false, timeout: 5000, ...(trust ? { ca } : {}) }, () => {
          try { resolve(inspectProxySiteCertificate(socket, requestedDomain)) } catch (error) { reject(error) } finally { socket.destroy() }
        })
        socket.on('error', error => { socket.destroy(); reject(error) })
        socket.on('timeout', () => { socket.destroy(); reject(new Error('fixture TLS timeout')) })
      })
    } finally {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }
  const valid = await inspect(['valid.pem'])
  assert.equal(valid.status, 'valid')
  assert.equal(valid.certificate.valid, true)
  assert.deepEqual(valid.checks, { validity: true, hostname: true, tlsAuthorization: true })
  assert.equal(valid.error, undefined)
  assert.equal(valid.certificate.subject, domain)
  assert.ok(Number.isFinite(Date.parse(valid.certificate.validFrom)))

  const mismatch = await inspect(['valid.pem'], 'leaf.key', 'other.fixture.test')
  assert.equal(mismatch.status, 'error')
  assert.equal(mismatch.certificate.valid, false)
  assert.equal(mismatch.checks.hostname, false)
  assert.match(mismatch.error!, /ERR_TLS_CERT_ALTNAME_INVALID/)
  assert.match(mismatch.hint!, /域名不匹配/)

  for (const [name, expected] of [['expired', 'CERT_HAS_EXPIRED'], ['future', 'CERT_NOT_YET_VALID']] as const) {
    const result = await inspect([`${name}.pem`])
    assert.equal(result.status, 'error')
    assert.equal(result.certificate.valid, false)
    assert.equal(result.checks.validity, false)
    assert.equal(result.checks.hostname, true)
    assert.match(result.error!, new RegExp(expected))
    if (name === 'expired') assert.ok(result.certificate.daysRemaining < 0)
  }
  const selfSigned = await inspect(['self.pem'], 'self.key', domain, false)
  assert.equal(selfSigned.status, 'error')
  assert.equal(selfSigned.certificate.valid, false)
  assert.deepEqual(selfSigned.checks, { validity: true, hostname: true, tlsAuthorization: false })
  assert.match(selfSigned.error!, /SELF_SIGNED/)
  assert.match(selfSigned.hint!, /信任校验未通过/)

  const incomplete = await inspect(['chained.pem'])
  assert.equal(incomplete.status, 'error')
  assert.equal(incomplete.checks.tlsAuthorization, false)
  assert.match(incomplete.error!, /UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT/)
  const complete = await inspect(['chained.pem', 'intermediate.pem'])
  assert.equal(complete.status, 'valid')
  assert.equal(complete.certificate.valid, true)

  // A chain rejection must not skip the independent domain check.
  const untrustedMismatch = await inspect(['self.pem'], 'self.key', 'other.fixture.test', false)
  assert.equal(untrustedMismatch.checks.hostname, false)
  assert.equal(untrustedMismatch.checks.tlsAuthorization, false)
  assert.match(untrustedMismatch.error!, /ERR_TLS_CERT_ALTNAME_INVALID/)
  assert.match(untrustedMismatch.error!, /SELF_SIGNED/)
  console.log('PASS real TLS certificate diagnostics: trusted match valid; wrong hostname, expired, future, self-signed and missing intermediate invalid; complete chain valid; independent hostname checks after trust failure; existing response fields preserved')
} finally {
  await rm(root, { recursive: true, force: true })
}
