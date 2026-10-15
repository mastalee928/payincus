---
title: One-click Install
description: Deploy PayIncus on Debian or Ubuntu from a verified GitHub Release
---

# One-click Install

<p class="doc-lead">Deploy PayIncus on a clean server with the official installer. It configures dependencies, database access, environment variables, systemd, and the selected external access mode.</p>

<div class="doc-meta">
  <div><span>Use case</span><strong>First production install</strong></div>
  <div><span>Supported OS</span><strong>Debian / Ubuntu</strong></div>
  <div><span>Default path</span><strong>/opt/incudal</strong></div>
</div>

::: tip Expected result
The installation creates separate user and admin frontends with a local backend service. Release artifacts are extracted only after SHA256 verification.
:::

## Requirements

Every mode requires a clean Debian or Ubuntu server and root or sudo access. External access requirements depend on the mode selected during installation:

| Mode | Domain and network requirements |
| --- | --- |
| Nginx + Certbot | Prepare separate user and admin domains, point A/AAAA records to the server, and expose ports 80/443. |
| Cloudflare Tunnel | Manage both domains in Cloudflare and prepare Tunnel credentials; inbound public ports 80/443 are not required. |
| Service only | The script does not require domains or configure TLS; an existing reverse proxy or internal gateway must expose the local backend. |

The default install directory is `/opt/incudal`. This is the real path used by the installer, systemd templates, OTA worker, and production release layout.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/mastalee928/payincus/main/scripts/install-panel.sh -o install-panel.sh
sudo bash install-panel.sh
```

During installation, provide:

- Initial admin email. Empty input defaults to `admin@payincus.local`. The installer generates a random administrator password and displays it after installation; save it securely.
- External access mode. Nginx and Cloudflare Tunnel modes ask for separate user/admin domains and the relevant certificate email or Tunnel credentials.
- Management gateway public IPv4 or direct DNS name, without a CDN proxy. Leave it empty to configure the gateway later.

## What It Does

- Installs Node.js, pnpm, PostgreSQL, Redis, Nginx, and systemd dependencies.
- Creates the database connection and `/opt/incudal/.env`.
- Downloads the latest GitHub Release artifact and its `.sha256`, then verifies it before extraction.
- Extracts PayIncus into `/opt/incudal`.
- Runs Prisma migrations and Prisma Client generation.
- Creates the `incudal` system user and `incudal-backend` service.
- Creates OTA, certificate, cache, and log directories.
- Writes Nginx configuration for both domains.
- Sets `FRONTEND_URL`, `ADMIN_FRONTEND_URL`, `SITE_URL`, and `PAYMENT_CALLBACK_BASE_URL`.
- When a gateway address is supplied, configures WireGuard, restricted SSH keys and host-key pinning, and verifies backend access before saving the configuration. The default management subnet is `10.253.240.0/24`; allow inbound UDP `51820` in the cloud firewall.

## Host Pool Management Gateway

Automatic onboarding and host management use a separate WireGuard tunnel. The control server must permit root SSH public-key authentication; the installer does not change the global login policy. The user portal can use a CDN, but the management gateway needs a public IPv4 or direct DNS name.

To configure an existing installation or finish a skipped gateway setup:

```bash
sudo bash install-panel.sh --configure-host-pool
```

Use `ONBOARDING_PUBLIC_HOST`, `ONBOARDING_MANAGEMENT_ADDRESS`, `ONBOARDING_WG_PORT` and `ONBOARDING_CONTROL_SSH_PORT` to set the address and ports. Existing gateway keys and peers are preserved. See [host pool configuration](https://github.com/mastalee928/payincus/blob/main/docs/host-pool.md) for a separate or custom gateway.

## Upgrade and Uninstall

```bash
sudo bash install-panel.sh --upgrade
sudo bash install-panel.sh --uninstall
```

`--upgrade` is only for the legacy non-atomic layout. If `/opt/incudal/current` is an atomic symlink, the script exits safely; use admin OTA instead so `current/releases` is not overwritten.

Legacy upgrades preserve `.env`, certificates, runtime caches, and OTA directories. Uninstall removes all of `/opt/incudal`, including runtime assets, OTA releases, and update logs. PostgreSQL/Redis services and database data are not removed automatically. Back up the database and installation directory first.

## Post-install Checks

```bash
systemctl status incudal-backend --no-pager
journalctl -u incudal-backend -n 100 --no-pager
```

Open:

```text
https://panel.example.com
https://admin.example.com
```

Run split deployment verification:

```bash
cd /opt/incudal/current 2>/dev/null || cd /opt/incudal
FRONTEND_URL=https://panel.example.com \
ADMIN_FRONTEND_URL=https://admin.example.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```

If atomic OTA layout is enabled, the runtime directory is `/opt/incudal/current`; otherwise it is `/opt/incudal`.
