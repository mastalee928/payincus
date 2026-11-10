#!/usr/bin/env python3
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

# Windows checks the file/decision logic only. Linux uses actual flock and
# POSIX metadata; no test invokes real swapon, mkswap or service management.
if sys.platform == 'win32':
    sys.modules['fcntl'] = types.SimpleNamespace(LOCK_EX=2, LOCK_NB=4, flock=lambda *_: None)
    os.geteuid = lambda: 0
    os.O_NOFOLLOW = 0

spec = importlib.util.spec_from_file_location('swap', Path(__file__).with_name('ensure-host-swap.py'))
swap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(swap)


class SwapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='incudal-swap-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.trusted_directory = swap.trusted_directory
        def fixture_directory(path):
            self.assertTrue(path == self.root or path.is_relative_to(self.root))
            self.assertFalse(path.is_symlink())
        p = patch.object(swap, 'trusted_directory', side_effect=fixture_directory); p.start(); self.addCleanup(p.stop)
        if sys.platform == 'win32':
            original_fstat = os.fstat
            def lock_metadata(fd):
                fields = list(original_fstat(fd)); fields[0] = 0o100600; fields[3] = 1; fields[4] = 0
                return os.stat_result(fields)
            p = patch.object(swap.os, 'fstat', side_effect=lock_metadata); p.start(); self.addCleanup(p.stop)
        for name, path in {'FSTAB': self.root / 'fstab', 'SWAPS': self.root / 'swaps', 'SWAP_DIRECTORY': self.root / 'incudal', 'LOCK_FILE': self.root / 'lock'}.items():
            p = patch.object(swap, name, path)
            p.start()
            self.addCleanup(p.stop)
        swap.FSTAB.write_text('# fixture\n/dev/vda1 / ext4 defaults 0 1\n')
        swap.SWAPS.write_text('Filename Type Size Used Priority\n/swapfile file 1048572 0 -2\n')

    def test_existing_swap_is_reused_and_persisted_once(self):
        with patch.object(swap.os, 'geteuid', return_value=0), patch.object(swap, 'run') as run, patch.object(swap.shutil, 'which', return_value='/bin/fixture'), contextlib.redirect_stdout(io.StringIO()):
            swap.ensure_swap()
            swap.ensure_swap()
        self.assertEqual(swap.FSTAB.read_text().count('/swapfile none swap defaults 0 0'), 1)
        self.assertIn('/dev/vda1 / ext4 defaults 0 1', swap.FSTAB.read_text())
        self.assertFalse(swap.SWAP_DIRECTORY.exists())
        self.assertFalse(any(call.args[0] in ('swapon', 'mkswap') for call in run.call_args_list))

    def test_larger_existing_swap_is_never_shrunk(self):
        swap.SWAPS.write_text('Filename Type Size Used Priority\n/swapfile file 2097148 0 -2\n')
        with patch.object(swap.os, 'geteuid', return_value=0), patch.object(swap, 'run'), patch.object(swap.shutil, 'which', return_value=None), contextlib.redirect_stdout(io.StringIO()):
            swap.ensure_swap()
        self.assertFalse(swap.SWAP_DIRECTORY.exists())

    def test_noauto_is_removed_and_openrc_boot_service_is_enabled(self):
        swap.FSTAB.write_text('/swapfile none swap sw,noauto 0 0\n')
        with patch.object(swap, 'run') as run, patch.object(swap.shutil, 'which', side_effect=lambda name: '/sbin/rc-update' if name == 'rc-update' else None):
            swap.persist(['/swapfile'])
        self.assertNotIn('noauto', swap.FSTAB.read_text())
        self.assertEqual(swap.FSTAB.read_text().count('/swapfile'), 1)
        run.assert_called_once_with('rc-update', 'add', 'swap', 'boot')

    def test_zram_does_not_replace_disk_swap_and_paths_roundtrip(self):
        swap.SWAPS.write_text('Filename Type Size Used Priority\n/dev/zram0 partition 2097148 0 100\n')
        self.assertEqual(swap.swaps(), [])
        path = '/some path/with\\slash'
        self.assertEqual(swap.unescape(swap.escape(path)), path)

    def test_existing_symlink_is_never_followed(self):
        swap.SWAPS.write_text('Filename Type Size Used Priority\n')
        swap.SWAP_DIRECTORY.mkdir()
        target = swap.SWAP_DIRECTORY / 'swapfile'
        if sys.platform == 'win32':
            original = Path.is_symlink
            p = patch.object(Path, 'is_symlink', lambda path: path == target or original(path))
            p.start(); self.addCleanup(p.stop)
        else:
            target.symlink_to(self.root / 'unrelated')
        with patch.object(swap.os, 'geteuid', return_value=0):
            with self.assertRaisesRegex(RuntimeError, 'symlink'):
                swap.ensure_swap()

    def test_inactive_managed_swap_is_reused_without_formatting(self):
        swap.SWAPS.write_text('Filename Type Size Used Priority\n')
        swap.SWAP_DIRECTORY.mkdir()
        target = swap.SWAP_DIRECTORY / 'swapfile'
        target.write_bytes(b'fixture')
        original_stat = Path.stat
        def metadata(path, *args, **kwargs):
            value = original_stat(path, *args, **kwargs)
            if path == target:
                fields = list(value); fields[0] = 0o100600; fields[3] = 1; fields[4] = 0; fields[6] = swap.SIZE
                return os.stat_result(fields)
            return value
        def command(*args):
            if args[0] == 'blkid': return 'swap'
            if args[0] == 'swapon':
                swap.SWAPS.write_text(f'Filename Type Size Used Priority\n{swap.escape(str(target))} file 1048572 0 -2\n')
                return ''
            self.fail('unexpected command: ' + args[0])
        with patch.object(swap.os, 'geteuid', return_value=0), patch.object(Path, 'stat', metadata), patch.object(swap, 'run', side_effect=command) as run, patch.object(swap.shutil, 'which', return_value=None), contextlib.redirect_stdout(io.StringIO()):
            swap.ensure_swap()
        self.assertEqual([call.args[0] for call in run.call_args_list], ['blkid', 'swapon'])
        self.assertEqual(target.read_bytes(), b'fixture')

    def test_untrusted_directory_metadata_is_rejected(self):
        from unittest.mock import Mock
        path = Mock(); path.parent = path
        for mode, uid in [(0o120777, 0), (0o040777, 0), (0o040755, 1000)]:
            path.lstat.return_value = types.SimpleNamespace(st_mode=mode, st_uid=uid)
            with self.assertRaisesRegex(RuntimeError, 'unsafe swap directory'):
                self.trusted_directory(path)

    def test_active_swap_lock_never_blocks_forever(self):
        with patch.object(swap.fcntl, 'flock', side_effect=BlockingIOError):
            with self.assertRaises(BlockingIOError):
                swap.ensure_swap()

    def test_previous_root_owned_lock_is_restricted_in_place(self):
        swap.LOCK_FILE.write_text('old-lock')
        original_fstat = swap.os.fstat
        def old_mode(fd):
            fields = list(original_fstat(fd)); fields[0] = 0o100644; fields[3] = 1; fields[4] = 0
            return os.stat_result(fields)
        with patch.object(swap.os, 'fstat', side_effect=old_mode), patch.object(swap.os, 'fchmod') as chmod, patch.object(swap, 'run'), patch.object(swap.shutil, 'which', return_value=None), contextlib.redirect_stdout(io.StringIO()):
            swap.ensure_swap()
        self.assertTrue(any(call.args[1] == 0o600 for call in chmod.call_args_list))
        self.assertEqual(swap.LOCK_FILE.read_text(), 'old-lock')

    def test_command_timeout_is_bounded_and_propagated(self):
        with patch.object(swap.subprocess, 'run', side_effect=swap.subprocess.TimeoutExpired('swapon', 120)) as run:
            with self.assertRaises(swap.subprocess.TimeoutExpired):
                swap.run('swapon', '/fixture')
            self.assertEqual(run.call_args.kwargs['timeout'], 120)


if __name__ == '__main__':
    unittest.main()
