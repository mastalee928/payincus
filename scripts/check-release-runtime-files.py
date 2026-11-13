#!/usr/bin/env python3
"""Compare the completed archive with this build, including runtime scripts."""
import hashlib
import re
import sys
import tarfile
from pathlib import Path


def check(archive_path, root):
    expected = {}
    for directory in ['server/dist', 'server/prisma', 'server/templates', 'client/dist']:
        files = [path for path in (root / directory).rglob('*') if path.is_file()]
        if not files:
            raise ValueError('Missing build directory: ' + directory)
        expected.update({path.relative_to(root).as_posix(): path for path in files})
    for name in ['package.json', 'server/package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
                 'scripts/ensure-time-sync.py', 'scripts/install-platform-backup.sh',
                 'scripts/install-gateway-controller.sh', 'scripts/provision-gateway-controller.py',
                 'scripts/enroll-gateway-controller.py', 'scripts/verify-gateway-component-package.py']:
        expected[name] = root / name
    # These scripts are read at runtime, so a successful TS build cannot catch
    # their omission from the archive. Ignore only non-text source bytes.
    for path in (root / 'server/src').rglob('*.ts'):
        for name in re.findall(r'scripts/([A-Za-z0-9_.-]+\.(?:py|sh))', path.read_text(encoding='utf-8', errors='replace')):
            expected['scripts/' + name] = root / 'scripts' / name
    for arch in ['amd64', 'arm64']:
        for name in ['ensure-time-sync.py', 'install-management-gateway.sh', 'verify-gateway-component-package.py']:
            expected[f'vendor/gateway/{arch}/scripts/{name}'] = root / 'scripts' / name
    hashes = {}
    for name, path in expected.items():
        with path.open('rb') as stream:
            hashes[name] = hashlib.file_digest(stream, 'sha256').digest()
    seen = set()
    with tarfile.open(archive_path, 'r|gz') as archive:
        for member in archive:
            name = member.name.removeprefix('./')
            if name.startswith('server/images/'):
                raise ValueError('Persistent image library must not be bundled with program updates')
            if name in seen:
                raise ValueError('Duplicate archive path: ' + name)
            seen.add(name)
            if name in hashes:
                if not member.isfile() or member.uid != 0 or member.gid != 0:
                    raise ValueError('Invalid runtime file ownership/type: ' + name)
                with archive.extractfile(member) as file:
                    if hashlib.file_digest(file, 'sha256').digest() != hashes[name]:
                        raise ValueError('Stale runtime content: ' + name)
    missing = hashes.keys() - seen
    if missing:
        raise ValueError('Missing runtime files: ' + ', '.join(sorted(missing)))
    print(f'PASS complete archive: {len(hashes)} built frontend/backend/schema/template/runtime files match this build; clock helpers included in both signed components')


if __name__ == '__main__':
    check(sys.argv[1], Path(__file__).resolve().parent.parent)
