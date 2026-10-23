#!/usr/bin/env python3
"""Linux root enrollment regression with genuine signed disposable packages."""
import fcntl
import importlib.util
import json
import os
import subprocess
import unittest
from pathlib import Path


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


enrollment = load('gateway_enrollment', 'enroll-gateway-controller.py')
fixtures = load('gateway_package_fixtures', 'test-gateway-component-package.py')


@unittest.skipUnless(hasattr(os, 'geteuid') and os.geteuid() == 0, 'Linux root file verification required')
class EnrollmentTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.PackageTests('test_valid')
        self.fixture.setUp()
        self.root = self.fixture.root / 'controller'
        self.value = {'platformId': '11111111-1111-4111-8111-111111111111', 'packageSigningKey': self.fixture.pinned,
                      'components': {'arm64': {'directory': str(self.fixture.package), 'version': '1.7.1', 'sourceCommit': 'a' * 40}}}

    def tearDown(self):
        self.fixture.tearDown()

    def initialize(self):
        return enrollment.enroll('initialize', self.value, self.root)

    def test_explicit_identity_and_independent_signing(self):
        result = self.initialize()
        self.assertTrue(result['verified'])
        self.assertFalse(result['canWrite'])
        self.assertEqual(result['architectures'], ['arm64'])
        self.assertNotEqual(enrollment.public_key(self.root / 'signing.pem'), self.fixture.pinned)
        self.assertEqual((self.root / 'signing.pem').stat().st_mode & 0o777, 0o600)
        self.assertEqual(enrollment.enroll('verify', root=self.root), result)

    def test_repeat_initialization_preserves_key_and_refuses(self):
        self.initialize()
        original = (self.root / 'signing.pem').read_bytes()
        with self.assertRaises(ValueError):
            self.initialize()
        self.assertEqual((self.root / 'signing.pem').read_bytes(), original)

    def test_verify_and_refresh_cannot_initialize_missing_identity(self):
        for action in ['verify', 'refresh']:
            with self.assertRaises((ValueError, FileNotFoundError)):
                enrollment.enroll(action, self.value, self.root)
        self.assertFalse(self.root.exists())

    def test_partial_initialization_is_not_repaired(self):
        self.root.mkdir(mode=0o700)
        (self.root / 'signing.pem').write_text('partial')
        (self.root / 'signing.pem').chmod(0o600)
        with self.assertRaises(ValueError):
            self.initialize()
        self.assertEqual((self.root / 'signing.pem').read_text(), 'partial')

    def test_refresh_keeps_identity_and_key_bytes(self):
        result = self.initialize()
        identity = (self.root / 'identity.json').read_bytes()
        key = (self.root / 'signing.pem').read_bytes()
        self.assertEqual(enrollment.enroll('refresh', self.value, self.root), result)
        self.assertEqual((self.root / 'identity.json').read_bytes(), identity)
        self.assertEqual((self.root / 'signing.pem').read_bytes(), key)

    def test_platform_and_trust_change_rejected(self):
        self.initialize()
        original = (self.root / 'enrollment.json').read_bytes()
        changed = dict(self.value, platformId='22222222-2222-4222-8222-222222222222')
        with self.assertRaises(ValueError):
            enrollment.enroll('refresh', changed, self.root)
        self.assertEqual((self.root / 'enrollment.json').read_bytes(), original)

    def test_package_tamper_blocks_initialization_and_refresh(self):
        self.initialize()
        package = self.fixture.package / 'ui/console.js'
        package.write_bytes(b'tampered')
        with self.assertRaises(ValueError):
            enrollment.enroll('refresh', self.value, self.root)
        with self.assertRaises(ValueError):
            enrollment.enroll('initialize', self.value, self.fixture.root / 'other')
        self.assertFalse((self.fixture.root / 'other/signing.pem').exists())

    def test_identity_or_signing_key_replacement_rejected(self):
        self.initialize()
        subprocess.run(['/usr/bin/openssl', 'genpkey', '-algorithm', 'Ed25519', '-out', str(self.root / 'signing.pem')], check=True, capture_output=True)
        with self.assertRaises(ValueError):
            enrollment.enroll('verify', root=self.root)

    def test_missing_identity_keeps_key_and_refuses(self):
        self.initialize()
        key = (self.root / 'signing.pem').read_bytes()
        (self.root / 'identity.json').unlink()
        for action in ['verify', 'refresh', 'initialize']:
            with self.assertRaises((ValueError, FileNotFoundError)):
                enrollment.enroll(action, self.value, self.root)
        self.assertEqual((self.root / 'signing.pem').read_bytes(), key)

    def test_symlink_and_relaxed_permissions_refused(self):
        self.initialize()
        key = self.root / 'signing.pem'
        key.chmod(0o644)
        with self.assertRaises(ValueError):
            enrollment.enroll('verify', root=self.root)
        key.chmod(0o600)
        link = self.fixture.root / 'link'
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            enrollment.enroll('verify', root=link)

    def test_busy_lock_refused(self):
        self.initialize()
        with (self.root / 'enrollment.lock').open('rb') as file:
            fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                enrollment.enroll('refresh', self.value, self.root)

    def test_strict_input_and_legacy_must_not_implicitly_adopt(self):
        for changed in [dict(self.value, command='unused'), dict(self.value, platformId='invalid'), dict(self.value, components={})]:
            with self.assertRaises(ValueError):
                enrollment.validate_input(changed)
        self.root.mkdir(mode=0o700)
        (self.root / 'enrollment.json').write_text(json.dumps({'schemaVersion': 1}))
        (self.root / 'enrollment.json').chmod(0o600)
        with self.assertRaises(ValueError):
            enrollment.enroll('refresh', self.value, self.root)


if __name__ == '__main__':
    unittest.main()
