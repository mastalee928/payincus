#!/usr/bin/env python3
"""Resolve the host's own ipinfo timezone; fixed URL, validated zone, no shell."""
import ipaddress
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import tempfile
import time
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path('/var/lib/incudal/timezone')
ZONES = Path('/usr/share/zoneinfo')
LOCALTIME = Path('/etc/localtime')
TIMEZONE = Path('/etc/timezone')
HELPER = Path('/usr/local/libexec/incudal-host-timezone.py')


def trusted_directory(path, create=False):
    # Check parents as well: rejecting only the final symlink still follows
    # a redirected /var/lib/incudal or /usr/local/libexec parent.
    if path.parent != path:
        trusted_directory(path.parent, create)
    if create and not path.exists():
        path.mkdir(mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o022:
        raise ValueError('unsafe directory')


def regular_destination(path):
    trusted_directory(path.parent)
    if path.is_symlink() or path.exists() and not path.is_file():
        raise ValueError('configuration conflict')


def atomic(path, data, mode=0o644):
    regular_destination(path)
    fd, name = tempfile.mkstemp(prefix='.incudal-time-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def zone_from_response(value):
    if not isinstance(value, dict):
        raise ValueError('invalid response')
    ipaddress.ip_address(value['ip'])
    zone = value['timezone']
    if not isinstance(zone, str) or len(zone) > 100 or not re.fullmatch(r'[A-Za-z0-9_+-]+(?:/[A-Za-z0-9_+-]+)*', zone):
        raise ValueError('invalid timezone')
    target = (ZONES / zone).resolve()
    if not target.is_relative_to(ZONES.resolve()) or not target.is_file():
        raise ValueError('invalid zone file')
    ZoneInfo(zone)
    return zone, target


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('redirect not allowed')


def fetch():
    # Never send platform credentials, tokens, node IDs or customer data.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request('https://ipinfo.io/json', headers={'Accept': 'application/json', 'User-Agent': 'PayIncus-Timezone/1'})
    with opener.open(request, timeout=12) as response:
        if response.status != 200:
            raise ValueError('lookup failed')
        body = response.read(16385)
    if len(body) > 16384:
        raise ValueError('response too large')
    return zone_from_response(json.loads(body))


def configure():
    if os.geteuid() != 0:
        raise ValueError('invalid state directory')
    trusted_directory(ROOT, create=True)
    # A successful location lookup lasts one day; transient failures are
    # retried by the timer, without delaying secure host enrollment.
    receipt = ROOT / 'receipt.json'
    regular_destination(receipt)
    regular_destination(TIMEZONE)
    trusted_directory(LOCALTIME.parent)
    if LOCALTIME.exists() and not LOCALTIME.is_symlink() and not LOCALTIME.is_file():
        raise ValueError('localtime conflict')
    try:
        saved = json.loads(receipt.read_text())
        if 0 <= time.time() - saved['checkedAt'] < 86400 and TIMEZONE.read_text().strip() == saved['timezone'] and LOCALTIME.resolve() == (ZONES / saved['timezone']).resolve():
            print('INCUDAL_TIMEZONE:cached')
            return
    except (OSError, ValueError, KeyError, TypeError):
        pass
    try:
        # urllib's socket timeout alone is not a total deadline. Bound cron
        # executions too, including a peer sending one byte at a time.
        def deadline(*_):
            raise TimeoutError('timezone deadline')
        signal.signal(signal.SIGALRM, deadline)
        signal.alarm(25)
        zone, target = fetch()
    except (OSError, ValueError, KeyError, TypeError):
        # Lookup errors alone are non-blocking. A local permissions/config
        # failure below must be reported, not disguised as an IP lookup retry.
        print('INCUDAL_TIMEZONE:retry-scheduled')
        return
    finally:
        signal.alarm(0)
    # /etc/localtime normally is a symlink. Replace the link atomically; do
    # not follow it and overwrite the distribution's zoneinfo source.
    fd, temporary = tempfile.mkstemp(prefix='.incudal-localtime-', dir=LOCALTIME.parent)
    os.close(fd)
    try:
        os.unlink(temporary)
        os.symlink(str(target), temporary)
        os.replace(temporary, LOCALTIME)
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)
    atomic(TIMEZONE, (zone + '\n').encode())
    atomic(receipt, json.dumps({'timezone': zone, 'checkedAt': int(time.time())}).encode(), 0o600)
    print('INCUDAL_TIMEZONE:' + zone)


def install_timer():
    if Path('/run/systemd/system').is_dir():
        atomic(Path('/etc/systemd/system/incudal-host-timezone.service'), b'[Unit]\nDescription=Refresh host local timezone\nAfter=network-online.target\n[Service]\nType=oneshot\nExecStart=/usr/bin/python3 /usr/local/libexec/incudal-host-timezone.py\nTimeoutStartSec=30\nNoNewPrivileges=true\nPrivateTmp=true\n')
        atomic(Path('/etc/systemd/system/incudal-host-timezone.timer'), b'[Unit]\nDescription=Retry host timezone lookup\n[Timer]\nOnBootSec=5min\nOnUnitActiveSec=1h\nRandomizedDelaySec=5min\n[Install]\nWantedBy=timers.target\n')
        subprocess.run(['systemctl', 'daemon-reload'], check=True, timeout=15)
        subprocess.run(['systemctl', 'enable', '--now', 'incudal-host-timezone.timer'], check=True, timeout=15, stdout=subprocess.DEVNULL)
    else:
        trusted_directory(Path('/etc/periodic/hourly'), create=True)
        atomic(Path('/etc/periodic/hourly/incudal-host-timezone'), b'#!/bin/sh\nexec /usr/bin/python3 /usr/local/libexec/incudal-host-timezone.py\n', 0o700)
        subprocess.run(['rc-update', 'add', 'crond', 'default'], check=True, timeout=15, stdout=subprocess.DEVNULL)
        if subprocess.run(['rc-service', 'crond', 'status'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15).returncode:
            subprocess.run(['rc-service', 'crond', 'start'], check=True, timeout=15, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    import sys
    try:
        if os.geteuid() != 0:
            raise ValueError('root required')
        # Root-only lock outside the writable state protects overlapping
        # enrollment and timer invocations. Never leave a permanent daemon.
        flags = os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW
        lock = os.open('/run/incudal-host-timezone.lock', flags, 0o600)
        lock_info = os.fstat(lock)
        if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_uid != 0 or stat.S_IMODE(lock_info.st_mode) & 0o077:
            raise ValueError('unsafe lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if '--install' in sys.argv:
            install_timer()
        configure()
    except ValueError:
        print('INCUDAL_ERROR:HOST_BOOTSTRAP_CONFLICT')
        raise SystemExit(1)
    except Exception:
        print('INCUDAL_ERROR:HOST_TIME_SYNC_PENDING')
        raise SystemExit(1)
