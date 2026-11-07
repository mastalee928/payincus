#!/usr/bin/env python3
"""Fixed host maintenance recipe. Native acceptance is required before activation.

Only stdin JSON from the pinned onboarding gateway is accepted. No caller can
provide shell text, filesystem paths, package names or replacement identities.
"""
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import stat
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path('/var/lib/incudal-hardening')
RECIPE = 'alpine-apparmor-extlinux-v1'
UUID = re.compile(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}')
def fail(code='HARDENING_JOURNAL_CONFLICT'): raise ValueError(code)
def digest(data): return hashlib.sha256(data).hexdigest()
def protected(path, directory=False):
    for parent in [path, *path.parents]:
        info=parent.lstat()
        if info.st_uid!=0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022: fail()
    info=path.lstat()
    if directory:
        if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077: fail()
    elif not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_size>131072: fail()
def read(path):
    protected(path)
    data=path.read_bytes()
    if len(data)>131072: fail()
    return data
def atomic(path,data,mode=0o600):
    fd,name=tempfile.mkstemp(prefix='.maintenance-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as stream:
            os.fchmod(stream.fileno(),mode);stream.write(data);stream.flush();os.fsync(stream.fileno())
        os.replace(name,path)
        parent=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(parent)
        finally:os.close(parent)
    finally:
        if os.path.exists(name):os.unlink(name)
def boot():return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
def command(args,timeout=20):
    result=subprocess.run(args,capture_output=True,timeout=timeout,check=False,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'})
    if result.returncode:fail('HARDENING_PREPARE_FAILED')
    return result.stdout
def request(value):
    keys={'action','nodeId','requestId','identityHash','bootId','prepareHash','recipe','architecture','expiresAt','customers'}
    if not isinstance(value,dict) or set(value)!=keys:fail()
    if value['action'] not in ['prepare','status','reboot','rollback','restore-customers']:fail()
    if any(not isinstance(value[key],str) or not UUID.fullmatch(value[key]) for key in ['nodeId','requestId','bootId']):fail()
    if not isinstance(value['identityHash'],str) or not re.fullmatch(r'[a-f0-9]{64}',value['identityHash']):fail()
    if value['prepareHash'] is not None and (not isinstance(value['prepareHash'],str) or not re.fullmatch(r'[a-f0-9]{64}',value['prepareHash'])):fail()
    if value['recipe']!=RECIPE or value['architecture'] not in ['x86_64','aarch64']:fail('HARDENING_RECIPE_UNSUPPORTED')
    if not isinstance(value['customers'],list) or len(value['customers'])>1:fail()
    for customer in value['customers']:
        if not isinstance(customer,dict) or set(customer)!={'name','uuid','attempt','state','autostart'} or not isinstance(customer['name'],str) or not re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}',customer['name']) or customer['state'] not in ['running','stopped','suspended']:fail()
        if customer['autostart'] is not None and customer['autostart'] not in ['true','false','0','1']:fail()
        if any(not isinstance(customer[key],str) or not UUID.fullmatch(customer[key]) for key in ['uuid','attempt']):fail()
    if type(value['expiresAt']) is not int or not time.time()*1000<value['expiresAt']<=time.time()*1000+60000:fail('HARDENING_REQUEST_EXPIRED')
    return value
def identity(value):
    if Path('/etc/incudal-onboarding-id').read_text().strip()!=value['nodeId'] or os.uname().machine!=value['architecture']:fail('HARDENING_IDENTITY_CHANGED')
    # Ordinary customer hosts only. A controller/gateway needs a separately
    # accepted external recovery path; the ordinary recipe never reboots it.
    if any(Path(path).exists() for path in ['/opt/incudal/current','/usr/local/sbin/incudal-onboarding-gateway',
        '/etc/incudal-onboarding-gateway','/opt/incudal-gateway','/etc/incudal-gateway']):fail('HARDENING_CONTROL_PLANE_TARGET')
def prepare_boot(data):
    """One unambiguous Extlinux label; keep all other boot bytes and parameters."""
    text=data.decode('utf-8')
    if '\x00' in text or '\r' in text:fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
    labels=re.findall(r'^\s*LABEL\s+([^\s]+)\s*$',text,re.I|re.M)
    if len(labels)!=1 or not re.search(r'^\s*(?:LINUX|KERNEL)\s+/[^\s]+\s*$',text,re.I|re.M):fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
    lines=text.splitlines(keepends=True);indices=[i for i,line in enumerate(lines) if re.match(r'^\s*APPEND\s+',line,re.I)]
    if len(indices)!=1:fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
    i=indices[0];match=re.match(r'^(\s*APPEND\s+)(.*?)(\n?)$',lines[i],re.I)
    args=match.group(2).split()
    if any(any(c in arg for c in '"\'`$\\') for arg in args):fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
    updated=[];lsm=False
    for arg in args:
        if arg.startswith('apparmor='):continue
        if arg.startswith('security='):
            if arg not in ['security=apparmor','security=none']:fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
            continue
        if arg.startswith('lsm='):
            if lsm:fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
            items=arg[4:].split(',')
            if not items or any(not re.fullmatch('[a-z_]+',item) for item in items):fail()
            if 'apparmor' not in items:items.append('apparmor')
            arg='lsm='+','.join(items);lsm=True
        updated.append(arg)
    if not lsm:updated.append('lsm=landlock,lockdown,yama,integrity,apparmor,bpf')
    updated+=['apparmor=1','security=apparmor']
    lines[i]=match.group(1)+' '.join(updated)+match.group(3)
    return ''.join(lines).encode()
def environment():
    release=Path('/etc/alpine-release').read_text().strip()
    if '.'.join(release.split('.')[:2]) not in ['3.22','3.23','3.24']:fail('HARDENING_RECIPE_UNSUPPORTED')
    if Path('/sys/module/apparmor/parameters/enabled').read_text().strip() not in ['Y','N']:fail('HARDENING_APPARMOR_KERNEL_UNSUPPORTED')
    if not Path('/etc/init.d/apparmor').is_file() or not any(Path(p).is_file() for p in ['/sbin/apparmor_parser','/usr/sbin/apparmor_parser']):fail('HARDENING_APPARMOR_TOOLS_REQUIRED')
    # Avoid editing generated/ambiguous boot arrangements or upgrading kernels.
    if Path('/etc/update-extlinux.conf').exists() or Path('/boot/grub/grub.cfg').exists():fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
    for path in ['/', '/boot']:
        space=os.statvfs(path)
        if space.f_flag&os.ST_RDONLY:fail('HARDENING_FILESYSTEM_READONLY')
        if space.f_bavail*space.f_frsize<64*1024*1024 or space.f_favail<128:fail('HARDENING_DISK_LOW')
def empty_remote():
    inventory=json.loads(command(['incus','list','--all-projects','--format=json']))
    if not isinstance(inventory,list) or inventory:fail('HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED')

def assert_customer_baseline(customers, prepared=False, preparing=False):
    if not customers:return empty_remote()
    inventory=json.loads(command(['incus','list','--all-projects','--format=json']))
    if not isinstance(inventory,list) or len(inventory)!=len(customers):fail('HARDENING_IDENTITY_CHANGED')
    for customer,remote in zip(customers,inventory):
        if not isinstance(remote,dict):fail()
        config=remote.get('config');effective=remote.get('expanded_config',config)
        if not isinstance(config,dict) or not isinstance(effective,dict):fail()
        if remote.get('project','default')!='default' or remote.get('name')!=customer['name'] or remote.get('type')!='container' or config.get('volatile.uuid')!=customer['uuid'] or config.get('user.payincus.provisioning-attempt')!=customer['attempt']:fail('HARDENING_IDENTITY_CHANGED')
        if remote.get('ephemeral') is not False:fail('HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED')
        if remote.get('status')!=('Running' if customer['state']=='running' else 'Stopped'):fail('HARDENING_BUSY')
        if prepared:
            if effective.get('boot.autostart') not in ['false','0']:fail('HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED')
        elif config.get('boot.autostart') not in ([customer['autostart'],'false'] if preparing else [customer['autostart']]):fail('HARDENING_IDENTITY_CHANGED')
        if effective.get('security.privileged','false') not in ['false','0']:fail('HARDENING_GUEST_RUNTIME_UNSAFE')

def guest_guard(remote):
    config=remote.get('config');effective=remote.get('expanded_config',config)
    if not isinstance(config,dict) or not isinstance(effective,dict):fail()
    guarded={key:value for key,value in effective.items() if key!='boot.autostart' and
        (re.match(r'^(limits\.|security\.|boot\.|environment\.|raw\.|linux\.|nvidia\.)',key) or
        re.match(r'^volatile\..+\.(hwaddr|last_state\.(ip_addresses|hwaddr))$',key) or
        re.match(r'^volatile\.(idmap|last_state\.idmap)',key))}
    return digest(json.dumps([remote.get('type'),remote.get('profiles'),remote.get('expanded_devices',remote.get('devices')),
        guarded,config.get('volatile.uuid'),config.get('user.payincus.provisioning-attempt')],sort_keys=True,separators=(',',':')).encode())

def local_incus(method,path,body=None,etag=None):
    """Root-owned local socket, bounded response, exact ETag for config CAS."""
    address=Path('/var/lib/incus/unix.socket')
    info=address.lstat()
    if info.st_uid!=0 or not stat.S_ISSOCK(info.st_mode) or stat.S_ISLNK(info.st_mode):fail()
    for parent in address.parents:
        item=parent.lstat()
        if item.st_uid!=0 or stat.S_ISLNK(item.st_mode) or item.st_mode&0o022:fail()
    connection=http.client.HTTPConnection('localhost',timeout=15)
    connection.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);connection.sock.settimeout(15)
    try:
        connection.sock.connect(str(address))
        headers={'Content-Type':'application/json'}
        if etag:headers['If-Match']=etag
        connection.request(method,path,json.dumps(body).encode() if body is not None else None,headers)
        response=connection.getresponse();data=response.read(1048577)
        if len(data)>1048576 or response.status>=400:fail('HARDENING_IDENTITY_CHANGED' if response.status==412 else 'HARDENING_PREPARE_FAILED')
        result=json.loads(data)
        if result.get('type')=='error':fail('HARDENING_PREPARE_FAILED')
        return result,response.getheader('ETag')
    finally:connection.close()

