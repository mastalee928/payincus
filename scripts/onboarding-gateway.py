#!/usr/bin/env python3
"""Restricted SSH forced-command helper for the Incudal management gateway.

Authorize a dedicated key with:
restrict,command="/usr/local/sbin/incudal-onboarding-gateway" ssh-ed25519 ...
Only status, peer registration, fixed DNS installation and enrolled-host identity probes are supported.
"""
import fcntl
import ipaddress
import json
import os
import pathlib
import re
import shlex
import subprocess
import tempfile
import time
import hashlib
import base64
import sys
import stat

INTERFACE = "incudal-mgmt"
CONFIG = pathlib.Path("/etc/wireguard") / (INTERFACE + ".conf")
STATE = pathlib.Path("/var/lib/incudal-onboarding")
MANAGEMENT_PUBLIC_KEY = pathlib.Path("/root/.ssh/incudal-host-management.pub")
DNS_TOOLS = pathlib.Path('/usr/local/libexec/incudal-onboarding-dns')


class GatewayOperationError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def verified_host_scan(scan, fingerprint):
    known = []
    for line in scan.stdout.decode().splitlines():
        fields = line.split()
        if len(fields) != 3 or fields[1] not in ['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256']:
            continue
        actual = 'SHA256:' + base64.b64encode(hashlib.sha256(base64.b64decode(fields[2], validate=True)).digest()).decode().rstrip('=')
        if actual == fingerprint:
            known.append(line)
    if not scan.stdout.strip():
        raise GatewayOperationError('GATEWAY_DNS_HOST_UNREACHABLE')
    if len(known) != 1:
        raise GatewayOperationError('GATEWAY_DNS_HOST_IDENTITY_CHANGED')
    return known


def strict_json(pairs):
    result = {}
    for name, value in pairs:
        if name in result: raise ValueError('duplicate input field')
        result[name] = value
    return result


