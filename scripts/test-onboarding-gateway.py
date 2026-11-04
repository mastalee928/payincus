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


class RecoveryRouteTests(unittest.TestCase):
    """Exercise the real restricted operation; OS boundaries are adapters here."""
    def setUp(self):
        self.job = '11111111-1111-4111-8111-111111111111'
        self.key = base64.b64encode(bytes([7])*32).decode()
        self.public = base64.b64encode(bytes([8])*32).decode()
        self.control = ipaddress.ip_interface('10.253.240.1/20')
        self.block = '# incudal-onboarding '+self.job+'\n[Peer]\nPublicKey = '+self.key+'\nAllowedIPs = 10.253.240.2/32\n'
        self.config = ('[Interface]\nAddress = 10.253.240.1/20\n\n'+self.block).encode()
        self.reservation = json.dumps({'nodePublicKey':self.key,'managementIp':'10.253.240.2'}).encode()
        self.live = {}; self.commands = []; self.now = 1000; self.reads = 0
        def read(path, limit):
            self.reads += 1
            return self.config if path == gateway.CONFIG else self.reservation
        def run(*args):
            self.commands.append(args)
            if args[-1] == 'public-key': return self.public
            if args[-1] == 'allowed-ips': return '\n'.join(key+'\t'+value for key,value in self.live.items())
            self.assertEqual(args,('wg','set',gateway.INTERFACE,'peer',self.key,'allowed-ips','10.253.240.2/32'))
            self.live[self.key] = '10.253.240.2/32'
            return ''
        self.reader = mock.patch.object(gateway,'read_protected_state',side_effect=read).start()
        self.runner = mock.patch.object(gateway,'run',side_effect=run).start()
        mock.patch.object(gateway.time,'time',side_effect=lambda:self.now).start()
        self.addCleanup(mock.patch.stopall)

    def request(self, **changes):
        return {'nodePublicKey':self.key,'managementIp':'10.253.240.2','gatewayPublicKey':self.public,
                'configHash':hashlib.sha256(self.config).hexdigest(),'expiresAt':1025000,**changes}

    def restore(self, request=None):
        with mock.patch.object(gateway.sys,'stdin',type('Input',(),{'buffer':io.BytesIO(json.dumps(request or self.request()).encode())})()):
            return gateway.restore_saved_peer(self.job,self.control,self.public)

    def writes(self): return [call for call in self.commands if call[1] == 'set']

    def test_missing_runtime_route_and_lost_receipt_are_idempotent(self):
        original = self.config, self.reservation
        self.assertTrue(self.restore()['runtimeRouteRestored'])
        self.assertTrue(self.restore()['runtimeRouteRestored'])
        self.assertEqual(len(self.writes()),1)
        self.assertEqual((self.config,self.reservation),original)

    def test_recovery_state_reports_missing_and_live_without_writing(self):
        with mock.patch.object(pathlib.Path,'glob',return_value=[gateway.STATE/(self.job+'.json')]):
            missing=gateway.read_recovery_state(self.control)
            self.assertFalse(missing['peers'][0]['enabled'])
            self.live[self.key]='10.253.240.2/32'
            present=gateway.read_recovery_state(self.control)
            self.assertTrue(present['peers'][0]['enabled'])
            self.assertNotEqual(missing['runtimeHash'],present['runtimeHash'])
            self.assertEqual(missing['configHash'],present['configHash'])
            self.assertEqual(self.writes(),[])

    def test_recovery_state_rejects_foreign_changed_or_duplicate_live_routes(self):
        with mock.patch.object(pathlib.Path,'glob',return_value=[gateway.STATE/(self.job+'.json')]):
            for live in [{'unknown':'10.253.240.3/32'},{self.key:'10.253.240.3/32'},
                         {self.key:'10.253.240.2/32,fd00::1/128'}]:
                self.live=live
                with self.assertRaises(gateway.GatewayOperationError):gateway.read_recovery_state(self.control)
            with mock.patch.object(gateway,'run',return_value=(self.key+'\t10.253.240.2/32\n')*2):
                with self.assertRaisesRegex(ValueError,'duplicate live peer'):gateway.read_recovery_state(self.control)
            self.assertEqual(self.writes(),[])

    def test_recovery_state_rejects_conflicting_reservations(self):
        with mock.patch.object(pathlib.Path,'glob',return_value=[gateway.STATE/(self.job+'.json')]):
            for address in ['10.253.240.0','10.253.240.1','10.253.255.255','192.0.2.1']:
                self.reservation=json.dumps({'managementIp':address,'nodePublicKey':self.key}).encode()
                with self.assertRaises(gateway.GatewayOperationError):gateway.read_recovery_state(self.control)
            self.reservation=json.dumps({'managementIp':'10.253.240.2','nodePublicKey':self.key,'extra':1}).encode()
            with self.assertRaisesRegex(ValueError,'invalid reservation'):gateway.read_recovery_state(self.control)

    def test_changed_or_expired_requests_do_not_write(self):
        for changes in [{'configHash':'a'*64},{'gatewayPublicKey':'b'*44},{'nodePublicKey':'b'*44},
                        {'managementIp':'10.253.240.3'},{'expiresAt':1000000},{'expiresAt':True},{'extra':1}]:
            with self.subTest(changes=list(changes)):
                with self.assertRaises(ValueError): self.restore(self.request(**changes))
                self.assertEqual(self.writes(),[])

    def test_removed_modified_or_duplicate_saved_route_does_not_reenroll(self):
        original=self.config
        for changed in [original.replace(self.block.encode(),b''),original+self.block.encode(),
                        original+b'PresharedKey = extra\n',original+b'AllowedIPs = 10.253.240.2/32\n',
                        original+b'\n[Peer]\nPublicKey = other\nAllowedIPs = 10.253.240.0/24\n']:
            self.config=changed
            with self.assertRaises(ValueError): self.restore()
            self.assertEqual(self.writes(),[])

    def test_foreign_live_peer_wrong_address_and_extra_ipv6_reject(self):
        for live in [{'unknown':'10.253.240.4/32'},{self.key:'10.253.240.3/32'},
                     {self.key:'10.253.240.2/32,fd00::1/128'}]:
            self.live=live
            with self.assertRaises(gateway.GatewayOperationError): self.restore()
            self.assertEqual(self.writes(),[])

    def test_configuration_changes_before_dispatch_reject(self):
        original=self.reader.side_effect
        def changed(path,limit):
            data=original(path,limit)
            return data+b'\n# changed' if self.reads>=3 and path==gateway.CONFIG else data
        self.reader.side_effect=changed
        with self.assertRaises(gateway.GatewayOperationError) as error:self.restore()
        self.assertEqual(error.exception.code,'GATEWAY_RECOVERY_REPAIR_CHANGED')
        self.assertEqual(self.writes(),[])

    def test_expiration_during_preflight_prevents_late_write(self):
        original=self.runner.side_effect
        def delayed(*args):
            result=original(*args);self.now=1026;return result
        self.runner.side_effect=delayed
        with self.assertRaises(gateway.GatewayOperationError) as error:self.restore()
        self.assertEqual(error.exception.code,'GATEWAY_RECOVERY_REPAIR_EXPIRED')
        self.assertEqual(self.writes(),[])

    def test_real_command_wrapper_has_bounded_timeout_and_fixed_error(self):
        # Undo only the run adapter to exercise the actual subprocess wrapper.
        mock.patch.stopall()
        for failure,code in [(gateway.subprocess.TimeoutExpired('wg',3),'SSH_COMMAND_TIMEOUT'),
                             (gateway.subprocess.CalledProcessError(1,'wg'),'GATEWAY_RECOVERY_RUNTIME_UNAVAILABLE')]:
            with mock.patch.object(gateway.subprocess,'check_output',side_effect=failure) as execute:
                with self.assertRaises(gateway.GatewayOperationError) as error:gateway.run('wg','show','incudal-mgmt','allowed-ips')
                self.assertEqual(error.exception.code,code)
                self.assertEqual(execute.call_args.kwargs['timeout'],3)

    def test_protected_file_rechecks_open_descriptor(self):
        from types import SimpleNamespace
        mock.patch.stopall()
        path=pathlib.Path('/protected/config')
        safe=SimpleNamespace(st_uid=0,st_mode=0o100600,st_nlink=1,st_size=4)
        for changed in [SimpleNamespace(st_uid=7,st_mode=0o100600,st_nlink=1,st_size=4),
                        SimpleNamespace(st_uid=0,st_mode=0o100622,st_nlink=1,st_size=4),
                        SimpleNamespace(st_uid=0,st_mode=0o100600,st_nlink=2,st_size=4),
                        SimpleNamespace(st_uid=0,st_mode=0o010600,st_nlink=1,st_size=4)]:
            with mock.patch.object(pathlib.Path,'lstat',return_value=safe),mock.patch.object(gateway.os,'open',return_value=19),\
                 mock.patch.object(gateway.os,'fstat',return_value=changed),mock.patch.object(gateway.os,'close') as close,\
                 mock.patch.object(gateway.os,'read') as read:
                with self.assertRaises(ValueError):gateway.read_protected_state(path,4096)
                read.assert_not_called();close.assert_called_once_with(19)


