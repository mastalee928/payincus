import ssh2, { type Client, type ConnectConfig } from 'ssh2'
import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { isIPv4 } from 'net'
import { OnboardingError, isOnboardingPublicIPv4 } from '../lib/host-onboarding.js'

export function sshFingerprint(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
}

export async function connectOnboardingSsh(config: ConnectConfig, verify: (fingerprint: string) => Promise<boolean>): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new ssh2.Client()
    let ready = false, mismatch = false
    let verificationError: OnboardingError | null = null
    client.on('error', (error: { level?: string }) => {
      if (!ready) { client.destroy(); reject(verificationError || new OnboardingError(mismatch ? 'SSH_HOST_KEY_CHANGED' : error.level === 'client-authentication' ? 'SSH_AUTH_FAILED' : 'SSH_CONNECT_FAILED')) }
    })
    client.once('close', () => { if (!ready) reject(verificationError || new OnboardingError(mismatch ? 'SSH_HOST_KEY_CHANGED' : 'SSH_CONNECT_FAILED')) })
    client.once('ready', () => { ready = true; resolve(client) })
    try { client.connect({ ...config, username: 'root', readyTimeout: 15000, keepaliveInterval: 15000, keepaliveCountMax: 3,
      hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => {
        verify(sshFingerprint(key)).then(valid => { mismatch = !valid; callback(valid) }).catch(error => {
          verificationError = error instanceof OnboardingError ? error : new OnboardingError('SSH_IDENTITY_CHECK_FAILED')
          callback(false)
        })
      }
    }) } catch { client.destroy(); reject(new OnboardingError('SSH_CONNECT_FAILED')) }
  })
}

// No PTY and no shell interpolation of credentials. The script arrives over
// stdin, and only structured, bounded results are returned to the worker.
export async function sshExec(client: Client, command: string, input = '', timeoutMs = 30000, outputLimit = 65536): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, value?: string) => {
      if (settled) return
      settled = true; clearTimeout(timer); client.off('close', onClose)
      if (error) reject(error); else resolve(value || '')
    }
    const onClose = () => finish(new OnboardingError('SSH_DISCONNECTED'))
    client.once('close', onClose)
    const timer = setTimeout(() => { client.destroy(); finish(new OnboardingError('SSH_COMMAND_TIMEOUT')) }, timeoutMs)
    client.exec(command, (error, stream) => {
      if (error) { finish(new OnboardingError('SSH_COMMAND_FAILED')); return }
      if (settled) { stream.close(); return }
      let output = ''
      stream.on('data', (data: Buffer) => { output = (output + data.toString('utf8')).slice(-outputLimit) })
      stream.stderr.on('data', () => {})
      stream.on('error', () => finish(new OnboardingError('SSH_COMMAND_FAILED')))
      stream.on('close', (code: number) => {
        if (code !== 0) {
          const known = output.match(/INCUDAL_ERROR:([A-Z_]+)/)
          finish(new OnboardingError(known?.[1] || 'SSH_COMMAND_FAILED'))
        } else finish(undefined, output)
      })
      stream.end(input)
    })
  })
}

export interface OnboardingGateway {
  publicKey: string
  controlIp: string
  network: string
  managementIp?: string
  endpoint: string
  sshHost: string
  managementSshPublicKey: string
  peers?: GatewayPeer[]
  recovery?: { version: 1; observedAt: number; stateHash: string; configHash?: string; runtimeHash?: string; peers: Array<{ nodeId: string; nodePublicKey: string; managementIp: string; enabled: boolean }> }
  dnsProtocolVersion?: number
  recoveryProtocolVersion?: number
  retirementProtocolVersion?: number
}

export interface GatewayPeer {
  nodeId: string; managementIp: string; publicIp: string | null; lastHandshakeAt: number
}

