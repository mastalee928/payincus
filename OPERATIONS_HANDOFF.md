# PayIncus 操作手册

适用仓库：[mastalee928/payincus](https://github.com/mastalee928/payincus)。当前版本与验证证据以 [HANDOFF.md](HANDOFF.md) 为准。此文件只包含可公开的运维规则；实际地址、账号、凭据和备份证据另存于维护者内部记录。

## Private Backend Must Run As A Single Instance

The private backend on 127.0.0.1:3001 must run as exactly one Node.js process. Treat a second backend replica as an unsupported deployment. Login locks, OAuth nonces, replay prevention, task state and configuration caches include process-local state; PostgreSQL advisory locks do not make multiple replicas safe. Move that state into shared storage before considering additional workers.

用户端与管理端使用不同源，通过各自的 /api 和 /api/ws 代理到同一后端，不共享 cookie 域。生产设置 SERVE_STATIC_CLIENT=false，由 Nginx 或现有入口提供两端静态文件。

## 安装与来源

```bash
curl -fsSL https://raw.githubusercontent.com/mastalee928/payincus/main/scripts/install-panel.sh -o install-panel.sh
sudo bash install-panel.sh
```

面板安装目录为 /opt/incudal；旧布局直接运行该目录，原子 OTA 布局使用 releases/ 与 current 软链。不要把旧版 --upgrade 用于原子布局。

源码、发行包和更新源均应使用自己的仓库：

```dotenv
SYSTEM_UPDATE_RELEASE_REPOSITORY=mastalee928/payincus
INCUDAL_AGENT_RELEASE_REPOSITORY=mastalee928/payincus
INCUDAL_AGENT_RELEASE_DIR=
```

INCUDAL_AGENT_RELEASE_DIR 仅供临时验收覆盖；正常安装从自己的 Agent Release 获取二进制。不要公开 .env、私钥、cookie 或带认证信息的日志。

## 管理网关

一键安装可配置 WireGuard 与受限 SSH 网关。地址必须为公网 IPv4 或直连域名，不能经过 CDN；云厂商安全组需允许管理 UDP 端口。安装时跳过可执行 `sudo bash install-panel.sh --configure-host-pool`。

默认管理地址 10.253.240.1/24、UDP 51820、主控 SSH 22。使用 ONBOARDING_MANAGEMENT_ADDRESS、ONBOARDING_WG_PORT、ONBOARDING_CONTROL_SSH_PORT 调整。已有密钥和 peer 保留，冲突时停止。自动接入的宿主机通过 WireGuard 管理，公网 22 端口交给客户实例。

## 发布和更新

1. 完成类型检查、相关守卫、全套测试、双端构建和受影响流程的测试。
2. 将已审查的源码提交到本仓库，先手动运行 Build & Release 做预览验证。工作流在 amd64/arm64 临时机器上从真实发行包运行一键安装，验证数据库迁移、唯一后端、两端页面、管理员登录与管理网关。
3. 验证成功后推送稳定版本标签，核对面板双架构安装包、SHA256、OTA manifest 和 Agent Release。Agent Release 不设置为面板 latest。
4. 更新前备份数据库、.env、证书、网关配置和私钥；只在 owner 授权后更改现有主控。更新失败先保留日志和备份，再按已验证流程回滚。
5. 更新后检查唯一后端、两端访问、登录、Agent 心跳以及变更涉及的业务流程，并将实证写入版本台账。

禁止未经明确批准设置 RUN_DB_CHECKS=0。数据库和支付就绪检查失败时，先查明原因，不能以跳过检查代替修复。

```bash
systemctl status incudal-backend --no-pager
curl -fsS http://127.0.0.1:3001/api/health
```

详细安装说明见 [一键安装](docs-site/docs/deployment/one-click-install.md)，故障换机、隔离恢复、协议切换与 IP 变更见 [主机接入与管理](docs/host-pool.md)。
