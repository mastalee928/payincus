#!/usr/bin/env python3
"""Read-only, root-side installation planning over a pinned component package.

The control service supplies a public, expiring task. Package and platform
trust come from a separately protected local policy, never from the task.
"""
import base64
import hashlib
import importlib.util
import ipaddress
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

sys.dont_write_bytecode = True


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


package = load_module('gateway_package', 'verify-gateway-component-package.py')
probe = load_module('gateway_probe', 'probe-management-gateway.py')
UUID = re.compile(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}')
HASH = re.compile(r'[a-f0-9]{64}')
TASK_FIELDS = {'schemaVersion', 'taskId', 'platformId', 'gatewayId', 'kind', 'basedOnRevision',
               'target', 'configurationHash', 'componentHash', 'observedStateHash'}
CONFIGURATION_FIELDS = {'slot', 'network', 'address', 'listenPort', 'consolePort', 'consoleOrigin', 'signedTransport'}
TRANSPORT_FIELDS = {'schemaVersion', 'purpose', 'platformId', 'gatewayId', 'epoch', 'sequence',
                    'issuedAt', 'expiresAt', 'slot', 'address', 'listenPort', 'mtu', 'peers'}


class PlanRejected(ValueError):
    def __init__(self, code='GATEWAY_INSTALL_PLAN_INVALID'):
        self.code = code
        super().__init__(code)


def require(condition, code='GATEWAY_INSTALL_PLAN_INVALID'):
    if not condition:
        raise PlanRejected(code)


def public_error_code(error, fallback):
    code = getattr(error, 'code', None)
    return code if isinstance(code, str) and re.fullmatch(r'GATEWAY_[A-Z_]{1,80}', code) else fallback


def exact(value, fields):
    require(isinstance(value, dict) and set(value) == fields)
    return value


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def task_hash(value):
    return hashlib.sha256(('payincus/gateway-task/v1\n' + canonical(value)).encode()).hexdigest()


def decode_object(raw):
    require(len(raw) <= 65536)
    return json.loads(raw, object_pairs_hook=package.strict_object,
                      parse_constant=lambda _: (_ for _ in ()).throw(PlanRejected()))


