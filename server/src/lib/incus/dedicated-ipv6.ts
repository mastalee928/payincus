import type { IncusClient } from './incus-client.js'
import { createHash } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { execWithOutput } from './incus-instances.js'
import { ensureDedicatedIpv6Forward, removeObsoleteDedicatedIpv6Forwards } from './dedicated-network.js'
import { dedicatedIpv6Address, dedicatedIpv6Gateway, dedicatedIpv6State, normalizeIpv6, privateIpv6, orderedPublicIpv6,
  PublicIpv6SyncError, MAX_PUBLIC_IPV6_ADDRESSES, type DedicatedIpv6Mapping, type DedicatedIpv6State } from '../host-public-ipv6.js'
import { verifyPublicSshIdentity, PublicIpSyncError } from '../host-public-ip.js'
import { verifyDedicatedIpv6FromGuest } from './dedicated-ipv6-probe.js'
import { guestSshFingerprintsCommand } from '../ssh-host-identity.js'

const bridge = '/1.0/networks/incusbr0'
const guestDirectory = '/etc/payincus/ipv6'
export const MAX_IPV6_VERIFICATIONS_PER_PASS = 8

function ipv6DeliveryError(error: unknown): string {
  if (error instanceof PublicIpv6SyncError) return error.code
  if (error instanceof PublicIpSyncError) {
    if (error.code === 'IPV6_CONTROLLER_NO_ROUTE') return error.code
    if (error.code === 'IP_IDENTITY_MISMATCH') return 'IPV6_IDENTITY_MISMATCH'
    if (error.code === 'IP_IDENTITY_UNAVAILABLE') return 'IPV6_IDENTITY_UNAVAILABLE'
  }
  return 'IPV6_DELIVERY_FAILED'
}

