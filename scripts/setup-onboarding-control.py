#!/usr/bin/env python3
"""Configure a local WireGuard management gateway without replacing existing keys."""
import argparse
import ipaddress
import json
import os
import pathlib
import re
import subprocess
import tempfile


def run(*args):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # Commands receive fixed arguments and file paths, never credentials.
        # Keep the final diagnostic line, with any key-like value redacted.
        detail = " ".join(result.stderr.strip().splitlines()[-1:])
        detail = re.sub(r"[A-Za-z0-9+/=_-]{40,}", "[redacted]", detail)[:400]
        raise RuntimeError(f"{pathlib.Path(args[0]).name} failed (exit {result.returncode}): {detail or 'check the local service configuration'}")
    return result.stdout.strip()


def public_host(value):
    value = value.strip()
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        if len(value) > 253 or not re.fullmatch(r"(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", value):
            raise ValueError("Use a public IPv4 address or DNS name, without a scheme or port")
        return value.lower()
    if address.version != 4 or not address.is_global or address.is_multicast:
        raise ValueError("The management endpoint must use a public IPv4 address or DNS name")
    return str(address)


def management_address(value):
    address = ipaddress.ip_interface(value)
    if address.version != 4 or not address.ip in ipaddress.ip_network("10.0.0.0/8") or not 16 <= address.network.prefixlen <= 30:
        raise ValueError("Management address must be in 10.0.0.0/8 with a /16 to /30 prefix")
    if address.ip in (address.network.network_address, address.network.broadcast_address) or address.network.overlaps(ipaddress.ip_network("10.10.0.0/22")):
        raise ValueError("Management subnet conflicts with reserved addresses or the Incus subnet")
    return address


def port_number(value):
    port = int(value)
    if not 1 <= port <= 65535:
        raise ValueError("Port must be between 1 and 65535")
    return port


def check_routes(address, routes):
    for route in routes:
        destination = route.get("dst", "default")
        if destination == "default" or route.get("dev") == "incudal-mgmt":
            continue
        network = ipaddress.ip_network(destination, strict=False)
        if network.version == 4 and address.network.overlaps(network):
            raise ValueError("Management subnet overlaps an existing route; choose another ONBOARDING_MANAGEMENT_ADDRESS")


def update_env(content, values):
    lines = content.splitlines()
    output = []
    remaining = dict(values)
    for line in lines:
        key = line.split("=", 1)[0] if "=" in line else ""
        if key in values:
            if key in remaining:
                output.append(key + "=" + remaining.pop(key))
        else:
            output.append(line)
    if remaining:
        output.extend(["", "# Local host-pool management gateway"])
        output.extend(key + "=" + value for key, value in remaining.items())
    return "\n".join(output) + "\n"


