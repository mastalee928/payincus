#!/usr/bin/env python3
"""Execute the installer's actual directory gate with real Linux root owners."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.name == 'posix' and hasattr(os, 'geteuid') and os.geteuid() == 0,
                     'Linux root ownership regression required')
class ControllerDirectoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='incudal-controller-directory-')
        self.base = Path(self.temp.name)
        source = Path(__file__).with_name('install-gateway-controller.sh').read_text()
        self.function = re.search(r'^prepare_controller_state_directory\(\) \{.*?^\}', source, re.M | re.S).group()
        self.directory = self.base / 'controller'

    def tearDown(self):
        self.temp.cleanup()

    def execute(self, expected=0):
        result = subprocess.run(['bash', '-c', 'set -Eeuo pipefail\n' + self.function +
                                 '\nprepare_controller_state_directory "$1"', 'directory-test', str(self.directory)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, expected, result.stderr)

    def test_missing_directory_created_private(self):
        self.execute()
        self.assertEqual(self.directory.stat().st_mode & 0o777, 0o700)

    def test_empty_legacy_root_directory_tightened(self):
        self.directory.mkdir(mode=0o755)
        self.directory.chmod(0o755)
        self.execute()
        self.assertEqual(self.directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_existing_private_identity_preserved(self):
        self.directory.mkdir(mode=0o700)
        identity = self.directory / 'signing.pem'
        identity.write_bytes(b'fixture identity must remain unchanged')
        identity.chmod(0o600)
        self.execute()
        self.assertEqual(identity.read_bytes(), b'fixture identity must remain unchanged')
        self.assertEqual(identity.stat().st_mode & 0o777, 0o600)

    def test_nonempty_legacy_directory_refused(self):
        self.directory.mkdir(mode=0o755)
        self.directory.chmod(0o755)
        (self.directory / 'partial').write_bytes(b'partial enrollment')
        self.execute(1)
        self.assertEqual(self.directory.stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.directory / 'partial').read_bytes(), b'partial enrollment')

    def test_writable_directory_refused(self):
        self.directory.mkdir()
        self.directory.chmod(0o777)
        self.execute(1)
        self.assertEqual(self.directory.stat().st_mode & 0o777, 0o777)

    def test_other_owner_refused(self):
        self.directory.mkdir()
        self.directory.chmod(0o755)
        os.chown(self.directory, 65534, 65534)
        self.execute(1)
        self.assertEqual(self.directory.stat().st_uid, 65534)

    def test_symlink_refused_without_touching_target(self):
        target = self.base / 'unrelated'
        target.mkdir(mode=0o755)
        target.chmod(0o755)
        self.directory.symlink_to(target, target_is_directory=True)
        self.execute(1)
        self.assertEqual(target.stat().st_mode & 0o777, 0o755)


if __name__ == '__main__':
    unittest.main()
