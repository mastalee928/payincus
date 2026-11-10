"""Local disposable netns packet test; never execute on a real host namespace."""
import os, pathlib, subprocess, sys, time, select, json
assert os.environ.get('INCUDAL_GUEST_GUARD_NETNS') == '1'
root=pathlib.Path(sys.argv[1]); children=[]
slow=10 if os.environ.get('INCUDAL_GUEST_GUARD_SLOW_VM')=='1' else 1
def run(*args,input=None,timeout=8):
 p=subprocess.run(args,input=input,text=True,capture_output=True,timeout=timeout*slow)
 assert p.returncode==0,(args,p.stderr)
 return p.stdout
def ns(pid,*args):return run('nsenter','-t',str(pid),'-n',*args)
def space():
 p=subprocess.Popen(['unshare','--net','sleep','1800']);children.append(p)
 for _ in range(100):
  if os.readlink('/proc/%d/ns/net'%p.pid)!=os.readlink('/proc/self/ns/net'):return p.pid
  time.sleep(.01)
 raise AssertionError('namespace not ready')
server=r'''
import socket,threading,time,sys
def serve(port,family):
 s=socket.socket(family);s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
 if family==socket.AF_INET6:s.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,1)
 s.bind(('::' if family==socket.AF_INET6 else '0.0.0.0',port));s.listen()
 print('READY',port,family,flush=True)
 def client(c,address):
  try:
   while True:
    d=c.recv(512)
    if not d:break
    print('HIT',port,d.decode(),flush=True);c.sendall(address[0].encode())
  except OSError:pass
  finally:c.close()
 while True:
  c,a=s.accept();threading.Thread(target=client,args=(c,a),daemon=True).start()
for port in (22,80,443,9001):
 for family in (socket.AF_INET,socket.AF_INET6):threading.Thread(target=serve,args=(port,family),daemon=True).start()
time.sleep(1800)
'''
client=r'''
import os,socket,sys
s=socket.socket(socket.AF_INET6 if ':' in sys.argv[1] else socket.AF_INET);s.settimeout(12 if os.environ.get('INCUDAL_GUEST_GUARD_SLOW_VM')=='1' else 1.2)
if len(sys.argv)>4:s.bind((sys.argv[4],0))
try:
 s.connect((sys.argv[1],int(sys.argv[2])));s.sendall(sys.argv[3].encode());print(s.recv(512).decode());sys.exit(0)
except socket.timeout:sys.exit(2)
'''
def probe(pid,addr,port,payload,allowed,source=None):
 prefix=[] if pid is None else ['nsenter','-t',str(pid),'-n']
 p=subprocess.run(prefix+['python3','-c',client,addr,str(port),payload]+([source] if source else []),text=True,capture_output=True,timeout=10*slow)
 assert p.returncode==(0 if allowed else 2),(addr,port,p.returncode,p.stderr)
 print('PASS probe',payload,flush=True)
 return p.stdout.strip()
