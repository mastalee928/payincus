#!/usr/bin/env python3
"""Refresh only the existing managed WireGuard peer's DNS endpoint.

No remote configuration is accepted. Local root-owned onboarding identity,
private key, peer identity, port and management routes remain authoritative.
"""
import base64
import fcntl
import ipaddress
import json
import os
import re
import stat
import subprocess
import sys
import time
import tempfile
from pathlib import Path

CONFIG = Path('/etc/wireguard/incudal-mgmt.conf')
IDENTITY = Path('/etc/incudal-onboarding-id')
ENROLLMENT = Path('/etc/incudal-gateway-dns.json')


def strict_object(pairs):
    result = {}
    for name, value in pairs:
        require(name not in result)
        result[name] = value
    return result


def require(value):
    if not value:
        raise ValueError('HOST_GATEWAY_ENDPOINT_REJECTED')


def protected(path, limit):
    for parent in path.parents:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        info = os.fstat(handle.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and not info.st_mode & 0o077 and info.st_size <= limit)
        value = handle.read(limit + 1)
        require(len(value) <= limit)
        return value.decode()


def public_ipv4(value):
    address = ipaddress.IPv4Address(value)
    require(str(address) == value and address.is_global and not address.is_multicast)
    return value


def endpoint(value):
    match = re.fullmatch(r'([a-zA-Z0-9.-]+):([0-9]{1,5})', value)
    require(match and 1 <= int(match[2]) <= 65535)
    host = match[1].lower()
    if re.fullmatch(r'[0-9.]+', host):
        public_ipv4(host)
    else:
        require(1 < len(host.split('.')) and len(host) <= 253 and not host.endswith(('.local', '.localhost', '.internal', '.invalid', '.test')) and
                all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in host.split('.')))
    return host, int(match[2])


def key(value):
    require(re.fullmatch(r'[A-Za-z0-9+/]{43}=', value))
    decoded = base64.b64decode(value, validate=True)
    require(len(decoded) == 32 and any(decoded) and base64.b64encode(decoded).decode() == value)
    return value


def configuration(raw):
    sections = {'Interface': {}, 'Peer': {}}
    current = None
    seen = set()
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line in ['[Interface]', '[Peer]']:
            current = line[1:-1]
            require(current not in seen)
            seen.add(current)
            continue
        require(current and '=' in line)
        name, value = (part.strip() for part in line.split('=', 1))
        allowed = ['PrivateKey', 'Address', 'MTU', 'ListenPort'] if current == 'Interface' else ['PublicKey', 'Endpoint', 'AllowedIPs', 'PersistentKeepalive', 'PresharedKey']
        require(name in allowed and name not in sections[current] and value)
        sections[current][name] = value
    require(seen == {'Interface', 'Peer'})
    interface, peer = sections['Interface'], sections['Peer']
    require(all(name in interface for name in ['PrivateKey', 'Address']) and all(name in peer for name in ['PublicKey', 'Endpoint', 'AllowedIPs']))
    key(interface['PrivateKey'])
    key(peer['PublicKey'])
    if 'PresharedKey' in peer:
        key(peer['PresharedKey'])
    local = ipaddress.IPv4Interface(interface['Address'])
    control = ipaddress.IPv4Network(peer['AllowedIPs'])
    require(local.network.prefixlen == 32 and control.prefixlen == 32 and str(local.ip).startswith('10.') and
            str(control.network_address).startswith('10.') and local.ip != control.network_address)
    host, port = endpoint(peer['Endpoint'])
    return {'privateKey': interface['PrivateKey'], 'publicKey': peer['PublicKey'], 'host': host, 'port': port,
            'localAddress': str(local), 'allowedIp': str(control)}


