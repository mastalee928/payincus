#!/usr/bin/env python3
"""Opt-in Linux network-namespace proof of management socket fencing only."""
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import threading
import time


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, timeout=10, **kwargs)


def isolated():
    # All interface and nft changes take place in a fresh unnamed namespace.
    # No /run/netns entries, root namespace changes or persistent rules.
    run("ip", "link", "set", "lo", "up")
    for ip in ["10.253.240.1", "10.253.241.1", "10.253.242.2"]:
        run("ip", "addr", "add", ip + "/32", "dev", "lo")
    old, new, target = "10.253.240.1", "10.253.241.1", "10.253.242.2"
    stop = threading.Event()
    listeners, connections, workers = [], [], []

    def echo(connection):
        try:
            connection.settimeout(5)
            while not stop.is_set():
                data = connection.recv(128)
                if not data:
                    return
                connection.sendall(data)
        except OSError:
            pass
        finally:
            connection.close()

    def accept(listener):
        listener.settimeout(.2)
        while not stop.is_set():
            try:
                connection, _ = listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            connections.append(connection)
            worker = threading.Thread(target=echo, args=(connection,), daemon=True)
            workers.append(worker)
            worker.start()

    def connect(source, port):
        connection = socket.socket()
        connection.settimeout(.6)
        connection.bind((source, 0))
        try:
            connection.connect((target, port))
            return connection
        except OSError:
            connection.close()
            raise

    def roundtrip(connection):
        connection.sendall(b"probe")
        if connection.recv(128) != b"probe":
            raise RuntimeError("socket did not return the expected bytes")

    def blocked(work):
        try:
            work()
        except OSError:
            return
        raise RuntimeError("stale controller socket remained usable")

    def policy(source, initial=False):
        prefix = "" if initial else "delete table inet payincus_fence_probe\n"
        rules = prefix + """table inet payincus_fence_probe {
  chain input {
    type filter hook input priority -200; policy accept;
    ip daddr %s tcp dport { 18443, 18022 } ip saddr != %s reject with tcp reset
    ct state established,related accept
  }
}
""" % (target, source)
        run("nft", "-f", "-", input=rules)

    checks = []
    try:
        for port in [18443, 18022, 18080]:
            listener = socket.socket()
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind((target, port)); listener.listen(16)
            listeners.append(listener)
            worker = threading.Thread(target=accept, args=(listener,), daemon=True)
            workers.append(worker); worker.start()
        policy(old, True)
        old_api, old_ssh = connect(old, 18443), connect(old, 18022)
        customer = connect(old, 18080)
        for connection in [old_api, old_ssh, customer]:
            roundtrip(connection)
        checks.append("old management sockets and customer fixture initially pass")
        blocked(lambda: connect(new, 18443))
        checks.append("candidate cannot write through inactive management source")
        policy(new)
        blocked(lambda: roundtrip(old_api)); blocked(lambda: roundtrip(old_ssh))
        old_api.close(); old_ssh.close()
        checks.append("old established API and SSH socket bytes rejected before conntrack accept")
        blocked(lambda: connect(old, 18443)); blocked(lambda: connect(old, 18022))
        checks.append("fresh old management sockets rejected")
        for port in [18443, 18022]:
            with connect(new, port) as connection:
                roundtrip(connection)
        checks.append("new management source verified")
        roundtrip(customer); customer.close()
        with connect(old, 18080) as connection:
            roundtrip(connection)
        checks.append("existing and new customer fixture traffic survives")
        policy(new)
        with connect(new, 18443) as connection:
            roundtrip(connection)
        checks.append("reapplying fence is idempotent")
        # Losing a transport socket cannot cancel an already accepted operation.
        # Explicitly prove this limitation rather than label network filtering
        # as a complete writer fence.
        started = threading.Event(); finished = threading.Event()
        def accepted_operation():
            started.set(); time.sleep(.1); finished.set()
        job = threading.Thread(target=accepted_operation, daemon=True); job.start()
        if not started.wait(1):
            raise RuntimeError("accepted-operation fixture failed")
        policy(old)
        if not finished.wait(1):
            raise RuntimeError("unexpected operation cancellation")
        checks.append("already accepted operation survives; task gate still required")
        print(json.dumps({"passed": True, "isolatedUnnamedNetworkNamespace": True,
                          "checks": checks, "completeWriterFence": False,
                          "realWireGuardOrIncus": False}))
    finally:
        stop.set()
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()
        for listener in listeners:
            listener.close()
        for worker in workers:
            worker.join(timeout=.3)


if __name__ == "__main__":
    if sys.platform != "linux" or os.geteuid() != 0 or os.environ.get("INCUDAL_CONTROLLER_FENCE_NETNS_TEST") != "1":
        sys.exit("Opt-in Linux root test only: INCUDAL_CONTROLLER_FENCE_NETNS_TEST=1")
    for tool in ["unshare", "ip", "nft"]:
        if not shutil.which(tool):
            sys.exit("Missing network test dependency")
    if sys.argv[1:] == ["--isolated"]:
        parent = os.environ.get("INCUDAL_FENCE_PARENT_NETNS")
        if not parent or parent == os.readlink("/proc/self/ns/net"):
            sys.exit("Refusing to change the parent network namespace")
        isolated()
    elif sys.argv[1:]:
        sys.exit("Unknown test argument")
    else:
        env = {**os.environ, "INCUDAL_FENCE_PARENT_NETNS": os.readlink("/proc/self/ns/net")}
        result = subprocess.run(["unshare", "--net", "--", sys.executable,
                                 str(pathlib.Path(__file__).resolve()), "--isolated"], env=env, timeout=30)
        sys.exit(result.returncode)
