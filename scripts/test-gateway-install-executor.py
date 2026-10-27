#!/usr/bin/env python3
"""Installer journal/file tests with explicit service-command substitutes.

Cryptographic package/plan checks and protected filesystem writes are real.
These tests do not substitute for the separate actual systemd installation.
"""
import base64
import hashlib
import importlib.util
import json
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


executor = load('gateway_executor', 'execute-gateway-install.py')
plans = load('gateway_plan_tests', 'test-gateway-install-plan.py')


class CommandErrorTests(unittest.TestCase):
    def test_timeout_and_missing_tool_are_specific_and_public(self):
        for error, code in [(subprocess.TimeoutExpired('private command', 1, stderr=b'private'), 'GATEWAY_INSTALL_TIMEOUT'),
                            (FileNotFoundError('private path'), 'GATEWAY_DEPENDENCIES_MISSING')]:
            with patch.object(executor.subprocess, 'run', side_effect=error):
                with self.assertRaises(executor.planner.PlanRejected) as raised:
                    executor.command('/usr/bin/tool', [])
                self.assertEqual(raised.exception.code, code)


@unittest.skipUnless(hasattr(os, 'geteuid') and os.geteuid() == 0, 'requires Linux protected-file semantics')
class ExecutorTests(unittest.TestCase):
    def setUp(self):
        self.fixture = plans.InstallPlanTests('test_fresh_install_plan_is_public_and_read_only')
        self.fixture.setUp()
        self.root = self.fixture.fixture.root
        self.state = self.root / 'state'
        self.components = self.root / 'components'
        self.installed_binary = self.root / 'installed-gateway'
        machine = Path('/etc/machine-id').read_text().strip()
        self.fixture.task['target']['machineId'] = machine
        self.fixture.report['machineId'] = machine
        self.calls = []
        self.fail_transport = False
        self.changed_link = False
        self.public = base64.b64encode(b'w' * 32)
        self.patches = [patch.object(executor, 'STATE_ROOT', self.state), patch.object(executor, 'COMPONENT_ROOT', self.components),
                        patch.object(executor, 'INSTALLED_BINARY', self.installed_binary),
                        patch.object(executor.planner.probe, 'probe', return_value=self.fixture.report),
                        patch.object(executor, 'command', side_effect=self.command),
                        patch.object(executor, 'verify_unit', return_value='b' * 64),
                        patch.object(executor, 'console_request', side_effect=self.console)]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.fixture.tearDown()

    def command(self, program, args, data=None, timeout=30):
        self.calls.append((program, args))
        if program == '/usr/bin/openssl':
            result = subprocess.run([program, *args], check=True, capture_output=True)
            return result.stdout
        if program == '/usr/bin/wg':
            if args[-1] == 'listen-port':
                return str(self.fixture.configuration['listenPort']).encode()
            if args[-1] == 'peers':
                return b''
            return (base64.b64encode(b'z' * 32) if args == ['genkey'] else self.public) + b'\n'
        if program == '/usr/sbin/ip':
            if 'link' in args:
                return json.dumps([{'ifname': 'incudal-gw-a', 'flags': ['UP'], 'mtu': 1300 if self.changed_link else 1380,
                                    'ifalias': 'payincus-gateway/v1/' + self.fixture.platform + '/' + self.fixture.gateway}]).encode()
            return json.dumps([{'addr_info': [{'local': self.fixture.configuration['address'], 'prefixlen': 32}]}]).encode()
        if program.endswith('/bin/node') and args[1] == '--initialize':
            configuration = json.loads(Path(args[2]).read_text())
            material = configuration['initialUser']
            state = {'users': [{'recoveryHashes': [hashlib.sha256(value.encode()).hexdigest() for value in material['recoveryCodes']]}]}
            executor.save_json(Path(configuration['authDirectory']) / 'gateway-auth.json', state, exclusive=True)
        if program == '/usr/bin/bash' and args[0].endswith('install-management-gateway.sh') and self.fail_transport:
            raise executor.planner.PlanRejected('INJECTED_TEST_INTERRUPTION')
        if program == '/usr/bin/bash' and args[0].endswith('install-management-gateway.sh') and not self.installed_binary.exists():
            executor.save(self.installed_binary, Path(args[2]).read_bytes(), exclusive=True, mode=0o755)
        return b''

    def console(self, port, certificate, host, path, method='GET', body=None, headers=None):
        if path == '/':
            return 200, {}, b'fixture-file'
        if path == '/api/login':
            return 200, {'set-cookie': 'fixture-session=opaque; Secure; HttpOnly'}, b'{"csrf":"fixture-csrf"}'
        if path == '/api/status':
            return 200, {}, json.dumps({'gatewayId': self.fixture.gateway, 'transportReady': True, 'canWrite': False}).encode()
        return 200, {}, b'{}'

    def run_install(self):
        return executor.install(self.fixture.request, self.fixture.policy)

    def interrupt(self):
        self.fail_transport = True
        with self.assertRaises(ValueError):
            self.run_install()
        self.fail_transport = False

    def test_actual_package_copy_is_pinned_and_idempotent(self):
        verified = self.fixture.plan()['package']
        path = executor.stage_package(self.fixture.policy, verified)
        self.assertEqual(path, executor.stage_package(self.fixture.policy, verified))
        (path / 'ui/index.html').write_bytes(b'changed')
        with self.assertRaises(ValueError):
            executor.stage_package(self.fixture.policy, verified)

    def test_atomic_private_write_rejects_links_and_changes(self):
        original = self.root / 'original'
        executor.save(original, b'private', exclusive=True)
        self.assertEqual(original.stat().st_mode & 0o777, 0o600)
        executor.save_unchanged(original, b'private')
        with self.assertRaises(ValueError):
            executor.save_unchanged(original, b'changed')
        link = self.root / 'link'
        link.symlink_to(original)
        with self.assertRaises(OSError):
            executor.save_unchanged(link, b'changed')
        self.assertEqual(original.read_bytes(), b'private')

    def test_installation_and_duplicate_preserve_identity(self):
        first = self.run_install()
        second = self.run_install()
        self.assertEqual(first, second)
        self.assertTrue(first['installed'])
        self.assertFalse(first['canWrite'])
        self.assertEqual(sum(args == ['genkey'] for _, args in self.calls), 1)
        self.assertEqual(sum('--initialize' in args for _, args in self.calls), 1)
        secret = executor.read_json(self.state / self.fixture.gateway / 'bootstrap.json')
        self.assertEqual(len(secret['recoveryCodes']), 7)
        self.assertNotIn(secret['password'], json.dumps(first))

    def test_interrupted_retry_preserves_keys_and_accounts(self):
        self.interrupt()
        state = self.state / self.fixture.gateway
        self.assertEqual(executor.read_json(state / 'journal.json')['status'], 'needs_review')
        key = (state / 'wireguard.key').read_bytes()
        self.assertTrue(self.run_install()['installed'])
        self.assertEqual((state / 'wireguard.key').read_bytes(), key)
        self.assertEqual(sum(args == ['genkey'] for _, args in self.calls), 1)
        self.assertEqual(sum('--initialize' in args for _, args in self.calls), 1)

    def test_lost_key_is_not_regenerated(self):
        self.interrupt()
        (self.state / self.fixture.gateway / 'wireguard.key').unlink()
        with self.assertRaises(ValueError):
            self.run_install()
        self.assertEqual(sum(args == ['genkey'] for _, args in self.calls), 1)

    def test_changed_confirmation_is_rejected(self):
        self.interrupt()
        self.fixture.request['expiresAt'] -= 1
        with self.assertRaises(ValueError):
            self.run_install()

    def test_duplicate_does_not_report_stale_transport_readiness(self):
        self.run_install()
        self.changed_link = True
        with self.assertRaises(ValueError):
            self.run_install()
        self.assertEqual(executor.read_json(self.state / self.fixture.gateway / 'journal.json')['status'], 'needs_review')

    def test_installed_executable_change_is_rejected_before_start(self):
        self.run_install()
        self.installed_binary.write_bytes(b'changed executable')
        self.calls.clear()
        with self.assertRaises(ValueError):
            self.run_install()
        self.assertFalse(any(program == '/usr/bin/systemctl' for program, _ in self.calls))

    def test_changed_configuration_is_not_overwritten(self):
        self.interrupt()
        path = self.state / self.fixture.gateway / 'signed-transport.json'
        path.write_bytes(b'newer-configuration')
        with self.assertRaises(ValueError):
            self.run_install()
        self.assertEqual(path.read_bytes(), b'newer-configuration')

    def test_same_commit_new_signed_package_still_requires_new_confirmation(self):
        self.interrupt()
        fixture = self.fixture.fixture
        target = fixture.package / 'ui/index.html'
        target.write_bytes(b'new-validly-signed-content')
        record = next(item for item in fixture.manifest['files'] if item['path'] == 'ui/index.html')
        record['size'] = target.stat().st_size
        record['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
        fixture.sign()
        with self.assertRaises(ValueError):
            self.run_install()


if __name__ == '__main__':
    unittest.main()
