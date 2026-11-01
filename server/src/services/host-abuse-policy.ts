import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { authorizeUserWrite, type WriteActor } from '../db/user-write-authorization.js'

export const ABUSE_CAPABILITY = 'abuse-policy-v1'
export const ABUSE_SPEEDTEST_CAPABILITY = 'abuse-speedtest-v1'
export const ABUSE_POLICY_KEY = 'host_abuse_policy_v1'
const retryPrefix = 'host_abuse_retry_v1_'
const queueErrorPrefix = 'host_abuse_queue_error_v1_'
const queueErrors = new Set(['ABUSE_RETRY_TIMEOUT', 'ABUSE_RETRY_FAILED', 'HOST_NOT_FOUND', 'HOST_AGENT_NOT_INSTALLED',
  'HOST_AGENT_DISABLED', 'HOST_AGENT_UPGRADE_REQUIRED', 'ABUSE_POLICY_CONFLICT', 'ABUSE_REVISION_LIMIT'])
// An Agent can report its own state, not allocate the global revision space.
// Normal backup lag can be reconciled; implausibly large reports stay isolated.
const recoveryRevisionWindow = 10000
const errors = new Set(['DEPENDENCY_MISSING', 'NETWORK_DISCOVERY_FAILED', 'APPLY_FAILED', 'PERSIST_FAILED', 'RESTORE_FAILED', 'UNSUPPORTED_NETWORK', 'INVALID_POLICY'])
export type AbusePolicy = { revision: number; blockBt: boolean; blockMining: boolean; blockSpeedTest: boolean }
export type AbusePolicyInput = Omit<AbusePolicy, 'blockSpeedTest'> & { blockSpeedTest?: boolean }
export type AbuseInstruction = AbusePolicy & { retryNonce: number }
export type AbuseStatus = AbuseInstruction & { applied: boolean; attempts: number; errorCode: string | null; nextRetryAt: string | null; checkedAt: string }
type Reader = Pick<Prisma.TransactionClient, 'systemConfig'>
type AbuseRetryResult = { id: number; success: boolean; code?: string }
const integer = (v: unknown, minimum = 0): v is number => Number.isSafeInteger(v) && Number(v) >= minimum && Number(v) <= 2147483647
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}

export class AbusePolicyError extends Error {
  constructor(readonly statusCode: number, readonly code: string) { super(code) }
}

export async function readAbusePolicy(db: Reader = prisma): Promise<AbusePolicy> {
  const row = await db.systemConfig.findUnique({ where: { key: ABUSE_POLICY_KEY }, select: { value: true } })
  if (!row) return { revision: 0, blockBt: false, blockMining: false, blockSpeedTest: false }
  let value: Record<string, unknown>
  try { value = object(JSON.parse(row.value)) } catch { throw new AbusePolicyError(409, 'ABUSE_POLICY_INVALID') }
  if (!integer(value.revision, 1) || typeof value.blockBt !== 'boolean' || typeof value.blockMining !== 'boolean' ||
    ('blockSpeedTest' in value && typeof value.blockSpeedTest !== 'boolean')) throw new AbusePolicyError(409, 'ABUSE_POLICY_INVALID')
  return { revision: value.revision, blockBt: value.blockBt, blockMining: value.blockMining, blockSpeedTest: value.blockSpeedTest === true }
}

export function normalizeAbuseStatus(input: unknown): AbuseStatus | null {
  const value = object(input)
  if (!integer(value.revision, 1) || !integer(value.retryNonce) || !integer(value.attempts) ||
    typeof value.blockBt !== 'boolean' || typeof value.blockMining !== 'boolean' || typeof value.applied !== 'boolean' ||
    ('blockSpeedTest' in value && typeof value.blockSpeedTest !== 'boolean') ||
    typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt)) || Date.parse(value.checkedAt) > Date.now() + 60000) return null
  return { revision: value.revision, retryNonce: value.retryNonce, blockBt: value.blockBt, blockMining: value.blockMining,
    blockSpeedTest: value.blockSpeedTest === true,
    applied: value.applied, attempts: value.attempts,
    errorCode: value.applied ? null : errors.has(String(value.errorCode)) ? String(value.errorCode) : 'APPLY_FAILED',
    checkedAt: new Date(value.checkedAt).toISOString(),
    nextRetryAt: typeof value.nextRetryAt === 'string' && Number.isFinite(Date.parse(value.nextRetryAt)) ? new Date(value.nextRetryAt).toISOString() : null }
}

