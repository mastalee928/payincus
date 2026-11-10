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
GRUB_RECIPE = 'alpine-apparmor-grub-v1'
APPARMOR_PACKAGES = ['apparmor','apparmor-openrc','apparmor-profiles-tunables','apparmor-profiles-abstractions','apparmor-profiles-api']
UUID = re.compile(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}')
def fail(code='HARDENING_JOURNAL_CONFLICT'): raise ValueError(code)
def digest(data): return hashlib.sha256(data).hexdigest()
def require_current_request(value):
    if time.time()*1000>=value['expiresAt']:fail('HARDENING_REQUEST_EXPIRED')
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
    if value['recipe'] not in [RECIPE,GRUB_RECIPE] or value['architecture'] not in ['x86_64','aarch64']:fail('HARDENING_RECIPE_UNSUPPORTED')
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
    if any(Path(path).exists() for path in ['/opt/incudal','/usr/local/sbin/incudal-onboarding-gateway',
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
def security_arguments(args):
    result=[];seen=set()
    for arg in args:
        if not re.fullmatch(r'[a-zA-Z0-9_=,.:/+@%-]+',arg):fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
        key=arg.split('=',1)[0]
        if key in ['apparmor','security','lsm']:
            if key in seen:fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
            seen.add(key)
        if key=='apparmor':
            if arg not in ['apparmor=0','apparmor=1']:fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
            continue
        if key=='security':
            if arg not in ['security=apparmor','security=none']:fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
            continue
        if key=='lsm':
            items=arg[4:].split(',')
            if not items or len(items)!=len(set(items)) or any(not re.fullmatch('[a-z_]+',item) for item in items) or any(item in items for item in ['selinux','smack','tomoyo']):fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
            if 'apparmor' not in items:items.append('apparmor')
            arg='lsm='+','.join(items)
        result.append(arg)
    if 'lsm' not in seen:result.append('lsm=landlock,lockdown,yama,loadpin,safesetid,integrity,apparmor,bpf')
    return result+['apparmor=1','security=apparmor']

def prepare_grub_defaults(data):
    text=data.decode('utf-8')
    if '\r' in text or '\x00' in text:fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
    pattern=r'^(GRUB_CMDLINE_LINUX_DEFAULT=)([\"\'])([^\n]*?)\2[ \t]*$'
    matches=list(re.finditer(pattern,text,re.M))
    if len(matches)!=1 or len(re.findall(r'^\s*GRUB_CMDLINE_LINUX_DEFAULT\s*=',text,re.M))!=1:fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
    # A second command-line source cannot silently override the managed value.
    for line in text.splitlines():
        if re.match(r'^\s*GRUB_CMDLINE_LINUX\s*=',line) and not re.fullmatch(r'GRUB_CMDLINE_LINUX=(?:""|\'\')[ \t]*',line):fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
    match=matches[0];updated=' '.join(security_arguments(match[3].split()))
    return (text[:match.start()]+match[1]+match[2]+updated+match[2]+text[match.end():]).encode()

def prepare_grub_config(data):
    text=data.decode('utf-8')
    if '\r' in text or '\x00' in text:fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
    pattern=r'^([ \t]*linux(?:efi)?[ \t]+)(/[^\s]+)([ \t]+)([^\n]+)$'
    matches=list(re.finditer(pattern,text,re.M))
    # One actual Linux entry plus an optional firmware menu. No guessing an
    # alternative kernel/root; preserve every byte outside the argument line.
    if len(matches)!=1 or len(re.findall(r'^\s*initrd(?:efi)?\s+/[^\s]+\s*$',text,re.M))!=1:fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
    match=matches[0]
    if not re.fullmatch(r'/boot/vmlinuz-(virt|lts)',match[2]):fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
    if len([arg for arg in match[4].split() if arg.startswith('root=')])!=1:fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
    return (text[:match.start()]+match[1]+match[2]+match[3]+' '.join(security_arguments(match[4].split()))+text[match.end():]).encode()

def boot_path(value):return Path('/boot/grub/grub.cfg' if value['recipe']==GRUB_RECIPE else '/boot/extlinux.conf')
def boot_before(value):return ROOT/('grub.before' if value['recipe']==GRUB_RECIPE else 'extlinux.before')
def prepare_boot_for(value,data):return prepare_grub_config(data) if value['recipe']==GRUB_RECIPE else prepare_boot(data)

def grub_defaults_state(value):
    if value['recipe']!=GRUB_RECIPE:return None
    path=Path('/etc/default/grub');before=read(path);after=prepare_grub_defaults(before);mode=path.stat().st_mode&0o777
    if mode not in [0o600,0o640,0o644]:fail()
    atomic(ROOT/'grub-defaults.before',before)
    return {'beforeHash':digest(before),'afterHash':digest(after),'mode':mode}

def grub_defaults_check(state,write=False,restore=False):
    saved=state.get('grubDefaults')
    if saved is None:return
    if not isinstance(saved,dict) or set(saved)!={'beforeHash','afterHash','mode'} or saved['mode'] not in [0o600,0o640,0o644]:fail()
    path=Path('/etc/default/grub');before=read(ROOT/'grub-defaults.before');after=prepare_grub_defaults(before);current=read(path)
    if digest(before)!=saved['beforeHash'] or digest(after)!=saved['afterHash'] or digest(current) not in [saved['beforeHash'],saved['afterHash']] or path.stat().st_mode&0o777!=saved['mode']:fail()
    wanted=before if restore else after
    if write and current!=wanted:atomic(path,wanted,saved['mode'])

def installed_packages():
    output=command(['apk','info','-v'])
    lines=output.decode().splitlines()
    if not lines or any(not re.fullmatch(r'[a-zA-Z0-9+_.-]+-[0-9][a-zA-Z0-9+_.~-]*',line) for line in lines):fail('HARDENING_APPARMOR_TOOLS_REQUIRED')
    return sorted(lines)

def apparmor_tools_ready():
    if not Path('/etc/init.d/apparmor').is_file() or not any(Path(p).is_file() for p in ['/sbin/apparmor_parser','/usr/sbin/apparmor_parser']):return False
    if not Path('/etc/apparmor.d/tunables/global').is_file() or not Path('/etc/apparmor.d/abstractions/base').is_file():return False
    packages=subprocess.run(['apk','info','-e',*APPARMOR_PACKAGES,'libapparmor'],capture_output=True,timeout=10,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'})
    if packages.returncode:return False
    return True

def ensure_grub_tools(lock_fd,state,persist,allowed=lambda:None):
    # Signed official same-branch packages only. No kernel/Incus/SSH upgrade,
    # and the child retains the root maintenance lock if transport is lost.
    branch='.'.join(Path('/etc/alpine-release').read_text().strip().split('.')[:2])
    if branch not in ['3.22','3.23','3.24']:fail('HARDENING_RECIPE_UNSUPPORTED')
    if Path('/sys/module/apparmor/parameters/enabled').read_text().strip() not in ['Y','N']:fail('HARDENING_APPARMOR_KERNEL_UNSUPPORTED')
    for path in ['/', '/boot']:
        space=os.statvfs(path)
        if space.f_flag&os.ST_RDONLY:fail('HARDENING_FILESYSTEM_READONLY')
        if space.f_bavail*space.f_frsize<134217728 or space.f_favail<512:fail('HARDENING_DISK_LOW')
    # A completed/partially installed plan must still prove its original
    # package baseline. Tool presence alone cannot bypass that transaction.
    plan=state.get('dependencyPlan')
    if plan is None and apparmor_tools_ready():
        allowed()
        command(['apparmor_parser','-Q','-T','-j','1','/etc/apparmor.d'],timeout=15)
        return False
    mem=re.search(r'^MemAvailable:\s+(\d+) kB$',Path('/proc/meminfo').read_text(),re.M)
    if not mem or int(mem[1])<131072:fail('HARDENING_MEMORY_LOW')
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():continue
        try:name=(process/'comm').read_text().strip()
        except OSError:continue
        if name in ['apk','apt','apt-get','dpkg','rpm','dnf']:fail('HARDENING_PACKAGE_BUSY')
    repositories=ROOT/'apparmor.repositories'
    allowed()
    atomic(repositories,('https://dl-cdn.alpinelinux.org/alpine/v'+branch+'/main\nhttps://dl-cdn.alpinelinux.org/alpine/v'+branch+'/community\n').encode())
    # Simulate the signed dependency transaction first. Installing a missing
    # dependency is fine; replacing existing packages is a separate operation.
    if plan is None:
        # One bounded request only discovers the signed transaction. Persist
        # exact versions and the installed package baseline before yielding;
        # installation never shares the simulation's remaining time budget.
        before=installed_packages()
        allowed()
        simulated=subprocess.run(['apk','--simulate','--no-cache','--repositories-file',str(repositories),'add',*APPARMOR_PACKAGES],capture_output=True,timeout=30,pass_fds=(lock_fd,),env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'})
        if simulated.returncode:fail('HARDENING_APPARMOR_TOOLS_REQUIRED')
        simulation=(simulated.stdout+simulated.stderr).decode(errors='replace')
        if re.search(r'\b(Upgrading|Downgrading|Purging|Reinstalling)\b',simulation):fail('HARDENING_APPARMOR_TOOLS_REQUIRED')
        packages=re.findall(r'Installing ([a-zA-Z0-9+_.-]+) \(([0-9][a-zA-Z0-9+_.~-]*)\)',simulation)
        if not packages or len(packages)>20 or len(packages)!=len(set(name for name,_ in packages)) or installed_packages()!=before:fail('HARDENING_PACKAGE_BUSY')
        state['dependencyPlan']={'packages':[name+'='+version for name,version in packages],'installed':before,'phase':'planned'}
        persist();return True
    if not isinstance(plan,dict) or set(plan) not in [{'packages','installed'},{'packages','installed','phase'}] or plan.get('phase','planned') not in ['planned','installed','verified'] or not isinstance(plan['packages'],list) or not 1<=len(plan['packages'])<=20 or any(not isinstance(p,str) or not re.fullmatch(r'[a-zA-Z0-9+_.-]+=[0-9][a-zA-Z0-9+_.~-]*',p) for p in plan['packages']) or not isinstance(plan['installed'],list) or not plan['installed'] or any(not isinstance(p,str) or not re.fullmatch(r'[a-zA-Z0-9+_.-]+-[0-9][a-zA-Z0-9+_.~-]*',p) for p in plan['installed']):fail()
    if len({p.split('=',1)[0] for p in plan['packages']})!=len(plan['packages']) or len(set(plan['installed']))!=len(plan['installed']):fail()
    current=installed_packages();new={p.replace('=','-',1) for p in plan['packages']}
    # Interrupted install may have added a subset of exactly planned packages.
    # Existing packages cannot be upgraded/downgraded or silently replaced.
    if not set(plan['installed']).issubset(current) or set(current)-set(plan['installed'])-new:fail('HARDENING_PACKAGE_BUSY')
    complete=set(current)==set(plan['installed'])|new
    if complete:
        if not apparmor_tools_ready():fail('HARDENING_APPARMOR_TOOLS_REQUIRED')
        if plan.get('phase')=='verified':return False
        # Compilation is its own bounded request after installation, never
        # shares apk's 35-second budget. Use one worker on small hosts.
        allowed()
        command(['apparmor_parser','-Q','-T','-j','1','/etc/apparmor.d'],timeout=15)
        plan['phase']='verified';persist();return True
    if plan.get('phase','planned')!='planned':fail('HARDENING_APPARMOR_TOOLS_REQUIRED')
    allowed()
    result=subprocess.run(['timeout','30','apk','--no-cache','--repositories-file',str(repositories),'add',*plan['packages']],capture_output=True,timeout=35,pass_fds=(lock_fd,),env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'})
    if result.returncode:fail('HARDENING_APPARMOR_TOOLS_REQUIRED')
    if set(installed_packages())!=set(plan['installed'])|new:fail('HARDENING_PACKAGE_BUSY')
    plan['phase']='installed';persist()
    return True

def environment(value=None):
    release=Path('/etc/alpine-release').read_text().strip()
    if '.'.join(release.split('.')[:2]) not in ['3.22','3.23','3.24']:fail('HARDENING_RECIPE_UNSUPPORTED')
    if Path('/sys/module/apparmor/parameters/enabled').read_text().strip() not in ['Y','N']:fail('HARDENING_APPARMOR_KERNEL_UNSUPPORTED')
    if not apparmor_tools_ready():fail('HARDENING_APPARMOR_TOOLS_REQUIRED')
    # Avoid editing generated/ambiguous boot arrangements or upgrading kernels.
    if not value or value['recipe']==RECIPE:
        if Path('/etc/update-extlinux.conf').exists() or Path('/boot/grub/grub.cfg').exists():fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
    else:
        if Path('/boot/extlinux.conf').exists() or Path('/boot/loader/loader.conf').exists():fail('HARDENING_BOOT_LAYOUT_UNSUPPORTED')
        command(['grub-script-check','/boot/grub/grub.cfg'])
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

def customer_boot_change(customer,saved,restore=False,allowed=lambda:None):
    remote,etag=guest_read(customer);current=remote['config'].get('boot.autostart')
    original=customer['autostart'];wanted=original if restore else 'false'
    if guest_guard(remote)!=saved['guardHash'] or current not in [original,'false']:fail('HARDENING_IDENTITY_CHANGED')
    if current!=wanted:
        config=dict(remote['config'])
        if wanted is None:config.pop('boot.autostart',None)
        else:config['boot.autostart']=wanted
        fields=['architecture','description','devices','ephemeral','profiles']
        if any(key not in remote for key in fields):fail()
        allowed()
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
        'architecture':value['architecture'],'recipe':value['recipe'],'phase':state['phase']}
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
            state['bootMode'] not in [0o600,0o640,0o644,0o700] or
            any(not isinstance(state.get(key),str) or not re.fullmatch('[a-f0-9]{64}',state[key]) for key in ['beforeHash','afterHash','prepareHash'])):fail()
        if state and (value['recipe']==GRUB_RECIPE)!=('grubDefaults' in state):fail()
        if value['action']=='status' and value['prepareHash']=='0'*64:
            # Full original identity above remains mandatory. Discovery must
            # never finish preparation or create a new maintenance journal.
            return receipt(value,state or {'prepareHash':'0'*64,'identity':expected,'phase':'absent'})
        def persist():identity(value);atomic(journal,json.dumps(state,separators=(',',':')).encode())
        def finish_preparation():
            # A lost reply may leave our exact before/after bytes. Under the
            # inherited lock, finish only this journal's deterministic change.
            if boot()!=value['bootId']:fail('HARDENING_IDENTITY_CHANGED')
            require_current_request(value)
            # Persisted preparation owns dependency installation too. Return
            # after that bounded transaction; boot/customer changes happen on
            # the next request, within the gateway's separate time budget.
            if value['recipe']==GRUB_RECIPE and ensure_grub_tools(fd,state,persist,lambda:require_current_request(value)):return
            environment(value);assert_customer_baseline(value['customers'],preparing=True);path=boot_path(value);current=read(path);before=read(boot_before(value))
            grub_defaults_check(state)
            if (digest(before)!=state['beforeHash'] or digest(prepare_boot_for(value,before))!=state['afterHash'] or
                digest(current) not in [state['beforeHash'],state['afterHash']] or path.stat().st_mode&0o777!=state['bootMode']):fail()
            enabled=runlevel_enabled()
            if state['runlevelBefore'] and not enabled:fail()
            require_current_request(value)
            if not enabled:
                command(['rc-update','add','apparmor','boot'])
                if not runlevel_enabled():fail('HARDENING_PREPARE_INCOMPLETE')
            for customer,saved in zip(value['customers'],state['customerBoot']):
                customer_boot_change(customer,saved,allowed=lambda:require_current_request(value))
            assert_customer_baseline(value['customers'],prepared=True)
            require_current_request(value)
            grub_defaults_check(state,write=True)
            # Customer/API and runlevel checks above can take time. Compare
            # fresh bytes and mode before replacing the original boot file.
            current=read(path)
            if digest(current) not in [state['beforeHash'],state['afterHash']] or path.stat().st_mode&0o777!=state['bootMode']:fail()
            require_current_request(value)
            if digest(current)==state['beforeHash']:atomic(path,prepare_boot_for(value,before),state['bootMode'])
            if digest(read(path))!=state['afterHash']:fail()
            if value['recipe']==GRUB_RECIPE:command(['grub-script-check',str(path)])
            state['phase']='prepared';persist()
        if value['action']=='prepare':
            if state:
                if value['prepareHash'] not in [None,'0'*64,state['prepareHash']]:fail()
                if state.get('phase') not in ['prepared','preparing','reboot-intent','customers-restored','rolled-back']:fail()
                if state['phase']=='rolled-back':
                    # A fresh controller retry may reuse only this exact
                    # pre-reboot baseline. Never overwrite a newer boot,
                    # customer, runlevel, file mode or administrator edit.
                    if boot()!=value['bootId']:fail('HARDENING_IDENTITY_CHANGED')
                    if type(state.get('rolledBackAt')) is not int or time.time()*1000<state['rolledBackAt']+120000:fail('HARDENING_REMOTE_BUSY')
                    retries=state.get('preparationRetries',0)
                    if type(retries) is not int or retries<0 or retries>=2:fail('HARDENING_RETRY_EXHAUSTED')
                    assert_customer_baseline(value['customers'])
                    if digest(read(boot_path(value)))!=state['beforeHash'] or boot_path(value).stat().st_mode&0o777!=state['bootMode'] or runlevel_enabled()!=state['runlevelBefore']:fail()
                    grub_defaults_check(state)
                    if value['recipe']==GRUB_RECIPE and digest(read(Path('/etc/default/grub')))!=state['grubDefaults']['beforeHash']:fail()
                    for customer,saved in zip(value['customers'],state['customerBoot']):
                        remote,_=guest_read(customer)
                        if guest_guard(remote)!=saved['guardHash']:fail('HARDENING_IDENTITY_CHANGED')
                    state['preparationRetries']=retries+1;state['phase']='preparing';persist()
                if state['phase']=='preparing':
                    finish_preparation()
                return receipt(value,state)
            if boot()!=value['bootId']:fail('HARDENING_IDENTITY_CHANGED')
            assert_customer_baseline(value['customers'])
            path=boot_path(value);before=read(path);after=prepare_boot_for(value,before)
            defaults=grub_defaults_state(value)
            if value['recipe']!=GRUB_RECIPE:environment(value)
            require_current_request(value)
            # Save the original file before any modification. A changed file
            # between inspection and writing cannot be overwritten.
            backup=boot_before(value);atomic(backup,before)
            before_hash=digest(before);after_hash=digest(after);runlevel_before=runlevel_enabled();mode=path.stat().st_mode&0o777
            # Alpine grub-mkconfig also emits root-only executable (0700)
            # configuration files. Preserve it; never grant group/world write.
            if mode not in [0o600,0o640,0o644,0o700]:fail()
            state={'version':1,'identity':expected,'phase':'preparing','beforeHash':before_hash,'afterHash':after_hash,
                'customerBoot':customer_boot_records(value['customers']),
                **({'grubDefaults':defaults} if defaults is not None else {}),
                'runlevelBefore':runlevel_before,'bootMode':mode,
                'prepareHash':digest(json.dumps([expected,before_hash,after_hash,runlevel_before,mode,defaults],sort_keys=True).encode())}
            persist()
            finish_preparation();return receipt(value,state)
        if not state or value['prepareHash']!=state.get('prepareHash'):fail()
        if value['action']=='status':return receipt(value,state)
        if value['action']=='restore-customers':
            if state['phase'] not in ['reboot-intent','customers-restored'] or boot()==value['bootId']:fail()
            if not value['customers']:empty_remote()
            for customer,saved in zip(value['customers'],state['customerBoot']):customer_boot_change(customer,saved,restore=True)
            state['phase']='customers-restored';persist();return receipt(value,state)
        if value['action']=='rollback':
            if state['phase']=='rolled-back':return receipt(value,state)
            if state['phase'] not in ['prepared','preparing'] or boot()!=value['bootId']:fail()
            path=boot_path(value);grub_defaults_check(state)
            if digest(read(path)) not in [state['beforeHash'],state['afterHash']]:fail()
            before=read(boot_before(value))
            if digest(before)!=state['beforeHash']:fail()
            if path.stat().st_mode&0o777!=state['bootMode']:fail()
            enabled=runlevel_enabled()
            if state['runlevelBefore'] and not enabled:fail()
            if not state['runlevelBefore'] and enabled:
                command(['rc-update','del','apparmor','boot'])
                if runlevel_enabled():fail('HARDENING_PREPARE_INCOMPLETE')
            for customer,saved in zip(value['customers'],state['customerBoot']):customer_boot_change(customer,saved,restore=True)
            grub_defaults_check(state,write=True,restore=True)
            # Runlevel/customer recovery can wait on external processes. Do
            # not replace an administrator edit made during that interval.
            if digest(read(path)) not in [state['beforeHash'],state['afterHash']] or path.stat().st_mode&0o777!=state['bootMode']:fail()
            atomic(path,before,state['bootMode']);state['phase']='rolled-back';state['rolledBackAt']=int(time.time()*1000);persist();return receipt(value,state)
        if state['phase'] in ['reboot-intent','customers-restored'] or boot()!=value['bootId']:return receipt(value,state)
        if state['phase']!='prepared' or digest(read(boot_path(value)))!=state['afterHash'] or not runlevel_enabled():fail()
        grub_defaults_check(state)
        if value['recipe']==GRUB_RECIPE and digest(read(Path('/etc/default/grub')))!=state['grubDefaults']['afterHash']:fail()
        if time.time()*1000>=value['expiresAt']:fail('HARDENING_REQUEST_EXPIRED')
        identity(value);assert_customer_baseline(value['customers'],prepared=True)
        if time.time()*1000>=value['expiresAt']:fail('HARDENING_REQUEST_EXPIRED')
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
