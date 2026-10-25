---
title: 一键安装
description: 使用经过校验的 GitHub Release 在 Debian 或 Ubuntu 上部署 PayIncus
---

# 一键安装

<p class="doc-lead">使用官方安装脚本在新服务器上部署 PayIncus。脚本负责依赖、数据库、环境变量、systemd 和外部访问入口。</p>

<div class="doc-meta">
  <div><span>适用场景</span><strong>首次生产部署</strong></div>
  <div><span>支持系统</span><strong>Debian / Ubuntu</strong></div>
  <div><span>默认目录</span><strong>/opt/incudal</strong></div>
</div>

::: tip 完成结果
安装完成后会得到独立的用户端、管理端和本机后端服务。Release 产物必须通过 SHA256 校验后才会解压。
:::

## 前置要求

所有模式都需要一台干净的 Debian / Ubuntu 服务器和 root 或 sudo 权限。外部访问条件取决于安装时选择的模式：

| 模式 | 域名和网络要求 |
| --- | --- |
| Nginx + Certbot | 准备用户端和管理后台两个域名，A/AAAA 指向服务器，并开放公网 80/443。 |
| Cloudflare Tunnel | 两个域名由 Cloudflare 管理，准备 Tunnel 凭证；服务器不需要开放公网入站 80/443。 |
| 仅启动服务 | 不要求脚本配置域名或 TLS；后端默认监听本机端口，由现有反向代理或内网入口接管。 |

默认安装目录是 `/opt/incudal`。这是当前安装脚本、systemd、OTA 和生产 release 布局使用的真实路径。

## 安装命令

```bash
curl -fsSL https://raw.githubusercontent.com/mastalee928/payincus/main/scripts/install-panel.sh -o install-panel.sh
sudo bash install-panel.sh
```

安装过程中按提示输入：

- 初始管理员邮箱，留空默认 `admin@payincus.local`。管理员密码随机生成，安装完成后显示，请妥善保存。
- 外部访问模式；选择 Nginx 或 Cloudflare Tunnel 时，填写用户端和管理后台域名，以及相应证书邮箱或 Tunnel 凭证。
- 机器池管理网关的公网 IPv4 或直连域名，不能经过 CDN。留空可稍后配置。

## Cloudflare Tunnel 配置（选项 2）

Cloudflare Tunnel 适合无公网 IP 或希望隐藏网站源站的服务器。浏览器通过 Cloudflare HTTPS 入口访问，服务器上的 `cloudflared` 主动建立出站连接，再转发到本机 Nginx。无需开放公网入站 80/443，但应允许服务器出站 UDP/TCP `7844`；下载安装组件还需要 HTTPS 出站访问。

### 先在 Cloudflare 添加两个域名路由

1. 将域名接入 Cloudflare，进入 Zero Trust → Networks → Tunnels / Connectors（名称随控制台版本变化）。
2. 创建类型为 **Cloudflared** 的 Tunnel，名称可以填写 `payincus-panel`。
3. 在 Public Hostnames / Published application routes 中添加以下两条路由：

| 配置项 | 客户面板 | 管理后台 |
| --- | --- | --- |
| Subdomain | `panel` | `admin` |
| Domain | `example.com`（替换为你的域名） | 同一个域名 |
| Path | 留空 | 留空 |
| Service Type | **HTTP** | **HTTP** |
| URL | **127.0.0.1:80** | **127.0.0.1:80** |

如果界面只有一个「内网 Service URL」输入框，两条路由都直接填 **`http://127.0.0.1:80`**（带 `http://` 和端口）。如果界面将 Type 和 URL 分开，则选择 **HTTP**，URL 填 **`127.0.0.1:80`**。Zone 选择已接入 Cloudflare 的域名，子域名分别填写用户端与管理端前缀；例如 Zone=`example.com`、子域名=`panel` / `admin`。

一个 Tunnel 可以同时提供两端入口。两条路由共用服务器上 Nginx 的 `80` 端口，由 Nginx 按域名分别托管前端并反代 `/api`，不要填后端端口 `3001`。这里的 HTTP 只表示本机连接，浏览器仍使用 HTTPS。高级设置保持默认，**HTTP Host Header 留空**，让 Nginx 根据访问域名区分两端。此配置适用于安装脚本直接在服务器上安装 `cloudflared`，不适用于独立 Docker 容器内的 loopback 地址。

