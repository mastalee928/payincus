#!/usr/bin/env python3
"""Explicit root enrollment; normal service startup must never create identities.

Input is a fixed JSON catalog on stdin. Package trust is supplied by the operator
or verified release installer, never by an HTTP installation request.
"""
import base64
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import secrets
import stat
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('gateway_package', Path(__file__).with_name('verify-gateway-component-package.py'))
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)
ROOT = Path('/var/lib/incudal-gateway-controller')
UUID = re.compile(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}')


def require(condition):
    if not condition:
        raise ValueError('GATEWAY_CONTROLLER_ENROLLMENT_REJECTED')


def public_key(path):
    package.protected_read(path, 16384, 0o600)
    result = subprocess.run(['/usr/bin/openssl', 'pkey', '-in', str(path), '-pubout', '-outform', 'DER'],
                            capture_output=True, timeout=10, check=False)
    require(result.returncode == 0 and len(result.stdout) == 44 and result.stdout[:12] == bytes.fromhex('302a300506032b6570032100'))
    return base64.b64encode(result.stdout[12:]).decode()


def key_id(public):
    return 'key_' + hashlib.sha256(base64.b64decode(public, validate=True)).hexdigest()


def directory(path):
    path = Path(path)
    require(path.is_absolute() and str(path) == os.path.normpath(path) and '..' not in path.parts)
    for parent in [*reversed(path.parents), path]:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)
    return path


def exact(value, keys):
    require(isinstance(value, dict) and set(value) == set(keys))
    return value


def validate_input(value):
    exact(value, ['platformId', 'packageSigningKey', 'components'])
    require(isinstance(value['platformId'], str) and UUID.fullmatch(value['platformId']))
    public = value['packageSigningKey']
    require(isinstance(public, str) and re.fullmatch(r'[A-Za-z0-9+/]{43}=', public))
    decoded = base64.b64decode(public, validate=True)
    require(len(decoded) == 32 and any(decoded) and base64.b64encode(decoded).decode() == public)
    components = value['components']
    require(isinstance(components, dict) and 1 <= len(components) <= 2 and set(components) <= {'amd64', 'arm64'})
    for architecture, component in components.items():
        exact(component, ['directory', 'version', 'sourceCommit'])
        require(isinstance(component['directory'], str) and re.fullmatch(r'/[A-Za-z0-9_./-]+', component['directory']))
        directory(component['directory'])
        package.verify_package(component['directory'], public, architecture, component['version'], component['sourceCommit'])
    return value


def write_atomic(path, data, exclusive=False):
    temporary = path.parent / ('.enrollment-' + secrets.token_hex(16))
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        if exclusive:
            os.link(temporary, path, follow_symlinks=False)
            temporary.unlink()
        else:
            package.protected_read(path, 8192, 0o600)
            os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary.exists():
            temporary.unlink()


def encode(value):
    return json.dumps(value, separators=(',', ':')).encode()


def verify_enrollment(root):
    directory(root)
    require(stat.S_IMODE(root.stat().st_mode) == 0o700)
    saved = package.canonical_json(package.protected_read(root / 'enrollment.json', 8192, 0o600))
    exact(saved, ['schemaVersion', 'platformId', 'signingKeyPath', 'signingKeyId', 'packageSigningKey', 'components'])
    require(saved['schemaVersion'] == 2)
    require(saved['signingKeyPath'] == str(root / 'signing.pem'))
    identity = package.canonical_json(package.protected_read(root / 'identity.json', 1024, 0o600))
    exact(identity, ['schemaVersion', 'platformId', 'signingKeyId', 'packageSigningKey'])
    require(identity['schemaVersion'] == 1 and all(saved[field] == identity[field] for field in ['platformId', 'signingKeyId', 'packageSigningKey']))
    public = public_key(root / 'signing.pem')
    require(saved['signingKeyId'] == key_id(public) and public != saved['packageSigningKey'])
    validate_input({field: saved[field] for field in ['platformId', 'packageSigningKey', 'components']})
    return saved


def enroll(action, value=None, root=ROOT):
    require(action in ['initialize', 'refresh', 'verify'])
    root = Path(root)
    directory(root.parent)
    if not root.exists() and not root.is_symlink():
        require(action == 'initialize')
        root.mkdir(mode=0o700)
    directory(root)
    require(stat.S_IMODE(root.stat().st_mode) == 0o700)
    descriptor = os.open(root / 'enrollment.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if action == 'verify':
            saved = verify_enrollment(root)
        elif action == 'refresh':
            saved = verify_enrollment(root)
            value = validate_input(value)
            require(saved['platformId'] == value['platformId'] and saved['packageSigningKey'] == value['packageSigningKey'])
            saved['components'] = value['components']
            write_atomic(root / 'enrollment.json', encode(saved))
        else:
            value = validate_input(value)
            # A partial identity is evidence of interrupted initialization or loss.
            # Never silently repair it with a new key.
            require(set(item.name for item in root.iterdir()) <= {'enrollment.lock'})
            key = root / 'signing.pem'
            generated = subprocess.run(['/usr/bin/openssl', 'genpkey', '-algorithm', 'Ed25519'], capture_output=True, timeout=10, check=False)
            require(generated.returncode == 0)
            write_atomic(key, generated.stdout, exclusive=True)
            public = public_key(key)
            require(public != value['packageSigningKey'])
            identity = {'schemaVersion': 1, 'platformId': value['platformId'], 'signingKeyId': key_id(public), 'packageSigningKey': value['packageSigningKey']}
            write_atomic(root / 'identity.json', encode(identity), exclusive=True)
            saved = {'schemaVersion': 2, 'platformId': value['platformId'], 'signingKeyPath': str(key), 'signingKeyId': identity['signingKeyId'],
                     'packageSigningKey': value['packageSigningKey'], 'components': value['components']}
            write_atomic(root / 'enrollment.json', encode(saved), exclusive=True)
        saved = verify_enrollment(root)
        return {'verified': True, 'platformId': saved['platformId'], 'signingKeyId': saved['signingKeyId'], 'architectures': sorted(saved['components']), 'canWrite': False}
    finally:
        os.close(descriptor)


def main():
    try:
        require(os.geteuid() == 0 and len(sys.argv) == 2 and sys.argv[1] in ['--initialize', '--refresh', '--verify'])
        action = sys.argv[1][2:]
        value = None
        if action != 'verify':
            raw = sys.stdin.buffer.read(8193)
            require(len(raw) <= 8192)
            value = json.loads(raw, object_pairs_hook=package.strict_object)
        print(json.dumps(enroll(action, value), separators=(',', ':')))
        return 0
    except (ValueError, OSError, KeyError, TypeError, RecursionError, subprocess.SubprocessError):
        print('{"code":"GATEWAY_CONTROLLER_ENROLLMENT_REJECTED","canWrite":false}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
