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

### Cloudflare Tunnel 网站入口

安装器选择选项 2，同一个 Tunnel 为用户端与管理端分别添加 Public Hostname。合并的「内网 Service URL」输入框均填 `http://127.0.0.1:80`；若 Type/URL 分开，选 HTTP、URL 填 `127.0.0.1:80`。Path 与 HTTP Host Header 留空，由本机 Nginx 按域名提供各端前端与 `/api` 反代。保存路由后核实对应 DNS 记录，网站 Tunnel 不替代机器池管理网关。

已有安装可运行 `sudo bash install-panel.sh --configure-cf-tunnel` 补配；它会重启唯一后端使两端地址生效，已有 cloudflared 只允许显式 `reuse`，不覆盖或重启 Tunnel。`sudo bash install-panel.sh --check-cf-tunnel` 只读检查本机、实时隧道连接及公网两端页面/API，不升级、不迁移或重启服务。公网 DNS/连接/超时失败最多尝试 3 次，间隔 3 秒；浏览器已可访问但服务器仍解析失败时，等待其 DNS 缓存或传播延迟消退后重查，无需重装。未验证项保持非零退出。详细填写和错误提示见安装说明。

源码、发行包和更新源均应使用自己的仓库：

```dotenv
SYSTEM_UPDATE_RELEASE_REPOSITORY=mastalee928/payincus
INCUDAL_AGENT_RELEASE_REPOSITORY=mastalee928/payincus
INCUDAL_AGENT_RELEASE_DIR=
```

INCUDAL_AGENT_RELEASE_DIR 仅供临时验收覆盖；正常安装从自己的 Agent Release 获取二进制。不要公开 .env、私钥、cookie 或带认证信息的日志。

## 管理网关

### 独立组件控制身份登记

包含完整 `vendor/gateway/` 双架构签名组件的新版发行包，在首装已核对包校验值、生成运行环境后自动准备组件并登记平台身份。正式构建从 GitHub Secret `GATEWAY_COMPONENT_SIGNING_KEY` 与变量 `GATEWAY_COMPONENT_SIGNING_PUBLIC_KEY` 取得独立发行身份，必须先核对私钥导出的公钥匹配固定变量，再签名组件；签名材料不进入安装包。Node 两种架构运行时从官方 HTTPS 下载并核对对应 SHA256，包内源码提交与面板 version.json 绑定。

组件按签名清单哈希保存到 root 私有 `/var/lib/incudal-gateway-components/`，避免 OTA 清理旧 release 使登记目录失效。已有 v2 身份的正常服务启动只刷新已验签组件目录并保持原私钥/identity；恢复保护时停止自动刷新，不从缺失文件生成新身份。旧版本无目录的安装维持显式登记流程；已有 v1 测试/人工登记需单独迁移，不能隐式重新初始化。主控控制身份仍不等于取得宿主写权或完成备用覆盖。

页面安装计划使用 root 私有登记 `/var/lib/incudal-gateway-controller/enrollment.json`。服务启动只安装受限 worker，不生成签名身份。首次登记必须显式执行 `sudo bash scripts/install-panel.sh --configure-gateway-controller --initialize < catalog.json`；已有身份仅用 `--refresh` 更新组件目录，`--verify` 只核验登记与组件。命令从已验证安装目录运行，不重启业务后端或网关。平台 `GATEWAY_PLATFORM_ID` 必须与登记的 `platformId` 一致；首次填入后重启唯一后端使环境配置生效。

`catalog.json` 仅包含 `platformId`、独立固定的 Base64 Ed25519 `packageSigningKey`，以及 `components` 的 `amd64`/`arm64` 目录、`version` 和完整 `sourceCommit`。只登记已解包、root 所有且通过固定包验证器的软件包。组件公钥必须从独立受信来源取得，不能从待安装包中自行信任；发布签名身份与本机控制签名身份分离。组件目录不可由业务服务用户写入。

初始化生成 root:root/0600 的 `signing.pem`，另存 `identity.json` 的平台/公钥摘要/组件信任绑定，最后原子发布 v2 登记。`--refresh` 保留原私钥和身份记录；平台或组件信任变化、身份文件缺失/损坏、换钥、软链、权限变宽及并发登记均拒绝，不自动重建。恢复应保留原控制身份并核对较新撤销/代次；不得用初始化替代灾备恢复。控制私钥和独立恢复材料必须安全保存，当前平台备份中的控制身份/事件链覆盖仍属于后续灾备施工，不能将本登记入口视为完整恢复已交付。

一键安装可配置 WireGuard 与受限 SSH 网关。地址必须为公网 IPv4 或直连域名，不能经过 CDN；云厂商安全组需允许管理 UDP 端口。安装时跳过可执行 `sudo bash install-panel.sh --configure-host-pool`。

默认管理地址 10.253.240.1/24、UDP 51820、主控 SSH 22。使用 ONBOARDING_MANAGEMENT_ADDRESS、ONBOARDING_WG_PORT、ONBOARDING_CONTROL_SSH_PORT 调整。已有密钥和 peer 保留，冲突时停止。自动接入的宿主机通过 WireGuard 管理，公网 22 端口交给客户实例。

## 发布和更新

### 平台控制签名身份的恢复（新增源码）

平台备份包含 root 私有 `controller/signing.pem`、`controller/identity.json`、`controller/enrollment.json`，备份前验证完整控制登记和当前平台 ID；缺失或损坏身份不自动重建。归档必须整体认证后才能读取这些文件，恢复要求三份齐全且私钥、公钥摘要、平台 ID 和独立发行信任一致。

