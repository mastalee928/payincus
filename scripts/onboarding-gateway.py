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


def read_protected_state(path, limit):
    for parent in [path, *path.parents]:
        info = parent.lstat()
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022:
            raise ValueError('untrusted recovery state')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_nlink != 1 or info.st_size > limit:
            raise ValueError('invalid recovery state')
        content = os.read(descriptor, limit + 1)
        if len(content) > limit: raise ValueError('invalid recovery state')
        return content
    finally:
        os.close(descriptor)


def install_host_dns(job, control, gateway_public):
    # A fixed one-hop operation, restricted to a previously reserved management
    # /32. It never connects to the host's customer-facing public SSH port.
    raw = sys.stdin.buffer.read(24577)
    if len(raw) > 24576: raise ValueError('input too large')
    request = json.loads(raw, object_pairs_hook=strict_json)
    fields = {'hostname', 'port', 'sshPort', 'sshFingerprint', 'nodePublicKey'}
    if not isinstance(request, dict) or set(request) not in [fields, fields | {'revision', 'previous'}]: raise ValueError('invalid DNS request')
    migrating = 'revision' in request
    if migrating and (type(request['revision']) is not int or not 0 <= request['revision'] < 2 ** 53 or
                      not isinstance(request['previous'], list) or len(request['previous']) > 64): raise ValueError('invalid DNS migration')
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
    try:
        scan = subprocess.run(['ssh-keyscan', '-T', '5', '-p', str(request['sshPort']), '-t', 'ed25519,rsa,ecdsa', str(address)], capture_output=True, timeout=15, check=False)
    except subprocess.TimeoutExpired:
        raise GatewayOperationError('GATEWAY_DNS_HOST_UNREACHABLE') from None
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
        payload = {'binding': binding, 'revision': request['revision'], 'previous': request['previous']} if migrating else binding
        script += "printf '%s' '" + base64.b64encode(json.dumps(payload, separators=(',', ':')).encode()).decode() + "' | base64 -d | bash \"$d/install-host-gateway-dns.sh\"" + (' --migrate' if migrating else '') + '\n'
        try:
            result = subprocess.run(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'GlobalKnownHostsFile=/dev/null',
                                     '-o', 'UserKnownHostsFile=' + str(trust), '-o', 'ConnectTimeout=10', '-o', 'IdentitiesOnly=yes',
                                     '-i', str(MANAGEMENT_PUBLIC_KEY.with_suffix('')), '-p', str(request['sshPort']), 'root@' + str(address), 'sh -s'],
                                    input=script.encode(), capture_output=True, timeout=90, check=False)
        except subprocess.TimeoutExpired:
            raise GatewayOperationError('SSH_COMMAND_TIMEOUT') from None
        if result.returncode != 0:
            if result.returncode == 255:
                if b'Permission denied' in result.stderr:
                    raise GatewayOperationError('GATEWAY_DNS_MANAGEMENT_AUTH_REQUIRED')
                if b'Host key verification failed' in result.stderr or b'REMOTE HOST IDENTIFICATION HAS CHANGED' in result.stderr:
                    raise GatewayOperationError('GATEWAY_DNS_HOST_IDENTITY_CHANGED')
                raise GatewayOperationError('GATEWAY_DNS_HOST_UNREACHABLE')
            if b'"code":"HOST_GATEWAY_DNS_SERVICE_BUSY"' in result.stdout:
                raise GatewayOperationError('GATEWAY_DNS_SERVICE_BUSY')
            if b'"code":"HOST_GATEWAY_DNS_LOOKUP_FAILED"' in result.stdout:
                raise GatewayOperationError('GATEWAY_DNS_LOOKUP_FAILED')
            if b'"code":"HOST_GATEWAY_DNS_RUNTIME_UNAVAILABLE"' in result.stdout:
                raise GatewayOperationError('GATEWAY_DNS_RUNTIME_UNAVAILABLE')
            raise GatewayOperationError('GATEWAY_DNS_INSTALL_FAILED')
        if b'Existing gateway DNS refresh enabled' not in result.stdout: raise ValueError('missing DNS install receipt')
    return {'nodeId': job, 'dnsRefreshInstalled': True, 'endpoint': domain + ':' + str(request['port']), 'keysAndRoutesPreserved': True,
            **({'revision': request['revision']} if migrating else {})}


