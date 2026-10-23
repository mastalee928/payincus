#!/usr/bin/env python3
"""Endpoint refresh regression: no remote shell, route or key updates allowed."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('dns_refresh', Path(__file__).with_name('refresh-host-gateway-endpoint.py'))
dns = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dns)
PRIVATE = base64.b64encode(bytes([1]) * 32).decode()
PEER = base64.b64encode(bytes([2]) * 32).decode()
LOCAL = base64.b64encode(bytes([3]) * 32).decode()
IDENTITY = '11111111-1111-4111-8111-111111111111'
CONFIG = ('[Interface]\nPrivateKey = ' + PRIVATE + '\nAddress = 10.253.240.2/32\nMTU = 1420\n'
          '[Peer]\nPublicKey = ' + PEER + '\nAllowedIPs = 10.253.240.1/32\n'
          'Endpoint = gateway.example.com:51820\nPersistentKeepalive = 25\n')


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.contents = CONFIG
        self.enrollment = {'schemaVersion': 1, 'nodeId': IDENTITY, 'localPublicKey': LOCAL, 'peerPublicKey': PEER,
                           'localAddress': '10.253.240.2/32', 'allowedIp': '10.253.240.1/32', 'hostname': 'gateway.example.com', 'port': 51820}
        self.live = '8.8.4.4:51820'
        self.local = LOCAL
        self.peers = PEER
        self.allowed = PEER + '\t10.253.240.1/32'
        self.address = [{'addr_info': [{'family': 'inet', 'local': '10.253.240.2', 'prefixlen': 32}]}]
        self.reads = patch.object(dns, 'protected', side_effect=lambda path, _limit: self.contents if path == dns.CONFIG else json.dumps(self.enrollment) if path == dns.ENROLLMENT else IDENTITY)
        self.reads.start()
        self.addCleanup(self.reads.stop)

    def command(self, program, args, data=None):
        self.calls.append((program, args, data))
        if args == ['pubkey']:
            self.assertEqual(data, (PRIVATE + '\n').encode())
            return LOCAL
        if program.endswith('/ip'):
            return json.dumps(self.address)
        if args[0] == 'set':
            self.assertEqual(args, ['set', 'incudal-mgmt', 'peer', PEER, 'endpoint', '1.1.1.1:51820'])
            self.live = args[-1]
            return ''
        return {'public-key': self.local, 'peers': self.peers, 'allowed-ips': self.allowed,
                'endpoints': PEER + '\t' + self.live}[args[-1]]

    def refresh(self, lookup=lambda _host: '1.1.1.1'):
        return dns.refresh(execute=self.command, lookup=lookup)

    def test_dns_change_updates_only_endpoint_and_is_idempotent(self):
        self.assertTrue(self.refresh()['endpointChanged'])
        self.assertFalse(self.refresh()['endpointChanged'])
        self.assertEqual(sum(args[0] == 'set' for _, args, _ in self.calls), 1)
        self.assertEqual(self.contents, CONFIG)

    def test_dns_outage_and_nonpublic_answers_preserve_configuration(self):
        def outage(_host):
            raise OSError('fixture outage')
        for resolver in [outage, lambda _: '127.0.0.1', lambda _: '10.0.0.1', lambda _: '169.254.169.254']:
            with self.assertRaises((OSError, ValueError)):
                self.refresh(resolver)
        self.assertFalse(any(args[0] == 'set' for _, args, _ in self.calls))
        self.assertEqual(self.live, '8.8.4.4:51820')

    def test_wrong_live_identity_peer_route_or_address_refuses_update(self):
        for field, value in [('local', PEER), ('peers', PEER + '\n' + LOCAL),
                             ('allowed', PEER + '\t0.0.0.0/0'),
                             ('address', [{'addr_info': [{'family': 'inet', 'local': '10.253.240.3', 'prefixlen': 32}]}])]:
            previous = getattr(self, field)
            setattr(self, field, value)
            with self.assertRaises(ValueError):
                self.refresh()
            setattr(self, field, previous)
        self.assertFalse(any(args[0] == 'set' for _, args, _ in self.calls))

    def test_changed_durable_binding_or_domain_refuses_refresh(self):
        for name, value in [('peerPublicKey', LOCAL), ('nodeId', '22222222-2222-4222-8222-222222222222'), ('hostname', 'other.example.com')]:
            previous = self.enrollment[name]; self.enrollment[name] = value
            with self.assertRaises(ValueError): self.refresh()
            self.enrollment[name] = previous
        self.assertFalse(any(args[0] == 'set' for _, args, _ in self.calls))

    def test_config_changed_during_lookup_refuses_update(self):
        def changed(_host):
            self.contents = CONFIG.replace('51820', '51821')
            return '1.1.1.1'
        with self.assertRaises(ValueError):
            self.refresh(changed)
        self.assertFalse(any(args[0] == 'set' for _, args, _ in self.calls))

    def test_unsafe_configurations_and_endpoints_are_rejected(self):
        for value in [CONFIG + 'PostUp = sh\n', CONFIG + '[Peer]\n', CONFIG.replace('/32', '/24'),
                      CONFIG.replace('gateway.example.com', 'localhost'), CONFIG.replace('51820', '65536')]:
            with self.assertRaises(ValueError):
                dns.configuration(value)
        for value in ['https://gateway.example.com:51820', 'gateway.example.com;id:51820', '127.0.0.1:51820']:
            with self.assertRaises(ValueError):
                dns.endpoint(value)

    def test_literal_ip_is_preserved_without_dns_or_kernel_write(self):
        self.contents = CONFIG.replace('gateway.example.com', '8.8.4.4')
        self.assertEqual(self.refresh()['reason'], 'literal-ip')
        self.assertEqual(self.calls, [])


@unittest.skipUnless(hasattr(os, 'geteuid') and os.geteuid() == 0, 'root-owned file checks require Linux root')
class FileTests(unittest.TestCase):
    def test_explicit_enrollment_is_durable_idempotent_and_refuses_trust_change(self):
        with tempfile.TemporaryDirectory(prefix='incudal-dns-', dir='/root') as directory:
            root = Path(directory); config = root / 'config'; identity = root / 'identity'; binding = root / 'binding'
            config.write_text(CONFIG.replace('gateway.example.com', '8.8.4.4')); config.chmod(0o600)
            identity.write_text(IDENTITY); identity.chmod(0o600)
            value = {'schemaVersion': 1, 'nodeId': IDENTITY, 'localPublicKey': LOCAL, 'peerPublicKey': PEER,
                     'localAddress': '10.253.240.2/32', 'allowedIp': '10.253.240.1/32', 'hostname': 'gateway.example.com', 'port': 51820}
            run = lambda *_: LOCAL
            self.assertTrue(dns.enroll(value, config, identity, binding, run)['configurationChanged'])
            self.assertFalse(dns.enroll(value, config, identity, binding, run)['configurationChanged'])
            self.assertEqual(json.loads(binding.read_text()), value)
            self.assertEqual(binding.stat().st_mode & 0o777, 0o600)
            for name, changed in [('hostname', 'other.example.com'), ('peerPublicKey', LOCAL), ('localAddress', '10.253.240.3/32')]:
                with self.assertRaises(ValueError): dns.enroll({**value, name: changed}, config, identity, binding, run)
            # Simulate interrupted enrollment: binding written, config still has IP.
            config.write_text(CONFIG.replace('gateway.example.com', '8.8.4.4'))
            self.assertTrue(dns.enroll(value, config, identity, binding, run)['configurationChanged'])

    def test_protected_input_rejects_links_modes_and_hardlinks(self):
        with tempfile.TemporaryDirectory(prefix='incudal-dns-', dir='/root') as directory:
            root = Path(directory)
            file = root / 'config'
            file.write_text(CONFIG)
            file.chmod(0o600)
            self.assertEqual(dns.protected(file, 16384), CONFIG)
            file.chmod(0o644)
            with self.assertRaises(ValueError):
                dns.protected(file, 16384)
            file.chmod(0o600)
            link = root / 'link'
            link.symlink_to(file)
            with self.assertRaises(OSError):
                dns.protected(link, 16384)
            os.link(file, root / 'hardlink')
            with self.assertRaises(ValueError):
                dns.protected(file, 16384)


if __name__ == '__main__':
    unittest.main()
