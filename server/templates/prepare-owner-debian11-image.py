#!/usr/bin/env python3
"""Derive a cloud-compatible archive from one of two owner-selected assets.

Streaming archive rewrite only: never extract or execute the supplied rootfs.
The original bytes, architecture and metadata are pinned before conversion.
"""
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile

SOURCES = {
    'amd64': '7343b1d120bfadde3888c221d959501b9991ffaea81e60f977555c94775ab463',
    'arm64': '54fb35a5532b1c17c3102237b31fa4086166f09339aa723f44d8ed0846864831',
}
BOOTSTRAP = Path(__file__).with_name('owner-debian11-bootstrap.sh').read_bytes()


def convert(source, destination, architecture):
    if architecture not in SOURCES or source.resolve() == destination.resolve():
        raise ValueError('DEBIAN11_IMAGE_ARGUMENT_INVALID')
    with source.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != SOURCES[architecture]:
        raise ValueError('DEBIAN11_IMAGE_HASH_MISMATCH')
    arch = 'x86_64' if architecture == 'amd64' else 'aarch64'
    expected = 62 if architecture == 'amd64' else 183
    metadata = f'''architecture: {arch}
creation_date: 1760655546
properties:
  architecture: {arch}
  description: "Debian 11 (owner-selected source, PayIncus cloud bootstrap)"
  os: Debian
  release: bullseye
  variant: cloud
  user.payincus.source-sha256: {digest}
templates:
  /var/lib/cloud/seed/nocloud-net/user-data:
    when: [create, copy]
    template: user-data.tpl
  /var/lib/cloud/seed/nocloud-net/network-config:
    when: [create, copy]
    template: network-config.tpl
  /var/lib/cloud/seed/nocloud-net/meta-data:
    when: [create, copy]
    template: meta-data.tpl
'''.encode()
    extra = {
        'metadata.yaml': (metadata, 0o644),
        'templates/user-data.tpl': (b'{{ config_get("cloud-init.user-data", config_get("user.user-data", "")) }}\n', 0o644),
        'templates/network-config.tpl': (b'{{ config_get("cloud-init.network-config", config_get("user.network-config", "")) }}\n', 0o644),
        'templates/meta-data.tpl': (b'instance-id: {{ container.name }}\nlocal-hostname: {{ container.name }}\n', 0o644),
        'rootfs/etc/machine-id': (b'', 0o644),
        'rootfs/var/lib/dbus/machine-id': (b'', 0o644),
        'rootfs/etc/cloud/cloud-init.disabled': (b'', 0o644),
        'rootfs/etc/apt/sources.list': (b'deb https://archive.debian.org/debian bullseye main contrib\ndeb https://archive.debian.org/debian-security bullseye-security main contrib\n', 0o644),
        'rootfs/usr/local/sbin/payincus-image-bootstrap': (BOOTSTRAP, 0o700),
        'rootfs/etc/systemd/system/payincus-image-bootstrap.service': (b'''[Unit]
Description=Initialize owner-selected Debian 11 image
Wants=network-online.target
After=network-online.target
ConditionPathExists=!/var/lib/incudal/image-bootstrap-complete

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/payincus-image-bootstrap
TimeoutStartSec=240

[Install]
WantedBy=multi-user.target
''', 0o644),
    }
    seen, total, elf_verified, metadata_verified = set(), 0, False, False
    with destination.open('xb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as zipped, \
            tarfile.open(fileobj=zipped, mode='w|', format=tarfile.PAX_FORMAT) as output, \
            tarfile.open(source, mode='r|gz') as original:
        for item in original:
            name = item.name.removeprefix('./').rstrip('/')
            if not name or name.startswith('/') or '..' in PurePosixPath(name).parts or name in seen or \
                    not (name == 'metadata.yaml' or name == 'rootfs' or name.startswith('rootfs/')):
                raise ValueError('DEBIAN11_IMAGE_ARCHIVE_INVALID')
            seen.add(name)
            total += item.size
            if len(seen) > 50000 or item.size > 256 * 1024 * 1024 or total > 2 * 1024 * 1024 * 1024:
                raise ValueError('DEBIAN11_IMAGE_ARCHIVE_TOO_LARGE')
            content = original.extractfile(item) if item.isfile() else None
            if name == 'metadata.yaml':
                text = content.read().decode()
                if not re.search(r'^architecture: ' + arch + r'$', text, re.M) or 'bullseye' not in text:
                    raise ValueError('DEBIAN11_IMAGE_ARCHITECTURE_MISMATCH')
                metadata_verified = True
                continue
            if name == 'rootfs/usr/lib/systemd/systemd':
                head = content.read(20)
                if head[:4] != b'\x7fELF' or int.from_bytes(head[18:20], 'little') != expected:
                    raise ValueError('DEBIAN11_IMAGE_ARCHITECTURE_MISMATCH')
                elf_verified = True
                # A small native binary, retained byte-for-byte.
                content = io.BytesIO(head + content.read())
            if name in extra or name.startswith('rootfs/etc/ssh/ssh_host_') or name.startswith('rootfs/root/.ssh/') or \
                    name.startswith('rootfs/var/lib/apt/lists/') or name.startswith('rootfs/var/cache/apt/archives/'):
                continue
            # Lock inherited account passwords. New passwords come exclusively
            # from the platform's generated initialization after import.
            if name == 'rootfs/etc/shadow' and content:
                lines = content.read().decode().splitlines()
                data = '\n'.join(':'.join([parts[0], '!', *parts[2:]]) for parts in (line.split(':') for line in lines)) + '\n'
                content = io.BytesIO(data.encode())
                item.size = len(data.encode())
            # Rootfs service/data ownership belongs to Debian. Preserve it;
            # only the newly added platform files are owned by root.
            output.addfile(item, content)
        if not elf_verified or not metadata_verified:
            raise ValueError('DEBIAN11_IMAGE_METADATA_MISSING')
        for path in ['templates', 'rootfs/etc/cloud', 'rootfs/etc/cloud/cloud.cfg.d', 'rootfs/var/lib/cloud',
                     'rootfs/var/lib/cloud/seed', 'rootfs/var/lib/cloud/seed/nocloud-net']:
            if path not in seen:
                member = tarfile.TarInfo(path)
                member.type = tarfile.DIRTYPE
                member.mode = 0o755
                output.addfile(member)
        for name, (data, mode) in extra.items():
            member = tarfile.TarInfo(name)
            member.size, member.mode = len(data), mode
            output.addfile(member, io.BytesIO(data))
        member = tarfile.TarInfo('rootfs/etc/systemd/system/multi-user.target.wants/payincus-image-bootstrap.service')
        member.type, member.mode = tarfile.SYMTYPE, 0o777
        member.linkname = '../payincus-image-bootstrap.service'
        output.addfile(member)
    with destination.open('rb') as stream:
        fingerprint = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'architecture': arch, 'sha256': fingerprint, 'size': destination.stat().st_size, 'sourceSha256': digest}


if __name__ == '__main__':
    print(json.dumps(convert(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])))