export async function abuseInstruction(hostId: number, capabilities?: string[]): Promise<AbuseInstruction | null> {
  const policy = await readAbusePolicy()
  if (!policy.revision) return null
  // Do not send an instruction that an old Agent can only partially enforce.
  if (capabilities && (!capabilities.includes(ABUSE_CAPABILITY) || (policy.blockSpeedTest && !capabilities.includes(ABUSE_SPEEDTEST_CAPABILITY)))) return null
  const row = await prisma.systemConfig.findUnique({ where: { key: retryPrefix + hostId }, select: { value: true } })
  const nonce = Number(row?.value || 0)
  if (!integer(nonce)) throw new AbusePolicyError(409, 'ABUSE_POLICY_INVALID')
  return { ...policy, retryNonce: nonce }
}

async function authorize(tx: Prisma.TransactionClient, actor: WriteActor) {
  if (!await authorizeUserWrite(tx, actor.id, actor) || (await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }))?.role !== 'admin') throw new AbusePolicyError(403, 'FORBIDDEN')
}

function unsupportedAgent(host: { agent: { enabled: boolean; capabilities: unknown } | null } | undefined, policy: AbusePolicy) {
  return !host ? 'HOST_NOT_FOUND' : !host.agent ? 'HOST_AGENT_NOT_INSTALLED' : !host.agent.enabled ? 'HOST_AGENT_DISABLED' :
    !Array.isArray(host.agent.capabilities) || !host.agent.capabilities.includes(ABUSE_CAPABILITY) ||
    (policy.blockSpeedTest && !host.agent.capabilities.includes(ABUSE_SPEEDTEST_CAPABILITY)) ? 'HOST_AGENT_UPGRADE_REQUIRED' : null
}

async function writeQueueErrors(tx: Prisma.TransactionClient, rows: AbuseRetryResult[], revision: number) {
  const failed = rows.filter(row => !row.success && queueErrors.has(row.code || ''))
  if (!failed.length) return
  const at = new Date().toISOString()
  const values = failed.map(row => Prisma.sql`(${queueErrorPrefix + row.id}, ${JSON.stringify({ revision, code: row.code, at })}, 'json', NOW())`)
  await tx.$executeRaw(Prisma.sql`INSERT INTO system_configs (key, value, type, updated_at) VALUES ${Prisma.join(values)}
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`)
}

async function auditQueueAttemptFailure(rows: AbuseRetryResult[], revision: number, actor: WriteActor, forbidden: boolean, diagnosticsFailed = false) {
  await prisma.log.create({ data: { module: 'host', action: 'host.abuse_policy.retry_attempt', result: 'failed',
    content: `Host abuse retry attempt by administrator ${actor.id}; revision=${revision}; ${forbidden ? 'FORBIDDEN; ' : ''}${diagnosticsFailed ? 'diagnostics=ABUSE_RETRY_FAILED; ' : ''}${rows.map(row => `${row.id}:${forbidden ? 'FORBIDDEN' : row.code}`).join(',')}` } })
}