def install_host_dns(job, control, gateway_public):
    # A fixed one-hop operation, restricted to a previously reserved management
    # /32. It never connects to the host's customer-facing public SSH port.
    raw = sys.stdin.buffer.read(2049)
    if len(raw) > 2048: raise ValueError('input too large')
    request = json.loads(raw, object_pairs_hook=strict_json)
    if not isinstance(request, dict) or set(request) != {'hostname', 'port', 'sshPort', 'sshFingerprint', 'nodePublicKey'}: raise ValueError('invalid DNS request')
    domain = request['hostname']
    if not isinstance(domain, str) or len(domain) > 253 or domain != domain.lower() or not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?', domain): raise ValueError('invalid domain')
    if domain.endswith(('.localhost', '.local', '.internal', '.invalid', '.test')): raise ValueError('nonpublic domain')
    if any(type(request[name]) is not int or not 1 <= request[name] <= 65535 for name in ['port', 'sshPort']): raise ValueError('invalid port')
    if not isinstance(request['sshFingerprint'], str) or not re.fullmatch(r'SHA256:[A-Za-z0-9+/]{43}', request['sshFingerprint']): raise ValueError('invalid fingerprint')
    reservation = STATE / (job + '.json')
    for parent in [reservation, *reservation.parents]:
        info = parent.lstat()
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022: raise ValueError('untrusted management reservation')
    if not reservation.is_file() or reservation.stat().st_size > 4096 or reservation.stat().st_nlink != 1: raise ValueError('invalid management reservation')
    saved = json.loads(reservation.read_text(), object_pairs_hook=strict_json)
    address = ipaddress.IPv4Address(saved['managementIp'])
    if address not in control.network or address in (control.ip, control.network.network_address, control.network.broadcast_address): raise ValueError('invalid management target')
    peer_key = saved['nodePublicKey']
    if not re.fullmatch(r'[A-Za-z0-9+/]{43}=', peer_key) or request['nodePublicKey'] != peer_key: raise ValueError('invalid peer identity')
    if run('wg', 'show', INTERFACE, 'listen-port') != str(request['port']): raise ValueError('gateway port conflict')
    allowed = dict(line.split(maxsplit=1) for line in run('wg', 'show', INTERFACE, 'allowed-ips').splitlines())
    if allowed.get(peer_key) != str(address) + '/32': raise ValueError('management route conflict')
    files = {}
    for name in ['refresh-host-gateway-endpoint.py', 'install-host-gateway-dns.sh']:
        path = DNS_TOOLS / name
        for parent in [path, *path.parents]:
            info = parent.lstat()
            if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022: raise ValueError('untrusted DNS tool')
        if not path.is_file() or path.stat().st_size > 65536: raise ValueError('invalid DNS tool')
        files[name] = path.read_bytes()
    scan = subprocess.run(['ssh-keyscan', '-T', '5', '-p', str(request['sshPort']), '-t', 'ed25519,rsa,ecdsa', str(address)], capture_output=True, timeout=15, check=False)
    known = verified_host_scan(scan, request['sshFingerprint'])
    binding = {'schemaVersion': 1, 'nodeId': job, 'localPublicKey': peer_key, 'peerPublicKey': gateway_public,
               'localAddress': str(address) + '/32', 'allowedIp': str(control.ip) + '/32', 'hostname': domain, 'port': request['port']}
    with tempfile.TemporaryDirectory(prefix='incudal-host-dns-', dir='/root') as directory:
        trust = pathlib.Path(directory) / 'known_hosts'; trust.write_text(known[0] + '\n'); trust.chmod(0o600)
        # Base64 contains no shell metacharacters. Only fixed trusted release
        # files and the strict JSON binding are transported, never user scripts.
        script = 'set -eu\numask 077\nd=$(mktemp -d /root/incudal-dns-install-XXXXXX)\ntrap \'rm -f "$d/refresh-host-gateway-endpoint.py" "$d/install-host-gateway-dns.sh"; rmdir "$d"\' EXIT\n'
        for name, content in files.items():
            script += "printf '%s' '" + base64.b64encode(content).decode() + "' | base64 -d > \"$d/" + name + '\"\n'
        script += "printf '%s' '" + base64.b64encode(json.dumps(binding, separators=(',', ':')).encode()).decode() + "' | base64 -d | bash \"$d/install-host-gateway-dns.sh\"\n"
        result = subprocess.run(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'GlobalKnownHostsFile=/dev/null',
                                 '-o', 'UserKnownHostsFile=' + str(trust), '-o', 'ConnectTimeout=10', '-o', 'IdentitiesOnly=yes',
                                 '-i', str(MANAGEMENT_PUBLIC_KEY.with_suffix('')), '-p', str(request['sshPort']), 'root@' + str(address), 'sh -s'],
                                input=script.encode(), capture_output=True, timeout=90, check=False)
        if result.returncode != 0:
            if b'"code":"HOST_GATEWAY_DNS_SERVICE_BUSY"' in result.stdout:
                raise GatewayOperationError('GATEWAY_DNS_SERVICE_BUSY')
            raise GatewayOperationError('GATEWAY_DNS_INSTALL_FAILED')
        if b'Existing gateway DNS refresh enabled' not in result.stdout: raise ValueError('missing DNS install receipt')
    return {'nodeId': job, 'dnsRefreshInstalled': True, 'endpoint': domain + ':' + str(request['port']), 'keysAndRoutesPreserved': True}


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL).strip()


