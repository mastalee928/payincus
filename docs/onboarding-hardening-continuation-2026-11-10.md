# 新接入自动加固续接与纯净系统准备

本轮只修改本机源码并运行隔离测试，未连接生产主控、真实宿主或客户，未提交、推送、部署或发行。基于 `2620f05ba44a7ffd23bb9a3fe84a73aecb7109c4` 的未提交文件；实际文件和日志摘要见 `logs/hardening46-evidence-index.json`。稳定 v1.8.5 安装包与此前生产验收结果不因本文改变。

## 新宿主长期不可售的原因和修复

此前只读诊断中，新接入任务已经进入 hardening 并保存维护请求。普通安全巡检没有接入任务的有效 lease，却试图继续该维护，随后将下一次检查不断推后；正确的接入 worker 因而领不到任务。第二台又被原维护请求的全局保护阻挡。原身份一致，不能解释为密码错误。

本轮在真实本机 PostgreSQL 复现旧代码失败。现在普通巡检不接管仍归接入任务所有的维护，也不修改其到期时间；接入 worker 携带当前 lease，依次续接维护、完整加固、准备和完成入库。队列优先处理原维护请求，避免另一台先取得维护通道。最终 verified 与任务 succeeded 之间如果进程中断，30 秒后可继续完成，不再等下一次 24 小时健康检查。

原请求、有效管理员、原 SSH／Agent／Incus 身份、客户占用、当前 lease、原生架构门禁和完整回执保持。blocked 维护优先显示具体维护错误，不再被旧的初始 AppArmor 诊断覆盖。

## 纯净系统的自动准备

- 仅原 SSH 身份认证与空闲宿主预检通过后执行。支持分支按 Alpine／Debian／Ubuntu、x86_64／aarch64 判断；代码分支覆盖不等于全部原生系统验收。
- 宿主时间严重偏差时先通过受信 SSH 获取主控 UTC 粗校时，避免 HTTPS 证书检查被错误时间挡住；包签名与 TLS 检查保持开启。随后启用 chrony 并实际等待同步检查，未就绪自动退避。
- 宿主自己请求固定 `https://ipinfo.io/json`，验证 IP 和 IANA 时区／本地 zoneinfo 文件后设置 `/etc/localtime` 和 `/etc/timezone`。此设置不改账期或 UTC 时间戳。禁止响应重定向、代理、路径穿越和执行响应内容；请求不携带平台密码、token 或客户资料。
- 地理查询有响应大小和总时限，成功缓存一天。首次查询失败保留原时区，systemd timer／Alpine hourly cron 每小时补试；无常驻 Python 进程。文件路径、权限或配置冲突单独报错，不能假装查询成功。原生 Linux 的锁、符号链接、服务启动和实际当地时钟仍需实机验收。
- Alpine 使用当前稳定分支的签名 main/community 包；Debian 包锁等待、网络请求和 dpkg 中断配置均有时限。不删包管理锁、不杀其他更新进程、不切换发行分支。
- 内核支持 BBR 时启用并持久化；不支持时保留原可用算法，不为 BBR 自动换内核。
- 复用已有至少约 1GiB 磁盘 swap（允许文件头占用），不缩小大 swap、不关闭旧 swap；缺少时按已有流程创建并持久化。zram 不冒充磁盘 swap。锁改为非阻塞并核所有者／链接，旧 root 所有 0644 锁收紧为 0600，保留同一 inode；命令超时或锁占用自动续接。未知文件、非受信路径和格式冲突保留明确失败。
- 一机一卖接入使用 Btrfs。Debian 安装器补齐非交互 `--yes`，不进入无关的 ZFS 编译／换内核或返回菜单。

## 失败续接和凭据

SSH 暂时不可达／断线／命令超时、准备依赖、时间同步、BBR／swap 暂未就绪、安装脚本下载、明确的安装依赖失败、管理通道暂不可达和 Agent 等待按 15 秒至 5 分钟退避。原凭据 24 小时到期上限保持；过期不继续使用或无限延长密码保存。

