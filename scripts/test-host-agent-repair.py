#!/usr/bin/env python3
"""Linux root filesystem boundaries for the fixed Agent reconciliation script.

The service command is intercepted; these tests do not claim real host recovery.
"""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import stat
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gateway', Path(__file__).with_name('onboarding-gateway.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


@unittest.skipUnless(os.geteuid() == 0, 'requires Linux root filesystem semantics')
class RepairTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='incudal-agent-boundary-', dir='/root')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = self.root / 'agent' / 'config.yaml'
        self.config.parent.mkdir(mode=0o700)
        self.node = self.root / 'onboarding-id'
        self.node.write_text('11111111-1111-4111-8111-111111111111\n')
        self.node.chmod(0o600)
        self.original = b'panel_url: "https://panel.example/api"\nagent_id: "agt_oldfixture000000000000000000"\nagent_secret: "ias_oldfixture000000000000000000000000"\ninterval: 30\n'
        self.config.write_bytes(self.original); self.config.chmod(0o600)
        self.customer = self.root / 'customer.img'; self.customer.write_bytes(b'customer-disk-must-remain')
        self.network = self.root / 'wg.conf'; self.network.write_bytes(b'network-and-keys-must-remain')
        self.input = {'nodeId': self.node.read_text().strip(), 'agentId': 'agt_' + 'a' * 32, 'agentSecret': 'ias_' + 'b' * 43,
                      'expiresAt': int(time.time() * 1000) + 20000}
        self.services = []
        self.output = io.StringIO()

    def execute(self, systemd=True, before_replace=None):
        paths = {'/etc/incudal-onboarding-id': self.node, '/etc/incudal-agent/config.yaml': self.config,
                 '/run/systemd/system': self.root / 'systemd'}
        if systemd: paths['/run/systemd/system'].mkdir(exist_ok=True)
        elif paths['/run/systemd/system'].exists(): paths['/run/systemd/system'].rmdir()
        original_replace = os.replace
        def replace(source, target):
            if before_replace: before_replace()
            return original_replace(source, target)
        def service(command, **kwargs):
            self.services.append(command)
            self.assertEqual(command, ['systemctl', 'restart', 'incudal-agent'] if systemd else ['rc-service', 'incudal-agent', 'restart'])
            self.assertTrue(kwargs['check'])
        script = gateway.AGENT_REPAIR_SCRIPT
        for original, path in paths.items(): script = script.replace(repr(original), repr(str(path)))
        with patch('subprocess.run', side_effect=service), patch('os.replace', side_effect=replace), contextlib.redirect_stdout(self.output):
            exec(compile(script, '<fixed-agent-repair>', 'exec'), {'D': self.input})

    def test_atomic_update_preserves_customer_and_other_config_retries_idempotently(self):
        self.execute()
        current = self.config.read_bytes()
        self.assertIn(b'panel_url: "https://panel.example/api"', current)
        self.assertIn(b'interval: 30', current)
        self.assertIn(self.input['agentSecret'].encode(), current)
        self.assertEqual(stat.S_IMODE(self.config.stat().st_mode), 0o600)
        self.assertEqual(self.customer.read_bytes(), b'customer-disk-must-remain')
        self.assertEqual(self.network.read_bytes(), b'network-and-keys-must-remain')
        self.execute()
        self.assertEqual(self.config.read_bytes(), current)
        self.assertNotIn(self.input['agentSecret'], self.output.getvalue())
        self.assertEqual(self.output.getvalue(), 'AGENT_CONFIG_RECONCILED\n' * 2)
        self.assertFalse(list(self.config.parent.glob('.agent-repair-*')))

    def test_openrc_only_restarts_agent(self):
        self.execute(systemd=False)
        self.assertEqual(self.services, [['rc-service', 'incudal-agent', 'restart']])

    def test_wrong_node_expiry_and_duplicate_fields_leave_file_untouched(self):
        for mode in ['identity', 'expiry', 'duplicate']:
            with self.subTest(mode=mode):
                before = self.config.read_bytes()
                if mode == 'identity': self.input['nodeId'] = 'wrong'
                if mode == 'expiry': self.input['expiresAt'] = 0
                if mode == 'duplicate':
                    self.config.write_bytes(self.original + b'agent_id: "duplicate"\n'); before = self.config.read_bytes()
                with self.assertRaises(ValueError): self.execute()
                self.assertEqual(self.config.read_bytes(), before)
                self.assertEqual(self.services, [])
                self.input['nodeId'] = self.node.read_text().strip(); self.input['expiresAt'] = int(time.time()*1000)+20000

    def test_symlink_hardlink_untrusted_owner_and_writable_parent_are_rejected(self):
        for mode in ['symlink', 'hardlink', 'owner', 'parent']:
            with self.subTest(mode=mode):
                if mode in ['symlink', 'hardlink']:
                    self.config.unlink()
                    target = self.root / 'target'; target.write_bytes(self.original); target.chmod(0o600)
                    if mode == 'symlink': self.config.symlink_to(target)
                    else: os.link(target, self.config)
                if mode == 'owner': os.chown(self.config, 65534, 65534)
                if mode == 'parent': self.config.parent.chmod(0o777)
                with self.assertRaises((ValueError, OSError)): self.execute()
                self.assertEqual(self.config.read_bytes(), self.original); self.assertEqual(self.services, [])
                self.config.unlink(); self.config.write_bytes(self.original); self.config.chmod(0o600); self.config.parent.chmod(0o700)
                if (self.root/'target').exists(): (self.root/'target').unlink()

    def test_busy_lock_prevents_config_and_service_changes(self):
        import fcntl
        with open(self.config.parent / '.repair.lock', 'w') as handle:
            os.chmod(handle.name, 0o600); fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError): self.execute()
        self.assertEqual(self.config.read_bytes(), self.original); self.assertEqual(self.services, [])

    def test_expiry_during_temp_write_prevents_late_publication(self):
        actual_fsync = os.fsync
        def expire(fd):
            actual_fsync(fd); self.input['expiresAt'] = 0
        with patch('os.fsync', side_effect=expire):
            with self.assertRaises(ValueError): self.execute()
        self.assertEqual(self.config.read_bytes(), self.original); self.assertEqual(self.services, [])
        self.assertFalse(list(self.config.parent.glob('.agent-repair-*')))

    def test_concurrent_config_change_is_preserved(self):
        actual_fsync = os.fsync
        def changed(fd):
            actual_fsync(fd); self.config.write_bytes(self.original + b'# newer configuration\n')
        with patch('os.fsync', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'configuration changed'): self.execute()
        self.assertTrue(self.config.read_bytes().endswith(b'# newer configuration\n')); self.assertEqual(self.services, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