async function recordQueueAttemptFailure(rows: AbuseRetryResult[], revision: number, actor: WriteActor, expectedNonces: Map<number, number>) {
  let forbidden = rows.some(row => row.code === 'FORBIDDEN')
  let diagnosticsFailed = false
  if (!forbidden) {
    try {
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
        await authorize(tx, actor)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('host-abuse-policy-v1'))`
        if ((await readAbusePolicy(tx)).revision !== revision) return
        const nonces = await tx.systemConfig.findMany({ where: { key: { in: rows.map(row => retryPrefix + row.id) } }, select: { key: true, value: true } })
        const current = new Map(nonces.map(row => [Number(row.key.slice(retryPrefix.length)), Number(row.value)]))
        // A concurrent successful retry advances the nonce. Its newer success
        // must not be replaced by this older attempt's timeout or DB failure.
        await writeQueueErrors(tx, rows.filter(row => Object.is(current.get(row.id) ?? 0, expectedNonces.get(row.id) ?? 0)), revision)
      }, { maxWait: 2000, timeout: 10000 })
    } catch (error) {
      if (error instanceof AbusePolicyError && error.code === 'FORBIDDEN') forbidden = true
      else diagnosticsFailed = true
    }
  }
  // Denied attempts write only an audit, never desired policy, nonce or queue
  // status. An anonymous row also survives deletion of the initiating account.
  // A failed diagnostic transaction must not skip the independent audit or
  // discard earlier committed batches. Audit failure itself still propagates.
  await auditQueueAttemptFailure(rows, revision, actor, forbidden, diagnosticsFailed)
  return forbidden
}

export async function saveAbusePolicy(input: AbusePolicyInput, actor: WriteActor) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
    await authorize(tx, actor)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('host-abuse-policy-v1'))`
    const current = await readAbusePolicy(tx)
    if (current.revision !== input.revision) throw new AbusePolicyError(409, 'ABUSE_POLICY_CHANGED')
    // A restored database can lag the durable protections on authenticated Agents.
    // Only an administrator's explicit save supersedes those newer policies.
    const agents = await tx.$queryRaw<Array<{ report: unknown }>>`SELECT last_report->'abusePolicyStatus' AS report FROM host_agents WHERE enabled = true`
    const floor = agents.reduce((maximum, agent) => {
      const reported = normalizeAbuseStatus(agent.report)?.revision || 0
      return reported <= current.revision + recoveryRevisionWindow ? Math.max(maximum, reported) : maximum
    }, current.revision)
    if (floor >= 2147483647) throw new AbusePolicyError(409, 'ABUSE_REVISION_LIMIT')
    // Old open pages may omit the new switch; never let that disable it.
    const policy = { revision: floor + 1, blockBt: input.blockBt, blockMining: input.blockMining, blockSpeedTest: input.blockSpeedTest ?? current.blockSpeedTest }
    const value = JSON.stringify(policy)
    await tx.systemConfig.upsert({ where: { key: ABUSE_POLICY_KEY }, create: { key: ABUSE_POLICY_KEY, value, type: 'json' }, update: { value } })
    await tx.log.create({ data: { userId: actor.id, module: 'host', action: 'host.abuse_policy.update', result: 'success',
      content: `Saved host abuse policy revision ${policy.revision}: BT=${policy.blockBt}, mining=${policy.blockMining}, speedTest=${policy.blockSpeedTest}; awaiting host verification` } })
    return policy
  }, { maxWait: 2000, timeout: 10000 })
}