def binding(config, node_id, execute):
    local_public = execute('/usr/bin/wg', ['pubkey'], (config['privateKey'] + '\n').encode())
    key(local_public)
    return {'schemaVersion': 1, 'nodeId': node_id, 'localPublicKey': local_public, 'peerPublicKey': config['publicKey'],
            'localAddress': config['localAddress'], 'allowedIp': config['allowedIp'], 'hostname': config['host'], 'port': config['port']}


def validate_enrollment(value):
    require(isinstance(value, dict) and set(value) == {'schemaVersion', 'nodeId', 'localPublicKey', 'peerPublicKey', 'localAddress', 'allowedIp', 'hostname', 'port'})
    require(type(value['schemaVersion']) is int and value['schemaVersion'] == 1 and
            isinstance(value['nodeId'], str) and re.fullmatch(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}', value['nodeId']))
    key(value['localPublicKey']); key(value['peerPublicKey'])
    require(type(value['port']) is int and isinstance(value['hostname'], str))
    host, port = endpoint(value['hostname'] + ':' + str(value['port']))
    require(host == value['hostname'] and port == value['port'] and not re.fullmatch(r'[0-9.]+', host))
    local = ipaddress.IPv4Interface(value['localAddress']); control = ipaddress.IPv4Network(value['allowedIp'])
    require(str(local) == value['localAddress'] and str(control) == value['allowedIp'] and local.network.prefixlen == 32 and control.prefixlen == 32 and
            str(local.ip).startswith('10.') and str(control.network_address).startswith('10.') and local.ip != control.network_address)
    return value


def atomic_file(path, value):
    # The parent and destination are checked before publishing; the destination
    # can never redirect the replacement to a symlink target.
    for parent in path.parents:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)
    descriptor, temporary = tempfile.mkstemp(prefix='.incudal-dns-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(value.encode()); handle.flush(); os.fsync(handle.fileno())
        if path.exists() or path.is_symlink():
            protected(path, 16384)
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_DIRECTORY | os.O_RDONLY | os.O_NOFOLLOW)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def enroll(value, config_path=CONFIG, identity_path=IDENTITY, enrollment_path=ENROLLMENT, execute=None):
    execute = execute or command
    desired = validate_enrollment(value)
    node_id = protected(identity_path, 64).strip()
    original = protected(config_path, 16384)
    config = configuration(original)
    current = binding(config, node_id, execute)
    require(all(current[name] == desired[name] for name in ['schemaVersion', 'nodeId', 'localPublicKey', 'peerPublicKey', 'localAddress', 'allowedIp', 'port']))
    if enrollment_path.exists() or enrollment_path.is_symlink():
        saved = validate_enrollment(json.loads(protected(enrollment_path, 4096), object_pairs_hook=strict_object))
        # Re-enrollment cannot replace trust or silently change the permanent
        # domain. A partial old request may resume publishing its own endpoint.
        require(saved == desired)
        require(config['host'] == desired['hostname'] or re.fullmatch(r'[0-9.]+', config['host']))
    require(protected(config_path, 16384) == original and protected(identity_path, 64).strip() == node_id)
    # Publish the durable binding first. A crash before config replacement fails
    # closed in the daemon and the same explicit request can finish the update.
    atomic_file(enrollment_path, json.dumps(desired, separators=(',', ':')))
    updated, count = re.subn(r'(?m)^(\s*Endpoint\s*=\s*)[^\r\n]+$', lambda match: match[1] + desired['hostname'] + ':' + str(desired['port']), original)
    require(count == 1)
    if updated != original: atomic_file(config_path, updated)
    return {'enrolled': True, 'configurationChanged': updated != original, 'keysAndRoutesPreserved': True}