export function dedicatedIpv6NetworkDigest(mappings: DedicatedIpv6Mapping[]): string {
  const lines = mappings.flatMap(mapping => [mapping.privateIp, mapping.fallbackIp].filter(Boolean)
    .map(target => `${mapping.publicIp}=${target}`)).sort()
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

/** Do not call inbound SSH alone proof of delivery: the Agent must also have
 * installed exact outbound source mappings before Incus's generic NAT. */
export async function waitForDedicatedIpv6Network(client: IncusClient, mappings: DedicatedIpv6Mapping[], signal?: AbortSignal): Promise<void> {
  if (!mappings.length) return
  const digest = dedicatedIpv6NetworkDigest(mappings)
  const until = Date.now() + 18000
  while (Date.now() < until) {
    signal?.throwIfAborted()
    const network = await client.request<{ config: Record<string, string> }>('GET', bridge, null, 5000, signal)
    if (network.config['user.payincus.ipv6.ready'] === digest) return
    await pause(1000, undefined, { signal })
  }
  throw new PublicIpv6SyncError('IPV6_NETWORK_PENDING')
}

export async function ensureDedicatedIpv6Bridge(client: Pick<IncusClient, 'request'>, hostId: number): Promise<string> {
  const info = await client.request<{ api_extensions?: string[]; environment?: { firewall?: string } }>('GET', '/1.0')
  if (!info.api_extensions?.includes('network_forward_snat') || info.environment?.firewall !== 'nftables') {
    throw new PublicIpv6SyncError('IPV6_INCUS_UPGRADE_REQUIRED')
  }
  const network = await client.request<{ config: Record<string, string> }>('GET', bridge)
  const address = network.config['ipv6.address']
  const gateway = !address || address === 'none' ? dedicatedIpv6Gateway(hostId) : normalizeIpv6(address.split('/')[0])
  if (!gateway || !privateIpv6(gateway) || (address && address !== 'none' && address.split('/')[1] !== '64')) {
    throw new PublicIpv6SyncError('IPV6_BRIDGE_CONFLICT')
  }
  if (!address || address === 'none' || network.config['ipv6.nat'] !== 'true' || network.config['ipv6.routing'] === 'false') {
    await client.request('PATCH', bridge, { config: {
      'ipv6.address': `${gateway}/64`, 'ipv6.nat': 'true', 'ipv6.routing': 'true', 'ipv6.dhcp': 'false'
    } })
  }
  return gateway
}

// BusyBox/POSIX awk is available even on minimal Alpine guests. Normalize
// IPv6 words before comparing the obsolete SLAAC address to the NIC's EUI-64.
export const legacyIpv6SlaacSelector = `function expand(a, out, halves, l, r, n, k, j, part) {
  n=split(a,halves,"::"); l=split(halves[1],part,":"); if(halves[1]=="")l=0
  k=0; for(j=1;j<=l;j++)out[++k]=part[j]
  if(n==2){r=split(halves[2],part,":");if(halves[2]=="")r=0;for(j=1;j<=8-l-r;j++)out[++k]="0";for(j=1;j<=r;j++)out[++k]=part[j]}
  for(j=1;j<=k;j++){sub(/^0+/,"",out[j]);if(out[j]=="")out[j]="0"}
  return k
}
BEGIN {expand(primary,p);expand(suffix,s);for(j=1;j<=4;j++)expected[j]=p[j];for(j=1;j<=4;j++)expected[j+4]=s[j]}
$3=="inet6" && /mngtmpaddr/ {split($4,address,"/");if(address[2]!="64")next;delete actual;n=expand(address[1],actual);matchAddress=n==8;for(j=1;j<=8;j++)if(actual[j]!=expected[j])matchAddress=0;if(matchAddress)print address[1]}`

/** Own only our addresses and route (protocol 242); preserve customer files and IPv4. */
export const dedicatedIpv6GuestScript = `#!/bin/sh
set -eu
directory=/etc/payincus/ipv6
test -f "$directory/addresses"
test -d /sys/class/net/eth0
sysctl -w net.ipv6.conf.eth0.disable_ipv6=0 net.ipv6.conf.eth0.accept_ra=0 net.ipv6.conf.eth0.autoconf=0 >/dev/null
primary=''
while IFS= read -r address; do
  [ -n "$address" ] || continue
  ip -6 addr replace "$address/64" dev eth0 nodad
  [ -n "$primary" ] || primary="$address"
done < "$directory/addresses"
if [ -n "$primary" ]; then
  gateway=$(cat "$directory/gateway")
  ip -6 route replace default via "$gateway" dev eth0 src "$primary" proto 242 metric 100
else
  ip -6 route del default dev eth0 proto 242 metric 100 2>/dev/null || true
fi
if [ -f "$directory/applied" ]; then
  while IFS= read -r address; do
    [ -n "$address" ] || continue
    if ! grep -Fxq "$address" "$directory/addresses"; then
      ip -6 addr del "$address/64" dev eth0 2>/dev/null || true
    fi
  done < "$directory/applied"
fi
cp "$directory/addresses" "$directory/applied"
# Remove only the obsolete SLAAC address derived from this NIC's own MAC.
# It was left by the old generated network config; keep explicit customer
# addresses and both owned TCP/UDP/default-protocol mapping addresses.
mac=$(cat /sys/class/net/eth0/address)
if [ -n "$primary" ]; then
  suffix=$(IFS=:; set -- $mac; printf '%x:%x:%x:%x' "$(( (0x$1 ^ 2) * 256 + 0x$2 ))" "$(( 0x$3 * 256 + 255 ))" "$(( 0xfe * 256 + 0x$4 ))" "$(( 0x$5 * 256 + 0x$6 ))")
  legacy=$(ip -o -6 addr show dev eth0 | awk -v primary="$primary" -v suffix="$suffix" '${legacyIpv6SlaacSelector}')
  if [ -n "$legacy" ] && ! grep -Fxq "$legacy" "$directory/addresses"; then ip -6 addr del "$legacy/64" dev eth0 2>/dev/null || true; fi
fi
`

const systemdUnit = `[Unit]
Description=PayIncus instance IPv6 addresses
After=network-online.target cloud-final.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/payincus-ipv6
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
`
const openrcUnit = `#!/sbin/openrc-run
description="PayIncus instance IPv6 addresses"
depend() { need networking; after cloud-final; }
start() { /usr/local/sbin/payincus-ipv6; }
`

const base64 = (text: string) => Buffer.from(text).toString('base64')
function writeGuestFile(path: string, content: string, mode = '0644'): string {
  return `printf '%s' '${base64(content)}' | base64 -d > '${path}.new'\nchmod ${mode} '${path}.new'\nif ! cmp -s '${path}.new' '${path}'; then mv '${path}.new' '${path}'; else rm '${path}.new'; fi`
}

export function dedicatedIpv6InstallScript(gateway: string | null, addresses: string[]): string {
  if ((gateway !== null && !privateIpv6(gateway)) ||
      addresses.some(address => !privateIpv6(address))) throw new PublicIpv6SyncError('IPV6_GUEST_CONFIG_INVALID')
  return `set -eu
# cloud-init used to disable IPv6 for NAT guests; let that first boot finish first.
if [ -d /var/lib/cloud/instance ] && [ ! -f /var/lib/cloud/instance/boot-finished ]; then exit 75; fi
command -v ip >/dev/null
if [ ! -d /run/systemd/system ] && ! command -v rc-update >/dev/null; then exit 76; fi
mkdir -p ${guestDirectory} /usr/local/sbin /etc/sysctl.d
${writeGuestFile(`${guestDirectory}/addresses`, addresses.join('\n') + (addresses.length ? '\n' : ''))}
${writeGuestFile(`${guestDirectory}/gateway`, gateway ? gateway + '\n' : '')}
${writeGuestFile('/usr/local/sbin/payincus-ipv6', dedicatedIpv6GuestScript, '0755')}
${writeGuestFile('/etc/sysctl.d/99-payincus-ipv6.conf', 'net.ipv6.conf.eth0.disable_ipv6 = 0\nnet.ipv6.conf.eth0.accept_ra = 0\nnet.ipv6.conf.eth0.autoconf = 0\n')}
if [ -d /run/systemd/system ]; then
  ${writeGuestFile('/etc/systemd/system/payincus-ipv6.service', systemdUnit)}
  systemctl daemon-reload
  systemctl enable payincus-ipv6.service >/dev/null 2>&1
else
  ${writeGuestFile('/etc/init.d/payincus-ipv6', openrcUnit, '0755')}
  rc-update add payincus-ipv6 default >/dev/null 2>&1
fi
/usr/local/sbin/payincus-ipv6
`
}

export async function configureDedicatedIpv6Guest(client: IncusClient, name: string, gateway: string | null, addresses: string[]): Promise<void> {
  const result = await execWithOutput(client, name, ['sh', '-c', dedicatedIpv6InstallScript(gateway, addresses)], {}, 20000)
  const code = (result.metadata as { return?: number } | null)?.return
  if (code === 75) throw new PublicIpv6SyncError('IPV6_GUEST_INITIALIZING')
  if (code !== 0) throw new PublicIpv6SyncError('IPV6_GUEST_CONFIG_FAILED')
}

export async function instanceSshFingerprints(client: IncusClient, name: string): Promise<string[]> {
  const result = await execWithOutput(client, name, ['sh', '-c',
    guestSshFingerprintsCommand], {}, 8000)
  if ((result.metadata as { return?: number } | null)?.return !== 0) throw new PublicIpv6SyncError('IPV6_IDENTITY_UNAVAILABLE')
  const fingerprints = result.stdout.match(/SHA256:[A-Za-z0-9+/]+/g) ?? []
  if (!fingerprints.length) throw new PublicIpv6SyncError('IPV6_IDENTITY_UNAVAILABLE')
  return fingerprints
}

export const dedicatedIpv6Dependencies = {
  bridge: ensureDedicatedIpv6Bridge,
  guest: configureDedicatedIpv6Guest,
  network: waitForDedicatedIpv6Network,
  fingerprints: instanceSshFingerprints,
  verify: verifyPublicSshIdentity,
  guestVerify: verifyDedicatedIpv6FromGuest
}

/** The caller owns the instance operation lock and publishes only these verified results. */
export async function reconcileDedicatedIpv6(client: IncusClient, input: {
  hostId: number; instanceId: number; name: string; addresses: string[]; previous: unknown; sshPort: number; force?: boolean; signal?: AbortSignal
}, deps = dedicatedIpv6Dependencies): Promise<DedicatedIpv6State> {
  const previous = dedicatedIpv6State(input.previous)
  const sameInstance = previous !== null && previous.hostId === input.hostId && previous.instanceName === input.name
  const addresses = orderedPublicIpv6(input.addresses, sameInstance ? previous.primary : null)
  const state: DedicatedIpv6State = { version: 1, hostId: input.hostId, instanceName: input.name,
    assignedAddresses: addresses,
    primary: addresses[0] ?? null, mappings: [], status: addresses.length ? 'pending' : 'none',
    configured: sameInstance && previous.configured, checkedAt: new Date().toISOString(), error: null }
  try {
    input.signal?.throwIfAborted()
    if (addresses.length > MAX_PUBLIC_IPV6_ADDRESSES) throw new PublicIpv6SyncError('IPV6_TOO_MANY_ADDRESSES')
    const gateway = addresses.length ? await deps.bridge(client, input.hostId) : null
    state.mappings = addresses.map(publicIp => {
      const privateIp = dedicatedIpv6Address(gateway!, input.instanceId, publicIp)
      const fallbackIp = dedicatedIpv6Address(gateway!, input.instanceId, `${publicIp}:other-protocols`)
      const old = sameInstance ? previous.mappings.find(mapping => mapping.publicIp === publicIp &&
        mapping.privateIp === privateIp && mapping.fallbackIp === fallbackIp) : undefined
      return { publicIp, privateIp, fallbackIp, ready: old?.ready === true, checkedAt: old?.checkedAt ?? null, ...(old?.verification ? { verification: old.verification } : {}) }
    })
    // Delete only addresses no longer present on the host, including after a crash/retry.
    await removeObsoleteDedicatedIpv6Forwards(client, input.name, addresses)
    if (addresses.length || state.configured) {
      state.configured = true
      await deps.guest(client, input.name, gateway, state.mappings.flatMap(mapping => [mapping.privateIp, mapping.fallbackIp!]))
    }
    const installed: DedicatedIpv6Mapping[] = []
    for (const mapping of state.mappings) {
      try {
        input.signal?.throwIfAborted()
        await ensureDedicatedIpv6Forward(client, input.name, mapping.publicIp, mapping.privateIp, mapping.fallbackIp!)
        installed.push(mapping)
      } catch (error) {
        input.signal?.throwIfAborted()
        mapping.ready = false
        state.error = ipv6DeliveryError(error)
      }
    }
    await deps.network(client, installed, input.signal)
    // Rotate failed checks behind never-checked addresses, so one unreachable
    // address cannot starve later additions or hold the host transaction forever.
    const verify = installed.filter(mapping => !mapping.ready || input.force).sort((a, b) =>
      Number(a.ready) - Number(b.ready) || (Date.parse(a.checkedAt ?? '') || 0) - (Date.parse(b.checkedAt ?? '') || 0)
    ).slice(0, MAX_IPV6_VERIFICATIONS_PER_PASS)
    const fingerprints = verify.length ? await deps.fingerprints(client, input.name) : []
    for (const mapping of verify) {
      input.signal?.throwIfAborted()
      mapping.checkedAt = new Date().toISOString()
      try {
        try {
          await deps.verify(mapping.publicIp, input.sshPort, fingerprints)
          mapping.verification = 'public-ssh'
        } catch (error) {
          if (!(error instanceof PublicIpSyncError) || error.code !== 'IPV6_CONTROLLER_NO_ROUTE') throw error
          await deps.guestVerify(client, input.name, mapping, input.sshPort, fingerprints)
          mapping.verification = 'guest-network'
        }
        mapping.ready = true
      } catch (error) {
        mapping.ready = false
        state.error = ipv6DeliveryError(error)
      }
    }
    state.status = state.error === 'IPV6_CONTROLLER_NO_ROUTE' ? 'pending' : state.error ? 'failed' : state.mappings.some(mapping => !mapping.ready) ? 'pending' : addresses.length ? 'ready' : 'none'
  } catch (error) {
    state.error = input.signal?.aborted ? 'IPV6_SYNC_DEADLINE' : error instanceof PublicIpv6SyncError ? error.code : 'IPV6_DELIVERY_FAILED'
    state.status = ['IPV6_GUEST_INITIALIZING', 'IPV6_NETWORK_PENDING', 'IPV6_SYNC_DEADLINE'].includes(state.error) ? 'pending' : 'failed'
    // Keep only previously verified, still assigned addresses; a failed read cannot invent readiness.
    state.mappings = state.mappings.length ? state.mappings : (sameInstance ? previous.mappings.filter(mapping => addresses.includes(mapping.publicIp)) : [])
  }
  return state
}
