import { createHash, randomUUID } from 'node:crypto'
import { ensure } from './platform-backup-core.js'
import { gatewayCommand, type OnboardingGateway } from './onboarding-ssh.js'
import { activeRecoveryBatch, recoveryDatasetHash, type RecoveryQuery } from './platform-recovery-state.js'
import { pgQuery } from './platform-backup-database.js'
import { stableGatewayEndpointText } from '../lib/onboarding-gateway-endpoint.js'
import { readGatewayEndpointPlan } from './onboarding-gateway-endpoint.js'
import { assertSavedRecoveryGateway } from './platform-recovery-gateway-baseline.js'
import { recoveryHostErrorCode, recoveryHostPolicy } from './platform-recovery-policy.js'

export function recoveryGatewayIdentity(current: OnboardingGateway) {
  const state=current.recovery
  ensure(state && state.version===1 && Math.abs(Date.now()-state.observedAt)<60000,'OSS_RECOVERY_GATEWAY_STATE_REQUIRED',409)
  return {publicKey:current.publicKey,controlIp:current.controlIp,network:current.network,
    endpoint:current.endpoint,sshHost:current.sshHost,managementSshPublicKey:current.managementSshPublicKey,
    peers:state.peers,stateHash:state.stateHash,...(state.configHash?{configHash:state.configHash}:{}),...(state.runtimeHash?{runtimeHash:state.runtimeHash}:{})}
}
export async function assertCurrentRecoveryGateway(query: RecoveryQuery=pgQuery) {
  const batch=await activeRecoveryBatch(query), hash=await recoveryDatasetHash('gateway',query)
  try {
  const [review]=await query<{evidence_hash:string}>(`SELECT evidence_hash FROM platform_recovery_evidence
    WHERE batch_id=$1 AND category='gateway' AND source_hash=$2 ORDER BY created_at DESC LIMIT 1`,[batch.id,hash])
  ensure(review,'OSS_RECOVERY_GATEWAY_STATE_REQUIRED',409)
  const [config]=await query<{value:string}>("SELECT value FROM system_configs WHERE key='onboarding_gateway_dns_endpoint'")
  const endpoint=config ? stableGatewayEndpointText(readGatewayEndpointPlan(config.value)) : process.env.ONBOARDING_WG_ENDPOINT || ''
  const current=await gatewayCommand('recovery-state',endpoint)
  await assertSavedRecoveryGateway(current)
  const currentHash=createHash('sha256').update(JSON.stringify(recoveryGatewayIdentity(current))).digest('hex')
  ensure(currentHash===review.evidence_hash,'OSS_RECOVERY_GATEWAY_CHANGED',409)
  } catch(error) {
    const code=recoveryHostErrorCode(error),policy=recoveryHostPolicy({managementVerified:false,code},1)
    const payload=JSON.stringify({status:policy.status,code,attempt:1,nextAction:policy.nextAction,
      nextAt:new Date(Date.now()+policy.delayMs).toISOString()})
    await query(`INSERT INTO platform_recovery_evidence(id,batch_id,category,reference,evidence_hash,source_hash,observed_at,actor_id,payload)
      VALUES($1,$2,'gateway-check',$3,$4,$5,NOW(),$6,$7::jsonb)`,[randomUUID(),batch.id,`final-${randomUUID()}`,
      createHash('sha256').update(payload).digest('hex'),hash,batch.operator_id,payload])
    throw error
  }
}
