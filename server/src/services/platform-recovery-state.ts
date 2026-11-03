import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { backupRoot, ensure, readJson, recoveryHeld, validateId } from './platform-backup-core.js'
import { pgQuery, pgRecoveryTransaction } from './platform-backup-database.js'
import { automaticResumeRetry } from './platform-recovery-policy.js'
import { restoredSnapshot } from './platform-recovery-snapshot.js'

export const RECOVERY_CATEGORIES = ['finance', 'access', 'tasks', 'gateway'] as const
export type RecoveryCategory = typeof RECOVERY_CATEGORIES[number]
export type RecoveryQuery = typeof pgQuery
const tables: Record<RecoveryCategory, string[]> = {
  finance: ['users', 'instances', 'instance_transfers', 'user_destroy_records', 'balance_logs', 'recharge_records', 'instance_billing_records', 'pool_orders', 'checkout_orders', 'checkout_payments', 'checkout_receipts', 'checkout_refunds'],
  access: ['users', 'public_api_tokens', 'oauth_access_tokens', 'oauth_refresh_tokens'],
  tasks: ['instance_tasks', 'instance_transfers', 'user_destroy_records', 'host_onboarding_nodes', 'management_gateway_tasks', 'checkout_orders', 'checkout_refunds', 'pool_orders', 'instances', 'instance_billing_records', 'balance_logs'],
  gateway: ['management_gateways', 'host_onboarding_nodes', 'system_configs']
}
export async function activeRecoveryBatch(query: RecoveryQuery = pgQuery) {
  ensure(recoveryHeld(), 'OSS_RECOVERY_NOT_HELD', 409)
  const hold = await readJson<{ taskId: string; batchId?: string; mode?: string; createdAt: string; restorePolicy?: 'snapshot-v1'; snapshot?:{createdAt:string} }>(join(backupRoot(), 'recovery-hold.json'))
  ensure(hold?.batchId, 'OSS_RECOVERY_BATCH_REQUIRED', 409); validateId(hold.batchId)
  const [batch] = await query<{ id: string; hold_task_id: string; mode: string; operator_id: number; revision: number; completed_at: Date | null }>(
    'SELECT * FROM platform_recovery_batches WHERE id=$1', [hold.batchId])
  ensure(batch && !batch.completed_at && batch.hold_task_id === hold.taskId && batch.mode === (hold.mode || 'restore'), 'OSS_RECOVERY_CONTEXT_CHANGED', 409)
  return { ...batch, hold }
}
export async function recoveryDatasetHash(category: RecoveryCategory, query: RecoveryQuery = pgQuery) {
  ensure(RECOVERY_CATEGORIES.includes(category), 'OSS_REVIEW_QUERY_INVALID')
  const hashes: unknown[] = []
  for (const table of tables[category]) {
    // Table names are a fixed allowlist. Only digests leave the database.
    // Sort hashes, not row IDs: all supported tables have different PK shapes.
    const projection = table === 'users'
      ? category === 'access' ? "jsonb_build_array(t.id,t.username,t.role,t.status,t.password_hash,t.two_factor_enabled,t.two_factor_secret)"
        : 'jsonb_build_array(t.id,t.username,t.balance)'
      : "to_jsonb(t)-'updated_at'-'last_seen_at'"
    const [row] = await query<{ hash: string; count: string }>(`SELECT count(*)::text AS count,
      md5(COALESCE(string_agg(h, '' ORDER BY h),'')) AS hash FROM
      (SELECT md5((${projection})::text) AS h FROM "${table}" t${category === 'gateway' && table === 'system_configs' ? " WHERE key LIKE 'management_gateway_%' OR key='onboarding_gateway_dns_endpoint'" : ''}) rows`)
    hashes.push([table, row])
  }
  if (category === 'gateway') hashes.push(['mapping', process.env.GATEWAY_PLATFORM_ID, process.env.ONBOARDING_GATEWAY_HOST,
    process.env.ONBOARDING_GATEWAY_PORT, process.env.ONBOARDING_GATEWAY_FINGERPRINT, process.env.ONBOARDING_WG_ENDPOINT])
  return createHash('sha256').update(JSON.stringify(hashes)).digest('hex')
}
// Shared by queue invalidation and gates; correlated to the outer hosts h row.
export const RECOVERY_HOST_SOURCE_SQL = `md5(jsonb_build_object(
    'host',to_jsonb(h)-'updated_at'-'status'-'pool_faulted'-'cpu_used'-'memory_used'-'disk_used'-'nat_ports_used_count',
    'instances',(SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM instances i WHERE host_id=h.id),
    'node',(SELECT COALESCE(jsonb_agg(to_jsonb(n)-'updated_at' ORDER BY id),'[]') FROM host_onboarding_nodes n WHERE host_id=h.id),
    'tasks',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM instance_tasks t WHERE host_id=h.id OR target_host_id=h.id),
    'ports',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM port_mappings p JOIN instances i ON i.id=p.instance_id WHERE i.host_id=h.id),
    'addresses',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM ip_addresses a WHERE a.host_id=h.id),
    'publicIpv4',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public_ipv4_addresses a WHERE a.host_id=h.id),
    'ipv6Subnets',(SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM ipv6_subnets s JOIN instances i ON i.id=s.instance_id WHERE i.host_id=h.id),
    'packages',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM packages p WHERE p.id IN (SELECT package_id FROM instances WHERE host_id=h.id)),
    'plans',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM package_plans p WHERE p.id IN (SELECT package_plan_id FROM instances WHERE host_id=h.id)),
    'storage',(SELECT COALESCE(jsonb_agg(to_jsonb(s)-'updated_at' ORDER BY s.id),'[]') FROM storage_pools s WHERE s.host_id=h.id)
    )::text)`
