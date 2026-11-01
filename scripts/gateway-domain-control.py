#!/usr/bin/env python3
"""Restricted hostname-only update for an installed management gateway console.

The authenticated controller pins the installed machine, TLS certificate and
key. This operation never edits transport, gateway roles, host peers or users.
"""
import fcntl
import hashlib
import http.client
import json
import os
import re
import ssl
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path('/var/lib/incudal-management-gateway')
MACHINE = Path('/etc/machine-id')
UNIT = Path('/etc/systemd/system/incudal-gateway-console.service')
UUID = re.compile(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}')
HASH = re.compile(r'[a-f0-9]{64}')
FIELDS = {'schemaVersion', 'operation', 'platformId', 'gatewayId', 'machineId', 'requestId', 'expectedRevision',
          'expectedOrigin', 'expectedCertificateSha256', 'expectedTlsKeySha256', 'origin'}


class Rejected(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def require(value, code='GATEWAY_DOMAIN_INVALID'):
    if not value:
        raise Rejected(code)


def strict_object(pairs):
    result = {}
    for name, value in pairs:
        require(name not in result)
        result[name] = value
    return result


def decode(raw):
    return json.loads(raw, object_pairs_hook=strict_object)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def directories(path, create=False):
    require(path.is_absolute() and '..' not in path.parts and str(path) == os.path.normpath(path))
    for current in reversed([path, *path.parents]):
        if not current.exists() and not current.is_symlink() and create:
            current.mkdir(mode=0o700)
        info = current.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'GATEWAY_DOMAIN_UNSAFE_FILE')


