# 新实例开通失败完整检查

记录：2026-11-12晚至11-13凌晨，北京时间。检查源码 `2edcf1d31eed08837a335212de8f42d530af5698`，业务代码与已推送 `5b13db743e7b3b779fc1130f5cd631f2d10f708a` 相同。Owner要求完整检查所有实例开通失败，覆盖 Alpine、Debian、Ubuntu、Rocky Linux、AlmaLinux、CentOS，不只看缺包。**本报告是检查结果，本轮未修产品、未发行或部署；生产仅只读主控，未登录生产宿主／客户或现场安装依赖。**

## 现场事实与根因

只读主控确认仍运行 v1.8.8。11月11日00:00 UTC以后两条新建日志均失败，没有成功新建：

| 实例／宿主 | 时间（北京时间） | 镜像 | 原始错误 |
|---|---|---|---|
| #30／seoul-amd-1 #23 | 11-12 22:41:29.906 | images:alpine/3.24/cloud | Unpack failed: exec: "aa-exec": executable file not found in $PATH |
| #31／mumbai-amd-1 #40 | 11-12 22:46:03.212 | images:debian/14/cloud | 同上 |

两台 Agent v1.0.7在线、接入 succeeded、加固 verified；两台之前完成 Alpine/GRUB AppArmor维护。主控32台singleTenant宿主中31台保存加固verified，但这些回执都没有 `aa-exec` 证据。两台缺工具由实际失败日志证明，其余为同源风险，**没有逐台进入宿主检查，不能称32台都实际缺文件**。Owner报告另外四类系统也失败，宿主侧同一错误能够解释跨客户系统解包失败，用户报告与本轮实际两条DB日志分开。

Incus上游v7.0 `internal/server/apparmor/archive.go`在解包的AppArmor包装中明确 `exec.LookPath("aa-exec")`，缺文件直接返回错误，不是客户机里的sshd、apt/dnf/yum出错。

官方包实际下载检查：

- Alpine3.22/3.24 AMD64及3.24 ARM64：基础`apparmor`包不含`aa-exec`，`apparmor-utils`含`usr/bin/aa-exec`。AMD64/ARM64均有该拆分，不能只修一架构。
- Debian3.0.8与Ubuntu24.04的4.0.1官方**基础apparmor包已含**`usr/bin/aa-exec`；不同宿主发行版应按实际文件/依赖核验，不能统一假定都需同名拆包。
- Alpine3.22、3.23没有`apparmor-profiles-tunables/abstractions/api`三个拆包；3.24才有。本库固定全分支使用新拆包名，存在旧分支安装失败。

## 为什么之前检查通过仍漏

1. **检查条件不完整。** 加固核AppArmor内核启用、解析器、规则与既有客户运行态，没有核镜像解包工具；空宿主的guest数组为空，`every()`直接为true。`verified`回执不证明能新建。
2. **原生场景不同。** 以前做实际Incus清理／停删，但部分Linux内核AppArmor未启用；实际创建镜像没有经过启用AppArmor后的解包包装。客户系统初始化守卫主要看生成字符串，也不能发现宿主包缺文件。
3. **夹具跟着错误规格。** AppArmor依赖测试模拟只安装基础包/服务包就ready，没有真实包文件归属和缺`aa-exec`的组合。五项相关守卫本次仍全绿，而原生现场错误已复现。
4. **失败恢复把空库存当作交付能力恢复。** 清理函数核实例／磁盘／转发空，不核原开通失败是否已修；因此一轮失败后又可售，重复购买再失败。

责任在验证覆盖和“通过”的范围表达，不能归咎owner选择Debian/Ubuntu/RHEL镜像。以后“宿主加固通过”“镜像创建成功”“SSH交付成功”“发行包/升级”“生产生效”分别留证据，不能用一个状态替代全链路。

## 逐项发现与维修清单

P01–P07为本次根因及直接闭环缺口；P08以后含完整检查发现的旁支／风险，不能说全部已在生产发生。每项保留已有正确保护。