安装器仅在已识别的包准备失败时返回专用 75 回执，允许下一次自动尝试。其他安装错误、超时与未知中断不盲目重跑整套安装器。自动重试、lease 恢复与管理员显式重试分开，避免因 attempt 递增而绕过未知失败或自动轮换过期安装 token。安装有原 PID／boot／退出文件和总时限；CLI 部分安装而无任何 Incus 数据时可继续，已有不可访问数据库／存储／客机目录不能推断为空。

SSH 凭据继续用 AES-256-GCM 加密保存，每次随机 nonce。接入及重试读取新增严格格式和认证检查，错 key、篡改、旧明文拒绝，不再回落为明文。列表不返回密文或密码，日志脱敏；完成、取消、删除和到期清理保持。生产加密 key 必须独立保存于原受限配置中；加密不能抵御已同时掌握主控运行权限和 key 的攻击者。

## 本轮实际验证

| 验证 | 证据及范围 |
| --- | --- |
| 旧缺陷复现 | `hardening46-reproduce-onboarding-hardening-continuation.log`：普通巡检推后原任务 due time，失败原日志保留。 |
| 接入到可售 | `hardening46-followup3-onboarding-hardening-continuation.log`：真实 PG、真实 claim／维护／完成／库存／公开目录／带锁分配器，AMD64／ARM64夹具，两台顺序、旧维护回退续接、失效lease零远端写、完成前中断。远端命令、内核与boot是替身。 |
| 调度和维护回归 | `hardening46-fix2-security-hardening-queue.log`、`hardening46-fix2-host-security-maintenance.log`、`hardening46-fix2-hardening-saleability.log`。对应代码后续未改。 |
| 凭据和UTC调度 | `hardening46-freeze-host-onboarding-lease-integration.log`：真实 PG 非UTC会话、退避、显式／自动重试区分、API拒绝普通用户和明文凭据、列表无秘密。 |
| 系统准备和失败分支 | `hardening46-final-source-onboarding-bootstrap-guards.log`：四系统／架构组合生成脚本实际经 Git Bash 运行，宿主命令是替身；安装75回执、未知失败／中断保护、部分安装预检；时区7项、swap10项 Python 测试。Windows 对 POSIX owner／flock／symlink 使用明确替身，非原生证据。 |
| 安装和原客户保护 | `hardening46-followup3-host-install-inputs.log`、`host-install-script-guards.log`、`host-install-session-integration.log`（同前缀）：非交互／Btrfs依赖、两架构现有客户／残留拒领完整安装器、原身份保持。 |
| 相关守卫与构建 | Alpine SSH、hardening、host-pool、security-config、log-sanitizer、前端路由／三语守卫；后端 tsc/build、前端 type-check／双端 build、测试清单和 diff 检查，准确最终日志与退出码以索引为准。 |

所有通过项核自然退出码。中途的夹具缺字段、Windows 符号链接权限、Windows 模拟链接路径规范化失败，以及早期测试的定向终止均保留，不能计为成功。未重复无变化的全套守卫或大矩阵。

## 仍需验收与后续范围

1. 新代码未原生验证完整纯净 Alpine／Debian 接入。自动引导维护仍只放行此前验收的 `alpine-apparmor-grub-v1:x86_64`；ARM64／Debian 需要改变引导才能启用 AppArmor 的情况尚未放行，不能通过模拟结果解锁。
2. 并非任意错误均已能自动修复。未知安装中断、Incus状态／原身份冲突、不可恢复磁盘问题、云平台阻断、第三方接口长期不可用等保留具体原因。此前已经终态 failed 的旧 bootstrap 任务不自动重新启用；本次修复的 queued/running hardening 任务沿原维护请求续接。
3. 可售仍要求原商品分组、定价和库存关系正确；仅 IP／密码不会凭空生成销售价格。本次不更改现有商品配置。
4. 完整独占客户重装、客户原密码与公网全端口、真实 OSS 新B／独立备用／千台72小时范围不由本轮本地测试替代。
5. 下次发行须包含新增 `server/templates/onboarding-prepare.sh`、`host-timezone.py`、全部相关编译代码和 `scripts/ensure-host-swap.py`。现有双架构打包工作流复制整个 templates 目录及该脚本；仍须对实际发行包分别核验，不能以源码路径存在代替资产验收。