export async function recoveryHostSourceHash(hostId: number, query: RecoveryQuery = pgQuery) {
  const [row] = await query<{ hash: string }>(`SELECT ${RECOVERY_HOST_SOURCE_SQL} AS hash FROM hosts h WHERE id=$1`, [hostId])
  ensure(row, 'OSS_REVIEW_HOST_MISSING', 409)
  return row.hash
}
// Completed order facts do not depend on a wallet's latest balance or unrelated
// transactions. Otherwise reconciling order B invalidates order A indefinitely.
// Correlated to pool_orders p; private fields are hashed inside PostgreSQL.
export const RECOVERY_LEGACY_SOURCE_SQL = `md5(jsonb_build_object(
  'order',to_jsonb(p),
  'instances',(SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]') FROM instances i WHERE i.purchase_batch_id=p.id),
  'bills',(SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]') FROM instance_billing_records b WHERE b.purchase_batch_id=p.id OR b.instance_id IN (SELECT id FROM instances WHERE purchase_batch_id=p.id)),
  'transfers',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM instance_transfers t WHERE t.instance_id IN (SELECT id FROM instances WHERE purchase_batch_id=p.id)),
  'identityTasks',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM instance_tasks t WHERE t.task_type IN ('replace_host','change_host','rebuild','recreate') AND t.instance_id IN (SELECT id FROM instances WHERE purchase_batch_id=p.id)),
  'destroyRecords',(SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') FROM user_destroy_records d WHERE d.instance_id IN (SELECT id FROM instances WHERE purchase_batch_id=p.id)),
  'refunds',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM checkout_refunds r WHERE r.billing_record_id IN (SELECT id FROM instance_billing_records WHERE instance_id IN (SELECT id FROM instances WHERE purchase_batch_id=p.id))),
  'logs',(SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM balance_logs l WHERE l.order_id=p.id OR l.id IN (SELECT b.balance_log_id FROM instance_billing_records b WHERE b.purchase_batch_id=p.id OR b.instance_id IN (SELECT id FROM instances WHERE purchase_batch_id=p.id)))
  )::text)`
export const RECOVERY_LEGACY_RESOLVED_SQL = `EXISTS(SELECT 1 FROM platform_recovery_evidence e WHERE e.batch_id=$1::uuid
  AND e.category='legacy-order-resolution' AND e.reference=p.id AND e.payload->>'factHash'=${RECOVERY_LEGACY_SOURCE_SQL}
  AND e.payload->>'status' IN ('completed','partial','refunded'))`
