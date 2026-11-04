#!/usr/bin/env python3
"""Actual WireGuard retirement in a disposable network namespace and private files."""
import importlib.util
import io
import ipaddress
import json
import os
import pathlib
import subprocess
import tempfile
import time
from unittest import mock

assert os.geteuid() == 0
assert os.environ.get('INCUDAL_NETWORK_NAMESPACE_TEST') == '1'
assert pathlib.Path('/proc/self/ns/net').readlink() != pathlib.Path('/proc/1/ns/net').readlink()
spec = importlib.util.spec_from_file_location('gateway', pathlib.Path(__file__).with_name('onboarding-gateway.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)
run = gateway.run
run('ip', 'link', 'set', 'lo', 'up')
run('ip', 'link', 'add', gateway.INTERFACE, 'type', 'wireguard')
run('ip', 'address', 'add', '10.253.240.1/20', 'dev', gateway.INTERFACE)
run('ip', 'link', 'set', gateway.INTERFACE, 'up')
pathlib.Path('/etc/wireguard').mkdir(mode=0o700, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='.incudal-retirement-test-', dir='/etc/wireguard') as directory:
    root = pathlib.Path(directory)
    gateway.STATE = root / 'state'
    gateway.STATE.mkdir(mode=0o700)
    gateway.CONFIG = root / 'wg.conf'
    private = root / 'key'
    private.write_text(run('wg', 'genkey') + '\n')
    private.chmod(0o600)
    run('wg', 'set', gateway.INTERFACE, 'private-key', str(private))
    def public():
        return subprocess.run(['wg', 'pubkey'], input=run('wg', 'genkey')+'\n', capture_output=True, text=True, check=True).stdout.strip()
    key, other, replacement = public(), public(), public()
    job, request_id = '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'
    control = ipaddress.ip_interface('10.253.240.1/20')
    header = '[Interface]\nAddress = 10.253.240.1/20\n\n[Peer]\nPublicKey = '+other+'\nAllowedIPs = 10.253.240.7/32\n\n'
    block = '# incudal-onboarding '+job+'\n[Peer]\nPublicKey = '+key+'\nAllowedIPs = 10.253.240.6/32\n'
    gateway.atomic_write(gateway.CONFIG, header+block)
    gateway.atomic_write(gateway.STATE/(job+'.json'), json.dumps({'nodePublicKey':key,'managementIp':'10.253.240.6'}))
    run('wg','set',gateway.INTERFACE,'peer',key,'allowed-ips','10.253.240.6/32')
    run('wg','set',gateway.INTERFACE,'peer',other,'allowed-ips','10.253.240.7/32')
    def retire():
        request = {'nodePublicKey':key,'managementIp':'10.253.240.6','requestId':request_id,'expiresAt':int(time.time()*1000)+25000}
        with mock.patch.object(gateway.sys,'stdin',type('Input',(),{'buffer':io.BytesIO(json.dumps(request).encode())})()):
            return gateway.retire_peer(job,control)
    original = gateway.atomic_write
    def interrupted(path, text):
        original(path,text)
        if path == gateway.CONFIG: raise RuntimeError('injected publication interruption')
    with mock.patch.object(gateway,'atomic_write',side_effect=interrupted):
        try: retire()
        except RuntimeError: pass
        else: raise AssertionError('interruption not injected')
    assert gateway.CONFIG.read_text() == header
    assert key in gateway.recovery_live_routes()
    assert retire()['registrationRetired']
    assert gateway.recovery_live_routes() == {other:['10.253.240.7/32']}
    assert gateway.registration(job) is None
    receipt = gateway.STATE/'retired'/(job+'-'+request_id+'.json')
    assert json.loads(gateway.read_protected_state(receipt,4096))['done'] is True
    assert receipt.stat().st_mode & 0o777 == 0o600
    address = gateway.register_peer(job,replacement,control,header,{other:[ipaddress.ip_network('10.253.240.7/32')]})
    run('wg','set',gateway.INTERFACE,'peer',replacement,'allowed-ips',address+'/32')
    before = gateway.CONFIG.read_bytes(), gateway.recovery_live_routes()
    assert retire()['registrationRetired']
    assert (gateway.CONFIG.read_bytes(),gateway.recovery_live_routes()) == before
    link = root/'untrusted.json'
    link.symlink_to(receipt)
    try: gateway.read_protected_state(link,4096)
    except ValueError: pass
    else: raise AssertionError('symlink accepted')
print('PASS native retirement: protected 0600 receipt, actual WireGuard deletion, publication crash resume, unrelated peer and late new-generation preservation')
