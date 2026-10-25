# v1.7.2 主控 DD 与 OSS 恢复操作说明

适用于主控兼管理网关 A 丢失、在 B 或 DD 后的原机器恢复管理。客户宿主与客户 VPS 保留原机器和磁盘。DD 由 owner 执行；只在下列准备全部完成后操作。

## DD 前：在原主控完成准备

1. 原站仍为 v1.7.1 时，先备份数据库、`.env`、证书、WireGuard 和管理 SSH 身份，再升级正式 v1.7.2。旧平铺布局使用新版安装器 `--upgrade`；存在 `/opt/incudal/current` 的原子布局使用后台在线更新，不能用旧布局升级命令。不要跳过数据库/支付就绪检查。
2. 登录管理后台，确认版本与唯一后端健康、原账户与宿主记录正常。v1.7.1 的旧归档不能被追认为已保存新增控制签名身份；须用新版重新制作完整备份。
3. 准备固定管理域名，例如 `gateway.example.com`，A 记录指向当前网关，设置 DNS only，保存原 WireGuard UDP 端口。后台「机器池 → 管理网关」保存域名和端口，再逐台对已有宿主执行「补装并核验」。所有需恢复的宿主都须确认成功；失败项先修复原管理通道。不能通过客户公网 22 登录宿主。
4. 在「系统 → 阿里云 OSS」保存并测试专用私有桶、短备份前缀（建议如 `payincus-backups/`）、RAM 凭据与独立备份密码。立即备份，确认完整性验证、两份上传及回读完成，状态成功。告警或失败先查清，不能把文件存在当成通过。
5. 把 OSS 区域、桶、完整备份集路径（含安装 ID/备份 ID）、原密码、RAM 凭据、快照时间、管理员登录/MFA 恢复材料安全保存到主控之外。另保存域名、UDP 端口、管理地址、外部支付与订单凭证。凭据不要写入聊天、命令参数或公开文档。
6. 用匹配版本执行一次恢复预检；确认 PostgreSQL 大版本与 locale 可用、备份完整且含原控制/WG/SSH/Incus 身份。预检通过后记录结果。暂停新销售和财务写入，制作最终成功备份并记录截止时间；截止后的付款、续费、退款、订单和撤销必须保留外部证据。
7. 确认旧主控业务后端已停止并隔离，避免旧主控复活继续写入。仅 DD 主控；客户宿主和客户 VPS 不参与 DD。

平台备份包含管理数据和受管身份，不包含客户 VPS 磁盘。定时快照存在备份间隔；它不提供零数据丢失保证。

## DD 后：安装正式版本

准备 Debian 12+ 或 Ubuntu 22.04+、公网网络与 root 权限。本版恢复验收使用 PostgreSQL 16；保持与备份相同的大版本及 libc locale。

在独立空目录下载对应架构的正式包和安装器：

```bash
mkdir -p /tmp/incudal
cd /tmp/incudal
case "$(uname -m)" in
  x86_64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo '不支持的架构'; exit 1 ;;
esac
curl -fLO "https://github.com/mastalee928/payincus/releases/download/v1.7.2/incudal-v1.7.2-linux-${arch}.tar.gz"
curl -fLO "https://github.com/mastalee928/payincus/releases/download/v1.7.2/incudal-v1.7.2-linux-${arch}.tar.gz.sha256"
sha256sum -c "incudal-v1.7.2-linux-${arch}.tar.gz.sha256"
curl -fsSL https://raw.githubusercontent.com/mastalee928/payincus/v1.7.2/scripts/install-panel.sh -o install-panel.sh
sudo bash install-panel.sh
```

任何下载或校验失败都先停止。新机器的 `/tmp/incudal` 只保留该架构这一份包；安装器会从这个固定目录识别完整包，再进行安装校验。安装过程中配置用户端与管理端两个独立网站入口，以及 B 的直连管理网关和原 UDP 端口。新安装会准备受信组件和 B 的初始身份；恢复将取回 A 的原身份，不手工复制旧组件或重新初始化替代密钥。

云安全组和本机防火墙允许原管理 UDP 端口。网站使用 Cloudflare Tunnel 时，两个网站 Service URL 均为 `http://127.0.0.1:80`；管理域名仍须 DNS only，网站 Tunnel 不转发 WireGuard。

