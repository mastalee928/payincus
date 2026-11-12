#!/usr/bin/env python3
# payincus-time-sync-v1
"""Root-only persistent clock maintenance. Never steps a running system clock.

An existing active daemon is reused. Otherwise a dedicated chrony service uses
an explicit slew-only configuration; package installation cannot auto-start a
distribution default daemon with makestep enabled. No application inputs.
"""
import fcntl
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import shutil
import pwd
import signal
import stat
import subprocess
import sys
import tempfile
import time

ROOT = Path('/var/lib/incudal-time-sync')
HELPER = Path('/usr/local/libexec/incudal/ensure-time-sync.py')
CONFIG = Path('/etc/chrony/incudal-clock.conf')
POLICY = Path('/usr/sbin/policy-rc.d')
MARK = '# payincus-time-sync-v1'


def trusted(path, directory=False):
    for p in [path, *path.parents]:
        s = p.lstat()
        if s.st_uid != 0 or stat.S_ISLNK(s.st_mode) or s.st_mode & 0o022:
            raise ValueError('TIME_SYNC_UNTRUSTED_PATH')
    if directory and not path.is_dir() or not directory and not path.is_file():
        raise ValueError('TIME_SYNC_UNTRUSTED_PATH')
    if not directory and (path.stat().st_nlink != 1 or path.stat().st_size > 262144):
        raise ValueError('TIME_SYNC_UNTRUSTED_PATH')


def directory(path):
    if not path.exists():
        directory(path.parent)
        path.mkdir(mode=0o755)
    trusted(path, True)


def daemon_directory(path, user):
    # The packaged chrony data directory may belong to chrony. Its parent
    # must still be root-owned; no symlink or writable-by-others path is used.
    trusted(path.parent.parent, True)
    if not path.parent.exists(): path.parent.mkdir(mode=0o755)
    parent=path.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid not in [0,user.pw_uid] or parent.st_mode&0o022:
        raise ValueError('TIME_SYNC_UNTRUSTED_PATH')
    parent_fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        try:os.mkdir(path.name,0o750,dir_fd=parent_fd)
        except FileExistsError:pass
        # The parent may be daemon-owned. Use a no-follow descriptor for the
        # leaf so a daemon cannot swap in a symlink before root chowns it.
        fd=os.open(path.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent_fd)
        try:
            info=os.fstat(fd)
            if info.st_uid not in [0,user.pw_uid] or info.st_mode&0o022:
                raise ValueError('TIME_SYNC_UNTRUSTED_PATH')
            if info.st_uid==0: os.fchown(fd,user.pw_uid,user.pw_gid)
        finally:os.close(fd)
    finally:os.close(parent_fd)


def runtime_directory(user):
    trusted(Path('/run'), True)
    path=Path('/run/chrony')
    if not path.exists(): path.mkdir(mode=0o750)
    info=path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid not in [0,user.pw_uid] or info.st_mode&0o022:
        raise ValueError('TIME_SYNC_UNTRUSTED_PATH')
    # Some packages/tmpfiles create the empty runtime as root. Adjust only
    # this checked directory, never recursively chown daemon-controlled data.
    os.chown(path,user.pw_uid,user.pw_gid)
    os.chmod(path,0o750)


