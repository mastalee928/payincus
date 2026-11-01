#!/usr/bin/env python3
"""Hostname migration state-machine regression; command boundaries are controlled."""
import hashlib
import importlib.util
import json
import os
import http.server
import shutil
import ssl
import threading
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

if os.name == 'nt':
    # Only state-machine tests run on Windows. Native lock/owner tests below
    # remain explicitly skipped and are executed by Linux CI.
    sys.modules.setdefault('fcntl', types.ModuleType('fcntl'))
spec = importlib.util.spec_from_file_location('gateway_domain', Path(__file__).with_name('gateway-domain-control.py'))
domain = importlib.util.module_from_spec(spec)
spec.loader.exec_module(domain)
GATEWAY = '11111111-1111-4111-8111-111111111111'
PLATFORM = '22222222-2222-4222-8222-222222222222'
REQUEST = '33333333-3333-4333-8333-333333333333'
REQUEST2 = '44444444-4444-4444-8444-444444444444'
MACHINE = 'a' * 32
STATE = domain.ROOT / GATEWAY


class DomainTests(unittest.TestCase):
    def setUp(self):
        self.config = {'schemaVersion': 1, 'origin': 'https://old.example.com:18443', 'listenHost': '0.0.0.0', 'listenPort': 18443,
                       'authDirectory': str(STATE / 'auth'), 'assetDirectory': '/opt/incudal-gateway/components/' + 'a' * 64 + '/ui',
                       'tlsKey': str(STATE / 'tls.key'), 'tlsCertificate': str(STATE / 'tls.crt'), 'initialUser': None,
                       'transport': {'platformId': PLATFORM, 'gatewayId': GATEWAY, 'statePath': str(STATE / 'transport/gateway-transport.json')}}
        self.files = {STATE / 'tls.key': b'original-private-key', STATE / 'tls.crt': b'original-certificate',
                      STATE / 'wireguard.key': b'original-wireguard-key', STATE / 'signed-transport.json': b'original-signed-transport',
                      STATE / 'auth/gateway-auth.json': b'original-users-and-mfa',
                      domain.MACHINE: MACHINE.encode(), domain.UNIT: ('ExecStart=/opt/incudal-gateway/components/' + 'a' * 64 +
                      '/bin/node /opt/incudal-gateway/components/' + 'a' * 64 + '/lib/gateway-console.cjs --serve ' + str(STATE / 'console-config.json') + '\n').encode(),
                      Path('/etc/systemd/system/incudal-gateway.service'): b'unchanged-transport-service'}
        self.put(STATE / 'console-config.json', self.config)
        self.put(domain.ROOT / 'owner.json', {'platformId': PLATFORM, 'gatewayId': GATEWAY, 'machineId': MACHINE})
        self.put(STATE / 'transport-config.json', {'platformId': PLATFORM, 'gatewayId': GATEWAY})
        self.put(STATE / 'request.json', {'configuration': {'slot': 'b'}, 'task': {'basedOnRevision': '0', 'taskId': REQUEST,
                 'platformId': PLATFORM, 'gatewayId': GATEWAY, 'target': {'machineId': MACHINE}}})
        self.put(STATE / 'receipt.json', {'taskId': REQUEST, 'gatewayId': GATEWAY, 'installed': True, 'consoleCertificateSha256': domain.digest(b'original-certificate')})
        self.enrollment = {'schemaVersion': 1, 'operation': 'enroll', 'platformId': PLATFORM, 'gatewayId': GATEWAY, 'machineId': MACHINE,
                           'requestId': REQUEST, 'expectedRevision': '1', 'expectedOrigin': self.config['origin'], 'origin': self.config['origin'],
                           'expectedCertificateSha256': domain.digest(b'original-certificate'), 'expectedTlsKeySha256': None}
        self.restarts = []; self.writes = []; self.verify_failures = 0; self.crash = False; self.commit_marker_failure = False
        self.commit_fsync_failure = False; self.commit_write_failure = False
        self.commands = []
        def write(path, value):
            if self.commit_marker_failure and path.name == 'domain-pending.json' and value.get('completed'):
                self.commit_marker_failure = False
                raise OSError('controlled post-commit marker failure')
            if self.commit_write_failure and path.name == 'domain-state.json' and value['receipt']['revision'] == '2':
                self.commit_write_failure = False
                raise OSError('controlled failure before commit replace')
            self.writes.append(path); self.put(path, value)
            if self.commit_fsync_failure and path.name == 'domain-state.json' and value['receipt']['revision'] == '2':
                self.commit_fsync_failure = False
                raise OSError('controlled failure after commit replace')
        def verify(state, config, certificate):
            self.assertEqual(state, STATE)
            self.assertEqual(self.get(STATE / 'console-config.json'), config)
            self.assertEqual(domain.digest(self.files[Path(config['tlsCertificate'])]), certificate)
            if config['origin'] == 'https://new.example.com:18443':
                if self.crash:
                    self.crash = False
                    raise KeyboardInterrupt('controlled process loss after publishing new config')
                if self.verify_failures:
                    self.verify_failures -= 1
                    raise domain.Rejected('GATEWAY_DOMAIN_VERIFY_FAILED')
        def restart(state, config, certificate):
            self.restarts.append(config['origin']); verify(state, config, certificate)
        def cert(state, request, revision):
            self.assertEqual(state, STATE)
            target = STATE / 'domain' / ('tls-' + revision + '-' + request['requestId'] + '.crt')
            self.files[target] = b'new-certificate-same-key'
            return str(target), domain.digest(self.files[target])
        def command(program, arguments, *_args, **_kwargs):
            self.commands.append((program, arguments))
            self.assertEqual(program, '/usr/bin/wg')
            self.assertEqual(arguments[:2], ['show', 'incudal-gw-b'])
            return ('unchanged-' + arguments[-1]).encode()
        for mock in [patch.object(domain, 'read', side_effect=lambda path, *_: self.files[path]), patch.object(domain, 'write', side_effect=write),
                     patch.object(domain.Path, 'exists', lambda path: path in self.files), patch.object(domain.Path, 'is_symlink', return_value=False),
                     patch.object(domain, 'certificate_sha', side_effect=domain.digest), patch.object(domain, 'new_certificate', side_effect=cert),
                     patch.object(domain, 'verify_console', side_effect=verify), patch.object(domain, 'restart_console', side_effect=restart),
                     patch.object(domain, 'command', side_effect=command)]:
            mock.start(); self.addCleanup(mock.stop)

    def put(self, path, value):
        self.files[path] = json.dumps(value, separators=(',', ':')).encode()

    def get(self, path):
        return json.loads(self.files[path])

    def apply_request(self):
        return {**self.enrollment, 'operation': 'apply', 'requestId': REQUEST2, 'origin': 'https://new.example.com:18443',
                'expectedTlsKeySha256': domain.digest(self.files[STATE / 'tls.key'])}

    def enroll(self):
        return domain.execute(dict(self.enrollment))

    def test_enroll_apply_replay_and_status_preserve_transport_users_and_key(self):
        preserved = {path: value for path, value in self.files.items() if path.name != 'console-config.json'}
        enrolled = self.enroll(); self.assertEqual(enrolled['revision'], '1')
        request = self.apply_request()
        result = domain.execute(request)
        self.assertEqual(result['revision'], '2'); self.assertTrue(result['verified']); self.assertTrue(result['transportPreserved'])
        self.assertEqual(self.get(STATE / 'console-config.json'), {**self.config, 'origin': request['origin'], 'tlsCertificate': str(STATE / 'domain' / ('tls-2-' + REQUEST2 + '.crt'))})
        self.assertEqual(domain.execute(request), result)
        self.assertEqual(self.restarts, [request['origin']])
        for path, value in preserved.items():
            self.assertEqual(self.files[path], value)
        status = {**request, 'operation': 'status', 'requestId': REQUEST, 'expectedRevision': '2', 'expectedOrigin': request['origin'],
                  'expectedCertificateSha256': result['certificateSha256']}
        self.assertEqual(domain.execute(status)['origin'], request['origin'])
        self.assertTrue(all(args[0] == 'show' for _, args in self.commands))

    def test_stale_revision_old_certificate_origin_or_key_rejected_without_writes(self):
        self.enroll()
        for changed in [{'expectedRevision': '2'}, {'expectedOrigin': 'https://other.example.com:18443'},
                        {'expectedCertificateSha256': 'f' * 64}, {'expectedTlsKeySha256': 'f' * 64}]:
            self.writes.clear()
            with self.assertRaises(domain.Rejected):
                domain.execute({**self.apply_request(), **changed})
            self.assertEqual(self.writes, [])

    def test_failed_new_service_rolls_back_then_same_request_recovers(self):
        self.enroll(); self.verify_failures = 1
        with self.assertRaisesRegex(domain.Rejected, 'VERIFY_FAILED'):
            domain.execute(self.apply_request())
        self.assertEqual(self.get(STATE / 'console-config.json'), self.config)
        self.assertEqual(self.get(STATE / 'domain-state.json')['receipt']['revision'], '1')
        self.assertEqual(self.restarts, ['https://new.example.com:18443', self.config['origin']])
        result = domain.execute(self.apply_request())
        self.assertEqual(result['revision'], '2')
        self.assertEqual(self.files[STATE / 'tls.key'], b'original-private-key')

    def test_process_crash_after_publish_resumes_only_same_operation(self):
        self.enroll(); self.crash = True
        with self.assertRaises(KeyboardInterrupt):
            domain.execute(self.apply_request())
        self.assertEqual(self.get(STATE / 'console-config.json')['origin'], 'https://new.example.com:18443')
        with self.assertRaisesRegex(domain.Rejected, 'BUSY'):
            domain.execute({**self.apply_request(), 'requestId': REQUEST})
        self.assertEqual(domain.execute(self.apply_request())['revision'], '2')

    def test_post_commit_crash_does_not_rollback_behind_durable_revision(self):
        self.enroll(); self.commit_marker_failure = True
        with self.assertRaises(OSError):
            domain.execute(self.apply_request())
        self.assertEqual(self.get(STATE / 'domain-state.json')['receipt']['revision'], '2')
        self.assertEqual(self.get(STATE / 'console-config.json')['origin'], 'https://new.example.com:18443')
        self.assertEqual(domain.execute(self.apply_request())['revision'], '2')
        self.assertEqual(self.restarts, ['https://new.example.com:18443'])

    def test_failed_commit_before_replace_rolls_back_but_after_replace_never_does(self):
        self.enroll(); self.commit_write_failure = True
        with self.assertRaises(OSError):
            domain.execute(self.apply_request())
        self.assertEqual(self.get(STATE / 'console-config.json'), self.config)
        self.assertEqual(self.get(STATE / 'domain-state.json')['receipt']['revision'], '1')
        self.commit_fsync_failure = True
        with self.assertRaisesRegex(domain.Rejected, 'COMMIT_UNCERTAIN'):
            domain.execute(self.apply_request())
        self.assertEqual(self.get(STATE / 'domain-state.json')['receipt']['revision'], '2')
        self.assertEqual(self.get(STATE / 'console-config.json')['origin'], 'https://new.example.com:18443')
        self.assertEqual(domain.execute(self.apply_request())['revision'], '2')

    def test_status_recovers_missing_controller_key_hash_without_writing(self):
        self.enroll()
        self.writes.clear()
        status = {**self.enrollment, 'operation': 'status', 'requestId': REQUEST2}
        self.assertEqual(domain.execute(status)['tlsKeySha256'], domain.digest(self.files[STATE / 'tls.key']))
        self.assertEqual(self.writes, [])
        for change in [{'expectedOrigin': 'https://other.example.com:18443', 'origin': 'https://other.example.com:18443'},
                       {'expectedRevision': '2'}, {'expectedCertificateSha256': 'f' * 64}]:
            with self.assertRaises(domain.Rejected):
                domain.execute({**status, **change})
            self.assertEqual(self.writes, [])
        del self.files[STATE / 'domain-state.json']
        with self.assertRaisesRegex(domain.Rejected, 'CONFLICT'):
            domain.execute(status)
        self.assertEqual(self.writes, [])

    def test_status_after_commit_marker_failure_remains_read_only(self):
        self.enroll(); self.commit_marker_failure = True
        with self.assertRaises(OSError):
            domain.execute(self.apply_request())
        result = self.get(STATE / 'domain-state.json')['receipt']
        status = {**self.enrollment, 'operation': 'status', 'expectedRevision': result['revision'],
                  'origin': result['origin'], 'expectedOrigin': result['origin'], 'expectedCertificateSha256': result['certificateSha256']}
        self.writes.clear()
        self.assertEqual(domain.execute(status)['revision'], '2')
        self.assertEqual(self.writes, [])

    def test_install_revision_and_machine_are_checked_when_enrolling(self):
        install = self.get(STATE / 'request.json'); install['task']['basedOnRevision'] = '8'
        self.put(STATE / 'request.json', install)
        with self.assertRaisesRegex(domain.Rejected, 'CONFLICT'):
            self.enroll()
        self.assertEqual(domain.execute({**self.enrollment, 'expectedRevision': '9'})['revision'], '9')
        del self.files[STATE / 'domain-state.json']
        install['task']['target']['machineId'] = 'b' * 32; self.put(STATE / 'request.json', install)
        with self.assertRaisesRegex(domain.Rejected, 'IDENTITY_CHANGED'):
            domain.execute({**self.enrollment, 'expectedRevision': '9'})

    def test_confirmed_rollback_allows_different_request_and_old_replay_cannot_revert(self):
        self.enroll(); self.verify_failures = 1
        with self.assertRaisesRegex(domain.Rejected, 'VERIFY_FAILED'):
            domain.execute(self.apply_request())
        alternate = {**self.apply_request(), 'requestId': REQUEST, 'origin': 'https://alternate.example.com:18443'}
        result = domain.execute(alternate)
        self.assertEqual(result['revision'], '2')
        self.writes.clear()
        with self.assertRaisesRegex(domain.Rejected, 'CONFLICT'):
            domain.execute(self.apply_request())
        self.assertEqual(self.writes, [])

    def test_changed_machine_owner_or_key_rejects_before_mutation(self):
        self.enroll()
        for path, value in [(domain.MACHINE, b'b' * 32), (STATE / 'tls.key', b'replacement-key'),
                            (domain.ROOT / 'owner.json', b'{}')]:
            previous = self.files[path]; self.files[path] = value; self.writes.clear()
            with self.assertRaises(domain.Rejected):
                domain.execute(self.apply_request())
            self.assertEqual(self.writes, []); self.files[path] = previous

    def test_identity_change_during_restart_prevents_commit_or_foreign_rollback(self):
        self.enroll()
        restart = domain.restart_console.side_effect
        def changed_owner(state, config, certificate):
            restart(state, config, certificate)
            self.put(domain.ROOT / 'owner.json', {'platformId': PLATFORM, 'gatewayId': GATEWAY, 'machineId': 'b' * 32})
        with patch.object(domain, 'restart_console', side_effect=changed_owner):
            with self.assertRaisesRegex(domain.Rejected, 'ROLLBACK_FAILED'):
                domain.execute(self.apply_request())
        self.assertEqual(self.get(STATE / 'domain-state.json')['receipt']['revision'], '1')
        self.assertFalse(self.get(STATE / 'domain-pending.json')['completed'])
        self.assertEqual(self.restarts, ['https://new.example.com:18443'])

    def test_invalid_requests_do_not_reach_files_or_commands(self):
        for change in [{'origin': 'https://new.example.com:18444'}, {'origin': 'https://new.example.com:18443/'},
                       {'origin': 'https://new.example.com;sh:18443'}, {'expectedRevision': '01'}, {'expectedRevision': '0'},
                       {'operation': 'shell'}, {'gatewayId': '../../etc'}, {'expectedTlsKeySha256': None}, {'command': 'sh'}]:
            with self.assertRaises((ValueError, domain.Rejected)):
                domain.validate({**self.apply_request(), **change})
        self.assertEqual(self.commands, []); self.assertEqual(self.writes, [])

    def test_roll_back_failure_is_explicit_and_retains_pending_journal(self):
        self.enroll()
        with patch.object(domain, 'restart_console', side_effect=domain.Rejected('GATEWAY_DOMAIN_VERIFY_FAILED')):
            with self.assertRaisesRegex(domain.Rejected, 'ROLLBACK_FAILED'):
                domain.execute(self.apply_request())
        self.assertFalse(self.get(STATE / 'domain-pending.json')['completed'])
        self.assertEqual(self.get(STATE / 'domain-state.json')['receipt']['revision'], '1')


