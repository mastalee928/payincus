#!/usr/bin/env python3
"""Fixed gateway transport and extracted host probe tests; no live host claims."""
import base64
import ast
import importlib.util
import io
import ipaddress
import json
import os
import pathlib
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

if os.name == 'nt':
    sys.modules.setdefault('fcntl', types.SimpleNamespace(LOCK_SH=1, LOCK_EX=2, LOCK_NB=4, LOCK_UN=8, flock=lambda *_: None))
spec = importlib.util.spec_from_file_location('security_gateway', pathlib.Path(__file__).with_name('onboarding-gateway.py'))
gateway = importlib.util.module_from_spec(spec); spec.loader.exec_module(gateway)


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.job = '11111111-1111-4111-8111-111111111111'
        self.peer = base64.b64encode(bytes([7])*32).decode()
        self.request = {'managementIp': '10.253.240.2', 'sshPort': 22, 'sshFingerprint': 'SHA256:' + 'A'*43,
                        'nodePublicKey': self.peer, 'guests': [{'instanceId': 7, 'pid': 123}], 'allowUpdate': True, 'requestId': self.job, 'expiresAt': 140000}
        self.calls = []

    def transport(self, request=None, route=True):
        receipt = {'runtime': {'apparmor': False, 'alpine': True, 'fixed': True, 'branch': '3.22', 'guests': []}, 'hostSshUpdated': True}
        def execute(command, **options):
            self.calls.append((command, options))
            if command[0] == 'ssh-keyscan': return types.SimpleNamespace(stdout=b'known', returncode=0)
            if command[-1] == 'id -u': return types.SimpleNamespace(stdout=b'0\n', returncode=0)
            return types.SimpleNamespace(stdout=json.dumps(receipt).encode(), returncode=0)
        with tempfile.TemporaryDirectory() as directory, patch.object(gateway.sys, 'stdin', types.SimpleNamespace(buffer=io.BytesIO(json.dumps(request or self.request).encode()))), \
             patch.object(gateway.time, 'time', return_value=1), patch.object(gateway, 'read_protected_state', side_effect=lambda path, *_: b'# fixed template' if path.name.endswith('.sh') else json.dumps({'managementIp': '10.253.240.2', 'nodePublicKey': self.peer}).encode()), \
             patch.object(gateway, 'run', return_value=self.peer+'\t'+('10.253.240.2/32' if route else '10.253.240.3/32')), \
             patch.object(gateway, 'verified_host_scan', return_value=['original-pin']), patch.object(gateway.subprocess, 'run', side_effect=execute):
            class Temp:
                def __enter__(self): return directory
                def __exit__(self, *_): return None
            with patch.object(gateway.tempfile, 'TemporaryDirectory', return_value=Temp()):
                return gateway.harden_host(self.job, ipaddress.ip_interface('10.253.240.1/20'))

    def test_exact_transport_and_fixed_source(self):
        self.assertTrue(self.transport()['hostSshUpdated'])
        self.assertEqual(len(self.calls), 3)
        command, options = self.calls[1]
        self.assertIn('StrictHostKeyChecking=yes', command)
        self.assertIn('IdentitiesOnly=yes', command)
        self.assertEqual(command[-2:], ['root@10.253.240.2', 'python3 -I -B -'])
        self.assertIn(gateway.HOST_HARDENING_SCRIPT.encode(), options['input'])
        self.assertEqual(self.calls[2][0][-1], 'id -u')

    def test_no_transport_for_invalid_request_or_binding(self):
        for delta in [{'managementIp':'192.0.2.23'}, {'allowUpdate':'true'}, {'expiresAt':500}, {'script':'id'},
                      {'nodePublicKey':'different'}, {'guests':[{'instanceId':7,'pid':'123'}]}, {'guests':[{'instanceId':7,'pid':True}]}]:
            self.calls=[]
            with self.assertRaises(ValueError): self.transport({**self.request, **delta})
            self.assertEqual(self.calls, [])
        with self.assertRaises(ValueError): self.transport(route=False)
        self.assertEqual(self.calls, [])

    def maintenance_transport(self,operation):
        request={key:self.request[key] for key in ['managementIp','sshPort','sshFingerprint','nodePublicKey']}
        request['operation']=operation
        def execute(command,**options):
            self.calls.append((command,options))
            if command[0]=='ssh-keyscan':return types.SimpleNamespace(stdout=b'known',returncode=0)
            return types.SimpleNamespace(stdout=json.dumps({'phase':'customers-restored'}).encode(),returncode=0)
        def source(path,*_):
            if path.name=='host-security-maintenance.py':return b"# fixed-maintenance-source\nif __name__=='__main__':main()"
            return json.dumps({'managementIp':'10.253.240.2','nodePublicKey':self.peer}).encode()
        with tempfile.TemporaryDirectory() as directory,patch.object(gateway.sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(json.dumps(request).encode()))), \
            patch.object(gateway.time,'time',return_value=1),patch.object(gateway,'read_protected_state',side_effect=source), \
            patch.object(gateway,'run',return_value=self.peer+'\t10.253.240.2/32'),patch.object(gateway,'verified_host_scan',return_value=['original-pin']), \
            patch.object(gateway.subprocess,'run',side_effect=execute):
            class Temp:
                def __enter__(self):return directory
                def __exit__(self,*_):return None
            with patch.object(gateway.tempfile,'TemporaryDirectory',return_value=Temp()):
                return gateway.maintain_host(self.job,ipaddress.ip_interface('10.253.240.1/20'))

    def test_fixed_maintenance_customer_protocol_rejects_unowned_changes(self):
        customer={'name':'original-customer','uuid':self.job,'attempt':self.job,'state':'running','autostart':None}
        operation={'action':'restore-customers','nodeId':self.job,'requestId':self.job,'identityHash':'a'*64,'bootId':self.job,
            'prepareHash':'b'*64,'recipe':'alpine-apparmor-extlinux-v1','architecture':'aarch64','expiresAt':59000,'customers':[customer]}
        self.assertEqual(self.maintenance_transport(operation)['phase'],'customers-restored')
        self.assertEqual(len(self.calls),2)
        command,options=self.calls[-1]
        self.assertIn('StrictHostKeyChecking=yes',command)
        self.assertIn(b'# fixed-maintenance-source',options['input'])
        for delta in [{'name':'../../shadow'},{'state':'Frozen'},{'autostart':True},{'uuid':'changed'},{'password':'override'}]:
            self.calls=[]
            with self.assertRaises(ValueError):self.maintenance_transport({**operation,'customers':[{**customer,**delta}]})
            self.assertEqual(self.calls,[])
        for delta in [{'action':'arbitrary'},{'script':'reboot'},{'customers':[customer,customer]}]:
            self.calls=[]
            with self.assertRaises(ValueError):self.maintenance_transport({**operation,**delta})
            self.assertEqual(self.calls,[])

    def host_script(self, unsafe=False, changed=False, fixed=False, patch_failure=False, architecture='x86_64',
                    memory=262144, pressure=0, disk=268435456, inodes=1024, readonly=False, package_busy=False, boot_changed=False, boot_disabled=False, page_size=None):
        writes=[]; probes=0
        def read(path, **_):
            name=path.as_posix()
            if name=='/etc/incudal-onboarding-id': return self.job
            if name=='/etc/alpine-release': return '3.22.1'
            if name=='/sys/kernel/security/lsm': return 'capability'
            if name=='/sys/module/apparmor/parameters/enabled': return 'N'
            if name=='/proc/sys/kernel/random/boot_id': return '22222222-2222-4222-8222-222222222222' if boot_changed and probes > 1 else self.job
            if name=='/proc/meminfo': return 'MemAvailable: '+str(memory)+' kB'
            if name=='/proc/pressure/memory': return 'some avg10='+str(pressure)+' avg60=0.00 avg300=0.00 total=0'
            if name=='/proc/cmdline': return 'root=private-root apparmor=0' if boot_disabled else 'root=private-root'
            if name.endswith('/uid_map') or name.endswith('/gid_map'): return '0 0 65536' if unsafe else '0 1000000 65536'
            if name.endswith('/status'): return 'Seccomp:\t2'
            if name.endswith('/attr/current'): return 'unconfined'
            if name.endswith('/stat'): return '123 (init) '+' '.join(['S']+['0']*18+[str(200 if changed and probes >= 1 else 100)])
            raise OSError('unsupported fixture read')
        def shell(_command, **options):
            nonlocal probes
            if b'alpine_ssh_security_update update' in options['input']:
                writes.append('patch')
                return types.SimpleNamespace(returncode=1 if patch_failure else 0, stdout=b'INCUDAL_ALPINE_SSH_PATCH_INSTALLED\n')
            probes+=1
            return types.SimpleNamespace(returncode=0 if fixed or writes else 1, stdout=b'')
        output=io.StringIO()
        def opened(path, *_args, **_options): return io.StringIO(read(path))
        processes=[pathlib.Path('/proc/123')]
        if package_busy: processes.append(pathlib.Path('/proc/321'))
        original_read=read
        def read(path, **options):
            if path.as_posix()=='/proc/321/comm':return 'apk'
            return original_read(path,**options)
        with patch.object(pathlib.Path,'open',opened), patch.object(pathlib.Path,'iterdir',return_value=iter(processes)), \
             patch.object(gateway.subprocess,'run',side_effect=shell), patch.object(gateway.time,'time',return_value=1), \
             patch.object(gateway.os,'uname',return_value=types.SimpleNamespace(machine=architecture),create=True), \
             patch.object(gateway.os,'sysconf',return_value=page_size or (65536 if architecture=='aarch64' else 4096),create=True), \
             patch.object(gateway.os,'statvfs',return_value=types.SimpleNamespace(f_bavail=disk//4096,f_frsize=4096,f_favail=inodes,f_flag=1 if readonly else 0),create=True), \
             patch.object(gateway.os,'ST_RDONLY',1,create=True), \
             patch.object(gateway.os,'open',side_effect=FileNotFoundError), \
             patch.object(gateway.os,'O_NONBLOCK',0,create=True), \
             patch.object(gateway.os,'O_NOFOLLOW',0,create=True), \
             patch.object(gateway.os,'getuid',return_value=0,create=True), redirect_stdout(output):
            # Transport/runtime tests stub journal storage, which is exercised
            # independently below with actual atomic files and replay checks.
            journal_fixture="""def journal_fixture(_before):
 result=shell('alpine_ssh_security_update update',90)
 if result.returncode:raise ValueError('ALPINE_SSH_UPDATE_FAILED')
 return True
"""
            source=gateway.HOST_HARDENING_SCRIPT.replace('updated=journal_update(before)','updated=journal_fixture(before)').replace('\n journal_readonly(before)\n','\n pass # journal tested independently\n')
            source=source.replace('try:\n identity();before,ticks=snapshot();updated=False',journal_fixture+'\ntry:\n identity();before,ticks=snapshot();updated=False')
            try: exec(compile(source,'host-hardening-script','exec'), {'D':{**self.request,'nodeId':self.job,'template':base64.b64encode(b'# fixture').decode()}})
            except SystemExit: pass
        return writes,output.getvalue()

    def test_host_partial_apparmor_patch_idempotence_and_unsafe_zero_write(self):
        writes,output=self.host_script()
        self.assertEqual(writes,['patch']);self.assertTrue(json.loads(output)['runtime']['fixed'])
        self.assertFalse(json.loads(output)['runtime']['apparmor'])
        self.assertEqual(self.host_script(fixed=True)[0],[])
        self.assertEqual(self.host_script(unsafe=True)[0],[])
        self.assertIn('ALPINE_SSH_UPDATE_FAILED',self.host_script(patch_failure=True)[1])
        self.assertIn('HARDENING_IDENTITY_CHANGED',self.host_script(changed=True)[1])

    def test_target_architecture_and_resource_zero_write(self):
        for architecture,sizes in [('x86_64',[4096]),('aarch64',[4096,16384,65536])]:
            for page_size in sizes:
                writes,output=self.host_script(architecture=architecture,page_size=page_size)
                self.assertEqual(writes,['patch'])
                self.assertEqual(json.loads(output)['runtime']['preflight']['pageSize'],page_size)
                self.assertEqual(json.loads(output)['runtime']['preflight']['architecture'],architecture)
        for options in [{'architecture':'riscv64'},{'architecture':'aarch64','page_size':8192},{'memory':131071},{'pressure':5},{'disk':134213632},
                        {'inodes':511},{'readonly':True},{'package_busy':True}]:
            with self.subTest(options=options):
                writes,output=self.host_script(**options)
                self.assertEqual(writes,[])
                self.assertFalse(json.loads(output)['runtime']['fixed'])
        self.assertIn('HARDENING_IDENTITY_CHANGED',self.host_script(boot_changed=True)[1])
        report=json.loads(self.host_script(boot_disabled=True)[1])['runtime']['preflight']
        self.assertTrue(report['apparmorBootDisabled']);self.assertTrue(report['apparmorKernelSupport'])
        self.assertNotIn('private-root',json.dumps(report))

    def test_real_journal_atomic_files_replay_busy_and_conflict(self):
        functions=[node for node in ast.parse(gateway.HOST_HARDENING_SCRIPT).body if isinstance(node,ast.FunctionDef) and node.name in ['journal_update','journal_readonly','journal_identity_matches']]
        with tempfile.TemporaryDirectory() as directory:
            target=pathlib.Path(directory); calls=[]; fixed=False; baseline={'/etc/shadow':['local-only-hash']}
            original_path=pathlib.Path
            def path(name):return target if str(name)=='/var/lib/incudal-hardening' else original_path(name)
            def shell(tail,_timeout,lock_fd=None,started=None):
                nonlocal fixed
                if tail=='alpine_ssh_security_update update':
                    self.assertIsInstance(lock_fd,int);self.assertTrue(callable(started));started(123)
                    calls.append('update');fixed=True;return types.SimpleNamespace(returncode=0,stdout=b'INCUDAL_ALPINE_SSH_PATCH_INSTALLED\n')
                return types.SimpleNamespace(returncode=0 if fixed else 1)
            import hashlib
            scope={'pathlib':types.SimpleNamespace(Path=path),'os':os,'stat':__import__('stat'),'fcntl':gateway.fcntl,
              'json':json,'hashlib':hashlib,'tempfile':__import__('tempfile'),'template':'fixed repository template','D':{**self.request,'nodeId':self.job},
              'identity':lambda:None,'active':lambda:None,'preflight':lambda:{},'writable':lambda _:True,
              'security_baseline':lambda:dict(baseline),'shell':shell,'protected':lambda *_:None,
              'process_owner':lambda pid:{'pid':pid,'startTicks':'100'},'owner_alive':lambda *_:False}
            with patch.object(os,'O_NOFOLLOW',getattr(os,'O_NOFOLLOW',0),create=True),patch.object(os,'O_NONBLOCK',getattr(os,'O_NONBLOCK',0),create=True), \
                 patch.object(os,'O_DIRECTORY',getattr(os,'O_DIRECTORY',0),create=True), \
                 patch.object(os,'fchmod',getattr(os,'fchmod',lambda *_:None),create=True):
                # Windows cannot open directories for fsync. Only that platform
                # uses a descriptor for a private fixture file instead.
                original_open=os.open
                def opened(name,flags,*args,**kwargs):
                    if os.name=='nt' and str(name)==str(target):return original_open(target/'update.lock',os.O_RDWR)
                    return original_open(name,flags,*args,**kwargs)
                with patch.object(os,'open',side_effect=opened):
                    exec(compile(ast.Module(body=functions,type_ignores=[]),'actual-journal','exec'),scope)
                    before={'preflight':{'bootId':self.job,'architecture':'aarch64'}}
                    (target/'maintenance.json').write_text('{"separate":"boot maintenance"}')
                    scope['journal_readonly'](before)
                    self.assertFalse((target/'update.lock').exists(),'boot-only journal does not require a fictitious SSH update lock')
                    self.assertTrue(scope['journal_update'](before));self.assertEqual(calls,['update'])
                    self.assertFalse(scope['journal_update'](before));self.assertEqual(calls,['update'],'lost response does not replay installed update')
                    scope['journal_readonly'](before)
                    receipt=json.loads((target/'ssh.json').read_text());self.assertEqual(receipt['phase'],'verified')
                    self.assertEqual(receipt['identity']['requestId'],self.job)
                    self.assertEqual(receipt['baseline'],baseline)
                    self.assertEqual(receipt['version'],2)
                    self.assertEqual(receipt['owner'],{'pid':os.getpid(),'startTicks':'100'})
                    receipt['phase']='started';(target/'ssh.json').write_text(json.dumps(receipt))
                    scope['owner_alive']=lambda *_:True
                    with self.assertRaisesRegex(ValueError,'REMOTE_BUSY'):scope['journal_update'](before)
                    with self.assertRaisesRegex(ValueError,'REMOTE_BUSY'):scope['journal_readonly'](before)
                    self.assertEqual(calls,['update'])
                    scope['owner_alive']=lambda *_:False
                    self.assertFalse(scope['journal_update'](before),'ended owner plus actual installed patch closes lost response')
                    scope['D']['requestId']='22222222-2222-4222-8222-222222222222'
                    scope['journal_readonly'](before)
                    self.assertFalse(scope['journal_update'](before),'verified receipt safely superseded without replaying patch')
                    self.assertEqual(len(list(target.glob('ssh-*.json'))),1)
                    baseline['/etc/shadow']=['changed-local-only']
                    with self.assertRaisesRegex(ValueError,'JOURNAL_CONFLICT'):scope['journal_update'](before)
                    with patch.object(gateway.fcntl,'flock',side_effect=BlockingIOError):
                        with self.assertRaisesRegex(ValueError,'REMOTE_BUSY'):scope['journal_update'](before)
                    self.assertEqual(calls,['update'])

    def test_owner_pid_reuse_and_inherited_lock_on_parent_timeout(self):
        functions=[node for node in ast.parse(gateway.HOST_HARDENING_SCRIPT).body if isinstance(node,ast.FunctionDef) and node.name in ['shell','process_owner','owner_alive']]
        state={'boot':self.job,'ticks':'100','exists':True}
        def read(path):
            if path=='/proc/sys/kernel/random/boot_id':return state['boot']
            return '123 (odd name)) '+' '.join(['S']+['0']*18+[state['ticks']])
        class Process:
            pid=123;returncode=0
            def communicate(_self,*args,**kwargs):raise gateway.subprocess.TimeoutExpired('fixed command',90)
        scope={'read':read,'pathlib':pathlib,'subprocess':gateway.subprocess,'template':'# fixed template'}
        exec(compile(ast.Module(body=functions,type_ignores=[]),'actual-owner-shell','exec'),scope)
        with patch.object(pathlib.Path,'exists',side_effect=lambda:state['exists']):
            owner=scope['process_owner'](123)
            self.assertTrue(scope['owner_alive'](owner,self.job))
            state['ticks']='101';self.assertFalse(scope['owner_alive'](owner,self.job),'PID reuse is not original owner')
            state['boot']='other';self.assertFalse(scope['owner_alive'](owner,self.job))
            with self.assertRaisesRegex(ValueError,'JOURNAL_CONFLICT'):scope['owner_alive']({'pid':True,'startTicks':'100'},self.job)
        called=[]
        with patch.object(gateway.subprocess,'Popen',return_value=Process()) as start:
            with self.assertRaises(gateway.subprocess.TimeoutExpired):scope['shell']('alpine_ssh_security_update update',90,77,called.append)
            self.assertEqual(start.call_args.kwargs['pass_fds'],(77,))
            self.assertEqual(called,[123])
            self.assertEqual(start.call_args.args[0],['timeout','-s','TERM','-k','3','85','sh','-s'])


if __name__=='__main__': unittest.main()
