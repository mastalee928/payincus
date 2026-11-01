import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isIP } from 'node:net'
import { ensure } from './platform-backup-core.js'

const exec = promisify(execFile)
const configPath = '/etc/wireguard/incudal-mgmt.conf'
function setting(config: string, name: string) {
  return new RegExp(`^\\s*${name}\\s*=\\s*([^\\r\\n]+)`, 'm').exec(config)?.[1].trim()
}
// Preserve learned endpoints only for peers belonging to the same controller identity.
export function retainGatewayEndpoints(previous: string, next: string, endpoints: string): string {
  const identity = setting(previous, 'PrivateKey')
  if (!identity || identity !== setting(next, 'PrivateKey')) return next
  const oldPeers = new Set([...previous.matchAll(/^\s*PublicKey\s*=\s*([A-Za-z0-9+/]{43}=)\s*$/gm)].map(match => match[1]))
  const known = new Map<string, string>()
  for (const line of endpoints.trim().split('\n')) {
    const [key, endpoint] = line.trim().split(/\s+/)
    const match = /^(?:([0-9.]+)|\[([0-9a-f:]+)\]):(\d{1,5})$/i.exec(endpoint || '')
    if (oldPeers.has(key) && match && isIP(match[1] || match[2]) && Number(match[3]) > 0 && Number(match[3]) <= 65535) known.set(key, endpoint)
  }
  return next.split(/(?=^\s*\[Peer\]\s*$)/m).map(section => {
    if (!/^\s*\[Peer\]/.test(section) || setting(section, 'Endpoint')) return section
    const endpoint = known.get(setting(section, 'PublicKey') || '')
    return endpoint ? section.trimEnd() + `\nEndpoint = ${endpoint}\n` : section
  }).join('')
}
export async function refreshRestoredGateway(previous: string, reconcileNetwork = false) {
  const next = await readFile(configPath, 'utf8')
  const active = await exec('/usr/bin/systemctl', ['is-active', 'wg-quick@incudal-mgmt'], { timeout: 10000 }).then(result => result.stdout.trim() === 'active').catch(() => false)
  // An unchanged file does not require restarting the live tunnel or discarding handshakes.
  if (!reconcileNetwork && active && previous === next) return
  const endpoints = active ? await exec('/usr/bin/wg', ['show', 'incudal-mgmt', 'endpoints'], { timeout: 10000 }).then(result => result.stdout) : ''
  // Distribution confinement permits wg/wg-quick to read identity material
  // under /etc/wireguard, not a generic temporary directory. mkdtemp is 0700.
  const directory = await mkdtemp('/etc/wireguard/.incudal-restore-')
  try {
    const temporary = join(directory, 'incudal-mgmt.conf')
    // Interrupted rollback can leave file and live identities different. Do
    // not carry learned endpoints across an identity we cannot establish.
    await writeFile(temporary, retainGatewayEndpoints(reconcileNetwork ? '' : previous, next, endpoints), { mode: 0o600 })
    const sameNetwork = ['Address', 'ListenPort', 'MTU'].every(name => setting(previous, name) === setting(next, name))
    const stripped = await exec('/usr/bin/wg-quick', ['strip', temporary], { timeout: 10000 })
    const input = join(directory, 'sync.conf'); await writeFile(input, stripped.stdout, { mode: 0o600 })
    // Reject unreadable/invalid input before disrupting the current interface.
    if (reconcileNetwork || !active || !sameNetwork) await exec('/usr/bin/systemctl', ['restart', 'wg-quick@incudal-mgmt'], { timeout: 30000 })
    await exec('/usr/bin/wg', ['syncconf', 'incudal-mgmt', input], { timeout: 10000 })
    const result = await exec('/usr/bin/systemctl', ['is-active', 'wg-quick@incudal-mgmt'], { timeout: 10000 })
    ensure(result.stdout.trim() === 'active', 'OSS_GATEWAY_RESTORE_FAILED', 503)
  } finally { await rm(directory, { recursive: true, force: true }) }
}
