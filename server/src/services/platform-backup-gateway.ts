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
export async function refreshRestoredGateway(previous: string) {
  const next = await readFile(configPath, 'utf8')
  const active = await exec('/usr/bin/systemctl', ['is-active', 'wg-quick@incudal-mgmt'], { timeout: 10000 }).then(result => result.stdout.trim() === 'active').catch(() => false)
  // An unchanged file does not require restarting the live tunnel or discarding handshakes.
  if (active && previous === next) return
  const endpoints = active ? await exec('/usr/bin/wg', ['show', 'incudal-mgmt', 'endpoints'], { timeout: 10000 }).then(result => result.stdout) : ''
  const directory = await mkdtemp('/var/tmp/incudal-gateway-restore-')
  try {
    const temporary = join(directory, 'incudal-mgmt.conf')
    await writeFile(temporary, retainGatewayEndpoints(previous, next, endpoints), { mode: 0o600 })
    const sameNetwork = ['Address', 'ListenPort', 'MTU'].every(name => setting(previous, name) === setting(next, name))
    if (!active || !sameNetwork) await exec('/usr/bin/systemctl', ['restart', 'wg-quick@incudal-mgmt'], { timeout: 30000 })
    const stripped = await exec('/usr/bin/wg-quick', ['strip', temporary], { timeout: 10000 })
    const input = join(directory, 'sync.conf'); await writeFile(input, stripped.stdout, { mode: 0o600 })
    await exec('/usr/bin/wg', ['syncconf', 'incudal-mgmt', input], { timeout: 10000 })
    const result = await exec('/usr/bin/systemctl', ['is-active', 'wg-quick@incudal-mgmt'], { timeout: 10000 })
    ensure(result.stdout.trim() === 'active', 'OSS_GATEWAY_RESTORE_FAILED', 503)
  } finally { await rm(directory, { recursive: true, force: true }) }
}