def main():
    import pwd
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-host", required=True)
    parser.add_argument("--management-address", default="10.253.240.1/24")
    parser.add_argument("--listen-port", default="51820")
    parser.add_argument("--ssh-port", default="22")
    args = parser.parse_args()
    host = public_host(args.public_host)
    address = management_address(args.management_address)
    listen_port = port_number(args.listen_port)
    ssh_port = port_number(args.ssh_port)
    if os.geteuid() != 0:
        raise ValueError("Run as root on the control server")
    os.umask(0o077)
    env_file = pathlib.Path("/opt/incudal/.env")
    if env_file.is_symlink() or not env_file.is_file():
        raise ValueError("Install the panel first; /opt/incudal/.env must be a regular file")
    original_env = env_file.read_text()
    account = pwd.getpwnam("incudal")
    config = pathlib.Path("/etc/wireguard/incudal-mgmt.conf")
    if config.is_symlink():
        raise ValueError("WireGuard configuration must not be a symlink")
    if config.exists():
        content = config.read_text()
        configured_address = re.search(r"(?m)^\s*Address\s*=\s*([^\r\n]+)", content)
        configured_port = re.search(r"(?m)^\s*ListenPort\s*=\s*(\d+)\s*$", content)
        if not configured_address or configured_address.group(1).strip() != str(address) or not configured_port or int(configured_port.group(1)) != listen_port:
            raise ValueError("Existing management configuration differs; keep it and supply its address and port explicitly")
    else:
        check_routes(address, json.loads(run("ip", "-j", "-4", "route", "show", "table", "all")))
        if run("ip", "-o", "link", "show", "type", "wireguard").find("incudal-mgmt") >= 0:
            raise ValueError("An unmanaged incudal-mgmt interface already exists")
        config.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        private_key = run("wg", "genkey")
        with config.open("x") as handle:
            handle.write(f"# Managed by PayIncus host-pool setup\n[Interface]\nPrivateKey = {private_key}\nAddress = {address}\nListenPort = {listen_port}\n")
            handle.flush()
            os.fsync(handle.fileno())
    run("systemctl", "enable", "--now", "wg-quick@incudal-mgmt")
    # Minimal/cloud images may only ship some SSH host-key algorithms.
    # Generate missing keys without replacing existing server identities.
    run("ssh-keygen", "-A")
    run("systemctl", "start", "ssh")
    key_path = pathlib.Path("/opt/incudal/server/certs/onboarding-gateway.key")
    if key_path.is_symlink():
        raise ValueError("Application gateway key must not be a symlink")
    scripts = pathlib.Path(__file__).resolve().parent
    run("bash", str(scripts / "install-onboarding-gateway.sh"), str(key_path))
    os.chown(key_path, 0, account.pw_gid)
    os.chmod(key_path, 0o640)
    host_key_path = pathlib.Path("/etc/ssh/ssh_host_ed25519_key.pub")
    fingerprint = run("ssh-keygen", "-lf", str(host_key_path), "-E", "sha256").split()[1]
    descriptor, known_path = tempfile.mkstemp(prefix="incudal-gateway-known-hosts-")
    try:
        with os.fdopen(descriptor, "w") as handle:
            handle.write(f"[127.0.0.1]:{ssh_port},127.0.0.1 " + " ".join(host_key_path.read_text().split()[:2]) + "\n")
        os.chown(known_path, account.pw_uid, account.pw_gid)
        status = json.loads(run("sudo", "-u", "incudal", "ssh", "-F", "/dev/null", "-T", "-p", str(ssh_port),
                                "-i", str(key_path), "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
                                "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlgorithms=ssh-ed25519",
                                "-o", "ConnectTimeout=10", "-o", f"UserKnownHostsFile={known_path}", "root@127.0.0.1", "status"))
        if status.get("controlIp") != str(address.ip) or status.get("network") != str(address.network):
            raise ValueError("Gateway status does not match the configured management network")
    finally:
        os.unlink(known_path)
    values = {
        "ONBOARDING_GATEWAY_HOST": "127.0.0.1",
        "ONBOARDING_GATEWAY_PORT": str(ssh_port),
        "ONBOARDING_GATEWAY_KEY_PATH": str(key_path),
        "ONBOARDING_GATEWAY_FINGERPRINT": fingerprint,
        "ONBOARDING_WG_ENDPOINT": f"{host}:{listen_port}",
        "ONBOARDING_SSH_JUMP_HOST": host,
        "ONBOARDING_SSH_JUMP_PORT": str(ssh_port),
        "ONBOARDING_SSH_JUMP_USER": "root",
    }
    if env_file.read_text() != original_env:
        raise ValueError("Panel environment changed during setup; retry without overwriting it")
    descriptor, temp_path = tempfile.mkstemp(dir=env_file.parent, prefix=".onboarding-env-")
    try:
        with os.fdopen(descriptor, "w") as handle:
            handle.write(update_env(original_env, values))
            handle.flush()
            os.fsync(handle.fileno())
        os.chown(temp_path, 0, account.pw_gid)
        os.chmod(temp_path, 0o640)
        os.replace(temp_path, env_file)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
    print(f"Host-pool management gateway verified. Allow inbound UDP {listen_port} for {host} in the cloud firewall.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        print(f"Gateway setup stopped: {error}")
        raise SystemExit(1)
