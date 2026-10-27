#!/usr/bin/env python3
"""Fixed fresh-gateway installer. No shell text or arbitrary file destinations.

Invoked by an authenticated controller worker, with a separately pinned policy.
Interrupted work retains its request, keys and journal and requires the same
unexpired confirmation. Bootstrap secrets stay in a root-only local file.
"""
import base64
import fcntl
import hashlib
import http.client
import importlib.util
import json
import os
import re
import secrets
import shutil
import ssl
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('gateway_install_plan', Path(__file__).with_name('gateway-install-plan.py'))
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)
require, package = planner.require, planner.package
STATE_ROOT = Path('/var/lib/incudal-management-gateway')
COMPONENT_ROOT = Path('/opt/incudal-gateway/components')
INSTALLED_BINARY = Path('/usr/local/libexec/incudal-gateway')
STEPS = ['identity-prepared', 'console-initialized', 'transport-started', 'transport-installed',
         'console-started', 'console-installed', 'console-authenticated']


def command(program, args, data=None, timeout=30):
    try:
        result = subprocess.run([program, *args], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout, check=False, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'})
    except subprocess.TimeoutExpired:
        raise planner.PlanRejected('GATEWAY_INSTALL_TIMEOUT') from None
    except FileNotFoundError:
        raise planner.PlanRejected('GATEWAY_DEPENDENCIES_MISSING') from None
    require(result.returncode == 0, 'GATEWAY_INSTALL_COMMAND_FAILED')
    require(len(result.stdout) <= 65536, 'GATEWAY_INSTALL_COMMAND_FAILED')
    return result.stdout


def safe_directory(path, create=False):
    require(path.is_absolute() and '..' not in path.parts and str(path) == os.path.normpath(path))
    for current in reversed([path, *path.parents]):
        try:
            info = current.lstat()
        except FileNotFoundError:
            require(create)
            current.mkdir(mode=0o700)
            info = current.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)


def read_json(path, limit=65536):
    return planner.decode_object(package.protected_read(path, limit, 0o600))


def save(path, raw, exclusive=False, mode=0o600):
    safe_directory(path.parent)
    temporary = path.parent / ('.write-' + secrets.token_hex(16))
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(raw)
            handle.flush()
            os.fchmod(handle.fileno(), mode)
            os.fsync(handle.fileno())
        if exclusive:
            os.link(temporary, path, follow_symlinks=False)
            temporary.unlink()
        else:
            if path.exists() or path.is_symlink():
                package.protected_read(path, 65536, mode)
            os.replace(temporary, path)
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        temporary.unlink(missing_ok=True)


def save_json(path, value, exclusive=False):
    save(path, json.dumps(value, separators=(',', ':')).encode(), exclusive)


def save_unchanged(path, raw):
    if path.exists() or path.is_symlink():
        require(package.protected_read(path, 65536, 0o600) == raw, 'GATEWAY_INSTALL_CONFIGURATION_CHANGED')
    else:
        save(path, raw, exclusive=True)


def save_json_unchanged(path, value):
    save_unchanged(path, json.dumps(value, separators=(',', ':')).encode())


