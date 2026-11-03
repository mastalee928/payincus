#!/usr/bin/env python3
"""Verify native nft JSON in a disposable network namespace only."""
import importlib.util
import json
import os
import pathlib
import subprocess

assert os.geteuid() == 0
assert os.environ.get('INCUDAL_NETWORK_NAMESPACE_TEST') == '1'
assert pathlib.Path('/proc/self/ns/net').readlink() != pathlib.Path('/proc/1/ns/net').readlink()
spec = importlib.util.spec_from_file_location('gateway', pathlib.Path(__file__).with_name('onboarding-gateway.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)

def read():
    return json.loads(subprocess.check_output(['nft','-j','list','table','inet','incudal_ingress_protocol'], text=True))

for mode in ['tcp', 'tcp_udp']:
    rule = 'iifname != "incusbr0" oifname "incusbr0" meta l4proto udp ct direction original counter drop;' if mode == 'tcp' else ''
    config = 'table inet incudal_ingress_protocol { chain forward { type filter hook forward priority -20; policy accept; '+rule+' } }'
    subprocess.run(['nft','-f','-'], input=config, text=True, check=True, capture_output=True)
    gateway.verify_recovery_port_protocol(read(), mode)
    try:
        gateway.verify_recovery_port_protocol(read(), 'tcp_udp' if mode == 'tcp' else 'tcp')
    except gateway.GatewayOperationError:
        pass
    else:
        raise AssertionError('wrong live policy accepted')
    subprocess.run(['nft','delete','table','inet','incudal_ingress_protocol'], check=True)
print('Native nft recovery inspection: tcp and tcp_udp match; opposite policies rejected; namespace isolated')
