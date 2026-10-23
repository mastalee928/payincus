#!/usr/bin/env python3
"""Pure validation/conflict guards; live probing is separately recorded."""
import importlib.util
import ipaddress
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

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
