#!/usr/bin/env python3
"""Real packets for two dedicated IPv6 addresses; run only under unshare --net."""
import os
import pathlib
import select
import subprocess
import sys
import time

if os.readlink('/proc/self/ns/net') == os.readlink('/proc/1/ns/net'):
    raise SystemExit('Refusing to modify the host network namespace')

processes = []


def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs)


def ns(pid, *args, **kwargs):
    return run('nsenter', '-t', str(pid), '-n', *args, **kwargs)


def namespace():
    process = subprocess.Popen(['unshare', '--net', 'sleep', '60'])
    processes.append(process)
    for _ in range(100):
        if os.readlink('/proc/self/ns/net') != os.readlink(f'/proc/{process.pid}/ns/net'):
            return process.pid
        time.sleep(0.01)
    raise RuntimeError('Failed to create a network namespace')


ECHO = r'''
import socket, threading, time, sys
label = sys.argv[1]
def serve(port, tcp):
    sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM if tcp else socket.SOCK_DGRAM)
    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(('::', port))
    if tcp:
        sock.listen()
        while True:
            conn, peer = sock.accept(); conn.recv(512)
            conn.sendall((label + '|' + peer[0]).encode()); conn.close()
    else:
        # A multihomed UDP server must reply from the address that received the
        # datagram (IPV6_PKTINFO), as DNS/QUIC daemons do. A wildcard sendto can
        # select the default source and would test the echo server instead.
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_RECVPKTINFO, 1)
        while True:
            data, control, flags, peer = sock.recvmsg(512, 256)
            source = [(level, kind, value) for level, kind, value in control
                      if level == socket.IPPROTO_IPV6 and kind == socket.IPV6_PKTINFO]
            sock.sendmsg([(label + '|' + peer[0]).encode()], source, 0, peer)
def icmp():
    sock = socket.socket(socket.AF_INET6, socket.SOCK_RAW, socket.IPPROTO_ICMPV6)
    while True:
        data, peer = sock.recvfrom(4096)
        if data[0] == 128: print('icmp|' + peer[0], flush=True)
for port in [1, 22, 53, 443, 8443, 65535]:
    for tcp in [False, True]: threading.Thread(target=serve, args=(port, tcp), daemon=True).start()
threading.Thread(target=icmp, daemon=True).start()
time.sleep(.1)
print('ready', flush=True)
time.sleep(60)
'''

PROBE = r'''
import socket, sys
address, port, protocol, source = sys.argv[1:]
sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM if protocol == 'tcp' else socket.SOCK_DGRAM)
sock.settimeout(.6)
if source != '-': sock.bind((source, 0))
try:
    sock.connect((address, int(port))); sock.send(b'ipv6-acceptance')
    print(sock.recv(512).decode())
except OSError:
    print('blocked')
finally:
    sock.close()
'''