export async function retryAbuseHosts(ids: number[], revision: number, actor: WriteActor) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
    await authorize(tx, actor)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('host-abuse-policy-v1'))`
    const policy = await readAbusePolicy(tx)
    if (!revision || policy.revision !== revision) throw new AbusePolicyError(409, 'ABUSE_POLICY_CHANGED')
    const rows = await compactHosts(tx, ids)
    const results: AbuseRetryResult[] = []
    for (const id of ids) {
      const host = rows.find(row => row.id === id)
      const unsupported = unsupportedAgent(host, policy)
      if (unsupported) { results.push({ id, success: false, code: unsupported }); continue }
      const key = retryPrefix + id
      const row = await tx.systemConfig.findUnique({ where: { key }, select: { value: true } })
      const report = normalizeAbuseStatus(object(host?.agent?.lastReport).abusePolicyStatus)
      if (report && (report.revision > revision || (report.revision === revision && (report.blockBt !== policy.blockBt || report.blockMining !== policy.blockMining || report.blockSpeedTest !== policy.blockSpeedTest)))) {
        results.push({ id, success: false, code: 'ABUSE_POLICY_CONFLICT' }); continue
      }
      const previous = Math.max(Number(row?.value || 0), report?.revision === revision ? report.retryNonce : 0)
      if (!integer(previous) || previous >= 2147483647) { results.push({ id, success: false, code: 'ABUSE_REVISION_LIMIT' }); continue }
      const value = String(previous + 1)
      await tx.systemConfig.upsert({ where: { key }, create: { key, value, type: 'number' }, update: { value } })
      await tx.systemConfig.deleteMany({ where: { key: queueErrorPrefix + id } })
      results.push({ id, success: true })
    }
    await writeQueueErrors(tx, results, revision)
    await tx.log.create({ data: { userId: actor.id, module: 'host', action: 'host.abuse_policy.retry', result: 'success', content: `Requested host abuse policy retry: ${results.filter(row => row.success).map(row => row.id).join(',')}; revision=${revision}` } })
    return { results }
  }, { maxWait: 2000, timeout: 15000 })
}

async function compactHosts(db: Prisma.TransactionClient | typeof prisma, ids?: number[]) {
  if (ids && !ids.length) return []
  const rows = await db.$queryRaw<Array<{ id: number; name: string; enabled: boolean | null; capabilities: unknown;
    report: unknown; interval: unknown; lastSeenAt: Date | null }>>(Prisma.sql`
    SELECT h.id, h.name, a.enabled, a.capabilities, a.last_report->'abusePolicyStatus' AS report,
      a.last_report->'metrics'->'heartbeatIntervalSeconds' AS interval, a.last_seen_at AS "lastSeenAt"
    FROM hosts h LEFT JOIN host_agents a ON a.host_id = h.id
    ${ids ? Prisma.sql`WHERE h.id IN (${Prisma.join(ids)})` : Prisma.empty} ORDER BY h.id`)
  return rows.map(row => ({ id: row.id, name: row.name, agent: row.enabled === null ? null : {
    enabled: row.enabled, capabilities: row.capabilities, lastSeenAt: row.lastSeenAt,
    lastReport: { abusePolicyStatus: row.report, metrics: { heartbeatIntervalSeconds: row.interval } }
  } }))
}

async function abuseInventory() {
  // A compact inventory permits exact exception counts before paging, as for pool inventory.
  const [policy, hosts, retries, queueFailures] = await Promise.all([
    readAbusePolicy(),
    compactHosts(prisma),
    prisma.systemConfig.findMany({ where: { key: { startsWith: retryPrefix } }, select: { key: true, value: true } }),
    prisma.systemConfig.findMany({ where: { key: { startsWith: queueErrorPrefix } }, select: { key: true, value: true } })
  ])
  const nonces = new Map(retries.map(row => [Number(row.key.slice(retryPrefix.length)), Number(row.value)]))
  const failures = new Map(queueFailures.map(row => {
    let value: Record<string, unknown> = {}
    try { value = object(JSON.parse(row.value)) } catch {}
    return [Number(row.key.slice(queueErrorPrefix.length)), value] as const
  }))
  const rows = hosts.map(host => {
    const report = normalizeAbuseStatus(object(host.agent?.lastReport).abusePolicyStatus)
    const unsupported = unsupportedAgent(host, policy), supported = !unsupported
    const metrics = object(object(host.agent?.lastReport).metrics)
    const interval = typeof metrics.heartbeatIntervalSeconds === 'number' && Number.isFinite(metrics.heartbeatIntervalSeconds) ? Math.min(3600, Math.max(30, metrics.heartbeatIntervalSeconds)) : 60
    const fresh = host.agent?.lastSeenAt && Date.now() - host.agent.lastSeenAt.getTime() < Math.max(180000, interval * 3000)
    const matches = report && report.revision === policy.revision && report.retryNonce === (nonces.get(host.id) || 0) && report.blockBt === policy.blockBt && report.blockMining === policy.blockMining && report.blockSpeedTest === policy.blockSpeedTest
    const checked = report && Date.now() - Date.parse(report.checkedAt) < Math.max(180000, interval * 2000)
    const conflict = report && (report.revision > policy.revision || (supported && report.revision === policy.revision &&
      (report.blockBt !== policy.blockBt || report.blockMining !== policy.blockMining || report.blockSpeedTest !== policy.blockSpeedTest)))
    const state = conflict ? 'conflict' : !policy.revision ? 'unconfigured' : !supported ? 'unsupported' : !fresh ? 'offline' : !matches ? 'pending' : !report.applied ? 'retrying' : checked ? 'applied' : 'pending'
    const failure = failures.get(host.id)
    const queueFailure = failure?.revision === policy.revision && queueErrors.has(String(failure.code)) &&
      typeof failure.at === 'string' && Number.isFinite(Date.parse(failure.at)) ? failure : null
    return { id: host.id, name: host.name, state, lastSeenAt: host.agent?.lastSeenAt?.toISOString() || null,
      errorCode: conflict ? (report.revision > policy.revision + recoveryRevisionWindow ? 'ABUSE_POLICY_UNTRUSTED_REVISION' : 'ABUSE_POLICY_CONFLICT') : state === 'unsupported' ? unsupported : matches ? report.errorCode : null, attempts: matches ? report.attempts : 0,
      queueErrorCode: queueFailure ? String(queueFailure.code) : null, queueErrorAt: queueFailure ? String(queueFailure.at) : null,
      nextRetryAt: matches ? report.nextRetryAt : null, checkedAt: report?.checkedAt || null }
  })
  const summary = { total: rows.length, applied: 0, pending: 0, retrying: 0, offline: 0, unsupported: 0, unconfigured: 0, conflict: 0 }
  for (const row of rows) summary[row.state as keyof Omit<typeof summary, 'total'>]++
  return { policy, rows, summary, nonces }
}

export async function retryAllAbuseHosts(revision: number, actor: WriteActor, now: () => number | Promise<number> = Date.now) {
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
      await authorize(tx, actor)
      if (!revision || (await readAbusePolicy(tx)).revision !== revision) throw new AbusePolicyError(409, 'ABUSE_POLICY_CHANGED')
    }, { maxWait: 2000, timeout: 5000 })
  } catch (error) {
    if (error instanceof AbusePolicyError && error.code === 'FORBIDDEN') await auditQueueAttemptFailure([], revision, actor, true)
    throw error
  }
  const { policy, rows, nonces } = await abuseInventory()
  if (!revision || policy.revision !== revision) throw new AbusePolicyError(409, 'ABUSE_POLICY_CHANGED')
  const ids = rows.filter(row => ['pending', 'retrying', 'offline'].includes(row.state)).map(row => row.id)
  const results: AbuseRetryResult[] = []
  const deadline = await now() + 20000
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100)
    if (await now() >= deadline) {
      const failed = ids.slice(offset).map(id => ({ id, success: false, code: 'ABUSE_RETRY_TIMEOUT' }))
      if (await recordQueueAttemptFailure(failed, revision, actor, nonces)) for (const row of failed) row.code = 'FORBIDDEN'
      results.push(...failed); break
    }
    try { results.push(...(await retryAbuseHosts(batch, revision, actor)).results) }
    catch (error) {
      const failed = ids.slice(offset).map(id => ({ id, success: false, code: error instanceof AbusePolicyError ? error.code : 'ABUSE_RETRY_FAILED' }))
      if (await recordQueueAttemptFailure(failed, revision, actor, nonces)) for (const row of failed) row.code = 'FORBIDDEN'
      results.push(...failed)
      break
    }
  }
  return { results, queued: results.filter(row => row.success).length, failed: results.filter(row => !row.success).length }
}

export async function listAbuseHosts(query: { page?: number; search?: string; state?: string }) {
  const { policy, rows, summary } = await abuseInventory()
  const filtered = rows.filter(row => (!query.search || `${row.id} ${row.name}`.toLowerCase().includes(query.search.toLowerCase())) &&
    (!query.state || query.state === 'all' || (query.state === 'attention' ? row.state !== 'applied' : row.state === query.state)))
  const pages = Math.max(1, Math.ceil(filtered.length / 20)), page = Math.min(query.page || 1, pages)
  return { policy, summary, hosts: filtered.slice((page - 1) * 20, page * 20), total: filtered.length, page, pages }
}