export function validateGatewayResponse(raw: unknown, endpoint: string, sshHost: string): OnboardingGateway {
  if (!raw || typeof raw !== 'object') throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
  const value = raw as Record<string, unknown>
  const network = typeof value.network === 'string' ? value.network.split('/') : []
  const prefix = Number(network[1])
  const ipv4Number = (ip: string) => ip.split('.').reduce((result, octet) => result * 256 + Number(octet), 0)
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  if (network.length !== 2 || !isIPv4(network[0]) || !Number.isInteger(prefix) || prefix < 16 || prefix > 30 ||
      typeof value.controlIp !== 'string' || !isIPv4(value.controlIp) || !value.controlIp.startsWith('10.') ||
      ((ipv4Number(value.controlIp) & mask) >>> 0) !== ipv4Number(network[0]) ||
      typeof value.publicKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value.publicKey)) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
  if (value.managementIp !== undefined && (typeof value.managementIp !== 'string' || !isIPv4(value.managementIp) || value.managementIp === value.controlIp ||
      ipv4Number(value.managementIp) <= ipv4Number(network[0]) || ipv4Number(value.managementIp) >= ipv4Number(network[0]) + 2 ** (32 - prefix) - 1 ||
      ((ipv4Number(value.managementIp) & mask) >>> 0) !== ipv4Number(network[0]))) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
  const match = endpoint.match(/^([a-zA-Z0-9][a-zA-Z0-9.-]*):([0-9]{1,5})$/)
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535 || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(sshHost)) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
  if (typeof value.managementSshPublicKey !== 'string' || !/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(value.managementSshPublicKey) || value.managementSshPublicKey.length > 200) throw new OnboardingError('GATEWAY_MANAGEMENT_KEY_MISSING')
  if (ssh2.utils.parseKey(value.managementSshPublicKey) instanceof Error) throw new OnboardingError('GATEWAY_MANAGEMENT_KEY_MISSING')
  if (value.dnsProtocolVersion !== undefined && value.dnsProtocolVersion !== 2) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
  if (value.recoveryProtocolVersion !== undefined && value.recoveryProtocolVersion !== 1) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
  if (value.retirementProtocolVersion !== undefined && value.retirementProtocolVersion !== 1) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
  let peers: GatewayPeer[] | undefined
  if (value.peers !== undefined) {
    if (!Array.isArray(value.peers) || value.peers.length > 10000) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
    peers = value.peers.map((peer: any) => {
      if (!peer || typeof peer.nodeId !== 'string' || !/^[a-f0-9-]{36}$/.test(peer.nodeId) ||
          typeof peer.managementIp !== 'string' || !isIPv4(peer.managementIp) ||
          peer.managementIp === value.controlIp || ((ipv4Number(peer.managementIp) & mask) >>> 0) !== ipv4Number(network[0]) ||
          (peer.publicIp !== null && !isOnboardingPublicIPv4(peer.publicIp)) ||
          !Number.isSafeInteger(peer.lastHandshakeAt) || peer.lastHandshakeAt < 0) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
      return { nodeId: peer.nodeId, managementIp: peer.managementIp, publicIp: peer.publicIp, lastHandshakeAt: peer.lastHandshakeAt }
    })
    if (new Set(peers.map(peer => peer.nodeId)).size !== peers.length || new Set(peers.map(peer => peer.managementIp)).size !== peers.length) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
  }
  let recovery: OnboardingGateway['recovery']
  if (value.recovery !== undefined) {
    const state = value.recovery as NonNullable<OnboardingGateway['recovery']>
    if(state?.configHash!==undefined && !/^[a-f0-9]{64}$/.test(state.configHash))throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
    if(state?.runtimeHash!==undefined && !/^[a-f0-9]{64}$/.test(state.runtimeHash))throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
    if (!state || state.version !== 1 || !Number.isSafeInteger(state.observedAt) || !/^[a-f0-9]{64}$/.test(state.stateHash) || !Array.isArray(state.peers) || state.peers.length > 10000 ||
        state.peers.some(peer => !peer || !/^[a-f0-9-]{36}$/.test(peer.nodeId) || !/^[A-Za-z0-9+/]{43}=$/.test(peer.nodePublicKey) || !isIPv4(peer.managementIp) || typeof peer.enabled !== 'boolean') ||
        new Set(state.peers.map(peer => peer.nodeId)).size !== state.peers.length || new Set(state.peers.map(peer => peer.managementIp)).size !== state.peers.length ||
        new Set(state.peers.map(peer => peer.nodePublicKey)).size !== state.peers.length || state.peers.some(peer => peer.managementIp === value.controlIp ||
          ((ipv4Number(peer.managementIp) & mask) >>> 0) !== ipv4Number(network[0]))) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
    recovery = state
  }
  return { recovery, publicKey: value.publicKey, controlIp: value.controlIp, network: String(value.network), peers,
    managementIp: value.managementIp as string | undefined, managementSshPublicKey: value.managementSshPublicKey, endpoint, sshHost,
    ...(value.dnsProtocolVersion === 2 ? { dnsProtocolVersion: 2 } : {}),
    ...(value.recoveryProtocolVersion === 1 ? { recoveryProtocolVersion: 1 } : {}),
    ...(value.retirementProtocolVersion === 1 ? { retirementProtocolVersion: 1 } : {}) }
}

