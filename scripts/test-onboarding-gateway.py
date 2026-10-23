#!/usr/bin/env python3
import importlib.util
import ipaddress
import json
import pathlib
import tempfile
import io
import base64
import hashlib
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("gateway", pathlib.Path(__file__).with_name("onboarding-gateway.py"))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="incudal-gateway-test-")
        self.addCleanup(self.temp.cleanup)
        directory = pathlib.Path(self.temp.name)
        gateway.STATE = directory / "state"
        gateway.STATE.mkdir()
        gateway.CONFIG = directory / "wg.conf"
        self.config = "[Interface]\nPrivateKey = test-fixture-only\nAddress = 10.253.240.1/24\n\n[Peer]\nPublicKey = existing-peer\nAllowedIPs = 10.253.240.2/32\n"
        gateway.CONFIG.write_text(self.config)
        self.control = ipaddress.ip_interface("10.253.240.1/24")
        self.job = "11111111-1111-4111-8111-111111111111"
        self.runner = mock.patch.object(gateway, "run", return_value="").start()
        self.addCleanup(mock.patch.stopall)

    def register(self, key="new-peer", job=None):
        return gateway.register_peer(job or self.job, key, self.control, gateway.CONFIG.read_text(), {})

    def test_preserves_existing_peers_and_resumes_the_same_address(self):
        self.assertEqual(self.register(), "10.253.240.3")
        self.assertEqual(self.register(), "10.253.240.3")
        config = gateway.CONFIG.read_text()
        self.assertIn(self.config.rstrip(), config)
        self.assertEqual(config.count("# incudal-onboarding"), 1)
        saved = json.loads((gateway.STATE / (self.job + ".json")).read_text())
        self.assertEqual(saved["nodePublicKey"], "new-peer")

    def test_crash_after_reservation_can_resume_without_double_allocation(self):
        self.runner.side_effect = RuntimeError("simulated WireGuard failure")
        with self.assertRaises(RuntimeError):
            self.register()
        self.runner.side_effect = None
        self.assertEqual(self.register(), "10.253.240.3")
        self.assertEqual(self.register("second-peer", "22222222-2222-4222-8222-222222222222"), "10.253.240.4")

    def test_key_change_or_duplicate_registration_cannot_steal_an_address(self):
        self.register()
        before = gateway.CONFIG.read_text()
        with self.assertRaises(ValueError):
            self.register("changed-key")
        with self.assertRaises(ValueError):
            self.register("new-peer", "22222222-2222-4222-8222-222222222222")
        self.assertEqual(gateway.CONFIG.read_text(), before)

    def test_saved_configuration_reserves_entire_ranges_while_device_is_down(self):
        gateway.CONFIG.write_text(self.config.replace("10.253.240.2/32", "10.253.240.0/30, 10.253.240.4/32, fd00::/64"))
        self.assertEqual(self.register(), "10.253.240.5")

    def test_other_reservations_remain_occupied_before_wireguard_is_updated(self):
        (gateway.STATE / "other.json").write_text(json.dumps({"managementIp": "10.253.240.3", "nodePublicKey": "other-peer"}))
        self.assertEqual(self.register(), "10.253.240.4")

    def test_forced_command_rejects_shell_commands_and_traversal(self):
        for command in ["status; id", "add ../../etc/passwd key", "sh", "status extra"]:
            with mock.patch.dict(gateway.os.environ, {"SSH_ORIGINAL_COMMAND": command}):
                with self.assertRaises(ValueError):
                    gateway.main()
        self.runner.assert_not_called()

    def test_peer_endpoint_is_bound_to_registered_management_identity(self):
        self.register()
        self.runner.side_effect = lambda *args: {
            "endpoints": "new-peer\t8.8.4.4:40000\nunknown\t1.1.1.1:30000",
            "latest-handshakes": "new-peer\t1000",
            "allowed-ips": "new-peer\t10.253.240.3/32"
        }[args[-1]]
        with mock.patch.object(gateway.time, "time", return_value=1100):
            self.assertEqual(gateway.peer_status(self.control), [{"nodeId": self.job, "managementIp": "10.253.240.3", "publicIp": "8.8.4.4", "lastHandshakeAt": 1000}])
        self.assertFalse(any(call.args[-1] == "dump" for call in self.runner.call_args_list), "private keys must never be requested")

    def test_foreign_routes_and_nonpublic_endpoints_are_not_candidates(self):
        self.register()
        self.runner.side_effect = lambda *args: {
            "endpoints": "new-peer\t127.0.0.1:22", "latest-handshakes": "new-peer\t1000", "allowed-ips": "new-peer\t10.253.240.3/32"
        }[args[-1]]
        self.assertIsNone(gateway.peer_status(self.control)[0]["publicIp"])
        self.runner.side_effect = lambda *args: {
            "endpoints": "new-peer\t8.8.4.4:22", "latest-handshakes": "new-peer\t1000", "allowed-ips": "new-peer\t10.253.240.99/32"
        }[args[-1]]
        self.assertEqual(gateway.peer_status(self.control), [])

    @unittest.skipUnless(hasattr(gateway.os, 'geteuid') and gateway.os.geteuid() == 0, 'root-owned DNS tool checks require Linux root')
    def test_dns_install_uses_only_reserved_management_ip_and_pinned_ssh(self):
        peer = base64.b64encode(bytes([2]) * 32).decode()
        self.register(peer)
        protected_tools = tempfile.TemporaryDirectory(prefix='incudal-dns-tools-', dir='/root') if hasattr(gateway.os, 'geteuid') and gateway.os.geteuid() == 0 else tempfile.TemporaryDirectory()
        self.addCleanup(protected_tools.cleanup)
        tools = pathlib.Path(protected_tools.name)
        for name in ['refresh-host-gateway-endpoint.py', 'install-host-gateway-dns.sh']:
            (tools / name).write_text('trusted fixture'); (tools / name).chmod(0o644)
        host_key = base64.b64encode(b'fixture-ssh-key').decode()
        fingerprint = 'SHA256:' + base64.b64encode(hashlib.sha256(b'fixture-ssh-key').digest()).decode().rstrip('=')
        request = {'hostname': 'gateway.example.com', 'port': 51820, 'sshPort': 2222, 'sshFingerprint': fingerprint, 'nodePublicKey': peer}
        commands = []
        def subprocess_run(args, **kwargs):
            commands.append(args)
            if args[0] == 'ssh-keyscan':
                return type('Result', (), {'returncode': 0, 'stdout': ('[10.253.240.3]:2222 ssh-ed25519 ' + host_key + '\n').encode()})()
            self.assertIn('root@10.253.240.3', args)
            self.assertIn('StrictHostKeyChecking=yes', args)
            self.assertIn('2222', args)
            self.assertNotIn('1.1.1.1', args)
            return type('Result', (), {'returncode': 0, 'stdout': b'Existing gateway DNS refresh enabled'})()
        self.runner.side_effect = lambda *args: '51820' if args[-1] == 'listen-port' else peer + '\t10.253.240.3/32'
        protected_state = tools / 'state'; protected_state.mkdir(mode=0o700)
        (protected_state / (self.job + '.json')).write_text((gateway.STATE / (self.job + '.json')).read_text())
        (protected_state / (self.job + '.json')).chmod(0o600)
        with mock.patch.object(gateway, 'DNS_TOOLS', tools), mock.patch.object(gateway, 'STATE', protected_state), \
             mock.patch.object(gateway, 'sys', type('System', (), {'stdin': type('Input', (), {'buffer': io.BytesIO(json.dumps(request).encode())})()})()), \
             mock.patch.object(gateway.subprocess, 'run', side_effect=subprocess_run):
            receipt = gateway.install_host_dns(self.job, self.control, peer)
            self.assertTrue(receipt['dnsRefreshInstalled'])
            self.assertEqual(commands[-1][0], 'ssh')


if __name__ == "__main__":
    unittest.main()
