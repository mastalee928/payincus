import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import stat
import types
import unittest
from unittest.mock import patch, Mock

# Windows can test the parsing/atomic-write code without claiming Linux flock
# or service-manager acceptance. Linux uses its real fcntl module.
if sys.platform == 'win32':
    sys.modules['fcntl'] = types.SimpleNamespace()
spec = importlib.util.spec_from_file_location('host_timezone', Path(__file__).parents[1] / 'server/templates/host-timezone.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TimezoneTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='timezone-fixture-')
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.zones = self.root / 'zoneinfo'
        (self.zones / 'Asia').mkdir(parents=True)
        (self.zones / 'Asia/Seoul').write_bytes(b'fixture-zone')
        (self.zones / 'Etc').mkdir()
        (self.zones / 'Etc/UTC').write_bytes(b'fixture-utc')
        for key, path in {'ROOT': self.root / 'state', 'ZONES': self.zones, 'LOCALTIME': self.root / 'localtime', 'TIMEZONE': self.root / 'timezone'}.items():
            p = patch.object(module, key, path); p.start(); self.addCleanup(p.stop)
        p = patch.object(module, 'ZoneInfo', side_effect=lambda zone: zone); p.start(); self.addCleanup(p.stop)
        self.trusted_directory = module.trusted_directory
        # Portable file tests do not claim native Linux owner/mode semantics.
        def fixture_directory(path, create=False):
            self.assertTrue(path == self.root or path.is_relative_to(self.root))
            if create:
                path.mkdir(parents=True, exist_ok=True)
        p = patch.object(module, 'trusted_directory', side_effect=fixture_directory); p.start(); self.addCleanup(p.stop)
        p = patch.object(module.os, 'geteuid', return_value=0, create=True); p.start(); self.addCleanup(p.stop)
        if sys.platform == 'win32':
            p = patch.object(module, 'signal', Mock(SIGALRM=14)); p.start(); self.addCleanup(p.stop)
            # Windows runner cannot create symlinks. Emulate only link creation
            # and resolution; native Linux runs exercise the actual operation.
            original_resolve = Path.resolve
            localtime = module.LOCALTIME
            def resolve(path, *args, **kwargs):
                if path == localtime and path.exists():
                    return original_resolve(Path(path.read_text()))
                return original_resolve(path, *args, **kwargs)
            p = patch.object(module.os, 'symlink', side_effect=lambda target, path: Path(path).write_text(target)); p.start(); self.addCleanup(p.stop)
            p = patch.object(Path, 'resolve', resolve); p.start(); self.addCleanup(p.stop)

    def test_untrusted_parent_rejected(self):
        # Run the real directory predicate with explicit POSIX metadata.
        path = Mock()
        path.parent = path
        for mode, uid in [(stat.S_IFLNK | 0o777, 0), (stat.S_IFDIR | 0o777, 0), (stat.S_IFDIR | 0o755, 1000)]:
            path.lstat.return_value = types.SimpleNamespace(st_mode=mode, st_uid=uid)
            with self.assertRaises(ValueError):
                self.trusted_directory(path)
        path.lstat.return_value = types.SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0)
        self.trusted_directory(path)

    def test_only_real_zone_paths(self):
        self.assertEqual(module.zone_from_response({'ip': '192.0.2.1', 'timezone': 'Asia/Seoul'})[0], 'Asia/Seoul')
        for value in ['../etc/passwd', '/etc/passwd', 'Asia/../Seoul', 'Asia/Seoul\n', '$(id)', 'Missing/Zone', 'A' * 101]:
            with self.assertRaises((ValueError, KeyError)):
                module.zone_from_response({'ip': '192.0.2.1', 'timezone': value})
        with self.assertRaises(ValueError):
            module.zone_from_response({'ip': 'not-an-ip', 'timezone': 'Asia/Seoul'})

    def test_fixed_https_without_credentials_or_redirects(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size):
                self_size = size
                assert self_size == 16385
                return json.dumps({'ip': '192.0.2.1', 'timezone': 'Asia/Seoul'}).encode()
        with patch.object(module.urllib.request, 'build_opener') as factory:
            factory.return_value.open.return_value = Response()
            self.assertEqual(module.fetch()[0], 'Asia/Seoul')
            request = factory.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, 'https://ipinfo.io/json')
            self.assertIsNone(request.data)
            self.assertNotIn('Authorization', request.headers)
        with self.assertRaises(ValueError):
            module.NoRedirect().redirect_request(None)

    def test_failure_keeps_previous_timezone(self):
        module.TIMEZONE.write_text('Etc/UTC\n')
        before = module.TIMEZONE.read_bytes()
        with patch.object(module.os, 'geteuid', return_value=0, create=True), patch.object(module, 'fetch', side_effect=TimeoutError):
            module.configure()
        self.assertEqual(module.TIMEZONE.read_bytes(), before)

    def test_success_then_cached_and_retry_after_failure(self):
        with patch.object(module, 'fetch', side_effect=TimeoutError):
            module.configure()
        self.assertFalse(module.TIMEZONE.exists())
        with patch.object(module, 'fetch', return_value=('Asia/Seoul', self.zones / 'Asia/Seoul')) as fetch:
            module.configure()
            module.configure()
            fetch.assert_called_once()
        self.assertEqual(module.TIMEZONE.read_text(), 'Asia/Seoul\n')
        self.assertEqual(module.LOCALTIME.resolve(), (self.zones / 'Asia/Seoul').resolve())
        self.assertNotIn('192.0.2', (module.ROOT / 'receipt.json').read_text())

    def test_local_conflict_never_reported_as_lookup_retry(self):
        module.TIMEZONE.mkdir()
        with patch.object(module, 'fetch') as fetch:
            with self.assertRaisesRegex(ValueError, 'configuration conflict'):
                module.configure()
            fetch.assert_not_called()
        self.assertFalse(module.LOCALTIME.exists())

    def test_atomic_replaces_only_owned_file(self):
        path = self.root / 'config'
        module.atomic(path, b'first')
        module.atomic(path, b'second')
        self.assertEqual(path.read_bytes(), b'second')
        self.assertFalse(list(self.root.glob('.incudal-time-*')))


if __name__ == '__main__':
    unittest.main()
