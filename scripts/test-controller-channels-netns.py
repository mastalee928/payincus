#!/usr/bin/env python3
"""Opt-in actual signed Go WireGuard A/B configuration in isolated namespaces."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=10, **kwargs)

def isolated():
    if os.readlink('/proc/self/ns/net') == os.environ['INCUDAL_CHANNELS_PARENT_NETNS']:
        raise RuntimeError('not isolated')
    root = tempfile.mkdtemp(prefix='incudal-channel-public-', dir='/root')
    processes = []
    try:
        run('ip', 'link', 'set', 'lo', 'up')
        keys = {}
        for slot in ['a', 'b']:
            gateway = subprocess.Popen(['unshare', '--net', '--', 'sleep', '60'])
            processes.append(gateway)
            for _ in range(100):
                if os.readlink(f'/proc/{gateway.pid}/ns/net') != os.readlink('/proc/self/ns/net'):
                    break
                time.sleep(.01)
            if os.readlink(f'/proc/{gateway.pid}/ns/net') == os.readlink('/proc/self/ns/net'):
                raise RuntimeError('gateway namespace creation failed')
            number = 1 if slot == 'a' else 2
            name = 'underlay-' + slot
            peer = 'gateway-' + slot
            run('ip', 'link', 'add', name, 'type', 'veth', 'peer', 'name', peer)
            run('ip', 'link', 'set', peer, 'netns', str(gateway.pid))
            run('ip', 'address', 'add', f'8.1.{number}.2/24', 'dev', name)
            run('ip', 'link', 'set', name, 'up')
            prefix = ['nsenter', '-t', str(gateway.pid), '-n', '--']
            run(*prefix, 'ip', 'link', 'set', 'lo', 'up')
            run(*prefix, 'ip', 'address', 'add', f'8.1.{number}.1/24', 'dev', peer)
            run(*prefix, 'ip', 'link', 'set', peer, 'up')
            key = run('wg', 'genkey').stdout.strip()
            keys[slot] = run('wg', 'pubkey', input=key + '\n').stdout.strip()
            run(*prefix, 'ip', 'link', 'add', 'wg-test', 'type', 'wireguard')
            run(*prefix, 'wg', 'set', 'wg-test', 'listen-port', str(51819 + number), 'private-key', '/dev/stdin', input=key+'\n')
            run(*prefix, 'ip', 'address', 'add', f'10.250.{number}.1/32', 'dev', 'wg-test')
            run(*prefix, 'ip', 'link', 'set', 'wg-test', 'up')
            run(*prefix, 'ip', 'route', 'add', f'10.250.{number}.2/32', 'dev', 'wg-test')
        # Fixed customer/default fixture is independent of management slots.
        run('ip', 'link', 'add', 'customer-test', 'type', 'dummy')
        run('ip', 'link', 'set', 'customer-test', 'up')
        run('ip', 'address', 'add', '192.0.2.2/24', 'dev', 'customer-test')
        run('ip', 'route', 'add', 'default', 'via', '192.0.2.1', 'dev', 'customer-test')
        before = run('ip', '-j', '-4', 'route', 'show', 'dev', 'customer-test').stdout
        env = {**os.environ, 'INCUDAL_CHANNELS_NETNS_TEST': '1',
               'INCUDAL_CHANNELS_PUBLIC_DIRECTORY': root,
               'INCUDAL_CHANNELS_GATEWAY_A_KEY': keys['a'], 'INCUDAL_CHANNELS_GATEWAY_B_KEY': keys['b']}
        binary = str(Path(os.environ['INCUDAL_CHANNELS_TEST_BINARY']).resolve(strict=True))
        test = subprocess.Popen([binary, '-test.run=^Test(ManagementChannels|GatewayTransport)IsolatedExecution$', '-test.v'], env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        processes.append(test)
        for _ in range(500):
            if Path(root, 'ready').exists():
                for slot, gateway in zip(['a', 'b'], processes[:2]):
                    number = 1 if slot == 'a' else 2
                    public = Path(root, slot+'.pub').read_text().strip()
                    run('nsenter', '-t', str(gateway.pid), '-n', '--', 'wg', 'set', 'wg-test', 'peer', public,
                        'allowed-ips', f'10.250.{number}.2/32')
                break
            if test.poll() is not None:
                break
            time.sleep(.02)
        output, error = test.communicate(timeout=35)
        if test.returncode:
            raise RuntimeError(output + error)
        after = run('ip', '-j', '-4', 'route', 'show', 'dev', 'customer-test').stdout
        if json.loads(before) != json.loads(after):
            raise RuntimeError('customer/default route changed')
        print(json.dumps({'passed': True, 'actualWireGuard': True, 'isolatedNamespaces': True,
                          'aFailureBContinues': True, 'customerDefaultRoutePreserved': True,
                          'signedGenerationReplayRejected': True, 'lostInterfaceRestored': True,
                          'independentCommandAndService': bool(os.environ.get('INCUDAL_CHANNELS_COMMAND_BINARY')),
                          'hostWriteAuthority': False, 'test': output}))
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        shutil.rmtree(root)

if __name__ == '__main__':
    if sys.platform != 'linux' or os.geteuid() != 0 or os.environ.get('INCUDAL_CHANNELS_NETNS_TEST') != '1':
        sys.exit('explicit Linux root test only')
    if sys.argv[1:] == ['--isolated']:
        isolated()
    elif sys.argv[1:]:
        sys.exit('unknown argument')
    else:
        env = {**os.environ, 'INCUDAL_CHANNELS_PARENT_NETNS': os.readlink('/proc/self/ns/net')}
        sys.exit(subprocess.run(['unshare', '--net', '--', sys.executable, str(Path(__file__).resolve()), '--isolated'],
                                env=env, timeout=55).returncode)