export async function gatewayRegistrationOperation(nodeId: string, expected?: { nodePublicKey: string; managementIp: string; requestId: string }) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(nodeId) || !gatewayConfigured()) throw new OnboardingError('GATEWAY_NOT_CONFIGURED')
  const privateKey = await readFile(process.env.ONBOARDING_GATEWAY_KEY_PATH!)
  const client = await connectOnboardingSsh({ host: process.env.ONBOARDING_GATEWAY_HOST!, port: Number(process.env.ONBOARDING_GATEWAY_PORT || 22), privateKey },
    async fingerprint => fingerprint === process.env.ONBOARDING_GATEWAY_FINGERPRINT)
  try {
    const value = JSON.parse(await sshExec(client, `${expected ? 'retire' : 'registration'} ${nodeId}`,
      expected ? JSON.stringify({ ...expected, expiresAt: Date.now() + 25000 }) : '', 28000))
    if (value?.nodeId !== nodeId) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
    if (expected) {
      if (Object.keys(value).sort().join(',') !== 'nodeId,registrationRetired' || value.registrationRetired !== true) throw new OnboardingError('GATEWAY_RETIREMENT_FAILED')
      return null
    }
    if (Object.keys(value).sort().join(',') !== 'nodeId,registration') throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
    if (value.registration === null) return null
    const saved = value.registration
    if (!saved || Object.keys(saved).sort().join(',') !== 'managementIp,nodePublicKey' || !isIPv4(saved.managementIp) ||
      !/^[A-Za-z0-9+/]{43}=$/.test(saved.nodePublicKey)) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
    return saved as { nodePublicKey: string; managementIp: string }
  } catch (error) { throw error instanceof OnboardingError ? error : new OnboardingError('GATEWAY_RESPONSE_INVALID') }
  finally { client.end() }
}

export function gatewayConfigured(): boolean {
  return Boolean(process.env.ONBOARDING_GATEWAY_HOST && process.env.ONBOARDING_GATEWAY_KEY_PATH && process.env.ONBOARDING_GATEWAY_FINGERPRINT && process.env.ONBOARDING_WG_ENDPOINT)
}
export function gatewaySshHost(endpoint: string, settings = {
  gatewayHost: process.env.ONBOARDING_GATEWAY_HOST || '', jumpHost: process.env.ONBOARDING_SSH_JUMP_HOST || '',
  configuredEndpoint: process.env.ONBOARDING_WG_ENDPOINT || ''
}) {
  const originalHost = settings.configuredEndpoint.replace(/:[0-9]+$/, '')
  // A restored single controller must not keep jumping to A's literal IP.
  // Preserve an explicitly separate SSH bastion in legacy split deployments.
  if (['127.0.0.1', 'localhost'].includes(settings.gatewayHost) && (!settings.jumpHost || settings.jumpHost === originalHost)) return endpoint.replace(/:[0-9]+$/, '')
  return settings.jumpHost || settings.gatewayHost
}

