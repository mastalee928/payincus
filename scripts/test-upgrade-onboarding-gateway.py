#!/usr/bin/env python3
"""Fixed-helper upgrade boundaries without a live remote gateway."""
import base64
import importlib.util
import os
from pathlib import Path
import stat
import sys
import types
import unittest
from unittest.mock import patch

if os.name == 'nt':
    sys.modules.setdefault('fcntl', types.SimpleNamespace(LOCK_EX=2, LOCK_NB=4, flock=lambda *_: None))
spec = importlib.util.spec_from_file_location('upgrade_gateway', Path(__file__).with_name('upgrade-onboarding-gateway.py'))
upgrade = importlib.util.module_from_spec(spec); spec.loader.exec_module(upgrade)


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.identity = {'publicKey': 'gateway-public', 'controlIp': '10.253.240.1', 'network': '10.253.240.0/20',
                         'managementSshPublicKey': 'management-public'}
        self.source = {name: b'# fixed repository helper\n' for name in upgrade.NAMES}
        self.request = {'identity': self.identity, 'sources': {name: base64.b64encode(raw).decode() for name, raw in self.source.items()}}
        self.files = {upgrade.HELPER: b'# old helper\n'}; self.writes = []
        def publish(path, raw, mode):
            self.writes.append((path, mode)); self.files[path] = raw
        for mock in [patch.object(upgrade, 'directories'), patch.object(upgrade, 'read', side_effect=lambda path, *_: self.files[path]),
                     patch.object(upgrade, 'identity', return_value=dict(self.identity)), patch.object(upgrade, 'snapshot', return_value={'identity': 'same'}),
                     patch.object(upgrade, 'publish', side_effect=publish), patch.object(upgrade.Path, 'exists', return_value=True),
                     patch.object(upgrade.os, 'open', return_value=100), patch.object(upgrade.os, 'close'),
                     patch.object(upgrade.os, 'fstat', return_value=types.SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_nlink=1)),
                     patch.object(upgrade.fcntl, 'flock'),
                     *([patch.object(upgrade.os, 'O_NOFOLLOW', 0, create=True), patch.object(upgrade.os, 'O_NONBLOCK', 0, create=True)] if os.name == 'nt' else [])]:
            mock.start(); self.addCleanup(mock.stop)

    def test_fixed_sources_publish_entrypoint_last_and_replay_preserves_identity(self):
        result = upgrade.upgrade(self.request)
        self.assertEqual(result, {'dnsProtocolVersion': 2, 'keysAndRoutesPreserved': True})
        self.assertEqual([path for path, _ in self.writes], [upgrade.TOOLS / 'refresh-host-gateway-endpoint.py',
                         upgrade.TOOLS / 'install-host-gateway-dns.sh', upgrade.TOOLS / 'alpine-ssh-security.sh', upgrade.TOOLS / 'host-security-maintenance.py', upgrade.HELPER])
        self.assertEqual(upgrade.upgrade(self.request), result)
        self.assertTrue(all(path == upgrade.HELPER or path.parent == upgrade.TOOLS for path, _ in self.writes))

    def test_identity_conflict_and_unsafe_lock_prevent_writes(self):
        with patch.object(upgrade, 'identity', return_value={**self.identity, 'publicKey': 'changed'}):
            with self.assertRaisesRegex(ValueError, 'IDENTITY_CHANGED'):
                upgrade.upgrade(self.request)
        self.assertEqual(self.writes, [])
        with patch.object(upgrade.os, 'fstat', return_value=types.SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=1000, st_nlink=1)):
            with self.assertRaisesRegex(ValueError, 'UNSAFE_FILE'):
                upgrade.upgrade(self.request)
        self.assertEqual(self.writes, [])

    def test_busy_and_invalid_sources_prevent_writes(self):
        with patch.object(upgrade.fcntl, 'flock', side_effect=BlockingIOError):
            with self.assertRaisesRegex(ValueError, 'SERVICE_BUSY'):
                upgrade.upgrade(self.request)
        for changed in [{'sources': {**self.request['sources'], '../../elsewhere': 'YQ=='}},
                        {'sources': {**self.request['sources'], 'onboarding-gateway.py': '!!!!'}},
                        {'identity': {**self.identity, 'machineId': 'unrequested'}}]:
            with self.assertRaises(ValueError):
                upgrade.upgrade({**self.request, **changed})
        self.assertEqual(self.writes, [])

    def test_interrupted_tools_leave_old_entrypoint_until_retry(self):
        original = upgrade.publish.side_effect
        def fail(path, raw, mode):
            if path.name == 'install-host-gateway-dns.sh':
                raise OSError('controlled interrupted file publication')
            original(path, raw, mode)
        with patch.object(upgrade, 'publish', side_effect=fail):
            with self.assertRaises(OSError):
                upgrade.upgrade(self.request)
        self.assertEqual(self.files[upgrade.HELPER], b'# old helper\n')
        self.assertEqual(upgrade.upgrade(self.request)['dnsProtocolVersion'], 2)

    def test_changed_transport_never_returns_success(self):
        with patch.object(upgrade, 'snapshot', side_effect=[{'peers': 'old'}, {'peers': 'changed'}]):
            with self.assertRaisesRegex(ValueError, 'IDENTITY_CHANGED'):
                upgrade.upgrade(self.request)

    def test_deadline_stops_publication_after_slow_read_only_checks(self):
        def snapshot():
            upgrade.DEADLINE = 0
            return {'identity': 'same'}
        with patch.object(upgrade, 'snapshot', side_effect=snapshot):
            with self.assertRaisesRegex(ValueError, 'UPGRADE_TIMEOUT'):
                upgrade.upgrade(self.request)
        self.assertEqual(self.writes, [])


if __name__ == '__main__':
    unittest.main()