保存后确认 CF 为两条路由建立对应 DNS 记录；如果提示已有同名 DNS 记录冲突，先核实该记录的用途再自行调整。脚本不会替你创建或更改 Cloudflare 路由和 DNS。

### 再填写安装脚本

在脚本中选择 **2**（选项 **3** 仅启动后端，需自行配置反代）。先填写 `panel.example.com` 和 `admin.example.com` 两个不同域名，不带协议、端口或路径。脚本会按实际输入显示两条 Public Hostname 与完整内网 Service URL，照表在同一个 Tunnel 保存路由。随后按提示输入 Tunnel Token：它是 Cloudflare 提供的 `cloudflared service install` 命令中最后的长字符串，**只复制 Token，不是整条命令，也不是 API Token**。输入隐藏，不会打印安装器捕获的原始 cloudflared 输出。

已有 `cloudflared` 服务时，脚本不会安装新 Token、覆盖隧道或重启该服务。确认已有服务就是你要使用的 Tunnel，并且已添加上述两条路由后，输入 `reuse` 复用；回车会停止配置。已有服务离线时应先自行检查，脚本不会自动替换为另一个 Tunnel。

### 为已有安装补配或重新检查

下载当前安装脚本后运行：

```bash
curl -fsSL https://raw.githubusercontent.com/mastalee928/payincus/main/scripts/install-panel.sh -o install-panel.sh

# 配置两端域名、Nginx 和 cloudflared；重启唯一后端使地址生效
sudo bash install-panel.sh --configure-cf-tunnel

# 只读诊断；不修改配置、不重启服务、不升级程序、不迁移数据库
sudo bash install-panel.sh --check-cf-tunnel
```

首次安装及补配会检查 Nginx、本机两端页面、后端健康状态、两端 API 反代、cloudflared 服务、当前进程实时连接指标及两端公网 HTTPS 页面/API。只有全部通过才宣布访问检查通过；失败或无法验证会返回非零退出码，首次安装仍会显示本机部署信息供后续排错。安装检查不代替浏览器登录、WebSocket 终端及支付回调的真实验收。

公网请求遇到 DNS 解析失败、连接失败或超时时，使用服务器原有解析方式最多尝试 **3 次**，两次重试间隔 **3 秒**。HTTP 错误、页面内容不符和证书错误不会重试，也不会切换 DNS、修改系统解析配置或绕过证书校验。如果浏览器已能打开，但服务器仍解析失败，可能是服务器递归 DNS 的缓存或新记录传播延迟；稍后重跑 `--check-cf-tunnel`，**无需重装面板**。重试后仍未验证的检查会保持非零退出。

### 常见失败位置

| 提示 | 检查方向 |
| --- | --- |
| Token 无效 / 服务安装失败 | 从正确 Tunnel 页面重新复制 Token；检查权限和 systemd。原始输出可能含凭据，安装器不直接打印。 |
| 本机 80 端口被占用 / Nginx 配置失败 | 在本机运行 `sudo ss -ltnp`、`sudo nginx -t`；自行处理其他服务或重复站点配置。 |
| cloudflared 未运行 | 检查是否成功安装、Token 是否有效；不要公开包含 Token 的服务启动命令或配置。 |
| 隧道未建立 / CF 显示 Inactive | 检查 Token 是否撤销和出站 UDP/TCP 7844，CF 后台应显示 Healthy。 |
| 隧道尚未验证，指标不可读 | 脚本无法读取当前进程的 loopback metrics，可能是自定义 metrics 配置或版本差异；在 CF 后台手动确认 Healthy。 |
| DNS 解析失败 | 核实两条公网域名路由与 DNS 记录；浏览器可访问但服务器失败时，等待服务器 DNS 缓存或传播延迟消退，再运行只读检查。 |
| HTTP 502 | 核实内网 Service URL=`http://127.0.0.1:80`，或 Type=HTTP、URL=127.0.0.1:80；若只 API 失败，再检查本机后端和 `/api` 反代。 |
| HTTP 530（可能是 CF 1033） | 检查 Tunnel 连接、路由和 DNS。 |
| 302 / 403 或 200 内容不符 | 检查 Access / WAF、HTTP Host Header、两端是否指反，以及 HTML 缓存或改写。 |
| HTTPS / 请求超时 | 检查出站网络、系统时间与 CA 证书、CF 边缘证书，修正后重跑只读检查。 |