def read(path, limit=65536, private=True):
    directories(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as handle:
        info = os.fstat(handle.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and
                not info.st_mode & (0o077 if private else 0o022) and info.st_size <= limit, 'GATEWAY_DOMAIN_UNSAFE_FILE')
        raw = handle.read(limit + 1)
        require(len(raw) <= limit, 'GATEWAY_DOMAIN_UNSAFE_FILE')
        return raw


def write(path, value):
    directories(path.parent)
    raw = json.dumps(value, separators=(',', ':')).encode()
    descriptor, temporary = tempfile.mkstemp(prefix='.domain-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(raw); handle.flush(); os.fsync(handle.fileno())
        if path.exists() or path.is_symlink():
            read(path)
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def sync_directory(path):
    directory = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def command(program, arguments, data=None, timeout=15):
    try:
        result = subprocess.run([program, *arguments], input=data, capture_output=True, timeout=timeout, check=False,
                                env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'})
    except subprocess.TimeoutExpired:
        raise Rejected('GATEWAY_DOMAIN_TIMEOUT') from None
    except FileNotFoundError:
        raise Rejected('GATEWAY_DOMAIN_DEPENDENCY_MISSING') from None
    require(result.returncode == 0 and len(result.stdout) <= 4 * 1024 * 1024, 'GATEWAY_DOMAIN_COMMAND_FAILED')
    return result.stdout


def origin(value):
    require(isinstance(value, str) and len(value) <= 300)
    parsed = urlsplit(value)
    require(parsed.scheme == 'https' and not parsed.username and not parsed.password and not parsed.path and not parsed.query and not parsed.fragment and
            parsed.hostname and parsed.hostname == parsed.hostname.lower() and parsed.port and 1024 <= parsed.port <= 65535 and
            value == 'https://' + parsed.hostname + ':' + str(parsed.port))
    require(re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?', parsed.hostname) and
            len(parsed.hostname) <= 253 and not parsed.hostname.endswith(('.local', '.localhost', '.internal', '.invalid', '.test')))
    return parsed


def validate(request):
    require(isinstance(request, dict) and set(request) == FIELDS and type(request['schemaVersion']) is int and request['schemaVersion'] == 1 and
            request['operation'] in ['enroll', 'apply', 'status'])
    for field in ['platformId', 'gatewayId', 'requestId']:
        require(isinstance(request[field], str) and UUID.fullmatch(request[field]))
    require(isinstance(request['machineId'], str) and re.fullmatch(r'[a-f0-9]{32}', request['machineId']) and request['machineId'] != '0' * 32)
    require(isinstance(request['expectedRevision'], str) and re.fullmatch(r'[1-9][0-9]{0,18}', request['expectedRevision']) and
            int(request['expectedRevision']) < 9223372036854775807)
    require(isinstance(request['expectedCertificateSha256'], str) and HASH.fullmatch(request['expectedCertificateSha256']))
    require(request['expectedTlsKeySha256'] is None and request['operation'] in ['enroll', 'status'] or
            isinstance(request['expectedTlsKeySha256'], str) and HASH.fullmatch(request['expectedTlsKeySha256']))
    old, new = origin(request['expectedOrigin']), origin(request['origin'])
    require(old.port == new.port)
    if request['operation'] != 'apply':
        require(request['origin'] == request['expectedOrigin'])
    return request


def certificate_sha(raw):
    try:
        return digest(ssl.PEM_cert_to_DER_cert(raw.decode()))
    except (ValueError, UnicodeError):
        raise Rejected('GATEWAY_DOMAIN_IDENTITY_CHANGED') from None


def config_certificate_path(state, config):
    path = Path(config['tlsCertificate'])
    require(path == state / 'tls.crt' or path.parent == state / 'domain' and
            re.fullmatch(r'tls-[1-9][0-9]{0,18}-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.crt', path.name), 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
    return path


def inspect(state, request):
    owner = decode(read(ROOT / 'owner.json'))
    expected_owner = {name: request[name] for name in ['platformId', 'gatewayId', 'machineId']}
    require(owner == expected_owner and read(MACHINE, 64, False).decode().strip() == request['machineId'], 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
    config = decode(read(state / 'console-config.json'))
    require(config['tlsKey'] == str(state / 'tls.key') and config['authDirectory'] == str(state / 'auth') and config['initialUser'] is None and
            config['transport']['gatewayId'] == request['gatewayId'] and config['transport']['platformId'] == request['platformId'], 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
    parsed = origin(config['origin'])
    require(parsed.port == config['listenPort'], 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
    certificate = read(config_certificate_path(state, config), 32768)
    key_hash = digest(read(state / 'tls.key', 16384))
    unit = read(UNIT, 8192, False).decode()
    expected_end = ' --serve ' + str(state / 'console-config.json')
    starts = [line for line in unit.splitlines() if line.startswith('ExecStart=')]
    require(len(starts) == 1 and starts[0].endswith(expected_end) and '/lib/gateway-console.cjs ' in starts[0] and
            starts[0].startswith('ExecStart=/opt/incudal-gateway/components/'), 'GATEWAY_DOMAIN_SERVICE_CHANGED')
    transport = decode(read(state / 'transport-config.json'))
    require(transport['platformId'] == request['platformId'] and transport['gatewayId'] == request['gatewayId'], 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
    install = decode(read(state / 'request.json', 4 * 1024 * 1024))
    slot = install['configuration']['slot']
    require(slot in ['a', 'b'], 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
    return config, certificate_sha(certificate), key_hash, slot


def transport_snapshot(state, slot):
    files = ['wireguard.key', 'transport-config.json', 'signed-transport.json']
    result = {name: digest(read(state / name, 4 * 1024 * 1024)) for name in files}
    result['unit'] = digest(read(Path('/etc/systemd/system/incudal-gateway.service'), 8192, False))
    for field in ['public-key', 'listen-port', 'peers', 'allowed-ips']:
        result[field] = digest(command('/usr/bin/wg', ['show', 'incudal-gw-' + slot, field]))
    return result


def verify_console(state, config, expected_certificate):
    parsed = origin(config['origin'])
    certificate = read(config_certificate_path(state, config), 32768)
    require(certificate_sha(certificate) == expected_certificate, 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
    context = ssl.create_default_context(cadata=certificate.decode())
    context.check_hostname = False  # The exact DER certificate is pinned below.
    for attempt in range(10):
        connection = http.client.HTTPSConnection('127.0.0.1', parsed.port, context=context, timeout=3)
        try:
            connection.connect()
            require(digest(connection.sock.getpeercert(binary_form=True)) == expected_certificate, 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
            connection.request('GET', '/', headers={'Host': parsed.netloc})
            response = connection.getresponse(); raw = response.read(1048577)
            require(response.status == 200 and 0 < len(raw) <= 1048576, 'GATEWAY_DOMAIN_VERIFY_FAILED')
            return
        except (ConnectionRefusedError, ConnectionResetError):
            if attempt == 9:
                raise Rejected('GATEWAY_DOMAIN_VERIFY_FAILED') from None
            time.sleep(0.2)
        finally:
            connection.close()


def restart_console(state, config, certificate):
    command('/usr/bin/systemctl', ['restart', 'incudal-gateway-console.service'], timeout=20)
    command('/usr/bin/systemctl', ['is-active', '--quiet', 'incudal-gateway-console.service'])
    verify_console(state, config, certificate)


def new_certificate(state, request, revision):
    destination = state / 'domain' / ('tls-' + revision + '-' + request['requestId'] + '.crt')
    directories(destination.parent, True)
    if not destination.exists() and not destination.is_symlink():
        descriptor, temporary = tempfile.mkstemp(prefix='.certificate-', dir=destination.parent)
        os.close(descriptor)
        try:
            host = origin(request['origin']).hostname
            # X.509 commonName is bounded more tightly than a valid DNS name;
            # the complete identity is always carried in subjectAltName.
            common_name = host if len(host) <= 64 else 'Incudal management gateway'
            command('/usr/bin/openssl', ['req', '-x509', '-key', str(state / 'tls.key'), '-out', temporary,
                    '-days', '30', '-subj', '/CN=' + common_name, '-addext', 'subjectAltName=DNS:' + host], timeout=20)
            os.chmod(temporary, 0o600)
            raw = read(Path(temporary), 32768)
            require(command('/usr/bin/openssl', ['x509', '-in', temporary, '-pubkey', '-noout']) ==
                    command('/usr/bin/openssl', ['pkey', '-in', str(state / 'tls.key'), '-pubout']), 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
            with open(temporary, 'rb') as handle:
                os.fsync(handle.fileno())
            os.replace(temporary, destination)
            sync_directory(destination.parent)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    raw = read(destination, 32768)
    host = origin(request['origin']).hostname
    # OpenSSL 3.0 can exit zero even when -checkhost reports a mismatch.
    # Check the positive result in the fixed C locale as well as the exit code.
    checked = command('/usr/bin/openssl', ['x509', '-in', str(destination), '-noout', '-checkhost', host])
    require(checked.strip() == ('Hostname ' + host + ' does match certificate').encode(), 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
    require(command('/usr/bin/openssl', ['x509', '-in', str(destination), '-pubkey', '-noout']) ==
            command('/usr/bin/openssl', ['pkey', '-in', str(state / 'tls.key'), '-pubout']), 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
    return str(destination), certificate_sha(raw)


def receipt(request, revision, config, certificate, key_hash):
    return {'schemaVersion': 1, 'gatewayId': request['gatewayId'], 'requestId': request['requestId'], 'revision': revision,
            'origin': config['origin'], 'certificateSha256': certificate, 'tlsKeySha256': key_hash, 'verified': True, 'transportPreserved': True}


def execute(request):
    request = validate(request)
    state = ROOT / request['gatewayId']
    config, certificate, key_hash, slot = inspect(state, request)
    path = state / 'domain-state.json'
    pending_path = state / 'domain-pending.json'
    saved = decode(read(path)) if path.exists() or path.is_symlink() else None
    pending = decode(read(pending_path)) if pending_path.exists() or pending_path.is_symlink() else None
    request_hash = digest(json.dumps(request, sort_keys=True, separators=(',', ':')).encode())
    if saved and saved.get('requestHash') == request_hash:
        require(saved['receipt']['origin'] == config['origin'] and saved['receipt']['certificateSha256'] == certificate and
                saved['receipt']['tlsKeySha256'] == key_hash, 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
        verify_console(state, config, certificate)
        if pending and pending.get('completed') is not True and pending.get('requestHash') == request_hash:
            write(pending_path, {**pending, 'completed': True})
        return saved['receipt']
    # A durable state record commits the operation even if writing its final
    # journal marker failed. A status lookup must remain entirely read-only.
    if pending and saved and saved.get('requestHash') == pending.get('requestHash'):
        pending = {**pending, 'completed': True}
    if pending and pending.get('completed') is not True:
        require(pending.get('requestHash') == request_hash, 'GATEWAY_DOMAIN_BUSY')
        require(key_hash == pending['keyHash'] and config in [pending['oldConfig'], pending['newConfig']], 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
        require(transport_snapshot(state, slot) == pending['transport'], 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
        # A killed process may leave the new file published without a receipt.
        # Resume only the same command and roll back to its exact recorded base.
        if config != pending['oldConfig']:
            write(state / 'console-config.json', pending['oldConfig'])
        restart_console(state, pending['oldConfig'], pending['oldCertificate'])
        config, certificate, key_hash, slot = inspect(state, request)
    if request['operation'] == 'enroll' and saved is None:
        installed = decode(read(state / 'receipt.json'))
        install = decode(read(state / 'request.json', 4 * 1024 * 1024))
        task = install['task']
        require(isinstance(task['basedOnRevision'], str) and re.fullmatch(r'0|[1-9][0-9]{0,18}', task['basedOnRevision']) and
                request['expectedRevision'] == str(int(task['basedOnRevision']) + 1), 'GATEWAY_DOMAIN_CONFLICT')
        require(task['gatewayId'] == request['gatewayId'] and task['platformId'] == request['platformId'] and
                task['target']['machineId'] == request['machineId'] and installed['taskId'] == task['taskId'] and
                installed['gatewayId'] == request['gatewayId'] and installed['installed'] is True and installed['consoleCertificateSha256'] == certificate,
                'GATEWAY_DOMAIN_IDENTITY_CHANGED')
    else:
        require(saved is not None and saved['receipt']['revision'] == request['expectedRevision'], 'GATEWAY_DOMAIN_CONFLICT')
        require(saved['receipt']['origin'] == config['origin'] and saved['receipt']['certificateSha256'] == certificate and
                saved['receipt']['tlsKeySha256'] == key_hash, 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
    require(config['origin'] == request['expectedOrigin'] and certificate == request['expectedCertificateSha256'] and
            (request['expectedTlsKeySha256'] is None or request['expectedTlsKeySha256'] == key_hash), 'GATEWAY_DOMAIN_CONFLICT')
    if request['operation'] != 'apply':
        verify_console(state, config, certificate)
        result = receipt(request, request['expectedRevision'], config, certificate, key_hash)
        if saved is None:
            write(path, {'requestHash': request_hash, 'receipt': result})
        return result
    require(request['origin'] != request['expectedOrigin'], 'GATEWAY_DOMAIN_CONFLICT')
    revision = str(int(request['expectedRevision']) + 1)
    before = transport_snapshot(state, slot)
    cert_path, new_hash = new_certificate(state, request, revision)
    updated = {**config, 'origin': request['origin'], 'tlsCertificate': cert_path}
    journal = {'requestHash': request_hash, 'oldConfig': config, 'newConfig': updated, 'oldCertificate': certificate,
               'newCertificate': new_hash, 'keyHash': key_hash, 'transport': before, 'completed': False}
    write(pending_path, journal)
    committed = None
    try:
        require(inspect(state, request)[:3] == (config, certificate, key_hash), 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
        write(state / 'console-config.json', updated)
        restart_console(state, updated, new_hash)
        require(inspect(state, request) == (updated, new_hash, key_hash, slot) and transport_snapshot(state, slot) == before,
                'GATEWAY_DOMAIN_IDENTITY_CHANGED')
        result = receipt(request, revision, updated, new_hash, key_hash)
        committed = {'requestHash': request_hash, 'receipt': result}
        write(path, committed)
    except Exception:
        # rename may succeed before the directory fsync reports an I/O error.
        # Never restore an old config behind an already visible commit record.
        if committed is not None:
            try:
                if decode(read(path)) == committed:
                    raise Rejected('GATEWAY_DOMAIN_COMMIT_UNCERTAIN')
            except (OSError, ValueError) as error:
                if isinstance(error, Rejected) and error.code == 'GATEWAY_DOMAIN_COMMIT_UNCERTAIN':
                    raise
                raise Rejected('GATEWAY_DOMAIN_COMMIT_UNCERTAIN') from None
        try:
            rollback_config, rollback_certificate, rollback_key, rollback_slot = inspect(state, request)
            require(rollback_config in [config, updated] and rollback_certificate in [certificate, new_hash] and
                    rollback_key == key_hash and transport_snapshot(state, rollback_slot) == before, 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
            current = decode(read(state / 'console-config.json'))
            require(current in [config, updated] and digest(read(state / 'tls.key', 16384)) == key_hash, 'GATEWAY_DOMAIN_IDENTITY_CHANGED')
            write(state / 'console-config.json', config)
            restart_console(state, config, certificate)
            write(pending_path, {**journal, 'completed': True, 'rolledBack': True})
        except Exception:
            raise Rejected('GATEWAY_DOMAIN_ROLLBACK_FAILED') from None
        raise
    # domain-state is the commit record. A failure after this point must never
    # roll the console back behind that persisted revision.
    write(pending_path, {**journal, 'completed': True})
    return result


def main():
    lock = None
    try:
        require(os.geteuid() == 0 and len(sys.argv) == 2)
        raw = sys.stdin.buffer.read(8193); require(len(raw) <= 8192)
        request = validate(decode(raw))
        if sys.argv[1] == '--enroll':
            require(request['operation'] == 'enroll')
        else:
            require(UUID.fullmatch(sys.argv[1]) and request['gatewayId'] == sys.argv[1] and
                    os.environ.get('SSH_ORIGINAL_COMMAND') == 'domain' and request['operation'] in ['apply', 'status'])
        state = ROOT / request['gatewayId']; directories(state)
        lock = os.open(state / 'domain.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        info = os.fstat(lock)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1, 'GATEWAY_DOMAIN_UNSAFE_FILE')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Rejected('GATEWAY_DOMAIN_BUSY') from None
        print(json.dumps(execute(request), separators=(',', ':')))
        return 0
    except Rejected as error:
        print(json.dumps({'code': error.code, 'canWrite': False}, separators=(',', ':')))
        return 1
    except TimeoutError:
        print('{"code":"GATEWAY_DOMAIN_TIMEOUT","canWrite":false}')
        return 1
    except OSError:
        print('{"code":"GATEWAY_DOMAIN_IO_FAILED","canWrite":false}')
        return 1
    except Exception:
        print('{"code":"GATEWAY_DOMAIN_FAILED","canWrite":false}')
        return 1
    finally:
        if lock is not None:
            os.close(lock)


if __name__ == '__main__':
    sys.exit(main())