def run(*args):
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=3).strip()
    except subprocess.TimeoutExpired:
        raise GatewayOperationError('SSH_COMMAND_TIMEOUT') from None
    except subprocess.CalledProcessError:
        raise GatewayOperationError('GATEWAY_RECOVERY_RUNTIME_UNAVAILABLE') from None


def probe_host(job, control):
    raw = sys.stdin.buffer.read(2049)
    if len(raw) > 2048: raise ValueError('input too large')
    request = json.loads(raw, object_pairs_hook=strict_json)
    if not isinstance(request, dict) or set(request) not in ({'sshPort', 'sshFingerprint', 'nodePublicKey'}, {'sshPort', 'sshFingerprint', 'nodePublicKey', 'portProtocol'}): raise ValueError('invalid probe request')
    if 'portProtocol' in request and request['portProtocol'] not in ('tcp', 'tcp_udp'): raise ValueError('invalid protocol')
    if type(request['sshPort']) is not int or not 1 <= request['sshPort'] <= 65535: raise ValueError('invalid port')
    if not isinstance(request['sshFingerprint'], str) or not re.fullmatch(r'SHA256:[A-Za-z0-9+/]{43}', request['sshFingerprint']): raise ValueError('invalid fingerprint')
    reservation = STATE / (job + '.json')
    if not reservation.exists(): raise GatewayOperationError('GATEWAY_RECOVERY_BINDING_MISSING')
    for path in [reservation, *reservation.parents]:
        info = path.lstat()
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022: raise ValueError('untrusted reservation')
    if not reservation.is_file() or reservation.stat().st_size > 4096 or reservation.stat().st_nlink != 1: raise ValueError('invalid reservation')
    saved = json.loads(reservation.read_text(), object_pairs_hook=strict_json)
    address = ipaddress.IPv4Address(saved['managementIp'])
    if address not in control.network or address in (control.ip, control.network.network_address, control.network.broadcast_address): raise ValueError('invalid target')
    peer = saved['nodePublicKey']
    if not re.fullmatch(r'[A-Za-z0-9+/]{43}=', peer) or request['nodePublicKey'] != peer: raise GatewayOperationError('GATEWAY_DNS_HOST_IDENTITY_CHANGED')
    allowed = dict(line.split(maxsplit=1) for line in run('wg', 'show', INTERFACE, 'allowed-ips').splitlines())
    if allowed.get(peer) != str(address) + '/32': raise GatewayOperationError('GATEWAY_RECOVERY_ROUTE_MISMATCH')
    scan = recovery_probe_process(['ssh-keyscan', '-T', '5', '-p', str(request['sshPort']), '-t', 'ed25519,rsa,ecdsa', str(address)])
    known = verified_host_scan(scan, request['sshFingerprint'])
    with tempfile.TemporaryDirectory(prefix='incudal-host-probe-', dir='/root') as directory:
        trust = pathlib.Path(directory) / 'known_hosts'; trust.write_text(known[0] + '\n'); trust.chmod(0o600)
        command = 'head -c64 /etc/incudal-onboarding-id'
        if 'portProtocol' in request:
            command += '; printf "\\n"; nft -j list table inet incudal_ingress_protocol'
        result = recovery_probe_process(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'GlobalKnownHostsFile=/dev/null',
                                 '-o', 'UserKnownHostsFile=' + str(trust), '-o', 'ConnectTimeout=8', '-o', 'IdentitiesOnly=yes',
                                 '-i', str(MANAGEMENT_PUBLIC_KEY.with_suffix('')), '-p', str(request['sshPort']), 'root@' + str(address),
                                 command])
        if result.returncode:
            if b'Permission denied' in result.stderr: raise GatewayOperationError('GATEWAY_DNS_MANAGEMENT_AUTH_REQUIRED')
            if b'Host key verification failed' in result.stderr or b'REMOTE HOST IDENTIFICATION HAS CHANGED' in result.stderr:
                raise GatewayOperationError('GATEWAY_DNS_HOST_IDENTITY_CHANGED')
            raise GatewayOperationError('GATEWAY_RECOVERY_HOST_UNREACHABLE')
        if len(result.stdout) > 65536: raise ValueError('probe response too large')
        identity, _, policy = result.stdout.decode().strip().partition('\n')
        if identity.strip() != job: raise GatewayOperationError('GATEWAY_DNS_HOST_IDENTITY_CHANGED')
        if 'portProtocol' in request:
            verify_recovery_port_protocol(json.loads(policy, object_pairs_hook=strict_json), request['portProtocol'])
    return {'nodeId': job, 'sshIdentityVerified': True, 'keysAndRoutesPreserved': True,
            **({'portProtocolVerified': request['portProtocol']} if 'portProtocol' in request else {})}