@unittest.skipUnless(hasattr(os, 'geteuid') and os.geteuid() == 0, 'root-owned atomic file tests require Linux root')
class NativeFileTests(unittest.TestCase):
    def test_private_files_symlinks_hardlinks_and_atomic_write(self):
        with tempfile.TemporaryDirectory(prefix='gateway-domain-test-', dir='/root') as directory:
            path = Path(directory) / 'state.json'
            domain.write(path, {'revision': '1'})
            self.assertEqual(domain.decode(domain.read(path)), {'revision': '1'})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            link = Path(directory) / 'link'
            link.symlink_to(path)
            with self.assertRaises((OSError, domain.Rejected)):
                domain.read(link)
            os.link(path, Path(directory) / 'hard')
            with self.assertRaises(domain.Rejected):
                domain.write(path, {'revision': '2'})
            (Path(directory) / 'hard').unlink()
            path.chmod(0o644)
            with self.assertRaises(domain.Rejected):
                domain.read(path)


class RealTlsTests(unittest.TestCase):
    def test_actual_openssl_reuses_key_checks_san_and_serves_pinned_https(self):
        executable = shutil.which('openssl')
        if not executable and Path('C:/Program Files/Git/usr/bin/openssl.exe').is_file():
            executable = 'C:/Program Files/Git/usr/bin/openssl.exe'
        self.assertIsNotNone(executable, 'The certificate regression requires the OpenSSL executable')
        command = domain.command
        with tempfile.TemporaryDirectory(prefix='gateway-domain-tls-') as directory:
            state = Path(directory)
            command(executable, ['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', str(state / 'tls.key')])
            original_key = (state / 'tls.key').read_bytes()
            request = {'requestId': REQUEST2, 'origin': 'https://new.example.com:18443'}
            # Only Linux ownership and fsync boundaries are controlled;
            # certificate generation, OpenSSL checks, TLS and HTTP are real here.
            def directories(path, create=False):
                if create:
                    path.mkdir(parents=True, exist_ok=True)
            with patch.object(domain, 'directories', side_effect=directories), patch.object(domain, 'read', side_effect=lambda path, *_: path.read_bytes()), \
                 patch.object(domain, 'sync_directory'), patch.object(domain, 'command', side_effect=lambda _program, args, *a, **kw: command(executable, args, *a, **kw)), \
                 patch.object(domain.os, 'fsync', side_effect=os.fsync if os.name != 'nt' else lambda _fd: None):
                cert, pin = domain.new_certificate(state, request, '2')
                self.assertEqual((state / 'tls.key').read_bytes(), original_key)
                self.assertEqual(pin, domain.certificate_sha(Path(cert).read_bytes()))
                self.assertEqual(domain.new_certificate(state, request, '2'), (cert, pin))
                # Ubuntu OpenSSL 3.0 returns success for a negative hostname
                # check; keep that exact command result covered on all OSes.
                def mismatch_result(_program, args, *a, **kw):
                    if '-checkhost' in args:
                        return b'Hostname new.example.com does NOT match certificate\n'
                    return command(executable, args, *a, **kw)
                with patch.object(domain, 'command', side_effect=mismatch_result):
                    with self.assertRaisesRegex(domain.Rejected, 'IDENTITY_CHANGED'):
                        domain.new_certificate(state, request, '2')
                long_host = 'a' * 60 + '.gateway.example.com'
                long_cert, _ = domain.new_certificate(state, {**request, 'requestId': REQUEST, 'origin': 'https://' + long_host + ':18443'}, '2')
                command(executable, ['x509', '-in', long_cert, '-noout', '-checkhost', long_host])
                with self.assertRaises(domain.Rejected):
                    domain.new_certificate(state, {**request, 'origin': 'https://other.example.com:18443'}, '2')
                requests = []
                class Handler(http.server.BaseHTTPRequestHandler):
                    def do_GET(self):
                        requests.append((self.path, self.headers.get('Host')))
                        self.send_response(200); self.end_headers(); self.wfile.write(b'gateway console fixture')
                    def log_message(self, *_args):
                        pass
                server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                context.load_cert_chain(cert, state / 'tls.key')
                server.socket = context.wrap_socket(server.socket, server_side=True)
                thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
                try:
                    config = {'origin': 'https://new.example.com:' + str(server.server_port), 'tlsCertificate': cert}
                    domain.verify_console(state, config, pin)
                    self.assertEqual(requests, [('/', 'new.example.com:' + str(server.server_port))])
                    with self.assertRaisesRegex(domain.Rejected, 'IDENTITY_CHANGED'):
                        domain.verify_console(state, config, 'f' * 64)
                finally:
                    server.shutdown(); server.server_close(); thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
