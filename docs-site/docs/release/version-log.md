# 系统版本更新日志

<!-- 此文件由 docs-site/scripts/generate-changelog.mjs 自动生成。请不要手动编辑。 -->

该页面从仓库 Git tag 和 commit 自动生成，用于展示系统版本演进。后台 OTA 的“可更新版本”和生产部署仍以 GitHub Release tag 为准。

## 最新发布状态 / Latest Release State

- 最新发布提交 / Latest Release Commit: `a208d480a`
- 提交日期 / Commit date: 2026-10-25
- 提交说明 / Commit subject: fix: refresh unprovisioned host identity on retry
- 最新 tag / Latest tag: `v1.7.4`

## 未发布变更 / Unreleased Changes

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## 历史版本 / Historical Versions

## v1.7.4

- 发布提交 / Release commit: `a208d480a`
- 提交日期 / Commit date: 2026-10-25
- 提交说明 / Commit subject: fix: refresh unprovisioned host identity on retry

未接入的新宿主重装系统后，普通重试重新核验当前身份，继续使用 root 密码；原身份保留审计，已建立的管理连接保持。
每五分钟巡检保存开始和完成日志，提供最近90天的时间、用户名、邮箱与中文描述关键词组合搜索。
完整发行包OTA验证并使用包内依赖及Prisma主入口；等待真实启动状态，替换前停止唯一后端，超时子进程停止后才回滚，原子目录执行跟随current。

## v1.7.3

- 发布提交 / Release commit: `9b4110dfb`
- 提交日期 / Commit date: 2026-10-25
- 提交说明 / Commit subject: fix: configure the local controller gateway without SSH credentials

主控兼网关直接在后台检查并确认配置，无需填写本机 SSH 地址、密码、端口或管理网段。
固定网关域名保存一次并自动同步已有宿主，保留逐台进度、失败原因和重试；地址池自动扩容，单网关可接入 4093 台宿主。
为外部独立网关和备用/备份网关保留独立入口，当前显示预留状态。
修复旧安装升级的空私有目录权限、回滚软链接和备份文件复制，以及安全配置缺省兼容。

恢复前须准备原宿主自动更新及完整 OSS 备份；B 恢复原管理身份后，在恢复保护内核对账目和实际宿主连接。真实公网 DNS 切换及 A 整机失联由管理员另行验收。

## v1.7.2

- 发布提交 / Release commit: `8eb306e2a`
- 提交日期 / Commit date: 2026-10-25
- 提交说明 / Commit subject: fix: wait for normal backend startup before releasing recovery protection

完整平台备份恢复原控制签名、WireGuard、管理 SSH 和 Incus 信任。恢复保护提供外部凭证核对及正常续费账单补回；已有宿主可补装固定域名定期解析。自然五分钟巡检处理漏续费、到期及确认删除后的库存释放。

修复官方 Alpine 云镜像第一次启动的公钥初始化、已接受订单重试、严格 umask 下 PostgreSQL 公钥读取、跨发行系统的备份结构指纹及低配置恢复启动等待。

验证：最终源码 CI 和 AMD64/ARM64 完整包构建、首装；真实 OSS 跨机恢复、原身份与客户持久数据保持、自然补续 TG 到达、新购公钥 NAT SSH 与不重复扣费；两架构旧平铺安装器升级。原子 OTA 的目标部署和完整 A/B 高可用、四拓扑、72 小时验收仍另行推进。

DD 前先升级新版、补装已有宿主固定域名重连，并制作含新增控制身份的完整成功备份；保留外部账证。恢复后先核账，再解除保护。客户 VPS 磁盘不在平台备份内。操作说明：docs/controller-dd-oss-recovery-v1.7.2.md（main）。

## v1.7.1

- 发布提交 / Release commit: `9d1e5ba47`
- 提交日期 / Commit date: 2026-10-21
- 提交说明 / Commit subject: fix: preserve root ownership for legacy OTA upgrades in v1.7.1


修复 v1.7.0 从旧版本在线升级时，备份执行器安装步骤报告「Untrusted helper source」并自动回滚的问题。

### 修复内容

- 发行包统一使用 root 所有权，避免已经安装的旧 OTA 执行器按构建机 UID 解包后，无法通过受信运维文件检查。
- 新 OTA 执行器解包时不继承归档所有者；在安装备份执行器前先完成现有权限加固。
- 保留运维文件 root 所有权校验、受信清单、数据库及支付就绪检查和自动回滚，不通过放宽安全检查解决问题。
- 双架构安装验证在安装器归一化权限前检查真实发行包的 UID/GID，避免首装成功掩盖旧 OTA 升级问题。

包含 v1.7.0 的批量恢复、已售机器无损恢复、故障状态、日志脱敏、密码重装及同配置跨区域更换机器能力。旧机升级使用新发行包；已失败并回滚的更新保留原任务和数据库备份，重新发起新版更新。

## v1.7.0

- 发布提交 / Release commit: `33b08791d`
- 提交日期 / Commit date: 2026-10-21
- 提交说明 / Commit subject: feat: add recovery safety and customer instance operations for v1.7.0


> 已发现旧版本 OTA 更新到 v1.7.0 时可能因归档文件所有权校验失败而回滚。请使用 v1.7.1 修正版；已回滚的机器保留原任务和数据库备份，重新发起新版更新。

完善平台恢复后的运营检查，新增批量恢复和管理员同配置跨区域更换机器，并修正客户故障状态、日志内容及密码重装体验。

### 恢复与机器池

- 恢复保护期间明确提示业务查询和任务暂停，避免用户、实例、机器池及版本页面把被拦截的查询显示为空数据。
- 同一主控身份恢复或回退时，保留现有 WireGuard 接口及已学习的对端地址；配置变化按需同步。
- 支持本页及所选机器批量检查并恢复，逐台显示结果和阻塞原因，单台失败不阻断其他机器。
- 已售机器核对当前实例、磁盘和网络规则后，可无损解除隔离，保留用户实例、账务和资源占用。需要清理旧系统时仍须明确确认。
- 管理端机器连接状态按最近 Agent 心跳显示，避免历史在线状态掩盖失联；客户侧统一显示「故障」。

### 客户实例

- 客户实例列表进入管理详情后新增「更换机器」按钮，可选同区域或跨区域的同配置空闲机器，后端再次校验 CPU、内存、磁盘、架构及占用。
- 更换机器保留客户、实例名称、价格、到期时间和续费设置，验证新机器公网 SSH 后交付，客户区域和 IP 随之更新。
- 成功日志使用「更换机器已完成」，客户日志隐藏内网地址和底层连接错误。
- 重装默认使用 root 密码，SSH 密钥可选；只有明确选择密钥才注入，系统自动启动。

### 使用边界

- 更换机器可从已完成的异地备份恢复，或明确确认创建全新系统。备份恢复到其时间点，不自动搬迁旧机当前磁盘数据，公网 IP 将改变。
- 平台备份不包含客户 VPS 磁盘和外部应用数据；恢复后先核对账目、实例、管理连接及库存，再恢复运营。
- 原机器保持隔离，确认遗留系统与规则安全清理后才可重新出售。
- 配套 Agent 保持 v1.0.3。GitHub 发布、本地验证、测试站实证与生产 OTA 是独立证据。

### 已完成的流程验证

- 测试站已完成批量空机恢复、已售机器无损恢复、密码重装及 Frankfurt → San Jose 的同配置更换机器；公网 SSH 与账务、归属、规格保持已核对。
- 隔离数据库集成覆盖权限、配置拒绝、并发预占、失败清理、持久隔离及已售实例保护。
- 本地全套 172 项测试、双端构建、文档构建与 Lint 通过；Linux CI 的 Agent 测试通过。
- 双架构预览与正式发行包均从真实安装包完成首装、212 条迁移、唯一后端、两端访问、管理员登录、备份、预检、恢复、回退及恢复运营演练；CI 中 OSS 传输使用本地替身。
- 正式发行及公开安装包校验证据记录于版本台账；发布不代表生产主控已执行 OTA。

## v1.6.9

- 发布提交 / Release commit: `54203107f`
- 提交日期 / Commit date: 2026-10-21
- 提交说明 / Commit subject: feat: verify complete OSS backups and add readable encrypted ZIP for v1.6.9


保留原 OSS 自动恢复备份，在同一备份集目录额外上传按 UTC 日期时间命名、使用相同密码的 AES-256 ZIP/ZIP64。管理端「阿里云 OSS」页面底部提供中文恢复指南和工具下载。

### 备份内容与校验

- ZIP 包含完整原生数据库归档、整库 SQL、按表排列的 SQL、角色与授权资料、运行配置、受管证书、网关身份、快照清单、完整性报告、中文说明和交互恢复工具。
- 全部 SQL 从同一个已验证数据库归档生成。备份在共享快照下检查每张表的完整记录、结构和大对象，并核对归档中的序列状态。
- 实际还原到隔离数据库并核对完整性；ZIP 每项解密哈希及原包、额外 ZIP 的 OSS 回读都通过后，才写入完成标记并清理旧备份。清理失败显示警告。
- 原 `payload.enc` 自动恢复流程继续保留；旧备份可兼容读取，但不会补生成 ZIP，也不能等同于通过新版完整性校验。

### 页面与工具

- 页面直接说明「面板还能打开」和「服务器损坏、面板打不开」两种恢复流程，并提供中文说明和工具下载。
- 工具交互读取凭据与备份密码，固定读取目标机配置并调用已安装的恢复执行器。
- 修复 OSS 连接保存入口和 V4 签名下的根目录浏览。

### 使用要求

- 恢复需匹配应用版本、迁移历史和 PostgreSQL 大版本；正式恢复需要维护窗口，恢复后保持保护，核对账目、宿主、实例和库存后再恢复运营。
- 额外 ZIP 可用支持 AES ZIP/ZIP64 的 7-Zip 或 WinRAR 打开，Windows 自带解压器可能不支持。逐表 SQL 用于查看和隔离核验，正式恢复以整库为单位。
- 备份只包含快照时刻的数据；后续交易、VPS 磁盘、客户网站文件、外部项目数据库和非受管文件需另行备份。

### 验证

- 发行提交完整执行 172 项检查并全部通过，双端构建、后端编译、产物边界及安装器守卫通过。
- 双架构真实发行包首装通过 212 条迁移、唯一后端、两端访问和管理员登录，并通过备份、预检、恢复、回退、恢复运营、主密钥及 SQL/原生归档完整性演练；CI 中 OSS 传输使用本地替身。
- 授权测试主控的真实 OSS 上传、回读与隔离恢复已通过，验证 126 张表、1,318 条记录和 118 个序列，原自动恢复包预检也成功。
- 两种架构公开发行包的 SHA256、大小、OTA 清单、包内版本及恢复工具副本一致。本次发版不代表生产主控已执行 OTA。

## v1.6.8

- 发布提交 / Release commit: `44d26132f`
- 提交日期 / Commit date: 2026-10-20
- 提交说明 / Commit subject: feat: add encrypted OSS platform backup and recovery for v1.6.8


新增阿里云 OSS 平台级加密备份与恢复，管理员入口位于「系统 → OAuth」下方。同时包含上一版发布后的客户订单中心三语化与英文导航文案调整。

### 新功能

- 选择 OSS 地域，分页浏览存储桶和目录，新建私有 Standard 桶，确认名称后删除未使用的空桶。
- 自定义备份目录与独立加密密码，保留最新 1/3/5 份，每 1/3/6/12/24/72 小时自动备份。
- 备份完整平台数据库、机器池分组和宿主登记、运行环境与受管证书；本机管理网关同时保护 WireGuard、SSH 管理身份及节点地址登记。
- 上传后下载核对密文，再标记成功并执行保留清理；支持手动备份和任务进度。
- 恢复预检、二次确认、数据库与文件回退、恢复保护模式，以及后台无法登录时使用的 root 命令行入口。

### 恢复保护

- 加密包采用 scrypt 与 AES-256-GCM，完整认证后提取文件；错误密码、篡改、路径越界及版本不匹配时拒绝恢复。
- 恢复暂停业务接口及后台任务，失效旧会话/API 凭据，并隔离机器池库存，等待核对真实支付、宿主和实例后再恢复运营。
- 备份与受限 systemd OTA 任务互斥，私有后端维持单实例；云端密码和密钥不回传至浏览器。
- 自动备份默认关闭，须保存并测试连接后启用。

### 使用边界

