import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const routePath = resolve(process.cwd(), 'src/routes/proxy-sites.ts')
const source = readFileSync(routePath, 'utf8')
const caddyClientPath = resolve(process.cwd(), 'src/lib/caddy-client.ts')
const caddyClientSource = readFileSync(caddyClientPath, 'utf8')
const outboundSecurityPath = resolve(process.cwd(), 'src/lib/outbound-security.ts')
const outboundSecuritySource = readFileSync(outboundSecurityPath, 'utf8')
const mutationSource = readFileSync(resolve(process.cwd(), 'src/db/proxy-site-mutations.ts'), 'utf8')
const operationSource = readFileSync(resolve(process.cwd(), 'src/db/proxy-site-operations.ts'), 'utf8')

assert.ok(
  source.includes('function parsePositiveRouteId(value: string): number | null') &&
    source.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    source.includes('Number.isSafeInteger(parsed) && parsed <= 2147483647'),
  'proxy site routes must use a strict positive PostgreSQL Int route ID parser'
)

assert.equal(
  source.match(/const instanceId = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  9,
  'all proxy site instance path IDs must use the strict parser'
)

assert.equal(
  source.match(/const siteId = parsePositiveRouteId\(request\.params\.siteId\)/g)?.length ?? 0,
  7,
  'all proxy site path IDs must use the strict parser'
)

const forbiddenPatterns = [
  'parseInt(request.params.id, 10)',
  'parseInt(request.params.siteId, 10)',
  'isNaN(instanceId)',
  'isNaN(siteId)'
]

for (const pattern of forbiddenPatterns) {
  assert.ok(!source.includes(pattern), `proxy site route ID guard must not use ${pattern}`)
}

assert.equal(source.match(/withProxySiteMutation\(instanceId,/g)?.length, 3,
  'create, DNS and remark writes must share the current instance/actor/credential transaction')
assert.equal(source.match(/prepareProxySiteOperation\(instanceId,/g)?.length, 3,
  'delete, refresh and toggle must prepare durable operations through the shared mutation transaction')
assert.ok(operationSource.includes('return withProxySiteMutation(instanceId, siteId, actor,') &&
  source.includes('retryProxySiteOperation(instanceId, siteId, request.user') &&
  operationSource.includes('async function authorizeOperation') && operationSource.includes('authorizeOperation(tx,'),
  'durable operations and retries must recheck their current authority')
assert.ok(mutationSource.includes('INSTANCE_OPERATION_LOCK_NAMESPACE') &&
  mutationSource.includes('authorizeUserWrite(tx, actor.id, actor, true)') &&
  mutationSource.includes('instance.userId !== actor.id') && mutationSource.includes('instance.provisioningCleanupPending') &&
  mutationSource.includes('instance.deletionBillingPending') && mutationSource.includes('instance.expiresAt <= new Date()') &&
  mutationSource.includes('tx.instanceTask.count({ where: workflow })') &&
  mutationSource.includes('tx.restoreTask.count({ where: workflow })') &&
  mutationSource.includes('tx.backupUploadTask.count({ where: workflow })') &&
  mutationSource.includes("status: { in: ['pending', 'processing'] }"),
  'site writes must serialize with transfer and recheck current owner, active session, expiry, readiness and workflows')
assert.ok(source.includes('site.status === \'pending\' && site.enabled') &&
  operationSource.includes("operation.action === 'delete'") &&
  operationSource.includes("data: { state: blocked ? 'blocked' : 'retry'") && !source.includes('继续删除数据库记录') &&
  source.includes('await tx.proxySite.count({ where: { instanceId } }) >= siteLimit') &&
  source.includes('const result = await mutation()'),
  'disabled sites cannot activate; deletion failures persist and quota/replies use the transaction')
assert.equal(operationSource.match(/ipv4SyncPending: false/g)?.length, 1,
  'only the confirmed durable executor clears pending IPv4 intent')
assert.ok(operationSource.indexOf('await client.reconcileManagedSite') < operationSource.indexOf('ipv4SyncPending: false') &&
  operationSource.includes('appliedRevision: operation.revision') &&
  operationSource.includes("if (operation.action === 'delete') await tx.proxySite.delete"),
  'site removal and applied fields must follow the confirmed remote reconciliation')
assert.ok(source.includes('data: { remark: changes.remark }') &&
  source.includes('if (configChanged)') && source.includes("action: 'upsert', requireEnabled: true, changes"),
  'remark-only edits must preserve pending IPv4 sync intent')
assert.ok(readFileSync(resolve(process.cwd(), 'src/app.ts'), 'utf8').includes("fastify.addHook('onClose', async () => { await closeCaddyClients() })"),
  'Caddy TLS connections must close with the backend')
const hostSource = readFileSync(resolve(process.cwd(), 'src/routes/hosts.ts'), 'utf8')
const credentialSource = readFileSync(resolve(process.cwd(), 'src/db/host-caddy-credentials.ts'), 'utf8')
assert.ok(hostSource.includes('createCaddyScriptToken(prepared.scriptGrant)') && hostSource.includes('loadCaddyScriptCredentials(grant)') &&
  credentialSource.includes('lockCaddyHost(tx, grant.hostId, caddyGrantActor(grant))') &&
  credentialSource.includes('host.userId !== grant.ownerId') && credentialSource.includes('currentRole !== grant.role') &&
  credentialSource.includes('caddyCredentialDigest(host) !== grant.credentials'),
  'Caddy script downloads must recheck issuing session, current role/owner and exact credentials')

const certificateResolution = 'const [certificateAddress] = await resolvePublicHostname(site.domain)'
const certificateConnection = 'host: certificateAddress.address'
assert.ok(
  source.includes("import { resolvePublicHostname } from '../lib/outbound-security.js'") &&
    source.includes(certificateResolution) &&
    source.includes(certificateConnection) &&
    source.includes('servername: site.domain'),
  'certificate lookup must validate DNS through outbound security, pin the TLS host to that IP, and preserve SNI'
)
assert.ok(
  source.indexOf(certificateResolution) < source.indexOf('const socket = tls.connect({'),
  'certificate DNS validation must complete before opening the TLS connection'
)
assert.doesNotMatch(
  source,
  /tls\.connect\(\{[\s\S]*?host:\s*site\.domain/,
  'certificate TLS must not resolve the tenant-controlled hostname again at connect time'
)
assert.ok(
  outboundSecuritySource.includes('export async function resolvePublicHostname') &&
    outboundSecuritySource.includes('for (const record of records)') &&
    outboundSecuritySource.includes('isIpPrivateOrReserved(record.address)') &&
    outboundSecuritySource.includes('return records'),
  'outbound hostname resolution must reject every private or reserved result before returning pinned addresses'
)

assert.ok(
  caddyClientSource.includes('class CaddyApiError extends Error') &&
    caddyClientSource.includes('readonly statusCode: number') &&
    caddyClientSource.includes('throw new CaddyApiError(response.statusCode, errorText)'),
  'Caddy failures must preserve the HTTP status code for exact 404 handling'
)

assert.ok(caddyClientSource.includes("return `site-v2-${Buffer.from(domain.toLowerCase()).toString('base64url')}`") &&
  caddyClientSource.includes('routeMatchesOnlyDomain(legacy, domain)') &&
  caddyClientSource.includes('{ ifMatch: etag }') &&
  caddyClientSource.includes('error.statusCode !== 404') &&
  !caddyClientSource.includes("error.message.includes('404')"),
  'site IDs must preserve domain boundaries; legacy deletion needs exact host and ETag; only HTTP 404 is ignored')

assert.ok(
  caddyClientSource.includes("'GET', '/config/'") &&
    caddyClientSource.includes("'POST', '/config/apps/http', http, { ifMatch: etag, deadline }") &&
    caddyClientSource.includes('error.statusCode !== 412') &&
    caddyClientSource.includes('attempt < 3') &&
    caddyClientSource.includes('routeMatchesOnlyDomain(existing, domain)'),
  'Caddy site updates must preserve the copied config, atomically replace the exact domain and retry bounded ETag conflicts'
)
assert.ok(caddyClientSource.includes('server.automatic_https.skip.push(domain)') &&
  caddyClientSource.includes("...(!httpsEnabled ? { protocol: 'http' } : {})"),
  'HTTP-only sites must disable certificate issuance for that domain in the same atomic update')
assert.ok(caddyClientSource.includes('MAX_CADDY_AGENT_CACHE = 100') &&
  caddyClientSource.includes("createHash('sha256').update(ca).digest('hex')") &&
  caddyClientSource.includes('void oldest.close()') && caddyClientSource.includes('export async function closeCaddyClients()'),
  'Caddy TLS pool must bind actual CA contents, bound cache growth and close retired agents')
assert.ok(!caddyClientSource.includes("this.request('PATCH', '/config/apps/http'") &&
  !caddyClientSource.includes("postErrorMsg.includes('404')"),
  'unversioned parent config replacement and textual 404 handling are forbidden')

assert.doesNotMatch(
  caddyClientSource,
  /rejectUnauthorized\s*:\s*false/,
  'credentialed Caddy management requests must never disable TLS certificate verification'
)

assert.ok(
  caddyClientSource.includes('caPath?: string') &&
    caddyClientSource.includes('process.env.CADDY_CA_PATH') &&
    caddyClientSource.includes('ca = readFileSync(caPath)') &&
    caddyClientSource.includes('ca,') &&
    caddyClientSource.includes("|| 'caddy-admin'") &&
    caddyClientSource.includes('servername: serverName') &&
    caddyClientSource.includes('rejectUnauthorized: true'),
  'Caddy management TLS must verify the server with pinned CA trust material'
)

assert.ok(
  caddyClientSource.includes('Caddy TLS trust material is missing') &&
    caddyClientSource.indexOf('Caddy TLS trust material is missing') <
      caddyClientSource.indexOf('this.agent = new Agent'),
  'Caddy management requests must fail closed before creating a connection without trust material'
)

assert.ok(
  caddyClientSource.includes('const caddyAgentCache = new Map<string, Agent>()') &&
    caddyClientSource.includes('const cachedAgent = caddyAgentCache.get(agentKey)') &&
    caddyClientSource.includes('this.agent = cachedAgent') &&
    caddyClientSource.includes('caddyAgentCache.set(agentKey, this.agent)'),
  'Caddy clients must reuse a module-level TLS Agent for the same host and trust configuration'
)

console.log('proxy site route ID guard tests passed')