安装后检查：

```bash
systemctl show incudal-backend -p MainPID -p ActiveState -p NRestarts
curl -fsS http://127.0.0.1:3001/api/health
```

每台主控只运行一个业务 Node 后端。确认双端入口、管理员登录和 v1.7.2 版本正常，再执行恢复。

## 从 OSS 恢复并保持保护

新后台「阿里云 OSS」配置原桶的读取凭据和原备份根目录，找到最终成功备份，输入原密码执行预检。输入页面显示的 `RESTORE <预检ID>` 正式恢复；预检只有 15 分钟有效期，过期后重新预检。

无法使用后台时，可在已安装机器使用交互工具；每条命令输入秘密时均隐藏：

```bash
app=/opt/incudal
if [ -d /opt/incudal/current ]; then app=/opt/incudal/current; fi
sudo python3 "$app/scripts/platform-backup-recovery.py" configure
sudo python3 "$app/scripts/platform-backup-recovery.py" preview
sudo python3 "$app/scripts/platform-backup-recovery.py" status
sudo python3 "$app/scripts/platform-backup-recovery.py" restore
```

恢复后旧会话和 API 凭据失效，使用原管理员密码与必要 MFA 重新登录。数据库外持久保护继续生效：普通业务、回调、Agent 和调度暂停是预期状态，不要直接删除保护文件。

将固定管理域名 A 记录切到 B 公网 IPv4，保持原 UDP 端口。补装成功的宿主每 30 秒重新解析，仅更新原 WireGuard peer Endpoint；DNS 传播仍可能延迟。未补装或旧 IP 固定的宿主须通过云厂商串口/root 控制台处理原隧道，不能假定 DNS 切换会覆盖它们。

## 保护内核账、检查宿主，再恢复运营

1. 「恢复核对」检查原账户、宿主与实例清单，执行管理 SSH/Incus 探测；核对原信任、UUID、运行态、存储、客户端口和 IPv4/IPv6 转发。失联、指纹变化或库存不符先修复。管理恢复本身不重建、重启或迁移客户 VPS。
2. 按快照截止时间逐项核对实际到账、每笔已完成续费、退款、购买/交付、余额、宿主收益、返利、权限撤销与待处理任务。「账户余额 → 核对并修订」填写凭证确认的最终余额、到账净额/时间；已经完成的续费逐笔补回正常账单与精确账期，输入管理员密码/MFA 提交。单独填写到期不会补回正常账单。其他业务记录不由余额修订自动重放；必须分别核对。
3. 确认没有遗漏或重复入账、旧 A 已隔离，才输入 `RESUME AFTER RECONCILIATION`。CLI 可使用 `sudo python3 "$app/scripts/platform-backup-recovery.py" resume`。后端正常启动有等待时间；失败时保留保护并查任务状态，不循环重复解除。
4. 检查真实 Agent 心跳、客户既有连接、双端页面及账单。存在库存隔离的宿主使用「检查并恢复所选宿主」，只解除检查通过的项；保留已分配实例和资源，不清理未知磁盘。
5. 「计费管理 → 概览」确认巡检运行，可先执行立即巡检，再观察下一次自然五分钟执行。自动补续按核账后的余额和到期处理，不追扣多期离线费用；检查扣费仅一次、正常账单、站内信和原 TG 绑定通知。到期删除须确认远端实例不存在后才释放库存；不要拿现存客户实例作删除测试。
6. 重新测试 OSS 配置并显式开启自动备份。映射 B 的网站入口、支付回调/白名单、邮件及 TG 配置，保留回退数据库和恢复证据，验收后再安排清理。

回退仅在保护期间使用 `ROLLBACK RESTORE`，回退后仍保持保护。详情见 [OSS 平台备份](../docs-site/docs/deployment/oss-backup.md) 与 [操作手册](../OPERATIONS_HANDOFF.md)。

本说明交付单主控灾后恢复流程；独立 A/B 切换切回、四拓扑、最新撤销链自动恢复及 72 小时离线验收仍属于持续工程，不能据本流程宣布完成。
