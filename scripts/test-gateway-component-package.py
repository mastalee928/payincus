#!/usr/bin/env python3
"""Explicit Linux/root package verification failures against disposable files."""
import base64
import hashlib
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('gateway_package', Path(__file__).with_name('verify-gateway-component-package.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


@unittest.skipUnless(os.geteuid() == 0 if hasattr(os, 'geteuid') else False, 'requires Linux root protected-file semantics')
class PackageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='incudal-component-test-', dir='/root')
        self.root = Path(self.directory.name)
        self.package = self.root / 'package'
        self.package.mkdir(mode=0o700)
        self.private = self.root / 'private.pem'
        subprocess.run(['/usr/bin/openssl', 'genpkey', '-algorithm', 'Ed25519', '-out', str(self.private)], check=True, capture_output=True)
        pub = subprocess.run(['/usr/bin/openssl', 'pkey', '-in', str(self.private), '-pubout', '-outform', 'DER'], check=True, capture_output=True).stdout[-32:]
        self.pinned = base64.b64encode(pub).decode()
        self.manifest = {'schemaVersion': 1, 'purpose': 'gateway-component-package', 'version': '1.7.1', 'sourceCommit': 'a'*40,
                         'architecture': 'arm64', 'protocols': verifier.PROTOCOLS, 'files': []}
        for name in verifier.FILES:
            path = self.package / name
            path.parent.mkdir(mode=0o755, exist_ok=True)
            mode = 0o755 if name.startswith('bin/') or name.endswith('.sh') else 0o644
            raw = b'fixture-file'
            if name.startswith('bin/'):
                raw = b'\x7fELF\x02\x01' + bytes(12) + (183).to_bytes(2, 'little') + b'fixture'
            path.write_bytes(raw)
            path.chmod(mode)
            self.manifest['files'].append({'path': name, 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'mode': mode})
        (self.package / 'package.json').write_bytes(b'{"type":"commonjs","private":true}')
        (self.package / 'package.json').chmod(0o644)
        self.sign()

    def sign(self):
        payload = base64.b64encode(json.dumps(self.manifest, separators=(',', ':')).encode()).decode()
        key_id = 'key_' + hashlib.sha256(base64.b64decode(self.pinned)).hexdigest()
        (self.root / 'message').write_bytes(verifier.PREFIX + key_id.encode() + b'\n' + payload.encode())
        signature = subprocess.run(['/usr/bin/openssl', 'pkeyutl', '-sign', '-rawin', '-inkey', str(self.private), '-in', str(self.root / 'message')], check=True, capture_output=True).stdout
        envelope = {'schemaVersion': 1, 'keyId': key_id, 'payload': payload, 'signature': base64.b64encode(signature).decode()}
        (self.package / 'manifest.json').write_text(json.dumps(envelope, separators=(',', ':')))
        (self.package / 'manifest.json').chmod(0o644)

    def verify(self, **kwargs):
        return verifier.verify_package(str(self.package), kwargs.get('pinned', self.pinned), kwargs.get('architecture', 'arm64'), kwargs.get('version', '1.7.1'), kwargs.get('commit', 'a'*40))

    def tearDown(self):
        self.directory.cleanup()

    def test_valid(self):
        self.assertEqual(self.verify()['files'], 20)
        self.assertFalse(self.verify()['canWrite'])

    def test_binding(self):
        for kwargs in ({'architecture': 'amd64'}, {'version': '1.7.2'}, {'commit': 'b'*40}, {'pinned': base64.b64encode(bytes(32)).decode()}):
            with self.assertRaises(ValueError):
                self.verify(**kwargs)

    def test_tamper(self):
        (self.package / 'lib/gateway-console.cjs').write_bytes(b'tampered-data')
        with self.assertRaises(ValueError):
            self.verify()

    def test_extra(self):
        (self.package / 'extra').write_text('unexpected')
        with self.assertRaises(ValueError):
            self.verify()

    def test_links(self):
        file = self.package / 'ui/index.html'
        file.unlink()
        file.symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):
            self.verify()

    def test_hardlink(self):
        os.link(self.package / 'ui/index.html', self.root / 'extra-link')
        with self.assertRaises(ValueError):
            self.verify()

    def test_permission(self):
        (self.package / 'ui/index.html').chmod(0o666)
        with self.assertRaises(ValueError):
            self.verify()

    def test_bad_elf_signed(self):
        path = self.package / 'bin/incudal-gateway'
        path.write_bytes(b'not-an-elf')
        item = next(item for item in self.manifest['files'] if item['path'] == 'bin/incudal-gateway')
        item['size'] = path.stat().st_size
        item['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.sign()
        with self.assertRaises(ValueError):
            self.verify()

    def test_protocol_change_signed(self):
        self.manifest['protocols'] = {**self.manifest['protocols'], 'witness': 2}
        self.sign()
        with self.assertRaises(ValueError):
            self.verify()

    def test_signed_path_escape(self):
        self.manifest['files'][0]['path'] = '../outside'
        self.sign()
        with self.assertRaises(ValueError):
            self.verify()

    def test_duplicate_json(self):
        with self.assertRaises(ValueError):
            verifier.canonical_json(b'{"schemaVersion":1,"schemaVersion":1}')

    def test_malformed_signed_file(self):
        for entry in (None, [], 'path', 1):
            self.manifest['files'][0] = entry
            self.sign()
            with self.assertRaises(ValueError):
                self.verify()


if __name__ == '__main__':
    unittest.main()