- 执行器要求标准 Linux/systemd 部署和本机 PostgreSQL；恢复要求相同应用版本、迁移历史和 PG 大版本。平台备份不包含客户 VPS 磁盘或外部图床/邮箱原件。
- 换 IP 后需人工核对域名、第三方回调、网关身份和节点连接，WireGuard 自动重连不在本版范围内。
- 严格按份数保留暂不支持启用/曾启用版本控制、WORM 或启用生命周期规则的桶。
- 从旧版升级后应检查备份执行器是否已安装；旧 OTA 进程可能不会调用新版新增的安装步骤，详见 [部署说明](https://mastalee928.github.io/payincus/deployment/oss-backup)。
- **真实阿里云 OSS 权限、云端上传和云端故障场景尚待专用测试桶验收。** 本地 SDK 回归与 CI 的本地存储替身不替代该证据。

### 验证

- 本地全量 172 项检查、双端构建、后端编译与 dist 边界检查通过；Lint 0 错误。
- 发布工作流先验证双架构真实发行包首装，再执行本机数据库备份、隔离预检、恢复、回退、恢复保护登录和主密钥一致性演练；OSS 传输使用本地文件替身。
- GitHub Release、CI 验证与生产 OTA 属于不同证据；本次发版不代表已经操作生产主控。

## v1.6.7

- 发布提交 / Release commit: `fa716ee69`
- 提交日期 / Commit date: 2026-10-18
- 提交说明 / Commit subject: chore: prepare the v1.6.7 release


本次发布聚焦客户实例与选购体验的打磨：机器池面板改版、45 个区域名称中英繁三语化与 OCI 机型名展示、实例重置密码、更克制的销毁弹窗，以及钱包与订单页的三处体验修复。

### 新功能 / Features

- **机器池面板改版（管理端）**：宿主行操作收纳为操作菜单，新增地区筛选 chips，紧凑行直接展示公网 IPv4 与 OCI 账号。
- **区域名称三语化**：45 个地理目录全部提供英文与繁体中文名称，选购向导、首页、结算与实例页面跟随界面语言显示；中文界面同样显示目录规范名，未匹配的自定义区域保持原样。
- **OCI 机型名展示**：客户实例页面以 `VM.Standard.E2.1.Micro` / `VM.Standard.A1.Flex` 显示机型，替代内部预设代号（中英文一致）。
- **实例重置密码**：实例详情页「升级」入口改为「重置密码」，经宿主机把新密码写入实例并加密保存，重置后旧密码立即失效。
- **概览「我的实例」区域 chip**：实例行在 IP 前显示国旗与本地化区域名（切换英文显示英文）。

### 改进与调整 / Improvements and Adjustments

- 选购页区域卡片去掉「可售 N 台 / 未上架」状态行，缩小卡片高度。
- 实例管理卡片去掉「网络」「流量」两行；「地区」行保留国旗并显示本地化区域名。
- 销毁实例弹窗隐藏内部节点名、删除退款与规则区块，当前方案显示 OCI 机型名，顶部说明改为「永久删除、无退款且不可恢复」。
- 资源占用面板删除编辑入口，用户无法再经任何路径进入配置编辑（管理员保留）。
- IPv6 地址行的复制按钮紧贴地址显示。
- 钱包「推荐计划」Tab 暂时隐藏（暂不做 AFF 推广）：入口、切换与渲染三层拦截，代码保留待启用。
- 余额明细中的内部用语「一机一卖」改为「购买实例」，并对存量记录执行数据迁移统一改写。

### 修复与稳定性 / Fixes and Stability

- 修复订单详情抽屉头部被控制台顶栏遮挡的问题（抽屉改为挂载到 body）。
- 修复概览实例卡片上误导性的 CPU 配额进度条（已移除）。

### 验证 / Verification

- main 上执行 `node scripts/run-tests.mjs`：planned / executed / passed 均为 171，failed 0。
- 前后端类型检查、双端生产构建与 dist 边界守卫、Lint（0 错误）通过。
- 完整守卫套件与双架构全新安装验证由发布工作流在 Linux amd64 / arm64 上执行，通过后才发布发行包。

## v1.6.6

- 发布提交 / Release commit: `9f1a14a79`
- 提交日期 / Commit date: 2026-10-18
- 提交说明 / Commit subject: chore: prepare the v1.6.6 release


本次发布聚焦 Telegram 通知体系：管理端四类告警机器人、面向用户的核心事件通知，以及按用户聚合的定时提醒；同时包含管理员直接建号、仪表盘机型展示等改进。

### 新功能 / Features

- **管理端 Telegram 告警机器人**：设置菜单新增「告警推送」子页，可分别配置工单、宿主机、财务、实例四类独立 Bot。工单推送包含主题、内容摘要、分类、优先级与附件数量；宿主机离线推一次、恢复再推一次；财务覆盖充值、余额扣款购买、续费与自动续费汇总（含用户使用的支付通道）；实例推送覆盖开通成功与失败（含退款状态）。
- **用户 Telegram 通知**：用户在个人设置完成 Telegram 绑定后默认开启通知，通过官方站点 Bot 私聊直接接收核心事件：开通成功 / 失败（含超时）、续费成功（手动与自动）、自动续费失败、充值到账、充值支付失败、临期提醒与已到期提醒。设置页提供「接收通知」开关与最近一次推送失败提示；机器人内支持 `/notify on` 与 `/notify off`，绑定成功回复与帮助文案同步更新。
- **通知聚合防轰炸**：临期提醒、已到期通知与自动续费结果按「每用户每轮任务一条」合并发送，同一批到期的多台实例合并为一条清单（最多列出 15 台，超出折叠计数），站内信、Telegram 与邮件同步聚合；单台实例的通知文案与此前完全一致。
- **管理员可直接创建用户**：用户管理页复用注册校验（标识、邮箱格式与域名白名单、危险字符），拒绝重名，生成 16 位初始密码以 bcrypt cost 12 存储，可指定角色与状态，并写入管理员审计记录。
- **仪表盘实例卡片展示机型规格**：按宿主机资源预设映射机型（E2 → `VM.Standard.E2.1.Micro`、ARM → `VM.Standard.A1.Flex`，回退宿主机架构），替代原先意义不大的 LXC/KVM 标签；无宿主机名称时不再显示「未分配」。

### 改进与调整 / Improvements and Adjustments

- 临期提醒由「到期前 3 天一次」调整为 **T-3 / T-2 / T-1 三档**，站内信、邮件与 Telegram 同档。
- 充值到账通知改走统一通知器：站内信、自建渠道（自建 Bot / Webhook 等）与站点 Bot 一致送达，此前仅站内信与邮件。
- 通知中的时间统一显示为本地可读格式（Asia/Shanghai），不再输出原始 ISO 字符串。
- 自动续费成功 / 失败、临期与已到期提醒的邮件同步聚合：多台实例合并为一封。

### 修复与稳定性 / Fixes and Stability

- 到期封停通知改为独立的「实例已到期」事件（含自动封停说明与 3 天删除倒计时），与手动封停的「已被封停」通知区分。
- 到期提醒与自动续费的新聚合链路保持原有安全不变量（先原子领取再发送、只对已领取条目发送、陈旧行不发送），并由守卫逐条钉住；计费调度器启动日志文案修正。

### 验证 / Verification

- main 上执行 `node scripts/run-tests.mjs`：planned / executed / passed 均为 171，failed 0。
- 前后端类型检查、双端生产构建与 dist 边界守卫、Lint（0 错误）通过。
- 完整守卫套件与双架构全新安装验证由发布工作流在 Linux amd64 / arm64 上执行，通过后才发布发行包。

## v1.6.5

- 发布提交 / Release commit: `3fb8a0eb9`
- 提交日期 / Commit date: 2026-10-18
- 提交说明 / Commit subject: chore: prepare the v1.6.5 release


本次发布聚焦 Windows 开发与发版工具链，以及面板读取 GitHub Agent Release 时的限流健壮性：守卫套件改由 Node runner 逐条执行，源码统一按 LF 检出，前端与根脚本可在 Windows cmd 下构建，面板遇到 GitHub 限流会退避重试并在必要时继续提供旧清单。

### 修复与稳定性 / Fixes and Stability

- 面板读取 GitHub Agent Release 的元数据与校验和改为有界重试：只对限流（403 rate limit / 429）与 5xx、网络错误重试，优先遵守 `Retry-After`，其它 4xx 立即失败；连续失败且已有清单缓存时继续提供旧清单，并在日志中给出配置 `INCUDAL_AGENT_RELEASE_TOKEN` 的提示。此前全新安装验证曾因匿名抓取触发 403 限流而失败。
- 全新安装验证在 CI 中以带 token 的方式安装面板，两个安装脚本会把环境里的 `INCUDAL_AGENT_RELEASE_TOKEN` 写入 `.env`，避免安装阶段就被限流。
- 根 `pnpm test` 不再使用「`&&` 串成一条超长脚本」的形式。该形式在 Windows 上会被 shell 静默截断（曾出现漏跑 20 条守卫却整体退出码为 0 的假绿），现改为 `node scripts/run-tests.mjs` 逐条 spawn 执行，执行前校验每个条目的脚本真实存在，任一失败即带守卫名与日志路径非零退出。

### 改进与调整 / Improvements and Adjustments

- `.gitattributes` 把源码与文本类扩展名钉为 `text eol=lf`，`*.bat` / `*.cmd` / `*.ps1` 保持 CRLF；逐字节断言的守卫因此在各平台行为一致。
- 前端 `dev` / `build` 相关脚本与根 `dev` / `dev:split` / `dev:user` / `dev:admin` 改用 `cross-env`，Windows cmd 下 `pnpm build` 与 `pnpm dev` 不再因 POSIX 环境变量前缀失败。
- 发行包纳入 `scripts/run-tests.mjs`：装机目录中的 `pnpm test` 不再因缺少该文件而报模块缺失，而是明确提示缺少工作区 `package.json` 并返回非零退出码（守卫套件仍只在源码仓库中运行）。
- `AGENTS.md` 的测试纪律与命令表更新为新的入口，并说明清单维护与 `pnpm test:check` / `pnpm test:list` 的用法。

### 验证 / Verification

- main 上执行 `node scripts/run-tests.mjs`：planned / executed / passed 均为 169，failed 0。
- 源码 CI（Lint & Type Check + Build）通过；双端生产构建与 dist 边界守卫通过。
- 完整守卫套件与双架构全新安装验证由发布工作流在 Linux amd64 / arm64 上执行，通过后才发布发行包。

## v1.6.4

- 发布提交 / Release commit: `41d878205`
- 提交日期 / Commit date: 2026-10-18
- 提交说明 / Commit subject: feat: choose a payment channel at checkout and retune user navigation


本次发布把用户端导航与结算体验调整到「创建实例 / 我的实例」口径，让购物车结算可以选择后台已启用的在线支付渠道，并把支付回调的验签与来源校验钉进守卫。

### 新增能力 / New Capabilities

- 购物车结算（含选购页「加入并结算」）新增支付方式选择：账户余额，或后台已启用的任一在线支付渠道。选择网关渠道时按整单金额创建充值单，服务端把渠道手续费补足，保证实际到账不少于订单金额；网关付清到账后，仍由余额完成整单扣款与开通 —— 购买订单本身没有新增支付状态，账务沿用现有充值语义。
- 用户端「概览」页的创建实例入口改为直达选购页，与实例列表页的行为一致。

### 改进与调整 / Improvements and Adjustments

- 用户端导航文案：「购买主机」调整为「创建实例」，「实例」调整为「我的实例」；公共站的同一入口与选购页标题同步使用「创建实例」。
- 用户端导航移除「福利」入口，`/entertainment` 不再对用户开放；页面代码保留，便于日后重新启用。

### 修复与稳定性 / Fixes and Stability

- 支付回调补充防伪守卫断言：来源 IP 白名单、逐渠道签名验证与渠道一致性校验必须在入账之前完成，重复回调继续按渠道 + 订单号 + 交易号去重。结算页只轮询服务端订单状态，到账前不解锁结算，前端不参与任何入账判断。

### 验证 / Verification

- 双端类型检查、相关守卫测试与双端生产构建通过；完整守卫套件与全新安装验证由发布工作流在 Linux amd64 / arm64 上执行，通过后才发布。
- 在线支付渠道流程在测试主站按真实渠道配置验证：选渠道创建充值单、到账后由余额完成结算；余额支付路径保持原有行为。

## v1.6.3

- 发布提交 / Release commit: `f8d2ca450`
- 提交日期 / Commit date: 2026-10-17
- 提交说明 / Commit subject: fix: surface failed update tasks and release stale pending ones


本次发布修复后台在线更新（OTA）在任务未能启动时的处理缺陷，并包含此前已在 main 上完成、尚未进入正式安装包的界面与权限调整。

### 修复与稳定性 / Fixes and Stability

- 卡在 `pending`、从未被 worker 认领的更新任务不再永久阻塞后续更新与回滚：发起新更新前自动回收超过时限仍未启动的记录，并写入失败原因。
- 更新任务未能在预期时间内启动时立即判为失败，错误信息包含 unit 状态（`ActiveState` / `Result` / `ExecMainStatus`）与该 unit 的 `journalctl` 排查命令，不再让面板一直停留在“已有更新任务执行中”。
- 管理端“版本更新”页可取消未启动的更新任务（仅限 `pending`，执行中的任务仍由 worker 自行收尾）。

### 改进与调整 / Improvements and Adjustments

- 购物车结算与开通结果页面板式精修：单价、开通费与小计集中展示，登录方式独立于商品清单；开通结果页展示连接信息与凭据入口。
- 实例高级配置（配置读取、进程上限提升、SWAP 开关与高级写入、批量配置）统一要求管理员权限，用户端不再加载相关入口与组件。

### 验证 / Verification

- 双端类型检查、ESLint、全套守卫测试与双端生产构建通过；发布包在 Linux amd64 / arm64 上完成全新安装验证后才发布。
- 在线更新修复在隔离环境复现原故障路径：受保护文件与可信清单不一致时，任务会立即判失败并给出排查命令，而不是停留在 `pending`。

## v1.6.2

- 发布提交 / Release commit: `2b81ce66e`
- 提交日期 / Commit date: 2026-10-16
- 提交说明 / Commit subject: chore: integrate v1.6.2 release preparation

多 IPv6 自动发现、附加、更换与完整端口交付，支持 Alpine 和 Debian。
OCI 分配地址自动配置、独立 IPv6 出口与持久恢复；TCP/TCP+UDP 策略保持一致。
首页真实商品、完整 45 个区域、购物车排版与交互动效更新。
UPAY Pro 支付渠道及 DNS、HTTPS 收银台修复。
配套 Agent v1.0.3；发行包新装验证覆盖双架构、209 条迁移和正式 Agent 下载。

## v1.6.1

- 发布提交 / Release commit: `737c6863a`
- 提交日期 / Commit date: 2026-10-16
- 提交说明 / Commit subject: fix: install the system Node runtime required by systemd

### v1.6.1 主机池与独占实例交付

本仓库首个独立维护版本，包含机器池与独占交付的完整源码。发行源码为 [737c6863a36c](https://github.com/mastalee928/payincus/commit/737c6863a36c436de8f9071e1831015f285b872b)，[正式发布工作流](https://github.com/mastalee928/payincus/actions/runs/38789679660) 已通过双架构全新安装验证并发布安装包。

### 新增

- 管理端增加「主机接入与管理」，包含按机型、地区组织的机器池和定价；支持纯净 Alpine 自动接入、批量导入、SSH 连接信息及机器删除。
- 用户通过购物车选择多种完整配置、镜像和数量，统一付款；结算检查库存、价格和余额，重试不会重复扣费。
- 一台宿主机交付一个客户实例，公网 IPv4 全端口由客户使用，SSH 为公网 IP 的 22 端口；宿主机管理使用 WireGuard。
- 管理端可选择 TCP 或 TCP+UDP，并显示 Agent 实际应用状态；交付前验证客户公网 SSH 登录。
- 管理员可将独占实例更换到同地区、同机型的备用机器，保留用户、价格和到期时间；原机持续隔离。无异地备份时须确认重建系统。
- 宿主机更换公网 IPv4 后，通过管理隧道发现、验证并同步到机器池和用户实例；支持手动指定入口。
- 用户端 PUSH 直接填写目标用户；管理端支持代用户转移实例，保留价格和账期并记录操作日志。

### 展示与维护

- 用户端显示公网 IPv4 和实际分配的 IPv6，流量显示无限；隐藏宿主机内部名称、虚拟化类型、带宽及端口转发操作。管理端仍显示宿主机名称。
- 购买结果显示逐台交付状态、实际 SSH 命令和遮盖的密码；支持重新进入订单查看进度。
- 安装、面板 OTA 和 Agent 的默认发布来源改为 `mastalee928/payincus`，保留原项目许可证与版权。
- 一键安装支持配置 WireGuard 管理网关；已有安装可用 `--configure-host-pool` 补配。OTA 同步网关程序并保留密钥与 peer。
- 修复预装 PostgreSQL 未启动、Node.js 只存在于用户环境、SSH 私钥权限顺序导致的新安装失败；服务使用经过检查的系统运行时。
- 发布工作流在 Linux amd64 和 arm64 临时机器上执行真实安装、数据库迁移、管理员登录、双端访问与网关连接验证，安装失败则阻止发布。

### 升级与验证

- 新增主机池结算与独占交付迁移，包含单机占用、备用机预占与故障隔离保护。升级前备份数据库和持久配置。
- 配套 [Agent v1.0.2](https://github.com/mastalee928/payincus/releases/tag/agent-v1.0.2) 已发布，支持协议切换和 Alpine OpenRC 管理。
- 已完成普通用户测试余额购买、公网 SSH、TCP/UDP 切换和两台 Alpine 的无备份故障换机实测；通过类型检查、守卫、隔离数据库集成测试及双端构建。
- Ubuntu 24.04 amd64 / arm64 全新安装验证通过：207 条数据库迁移、唯一后端、双端页面、随机管理员密码登录、机器池 API、固定指纹 SSH 网关及重复配置检查。
- 本轮未真机验收外部支付、客户公网 IPv6、异地备份恢复；无备份换机不会恢复旧磁盘数据。旧机彻底不可访问时，需要运维确认关闭或隔离，系统不能远程保证旧实例停止。

## v1.6.0

- 发布提交 / Release commit: `b140752e9`
- 提交日期 / Commit date: 2026-07-14
- 提交说明 / Commit subject: Release v1.5.8 修复内网 IP 分配竞态 + LXC 端口转发改走内核 NAT

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v1.5.8

- 发布提交 / Release commit: `b140752e9`
- 提交日期 / Commit date: 2026-07-14
- 提交说明 / Commit subject: Release v1.5.8 修复内网 IP 分配竞态 + LXC 端口转发改走内核 NAT

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v1.5.7

- 发布提交 / Release commit: `3e2a64257`
- 提交日期 / Commit date: 2026-07-14
- 提交说明 / Commit subject: Release v1.5.7 修复宿主机 ZFS 安装失败 + 预编译内核模块加 SHA-256 校验

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v1.5.6

- 发布提交 / Release commit: `1cf90c34a`
- 提交日期 / Commit date: 2026-07-14
- 提交说明 / Commit subject: Release v1.5.6 OTA 不再依赖 Git + 创建实例自动下发远程端口

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v1.5.5

- 发布提交 / Release commit: `49ebad913`
- 提交日期 / Commit date: 2026-07-14
- 提交说明 / Commit subject: Release v1.5.5 页面级错误边界：渲染异常不再导致静默白屏

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v1.5.4

- 发布提交 / Release commit: `d17675b30`
- 提交日期 / Commit date: 2026-07-13
- 提交说明 / Commit subject: Release v1.5.4 修复管理端节点详情白屏（Transition out-in + KeepAlive）

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v1.5.3

- 发布提交 / Release commit: `24226069a`
- 提交日期 / Commit date: 2026-07-13
- 提交说明 / Commit subject: Release v1.5.3 修复节点详情白屏 + 第三方二进制固定版本与 SHA-256 校验


### 修复

- **管理后台「节点 → 节点详情」整页白屏（刷新后恢复正常）**：节点详情视图被用户端与管理端共用，但页面内负责在路由参数变化时重新加载数据的守卫写死了用户端的路由名（`my-host-detail`），管理端的路由名是 `admin-my-host-detail`，因此该守卫在管理端永远提前返回、从不加载数据。而该组件外层包着 `<KeepAlive>`，被缓存复用时 `onMounted` 不会再执行——于是页面进入「既不在加载中、节点数据又为空」的状态；模板此前没有对应的兜底分支，两个条件都不成立就什么都不渲染，表现为整页白屏（没有任何报错，刷新因为是全新挂载才恢复）。

  三处修复：路由守卫改为同时识别用户端与管理端的路由名；新增 `onActivated`，组件被 `KeepAlive` 缓存复用时按需重新加载；模板补上兜底分支，数据为空时明确展示「加载失败」并提供重试 / 返回，杜绝再次渲染成空白页。

### 安全（宿主机安装脚本）

- **第三方二进制改为固定版本 + 固定 SHA-256 校验**：`wgcf` 与 `RFW` 以 root 身份安装并执行在客户宿主机上。此前 `RFW` 拉取的是上游的 `latest`——上游一旦变更，客户机器上装到的就是另一个二进制，既不可复现也无法校验；`wgcf` 虽已固定版本但没有任何哈希校验。现在两者的版本与期望 SHA-256 都固定在脚本内，下载后逐字节比对，任一不符即丢弃并重试，校验不通过一律不安装（fail closed）。

  > 说明：仅比对上游同源的 `checksums.txt` 是不够的——能替换二进制的攻击者同样能替换那份校验和。因此哈希由本项目固定，并已通过独立下载重算核对。升级第三方组件时需同步更新版本号与哈希。

> 本版不涉及数据库结构变更。基于 v1.5.2。

## v1.5.2

- 发布提交 / Release commit: `9fda0a300`
- 提交日期 / Commit date: 2026-07-13
- 提交说明 / Commit subject: Release v1.5.2 宿主机/Agent/Caddy 安装脚本系统性整改


本版是一次针对**宿主机安装脚本 / Agent 安装脚本 / Caddy 脚本**的系统性审查与整改。这三个脚本以 root 身份运行在客户的宿主机上，本次修复了其中若干**会损坏客户机器、泄露凭据、甚至把管理员锁在服务器外**的既有缺陷。所有问题均与近期的功能精简无关，是长期存在的。

### 🔴 会导致失联 / 锁死 / 数据损坏的修复

- **`nat` 模式可能让宿主机丢失 IPv6、导致 SSH 断连**：Linux 在 `forwarding=1` 时默认停止接受 Router Advertisement（RA），只有 `accept_ra=2` 才是「开启转发仍接受 RA」。此前 IPv6 转发对所有模式启用，`accept_ra=2` 却只在 `nat_ipv6` 模式设置。绝大多数 VPS 的 IPv6 默认路由由 RA/SLAAC 下发，因此 `nat` 模式下该路由会在 RA 租期到期后（通常 30 分钟～2 小时）消失且不再刷新——宿主机失去 IPv6；若管理员通过 IPv6 SSH 登录，会在安装数小时后被锁在服务器外。现将 `accept_ra=2` 提升为所有模式共用。
- **面板证书轮换失败会让宿主机永久失联**：此前先删除旧的 `panel` 信任项再导入新证书，一旦下载到的是 CDN/WAF 错误页或损坏内容，导入失败即退出，旧信任已删、新证书未加。现在先校验确实是合法 X.509 证书，校验不通过直接中止且**不改动任何现有信任配置**。
- **ZFS 编译后的清理会删除客户自己的工具链**：此前无条件 `purge build-essential/gcc/g++/make` 并以 `linux-headers-*` 通配符删除所有内核头。现在只清理「本次为编译 ZFS 而新增」的软件包，去掉通配符。同时 `install_zfs_dkms` 改为返回真实结果——编译失败不再谎报成功、也不再据此清理工具链。
- **ZFS 内核锁定可能锁错版本**：改为锁定 `linux-image-$(uname -r)`（ZFS 模块实际对应的运行内核），避免重启后进入无 ZFS 模块的内核导致存储池不可用。
- **WireGuard / ndppd / resolv.conf 被覆盖或整目录删除**：此前安装会无条件覆盖 `/etc/wireguard/wg0.conf`（客户可能正用 wg0 作 VPN 或 SSH 管理隧道）、覆盖全局 `/etc/ndppd.conf`、直接改写 `/etc/resolv.conf`；卸载则 `rm -rf /etc/wireguard/`。现在本脚本写入的配置一律带专属标记：覆盖前若发现非本脚本所写，先备份并告警；卸载只删除带标记的文件，其余保留。
- **卸载删除范围过宽**：此前会删除当前目录下的 `*.install.sh`、`install.sh` 及固定的 `/root/install.sh`，可能误删无关安装器。现在只删除本脚本自身。
- **RFW 重装会让防火墙保持停用**：此前先停用旧服务再下载新二进制，下载失败即让客户防火墙处于停用状态。现改为先下载校验、最后才原子替换；失败时恢复旧服务。

### 🔒 安全修复

- **含 token 的渲染脚本不再以可读权限落盘**：此前包含 host / Agent 一次性 token 的脚本会被复制为 `0755` 的 `/usr/local/bin/incudal`，本地普通用户可读取仍然有效的凭据。
- **Caddy 管理密码不再进入进程参数与 shell 历史**：此前密码经 `--password` 传入命令行、并再次以 `--plaintext` 出现在 `caddy hash-password` 的进程参数中。现在密码由面板注入脚本响应（`Cache-Control: no-store`），脚本通过 stdin 传给 `hash-password`，用后立即清除。
- **Caddy TLS 私钥权限收紧**：`key.pem` 由 `0644` 改为 `root:caddy 0640`，`/etc/caddy` 目录同步收紧。
- **Agent 安装脚本 dry-run 不再打印密钥**：`agent_secret` 与一次性 install token 在 dry-run 输出中强制脱敏。
- **ZFS 预编译模块路径穿越防护**：不再无条件信任归档内的 `module_path`，校验其必须落在预期目录内。
- **下载的二进制新增 ELF 校验**：Release 资产缺失或被 CDN 拦截时可能返回 HTTP 200 + HTML，此前不校验就 `chmod +x` 执行。现在 wgcf 与 RFW 必须通过 ELF 魔数校验。

### 健壮性修复

- **安装命令会把 CDN/WAF 的人机校验页当脚本执行**：节点安装与 Caddy 脚本命令此前使用 `curl -sL` / `-sSL`（缺 `-f`）。curl 在 HTTP 4xx/5xx 时默认仍以成功退出并写出错误响应体，于是 Cloudflare 的 “Just a moment...” 挑战页 HTML 会被当作 shell 脚本执行（报 `syntax error near unexpected token '<'`）。现统一为 `curl -fsSL`。
  > 若面板域名启用了 CDN 人机校验，仍需在 CDN 侧放行安装脚本路径（`/api/hosts/install.sh*`、`/api/hosts/caddy-script/*`、`/api/agent/install.sh`），否则被挑战的机器依然拿不到脚本。
- **Agent 升级失败可回滚**：新二进制先以临时配置冒烟通过，才备份旧版本并原子替换；重启后未 active 立即回滚，避免宿主永久离线。一次性 token 也改为在全部预检与下载完成后才消费，失败可重试。
- **Caddy 配置事务化切换**：新 Caddyfile 先 `caddy validate`，通过后才原子切换；旧配置先备份，失败自动恢复；不再删除面板动态站点的 `autosave.json`；已存在且有效的证书/私钥直接复用，避免重跑后面板固定的 CA 信任失效。
- **入参校验前置**：所有带值参数检查是否缺值，端口统一校验 1–65535，用户名限制字符集——全部在任何 apt / systemctl 改动之前完成。
- **内核头文件按架构选择**（不再硬编码 amd64），关键步骤失败不再被 `|| true` 掩盖后仍报告成功。

> 本版不涉及数据库结构变更。基于 v1.5.1。

## v1.5.1

- 发布提交 / Release commit: `7f5728f9e`
- 提交日期 / Commit date: 2026-07-13
- 提交说明 / Commit subject: Release v1.5.1 修复系统设置白屏 + 退款统一走余额 + i18n编译守卫


### 修复

- 修复系统设置 / Telegram 设置页整页白屏：Telegram「机器人用户名」提示文案中有一个未转义的字面量 `@`，被 vue-i18n 当作链接消息语法（`@:key`）解析，触发编译错误（code 10 INVALID_LINKED_FORMAT），导致整页渲染崩溃。现将字面量 `@` 统一写为 `{'@'}` 转义（三语言各处）。同类问题的 Heleket 支付方式占位符（`@TRON` / `@BSC`）一并修复，避免支付渠道设置页白屏。

### 优化

- 新增 i18n 文案编译守卫：用 vue-i18n 实际的消息编译器编译全部三语言文案（本版约 2.1 万条），任何编译错误即测试失败，从源头拦截未转义 `@` / 未配对花括号等会导致运行时白屏的文案语法问题。

### 升级说明（面向自建 / 开源用户）

- 本版新增两个下线迁移，均幂等无损：
  - 删除「原路退款」的 `recharge_refund_requests` 表与 `RechargeRefundStatus` 枚举（`DROP TABLE IF EXISTS ... CASCADE` / `DROP TYPE IF EXISTS`）。
- 其余业务数据完整保留，自建用户可安全 OTA。

> 本版为 v1.5.0 的修复与收尾：根治了因文案未转义 `@` 导致的系统设置页白屏、把退款统一到余额、新增 i18n 文案编译守卫防此类问题复发，并清理了数据库中的孤儿枚举。基于 v1.5.0。

## v1.5.0

- 发布提交 / Release commit: `bb5a0ea8a`
- 提交日期 / Commit date: 2026-07-13


### 精简（移除下列模块，含前端、后端路由/worker、Prisma 模型与数据库表）

### 优化

- 全站 UI 重做为纯净的浅色主色 + 单一强调色的 Linear 风格设计，支持浅色 / 深色双主题。
- 修复长期存在的“点击侧边栏偶发白屏”问题：`index.html` 增加 `Cache-Control: no-cache`，避免浏览器 / CDN 缓存到旧入口导致的分块 404。
- 文档站删减已下线功能的冗余内容，导航去除死链。

### 修复

### 升级说明（面向自建 / 开源用户）

- 本版新增 9 个下线迁移，全部按幂等、无损原则编写：`DROP TABLE IF EXISTS ... CASCADE`、`DROP TYPE IF EXISTS`；共享枚举（`TicketObjectLinkType`、`PaymentProviderType`）采用“重命名旧类型 + 新建 + `USING` 转换”的安全收窄方式，且在收窄前先删除/转换被移除枚举值对应的数据行，不使用不受支持的 `ALTER TYPE ... DROP VALUE`。
- `plugin_gateway` 类型的支付渠道会被自动置为 `disabled` 并归类为 `manual`，不会因外键约束中止升级；升级后管理员可自行清理这些遗留渠道。
- 上述设计保证任意历史版本的部署都能顺利完成“备份 → 迁移 → 重启”的在线升级流程，仅删除被下线功能自身的数据，其余业务数据完整保留。

## v1.4.3

- 发布提交 / Release commit: `cdcdeb583`
- 提交日期 / Commit date: 2026-07-12
- 提交说明 / Commit subject: Release v1.4.3: 修复 OTA 迁移前 pg_dump 连接（role "root"）


### 修复

- 修复 OTA 迁移前数据库备份步骤连接错误：此前 `pg_dump` 未携带正确的连接信息，会回退到本地 unix socket 并以操作系统用户（root）连接，触发 `role "root" does not exist`，导致备份失败、迁移中止并自动回滚。现改为从 `DATABASE_URL` 解析出主机/端口/用户/密码/库名并通过环境变量传入 `pg_dump`，凭据不落命令行、不写入更新日志。

> 本补丁修复了 v1.4.0/v1.4.1 引入的 OTA 数据库备份缺陷，使后续在线升级能够顺利完成备份→迁移→重启流程。无 schema 变更。基于 v1.4.2。

## v1.4.2

- 发布提交 / Release commit: `630544fe1`
- 提交日期 / Commit date: 2026-07-12
- 提交说明 / Commit subject: Release v1.4.2: 版本号对齐 tag + 归档本次大版本审计台账


### 维护

- 将 `package.json` 版本号从 `1.3.7` 更新为 `1.4.2`，与发行 tag 保持一致(此前版本号未随 v1.4.0/v1.4.1 同步)。
- 归档本次大版本(v1.4.0)的审计台账与逐项评审记录到仓库(`EXECUTION_LOG.md`、`audits/`),便于团队追溯。

> 无功能/schema 变更。基于 v1.4.1(见对应发布说明)。

## v1.4.0

- 发布提交 / Release commit: `38c7bf154`
- 提交日期 / Commit date: 2026-07-12
- 提交说明 / Commit subject: Release v1.4.0 全面加固与功能补全 + OTA 数据库迁移支持


> 本版(v1.4.0)为一次大范围加固与功能补全:约 120 项缺陷/逻辑修复 + 7 个大功能,并首次为 OTA 增加数据库迁移支持。**升级前请务必阅读文末「升级注意 / 部署红线」。**

### 安全加固

- 修复开放重定向反斜杠绕过(前后端同步),防 OAuth 登录码泄漏致账号接管。
- 所有外呼(AI/SMTP/webhook/市场扫描/图床/证书查询)统一走安全出站组件:连接期 DNS 复核、禁重定向、超时、响应限长,防 SSRF/DNS rebinding。
- 日志脱敏覆盖 `pat_`/`poa_`/Basic/深层对象;`apiError` 5xx 不再返回内部异常原文。
- Caddy 管理请求启用 TLS 证书校验(CA 固定/fail-closed),不再明文可劫持。
- root OTA 单元只执行 root 拥有、服务用户不可写的固定入口与 SHA256 已验证产物,阻断服务用户→root 提权链。

### 资金与计费正确性

- 修复退款方向/漏钱:充值来源退款改「扣减」,退款按比例冲回 AFF 佣金与统计,托管「删除并退款」回扣节点主人。
- 邮箱退款按真实实付逐期、累计退款≤累计实付;延期统一 31 天基、升级剩余价值按实付封顶、三者入事务加锁。
- 订单退款限已完成状态、上限取实付、条件唯一防查重竞态;套餐价「分/元」不再放大 100 倍。
- 硬删用户/到期实例改软删/归档,不再级联抹掉财务与审计;积分↔余额比价护栏、奖池概率总和约束、礼品卡资金来源与撤销。

### 实例交付 / 网络 / 终端 / 流量

- 流量双通道加采样版本、拒迟到上报回退快照,消除重复计量;月流量重置在采集锁内重建基线再原子清零;固定 Asia/Shanghai 时区。
- 批量端口映射统一按最终数计配额/校验范围;IPv6 CIDR 子网重叠检查;资源池申领按主机容量原子校验防 OOM 超卖;宿主用量原子 increment 防并发丢失更新。
- **修复终端「Failed to connect」**:审计日志失败与连接生命周期隔离;WS 初次建连/重连加 close 监听与代次校验,消除僵尸会话。

### 规则与体验

- 礼品卡按 `expiresAt` 实时排除过期;有使用记录的兑换码禁物理删除只允许禁用/归档;流量兑换码改一次性。

### 新功能

- **AFF 佣金/折扣百分比后台可配**。
- **邮箱过期自救 + 自动续费**:过期可续费复活、到期暂停上游/续费恢复、`autoRenew` 自动扣费执行器(每次 1 月)、定时同步上游实际用量。
- **Hosting 现金提现人工审核流**(转面板余额免审即时)。
- **工单自动关闭可配置 + 可关**。

### 运维 / OTA

- **OTA 首次支持数据库迁移**:升级时在切换 release 后、重启前自动 `pg_dump` 备份并 `prisma migrate deploy`;迁移失败中止,代码自动回滚时保留 DB 备份并告警(DB 不自动回滚,如需请用备份手工恢复)。
- 明确并文档化「私有后端单进程」假设(登录锁/OAuth nonce/去重/配置缓存)。

### ⚠️ 升级注意 / 部署红线

2. **流量重置价改「元」存储须与代码原子同发**——迁移把存量「分」值 ÷100,若代码上线而迁移未跑会导致 100 倍偏差。
3. **Caddy TLS 校验**:升级前须在后端配置 `CADDY_CA_PATH` 并收集各宿主 `/etc/caddy/cert.pem`,否则反代管理会 fail-closed。
4. **root 提权链硬化(装机/OTA 单元变更)**:升级需在维护窗口重新执行装机脚本安装新 OTA 单元,并按部署清单核对属主/权限/sudoers。
5. 发布前请在维护窗口对受影响流程做真机验证。

### 验证

- 全量守卫(200+ 个 `test-*-guards`)、前后端 TypeScript、i18n 键、路由与产物边界守卫通过;用户端与管理端生产构建通过。
- 说明:以上为本地/守卫层验证,生产真机验证在部署期完成。

## v1.3.7

- 发布提交 / Release commit: `fd5e722f0`
- 提交日期 / Commit date: 2026-07-10
- 提交说明 / Commit subject: Release v1.3.7 UI consistency refinement


### 界面一致性

- 继续统一用户端与管理端的中性色视觉语言，收敛实例、套餐、消息、账务、运营和系统设置页面中过多的装饰性颜色。
- 保留失败、危险、成功、警告和处理中等关键业务状态的语义色，并补齐对应的暗色模式样式。
- 优化表格、筛选区、状态标签、操作按钮和管理端表单的间距、边框与信息层级，降低高密度页面的视觉干扰。

### 布局与可读性

- Antom 支付配置弹窗扩大到双列表单宽度，减少密钥、币种和商户字段的拥挤。
- 实例与套餐页面的网络模式、来源和类型标签改为稳定的中性标签；IPv6 地址不再截断，便于核对完整地址。
- 调整账务提醒、批量操作及多项管理表单的网格布局，并改善窄屏下的换行和内容容纳。

### 验证

- 前端 TypeScript、国际化键和路由守卫通过。
- ESLint 零错误；存量 Vue 缩进提示不阻断发布。
- 用户端与管理端生产构建、前后台产物边界守卫和后端 TypeScript 编译通过。

## v1.3.6

- 发布提交 / Release commit: `1f4008cc2`
- 提交日期 / Commit date: 2026-07-10
- 提交说明 / Commit subject: Release v1.3.6 Antom payments and UI refinement


### 界面体验

- 统一用户端与管理端的页面密度、导航、表单、列表、空状态和响应式布局，减少模板化装饰，提升长时间操作时的可读性。
- 重构首页、市场、登录、用户仪表盘及管理端核心页面的视觉层级，并补齐桌面端与 390px 移动端适配。
- 使用语义状态色区分成功、处理中、警告与失败状态，避免中性色主题削弱业务反馈。
- 引入轻量滚动揭示动效，并遵循系统的减少动态效果设置；空状态图标统一使用 Lucide 图标。

### Antom 支付

- 新增 Antom Checkout Payment 托管收银台支付方式，支持支付会话创建、结果查询、异步通知与幂等入账。
- 管理端支付方式页面新增 Antom 配置表单、字段说明、密钥脱敏和生产就绪检查。
- Antom 回调继续复用现有订单金额校验、状态流转和重复通知保护；新增 Prisma 枚举迁移与定向 guard。
- Antom 默认保持未配置和停用状态，正式启用前仍需完成商户凭证配置及沙箱实付验证；原路退款暂按人工流程处理。

### 文档与验证

- 补充中英文 Antom 配置、回调和上线前核对说明。
- 前后端 TypeScript 类型检查、前端国际化检查、Prisma 校验、183 项测试命令、用户端与管理端生产构建、文档构建全部通过。
- 首页、市场、登录、用户仪表盘、支付方式管理及 Antom 表单已完成桌面端和移动端实屏验收。

## v1.3.5

- 发布提交 / Release commit: `7f6f6b8c1`
- 提交日期 / Commit date: 2026-07-09
- 提交说明 / Commit subject: Release v1.3.5 security hardening and UI refresh


### 安全与稳定性

- 修复重建、迁移和恢复期间 Incus 实例短暂不可见时被状态调度器误标为删除的问题，并避免操作期间误发意外停机通知。
- 强化主题资源响应的 CSP 与 sandbox，降低可执行 SVG/HTML 资源造成存储型 XSS 的风险。
- OAuth state 与登录码改用常量时间签名比较，并按各自有效期逐条清理防重放 nonce。
- OTA manifest 和 artifact 仅向可信 GitHub 主机附带 Release Token；回滚拒绝删除包含原子备份的安装目录。
- Restore 与 Backup Upload Worker 只清理确实超时的 PROCESSING 任务，避免多节点部署误杀其他节点任务。
- Telegram webhook URL 不再从客户端可控的转发头推导；普通用户不再看到通知渠道 Chat ID 预览。

### 账务与支付

- 用余额生成礼品卡改用独立 `gift_card_issue` 余额日志类型，不再计入可兑换积分的真实消费额。
- 新增历史日志重分类迁移，使用礼品卡关联、金额与事务时间窗口识别历史发行扣款。
- 已验签且金额一致的迟到支付回调不再因本地过期时间被静默丢弃，继续进入幂等入账；待支付订单增加六小时取消宽限期。

### 会话与前端可靠性

- 用户端和管理端 Token 刷新增加 15 秒超时，刷新端点挂起时不再长期阻塞请求队列。
- 管理端 `/auth/me` 瞬时失败不再触发管理员整段登出。
- 用户端与管理端跨域误入时只清当前标签页内存状态，保留另一端合法共享会话。
- Service Worker 缓存名从注册 URL 的版本参数生成，后续发版无需重复手工维护缓存字面量。

### 界面与文档

- 用户端与管理端视觉调整为更克制、清晰的产品界面，统一页面密度、表单、导航、卡片和响应式细节。
- 文档站改为任务导向的信息架构，统一浅色/暗色主题、侧栏、正文、代码块、表格和风险提示，并完成中英文移动端适配。
- 修复一键升级的原子布局识别和版本输出，安装包增加 SHA256 与归档路径校验。
- 重写中英文手工部署与 systemd 指南，补齐 GitHub Pages sitemap、robots、canonical 和多语言 alternate。

### 验证

- 前后端 TypeScript 类型检查。
- 全量 `pnpm build`、`pnpm test`、文档构建和部署文档 guard。
- 文档站 70 个路由的桌面与 390px 移动端宽度、标题和链接检查。

## v1.3.4

- 发布提交 / Release commit: `bd0a36c69`
- 提交日期 / Commit date: 2026-07-09
- 提交说明 / Commit subject: Release v1.3.4 reload loop guard


### 修复与体验

- 修复首页在 Service Worker 接管或静态资源恢复期间可能反复自动刷新的问题。
- Service Worker `controllerchange` 刷新改为按客户端版本在当前会话内只执行一次，避免同一版本重复接管造成刷新循环。
- 前端静态资源版本不一致恢复逻辑改为按当前 HTML 资源签名只自动刷新一次；如果刷新后仍失败，会停止自动刷新并保留控制台告警，避免用户卡在无限刷新中。

### 验证

- `pnpm --filter client type-check`
- `pnpm --filter server test:frontend-route-guards`

## v1.3.3

- 发布提交 / Release commit: `f32e44e02`
- 提交日期 / Commit date: 2026-07-09
- 提交说明 / Commit subject: Release v1.3.3 demo safeguards and UI polish


### 修复与体验

- 合并演示账号一键登录和只读保护：演示账号登录历史脱敏，受保护账号禁止修改密码和管理员重置密码。
- 前端保留最新生产主线功能的前提下，合入二次元风格的轻量视觉升级：字体、主题色、动效 token、实例配置卡片、镜像选择下拉和资料页标题细节。
- 镜像选择下拉改为 Teleport 到 `body`，避免被父级滚动容器裁切。
- Markdown 渲染增加基础 HTML 清理，降低帮助文档等富文本内容的 XSS 风险。
- 同步 Service Worker 静态缓存名到 `v1.3.3`，确保 OTA 后客户端获取新版本静态资源。

### 验证

- `pnpm --filter client type-check`
- `pnpm --filter server type-check`
- `pnpm --filter server test:demo-account-safety-guards`
- `pnpm --filter server test:demo-notification-redaction-guards`
- `pnpm --filter server test:demo-readonly-redaction-guards`
- `pnpm --filter server test:frontend-route-guards`
- `pnpm build`

## v1.3.2

- 发布提交 / Release commit: `62338ac31`
- 提交日期 / Commit date: 2026-07-08
- 提交说明 / Commit subject: Release v1.3.2 stale asset recovery


### 修复与稳定性

- 增加前后台统一的旧静态资源恢复逻辑：捕获 Vite preload、动态 import、router 和 Vue 错误中的旧 chunk 加载失败，清理 Incudal 静态缓存后自动刷新，减少 OTA 后点击页面无反应或白屏需要手动刷新的情况。
- 登录、注册、忘记密码等 Turnstile 验证区域固定显示验证状态，明确区分“未验证 / 已验证 / 已过期 / 验证失败”，避免用户误判当前验证码是否已经完成。
- 移除前端生产 HTML 中残留的 Figma capture 外链，降低线上 CSP/外部脚本噪音。
- 同步前端路由守卫测试，覆盖旧静态资源恢复、Figma capture 移除和 Turnstile 固定状态提示。
- 同步 Service Worker 静态缓存名到 `v1.3.2`，确保 OTA 后客户端获取新版本静态资源。

### 验证

- `pnpm --filter server test:frontend-route-guards`
- `pnpm --filter client type-check`
- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm build`
- `git diff --check`
- 本地 CDP 全页扫描：202 页，0 issues。
- 本地可见导航点击扫描：用户端 desktop/mobile 36/36，通过；管理端 desktop/mobile 60/60，通过。

## v1.3.1

- 发布提交 / Release commit: `edd97236f`
- 提交日期 / Commit date: 2026-07-08
- 提交说明 / Commit subject: Release v1.3.1 auth redirect fixes


### 修复

- 合并 PR #8：登录成功后使用 `router.replace()` 跳转，等待导航完成并避免登录页留在历史记录中。
- 注册成功后在同步认证状态并加载当前用户后立即跳转客户控制台，不再依赖延迟 `setTimeout()`。
- 已登录用户访问登录/注册等游客页时使用 `replace` 跳转到控制台，避免返回按钮回到已失效的认证页。
- 同步前端路由守卫测试，覆盖登录、注册和游客页重定向的新跳转语义。
- 同步 Service Worker 静态缓存名到 `v1.3.1`，确保 OTA 后客户端获取新版本静态资源。

## v1.2.12

- 发布提交 / Release commit: `df34eacf9`
- 提交日期 / Commit date: 2026-07-08
- 提交说明 / Commit subject: Release v1.2.12 UI and stability fixes


### 修复与稳定性

- 修复实例改配预览的套餐价格单位，避免分/元混用导致用户看到错误差价。
- 同步 Service Worker 静态缓存名到 `v1.2.12`，确保 `/sw.js?v=1.2.12` 激活后清理旧版本静态资源缓存。

## v1.2.11

- 发布提交 / Release commit: `17d1d2265`
- 提交日期 / Commit date: 2026-07-01
- 提交说明 / Commit subject: Release v1.2.11 service worker cache version


### 修复

- 同步 Service Worker 静态缓存名到 `v1.2.11`，确保 `/sw.js?v=1.2.11` 激活后会清理旧版本资源缓存，延续 OTA 后避免旧 chunk 白屏的缓存隔离策略。

### 验证

- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm --filter server type-check`
- `pnpm test`
- `pnpm build`
- `pnpm --dir docs-site --ignore-workspace build`
- `git diff --check`

## v1.2.10

- 发布提交 / Release commit: `f1452aeff`
- 提交日期 / Commit date: 2026-07-01
- 提交说明 / Commit subject: Release v1.2.10 help and OAuth fallback fixes


### 修复

- 帮助中心在没有后台发布文章时提供内置“快速开始使用 Incudal”文章，避免线上帮助页空数据或文章缺失时显示通用加载失败。
- 帮助文章详情页把 `ARTICLE_NOT_FOUND` 和 404 显示为明确的文章不存在状态，减少误判为系统错误。
- OAuth 授权页对无效、停用或回调地址不匹配的客户端显示中文不可用提示，不再直接暴露原始英文错误。

### 验证

- `pnpm --filter server exec tsx scripts/test-content-route-guards.ts`
- `pnpm --filter server exec tsx scripts/test-frontend-route-guards.ts`
- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm --filter server type-check`
- `pnpm test`
- `pnpm build`
- `pnpm --dir docs-site --ignore-workspace build`
- `git diff --check`

## v1.2.9

- 发布提交 / Release commit: `014c5af45`
- 提交日期 / Commit date: 2026-07-01
- 提交说明 / Commit subject: Release v1.2.9 auth Turnstile cache hotfix


### 修复

- 注册、登录和忘记密码页提交时会从 Turnstile 组件和隐藏响应字段重新读取 token，并在缺少验证时聚焦到可见验证区，避免验证码组件已完成但页面仍提示未验证。
- 忘记密码页补入认证页白名单，避免残留会话检查把它当成普通用户页处理。
- 前后台入口注册 Service Worker 时使用版本化 `/sw.js?v=...` 并禁用更新缓存，避免边缘缓存返回旧 `sw.js` 导致旧 JS/CSS chunk 持续生效。

### 验证

- `pnpm --filter server exec tsx scripts/test-frontend-route-guards.ts`
- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm --filter server type-check`
- `pnpm test`
- `git diff --check`

## v1.2.8

- 发布提交 / Release commit: `7d166c288`
- 提交日期 / Commit date: 2026-07-01
- 提交说明 / Commit subject: Release v1.2.8 auth and OTA cache hotfix


### 修复

- 注册页发送验证码按钮不再因为 Turnstile token 尚未生成而硬禁用；点击后继续走现有校验并给出人机验证提示，避免页面看起来“不能用”。
- Service Worker 静态资源改为网络优先并升级缓存名；新 worker 接管后自动刷新一次，降低 OTA 后旧 JS/CSS chunk 导致白屏、需要手动刷新才恢复的风险。

### 验证

- `pnpm --filter server type-check`
- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm test`
- `pnpm build`
- `git diff --check`

## v1.2.7

- 发布提交 / Release commit: `948db6ad1`
- 提交日期 / Commit date: 2026-07-01
- 提交说明 / Commit subject: Release v1.2.7 kawaii UI refresh


### 改进

- 发布 Product Design / kawaii-cloud 主题升级：公共首页、套餐市场、认证页、用户端、资源方页面和管理端共享浅色云朵主题、玻璃质感卡片和更一致的导航布局。
- 引入 Uiverse 风格的轻量动效，但保持为本地 CSS 实现：卡片 aurora 边框、按钮 glint 反馈、骨架屏流光和 loading 高亮都遵守 `prefers-reduced-motion`。
- 增加主题图片资产，用于首页和市场页的可爱 IDC 视觉表达，不新增运行时依赖。

### 验证

- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm test`
- `git diff --check`
- `UI_SCAN_RUN_ID=2026-07-01T02-27-00-uiverse-motion-final node .ui-scan/run-cdp-ui-scan.mjs`
- `DATABASE_URL=... JWT_SECRET=... COOKIE_SECRET=... ENCRYPTION_KEY=... RUN_RECHARGE_CALLBACK_SMOKE=false RUN_AGENT_HEARTBEAT_SMOKE=false RUN_AGENT_RELEASE_SMOKE=false pnpm smoke:split:nginx`

## v1.1.9

- 发布提交 / Release commit: `d0bb415af`
- 提交日期 / Commit date: 2026-06-29


### 修复

- `v1.0.0` 正式版公告重写为可发布版本，补齐 0.9.x 到 1.0.0 的生产稳定性、Agent 加固、支付回调策略、资源售罄判断和升级建议。

### 验证

- `pnpm --filter server type-check`

## v1.1.1

- 发布提交 / Release commit: `c3099ec50`
- 提交日期 / Commit date: 2026-06-29


### 修复

### 验证

## v1.0.9

- 发布提交 / Release commit: `7ef8a144e`
- 提交日期 / Commit date: 2026-06-29

### v1.0.9

- Fix registration retry after Turnstile-protected failures such as an incorrect invite code: the page now resets only the Cloudflare challenge token and keeps the filled registration form intact.

## v1.0.8

- 发布提交 / Release commit: `f41632471`
- 提交日期 / Commit date: 2026-06-29

### v1.0.8

- Fix create-instance Turnstile submission: the page now uses the visible verification widget token, falls back to Cloudflare's hidden response field, blocks locally when verification is missing, and localizes raw Turnstile backend errors.

## v1.0.7

- 发布提交 / Release commit: `a6c0838ce`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.0.7 instance verification

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v1.0.3

- 发布提交 / Release commit: `a6b15797e`
- 提交日期 / Commit date: 2026-06-28
- 提交说明 / Commit subject: Release v1.0.3 package delivery hotfix

Fix hosted package delivery guards and Incus certificate path resilience.

Packages can now be published or unpublished directly from the package list. The action only changes package visibility for new orders; existing instances and renewals keep their normal lifecycle.

Harden package host storage-pool persistence. When a package is active, bound hosts must resolve to an `instance_data` storage pool. Empty storage-pool selections now fall back to the host's preferred system disk pool, prioritizing `default`, and activation is blocked if no usable pool exists.

Fix stale Incus client certificate paths after OTA. If a host still references an old release directory and that certificate file no longer exists, Incus operations fall back to the stable panel certificate directory under `/opt/incudal/server/certs` or the configured panel certificate environment variables.

Restore the Germany `DEBGP` production package configuration by binding it back to the `default` system disk pool and publishing it again after confirming `DE-01` can list Incus storage pools.

## v1.0.2

- 发布提交 / Release commit: `02a9bec30`
- 提交日期 / Commit date: 2026-06-28
- 提交说明 / Commit subject: Release v1.0.2 welfare check-in

Add daily points check-in to the Welfare center.

Users can now open the Check-in tab, claim one random points reward per Beijing calendar day, and see current points, reward range, streak, monthly count and recent records. The default reward range is 1-500 points.

Add admin controls for daily check-in. Operators can enable or disable check-in, set the random points range, optionally require users to own an instance before claiming, and review paginated check-in logs with username, date, points, streak, IP and timestamp.

Harden check-in accounting with a dedicated `daily_checkins` table, a unique `(user_id, date_key)` constraint, points ledger entries, and a per-user advisory lock so concurrent requests cannot double-claim the daily reward.

Keep the existing system redeem code and resource pool flows intact. The daily check-in reward itself now grants points instead of random resource-pool credits.

Update the customer instance cards with clearer LXC/KVM, IPv4 NAT/dedicated network and quota markers so the instance list matches the newer network delivery model.

## v1.0.1

- 发布提交 / Release commit: `0e5d04951`
- 提交日期 / Commit date: 2026-06-28
- 提交说明 / Commit subject: Release v1.0.1 network delivery

Add dedicated IPv4 and dedicated IPv4 + dedicated IPv6 delivery modes for hosted instances.

Plans can now use `public_ipv4` and `public_ipv4_ipv6`. New plan creation only exposes IPv4 NAT, IPv4 NAT + dedicated IPv6, dedicated IPv6, dedicated IPv4, and dedicated IPv4 + dedicated IPv6. Legacy `nat_ipv6_nat` and `ipv6_nat` values remain for existing data compatibility only and are not new plan targets.

Add host public IPv4 IPAM. Host owners and admins can create public IPv4 pools, add addresses, disable or re-enable free addresses, and delete unused addresses from the host detail page. Dedicated IPv4 capacity is checked during host selection, and instance creation reserves addresses with row locking to avoid concurrent double allocation.

Update Incus network payload generation so dedicated IPv4 instances use a routed `eth0` NIC on the host interface. Dual-stack dedicated IPv4 + IPv6 instances also receive the existing routed IPv6 NIC. NAT IPv4 modes continue to use the `incusbr0` bridge and remain the only modes that expose NAT port mappings.

Harden provisioning rollback for dedicated IPv4. User purchases, admin-created instances, host-owner created instances, async provisioning failures, and stuck `creating` timeout cleanup now release reserved public IPv4 addresses and compensate failed purchases consistently.

Update the host install script and hosting documentation so new nodes no longer present IPv6 NAT as a target capability. IPv6 delivery is documented as routed dedicated IPv6, while dedicated IPv4 requires a configured public IPv4 pool.

## v1.0.0

- 发布提交 / Release commit: `b2857f492`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Update handoff for DEBGP closure

### PayIncus v1.0.0 正式版更新公告

### 正式版定位

v1.0.0 面向真实商业运营场景发布，目标是让面板具备稳定上线、可升级、可回滚、可审计、可排障的基础能力。

从 0.9.0 到 1.0.0，主要完成了这些能力收口：

- 在线升级链路加固，减少重复执行、重复 worker 和异常升级带来的不确定状态。
- 支付回调策略明确支持“无固定回调 IP，但强制验签、金额校验和幂等”的生产配置。
- 节点 Agent 加固，避免高频心跳、全量状态采集和日志刷屏对宿主机造成压力。

### 生产稳定性

- 修复 OTA worker 重复启动和重复处理任务的问题。
- 跳过重复任务时会正确关闭数据库连接，避免升级进程残留。
- 生产包内的 split auth smoke 修复，确保发布产物和线上验证脚本一致。
- Turnstile 开启时，split auth smoke 能识别人机验证保护状态，不再把正常防护误判为失败。
- 版本日志过滤 handoff 和日志同步类提交，减少发布记录噪音。

### 节点 Agent 加固

- Agent 默认心跳间隔调整为 60 秒，并设置 30 秒最低间隔，避免被错误配置成高频请求。
- Incus 实例状态采集只处理运行中的实例，减少对宿主机 CPU 的压力。
- 单次状态上报加入 500 实例上限和更低并发，避免节点规模较大时把宿主机打满。
- 心跳日志做节流，避免长期运行时日志无限写入导致磁盘压力。
- 生成的 `incudal-agent.service` 增加 CPU、内存、任务数量和 journal 写入限额。
- Agent 发布版本提升到 `v1.0.0`，面板可以向已有节点分发加固后的 Agent 二进制。

已有节点只升级 Agent 二进制还不够。要让 systemd 的 CPU、内存、任务和日志限额生效，需要在每台节点重新运行 Agent 安装脚本，刷新 systemd unit。

### 支付回调策略

- 新增明确的生产策略：当支付商没有固定回调出口 IP 时，可以设置 `PAYMENT_CALLBACK_IP_WHITELIST_REQUIRED=false`。
- 该策略不等于跳过安全校验。回调仍必须通过签名验证、交易状态验证、金额匹配和 `payment_callbacks` 幂等记录。
- `PAYMENT_CALLBACK_SKIP_IP_WHITELIST=true` 仍属于跳过 IP 检查的高风险配置，文档已区分这两种模式。
- 生产 readiness 不再把“明确接受无固定回调 IP 策略”的配置误报为未解决风险。

### 资源与售罄判断

- 公开套餐售罄判断补齐磁盘容量，避免前台显示可购买、下单后创建失败。
- 生产 readiness 文档补充 CPU、内存和磁盘容量要求。
- 节点/套餐资源判断更接近真实交付链路，减少购买成功后资源不足的异常。

- 证据详情现在使用实体背景覆盖，不再透出底层风险列表。
- 证据快照、表格和 JSON 内容在浅色/深色模式下都保持可读。
- 后台资源风险页更适合运营人员直接查看实例风险、证据和处置记录。

### 部署与文档

- 运行路径、系统用户、systemd 服务名和发布产物名保持兼容，仍沿用 `/opt/incudal`、`incudal` 用户、`incudal-backend` 服务和现有 release artifact 命名，避免破坏已有线上环境。
- 中文和英文部署文档补充支付回调 IP 策略、Agent systemd 限额和生产检查说明。

### 升级建议

- 建议所有 0.9.x 用户升级到 v1.0.0。
- 升级后检查后台版本页、生产健康检查、支付回调配置和节点 Agent 状态。
- 每台宿主机建议重新运行 Agent 安装脚本，让 systemd 限额配置生效。
- 如果支付通道没有固定回调 IP，请使用明确策略 `PAYMENT_CALLBACK_IP_WHITELIST_REQUIRED=false`，不要使用跳过安全检查的临时绕过配置。

### 总结

## v0.9.9

- 发布提交 / Release commit: `085ff7896`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.9

Keep `/opt/incudal`, the `incudal` system user, the `incudal-backend` service name and release artifact names unchanged for runtime and OTA compatibility.

## v0.9.6

- 发布提交 / Release commit: `dd0816dc8`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.6

Fix public package sold-out detection to include disk capacity, keeping market availability aligned with backend instance creation checks.

## v0.9.4

- 发布提交 / Release commit: `cdb1386ca`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Close OTA worker database on skipped duplicate

### 其他变更 / Other Changes

- Close OTA worker database on skipped duplicate `cdb1386ca`

## v0.9.3

- 发布提交 / Release commit: `2b5aa5dac`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Guard OTA workers against duplicate starts

### 其他变更 / Other Changes

- Guard OTA workers against duplicate starts `2b5aa5dac`

## v0.9.2

- 发布提交 / Release commit: `804fb5270`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Handle Turnstile in split auth smoke

### 其他变更 / Other Changes

- Handle Turnstile in split auth smoke `804fb5270`

## v0.9.1

- 发布提交 / Release commit: `e46a425a7`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix split auth smoke in production artifacts

### 修复与稳定性 / Fixes and Stability

- Fix split auth smoke in production artifacts `e46a425a7`

## v0.9.0

- 发布提交 / Release commit: `6a619cfe2`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.0

## v0.8.9

- 发布提交 / Release commit: `857e892d0`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Update version log for v0.8.9

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v0.8.8

- 发布提交 / Release commit: `5c03ca250`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Update version log for v0.8.8

### 其他变更 / Other Changes

- Establish PayIncus project baseline `cddea0dc8`

## v0.8.7

- 发布提交 / Release commit: `d7830b694`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix instance plan upgrade capacity checks

### 修复与稳定性 / Fixes and Stability

- Fix instance plan upgrade capacity checks `d7830b694`

## v0.8.5

- 发布提交 / Release commit: `394e92c05`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Harden OTA Prisma client generation

### 修复与稳定性 / Fixes and Stability

- Harden OTA Prisma client generation `394e92c05`

## v0.8.3

- 发布提交 / Release commit: `576d1382e`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix instance bandwidth and billing nav display

### 修复与稳定性 / Fixes and Stability

- Fix instance bandwidth and billing nav display `576d1382e`

## v0.8.2

- 发布提交 / Release commit: `fe79137ec`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Add package traffic reset pricing

### 新增能力 / New Capabilities

- Add package traffic reset pricing `fe79137ec`

## v0.8.1

- 发布提交 / Release commit: `8dfa597e7`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Harden storage readiness and traffic reset

### 修复与稳定性 / Fixes and Stability

- Harden storage readiness and traffic reset `8dfa597e7`

## v0.6.19

- 发布提交 / Release commit: `19ae72719`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix instance transfer path release guard

- 继续发布用户端实例产品卡片和创建实例自动命名能力。
- 修复实例卡片 PUSH 跳转的前后台构建边界，避免后台包包含用户端固定转让路径。
- 更新 route guard 以覆盖新的 transfersPath helper 形态。

## v0.6.18

- 发布提交 / Release commit: `d69254c73`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Polish instance cards and creation naming

- 用户端实例卡片改为产品信息卡样式，集中展示地区、节点、套餐、配置、网络、流量、价格、到期时间和自动续费。
- 实例卡片新增管理、PUSH、续费入口，并复用现有单实例续费/自动续费能力。
- 创建实例时自动生成安全实例名称，支持手动覆盖和重新生成；后端 API 在 name 缺省时也会兜底生成。
- 侧边栏分组标题增加翻译兜底，避免显示裸 key。

## v0.6.17

- 发布提交 / Release commit: `7c62431e9`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Polish UI structure and docs for v0.6.17

- Keep public market and help pages in the public site shell.
- Add collapsible user/admin sidebar groups.
- Improve help center search, links, and error states.
- Improve gift card user/admin UI safety, code masking, copy, and responsive layout.

## v0.6.16

- 发布提交 / Release commit: `8639b5a6e`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix gift card Turnstile body verification

#### Fixes and Stability / 修复与稳定性

- Move user gift card Turnstile verification from onRequest to preHandler so body turnstileToken is available.

- Keep authentication in onRequest and add guard coverage to prevent body-token verification regressions.

- Let the gift-card flow test check the active database schema for isolated test runs.

## v0.6.15

- 发布提交 / Release commit: `e67c9603f`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Persist expired gift card state

### 其他变更 / Other Changes

- Persist expired gift card state `e67c9603f`

## v0.6.14

- 发布提交 / Release commit: `d0389797f`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix gift card Turnstile token flow

### 修复与稳定性 / Fixes and Stability

- Fix gift card Turnstile token flow `d0389797f`

## v0.6.13

- 发布提交 / Release commit: `dae1a64c5`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix user gift card Turnstile verification

### 修复与稳定性 / Fixes and Stability

- Fix user gift card Turnstile verification `dae1a64c5`

## v0.6.12

- 发布提交 / Release commit: `2fcc75bfb`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix admin gift card generation Turnstile gate

### 修复与稳定性 / Fixes and Stability

- Fix admin gift card generation Turnstile gate `2fcc75bfb`

## v0.6.11

- 发布提交 / Release commit: `6b0bf1232`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Add operations settings center

### 新增能力 / New Capabilities

- Add operations settings center `6b0bf1232`

## v0.6.10

- 发布提交 / Release commit: `1cb4f76b2`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Add gift card center

#### New capabilities / 新增能力

- Add user gift card page for balance-funded gift card generation, redemption, and owned-card history.

- Add admin gift card center for single and batch generation, stats, redacted lists, enable, disable, and delete actions.

- Add GiftCard Prisma model and migration; OTA applies it through prisma migrate deploy.

#### Fixes and stability / 修复与稳定性

- Protect gift card balance flows with advisory locks, transaction-scoped balance deduction, self-redeem blocking, and one-time redeem claims.

- Restrict production gift card management with PAYINCUS_GIFT_CARD_ADMIN_IDS and mask codes by default.

- Localize and fix the OAuth Provider admin UI template.

## v0.6.9

- 发布提交 / Release commit: `85d952b53`
- 提交日期 / Commit date: 2026-06-26

- Trust the real docs-site host for market index and package downloads

- Keep market guard coverage aligned with the live docs domain

## v0.6.3

- 发布提交 / Release commit: `e42ee2b15`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden Lsky commit proof permissions / 加固 Lsky 提交证明权限检查

### 修复与稳定性 / Fixes and Stability

- Harden Lsky commit proof permissions / 加固 Lsky 提交证明权限检查 `e42ee2b15`

## v0.6.2

- 发布提交 / Release commit: `49f484ec3`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Force artifact OTA dependency install / 强制重建 OTA 制品依赖

### 其他变更 / Other Changes

- Force artifact OTA dependency install / 强制重建 OTA 制品依赖 `49f484ec3`

## v0.6.1

- 发布提交 / Release commit: `08ad73d59`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden Lsky proof and artifact install output / 加固 Lsky proof 与制品安装输出

### 修复与稳定性 / Fixes and Stability

- Harden Lsky proof and artifact install output / 加固 Lsky proof 与制品安装输出 `08ad73d59`

## v0.6.0

- 发布提交 / Release commit: `dd81058ff`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Summarize Lsky proof token abilities / 汇总 Lsky proof token 权限

### 其他变更 / Other Changes

- Summarize Lsky proof token abilities / 汇总 Lsky proof token 权限 `dd81058ff`

## v0.5.9

- 发布提交 / Release commit: `5738eb89e`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden artifact OTA install directory handling

### 修复与稳定性 / Fixes and Stability

- Harden artifact OTA install directory handling `5738eb89e`

## v0.5.8

- 发布提交 / Release commit: `e687afc70`
- 提交日期 / Commit date: 2026-06-25

### 其他变更 / Other Changes

- Document safe Lsky cleanup proof boundary `5cbf7d734`

## v0.5.7

- 发布提交 / Release commit: `921168bf4`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden online update runner environment

### 修复与稳定性 / Fixes and Stability

- Harden online update runner environment `921168bf4`

### 其他变更 / Other Changes

- Record latest Lsky proof access attempt `3178e60af`

## v0.5.6

- 发布提交 / Release commit: `ea1d4d812`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add Lsky production proof script

### 新增能力 / New Capabilities

- Add Lsky production proof script `ea1d4d812`

### 其他变更 / Other Changes

- Document Lsky cleanup blocker evidence `b41fec0a7`

## v0.5.5

- 发布提交 / Release commit: `f92545e7b`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Expose SMTP provider proof metadata

### 其他变更 / Other Changes

- Expose SMTP provider proof metadata `f92545e7b`

## v0.5.4

- 发布提交 / Release commit: `b3279626c`
- 提交日期 / Commit date: 2026-06-25

## v0.5.3

- 发布提交 / Release commit: `800036838`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add production DB restore drill proof

### 新增能力 / New Capabilities

- Add production DB restore drill proof `800036838`

## v0.5.2

- 发布提交 / Release commit: `e0a630fc0`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add Lsky delete diagnostics

Log non-sensitive Lsky delete status/body/error diagnostics and avoid treating provider status:false responses as successful cleanup.

## v0.5.1

- 发布提交 / Release commit: `498b824c2`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix Lsky v2 image deletion

Preserve numeric Lsky v2 photo IDs and delete images through the official batch /user/photos endpoint.

## v0.5.0

- 发布提交 / Release commit: `5fa3402a8`
- 提交日期 / Commit date: 2026-06-25

## v0.4.9

- 发布提交 / Release commit: `0854f27c1`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix Lsky upload cleanup identifier / 修复 Lsky 上传清理标识

Preserve Lsky pathname/path fallback provider IDs so uploaded ticket images can be cleaned up when provider responses omit id/key/hash.

## v0.3.7

- 发布提交 / Release commit: `266f52d55`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix admin benefits localization bundle / 修复后台福利本地化打包

#### 新增能力 / New Capabilities

- Added a release guard that checks all benefits translation keys used by the admin benefits page.
- 新增后台福利页 i18n key 发布守卫，覆盖页面使用的全部福利文案。

#### 改进与调整 / Improvements and Adjustments

- Keep the admin benefits translation namespace in the admin frontend bundle while continuing to strip admin-only benefits text from the customer bundle.
- 后台前端包保留福利管理所需文案，同时用户端包继续剔除后台福利管理文案。
- Prevent admin benefits pages from rendering raw translation keys such as entertainment.admin.title.
- 避免后台福利页显示 entertainment.admin.title 等原始翻译 key。

## v0.3.6

- 发布提交 / Release commit: `773843087`
- 提交日期 / Commit date: 2026-06-25

#### 新增能力 / New Capabilities

- 后台日志页新增风险审计概览，显示风险动作数量、本页高风险、需要审批和需要验证码的记录数。 / Added an audit summary to the admin logs page with risk catalog count, high-risk records, approval-required records, and verification-required records.

- 日志列表新增风险等级与风险说明，覆盖低、中、高、严重四级。 / Added risk level and risk title display to log rows with low, medium, high, and critical levels.

- 新增管理员审计 CSV 导出，单次最多 1000 条，并记录 audit.export 操作日志。 / Added admin-only audit CSV export capped at 1000 rows and recorded as an audit.export operation log.

#### 改进与调整 / Improvements and Adjustments

- 日志接口返回前脱敏用户名、邮箱、IP、token 和 JWT 类内容。 / Redacted usernames, emails, IP addresses, tokens, and JWT-like values before returning log data.

- 根目录全量测试纳入 risk-audit 守卫。 / Included the risk-audit guard in the root full test command.

- 更新中英文后台文档和商业运营目标进度。 / Updated Chinese and English admin docs plus commercial operation progress notes.

## v0.3.5

- 发布提交 / Release commit: `7e9f95a8c`
- 提交日期 / Commit date: 2026-06-25


#### 改进与调整 / Improvements

- Fix benefits admin localization fallback and missing English keys.

## v0.3.1

- 发布提交 / Release commit: `51be2d4ac`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add customer success ticket workspace / 新增客服成功工单工作台

### 新增能力 / New Capabilities

- Add customer success ticket workspace / 新增客服成功工单工作台 `51be2d4ac`

## v0.2.8

- 发布提交 / Release commit: `7e8a29e43`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add financial reconciliation workflow / 新增财务对账闭环

### 新增能力 / New Capabilities

- Add financial reconciliation workflow / 新增财务对账闭环 `7e8a29e43`

## v0.2.7

- 发布提交 / Release commit: `7f6f66e29`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add order payment operations workflow / 新增订单支付运营闭环

#### 新增能力 / New capabilities

- Add admin order operation cases with dispute states: pending review, confirmed, compensated and closed.
- Add manual refund registration that creates balance-adjustment approval requests without directly changing user balances.
- 新增人工退款登记，只创建调账审批，不直接修改用户余额。
- Add redacted provider status summaries and extended order search by keyword and date range.
- 新增脱敏 provider 状态摘要，并扩展订单号、交易号、用户和时间范围搜索。

#### 改进与调整 / Improvements and adjustments

- Link order operation records to adjustment approvals and balance logs after approval.
- 订单运营处理记录可关联调账审批，审批通过后继续关联余额流水。
- Update admin billing documentation in Chinese and English.
- 更新中英文后台与支付账务文档。

#### 验证 / Verification

- pnpm --filter server test:order-payment-operations-guards
- pnpm --filter server test:order-center-guards
- pnpm --filter server test:balance-adjustment-approval-guards
- pnpm --filter server type-check
- pnpm --filter client type-check
- pnpm --filter client build
- pnpm --filter server test:frontend-route-guards
- pnpm --filter server test:frontend-dist-boundary-guards
- pnpm --dir docs-site --ignore-workspace build
- pnpm build
- pnpm test
- git diff --check

## v0.2.6

- 发布提交 / Release commit: `0f327fe1f`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add commercial operations overview / 新增商业运营总览

#### New capabilities / 新增能力

- Add admin commercial operations overview for revenue, orders, users, instances, delivery, infrastructure, support, and risk alerts.
- 新增后台商业运营总览，覆盖收入、订单、用户、实例、交付、基础设施、支持与风险提醒。

#### Other changes / 其他变更

- Update admin documentation for the operations overview.
- 更新后台文档，说明运营总览指标与边界。

#### Improvements and adjustments / 改进与调整

- Add commercial operations overview guard and include it in pnpm test.
- 新增商业运营总览守卫，并纳入 pnpm test。

## v0.2.5

- 发布提交 / Release commit: `1c3b63086`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Harden OTA cleanup and disk preflight / 加固 OTA 清理与磁盘预检

#### 新增能力 / New capabilities

- Add OTA download-cache cleanup before and after update tasks.
- Add disk-space preflight with actionable Chinese failure guidance.
- Add atomic release pruning with protected current and rollback targets.

#### 改进与调整 / Improvements and adjustments

- Preserve .incudal-update-downloads during legacy artifact application until cleanup finishes.
- Document OTA retention environment variables in Chinese and English.

#### 其他变更 / Other changes

- Extend system update guard coverage for cleanup, preflight and release pruning.

## v0.2.4

- 发布提交 / Release commit: `12bcebeb2`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add balance adjustment approval / 新增调账审批流

### 新增能力 / New Capabilities

- Add balance adjustment approval / 新增调账审批流 `12bcebeb2`

## v0.2.3

- 发布提交 / Release commit: `9d03a7b6c`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add order exception handling / 新增订单异常处理

### 新增能力 / New Capabilities

- Add order exception handling / 新增订单异常处理 `9d03a7b6c`

## v0.2.2

- 发布提交 / Release commit: `2311b2442`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add unified order center / 新增统一订单中心

### 新增能力 / New Capabilities

- Add unified order center / 新增统一订单中心 `2311b2442`
- Revert "Add demo login and read-only safeguards / 新增演示登录与只读保护" `bf96cde42`
- Add demo login and read-only safeguards / 新增演示登录与只读保护 `7be458969`

### 其他变更 / Other Changes

- Separate demo docs from production guides / 区分演示文档与生产指南 `4978cf845`

## v0.2.1

- 发布提交 / Release commit: `815dd2f73`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Allow installer to set initial admin email / 允许安装器设置初始管理员邮箱

#### 新增能力 / New Capabilities

- 一键安装脚本支持设置初始管理员邮箱。
- One-click installer now supports setting the initial admin email.

#### 改进与调整 / Improvements and Adjustments

- 默认管理员初始化改为读取 ADMIN_EMAIL，兼容 ADMIN_INITIAL_EMAIL。
- Default admin initialization now reads ADMIN_EMAIL and remains compatible with ADMIN_INITIAL_EMAIL.
- 环境示例和中英文部署文档补充 ADMIN_EMAIL。
- Environment examples and Chinese/English deployment docs now include ADMIN_EMAIL.

#### 其他变更 / Other Changes

- 增加安装器和数据库初始化守卫测试，防止管理员邮箱再次硬编码。
- Added installer and database initialization guards to prevent hardcoded admin email regressions.

## v0.2.0

- 发布提交 / Release commit: `dd9e8e395`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix installer static asset permissions / 修复安装器静态资源权限

#### 修复与稳定性 / Fixes and stability

- Keep the install root traversable for Nginx so one-click installs can serve frontend static assets.
- 保持安装根目录可被 Nginx 穿透，确保一键安装后可正常提供前端静态资源。

#### 改进与调整 / Improvements and adjustments

- Preserve owner-only permissions for .env after install and upgrade permission repair.
- Add split deployment guard coverage for installer static asset permissions.

## v0.1.9

- 发布提交 / Release commit: `9649f3c9b`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Ensure installer enables pnpm / 确保安装脚本启用 pnpm

#### 修复与稳定性 / Fixes and stability

- Ensure the one-click production installer enables pnpm before Prisma migrations and systemd startup.
- 确保一键生产安装脚本在 Prisma 迁移和 systemd 启动前启用 pnpm。

#### 改进与调整 / Improvements and adjustments

- Pin pnpm 9.14.2 in the installer and keep a Corepack-first, npm-fallback bootstrap path.
- 在安装脚本中固定 pnpm 9.14.2，并保留 Corepack 优先、npm 兜底的初始化路径。
- Extend split deployment guards to prevent clean-server installer regressions.
- 扩展前后台分离部署守卫，防止干净服务器安装路径回退。

## v0.1.7

- 发布提交 / Release commit: `ba7a6eed2`
- 提交日期 / Commit date: 2026-06-24


#### 其他变更 / Other changes

- 实例任务失败、超时清理和启动清理僵尸任务时，会记录中文失败日志并触发用户失败通知。

- Instance task failures, timeout cleanup, and startup stale-task cleanup now write Chinese failure logs and send user failure notifications.

## v0.1.6

- 发布提交 / Release commit: `3bfdfe5ac`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix admin instance detail loading / 修复后台实例详情加载

### 修复与稳定性 / Fixes and Stability

- Fix admin instance detail loading / 修复后台实例详情加载 `3bfdfe5ac`

## v0.1.5

- 发布提交 / Release commit: `33d1afc9f`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Localize operation logs in Chinese / 日志内容中文化

### 其他变更 / Other Changes

- Localize operation logs in Chinese / 日志内容中文化 `33d1afc9f`

## v0.1.4

- 发布提交 / Release commit: `653d3a51b`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Prevent incompatible VM package host binding / 阻止不兼容 VM 套餐节点绑定

### 其他变更 / Other Changes

- Prevent incompatible VM package host binding / 阻止不兼容 VM 套餐节点绑定 `653d3a51b`

## v0.1.3

- 发布提交 / Release commit: `b9857686a`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix instance detail bandwidth rendering / 修复实例详情带宽渲染

### 修复与稳定性 / Fixes and Stability

- Fix instance detail bandwidth rendering / 修复实例详情带宽渲染 `b9857686a`

## v0.1.2

- 发布提交 / Release commit: `104c6c0c5`
- 提交日期 / Commit date: 2026-06-24

#### New capabilities / 新增能力

- Admin users can view latest release metadata while update execution remains super-admin only.

- 后台管理员可查看最新 release 信息，实际更新执行仍仅限超级管理员。

## v0.1.1

- 发布提交 / Release commit: `4fb35c487`
- 提交日期 / Commit date: 2026-06-24


#### 其他变更 / Other Changes

- 版本更新页在未发现新版本时持续展示当前/latest 版本信息，并将主按钮显示为已更新至最新版本。

- The system update page keeps latest/current version details visible when no newer release exists and marks the primary action as already up to date.

#### 改进与调整 / Improvements and Adjustments

- 安装任务日志和市场页面布局改为更清晰的后台工作区，减少页面撑高和信息挤压。

- Install logs and market layout now use clearer admin workspace spacing to reduce page overflow and crowded content.

## v0.1.0

- 发布提交 / Release commit: `e4f9f8a17`
- 提交日期 / Commit date: 2026-06-24

### 其他变更 / Other Changes

- Document bilingual versioning and OTA cadence rules `81fce60d0`

## v0.0.21

- 发布提交 / Release commit: `6a4ebdb1b`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix production OTA CLI start command

### 修复与稳定性 / Fixes and Stability

- Fix production OTA CLI start command `6a4ebdb1b`

## v0.0.20

- 发布提交 / Release commit: `6b99a47f2`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Update version log for static root fix

### 修复与稳定性 / Fixes and Stability

- Fix production split static roots `9cb0ae0c2`

## v0.0.19

- 发布提交 / Release commit: `d8195460b`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix storage pool defaults and error guidance

### 修复与稳定性 / Fixes and Stability

- Fix storage pool defaults and error guidance `d8195460b`

## v0.0.18

- 发布提交 / Release commit: `43b9807ed`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix Agent binary installer cache query

### 修复与稳定性 / Fixes and Stability

- Fix Agent binary installer cache query `43b9807ed`

## v0.0.17

- 发布提交 / Release commit: `71bb4ca70`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix Agent installer manifest parsing

### 修复与稳定性 / Fixes and Stability

- Fix Agent installer manifest parsing `71bb4ca70`

## v0.0.16

- 发布提交 / Release commit: `0a75877a6`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Refresh host panel trust certificate

### 其他变更 / Other Changes

- Refresh host panel trust certificate `0a75877a6`

## v0.0.15

- 发布提交 / Release commit: `71e2af87c`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Fix atomic OTA install root detection

### 修复与稳定性 / Fixes and Stability

- Fix atomic OTA install root detection `71e2af87c`

## v0.0.14

- 发布提交 / Release commit: `3833c6f79`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Clarify Debian host install support

### 新增能力 / New Capabilities

- Clarify Debian host install support `3833c6f79`

## v0.0.13

- 发布提交 / Release commit: `f9f6cdb7c`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Update version log for HSTS hardening

- Add HSTS to split Nginx templates and installer-generated static frontend blocks.

- Guard HSTS in split deployment and security header checks.

- Document the public Strict-Transport-Security production requirement.

## v0.0.12

- 发布提交 / Release commit: `e44a5d7ce`
- 提交日期 / Commit date: 2026-06-23

### 修复与稳定性 / Fixes and Stability

- Fix GitHub Pages docs workflow `5e0a9a0fa`

### 其他变更 / Other Changes

- Deploy docs site with GitHub Pages `e041db36e`

### 新增能力 / New Capabilities

- Add bilingual PayIncus documentation site `0c8682741`

### 改进与调整 / Improvements and Adjustments

- Update split deployment docs `54368bf10`
- Update README with OTA and community links `ae5617118`

## v0.0.11

- 发布提交 / Release commit: `eae342d77`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Support atomic OTA release layout

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v0.0.10

- 发布提交 / Release commit: `eae342d77`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Support atomic OTA release layout

### 新增能力 / New Capabilities

- Support atomic OTA release layout `eae342d77`

## v0.0.9

- 发布提交 / Release commit: `2af166460`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Auto rollback failed online updates

### 修复与稳定性 / Fixes and Stability

- Auto rollback failed online updates `2af166460`

## v0.0.8

- 发布提交 / Release commit: `39140db7a`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Prefer verified OTA artifacts for online updates

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v0.0.7

- 发布提交 / Release commit: `39140db7a`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Prefer verified OTA artifacts for online updates

### 改进与调整 / Improvements and Adjustments

- Prefer verified OTA artifacts for online updates `39140db7a`

## v0.0.6

- 发布提交 / Release commit: `c6342d950`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Stabilize OTA restart verification

### 修复与稳定性 / Fixes and Stability

- Stabilize OTA restart verification `c6342d950`

## v0.0.5

- 发布提交 / Release commit: `8c633c68f`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Fix OTA manifest release workflow checkout

### 修复与稳定性 / Fixes and Stability

- Fix OTA manifest release workflow checkout `8c633c68f`

## v0.0.4

- 发布提交 / Release commit: `55fdd4abd`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Add OTA release manifest metadata

### 新增能力 / New Capabilities

- Add OTA release manifest metadata `55fdd4abd`

## v0.0.3

- 发布提交 / Release commit: `9ad38dde4`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Make OTA worker tolerate production git ownership

### 修复与稳定性 / Fixes and Stability

- Make OTA worker tolerate production git ownership `9ad38dde4`

## v0.0.2

- 发布提交 / Release commit: `cb1f45b96`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Make online updates asynchronous and build-ready

### 改进与调整 / Improvements and Adjustments

- Make online updates asynchronous and build-ready `cb1f45b96`

## v0.0.1

- 发布提交 / Release commit: `dcd968d20`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Allow online update worker sudo under systemd

### 新增能力 / New Capabilities

- Allow online update worker sudo under systemd `dcd968d20`

### 改进与调整 / Improvements and Adjustments

- Prepare v0.0.1 online update baseline `c7b223d93`
- Make release installs reproducible `deea26349`
- Update Agent release repository default `51bf5ff43`
- Rewrite PayIncus README `c1f237e0e`
- Update payincus deployment checks `7979d9dda`
- Update README.md `f971ad5f0`
- Prepare host deployment package `09d96b11b`

### 修复与稳定性 / Fixes and Stability

- Harden release production verification `c31d5ba79`

### 其他变更 / Other Changes

- first commit `cb4a866db`

## 生成方式

在仓库根目录执行：

```bash
pnpm docs:build
```

或者只刷新版本日志：

```bash
pnpm docs:changelog
```

如果 CI 或 GitHub Pages 使用浅克隆，可能拿不到完整 tag。需要在构建前拉取 tags，或改用 GitHub Release API 作为数据源。