def guest_read(customer):
    result,etag=local_incus('GET','/1.0/instances/'+customer['name'])
    remote=result.get('metadata')
    if not isinstance(remote,dict) or not etag or remote.get('name')!=customer['name'] or remote.get('type')!='container':fail()
    if remote.get('ephemeral') is not False:fail('HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED')
    config=remote.get('config',{})
    if config.get('volatile.uuid')!=customer['uuid'] or config.get('user.payincus.provisioning-attempt')!=customer['attempt']:fail('HARDENING_IDENTITY_CHANGED')
    return remote,etag

def customer_boot_change(customer,saved,restore=False):
    remote,etag=guest_read(customer);current=remote['config'].get('boot.autostart')
    original=customer['autostart'];wanted=original if restore else 'false'
    if guest_guard(remote)!=saved['guardHash'] or current not in [original,'false']:fail('HARDENING_IDENTITY_CHANGED')
    if current!=wanted:
        config=dict(remote['config'])
        if wanted is None:config.pop('boot.autostart',None)
        else:config['boot.autostart']=wanted
        fields=['architecture','description','devices','ephemeral','profiles']
        if any(key not in remote for key in fields):fail()
        result,_=local_incus('PUT','/1.0/instances/'+customer['name'],{**{key:remote[key] for key in fields},'config':config},etag)
        if result.get('type')=='async':
            operation=result.get('operation')
            if not isinstance(operation,str) or not re.fullmatch(r'/1\.0/operations/[a-f0-9-]{36}',operation):fail()
            end=time.monotonic()+20
            while True:
                status,_=local_incus('GET',operation);metadata=status.get('metadata',{})
                if metadata.get('status')=='Success':break
                if metadata.get('status') in ['Failure','Cancelled'] or time.monotonic()>=end:fail('HARDENING_PREPARE_INCOMPLETE')
                time.sleep(0.2)
    after,_=guest_read(customer)
    if guest_guard(after)!=saved['guardHash'] or after['config'].get('boot.autostart')!=wanted:fail('HARDENING_IDENTITY_CHANGED')