// Automatic checkout retries depend on this order's evidence, not the owner's
// latest wallet balance. Unrelated settlements must not reset a blocked attempt.
export const RECOVERY_CHECKOUT_SOURCE_SQL = `md5(jsonb_build_object(
  'order',to_jsonb(c)-'updated_at',
  'instances',(SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]') FROM instances i WHERE i.purchase_batch_id=c.id),
  'bills',(SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]') FROM instance_billing_records b WHERE b.purchase_batch_id=c.id OR b.instance_id IN (SELECT id FROM instances WHERE purchase_batch_id=c.id)),
  'transfers',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM instance_transfers t WHERE t.instance_id IN (SELECT id FROM instances WHERE purchase_batch_id=c.id)),
  'identityTasks',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM instance_tasks t WHERE t.task_type IN ('replace_host','change_host','rebuild','recreate') AND t.instance_id IN (SELECT id FROM instances WHERE purchase_batch_id=c.id)),
  'destroyRecords',(SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') FROM user_destroy_records d WHERE d.instance_id IN (SELECT id FROM instances WHERE purchase_batch_id=c.id)),
  'payments',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM checkout_payments p WHERE p.order_id=c.id),
  'receipts',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM checkout_receipts r JOIN checkout_payments p ON p.id=r.payment_id WHERE p.order_id=c.id),
  'refunds',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM checkout_refunds r WHERE r.order_id=c.id OR r.billing_record_id IN (SELECT id FROM instance_billing_records WHERE instance_id IN (SELECT id FROM instances WHERE purchase_batch_id=c.id))),
  'sharedBillingLinks',(SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]') FROM instance_billing_records b WHERE b.balance_log_id IN (SELECT balance_log_id FROM instance_billing_records WHERE instance_id IN (SELECT id FROM instances WHERE purchase_batch_id=c.id))),
  'logs',(SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM balance_logs l WHERE l.order_id=c.id OR l.id IN (SELECT b.balance_log_id FROM instance_billing_records b WHERE b.purchase_batch_id=c.id OR b.instance_id IN (SELECT id FROM instances WHERE purchase_batch_id=c.id)))
  )::text)`