def command(program, args, data=None):
    result = subprocess.run([program, *args], input=data, capture_output=True, timeout=10, check=False,
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'})
    require(result.returncode == 0 and len(result.stdout) <= 16384)
    return result.stdout.decode().strip()


def resolve(host):
    # A separate process makes libc DNS resolution bounded even during outages.
    program = "import json,socket,sys;print(json.dumps(sorted(set(x[4][0] for x in socket.getaddrinfo(sys.argv[1],None,socket.AF_INET,socket.SOCK_DGRAM)))))"
    result = subprocess.run([sys.executable, '-I', '-c', program, host], capture_output=True, timeout=8, check=False,
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'})
    require(result.returncode == 0 and len(result.stdout) <= 4096)
    values = json.loads(result.stdout)
    require(isinstance(values, list) and len(values) == 1)
    return public_ipv4(values[0])


def refresh(config_path=CONFIG, identity_path=IDENTITY, execute=command, lookup=resolve, enrollment_path=ENROLLMENT):
    identity = protected(identity_path, 64).strip()
    require(re.fullmatch(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}', identity))
    original = protected(config_path, 16384)
    config = configuration(original)
    if re.fullmatch(r'[0-9.]+', config['host']):
        return {'refreshed': False, 'reason': 'literal-ip', 'customerRoutesChanged': False}
    enrolled = validate_enrollment(json.loads(protected(enrollment_path, 4096), object_pairs_hook=strict_object))
    require(binding(config, identity, execute) == enrolled)
    resolved = lookup(config['host'])
    public_ipv4(resolved)
    local_public = execute('/usr/bin/wg', ['pubkey'], (config['privateKey'] + '\n').encode())
    require(execute('/usr/bin/wg', ['show', 'incudal-mgmt', 'public-key']) == local_public)
    require(execute('/usr/bin/wg', ['show', 'incudal-mgmt', 'peers']) == config['publicKey'])
    require(execute('/usr/bin/wg', ['show', 'incudal-mgmt', 'allowed-ips']).split() == [config['publicKey'], config['allowedIp']])
    addresses = json.loads(execute('/sbin/ip', ['-j', '-4', 'address', 'show', 'dev', 'incudal-mgmt']))
    require(isinstance(addresses, list) and len(addresses) == 1 and
            [(row.get('local'), row.get('prefixlen')) for row in addresses[0].get('addr_info', []) if row.get('family') == 'inet'] ==
            [(config['localAddress'].split('/')[0], 32)])
    existing = execute('/usr/bin/wg', ['show', 'incudal-mgmt', 'endpoints'])
    fields = existing.split()
    require(len(existing.splitlines()) == 1 and len(fields) == 2 and fields[0] == config['publicKey'])
    desired = resolved + ':' + str(config['port'])
    require(protected(config_path, 16384) == original and protected(identity_path, 64).strip() == identity)
    if fields[1] != desired:
        execute('/usr/bin/wg', ['set', 'incudal-mgmt', 'peer', config['publicKey'], 'endpoint', desired])
    return {'refreshed': True, 'endpointChanged': fields[1] != desired, 'customerRoutesChanged': False}


def main():
    try:
        require(os.geteuid() == 0 and sys.argv[1:] in [[], ['--serve'], ['--enroll']])
        lock = os.open('/run/incudal-gateway-dns.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        try:
            info = os.fstat(lock)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if sys.argv[1:] == ['--enroll']:
                raw = sys.stdin.buffer.read(4097); require(len(raw) <= 4096)
                print(json.dumps(enroll(json.loads(raw, object_pairs_hook=strict_object)), separators=(',', ':')))
                return 0
            while True:
                try:
                    result = refresh()
                    if '--serve' not in sys.argv or result.get('endpointChanged'):
                        print(json.dumps(result, separators=(',', ':')), flush=True)
                except (ValueError, OSError, KeyError, IndexError, TypeError, subprocess.SubprocessError):
                    print('{"code":"HOST_GATEWAY_DNS_REFRESH_FAILED","existingConfigurationPreserved":true}', flush=True)
                    if '--serve' not in sys.argv:
                        return 1
                if '--serve' not in sys.argv:
                    return 0
                time.sleep(30)
        finally:
            os.close(lock)
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError):
        print('{"code":"HOST_GATEWAY_DNS_REFRESH_REJECTED"}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
