#!/usr/bin/env python3
"""Pure validation/conflict guards; live probing is separately recorded."""
import importlib.util
import ipaddress
import json
import os
import subprocess
import sys
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gateway_probe', Path(__file__).with_name('probe-management-gateway.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class GatewayProbeTests(unittest.TestCase):
    def request(self):
        return {'schemaVersion': 1, 'platformId': 'a'*8+'-'+('a'*4+'-')*3+'a'*12,
                'gatewayId': 'b'*8+'-'+('b'*4+'-')*3+'b'*12, 'slot': 'a',
                'expectedMachineId': None, 'network': '10.249.80.0/24', 'address': '10.249.80.1',
                'listenPort': 51980, 'consolePort': 18480}

    def test_valid_request(self):
        value = self.request()
        self.assertEqual(probe.validate_request(value), value)
        large = {**value, 'network': '10.252.0.0/20', 'address': '10.252.0.1'}
        self.assertEqual(probe.validate_request(large), large)

    def test_unknown_fields_and_secrets(self):
        for key in ('password', 'command', 'privateKey'):
            with self.assertRaises(ValueError):
                probe.validate_request({**self.request(), key: 'unusable-test-value'})

    def test_network_and_address_constraints(self):
        for field, value in (('network', '10.249.80.1/24'), ('network', '8.8.8.0/24'),
                             ('network', '10.0.0.0/8'), ('address', '10.249.80.0'),
                             ('address', '10.249.80.255'), ('address', '10.249.81.1')):
            with self.assertRaises(ValueError):
                probe.validate_request({**self.request(), field: value})

    def test_ports_and_identity(self):
        for field, value in (('schemaVersion', True), ('listenPort', True), ('consolePort', 22), ('slot', 'c'),
                             ('expectedMachineId', '0'*32), ('consolePort', 51980)):
            with self.assertRaises(ValueError):
                probe.validate_request({**self.request(), field: value})

    def test_duplicate_json(self):
        with self.assertRaises(ValueError):
            probe.strict_object([('slot', 'a'), ('slot', 'b')])

    def test_route_overlap_and_own_interface(self):
        network = ipaddress.IPv4Network('10.249.80.0/24')
        routes = [{'dst': 'default', 'dev': 'eth0'}, {'dst': '10.249.80.4/32', 'dev': 'incudal-gw-a'},
                  {'dst': '10.249.0.0/16', 'dev': 'eth1'}, {'dst': '10.249.81.0/24', 'dev': 'eth2'}]
        self.assertEqual(probe.route_conflicts(routes, network, 'incudal-gw-a'), [{'network': '10.249.0.0/16', 'interface': 'eth1'}])

    def test_listener_ipv4_ipv6(self):
        self.assertEqual(probe.listener_ports('UNCONN 0 0 0.0.0.0:51980 0.0.0.0:*\nLISTEN 0 128 [::]:18480 [::]:*'), {51980, 18480})
        with self.assertRaises(ValueError):
            probe.listener_ports('unexpected response')

    def test_debian_13_14_without_ipv6(self):
        # Exercise the complete probe, not just a version string. The machine
        # has only an IPv4 route; IPv6 reads/commands fail the test.
        for version in ('13', '14'):
            with self.subTest(version=version):
                reads = {'/etc/machine-id': 'c'*32, '/etc/os-release': f'ID=debian\nVERSION_ID="{version}"',
                         '/proc/meminfo': 'MemTotal: 2097152 kB\n'}
                def read(path, *args, **kwargs):
                    return reads[path.as_posix()]
                def command(tool, args):
                    self.assertNotIn('-6', args)
                    if tool == 'systemctl':
                        return 'LoadState=not-found\nActiveState=inactive\nFragmentPath=\n'
                    if tool == 'ss':
                        return ''
                    if tool == 'ip':
                        if 'route' in args:
                            return '[{"dst":"default","gateway":"192.0.2.1","dev":"eth0"}]'
                        return '[]'
                    self.fail(f'unexpected command: {tool}')
                with patch.object(Path, 'read_text', read), patch.object(Path, 'is_dir', return_value=True), \
                     patch.object(probe.platform, 'machine', return_value='x86_64'), \
                     patch.object(probe.shutil, 'disk_usage', return_value=SimpleNamespace(free=2**30)), \
                     patch.object(probe.shutil, 'which', return_value='/usr/bin/tool'), patch.object(probe, 'command', command):
                    report = probe.probe(self.request())
                self.assertEqual(report['osId'], 'debian')
                self.assertEqual(report['blockers'], [])
                self.assertEqual(len(report['facts']['services']), 3)

    def test_command_failures_have_specific_public_codes(self):
        for failure, code in [(subprocess.TimeoutExpired('ip', 8, stderr=b'private-output'), 'GATEWAY_INSPECTION_TIMEOUT'),
                              (subprocess.CalledProcessError(1, 'ip', stderr=b'private-output'), 'GATEWAY_INSPECTION_COMMAND_FAILED')]:
            with patch.object(probe.shutil, 'which', return_value='/usr/bin/ip'), \
                 patch.object(probe.subprocess, 'run', side_effect=failure):
                with self.assertRaises(probe.ProbeError) as result:
                    probe.command('ip', ['-j', '-4', 'route', 'show'])
                self.assertEqual(result.exception.code, code)
                self.assertNotIn('private-output', str(result.exception))

    def test_missing_identity_is_not_identity_changed(self):
        with patch.object(Path, 'read_text', side_effect=FileNotFoundError):
            with self.assertRaises(probe.ProbeError) as result:
                probe.probe(self.request())
        self.assertEqual(result.exception.code, 'GATEWAY_MACHINE_ID_UNAVAILABLE')

    @unittest.skipUnless(sys.platform == 'linux' and os.geteuid() != 0, 'actual unprivileged Linux process only')
    def test_unprivileged_read_only_probe(self):
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('probe-management-gateway.py'))],
                                input=json.dumps(self.request()), text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0)
        report = json.loads(result.stdout)
        self.assertEqual(report['schemaVersion'], 1)
        self.assertRegex(report['machineId'], r'^[a-f0-9]{32}$')


if __name__ == '__main__':
    unittest.main()