def verify_recovery_port_protocol(document, mode):
    """Read the actual dedicated-host filter; an old DB/Agent ack is insufficient."""
    code = 'OSS_RECOVERY_DELIVERY_PROTOCOL_PENDING'
    entries = document.get('nftables') if isinstance(document, dict) else None
    if not isinstance(entries, list) or len(entries) > 256: raise GatewayOperationError(code)
    chains = []; rules = []; tables = []
    for entry in entries:
        if not isinstance(entry, dict) or len(entry) != 1: raise GatewayOperationError(code)
        kind, value = next(iter(entry.items()))
        if kind == 'metainfo': continue
        if kind not in ('table', 'chain', 'rule') or not isinstance(value, dict): raise GatewayOperationError(code)
        if value.get('family') != 'inet': raise GatewayOperationError(code)
        if (value.get('name') if kind == 'table' else value.get('table')) != 'incudal_ingress_protocol': raise GatewayOperationError(code)
        {'table': tables, 'chain': chains, 'rule': rules}[kind].append(value)
    if len(tables) != 1 or len(chains) != 1: raise GatewayOperationError(code)
    chain = chains[0]
    if any(chain.get(k) != v for k, v in {'name':'forward', 'type':'filter', 'hook':'forward', 'prio':-20, 'policy':'accept'}.items()): raise GatewayOperationError(code)
    if mode == 'tcp_udp':
        if rules: raise GatewayOperationError(code)
        return
    if mode != 'tcp' or len(rules) != 1 or rules[0].get('chain') != 'forward': raise GatewayOperationError(code)
    expressions = rules[0].get('expr')
    if not isinstance(expressions, list): raise GatewayOperationError(code)
    normalized = []
    for expression in expressions:
        if isinstance(expression, dict) and set(expression) == {'counter'}: continue
        normalized.append(expression)
    wanted = [
        {'match': {'op':'!=', 'left':{'meta':{'key':'iifname'}}, 'right':'incusbr0'}},
        {'match': {'op':'==', 'left':{'meta':{'key':'oifname'}}, 'right':'incusbr0'}},
        {'match': {'op':'==', 'left':{'meta':{'key':'l4proto'}}, 'right':'udp'}},
        {'match': {'op':'==', 'left':{'ct':{'key':'direction'}}, 'right':'original'}},
        {'drop':None}
    ]
    if normalized != wanted: raise GatewayOperationError(code)


def recovery_probe_process(arguments):
    try:
        return subprocess.run(arguments, capture_output=True, timeout=15, check=False)
    except subprocess.TimeoutExpired:
        raise GatewayOperationError('SSH_COMMAND_TIMEOUT') from None


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


