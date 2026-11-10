import { readFile } from 'node:fs/promises'
import { connectOnboardingSsh, gatewayConfigured, sshExec } from './onboarding-ssh.js'
import type { HostSecurityTarget } from './host-security-inspection.js'
import type { HostMaintenanceIntent } from '../lib/host-maintenance-plan.js'

export type MaintenanceOperation = Pick<HostMaintenanceIntent,'requestId'|'identityHash'|'bootId'|'prepareHash'|'recipe'|'architecture'> &
  {action:'prepare'|'status'|'reboot'|'rollback'|'restore-customers';customers?:HostMaintenanceIntent['customers'];deadline?:string}
export type MaintenanceReceipt = {nodeId:string;requestId:string;identityHash:string;prepareHash:string;originalBootId:string;
  bootId:string;architecture:string;recipe:string;phase:'absent'|'prepared'|'preparing'|'reboot-intent'|'customers-restored'|'rolled-back'}
export function maintenanceWireExpiry(operation:MaintenanceOperation,now=Date.now()):number {
  const expiresAt=now+59000
  if(!['prepare','reboot'].includes(operation.action))return expiresAt
  const deadline=Date.parse(operation.deadline||'')
  if(!Number.isFinite(deadline)||deadline<=now)throw Error('HARDENING_REQUEST_EXPIRED')
  return Math.min(expiresAt,deadline)
}
/** Select the wire protocol explicitly: callers may hold a larger durable
 * intent, but neither customer baselines nor database phases leave the server. */
export function maintenanceWireOperation(operation:MaintenanceOperation,nodeId:string,expiresAt:number) {
  return {action:operation.action,nodeId,requestId:operation.requestId,identityHash:operation.identityHash,
    bootId:operation.bootId,prepareHash:operation.prepareHash,recipe:operation.recipe,
    architecture:operation.architecture,expiresAt,customers:(operation.customers||[]).map(customer=>({
      name:customer.incusId,uuid:customer.uuid,attempt:customer.attempt,state:customer.state,autostart:customer.boot?.autostart??null}))}
}
export async function hostMaintenanceCommand(target:HostSecurityTarget,operation:MaintenanceOperation):Promise<MaintenanceReceipt> {
  const node=target.onboardingNode
  if(!gatewayConfigured()||!node?.managementIp||!node.nodePublicKey||!node.sshFingerprint||target.managementSshHost!==node.managementIp||
    target.managementSshPort!==node.sshPort||target.managementSshUser!=='root')throw Error('HARDENING_IDENTITY_MISSING')
  const key=await readFile(process.env.ONBOARDING_GATEWAY_KEY_PATH!)
  const client=await connectOnboardingSsh({host:process.env.ONBOARDING_GATEWAY_HOST!,port:Number(process.env.ONBOARDING_GATEWAY_PORT||22),privateKey:key},
    async fingerprint=>fingerprint===process.env.ONBOARDING_GATEWAY_FINGERPRINT)
  try{
    const input={managementIp:node.managementIp,sshPort:node.sshPort,sshFingerprint:node.sshFingerprint,nodePublicKey:node.nodePublicKey,
      operation:maintenanceWireOperation(operation,node.id,maintenanceWireExpiry(operation))}
    const receipt=JSON.parse(await sshExec(client,`security-maintenance ${node.id}`,JSON.stringify(input),60000,8192))
    if(!receipt||Object.keys(receipt).sort().join(',')!=='architecture,bootId,identityHash,nodeId,originalBootId,phase,prepareHash,recipe,requestId'||
      receipt.nodeId!==node.id||receipt.requestId!==operation.requestId||receipt.identityHash!==operation.identityHash||
      receipt.originalBootId!==operation.bootId||receipt.architecture!==operation.architecture||receipt.recipe!==operation.recipe||
      !/^[a-f0-9]{64}$/.test(receipt.prepareHash)||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(receipt.bootId)||
      !['absent','prepared','preparing','reboot-intent','customers-restored','rolled-back'].includes(receipt.phase)||
      receipt.phase==='absent'&&(operation.action!=='status'||operation.prepareHash!=='0'.repeat(64)||receipt.prepareHash!=='0'.repeat(64))||
      operation.action!=='prepare'&&!(operation.action==='status'&&operation.prepareHash==='0'.repeat(64))&&receipt.prepareHash!==operation.prepareHash)throw Error('HARDENING_REMOTE_RESULT_UNKNOWN')
    return receipt
  }finally{client.destroy()}
}