| 编号 | 检查结论、触发与位置 | 后续修改／验收要求 |
|---|---|---|
| P01 已确证 | Alpine安装模板`install-alpine.sh:79`与接入`onboarding-prepare.sh:29`没有apparmor-utils，后续维护`host-security-maintenance.py:24`也未列；内核启用后Incus解包失败 | 新接入明确准备必要工具；已有宿主沿原受信管理身份自动补齐，不重装Incus／换内核／停客户，不能只对新装生效 |
| P02 官方包确认 | 维护全分支固定3.24拆包名，3.22/3.23无此三包 | 按受信当前分支选择正确包；保原签名、libapparmor精确匹配与既有包基线，锁/下载失败自动续接，拒无依据升级原Incus/内核/SSH |
| P03 源码＋原生确认 | `apparmor_tools_ready():182`只看parser/规则/包，`onboarding-gateway.py:176`只回内核apparmor bool；`security-hardening-queue.ts:182`空guest every可verified | 宿主运行报告必须核aa-exec可执行、动态库/执行可用和必要解包工具；缺字段旧回执不能继续证明交付能力，保明确失败步骤 |
| P04 源码＋现场回池确认 | `beginPoolProvision:34`只用旧hardening/agent/库存；`host-resource-usage.ts:7`接纳旧verified或NULL，无解包能力门禁 | 可售/锁定预占/真正POST create前保持同一能力依据；漂移/包缺失由程序修复并核实际恢复，不靠隔离／报错完成任务 |
| P05 现场确认 | #23/#40失败后`poolCleanup verify_empty done`、poolFaulted=false、计数0，完全未修aa-exec；`host-pool-recovery.ts:112–120`及`host-pool-cleanup.ts:189`核空后放售 | 回池“已清空”与“可重新交付”分开；先保持清理事实，再核原失败依赖修复；不能假释放客户残留，修复后恢复原定价售卖 |
| P06 源码确认 | 队列`security-hardening-queue.ts:79`在旧revision/nextCheckAt未到时跳过；host-security-maintenance.ts已apparmor verified时不准备，常规host-hardening只自动补SSH | 下一版本启动后能识别旧能力回执、逐台公平补查/补齐，不能等24小时或被6次SSH预算永久挡工具修复；不同工作预算/原回执分别保存 |
| P07 覆盖确认 | 官方AppArmor包／启用内核＋真实新建组合未作为最终门槛；现5守卫全绿不能拦现场失败 | 固定回归：缺工具真实新建失败→自动补齐→实际创建→Running/SSH；同SHA双架构包旧worker首次升级需验证工具与新报告在实际执行器中生效，不能只改新worker或安装模板 |
| P08 普通/admin旁支源码确认 | `routes/instances.ts:6309–6336`VM等180s未Running仍继续并写running；admin-billing.ts:4745循环没有最终running=false拒绝 | 所有正常开通都需真正Running/初始化/显示密码可登录；机器池`poolProvision.complete`已核Running正确，不能把旧旁支当本次机器池根因 |
| P09 普通旁支源码确认 | `compensateFailedInstanceCreation:6094`及app.ts:1009先回滚资源/独立IPv4，再delete；deleteInstance不先stop，失败后普通error未进入再次扫描；managed分支有更强pending保护 | 不提前释放未确认远端的资源/地址，保原创建标记UUID；统一先核原尝试的stop/delete、系统卷/转发，再结资源，账务退款独立。当前机器池pending保护不能削弱 |
| P10 managed旁支源码确认 | managed创建首查归属后多个远端动作无同等pool guard；finalize只匹配target/status/specs，不在final写入时复查有效expiresAt；初始UUID/attempt到成功后才完整落库 | 逐写复查当前目标/原尝试/账期并锁必要字段；成功提交需与stop/删除/转移竞争；保底层开机到期门禁，不能因为本轮修创建而允许过期开机 |
| P11 源码确认 | finalizeManagedCleanupForDeletion:42先host后instance，与已改expiry等instance→host不同 | 统一锁顺序，真实PG并发屏障验无40P01；仅代码排序不能称所有竞争已实跑 |
| P12 恢复旁支源码确认 | host迁移创建后没有prepareNewContainerCloudInit；无调用者的restoreFromBackup helper source `{type:'backup',...backupData}`可被参数覆盖type | 迁移新建需同一首启准备；helper当前未发现调用，按退役/未用记录，不宣称生产可利用；未来保持source类型与客户隔离检查 |
| P13 初始配置源码风险 | `wrapWithNetworkRetry`耗尽后返回后续shell状态；非Alpinesetup与apt安装等`|| true`隐藏失败；默认sshd首值与Match/旧Include必须按各系统实际解析 | 不以runcmd执行完/Cloud-init done_with_errors/Running当密码交付；关键初始化步骤要持久明确失败并可修，现机器池已有实际SSH门槛，普通旁支无同等证明 |
| P14 能力源码风险＋隔离CPU确认 | 镜像兼容核arch/type/内存/白名单，无CPU指令级要求；旧qemu64实际RHEL9报glibc x86-64-v2 | 机器池真实OCI硬件是否满足不能靠模拟推断；CPU能力与镜像要求需实际核，ARM及不同版本分别说明，不能给失败实例强行改特权或禁AppArmor |
| P15 复审纠正，已有保护 | dedicatedHostReadyWhere的onboardingNode=succeeded分支额外检查agent在线；上层顶级agent条件仍与OR分支共同满足，**不会覆盖guestProtectionReadyWhere** | 原capability、applied和时间门槛保持；不修改此处、不列为本次bug。初次阅读把嵌套条件误认为覆盖，已在正式结论纠正 |
| P16 失败回执源码 | failPoolProvision在已扣后先claim标失败，日志/DB异常会阻补偿调用；prepared与真实在途、丢POST回执分支要精确区分 | 记录失败/退款/远端清理独立续接，不能日志插入失败阻退款和停止；已接受创建须核操作、原marker/uuid和磁盘，不用反复POST探结果 |
| P17 自动化调度范围 | security-hardening scan先串行续接一个未完成maintenance，保护全局重启批次；工具补齐没有独立队列。create-timeout循环无总预算/重入去重、普通单台错误可能结束后面目标 | 依赖补齐可独立公平调度，不能以修依赖为由取消原重启互斥/原客户恢复。超时清理补单目标错误隔离，保唯一后端、PG锁与恢复保护 |
| P18 本轮CI确证 | 三CI job失败：IPv4/IPv6 mock缺withMaintenanceDatabase；双Alpine maintenance期待旧HARDENING_BUSY而实际INSTANCE_EXPIRED | 仅修改错误夹具/断言，不放宽当前期限/事务能力；用真实独立客户端行锁竞争验证，新的例外不得伪装成安全放行 |
| P19 本轮CI/PG夹具纠正 | managed success_lost_claim模拟Incus在start响应前await更新主控当前被start持锁的实例，Query timeout并触退款/清理 | 此为fixture内互等，**不能称线上Incus会更新主控同库**；改为独立并发请求且不await阻远端回执，核原意图/账务/资源结果；先前commentary的“产品互等”结论以此纠正 |
| P20 证据范围 | cloud-init页面状态将disabled/unsupported/done_with_errors视ready，但未发现它直接代替机器池SSH准入 | 页面就绪与实际交付分开；不扩大为已证所有客户密码坏。原生六类完整初始化与公网/全端口尚未验收，必须继续核 |

