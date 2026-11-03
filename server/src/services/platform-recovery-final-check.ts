import { ensure } from './platform-backup-core.js'
import { activeRecoveryBatch, recoveryHostSourceHash, RECOVERY_HOST_SOURCE_SQL, type RecoveryQuery } from './platform-recovery-state.js'
import { pgQuery } from './platform-backup-database.js'
import { probeRecoveryHost } from './platform-recovery-review.js'
import { recoveryHostErrorCode, recoveryHostPolicy } from './platform-recovery-policy.js'
import { createHash, randomUUID } from 'node:crypto'

// Keep the backend serving protected progress during remote checks. Persisted
// successes survive a timeout only while their source and 24-hour lifetime
// remain valid. A later failed observation invalidates the previous success.
const finalVerified = `r.status='success' AND r.source_hash=${RECOVERY_HOST_SOURCE_SQL}
  AND EXISTS(SELECT 1 FROM platform_recovery_evidence e WHERE e.batch_id=r.batch_id
    AND e.category='host-final-check' AND e.payload->>'hostId'=h.id::text
    AND e.source_hash=r.source_hash AND e.created_at>NOW()-INTERVAL '24 hours'
    AND e.payload->>'managementVerified'='true' AND e.payload->'inventory'->>'inventoryMatched'='true'
    AND NOT EXISTS(SELECT 1 FROM platform_recovery_evidence f WHERE f.batch_id=e.batch_id
      AND f.category IN ('host-check','host-final-check') AND f.payload->>'hostId'=h.id::text
      AND f.created_at>=e.created_at AND (f.payload->>'managementVerified' IS DISTINCT FROM 'true'
        OR f.payload->'inventory'->>'inventoryMatched' IS DISTINCT FROM 'true'
        OR f.payload->>'code'='OSS_RECOVERY_EVIDENCE_STALE')))`

export async function assertFinalRecoveryHosts(batchId: string, query: RecoveryQuery = pgQuery) {
  ensure((await activeRecoveryBatch(query)).id === batchId, 'OSS_RECOVERY_CONTEXT_CHANGED',409)
  const [row] = await query<{pending:string}>(`SELECT count(*)::text pending FROM hosts h
    LEFT JOIN platform_recovery_hosts r ON r.host_id=h.id AND r.batch_id=$1
    WHERE (${finalVerified}) IS NOT TRUE`,[batchId])
  ensure(row?.pending === '0','OSS_RECOVERY_FINAL_HOST_CHECK_PENDING',409)
}

export async function verifyCurrentRecoveryHosts(batchId: string, query: RecoveryQuery = pgQuery, probe = probeRecoveryHost,
  runtime = { now: Date.now, budgetMs: 120000 }) {
  const batch = await activeRecoveryBatch(query)
  ensure(batch.id === batchId, 'OSS_RECOVERY_CONTEXT_CHANGED',409)
  const deadline = runtime.now() + runtime.budgetMs
  let lastId = 0, failed = 0
  while (true) {
    const rows = await query<{id:number;attempts:number}>(`SELECT h.id,COALESCE(r.attempts,0) attempts FROM hosts h
      LEFT JOIN platform_recovery_hosts r ON r.host_id=h.id AND r.batch_id=$2 WHERE h.id>$1
      AND (${finalVerified}) IS NOT TRUE ORDER BY h.id LIMIT 100`,[lastId,batchId])
    if (!rows.length) break
    let next = 0
    const settled = await Promise.allSettled(Array.from({length:4}, async () => {
      while (next < rows.length) {
        if (runtime.now() >= deadline) return
        const row = rows[next++]
        const before = await recoveryHostSourceHash(row.id,query)
        const result = await probe(row.id).catch(error => ({hostId:row.id,checkedAt:new Date().toISOString(),managementVerified:false,
          inventory:undefined,code:recoveryHostErrorCode(error)}))
        const after = await recoveryHostSourceHash(row.id,query)
        const attempt = Math.min(row.attempts + 1,1000000)
        const policy = recoveryHostPolicy(result,attempt,before !== after)
        if (policy.status !== 'success') failed++
        const receipt = JSON.stringify({...result,...(before !== after ? {code:'OSS_RECOVERY_EVIDENCE_STALE'} : {}),
          automation:{mode:policy.mode,nextAction:policy.nextAction,attempt}})
        // The current result and its history commit together. A failed final
        // gate must retain the same backoff as the normal protected queue.
        const saved = await query(`WITH updated AS (UPDATE platform_recovery_hosts SET status=$3,checked_at=NOW(),source_hash=$4,result=$5::jsonb,
          attempts=$6,lease_token=NULL,lease_until=NULL,next_attempt_at=NOW()+($7 * INTERVAL '1 millisecond')
          WHERE batch_id=$1 AND host_id=$2 RETURNING batch_id)
          INSERT INTO platform_recovery_evidence(id,batch_id,category,reference,evidence_hash,source_hash,observed_at,actor_id,payload)
          SELECT $8::uuid,batch_id,'host-final-check',$9,$10,$4,NOW(),$11,$5::jsonb FROM updated RETURNING id`,
        [batchId,row.id,policy.status,after,receipt,attempt,policy.delayMs,randomUUID(),`host-${row.id}-${randomUUID()}`,
          createHash('sha256').update(receipt).digest('hex'),batch.operator_id])
        ensure(saved.length===1,'OSS_RECOVERY_CONTEXT_CHANGED',409)
      }
    }))
    // Never release ownership while another verification lane is still active.
    const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (rejected) throw rejected.reason
    if (runtime.now() >= deadline) break
    lastId = rows[rows.length-1].id
  }
  ensure((await activeRecoveryBatch(query)).id === batchId, 'OSS_RECOVERY_CONTEXT_CHANGED',409)
  ensure(failed === 0, 'OSS_RECOVERY_FINAL_HOST_CHECK_FAILED',409)
  await assertFinalRecoveryHosts(batchId,query)
}
