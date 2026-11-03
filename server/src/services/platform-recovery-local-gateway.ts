import { readFile, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isIPv4 } from 'node:net'
import { parse as parseEnv } from 'dotenv'
import ssh2 from 'ssh2'
import { ensure } from './platform-backup-core.js'
import { normalizeOnboardingAddress } from '../lib/host-onboarding.js'

const exec=promisify(execFile)
export interface LocalRecoveryGateway { hostname:string; port:number; fingerprint:string }
export function localRecoveryGateway(current:string, archived:string, hostKey:string, sshConfiguration:string, savedEndpoint?:string):LocalRecoveryGateway {
  const target=parseEnv(current),old=parseEnv(archived)
  ensure(!target.ONBOARDING_GATEWAY_HOST || ['127.0.0.1','localhost','::1'].includes(target.ONBOARDING_GATEWAY_HOST),'OSS_GATEWAY_MAPPING_REQUIRED',409)
  // A local backup may retain the original stable DNS name. Never substitute
  // B's public IP or infer a hostname from the browser's unrelated admin URL.
  const endpoint=savedEndpoint || old.ONBOARDING_WG_ENDPOINT || target.ONBOARDING_WG_ENDPOINT || ''
  const match=/^([^:]+):([0-9]{1,5})$/.exec(endpoint)
  ensure(match && +match[2]>0 && +match[2]<=65535,'OSS_RECOVERY_GATEWAY_DOMAIN_MISSING',409)
  let hostname:string
  try {hostname=normalizeOnboardingAddress(match[1])}catch{ensure(false,'OSS_RECOVERY_GATEWAY_DOMAIN_MISSING',409)}
  ensure(!isIPv4(hostname!) && !['localhost','localhost.localdomain'].includes(hostname!),'OSS_RECOVERY_GATEWAY_DOMAIN_MISSING',409)
  const ports=[...sshConfiguration.matchAll(/^port (\d+)\s*$/gm)].map(row=>Number(row[1]))
  ensure(ports.length===1 && Number.isInteger(ports[0]) && ports[0]>0 && ports[0]<=65535,'OSS_RECOVERY_LOCAL_SSH_AMBIGUOUS',409)
  ensure(/^hostkey \/etc\/ssh\/ssh_host_ed25519_key\s*$/m.test(sshConfiguration),'OSS_RECOVERY_LOCAL_SSH_IDENTITY_MISSING',409)
  const key=ssh2.utils.parseKey(hostKey)
  ensure(!(key instanceof Error) && !Array.isArray(key) && key.type==='ssh-ed25519','OSS_RECOVERY_LOCAL_SSH_IDENTITY_MISSING',409)
  const fingerprint='SHA256:'+createHash('sha256').update(key.getPublicSSH()).digest('base64').replace(/=+$/,'')
  return {hostname:hostname!,port:ports[0],fingerprint}
}
export async function discoverLocalRecoveryGateway(current:string,archived:string,savedEndpoint?:string) {
  const path='/etc/ssh/ssh_host_ed25519_key.pub',info=await lstat(path)
  ensure(info.isFile() && !info.isSymbolicLink() && info.uid===0 && (info.mode&0o022)===0 && info.size<=4096,'OSS_RECOVERY_LOCAL_SSH_IDENTITY_MISSING',409)
  const ssh=await exec('/usr/sbin/sshd',['-T','-C','user=root,host=localhost,addr=127.0.0.1'],{timeout:10000,maxBuffer:65536})
  return localRecoveryGateway(current,archived,await readFile(path,'utf8'),ssh.stdout,savedEndpoint)
}
