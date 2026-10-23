# 版本与验证记录

维护仓库：[mastalee928/payincus](https://github.com/mastalee928/payincus)。GitHub Fork 关系已于 2026-10-16 解除；仓库地址和提交历史保留。原 BSD 3-Clause 许可证与版权声明继续保留在 LICENSE。

## 当前源码与发布状态

- 面板 [v1.7.1](https://github.com/mastalee928/payincus/releases/tag/v1.7.1) 已正式发布，发行源码 `9d1e5ba47dd6bf0a0937413892dacfeeb15e4a1d`，注解标签对象 `b9e5ca546250ada32e9df55455bba454f54f5a4d`，GitHub 面板 latest 为 v1.7.1。修复旧 OTA 解包保留构建机 UID 导致备份执行器安装回滚的问题；双架构预览、正式首装/恢复演练与公开资产校验通过。测试主控任务 #13 已使用原版 v1.7.0 执行器成功升级至 v1.7.1，2026-10-22 从实际管理后台复核成功日志及运行版本；同日 owner 明确确认已升级至 v1.7.1、正常运行、所有宿主均正常。下方各版本 latest 为当时状态；生产 OTA 未执行。
- 面板 [v1.7.0](https://github.com/mastalee928/payincus/releases/tag/v1.7.0) 已正式发布，发行源码 `33b08791dc62e819fbbff847c38cd9e9ba438a37`，注解标签对象 `e778882f3e20e62067abdcc289136de3d7e0f407`，GitHub 面板 latest 为 v1.7.0。纳入恢复保护、批量/已售恢复、故障状态、客户日志、密码重装及同配置跨区域更换机器；双架构预览与正式首装/恢复演练通过。首页改版已取消，设计样稿和新安装的设计技能未进入发行提交。测试站此前已热更新验证相关功能，生产 OTA 未执行。
- 面板 [v1.6.9](https://github.com/mastalee928/payincus/releases/tag/v1.6.9) 已正式发布，发行源码 `54203107fa138d92f0e29ece97d0c3fe1ed80090`，注解标签对象 `bce6f35d18e9bf00549349db8dc4fb8e4696980f`。GitHub 面板 latest 为 v1.6.9；双架构预览及正式首装/恢复演练、真实 OSS 额外 ZIP 上传/回读/隔离恢复均通过。测试主控已直接热更新验证，生产 OTA 未执行。
- 面板 [v1.6.8](https://github.com/mastalee928/payincus/releases/tag/v1.6.8) 已正式发布，发行源码 `44d26132f02f9bbaeb87c50305e39fb40f65be6c`，注解标签对象 `733c867101089fe1d24b9dd53d25b36c8c0a90a1`。GitHub 面板 latest 为 v1.6.8，双架构预览、正式首装及 Linux 本机备份/恢复/回退演练均成功。真实 OSS 测试桶验收及生产 OTA 未执行。
- 面板 [v1.6.7](https://github.com/mastalee928/payincus/releases/tag/v1.6.7) 已正式发布，发行源码 `fa716ee699e4ff77400b21bd093968c8be5f0dbc`（注解标签 `v1.6.7`，对象 `da4fdd3d1087d8cc59a8b0c4fcedba637ae95a6a`）；GitHub 面板 latest 为 v1.6.7。测试主控已载入 v1.6.7 同源内容（发布前经第六轮内部热替换上机，双端 index.html 与发行包逐字节一致）；面板 OTA 正式升级待执行。下方 v1.6.6 及其“已通过面板 OTA 升级至 v1.6.6”为当时状态。
- 面板 [v1.6.6](https://github.com/mastalee928/payincus/releases/tag/v1.6.6) 已正式发布，发行源码 `9f1a14a799a9600a4aa6a3c84f9cffa7d68ad087`（注解标签 `v1.6.6`，对象 `55bdb1dcfba1197b42a050ad8bf130afccaf6410`）；GitHub 面板 latest 为 v1.6.6，测试主控已通过面板 OTA 升级至 v1.6.6；其后的仪表盘负载条修复等提交已随 v1.6.7 发布。下方 v1.6.5 及其“已通过面板 OTA 升级至 v1.6.5”为当时状态。
- 面板 [v1.6.5](https://github.com/mastalee928/payincus/releases/tag/v1.6.5) 已正式发布，发行源码 `3fb8a0eb9dd95088addf221e538a9eeac4e687f3`（注解标签 `v1.6.5`，对象 `26a2651773e813b7292506c9a7fd776b4672bb16`）；GitHub 面板 latest 为 v1.6.5，测试主控已通过面板 OTA 升级至 v1.6.5。下方 v1.6.4 及其“已通过面板 OTA 升级至 v1.6.4”为当时状态。
- 面板 [v1.6.4](https://github.com/mastalee928/payincus/releases/tag/v1.6.4) 已正式发布，发行源码 `41d87820504977ffb24f895ab6c735a67f17fdaa`（注解标签 `v1.6.4`，对象 `8d39a04ea5d084378664e24ff0c0326758c2d744`）；GitHub 面板 latest 为 v1.6.4，测试主控已通过面板 OTA 升级至 v1.6.4。下方 v1.6.3 及其“已通过面板 OTA 升级至 v1.6.3”为当时状态。
- 面板 [v1.6.3](https://github.com/mastalee928/payincus/releases/tag/v1.6.3) 已正式发布，发行源码 `f8d2ca450e01a10a54ae5f57b75e4f80821371dd`（注解标签 `v1.6.3`，对象 `5d7b3e170a6de887256c5ccc2ba32e8e8d7bb58f`）；GitHub 面板 latest 为 v1.6.3，测试主控已通过面板 OTA 升级至 v1.6.3。下方 v1.6.2 及其“尚未进入新的正式安装包”为当时状态。
- 面板 [v1.6.2](https://github.com/mastalee928/payincus/releases/tag/v1.6.2) 与 [Agent v1.0.3](https://github.com/mastalee928/payincus/releases/tag/agent-v1.0.3) 已正式发布，源码均为 `2b81ce66e99c0941df8f579f085be59ce909541f`；后续源码和文档提交不改变已发布标签或安装包。下方实例配置权限收紧与购物车布局精修属于发布后的源码及测试站更新，尚未进入新的正式安装包。
- 此前 GitHub main 停留在 b140752，后续功能只在维护者工作区及测试主控直接部署。`429e858` 已补齐完整功能，后续提交修复全新安装验证中发现的问题。
- 源码包括机器池、定价、购物车、一机一卖、Alpine / Debian 接入、1 GiB swap、WireGuard 管理、全端口 TCP/TCP+UDP、故障换机、公网 IPv4 与多 IPv6 自动同步、用户/管理员 PUSH，以及首页、45 区域选购和 UPAY Pro 更新。
- 安装器、OTA、Agent、文档和问题反馈均使用本仓库。新安装增加管理网关配置，发行包包含完整迁移、探测、网络、swap 与网关脚本。
- 本地类型检查及全套配置测试已逐项通过；安装器、仓库来源、部署配置、OTA 与网关参数守卫通过。Lint 无错误，保留已有样式警告；文档构建通过。
- [正式发布工作流](https://github.com/mastalee928/payincus/actions/runs/38878414833) 全部成功：Linux amd64 / arm64 分别构建并从真实发行包全新安装，通过 209 条数据库迁移、IPv6 数据字段、唯一后端启动、双端访问、管理员登录、机器池 API、固定主机指纹 SSH 网关及正式 Agent 下载和执行验证。
- 已实际下载两种架构的公开安装包，确认 SHA256、文件大小、OTA manifest、包内版本与 Git 提交一致；检查全部迁移和 IPv6、UPAY 等关键模块，包内 LICENSE 与发行源码原文一致。GitHub 的面板 latest 为 v1.6.2；公开一键安装脚本与发行源码一致。
- [源码 CI](https://github.com/mastalee928/payincus/actions/runs/38877110604)、[Agent 发布](https://github.com/mastalee928/payincus/actions/runs/38877110746) 均通过；[本仓库文档站](https://mastalee928.github.io/payincus/) 已上线。

## 2026-10-23 独立网关组件包与运行验证（阶段交付，未发版）

- 组件包基础提交 `f27a57c` 已推送；[CI 39895823020](https://github.com/mastalee928/payincus/actions/runs/39895823020) 全部通过，包括 amd64/arm64 原生包构建/验签/进程验收、类型/Lint/守卫及完整构建。
- 后续新增 root 侧完整安装计划和固定新装执行器。计划绑定物理机器、当前预检摘要、包清单哈希、已提交源码身份及平台签名配置，有明确期限；包/平台信任来自单独受保护策略。已有接口、服务、执行文件或安装身份进入连接/迁移流程，不隐式重装。执行器不接受 shell/任意目标路径，持久保存原请求、步骤与独立密钥，中断后仅在原确认仍有效且配置一致时续跑；缺密钥、文件/服务变更和同提交下的另一个签名包拒绝。安装后及重复执行重新检查当前内核接口、公钥、端口、地址和 peer，资源写权仍为 false。
- 授权灾难测试机的新平台测试身份已实际完成 root 安装→两个独立 systemd 服务→真实 HTTPS 登录/状态/退出→重复同请求返回相同回执→服务重启后身份不变。新服务 NRestarts=0，最终内核检查代码在该实际接口执行通过。初次安装前后业务后端 PID、IPv4 默认路由与完整 nft 规则哈希一致；IPv6 原始哈希因 RA 动态 expires 字段变化，不能当作完全一致证据，随后排除该倒计时后的双栈默认拓扑/规则/PID 在新服务重启前后保持一致。没有执行客户实例操作。
- 安装流程使用独立固定证书和随机密码/MFA/恢复码，秘密只留 root 私有 bootstrap 文件；公网 HTTPS 认证使用该证书校验通过。现阶段仍明确列出自主备份登记、宿主写服务及公开证书生命周期阻断，不将固定证书当作完整自动续期方案。实际包内 Python 导入曾生成 __pycache__ 导致严格验签拒绝，已禁止生成字节码，不放宽额外文件守卫。新增安装材料进入固定组件清单，现为 20 项。
- 12 组计划守卫及 10 组执行器文件/中断守卫通过；后者明确使用服务命令替身，不替代上述真实 systemd/公网验收。相关服务器类型、候选/租约/认证/控制台/备份与网关任务守卫、新增 TS ESLint 通过。证据 `logs/controller-takeover-research-20261022/gateway-install-executor-live.json`。页面计划/确认、受限 worker 调度及回执入库接线仍待继续；这一步没有新建业务后端或正式发行版本。
- 接手原目标，继续 P0–P6、四种部署拓扑及 AC01–AC34；每个已验证的大步骤按 owner 授权提交推送，完整上线门槛达成后才正式发版。原目标无 token 预算上限。页面安装/切换、业务管理路径接线、完整故障恢复和 72 小时离线等验收仍未完成。
- 新增显式组件构建器、Ed25519 清单及 Linux 验证器：包含 Node、三个独立 Go 命令、控制台/备份/发现/见证独立 bundle、静态资源和固定安装脚本。固定版本、源码提交、架构、协议和文件清单；拒绝错误签名/身份、篡改、额外文件、链接、错误权限与非匹配 ELF。安装器、构建器、依赖清单与运行源码都必须在已提交且未改动的状态，构建结束再核验来源；无自动生成发行签名身份或发布动作。
- OSS bundle 明确拒绝可选代理分支，保留现有受控 HTTPS 直连；清理上轮试装代理留下的依赖锁变化，锁文件仅增加既有 esbuild 的根构建依赖。包文件显式设置权限，严格 `umask 077` 下仍与验签清单一致；bundle 检查禁止导入业务后端、Prisma、dotenv 和 worker。
- 授权 ARM64 测试主控的隔离源码快照完成真实构建/验签、12 组 Linux 包验证测试及 14 项包内进程验收：独立账号初始化/重复初始化拒绝、HTTPS 登录/退出/恢复码重放拒绝、缺失传输状态返回未就绪、发现读取及重启防重放、见证 mTLS/互斥/持久代次，以及隔离网络中 OSS 失败不发布完成状态。所有服务仅运行于新建测试目录与 loopback，没有启动第二个业务后端。
- 使用包内 Node 和备份入口在新 OSS 测试子前缀实际上传、回读、解密并提取七项 B 网关资料，逐文件哈希与来源一致；恢复资料未激活，不修改 B 身份或客户资源。证据 `logs/controller-takeover-research-20261022/gateway-component-package-live.json`；构建源为独立验收快照，不当作正式发行构建。相关守卫、服务器类型/构建及新增测试 ESLint 通过；本阶段没有前端源码变化。
- CI 新增 amd64/arm64 原生组件构建、独立验签和包内进程验收；提交后的 CI 结果另记。包内运行通过不等于页面安装、受信 root 执行器、全部故障切换或正式 Release 已完成。

## 2026-10-23 签名候选与独立发现基础（隔离实测，完整接管未完成）

- 后台网关任务补齐持久底座：固定平台/网关/物理machine-id与SSH指纹，严格计划哈希、独立步骤operationId、单目标活动任务约束、PG事务前有界排队及跨进程非阻塞锁。失去执行租约转needs_review并保留机器占用，不自动重放；重新确认后要求started步骤对账。全部回执与配置版本校验后只推进一次版本，凭据与执行租约不进入公共select，结束/过期清除凭据。尚未开放任务API、页面执行或特权安装接线，摘要回执不是物理证明，不标HA就绪。
- 任务底座提交9b526f5已推送，[CI 39883087278](https://github.com/mastalee928/payincus/actions/runs/39883087278)成功。随后新增统一只读网关预检：本机固定execFile无需SSH、远端固定python stdin，读取实际机器/系统/服务归属、接口alias与地址、全路由及UDP/TCP监听；错误目标、既有路由重叠、未知服务和占用HTTPS端口阻断。Node严格校验报告并重新计算请求/现场摘要。实际主控ARM64本机执行器、固定SSH指纹的A网关amd64远端执行器、B状态、错误机器ID/占用端口/路由冲突通过；证据 `gateway-preflight-live.json`、`gateway-preflight-local-bound.json`、`gateway-preflight-remote-bound.json`。A/B使用专用Node目录，系统PATH缺Node按事实显示依赖缺口，未自动忽略。Python7组冲突守卫、Node请求/报告边界、双端类型及相关候选/机器池守卫、服务器构建与新文件ESLint通过；尚无页面任务/安装执行接线。
- 预检提交c00591e已推送，[CI 39884135967](https://github.com/mastalee928/payincus/actions/runs/39884135967)成功。继续接机器池只读网关列表/任务查询/inspect路由，要求当前管理员及Web sid/Bearer/精确管理端Origin；严格schema、限量/限频、错误信息只输出固定码。平台ID从配置读取，本机不用SSH，远端固定一个公网IP及SSH指纹。检查报告与摘要回执原子持久，重复请求返回原报告，变更参数复用请求ID/重复物理机器身份拒绝。succeeded仅指检查完成，依赖/冲突阻断仍显示，canWrite=false；没有安装/应急写入口。
- 新报告迁移仅应用隔离库；真实ARM64主控本机检查API、A网关amd64远端检查API均通过登记→预检→持久查询→重复提交，身份重复/参数冲突/本机凭据拒绝；接线后11组真实PG事务回归通过。证据 `gateway-management-route-live.json`、`gateway-management-remote-route-live.json`、`gateway-task-journal-route-regression.json`。真实Fastify权限/Origin/schema守卫已登记根清单与CI（175项），相关类型/管理员/会话/任务守卫、服务器构建、新文件ESLint通过；未改变业务数据库或客户宿主管理入口，完整HA及页面安装仍未完成。
- 检查接口提交3f070ea已推送，[CI 39885428821](https://github.com/mastalee928/payincus/actions/runs/39885428821)成功。机器池新增管理网关页签：本机/独立/已有目标选择、预先核验SSH指纹、临时凭据、管理网段/端口、真实检查及持久阻断。本机无SSH字段，提交/切换/离开清除表单秘密，列表重新检查恢复原身份；新增页签方向键/Home/End及焦点转移。保持黑白token和既有机器池行为，没有安装/控制权按钮冒充可用。
- 使用design-taste-frontend及fixing-accessibility，延续Data terminal（seed779163351，保留品牌字体/配色，无重抽）；浅深色1440/768/390真实浏览器检查0 FAIL/0 WARN，身份/网段等宽提示按用途保留。真实页面调用隔离主控API完成检查→刷新→重查路由冲突、模式切换清凭据、焦点及手机无横向溢出，`gateway-page-browser/live-result.json`；样本会话只在隔离服务，不替代正式权限守卫。双端类型/路由/i18n守卫通过（`logs/test-run-20261023-102154/summary.txt`），双端构建/dist边界/服务器构建及修改文件ESLint通过。发行工作流、首装检查补入预检Python文件，配置示例加入稳定GATEWAY_PLATFORM_ID；正式Release与业务部署未更改。
- 新增迁移仅应用于新建隔离PostgreSQL16数据库；在授权测试主控独立Node22 ARM64目录执行11组真实事务验收，覆盖8路重复请求、跨进程锁竞争、新进程重读UTC租约（数据库会话Asia/Shanghai）、中断保留占用/同operationId对账、回执重放/冲突、精确确认/过期、版本只推进一次、管理员撤销与远端凭据过期清除。两次同机验收通过，证据 `gateway-task-journal-live.json`。跨机SSH隧道样本发现默认5秒事务排队超时，修为事务前排队；新进程首次连接抖动另以同机隔离连接完成正式证据，不把失败样本计作通过。
- 14项新增守卫已登记根清单及CI，清单现174项；相关双端类型、候选/发现、管理员权限、会话状态、机器池守卫通过，服务器构建与新增文件ESLint通过。没有前端文件变更，没有在业务数据库应用迁移，现有唯一测试后端active、NRestarts=0。最新前三阶段提交ac1b09e/183bedd/706af0d的CI与Agent构建已复核成功；本轮不更改版本、标签或正式Release资产。

- 接手原聊天后继续原完整网关/灾备规格（截图最初26项，现行规格已扩展34项）：目标仍为页面灾备准备→新页面恢复并确认→宿主主动读取签名配置/建新通道/上报；双通道、独立备用身份、旧写者隔离、历史副本和部分失败均须交付。没有缩减为测试机通讯修补，旧主控与客户宿主保持原运行状态。
- 新增独立准备隔离 `--prepare-fence`，本地受保护登记ssh/incus端口，远端候选和见证许可均需验签；重读并锁住最高代次，nft检查后重新按当前时间核验有效期，拒绝无关同名表/额外规则/休眠或设备绑定，执行后核验实际规则。仅阻断宿主外部管理INPUT TCP，不开放候选写入、不取消Incus任务、不动客户FORWARD/DNAT、WireGuard、SSH密钥或Agent地址。输出networkFenceApplied=true仍保留凭据/本地进程及活动任务阻断，canWrite=false。
- 真实Linux隔离net namespace中，实际Go生产路径及维护命令验证7项：双签名和磁盘水位→原子规则及重试→缺失登记端口拒绝/隔离后读取失败无成功输出→IPv4/IPv6旧连接字节与新连接拒绝→相同管理端口上的客户DNAT/FORWARD既有/新连接保持→loopback与其它INPUT可用→客户规则一致。Go全包race/vet通过；真实Incus6.0.4在独立mount/net/pid namespace验证活动与结束任务均准确报告，隔离不取消已接受的任务。证据 `management-fence-command-final.json`、`maintenance-prepare-real-incus.json`；新增可复验脚本 `scripts/test-controller-management-fence-netns.py`。尚无重启门禁、旧凭据/进程审计或租约代理，未上客户宿主、未发新版本。
- 本轮全清单通过四分片覆盖173项（44+43+43+43），每个进程独立exit=0，另过服务器编译、Go全包race/vet及真实准备命令/Incus联调；Lint 0错误、665条既有格式告警。分片2记录 `logs/test-run-20261023-033925/summary.txt`；并发分片1/3/4因同秒启动共用日志目录，分别的成功结果另存 `logs/controller-takeover-research-20261022/maintenance-suite-shards.json`，不能只以被覆盖的单份summary作为173项证据。此前单次全量033022因会话中断仅执行部分，不作为全量通过记录。本轮没有前端源码变化，双端构建不作为新增证据。
- Owner更新目标：完成P0–P6，在130.61.72.222测试机核验主控兼网关、独立网关、主控经独立网关及备用网关；旧主控允许作为灾难演练机器。必须复审代码、权限/回放等基础漏洞及实际前端按钮，全部上线门槛达成后才提交最终实现、推送及发版。准备隔离只是阶段成果，不触发提前发版，也不授权破坏客户实例/磁盘/账务。
- P0新增实现决策 `GATEWAY_CONTROL_DESIGN.md`，明确独立单写文件见证的故障/恢复边界、短租约与boot/gate身份、固定管理代理及A/B传输映射。Node/Go短写租约编码36项共同向量通过，Go LeaseGate单调截止/重复不续命/撤销重放/错误持有者与范围/过期和进程重开拒绝通过；逻辑时间随单调时间前进，回拨不复活。最终Go全包race/vet通过，相关Node守卫通过，新增编译及类型证据随后确认。尚未接入见证签发、真实凭据/进程审计、端口代理或资源动作；不能据此标P0完成，见证仍signedWriteLeaseAvailable=false。证据 `write-lease-go.json`。
- 继续补写请求的持有者证明：精确租约/正文哈希、权限、时间和nonce签名，9项Node→Go共同向量通过；错误正文不消耗nonce，8并发同请求仅一次授权，过期证明/改权限拒绝；公开门禁不接受公钥摘要作为写认证。时间校验与租约共用不回退逻辑时间，nonce覆盖整个最长租约并在续期中保留。Go全包race/vet通过；服务器类型检查及编译通过，候选总守卫包括新增租约/证明检查。证据 `write-lease-request-go.json`，仍无真实执行端点或签发。
- 见证继续接入内部短租约签发/续期：固定初始化的见证签名身份，验证新鲜host-fence-receipt及绑定boot/gate/持有者的controller-gate-proof；租约序号原子保存，重启重读并验签落盘对象，错误密钥/新gate/旧epoch/并发冲突拒绝。Windows30项、Linux32项见证守卫通过，Node/Go gate proof编码测试通过，证据 `witness-write-lease-linux.json`。目前使用签名夹具，无实际宿主凭据/进程审计或写代理，公开可用状态仍false，不能标物理隔离/接管已完成；上一条“无签发”为当时状态。
- 准备报告加入真实本机processAudit：确认procfs、两遍核对PID/父链/UID/名称/启动ticks，SSH会话及后代任务计数、监听进程分列、父链变化不冒充稳定；不读取cmdline/environ。真机发现内核启动早期ticks=0合法，已兼容。真实procfs读取/取消、父链循环/缺失及解析边界、最终Go全包race/vet通过，证据 `process-audit-go.json`。脱离SSH的旧任务及本地root写者仍未完成隔离审计，localWriterAuditComplete=false并继续阻断；不能据无SSH会话签发完整物理回执。
- 内部HostOperationExecutor加入固定inspect-operations与既有默认项目实例start/stop/restart协议，拒绝任意Incus路径/原始shell/创建删除/force和路径穿越；先租约+持有者正文证明，再查活动任务/实例身份，最后发固定电源请求。执行上下文受剩余租约时限与Revoke取消绑定，已接受任务仍须后续核对。真实Unix API替身验证错签名不触达、忙任务不写、重复不二次执行、撤销拒绝，Go全包race/vet通过；无网络监听/正式服务，没有更改客户实例。证据 `host-operation-go.json`。
- 真实Incus6.0.4隔离mount/net/pid环境通过内部执行器的租约+持有者证明只读链，活动与结束任务均准确检出；未提交真实实例电源操作。证据 `host-operation-real-incus.json`。随后加入准备前持久network-fence.json及 `--restore-fence`：原子保存签名拒绝授权，启动仅恢复已授权拒绝；隔离网络中删除运行期表模拟规则丢失，恢复与端口变化拒绝、双栈客户转发保持均通过，Go全包race/vet通过，证据 `management-fence-startup.json`。尚无已安装init启动顺序、旧凭据/本地写者完整审计，未标整机重启或完整接管验收。
- Owner 后续明确改为每完成一个大步骤、通过对应验证后立即提交推送，不再积累到全部阶段结束；此前“最终实现完成才提交”不再适用于阶段源码提交。完整灾备验收与发布仍分开记录。
- 继续补齐独立 incudal-maintenance HTTPS 准备服务：TLS1.3 客户端证书认证，逐请求候选/见证验签；只开放检查与拒绝准备，私有/loopback 独立端口、同宿主身份 flock 单服务；先恢复持久签名拒绝再监听。拒绝查询/编码路径、未知接口、超限/压缩正文和并发准备，失败不泄露配置或部分输出；SIGTERM 关闭监听，保留拒绝状态。尚无租约写入口、完整本地写者审计或正式宿主启动安装。
- 本阶段最终全套检查 planned/executed/passed=173、failed=0，`logs/test-run-20261023-044946/summary.txt`；服务器构建通过。独立 Ubuntu 24.04 amd64 的完整 Go race/vet 与维护服务构建通过，证据 `maintenance-service-race.json`；真实隔离 net namespace 中，生产 HTTPS 服务恢复签名隔离后监听、mTLS 检查、不同端口重复服务及缺失状态拒绝、停止关闭监听均通过，双栈客户转发规则保持，证据 `maintenance-service-lifecycle.json`。CI 增加维护命令的 race 检查；没有前端源码改动、真实实例电源操作或整机重启验收，不作为完整P0–P6通过证据。
- 基础阶段提交 [69d9fe6](https://github.com/mastalee928/payincus/commit/69d9fe6eaddba419a17aa33312f2ae4d61f8b33e) 已推送；[CI 39854695406](https://github.com/mastalee928/payincus/actions/runs/39854695406) 和 [Agent 构建 39854695385](https://github.com/mastalee928/payincus/actions/runs/39854695385) 成功，版本与正式发行资产不变。
- 独立见证补齐受信首次初始化、身份清单和mTLS状态/准备/激活/租约接口：签名身份固定，证书精确绑定主控/持有者/节点范围，同节点请求串行；已有/缺失/损坏状态不能重新初始化。Windows26项接口守卫、服务器类型和构建通过；独立Ubuntu amd64真实CLI验证mTLS、重复权威拒绝、重启保留代次、缺失/损坏拒绝、正常退出关闭监听，单节点样本RSS约62MiB，证据 `witness-service-cli.json`。夹具签发租约不构成真实宿主物理隔离，正式部署/恢复流程、宿主采集与写代理尚未完成。
- 见证服务阶段 [01d63c8](https://github.com/mastalee928/payincus/commit/01d63c8916a5e3f3c6e0ffc0cd3c6074948698e6) 已推送，[CI 39856820346](https://github.com/mastalee928/payincus/actions/runs/39856820346) 成功；独立Linux26项接口及正常/强制退出CLI重启验证通过，证据 `witness-service-linux-final.json`。
- 双通道基础增加host-management-channels/v1及独立incudal-channels命令/服务：a/b不同公钥、接口与/32控制路由，预检全部路由表/地址/接口归属，拒绝隐式替换/退役；签名高水位及不可变本地身份持久化，缺失初始化状态拒绝。已过Node/Go10共同向量、服务器类型/相关候选守卫和编译（`logs/test-run-20261023-053639/summary.txt`），完整Go race/vet。实际WireGuard隔离namespace验证双握手、A断链/B保持、客户默认路由不变、运行接口丢失恢复、过期本地恢复/过期更新拒绝、实际命令与单服务及状态丢失防回放；证据 `channels-go-netns-final.json`。尚未配置真实A/B机器通道、正式安装/init顺序、页面或租约写代理，不作为整机HA完成证据。
- 双通道基础 [2cb03a0](https://github.com/mastalee928/payincus/commit/2cb03a0dad21e39015e2426c3c70a332a57079ce) 已推送，[CI 39859758227](https://github.com/mastalee928/payincus/actions/runs/39859758227) 和 [Agent 构建 39859758302](https://github.com/mastalee928/payincus/actions/runs/39859758302) 成功。随后新测试主控arm64通过同源incudal-channels连接两台独立amd64网关专用身份/网段，真实UDP双握手与探测通过，A测试接口停止后B继续、主控健康/默认路由保持，证据 `channels-live-cross-machine.json`。仅使用新建测试接口，不宣称现有客户宿主已双通道覆盖。
- 新增显式通道服务安装计划/哈希检查及systemd/OpenRC单元。实际Debian测试主控systemd通过：错误哈希拒绝且现存unit/进程不变；启动前恢复接口，停止服务不删除通道，丢失B接口后启动重建并在有限18秒探测窗口重握手，主控后端进程及默认路由不变；服务内存约5–11MiB，128MiB限额。证据 `channels-systemd-live.json`，安装器相关守卫通过。整机重启、Alpine/OpenRC、真实宿主与发现/页面下发仍待后续验收。
- 安装阶段[aecc28b](https://github.com/mastalee928/payincus/commit/aecc28b23afb8d71d92dcbefa22babbd4e2f0de3)已推送，[CI 39861248743](https://github.com/mastalee928/payincus/actions/runs/39861248743)成功。后续独立发现增加节点签名路径绑定的双通道领取与持久发布；Go常驻服务可配置独立HTTPS/节点seed/CA，失败报告并保留当前通道。服务器类型/构建/相关守卫通过（`logs/test-run-20261023-060002/summary.txt`），Go全包race/vet通过；独立发现服务守卫增至34项。
- 实际新测试主控Go经独立见证机HTTPS读取并应用新签名通道代次，旧代次再次发布后被宿主持久水位拒绝；停止发现进程时通道服务持续运行，A/B均可达并记录读取失败，证据 `channels-discovery-live.json`。测试中发现A接口down/up丢失独立回程host route，恢复测试路由后双向探测通过；正式网关服务仍需负责持久协调，不以握手替代路由/通信实证。该试验不是现有客户宿主通信接管，也未验证主控整机灾难、网页发布或资源写者隔离。
- 网关传输增加签名配置、持久身份/代次、peer墓碑及独立incudal-gateway服务/安装器。Node/Go10共同向量、服务器类型与相关守卫通过（`logs/test-run-20261023-061816/summary.txt`），完整Go race/vet通过。实际隔离内核验证接口down后的peer回程路由恢复、冲突/签名拒绝、撤销落盘中断后重试、旧快照拒绝及墓碑不能复活；证据 `gateway-transport-go-final.json`。
- 实际两台独立Ubuntu amd64网关安装同源专用传输服务，systemd启动/停止/恢复回程路由及新测试主控双向探测通过，B重启重连测得19289毫秒；证据 `gateway-transport-live.json`。测试机专用网段/身份，不修改客户资源；仍无网关Web/MFA、自主OSS备份、宿主真实审计写代理或完整整机灾难验收，不作为P0–P6全部完成证据。
- 网关协调[1d1ed2d](https://github.com/mastalee928/payincus/commit/1d1ed2d30c19025bf4cd2a442f33e5cc2cf4de60)已推送，[CI 39864715146](https://github.com/mastalee928/payincus/actions/runs/39864715146)和[Agent构建39864715109](https://github.com/mastalee928/payincus/actions/runs/39864715109)成功。
- 本地写者审计补齐固定可执行/配置哈希、UID/capability/Incus管理组、procfs二次进程及exec变化、Incus socket/netlink/BPF描述符、调度清单与NOFOLLOW/文件边界，接入受保护维护登记的可选writerAudit。Linux实际未知root进程、文件权限/取消及非root管理组守卫、完整Go race/vet通过，证据 `writer-audit-go.json`；服务器类型/候选守卫通过（`logs/test-run-20261023-064107/summary.txt`）。事实清点不构成旧授权/本地任务实际隔离，ManagedWriterIsolationVerified仍false、原阻断项保留，未据此签发完整宿主回执。
- 网关独立认证/控制台：scrypt密码、持久TOTP防重放/恢复码消耗/登录锁、账号版本撤销及进程会话；HTTPS Cookie/Origin/CSRF/CSP、限量本机ip/wg状态和固定接口。18项认证及19项HTTPS守卫通过，服务器类型/构建、前端路由、双端构建/dist边界通过；浏览器实际登录、恢复码展开/重放拒绝、刷新、黑白主题/退出，1440/768/390布局无横向溢出。设计源码检查0失败，渲染检查0失败、登录屏留白和skip-link边界识别两条提示已解释；证据 `gateway-console-browser.json`。状态行使用明确样本，不代替真机验收。
- 两台独立Ubuntu amd64网关的真实HTTPS控制台登录/peer接口和完整回程路由/退出/恢复码重放拒绝通过，独立systemd服务NRestarts=0、各约30MiB内存，传输服务持续运行；证据 `gateway-console-live.json`、`gateway-console-systemd.json`。安装器拦截官方Node包保留的非root构建UID，测试目录修正归属后通过。运行配置已移除初始化密码/MFA材料。当前只读及写门禁/备份阻断如实显示，正式独立证书续期、主控页面配置、应急写、OSS自主备份和完整灾难验收尚未完成。
- 自主备份基础加入独立scrypt/AES-GCM归档、身份/文件哈希和受限OSS前缀、回读认证后完成标记、全量历史保留及恢复ID保护；备份/清理与恢复互斥，常驻定时与所有源变更触发。备份失败保留上次完成时间，控制台读取实际覆盖代次。相关服务器类型/构建及17项加密/失败/保留守卫通过（`logs/test-run-20261023-075422/summary.txt`），后续客户端越界操作检查另跑同守卫。
- 在独立B的真实OSS新测试前缀上传/回读/解密、7项资料空目录提取与私钥/传输字节一致通过，另一个测试机器用独立恢复密码从OSS冷恢复哈希一致；证据 `gateway-oss-live.json`、`gateway-oss-cold-recovery.json`。停止新测试主控Node期间，B自主调度完成新云归档，完成时间在故障窗口内，传输/控制台继续；主控已恢复且健康。证据 `gateway-oss-controller-offline.json`。1小时周期下认证配置变化触发新归档，证据 `gateway-oss-change-trigger.json`；实际控制台显示完整备份但保持无写权限，证据 `gateway-oss-status.json`。真实RAM越界、72小时/整机故障、磁盘满/限流/独立告警及完整恢复激活仍未完成，不能据此标P4/P6通过。
- 宿主维护运行状态补齐boot/gate、证书精确主控/持有者绑定、双签名准备/本机采集→节点回执/gate proof→租约→固定操作路径。每次操作先鉴权再审计，磁盘高水位变化撤销、新epoch失败不保留旧写者、旧租约拒绝跨进程重启。完整Go race/vet及实际Linux隔离HTTPS未完成审计拒绝签完整回执、客户双栈规则保持通过；证据 `maintenance-runtime-go.json`。服务器类型/相关守卫通过（`logs/test-run-20261023-081440/summary.txt`）。正式collector仍保留旧授权/本地任务隔离阻断，无真实客户写授权或完整接管声明。
- 迁移审计接入实际sshd有效配置、Include/Match旁路检查及root:root/0600 Incus Unix socket；受审调度树哈希绑定目录/链接/文件变化，未知特权进程及旧任务阻断。修正审计自身临时FD误判，只有完整受审事实才标本地写者隔离。完整Go race/vet、SSH认证方式/树变化守卫及显式三namespace集成通过：真实禁用SSH/root socket/procfs/nft采集后签回执，新增调度任务立即拒绝；证据 `migration-audit-go.json`、`migration-audit-isolated.json`。类型/相关守卫通过（`logs/test-run-20261023-082845/summary.txt`）。本集成Unix API为固定替身，未作为真实Incus电源动作、客户宿主或完整分区验收。
- 后续同源迁移测试在新测试主控arm64隔离mnt/net/pid中连接真实Incus6.0.4，实际SSH有效配置、root-only Unix socket、进程/调度树和nft水位采集→节点回执→签名短租约→固定Incus只读执行通过；原请求重放、3秒实际租约到期和调度变化均拒绝。证据 `migration-runtime-real-incus.json`；完整Go race/vet通过。此项仍使用临时见证签名身份，未执行真实实例电源/远端见证HTTP/客户宿主，完整接管继续施工。

- 本机采集提交 [e9aa5f4](https://github.com/mastalee928/payincus/commit/e9aa5f4b31af9a828a103ac6a8d6e10fb4c4549b) 的 [CI 39830723408](https://github.com/mastalee928/payincus/actions/runs/39830723408) 和 [Agent 构建 39830723410](https://github.com/mastalee928/payincus/actions/runs/39830723410) 成功，未修改VERSION或发布新资产。
- 继续实现host-fence-prepare/v1见证签名准备许可，21项共同Node/Go边界通过；独立incudal-maintenance只读预检严格核对登记/输入、两方签名及最高观察代次后读取本机Incus，尚未完成的网络/凭据/进程审计始终列为阻断，canWrite=false。错误许可不创建状态、高代次后拒绝旧请求、重复预检/错误权限/未知命令与JSON均有命令级守卫。
- 实际Incus6.0.4隔离环境中，由Node见证生成许可、Go独立维护命令读取真实活动/结束任务并持久记录最高代次；有任务时准确阻断，无任务仍不冒充物理隔离。错误许可/不安全登记拒绝；Go全包race/vet通过，类型检查/服务器编译/相关候选守卫通过。证据 `maintenance-cli-go.json`、`maintenance-real-incus.json` 保留本地。未接入正式Agent main/安装服务，未改宿主或主控管理入口。

- 见证提交 [7eb81a3](https://github.com/mastalee928/payincus/commit/7eb81a339afdea2ac495157cc513e30fa64b3fc3) 的 [CI 39829854002](https://github.com/mastalee928/payincus/actions/runs/39829854002) 与 [Agent 构建 39829853941](https://github.com/mastalee928/payincus/actions/runs/39829853941) 成功，版本不变，未发Agent新版本。
- 宿主Go加入独立本机只读Incus操作采集，固定Unix socket GET全部项目操作，安全文件/祖先权限与链接检查、超时/取消、响应大小/操作数量/JSON深度/重复键边界；连接失败、HTTP拒绝/跳转/HTML、未知分组拒绝。Go全包race/vet通过；实际Incus6.0.4隔离任务活动及最终结束分别被Go检出，Node静止门禁同步验证。证据 `quiescence-go-final.json`、`incus-go-quiescence.json`。尚未接入Agent main或宿主写权限执行，原主控/宿主不变。

- 接管前静止检查提交 `7834689` 已推送。后续新增 Node/Go 宿主隔离回执：绑定候选/挑战/bootId及主控代次，要求实际旧连接/凭据隔离和无未结束任务，严格规范字节与30秒有效期。26项跨语言向量、实际Go签名由Node核验、Go race/vet通过；未接入宿主root执行器，签名协议不是实际隔离证明。
- 新增内部独立见证两阶段状态库：更高epoch候选准备→持久挑战→验证宿主回执→内部激活；同请求幂等，冲突/旧代次/错误签名或挑战/过期/不同boot回执拒绝，缺失/损坏状态不自动重建，文件原子同步及进程锁。尚无管理认证、正式初始化/灾备重建、签名写租约和续期，signedWriteLeaseAvailable=false，不改变现有资源控制。
- 见证最终 Windows 23项/Linux 25项守卫通过，包含时钟回拨持久保护和容差内逻辑时间防过期复活。实际Go使用预登记临时节点私钥签署见证挑战回执，Node见证原子激活、进程重开幂等、下一代拒绝旧回执全部通过；证据 `witness-linux.json`、`witness-go-integration.json` 保留本地。此处只有内部状态联调，无真实资源写权限。
- 回执/见证阶段全套173项通过，`logs/test-run-20261023-020837/summary.txt`；之后时间持久保护另过最终服务器类型检查/编译、Windows候选守卫及Linux见证/Go联调。此阶段没有前端变更，无新版本、生产OTA或真实客户宿主控制变更。

- 后续 [8db15c6](https://github.com/mastalee928/payincus/commit/8db15c6fd28973acf3c83fe25ab36b56bdf60b62) 的 [CI 39822967631](https://github.com/mastalee928/payincus/actions/runs/39822967631) 与 [文档部署 39822967641](https://github.com/mastalee928/payincus/actions/runs/39822967641) 成功，未发新版本。
- 补齐只读接管前静止检查 inspectControllerQuiescence：真实 Incus 状态分组、ID/状态码、1024项边界及未知格式拒绝；旧连接/凭据未隔离、SSH进程/本地任务/Incus活动操作存在时阻断。状态码按 Incus 6.0.4 官方定义复核（Operation created=100、Pending=105）。类型检查、服务器编译和已登记候选守卫通过；canActivate 不构成写租约或资源核对成功。
- 从 Debian 包只提取 Incus 6.0.4 与依赖到专用实验目录，在独立 mount/net/pid 命名空间启动真实守护进程，sys/proc/sys保护且隐藏AppArmor控制入口，不安装系统服务/创建客户实例。延迟镜像任务提交后客户端关闭，真实任务继续运行，检查模块拒绝；测试源释放后任务按预期进入Failure，静止检查通过。Failure只表示任务结束，资源完整性仍须另查。验收脚本及调用适配入仓，证据 `logs/controller-takeover-research-20261022/incus-quiescence.json`；不等同于真实网关接管。

- 基础提交 [5e2a3cc](https://github.com/mastalee928/payincus/commit/5e2a3ccfc341b4018a4a811e2e03fcb0339e8544) 已推送；[CI 39819910429](https://github.com/mastalee928/payincus/actions/runs/39819910429) 和 [Agent 构建 39819910433](https://github.com/mastalee928/payincus/actions/runs/39819910433) 均成功，Agent VERSION 未修改，发布作业未触发。文档站本地构建通过；这些结果不等同于线上接管。
- 继续补齐内部候选状态库：受限结构登记、跨实例串行/跨进程 mutation.lock、原子持久发布、过期历史候选最高代次验证、同版本幂等及永久撤销墓碑；撤销不删除身份/nonce，不通过普通 enroll 自动复活。尚未开放受权网页/主控管理接口。Windows 20 项、Linux 22 项状态库边界及 29/43 项 HTTPS/CLI 检查通过；真实 Go 客户端经正式 CLI 验证登记→读取→新配置发布→再读取→撤销→拒绝，仍无写授权。最终全套 173 项通过，`logs/test-run-20261023-011442/summary.txt`；服务器编译通过。
- 新增显式启用的 Linux `scripts/test-controller-fence-netns.py`，在未命名独立网络命名空间验证 8 项网络门禁方向：旧既有/新建管理套接字拒绝、新管理源通过、客户模拟连接保持、重载幂等，并证明已接受的任务不会随连接隔离取消。网络规则仅作用于测试命名空间，未改主控或宿主防火墙；使用 TCP/任务夹具，不冒充真实 WireGuard/SSH/Incus 或完整写者门禁。完整接管仍须执行路径/已启动任务隔离与核对，证据 `logs/controller-takeover-research-20261022/fence-netns.json`。

- 新增 [CONTROLLER_CONFIG_PROTOCOL.md](CONTROLLER_CONFIG_PROTOCOL.md)。Node 与 Go 共用 Ed25519 字节封装、严格结构、平台/节点绑定、毫秒过期和精确 int64 字符串代次；未知命令、重复键、篡改、旧代次及同代次冲突拒绝。候选结果始终 canWrite=false，不授予管理写权。
- Go 新增独立 HTTPS 签名读取和 Linux 最高观察代次存储：校验 TLS、禁止重定向/HTTP、响应限量，磁盘互斥/原子改名/文件及目录同步，重启重新加载；文件损坏、权限/链接/持久化异常拒绝。未接入现有 Agent main，不变更当前心跳或网络指令。
- 独立 Node HTTPS 服务不导入业务后端、Prisma、Web cookie 或平台调度。节点独立签名请求、原点绑定、nonce 持久防重放、异步存储后再次核对撤销，错误信息脱敏。显式 CLI 仅监听 loopback，同状态目录 flock 防多进程，强制退出无需删除遗留锁；配置/TLS/状态均受文件权限及链接守卫约束。
- 73 份共同 Node/Go 向量通过；Windows 27 项 HTTPS/存储检查、Linux 真机 41 项（含正式 CLI、不同端口第二进程拒绝、SIGKILL/SIGTERM 重启、防重放保留和不安全配置拒绝）通过。正式独立 CLI 与实际 Go 客户端通过真实 TLS 双向签名、超 JS 精度代次及可配置地址验证，canWrite=false。Go 全包 race 与 vet 通过。本地证据 `logs/controller-takeover-research-20261022/`，不包含提交的凭据或私有配置。
- 全套 planned/executed/passed=173、failed=0，`logs/test-run-20261023-003759/summary.txt`；之后新增进程锁/CLI检查另过服务器类型检查、编译、候选守卫及 Linux 实测。根 lint 0 错误，保留 665 条既有前端格式告警。无前端源码变化；本阶段未使用网页模拟接管代替真实结果。
- 测试仅在临时独立进程/目录进行，未安装到现有运行后端、未修改原宿主连接、未停止旧主控。最后现存数据核对为 6 宿主、6 Agent、0 临时探针、15 实例；业务后端 MainPID=41330、NRestarts=0（当时核对结果）。
- 持久登记/撤销和候选发布、独立见证/宿主旧写者门禁、受限通道维护、双网关覆盖、页面接管、网关 Web 认证及自主 OSS 备份仍待施工。整体 34 项灾备验收尚未通过；本阶段不发布新标签/版本、不修改 v1.7.1 资产、不执行生产 OTA，后续完整验收后随正常发版纳入。

## 2026-10-22 主控页面接管研究与 CF Agent 通讯实测（当时接管功能未实施）

- Owner要求作为项目通用能力研究：未来正式主控不是本次测试IP，最终操作尽量在PayIncus页面完成。新增 [CONTROLLER_TAKEOVER_RESEARCH.md](CONTROLLER_TAKEOVER_RESEARCH.md)，明确可配置HTTPS上报、直连WireGuard入口、独立签名发现、预建B通道和控制权隔离；不是逐台SSH临时改地址方案。
- 在授权测试主控创建独立临时Host/Agent，仅验证CF公网API传输：有效HMAC心跳HTTP200并记录时间；同一nonce重放HTTP401/AGENT_NONCE_REPLAY；错误签名HTTP401/AGENT_SIGNATURE_INVALID。使用项目实际Go心跳客户端再次验证HTTP200及心跳记录；官方Go临时工具链SHA256已核对。临时身份/nonce清理完成，正式宿主未被伪造在线，旧主控和宿主Endpoint/上报地址未改变。证据仅保留本地 `logs/controller-takeover-research-20261022/`。
- 当前Agent单panel_url、宿主单WireGuard通道，没有旧网关完全失联后从新页面直接重连的能力。正常灾备需提前部署独立发现/备用通道；遗留宿主可经已有受控路径页面补装，全部路径失效时仍须云控制台或经另行授权实现的云远程命令适配，不能承诺凭数据库记录接管。
- 本轮验证只覆盖真实客户端从测试服务器访问CF，不等同于现有客户宿主迁移、管理SSH/Incus接管或跨故障域恢复。接管根签名、节点最高代次、旧写连接隔离和页面任务仍待实施；AC30–AC34补入施工验收，总计34项。用户已选择保留旧主控运行的恢复演练，当前继续遵守此范围。
- 进一步使用隔离HTTPS服务与临时CA/Ed25519身份完成16项独立签名配置拉取检查：地址配置变更、跨节点/平台、篡改、过期、HTTP降级、非法端口、同版本冲突、持久状态重读后旧配置回放、读取nonce回放及不可信证书均按预期处理。旧入口故障由未监听端口模拟，真实旧主控未停止，网关/Agent配置未修改；证据 `logs/controller-takeover-research-20261022/discovery-prototype.json`。原型仅证明读取协议方向，不作为真实切换、控制租约或旧写连接隔离的验收。

## 2026-10-22 网关独立界面、高可用与自主 OSS 备份方案整理（未实施）

- Owner 同意主控页面配置网关、独立网关轻量 Web 界面、活动/备用网关及灾备方向；独立备份沿用阿里云 OSS，在平台定时备份之外增加网关自主调度和变更备份，主控离线时仍可上传。可同桶不同前缀和独立RAM权限，但同桶不代表跨存储故障域。
- 完整流程见 [GATEWAY_HA_PLAN.md](GATEWAY_HA_PLAN.md)，施工要点、难点、阶段交付和29项验收见 [GATEWAY_IMPLEMENTATION_SPEC.md](GATEWAY_IMPLEMENTATION_SPEC.md)。主控离线时网关独立认证/诊断/备份，活动网关失联时从主控经预建备用通道接管；旧控制端和旧连接必须隔离，不能靠页面角色标记防双写。专项补齐「主控本机活动网关A + 独立备用B」服务隔离、双通道、页面切换与整机损坏后的B独立接管；旧主控页面离线时不能作为故障接管入口。
- 控制权见证、统一管理路径/地址映射、宿主双通道和门禁、远端一致性快照、撤销/增量恢复链为施工前架构必决项；见证不由OSS对象存储隐式替代。拟定恢复时间和备份覆盖目标需实际故障演练确认。现有版本没有上述完整高可用能力，本轮仅整理设计，未更改运行代码或生产配置。
- 同机A+独立B策略复审补齐故障处理矩阵、B应急账号/MFA及解密材料预配置、独立systemd服务依赖、升级/卸载不隐式移除B通道、旧端恢复及角色互迁；需求映射与P1–P5阶段门禁纳入AC27–AC29。第一版默认管理员确认接管，自动写接管须另经见证/宿主门禁验收，不将未实施方案写成当前已支持。

## 2026-10-22 OSS 换机恢复兼容性修复与网关指引（测试站热更新，未发新版本）

- Owner 在新装 v1.7.1 测试主控预检旧 OSS 备份时，任务 `5894b378-4911-4b14-8873-4779c8828fce` 返回 `OSS_VERSION_MISMATCH`；实际恢复未执行，数据库未切换、保护未开启。三份旧备份均认证通过，标记版本为 1.6.8、PostgreSQL 16、212 条迁移。最近备份 `509ee35b-8b4e-4540-9dfb-5e220eaefda5` 的唯一历史校验差异为 `202610150001_host_pool_checkout` 同一 SQL 的 CRLF/LF；触发器结构差异也仅为同一受信函数体的换行格式。
- 恢复支持相同版本或同一应用主版本内的较新稳定版本（0.x 限同一 minor），PostgreSQL 大版本仍须一致。先认证归档、按备份编码/libc locale 创建隔离库并验证完整性，再核对当前发行包的完整迁移历史，只接受受信 SQL 的精确 LF/CRLF 校验别名；缺少的迁移仅由当前安装的 Prisma 工具在隔离库执行，不执行备份中的代码。升级后结构须匹配当前程序；未知校验值、较新备份、跨主版本、结构不符与迁移失败明确拒绝。预检绑定目标版本、迁移、发行迁移清单和结构，正式恢复重新验证；同一 commit 的发行预览仅允许自身恢复。
- 完整换机演练发现备份 `en_US.UTF-8` 与新装默认 `C.UTF-8` 的差异；预检/恢复临时库改为继承已认证报告中的编码和排序规则，缺少系统 locale 时明确要求安装后重试。数据/序列/大对象/locale 的完整性校验与会话撤销、库存隔离、恢复保护、回退路径保持。恢复网关时先应用归档配置，再运行受信授权安装器，避免不同管理网段下验证旧运行接口。
- 使用真实 OSS 最近备份，在独立挂载/网络/进程命名空间和独立 PostgreSQL 集群完成预检、数据库/文件切换、保护启动、回退、回退后恢复运行：恢复 4 个用户、6 台宿主、15 条实例；原数据加密密钥、证书、WireGuard 配置和受限 SSH 身份逐项匹配，新机数据库连接、JWT/Cookie 身份、域名及公网管理地址保留。回退恢复目标机原数据和配置；演练不访问旧主控，也不连接客户宿主。数据库与文件恢复真实执行，服务控制使用隔离夹具，不能等同于生产故障切换或真实宿主重连。证据 `logs/recovery-diagnosis-20261022/full-isolated-drill.txt`。
- 新增隔离迁移兼容性演练，验证旧稳定版本与 CRLF 历史升级到目标结构、精确金额保持；较新备份、PostgreSQL 不匹配、结构漂移、预检后目标变化、未知迁移校验值均拒绝。已接入双架构发行首装脚本；本轮 ARM64 实测通过，后续 GitHub 双架构结果另记。
- Owner 确认新测试主控使用其直连公网地址配置本机网关，既有 root 安装器已验证成功。机器池新增可展开的「配置管理网关」指引，三语同步，说明在主控 root 终端执行 `--configure-host-pool`、直连地址、UDP 51820 与复查。当前网页提供指引，不直接执行配置；独立远端网关不是本轮自动完整恢复范围。
- 测试站部署前保存数据库、运行/OSS/网关配置、双端静态文件、受影响后端与原受信清单，回退目录 `/root/incudal-recovery-hotfix-3LvIzw`。只热更新验证代码、说明及双端构建并补齐 seal；最终后端 MainPID=26869、NRestarts=0，唯一监听 `127.0.0.1:3001`、`recoveryHeld=false`。运行配置与部署前逐字节一致，当前库仍只有新装管理员。最终后端模块及双端入口与本地构建逐字节一致。
- 已安装受信 CLI 的真实 OSS 预检 `1e55c355-9a54-4b8d-901e-5f5281e126c7` 成功；管理员 API 预检 `ac744b3e-d104-4f23-bccb-08da7d2886dd` 同样达到 `success/preview_ready`，可进入原确认流程。浏览器确认本机网关就绪、配置指引正常展开。预检绑定发起者且有效期 15 分钟；过期须从后台重新发起。测试站未正式恢复旧数据库，未解除恢复保护或操作客户实例。
- 最终本地全套 planned/executed/passed=172、failed=0（`logs/test-run-20261022-211942/summary.txt`）；双端与后端构建、dist 边界、部署/备份/机器池/前端路由/i18n 守卫、修改前端文件 Lint（0 错误）及文档构建通过。源码及记录按 owner 授权提交推送；不含本地技能配置、真实凭据或私有验收文件。GitHub CI 与下一次双架构发行首装证据独立记录；本轮未打标签、未更新 v1.7.1 发行包、未执行生产 OTA。
- 后续正常发版必须纳入本轮后端恢复修复、网关指引及演练；仅重新下载安装脚本不能给原版 v1.7.1 后端增加此能力。新主控完整恢复指平台快照内数据库和受管身份；不包含 VPS 磁盘、快照后的交易或外部系统。换公网 IP 后需将稳定直连管理域名指向新机，或通过宿主控制通道更新旧 IP Endpoint；主控数据恢复不能宣称离线宿主已自动重连。

## 2026-10-22 CF Tunnel 安装引导与真实首装验收（源码更新，未发新版本）

- 安装器 CF 方案明确为选项 2；增加「内网 Service URL」合并输入框与 Type/URL 分开输入两种填写方式，统一使用 `http://127.0.0.1:80`。输入两端域名后显示实际路由表，说明两端共用本机 Nginx、Path/HTTP Host Header 留空、保存路由后核实 DNS。两端 `.env` 地址仍走既有配置路径，不更改业务 API、鉴权或支付逻辑。
- 修复 cloudflared 安装失败被忽略仍报告成功：隐藏 Token 输入，不打印可能带凭据的原始 CLI 输出；已有服务必须显式输入 `reuse`，不覆盖配置或重启 Tunnel。增加域名/双端构建/端口/Nginx 前置检查、`--configure-cf-tunnel` 补配和 `--check-cf-tunnel` 只读分层诊断；验证当前进程实时连接数、两端正确页面及 JSON 健康 API，任何失败或未知项保持非零退出。
- 真实新域名生效过程中出现浏览器可访问、服务器递归 DNS 仍解析失败的现象。公网 DNS/连接/超时失败最多尝试 3 次，间隔 3 秒；保持原 DNS 与证书验证，不修改系统解析配置。持续失败提示 DNS 缓存或传播延迟、稍后只读复查，无需重装；HTTP 错误、错误页面/健康状态与 TLS 错误不重试。相关守卫覆盖恢复、持续失败、次数边界、已有服务/安装失败与 Token 不泄露；修正夹具受真实主机已有 cloudflared 服务文件影响的问题。
- 经 owner 授权在干净 Debian 13 ARM64 测试服务器从公开 v1.7.1 ARM64 发行包首次安装，使用本轮前期改进版安装器；完成 212 条迁移、唯一后端监听 `127.0.0.1:3001`、Nginx/cloudflared 启动。Owner 保存同一 Tunnel 的两条公网路由后，浏览器用户页和管理员登录成功，用户管理页显示初始管理员；本机 API 登录/查询/退出均返回 200，refresh cookie 为 Secure/HttpOnly 且无 Domain。凭据不写入公开记录。
- 本轮最终脚本与守卫在同一测试服务器的隔离验证目录运行：Linux 安装守卫通过，`--check-cf-tunnel` 返回 0，两端本机及公网页面与各自已安装构建一致、四个 API 反代检查和实时隧道连接均通过。检查前后 `.env`/Nginx 配置哈希及后端/cloudflared MainPID、NRestarts 一致（均未重启）；脱敏证据 `logs/cf-install-20261022/verification.json` 与 `linux-guards-and-diagnostics.txt`，仅保留本地。
- 本地最终检查：全套 planned/executed/passed 均为 172、failed=0（`logs/test-run-20261022-171733/summary.txt`），Windows/Linux 安装守卫、清单校验、仓库来源及部署文档守卫通过；双端/后端构建、dist 边界与文档构建通过。中文及英文安装说明同步。本次不含技能配置与构建自动生成的无关版本日志。
- 本轮按 owner 授权提交并推送源码与验收记录；GitHub Actions 结果单独查看，不能以本地通过代替。未打标签、未重建或替换 v1.7.1 Release 资产、未执行生产 OTA。管理网关安装时暂跳过；实例终端、资源交付和支付回调未在这台新测试机验收，不作为此次网站安装通过的证据。
- 后续发版安排：本次安装器修复随下一次正常面板发版纳入双架构安装包，不为此单独发布新版本。当前官方安装命令从 GitHub main 获取修正版脚本，但已发布 v1.7.1 安装包内附带的脚本仍为旧版；已有用户需要新的 CF 补配或诊断功能时，重新下载 main 的安装脚本即可，无需升级或重装面板。下一次发版应核对包内安装脚本与发行源码一致，并完成对应安装守卫及首装验收。

## 2026-10-22 v1.7.1 正式发行与测试站 OTA 收尾核验

- 发行源码 `9d1e5ba47dd6bf0a0937413892dacfeeb15e4a1d`，标签对象 `b9e5ca546250ada32e9df55455bba454f54f5a4d`。预览 [39614785962](https://github.com/mastalee928/payincus/actions/runs/39614785962)、正式 [39616260761](https://github.com/mastalee928/payincus/actions/runs/39616260761) 均成功：amd64/arm64 构建、归档 root UID/GID 检查、真实发行包首装、212 条迁移、唯一后端、管理员登录、管理网关及备份/预检/恢复/回退/恢复运营演练。OSS 传输在 CI 中使用本地替身。正式发布于北京时间 2026-10-21 22:31:35，非 draft、非 prerelease；本轮 GitHub API 复核 latest 为 v1.7.1。
- 两份已下载公开安装包重新校验通过：amd64 109074252 字节 SHA256 `fdae6bbc3caba1ac269ec42446258904ee8d4c68f1a8c996f66ceba4b26fb263`，arm64 108335628 字节 SHA256 `ff202065b25dc4ec2937d6948b51c97c64763d481c7fadb31c32e030df381e57`。校验文件、资产 digest、两份 OTA manifest、版本与源码身份一致；全部归档成员 UID/GID 均为 0，新执行器包含 `--no-same-owner`，关键运行模块与双端边界通过，设计样稿和技能未包含。证据 `logs/release-v1.7.1/verification.json`。
- 发行源码本地全套 172/172（含双端类型检查，`logs/test-run-20261021-220344/summary.txt`）、双端及后端构建、文档构建通过；Linux [源码 CI 39614784138](https://github.com/mastalee928/payincus/actions/runs/39614784138) 与 [文档 Pages 39614784139](https://github.com/mastalee928/payincus/actions/runs/39614784139) 均成功。
- 本轮直接读取已登录测试管理后台：任务 #13 为 `v1.7.0 → v1.7.1`、成功。日志始于北京时间 2026-10-21 22:35:28，22:37:32 完成；实际执行的是旧 `tar -xzf`，随后备份执行器安装成功，直接覆盖此前失败路径。整目录备份 `/opt/incudal.bak.20261021143528`、预迁移数据库备份 `/opt/incudal.bak.20261021143528/db-pre-migrate-v1.7.1-20261021143528.sql` 均在日志中记录。无待执行迁移，数据库/支付就绪、双端静态资源/API/WS、Agent manifest 和日志凭据检查通过，未跳过 DB 检查。页面运行版本为 v1.7.1、Commit 为 `9d1e5ba47dd6`，部署时间为 22:36:31。
- 2026-10-22 当前测试站健康接口返回 `status=ok`、`recoveryHeld=false`；实际用户概览显示实例 #13/#15 均运行中，名称、San Jose 区域及 2 核/768 MiB/30 GiB 配置可见，用户余额为 999868.90；管理端显示该用户仍有 2 个实例。本轮通过浏览器读取证据，旧 SSH 会话已断开，未重新执行服务器上的全字段/全用户余额快照断言或唯一后端进程检查；此前 #12 的逐项断言见下方，不能当作 #13 的同等验证。
- 2026-10-22 owner 明确确认：「我已经确定升级至1.7.1，并且正常运行，所有宿主均正常，请记录」。据此记录升级与当前运行状态的 owner 实际确认；下方 Frankfurt 宿主离线等内容为历史故障记录，不代表此次确认时的状态。SSH 补充核验已停止，该确认不等同于重新执行全字段快照断言或后端进程数量检查。
- 本轮仅补齐版本台账，不重新发起 OTA、不更改生产；首页设计保持取消，既有 `skills-lock.json` 和 `.agents/` 本地变动不纳入交接提交。

## 2026-10-21 v1.7.0 旧版本 OTA 权限回归与 v1.7.1 修复

- Owner 在测试主控发起任务 #11（v1.6.8 → v1.7.0），北京时间 21:52:31 失败于 `scripts/install-platform-backup.sh`，错误 `Untrusted helper source`，21:54:03 自动代码回滚完成。完整错误保存在失败版本副本中；活动日志在旧布局回滚时被旧备份覆盖，任务记录保留。迁移无新增变更，数据库预迁移备份 `/opt/incudal.bak.20261021135125/db-pre-migrate-v1.7.0-20261021135125.sql` 保留。
- 根因：GitHub 发行包记录构建机 UID 1001，旧 root OTA `tar -xzf` 保留此 UID；备份执行器安装要求来源文件为 root 所有，而更新流程在该安装后才加固权限。首装安装器会预先归一化权限，因此双架构首装通过未覆盖旧 OTA 场景。保持安全校验，修复新执行器 `--no-same-owner` 解包及安装前权限加固，并将后续发行包统一 `--owner=0 --group=0 --numeric-owner`，兼容已安装旧执行器。双架构验证直接检查安装前归档 UID/GID。
- 已备份测试机执行器与环境到 `/root/incudal-ota-owner-fix-iDf6bZ`，只修改已安装执行器的两处权限顺序并同步受信 seal，沿用 owner 的测试站更新授权重试。任务 #12 于北京时间 22:04:26 完成 v1.7.0 更新，数据库/支付就绪、双端 API/静态资源/WS、日志凭据检查通过；服务 `MainPID=1273505`、`NRestarts=0`，恢复保护关闭。实例 ID 13/15 的归属、机器、名称、CPU/内存/磁盘、价格、到期、续费及所有用户余额与更新前逐项一致。后续 v1.7.1 正式发行与任务 #13 成功证据见上方。

## 2026-10-21 v1.7.0 正式发行证据

- 发行源码 `33b08791dc62e819fbbff847c38cd9e9ba438a37`，标签对象 `e778882f3e20e62067abdcc289136de3d7e0f407`。预览 [39608386204](https://github.com/mastalee928/payincus/actions/runs/39608386204)、正式 [39609841694](https://github.com/mastalee928/payincus/actions/runs/39609841694) 均通过双架构构建及首装、212 条迁移、唯一后端、管理员登录、管理网关、备份/预检/恢复/回退/恢复运营演练；OSS 传输在 CI 中使用本地替身。正式发布北京时间 21:47:30，非 draft、非 prerelease。
- 实际下载两份公开安装包，amd64 109195921 字节 SHA256 `fc2a91fe3ca2f0c17cb3a32085f5a1d3a2949d1b06c402b396ac00b3b04917e4`，arm64 108303008 字节 SHA256 `66cf7ac7aaba0440adcdaaedfa694f970545d08827a1cd775c8328f90da1d196`。校验文件、资产 digest、两个 OTA manifest 一致，包内版本/源码/迁移与关键运行模块一致；用户 dist 无管理员换机接口、本地设计及技能未包含。校验记录 `logs/release-v1.7.0/verification.json`。
- 本地最终全套 172/172（`logs/test-run-20261021-211836/summary.txt`）、双端/后端构建、文档构建和 Lint 通过。Linux [源码 CI 39608386337](https://github.com/mastalee928/payincus/actions/runs/39608386337) 包含 Agent 测试通过，文档 Pages [39608386414](https://github.com/mastalee928/payincus/actions/runs/39608386414) 通过。后续旧 OTA 所有权问题及真实更新证据见上方，不将首装通过等同于旧版本 OTA 验证。

## 2026-10-21 PHP 紧急安全通告适用性核对

- 北京时间 20:22 核对 PHP 官网安全预告：计划 10 月 21 日 22:00 发布两项 CVSS v4.0 9.2 安全更新，预告尚未公开具体受影响及修复版本；当时两项转述 CVE 的公开记录查询均返回 404，不能据此断言不存在漏洞，也不能将转述的全版本影响范围当作已核实官方事实。
- 仓库运行栈为 Node.js/Vue/Go，没有 PHP 运行依赖；仅有外部支付/邮件服务的 PHP 路径调用。授权测试主控未发现 PHP 包、进程或 Nginx PHP 执行配置；两台运行客户实例只读检查均未发现 PHP CLI、PHP 软件包或 PHP 进程。未发现本次 PHP 核心漏洞的直接执行入口。
- 该核对仅覆盖仓库及已检查测试环境，不包含未检查的生产主机、全部客户自装应用及外部服务；未做补丁更新，v1.7.0 不宣传为 PHP 漏洞修复版本。

## 2026-10-21 管理员实例详情同配置跨区域更换机器（测试主控，未发版）

- 客户实例列表 → 管理 → 实例详情新增管理员「更换机器」入口，复用已有独占实例换机任务。弹窗默认同区域，可切换所有区域；展示候选地域、名称和公网 IP。管理组件按构建入口动态导入，用户 dist 不含管理 API；使用原生 dialog 管理焦点、Escape 和状态提示，防止旧区域异步响应覆盖新选择或重复轮询。
- 候选查询和事务预占共用规格条件：同机型分组、资源档及架构，CPU、内存和客户磁盘严格等于原实例。跨区域必须显式选择范围，提交再次检查空闲、最近 Agent 心跳、资源及任务占用。异地备份恢复到备份时间点，重新创建系统不自动搬迁当前磁盘数据，必须明确确认；公网 IP 将改变，原计费方案及续费关联保留。客户详情的区域展示改读当前机器区域，保留原计费关联。
- 前后端类型、相关守卫和双端构建/dist 边界通过；全套 172/172 通过（`logs/test-run-20261021-194022/summary.txt`），Lint 0 错误。隔离 `_pool_test` 集成实证通过跨区域允许、默认范围拒绝、大小规格不一致拒绝、管理员权限、并发预占、失败清理、持久隔离与账务保持；临时数据库已删除。
- 测试站更新前保存受影响文件、数据库、配置及证书，备份 `/root/incudal-host-replacement-dIVqN8`，同步 seal。授权从真实管理员客户列表进入 dfsafdsa（ID 13），默认 Frankfurt 无库存，切换所有区域显示三台同配置 San Jose 空机，确认新建系统后任务 #12 于北京时间 19:58:06 完成，从 host #3 切至 #8，状态 running、网络交付就绪。固定宿主身份的公网 SSH 验证成功；客户、名称、CPU/内存/磁盘、原密码、价格、到期、续费/计费关联及用户余额保持；原机器继续隔离，另一个现有客户实例 ID 15 保持。
- 真实客户列表和详情均显示美国西部（圣何塞）、运行中及原价格/到期；无管理换机入口。Owner 要求成功日志统一「更换机器已完成」，已修正源代码并保存旧记录后同步测试站日志 #358。最后后端构建、机器池/日志查询守卫及数据库就绪检查通过；唯一后端 `MainPID=1260453`、`NRestarts=0`、健康正常、`recoveryHeld=false`，seal 已同步。证据截图 `logs/host-replacement-verified.jpg`。源码未提交、未推送、未发版；生产 OTA 未执行。

## 2026-10-21 客户日志隐藏内部地址与重装密码登录（测试主控，未发版）

- 客户日志过去仅部分遮罩 IPv4，仍显示管理网段与 Incus 连接错误。新增 `customer-log-view.ts`，在已鉴权且按用户过滤的日志响应中隐藏内网/回环/link-local/CGNAT IPv4（含旧遮罩值）、内部 IPv6、localhost，并将低层 Incus 连接错误替换为客户可理解的失败提示。历史记录无需迁移即可隐藏，管理员审计内容和数据库原文保持。
- 重装弹窗默认「仅使用 root 密码登录」，SSH 密钥可选；没有密钥时仍可提交，选择密钥才传 `sshKeyId`。执行器移除用户首个密钥自动回退，所选密钥在停止实例/删除快照前复核归属，始终保留新密码生成及密码登录。三语同步，并修正原手动启动文案为实际自动启动。
- 前后端类型检查、后端构建、双端构建/dist 边界、前端路由/i18n、日志查询/日志本地化、实例路由/任务查询、独占交付守卫通过；全套 172 项全部通过（`logs/test-run-20261021-183527/summary.txt`）。新增守卫验证旧遮罩地址、IPv4/IPv6/连接错误隐藏、密码配置/所选密钥注入及无隐式回退。Lint 0 错误，保留既有格式告警；Impeccable 检查空列表。
- 授权测试主控部署前保存双端页面、受影响后端文件和数据库，备份 `/root/incudal-log-rebuild-wFcyjK`，完成 seal 后重启唯一后端。实际客户日志已验证不含 `10.253.240` 或 `EHOSTUNREACH`；重装弹窗无密钥时确认按钮可用，默认密码登录。样本验证不选密钥提交无 sshKeyId，选密钥传所选 ID，英文窄屏无横向溢出。
- Owner 明确授权操作测试站现有用户实例，已实际对 vdfssd（ID 15）执行密码登录重装，任务 #11（北京时间 18:56:20 提交、18:57:01 完成）`COMPLETED`、`sshKeyId=null`、错误为空；Alpine 3.21/cloud 自动启动，实例 running 且 `dedicatedNetworkReady=true`。独立公网 SSH 使用新密码与固定主机身份登录成功，确认 root UID、`AUTHORIZED_KEYS=0`、`PermitRootLogin yes`、`PasswordAuthentication yes`，cloud-init 未注入密钥；密码不输出、不记录。唯一后端 `MainPID=1253626`、`NRestarts=0`、健康正常。源码未提交、未推送、未发新版本；生产 OTA 未执行。

## 2026-10-21 已售宿主无损恢复、实时离线与客户故障状态（测试主控，未发版）

- Owner 进一步确认 fra-amd-1/fra-amd-2 对应云实例已终止，撤销此前“未停用”判断；两台无需重新连接，保留隔离。根因是宿主列表/详情及机器池直接显示历史 `hosts.status=online`，离线告警只更新 Agent 状态。新增 `host-live-status.ts`，上述三个管理员入口按 Agent 最近心跳及配置间隔派生离线状态，维护和无 Agent 的旧节点保持既有语义，不覆盖数据库记录。
- 已售宿主增加 `mode=preserve`：锁定宿主及实例记录，核对唯一既有实例、归属、运行状态、系统盘、IPv4 与 IPv6 转发和额外数据卷；任务、待清理账务、未知系统/项目、地址或状态不匹配时拒绝。通过后只设置 `poolFaulted=false`，不删除实例/磁盘/快照/网络规则，不清零资源占用，不更改用户、价格、到期时间或续费。IPv6 仅因隔离暂停且原映射已验证时，允许使用远端规则核对打破循环依赖；空映射或未知失败仍拒绝。
- 隔离 `_pool_test` 数据库执行既有恢复集成测试并补充已售场景：运行实例、网络和额外卷不匹配拒绝，IPv6 隔离循环、GET-only 远端调用、清理确认、并发及完整账务/资源保持通过。临时库已删除。平台备份/机器池/实例路由/宿主路由/分页/拆分部署等守卫及前后端类型检查、构建通过；全套 172 项检查在 `logs/test-run-20261021-162812/summary.txt` 全过，后续 IPv6 循环补充另经类型/构建/相关守卫及隔离集成验证。
- 实际后台成功恢复 sanjose-amd-2（ID 6），对比恢复前后资源占用和客户记录哈希均一致，既有用户实例保留。3 台此前恢复的 San Jose 空机不变，Frankfurt 两台保留隔离。部署前备份 `/root/incudal-occupied-status-QPDHYZ`，后续 IPv6 循环调整备份 `/root/incudal-preserve-final-AINQJ1/before-host-pool-recovery.js`。
- 客户实例列表、卡片、详情与概览新增独立 `serviceFault` 显示标记，按实时心跳显示「故障」/「Fault」，不显示“宿主离线”或内部原因；原实例 lifecycle 与账务状态保持。实时资源查询离线时返回故障标记而不冒充已确认 running，恢复正常后清除标记。故障时不显示运行中的停止/重启/实例终端操作；续费及既有记录保持。
- 授权登录实际用户 `vm-test.masta.ee` 验证 Frankfurt 实例列表和详情显示「故障」。新双端公开 HTML 与本地最终构建逐字节一致；后端备份 `/root/incudal-customer-fault-RLAd09`，最终前端旧入口 `/root/incudal-customer-final-ui-3LDWD9`。唯一后端 `MainPID=1248250`、`NRestarts=0`、`recoveryHeld=false`，seal 已同步。客户变更全套 172 项通过（`logs/test-run-20261021-172905/summary.txt`），后续概览调整另过前端类型/路由/i18n/双端构建/dist 边界；Lint 0 错误、保留既有格式告警，Impeccable 检查空列表。源码未提交、未推送、未发新版本；生产 OTA 未执行。
- 最终浏览器核验：客户概览中的 Frankfurt 实例显示「故障」且不计入运行中数量，实例卡片与详情同样显示「故障」，无“宿主离线”等内部文案；管理员机器池两台 Frankfurt 显示离线，4 台 San Jose 管理连接在线，其中 ID 6 保留实例并显示已分配，ID 7/8/9 可售。客户列表 San Jose 实例显示已停止，实际任务 #10（2026-10-21 17:38:01）为停止成功，此生命周期变化不由状态显示补丁引起。客户与后台两个源公开 HTML 已与最终本地构建逐字节比对，最终前端变化不重启后端。

## 2026-10-21 批量宿主检查恢复与管理隧道保持（测试主控，未发版）

- 机器池新增「批量检查本页隔离宿主」及勾选后的「检查并恢复所选宿主」。逐台复用原检查/恢复接口，不新增批量绕过路径；逐项显示阻断原因、失败和成功，单项失败后继续后续机器，清理遗留数据仍须确认。适配既有管理 API 的顶层错误报告，状态变化时展示最新阻断条件；查询超时调整为 65 秒，守卫验证顺序、失败隔离和清理确认。每页最多 20 台，相关限流调整为检查 30 次/分钟、恢复 20 次/分钟，鉴权不变。
- 平台恢复及回退原先无条件重启 WireGuard，导致已学习的节点端点和握手丢失。新增 `platform-backup-gateway.ts`：配置与运行状态不变时不重启；同一控制身份同步配置时只保留同一 peer 的有效数字 IP/端口，使用 `wg syncconf`。不同控制身份不继承旧端点，配置中的显式端点优先。角色、密钥、业务门禁与库存隔离不变。发行首装恢复演练增加接口 ifindex 与端点保持断言。
- 前后端类型检查、后端编译、双端构建/dist 边界、前端路由/i18n/平台备份/机器池/拆分部署守卫通过。Linux 测试机从已有备份还原到新 `_pool_test` 隔离库，使用既有宿主恢复集成测试验证鉴权、状态变化、清理确认、部分失败重试、并发及账务保持，已通过，临时库已删除。模拟浏览器验证批量失败后继续及成功保留，390px 英文深色无横向溢出。全套最终检查记录随后补齐。
- 授权测试主控部署前保存数据库、配置、网关配置、受影响后端文件及双端页面，备份 `/root/incudal-batch-recovery-3SbdU3`；最终前端入口旧副本 `/root/incudal-batch-final-ui-s7tMvF`。已补齐 seal，唯一后端 `MainPID=1235779`、`NRestarts=0`、健康接口 `recoveryHeld=false`；运行配置及网关配置与部署前逐字节一致。真实网关验证配置相同及仅注释变化时均不重建接口、不丢已知端点，并还原原文件。
- 实际浏览器批量检查 5 台隔离宿主：sanjose-amd-3（ID 8）与 sanjose-amd-4（ID 9）通过并成功解除隔离；sanjose-amd-1（ID 7）此前 Owner 已单台恢复。这 3 台空闲机器持续上报 Agent，用户 4 条、实例 15 条（2 running、13 deleted）保持。sanjose-amd-2（ID 6）管理连接和现存用户实例匹配，但既有空机恢复检查因实例占用继续阻断，不删除用户实例、不自动置空资源计数。
- fra-amd-2/fra-amd-1（ID 3/4）管理隧道仍不可达，Agent 原始心跳也已过期；Owner 明确未停用宿主，公网 22 已交给用户，暂时无法进入云控制台。当前缺可用的宿主控制通道，真实重连未完成。已提供仅重新加载原 WireGuard 配置和重启监控 Agent 的 `scripts/reconnect-host-management.sh`，不得在用户实例或独立 Cloud Shell 内执行。保持隔离，不宣称全部宿主恢复。源码未提交、未推送、未发新版本，生产 OTA 未执行。

## 2026-10-21 恢复后的保护页面修复（测试主控，未发版）

- Owner 执行 13:01:44 快照恢复后，用户页、机器池页和版本页显示为空。现场恢复任务 `0c419c96-f927-4f5b-827e-bb5e6c1322b4` 成功且 journal 为 `awaiting_review`，健康接口 `recoveryHeld=true`。根因为保护门禁将业务查询返回 `503 PLATFORM_RECOVERY_HELD`，页面把查询失败呈现为没有记录。
- 当前恢复库保留 4 个用户、6 台宿主、15 条实例记录（含历史删除记录）、2 条机器池定价、7 条接入节点和 67 条配置。126 张表按快照相同格式逐行指纹核对，差异仅为宿主 `pool_faulted` 隔离标记、会话撤销以及恢复后登录产生的审计记录；宿主去除隔离标记后的全部字段与快照一致。恢复前数据库 `incudal_before_0c419c96f9274f5b827ebb5e6c1322b4` 仍保留且禁止连接。
- Owner 明确选择保留本次恢复结果、先核对。仅前端增加全局保护提示与 OSS 核对入口，保护期间不渲染无法查询的业务页，OSS 页继续可用；后端门禁、数据库及库存隔离不变。三语文案同步，平台备份守卫补充相关业务查询拒绝与提示结构断言。
- 前后端类型检查、前端路由/i18n/平台备份守卫、双端构建与 dist 边界通过；修改文件 Lint 0 错误（AppLayout 1 条既有格式警告），Impeccable 检查空列表。浏览器验证本地正常/保护状态和核对入口，390px 英文深色宽度及 scrollWidth 均为 390。
- 授权测试主控双端页面已热更新，旧页面备份在 `/root/incudal-recovery-ui-V5d2Xs`。公开两端 index.html 与本地构建逐字节一致；真实后台已登录验证用户、机器池和版本页显示保护提示，恢复核对页仍可访问。唯一后端 `MainPID=1220587`、`NRestarts=0`，保护文件哈希与部署前一致，未重启后端。
- 实时宿主核对：ID 6/7/8/9 可用，ID 6 唯一运行实例与登记一致，ID 7/8/9 无远端实例；ID 3/4 连接报 EHOSTUNREACH，ID 3 登记 1 个运行实例尚未核对。无待执行实例任务。此项仍未完成，不应据数据库一致性解除保护或自动清除库存隔离。源码修复未提交、未推送、未发新版本；生产 OTA 未执行。
- Owner 14:08:47 确认恢复运营，任务 `2997e2f7-38b2-4556-89af-2ed18601a42a` 在启动执行器前被受信文件清单拦截，显示 `OSS_WORKER_STOPPED`；后端未重启、保护未解除。原因是本轮前端热更新漏做 seal。已逐文件确认 125 个新增资源与 2 个 index.html 改动仅属于已验证前端，无删除或后端变化；保存旧清单后执行受信 seal，保护文件哈希不变。WireGuard 配置与 SSH 管理身份均与恢复前逐字节一致。
- 沿用 Owner 的恢复运营确认，补齐清单后通过已安装 CLI 重试：任务 `ce2f3e1c-5daf-423b-a07c-c9ad60c093d4` 于北京时间 14:19:06 达到 `success/resumed`，健康接口 `recoveryHeld=false`，唯一后端 `MainPID=1229991`、`NRestarts=0`。实际后台验证用户 4 条、机器池 6 台、版本与 OTA 资产信息恢复显示；测试主控版本元数据仍为 v1.6.8，v1.6.9 仅部分热更新，未执行新的 OTA。6 台宿主的库存隔离保留；fra-amd-2/fra-amd-1 仍无法通过管理网络连接，宿主实时核对未完成，未对其节点执行变更。

## 2026-10-21 v1.6.9 发布（完整备份、额外 ZIP 与恢复指南）

- [正式发行 39539930557](https://github.com/mastalee928/payincus/actions/runs/39539930557) 的五个作业全部成功，2026-10-21 11:47:37（北京时间）发布，非 draft、非 prerelease。发行源码及标签对象与上方记录一致；amd64 作业完整执行 172 项检查，planned / executed / passed 均为 172、failed 为 0。双架构 Linux 首装及恢复演练使用本地 OSS 传输替身；真实云端证据单独记录在下方。
- 两种架构的公开发行包已下载复核：amd64 109177028 字节、SHA256 `5f8f97cb8ad928ac31ded4eb9308000f86da819cb663c809814d5d121d705016`；arm64 108318101 字节、SHA256 `780f7036271ace68fab685e686c621f9d0bcfc77fa2b4a8220f4d4f3b96d300a`。各自 `.sha256`、GitHub 资产 digest 与 OTA manifest 一致；两份 manifest 逐字节一致，记录 `gitCommit=54203107fa13`、`minimumUpdaterVersion=v0.0.3`、`buildTime=2026-10-21T03:47:25.946Z`。包内版本、212 条迁移、备份模块、双端工具/说明与发行脚本同源均通过；两种架构的双端 index.html 哈希一致，不含本地 `.env` 或 `oss-review.html`。核验记录：`logs/release-v1.6.9/verification.json`。
- 同一发行提交的 [源码 CI 39538543643](https://github.com/mastalee928/payincus/actions/runs/39538543643) 与 [文档 Pages 39538543664](https://github.com/mastalee928/payincus/actions/runs/39538543664) 均成功。公开 main 的安装器、恢复工具和说明与本地源码逐字节一致，发行包内上述脚本与 LICENSE 与发行提交逐字节一致。Agent v1.0.3 仍提供 x86_64/aarch64 两种二进制，面板 latest 仍为 v1.6.9。
- 保留原自动恢复 `payload.enc` 与完成标记，额外上传按 UTC 日期时间命名、使用同一密码的 AES-256 ZIP/ZIP64。ZIP 包含同源整库归档、可移植整库 SQL、按表排列 SQL、权限/配置/身份、快照清单、完整性报告、中文说明和交互工具。
- 备份在共享快照下核对每张表的完整记录、多重集、结构、大对象及归档序列状态；保留原归属/授权和 globals。实际临时库恢复匹配后才打包；ZIP 每项解密哈希与两份 OSS 对象回读均通过才发布 complete 标记。清理失败显示警告；中断清理覆盖额外 ZIP，且限于当前安装命名空间。
- 页面底部直接提供两种中文恢复场景和说明/工具下载；工具使用目标机已安装执行器，交互读取秘密并固定读取目标 .env。旧加密格式读取保持兼容，旧包不会补生成 ZIP。
- 本地 172 项完整检查全部通过（`logs/test-run-20261021-103403/summary.txt`），双端/后端构建和 dist 边界、安装器守卫、冻结依赖通过；Lint 0 错误（663 条既有样式警告）。后续数据库 SQL 导出调整另跑类型/平台备份守卫/后端构建。说明和工具公开副本与发行脚本同源校验通过。
- 浏览器真实点击恢复步骤、说明/工具下载通过；390px 深色样本页面宽度与 scrollWidth 均 390，无横向溢出。样本使用模拟接口；不等同于云端上传或实际恢复。机械 UI 检查返回空列表。
- 测试主控恢复工具 `status` 实际调用成功；公网下载与安装脚本副本逐字节一致（SHA256 `6116600a752ab8df540a002a25c82a1b362ddd3594ee367964753c780480d039`）。新增发行首装断言核对双端公开工具/说明与执行器脚本的副本一致。
- 授权测试主控已热更新，唯一后端健康且 NRestarts=0；更新前保存数据库、运行配置、证书及受影响文件。真实 Linux 隔离演练已通过逐表 SQL、整库 SQL 与原生归档恢复一致性，以及金额、数组下标、序列、大对象、缺表、外部表拒绝等检查。真实 OSS 已验证：备份 e0b7ab24-8998-4814-899a-902f134e5d33，ZIP `payincus-backup-20261021-031730-UTC.zip`（北京时间 11:17:30）1,845,157 字节；相同密码解密全部文件、126 表/1,318 行/118 序列、整库 SQL 与原生归档实际恢复一致，原 payload.enc 预检成功。预检任务 1a91e48a-009d-4f3a-a0f0-83c11037a4a2，配置 revision 与恢复保护保持不变。[双架构预览 39538838380](https://github.com/mastalee928/payincus/actions/runs/39538838380) 和 [正式发行 39539930557](https://github.com/mastalee928/payincus/actions/runs/39539930557) 均通过，包含 212 条迁移、唯一后端、双端登录、备份/预检/恢复/回退/恢复运营、密钥一致性与全库 SQL/原生恢复核对。生产 OTA 未执行。

## 2026-10-20 OSS 设置修复（测试主控热更新，未发版）

- 修复连接区缺少保存/测试入口：仅填写 AccessKey 即可保存或测试列桶权限；选择桶、保存备份密码并通过桶读写测试后才可启用自动备份或立即备份。保存失败显示准确原因并保留表单，三语文案同步。
- 测试主控为旧平铺部署，原先缺少 `/var/lib/incudal-backup` 与备份服务，导致保存失败被错误归类为 `OSS_OPERATION_FAILED`。热更新补齐目录、受限调用和服务；安装/更新/启动检查接入同一安装脚本。真机首次启动检查暴露 `systemctl daemon-reload` 被后端 PATH 中的受限 wrapper 拦截，已改为 `/usr/bin/systemctl daemon-reload` 并补回归守卫。
- 真机复现 OSS V4 根目录浏览签名错误：同一凭据可列桶、读桶区域，带空 `prefix=` 的对象列表失败；省略空参数及非空目录均成功。修复仅省略根目录空参数，继续使用 V4。回归守卫执行已安装 SDK 的真实签名流程，仅替换 HTTP 边界，覆盖根目录、非空目录与分页游标。
- 本地证据：前后端类型检查、7 项相关守卫（部署/前端路由/i18n/系统更新/平台备份及类型检查）、安装器守卫、双端生产构建和 dist 边界守卫通过。签名修复后重新通过后端类型检查、构建和平台备份守卫。首轮守卫记录：`logs/test-run-20261020-222707/summary.txt`。
- 测试主控最终唯一后端 `MainPID=1094590`，健康检查成功、恢复保护关闭，组件及目录权限正常；两端首页与各 9 个关联资源经公网逐字节比对一致，安装脚本与最终 OSS 后端构建哈希也与本地一致。真实管理员 API 的列桶与根目录对象列表均返回 200，未鉴权返回 401；验证保留已有配置。实际浏览器点击目标桶后成功显示根目录的三个目录，无错误提示，凭据字段移出视口后的截图保存在 `logs/oss-hotfix-ociee-verified.png`。另核到测试机 22:54:05 发起的真实备份任务在 22:54:17 达到 `success/complete`；恢复覆盖演练未执行。
- 热更新前备份分别保存在测试主控 `/root/incudal-oss-hotfix-20261020-2236-r2` 和 `/root/incudal-oss-signature-20261020`。本轮仅更新测试主控与本地源码，正式 v1.6.8 标签、Release 安装包和生产部署证据未改变。

## 2026-10-20 v1.6.8 发布（阿里云 OSS 平台备份与恢复）

- 新增管理员「系统 → 阿里云OSS」入口：区域/桶/目录、1/3/5 份保留、1/3/6/12/24/72 小时定时加密备份、预检恢复、保护模式及本地回退。
- 人工代码审视修复 SDK 完成回调空 checkpoint、网关 `.pub` 文件和应用密钥权限、授权文件回退、主密钥一致性、恢复保护登录与发行包安装脚本遗漏。
- 本地验证：172 项全量检查全部通过，双端和后端构建、dist 边界、Bash 安装守卫通过，Lint 0 错误；桌面/窄屏浅深色页面和恢复确认已检查。
- 新增 `scripts/smoke-platform-backup.mjs`，双架构首装 CI 已在一次性 Linux VM 上通过真实 PostgreSQL/systemd 的备份、预检、恢复、回退、恢复登录和跨主密钥一致性检查；仅 OSS 传输以本地文件替代。两边均应用 212 条迁移，确认唯一后端、双端访问、受限管理网关以及配套 Agent v1.0.3 下载和运行。
- 云端 OSS 权限、实际上传与云端异常清理尚待专用测试桶验收；平台备份不包含 VPS 磁盘，换 IP 的 WireGuard 自动重连仍待后续专项。
- [预览运行 39384509063](https://github.com/mastalee928/payincus/actions/runs/39384509063) 成功：双架构构建与首装/恢复验证成功，发布作业按预览设计 skipped。源码 [CI 39384508902](https://github.com/mastalee928/payincus/actions/runs/39384508902) 和文档 Pages [39384508903](https://github.com/mastalee928/payincus/actions/runs/39384508903) 成功。
- [正式发布 39386136385](https://github.com/mastalee928/payincus/actions/runs/39386136385) 的五个作业全部 success：arm64 构建、amd64 构建、两种架构首装/恢复验证、发布 Release。Release 于北京时间 2026-10-20 15:30:53 发布，非 draft、非 prerelease；公开 release notes 已补齐使用和验收边界。
- 两份公开安装包已实际下载复核：amd64 106775535 字节，sha256 `74d97518d0807e3712b803fe6fc5e75436694df8808977f9174f1ca25cdd6f33`；arm64 105928055 字节，sha256 `827311f5721827518de9e548f918a15b756045fcd47c5cbe083d679840b8ff09`。校验文件、版本化及通用 OTA manifest 一致，manifest 和包内元数据均指向 `v1.6.8` / `44d26132f02f`。
- 包内备份 worker/CLI/服务/安装脚本、完整迁移、双端入口与 LICENSE 已确认；双架构前端入口 HTML 哈希一致。未包含 `.env` 或本地 UI 样本。安装包及本地复核记录保存在 Git 忽略的 `logs/release-v1.6.8/`。
- 操作要求已公开到 `docs-site/docs/deployment/oss-backup.md`。本次只发布 GitHub 源码/标签/Release，没有执行生产 OTA。后续台账/版本日志文档提交不改变发行标签及安装包内容。

## 2026-10-18 v1.6.7 发布（机器池面板改版、区域三语化与客户实例打磨）

- 发行源码 `fa716ee699e4ff77400b21bd093968c8be5f0dbc`（`ec7c329` 仪表盘负载条修复、`f006276`/`e74c81a` 机器池面板改版、`0563db7` 选购区域卡片瘦身、`d7b609c` 区域三语与 OCI 机型名、`6a96e1e` 重置密码与精简销毁弹窗、`58e9e9b` 实例面打磨、`f141fa8` 钱包推荐计划隐藏与余额流水文案迁移、`fa716ee` 版本准备）；注解标签 `v1.6.7`（对象 `da4fdd3d1087d8cc59a8b0c4fcedba637ae95a6a`）。[正式发布运行](https://github.com/mastalee928/payincus/actions/runs/39141400802) 运行级结论 success，五个作业全部成功：构建 arm64 2m32s、构建 amd64 5m36s、全新安装验证 arm64 1m23s、全新安装验证 amd64 1m25s、发布 Release 19s（15:38:34Z→15:46:01Z；publishedAt 2026-10-18T15:45:58Z，非 draft、非 prerelease；GitHub 面板 latest 为 v1.6.7）。
- [预览运行](https://github.com/mastalee928/payincus/actions/runs/39140719213)（7m42s）：两个构建作业成功（arm64 2m35s、amd64 5m54s），双架构全新安装验证均成功（arm64 1m39s、amd64 1m34s），`发布 Release` 按预览设计 skipped。
- 公开资产：`incudal-v1.6.7-linux-amd64.tar.gz` 104572352 字节 sha256 `b85ac4b269a59b6c3580bdc55201102a4fe386ee27bba6e899304332959d61dd`；`incudal-v1.6.7-linux-arm64.tar.gz` 103739504 字节 sha256 `5073b7b6f5fe0102c55db3c808ce1d6036daab993daebb70e6920e4e35c55654`；两份 `.sha256` 已重新下载复核通过；`incudal-v1.6.7-ota-manifest.json` 与通用 `ota-manifest.json` 内容一致，记录 `gitCommit=fa716ee699e4`、`minimumUpdaterVersion=v0.0.3`；发行包内 user/admin `index.html` 与本地构建逐字节一致（双架构相同）。
- 同一提交的源码 CI（[39140374936](https://github.com/mastalee928/payincus/actions/runs/39140374936)、[39140704865](https://github.com/mastalee928/payincus/actions/runs/39140704865)）与文档站 Pages 部署（[39140704831](https://github.com/mastalee928/payincus/actions/runs/39140704831)）成功。
- 本地验证：`node scripts/run-tests.mjs` 全部通过（planned / executed / passed 171、failed 0、5m46s）；前后端类型检查、双端生产构建与 dist 边界守卫、Lint（0 错误）通过。
- 本次发布内容：
  - 管理端机器池面板改版（行操作菜单、地区筛选 chips、紧凑行展示公网 IPv4 与 OCI 账号）；选购页区域卡片去掉库存状态行。
  - 45 个区域名称英/繁三语化，选购、首页、结算与实例页面随界面语言显示；客户实例页面显示 OCI 机型名（`VM.Standard.E2.1.Micro` / `VM.Standard.A1.Flex`）。
  - 实例详情「重置密码」替换升级入口（宿主机侧 chpasswd 写入并加密保存）；资源占用面板移除配置编辑入口。
  - 销毁弹窗隐藏内部节点名、删除退款与规则区块、显示 OCI 机型名、顶部警示无退款且不可恢复（三语）。
  - 实例卡去「网络」「流量」行；概览「我的实例」IP 前显示国旗与本地化区域名；IPv6 复制按钮贴地址。
  - 钱包「推荐计划」Tab 隐藏（入口、切换、渲染三层拦截，代码保留待启用）；余额明细内部用语「一机一卖」改为「购买实例」，存量记录经迁移 `202610180003_pool_remark_wording` 统一改写。
  - 订单详情抽屉 Teleport 到 body，修复头部被控制台顶栏遮挡。
- 测试主控上机：发布前第六轮全量热替换（ps48，备份 `/root/incudal-handswap-2026-10-18-round6`）载入 `f141fa8` 构建，双端 `index.html` 与本地构建及发行包逐字节一致；迁移应用后存量「一机一卖」文案 0 条、新文案 14 条；健康检查 200、路由探测与标记抽查全中、seal 23:30。面板 OTA 正式升级至 v1.6.7 待 owner 执行。

## 2026-10-18 v1.6.6 发布（用户 Telegram 通知、管理端分类告警机器人与管理员建号）

- 发行源码 `9f1a14a799a9600a4aa6a3c84f9cffa7d68ad087`（含 `1b109d3` 的用户 Telegram 通知与逐用户聚合、`2e4b71b`/`d4b8621` 管理端分类告警机器人、`7a43fa8` 管理员建号、`ea3fe38` 仪表盘机型展示）；注解标签 `v1.6.6`（对象 `55bdb1dcfba1197b42a050ad8bf130afccaf6410`）。[正式发布运行](https://github.com/mastalee928/payincus/actions/runs/39109797096) 运行级结论 success，五个作业全部成功：构建 arm64 2m33s、构建 amd64 3m49s、全新安装验证 amd64 1m24s、全新安装验证 arm64 1m29s、发布 Release 24s（publishedAt 2026-10-18T08:06:29Z，非 draft、非 prerelease）。
- [预览运行](https://github.com/mastalee928/payincus/actions/runs/39109288989)（7m08s）：两个构建作业成功（arm64 2m33s、amd64 5m34s），双架构全新安装验证均成功（arm64 1m25s、amd64 1m30s），`发布 Release` 按预览设计 skipped。
- 公开资产：`incudal-v1.6.6-linux-amd64.tar.gz` 104591129 字节 sha256 `4cef381fe6510021d417590bb06acf3d3dc07970b0a5919cae33df478bf5d08c`；`incudal-v1.6.6-linux-arm64.tar.gz` 103721559 字节 sha256 `5fda24182f54e933579e7b37e1a1605a30a098d8cbe9f19d94d0806d03e5bd9c`；两份 `.sha256` 与 `incudal-v1.6.6-ota-manifest.json`（另含通用 `ota-manifest.json`，两者内容一致），manifest 记录 `gitCommit=9f1a14a799a9`、`minimumUpdaterVersion=v0.0.3`、`buildTime=2026-10-18T08:06:19.402Z`；两种架构发行包已重新下载并逐字节复核体积与 sha256 一致。
- 同一提交的源码 CI（[39109288202](https://github.com/mastalee928/payincus/actions/runs/39109288202)，Lint & Type Check 1m26s + Build 2m30s）与文档站 Pages 部署（[39109288025](https://github.com/mastalee928/payincus/actions/runs/39109288025)，build 26s + deploy 8s）均成功。
- 本地验证：9f1a14a 上 `node scripts/run-tests.mjs` 全部通过（planned / executed / passed 171、failed 0、5m40s）；前后端类型检查、双端生产构建与 dist 边界守卫、Lint（0 错误、无新增告警）通过。守卫清单 169→171：新增 `test:user-telegram-notify-guards` 与 `test:admin-alert-bots-guards`。
- 9f1a14a 同时包含版本位（三个 `package.json`）、`README.md`、`AGENTS.md` 更新至 v1.6.6 与新增 `docs-site/release-notes/v1.6.6.md`；文档站版本日志按 v1.6.6 重新生成并随本次台账提交。
- 本次发布内容：
  - 用户 Telegram 通知（官方站点 Bot）：绑定后默认开启，覆盖开通成功/失败/超时、手动与自动续费、自动续费失败、充值到账、充值支付失败、临期提醒（T-3/T-2/T-1）与已到期；个人设置提供开关与最近一次推送失败提示，Bot 内支持 `/notify on|off`。
  - 定时通知按「每用户每轮任务一条」聚合防轰炸：临期、已到期与自动续费结果合并发送，站内信 / Telegram / 邮件同档；单台实例文案不变，多台合并为清单（最多 15 台）。
  - 管理端四类分类告警 Bot（工单 / 宿主机 / 财务 / 实例）可在设置页分别配置；工单推送含主题、内容、分类、优先级与附件数量。
  - 管理员可在用户管理页直接建号（复用注册校验、16 位初始密码、审计记录）；仪表盘实例卡片展示机型规格替代 LXC/KVM 标签。
- 测试主控（`51.170.43.169`，旧布局）由 owner 通过面板 OTA 升级至 v1.6.6 并回报成功；本次会话未持有 SSH 通道，主机侧明细（任务号、MainPID、version.json）未采集，以线上产物核验替代：用户端 `vm-test.masta.ee` 的 `index.html`（sha256 `c9877af6ea9e3b85c63152845b7c121e56c3d1de95fd37c85fcf1b0a486d2a0f`）与管理端 `vm-admin.masta.ee` 的 `index.html`（sha256 `5a1776c66ca407207c2c4c46536a9a39779365b63311895e70db7fe3c72ebcd5`）均与发行包内同名文件逐字节一致、资产清单一致（另抽查懒加载资源 8 个文件 sha256 与发行包一致）；v1.6.6 新增路由 `PUT /api/telegram/notification` 未鉴权返回 401（对照既有路由同为 401，路由确已注册；旧版为 404）；`/api/health` 200。
- 发布后源码修复（未发版）：仪表盘「最近实例」卡片底部的负载条把 CPU 配额（如 100%）当作实时占用渲染（配额 >85 恒红，源自 Nimbus 仪表盘改版 `05e94d3`），owner 于升级后报告“总是以为是服务器炸了”；列表接口不含实时占用数据，经 owner 选择直接移除该负载条（提交 `ec7c329`），仅动前端模板与样式、无业务逻辑变化；已过前端路由守卫、前后端类型检查与双端生产构建，随下一次发布进入安装包。
- 已知既有缺陷（同 v1.6.5 记录，本次未涉及）：根 `verify:final-acceptance` 的 POSIX 前缀写法（设计在 Linux 侧执行）；测试主控上的历史 failed 更新单元 `incudal-online-update@1/4/5`。

## 2026-10-18 v1.6.5 发布（Windows 工具链与 Agent 版本清单取数健壮性）

- 发行源码 `3fb8a0eb9dd95088addf221e538a9eeac4e687f3`（含 `67efd41` 的 Agent 403 修复与 `cea16a6` 的 Windows 工具链落地）；注解标签 `v1.6.5`（对象 `26a2651773e813b7292506c9a7fd776b4672bb16`）。[正式发布运行](https://github.com/mastalee928/payincus/actions/runs/39088069681) 运行级结论 success；已取得用时的作业：amd64 构建 3m28s、双架构全新安装验证各 1m30s、发布 Release 25s（publishedAt 2026-10-18T01:58:25Z，非 draft、非 prerelease）。arm64 构建作业在 GitHub 作业接口里结论字段缺失（status 仍为 in_progress、completedAt 为空），属接口数据不一致；该架构的发行包与全新安装验证均已成功产出并通过。
- [预览运行](https://github.com/mastalee928/payincus/actions/runs/39087584812)（7m25s）：两个构建作业成功（arm64 2m42s、amd64 5m52s），双架构全新安装验证均成功（arm64 1m24s、amd64 1m20s，amd64 本次首轮即过；此前 v1.6.3 与 v1.6.4 预览各因新装面板匿名抓取 GitHub 限流失败一次），`发布 Release` 按预览设计 skipped。
- 公开资产：`incudal-v1.6.5-linux-amd64.tar.gz` 104530875 字节 sha256 `8b3676b9dcf4e041cb7f24dcb83a3eb4a504393b5be357a5fa787da104889399`；`incudal-v1.6.5-linux-arm64.tar.gz` 103700049 字节 sha256 `d9273ecf88ee3d4670b4fcf2df528ec7274f731e03cb0be56d30a13941fa4633`；两份 `.sha256` 与 `incudal-v1.6.5-ota-manifest.json`（另含通用 `ota-manifest.json`），manifest 记录 `gitCommit=3fb8a0eb9dd9`、`minimumUpdaterVersion=v0.0.3`。
- 同一提交的源码 CI（[39087584675](https://github.com/mastalee928/payincus/actions/runs/39087584675)，Lint & Type Check 1m45s + Build 2m32s）与文档站 Pages 部署（[39087584738](https://github.com/mastalee928/payincus/actions/runs/39087584738)，42s）均成功。
- 本地验证：main 上 `node scripts/run-tests.mjs` 全部通过（planned / executed / passed 169、failed 0、5m44s）；前后端类型检查、双端生产构建与 dist 边界守卫、`pnpm --dir docs-site --ignore-workspace check:deployment`、`bash scripts/test-install-panel-guards.sh`、`node scripts/run-tests.mjs --check` 与 `pnpm install --frozen-lockfile` 均通过。根 `pnpm test` 现为 `node scripts/run-tests.mjs` + 根 `package.json` 的 169 条 `testGuards` 清单（逐条 spawn；旧版「`&&` 串成超长脚本」在 Windows 上会被 shell 静默截断却退出 0，是本次修复的假绿来源）。
- 本次发布内容：
  - Agent 版本清单取数健壮性：`server/src/routes/agent.ts` 的 GitHub 请求改为有界重试（仅重试 403 rate limit / 429 / 5xx 与网络错误，遵守 Retry-After，其它 4xx 立即失败），连续失败且已有缓存时继续提供旧清单并提示配置 `INCUDAL_AGENT_RELEASE_TOKEN`；`.github/workflows/release.yml` 的全新安装验证注入 `github.token`（本次 amd64 作业日志显示该变量已传入且全程无 403 行），`scripts/install-panel.sh` 与 `scripts/init-env.sh` 把环境中的该变量写入 `.env`。
  - Windows 工具链：根 `test` 改为 `node scripts/run-tests.mjs`（执行前校验每个条目的脚本真实存在，任一失败即以守卫名 + 尾部输出 + 日志路径非零退出）；`.gitattributes` 把源码/文本类扩展名钉为 `text eol=lf`（`*.bat`/`*.cmd`/`*.ps1` 保持 CRLF），逐字节断言的守卫跨平台一致；前端 `dev`/`build` 脚本与根 `dev`/`dev:split`/`dev:user`/`dev:admin` 改用 `cross-env`，根 `devDependencies` 与锁文件根 importer 同步加入 `cross-env@10.1.0`。
  - 发行包纳入 `scripts/run-tests.mjs`：装机目录的 `pnpm test` 不再报模块缺失，而是明确提示缺少工作区 `package.json` 并返回非零退出码（装机形态实测退出 1，无假绿）；守卫套件仍只在源码仓库中运行。
  - 版本位（三个 `package.json`）、`README.md`、`AGENTS.md` 更新至 v1.6.5；新增 `docs-site/release-notes/v1.6.5.md`；文档站版本日志按 v1.6.5 重新生成（两条 version-log 共 +59/−15）并随台账提交。
- 测试主控（`51.170.43.169`，旧布局）经面板 OTA 任务 `7` 由 v1.6.4 升至 v1.6.5：任务 startedAt 2026-10-18T02:00:19.929Z、finishedAt 2026-10-18T02:02:16.427Z（约 1 分 56 秒）；单元 `incudal-online-update@7` 最终 Result=success、ExecMainStatus=0，日志结尾 `System update completed successfully`，并清理了 OTA 下载缓存；升级前整目录备份 `/opt/incudal.bak.20261018020019`。升级后唯一后端实例（`incudal-backend`，MainPID 716294、active/running）、`/api/health` 200、`version.json` 为 `v1.6.5`。
- 真机核验（升级后主站，v1.6.5 在线）：`/api/agent/manifest.json` 返回 200（377 字节，`version=v1.0.3`，含 `linux-amd64` 与 `linux-arm64` 的 sha256 与 size）——本次唯一行为改动路径在线上可用；`/api/health` 返回 `{"status":"ok"}`；面板 OTA 期间自身完成 `verify-split-host` 静态资源与反向代理校验（任务 #7 日志）。
- 另按 owner 授权清理测试主控上 v1.6.3/v1.6.4 期的三个旧备份目录（`/opt/incudal.bak.20261017131225` 2.2G、`.20261017144338` 1.1G、`.20261017172752` 1.1G，合计约 4.4G）：删除前 `df /` 为 196G 中已用 13G（7%）、可用 173G，删除后已用 8.8G（5%）、可用 177G，仅保留本次升级的备份 `/opt/incudal.bak.20261018020019`（1.1G）。
- 工作区清理：四个 `claude/*` worktree 分支（`affectionate-dijkstra-5f9a57`、`gifted-roentgen-494ceb`、`goofy-blackwell-c32240`、`zen-dewdney-bc1653`）确认已全部并入 main 后注销并删除分支；其未提交改动（`.gitattributes`、`AGENTS.md`、`client/package.json`、`package.json`、`pnpm-lock.yaml`、`scripts/run-tests.mjs`）逐字节核对后并入 `cea16a6`，其中 `affectionate` 额外的根 `cross-env` 改动并入 `3fb8a0e`。四个 worktree 目录本体（内容已清空为 0 项）当时被应用进程占用而无法从命令行删除；随后归档拥有它们的四个空闲应用会话，句柄释放，四个空目录已删除（`.claude/worktrees` 只剩空目录）：`affectionate-dijkstra-5f9a57`、`gifted-roentgen-494ceb`、`goofy-blackwell-c32240`、`zen-dewdney-bc1653`。
- 已知既有缺陷（本次未改，均与本次改动无关）：
  - 根 `package.json` 的 `verify:final-acceptance` 仍使用 POSIX 环境变量前缀写法（该脚本设计在 Linux 侧执行，本次未改）。
  - 测试主控上存在 `incudal-online-update@1/4/5` 三个历史 failed 单元（v1.6.2/v1.6.3 期遗留的失败记录，不影响新任务启动）。

## 2026-10-18 v1.6.4 发布（结算可选在线支付渠道、用户导航调整与回调防伪断言）

- 发行源码 `41d87820504977ffb24f895ab6c735a67f17fdaa`；注解标签 `v1.6.4`（对象 `8d39a04ea5d084378664e24ff0c0326758c2d744`）。[正式发布运行](https://github.com/mastalee928/payincus/actions/runs/39053295718) 五个作业全部成功：amd64 / arm64 构建、双架构全新安装验证与发布 Release（`publishedAt 2026-10-17T17:26:38Z`，非 draft、非 prerelease）。
- [预览运行](https://github.com/mastalee928/payincus/actions/runs/39052508600)：两个构建作业成功；`全新安装验证 (arm64)` 首轮通过，`全新安装验证 (amd64)` 首次因新装面板抓取 Agent release 命中 GitHub 403 限流失败（`fetchJsonFromGitHub`，`server/dist/routes/agent.js:404`），`gh run rerun --failed` 重跑后通过，整体结论成功。
- 公开资产：`incudal-v1.6.4-linux-amd64.tar.gz` 104538519 字节 sha256 `5594bdfdc561d315c81f4893cf7ae536f993178f920cd38c3769009d84f310e0`；`incudal-v1.6.4-linux-arm64.tar.gz` 103683820 字节 sha256 `48d5ecc531588ec3deabe517660037283fa5408b39faa34c0d6b344742a6e695`；两份 `.sha256` 与 `incudal-v1.6.4-ota-manifest.json`（另含通用 `ota-manifest.json`），manifest 记录 `gitCommit=41d878205049`、`minimumUpdaterVersion=v0.0.3`。
- 同一提交的源码 CI（[39052465293](https://github.com/mastalee928/payincus/actions/runs/39052465293)，Lint & Type Check + Build）与文档站 Pages 部署（[39052465326](https://github.com/mastalee928/payincus/actions/runs/39052465326)）均成功。
- 本地验证：前后端类型检查、client ESLint（0 error，保留既有样式警告；改动的 CheckoutView 无新增告警、DashboardView 唯一 1 条为 HEAD 既有）、双端生产构建与 dist 边界守卫、文档站构建与 `check:deployment` 全部通过。全套 167 条守卫逐条核验：首次整串（`npm_config_script_shell=bash pnpm test`）在 `user-destroy-incus-order` 之后被 Windows 侧命令串截断（`None of the selected packages has a "test:ins" script`）却仍返回 0；比对根脚本命令清单后补跑缺失的 20 条（`instance-delete-incus-order` 至 `host-public-ipv6`），全部通过，覆盖完整。CI 侧同一守卫步骤在 Linux amd64 上亦为 success。
- 本次发布内容：
  - 购物车结算（含选购页「加入并结算」）可选支付方式：账户余额，或后台已启用的任一在线支付渠道。选网关渠道时按整单金额创建充值单，服务端 `calculateRechargeAmountForCredit` 把手续费补足（易支付手续费外加、其它渠道内扣向上取整，并用 `calculateActualAmount` 逐分校验），保证实际到账不少于订单金额；到账后仍由余额完成整单扣款与开通，购买订单没有新增支付状态。
  - 支付回调防伪断言进入 `test-recharge-accounting-guards`：回调处理函数内必须存在来源 IP 白名单、逐渠道验签（易支付 `verifyWithStatus`、Heleket、UPAY Pro、Antom、通用 `verifyCallbackSignature`）、渠道一致性、仅当前支付尝试有效与去重，且 IP 与签名检查次序必须在 `db.completeRecharge` 之前；结算页只认服务端 `completed`，前端不参与入账。
  - 用户端导航：「购买主机」改为「创建实例」，「实例」改为「我的实例」（新增 `nav.myInstances`，不动共享的 `nav.instances`）；用户端「概览」页创建实例入口直达 `/purchase`；公共站入口与选购页标题同步。
  - 移除用户端「福利」导航与 `/entertainment` 路由（页面代码与 `entertainmentPath()` 保留，便于重新启用）；管理端娱乐页不受影响。
  - 版本位（三个 `package.json`）、`AGENTS.md`、`README.md` 更新至 v1.6.4；新增 `docs-site/release-notes/v1.6.4.md`；文档站版本日志按 v1.6.4 重新生成。
- 测试主控（`51.170.43.169`，旧布局）经面板 OTA 任务 `#6` 由 v1.6.3 升至 v1.6.4：`startedAt 2026-10-17 17:27:51.971`、`finishedAt 17:29:48.126`，日志结尾 `System update completed successfully`；更新前整目录备份 `/opt/incudal.bak.20261017172752`。升级后唯一后端实例（MainPID 501859、`NRestarts=0`、active/running）、`/api/health` 200、`version.json` 为 `v1.6.4`（`gitCommit=41d878205049`，`deployedAt 2026-10-17T17:28:54.367Z`）。
- 真机产物核验（vm-test.masta.ee 线上 v1.6.4 用户端产物）：含「创建实例」「我的实例」与结算网关文案（前往支付 / 等待支付到账 / 打开支付页面）；路由标记 `name:"entertainment"` 已不存在；`/entertainment` 字面量仅存于 API 客户端 chunk（既有端点字符串）。管理端产物 `/admin/entertainment` 完好，未被误伤。
- 已知既有缺陷（本次未改，均与本次改动无关）：
  - Windows 下 `pnpm build` 因 `VITE_APP_ENTRY=user vue-tsc` 这类 POSIX 写法在 cmd 中失败（本次仍以等价命令构建）。
  - 全新安装验证中面板未鉴权抓取 GitHub Agent release 的 403 限流健壮性缺口（v1.6.3 预览与本次预览各复现一次，重跑即过）。
  - Windows 侧根 `pnpm test` 超长命令串截断且退出码误导（本次以比对清单 + 补跑方式绕过）。

## 2026-10-17 v1.6.3 发布（在线更新的失败可见性与阻塞修复）

- 发行源码 `f8d2ca450e01a10a54ae5f57b75e4f80821371dd`；注解标签 `v1.6.3`（对象 `5d7b3e170a6de887256c5ccc2ba32e8e8d7bb58f`）。[正式发布运行](https://github.com/mastalee928/payincus/actions/runs/39041293327) 五个作业全部成功：amd64 / arm64 构建、双架构全新安装验证与发布 Release。
- [预览运行](https://github.com/mastalee928/payincus/actions/runs/39040445406) 首次的 `全新安装验证 (amd64)` 因新装面板抓取 Agent release 命中 GitHub 403 限流而失败（`fetchJsonFromGitHub`，`server/dist/routes/agent.js`），重跑该作业后通过、整体结论为成功；该健壮性缺口已单独记录待修，本次未改动相关代码。
- 公开资产：`incudal-v1.6.3-linux-amd64.tar.gz` 104550174 字节 sha256 `5984472d6c9937e2ebddf9d82c752676fdcc358abaebafa64097c6cff60a4ecc`；`incudal-v1.6.3-linux-arm64.tar.gz` 103705434 字节 sha256 `6ea07ce7de0e90ded81c9c5da9ca0d588c22692b25939235f553a9adda02833f`；两份 `.sha256` 与 `incudal-v1.6.3-ota-manifest.json`（另含通用 `ota-manifest.json`），manifest 记录 `gitCommit=f8d2ca450e01`、`minimumUpdaterVersion=v0.0.3`。
- 同一提交的源码 CI（[39040332118](https://github.com/mastalee928/payincus/actions/runs/39040332118)，Lint & Type Check + Build）与文档站 Pages 部署（[39040332125](https://github.com/mastalee928/payincus/actions/runs/39040332125)）均成功；本地双端类型检查、ESLint（0 error）、全套 169 项守卫（CI 同款占位 `DATABASE_URL`）、双端构建与 dist 边界、文档站构建、`pnpm install --frozen-lockfile` 全部通过。
- 测试主控（`51.170.43.169`，旧布局）经面板 OTA 任务 `#3` 由 v1.6.2 升至 v1.6.3：`startedAt 14:43:38Z`、`finishedAt 14:45:35Z`，日志结尾 `System update completed successfully`；更新前整目录备份 `/opt/incudal.bak.20261017144338`（内含 `db-pre-migrate-v1.6.3-*.sql`）。升级后唯一后端 active、`NRestarts=0`、`/api/health` 正常，`version.json` 为 v1.6.3（`gitCommit=f8d2ca450e01`）。
- 真机验证新行为（临时移走 root helper 以模拟“unit 已启动但 worker 未运行”，此状态下不可能真正安装；验证后 helper 复原、清单重新封存）：
  - 任务 `#4` 未在 24 秒内被认领，被**立即标记为失败**，原因是“更新任务未在 24 秒内启动（unit failed/failed，Result=exit-code，ExecMainStatus=203）…排查命令：journalctl -u 'incudal-online-update@4.service'”；同 unit 的 journal 显示 `Unable to locate executable '/usr/local/libexec/incudal/incudal-online-task'` 与 `status=203/EXEC`，与面板显示的原因一致。
  - 任务 `#5` 在 pending 窗口内经面板取消，HTTP 200 并变为失败（“已由管理员取消：任务从未启动”）；30 秒后未被仍在等待的服务端覆盖，无 pending 残留。
  - 复核状态：helper 属主与权限不变、无残留文件，可信清单 `FILES_MATCH` + `LINKS_MATCH`，任务表仅 2 success / 3 failed，无 pending。
- 同时修正长期过时的版本号：`AGENTS.md`（v1.3.7）与 `README.md`（v1.6.2）更新为 v1.6.3；中英文 OTA 指南与中英文后台总览补齐“未启动任务会自动释放/可取消、失败原因与 journalctl 排查命令”。文档站版本日志已按 v1.6.3 重新生成。
- 已知既有缺陷（本次未改）：Windows 下 `pnpm build` 会因 `client/package.json` 中 `VITE_APP_ENTRY=user vue-tsc` 这类 POSIX 写法在 cmd 中失败，本次构建改用等价命令完成。

## 2026-10-16 实例高级配置仅限管理员（发布后源码与测试部署）

- 源码提交 `b9c1e73211a642d0c90f1de6e187ec4b906f965e` 已推送 main；[源码 CI](https://github.com/mastalee928/payincus/actions/runs/38911749969) 的类型、Lint、Agent 测试及构建均通过。本轮没有新 Release 或 OTA，现有正式安装包不包含本节改动。
- `InstanceDetailView.vue` 从用户端移除整个“配置”页签，以入口条件隔离组件加载及渲染；管理员端保留。用户端生产产物不再包含进程上限提升的界面组件，直接指定配置页签也不能显示它。
- `server/src/routes/instances.ts` 对配置读取、进程上限提升、SWAP 开关及原已禁用的高级配置写入统一使用管理员认证。`batch-config.ts` 同时限制高级配置及 SWAP 字段，非管理员宿主机所有者不能通过批量接口绕过；不调整实例现有资源值。
- 新增不连接数据库或宿主机的真实路由回归，覆盖未登录、实例所有者、其他用户、非管理员宿主机所有者、HEAD/直接请求、伪装请求字段、批量修改的全部受限字段，以及管理员读取和原有参数校验。新增检查已加入根测试流程。Client/Server 类型检查、前端路由、实例路由、管理员权限、鉴权会话、操作冲突、批量配置、i18n、双端构建与产物边界守卫通过。
- 已更新 owner 授权测试主控的两个后端路由模块及用户端静态文件；部署前备份数据库、程序与运行配置，保留旧静态资源，更新前后均执行未跳过数据库的生产就绪检查。后端恢复为唯一进程，公网入口哈希与构建一致，程序校验清单已重新封存。
- 真机验收：普通用户保留旧页面并点击“提高上限”，实际请求 HTTP 403；操作前后进程及 SWAP 配置相同。刷新后不再显示配置入口，附加 `tab=config` 查询和片段仍只能访问普通详情；管理员仍能打开配置页并读取原有值。截图、HTTP 状态、资源快照与部署收据保存在维护者内部验收目录。

## 2026-10-16 购物车布局精修（发布后源码与测试部署）

- 单价、开通费及小计集中展示；登录方式独立于商品清单下方；桌面结算栏集中显示费用、总额与付款入口。窄屏按清单、登录方式、结算顺序排列，极窄屏登录选项纵向展示。
- 仅调整 CheckoutView 的模板、样式及三语界面文案。除图标导入外，结算业务脚本与改动前完全一致；后端、库存、计价、下单、鉴权与实例交付没有改动。
- Client 类型检查、修改文件 ESLint、前端路由、机器池、i18n keys、三语消息编译、双端生产构建及 dist 边界均通过。隔离数据验证数量和金额联动、移除、名称错误、缺货、涨价确认和无密钥状态；桌面、手机、英文深色窄屏验收通过。
- 已更新 owner 授权测试站的用户端静态文件，保留旧资源和备份、最后原子替换入口。真实普通用户页面验证完成，公网入口与构建一致；后端保持原有唯一进程。测试购物车恢复为空，未创建订单或扣费；本轮没有面板 OTA 或新 Release。
- 详细范围与证据见 [购物车布局精修验收](docs/checkout-ui-refinement-20261016.md)。构建日志、截图、源码补丁和部署收据保存在维护者内部验收目录。

## 2026-10-16 v1.6.2 发布集成

- 本次整合 main 上的首页、45 区域选购、购物车与 UPAY Pro 更新，以及此前已在测试环境验收的多 IPv6 交付；保留 `ef798a5` 的 HTTPS 收银台修复。下方 IPv6 专项中的“未提交、未发布”为当时状态。
- 配套 Agent 版本提高为 `v1.0.3`。Agent 发布增加真实 Linux 网络命名空间验收，覆盖双 IPv6 数据包、协议限制、地址生命周期与路由保留。
- 本地按根 `test` 脚本逐项执行的 168 项检查全部通过，涵盖双端类型、业务和前端守卫；新的安装验收脚本通过语法与来源检查。发行包新装验收增加 IPv6 数据字段、发布源码版本及正式 Agent 双架构下载、大小、SHA256 和可执行能力检查。
- [预览安装](https://github.com/mastalee928/payincus/actions/runs/38877337714) 与 [正式发行](https://github.com/mastalee928/payincus/actions/runs/38878414833) 均通过双架构全新安装。公开面板包、OTA manifest、SHA256 和 Agent 双架构资产已独立下载核对；前述直接部署记录与本次 GitHub 新装证据分开保存。
- 现有测试主控的更新检查返回 `latest=v1.6.2`、`updateAvailable=true`、`canManageUpdates=true`，运行标识仍为 `v1.6.1-upaypro.3`，本轮没有执行面板 OTA。两台宿主已通过正常自动升级流程运行正式 Agent `v1.0.3`，心跳、一个/两个 IPv6、库存及端口协议状态正常。

## 2026-10-16 首页与选购界面源码

- 首页使用真实机器池商品目录，展示国旗、资源、月价和库存；公共购买入口统一为“购买主机”。选购页保留完整 45 个区域，售罄和未上架区域标灰。
- 新增可复用的入场、筛选和加购反馈组件，支持减少动态。Vue Bits 的 AnimatedContent 适配使用现有 GSAP；来源与许可保存在 `client/public/THIRD_PARTY_NOTICES.md`。支付、库存和实例交付逻辑未改动。
- 本地 client/server 类型检查、前端路由守卫、三语 key 与 23,540 条文案编译、机器池守卫、双端构建及 dist 边界守卫通过。隔离浏览器已验证商品预选、多台加购、登录返回、售罄、空目录、失败重试、三语、深浅色、手机布局和减少动态。
- 此节记录当时的 main 源码与本地验收；这些界面更新现已包含在正式版 `v1.6.2`。测试主控静态更新的备份与浏览器实证另存内部记录。

## 2026-10-16 UPAY Pro 接入与测试主控更新

- UPAY Pro 接入提交为 `1d37ff0c72bb5e669ee50c959351d77ac711c039`，已推送 main；[对应 CI](https://github.com/mastalee928/payincus/actions/runs/38842372055) 的类型、Lint 与构建检查通过。接口按上游 `a232783` 实现，各支付网络分别配置渠道。
- 固定提交的 166 项完整本地检查通过；Linux arm64 隔离构建完成后端、双端前端及前端路由、产物边界和 UPAY 守卫。部署包使用 LF 换行，未使用工作区未提交内容。
- Owner 授权后，测试主控于北京时间 2026-10-16 11:32 完成直接部署，运行标识为 `v1.6.1-upaypro.1`。应用新增 `202610160001_add_upaypro_payment_provider`，迁移总数为 208；已备份程序、数据库与运行配置，并重新生成 Prisma Client、封存程序文件。
- 更新后唯一后端、双端入口与静态资源、数据库及生产就绪检查、日志与响应头检查通过。实际管理员登录、版本与支付渠道 API 通过；两台 Agent 在线且心跳正常。配置表单的浏览器操作与支付事务已在此前隔离环境验证，真实 UPAY 付款、回调及到账仍待 owner 测试。
- 此项为已提交源码的测试部署，当时未创建新的 Release 或标签；UPAY Pro 及后续修复现已包含在正式版 `v1.6.2`。脱敏部署收据与备份位置保存在内部验收记录。

## 2026-10-16 IPv6 自动同步专项（发布前验收记录）

- 基于已运行的 UPAY Pro 提交 `1d37ff0`，叠加 IPv6 工作区改动部署到维护者测试主控；保留已安装的支付更新。应用 `202610160002_dedicated_ipv6` 后共有 209 条迁移，唯一后端、健康检查和数据库/支付就绪检查通过。此项未提交、未推送，也未发布新的面板或 Agent Release。
- 自动接入的独占宿主从实际物理网卡发现公网 IPv6，支持后加、替换、移除和多地址；宿主地址清单与实例已验证的交付地址分开。管理页面显示地址及同步原因，用户响应只暴露已验证公网地址。
- IPv6 转发与 TCP / TCP+UDP 策略协同；宿主 Agent 补齐必要的邻居发现规则，并以优先级 90 的专用 SNAT 保持各地址出口身份。实例网络配置持久化，Agent 独立协调并恢复网络规则。
- 验收发现旧升级逻辑将所有版本差异当作升级，曾把测试 Agent 换回旧版；面板与 Agent 均已增加版本比较和防降级守卫。两台测试宿主当前运行 `v1.0.3-ipv6.3`，真实心跳包含 `dedicated-ipv6-v1`，主控不再下发降级指令。
- 已通过：类型检查、配置的根检查逐项运行、相关守卫、双端构建及产物边界；新增防降级守卫和全部 Go 测试另行通过。隔离 PostgreSQL 覆盖地址变化、生命周期和客户响应；独立 Linux 网络测试覆盖两个 IPv6 的 TCP/UDP/ICMP、出口地址、NDP、隔离、协议切换及规则重载。
- 真机证据：一个云平台已分配的公网 IPv6 上，密码 SSH 以及端口 1、53、443、8443、65535 的 TCP/UDP 和 TCP-only 策略通过；临时实例重启后 SSH 正常，Agent 服务重启可重建专用 IPv6 规则。正式管理 API、机器池/宿主详情页及地址复制已验证。
- 后续真机发现云平台已分配 IPv6、宿主网卡却未自动配置。Agent 已补齐 OCI IMDS v2 地址同步，按物理网卡 MAC 匹配显式分配地址，维护 `/128` 地址及独立路由；不推测前缀地址，保留无关手工配置，元数据失败时保留现有地址。Debian 13 与 Alpine 的独立网络命名空间均已验证新增、多地址、替换、删除、网卡地址丢失恢复和路由保留；新增代码通过完整 Go 测试与构建。
- Owner 后加到现有用户实例宿主的 IPv6 已自动交付；普通用户真实网络页面显示正确，使用正式密码接口返回的密码经该 IPv6 登录成功，SSH 身份与实例一致。另通过普通用户的正式注册、邀请码、测试余额和购物车结算 API 购买临时 Debian 13 实例，订单及用户实例响应同时返回两个已就绪云 IPv6，IPv4 和两个 IPv6 的密码 SSH 均通过。这项购买走真实 API，未改动原客户会话或手工插入订单数据；不代表外部支付验收。
- 两个真实云 IPv6 的端口 1、53、443、8443、65535 均验证 TCP/TCP+UDP 策略。测试宿主实际整机重启，启动 ID 已变化，IPv4、两个 IPv6、同一密码和 SSH 身份恢复，TCP 模式下 UDP 仍被阻断。原客户的另一台宿主没有重启。
- 临时实例及全部转发已通过正式删除流程清理，测试账号余额归零并停用；测试宿主库存恢复可售，原 TCP 策略已恢复且生效，IPv4/IPv6 同步成功。没有新增稳定 Release 或 Git 提交；源码、部署包哈希、重启证据和无凭据截图保存在内部验收记录。云平台实际撤回地址的场景尚未由 owner 操作，删除与更换已有隔离网络及数据库测试证据。

## 2026-10-16 UPAY 充值下单修复

- 修复已推送 main：`1c5b21d` 修正 Node.js 多地址 DNS lookup 的回调格式，`ef798a5` 让收银台链接固定使用已配置的 HTTPS 域名。UPAY 返回的 AppUrl 可以是反向代理后的 HTTP 地址；仍校验交易号、固定收银台路径、金额、有效期，并拒绝附加查询参数、片段和 URL 凭据，不访问或返回该上游地址。
- 新回归分别复现旧实现失败并验证修复；两次 Linux arm64 隔离快照的 166 项完整检查及后端构建均通过，改动文件 Lint 通过。[DNS 修复 CI](https://github.com/mastalee928/payincus/actions/runs/38853012962) 与 [UPAY 收银台修复 CI](https://github.com/mastalee928/payincus/actions/runs/38854723532) 均成功。
- Owner 授权后，测试主控于北京时间 2026-10-16 13:15 更新为 `v1.6.1-upaypro.3`。两次修复仅替换各自后端模块的四个构建文件及版本元数据；更新前分别备份受影响文件、数据库、运行配置与证书，更新后重新封存程序。既有 IPv6 部署、schema 与 209 条迁移保持原状，本次没有新增迁移。
- 真机验收通过：使用已启用的 USDT-TRC20 渠道创建人民币 10 元待支付订单、打开 HTTPS 收银台、核对保存的币种/网络/交易号、重新支付和打开新的收银台。创建与重新支付均 HTTP 200，未付款状态保持 pending，账户余额不变；本次诊断订单已取消，验证会话已注销。
- 唯一后端、健康检查及未跳过数据库的生产/支付就绪检查通过。真实链上转账、支付回调与最终到账仍待 owner 付款验收。这两次修复当时仅直接部署，后续已整合到正式版 `v1.6.2`。

## 测试主控的既有证据

维护者测试主控此前使用 v1.6.1-preview.3 直接部署；最新测试部署见上方 IPv6 专项记录，尚未切换到稳定 Release。普通用户余额购买、公网密码 SSH、TCP/UDP 切换、两台 Alpine 无备份故障换机、故障隔离恢复、公网 IPv4 更换与同步，以及用户和管理员 PUSH 已完成测试。隔离 PostgreSQL 数据库另有库存、扣费、任务租约、换机和权限测试。

本轮已将该主控的面板与 Agent 更新源切换到本仓库，并清空临时 Agent 目录覆盖。主控从 GitHub 下载的两种 Agent、实际提供的 Agent manifest 与二进制下载均已核对 SHA256；唯一后端及双端健康检查正常。此项验证不代表主控已 OTA 至稳定面板版本。

本节早期验收不包括外部支付、客户公网 IPv6 与异地备份恢复；后续 IPv6 证据见上方专项记录。无备份换机不会恢复旧磁盘；旧机完全失联时需由运维在云厂商侧隔离，系统不能保证远端旧实例已经停止。

实际主控地址、测试账号、备份路径与逐步验收记录保存在维护者工作区内部文档中，不随公开源码发布。上游历史运行记录已归档，不代表本仓库当前生产状态。

## 继续维护

先读 AGENTS.md 与 [操作手册](OPERATIONS_HANDOFF.md)。每次发布必须分别记录源码提交、本地检查、Actions、Release 资产、安装验证及线上验收。功能说明见 [机器池文档](docs/host-pool.md)，发布步骤见 [安装与发布](docs/fork-release.md)。
