"""Dedicated namespace only. Never invoke directly in the host namespace."""
import fcntl
import ipaddress
import json
import os
import select
import socket
import struct
import subprocess
import sys
from pathlib import Path

if os.environ.get("INCUDAL_ABUSE_NETNS_INNER") != "1":
    raise SystemExit("requires the Go test's isolated namespace")

root = Path(sys.argv[1])
children = []

def run(*args, input=None):
    result = subprocess.run(args, input=input, text=True, capture_output=True)
    if result.returncode:
        raise AssertionError(("fixture command failed", args, result.returncode, result.stderr))
    return result.stdout

def ns(pid, *args):
    return run("nsenter", "-t", str(pid), "-n", *args)

def space():
    p = subprocess.Popen(["unshare", "--net", "sleep", "90"])
    children.append(p)
    # A process existing does not mean unshare has completed. Wait for its
    # namespace identity to differ, without touching the parent namespace.
    import time
    for _ in range(100):
        if os.readlink(f"/proc/{p.pid}/ns/net") != os.readlink("/proc/self/ns/net"):
            return p.pid
        time.sleep(.01)
    raise AssertionError("child did not create a namespace")

server_code = r'''
import socket,threading,time,queue
ready=queue.Queue()
def serve(family,kind):
 s=socket.socket(family,kind);s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
 if family==socket.AF_INET6:s.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,1)
 s.bind(('::' if family==socket.AF_INET6 else '0.0.0.0',9001))
 if kind==socket.SOCK_STREAM:
  s.listen()
  ready.put(True)
  while True:
   c,_=s.accept();c.settimeout(2)
   try:
    data=c.recv(4096)
    if data:c.sendall(data)
   except socket.timeout:pass
   finally:c.close()
 else:
  ready.put(True)
  while True:
   data,address=s.recvfrom(4096);s.sendto(data,address)
for family in (socket.AF_INET,socket.AF_INET6):
 for kind in (socket.SOCK_STREAM,socket.SOCK_DGRAM):
  threading.Thread(target=serve,args=(family,kind),daemon=True).start()
for _ in range(4):ready.get(timeout=5)
print('READY',flush=True);time.sleep(70)
'''
client_code = r'''
import socket,sys
family=socket.AF_INET6 if sys.argv[1]=='6' else socket.AF_INET
kind=socket.SOCK_STREAM if sys.argv[2]=='tcp' else socket.SOCK_DGRAM
s=socket.socket(family,kind);s.settimeout(.7)
data=bytes.fromhex(sys.argv[4])
try:
 s.connect((sys.argv[3],9001));s.send(data)
 result=s.recv(4096)
 sys.exit(0 if result==data else 3)
except socket.timeout:sys.exit(2)
'''

def probe(pid, family, protocol, payload, allowed):
    address = "172.30.20.2" if family == "4" else "fd42:20::2"
    prefix = [] if pid is None else ["nsenter", "-t", str(pid), "-n"]
    result = subprocess.run(prefix + ["python3", "-c", client_code, family, protocol, address, payload.hex()], capture_output=True)
    expected = 0 if allowed else 2
    if result.returncode != expected:
        diagnostics()
        raise AssertionError(("packet result", family, protocol, "allowed", allowed, result.returncode, result.stderr.decode()))

def diagnostics():
    # Failed baseline reachability is separate from a firewall assertion. Keep
    # routing/neighbor evidence from all three isolated namespaces before exit.
    for label, pid in [("router", None), ("guest", guest), ("server", server)]:
        prefix = [] if pid is None else ["nsenter", "-t", str(pid), "-n"]
        for args in [("ip", "-6", "addr"), ("ip", "-6", "route"), ("ip", "-6", "neigh"), ("ip", "-s", "link")]:
            result = subprocess.run(prefix + list(args), text=True, capture_output=True)
            print(label, args, result.stdout, result.stderr, flush=True)
    for args in [("nft", "list", "ruleset"), ("ip6tables-save",), ("bridge", "mdb", "show")]:
        result = subprocess.run(args, text=True, capture_output=True)
        print(args, result.stdout, result.stderr, flush=True)