脚本会把 HTTP 200 的页面与对应本机构建比对，并校验健康 API 的 JSON `status=ok`，避免将错误站点、Access 登录页或两端指反误判为成功。若有意启用 Access 或 HTML 改写，自动检查可能无法通过；需另行记录人工验证，不能将“尚未验证”当作“已验证”。不要将 Access 登录验证套在需要第三方访问的用户端支付回调路径上。

CF Tunnel 只负责网站访问，机器池 WireGuard / SSH 管理网关仍需直连公网 IPv4 或域名。

## 脚本会做什么

- 安装 Node.js、pnpm、PostgreSQL、Redis、Nginx 和 systemd 依赖。
- 创建数据库连接和 `/opt/incudal/.env`。
- 下载最新 GitHub Release artifact 及其 `.sha256`，校验通过后才解压。
- 解压 PayIncus 到 `/opt/incudal`。
- 执行 Prisma migration 和 Prisma Client 生成。
- 创建 `incudal` 系统用户和 `incudal-backend` 服务。
- 创建 OTA、证书、缓存和日志目录。
- 写入用户端和管理端 Nginx 配置。
- 设置 `FRONTEND_URL`、`ADMIN_FRONTEND_URL`、`SITE_URL` 和 `PAYMENT_CALLBACK_BASE_URL`。
- 如果提供管理网关地址，配置 WireGuard、受限 SSH 密钥与主机指纹，验证后端连接后写入环境配置。默认管理地址池为 `/20`，单网关可接入4093台宿主；云厂商安全组需允许网关 UDP 通信。

## 机器池管理网关

机器池自动接入和宿主机管理使用独立的 WireGuard 隧道。主控需允许 root 公钥 SSH 登录；安装器不会更改全局登录策略。用户端域名可以经过 CDN，但管理网关必须使用公网 IPv4 或直连域名。

常规补配使用后台「机器池 → 管理网关」：直接检查当前主控本机并确认计划，不填写本机SSH。系统自动规划地址池、保留原密钥和 peer，并持续显示步骤与结果。固定直连域名保存一次；已接入宿主自动补装更新服务，新宿主自动加入，失败项可以批量重试。

以下 CLI 仅供维护者在网页不可用时兜底：

```bash
sudo bash install-panel.sh --configure-host-pool
```

可通过 `ONBOARDING_PUBLIC_HOST`、`ONBOARDING_MANAGEMENT_ADDRESS`、`ONBOARDING_WG_PORT`、`ONBOARDING_CONTROL_SSH_PORT` 指定地址和端口。已有网关密钥与 peer 会保留。分离部署或自定义网关见[机器池配置](https://github.com/mastalee928/payincus/blob/main/docs/host-pool.md)。

## 升级和卸载

```bash
sudo bash install-panel.sh --upgrade
sudo bash install-panel.sh --uninstall
```

`--upgrade` 只用于旧版非原子目录。检测到 `/opt/incudal/current` 原子布局时，脚本会安全退出，请改用管理后台 OTA，避免覆盖 `current/releases`。

旧版升级会保留 `.env`、证书、运行缓存和 OTA 目录。卸载会删除整个 `/opt/incudal`，包括运行资产、OTA release 和更新日志；PostgreSQL/Redis 服务及数据库不会自动删除。卸载前先完成数据库和安装目录备份。

## 安装后检查

```bash
systemctl status incudal-backend --no-pager
journalctl -u incudal-backend -n 100 --no-pager
```

访问：

```text
https://panel.example.com
https://admin.example.com
```

执行生产 split 验证：

```bash
cd /opt/incudal/current 2>/dev/null || cd /opt/incudal
FRONTEND_URL=https://panel.example.com \
ADMIN_FRONTEND_URL=https://admin.example.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```

如果你启用了原子 OTA 布局，当前运行目录是 `/opt/incudal/current`；旧布局则是 `/opt/incudal`。
