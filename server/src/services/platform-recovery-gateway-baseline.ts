import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { backupRoot, ensure, readJson, validateId } from './platform-backup-core.js'
import type { OnboardingGateway } from './onboarding-ssh.js'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { isIPv4 } from 'node:net'
import ssh2 from 'ssh2'

export interface RecoveryGatewayBaseline {
  version:1; publicKey:string; managementSshPublicKey:string; controlIp:string; network:string
}
export function gatewayBaseline(current: OnboardingGateway): RecoveryGatewayBaseline {
  return {version:1,publicKey:current.publicKey,managementSshPublicKey:current.managementSshPublicKey,
    controlIp:current.controlIp,network:current.network}
}
export function assertGatewayBaseline(value: unknown, current: OnboardingGateway) {
  const baseline=value as RecoveryGatewayBaseline
  ensure(baseline?.version===1 && typeof baseline.publicKey==='string' && /^[A-Za-z0-9+/]{43}=$/.test(baseline.publicKey) &&
    Buffer.from(baseline.publicKey,'base64').toString('base64')===baseline.publicKey &&
    typeof baseline.managementSshPublicKey==='string' && /^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(baseline.managementSshPublicKey) &&
    baseline.managementSshPublicKey.length<=200 && !(ssh2.utils.parseKey(baseline.managementSshPublicKey) instanceof Error) &&
    typeof baseline.controlIp==='string' && typeof baseline.network==='string', 'OSS_RECOVERY_GATEWAY_BASELINE_INVALID',409)
  const network=baseline.network.split('/'),prefix=Number(network[1])
  const number=(ip:string)=>ip.split('.').reduce((sum,part)=>sum*256+Number(part),0)
  ensure(network.length===2 && isIPv4(network[0]) && Number.isInteger(prefix) && prefix>=16 && prefix<=30 &&
    isIPv4(baseline.controlIp) && baseline.controlIp.startsWith('10.') &&
    ((number(baseline.controlIp)&(0xffffffff<<(32-prefix)))>>>0)===number(network[0]) &&
    number(baseline.controlIp)>number(network[0]) && number(baseline.controlIp)<number(network[0])+2**(32-prefix)-1,
    'OSS_RECOVERY_GATEWAY_BASELINE_INVALID',409)
  ensure(['publicKey','managementSshPublicKey','controlIp','network'].every(key=>baseline[key as keyof RecoveryGatewayBaseline]===current[key as keyof OnboardingGateway]),
    'OSS_RECOVERY_GATEWAY_IDENTITY_CHANGED',409)
}
export function localGatewayBaseline(config: string, managementPublicKey: string): RecoveryGatewayBaseline {
  const section=config.split(/(?=^\s*\[Peer\]\s*$)/m)[0]
  const keys=[...section.matchAll(/^\s*PrivateKey\s*=\s*([A-Za-z0-9+/]{43}=)\s*$/gm)]
  const addresses=[...section.matchAll(/^\s*Address\s*=\s*([0-9.]+)\/(\d+)\s*$/gm)]
  ensure(keys.length===1 && addresses.length===1 && isIPv4(addresses[0][1]),'OSS_RECOVERY_GATEWAY_BASELINE_INVALID',409)
  const controlIp=addresses[0][1],prefix=Number(addresses[0][2])
  ensure(prefix>=16 && prefix<=30,'OSS_RECOVERY_GATEWAY_BASELINE_INVALID',409)
  const raw=Buffer.from(keys[0][1],'base64')
  ensure(raw.length===32,'OSS_RECOVERY_GATEWAY_BASELINE_INVALID',409)
  const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b656e04220420','hex'),raw]),format:'der',type:'pkcs8'})
  const publicKey=createPublicKey(privateKey).export({format:'der',type:'spki'}).subarray(-32).toString('base64')
  const network=(controlIp.split('.').reduce((sum,part)=>sum*256+Number(part),0)&(0xffffffff<<(32-prefix)))>>>0
  const networkIp=[24,16,8,0].map(shift=>(network>>>shift)&255).join('.')
  const baseline:RecoveryGatewayBaseline={version:1,publicKey,managementSshPublicKey:managementPublicKey.trim().split(/\s+/).slice(0,2).join(' '),controlIp,network:`${networkIp}/${prefix}`}
  assertGatewayBaseline(baseline,{...baseline,endpoint:'',sshHost:''})
  return baseline
}
export async function backupGatewayBaseline(files: Map<string,string>) {
  const saved=files.has('gateway-baseline.json')?await readJson<RecoveryGatewayBaseline>(files.get('gateway-baseline.json')!,8192):null
  if(saved)assertGatewayBaseline(saved,{...saved,endpoint:'',sshHost:''})
  const derived=files.has('gateway.conf') && files.has('management.pub') ? localGatewayBaseline(
    await readFile(files.get('gateway.conf')!,'utf8'),await readFile(files.get('management.pub')!,'utf8')) : null
  if(saved && derived)assertGatewayBaseline(saved,{...derived,endpoint:'',sshHost:''})
  return saved||derived
}
export async function assertSavedRecoveryGateway(current: OnboardingGateway) {
  const hold=await readJson<{taskId:string;mode?:string;gatewayBaseline?:RecoveryGatewayBaseline}>(join(backupRoot(),'recovery-hold.json'))
  ensure(hold,'OSS_RECOVERY_NOT_HELD',409);validateId(hold.taskId)
  if(hold.mode==='rollback')return // Original local environment was retained, not imported.
  ensure(hold.gatewayBaseline,'OSS_RECOVERY_GATEWAY_BASELINE_MISSING',409)
  assertGatewayBaseline(hold.gatewayBaseline,current)
}