def stage_package(policy, verified):
    safe_directory(COMPONENT_ROOT, create=True)
    destination = COMPONENT_ROOT / verified['manifestHash']
    if destination.exists() or destination.is_symlink():
        actual = package.verify_package(destination, policy['packageSigningKey'], verified['architecture'], policy['componentVersion'], policy['componentCommit'])
        require(actual['manifestHash'] == verified['manifestHash'], 'GATEWAY_INSTALL_COMPONENT_CHANGED')
        return destination
    temporary = Path(tempfile.mkdtemp(prefix='.staging-', dir=COMPONENT_ROOT))
    try:
        for name in ('bin', 'lib', 'ui', 'scripts'):
            (temporary / name).mkdir(mode=0o755)
        source = Path(policy['packageDirectory'])
        for name in [*package.FILES, 'package.json', 'manifest.json']:
            mode = 0o755 if name.startswith('bin/') or name.endswith('.sh') else 0o644
            raw = package.protected_read(source / name, 200 * 1024 * 1024, mode)
            save(temporary / name, raw, exclusive=True, mode=mode)
        actual = package.verify_package(temporary, policy['packageSigningKey'], verified['architecture'], policy['componentVersion'], policy['componentCommit'])
        require(actual['manifestHash'] == verified['manifestHash'], 'GATEWAY_INSTALL_COMPONENT_CHANGED')
        os.rename(temporary, destination)
        fd = os.open(COMPONENT_ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        return destination
    finally:
        if temporary.exists():
            require(temporary.parent == COMPONENT_ROOT and temporary.name.startswith('.staging-'))
            shutil.rmtree(temporary)


def verify_unit(unit, expected, expected_hash=None):
    raw = package.protected_read(Path('/etc/systemd/system') / unit, 8192, 0o644).decode()
    require(expected in raw.splitlines(), 'GATEWAY_INSTALL_SERVICE_CHANGED')
    if expected_hash is not None:
        require(hashlib.sha256(raw.encode()).hexdigest() == expected_hash, 'GATEWAY_INSTALL_SERVICE_CHANGED')
    command('/usr/bin/systemctl', ['is-active', '--quiet', unit])
    return hashlib.sha256(raw.encode()).hexdigest()


def console_request(port, certificate, host, path, method='GET', body=None, headers=None):
    context = ssl.create_default_context(cadata=certificate.decode())
    context.check_hostname = False  # Identity is pinned to this exact certificate below.
    connection = http.client.HTTPSConnection('127.0.0.1', port, context=context, timeout=5)
    try:
        connection.connect()
        expected = ssl.PEM_cert_to_DER_cert(certificate.decode())
        require(connection.sock.getpeercert(binary_form=True) == expected, 'GATEWAY_INSTALL_CONSOLE_IDENTITY')
        connection.request(method, path, None if body is None else json.dumps(body, separators=(',', ':')),
                           {'Host': host, 'Content-Type': 'application/json', **(headers or {})})
        response = connection.getresponse()
        raw = response.read(65537)
        require(len(raw) <= 65536, 'GATEWAY_INSTALL_CONSOLE_FAILED')
        return response.status, {name.lower(): value for name, value in response.getheaders()}, raw
    finally:
        connection.close()


def verify_transport(task, configuration, declared_transport, public_key):
    interface = 'incudal-gw-' + configuration['slot']
    require(command('/usr/bin/wg', ['show', interface, 'public-key']).decode().strip() == public_key,
            'GATEWAY_INSTALL_TRANSPORT_MISMATCH')
    links = json.loads(command('/usr/sbin/ip', ['-j', 'link', 'show', 'dev', interface]))
    addresses = json.loads(command('/usr/sbin/ip', ['-j', '-4', 'address', 'show', 'dev', interface]))
    require(len(links) == 1 and links[0]['ifname'] == interface and 'UP' in links[0]['flags'] and
            links[0]['mtu'] == declared_transport['mtu'] and
            links[0]['ifalias'] == 'payincus-gateway/v1/' + task['platformId'] + '/' + task['gatewayId'] and
            len(addresses) == 1 and len(addresses[0]['addr_info']) == 1 and
            addresses[0]['addr_info'][0]['local'] == configuration['address'] and addresses[0]['addr_info'][0]['prefixlen'] == 32 and
            command('/usr/bin/wg', ['show', interface, 'listen-port']).decode().strip() == str(configuration['listenPort']) and
            command('/usr/bin/wg', ['show', interface, 'peers']).strip() == b'', 'GATEWAY_INSTALL_TRANSPORT_MISMATCH')


def install(request, policy):
    policy = planner.validate_policy(policy)
    _, declared_transport = planner.validate_request(request, policy, int(time.time() * 1000))
    task = request['task']
    state = STATE_ROOT / task['gatewayId']
    safe_directory(STATE_ROOT, create=True)
    lockfd = os.open(STATE_ROOT / 'install.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    journal = None
    try:
        info = os.fstat(lockfd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1)
        fcntl.flock(lockfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        owner = {'platformId': task['platformId'], 'gatewayId': task['gatewayId'], 'machineId': task['target']['machineId']}
        if (STATE_ROOT / 'owner.json').exists():
            require(read_json(STATE_ROOT / 'owner.json') == owner, 'GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH')
        if state.exists() or state.is_symlink():
            safe_directory(state)
            require(read_json(state / 'request.json') == request, 'GATEWAY_INSTALL_CONFIRMATION_CHANGED')
            plan = read_json(state / 'plan.json')
            journal = read_json(state / 'journal.json')
            planner.exact(journal, {'schemaVersion', 'taskId', 'planHash', 'attempts', 'steps', 'unitHashes', 'status', 'errorCode'})
            require(type(journal['schemaVersion']) is int and journal['schemaVersion'] == 1 and
                    journal['taskId'] == task['taskId'] and journal['planHash'] == planner.task_hash(task) and
                    type(journal['attempts']) is int and 0 <= journal['attempts'] < 16 and
                    isinstance(journal['steps'], list) and journal['steps'] == STEPS[:len(journal['steps'])] and
                    isinstance(journal['unitHashes'], dict) and journal['status'] in ('running', 'needs_review', 'succeeded'),
                    'GATEWAY_INSTALL_REVIEW_REQUIRED')
            require(all(unit in ('incudal-gateway.service', 'incudal-gateway-console.service') and isinstance(digest, str) and
                        planner.HASH.fullmatch(digest) for unit, digest in journal['unitHashes'].items()), 'GATEWAY_INSTALL_REVIEW_REQUIRED')
            require(Path('/etc/machine-id').read_text().strip() == owner['machineId'], 'GATEWAY_INSTALL_TARGET_MISMATCH')
            actual = package.verify_package(policy['packageDirectory'], policy['packageSigningKey'], plan['package']['architecture'], policy['componentVersion'], policy['componentCommit'])
            require(actual['manifestHash'] == task['componentHash'], 'GATEWAY_INSTALL_COMPONENT_CHANGED')
            require(plan['package']['manifestHash'] == task['componentHash'])
        else:
            plan = planner.prepare_installation(request, policy)
            require(plan['installable'], 'GATEWAY_INSTALL_PREFLIGHT_BLOCKED')
            safe_directory(state, create=True)
            save_json(state / 'request.json', request, exclusive=True)
            save_json(state / 'plan.json', plan, exclusive=True)
            journal = {'schemaVersion': 1, 'taskId': task['taskId'], 'planHash': plan['planHash'], 'attempts': 0,
                       'steps': [], 'unitHashes': {}, 'status': 'running', 'errorCode': None}
            save_json(state / 'journal.json', journal, exclusive=True)
        if not (STATE_ROOT / 'owner.json').exists():
            save_json(STATE_ROOT / 'owner.json', owner, exclusive=True)
        journal['attempts'] += 1
        journal['status'] = 'running'
        journal['errorCode'] = None
        save_json(state / 'journal.json', journal)
        component = stage_package(policy, plan['package'])
        runtime = str(component / 'bin/node')
        configuration = request['configuration']
        trust = {'key_' + hashlib.sha256(base64.b64decode(policy['platformSigningKey'])).hexdigest(): policy['platformSigningKey']}

        def checkpoint(step):
            if step not in journal['steps']:
                journal['steps'].append(step)
            save_json(state / 'journal.json', journal)

        for directory in ('transport', 'auth'):
            safe_directory(state / directory, create=True)
        if not (state / 'wireguard.key').exists():
            require(not (state / 'transport/gateway-identity.json').exists() and 'identity-prepared' not in journal['steps'],
                    'GATEWAY_INSTALL_IDENTITY_MISSING')
            save(state / 'wireguard.key', command('/usr/bin/wg', ['genkey']), exclusive=True)
        key = package.protected_read(state / 'wireguard.key', 64, 0o600)
        public_key = command('/usr/bin/wg', ['pubkey'], key).decode().strip()
        if not (state / 'bootstrap.json').exists():
            require('console-initialized' not in journal['steps'] and not (state / 'auth/gateway-auth.json').exists(),
                    'GATEWAY_INSTALL_REVIEW_REQUIRED')
            bootstrap = {'username': 'operator', 'password': secrets.token_urlsafe(24), 'role': 'operator',
                         'totpSeed': base64.b64encode(secrets.token_bytes(20)).decode(),
                         'recoveryCodes': [secrets.token_urlsafe(24) for _ in range(8)]}
            save_json(state / 'bootstrap.json', bootstrap, exclusive=True)
        bootstrap = read_json(state / 'bootstrap.json')
        transport_config = {'schemaVersion': 1, 'platformId': task['platformId'], 'gatewayId': task['gatewayId'], 'trustedKeys': trust,
                            'stateDirectory': str(state / 'transport'), 'signedConfiguration': str(state / 'signed-transport.json'),
                            'privateKeyPath': str(state / 'wireguard.key')}
        save_unchanged(state / 'signed-transport.json', configuration['signedTransport'].encode())
        save_json_unchanged(state / 'transport-config.json', transport_config)
        checkpoint('identity-prepared')
        origin = urlsplit(configuration['consoleOrigin'])
        require(not (state / 'tls.key').is_symlink() and not (state / 'tls.crt').is_symlink())
        if not (state / 'tls.key').exists() and not (state / 'tls.crt').exists():
            san_type = 'IP' if re.fullmatch(r'[0-9.]+', origin.hostname) else 'DNS'
            command('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(state / 'tls.key'),
                    '-out', str(state / 'tls.crt'), '-days', '30', '-subj', '/CN=' + origin.hostname,
                    '-addext', 'subjectAltName=' + san_type + ':' + origin.hostname])
            os.chmod(state / 'tls.key', 0o600)
            os.chmod(state / 'tls.crt', 0o600)
        package.protected_read(state / 'tls.key', 16384, 0o600)
        certificate = package.protected_read(state / 'tls.crt', 32768, 0o600)
        console_config = {'schemaVersion': 1, 'origin': configuration['consoleOrigin'], 'listenHost': '0.0.0.0',
                          'listenPort': configuration['consolePort'], 'authDirectory': str(state / 'auth'), 'assetDirectory': str(component / 'ui'),
                          'tlsKey': str(state / 'tls.key'), 'tlsCertificate': str(state / 'tls.crt'), 'initialUser': None,
                          'transport': {'platformId': task['platformId'], 'gatewayId': task['gatewayId'], 'trustedKeys': trust,
                                        'statePath': str(state / 'transport/gateway-transport.json'), 'componentVersion': policy['componentVersion']}}
        if not (state / 'auth/gateway-auth.json').exists():
            require('console-initialized' not in journal['steps'], 'GATEWAY_INSTALL_REVIEW_REQUIRED')
            save_json_unchanged(state / 'console-initialize.json', {**console_config, 'initialUser': bootstrap})
            command(runtime, [str(component / 'lib/gateway-console.cjs'), '--initialize', str(state / 'console-initialize.json')])
        save_json_unchanged(state / 'console-config.json', console_config)
        if (state / 'console-initialize.json').exists() or (state / 'console-initialize.json').is_symlink():
            require(read_json(state / 'console-initialize.json') == {**console_config, 'initialUser': bootstrap})
            (state / 'console-initialize.json').unlink()
        checkpoint('console-initialized')
        units = {'incudal-gateway.service': 'ExecStart=/usr/local/libexec/incudal-gateway --serve ' + str(state / 'transport-config.json'),
                 'incudal-gateway-console.service': 'ExecStart=' + runtime + ' ' + str(component / 'lib/gateway-console.cjs') + ' --serve ' + str(state / 'console-config.json')}
        for unit, expected in units.items():
            path = Path('/etc/systemd/system') / unit
            if path.exists() or path.is_symlink():
                raw = package.protected_read(path, 8192, 0o644).decode()
                require(expected in raw.splitlines(), 'GATEWAY_INSTALL_SERVICE_CHANGED')
                recorded = journal['unitHashes'].get(unit)
                if recorded is not None:
                    require(hashlib.sha256(raw.encode()).hexdigest() == recorded, 'GATEWAY_INSTALL_SERVICE_CHANGED')
        binary = component / 'bin/incudal-gateway'
        digest = hashlib.sha256(package.protected_read(binary, 200 * 1024 * 1024, 0o755)).hexdigest()
        installed_binary = INSTALLED_BINARY
        if installed_binary.exists() or installed_binary.is_symlink():
            require('transport-started' in journal['steps'] and
                    hashlib.sha256(package.protected_read(installed_binary, 200 * 1024 * 1024, 0o755)).hexdigest() == digest,
                    'GATEWAY_INSTALL_EXECUTABLE_CONFLICT')
        else:
            require('transport-installed' not in journal['steps'], 'GATEWAY_INSTALL_EXECUTABLE_CONFLICT')
        if 'transport-installed' not in journal['steps']:
            checkpoint('transport-started')
            command('/usr/bin/bash', [str(component / 'scripts/install-management-gateway.sh'), '--install', str(binary), digest, str(state / 'transport-config.json')])
            journal['unitHashes']['incudal-gateway.service'] = verify_unit('incudal-gateway.service', units['incudal-gateway.service'])
            checkpoint('transport-installed')
        if 'console-installed' not in journal['steps']:
            checkpoint('console-started')
            command('/usr/bin/bash', [str(component / 'scripts/install-gateway-console.sh'), '--install', runtime,
                    str(component / 'lib/gateway-console.cjs'), str(state / 'console-config.json')])
            journal['unitHashes']['incudal-gateway-console.service'] = verify_unit('incudal-gateway-console.service', units['incudal-gateway-console.service'])
            checkpoint('console-installed')
        for unit, expected in units.items():
            command('/usr/bin/systemctl', ['start', unit])
            verify_unit(unit, expected, journal['unitHashes'][unit])
        verify_transport(task, configuration, declared_transport, public_key)
        for attempt in range(50):
            try:
                status, _, page = console_request(configuration['consolePort'], certificate, origin.netloc, '/')
                break
            except ConnectionRefusedError:
                if attempt == 49:
                    raise
                time.sleep(0.2)
        require(status == 200 and hashlib.sha256(page).digest() == hashlib.sha256((component / 'ui/index.html').read_bytes()).digest(),
                'GATEWAY_INSTALL_CONSOLE_FAILED')
        if 'console-authenticated' not in journal['steps']:
            auth = read_json(state / 'auth/gateway-auth.json')
            available = auth['users'][0]['recoveryHashes']
            code = next((value for value in bootstrap['recoveryCodes'] if hashlib.sha256(value.encode()).hexdigest() in available), None)
            require(code is not None, 'GATEWAY_INSTALL_BOOTSTRAP_UNAVAILABLE')
            status, headers, body = console_request(configuration['consolePort'], certificate, origin.netloc, '/api/login', 'POST',
                {'username': bootstrap['username'], 'password': bootstrap['password'], 'recoveryCode': code}, {'Origin': configuration['consoleOrigin']})
            require(status == 200, 'GATEWAY_INSTALL_CONSOLE_FAILED')
            session = json.loads(body)
            cookie = headers['set-cookie'].split(';')[0]
            status, _, body = console_request(configuration['consolePort'], certificate, origin.netloc, '/api/status', headers={'Cookie': cookie})
            live = json.loads(body)
            require(status == 200 and live['transportReady'] is True and live['gatewayId'] == task['gatewayId'] and live['canWrite'] is False,
                    'GATEWAY_INSTALL_TRANSPORT_MISMATCH')
            status, _, _ = console_request(configuration['consolePort'], certificate, origin.netloc, '/api/logout', 'POST', {},
                {'Origin': configuration['consoleOrigin'], 'Cookie': cookie, 'X-Gateway-CSRF': session['csrf']})
            require(status == 200, 'GATEWAY_INSTALL_CONSOLE_FAILED')
            bootstrap['recoveryCodes'] = [value for value in bootstrap['recoveryCodes'] if value != code]
            save_json(state / 'bootstrap.json', bootstrap)
            checkpoint('console-authenticated')
        receipt = {'schemaVersion': 1, 'taskId': task['taskId'], 'planHash': planner.task_hash(task), 'targetHash': planner.task_hash(task['target']),
                   'configurationHash': task['configurationHash'], 'componentHash': task['componentHash'], 'gatewayId': task['gatewayId'],
                   'publicKey': public_key, 'consoleCertificateSha256': hashlib.sha256(ssl.PEM_cert_to_DER_cert(certificate.decode())).hexdigest(),
                   'installed': True, 'transportReady': True, 'canWrite': False, 'bootstrapAvailable': True,
                   'blockers': ['backup-not-configured', 'host-write-service-not-ready', 'public-certificate-maintenance-required']}
        save_json(state / 'receipt.json', receipt)
        journal['status'] = 'succeeded'
        save_json(state / 'journal.json', journal)
        return receipt
    except Exception as error:
        if journal is not None:
            journal['status'] = 'needs_review'
            journal['errorCode'] = planner.public_error_code(error, 'GATEWAY_INSTALL_INCOMPLETE')
            save_json(state / 'journal.json', journal)
        raise
    finally:
        os.close(lockfd)


def main():
    try:
        require(len(sys.argv) == 3 and os.geteuid() == 0)
        policy = read_json(Path(sys.argv[1]), 4096)
        request = read_json(Path(sys.argv[2]))
        print(json.dumps(install(request, policy), separators=(',', ':')))
        return 0
    except Exception as error:
        print(json.dumps({'code': planner.public_error_code(error, 'GATEWAY_INSTALL_INCOMPLETE'), 'canWrite': False}, separators=(',', ':')))
        return 1


if __name__ == '__main__':
    sys.exit(main())
