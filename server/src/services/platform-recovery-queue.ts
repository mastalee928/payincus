import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { ensure, recoveryHeld, serializeBackupMutation } from './platform-backup-core.js'
import { activeBackupTask } from './platform-backup-scheduler.js'
import { activeRecoveryBatch, recoveryHostSourceHash, RECOVERY_HOST_SOURCE_SQL } from './platform-recovery-state.js'
import { probeRecoveryHost } from './platform-recovery-review.js'
import { recoveryHostErrorCode, recoveryHostPolicy } from './platform-recovery-policy.js'
import { runRecoveryGatewayCheck } from './platform-recovery-gateway.js'
import { autoResumeRecovery } from './platform-recovery-auto-resume.js'
import { dispatchRecoveryHelper } from './platform-recovery-helper.js'
import { dispatchRecoveryMapping } from './platform-recovery-mapping-intent.js'
import { reconcileIntactLegacyOrders } from './platform-recovery-legacy-order.js'
import { reconcileIntactCheckoutOrders } from './platform-recovery-orders.js'
import { advanceAutomaticRestore } from './platform-recovery-start.js'

export async function claimRecoveryHost(batchId: string, hostId?: number) {
  const token = randomUUID()
  const rows = await prisma.$queryRaw<Array<{ host_id: number; attempts: number }>>`UPDATE platform_recovery_hosts SET
    status='running', lease_token=${token}::uuid, lease_until=NOW()+INTERVAL '3 minutes',
    attempts=CASE WHEN ${hostId !== undefined} THEN 1 ELSE LEAST(attempts+1,1000000) END
    WHERE (batch_id,host_id) IN (SELECT batch_id,host_id FROM platform_recovery_hosts
      WHERE batch_id=${batchId}::uuid AND (${hostId ?? null}::integer IS NULL OR host_id=${hostId ?? null})
      AND (lease_until IS NULL OR lease_until<NOW()) AND (status<>'blocked' OR ${hostId !== undefined} OR
        result->'automation'->>'nextAction'='observe-original-condition')
      AND (next_attempt_at<=NOW() OR ${hostId !== undefined})
      ORDER BY next_attempt_at,host_id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING host_id,attempts`
  return rows[0] ? { ...rows[0], token } : undefined
}

