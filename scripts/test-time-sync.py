"""Portable clock-maintenance fault tests; service commands are isolated fakes."""
import importlib.util
import contextlib
import io
from datetime import datetime, timezone
import json
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

if sys.platform == 'win32':
    sys.modules['fcntl'] = types.SimpleNamespace()
    sys.modules['pwd'] = types.SimpleNamespace()
spec = importlib.util.spec_from_file_location('clock_helper', Path(__file__).with_name('ensure-time-sync.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ClockTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix='incudal-clock-test-')
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.calls = []
        self.files = {}

    def result(self, args, code=0, out=''):
        return subprocess.CompletedProcess(args, code, out, '')

    def test_aliases_are_one_daemon(self):
        def command(args, **kwargs):
            name = args[2]
            return self.result(args, out='Id='+({'chronyd':'chrony','ntp':'ntpsec'}.get(name,name))+'.service\nLoadState=loaded\n')
        with patch.object(m,'command',side_effect=command):
            self.assertEqual(m.services('systemd'), ['incudal-clock','chrony','ntpsec','systemd-timesyncd'])

    def test_existing_service_reused_without_restart_or_package_install(self):
        for service in ['chrony','ntpsec','systemd-timesyncd']:
            with patch.object(m,'services',return_value=[service]), patch.object(m,'active',return_value=True), \
                 patch.object(m,'enable') as enable, patch.object(m,'synchronized',return_value=True), patch.object(m,'managed_clock') as managed:
                self.assertEqual(m.reconcile('systemd')['state'],'synchronized')
                enable.assert_called_once_with('systemd',service)
                managed.assert_not_called()

    def test_absent_openrc_service_needs_no_process(self):
        with patch.object(m,'Path') as path,patch.object(m,'command') as command:
            path.return_value.exists.return_value=False
            self.assertFalse(m.active('openrc','ntpd'))
            command.assert_not_called()

    def test_service_query_errors_and_transitions_cannot_mean_stopped(self):
        for output in ['LoadState=loaded\nActiveState=activating\n', 'LoadState=loaded\nActiveState=deactivating\n', '']:
            with self.subTest(output=output), patch.object(m,'command',return_value=self.result([],out=output)):
                with self.assertRaisesRegex(ValueError,'TIME_SYNC_'): m.active('systemd','chrony')
        with patch.object(m,'command',return_value=self.result([],code=1)):
            with self.assertRaisesRegex(ValueError,'TIME_SYNC_'): m.services('systemd')
        with patch.object(m,'Path') as path,patch.object(m,'command',return_value=self.result([],code=8,out=' * status: starting\n')):
            path.return_value.exists.return_value=True
            with self.assertRaisesRegex(ValueError,'TIME_SYNC_'): m.active('openrc','chronyd')

    def test_active_service_still_cleans_own_interrupted_package_policy(self):
        policy=self.root/'policy-rc.d';policy.write_text('#!/bin/sh\n'+m.MARK+'\nexit 101\n')
        with patch.object(m,'POLICY',policy),patch.object(m,'trusted'),patch.object(m,'services',return_value=['incudal-clock']), \
             patch.object(m,'active',return_value=True),patch.object(m,'enable_managed'),patch.object(m,'synchronized',return_value=True):
            self.assertEqual(m.reconcile('systemd')['state'],'synchronized')
            self.assertFalse(policy.exists(),'active service must not strand a global package start blocker')

    def test_service_states_and_absent_units_are_classified(self):
        for load,state,expected in [('loaded','active',True),('loaded','inactive',False),('loaded','failed',False),('masked','inactive',False),('not-found','inactive',False)]:
            with self.subTest(load=load,state=state),patch.object(m,'command',return_value=self.result([],out=f'LoadState={load}\nActiveState={state}\n')):
                self.assertEqual(m.active('systemd','chrony'),expected)
        with patch.object(m,'command',return_value=self.result([],code=1,out='Id=chrony.service\nLoadState=not-found\n')):
            self.assertEqual(m.services('systemd'),[])
        with patch.object(m,'Path') as path,patch.object(m,'command',return_value=self.result([],code=3,out=' * status: stopped\n')) as command:
            path.return_value.exists.return_value=True
            self.assertFalse(m.active('openrc','chronyd'))
            self.assertEqual(command.call_args.kwargs['timeout'],30)

    def test_manual_daemon_prevents_package_changes(self):
        with patch.object(m,'services',return_value=[]),patch.object(m,'no_clock_processes',side_effect=ValueError('TIME_SYNC_SERVICE_BUSY')),patch.object(m,'managed_clock') as managed:
            with self.assertRaisesRegex(ValueError,'SERVICE_BUSY'):m.reconcile('openrc')
            managed.assert_not_called()

    def test_openrc_own_crashed_service_checks_processes_before_repair(self):
        with patch.object(m,'Path') as path,patch.object(m,'command',return_value=self.result([],code=32,out=' * status: crashed\n')),patch.object(m,'openrc_start_ready') as ready:
            path.return_value.exists.return_value=True
            self.assertFalse(m.active('openrc','incudal-clock'));ready.assert_called_once()
            ready.side_effect=ValueError('TIME_SYNC_SERVICE_BUSY')
            with self.assertRaisesRegex(ValueError,'SERVICE_BUSY'):m.active('openrc','incudal-clock')

    def test_openrc_crashed_external_clock_only_allows_replacement_when_gone(self):
        with patch.object(m,'Path') as path,patch.object(m,'command',return_value=self.result([],code=32,out=' * status: crashed\n')),patch.object(m,'no_clock_processes') as absent:
            path.return_value.exists.return_value=True
            self.assertFalse(m.active('openrc','chronyd'));absent.assert_called_once()
            absent.side_effect=ValueError('TIME_SYNC_SERVICE_BUSY')
            with self.assertRaisesRegex(ValueError,'SERVICE_BUSY'):m.active('openrc','chronyd')

    def test_failed_synchronization_query_does_not_report_success(self):
        with patch.object(m,'command',return_value=self.result([],code=1,out='yes\n')):
            self.assertFalse(m.synchronized('systemd','systemd-timesyncd'))

    def test_multiple_daemons_do_not_trigger_blind_changes(self):
        with patch.object(m,'services',return_value=['chrony','ntpsec']), patch.object(m,'active',return_value=True), patch.object(m,'enable') as enable:
            with self.assertRaisesRegex(ValueError,'MULTIPLE_SERVICES'): m.reconcile('systemd')
            enable.assert_not_called()

    def test_started_managed_service_finishes_boot_setup_after_interruption(self):
        with patch.object(m,'services',return_value=['incudal-clock']),patch.object(m,'active',return_value=True), \
             patch.object(m,'enable_managed') as enable,patch.object(m,'synchronized',return_value=True),patch.object(m,'managed_clock') as managed:
            self.assertEqual(m.reconcile('openrc')['state'],'synchronized')
            enable.assert_called_once_with('openrc');managed.assert_not_called()

    def test_offset_must_be_small_and_tracking_valid(self):
        for offset, leap, expected in [('0.001','Normal',True),('14','Normal',False),('nan','Normal',False),('0','Not synchronised',False)]:
            reference=datetime.now(timezone.utc).strftime('%a %b %d %H:%M:%S %Y')
            output=f'System time     : {offset} seconds slow of NTP time\nLeap status     : {leap}\nRef time (UTC) : {reference}\n'
            with patch.object(m,'command',return_value=self.result([],out=output)) as command:
                self.assertEqual(m.synchronized('systemd','incudal-clock'),expected)
                self.assertEqual(command.call_args.args[0],['chronyc','tracking'])

    def test_unsynced_service_stays_running_and_visible(self):
        with patch.object(m,'services',return_value=['chrony']), patch.object(m,'active',return_value=True), \
             patch.object(m,'enable'), patch.object(m,'synchronized',return_value=False):
            self.assertEqual(m.reconcile('systemd'),{'service':'chrony','synchronized':False,'state':'synchronizing'})

    def test_package_failure_removes_only_own_policy(self):
        policy=self.root/'policy-rc.d'
        def write(path,data,*args,**kwargs): path.write_bytes(data)
        for failure in [ValueError('TIME_SYNC_COMMAND_PENDING'),subprocess.TimeoutExpired('apt',90)]:
            with patch.object(m,'POLICY',policy),patch.object(m.shutil,'which',return_value=None),patch.object(m,'trusted'), \
                 patch.object(m,'write',side_effect=write),patch.object(m,'command',side_effect=failure):
                with self.assertRaises(type(failure)): m.install_chrony('systemd')
                self.assertFalse(policy.exists())

    def test_administrator_policy_untouched(self):
        policy=self.root/'policy-rc.d';policy.write_text('# owner policy\n')
        with patch.object(m,'POLICY',policy),patch.object(m.shutil,'which',return_value=None),patch.object(m,'trusted'),patch.object(m,'command') as command:
            with self.assertRaisesRegex(ValueError,'POLICY_CONFLICT'): m.install_chrony('systemd')
            self.assertEqual(policy.read_text(encoding='utf-8'),'# owner policy\n');command.assert_not_called()

    def test_crash_policy_recovered_after_binary_unpacked(self):
        policy=self.root/'policy-rc.d';policy.write_text('#!/bin/sh\n'+m.MARK+'\nexit 101\n')
        with patch.object(m,'POLICY',policy),patch.object(m.shutil,'which',return_value='/usr/sbin/chronyd'),patch.object(m,'trusted'),patch.object(m,'command',return_value=self.result([],out='installed')) as command:
            m.install_chrony('systemd');self.assertFalse(policy.exists())
            self.assertEqual(len(command.call_args_list),1)

    def test_interrupted_package_configures_only_chrony_with_start_blocked(self):
        policy=self.root/'policy-rc.d'
        def command(args,**kwargs):
            if args[0]=='dpkg-query':return self.result(args,out='unpacked')
            if args==['systemctl','mask','chrony.service']:return self.result(args)
            self.assertEqual(args,['dpkg','--configure','chrony'])
            self.assertIn('exit 101',policy.read_text())
            return self.result(args)
        with patch.object(m,'POLICY',policy),patch.object(m.shutil,'which',return_value='/usr/sbin/chronyd'),patch.object(m,'trusted'), \
             patch.object(m,'write',side_effect=lambda p,data,*a,**kw:p.write_bytes(data)),patch.object(m,'command',side_effect=command):
            m.install_chrony('systemd');self.assertFalse(policy.exists())

    def test_untrusted_files_and_hardlinks_rejected(self):
        path=Mock(parents=[])
        path.is_file.return_value=True
        for mode,uid,links,size in [(stat.S_IFLNK|0o777,0,1,1),(stat.S_IFREG|0o666,0,1,1),(stat.S_IFREG|0o644,1000,1,1),(stat.S_IFREG|0o644,0,2,1),(stat.S_IFREG|0o644,0,1,300000)]:
            info=types.SimpleNamespace(st_mode=mode,st_uid=uid,st_nlink=links,st_size=size)
            path.lstat.return_value=info;path.stat.return_value=info
            with self.assertRaises(ValueError):m.trusted(path)

    def test_first_upgrade_only_schedules_background_work(self):
        def write(path,data,*args,**kwargs): self.files[str(path)]=data.decode();return True
        with patch.object(m,'trusted'),patch.object(m,'write',side_effect=write),patch.object(m,'command') as command,patch.object(m,'reconcile') as reconcile:
            self.assertEqual(m.install('systemd'),{'state':'scheduled'})
            reconcile.assert_not_called()
            commands=[c.args[0] for c in command.call_args_list]
            self.assertIn(['systemctl','start','--no-block','incudal-time-sync.service'],commands)
            self.assertIn('OnUnitInactiveSec=2min',self.files[str(Path('/etc/systemd/system/incudal-time-sync.timer'))])

    def test_slew_only_configuration_and_reboot_runtime(self):
        source=Path(m.__file__).read_text(encoding='utf-8')
        self.assertNotIn("'makestep",source)
        self.assertNotIn("'initstepslew",source)
        self.assertIn('maxslewrate 10000',source)
        self.assertIn('RuntimeDirectory=chrony',source)
        self.assertIn('start_pre() { checkpath',source)
        self.assertNotIn('timedatectl\',\'set-time',source)
        root=Path(__file__).parents[1]
        self.assertIn('ensure-time-sync.py" --install',(root/'scripts/install-platform-backup.sh').read_text(encoding='utf-8'))
        self.assertIn('ensure-time-sync.py release/scripts/',(root/'.github/workflows/release.yml').read_text(encoding='utf-8'))

    def test_standard_runtime_started_once_and_future_boot_enabled(self):
        for init in ['systemd','openrc']:
            commands=[]; running=False
            def command(args,**kwargs):
                nonlocal running
                commands.append(args)
                if args in [['systemctl','start','incudal-clock'],['rc-service','incudal-clock','start']]:running=True
                return self.result(args)
            def active(manager,name):return name=='incudal-clock' and running
            self.files={}
            with patch.object(m,'install_chrony'),patch.object(m.shutil,'which',return_value='/usr/sbin/chronyd'), \
                 patch.object(m.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=51,pw_gid=51),create=True), \
                 patch.object(m,'daemon_directory'),patch.object(m,'runtime_directory'),patch.object(m,'openrc_start_ready'),patch.object(m,'no_clock_processes'), \
                 patch.object(m,'write',side_effect=lambda p,data,*a,**kw:self.files.setdefault(str(p),data.decode()) or True), \
                 patch.object(m,'command',side_effect=command),patch.object(m,'active',side_effect=active),patch.object(m,'services',return_value=['chrony','incudal-clock']):
                self.assertEqual(m.managed_clock(init),'incudal-clock')
                self.assertTrue(running)
                config=self.files[str(m.CONFIG)]
                self.assertNotIn('makestep',config);self.assertNotIn('initstepslew',config)
                self.assertIn('maxslewrate 10000',config)
                start=['systemctl','start','incudal-clock'] if init=='systemd' else ['rc-service','incudal-clock','start']
                self.assertEqual(commands.count(start),1)
                if init=='openrc':self.assertIn('after net',self.files[str(Path('/etc/init.d/incudal-clock'))])
                disabled=[i for i,c in enumerate(commands) if 'disable' in c or 'del' in c]
                self.assertTrue(all(i>commands.index(start) for i in disabled),'preserve fallback until managed daemon starts')

    def test_stale_tracking_is_not_synchronization(self):
        with patch.object(m,'command',return_value=self.result([],out='System time : 0.001 seconds fast\nLeap status : Normal\nRef time (UTC) : Wed Jan 01 00:00:00 2020\n')):
            self.assertFalse(m.synchronized('systemd','chrony'))

    def test_root_runtime_repaired_but_symlink_or_other_owner_rejected(self):
        path=Mock();path.exists.return_value=True
        user=types.SimpleNamespace(pw_uid=51,pw_gid=51)
        for mode,uid,valid in [(stat.S_IFDIR|0o755,0,True),(stat.S_IFDIR|0o750,51,True),
                               (stat.S_IFDIR|0o777,0,False),(stat.S_IFLNK|0o777,0,False),(stat.S_IFDIR|0o750,1000,False)]:
            path.lstat.return_value=types.SimpleNamespace(st_mode=mode,st_uid=uid)
            with patch.object(m,'Path',return_value=path),patch.object(m,'trusted'), \
                 patch.object(m.os,'chown',create=True) as chown,patch.object(m.os,'chmod'):
                if valid:
                    m.runtime_directory(user);chown.assert_called_once_with(path,51,51)
                else:
                    with self.assertRaisesRegex(ValueError,'UNTRUSTED_PATH'):m.runtime_directory(user)
                    chown.assert_not_called()

    def test_openrc_install_does_not_wait_for_ntp_or_packages(self):
        with patch.object(m,'trusted'),patch.object(m,'write'),patch.object(m,'command'), \
             patch.object(m,'active',return_value=True),patch.object(m.subprocess,'Popen') as popen,patch.object(m,'reconcile') as reconcile:
            self.assertEqual(m.install('openrc'),{'state':'scheduled'})
            reconcile.assert_not_called()
            self.assertTrue(popen.call_args.kwargs['start_new_session'])
            self.assertEqual(popen.call_args.args[0],['/usr/bin/python3',str(m.HELPER)])

    def test_stale_openrc_start_resets_only_when_process_gone(self):
        service=Mock();service.read_text.return_value=m.MARK+'\n'
        process=Mock();process.name='123'
        proc=Mock();proc.iterdir.return_value=[process]
        marker=Mock();marker.is_symlink.return_value=True
        def path(value,*parts):
            if str(value)=='/proc':return proc
            if str(value)=='/etc/init.d/incudal-clock':return service
            return marker
        for args in [b'',b'/sbin/chronyd\0-d\0',b'/sbin/supervise-daemon\0incudal-clock\0',b'/sbin/openrc-run\0/etc/init.d/incudal-clock\0start\0']:
            process.__truediv__=Mock(return_value=Mock(read_bytes=Mock(return_value=args)))
            with patch.object(m,'Path',side_effect=path),patch.object(m,'trusted'),patch.object(m,'command') as command:
                if args:
                    with self.assertRaisesRegex(ValueError,'SERVICE_BUSY'):m.openrc_start_ready()
                    command.assert_not_called()
                else:
                    m.openrc_start_ready();command.assert_called_once_with(['rc-service','incudal-clock','zap'])

    def test_install_failure_is_not_success_and_runtime_failure_retries(self):
        fake_fcntl=types.SimpleNamespace(flock=Mock(),LOCK_EX=1,LOCK_NB=4)
        for args,expected,state in [(['helper','--install'],1,'installation-failed'),(['helper'],0,'pending')]:
            with patch.object(m.sys,'argv',args),patch.object(m.os,'geteuid',return_value=0,create=True), \
                 patch.object(m,'directory'),patch.object(m.os,'open',return_value=9),patch.object(m.os,'O_NOFOLLOW',0,create=True), \
                 patch.object(m.os,'fstat',return_value=types.SimpleNamespace(st_mode=stat.S_IFREG|0o600,st_uid=0,st_nlink=1)), \
                 patch.object(m.os,'close'),patch.object(m,'fcntl',fake_fcntl),patch.object(m,'manager',return_value='systemd'), \
                 patch.object(m,'install',side_effect=ValueError('TIME_SYNC_COMMAND_PENDING')), \
                 patch.object(m,'reconcile',side_effect=ValueError('TIME_SYNC_COMMAND_PENDING')),patch.object(m,'write') as write, \
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(m.main(),expected)
                self.assertEqual(json.loads(write.call_args.args[1])['state'],state)

    @unittest.skipUnless(sys.platform!='win32' and m.os.geteuid()==0, 'requires root POSIX paths')
    def test_gateway_symlink_entry_uses_trusted_physical_source(self):
        repository=Path(__file__).parents[1]
        with tempfile.TemporaryDirectory(dir='/root',prefix='clock-source-') as folder:
            root=Path(folder);root.chmod(0o755)
            scripts=root/'release'/'scripts';scripts.mkdir(parents=True)
            source=scripts/'ensure-time-sync.py';source.write_text(m.MARK+'\n')
            (root/'current').symlink_to(root/'release',target_is_directory=True)
            with self.assertRaises(ValueError):m.trusted(root/'current'/'scripts'/'ensure-time-sync.py')
            for name in ['install-onboarding-gateway.sh','install-management-gateway.sh']:
                assignment=next(line for line in (repository/'scripts'/name).read_text().splitlines() if line.startswith('script_dir='))
                resolved=subprocess.run(['sh','-c',assignment+'; printf "%s" "$script_dir"',str(root/'current'/'scripts'/name)],check=True,capture_output=True,text=True).stdout
                self.assertEqual(Path(resolved),scripts)
                m.trusted(Path(resolved)/'ensure-time-sync.py')

    @unittest.skipUnless(sys.platform!='win32' and m.os.geteuid()==0, 'requires root POSIX paths')
    def test_native_atomic_files_and_daemon_symlink_refusal(self):
        with tempfile.TemporaryDirectory(dir='/root',prefix='clock-path-') as folder:
            root=Path(folder);root.chmod(0o755)
            data=root/'chrony';data.mkdir()
            outside=root/'outside';outside.mkdir();outside.chmod(0o700)
            leaf=data/'incudal-clock'
            leaf.symlink_to(outside,target_is_directory=True)
            user=types.SimpleNamespace(pw_uid=65534,pw_gid=65534)
            with self.assertRaises((OSError,ValueError)):m.daemon_directory(leaf,user)
            self.assertEqual(outside.stat().st_uid,0)
            leaf.unlink();m.daemon_directory(leaf,user)
            self.assertEqual(leaf.stat().st_uid,user.pw_uid)
            target=root/'state.json';m.write(target,b'{"state":"pending"}')
            self.assertEqual(target.read_bytes(),b'{"state":"pending"}')
            self.assertEqual(target.stat().st_mode&0o777,0o644)
            self.assertFalse(m.write(target,b'{"state":"pending"}'))
            link=root/'link';link.symlink_to(target)
            with self.assertRaises(ValueError):m.write(link,b'changed')
            self.assertEqual(target.read_bytes(),b'{"state":"pending"}')


if __name__=='__main__': unittest.main()
