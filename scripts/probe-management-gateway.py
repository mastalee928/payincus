#!/usr/bin/env python3
"""Read-only gateway preflight. One strict JSON request on stdin, no secrets."""
import hashlib
import base64
import ipaddress
import json
import platform
import re
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path

UUID = re.compile(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}')
KEYS = {'schemaVersion', 'platformId', 'gatewayId', 'slot', 'expectedMachineId',
        'network', 'address', 'listenPort', 'consolePort'}
UNITS = {
    'transport': ('incudal-gateway.service', '# payincus-gateway-transport-v1'),
    'console': ('incudal-gateway-console.service', '# payincus-gateway-console-v1'),
    'backup': ('incudal-gateway-backup.service', '# payincus-gateway-backup-v1'),
}


class ProbeError(ValueError):
    """Public failure code only; never include command output or file contents."""
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate key')
        result[key] = value
    return result


def validate_request(value):
    if not isinstance(value, dict) or set(value) != KEYS or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1:
        raise ValueError('invalid request')
    if any(not isinstance(value[key], str) or not UUID.fullmatch(value[key]) for key in ('platformId', 'gatewayId')):
        raise ValueError('invalid identity')
    if value['slot'] not in ('a', 'b'):
        raise ValueError('invalid slot')
    machine = value['expectedMachineId']
    if machine is not None and (not isinstance(machine, str) or not re.fullmatch(r'[a-f0-9]{32}', machine) or set(machine) == {'0'}):
        raise ValueError('invalid machine')
    network = ipaddress.IPv4Network(value['network'], strict=True)
    address = ipaddress.IPv4Address(value['address'])
    private = any(network.subnet_of(ipaddress.IPv4Network(item)) for item in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))
    if not private or not 20 <= network.prefixlen <= 30 or address not in network or address in (network.network_address, network.broadcast_address):
        raise ValueError('invalid management network')
    if str(network) != value['network'] or str(address) != value['address']:
        raise ValueError('noncanonical network')
    for key in ('listenPort', 'consolePort'):
        if type(value[key]) is not int or not 1024 <= value[key] <= 65535:
            raise ValueError('invalid port')
    if value['listenPort'] == value['consolePort']:
        raise ValueError('overlapping ports')
    return value


