#!/usr/bin/env python3
"""Opt-in production Go preparation fence with isolated INPUT and DNAT probes."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
import time


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True,
                          timeout=10, **kwargs)


def echo(listener):
    def serve(connection):
        try:
            connection.settimeout(10)
            while True:
                data = connection.recv(128)
                if not data:
                    break
                connection.sendall(data)
        except OSError:
            pass
        finally:
            connection.close()
    while True:
        try:
            connection, _ = listener.accept()
        except OSError:
            return
        threading.Thread(target=serve, args=(connection,), daemon=True).start()


def listener(address, port):
    value = socket.socket(socket.AF_INET6 if ":" in address else socket.AF_INET)
    value.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if ":" in address:
        value.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
    value.bind((address, port))
    value.listen(16)
    threading.Thread(target=echo, args=(value,), daemon=True).start()
    return value


def child(mode):
    # Children wait for the parent to configure their veth interfaces. They
    # contain no filesystem/rule mutations and die with the test's finally.
    values = {}
    for line in sys.stdin:
        request = json.loads(line)
        try:
            action = request["action"]
            if action == "start":
                for address in ["10.92.0.2", "fd92::2"]:
                    for port in [22, 8443]:
                        values[(address, port)] = listener(address, port)
            elif action == "connect":
                address = request["address"]
                connection = socket.socket(socket.AF_INET6 if ":" in address else socket.AF_INET)
                connection.settimeout(3)
                try:
                    connection.connect((address, request["port"]))
                except OSError:
                    connection.close()
                    raise
                values[request["id"]] = connection
            elif action == "roundtrip":
                connection = values[request["id"]]
                connection.sendall(b"probe")
                if connection.recv(128) != b"probe":
                    raise RuntimeError("wrong echo")
            else:
                raise RuntimeError("unknown child operation")
            result = {"ok": True}
        except OSError as error:
            result = {"ok": False, "error": str(error)}
        print(json.dumps(result), flush=True)


def isolated():
    parent = os.environ.get("INCUDAL_MANAGEMENT_FENCE_PARENT_NETNS")
    if not parent or parent == os.readlink("/proc/self/ns/net"):
        raise RuntimeError("refusing parent network namespace")
    binary = Path(os.environ["INCUDAL_MANAGEMENT_FENCE_TEST_BINARY"]).resolve(strict=True)
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise RuntimeError("compiled Go test binary required")
    script = str(Path(__file__).resolve())
    processes, listeners = [], []
    checks = []
    try:
        run("ip", "link", "set", "lo", "up")
        run("sysctl", "-w", "net.ipv4.ip_forward=1")
        run("sysctl", "-w", "net.ipv6.conf.all.forwarding=1")
        run("ip", "addr", "add", "192.0.2.1/32", "dev", "lo")
        run("ip", "-6", "addr", "add", "2001:db8::1/128", "dev", "lo", "nodad")
        for index, mode in enumerate(["--client", "--server"], start=91):
            process = subprocess.Popen(["unshare", "--net", "--", sys.executable, script, mode],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True)
            processes.append(process)
            deadline = time.monotonic() + 2
            while os.readlink(f"/proc/{process.pid}/ns/net") == os.readlink("/proc/self/ns/net"):
                if time.monotonic() > deadline:
                    raise RuntimeError("child namespace not ready")
                time.sleep(.02)
            outside, inside = f"f{index}", f"n{index}"
            run("ip", "link", "add", outside, "type", "veth", "peer", "name", inside)
            run("ip", "link", "set", inside, "netns", str(process.pid))
            for family, network in [("-4", f"10.{index}.0."), ("-6", f"fd{index}::")]:
                suffix = "/24" if family == "-4" else "/64"
                args = ["nodad"] if family == "-6" else []
                run("ip", family, "addr", "add", network + "1" + suffix, "dev", outside, *args)
                run("nsenter", "-t", str(process.pid), "-n", "ip", family, "addr", "add", network + "2" + suffix, "dev", inside, *args)
                run("nsenter", "-t", str(process.pid), "-n", "ip", "link", "set", inside, "up")
                run("nsenter", "-t", str(process.pid), "-n", "ip", family, "route", "add", "default", "via", network + "1")
            run("ip", "link", "set", outside, "up")
            for name in ["lo", inside]:
                run("nsenter", "-t", str(process.pid), "-n", "ip", "link", "set", name, "up")

        def request(process, expected=True, **value):
            process.stdin.write(json.dumps(value) + "\n")
            process.stdin.flush()
            result = json.loads(process.stdout.readline())
            if result.get("ok") != expected:
                raise RuntimeError("unexpected probe result: " + json.dumps(value) + " " + json.dumps(result))

        client, server = processes
        request(server, action="start")
        for address in ["0.0.0.0", "::"]:
            for port in [2200, 8443, 18080]:
                listeners.append(listener(address, port))
        run("nft", "-f", "-", input="""table inet customer_probe {
 chain forward { type filter hook forward priority 0; policy accept; }
 chain input { type filter hook input priority 0; policy accept; ct state established,related accept; }
}
table ip customer_dnat {
 chain prerouting { type nat hook prerouting priority dstnat; policy accept;
  ip daddr 192.0.2.1 tcp dport 2200 dnat to 10.92.0.2:22
  ip daddr 192.0.2.1 tcp dport 8443 dnat to 10.92.0.2:8443
 }
}
table ip6 customer_dnat6 {
 chain prerouting { type nat hook prerouting priority dstnat; policy accept;
  ip6 daddr 2001:db8::1 tcp dport 2200 dnat to [fd92::2]:22
  ip6 daddr 2001:db8::1 tcp dport 8443 dnat to [fd92::2]:8443
 }
}
""")
        customer_before = run("nft", "-j", "list", "ruleset").stdout
        for address in ["10.91.0.1", "fd91::1"]:
            for port in [2200, 8443]:
                key = f"management-{address}-{port}"
                request(client, action="connect", id=key, address=address, port=port)
                request(client, action="roundtrip", id=key)
        for address in ["192.0.2.1", "2001:db8::1"]:
            for port in [2200, 8443]:
                key = f"customer-{address}-{port}"
                request(client, action="connect", id=key, address=address, port=port)
                request(client, action="roundtrip", id=key)
        checks.append("IPv4/IPv6 management and customer DNAT initially usable")
        env = {**os.environ, "INCUDAL_MANAGEMENT_FENCE_EXEC_TEST": "1"}
        subprocess.run([str(binary), "-test.run=^TestManagementFenceIsolatedExecution$", "-test.v"],
                       env=env, check=True, capture_output=True, text=True, timeout=15)
        checks.append("production Go verifies signatures and disk watermark, applies and repeats atomic nft fence")
        command_binary = os.environ.get("INCUDAL_MAINTENANCE_FENCE_TEST_BINARY")
        if command_binary:
            subprocess.run([str(Path(command_binary).resolve(strict=True)),
                            "-test.run=^TestProtectedMaintenanceCommandPersistsOnlyTrustedCandidates$", "-test.v"],
                           env=env, check=True, capture_output=True, text=True, timeout=15)
            checks.append("actual maintenance command and HTTPS lifecycle: signed startup deny before listening, mutual TLS inspection, duplicate listener and missing state rejected, graceful shutdown; no write authority")
        for address in ["10.91.0.1", "fd91::1"]:
            for port in [2200, 8443]:
                request(client, expected=False, action="roundtrip", id=f"management-{address}-{port}")
                request(client, expected=False, action="connect", id="blocked", address=address, port=port)
        checks.append("IPv4/IPv6 existing bytes and new management connections rejected before conntrack accept")
        for address in ["192.0.2.1", "2001:db8::1"]:
            for port in [2200, 8443]:
                request(client, action="roundtrip", id=f"customer-{address}-{port}")
                request(client, action="connect", id="new-customer", address=address, port=port)
                request(client, action="roundtrip", id="new-customer")
        checks.append("existing and new IPv4/IPv6 customer DNAT/FORWARD survive even on fenced TCP ports")
        for port in [2200, 8443]:
            with socket.create_connection(("127.0.0.1", port), timeout=1) as connection:
                connection.sendall(b"probe")
                if connection.recv(128) != b"probe":
                    raise RuntimeError("loopback inspection blocked")
        request(client, action="connect", id="other", address="10.91.0.1", port=18080)
        request(client, action="roundtrip", id="other")
        checks.append("loopback inspection and unrelated INPUT service remain usable")

        # Compare exact customer rules apart from expected counters in the
        # independent controller table. No customer table is replaced.
        before = json.loads(customer_before)["nftables"]
        after = json.loads(run("nft", "-j", "list", "ruleset").stdout)["nftables"]
        def customer_rows(rows):
            return [row for row in rows if "metainfo" not in row and all(
                value.get("table", value.get("name")) != "incudal_controller_fence"
                for value in row.values())]
        if customer_rows(before) != customer_rows(after):
            raise RuntimeError("customer rules changed")
        checks.append("customer nft tables byte-equivalent as JSON objects")
        print(json.dumps({"passed": True, "isolatedNetworkNamespaces": True,
                          "actualGoPreparationFence": True, "checks": checks,
                          "completeTakeover": False, "realWireGuardSshIncus": False}))
    finally:
        for value in listeners:
            value.close()
        for process in processes:
            process.terminate()
        for process in processes:
            try:
                process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate(timeout=2)


if __name__ == "__main__":
    if sys.platform != "linux" or os.geteuid() != 0 or os.environ.get("INCUDAL_MANAGEMENT_FENCE_NETNS_TEST") != "1":
        sys.exit("Opt-in Linux root only: INCUDAL_MANAGEMENT_FENCE_NETNS_TEST=1")
    if sys.argv[1:] in [["--client"], ["--server"]]:
        child(sys.argv[1])
    elif sys.argv[1:] == ["--isolated"]:
        isolated()
    elif sys.argv[1:]:
        sys.exit("unknown argument")
    else:
        for tool in ["unshare", "nsenter", "ip", "nft", "sysctl"]:
            if not shutil.which(tool):
                sys.exit("missing namespace dependency")
        env = {**os.environ, "INCUDAL_MANAGEMENT_FENCE_PARENT_NETNS": os.readlink("/proc/self/ns/net")}
        result = subprocess.run(["unshare", "--net", "--", sys.executable,
                                 str(Path(__file__).resolve()), "--isolated"], env=env, timeout=50)
        sys.exit(result.returncode)
