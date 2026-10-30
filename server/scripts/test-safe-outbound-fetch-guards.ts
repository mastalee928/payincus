import assert from 'node:assert/strict'
import dns from 'node:dns'
import { readFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { dirname, resolve } from 'node:path'
import { mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import { OutboundTargetValidationError, revalidatingLookup } from '../src/lib/outbound-security.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf8')
}

const outboundSecuritySource = readSource('../src/lib/outbound-security.ts')
const serverPackageSource = readSource('../package.json')
const rootPackageSource = readSource('../../package.json')
const safeFetchBody = outboundSecuritySource.match(
  /export async function safeFetch\([\s\S]*?\n}\n\nexport async function assertSafeStorageTarget/
)?.[0] ?? ''

assert.ok(safeFetchBody, 'outbound security must export safeFetch')
assert.ok(
  safeFetchBody.includes('await assertSafeHttpUrl(url, label)'),
  'safeFetch must validate the URL before making the request'
)
assert.ok(
  safeFetchBody.includes('dispatcher: safeOutboundDispatcher'),
  'safeFetch must use the connection-time revalidating dispatcher'
)
assert.ok(
  serverPackageSource.includes('"test:safe-outbound-fetch-guards"'),
  'server package must expose the safe outbound fetch guard script'
)
assert.ok(
  rootPackageSource.includes('pnpm --filter server test:safe-outbound-fetch-guards'),
  'root test chain must run the safe outbound fetch guard'
)

for (const [label, relativePath] of [
  ['Epay order query', '../src/lib/epay.ts'],
  ['Heleket API client', '../src/lib/heleket.ts'],
  ['notification webhooks', '../src/lib/notifier.ts'],
  ['Lsky client', '../src/lib/lsky.ts'],
  ['ticket image proxy', '../src/routes/tickets.ts'],
  ['CraneMail client', '../src/services/cranemail.ts'],
  ['SmarterMail client', '../src/services/smartermail.ts'],
  ['system monitor webhook', '../src/services/system-monitor.ts']
] as const) {
  assert.ok(readSource(relativePath).includes('safeFetch('), `${label} must use safeFetch`)
}

// Node's automatic IPv4/IPv6 selection requests all addresses from the connection lookup.
// Returning the single-address callback shape makes fetch fail with ERR_INVALID_IP_ADDRESS.
const publicAddresses: dns.LookupAddress[] = [
  { address: '2606:4700:4700::1111', family: 6 },
  { address: '1.1.1.1', family: 4 }
]
let lookupAddresses = publicAddresses
let lookupError: NodeJS.ErrnoException | null = null
const lookupMock = mock.method(dns, 'lookup', ((
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void
) => {
  assert.equal(hostname, 'outbound-guard.example')
  assert.equal(options.all, true, 'validate every DNS result even for a single-address caller')
  queueMicrotask(() => callback(lookupError, lookupAddresses))
}) as typeof dns.lookup)
syncBuiltinESMExports()

function lookupForConnection(options: dns.LookupOptions) {
  return new Promise<{ address: string | dns.LookupAddress[]; family?: number }>((resolve, reject) => {
    revalidatingLookup('outbound-guard.example', options, (error, address, family) => {
      if (error) reject(error)
      else resolve({ address, family })
    })
  })
}

try {
  assert.deepEqual(await lookupForConnection({ all: true }), { address: publicAddresses, family: undefined })
  for (const options of [{ all: false }, {}]) {
    assert.deepEqual(await lookupForConnection(options), { address: publicAddresses[0].address, family: 6 })
  }
  lookupAddresses = [publicAddresses[1]]
  assert.deepEqual(await lookupForConnection({ all: true }), { address: lookupAddresses, family: undefined })
  assert.deepEqual(await lookupForConnection({ family: 4 }), { address: '1.1.1.1', family: 4 })

  for (const options of [{ all: true }, { all: false }, {}]) {
    for (const privateAddress of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', 'fc00::1',
      '0:0:0:0:0:0:0:1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:a00:1']) {
      lookupAddresses = [...publicAddresses, { address: privateAddress, family: privateAddress.includes(':') ? 6 : 4 }]
      await assert.rejects(() => lookupForConnection(options), OutboundTargetValidationError,
        'a private result must reject the entire connection, including when the first result is public')
    }
    lookupAddresses = []
    await assert.rejects(() => lookupForConnection(options), OutboundTargetValidationError)
    lookupError = Object.assign(new Error('DNS lookup failed'), { code: 'ENOTFOUND' })
    await assert.rejects(() => lookupForConnection(options), error => error === lookupError)
    lookupError = null
  }
} finally {
  lookupMock.mock.restore()
  syncBuiltinESMExports()
}

console.log('safe outbound fetch guard tests passed')