def checksum(data):
    if len(data) % 2: data += b"\0"
    total = sum(struct.unpack("!%dH" % (len(data)//2), data))
    while total >> 16: total = (total & 65535) + (total >> 16)
    return (~total) & 65535

def tap_probe(fd, family, payload, allowed, bridge_mac):
    srcmac = bytes.fromhex("020000000003")
    udp = struct.pack("!HHHH", 31001, 9001, 8+len(payload), 0)
    if family == "4":
        source=ipaddress.ip_address("172.30.10.3").packed;target=ipaddress.ip_address("172.30.20.2").packed
        header=struct.pack("!BBHHHBBH4s4s",0x45,0,28+len(payload),1,0,64,17,0,source,target)
        header=header[:10]+struct.pack("!H",checksum(header))+header[12:]
        packet=bridge_mac+srcmac+b"\x08\x00"+header+udp+payload
    else:
        source=ipaddress.ip_address("fd42:10::3").packed;target=ipaddress.ip_address("fd42:20::2").packed
        pseudo=source+target+struct.pack("!I3xB",8+len(payload),17)
        udp=udp[:6]+struct.pack("!H",checksum(pseudo+udp+payload) or 65535)
        header=struct.pack("!IHBB16s16s",6<<28,8+len(payload),17,64,source,target)
        packet=bridge_mac+srcmac+b"\x86\xdd"+header+udp+payload
    while select.select([fd],[],[],0)[0]: os.read(fd,65535)
    os.write(fd,packet)
    import time
    deadline=time.monotonic()+.7;received=False
    while time.monotonic()<deadline:
        if select.select([fd],[],[],max(0,deadline-time.monotonic()))[0]:
            response=os.read(fd,65535)
            if response.startswith(srcmac) and response.endswith(payload): received=True;break
    if received != allowed: raise AssertionError(("TAP bridge packet",family,allowed,received))

try:
    guest, server = space(), space()
    run("ip","link","set","lo","up")
    run("ip","link","add","incusbr0","type","bridge")
    run("ip","link","set","incusbr0","up")
    run("ip","addr","add","172.30.10.1/24","dev","incusbr0")
    run("ip","-6","addr","add","fd42:10::1/64","dev","incusbr0","nodad")
    run("ip","link","add","veth0","type","veth","peer","name","guest0")
    run("ip","link","set","veth0","master","incusbr0")
    run("ip","link","set","veth0","up")
    run("ip","link","set","guest0","netns",str(guest))
    run("ip","link","add","uplink","type","veth","peer","name","server0")
    run("ip","link","set","uplink","up")
    run("ip","addr","add","172.30.20.1/24","dev","uplink")
    run("ip","-6","addr","add","fd42:20::1/64","dev","uplink","nodad")
    run("ip","link","set","server0","netns",str(server))
    for pid,iface,subnet in [(guest,"guest0",10),(server,"server0",20)]:
        ns(pid,"ip","link","set","lo","up");ns(pid,"ip","link","set",iface,"up")
        ns(pid,"ip","addr","add",f"172.30.{subnet}.2/24","dev",iface)
        ns(pid,"ip","-6","addr","add",f"fd42:{subnet}::2/64","dev",iface,"nodad")
        ns(pid,"ip","route","add","default","via",f"172.30.{subnet}.1")
        ns(pid,"ip","-6","route","add","default","via",f"fd42:{subnet}::1")
    run("sysctl","-qw","net.ipv4.ip_forward=1","net.ipv6.conf.all.forwarding=1")
    for family in ("iptables","ip6tables"):
        run(family,"-t","mangle","-N","UNRELATED")
        run(family,"-t","mangle","-A","UNRELATED","-j","RETURN")
    run("nft","-f","-",input="table inet incudal_ingress_protocol {\n chain forward {\n  type filter hook forward priority -20; policy accept;\n }\n}\n")
    ingress_before=run("nft","list","table","inet","incudal_ingress_protocol")
    echo=subprocess.Popen(["nsenter","-t",str(server),"-n","python3","-u","-c",server_code],stdout=subprocess.PIPE)
    children.append(echo)
    if echo.stdout.readline()!=b"READY\n": raise AssertionError("echo server did not become ready")
    tap=os.open("/dev/net/tun",os.O_RDWR|os.O_NONBLOCK)
    fcntl.ioctl(tap,0x400454ca,struct.pack("16sH",b"vmtest0",0x0002|0x1000))
    run("ip","link","set","vmtest0","master","incusbr0");run("ip","link","set","vmtest0","up")
    run("ip","neigh","replace","172.30.10.3","lladdr","02:00:00:00:00:03","nud","permanent","dev","incusbr0")
    run("ip","-6","neigh","replace","fd42:10::3","lladdr","02:00:00:00:00:03","nud","permanent","dev","incusbr0")
    mac=bytes.fromhex(json.loads(run("ip","-j","link","show","dev","incusbr0"))[0]["address"].replace(":",""))
    # Establish neighbor reachability separately from the short DROP deadline.
    # A newly created IPv6 link can still be completing multicast membership /
    # neighbor discovery. ICMP is never part of the signature filter assertions.
    for family, address in [("-4", "172.30.20.2"), ("-6", "fd42:20::2")]:
        try:
            ns(guest, "ping", family, "-c", "1", "-W", "3", address)
        except AssertionError:
            diagnostics()
            raise
    bt=b"\x13BitTorrent protocol"+b"\0"*40
    mining=b'{"id":1,"method":"mining.subscribe","params":[]}\n'
    plain=b"ordinary DNS or web traffic, no matched protocol signature"
    speed_signatures=[b".speed", b"speed.", b".speed.", b"fast.com", b"speedtest.net", b"speedtest.com", b"speedtest.cn", b"test.ustc.edu.cn", b"10000.gd.cn", b"db.laomoe.com", b"jiyou.cloud", b"ovo.speedtestcustom.com", b"speed.cloudflare.com", b"speedtest"]
    for family in ("4","6"):
        probe(guest,family,"udp",bt,True);tap_probe(tap,family,plain,True,mac)
    for family in ("iptables","ip6tables"):
        run(family+"-restore","--wait","3","--noflush","--test",input=(root/"enable.rules").read_text())
        run(family+"-restore","--wait","3","--noflush",input=(root/"enable.rules").read_text())
        (root/(family+".saved")).write_text(run(family+"-save","-t","mangle"))
    for family in ("4","6"):
        for protocol,payload in [("tcp",bt),("udp",bt),("tcp",mining),("udp",b'd1:q9:get_peers1:y1:qe')]:
            probe(guest,family,protocol,payload,False)
            probe(None,family,protocol,payload,True)
        probe(guest,family,"tcp",plain,True);probe(guest,family,"udp",plain,True)
        for index, signature in enumerate(speed_signatures):
            probe(guest,family,"tcp" if index % 2 else "udp",signature,False)
        probe(None,family,"tcp",b"fast.com",True)
        probe(None,family,"udp",b"speedtest",True)
        tap_probe(tap,family,b"speedtest",False,mac)
        tap_probe(tap,family,bt,False,mac);tap_probe(tap,family,plain,True,mac)
    run("ip","link","set","uplink","name","incudal-mgmt")
    for family in ("4","6"):probe(guest,family,"udp",bt,True)
    run("ip","link","set","incudal-mgmt","name","uplink")
    run("ip","link","set","uplink","name","tenant1")
    for family in ("4","6"):probe(guest,family,"udp",bt,True)
    run("ip","link","set","tenant1","name","uplink")
    for family in ("iptables","ip6tables"):
        run(family+"-restore","--wait","3","--noflush",input=(root/"disable.rules").read_text())
        if "-A UNRELATED -j RETURN" not in run(family+"-save","-t","mangle"):raise AssertionError("foreign rule changed")
    for family in ("4","6"):
        probe(guest,family,"udp",bt,True);probe(guest,family,"tcp",mining,True);tap_probe(tap,family,bt,True,mac)
        probe(guest,family,"tcp",b"fast.com",True);probe(guest,family,"udp",b"speedtest",True)
    if run("nft","list","table","inet","incudal_ingress_protocol")!=ingress_before:raise AssertionError("ingress policy changed")
    os.close(tap)
    print("IPv4+IPv6 bridged veth/TAP signatures, plain traffic, host OUTPUT, management/inter-bridge exemption, removal and ingress coexistence passed")
finally:
    for child in reversed(children):
        child.terminate()
        try:child.wait(timeout=3)
        except subprocess.TimeoutExpired:child.kill();child.wait()
