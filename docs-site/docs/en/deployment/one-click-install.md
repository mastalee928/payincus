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

## Cloudflare Tunnel (Option 2)

In Cloudflare Zero Trust → Networks → Tunnels / Connectors, create a **Cloudflared** tunnel. Add two Public Hostnames / Published application routes:

| Setting | User portal | Admin portal |
| --- | --- | --- |
| Subdomain | `panel` | `admin` |
| Domain | Your Cloudflare-managed domain | The same domain |
| Path | Empty | Empty |
| Service Type | **HTTP** | **HTTP** |
| URL | **127.0.0.1:80** | **127.0.0.1:80** |

If the interface has a single **Service URL** field (shown as “内网 Service URL” in Chinese), enter **`http://127.0.0.1:80`** for both routes, including the scheme and port. If Type and URL are separate fields, select **HTTP** and enter **`127.0.0.1:80`** as the URL. Select the Cloudflare-managed zone and enter each portal's subdomain prefix.

Both routes use the same tunnel and the server's Nginx port `80`. Nginx serves the matching frontend by hostname and proxies `/api` to the backend. Keep advanced settings at their defaults and leave **HTTP Host Header empty**. Do not use backend port `3001`; browsers still use HTTPS. This assumes cloudflared runs directly on the server, as installed by this script, rather than inside a separate container. Confirm the corresponding DNS records were created. The installer does not create Cloudflare routes or DNS records.

Choose option **2** in the installer; option **3** only starts the backend. Enter two distinct domains without a scheme, path or port. The installer then displays both actual Public Hostnames and their complete Service URLs; save these routes in the same tunnel. When prompted, paste only the token after `service install` in Cloudflare's installation command, not the whole command or an API token. Token input is hidden and raw cloudflared output is not printed.

An existing cloudflared service is never overwritten or restarted. Enter `reuse` only after confirming it is the intended tunnel and both routes exist; empty input cancels configuration. An inactive existing service must be investigated and started separately. Public inbound ports 80/443 are unnecessary, but outbound UDP/TCP **7844** must be allowed; component downloads also require outbound HTTPS.

Download the current installer before using these commands:

```bash
curl -fsSL https://raw.githubusercontent.com/mastalee928/payincus/main/scripts/install-panel.sh -o install-panel.sh

# Configure an existing installation; restart the single backend to apply URLs
sudo bash install-panel.sh --configure-cf-tunnel

# Read-only checks; no configuration changes or service restarts
sudo bash install-panel.sh --check-cf-tunnel
```

Checks cover Nginx, both local pages, backend health, both API proxies, service activity, live tunnel connections from the current process, and both public HTTPS pages/APIs. Any failure or unverifiable layer returns a nonzero exit code. A running service alone does not prove connectivity. Browser login, WebSocket terminals and payment callbacks still require live acceptance testing.

Public DNS, connection and timeout failures get at most **3 attempts**, with **3 seconds** between retries, using the server's existing resolver. HTTP errors, unexpected content and certificate errors are not retried. The check does not switch DNS providers, change resolver settings or bypass certificate validation. If a browser works while the server still cannot resolve a new domain, server-side DNS caching or propagation delay may be responsible. Rerun `--check-cf-tunnel` later; **do not reinstall the panel**. Unverified checks still return a nonzero exit code after retries.

| Failure | What to check |
| --- | --- |
| Invalid token / failed service install | Copy the token from the correct tunnel; check permissions and systemd. Do not share credential-bearing service commands or raw output. |
| Port 80 occupied / invalid Nginx config | Inspect `sudo ss -ltnp` and `sudo nginx -t` locally; resolve other services or duplicate site definitions yourself. |
| Tunnel disconnected / Inactive | Check revoked tokens and outbound UDP/TCP 7844; the dashboard should show Healthy. |
| Connection metrics unavailable | Custom metrics settings or version differences may prevent automated verification; confirm Healthy in Cloudflare. |
| DNS failure | Check both public routes and DNS records. If browsers work, allow server-side DNS caches or propagation delays to clear, then rerun the read-only check. |
| HTTP 502 | Check Service URL=`http://127.0.0.1:80`, or HTTP → 127.0.0.1:80, Nginx, and the backend/API proxy. |
| HTTP 530 (possibly Cloudflare 1033) | Check tunnel connections, routes and DNS. |
| Redirect / 403 / unexpected HTTP 200 content | Check Access/WAF, HTTP Host Header, swapped portals, HTML caching or rewriting. |
| TLS error / timeout | Check outbound connectivity, system time, CA certificates and Cloudflare edge certificates. |

Page checks compare the response with the matching local build; API checks require JSON `status=ok`. Access login pages and intentional HTML rewriting may prevent automated verification and require separate manual evidence. Do not protect third-party payment callback paths with interactive Access login. Cloudflare Tunnel does not replace the host pool's direct WireGuard/SSH management gateway.

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