def probe_host(job, control):
    raw = sys.stdin.buffer.read(2049)
    if len(raw) > 2048: raise ValueError('input too large')
    request = json.loads(raw, object_pairs_hook=strict_json)
    if not isinstance(request, dict) or set(request) != {'sshPort', 'sshFingerprint', 'nodePublicKey'}: raise ValueError('invalid probe request')
    if type(request['sshPort']) is not int or not 1 <= request['sshPort'] <= 65535: raise ValueError('invalid port')
    if not isinstance(request['sshFingerprint'], str) or not re.fullmatch(r'SHA256:[A-Za-z0-9+/]{43}', request['sshFingerprint']): raise ValueError('invalid fingerprint')
    reservation = STATE / (job + '.json')
    for path in [reservation, *reservation.parents]:
        info = path.lstat()
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022: raise ValueError('untrusted reservation')
    if not reservation.is_file() or reservation.stat().st_size > 4096 or reservation.stat().st_nlink != 1: raise ValueError('invalid reservation')
    saved = json.loads(reservation.read_text(), object_pairs_hook=strict_json)
    address = ipaddress.IPv4Address(saved['managementIp'])
    if address not in control.network or address in (control.ip, control.network.network_address, control.network.broadcast_address): raise ValueError('invalid target')
    peer = saved['nodePublicKey']
    if not re.fullmatch(r'[A-Za-z0-9+/]{43}=', peer) or request['nodePublicKey'] != peer: raise ValueError('peer mismatch')
    allowed = dict(line.split(maxsplit=1) for line in run('wg', 'show', INTERFACE, 'allowed-ips').splitlines())
    if allowed.get(peer) != str(address) + '/32': raise ValueError('route mismatch')
    scan = subprocess.run(['ssh-keyscan', '-T', '5', '-p', str(request['sshPort']), '-t', 'ed25519,rsa,ecdsa', str(address)], capture_output=True, timeout=15, check=False)
    known = verified_host_scan(scan, request['sshFingerprint'])
    with tempfile.TemporaryDirectory(prefix='incudal-host-probe-', dir='/root') as directory:
        trust = pathlib.Path(directory) / 'known_hosts'; trust.write_text(known[0] + '\n'); trust.chmod(0o600)
        result = subprocess.run(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'GlobalKnownHostsFile=/dev/null',
                                 '-o', 'UserKnownHostsFile=' + str(trust), '-o', 'ConnectTimeout=8', '-o', 'IdentitiesOnly=yes',
                                 '-i', str(MANAGEMENT_PUBLIC_KEY.with_suffix('')), '-p', str(request['sshPort']), 'root@' + str(address),
                                 'head -c64 /etc/incudal-onboarding-id'], capture_output=True, timeout=15, check=False)
        if result.returncode or result.stdout.decode().strip() != job: raise ValueError('host identity mismatch')
    return {'nodeId': job, 'sshIdentityVerified': True, 'keysAndRoutesPreserved': True}


def atomic_write(path, content):
    fd, temp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w") as file:
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def ipv4_networks(value):
    return [network for item in re.split(r"[\s,]+", value.strip()) if item and item != "(none)"
            for network in [ipaddress.ip_network(item)] if network.version == 4]


def configured_peers(config):
    peers = {}
    for section in re.split(r"(?m)^\s*\[Peer\]\s*$", config)[1:]:
        fields = {}
        for line in section.splitlines():
            line = line.split("#", 1)[0].strip()
            if line.startswith("["):
                break
            if "=" in line:
                key, value = line.split("=", 1)
                fields[key.strip()] = value.strip()
        if fields.get("PublicKey"):
            key = fields["PublicKey"]
            if key in peers:
                raise ValueError("duplicate configured peer")
            peers[key] = ipv4_networks(fields.get("AllowedIPs", ""))
    return peers


def register_peer(job, public_key, control, config, live_peers):
    peer_file = STATE / (job + ".json")
    peers = configured_peers(config)
    for key, subnets in live_peers.items():
        peers.setdefault(key, []).extend(subnets)
    reservations = {}
    for path in STATE.glob("*.json"):
        saved = json.loads(path.read_text())
        reservations[path.stem] = saved
        if path != peer_file and saved["nodePublicKey"] == public_key:
            raise ValueError("peer key already registered")
    occupied = [subnet for key, subnets in peers.items() if key != public_key for subnet in subnets]
    occupied.extend(ipaddress.ip_network(saved["managementIp"] + "/32")
                    for key, saved in reservations.items() if key != job)
    if job in reservations:
        saved = reservations[job]
        if saved["nodePublicKey"] != public_key:
            raise ValueError("peer key changed")
        target = ipaddress.ip_address(saved["managementIp"])
        if target not in control.network or target in (control.ip, control.network.network_address, control.network.broadcast_address):
            raise ValueError("invalid reserved address")
        if any(target in subnet for subnet in occupied):
            raise ValueError("peer address is occupied")
    else:
        if public_key in peers:
            raise ValueError("peer already belongs to another registration")
        target = next((ip for ip in control.network.hosts() if ip != control.ip and not any(ip in net for net in occupied)), None)
        if target is None:
            raise ValueError("management network full")
    marker = "# incudal-onboarding " + job
    block = marker + "\n[Peer]\nPublicKey = " + public_key + "\nAllowedIPs = " + str(target) + "/32\n"
    if marker in config and block not in config:
        raise ValueError("registered configuration changed")
    # Reserve durably before changing WireGuard. A crash at any later step can
    # resume this same address, even if the peer is absent from the live device.
    atomic_write(peer_file, json.dumps({"managementIp": str(target), "nodePublicKey": public_key}))
    if marker not in config:
        atomic_write(CONFIG, config.rstrip() + "\n\n" + block)
    run("wg", "set", INTERFACE, "peer", public_key, "allowed-ips", str(target) + "/32")
    return str(target)