export async function unresolvedLegacyRecoveryOrders(batchId:string,query:RecoveryQuery=pgQuery) {
  const [row]=await query<{count:string}>(`SELECT count(*)::text count FROM pool_orders p
    WHERE NOT EXISTS(SELECT 1 FROM checkout_orders c WHERE c.id=p.id) AND NOT ${RECOVERY_LEGACY_RESOLVED_SQL}`,[batchId])
  return Number(row.count)
}
export function validateRecoveryEvidence(input: { reference: string; observedAt: string; evidenceHash: string; sourceHash: string }) {
  ensure(input && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{5,119}$/.test(input.reference) && /^[a-f0-9]{64}$/.test(input.evidenceHash) &&
    /^[a-f0-9]{64}$/.test(input.sourceHash) && Number.isFinite(Date.parse(input.observedAt)) &&
    Date.parse(input.observedAt) <= Date.now() && Date.parse(input.observedAt) > 0, 'OSS_RECOVERY_EVIDENCE_INVALID')
}
export async function recoveryReadiness(query: RecoveryQuery = pgQuery) {
  return query===pgQuery ? pgRecoveryTransaction(readRecoveryReadiness) : readRecoveryReadiness(query)
}
async function readRecoveryReadiness(query: RecoveryQuery) {
  const batch = await activeRecoveryBatch(query)
  const [hosts] = await query<{ total: string; passed: string; pending: string }>(`SELECT count(*)::text total,
    count(*) FILTER (WHERE r.status='success' AND r.checked_at > NOW()-INTERVAL '24 hours' AND r.source_hash=${RECOVERY_HOST_SOURCE_SQL})::text passed,
    count(*) FILTER (WHERE r.status IS NULL OR r.status<>'success' OR r.checked_at IS NULL OR r.checked_at <= NOW()-INTERVAL '24 hours' OR r.source_hash IS DISTINCT FROM ${RECOVERY_HOST_SOURCE_SQL})::text pending
    FROM hosts h LEFT JOIN platform_recovery_hosts r ON r.host_id=h.id AND r.batch_id=$1`, [batch.id])
  const categories = []
  const snapshotMode=batch.mode==='restore' && batch.hold.restorePolicy==='snapshot-v1'
  let snapshot:Awaited<ReturnType<typeof restoredSnapshot>>|undefined,snapshotCode:string|undefined
  if(snapshotMode){
    try{snapshot=await restoredSnapshot(batch.id,batch.hold.snapshot?.createdAt||'',query)}
    catch(error){snapshotCode=String((error as {code?:string}).code||'OSS_RECOVERY_SNAPSHOT_RECEIPT_MISSING')}
  }
  const legacyPending=snapshotMode?0:await unresolvedLegacyRecoveryOrders(batch.id,query)
  const [checkoutCount]=snapshotMode?[{count:'0'}]:await query<{count:string}>("SELECT count(*)::text count FROM checkout_orders WHERE status='recovery_review'")
  const checkoutPending=Number(checkoutCount.count)
  const checkoutOrders=snapshotMode?[]:await query<{id:string;code:string|null;status:string|null;nextAt:string|null;checkedAt:Date|null}>(`SELECT c.id,a.payload->>'code' code,
    a.payload->>'status' status,a.payload->>'nextAt' AS "nextAt",a.observed_at AS "checkedAt"
    FROM checkout_orders c LEFT JOIN platform_recovery_evidence a ON a.batch_id=$1::uuid AND a.category='checkout-order-auto' AND a.reference=c.id
    WHERE c.status='recovery_review' ORDER BY c.id LIMIT 20`,[batch.id])
  const legacyOrders=snapshotMode?[]:await query<{id:string;code:string|null;nextAt:string|null}>(`SELECT p.id,a.payload->>'code' code,a.payload->>'nextAt' AS "nextAt"
    FROM pool_orders p LEFT JOIN platform_recovery_evidence a ON a.batch_id=$1::uuid AND a.category='legacy-order-auto' AND a.reference=p.id
    WHERE NOT EXISTS(SELECT 1 FROM checkout_orders c WHERE c.id=p.id) AND NOT ${RECOVERY_LEGACY_RESOLVED_SQL}
    ORDER BY p.id LIMIT 20`,[batch.id])
  for (const category of RECOVERY_CATEGORIES) {
    const sourceHash = await recoveryDatasetHash(category, query)
    if(snapshotMode && category!=='gateway'){
      const verified=!!snapshot && snapshot.hashes[category]===sourceHash
      categories.push({category,sourceHash,verified,code:verified?null:snapshotCode||'OSS_RECOVERY_SNAPSHOT_CHANGED',basis:'snapshot' as const})
      continue
    }
    const rows = await query<{ id: string }>(`SELECT id FROM platform_recovery_evidence e WHERE batch_id=$1 AND category=$2 AND source_hash=$3
      AND observed_at >= $4::timestamptz AND created_at > NOW()-INTERVAL '24 hours'
      AND ($2<>'gateway' OR NOT EXISTS(SELECT 1 FROM platform_recovery_evidence failure WHERE failure.batch_id=e.batch_id
        AND failure.category='gateway-check' AND failure.payload->>'status'<>'success' AND failure.created_at>=e.created_at))
      AND ($2<>'gateway' OR NOT EXISTS(SELECT 1 FROM
        (SELECT payload FROM platform_recovery_evidence WHERE batch_id=$1 AND category='gateway-map-intent'
          ORDER BY created_at DESC,id DESC LIMIT 1) mapping WHERE mapping.payload->>'status' IS DISTINCT FROM 'verified'))
      LIMIT 1`, [batch.id, category, sourceHash, batch.hold.createdAt])
    const verified=rows.length === 1 && (category!=='tasks'||legacyPending===0&&checkoutPending===0)
    // A missing final reconciliation receipt is not an active computation.
    // Report the exact remaining material instead of an endless generic spinner.
    const code=verified?null:category==='finance'?'OSS_RECOVERY_FINANCE_COVERAGE_MISSING':
      category==='access'?'OSS_RECOVERY_ACCESS_COVERAGE_MISSING':category==='tasks'?
        legacyPending || checkoutPending?'OSS_RECOVERY_ORDERS_UNREVIEWED':'OSS_RECOVERY_TASK_COVERAGE_MISSING':null
    categories.push({ category, sourceHash, verified,code })
  }
  const automation=await query<{category:string;payload:{status:string;code?:string;attempt:number;nextAt:string};created_at:Date}>(`SELECT DISTINCT ON(category) category,payload,created_at
    FROM platform_recovery_evidence WHERE batch_id=$1 AND category IN ('gateway-check','auto-resume') ORDER BY category,created_at DESC,id DESC`,[batch.id])
  const progress=automation.map(row=>({category:row.category,status:row.category==='auto-resume' && row.payload.code?
      automaticResumeRetry(row.payload.code,row.payload.attempt).status:row.payload.status,
    code:typeof row.payload.code==='string' && /^[A-Z0-9_]{1,100}$/.test(row.payload.code)?row.payload.code:null,
    attempt:row.payload.attempt,nextAt:row.payload.nextAt,checkedAt:row.created_at}))
  const routeRows=await query<{reference:string;payload:{hostId:number;status:string;code:string|null;attempt:number;nextAt:string;nextAction:string};observed_at:Date}>(`SELECT reference,payload,observed_at
    FROM platform_recovery_evidence WHERE batch_id=$1 AND category='gateway-route'
    ORDER BY (payload->>'status'='success'),observed_at DESC,reference LIMIT 20`,[batch.id])
  const routeProgress=routeRows.map(row=>({category:'gateway-route',reference:row.reference,hostId:row.payload.hostId,
    status:row.payload.status,code:row.payload.code,attempt:row.payload.attempt,nextAt:row.payload.nextAt,checkedAt:row.observed_at,nextAction:row.payload.nextAction}))
  const [deliveryCount]=snapshotMode?await query<{count:string}>("SELECT count(*)::text count FROM instances WHERE status='creating'"):[{count:'0'}]
  const deliveryOrders=snapshotMode?await query<{instanceId:number;hostId:number;name:string;step:string|null;status:string|null;code:string|null;nextAt:string|null}>(`SELECT
    i.id AS "instanceId",i.host_id AS "hostId",i.name,e.payload->>'step' step,e.payload->>'status' status,
    e.payload->>'code' code,e.payload->>'nextAt' AS "nextAt" FROM instances i LEFT JOIN platform_recovery_evidence e
    ON e.batch_id=$1 AND e.category='snapshot-delivery-check' AND e.reference='instance-'||i.id::text
    WHERE i.status='creating' ORDER BY i.id LIMIT 20`,[batch.id]):[]
  return { batchId: batch.id, revision: batch.revision, mode: batch.mode, hosts, categories,
    deliveryPending:Number(deliveryCount.count),deliveryOrders,
    legacyPending:snapshotMode?0:legacyPending,legacyOrders:snapshotMode?[]:legacyOrders,
    checkoutPending:snapshotMode?0:checkoutPending,checkoutOrders:snapshotMode?[]:checkoutOrders,automation:[...progress,...routeProgress],
    ready: hosts.pending === '0' && categories.every(row => row.verified) }
}
export async function assertRecoveryReady(expectedBatchId?: string, query: RecoveryQuery = pgQuery) {
  const ready = await recoveryReadiness(query)
  ensure(expectedBatchId && ready.batchId === expectedBatchId && ready.ready, 'OSS_RECOVERY_RECONCILIATION_REQUIRED', 409)
  const [admins] = await query<{ count: string }>(`SELECT count(*)::text count FROM users WHERE role='admin' AND status='active' AND id<>(SELECT operator_id FROM platform_recovery_batches WHERE id=$1)`, [ready.batchId])
  const batch = await activeRecoveryBatch(query)
  ensure(batch.mode === 'rollback' || admins.count !== '0', 'OSS_RECOVERY_ADMIN_REQUIRED', 409)
  return ready
}
