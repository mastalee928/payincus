#!/usr/bin/env python3
"""Root provisioning regression for signed dual-architecture release components."""
import base64
import fcntl
import copy
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


provisioner = load('gateway_provision', 'provision-gateway-controller.py')
fixtures = load('gateway_fixture', 'test-gateway-component-package.py')


@unittest.skipUnless(hasattr(os, 'geteuid') and os.geteuid() == 0, 'Linux root verification required')
class ProvisioningTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.PackageTests('test_valid')
        self.fixture.setUp()
        self.app = self.fixture.root / 'release'
        self.app.mkdir(mode=0o755)
        (self.app / 'server').mkdir(mode=0o755)
        (self.app / 'server/package.json').write_text('{"version":"1.7.1"}')
        (self.app / 'version.json').write_text(json.dumps({'gitCommit': 'a' * 12}))
        (self.app / 'vendor/gateway').mkdir(parents=True, mode=0o755)
        for architecture in ['amd64', 'arm64']:
            target = self.app / 'vendor/gateway' / architecture
            shutil.copytree(self.fixture.package, target)
            manifest = copy.deepcopy(self.fixture.manifest)
            manifest['architecture'] = architecture
            for item in manifest['files']:
                if item['path'].startswith('bin/'):
                    data = (target / item['path']).read_bytes()
                    data = data[:18] + (62 if architecture == 'amd64' else 183).to_bytes(2, 'little') + data[20:]
                    (target / item['path']).write_bytes(data)
                    item['sha256'] = hashlib.sha256(data).hexdigest()
            payload = base64.b64encode(json.dumps(manifest, separators=(',', ':')).encode()).decode()
            key_id = 'key_' + hashlib.sha256(base64.b64decode(self.fixture.pinned)).hexdigest()
            message = self.fixture.root / 'message'
            message.write_bytes(fixtures.verifier.PREFIX + key_id.encode() + b'\n' + payload.encode())
            signature = subprocess.run(['/usr/bin/openssl', 'pkeyutl', '-sign', '-rawin', '-inkey', str(self.fixture.private), '-in', str(message)], check=True, capture_output=True).stdout
            (target / 'manifest.json').write_bytes(json.dumps({'schemaVersion': 1, 'keyId': key_id, 'payload': payload, 'signature': base64.b64encode(signature).decode()}, separators=(',', ':')).encode())
        self.catalog = {'schemaVersion': 1, 'packageSigningKey': self.fixture.pinned, 'version': '1.7.1', 'sourceCommit': 'a'*40, 'architectures': ['amd64', 'arm64']}
        self.write_catalog()
        self.env = self.fixture.root / '.env'
        self.env.write_text('ENCRYPTION_KEY=fixture-only\nDATABASE_URL=fixture-only\n')
        self.env.chmod(0o640)
        self.controller = self.fixture.root / 'controller'
        self.components = self.fixture.root / 'components'

    def tearDown(self):
        self.fixture.tearDown()

    def write_catalog(self):
        file = self.app / 'vendor/gateway/catalog.json'
        file.write_text(json.dumps(self.catalog))
        file.chmod(0o644)

    def provision(self, action='initialize'):
        return provisioner.provision(action, self.app, self.env, self.controller, self.components)

    def test_signed_components_persist_and_platform_generated(self):
        result = self.provision()
        self.assertEqual(result['architectures'], ['amd64', 'arm64'])
        self.assertIn('GATEWAY_PLATFORM_ID=' + result['platformId'], self.env.read_text())
        self.assertIn('DATABASE_URL=fixture-only', self.env.read_text())
        self.assertEqual(self.env.stat().st_mode & 0o777, 0o640)
        self.assertEqual(len([p for p in self.components.iterdir() if p.is_dir()]), 2)

    def test_refresh_preserves_identity_and_environment(self):
        result = self.provision()
        key = (self.controller / 'signing.pem').read_bytes()
        identity = (self.controller / 'identity.json').read_bytes()
        env = self.env.read_bytes()
        self.assertEqual(self.provision('refresh'), result)
        self.assertEqual((self.controller / 'signing.pem').read_bytes(), key)
        self.assertEqual((self.controller / 'identity.json').read_bytes(), identity)
        self.assertEqual(self.env.read_bytes(), env)

    def test_initialize_refuses_existing_and_partial_identity(self):
        self.provision()
        with self.assertRaises(ValueError):
            self.provision()
        (self.controller / 'enrollment.json').unlink()
        with self.assertRaises(ValueError):
            self.provision()

    def test_refresh_missing_identity_not_initialized(self):
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.provision('refresh')
        self.assertFalse(self.controller.exists())

    def test_wrong_release_commit_rejected_before_identity(self):
        (self.app / 'version.json').write_text(json.dumps({'gitCommit': 'b'*12}))
        with self.assertRaises(ValueError):
            self.provision()
        self.assertFalse(self.controller.exists())

    def test_tampered_component_rejected(self):
        (self.app / 'vendor/gateway/arm64/ui/console.js').write_bytes(b'tampered')
        with self.assertRaises(ValueError):
            self.provision()
        self.assertFalse(self.controller.exists())

    def test_environment_platform_conflict_rejected(self):
        self.provision()
        self.env.write_text('GATEWAY_PLATFORM_ID=22222222-2222-4222-8222-222222222222\n')
        with self.assertRaises(ValueError):
            self.provision('refresh')

    def test_duplicate_environment_platform_and_unknown_catalog_rejected(self):
        self.env.write_text('GATEWAY_PLATFORM_ID=\nGATEWAY_PLATFORM_ID=\n')
        with self.assertRaises(ValueError):
            self.provision()
        self.env.write_text('GATEWAY_PLATFORM_ID=\n')
        self.catalog['command'] = 'unused'
        self.write_catalog()
        with self.assertRaises(ValueError):
            self.provision()

    def test_symlink_env_and_component_path_rejected(self):
        self.env.unlink()
        self.env.symlink_to(self.app / 'version.json')
        with self.assertRaises((ValueError, OSError)):
            self.provision()

    def test_provision_lock_refuses_parallel_mutation(self):
        self.provision()
        with (self.components / 'provision.lock').open('rb') as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                self.provision('refresh')

    def test_wrong_trust_and_version_refused(self):
        self.catalog['packageSigningKey'] = base64.b64encode(bytes([2]) * 32).decode()
        self.write_catalog()
        with self.assertRaises(ValueError):
            self.provision()
        self.catalog['packageSigningKey'] = self.fixture.pinned
        self.catalog['version'] = '1.7.2'
        self.write_catalog()
        with self.assertRaises(ValueError):
            self.provision()

    def test_preconfigured_platform_keeps_its_identity(self):
        platform = '33333333-3333-4333-8333-333333333333'
        self.env.write_text('GATEWAY_PLATFORM_ID=' + platform + '\nOTHER=preserved\n')
        result = self.provision()
        self.assertEqual(result['platformId'], platform)
        self.assertIn('OTHER=preserved', self.env.read_text())

    def test_persisted_component_tamper_not_overwritten(self):
        self.provision()
        path = next(p for p in self.components.iterdir() if p.is_dir()) / 'ui/console.js'
        path.write_bytes(b'tampered')
        with self.assertRaises(ValueError):
            self.provision('refresh')
        self.assertEqual(path.read_bytes(), b'tampered')


if __name__ == '__main__':
    unittest.main()