B 先使用受信新发行正常安装并登记其组件，恢复时将原 A 控制签名身份映射到 B 已验签的组件目录；不执行备份中记录的旧路径，不把旧组件程序作为恢复来源，不生成替代密钥。发布后运行固定登记验证器，失败保持恢复保护；回滚恢复 B 之前的身份和环境并重新核验。平台数据身份不一致或不同发行信任根须停止并走明确迁移，不能用初始化绕过。

该材料补齐控制签名身份备份，不代表最新撤销/应急审计、主备写者门禁、72小时离线和整机灾备均已验收；完整能力与当前版本状态见台账。

### 固定网关域名与宿主补装（新增源码）

后台「机器池 → 管理网关」可保存裸域名和当前 WireGuard UDP 端口。域名须 DNS only，不代理 UDP；保存前核对它指向现有网关公网 IPv4、端口一致。设置保存在数据库，平台整库备份会携带它。换机时只改 DNS 不会重建密钥；B 必须恢复原 WireGuard/管理 SSH/Incus 信任与宿主记录，完成账目核对后才解除恢复保护。

已有宿主逐台点击「补装并核验」，仅使用已完成接入的管理 /32 地址、登记宿主公钥和 SSH 指纹；不会尝试客户公网22。缺失管理身份、任务冲突、指纹改变或恢复保护会阻断。界面显示失败/未补装，修复通道后可重试；补装确认只证明那次安装和绑定，不等于当前心跳在线或完整灾备通过。宿主身份或域名设置改变时，旧回执不再显示就绪。

固定程序安装为 `/usr/local/libexec/incudal-gateway-dns`，root私有 `/etc/incudal-gateway-dns.json` 绑定原宿主与网关身份。每30秒重新解析当前配置的固定域名，仅更新已核对的 WireGuard peer Endpoint，不改变密钥、AllowedIPs、管理地址或客户转发。DNS失败/非公网/配置冲突保留旧Endpoint并重试。systemd/OpenRC负责自启动和进程故障重启；重复补装保持绑定，已有绑定冲突不自动改身份/域名。迁移既有域名是另一项明确变更，不能靠删除绑定规避。

本次已验收实际 SSH/WireGuard 管理补装、同进程周期DNS重握手、systemd沙箱重启、Alpine/OpenRC重启，以及真实数据库失败/重试/互斥和浏览器按钮。整机重启、现存宿主部署、A整机不可恢复→B真实OSS恢复和账务补偿尚需继续验收，当前正式v1.7.1不含此新增功能。

### 到期巡检（新增源码，随后续发行交付）

唯一业务后端启动时注册每 5 分钟一次的实例到期巡检。管理后台「计费管理 → 概览」显示调度状态、最近开始/完成、下次执行、本轮失败数和原因；调度停止时可点击「启动巡检」，也可「立即巡检」。整个后端停止或页面无法访问时，页面无法启动系统服务，仍应由运维恢复唯一后端。最近执行时间和失败数属于本次进程，重启后重新计数。

以当前数据库到期时间为准：付费实例到期后暂停，巡检再次读取宿主实际状态，重试未成功的停机；系统到期暂停满 3 天才删除。管理员手动暂停、免费实例和已续费实例不进入该到期停机/删除流程。续费、管理员延期和到期资源操作按实例串行；续费仍使用版本及余额事务检查，陈旧续费请求需重试。

网关断网时不能确认远端停止，控制器只能保存暂停状态并重试；宿主重新可达后再核对和执行。删除先确认宿主可访问；远端删除回执不确定时保留删除待核对标记及库存占用，确认实例不存在并清理转发后在同一事务释放网络、重算库存，避免误售或重复扣减。恢复保护期间巡检不执行，解除保护前必须先完成恢复账目核对；数据库备份之后的交易无法由 DNS 恢复，需要按支付/订单证据另行对账。

验收边界及最新源码/发布状态见 [版本台账](HANDOFF.md) 和 [网关工程进度](GATEWAY_PROGRESS.md)。当前正式 v1.7.1 不包含本次巡检新增行为。

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

v1.6.8 起的阿里云 OSS 平台备份、旧版执行器补装、恢复保护和 CLI 入口见 [OSS 平台备份](docs-site/docs/deployment/oss-backup.md)。自动备份默认关闭；真实 OSS 测试桶验收与生产恢复演练必须分别记录，不能用本地存储替身的 CI 结果代替。

### 旧主控不可访问时的 OSS 换机恢复

新主控安装包含恢复兼容性修复的稳定版本，配置目标数据库、网站域名、OSS 权限及原密码，查询原安装备份目录；流程不需要访问旧主控。支持相同或同一应用主版本内较新的稳定版本（0.x 限同一 minor），保持 PostgreSQL 大版本一致。原版 v1.7.1 发行包尚未包含本轮修复，须使用包含修复的后续发行版本或经验证部署。

预检认证归档后，按原数据库编码和 libc locale 在隔离库还原、验证完整性，并使用目标发行包的受信迁移升级；已知 LF/CRLF 校验别名可兼容，未知历史或结构差异拒绝。新系统缺原 locale 时安装对应 locale 后重试。预检有效期 15 分钟，绑定发起管理员和目标结构，目标变化须重做。正式恢复保留新机连接、网站地址及 JWT 身份，恢复整库、数据解密密钥、受管证书和本机网关身份，随后保持恢复保护并撤销旧会话/API 凭证。

标准方案在新主控本机先执行 `sudo bash install-panel.sh --configure-host-pool`，使用新机直连公网地址；后台「机器池 → 配置管理网关」展示步骤。本轮不提供网页执行配置或独立远端网关自动恢复。换公网 IP 需核对宿主 WireGuard Endpoint，Cloudflare 网站 Tunnel 不代理管理 UDP。核对现存宿主、实例、库存、支付和快照后账目后才恢复运营；VPS 磁盘和外部数据需另行备份。