export async function gatewayCommand(command = 'status', resolvedEndpoint?: string): Promise<OnboardingGateway> {
  if (!gatewayConfigured()) throw new OnboardingError('GATEWAY_NOT_CONFIGURED')
  const privateKey = await readFile(process.env.ONBOARDING_GATEWAY_KEY_PATH!)
  const client = await connectOnboardingSsh({ host: process.env.ONBOARDING_GATEWAY_HOST!, port: Number(process.env.ONBOARDING_GATEWAY_PORT || 22), privateKey },
    async fingerprint => fingerprint === process.env.ONBOARDING_GATEWAY_FINGERPRINT)
  try {
    let raw: unknown
    try { raw = JSON.parse(await sshExec(client, command, '', 30000, ['peers', 'recovery-state'].includes(command) ? 2 * 1024 * 1024 : 65536)) }
    catch (error) { if (error instanceof OnboardingError) throw error; throw new OnboardingError('GATEWAY_RESPONSE_INVALID') }
    // Validation and SSH helpers are also used by standalone guard processes.
    // Load database-backed endpoint settings only for an actual gateway command.
    const endpoint = resolvedEndpoint ?? await (await import('./onboarding-gateway-endpoint.js')).currentOnboardingGatewayEndpoint()
    return validateGatewayResponse(raw, endpoint, gatewaySshHost(endpoint))
  } finally { client.end() }
}

export async function restoreGatewayRuntimeRoute(nodeId:string,input:{nodePublicKey:string;managementIp:string;gatewayPublicKey:string;configHash:string;expiresAt:number}) {
  if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(nodeId) || !gatewayConfigured())throw new OnboardingError('GATEWAY_NOT_CONFIGURED')
  const privateKey=await readFile(process.env.ONBOARDING_GATEWAY_KEY_PATH!)
  const client=await connectOnboardingSsh({host:process.env.ONBOARDING_GATEWAY_HOST!,port:Number(process.env.ONBOARDING_GATEWAY_PORT||22),privateKey},
    async fingerprint=>fingerprint===process.env.ONBOARDING_GATEWAY_FINGERPRINT)
  try{
    let value:any
    try{value=JSON.parse(await sshExec(client,`restore-route ${nodeId}`,JSON.stringify(input),15000))}
    catch(error){throw error instanceof OnboardingError?error:new OnboardingError('GATEWAY_RESPONSE_INVALID')}
    if(!value || Object.keys(value).sort().join(',')!=='nodeId,runtimeRouteRestored,savedConfigurationPreserved' || value.nodeId!==nodeId ||
      value.runtimeRouteRestored!==true || value.savedConfigurationPreserved!==true)throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
  }finally{client.end()}
}

export async function installGatewayHostDns(nodeId: string, input: { hostname: string; port: number; sshPort: number; sshFingerprint: string; nodePublicKey: string;
  revision?: number; previous?: Array<{ hostname: string; revision: number }> }) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(nodeId) || !gatewayConfigured()) throw new OnboardingError('GATEWAY_NOT_CONFIGURED')
  const privateKey = await readFile(process.env.ONBOARDING_GATEWAY_KEY_PATH!)
  const client = await connectOnboardingSsh({ host: process.env.ONBOARDING_GATEWAY_HOST!, port: Number(process.env.ONBOARDING_GATEWAY_PORT || 22), privateKey },
    async fingerprint => fingerprint === process.env.ONBOARDING_GATEWAY_FINGERPRINT)
  try {
    if (input.revision !== undefined) {
      const status = JSON.parse(await sshExec(client, 'status')) as { dnsProtocolVersion?: number }
      if (status.dnsProtocolVersion !== 2) throw new OnboardingError('GATEWAY_DNS_HELPER_UPGRADE_REQUIRED')
    }
    const receipt = JSON.parse(await sshExec(client, `dns ${nodeId}`, JSON.stringify(input), 100000))
    if (receipt.nodeId !== nodeId || receipt.dnsRefreshInstalled !== true || receipt.endpoint !== `${input.hostname}:${input.port}` || receipt.keysAndRoutesPreserved !== true ||
        (input.revision !== undefined && receipt.revision !== input.revision) ||
        Object.keys(receipt).sort().join(',') !== 'dnsRefreshInstalled,endpoint,keysAndRoutesPreserved,nodeId' + (input.revision === undefined ? '' : ',revision')) throw new OnboardingError('GATEWAY_DNS_INSTALL_FAILED')
    return receipt as { nodeId: string; dnsRefreshInstalled: true; endpoint: string; keysAndRoutesPreserved: true; revision?: number }
  } catch (error) { throw error instanceof OnboardingError ? error : new OnboardingError('GATEWAY_DNS_INSTALL_FAILED') }
  finally { client.end() }
}