def start_echo(pid, label):
    process = subprocess.Popen(['nsenter', '-t', str(pid), '-n', 'python3', '-u', '-c', ECHO, label], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(process)
    assert process.stdout.readline().strip() == 'ready'
    return process


def probe(pid, address, port, protocol, expected, source='-'):
    output = ns(pid, 'python3', '-c', PROBE, address, str(port), protocol, source).stdout.strip()
    if output != expected:
        print(run('ip', '-6', 'neigh').stdout, run('nft', 'list', 'ruleset').stdout, flush=True)
        print(ns(pid, 'ip', '-6', 'route').stdout, ns(pid, 'ip', '-6', 'neigh').stdout, flush=True)
        for process in processes:
            if process.stderr and select.select([process.stderr], [], [], 0)[0]:
                print(os.read(process.stderr.fileno(), 8192).decode(), flush=True)
    assert output == expected, f'{protocol} {source} -> {address}:{port}: {output}, wanted {expected}'


def apply(path, table, replace=False):
    prefix = f'delete table {table}\n' if replace else ''
    run('nft', '-f', '-', input=prefix + pathlib.Path(path).read_text())


try:
    run('ip', 'link', 'set', 'lo', 'up')
    pathlib.Path('/proc/sys/net/ipv6/conf/all/forwarding').write_text('1')
    pathlib.Path('/proc/sys/net/ipv6/conf/default/forwarding').write_text('1')
    client, guest = namespace(), namespace()
    run('ip', 'link', 'add', 'uplink', 'type', 'veth', 'peer', 'name', 'client0')
    run('ip', 'link', 'set', 'client0', 'netns', str(client))
    run('ip', 'link', 'add', 'incusbr0', 'type', 'bridge')
    run('ip', 'link', 'add', 'guest-link', 'type', 'veth', 'peer', 'name', 'guest0')
    run('ip', 'link', 'set', 'guest0', 'netns', str(guest))
    run('ip', 'link', 'set', 'guest-link', 'master', 'incusbr0')
    for interface in ['uplink', 'incusbr0', 'guest-link']:
        run('ip', 'link', 'set', interface, 'up')
    public = ['2603:c020:802a:cc00::1', '2603:c020:802a:cc00::2']
    for address in public:
        run('ip', '-6', 'addr', 'add', address + '/64', 'dev', 'uplink', 'nodad')
    run('ip', '-6', 'addr', 'add', 'fd42:2::1/64', 'dev', 'incusbr0', 'nodad')
    for pid, interface, address, gateway in [
        (client, 'client0', '2603:c020:802a:cc00::9', public[0]),
        (guest, 'guest0', 'fd42:2::2', 'fd42:2::1')]:
        ns(pid, 'ip', 'link', 'set', 'lo', 'up')
        ns(pid, 'ip', 'link', 'set', interface, 'up')
        ns(pid, 'ip', '-6', 'addr', 'add', address + '/64', 'dev', interface, 'nodad')
        ns(pid, 'ip', '-6', 'route', 'add', 'default', 'via', gateway)
    ns(guest, 'ip', '-6', 'addr', 'add', 'fd42:2::4/64', 'dev', 'guest0', 'nodad')
    guest_echo = start_echo(guest, 'guest')
    client_echo = start_echo(client, 'client')
    host_echo = start_echo(os.getpid(), 'host')
    time.sleep(2)
    # Reproduce the old firewall. Guest NDP must be allowed without allowing
    # guest access to host services, even when the host INPUT policy is ACCEPT.
    run('ip6tables', '-N', 'INCUDAL_OCI_IN')
    run('ip6tables', '-A', 'INPUT', '-j', 'INCUDAL_OCI_IN')
    run('ip6tables', '-A', 'INCUDAL_OCI_IN', '-i', 'incusbr0', '-j', 'REJECT')
    for kind in ['135', '136']:
        run('ip6tables', '-I', 'INCUDAL_OCI_IN', '-i', 'incusbr0', '-p', 'ipv6-icmp', '--icmpv6-type', kind, '-m', 'hl', '--hl-eq', '255', '-j', 'ACCEPT')
    # Create the generic Incus-style NAT first. Correct source selection cannot
    # depend on the relative creation order of two priority-100 chains.
    native = '''table ip6 simulated_incus {
 chain outbound { type nat hook postrouting priority 100; policy accept;
  ip6 saddr fd42:2::/64 ip6 daddr != fd42:2::/64 masquerade
 }
 chain inbound { type nat hook prerouting priority -100; policy accept;
  ip6 daddr 2603:c020:802a:cc00::1 dnat to fd42:2::2
  ip6 daddr 2603:c020:802a:cc00::2 dnat to fd42:2::4
 }
}
'''
    run('nft', '-f', '-', input=native)
    run('nft', 'add', 'table', 'inet', 'unrelated_ipv6_test')
    apply(sys.argv[1], 'ip6 incudal_dedicated_ipv6')
    apply(sys.argv[3], 'inet incudal_ingress_protocol')
    for address in public:
        for port in [1, 22, 53, 443, 8443, 65535]:
            for protocol in ['tcp', 'udp']:
                probe(client, address, port, protocol, 'guest|2603:c020:802a:cc00::9')
        ns(client, 'ping', '-6', '-c', '1', '-W', '1', address)
    for source, expected in zip(['fd42:2::2', 'fd42:2::4'], public):
        for protocol in ['tcp', 'udp']:
            probe(guest, '2603:c020:802a:cc00::9', 443, protocol, 'client|' + expected, source)
        ns(guest, 'ping', '-6', '-I', source, '-c', '1', '-W', '1', '2603:c020:802a:cc00::9')
        assert select.select([client_echo.stdout], [], [], 2)[0], 'no outbound ICMP packet observed'
        assert client_echo.stdout.readline().strip() == 'icmp|' + expected, 'ICMP used the wrong public IPv6'
    for port in [22, 8443]:
        probe(guest, 'fd42:2::1', port, 'tcp', 'blocked')
    apply(sys.argv[2], 'inet incudal_ingress_protocol', True)
    for address in public:
        probe(client, address, 443, 'udp', 'blocked')
        probe(client, address, 443, 'tcp', 'guest|2603:c020:802a:cc00::9')
    probe(guest, '2603:c020:802a:cc00::9', 53, 'udp', 'client|' + public[1], 'fd42:2::4')
    # Reload source mappings while unrelated firewall and protocol rules stay.
    apply(sys.argv[1], 'ip6 incudal_dedicated_ipv6', True)
    run('nft', '-f', '-', input='delete table ip6 simulated_incus\n' + native)
    probe(guest, '2603:c020:802a:cc00::9', 65535, 'tcp', 'client|' + public[1], 'fd42:2::4')
    apply(sys.argv[3], 'inet incudal_ingress_protocol', True)
    probe(client, public[1], 65535, 'udp', 'guest|2603:c020:802a:cc00::9')
    run('nft', 'list', 'table', 'inet', 'unrelated_ipv6_test')
    print('Two IPv6 addresses: inbound TCP/UDP low-high ports, ICMP, per-address outbound TCP/UDP/ICMP, NDP, host isolation, TCP-only, DNS replies, reload and re-enable passed')
finally:
    for process in reversed(processes):
        process.terminate()
    for process in reversed(processes):
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait()
