#!/usr/bin/env python3
"""Run only inside an isolated Linux network namespace; no system files touched."""
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile

assert os.geteuid() == 0
assert os.environ.get('INCUDAL_NETWORK_NAMESPACE_TEST') == '1'
assert pathlib.Path('/proc/self/ns/net').readlink() != pathlib.Path('/proc/1/ns/net').readlink()
spec = importlib.util.spec_from_file_location('setup', pathlib.Path(__file__).with_name('setup-onboarding-control.py'))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
run = setup.run
run('ip', 'link', 'set', 'lo', 'up')
run('ip', 'link', 'add', 'incudal-mgmt', 'type', 'wireguard')
run('ip', 'address', 'add', '10.253.240.1/24', 'dev', 'incudal-mgmt')
run('ip', 'link', 'set', 'incudal-mgmt', 'up')
with tempfile.TemporaryDirectory() as directory:
    key = pathlib.Path(directory) / 'key'
    key.write_text(run('wg', 'genkey') + '\n')
    key.chmod(0o600)
    run('wg', 'set', 'incudal-mgmt', 'private-key', str(key), 'listen-port', '51820')
    peer = subprocess.run(['wg', 'pubkey'], input=run('wg', 'genkey') + '\n', text=True, check=True, capture_output=True).stdout.strip()
    run('wg', 'set', 'incudal-mgmt', 'peer', peer, 'allowed-ips', '10.253.240.2/32', 'endpoint', '192.0.2.2:51820')
    before = run('wg', 'showconf', 'incudal-mgmt')
    run('ip', 'link', 'add', 'customer0', 'type', 'dummy')
    run('ip', 'address', 'add', '10.10.0.1/22', 'dev', 'customer0')
    run('ip', 'link', 'set', 'customer0', 'up')
    customer = run('ip', '-j', 'addr', 'show', 'dev', 'customer0')
    routes = run('ip', '-j', '-4', 'route', 'show', 'dev', 'customer0')
    address = setup.automatic_management_address('10.253.240.1/24', json.loads(run('ip', '-j', '-4', 'route', 'show', 'table', 'all')))
    setup.expand_live_management_address(address)
    setup.expand_live_management_address(address)
    live = json.loads(run('ip', '-j', '-4', 'addr', 'show', 'dev', 'incudal-mgmt'))[0]['addr_info']
    assert [(x['local'], x['prefixlen']) for x in live if x['family'] == 'inet'] == [('10.253.240.1', 20)]
    assert run('wg', 'showconf', 'incudal-mgmt') == before, 'WireGuard identity or peer changed'
    assert run('ip', '-j', 'addr', 'show', 'dev', 'customer0') == customer, 'Customer interface changed'
    assert run('ip', '-j', '-4', 'route', 'show', 'dev', 'customer0') == routes, 'Customer routes changed'
    assert address.network.num_addresses - 3 == 4093
    # Inject an error after the new prefix is applied: the old prefix returns.
    run('ip', '-4', 'address', 'del', str(address), 'dev', 'incudal-mgmt')
    run('ip', '-4', 'address', 'add', '10.253.240.1/24', 'dev', 'incudal-mgmt')
    fired = False
    def fail_once(*args):
        global fired
        if not fired and args[:4] == ('ip', '-4', 'address', 'del') and args[4] == '10.253.240.1/24':
            fired = True
            raise RuntimeError('Injected address removal failure')
        return run(*args)
    setup.run = fail_once
    try:
        setup.expand_live_management_address(address)
    except RuntimeError:
        pass
    else:
        raise AssertionError('Injected failure was ignored')
    live = json.loads(run('ip', '-j', '-4', 'addr', 'show', 'dev', 'incudal-mgmt'))[0]['addr_info']
    assert [(x['local'], x['prefixlen']) for x in live if x['family'] == 'inet'] == [('10.253.240.1', 24)]
    assert run('wg', 'showconf', 'incudal-mgmt') == before
print('Native namespace expansion: /24 -> /20, 4093 capacity, keys/peers/customer routes preserved, idempotency and rollback passed')
