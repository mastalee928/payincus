import { isIPv4 } from 'node:net'
import { readFile } from 'node:fs/promises'
import { parse as parseEnv } from 'dotenv'
import { ensure } from './platform-backup-core.js'
import { connectOnboardingSsh, sshExec, validateGatewayResponse } from './onboarding-ssh.js'
import { assertSavedRecoveryGateway } from './platform-recovery-gateway-baseline.js'

export function recoveryMappingEnvironment(source: string, address: string) {
  ensure(isIPv4(address) && !['0','127'].includes(address.split('.')[0]) && Number(address.split('.')[0]) < 224 &&
    address !== '169.254.169.254', 'OSS_RECOVERY_GATEWAY_ADDRESS_INVALID')
  const values = parseEnv(source), oldHost = values.ONBOARDING_GATEWAY_HOST
  ensure(oldHost && !['127.0.0.1','localhost','::1'].includes(oldHost), 'OSS_RECOVERY_EXTERNAL_GATEWAY_REQUIRED', 409)
  ensure(/^SHA256:[A-Za-z0-9+/]{43}$/.test(values.ONBOARDING_GATEWAY_FINGERPRINT || '') &&
    /^\/opt\/incudal\/server\/certs\/[A-Za-z0-9_.-]+$/.test(values.ONBOARDING_GATEWAY_KEY_PATH || ''), 'OSS_GATEWAY_MAPPING_REQUIRED', 409)
  values.ONBOARDING_GATEWAY_HOST = address
  // Preserve an independently configured SSH bastion. Only replace the old
  // gateway's own literal jump address; never regenerate keys or trust pins.
  if (values.ONBOARDING_SSH_JUMP_HOST === oldHost) values.ONBOARDING_SSH_JUMP_HOST = address
  for (const [key,value] of Object.entries(values)) ensure(/^[A-Z][A-Z0-9_]*$/.test(key) && !/[\r\n\x00']/.test(value), 'OSS_ENV_FORMAT_UNSUPPORTED')
  return Object.entries(values).map(([key,value]) => `${key}='${value}'`).join('\n') + '\n'
}

export async function inspectRecoveryMapping(source: string, address: string) {
  const environment = recoveryMappingEnvironment(source,address), values = parseEnv(environment)
  const privateKey = await readFile(values.ONBOARDING_GATEWAY_KEY_PATH)
  const client = await connectOnboardingSsh({host:address,port:Number(values.ONBOARDING_GATEWAY_PORT || 22),privateKey},
    async fingerprint => fingerprint === values.ONBOARDING_GATEWAY_FINGERPRINT)
  try {
    const raw = JSON.parse(await sshExec(client,'status','',30000,2*1024*1024))
    let state = validateGatewayResponse(raw,values.ONBOARDING_WG_ENDPOINT,values.ONBOARDING_SSH_JUMP_HOST || address)
    await assertSavedRecoveryGateway(state)
    // Moving the pinned connection address must not depend on upgrading a
    // helper through the dead old address. Identity-only mapping keeps the
    // recovery hold; the new address can then receive the packaged helper.
    if(state.recoveryProtocolVersion===1) {
      state=validateGatewayResponse(JSON.parse(await sshExec(client,'recovery-state','',30000,2*1024*1024)),
        values.ONBOARDING_WG_ENDPOINT,values.ONBOARDING_SSH_JUMP_HOST || address)
      await assertSavedRecoveryGateway(state)
      ensure(state.recovery && Math.abs(Date.now()-state.recovery.observedAt)<60000,'OSS_RECOVERY_GATEWAY_STATE_REQUIRED',409)
    }
    return {environment,state}
  } finally { client.end() }
}
