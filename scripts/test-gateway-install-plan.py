#!/usr/bin/env python3
"""Root-side plan validation; fixture package signatures are genuine Ed25519."""
import base64
import hashlib
import importlib.util
import json
import os
import subprocess
import time
import unittest
from pathlib import Path
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


planner = load('gateway_planner', 'gateway-install-plan.py')
fixtures = load('gateway_package_fixtures', 'test-gateway-component-package.py')


class PublicErrorTests(unittest.TestCase):
    def test_only_structured_public_codes_are_returned(self):
        self.assertEqual(planner.public_error_code(planner.PlanRejected('GATEWAY_INSTALL_TRANSPORT_MISMATCH'), 'fallback'),
                         'GATEWAY_INSTALL_TRANSPORT_MISMATCH')
        for error in [ValueError('private stderr'), planner.PlanRejected('password=private'), planner.PlanRejected('GATEWAY_FAILURE\nprivate')]:
            self.assertEqual(planner.public_error_code(error, 'fallback'), 'fallback')


@unittest.skipUnless(hasattr(os, 'geteuid') and os.geteuid() == 0, 'requires Linux protected-file semantics')
class InstallPlanTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.PackageTests('test_valid')
        self.fixture.setUp()
        self.now = int(time.time() * 1000)
        self.platform = '11111111-1111-4111-8111-111111111111'
        self.gateway = '22222222-2222-4222-8222-222222222222'
        self.policy = {'schemaVersion': 1, 'platformId': self.platform, 'platformSigningKey': self.fixture.pinned,
                       'packageSigningKey': self.fixture.pinned, 'packageDirectory': str(self.fixture.package),
                       'componentVersion': '1.7.1', 'componentCommit': 'a' * 40}
        self.transport = {'schemaVersion': 1, 'purpose': 'gateway-transport', 'platformId': self.platform,
                          'gatewayId': self.gateway, 'epoch': '1', 'sequence': '1', 'issuedAt': self.now,
                          'expiresAt': self.now + 600000, 'slot': 'a', 'address': '10.249.80.1',
                          'listenPort': 51980, 'mtu': 1380, 'peers': []}
        self.configuration = {'slot': 'a', 'network': '10.249.80.0/24', 'address': '10.249.80.1',
                              'listenPort': 51980, 'consolePort': 18480, 'consoleOrigin': 'https://gateway.example.test:18480',
                              'signedTransport': self.signed_transport()}
        self.report = {'schemaVersion': 1, 'machineId': 'b' * 32, 'osId': 'debian', 'architecture': 'arm64',
                       'memoryMiB': 1024, 'diskAvailableMiB': 2048,
                       'tools': {key: True for key in ['node', 'wg', 'ip', 'ss', 'python3', 'systemctl']},
                       'facts': {'interface': {'exists': False, 'owned': False, 'addressMatches': False},
                                 'routeConflicts': [], 'portConflicts': [], 'services': {
                                     key: {'installed': False, 'owned': False, 'active': False, 'digest': None}
                                     for key in ['transport', 'console', 'backup']}},
                       'blockers': [], 'observedStateHash': 'c' * 64, 'inspectedAt': self.now}
        self.task = {'schemaVersion': 1, 'taskId': '33333333-3333-4333-8333-333333333333', 'platformId': self.platform,
                     'gatewayId': self.gateway, 'kind': 'install', 'basedOnRevision': '0',
                     'target': {'mode': 'local', 'machineId': 'b' * 32, 'ssh': None},
                     'configurationHash': planner.task_hash(self.configuration),
                     'componentHash': hashlib.sha256((self.fixture.package / 'manifest.json').read_bytes()).hexdigest(),
                     'observedStateHash': self.report['observedStateHash']}
        self.request = {'task': self.task, 'configuration': self.configuration, 'expiresAt': self.now + 300000}
        self.probe = patch.object(planner.probe, 'probe', return_value=self.report)
        self.probe.start()

    def tearDown(self):
        self.probe.stop()
        self.fixture.tearDown()

    def signed_transport(self, prefix=b'payincus/gateway-transport/v1\n'):
        payload = base64.b64encode(json.dumps(self.transport, separators=(',', ':')).encode()).decode()
        key_id = 'key_' + hashlib.sha256(base64.b64decode(self.fixture.pinned)).hexdigest()
        message = self.fixture.root / 'transport-message'
        message.write_bytes(prefix + key_id.encode() + b'\n' + payload.encode())
        signature = subprocess.run(['/usr/bin/openssl', 'pkeyutl', '-sign', '-rawin', '-inkey', str(self.fixture.private), '-in', str(message)],
                                   check=True, capture_output=True).stdout
        return json.dumps({'schemaVersion': 1, 'keyId': key_id, 'payload': payload, 'signature': base64.b64encode(signature).decode()}, separators=(',', ':'))

    def refresh_hash(self):
        self.task['configurationHash'] = planner.task_hash(self.configuration)

    def plan(self):
        return planner.prepare_installation(self.request, self.policy, now=self.now)

    def test_fresh_install_plan_is_public_and_read_only(self):
        result = self.plan()
        self.assertTrue(result['installable'])
        self.assertFalse(result['canWrite'])
        self.assertFalse(result['changes']['businessBackendRestart'])
        self.assertEqual(result['planHash'], planner.task_hash(self.task))
        self.assertNotIn('signedTransport', result['configuration'])
        self.assertFalse(Path(result['changes']['stateDirectory']).exists())

    def test_exact_request_and_local_target(self):
        for value in [dict(self.request, command='id'), dict(self.request, password='fixture')]:
            with self.assertRaises(ValueError):
                planner.prepare_installation(value, self.policy, now=self.now)
        self.task['target']['ssh'] = {'address': '10.1.1.1'}
        with self.assertRaises(ValueError):
            self.plan()

    def test_machine_observation_package_and_platform_binding(self):
        for owner, key, bad in [(self.task['target'], 'machineId', 'd' * 32), (self.task, 'observedStateHash', 'd' * 64),
                                (self.task, 'componentHash', 'd' * 64), (self.task, 'platformId', self.gateway),
                                (self.policy, 'componentCommit', 'd' * 40)]:
            original = owner[key]
            owner[key] = bad
            with self.assertRaises(ValueError):
                self.plan()
            owner[key] = original

    def test_expiry_and_type_strictness(self):
        for expiry in [self.now, self.now + 600001, True, float(self.now + 1)]:
            self.request['expiresAt'] = expiry
            with self.assertRaises(ValueError):
                self.plan()

    def test_changed_configuration_without_confirmation(self):
        self.configuration['consolePort'] += 1
        with self.assertRaises(ValueError):
            self.plan()

    def test_signed_transport_must_match_exact_plan(self):
        for field, value in [('gatewayId', self.platform), ('slot', 'b'), ('listenPort', 51981), ('epoch', '2'), ('peers', [{}]), ('expiresAt', self.now - 1)]:
            original = self.transport[field]
            self.transport[field] = value
            self.configuration['signedTransport'] = self.signed_transport()
            self.refresh_hash()
            with self.assertRaises(ValueError):
                self.plan()
            self.transport[field] = original

    def test_signature_domain_and_pinned_key(self):
        self.configuration['signedTransport'] = self.signed_transport(planner.package.PREFIX)
        self.refresh_hash()
        with self.assertRaises(ValueError):
            self.plan()

    def test_conflicts_stay_blocked(self):
        self.report['blockers'] = ['GATEWAY_PORT_CONFLICT', 'GATEWAY_MANAGEMENT_ROUTE_CONFLICT']
        result = self.plan()
        self.assertFalse(result['installable'])
        self.assertEqual(result['blockers'], sorted(self.report['blockers']))

    def test_package_resolves_only_missing_node(self):
        self.report['tools']['node'] = False
        self.report['blockers'] = ['GATEWAY_DEPENDENCIES_MISSING']
        self.assertTrue(self.plan()['installable'])
        self.report['tools']['wg'] = False
        self.assertFalse(self.plan()['installable'])

    def test_existing_identity_never_reinitialized(self):
        self.report['facts']['interface'] = {'exists': True, 'owned': True, 'addressMatches': True}
        self.assertIn('GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH', self.plan()['blockers'])
        self.report['facts']['interface']['exists'] = False
        self.report['facts']['services']['console']['installed'] = True
        self.assertIn('GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH', self.plan()['blockers'])

    def test_remote_target_requires_canonical_identity(self):
        self.task['target'] = {'mode': 'remote', 'machineId': 'b' * 32, 'ssh': {'address': '10.1.1.1', 'port': 22,
                               'username': 'root', 'fingerprint': 'SHA256:' + base64.b64encode(b'c' * 32).decode().rstrip('=')}}
        self.assertTrue(self.plan()['installable'])
        for address in ['localhost', '127.0.0.1', '169.254.169.254', '224.1.1.1']:
            self.task['target']['ssh']['address'] = address
            with self.assertRaises(ValueError):
                self.plan()

    def test_console_origin_cannot_inject_or_change_port(self):
        for origin in ['http://gateway.example.test:18480', 'https://gateway.example.test:18481',
                       'https://user@gateway.example.test:18480', 'https://gateway.example.test:18480/',
                       'https://-gateway.example.test:18480', 'https://gateway..example.test:18480', 'https://999.1.1.1:18480',
                       'https://gateway.example.test:18480/#x', 'https://gateway.example.test:18480\ncommand']:
            self.configuration['consoleOrigin'] = origin
            self.refresh_hash()
            with self.assertRaises(ValueError):
                self.plan()


if __name__ == '__main__':
    unittest.main()