def repair_host_agent(job, control):
    """Fixed credential reconciliation for an already enrolled host, never a shell API."""
    raw = sys.stdin.buffer.read(4097)
    if len(raw) > 4096: raise ValueError('input too large')
    request = json.loads(raw, object_pairs_hook=strict_json)
    if not isinstance(request, dict) or set(request) != {'sshPort', 'sshFingerprint', 'nodePublicKey', 'agentId', 'agentSecret', 'expiresAt'}:
        raise ValueError('invalid agent repair')
    if type(request['expiresAt']) is not int or not time.time()*1000 < request['expiresAt'] <= time.time()*1000+30000: raise ValueError('expired repair')
    if type(request['sshPort']) is not int or not 1 <= request['sshPort'] <= 65535: raise ValueError('invalid port')
    if not isinstance(request['sshFingerprint'], str) or not re.fullmatch(r'SHA256:[A-Za-z0-9+/]{43}', request['sshFingerprint']): raise ValueError('invalid fingerprint')
    if not isinstance(request['agentId'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', request['agentId']): raise ValueError('invalid agent identity')
    if not isinstance(request['agentSecret'], str) or not re.fullmatch(r'ias_[A-Za-z0-9_-]{32,96}', request['agentSecret']): raise ValueError('invalid agent secret')
    reservation = STATE / (job + '.json')
    for path in [reservation, *reservation.parents]:
        info = path.lstat()
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022: raise ValueError('untrusted reservation')
    if not reservation.is_file() or reservation.stat().st_size > 4096 or reservation.stat().st_nlink != 1: raise ValueError('invalid reservation')
    saved = json.loads(reservation.read_text(), object_pairs_hook=strict_json)
    address = ipaddress.IPv4Address(saved['managementIp'])
    if address not in control.network or address in (control.ip, control.network.network_address, control.network.broadcast_address): raise ValueError('invalid target')
    peer = saved['nodePublicKey']
    if request['nodePublicKey'] != peer or not re.fullmatch(r'[A-Za-z0-9+/]{43}=', peer): raise ValueError('peer mismatch')
    allowed = dict(line.split(maxsplit=1) for line in run('wg', 'show', INTERFACE, 'allowed-ips').splitlines())
    if allowed.get(peer) != str(address) + '/32': raise ValueError('route mismatch')
    scan = subprocess.run(['ssh-keyscan', '-T', '5', '-p', str(request['sshPort']), '-t', 'ed25519,rsa,ecdsa', str(address)], capture_output=True, timeout=15, check=False)
    known = verified_host_scan(scan, request['sshFingerprint'])
    # Python is installed by both supported host installers. Transport secrets
    # through encrypted stdin only; no command arguments, stdout or log values.
    payload = base64.b64encode(json.dumps({'nodeId': job, 'agentId': request['agentId'], 'agentSecret': request['agentSecret'], 'expiresAt': request['expiresAt']}).encode()).decode()
    script = "D=__import__('json').loads(__import__('base64').b64decode('" + payload + "'))\n" + AGENT_REPAIR_SCRIPT
    with tempfile.TemporaryDirectory(prefix='incudal-agent-repair-', dir='/root') as directory:
        trust = pathlib.Path(directory) / 'known_hosts'; trust.write_text(known[0] + '\n'); trust.chmod(0o600)
        result = subprocess.run(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'GlobalKnownHostsFile=/dev/null',
                                 '-o', 'UserKnownHostsFile=' + str(trust), '-o', 'ConnectTimeout=8', '-o', 'IdentitiesOnly=yes',
                                 '-i', str(MANAGEMENT_PUBLIC_KEY.with_suffix('')), '-p', str(request['sshPort']), 'root@' + str(address),
                                 'python3 -I -B -'], input=script.encode(), capture_output=True, timeout=40, check=False)
        if result.returncode != 0 or result.stdout.strip() != b'AGENT_CONFIG_RECONCILED':
            raise GatewayOperationError('AGENT_REPAIR_REMOTE_FAILED')
    return {'nodeId': job, 'agentId': request['agentId'], 'configReconciled': True, 'keysAndRoutesPreserved': True}


AGENT_REPAIR_SCRIPT = r'''
import os,stat,pathlib,re,tempfile,subprocess,fcntl,time
def active():
    if time.time()*1000 >= D['expiresAt']: raise ValueError('expired repair')
active()
def protected(path, limit):
    for parent in [path.parent, *path.parent.parents]:
        info=parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022: raise ValueError('unsafe directory')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as handle:
        info=os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o022 or info.st_size > limit: raise ValueError('unsafe file')
        return handle.read(limit+1)
if protected(pathlib.Path('/etc/incudal-onboarding-id'),128).decode().strip()!=D['nodeId']: raise ValueError('wrong node')
path=pathlib.Path('/etc/incudal-agent/config.yaml')
original=protected(path,65536)
lock=os.open(path.parent/'.repair.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)
try:
    info=os.fstat(lock)
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1 or info.st_mode & 0o077: raise ValueError('unsafe lock')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    if protected(path,65536)!=original: raise ValueError('configuration changed')
    text=original.decode()
    for field,value in [('agent_id',D['agentId']),('agent_secret',D['agentSecret'])]:
        text,count=re.subn(r'(?m)^'+field+r':[ \t]*[^\r\n]*',field+': "'+value+'"',text)
        if count!=1: raise ValueError('unexpected configuration')
    changed=text.encode()!=original
    if changed:
        fd,temp=tempfile.mkstemp(prefix='.agent-repair-',dir=path.parent)
        try:
            with os.fdopen(fd,'wb') as handle:
                os.fchmod(handle.fileno(),0o600);handle.write(text.encode());handle.flush();os.fsync(handle.fileno())
            active()
            if protected(path,65536)!=original: raise ValueError('configuration changed')
            os.replace(temp,path)
            directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try: os.fsync(directory)
            finally: os.close(directory)
        finally:
            if os.path.exists(temp): os.unlink(temp)
    # A lost receipt after publication is idempotent. Restarting only the Agent
    # also covers a previous timeout between file publication and service restart.
    command=['systemctl','restart','incudal-agent'] if pathlib.Path('/run/systemd/system').is_dir() else ['rc-service','incudal-agent','restart']
    active()
    subprocess.run(command,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=20)
    print('AGENT_CONFIG_RECONCILED')
finally: os.close(lock)
'''


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


def recovery_configured_peers(text):
    peers = {}
    for section in re.split(r'(?m)^\s*\[Peer\]\s*$', text)[1:]:
        fields = {}
        for line in section.splitlines():
            line = line.split('#', 1)[0].strip()
            if not line: continue
            if line.startswith('['): break
            if '=' not in line: raise ValueError('invalid saved peer')
            name, value = [part.strip() for part in line.split('=', 1)]
            if name in fields: raise ValueError('duplicate saved field')
            fields[name] = value
        key = fields.get('PublicKey')
        if not key or key in peers: raise ValueError('invalid saved peer')
        peers[key] = fields
    return peers


def recovery_live_routes():
    result = {}
    for line in run('wg', 'show', INTERFACE, 'allowed-ips').splitlines():
        if not line.strip(): continue
        key, value = line.split(maxsplit=1)
        if key in result: raise ValueError('duplicate live peer')
        result[key] = [str(ipaddress.ip_network(item)) for item in re.split(r'[\s,]+', value) if item and item != '(none)']
    return result


def read_recovery_state(control):
    allowed = recovery_live_routes()
    config_bytes = read_protected_state(CONFIG, 2*1024*1024)
    configured = recovery_configured_peers(config_bytes.decode('utf-8'))
    for key, routes in allowed.items():
        fields = configured.get(key)
        expected = [str(ipaddress.ip_network(item)) for item in re.split(r'[\s,]+', fields.get('AllowedIPs', '')) if item] if fields else None
        if routes != expected:
            raise GatewayOperationError('GATEWAY_RECOVERY_ADDRESS_CONFLICT')
    peers = []
    for path in sorted(STATE.glob('*.json')):
        if not re.fullmatch(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}', path.stem): continue
        saved = json.loads(read_protected_state(path, 4096), object_pairs_hook=strict_json)
        if not isinstance(saved, dict) or set(saved) != {'managementIp', 'nodePublicKey'}:
            raise ValueError('invalid reservation')
        address = str(ipaddress.IPv4Address(saved['managementIp']))
        key = saved['nodePublicKey']
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9+/]{43}=', key): raise ValueError('invalid peer')
        if ipaddress.IPv4Address(address) not in control.network or ipaddress.IPv4Address(address) in (control.ip, control.network.network_address, control.network.broadcast_address):
            raise GatewayOperationError('GATEWAY_RECOVERY_ADDRESS_CONFLICT')
        peers.append({'nodeId': path.stem, 'managementIp': address, 'nodePublicKey': key, 'enabled': allowed.get(key) == [address + '/32']})
        if len(peers) > 10000: raise ValueError('too many peers')
    known_keys = {peer['nodePublicKey'] for peer in peers}
    if len(known_keys) != len(peers) or set(allowed) - known_keys:
        raise GatewayOperationError('GATEWAY_RECOVERY_UNKNOWN_PEER')
    if len({peer['managementIp'] for peer in peers}) != len(peers):
        raise GatewayOperationError('GATEWAY_RECOVERY_ADDRESS_CONFLICT')
    # A missing runtime route remains visible for the bounded repair path.
    # Duplicate/foreign routes never disappear in a dict conversion.
    return {'version': 1, 'observedAt': int(time.time() * 1000), 'peers': peers,
            'stateHash': hashlib.sha256(json.dumps(peers, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'configHash': hashlib.sha256(config_bytes).hexdigest(),
            'runtimeHash': hashlib.sha256(json.dumps(allowed, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}


def restore_saved_peer(job, control, gateway_public):
    """Restore only a missing runtime /32 from this gateway's current file.

    The old controller database is never a source for recreating enrollment.
    A removed block, changed key/address or foreign live route is a conflict.
    The caller holds the same gateway mutation lock as peer registration.
    """
    raw = sys.stdin.buffer.read(4097)
    if len(raw) > 4096: raise ValueError('input too large')
    request = json.loads(raw, object_pairs_hook=strict_json)
    fields = {'nodePublicKey', 'managementIp', 'gatewayPublicKey', 'configHash', 'expiresAt'}
    if not isinstance(request, dict) or set(request) != fields: raise ValueError('invalid restore request')
    if type(request['expiresAt']) is not int or not time.time()*1000 < request['expiresAt'] <= time.time()*1000+30000:
        raise GatewayOperationError('GATEWAY_RECOVERY_REPAIR_EXPIRED')
    config_bytes = read_protected_state(CONFIG, 2*1024*1024)
    if (request['gatewayPublicKey'] != gateway_public or
        request['configHash'] != hashlib.sha256(config_bytes).hexdigest()):
        raise GatewayOperationError('GATEWAY_RECOVERY_REPAIR_CHANGED')
    reservation = read_protected_state(STATE / (job + '.json'), 4096)
    saved = json.loads(reservation, object_pairs_hook=strict_json)
    key, address = saved['nodePublicKey'], str(ipaddress.IPv4Address(saved['managementIp']))
    if (set(saved) != {'nodePublicKey', 'managementIp'} or request['nodePublicKey'] != key or request['managementIp'] != address or
        not re.fullmatch(r'[A-Za-z0-9+/]{43}=', key) or ipaddress.IPv4Address(address) not in control.network or
        ipaddress.IPv4Address(address) in (control.ip, control.network.network_address, control.network.broadcast_address)):
        raise GatewayOperationError('GATEWAY_RECOVERY_REPAIR_CHANGED')
    text = config_bytes.decode('utf-8')
    block = '# incudal-onboarding ' + job + '\n[Peer]\nPublicKey = ' + key + '\nAllowedIPs = ' + address + '/32\n'
    expected = [address + '/32']
    fields = recovery_configured_peers(text)
    configured = {peer: [str(ipaddress.ip_network(item)) for item in re.split(r'[\s,]+', value.get('AllowedIPs', '')) if item]
                  for peer, value in fields.items()}
    if (text.count('# incudal-onboarding ' + job) != 1 or block not in text or configured.get(key) != expected or
        set(fields.get(key, {})) != {'PublicKey', 'AllowedIPs'}):
        raise GatewayOperationError('GATEWAY_RECOVERY_SAVED_ROUTE_MISSING')
    for peer_key, subnets in configured.items():
        if peer_key != key and any(ipaddress.ip_address(address) in ipaddress.ip_network(subnet) for subnet in subnets):
            raise GatewayOperationError('GATEWAY_RECOVERY_ADDRESS_CONFLICT')
    live = recovery_live_routes()
    if set(live) - set(configured) or any(subnets != configured.get(peer_key) for peer_key, subnets in live.items()):
        raise GatewayOperationError('GATEWAY_RECOVERY_ADDRESS_CONFLICT')
    if key not in live:
        if time.time()*1000 >= request['expiresAt']: raise GatewayOperationError('GATEWAY_RECOVERY_REPAIR_EXPIRED')
        if (read_protected_state(CONFIG, 2*1024*1024) != config_bytes or
            read_protected_state(STATE / (job + '.json'), 4096) != reservation or
            run('wg', 'show', INTERFACE, 'public-key') != gateway_public):
            raise GatewayOperationError('GATEWAY_RECOVERY_REPAIR_CHANGED')
        if recovery_live_routes() != live:
            raise GatewayOperationError('GATEWAY_RECOVERY_REPAIR_CHANGED')
        if time.time()*1000 >= request['expiresAt']: raise GatewayOperationError('GATEWAY_RECOVERY_REPAIR_EXPIRED')
        run('wg', 'set', INTERFACE, 'peer', key, 'allowed-ips', address + '/32')
    observed = recovery_live_routes()
    if observed != {**live, key: expected}: raise GatewayOperationError('GATEWAY_RECOVERY_ROUTE_MISMATCH')
    return {'nodeId': job, 'runtimeRouteRestored': True, 'savedConfigurationPreserved': True}


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
    agent_request = len(args) == 2 and args[0] == 'repair-agent' and re.fullmatch(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}', args[1])
    route_request = len(args) == 2 and args[0] == 'restore-route' and re.fullmatch(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}', args[1])
    if args not in (["status"], ["peers"], ["recovery-state"]) and not dns_request and not probe_request and not agent_request and not route_request and not (len(args) == 3 and args[0] == "add" and re.fullmatch(r"[a-f0-9-]{36}", args[1]) and re.fullmatch(r"[A-Za-z0-9+/]{43}=", args[2])):
        raise ValueError("unsupported operation")
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    for parent in [STATE, *STATE.parents]:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('untrusted gateway directory')
    descriptor = os.open(STATE / 'lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    with os.fdopen(descriptor, 'a') as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o077:
            raise ValueError('untrusted gateway lock')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise GatewayOperationError('GATEWAY_RECOVERY_BUSY') from None
        addresses = json.loads(run("ip", "-j", "-4", "addr", "show", "dev", INTERFACE))[0]["addr_info"]
        address = next(a for a in addresses if a["family"] == "inet")
        control = ipaddress.ip_interface(str(address["local"]) + "/" + str(address["prefixlen"]))
        if not control.ip in ipaddress.ip_network("10.0.0.0/8") or not 16 <= control.network.prefixlen <= 30:
            raise ValueError("unsupported management network")
        public_key_parts = MANAGEMENT_PUBLIC_KEY.read_text().split()
        if len(public_key_parts) < 2 or public_key_parts[0] != "ssh-ed25519" or not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", public_key_parts[1]):
            raise ValueError("management public key missing")
        result = {"publicKey": run("wg", "show", INTERFACE, "public-key"), "controlIp": str(control.ip),
                  "network": str(control.network), "managementSshPublicKey": " ".join(public_key_parts[:2]), "dnsProtocolVersion": 2, "recoveryProtocolVersion": 1}
        if dns_request:
            # DNS installation reads the reservation and validates exact peer
            # identity; it does not mutate the controller's peers. Do not hold
            # the global gateway lock across slow per-host SSH installations.
            fcntl.flock(lock, fcntl.LOCK_UN)
            print(json.dumps(install_host_dns(args[1], control, result['publicKey']))); return
        if probe_request:
            print(json.dumps(probe_host(args[1], control))); return
        if agent_request:
            fcntl.flock(lock, fcntl.LOCK_UN)
            print(json.dumps(repair_host_agent(args[1], control))); return
        if route_request:
            print(json.dumps(restore_saved_peer(args[1], control, result['publicKey']))); return
        if args[0] == "recovery-state":
            result['recovery'] = read_recovery_state(control)
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