// This queue only reads remote state. It never starts regular business workers.
export async function seedRecoveryHosts() {
  const batch = await activeRecoveryBatch()
  await prisma.$executeRaw`INSERT INTO platform_recovery_hosts(batch_id,host_id)
    SELECT ${batch.id}::uuid,id FROM hosts ON CONFLICT DO NOTHING`
  await prisma.$executeRawUnsafe(`UPDATE platform_recovery_hosts r SET status='pending',next_attempt_at=NOW(),attempts=0
    FROM hosts h WHERE r.batch_id=$1::uuid AND r.host_id=h.id AND r.status IN ('success','blocked','retry')
    AND r.source_hash IS NOT NULL AND (r.lease_until IS NULL OR r.lease_until<NOW())
    AND r.source_hash IS DISTINCT FROM ${RECOVERY_HOST_SOURCE_SQL}`, batch.id)
  return batch
}
export async function retryBlockedRecoveryHosts(expectedBatchId: string) {
  ensure(!await activeBackupTask(), 'OSS_TASK_BUSY', 409)
  const batch = await activeRecoveryBatch()
  ensure(batch.id === expectedBatchId, 'OSS_RECOVERY_CONTEXT_CHANGED', 409)
  // The background queue keeps its four-worker limit and existing live leases.
  // Results stay visible while a new bounded attempt sequence is queued.
  const count = await prisma.$executeRaw`UPDATE platform_recovery_hosts SET status='pending',attempts=0,next_attempt_at=NOW(),
    lease_token=NULL,lease_until=NULL WHERE batch_id=${batch.id}::uuid AND status IN ('blocked','retry')
    AND (lease_until IS NULL OR lease_until<NOW())`
  return { batchId: batch.id, queued: count }
}
export async function runRecoveryHostCheck(hostId?: number, preparedBatch?: Awaited<ReturnType<typeof seedRecoveryHosts>>, probe = probeRecoveryHost) {
  if (!recoveryHeld() || await activeBackupTask()) return
  const batch = preparedBatch || await seedRecoveryHosts(), row = await claimRecoveryHost(batch.id, hostId)
  if (!row) return
  const { token } = row, sourceHash = await recoveryHostSourceHash(row.host_id)
  const result = await probe(row.host_id).catch(error => ({ hostId: row.host_id, checkedAt: new Date().toISOString(), managementVerified: false, code: recoveryHostErrorCode(error), inventory: undefined, pool: undefined }))
  await (async () => {
    if (!recoveryHeld() || (await activeRecoveryBatch()).id !== batch.id || await activeBackupTask()) return
    const currentHash = await recoveryHostSourceHash(row.host_id)
    const policy = recoveryHostPolicy(result, row.attempts, currentHash !== sourceHash)
    const receipt = JSON.parse(JSON.stringify({ ...result, ...(currentHash !== sourceHash ? { code: 'OSS_RECOVERY_EVIDENCE_STALE' } : {}),
      automation: { mode: policy.mode, nextAction: policy.nextAction, attempt: row.attempts } })) as Prisma.InputJsonValue
    await prisma.$transaction(async tx => {
      const saved = await tx.platformRecoveryHost.updateMany({ where: { batchId: batch.id, hostId: row.host_id, leaseToken: token }, data: {
        status: policy.status, checkedAt: new Date(), sourceHash: currentHash, result: receipt, leaseToken: null, leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + policy.delayMs)
      } })
      if (!saved.count) return // A superseded lease must not append a success receipt either.
      await tx.platformRecoveryEvidence.create({ data: { batchId: batch.id, category: 'host-check', reference: `host-${row.host_id}-${token}`,
        evidenceHash: createHash('sha256').update(JSON.stringify(receipt)).digest('hex'), sourceHash: currentHash, observedAt: new Date(), actorId: batch.operator_id, payload: receipt } })
    })
  })()
  return result
}
let timer: ReturnType<typeof setInterval> | undefined, running = false, nextResumeCheck=0, nextTickAt=0, failures=0
export function startRecoveryReviewWorker() {
  if (timer) return
  const tick = async () => {
    if (running || Date.now()<nextTickAt || !recoveryHeld()) return
    running = true
    try {
      if (await activeBackupTask()) return
      await serializeBackupMutation(()=>advanceAutomaticRestore())
      await dispatchRecoveryMapping()
      if (await activeBackupTask()) return
      await dispatchRecoveryHelper()
      if (await activeBackupTask()) return
      const batch = await seedRecoveryHosts()
      const results = await Promise.allSettled([...([0,1,2,3].map(() => runRecoveryHostCheck(undefined, batch))),runRecoveryGatewayCheck(batch)])
      if (results.some(result => result.status === 'rejected')) throw new Error('RECOVERY_RECEIPT_PENDING')
      if(Date.now()>=nextResumeCheck){
        nextResumeCheck=Date.now()+15000
        await serializeBackupMutation(async()=>{if(!await activeBackupTask()){
          if(batch.hold.restorePolicy!=='snapshot-v1'){
            await reconcileIntactLegacyOrders(batch)
            await reconcileIntactCheckoutOrders(batch)
          }
        }})
        await autoResumeRecovery()
      }
      failures=0
    }
    catch {
      failures=Math.min(failures+1,8);nextTickAt=Date.now()+Math.min(300000,15000*2**(failures-1))
      console.warn('[Recovery] Verification receipt unavailable; protection and leases retained. Queue retry scheduled with backoff.')
    }
    finally { running = false }
  }
  timer = setInterval(() => { void tick() }, 1000); timer.unref(); void tick()
}
export function stopRecoveryReviewWorker() { if (timer) clearInterval(timer); timer = undefined }