export async function probeGatewayHost(nodeId: string, input: { sshPort: number; sshFingerprint: string; nodePublicKey: string; portProtocol?: 'tcp'|'tcp_udp' }) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(nodeId) || !gatewayConfigured()) throw new OnboardingError('GATEWAY_NOT_CONFIGURED')
  const privateKey = await readFile(process.env.ONBOARDING_GATEWAY_KEY_PATH!)
  const client = await connectOnboardingSsh({ host: process.env.ONBOARDING_GATEWAY_HOST!, port: Number(process.env.ONBOARDING_GATEWAY_PORT || 22), privateKey },
    async fingerprint => fingerprint === process.env.ONBOARDING_GATEWAY_FINGERPRINT)
  try {
    const value = JSON.parse(await sshExec(client, `probe ${nodeId}`, JSON.stringify(input), 40000))
    if (Object.keys(value).sort().join(',') !== (input.portProtocol ? 'keysAndRoutesPreserved,nodeId,portProtocolVerified,sshIdentityVerified' : 'keysAndRoutesPreserved,nodeId,sshIdentityVerified') || value.nodeId !== nodeId ||
      (input.portProtocol && value.portProtocolVerified !== input.portProtocol) ||
      value.sshIdentityVerified !== true || value.keysAndRoutesPreserved !== true) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
  } finally { client.end() }
}

export async function repairGatewayHostAgent(nodeId: string, input: {
  sshPort: number; sshFingerprint: string; nodePublicKey: string; agentId: string; agentSecret: string; expiresAt: number
}, signal?: AbortSignal) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(nodeId) || !gatewayConfigured()) throw new OnboardingError('GATEWAY_NOT_CONFIGURED')
  const privateKey = await readFile(process.env.ONBOARDING_GATEWAY_KEY_PATH!)
  const client = await connectOnboardingSsh({ host: process.env.ONBOARDING_GATEWAY_HOST!, port: Number(process.env.ONBOARDING_GATEWAY_PORT || 22), privateKey },
    async fingerprint => !signal?.aborted && fingerprint === process.env.ONBOARDING_GATEWAY_FINGERPRINT)
  const abort = () => client.destroy()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    signal?.throwIfAborted()
    // Remote publication expires before this transaction's deadline, even when
    // an SSH response is lost and the remote interpreter has not exited yet.
    if (input.expiresAt <= Date.now()) throw new OnboardingError('AGENT_REPAIR_EXPIRED')
    const value = JSON.parse(await sshExec(client, `repair-agent ${nodeId}`, JSON.stringify(input), 35000, 2048))
    if (Object.keys(value).sort().join(',') !== 'agentId,configReconciled,keysAndRoutesPreserved,nodeId' ||
        value.nodeId !== nodeId || value.agentId !== input.agentId || value.configReconciled !== true || value.keysAndRoutesPreserved !== true) {
      throw new OnboardingError('AGENT_REPAIR_RECEIPT_INVALID')
    }
  } finally { signal?.removeEventListener('abort', abort); client.destroy() }
}
