#!/usr/bin/env python3
"""Exercise the shipped recovery lock admission against real Linux flock."""
import fcntl
import pathlib
import select
import subprocess
import tempfile

source = pathlib.Path(__file__).resolve().parents[1].joinpath('deploy/incudal-online-task.sh.example').read_text()
block = source.split('  platform-backup)\n', 1)[1].split('    app_dir=', 1)[0]
block = block[block.index('    exec 9>'):]
assert block.count('/var/lib/incudal-platform-operation.lock') == 1
assert 'flock -w 30 -E 75 9' in block
assert block.index('flock -w') < block.index('verify_manifest')
block = block.replace('/var/lib/incudal-platform-operation.lock', '"$1"')
body = 'set -euo pipefail\nfail(){ exit 75; }\nverify_manifest(){ echo admitted; }\necho waiting\n' + block

with tempfile.TemporaryDirectory(prefix='payincus-recovery-lock-') as directory:
    lock = pathlib.Path(directory, 'maintenance.lock')
    with lock.open('w') as held:
        fcntl.flock(held, fcntl.LOCK_EX)
        # The old nonblocking admission fails before verification while the
        # previous worker still owns its successful operation's lock.
        before = body.replace('flock -w 30 -E 75 9', 'flock -n 9')
        old = subprocess.run(['bash', '-c', before, '--', str(lock)], capture_output=True, text=True, timeout=3)
        assert old.returncode == 75 and old.stdout == 'waiting\n'
        child = subprocess.Popen(['bash', '-c', body, '--', str(lock)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            assert child.stdout.readline() == 'waiting\n'
            assert not select.select([child.stdout], [], [], 0.15)[0]
            assert child.poll() is None, 'successor must wait while the original worker owns the lock'
            fcntl.flock(held, fcntl.LOCK_UN)
            out, err = child.communicate(timeout=3)
            assert child.returncode == 0 and out == 'admitted\n' and not err
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()
        fcntl.flock(held, fcntl.LOCK_EX)
        # Exercise timeout without consuming 30 seconds; the production bound
        # above is checked exactly and only the test's duration is shortened.
        timed = subprocess.run(['bash', '-c', body.replace('flock -w 30 -E 75 9', 'flock -w 0.1 -E 75 9'), '--', str(lock)], capture_output=True, text=True, timeout=3)
        assert timed.returncode == 75 and timed.stdout == 'waiting\n'
        fcntl.flock(held, fcntl.LOCK_UN)
    free = subprocess.run(['bash', '-c', body, '--', str(lock)], capture_output=True, text=True, timeout=3)
    assert free.returncode == 0 and free.stdout == 'waiting\nadmitted\n'
print('PASS native recovery lock handoff: old admission fails, successor waits for release, one admission, bounded timeout refuses overlapping maintenance')