## 正确保护，修复不能删除

- 一机一卖独占宿主，库存／checkout预留／创建pending与删除pending不提前回卖；原价与当前实例改价独立，历史账单不改。
- 下单及materialize事务重新核当前账户、价格/plan、镜像可见/架构/type/命令归属、已预留host；重复requestId不重复扣款。
- Pool创建有原endpoint/marker/uuid/createdAt逐动作保护，完成前实际Running、原有效配置和SSH登录验证；未知同名资源不能被旧创建清理误删。
- stop/start低层有效期限行锁；不能为解除创建故障撤销到期stop/delete或允许过期开机。
- 遗留清理确认实际404、远端无在途原创建、系统卷/快照、对应forward；HTTP200或DB deleted不能代替磁盘已消失。
- 已付款失败退余额／原路外部退款分别持账目；有失败退款历史不重复返利冲正。外部refund pending不冒称钱已到账。
- 原AppArmor/非特权、OCI metadata与管理网隔离、TLS/SSH pin、原客户密码/磁盘/已付账期、恢复保护保持。

## 两笔退款与回池实证

#30余额日志消费-11（#68）之后refund+11（#69），余额932→943；账单newPurchase11（#43）/refund-11（#44）对应原ledger，订单refunded。checkoutRefund无记录是余额支付正常路径，不是漏退。#31newPurchase11（#45）/refund-11（#46）、refund余额日志#71存在。当前两实例deleted、两个pending=false、宿主占用0。

#23在22:41:40.913、#40在22:46:09.178完成`verify_empty`，poolFaulted=false、资源0。证明“清理与钱返还已完成”，**不证明原aa-exec故障已修**。不改历史退款或代重新扣钱/建实例。

## 原生复现与六系统矩阵

一次性本地Linux：官方Alpine3.24标准ISO SHA256实核，kernel6.18.60-lts支持AppArmor并通过启动参数实际启用；Incus7.0.1。Windows ARM64本机QEMU TCG运行x86_64 Linux，非生产。官方镜像metadata/rootfs均实际下载核size/hash。

缺aa-exec时，实际POST create→远端任务Failure，错误与现场完全一致，`logs/aa-exec-native-before.json`；仅在隔离宿主加apparmor-utils后，`aa-exec --help`执行与apk who-owns核包，通过真实镜像创建。不更改产品源码、不在生产修包。