def customer_boot_records(customers):
    records=[]
    for customer in customers:
        remote,_=guest_read(customer)
        if remote['config'].get('boot.autostart')!=customer['autostart']:fail('HARDENING_IDENTITY_CHANGED')
        records.append({'name':customer['name'],'guardHash':guest_guard(remote)})
    return records
def receipt(value, state):
    return {'nodeId':value['nodeId'],'requestId':value['requestId'],'identityHash':value['identityHash'],
        'prepareHash':state['prepareHash'],'originalBootId':state['identity']['bootId'],'bootId':boot(),
        'architecture':value['architecture'],'recipe':RECIPE,'phase':state['phase']}
def runlevel_enabled():
    link=Path('/etc/runlevels/boot/apparmor')
    if not link.exists() and not link.is_symlink():return False
    for parent in link.parents:
        info=parent.lstat()
        if info.st_uid!=0 or stat.S_ISLNK(info.st_mode) or info.st_mode&0o022:fail()
    info=link.lstat()
    if info.st_uid!=0 or not stat.S_ISLNK(info.st_mode) or link.resolve()!=Path('/etc/init.d/apparmor').resolve():fail()
    protected(Path('/etc/init.d/apparmor'))
    return True
def execute(raw):
    value=request(raw);identity(value)
    if os.getuid()!=0:fail()
    ROOT.mkdir(mode=0o700,exist_ok=True);protected(ROOT,True)
    lock=ROOT/'maintenance.lock';fd=os.open(lock,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        protected(lock)
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:fail('HARDENING_REMOTE_BUSY')
        journal=ROOT/'maintenance.json';state=None
        if journal.exists():state=json.loads(read(journal))
        expected={key:value[key] for key in ['nodeId','requestId','identityHash','bootId','architecture','recipe','customers']}
        if state and (not isinstance(state,dict) or state.get('version')!=1 or state.get('identity')!=expected or
            state.get('phase') not in ['preparing','prepared','reboot-intent','customers-restored','rolled-back'] or
            not isinstance(state.get('customerBoot'),list) or len(state['customerBoot'])!=len(value['customers']) or
            any(not isinstance(saved,dict) or set(saved)!={'name','guardHash'} or saved['name']!=customer['name'] or
                not isinstance(saved['guardHash'],str) or not re.fullmatch('[a-f0-9]{64}',saved['guardHash'])
                for customer,saved in zip(value['customers'],state['customerBoot'])) or
            type(state.get('runlevelBefore')) is not bool or type(state.get('bootMode')) is not int or
            state['bootMode'] not in [0o600,0o640,0o644] or
            any(not isinstance(state.get(key),str) or not re.fullmatch('[a-f0-9]{64}',state[key]) for key in ['beforeHash','afterHash','prepareHash'])):fail()
        def persist():identity(value);atomic(journal,json.dumps(state,separators=(',',':')).encode())
        def finish_preparation():
            # A lost reply may leave our exact before/after bytes. Under the
            # inherited lock, finish only this journal's deterministic change.
            if boot()!=value['bootId']:fail('HARDENING_IDENTITY_CHANGED')
            environment();assert_customer_baseline(value['customers'],preparing=True);path=Path('/boot/extlinux.conf');current=read(path);before=read(ROOT/'extlinux.before')
            if (digest(before)!=state['beforeHash'] or digest(prepare_boot(before))!=state['afterHash'] or
                digest(current) not in [state['beforeHash'],state['afterHash']] or path.stat().st_mode&0o777!=state['bootMode']):fail()
            enabled=runlevel_enabled()
            if state['runlevelBefore'] and not enabled:fail()
            if not enabled:
                command(['rc-update','add','apparmor','boot'])
                if not runlevel_enabled():fail('HARDENING_PREPARE_INCOMPLETE')
            for customer,saved in zip(value['customers'],state['customerBoot']):customer_boot_change(customer,saved)
            assert_customer_baseline(value['customers'],prepared=True)
            if digest(current)==state['beforeHash']:atomic(path,prepare_boot(before),state['bootMode'])
            if digest(read(path))!=state['afterHash']:fail()
            state['phase']='prepared';persist()
        if value['action']=='prepare':
            if state:
                if value['prepareHash'] not in [None,'0'*64,state['prepareHash']]:fail()
                if state.get('phase') not in ['prepared','preparing','reboot-intent','customers-restored','rolled-back']:fail()
                if state['phase']=='preparing':
                    finish_preparation()
                return receipt(value,state)
            if boot()!=value['bootId']:fail('HARDENING_IDENTITY_CHANGED')
            environment();assert_customer_baseline(value['customers']);path=Path('/boot/extlinux.conf');before=read(path);after=prepare_boot(before)
            # Save the original file before any modification. A changed file
            # between inspection and writing cannot be overwritten.
            backup=ROOT/'extlinux.before';atomic(backup,before)
            before_hash=digest(before);after_hash=digest(after);runlevel_before=runlevel_enabled();mode=path.stat().st_mode&0o777
            if mode not in [0o600,0o640,0o644]:fail()
            state={'version':1,'identity':expected,'phase':'preparing','beforeHash':before_hash,'afterHash':after_hash,
                'customerBoot':customer_boot_records(value['customers']),
                'runlevelBefore':runlevel_before,'bootMode':mode,
                'prepareHash':digest(json.dumps([expected,before_hash,after_hash,runlevel_before,mode],sort_keys=True).encode())}
            persist()
            finish_preparation();return receipt(value,state)
        if not state or value['prepareHash']!=state.get('prepareHash'):fail()
        if value['action']=='status':return receipt(value,state)
        if value['action']=='restore-customers':
            if state['phase'] not in ['reboot-intent','customers-restored'] or boot()==value['bootId']:fail()
            for customer,saved in zip(value['customers'],state['customerBoot']):customer_boot_change(customer,saved,restore=True)
            state['phase']='customers-restored';persist();return receipt(value,state)
        if value['action']=='rollback':
            if state['phase']=='rolled-back':return receipt(value,state)
            if state['phase'] not in ['prepared','preparing'] or boot()!=value['bootId']:fail()
            path=Path('/boot/extlinux.conf')
            if digest(read(path)) not in [state['beforeHash'],state['afterHash']]:fail()
            before=read(ROOT/'extlinux.before')
            if digest(before)!=state['beforeHash']:fail()
            if path.stat().st_mode&0o777!=state['bootMode']:fail()
            enabled=runlevel_enabled()
            if state['runlevelBefore'] and not enabled:fail()
            if not state['runlevelBefore'] and enabled:
                command(['rc-update','del','apparmor','boot'])
                if runlevel_enabled():fail('HARDENING_PREPARE_INCOMPLETE')
            for customer,saved in zip(value['customers'],state['customerBoot']):customer_boot_change(customer,saved,restore=True)
            atomic(path,before,state['bootMode']);state['phase']='rolled-back';persist();return receipt(value,state)
        if state['phase'] in ['reboot-intent','customers-restored'] or boot()!=value['bootId']:return receipt(value,state)
        if state['phase']!='prepared' or digest(read(Path('/boot/extlinux.conf')))!=state['afterHash'] or not runlevel_enabled():fail()
        if time.time()*1000>=value['expiresAt']:fail('HARDENING_REQUEST_EXPIRED')
        identity(value);assert_customer_baseline(value['customers'],prepared=True)
        # fsync the single intent before launching the fixed reboot. A lost
        # response, old DB or expired lease cannot enter this branch again.
        state['phase']='reboot-intent';persist()
        subprocess.Popen(['/sbin/reboot'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,pass_fds=(fd,))
        return receipt(value,state)
    finally:os.close(fd)
def main():
    data=sys.stdin.buffer.read(8193)
    if len(data)>8192:fail()
    try:print(json.dumps(execute(json.loads(data))))
    except Exception as error:
        code=str(error)
        print(json.dumps({'error':code if re.fullmatch('HARDENING_[A-Z_]{1,90}',code) else 'HARDENING_PREPARE_FAILED'}));raise SystemExit(1)
if __name__=='__main__':main()
