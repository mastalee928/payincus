#!/usr/bin/env python3
"""Refresh the fixed legacy gateway helpers over an already pinned root session.

No keys, reservations, peers, customer rules or service state are rewritten.
The application key remains restricted to the existing forced-command entry.
"""
import base64
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import time

STATE = Path('/var/lib/incudal-onboarding')
HELPER = Path('/usr/local/sbin/incudal-onboarding-gateway')
TOOLS = Path('/usr/local/libexec/incudal-onboarding-dns')
NAMES = {'onboarding-gateway.py', 'refresh-host-gateway-endpoint.py', 'install-host-gateway-dns.sh', 'alpine-ssh-security.sh', 'host-security-maintenance.py'}
IDENTITY = {'publicKey', 'controlIp', 'network', 'managementSshPublicKey'}
DEADLINE = None


def require(value, code='GATEWAY_DNS_UPGRADE_FAILED'):
    if not value:
        raise ValueError(code)


def checkpoint():
    require(DEADLINE is None or time.monotonic() < DEADLINE, 'GATEWAY_DNS_UPGRADE_TIMEOUT')


def directories(path):
    for current in reversed([path, *path.parents]):
        info = current.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'GATEWAY_DNS_UNSAFE_FILE')


def read(path, limit=65536):
    directories(path.parent)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as handle:
        info = os.fstat(handle.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and not info.st_mode & 0o022 and info.st_size <= limit,
                'GATEWAY_DNS_UNSAFE_FILE')
        raw = handle.read(limit + 1)
        require(len(raw) <= limit, 'GATEWAY_DNS_UNSAFE_FILE')
        return raw


def command(args):
    checkpoint()
    timeout = min(20, max(0.001, DEADLINE - time.monotonic())) if DEADLINE is not None else 20
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout, check=False,
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'})
    except subprocess.TimeoutExpired:
        raise ValueError('GATEWAY_DNS_UPGRADE_TIMEOUT') from None
    checkpoint()
    require(result.returncode == 0 and len(result.stdout) <= 4 * 1024 * 1024)
    return result.stdout


def identity():
    addresses = json.loads(command(['/usr/sbin/ip', '-j', '-4', 'addr', 'show', 'dev', 'incudal-mgmt']))[0]['addr_info']
    row = next(value for value in addresses if value['family'] == 'inet')
    address = ipaddress.ip_interface(str(row['local']) + '/' + str(row['prefixlen']))
    key = read(Path('/root/.ssh/incudal-host-management.pub'), 1024).decode().split()
    return {'publicKey': command(['/usr/bin/wg', 'show', 'incudal-mgmt', 'public-key']).decode().strip(),
            'controlIp': str(address.ip), 'network': str(address.network), 'managementSshPublicKey': ' '.join(key[:2])}


def snapshot():
    files = [Path('/etc/wireguard/incudal-mgmt.conf'), Path('/root/.ssh/incudal-host-management'),
             Path('/root/.ssh/incudal-host-management.pub'), Path('/root/.ssh/authorized_keys'), *sorted(STATE.glob('*.json'))]
    result = {str(path): hashlib.sha256(read(path, 4 * 1024 * 1024)).hexdigest() for path in files}
    for field in ['public-key', 'listen-port', 'peers', 'allowed-ips']:
        result[field] = hashlib.sha256(command(['/usr/bin/wg', 'show', 'incudal-mgmt', field])).hexdigest()
    return result


def publish(path, content, mode):
    checkpoint()
    directories(path.parent)
    if path.exists() or path.is_symlink():
        read(path, 131072)
    fd, temporary = tempfile.mkstemp(prefix='.incudal-dns-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            os.fchmod(handle.fileno(), mode); handle.write(content); handle.flush(); os.fsync(handle.fileno())
        checkpoint()
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def upgrade(request):
    global DEADLINE
    DEADLINE = time.monotonic() + 30
    require(type(request) is dict and set(request) == {'identity', 'sources'} and type(request['identity']) is dict and
            set(request['identity']) == IDENTITY and type(request['sources']) is dict and set(request['sources']) == NAMES)
    sources = {}
    for name, value in request['sources'].items():
        require(type(value) is str and len(value) <= 174764)
        raw = base64.b64decode(value, validate=True)
        # Python accepts CRLF during compilation, but a Linux shebang does not.
        # Reject noncanonical scripts before any identity reads or publication.
        require(0 < len(raw) <= 131072 and b'\0' not in raw and b'\r' not in raw)
        if name.endswith('.py'):
            compile(raw, name, 'exec')
        sources[name] = raw
    directories(STATE); read(HELPER, 131072)
    lock = os.open(STATE / 'lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(lock)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and not info.st_mode & 0o077,
                'GATEWAY_DNS_UNSAFE_FILE')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('GATEWAY_DNS_SERVICE_BUSY') from None
        require(identity() == request['identity'], 'GATEWAY_DNS_HOST_IDENTITY_CHANGED')
        before = snapshot()
        directories(TOOLS.parent)
        if not TOOLS.exists() and not TOOLS.is_symlink():
            TOOLS.mkdir(mode=0o755)
        directories(TOOLS)
        # Publish the protocol-advertising entry point last. Interrupted copies
        # leave the old protocol visible and can be resumed with the same pin.
        for name in ['refresh-host-gateway-endpoint.py', 'install-host-gateway-dns.sh', 'alpine-ssh-security.sh', 'host-security-maintenance.py', 'onboarding-gateway.py']:
            checkpoint()
            target = HELPER if name == 'onboarding-gateway.py' else TOOLS / name
            publish(target, sources[name], 0o755 if target == HELPER else 0o644)
        require(identity() == request['identity'] and snapshot() == before, 'GATEWAY_DNS_HOST_IDENTITY_CHANGED')
        require(all(read(HELPER if name == 'onboarding-gateway.py' else TOOLS / name, 131072) == raw for name, raw in sources.items()))
        return {'dnsProtocolVersion': 2, 'keysAndRoutesPreserved': True}
    finally:
        os.close(lock)