| 客户镜像 | 实际解包/创建 | 实际启动对照 | 当前生成器初始化/SSH |
|---|---|---|---|
| Alpine3.24/cloud | 成功 | Running | 当前生成器配置已运行，IPv4分配；180秒观察仍cloud-init running，无密码策略证明，未通过 |
| Debian14/forky/cloud | 成功 | Running | 进一步检查出现创建/exec超时，无完整初始SSH证明，未通过 |
| Ubuntu24.04/noble/cloud | 成功 | Running | 进一步检查创建120秒超时，未通过 |
| RockyLinux9/cloud | 成功 | 旧qemu64不支持v2、Stopped；保原磁盘CPU改max后Running | 当前生成器检查Running但exec/初始化观察无输出，未通过 |
| AlmaLinux9/cloud | 成功 | 同上；原磁盘max后Running | 当前生成器创建超时，未通过 |
| CentOS9-Stream/cloud | 成功 | 旧qemu64Stopped，max新建同缓存镜像Running | 当前生成器创建/Running且IPv4分配，完整cloud-init/密码证明未取得，未通过 |

初轮小临时盘容量不足、非真实线上故障，保留exit1；改本次24GiB独立磁盘/6GiB内存后六类都能创建。RHEL退出日志明确`Fatal glibc error: CPU does not support x86-64-v2`，属于旧测试CPU，不能据此说OCI池宿主不能运行RHEL9。max CPU对照补明确证据。

后续初始化观察脚本第一次仅等待一次image-operation，任务仍Running就误判失败，此为**检查脚本问题**；纠正为完整等待，Alpine仍缺完成证据。输出/密码资料仅仓库外私有保存，公开结果只保存布尔观察，不展示客户凭据。脚本exit0仅表示检查运行结束，`initializationVerified=false`不能当验收绿。

最终五类缓存检查自然exit0，但所有`initializationVerified=false`：Debian/Rocky/CentOS创建并Running，Ubuntu/Alma记录120秒请求超时；exec观察无输出不能直接归因初始化损坏。检查结束时Ubuntu/Alma测试容器仍有待确认的删除回执，不能用“脚本已退出”称远端已清。最后只读列表确认两测试容器均Stopped、forward=0，完整磁盘、操作／卷列表保存于私有`final-inventory.private.json`；核本次两个QEMU实际PID/父进程/启动路径后停止，未删除测试磁盘。后续独立环境继续验，不对生产做同样操作。

本轮还没完成所有版本、ARM64真实镜像、KVM、原生无模拟时间限制、公网SSH/TCP/UDP全端口／IPv6／DNS、真实旧包升级后全池补齐及生产点击验收。不得宣称所有系统100%通过或永不再漏。已明确覆盖链路和对应缺口，后续按P编号修/验。

## 守卫及CI终态

五项现有检查：security-hardening、onboarding-bootstrap、instance-create-failure-compensation、dedicated-delivery、image-route全部自然exit0，ignored `aa-exec-inspection-guards-correct.log`。初轮错误把`--only`当正则没有匹配任何测试exit1保留，纠正逐参数后全五项实际执行。**它们没覆盖P01根因，绿不能称修复。**

- 源码CI `43241386494`：completed/failure，15job中12success，失败job131262413524（host-public-ip）、131262413618（host-public-ipv6）、131262413526（managed provision lost-claim）。
- Alpine SSH `43241386488`：completed/failure，双maintenance131262406690/131262407472因旧错误断言；其它native分项成功不代替整轮。
- 本轮未重新push、tag、发行/部署；已推expiry源码本地通过与云端失败均保留，需要修夹具/必要真实问题后新来源闭环。

## 下一阶段的具体验收

1. 新接入Alpine3.22/3.23/3.24及Debian/Ubuntu准备正确宿主依赖并执行验证；AMD64/ARM64分别验证。
2. 已接入的旧verified/缺字段、工具漂移/损坏/权限/PATH、包锁/下载中断/索引旧、同branch库版本不匹配：自动按固定范围修复并回读；不升级原内核/Incus/SSH、不重装客户/改TLS pin。
3. 启用AppArmor的真实新建从空池首次解包、缓存镜像重建/重装/换机、普通/admin/pool入口均核原实例、实际Running/显示密码SSH、IPv4/IPv6/DNS与全端口；错误步骤持久，未知回执不重复创建。
4. 故障注入失败日志写DB、单目标报错、实际在途/丢回执、到期改期/stop/delete竞争、账务回滚/退款/返利幂等，远端及系统盘/快照/forward真清再回池；工具未恢复不得再放售。
5. 原v1.8.8旧包worker升级到下一候选包、已有网关helper/Agent/能力报告/调度代码真实生效，补两架构安装/恢复/回滚再升级、实际tar与签名；最后再列生产只读状态或owner点击结果。

原生/root证据索引为ignored `logs/aa-exec-complete-inspection-evidence.json`。现场只读数据在仓库外 `private/payincus/hardening29/aa-exec-controller-read.json` 和 `aa-exec-controller-accounting-read.json`；原始私有输出、凭据、客机密码、测试磁盘不提交。