def validate_policy(policy):
    exact(policy, {'schemaVersion', 'platformId', 'platformSigningKey', 'packageSigningKey',
                   'packageDirectory', 'componentVersion', 'componentCommit'})
    require(type(policy['schemaVersion']) is int and policy['schemaVersion'] == 1)
    require(isinstance(policy['platformId'], str) and UUID.fullmatch(policy['platformId']))
    require(isinstance(policy['componentVersion'], str) and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', policy['componentVersion']))
    require(isinstance(policy['componentCommit'], str) and re.fullmatch(r'[a-f0-9]{40}', policy['componentCommit']))
    require(isinstance(policy['packageDirectory'], str) and re.fullmatch(r'/[A-Za-z0-9_./-]+', policy['packageDirectory']) and
            str(Path(policy['packageDirectory'])) == policy['packageDirectory'] and '..' not in Path(policy['packageDirectory']).parts)
    for name in ('platformSigningKey', 'packageSigningKey'):
        require(isinstance(policy[name], str))
        key = base64.b64decode(policy[name], validate=True)
        require(len(key) == 32 and any(key) and base64.b64encode(key).decode() == policy[name])
    return policy


def validate_request(request, policy, now):
    exact(request, {'task', 'configuration', 'expiresAt'})
    require(type(now) is int and type(request['expiresAt']) is int and now < request['expiresAt'] <= now + 600000,
            'GATEWAY_INSTALL_PLAN_EXPIRED')
    task = exact(request['task'], TASK_FIELDS)
    require(type(task['schemaVersion']) is int and task['schemaVersion'] == 1 and task['kind'] == 'install')
    for field in ('taskId', 'platformId', 'gatewayId'):
        require(isinstance(task[field], str) and UUID.fullmatch(task[field]))
    require(task['platformId'] == policy['platformId'], 'GATEWAY_INSTALL_PLATFORM_MISMATCH')
    # Fresh installation only; attach/update must verify existing identities.
    require(task['basedOnRevision'] == '0', 'GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH')
    for field in ('configurationHash', 'componentHash', 'observedStateHash'):
        require(isinstance(task[field], str) and HASH.fullmatch(task[field]))
    target = exact(task['target'], {'mode', 'machineId', 'ssh'})
    require(target['mode'] in ('local', 'remote'))
    require(isinstance(target['machineId'], str) and re.fullmatch(r'[a-f0-9]{32}', target['machineId']) and set(target['machineId']) != {'0'})
    if target['mode'] == 'local':
        require(target['ssh'] is None)
    else:
        ssh = exact(target['ssh'], {'address', 'port', 'username', 'fingerprint'})
        require(isinstance(ssh['address'], str))
        address = ipaddress.IPv4Address(ssh['address'])
        require(str(address) == ssh['address'] and not address.is_loopback and not address.is_multicast and
                int(address) >> 24 not in (0, 255) and int(address) < int(ipaddress.IPv4Address('224.0.0.0')) and
                ssh['address'] != '169.254.169.254')
        require(type(ssh['port']) is int and 1 <= ssh['port'] <= 65535 and ssh['username'] == 'root')
        fingerprint = ssh['fingerprint']
        require(isinstance(fingerprint, str) and re.fullmatch(r'SHA256:[A-Za-z0-9+/]{43}', fingerprint))
        require(base64.b64encode(base64.b64decode(fingerprint[7:] + '=', validate=True)).decode().rstrip('=') == fingerprint[7:])
    configuration = exact(request['configuration'], CONFIGURATION_FIELDS)
    require(task_hash(configuration) == task['configurationHash'], 'GATEWAY_INSTALL_CONFIGURATION_MISMATCH')
    preflight = probe.validate_request({'schemaVersion': 1, 'platformId': task['platformId'], 'gatewayId': task['gatewayId'],
        'expectedMachineId': target['machineId'], **{key: configuration[key] for key in ('slot', 'network', 'address', 'listenPort', 'consolePort')}})
    origin = configuration['consoleOrigin']
    require(isinstance(origin, str) and len(origin) <= 300)
    parsed = urlsplit(origin)
    require(parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password and
            not parsed.query and not parsed.fragment and not parsed.path and parsed.port == configuration['consolePort'] and
            re.fullmatch(r'[a-z0-9.-]+', parsed.hostname) and origin == 'https://' + parsed.hostname + ':' + str(parsed.port))
    if re.fullmatch(r'[0-9.]+', parsed.hostname):
        require(str(ipaddress.IPv4Address(parsed.hostname)) == parsed.hostname)
    else:
        require(all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in parsed.hostname.split('.')))
    require(isinstance(configuration['signedTransport'], str) and len(configuration['signedTransport']) <= 49152)
    envelope = package.canonical_json(configuration['signedTransport'].encode())
    transport = exact(package.verify_signature(envelope, policy['platformSigningKey'],
                      prefix=b'payincus/gateway-transport/v1\n'), TRANSPORT_FIELDS)
    require(type(transport['schemaVersion']) is int and transport['schemaVersion'] == 1 and transport['purpose'] == 'gateway-transport')
    for field in ('platformId', 'gatewayId'):
        require(transport[field] == task[field], 'GATEWAY_INSTALL_TRANSPORT_MISMATCH')
    for field in ('slot', 'address', 'listenPort'):
        require(type(transport[field]) is type(configuration[field]) and transport[field] == configuration[field], 'GATEWAY_INSTALL_TRANSPORT_MISMATCH')
    require(transport['epoch'] == '1' and transport['sequence'] == '1' and transport['peers'] == [], 'GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH')
    require(type(transport['issuedAt']) is int and type(transport['expiresAt']) is int and
            0 < transport['issuedAt'] <= now + 30000 and now < transport['expiresAt'] and
            transport['issuedAt'] < transport['expiresAt'] <= transport['issuedAt'] + 900000 and request['expiresAt'] <= transport['expiresAt'],
            'GATEWAY_INSTALL_PLAN_EXPIRED')
    require(type(transport['mtu']) is int and 1280 <= transport['mtu'] <= 1420)
    require(configuration['address'].startswith('10.') and not re.match(r'10\.10\.[0-3]\.', configuration['address']))
    return preflight, transport


