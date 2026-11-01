#!/usr/bin/env python3
"""Disposable Linux proof: the shipped repair restarts a real Go Agent service.

The HTTP receiver checks the real signed heartbeat. It is not a production panel.
"""
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

assert os.geteuid() == 0 and os.environ.get('GITHUB_ACTIONS') == 'true'
assert os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
config = Path('/etc/incudal-agent/config.yaml')
node = Path('/etc/incudal-onboarding-id')
unit = Path('/etc/systemd/system/incudal-agent.service')
assert not config.parent.exists() and not node.exists() and not unit.exists(), 'empty disposable host required'
binary = Path(sys.argv[1]).resolve(strict=True)
assert binary.is_file()
spec = importlib.util.spec_from_file_location('gateway', Path(__file__).with_name('onboarding-gateway.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)
agent_id, secret = 'agt_' + secrets.token_urlsafe(24), 'ias_' + secrets.token_urlsafe(32)
old_id = 'agt_' + secrets.token_urlsafe(24)
old_seen, current_seen = threading.Event(), threading.Event()


class Receiver(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        digest = hashlib.sha256(body).hexdigest()
        signed = '\n'.join(['POST', self.path, self.headers.get('x-incudal-timestamp', ''),
                            self.headers.get('x-incudal-nonce', ''), digest])
        expected = hmac.new(secret.encode(), signed.encode(), hashlib.sha256).hexdigest()
        valid = (self.path == '/api/agent/heartbeat' and self.headers.get('x-incudal-agent-id') == agent_id
                 and self.headers.get('x-incudal-body-sha256') == digest
                 and hmac.compare_digest(self.headers.get('x-incudal-signature', ''), expected))
        if valid:
            assert json.loads(body)['version'] == 'v1.0.4'
            current_seen.set()
        elif self.headers.get('x-incudal-agent-id') == old_id:
            old_seen.set()
        self.send_response(200 if valid else 401)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{}')


receiver = ThreadingHTTPServer(('127.0.0.1', 0), Receiver)
threading.Thread(target=receiver.serve_forever, daemon=True).start()
with tempfile.TemporaryDirectory(prefix='agent-service-repair-', dir='/root') as directory:
    customer = Path(directory) / 'customer.img'
    customer.write_bytes(b'customer fixture remains untouched')
    try:
        config.parent.mkdir(mode=0o700)
        config.write_text(f'panel_url: "http://127.0.0.1:{receiver.server_port}"\nagent_id: "{old_id}"\n'
                          f'agent_secret: "ias_{secrets.token_urlsafe(32)}"\nheartbeat_interval_seconds: 30\n')
        config.chmod(0o600)
        node.write_text('11111111-1111-4111-8111-111111111111\n'); node.chmod(0o600)
        unit.write_text('[Unit]\nDescription=Disposable Agent repair test\n[Service]\nType=simple\n'
                        f'ExecStart={binary}\nRestart=no\n')
        subprocess.run(['systemctl', 'daemon-reload'], check=True)
        subprocess.run(['systemctl', 'start', 'incudal-agent'], check=True)
        assert old_seen.wait(40), 'real Agent did not send old credentials'
        assert not current_seen.is_set()
        data = {'nodeId': node.read_text().strip(), 'agentId': agent_id, 'agentSecret': secret,
                'expiresAt': int(time.time() * 1000) + 25000}
        exec(compile(gateway.AGENT_REPAIR_SCRIPT, '<shipped-agent-repair>', 'exec'), {'D': data})
        assert current_seen.wait(40), 'no valid heartbeat after actual service restart'
        subprocess.run(['systemctl', 'is-active', '--quiet', 'incudal-agent'], check=True)
        assert customer.read_bytes() == b'customer fixture remains untouched'
        assert config.stat().st_mode & 0o777 == 0o600
        print('PASS actual systemd + Go v1.0.4: old identity rejected, fixed repair applied, new signed heartbeat received')
    finally:
        subprocess.run(['systemctl', 'stop', 'incudal-agent'], check=False, stdout=subprocess.DEVNULL)
        unit.unlink(missing_ok=True)
        subprocess.run(['systemctl', 'daemon-reload'], check=True)
        config.unlink(missing_ok=True)
        (config.parent / '.repair.lock').unlink(missing_ok=True)
        config.parent.rmdir()
        node.unlink(missing_ok=True)
        receiver.shutdown(); receiver.server_close()
