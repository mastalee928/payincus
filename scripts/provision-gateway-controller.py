#!/usr/bin/env python3
"""Provision verified release components; initialization is an explicit install step."""
import hashlib
import fcntl
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import uuid
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('gateway_enrollment', Path(__file__).with_name('enroll-gateway-controller.py'))
enrollment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enrollment)
package = enrollment.package
require = enrollment.require
COMPONENT_ROOT = Path('/var/lib/incudal-gateway-components')
INSTALL = Path('/opt/incudal')
PROVISION_STAGE = 'arguments'


def stage(value):
    # Only fixed stage names are exposed. Never include file contents, environment
    # values, signatures, keys, exception text or subprocess output.
    global PROVISION_STAGE
    PROVISION_STAGE = value


def read_environment(path):
    raw = package.protected_read(path, 1024 * 1024).decode()
    matches = re.findall(r'^GATEWAY_PLATFORM_ID=(.*)$', raw, re.M)
    require(len(matches) <= 1)
    value = matches[0].strip() if matches else ''
    if value.startswith("'") and value.endswith("'"):
        value = value[1:-1]
    require(not value or enrollment.UUID.fullmatch(value))
    return raw, value


def release_catalog(app):
    stage('release-directory')
    enrollment.directory(app)
    stage('catalog-file')
    catalog = json.loads(package.protected_read(app / 'vendor/gateway/catalog.json', 8192, 0o644), object_pairs_hook=package.strict_object)
    stage('catalog-fields')
    enrollment.exact(catalog, ['schemaVersion', 'packageSigningKey', 'version', 'sourceCommit', 'architectures'])
    require(catalog['schemaVersion'] == 1 and catalog['architectures'] == ['amd64', 'arm64'])
    require(isinstance(catalog['version'], str) and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', catalog['version']))
    require(isinstance(catalog['sourceCommit'], str) and re.fullmatch(r'[a-f0-9]{40}', catalog['sourceCommit']))
    stage('version-metadata')
    metadata = json.loads(package.protected_read(app / 'version.json', 8192), object_pairs_hook=package.strict_object)
    require(isinstance(metadata, dict) and isinstance(metadata.get('gitCommit'), str) and
            12 <= len(metadata['gitCommit']) <= 40 and catalog['sourceCommit'].startswith(metadata['gitCommit']))
    stage('server-version')
    version = json.loads(package.protected_read(app / 'server/package.json', 65536), object_pairs_hook=package.strict_object)
    require(version.get('version') == catalog['version'])
    for architecture in catalog['architectures']:
        stage('verify-' + architecture)
        package.verify_package(app / 'vendor/gateway' / architecture, catalog['packageSigningKey'], architecture, catalog['version'], catalog['sourceCommit'])
    return catalog


def persist_component(app, catalog, architecture, component_root):
    source = app / 'vendor/gateway' / architecture
    manifest = package.protected_read(source / 'manifest.json', 49152, 0o644)
    digest = hashlib.sha256(manifest).hexdigest()
    destination = component_root / digest
    if destination.exists() or destination.is_symlink():
        package.verify_package(destination, catalog['packageSigningKey'], architecture, catalog['version'], catalog['sourceCommit'])
    else:
        temporary = component_root / ('.stage-' + uuid.uuid4().hex)
        try:
            # Package verification has already rejected links and unexpected files.
            shutil.copytree(source, temporary)
            package.verify_package(temporary, catalog['packageSigningKey'], architecture, catalog['version'], catalog['sourceCommit'])
            os.rename(temporary, destination)
            descriptor = os.open(component_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
    return {'directory': str(destination), 'version': catalog['version'], 'sourceCommit': catalog['sourceCommit']}


def provision_locked(action, app, env_path, controller_root, component_root):
    require(action in ['initialize', 'refresh'])
    app = Path(app)
    catalog = release_catalog(app)
    stage('environment')
    raw, platform = read_environment(env_path)
    if action == 'refresh':
        stage('existing-identity')
        saved = enrollment.verify_enrollment(controller_root)
        require(platform == saved['platformId'] and catalog['packageSigningKey'] == saved['packageSigningKey'])
    else:
        stage('fresh-identity')
        # Existing or partial state must never be adopted by fresh provisioning.
        require(not controller_root.exists() or set(item.name for item in controller_root.iterdir()) <= {'enrollment.lock'})
        platform = platform or str(uuid.uuid4())
    stage('persist-components')
    components = {architecture: persist_component(app, catalog, architecture, component_root) for architecture in catalog['architectures']}
    value = {'platformId': platform, 'packageSigningKey': catalog['packageSigningKey'], 'components': components}
    stage('enroll-identity')
    result = enrollment.enroll(action, value, controller_root)
    if action == 'initialize':
        stage('publish-environment')
        # Preserve the exact runtime file except the platform identity setting.
        if re.search(r'^GATEWAY_PLATFORM_ID=', raw, re.M):
            updated = re.sub(r'^GATEWAY_PLATFORM_ID=.*$', 'GATEWAY_PLATFORM_ID=' + platform, raw, flags=re.M)
        else:
            updated = raw.rstrip('\n') + '\nGATEWAY_PLATFORM_ID=' + platform + '\n'
        info = env_path.lstat()
        temporary = env_path.parent / ('.gateway-env-' + uuid.uuid4().hex)
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, stat.S_IMODE(info.st_mode))
        try:
            with os.fdopen(descriptor, 'wb', closefd=False) as file:
                os.fchown(descriptor, info.st_uid, info.st_gid)
                os.fchmod(descriptor, stat.S_IMODE(info.st_mode))
                file.write(updated.encode())
                file.flush()
                os.fsync(file.fileno())
            current = env_path.lstat()
            require(current.st_ino == info.st_ino and current.st_dev == info.st_dev and package.protected_read(env_path, 1024 * 1024).decode() == raw)
            os.replace(temporary, env_path)
            parent = os.open(env_path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(parent)
            finally:
                os.close(parent)
        finally:
            os.close(descriptor)
            if temporary.exists():
                temporary.unlink()
    return result


def provision(action, app, env_path=INSTALL / '.env', controller_root=enrollment.ROOT, component_root=COMPONENT_ROOT):
    stage('component-directory')
    component_root = Path(component_root)
    env_path = Path(env_path)
    controller_root = Path(controller_root)
    enrollment.directory(component_root.parent)
    if not component_root.exists() and not component_root.is_symlink():
        component_root.mkdir(mode=0o700)
    enrollment.directory(component_root)
    require(stat.S_IMODE(component_root.stat().st_mode) == 0o700)
    descriptor = os.open(component_root / 'provision.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        stage('release-catalog')
        return provision_locked(action, app, env_path, controller_root, component_root)
    finally:
        os.close(descriptor)


def main():
    try:
        require(os.geteuid() == 0 and len(sys.argv) == 3 and sys.argv[1] in ['--initialize', '--refresh'])
        app = Path(sys.argv[2])
        require(app == INSTALL or (app.is_absolute() and app.parent == INSTALL / 'releases'))
        print(json.dumps(provision(sys.argv[1][2:], app), separators=(',', ':')))
        return 0
    except (ValueError, OSError, KeyError, TypeError, RecursionError, subprocess.SubprocessError):
        print(json.dumps({'code': 'GATEWAY_CONTROLLER_PROVISIONING_REJECTED', 'stage': PROVISION_STAGE, 'canWrite': False}, separators=(',', ':')))
        return 1


if __name__ == '__main__':
    sys.exit(main())