try:
 guest,external=space(),space()
 run('ip','link','add','incusbr0','type','bridge');run('ip','addr','add','10.10.0.1/24','dev','incusbr0');run('ip','link','set','incusbr0','up')
 run('ip','link','add','vguest','type','veth','peer','name','guest0');run('ip','link','set','vguest','master','incusbr0');run('ip','link','set','vguest','up');run('ip','link','set','guest0','netns',str(guest))
 run('ip','link','add','uplink0','type','veth','peer','name','outside0');run('ip','link','set','outside0','netns',str(external));run('ip','addr','add','192.0.2.1/24','dev','uplink0');run('ip','link','set','uplink0','up')
 ns(guest,'ip','addr','add','10.10.0.2/24','dev','guest0');ns(guest,'ip','link','set','guest0','up');ns(guest,'ip','route','add','default','via','10.10.0.1')
 ns(external,'ip','addr','add','192.0.2.2/24','dev','outside0');ns(external,'ip','addr','add','192.0.2.20/32','dev','outside0');ns(external,'ip','addr','add','169.254.169.254/32','dev','outside0');ns(external,'ip','addr','add','198.18.0.2/32','dev','outside0');ns(external,'ip','link','set','outside0','up');ns(external,'ip','route','add','10.10.0.0/24','via','192.0.2.1')
 run('ip','route','add','169.254.169.254/32','via','192.0.2.2');run('ip','route','add','198.18.0.2/32','via','192.0.2.2');run('sysctl','-q','-w','net.ipv4.ip_forward=1')
 run('ip','-6','addr','add','2001:db8:1::1/64','dev','incusbr0','nodad');run('ip','-6','addr','add','2001:db8:2::1/64','dev','uplink0','nodad')
 ns(guest,'ip','-6','addr','add','2001:db8:1::2/64','dev','guest0','nodad');ns(guest,'ip','-6','route','add','default','via','2001:db8:1::1')
 ns(external,'ip','-6','addr','add','2001:db8:2::2/64','dev','outside0','nodad');ns(external,'ip','-6','addr','add','2001:db8::20/128','dev','outside0','nodad')
 ns(external,'ip','-6','route','add','2001:db8:1::/64','via','2001:db8:2::1');run('ip','-6','route','add','2001:db8::20/128','via','2001:db8:2::2');run('sysctl','-q','-w','net.ipv6.conf.all.forwarding=1')
 for pid in (guest,external):
  log=(root/('server-%s.log'%pid)).open('w')
  children.append(subprocess.Popen(['nsenter','-t',str(pid),'-n','python3','-u','-c',server],stdout=log,stderr=log))
 deadline=time.monotonic()+15*slow
 while not all((root/('server-%s.log'%pid)).read_text().count('READY')==8 for pid in (guest,external)):
  assert time.monotonic()<deadline,[(p.name,p.read_text()) for p in root.glob('server-*.log')]
  time.sleep(.05)
 assert probe(guest,'169.254.169.254',80,'baseline',True)=='10.10.0.2'
 held=r'''
import socket,pathlib,sys,time
root=pathlib.Path(sys.argv[1]);s=socket.create_connection(('169.254.169.254',80),3)
s.sendall(b'established-baseline');s.recv(512);(root/'established-ready').touch()
while not (root/'guard-applied').exists():time.sleep(.05)
s.settimeout(1.2);s.sendall(b'forbidden-established')
try:s.recv(512);sys.exit(1)
except socket.timeout:print('ESTABLISHED_BLOCKED',flush=True)
'''
 heldLog=(root/'established.log').open('w')
 heldProcess=subprocess.Popen(['nsenter','-t',str(guest),'-n','python3','-u','-c',held,str(root)],stdout=heldLog,stderr=heldLog);children.append(heldProcess)
 deadline=time.monotonic()+10*slow
 while not (root/'established-ready').exists():
  assert time.monotonic()<deadline,'established baseline not ready'
  time.sleep(.05)
 run('nft','-f',str(root/'rules.nft'))
 (root/'guard-applied').touch();assert heldProcess.wait(timeout=10*slow)==0
 probe(guest,'169.254.169.254',80,'forbidden-metadata',False)
 probe(guest,'169.254.169.254',9001,'forbidden-other-port',False)
 probe(guest,'192.0.2.20',22,'forbidden-management',False)
 probe(guest,'198.18.0.2',9001,'customer-public',True)
 probe(guest,'192.0.2.20',443,'customer-portal',True)
 probe(None,'169.254.169.254',80,'host-metadata',True)
 probe(None,'10.10.0.2',22,'host-guest-management',True)
 probe(guest,'2001:db8:2::2',9001,'customer-ipv6',True)
 probe(guest,'2001:db8::20',22,'forbidden-management-v6',False)
 probe(guest,'2001:db8::20',443,'customer-portal-v6',True)
 # Preserve actual public DNAT traversal; convert only known management source.
 run('nft','-f','-',input='table ip fixture_nat {\n chain in {\n type nat hook prerouting priority -100; policy accept;\n iifname "uplink0" ip daddr 192.0.2.1 tcp dport 22 dnat to 10.10.0.2\n }\n}\n')
 assert probe(external,'192.0.2.1',22,'management-validation',True,'192.0.2.20')=='10.10.0.1'
 assert probe(external,'192.0.2.1',22,'customer-login',True,'192.0.2.2')=='192.0.2.2'
 ns(guest,'ip','addr','add','10.10.0.3/24','dev','guest0')
 probe(guest,'169.254.169.254',80,'spoofed-source',False,'10.10.0.3')
 # Apply the real OCI full-port script in the same isolated host namespace.
 run('ip','route','add','default','via','192.0.2.2')
 run('ip','link','add','incudal-mgmt','type','dummy');run('ip','addr','add','10.253.0.2/24','dev','incudal-mgmt');run('ip','link','set','incudal-mgmt','up')
 run('nft','delete','table','ip','fixture_nat')
 run('bash',str(root/'oci-network.sh'),'--control-ip','10.253.0.1','--management-interface','incudal-mgmt','--bind-ip','192.0.2.1','--dedicated-ip','10.10.0.2',timeout=60)
 probe(None,'10.10.0.2',22,'oci-host-guest-management',True)
 probe(guest,'198.18.0.2',9001,'oci-customer-public',True)
 probe(guest,'169.254.169.254',80,'forbidden-oci-metadata',False)
 probe(guest,'192.0.2.20',22,'forbidden-oci-management',False)
 assert probe(external,'192.0.2.1',22,'oci-management-validation',True,'192.0.2.20')=='10.10.0.1'
 assert probe(external,'192.0.2.1',22,'oci-customer-login',True,'192.0.2.2')=='192.0.2.2'
 probe(guest,'2001:db8:2::2',9001,'oci-customer-public-v6',True)
 log=''.join(p.read_text() for p in root.glob('server-*.log'))
 assert all(x not in log for x in ['forbidden-metadata','forbidden-other-port','forbidden-management','spoofed-source','forbidden-established','forbidden-oci']),log
 assert 'host-metadata' in log and 'customer-public' in log,log
 print('PASS real namespace packets: metadata new/established/source changes blocked; host OCI/guest management/public/portal/IPv6 preserved; management source masked; customer source preserved')
finally:
 for p in children:
  p.terminate()
 for p in children:
  try:p.wait(timeout=3)
  except subprocess.TimeoutExpired:p.kill();p.wait()
