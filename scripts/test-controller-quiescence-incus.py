#!/usr/bin/env python3
"""Opt-in extracted Incus 6.0.4 test; runs no customer instance or host setup."""
import os,subprocess,time,json,socket,http.client,threading
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
root=Path(os.environ['INCUDAL_INCUS_TEST_ROOT']).resolve()
if os.geteuid()!=0 or os.environ.get('INCUDAL_INCUS_QUIESCENCE_TEST')!='1':raise RuntimeError('opt-in root test only')
for ns in ['net','mnt','pid']:
 parent=os.environ.get('INCUDAL_PARENT_'+ns.upper())
 if not parent or parent==os.readlink('/proc/self/ns/'+ns):raise RuntimeError('namespace isolation required')
subprocess.run(['mount','--make-rprivate','/'],check=True)
subprocess.run(['mount','--bind','/sys','/sys'],check=True)
subprocess.run(['mount','-o','remount,bind,ro','/sys'],check=True)
subprocess.run(['mount','-t','tmpfs','-o','mode=0700','tmpfs','/sys/kernel/security'],check=True)
subprocess.run(['mount','--bind','/proc/sys','/proc/sys'],check=True)
subprocess.run(['mount','-o','remount,bind,ro','/proc/sys'],check=True)
subprocess.run(['ip','link','set','lo','up'],check=True)
import tempfile
state=Path(tempfile.mkdtemp(prefix='incus-state-',dir=root))
env={**os.environ,'INCUS_DIR':str(state),'LD_LIBRARY_PATH':str(root/'rootfs/usr/lib/aarch64-linux-gnu'),'PATH':str(root/'rootfs/usr/bin')+':'+str(root/'rootfs/usr/sbin')+':'+os.environ['PATH']}
log=open(root/'daemon.log','w')
p=subprocess.Popen([str(root/'rootfs/usr/libexec/incus/incusd'),'--verbose'],env=env,stdout=log,stderr=log)
class UnixHTTP(http.client.HTTPConnection):
 def connect(self):
  self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(3);self.sock.connect(str(state/'unix.socket'))
def read(path):
 c=UnixHTTP('localhost',timeout=3);c.request('GET',path);r=c.getresponse();data=r.read();c.close();return r.status,json.loads(data)
try:
 deadline=time.time()+20
 while time.time()<deadline:
  if p.poll() is not None:raise RuntimeError('daemon exited')
  try:
   status,body=read('/1.0');break
  except (OSError,http.client.HTTPException):time.sleep(.2)
 else:raise RuntimeError('not ready')
 started=threading.Event();release=threading.Event()
 class SlowSource(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_HEAD(self):
   started.set();release.wait(10);self.send_response(200);self.end_headers()
 source=ThreadingHTTPServer(('127.0.0.1',0),SlowSource)
 threading.Thread(target=source.serve_forever,daemon=True).start()
 c=UnixHTTP('localhost',timeout=3)
 c.request('POST','/1.0/images',json.dumps({'source':{'type':'url','url':'http://127.0.0.1:'+str(source.server_port)+'/delayed'}}),{'Content-Type':'application/json'})
 r=c.getresponse();submitted=json.loads(r.read());c.close()
 if r.status!=202:raise RuntimeError('async submission failed')
 if not started.wait(5):raise RuntimeError('download task not started')
 running=read('/1.0/operations?recursion=1&all-projects=true')[1]['metadata']
 operation=submitted['operation'].rsplit('/',1)[-1]
 active=[op for entries in running.values() for op in entries if op['id']==operation and op['status_code']<200]
 if len(active)!=1:raise RuntimeError('submitted operation missing after client disconnected')
 gate=Path(os.environ['INCUDAL_QUIESCENCE_CHECK_SCRIPT']).resolve()
 def check_gate(operations,expected):
  response=subprocess.run(['node',str(gate)],input=json.dumps({'operations':operations,'expected':expected}),text=True,capture_output=True,timeout=5)
  if response.returncode:raise RuntimeError('quiescence module rejected actual Incus data')
 check_gate(running,False)
 release.set()
 deadline=time.time()+5
 while time.time()<deadline:
  state_op=read(submitted['operation'])[1]['metadata']
  if state_op['status_code']>=200:break
  time.sleep(.1)
 else:raise RuntimeError('task failed to reach final state')
 terminal=read('/1.0/operations?recursion=1&all-projects=true')[1]['metadata']
 check_gate(terminal,True)
 source.shutdown();source.server_close()
 print(json.dumps({'passed':True,'incusVersion':body['metadata']['environment']['server_version'],'realIncusOperation':True,'clientDisconnectLeavesOperationRunning':True,'quiescenceRejectsActive':True,'quiescenceAcceptsTerminalOnlyWithFencingFacts':True,'taskFinalStatus':state_op['status'],'transport':'isolated Unix socket','realGatewayTakeover':False}))
finally:
 p.terminate()
 try:p.wait(timeout=8)
 except subprocess.TimeoutExpired:p.kill();p.wait()
 log.close()
