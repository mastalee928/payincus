#!/usr/bin/env python3
"""Fixed boot recipe fixtures. Does not claim native reboot acceptance."""
import importlib.util
import json
import os
import tempfile
from contextlib import ExitStack
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
if os.name=='nt':sys.modules.setdefault('fcntl',types.SimpleNamespace(LOCK_EX=2,LOCK_NB=4,flock=lambda *_:None))
spec=importlib.util.spec_from_file_location('host_maintenance',Path(__file__).parents[1]/'server/templates/host-security-maintenance.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class MaintenanceTests(unittest.TestCase):
    def fixture(self, initial_enabled=False):
        stack=ExitStack();directory=stack.enter_context(tempfile.TemporaryDirectory());root=Path(directory)
        original=Path;boot_id='33333333-3333-4333-8333-333333333333';calls=[];enabled=[initial_enabled];boot_value=[boot_id]
        config=root/'extlinux.conf';before=b'LABEL stable\n KERNEL /boot/vmlinuz-lts\n APPEND root=UUID=original console=ttyS0\n';config.write_bytes(before);config.chmod(0o644)
        def mapped(value):return config if str(value)=='/boot/extlinux.conf' else original(value)
        def command(args, **_):
            calls.append(args)
            if args[:2]==['rc-update','add']:enabled[0]=True
            elif args[:2]==['rc-update','del']:enabled[0]=False
            else:self.fail('Unexpected fixture command')
            return b''
        original_open=os.open
        def opened(path,flags,*args,**kwargs):
            if os.name=='nt' and str(path)==str(root):return original_open(root/'maintenance.lock',os.O_RDWR)
            return original_open(path,flags,*args,**kwargs)
        for name,value in [('ROOT',root),('Path',mapped),('identity',lambda _:None),('environment',lambda:None),
            ('protected',lambda *_:None),('boot',lambda:boot_value[0]),('runlevel_enabled',lambda:enabled[0]),('empty_remote',lambda:None),('command',command)]:
            stack.enter_context(patch.object(module,name,value))
        stack.enter_context(patch.object(module.os,'getuid',return_value=0,create=True))
        for name in ['O_NOFOLLOW','O_DIRECTORY']:stack.enter_context(patch.object(os,name,getattr(os,name,0),create=True))
        stack.enter_context(patch.object(os,'fchmod',getattr(os,'fchmod',lambda *_:None),create=True))
        stack.enter_context(patch.object(os,'open',side_effect=opened))
        if os.name=='nt':
            original_stat=original.stat
            def file_stat(path,*args,**kwargs):
                info=original_stat(path,*args,**kwargs)
                if path==config:return types.SimpleNamespace(st_mode=0o100644)
                return info
            # NT chmod cannot represent Unix modes; native permissions remain
            # a separate gate. Only the fixture boot file's mode is adapted.
            stack.enter_context(patch.object(original,'stat',file_stat))
        stack.enter_context(patch.object(module.time,'time',return_value=1))
        value={'action':'prepare','nodeId':'11111111-1111-4111-8111-111111111111','requestId':'22222222-2222-4222-8222-222222222222',
            'identityHash':'a'*64,'bootId':boot_id,'prepareHash':'0'*64,'recipe':module.RECIPE,'architecture':'aarch64','expiresAt':59000,'customers':[]}
        return stack,root,config,before,value,calls,enabled,boot_value
    def test_actual_atomic_journal_single_dispatch_lost_response_and_boot(self):
        stack,root,config,before,value,calls,enabled,boot_value=self.fixture()
        with stack:
            first=module.execute(value);self.assertEqual(first['phase'],'prepared');self.assertTrue(enabled[0])
            self.assertNotEqual(config.read_bytes(),before);self.assertEqual(module.execute(value),first)
            request={**value,'prepareHash':first['prepareHash']}
            launches=[]
            def start(args,**kwargs):
                launches.append((args,kwargs))
                self.assertEqual(json.loads((root/'maintenance.json').read_text())['phase'],'reboot-intent','durable barrier precedes launch')
                raise OSError('simulated lost launch result')
            with patch.object(module.subprocess,'Popen',side_effect=start):
                with self.assertRaises(OSError):module.execute({**request,'action':'reboot'})
                self.assertEqual(module.execute({**request,'action':'status'})['phase'],'reboot-intent')
                module.execute({**request,'action':'reboot'})
                boot_value[0]='44444444-4444-4444-8444-444444444444';module.execute({**request,'action':'reboot'})
            self.assertEqual(len(launches),1);self.assertEqual(launches[0][0],['/sbin/reboot']);self.assertIn('pass_fds',launches[0][1])
            with self.assertRaisesRegex(ValueError,'JOURNAL'):module.execute({**request,'requestId':value['nodeId'],'action':'reboot'})
            self.assertEqual(calls,[['rc-update','add','apparmor','boot']])
    def test_interrupted_preparation_and_exact_conditional_rollback(self):
        for initial_enabled in [False,True]:
            stack,root,config,before,value,calls,enabled,_=self.fixture(initial_enabled)
            with stack:
                first=module.execute(value);request={**value,'prepareHash':first['prepareHash']}
                journal=root/'maintenance.json';state=json.loads(journal.read_text());state['phase']='preparing';journal.write_text(json.dumps(state))
                config.write_bytes(before);enabled[0]=initial_enabled
                module.execute(value);self.assertTrue(enabled[0]);self.assertEqual(config.read_bytes(),module.prepare_boot(before))
                config.write_bytes(b'other writer')
                with self.assertRaisesRegex(ValueError,'JOURNAL'):module.execute({**request,'action':'rollback'})
                self.assertEqual(config.read_bytes(),b'other writer')
                config.write_bytes(module.prepare_boot(before))
                rolled=module.execute({**request,'action':'rollback'})
                self.assertEqual(rolled['phase'],'rolled-back');self.assertEqual(config.read_bytes(),before)
                self.assertEqual(enabled[0],initial_enabled,'restore exactly the prior AppArmor boot runlevel')
                self.assertEqual(module.execute({**request,'action':'rollback'}),rolled,'lost rollback receipt is safely replayed')
    def test_fixed_boot_changes_preserve_root_network_and_other_bytes(self):
        before=b'DEFAULT stable\nTIMEOUT 20\nLABEL stable\n KERNEL /boot/vmlinuz-lts\n INITRD /boot/initramfs-lts\n APPEND root=UUID=original console=ttyS0 apparmor=0 lsm=landlock,lockdown,yama\n'
        after=module.prepare_boot(before)
        self.assertIn(b'root=UUID=original console=ttyS0',after)
        self.assertIn(b'lsm=landlock,lockdown,yama,apparmor',after)
        self.assertIn(b'apparmor=1 security=apparmor',after)
        self.assertTrue(after.startswith(before[:before.index(b' APPEND')]))
        self.assertEqual(module.prepare_boot(after),after)
        for extra in [b'LABEL alternate\n KERNEL /boot/other\n APPEND root=other\n',b' APPEND another\n']:
            with self.assertRaisesRegex(ValueError,'BOOT_LAYOUT'):module.prepare_boot(before+extra)
        for text in [before.replace(b'console=ttyS0',b'security=selinux'),before.replace(b'root=UUID=original',b'root="$OTHER"'),before.replace(b'\n',b'\r\n')]:
            with self.assertRaisesRegex(ValueError,'BOOT_LAYOUT'):module.prepare_boot(text)
    def test_request_no_arbitrary_action_or_paths(self):
        value={'action':'prepare','nodeId':'11111111-1111-4111-8111-111111111111','requestId':'22222222-2222-4222-8222-222222222222',
            'identityHash':'a'*64,'bootId':'33333333-3333-4333-8333-333333333333','prepareHash':None,
            'recipe':module.RECIPE,'architecture':'aarch64','expiresAt':11000,'customers':[]}
        with patch.object(module.time,'time',return_value=1):
            self.assertEqual(module.request(value),value)
            for delta in [{'script':'reboot'},{'path':'/etc/shadow'},{'action':'arbitrary'},{'expiresAt':True},{'architecture':'riscv64'},{'identityHash':'private'}]:
                with self.assertRaises(ValueError):module.request({**value,**delta})
    def test_control_plane_target_no_reboot(self):
        value={'nodeId':'node','architecture':'aarch64'}
        with patch.object(Path,'read_text',return_value='node'),patch.object(module.os,'uname',return_value=types.SimpleNamespace(machine='aarch64'),create=True),patch.object(Path,'exists',side_effect=lambda:True):
            with self.assertRaisesRegex(ValueError,'CONTROL_PLANE'):module.identity(value)

    def test_customer_autostart_journal_cas_lost_reply_and_exact_restore(self):
        for original in [None,'true','1','false','0']:
            stack,root,config,before,value,calls,enabled,boot_value=self.fixture()
            customer={'name':'original-customer','uuid':value['nodeId'],'attempt':value['requestId'],'state':'running','autostart':original}
            value={**value,'customers':[customer]}
            remote={'name':customer['name'],'type':'container','status':'Running','architecture':'aarch64','description':'original',
                'devices':{'root':{'type':'disk','path':'/','pool':'original'}},'profiles':[],'ephemeral':False,
                'config':{'volatile.uuid':customer['uuid'],'user.payincus.provisioning-attempt':customer['attempt'],
                    'security.privileged':'false','limits.memory':'256MiB'}}
            if original is not None:remote['config']['boot.autostart']=original
            revision=[0];writes=[];lose=[True]
            def api(method,path,body=None,etag=None):
                self.assertEqual(path,'/1.0/instances/original-customer')
                if method=='GET':return {'type':'sync','metadata':json.loads(json.dumps(remote))},str(revision[0])
                self.assertEqual(method,'PUT');self.assertEqual(etag,str(revision[0]))
                self.assertTrue((root/'maintenance.json').exists(),'journal persisted before first customer mutation')
                expected={key:remote[key] for key in ['architecture','description','devices','ephemeral','profiles']}
                self.assertEqual({key:body[key] for key in expected},expected)
                revision[0]+=1;remote['config']=body['config'];writes.append(body)
                if lose[0]:lose[0]=False;raise TimeoutError('lost autostart change reply')
                return {'type':'sync','metadata':{}},str(revision[0])
            def inventory(args,**kwargs):
                if args[:2]==['incus','list']:return json.dumps([remote]).encode()
                return self.fixture_command(args,calls,enabled)
            with stack,patch.object(module,'local_incus',side_effect=api),patch.object(module,'command',side_effect=inventory):
                if original!='false':
                    with self.assertRaises(TimeoutError):module.execute(value)
                    self.assertEqual(json.loads((root/'maintenance.json').read_text())['phase'],'preparing')
                first=module.execute(value)
                self.assertEqual(remote['config']['boot.autostart'],'false')
                self.assertEqual(len(writes),int(original!='false'),'lost response resumes without repeating config change')
                for value_ephemeral in [True,None,'false',0]:
                    remote['ephemeral']=value_ephemeral;count=len(writes)
                    with self.assertRaisesRegex(ValueError,'BOOT_RECOVERY'):module.customer_boot_change(customer,{'guardHash':module.guest_guard(remote)},restore=True)
                    self.assertEqual(len(writes),count,'unknown persistence must not reach a config mutation')
                remote['ephemeral']=False
                request={**value,'prepareHash':first['prepareHash'],'action':'reboot'}
                with patch.object(module.subprocess,'Popen') as reboot:
                    module.execute(request);self.assertEqual(reboot.call_count,1)
                boot_value[0]=customer['uuid'];remote['status']='Running'
                result=module.execute({**request,'action':'restore-customers'})
                self.assertEqual(result['phase'],'customers-restored');self.assertEqual(remote['config'].get('boot.autostart'),original)
                count=len(writes);module.execute({**request,'action':'restore-customers'});self.assertEqual(len(writes),count)
                remote['config']['limits.memory']='512MiB'
                with self.assertRaisesRegex(ValueError,'IDENTITY_CHANGED'):module.execute({**request,'action':'restore-customers'})
                self.assertEqual(remote['config']['limits.memory'],'512MiB','never overwrite a newer config')

    def test_reboot_rechecks_customer_boot_and_runtime(self):
        customer={'name':'original','uuid':'11111111-1111-4111-8111-111111111111',
            'attempt':'22222222-2222-4222-8222-222222222222','state':'running','autostart':'true'}
        remote={'name':'original','type':'container','ephemeral':False,'project':'default','status':'Running','config':{
            'volatile.uuid':customer['uuid'],'user.payincus.provisioning-attempt':customer['attempt'],
            'boot.autostart':'true','security.privileged':'false'}}
        with patch.object(module,'command',side_effect=lambda *_:json.dumps([remote]).encode()):
            module.assert_customer_baseline([customer])
            for value in [True,None,'false',0]:
                remote['ephemeral']=value
                with self.assertRaisesRegex(ValueError,'BOOT_RECOVERY'):module.assert_customer_baseline([customer])
            remote['ephemeral']=False
            with self.assertRaisesRegex(ValueError,'BOOT_RECOVERY'):module.assert_customer_baseline([customer],prepared=True)
            remote['config']['boot.autostart']='false';module.assert_customer_baseline([customer],prepared=True)
            remote['status']='Stopped'
            with self.assertRaisesRegex(ValueError,'HARDENING_BUSY'):module.assert_customer_baseline([customer],prepared=True)
            remote['status']='Running';remote['config']['security.privileged']='true'
            with self.assertRaisesRegex(ValueError,'RUNTIME_UNSAFE'):module.assert_customer_baseline([customer],prepared=True)

    def fixture_command(self,args,calls,enabled):
        calls.append(args)
        if args[:2]==['rc-update','add']:enabled[0]=True
        elif args[:2]==['rc-update','del']:enabled[0]=False
        else:self.fail('Unexpected fixture command')
        return b''
if __name__=='__main__':unittest.main()