def prepare_installation(request, policy, *, now=None):
    now = int(time.time() * 1000) if now is None else now
    policy = validate_policy(policy)
    preflight, transport = validate_request(request, policy, now)
    report = probe.probe(preflight)
    require(report['machineId'] == request['task']['target']['machineId'], 'GATEWAY_INSTALL_TARGET_MISMATCH')
    require(report['observedStateHash'] == request['task']['observedStateHash'], 'GATEWAY_INSTALL_OBSERVATION_CHANGED')
    require(report['architecture'] in ('amd64', 'arm64'), 'GATEWAY_SYSTEM_UNSUPPORTED')
    verified = package.verify_package(policy['packageDirectory'], policy['packageSigningKey'], report['architecture'],
                                      policy['componentVersion'], policy['componentCommit'])
    require(verified['manifestHash'] == request['task']['componentHash'], 'GATEWAY_INSTALL_COMPONENT_CHANGED')
    blockers = set(report['blockers'])
    # Node is supplied by the verified package. Every other missing dependency
    # remains a blocker; the executor does not run an arbitrary package manager.
    if all(value for name, value in report['tools'].items() if name != 'node'):
        blockers.discard('GATEWAY_DEPENDENCIES_MISSING')
    if report['facts']['interface']['exists'] or any(value['installed'] for value in report['facts']['services'].values()):
        blockers.add('GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH')
    executable = Path('/usr/local/libexec/incudal-gateway')
    if executable.exists() or executable.is_symlink():
        blockers.add('GATEWAY_INSTALL_EXECUTABLE_CONFLICT')
    task = request['task']
    state = '/var/lib/incudal-management-gateway/' + task['gatewayId']
    if Path(state).exists() or Path(state).is_symlink():
        blockers.add('GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH')
    installation_root = Path('/var/lib/incudal-management-gateway')
    if installation_root.exists() and any(item.name == 'owner.json' or UUID.fullmatch(item.name) for item in installation_root.iterdir()):
        blockers.add('GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH')
    return {'schemaVersion': 1, 'task': task, 'planHash': task_hash(task), 'expiresAt': request['expiresAt'],
            'package': verified, 'target': {'machineId': report['machineId'], 'osId': report['osId'], 'architecture': report['architecture']},
            'configuration': {key: value for key, value in request['configuration'].items() if key != 'signedTransport'},
            'transport': {'epoch': transport['epoch'], 'sequence': transport['sequence'], 'mtu': transport['mtu'], 'peerCount': 0},
            'changes': {'packageDirectory': '/opt/incudal-gateway/components/' + verified['manifestHash'], 'stateDirectory': state,
                        'services': ['incudal-gateway.service', 'incudal-gateway-console.service'],
                        'interface': 'incudal-gw-' + transport['slot'], 'newIndependentIdentity': True,
                        'consoleCertificate': 'independently-pinned', 'businessBackendRestart': False,
                        'consoleListenAddress': '0.0.0.0',
                        'existingFilesOverwritten': False, 'customerRoutesChanged': False},
            'blockers': sorted(blockers), 'installable': not blockers, 'canWrite': False}


def main():
    try:
        require(len(sys.argv) == 3 and os.geteuid() == 0)
        policy = decode_object(package.protected_read(sys.argv[1], 4096, 0o600))
        request = decode_object(package.protected_read(sys.argv[2], 65536, 0o600))
        print(json.dumps(prepare_installation(request, policy), separators=(',', ':')))
        return 0
    except (ValueError, OSError, KeyError, TypeError, RecursionError, subprocess.SubprocessError) as error:
        print(json.dumps({'code': public_error_code(error, 'GATEWAY_INSTALL_PLAN_REJECTED'), 'canWrite': False}, separators=(',', ':')))
        return 1


if __name__ == '__main__':
    sys.exit(main())