class GatewayTests(unittest.TestCase):
    def test_recovery_protocol_reads_exact_live_filter_not_old_ack(self):
        table={'table':{'family':'inet','name':'incudal_ingress_protocol'}}
        chain={'chain':{'family':'inet','table':'incudal_ingress_protocol','name':'forward','type':'filter','hook':'forward','prio':-20,'policy':'accept'}}
        document={'nftables':[table,chain]}
        gateway.verify_recovery_port_protocol(document,'tcp_udp')
        with self.assertRaises(gateway.GatewayOperationError):gateway.verify_recovery_port_protocol(document,'tcp')
        expressions=[
            {'match':{'op':'!=','left':{'meta':{'key':'iifname'}},'right':'incusbr0'}},
            {'match':{'op':'==','left':{'meta':{'key':'oifname'}},'right':'incusbr0'}},
            {'match':{'op':'==','left':{'meta':{'key':'l4proto'}},'right':'udp'}},
            {'match':{'op':'==','left':{'ct':{'key':'direction'}},'right':'original'}},
            {'counter':{'packets':312,'bytes':62000}},{'drop':None}]
        rule={'rule':{'family':'inet','table':'incudal_ingress_protocol','chain':'forward','expr':expressions}}
        document['nftables'].append(rule)
        gateway.verify_recovery_port_protocol(document,'tcp')
        with self.assertRaises(gateway.GatewayOperationError):gateway.verify_recovery_port_protocol(document,'tcp_udp')
        for index in range(len(expressions)):
            if 'counter' in expressions[index]:continue
            broken=json.loads(json.dumps(document));broken['nftables'][2]['rule']['expr'].pop(index)
            with self.assertRaises(gateway.GatewayOperationError):gateway.verify_recovery_port_protocol(broken,'tcp')
        for broken in [{}, {'nftables':[]}, {'nftables':[table,chain,rule,rule]}, {'nftables':[table,{**chain,'other':{}}]}]:
            with self.assertRaises(gateway.GatewayOperationError):gateway.verify_recovery_port_protocol(broken,'tcp')

    def test_recovery_probe_timeout_retains_a_retryable_code(self):
        for command in ['ssh-keyscan', 'ssh']:
            with mock.patch.object(gateway.subprocess, 'run', side_effect=gateway.subprocess.TimeoutExpired(command, 15)):
                with self.assertRaises(gateway.GatewayOperationError) as error:
                    gateway.recovery_probe_process([command])
                self.assertEqual(error.exception.code, 'SSH_COMMAND_TIMEOUT')

    def test_thousand_distinct_host_reservations_fit_without_changing_gateway(self):
        import uuid
        self.control = ipaddress.ip_interface('10.253.240.1/20')
        gateway.CONFIG.write_text(self.config.replace('/24', '/20'))
        assigned = {self.register('node-key-' + str(i), str(uuid.uuid4())) for i in range(1000)}
        self.assertEqual(len(assigned), 1000)
        self.assertNotIn(str(self.control.ip), assigned)
        self.assertTrue(all(ipaddress.ip_address(ip) in self.control.network for ip in assigned))

    def test_missing_ssh_reply_is_not_reported_as_changed_identity(self):
        from types import SimpleNamespace
        with self.assertRaises(gateway.GatewayOperationError) as error:
            gateway.verified_host_scan(SimpleNamespace(stdout=b''), 'SHA256:' + 'a' * 43)
        self.assertEqual(error.exception.code, 'GATEWAY_DNS_HOST_UNREACHABLE')

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


class RetirementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='incudal-retirement-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.state = self.root / 'state'; self.state.mkdir()
        self.config = self.root / 'wg.conf'
        self.job = '11111111-1111-4111-8111-111111111111'
        self.request_id = '22222222-2222-4222-8222-222222222222'
        self.key = base64.b64encode(bytes([11])*32).decode()
        self.other = base64.b64encode(bytes([12])*32).decode()
        self.address = '10.253.240.6'
        self.control = ipaddress.ip_interface('10.253.240.1/20')
        self.block = '# incudal-onboarding '+self.job+'\n[Peer]\nPublicKey = '+self.key+'\nAllowedIPs = '+self.address+'/32\n'
        self.unrelated = '[Interface]\nAddress = 10.253.240.1/20\n\n[Peer]\nPublicKey = '+self.other+'\nAllowedIPs = 10.253.240.7/32\n\n'
        self.config.write_text(self.unrelated+self.block)
        (self.state/(self.job+'.json')).write_text(json.dumps({'nodePublicKey':self.key,'managementIp':self.address}))
        self.live = {self.key:[self.address+'/32'],self.other:['10.253.240.7/32']}
        self.writes = []
        mock.patch.object(gateway,'STATE',self.state).start();mock.patch.object(gateway,'CONFIG',self.config).start()
        # File ownership and OS WireGuard boundaries are tested on Linux; this
        # fixture executes the real journal/configuration lifecycle on disk.
        mock.patch.object(gateway,'read_protected_state',side_effect=lambda path,limit:path.read_bytes()).start()
        mock.patch.object(gateway,'recovery_live_routes',side_effect=lambda:dict(self.live)).start()
        mock.patch.object(gateway.time,'time',return_value=1000).start()
        def run(*args):
            self.writes.append(args)
            if args[-1]=='remove': self.live.pop(args[-2],None)
            return ''
        mock.patch.object(gateway,'run',side_effect=run).start();self.addCleanup(mock.patch.stopall)

    def retire(self, **changes):
        request={'nodePublicKey':self.key,'managementIp':self.address,'expiresAt':1025000,'requestId':self.request_id,**changes}
        with mock.patch.object(gateway.sys,'stdin',type('Input',(),{'buffer':io.BytesIO(json.dumps(request).encode())})()):
            return gateway.retire_peer(self.job,self.control)

    def test_delete_recreate_and_late_old_receipt_preserve_new_peer(self):
        self.assertTrue(self.retire()['registrationRetired'])
        self.assertEqual(self.config.read_text(),self.unrelated)
        self.assertEqual(self.live,{self.other:['10.253.240.7/32']})
        self.assertIsNone(gateway.registration(self.job))
        self.assertEqual(len(self.writes),1)
        new_key=base64.b64encode(bytes([13])*32).decode()
        address=gateway.register_peer(self.job,new_key,self.control,self.config.read_text(),{key:[ipaddress.ip_network(route) for route in routes] for key,routes in self.live.items()})
        self.live[new_key]=[address+'/32']
        before=self.config.read_text(),dict(self.live)
        self.assertTrue(self.retire()['registrationRetired'])
        self.assertEqual((self.config.read_text(),self.live),before,'late retirement must not touch a new generation')

    def test_crash_after_startup_config_write_resumes_without_duplicate_changes(self):
        original=gateway.atomic_write
        def publish(path,text):
            original(path,text)
            if path==self.config: raise RuntimeError('lost receipt after config publication')
        with mock.patch.object(gateway,'atomic_write',side_effect=publish):
            with self.assertRaises(RuntimeError):self.retire()
        self.assertTrue(self.retire()['registrationRetired'])
        self.assertEqual(self.config.read_text(),self.unrelated)
        self.assertEqual(self.live,{self.other:['10.253.240.7/32']})
        self.assertEqual(len(self.writes),1)

    def test_changed_foreign_duplicate_and_expired_requests_make_no_changes(self):
        before=self.config.read_text()
        for changes in [{'nodePublicKey':self.other},{'managementIp':'10.253.240.7'},{'expiresAt':1000000},{'extra':1}]:
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):self.retire(**changes)
                self.assertEqual(self.config.read_text(),before);self.assertEqual(self.writes,[])
        self.config.write_text(before+self.block)
        with self.assertRaises(ValueError):self.retire()
        self.assertEqual(self.writes,[])

    def test_incomplete_retirement_blocks_new_registration_until_finished(self):
        original=gateway.atomic_write
        def publish(path,text):
            original(path,text)
            if path==self.config: raise RuntimeError('interrupted')
        with mock.patch.object(gateway,'atomic_write',side_effect=publish):
            with self.assertRaises(RuntimeError):self.retire()
        with self.assertRaises(gateway.GatewayOperationError):gateway.register_peer(self.job,self.other,self.control,self.config.read_text(),self.live)
        self.retire()
        self.assertNotIn(self.key,self.live)

    def test_restored_deleted_node_without_peer_can_complete_retirement(self):
        self.config.write_text(self.unrelated)
        (self.state/(self.job+'.json')).unlink()
        self.live.pop(self.key)
        self.assertTrue(self.retire()['registrationRetired'])
        self.assertEqual(self.config.read_text(),self.unrelated)
        self.assertEqual(self.writes,[])

    def test_missing_reservation_does_not_authorize_an_untracked_live_peer(self):
        (self.state/(self.job+'.json')).unlink()
        with self.assertRaises(gateway.GatewayOperationError):self.retire()
        self.assertIn(self.key,self.live)
        self.assertEqual(self.writes,[])


if __name__ == "__main__":
    unittest.main()
