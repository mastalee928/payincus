#!/usr/bin/env python3
"""Verify an extracted package against an independently pinned Ed25519 key."""
import base64
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

FILES = sorted([
    'LICENSE',
    'bin/incudal-channels', 'bin/incudal-gateway', 'bin/incudal-maintenance', 'bin/node',
    'lib/gateway-console.cjs', 'lib/gateway-backup.cjs', 'lib/controller-discovery.cjs', 'lib/controller-witness.cjs',
    'ui/index.html', 'ui/console.css', 'ui/console.js',
    'scripts/install-management-gateway.sh', 'scripts/install-management-channels.sh', 'scripts/install-gateway-console.sh',
    'scripts/install-gateway-backup.sh', 'scripts/probe-management-gateway.py',
    'scripts/gateway-install-plan.py', 'scripts/verify-gateway-component-package.py',
    'scripts/execute-gateway-install.py',
])
PREFIX = b'payincus/gateway-component-package/v1\n'
PROTOCOLS = {'gatewayTransport': 1, 'managementChannels': 1, 'maintenance': 1, 'discovery': 1, 'witness': 1, 'console': 1, 'backup': 1}


def require(condition):
    if not condition:
        raise ValueError('package verification failed')


def strict_object(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value)
        value[key] = item
    return value


def canonical_json(raw):
    value = json.loads(raw, object_pairs_hook=strict_object)
    require(json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode() == raw)
    return value


def protected_read(path, limit, mode=None):
    path = Path(path)
    require(path.is_absolute() and str(path) == str(Path(os.path.normpath(path))))
    for parent in path.parents:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        info = os.fstat(handle.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and info.st_size <= limit and not info.st_mode & 0o022)
        if mode is not None:
            require(stat.S_IMODE(info.st_mode) == mode)
        raw = handle.read(limit + 1)
        require(len(raw) <= limit)
        return raw


def verify_signature(envelope, pinned, *, prefix=PREFIX):
    require(isinstance(envelope, dict) and set(envelope) == {'schemaVersion', 'keyId', 'payload', 'signature'} and type(envelope['schemaVersion']) is int and envelope['schemaVersion'] == 1)
    public_key = base64.b64decode(pinned, validate=True)
    require(len(public_key) == 32 and base64.b64encode(public_key).decode() == pinned)
    key_id = 'key_' + hashlib.sha256(public_key).hexdigest()
    require(envelope['keyId'] == key_id)
    payload = base64.b64decode(envelope['payload'], validate=True)
    signature = base64.b64decode(envelope['signature'], validate=True)
    require(len(payload) <= 32768 and len(signature) == 64 and base64.b64encode(payload).decode() == envelope['payload'] and base64.b64encode(signature).decode() == envelope['signature'])
    message = prefix + key_id.encode() + b'\n' + envelope['payload'].encode()
    with tempfile.TemporaryDirectory(prefix='incudal-package-signature-') as directory:
        root = Path(directory)
        (root / 'public.der').write_bytes(bytes.fromhex('302a300506032b6570032100') + public_key)
        (root / 'signature').write_bytes(signature)
        (root / 'message').write_bytes(message)
        verified = subprocess.run(['/usr/bin/openssl', 'pkeyutl', '-verify', '-pubin', '-keyform', 'DER', '-rawin',
                                   '-inkey', str(root / 'public.der'), '-sigfile', str(root / 'signature'), '-in', str(root / 'message')],
                                  stdin=subprocess.DEVNULL, capture_output=True, timeout=10, check=False)
        require(verified.returncode == 0)
    return canonical_json(payload)


def verify_package(directory, pinned, architecture, expected_version, expected_commit):
    require(architecture in ('amd64', 'arm64') and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', expected_version) and re.fullmatch(r'[a-f0-9]{40}', expected_commit))
    root = Path(directory)
    manifest_raw = protected_read(root / 'manifest.json', 49152, 0o644)
    manifest = verify_signature(canonical_json(manifest_raw), pinned)
    require(isinstance(manifest, dict) and set(manifest) == {'schemaVersion', 'purpose', 'version', 'sourceCommit', 'architecture', 'protocols', 'files'})
    require(type(manifest['schemaVersion']) is int and manifest['schemaVersion'] == 1 and manifest['purpose'] == 'gateway-component-package')
    require(manifest['architecture'] == architecture and manifest['version'] == expected_version and manifest['sourceCommit'] == expected_commit)
    require(manifest['protocols'] == PROTOCOLS and all(type(value) is int for value in manifest['protocols'].values()))
    require(isinstance(manifest['files'], list) and all(isinstance(item, dict) for item in manifest['files']) and
            [item.get('path') for item in manifest['files']] == FILES)
    observed_files, observed_directories = [], []
    def walk(path):
        for item in path.iterdir():
            info = item.lstat()
            require(not stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)
            relative = item.relative_to(root).as_posix()
            if stat.S_ISDIR(info.st_mode):
                observed_directories.append(relative)
                walk(item)
            else:
                require(stat.S_ISREG(info.st_mode))
                observed_files.append(relative)
    walk(root)
    require(sorted(observed_files) == sorted(FILES + ['manifest.json', 'package.json']) and sorted(observed_directories) == ['bin', 'lib', 'scripts', 'ui'])
    require(protected_read(root / 'package.json', 128, 0o644) == b'{"type":"commonjs","private":true}')
    total = 0
    for item in manifest['files']:
        require(set(item) == {'path', 'size', 'sha256', 'mode'} and type(item['size']) is int and 0 < item['size'] <= 200 * 1024 * 1024)
        require(isinstance(item['sha256'], str) and re.fullmatch(r'[a-f0-9]{64}', item['sha256']))
        expected_mode = 0o755 if item['path'].startswith('bin/') or item['path'].endswith('.sh') else 0o644
        require(type(item['mode']) is int and item['mode'] == expected_mode)
        contents = protected_read(root / item['path'], item['size'], expected_mode)
        require(len(contents) == item['size'] and hashlib.sha256(contents).hexdigest() == item['sha256'])
        if item['path'].startswith('bin/'):
            require(len(contents) >= 20 and contents[:6] == b'\x7fELF\x02\x01' and int.from_bytes(contents[18:20], 'little') == (62 if architecture == 'amd64' else 183))
        total += item['size']
    require(total <= 256 * 1024 * 1024)
    return {'verified': True, 'architecture': architecture, 'version': expected_version, 'sourceCommit': expected_commit,
            'files': len(FILES), 'manifestHash': hashlib.sha256(manifest_raw).hexdigest(), 'canWrite': False}


def main():
    try:
        require(len(sys.argv) == 6 and os.geteuid() == 0)
        directory, trust_path, architecture, version, commit = sys.argv[1:]
        pinned = protected_read(trust_path, 64, 0o600).decode().strip()
        print(json.dumps(verify_package(directory, pinned, architecture, version, commit), separators=(',', ':')))
    except (ValueError, OSError, KeyError, TypeError, RecursionError, subprocess.SubprocessError):
        print('{"code":"GATEWAY_PACKAGE_REJECTED","canWrite":false}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