def peer_status(control):
    # Never use `wg show dump`: its first row includes the interface private key.
    endpoints = dict(line.split(maxsplit=1) for line in run("wg", "show", INTERFACE, "endpoints").splitlines() if line.strip())
    handshakes = dict(line.split(maxsplit=1) for line in run("wg", "show", INTERFACE, "latest-handshakes").splitlines() if line.strip())
    allowed = {line.split(maxsplit=1)[0]: ipv4_networks(line.split(maxsplit=1)[1])
               for line in run("wg", "show", INTERFACE, "allowed-ips").splitlines() if line.strip()}
    result = []
    now = int(time.time())
    for path in sorted(STATE.glob("*.json")):
        if not re.fullmatch(r"[a-f0-9-]{36}", path.stem):
            continue
        saved = json.loads(path.read_text())
        address = ipaddress.ip_address(saved["managementIp"])
        key = saved["nodePublicKey"]
        if address not in control.network or address == control.ip or allowed.get(key) != [ipaddress.ip_network(str(address) + "/32")]:
            continue
        endpoint = endpoints.get(key, "")
        match = re.fullmatch(r"([0-9.]+):([0-9]{1,5})", endpoint)
        public_ip = None
        if match and 1 <= int(match[2]) <= 65535:
            parsed = ipaddress.ip_address(match[1])
            if parsed.version == 4 and parsed.is_global and not parsed.is_multicast:
                public_ip = str(parsed)
        handshake = int(handshakes.get(key, "0"))
        result.append({"nodeId": path.stem, "managementIp": str(address), "publicIp": public_ip,
                       "lastHandshakeAt": handshake if 0 < handshake <= now + 30 else 0})
    return result


def main():
    os.umask(0o077)
    args = shlex.split(os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    dns_request = len(args) == 2 and args[0] == 'dns' and re.fullmatch(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}', args[1])
    probe_request = len(args) == 2 and args[0] == 'probe' and re.fullmatch(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}', args[1])
    if args not in (["status"], ["peers"]) and not dns_request and not probe_request and not (len(args) == 3 and args[0] == "add" and re.fullmatch(r"[a-f0-9-]{36}", args[1]) and re.fullmatch(r"[A-Za-z0-9+/]{43}=", args[2])):
        raise ValueError("unsupported operation")
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(STATE / "lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        addresses = json.loads(run("ip", "-j", "-4", "addr", "show", "dev", INTERFACE))[0]["addr_info"]
        address = next(a for a in addresses if a["family"] == "inet")
        control = ipaddress.ip_interface(str(address["local"]) + "/" + str(address["prefixlen"]))
        if not control.ip in ipaddress.ip_network("10.0.0.0/8") or not 16 <= control.network.prefixlen <= 30:
            raise ValueError("unsupported management network")
        public_key_parts = MANAGEMENT_PUBLIC_KEY.read_text().split()
        if len(public_key_parts) < 2 or public_key_parts[0] != "ssh-ed25519" or not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", public_key_parts[1]):
            raise ValueError("management public key missing")
        result = {"publicKey": run("wg", "show", INTERFACE, "public-key"), "controlIp": str(control.ip),
                  "network": str(control.network), "managementSshPublicKey": " ".join(public_key_parts[:2])}
        if dns_request:
            # DNS installation reads the reservation and validates exact peer
            # identity; it does not mutate the controller's peers. Do not hold
            # the global gateway lock across slow per-host SSH installations.
            fcntl.flock(lock, fcntl.LOCK_UN)
            print(json.dumps(install_host_dns(args[1], control, result['publicKey']))); return
        if probe_request:
            print(json.dumps(probe_host(args[1], control))); return
        if args[0] == "peers":
            result["peers"] = peer_status(control)
        if args[0] == "add":
            job, public_key = args[1:]
            peers = {}
            for line in run("wg", "show", INTERFACE, "allowed-ips").splitlines():
                fields = line.split(maxsplit=1)
                if len(fields) > 1:
                    peers[fields[0]] = ipv4_networks(fields[1])
            result["managementIp"] = register_peer(job, public_key, control, CONFIG.read_text(), peers)
        print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Fixed codes expose the failed step without keys or raw SSH output.
        code = error.code if isinstance(error, GatewayOperationError) else 'GATEWAY_OPERATION_FAILED'
        print('INCUDAL_ERROR:' + code)
        raise SystemExit(1)
