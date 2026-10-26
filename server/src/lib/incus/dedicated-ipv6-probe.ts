import type { IncusClient } from './incus-client.js'
import { execWithOutput } from './incus-instances.js'
import { privateIpv6, publicIpv6, PublicIpv6SyncError, type DedicatedIpv6Mapping } from '../host-public-ipv6.js'
import { shellQuote } from '../host-onboarding.js'

/** An IPv4-only controller can check the guest through authenticated Incus.
 * Verify real IPv6 egress with its exact source, and a signed SSH key exchange
 * against the guest identity. The Agent's exact forwarding/SNAT digest is checked
 * by the caller. This does not claim an external cloud-firewall ingress test. */
export function dedicatedIpv6ProbeScript(mapping: DedicatedIpv6Mapping, port: number): string {
  if (!publicIpv6(mapping.publicIp) || !privateIpv6(mapping.privateIp) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PublicIpv6SyncError('IPV6_GUEST_CONFIG_INVALID')
  }
  return `set -eu
export LC_ALL=C
for tool in ssh ssh-keyscan ssh-keygen timeout; do command -v "$tool" >/dev/null || exit 76; done
command -v curl >/dev/null || command -v python3 >/dev/null || exit 76
source_ip=${shellQuote(mapping.privateIp)}
directory=$(mktemp -d /tmp/payincus-ipv6-probe.XXXXXX)
trap 'rm -f "$directory/keys" "$directory/trace"; rmdir "$directory"' EXIT HUP INT TERM
ssh-keyscan -6 -T 4 -p ${port} "$source_ip" > "$directory/keys" 2>/dev/null
test -s "$directory/keys"
ssh-keygen -lf "$directory/keys" -E sha256
# No credentials, authentication attempts with keys, remote command or shell.
timeout 6 ssh -F /dev/null -vN -6 -p ${port} -o BatchMode=yes -o PreferredAuthentications=none \
  -o IdentityFile=none -o IdentityAgent=none -o UserKnownHostsFile="$directory/keys" \
  -o GlobalKnownHostsFile=/dev/null -o StrictHostKeyChecking=yes -o ConnectTimeout=4 \
  "root@$source_ip" > /dev/null 2> "$directory/trace" || true
grep -Fq 'debug1: SSH2_MSG_NEWKEYS received' "$directory/trace" || exit 77
printf 'SSH_KEY_EXCHANGE_OK\\n'
for endpoint in https://api6.ipify.org https://v6.ident.me; do
  observed=$(
    if command -v curl >/dev/null; then
      curl -6 --interface "$source_ip" --noproxy '*' --proto '=https' --connect-timeout 4 \
        --max-time 6 --max-filesize 64 --fail --silent "$endpoint"
    else
      timeout 6 python3 - "$source_ip" "$endpoint" <<'PY'
import http.client, socket, ssl, sys
from urllib.parse import urlsplit
source, endpoint = sys.argv[1:]
hostname = urlsplit(endpoint).hostname
class Ipv6Connection(http.client.HTTPSConnection):
    def connect(self):
        for family, kind, protocol, _, address in socket.getaddrinfo(self.host, 443, socket.AF_INET6, socket.SOCK_STREAM):
            channel = socket.socket(family, kind, protocol)
            channel.settimeout(4)
            try:
                channel.bind((source, 0))
                channel.connect(address)
                self.sock = self._context.wrap_socket(channel, server_hostname=self.host)
                return
            except OSError:
                channel.close()
        raise OSError('IPv6 connection failed')
connection = Ipv6Connection(hostname, timeout=4, context=ssl.create_default_context())
try:
    connection.request('GET', '/', headers={'Connection': 'close'})
    reply = connection.getresponse()
    body = reply.read(65)
    if reply.status != 200 or len(body) > 64: raise OSError('Invalid IPv6 echo response')
    print(body.decode('ascii').strip())
finally:
    connection.close()
PY
    fi
  ) || continue
  printf 'IPV6_SOURCE:%s\\n' "$observed"
  exit 0
done
exit 78
`
}

export async function verifyDedicatedIpv6FromGuest(client: IncusClient, name: string, mapping: DedicatedIpv6Mapping,
  port: number, expectedFingerprints: string[]): Promise<void> {
  if (!expectedFingerprints.length) throw new PublicIpv6SyncError('IPV6_IDENTITY_UNAVAILABLE')
  const result = await execWithOutput(client, name, ['sh', '-c', dedicatedIpv6ProbeScript(mapping, port)], {}, 25000)
  const code = (result.metadata as { return?: number } | null)?.return
  validateDedicatedIpv6Probe(code, result.stdout, mapping.publicIp, expectedFingerprints)
}

export function validateDedicatedIpv6Probe(code: number | undefined, output: string, expectedSource: string, expectedFingerprints: string[]): void {
  if (code === 76) throw new PublicIpv6SyncError('IPV6_GUEST_PROBE_UNAVAILABLE')
  if (code === 77) throw new PublicIpv6SyncError('IPV6_GUEST_SSH_FAILED')
  if (code !== 0) throw new PublicIpv6SyncError('IPV6_GUEST_EGRESS_FAILED')
  if (output.length > 8192) throw new PublicIpv6SyncError('IPV6_GUEST_EGRESS_FAILED')
  const fingerprints = output.match(/SHA256:[A-Za-z0-9+/]+/g) ?? []
  if (!fingerprints.length || fingerprints.some(value => !expectedFingerprints.includes(value)) ||
    !output.split('\n').includes('SSH_KEY_EXCHANGE_OK')) throw new PublicIpv6SyncError('IPV6_IDENTITY_MISMATCH')
  const source = /^IPV6_SOURCE:([^\r\n]+)$/m.exec(output)?.[1]
  if (!publicIpv6(expectedSource) || publicIpv6(source) !== publicIpv6(expectedSource)) throw new PublicIpv6SyncError('IPV6_SOURCE_MISMATCH')
}