def command(tool, arguments):
    binary = shutil.which(tool, path='/usr/sbin:/usr/bin:/sbin:/bin')
    if not binary:
        raise ProbeError('GATEWAY_DEPENDENCIES_MISSING')
    try:
        result = subprocess.run([binary, *arguments], stdin=subprocess.DEVNULL, capture_output=True,
                                timeout=8, check=True, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'})
    except subprocess.TimeoutExpired:
        raise ProbeError('GATEWAY_INSPECTION_TIMEOUT') from None
    except (OSError, subprocess.CalledProcessError):
        raise ProbeError('GATEWAY_INSPECTION_COMMAND_FAILED') from None
    if len(result.stdout) > 262144 or len(result.stderr) > 32768:
        raise ProbeError('GATEWAY_INSPECTION_RESPONSE_INVALID')
    try:
        return result.stdout.decode('utf8', errors='strict')
    except UnicodeError:
        raise ProbeError('GATEWAY_INSPECTION_RESPONSE_INVALID') from None


def route_conflicts(routes, network, interface):
    conflicts = []
    for route in routes:
        if route.get('dst', 'default') == 'default':
            continue
        destination = ipaddress.IPv4Network(route['dst'], strict=False)
        if destination.overlaps(network) and route.get('dev') != interface:
            conflicts.append({'network': str(destination), 'interface': route.get('dev', 'unknown')})
    return conflicts


def listener_ports(text):
    ports = set()
    for line in text.splitlines():
        fields = line.split()
        if len(fields) < 5:
            raise ValueError('invalid socket response')
        port = fields[3].rsplit(':', 1)[-1]
        if port.isdigit():
            ports.add(int(port))
        elif port != '*':
            raise ValueError('invalid socket port')
    return ports


def service_fact(name, marker):
    raw = command('systemctl', ['show', name, '--property=LoadState,ActiveState,FragmentPath', '--no-pager'])
    facts = dict(line.split('=', 1) for line in raw.splitlines() if '=' in line)
    path = facts.get('FragmentPath', '')
    if facts.get('LoadState') == 'not-found' and not path:
        return {'installed': False, 'owned': False, 'active': False, 'digest': None}
    if not path.startswith(('/etc/systemd/system/', '/usr/lib/systemd/system/', '/lib/systemd/system/')):
        return {'installed': True, 'owned': False, 'active': False, 'digest': None}
    target = Path(path)
    info = target.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > 16384:
        return {'installed': True, 'owned': False, 'active': False, 'digest': None}
    contents = target.read_bytes()
    return {'installed': True, 'owned': marker.encode() in contents.splitlines(),
            'active': facts.get('ActiveState') == 'active', 'digest': hashlib.sha256(contents).hexdigest()}


def probe(request):
    blockers = []
    # This entry only reads public machine/network/service facts. The Web
    # backend runs without root; privileged observations that are unavailable
    # remain explicit blockers. Installation planning/execution still require root.
    try:
        machine = Path('/etc/machine-id').read_text().strip()
    except OSError:
        raise ProbeError('GATEWAY_MACHINE_ID_UNAVAILABLE') from None
    if not re.fullmatch(r'[a-f0-9]{32}', machine) or set(machine) == {'0'}:
        raise ProbeError('GATEWAY_MACHINE_ID_UNAVAILABLE')
    if request['expectedMachineId'] is not None and request['expectedMachineId'] != machine:
        blockers.append('GATEWAY_TARGET_IDENTITY_CHANGED')
    os_values = {}
    for line in Path('/etc/os-release').read_text().splitlines():
        if re.fullmatch(r'[A-Z_]+=["A-Za-z0-9._ -]+', line):
            key, value = line.split('=', 1)
            os_values[key] = value.strip('"')
    os_id = os_values.get('ID', 'unknown')
    architecture = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine(), 'unknown')
    if os_id not in ('debian', 'ubuntu') or architecture == 'unknown':
        blockers.append('GATEWAY_SYSTEM_UNSUPPORTED')
    if not Path('/run/systemd/system').is_dir():
        blockers.append('GATEWAY_SERVICE_MANAGER_UNSUPPORTED')
    memory = int(re.search(r'^MemTotal:\s+(\d+) kB$', Path('/proc/meminfo').read_text(), re.M)[1]) // 1024
    disk = shutil.disk_usage('/var/lib').free
    if memory < 768:
        blockers.append('GATEWAY_MEMORY_INSUFFICIENT')
    if disk < 512 * 1024 * 1024:
        blockers.append('GATEWAY_DISK_INSUFFICIENT')
    tools = {tool: shutil.which(tool, path='/usr/sbin:/usr/bin:/sbin:/bin') is not None for tool in ('wg', 'ip', 'ss', 'systemctl', 'node', 'python3')}
    if not all(tools.values()):
        blockers.append('GATEWAY_DEPENDENCIES_MISSING')
    interface = 'incudal-gw-' + request['slot']
    alias = 'payincus-gateway/v1/' + request['platformId'] + '/' + request['gatewayId']
    facts = {'interface': {'exists': False, 'owned': False, 'addressMatches': False},
             'routeConflicts': [], 'portConflicts': [], 'services': {}}
    try:
        links = json.loads(command('ip', ['-j', 'link', 'show']))
        addresses = json.loads(command('ip', ['-j', '-4', 'address', 'show']))
        routes = json.loads(command('ip', ['-j', '-4', 'route', 'show', 'table', 'all']))
        link = next((item for item in links if item['ifname'] == interface), None)
        owned = bool(link and link.get('ifalias') == alias)
        actual = next((item for item in addresses if item['ifname'] == interface), {})
        address_matches = bool(link and len(actual.get('addr_info', [])) == 1 and actual['addr_info'][0].get('local') == request['address'] and actual['addr_info'][0].get('prefixlen') == 32)
        facts['interface'] = {'exists': link is not None, 'owned': owned, 'addressMatches': address_matches}
        if link and not owned:
            blockers.append('GATEWAY_INTERFACE_CONFLICT')
        if link and owned and not address_matches:
            blockers.append('GATEWAY_ADDRESS_CHANGE_REQUIRES_MIGRATION')
        facts['routeConflicts'] = route_conflicts(routes, ipaddress.IPv4Network(request['network']), interface if owned else '')
        if facts['routeConflicts']:
            blockers.append('GATEWAY_MANAGEMENT_ROUTE_CONFLICT')
        for key, (name, marker) in UNITS.items():
            facts['services'][key] = service_fact(name, marker)
        if any(item['installed'] and not item['owned'] for item in facts['services'].values()):
            blockers.append('GATEWAY_SERVICE_OWNERSHIP_CONFLICT')
        udp = listener_ports(command('ss', ['-H', '-lun']))
        tcp = listener_ports(command('ss', ['-H', '-ltn']))
        if request['listenPort'] in udp:
            if not owned or int(command('wg', ['show', interface, 'listen-port']).strip()) != request['listenPort']:
                facts['portConflicts'].append({'protocol': 'udp', 'port': request['listenPort']})
        # A matching unit marker cannot prove who owns an HTTPS socket. Require
        # the authenticated console identity check before attaching an occupied port.
        if request['consolePort'] in tcp:
            facts['portConflicts'].append({'protocol': 'tcp', 'port': request['consolePort']})
        if facts['portConflicts']:
            blockers.append('GATEWAY_PORT_CONFLICT')
    except ProbeError as error:
        blockers.extend(['GATEWAY_INSPECTION_INCOMPLETE', error.code])
    except (ValueError, OSError, subprocess.SubprocessError, KeyError, TypeError):
        blockers.append('GATEWAY_INSPECTION_INCOMPLETE')
    stable = {'request': request, 'machineId': machine, 'osId': os_id, 'architecture': architecture,
              'tools': tools, 'facts': facts, 'blockers': sorted(set(blockers))}
    digest = hashlib.sha256(json.dumps(stable, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'schemaVersion': 1, 'machineId': machine, 'osId': os_id, 'architecture': architecture,
            'memoryMiB': memory, 'diskAvailableMiB': disk // 1048576, 'tools': tools, 'facts': facts,
            'blockers': sorted(set(blockers)), 'observedStateHash': digest, 'inspectedAt': int(time.time() * 1000)}


def main():
    try:
        encoded = globals().get('INCUDAL_PREFLIGHT_REQUEST')
        raw = base64.b64decode(encoded, validate=True) if encoded is not None else sys.stdin.buffer.read(4097)
        if len(raw) > 4096:
            raise ValueError('oversize request')
        request = validate_request(json.loads(raw, object_pairs_hook=strict_object))
        result = probe(request)
        if len(json.dumps(result)) > 16384:
            raise ValueError('oversize result')
        print(json.dumps(result, separators=(',', ':')))
    except ProbeError as error:
        if globals().get('INCUDAL_PREFLIGHT_REQUEST') is not None:
            print('INCUDAL_ERROR:' + error.code)
        else:
            print(json.dumps({'code': error.code}, separators=(',', ':')))
        return 1
    except (ValueError, OSError, subprocess.SubprocessError, KeyError, TypeError, IndexError):
        print('INCUDAL_ERROR:GATEWAY_PREFLIGHT_FAILED' if globals().get('INCUDAL_PREFLIGHT_REQUEST') is not None
              else '{"code":"GATEWAY_PREFLIGHT_FAILED"}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