def write(path, data, mode=0o644, managed=False):
    directory(path.parent)
    if path.exists() or path.is_symlink():
        trusted(path)
        old = path.read_bytes()
        if managed and MARK.encode() not in old.splitlines():
            raise ValueError('TIME_SYNC_CONFIGURATION_CONFLICT')
        if old == data and stat.S_IMODE(path.stat().st_mode) == mode:
            return False
    fd, name = tempfile.mkstemp(prefix='.clock-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            os.fchmod(f.fileno(), mode)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
        parent_fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(parent_fd)
        finally:os.close(parent_fd)
    finally:
        if os.path.exists(name): os.unlink(name)
    return True


def command(args, timeout=12, check=True):
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True,
                         env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL':'C', 'DEBIAN_FRONTEND':'noninteractive'})
    try: out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        p.communicate()
        raise
    r = subprocess.CompletedProcess(args,p.returncode,out,err)
    if check and r.returncode:
        raise ValueError('TIME_SYNC_COMMAND_PENDING')
    return r


def manager():
    if Path('/run/systemd/system').is_dir(): return 'systemd'
    if Path('/sbin/openrc').exists(): return 'openrc'
    raise ValueError('TIME_SYNC_INIT_UNSUPPORTED')


def services(init):
    names = ['incudal-clock','chrony','chronyd','ntpsec','ntp','systemd-timesyncd'] if init == 'systemd' else ['incudal-clock','chronyd','ntpd']
    if init != 'systemd': return names
    # ntp/ntpsec and chrony/chronyd may be aliases for the same unit.
    units = []
    for name in names:
        r = command(['systemctl','show',name,'--property=Id,LoadState'], check=False)
        fields=dict(line.split('=',1) for line in r.stdout.splitlines() if '=' in line)
        unit = fields.get('Id','').removesuffix('.service')
        if fields.get('LoadState')=='not-found': continue
        if r.returncode or fields.get('LoadState') not in ['loaded','masked'] or unit not in names:
            raise ValueError('TIME_SYNC_SERVICE_QUERY_PENDING')
        if unit not in units: units.append(unit)
    return units


def active(init, service):
    if init == 'systemd':
        r=command(['systemctl','show',service,'--property=LoadState,ActiveState'],check=False)
        fields=dict(line.split('=',1) for line in r.stdout.splitlines() if '=' in line)
        if fields.get('LoadState')=='not-found': return False
        if r.returncode or fields.get('LoadState') not in ['loaded','masked']:
            raise ValueError('TIME_SYNC_SERVICE_QUERY_PENDING')
        state=fields.get('ActiveState')
        if state=='active': return True
        if state in ['inactive','failed']: return False
        raise ValueError('TIME_SYNC_SERVICE_BUSY')
    if not Path('/etc/init.d',service).exists(): return False
    # OpenRC rebuilds/loads dependency state even for status. Slow hosts can
    # exceed the ordinary 12s probe budget; this bounded check never starts it.
    r=command(['rc-service',service,'status'],timeout=30,check=False)
    if r.returncode==0: return True
    if r.returncode==3 and 'status: stopped' in r.stdout: return False
    if service=='incudal-clock' and any('status: '+state in r.stdout for state in ['starting','stopping','crashed']):
        openrc_start_ready()
        return False
    if 'status: crashed' in r.stdout:
        no_clock_processes()
        return False
    raise ValueError('TIME_SYNC_SERVICE_QUERY_PENDING')


def enable(init, service):
    command(['systemctl','enable',service] if init == 'systemd' else ['rc-update','add',service,'default'])


def enable_managed(init):
    enable(init,'incudal-clock')
    for service in (['chrony','chronyd','ntpsec','ntp','systemd-timesyncd'] if init=='systemd' else ['chronyd','ntpd']):
        command(['systemctl','disable',service] if init=='systemd' else ['rc-update','del',service],check=False)


def no_clock_processes():
    for path in Path('/proc').iterdir():
        if not path.name.isdigit(): continue
        try:
            args=(path/'cmdline').read_bytes().split(b'\0')
        except FileNotFoundError: continue
        if any(os.path.basename(os.fsdecode(arg)) in ['chronyd','ntpd','systemd-timesyncd'] or
               arg in [b'/etc/init.d/incudal-clock',b'incudal-clock'] for arg in args if arg):
            raise ValueError('TIME_SYNC_SERVICE_BUSY')


def openrc_start_ready():
    # A killed OpenRC invocation may leave its starting marker. Only our own
    # service can be reset, and only after no daemon/supervisor/start process
    # exists. Never delete an OpenRC lock or zap another clock service.
    own=Path('/etc/init.d/incudal-clock')
    trusted(own)
    if MARK not in own.read_text().splitlines(): raise ValueError('TIME_SYNC_CONFIGURATION_CONFLICT')
    no_clock_processes()
    if any(Path('/run/openrc',state,'incudal-clock').is_symlink() for state in ['starting','stopping','started']):
        command(['rc-service','incudal-clock','zap'])


def synchronized(init, service):
    if service in ['incudal-clock','chrony','chronyd']:
        args=['chronyc','tracking']
        r=command(args, check=False)
        fields = dict(line.strip().split(':',1) for line in r.stdout.splitlines() if ':' in line)
        fields = {key.strip(): value.strip() for key,value in fields.items()}
        try:
            offset = float(fields['System time'].split()[0])
            reference = datetime.strptime(fields['Ref time (UTC)'], '%a %b %d %H:%M:%S %Y').replace(tzinfo=timezone.utc).timestamp()
            return r.returncode == 0 and fields.get('Leap status') == 'Normal' and math.isfinite(offset) and abs(offset) <= 1 and -60 <= time.time()-reference <= 3600
        except (KeyError,ValueError,IndexError): return False
    if init == 'systemd':
        r=command(['timedatectl','show','--property=NTPSynchronized','--value'], check=False)
        return r.returncode==0 and r.stdout.strip() == 'yes'
    return False


def clear_own_package_policy():
    # A killed/rebooted package transaction can leave our own policy behind.
    # Always clean exactly that file, even if chronyd was already unpacked.
    own_policy = '#!/bin/sh\n'+MARK+'\nexit 101\n'
    if POLICY.exists() or POLICY.is_symlink():
        trusted(POLICY)
        if POLICY.read_text() == own_policy: POLICY.unlink()


def install_chrony(init):
    clear_own_package_policy()
    own_policy = '#!/bin/sh\n'+MARK+'\nexit 101\n'
    binary = shutil.which('chronyd')
    package_state = ''
    if init == 'systemd' and binary:
        package_state = command(['dpkg-query','-W','-f=${db:Status-Status}','chrony'],check=False).stdout.strip()
    if binary and (init != 'systemd' or package_state == 'installed'): return
    if init == 'systemd':
        # Respect an existing package policy; never replace an administrator's
        # script. Retry visibly if its safety cannot be established.
        if POLICY.exists() or POLICY.is_symlink():
            trusted(POLICY)
            if POLICY.read_text() != own_policy:
                raise ValueError('TIME_SYNC_PACKAGE_POLICY_CONFLICT')
        write(POLICY, own_policy.encode(), 0o755)
        try:
            # policy-rc.d blocks immediate start, not enable-at-boot. Mask the
            # distro daemon before unpacking so a crash/reboot midway cannot
            # start its default makestep policy. The managed unit is separate.
            command(['systemctl','mask','chrony.service'])
            if binary and package_state in ['unpacked','half-configured','triggers-awaited','triggers-pending']:
                command(['dpkg','--configure','chrony'],timeout=90)
                return
            command(['apt-get','-o','DPkg::Lock::Timeout=10','-o','Acquire::Retries=1','-o','Acquire::http::Timeout=15','-o','Acquire::https::Timeout=15','update','-qq'], timeout=60)
            command(['apt-get','-o','DPkg::Lock::Timeout=10','-y','--no-install-recommends','install','chrony'], timeout=90)
        finally:
            # Remove only the exact policy created by this helper.
            trusted(POLICY)
            if POLICY.read_text() == own_policy: POLICY.unlink()
    else:
        command(['apk','add','--no-cache','chrony'], timeout=90)


def managed_clock(init):
    install_chrony(init)
    binary = shutil.which('chronyd')
    if binary not in ['/usr/sbin/chronyd','/sbin/chronyd']: raise ValueError('TIME_SYNC_BINARY_UNAVAILABLE')
    # Dedicated configuration omits makestep/initstepslew: existing billing,
    # leases and authentication timestamps must not jump when upgrading.
    user=pwd.getpwnam('_chrony' if init=='systemd' else 'chrony')
    # Standard chrony data/config paths also work with Debian's packaged
    # AppArmor policy. Only daemon data lives below the daemon-owned directory.
    drift=Path('/var/lib/chrony/incudal-clock')
    daemon_directory(drift,user)
    # This owned leaf is daemon data, never used as a trusted executable path.
    conf=(MARK+'\npool pool.ntp.org iburst maxsources 4\n'
          'driftfile /var/lib/chrony/incudal-clock/chrony.drift\n'
          'rtcsync\nmaxslewrate 10000\ncmdport 0\n').encode()
    write(CONFIG, conf, managed=True)
    if init == 'systemd':
        unit=(MARK+'\n[Unit]\nDescription=PayIncus continuous clock synchronization\nWants=network-online.target\nAfter=network-online.target\n'
              '[Service]\nType=simple\nRuntimeDirectory=chrony\nRuntimeDirectoryMode=0750\n'
              'ExecStartPre=/usr/bin/install -d -m 0750 -o _chrony -g _chrony /run/chrony\n'
              'ExecStart='+binary+' -d -f '+str(CONFIG)+'\nRestart=on-failure\nRestartSec=10\n'
              '[Install]\nWantedBy=multi-user.target\n').encode()
        changed=write(Path('/etc/systemd/system/incudal-clock.service'),unit,managed=True)
        if changed: command(['systemctl','daemon-reload'])
    else:
        unit=('#!/sbin/openrc-run\n'+MARK+'\ncommand="'+binary+'"\ncommand_args="-d -f '+str(CONFIG)+'"\n'
              'supervisor="supervise-daemon"\nrespawn_delay=10\nrespawn_max=0\n'
              'output_log="/dev/null"\nerror_log="/dev/null"\n'
              'start_pre() { checkpath --directory --mode 0750 --owner chrony:chrony /run/chrony; }\n'
              'depend() { after net; }\n').encode()
        write(Path('/etc/init.d/incudal-clock'),unit,0o755,managed=True)
    if not active(init,'incudal-clock'):
        # Recheck immediately before starting; another service may have started
        # while the package manager was running. Never compete for the clock.
        if any(active(init,s) for s in services(init) if s != 'incudal-clock'):
            raise ValueError('TIME_SYNC_SERVICE_CHANGED')
        runtime_directory(user)
        if init=='openrc':openrc_start_ready()
        else:no_clock_processes()
        # Service startup may rebuild OpenRC dependencies. It needs a separate
        # bounded budget from a read-only status probe; chrony tolerates an
        # initially offline network and must not start network reconfiguration.
        command(['systemctl','start','incudal-clock'] if init == 'systemd' else ['rc-service','incudal-clock','start'],timeout=60)
    if not active(init,'incudal-clock'): raise ValueError('TIME_SYNC_START_PENDING')
    enable_managed(init)
    return 'incudal-clock'


def reconcile(init):
    # Cleanup must run even when an active service bypasses package setup.
    if init=='systemd':clear_own_package_policy()
    running=[s for s in services(init) if active(init,s)]
    if len(running)>1: raise ValueError('TIME_SYNC_MULTIPLE_SERVICES')
    if running:
        service=running[0]
        # Finish boot configuration even if the preceding run crashed after
        # starting the managed daemon but before disabling alternative units.
        if service=='incudal-clock':enable_managed(init)
        else:enable(init,service)
    else:
        # A manually started daemon has no service entry. Detect it before
        # package or runtime changes as well as immediately before startup.
        no_clock_processes()
        service=managed_clock(init)
    synced=synchronized(init,service)
    return {'service':service,'synchronized':synced,'state':'synchronized' if synced else 'synchronizing'}


def install(init):
    source=Path(__file__).absolute()
    trusted(source)
    write(HELPER, source.read_bytes(), 0o755, managed=HELPER.exists())
    if init == 'systemd':
        service=(MARK+'\n[Unit]\nDescription=Maintain PayIncus clock service\nAfter=network-online.target\n'
                 '[Service]\nType=oneshot\nExecStart=/usr/bin/python3 '+str(HELPER)+'\nTimeoutStartSec=4min\n').encode()
        timer=(MARK+'\n[Unit]\nDescription=Check PayIncus clock service\n[Timer]\nOnBootSec=30s\nOnUnitInactiveSec=2min\nRandomizedDelaySec=10s\n'
               '[Install]\nWantedBy=timers.target\n').encode()
        changed=write(Path('/etc/systemd/system/incudal-time-sync.service'),service,managed=True)
        changed=write(Path('/etc/systemd/system/incudal-time-sync.timer'),timer,managed=True) or changed
        if changed: command(['systemctl','daemon-reload'])
        command(['systemctl','enable','--now','incudal-time-sync.timer'])
        # Do not hold OTA/startup open for package mirrors or NTP reachability.
        command(['systemctl','start','--no-block','incudal-time-sync.service'])
    else:
        write(Path('/etc/periodic/15min/incudal-time-sync'),('#!/bin/sh\n'+MARK+'\nexec /usr/bin/python3 '+str(HELPER)+'\n').encode(),0o755,managed=True)
        command(['rc-update','add','crond','default'])
        if not active(init,'crond'): command(['rc-service','crond','start'])
        # The gateway installer also has a bounded caller timeout. Persistent
        # cron is already installed before the first asynchronous attempt.
        subprocess.Popen(['/usr/bin/python3',str(HELPER)],start_new_session=True,
                         stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                         env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'})
    return {'state':'scheduled'}


def main():
    if os.geteuid()!=0 or sys.argv[1:] not in [[],['--install'],['--status']]:
        raise ValueError('TIME_SYNC_ARGUMENT_INVALID')
    if sys.argv[1:]==['--status']:
        p=ROOT/'status.json';trusted(p);print(p.read_text());return
    directory(ROOT)
    directory(Path('/run'))
    installing=sys.argv[1:]==['--install']
    # Scheduler installation must not be silently skipped while an older
    # reconciliation holds its lock during a package download.
    lock='/run/incudal-time-sync-install.lock' if installing else '/run/incudal-time-sync.lock'
    fd=os.open(lock,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        s=os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_nlink!=1 or s.st_mode&0o077: raise ValueError('TIME_SYNC_LOCK_INVALID')
        try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            if installing: raise ValueError('TIME_SYNC_INSTALL_BUSY')
            return 0
        try:
            init=manager()
            result=install(init) if installing else reconcile(init)
        except (ValueError,KeyError,subprocess.SubprocessError,OSError) as e:
            code=str(e) if isinstance(e,ValueError) and str(e).startswith('TIME_SYNC_') else 'TIME_SYNC_RETRY_PENDING'
            result={'state':'installation-failed' if installing else 'pending','synchronized':False,'error':code}
        result['checkedAt']=time.time()
        # An asynchronous reinstall must not replace a useful previous result.
        if result['state']!='scheduled': write(ROOT/'status.json',json.dumps(result,separators=(',',':')).encode())
        print(json.dumps(result))
        return 1 if result['state']=='installation-failed' else 0
    finally:os.close(fd)


if __name__=='__main__': sys.exit(main())
