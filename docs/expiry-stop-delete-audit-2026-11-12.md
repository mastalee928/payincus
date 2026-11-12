# v1.8.8 到期停机与宽限期删除彻查

后续：Owner 已授权修好本报告整份结果；源码修复、五轮代码审视和两遍排查的最新状态见[修复证据](expiry-stop-delete-five-reviews-2026-11-12.md)。下文“未修”是本次诊断时的历史状态，生产当时事实保持，不能作为后续已部署声明。

记录：2026-11-12，北京时间。Owner明确要求到期且未完成手动／自动续费必须实际Stopped，宽限期结束仍未续费必须删除，不能因客户系统或历史任务格式长期跳过。当前授权为**只读主控及本地代码排查**；本报告不代表修复、停机或新版本已完成。

## JHTONE 实际失败链路

主控已部署正式v1.8.8，source `a7d7d841aec3`，backend active、NRestarts=0。部署的`registered-guest-identity.js`与公开AMD64／ARM64包hash完全相同；升级和入包均正确。

实例#28/JHTONE属于seoul-amd-2（宿主#24），当前系统状态为`suspended`／`expired`，自动续费关闭。到期时间为11月10日10:44:29，封停时间为10:45:00.052。11月9日管理员到期修改审计明确把原日期改为该到期时间，未扣费／退款；历史实付账单仍保留，不能将旧账单日期错误当作当前续费已发生。

截至18:44的只读核验：没有PENDING／PROCESSING实例、恢复或上传任务，没有未结束快照／反代操作，没有该实例计费锁，恢复保护关闭，宿主Agentv1.0.7在线。北京时间19:47:39再次仅只读主控：仍suspended，旧任务仍SQL NULL，没有open快照／反代或该实例计费锁；最新19:45:01.233日志#11643仍instance.expiry_stop_pending／warning。19:32已部署解析器仍返回空身份。客户仍可登录使用由owner实测；本次未进入宿主／客户读取实时Incus状态。

主控五分钟巡查选中了#28，每轮在实际停机前抛`EXPIRY_STOP_IDENTITY_UNVERIFIED`。原`recoveryIdentity`仍保存UUID和精确创建时间；最新历史任务#24为11月6日19:47:46–19:48:39完成的同宿主原地`rebuild`，`targetHostId=null`，`replacementState`是**SQL NULL**。

`registeredGuestIdentity`仅把空对象`{}`认作旧原地重装，明确排除`null`，于是返回`uuid=null, createdAt=null`，丢弃已有原凭据。之后`stopCurrentExpiredInstance`拒绝下发PUT stop。现有守卫也把`null`列为必须拒绝的样例，测试规格错误掩盖真实旧数据。

用实际已保存主控记录在本地调用未修改v1.8.8源码：`null`返回空身份；只把同一fixture状态换为`{}`便返回原UUID和创建时间，问题已复现。18:25巡查的“当前身份或登记与原任务不一致”来自通用文案，**没有证明实际UUID变化、客户篡改或换机**。当前重试没有旧数据修复步骤，只会重复失败。

## 完整链路审查发现

| 编号 | 事实／触发条件 | 代码位置与影响 |
|---|---|---|
| E01：已实证 | 同宿主旧原地rebuild为SQL NULL，被新判断丢弃原身份 | `server/src/lib/registered-guest-identity.ts:23`；阻塞JHTONE停机，也会阻塞使用同一解析器的删除、续费恢复和其它流程 |
| E02：代码确认 | 保存UUID但未保存创建时间时，停删要求两者齐全 | `billing-scheduler.ts:723`；主控另一台未到期实例#27有managedCleanup.uuid但无recoveryIdentity.createdAt，未来存在同类阻断。缺记录应按受信当前绑定／原交付记录核验补齐，不能长期只报错 |
| E03：本地确认 | 查询及执行要求packagePlanId非空，并限system expired封停 | `db/instance-suspend.ts:21,192`、`billing-expiry-enforcement.ts:6`；有明确expiresAt但无套餐计划被排除，已手工封停但仍Running的到期实例也不会进入同一停机／删除处理。是否收费与是否有到期截止需区分 |
| E04：本地确认 | 宽限期从suspendedAt而非expiresAt计算，删除仅选已封停记录 | `db/instance-suspend.ts:308`、`billing-scheduler.ts:806`、`instance-auto-renew.ts:10`；迟封停会推迟删除，缺suspendedAt会永久跳过删除；仍Running但已过宽限期也不被保留期函数识别。续费拒绝边界与删除边界必须统一 |
| E05：代码确认 | 五分钟整点巡查，无到期时刻调度／启动即时补扫 | `billing-scheduler.ts:1289,1314`；时间到后最多先等待五分钟，前面的修复和续费工作还会增加延迟。当前没有满足“到期时就停”的机制 |
| E06：代码确认 | 全部PENDING／PROCESSING、快照／反代pending/applying/retry/blocked均阻塞停删；重装人工介入可继续保持PROCESSING | `billing-scheduler.ts:714,808,857`、`snapshot-operation-guards.ts:7`、`proxy-site-operation-guards.ts:4`、`instanceTaskWorker.ts:243,2196`；未执行任务、失败隔离状态和真实远端在途未区分。存在相互等待及无限跳过路径；需要取消未执行客户动作、核验并收尾已受理操作，而不是反复全量busy |
| E07：本地确认 | 任意关联远端操作都被lifecycleOperationPending认为阻塞 | `incus/lifecycle-operation-idle.ts:2`及`billing-scheduler.ts:736,907`；Running exec／websocket可阻塞到期停删，持久终端不等同重建／迁移。需分类并终止到期客户会话，保留真正改变资源的操作回执 |
| E08：代码确认 | 单个自动续费读取异常可让executeAutoRenew抛错，整轮到期执行立即return | `billing-scheduler.ts:231,1255`；一台不相关实例异常也可阻断所有停删，包括autoRenew=false实例。应按目标隔离，当前目标重读已付期限，不能把其它目标错误变成全局不执行 |
| E09：代码确认 | 普通start／restart排队及执行没有统一当前期限复核；备份恢复授权主要拒绝deleted，后续会start | `routes/instances.ts:2936`、`db/instance-tasks.ts:341`、`instanceTaskWorker.ts:597,769,933`、`restore-task-authorization.ts:16`；页面封停可挡新请求，但已排队动作、日期刚到或后台执行之间存在过期后重新启动路径。应在每次真正start／restart／rebuild／restore前核当前expiresAt及已付状态 |
| E10：代码确认 | 到期stop不保存／禁用boot.autostart，Agent本身无账期执行指令 | `billing-scheduler.ts:701`；宿主／Incus重启可能再次自动启动已到期客机。应保存原boot策略、到期禁用并核回读，续费成功按用户原意恢复，主控离线时的宿主侧期限执行也需明确设计与验收 |
| E11：代码确认 | 备份恢复导入后UUID改变，成功事务没有更新recoveryIdentity／managedCleanup，解析器也不读恢复任务 | `restoreTaskWorker.ts:343`、`registered-guest-identity.ts:11`；恢复后的合法当前机器会保留旧UUID，后续停删可能拒绝。恢复完成／原操作回执续接需原子更新实际新身份并保留来源历史 |
| E12：代码确认 | 取不到计费锁静默return、部分删除busy条件静默return；身份错误均映射同一文案 | `billing-scheduler.ts:130,810,884`、`automatic-operation-audit.ts:33`；可能只显示巡查完成，缺具体阻塞任务／步骤／尚未发出请求的信息。应持久显示“尚未停机”、具体任务ID／状态／自动处置结果，真实Stopped后才记录停机成功 |

初轮E03／E04／E07为函数验证，E05–E12为代码检查；**本轮继续彻查后，E03／E04／E06／E07／E08／E09／E10／E11／E12均补充实际PG／TLS调度器、worker或HTTP复现，详情与准确范围见下文第二轮。** 没有宣称这些都发生在JHTONE身上。JHTONE的实际持续失败点是E01；E02来自另一台当前实例记录，尚未到期。

## 当前停删机制已有的正确部分

实际停机请求为Incus `PUT /1.0/instances/<name>/state`，`action=stop, force=true, timeout=5`，由宿主执行，不依赖客机Alpine／Debian等系统内服务。请求后回读`Stopped`；`Frozen`仍需执行stop。已续费并提交新期限时复查可避免旧停机快照误停。

删除流程先保存删除意图及库存占用，实际删除后验证容器不存在、系统卷／快照不存在、对应转发已消失，再清理平台分配、重算资源并释放库存；历史实付账单保留。这些验收应保留，不能把仅主控status=deleted当成真实删除完成。

根本问题在于执行前的选择、身份解析和任务分类无法自动收尾，以及没有到期后的开机／自启闭环。修复应落实为“当前账期是否到期”决定动作，“当前宿主／实例绑定”决定准确目标；历史缺字段由程序核验补齐，不能让客户机器一直运行。真正的目标迁移／重建在途必须自动确认当前承载位置和结果，不能用旧名字误删别人的机器，也不能停在永久拒绝。

## 完整修复与验收要求

1. 先修E01，并同时处理实际旧身份格式：SQL NULL、JSON null、空对象；原地重装和真实换机／重建分清，拒绝损坏半成品，解析出当前原实例。用真实旧数据fixture与真实PG NULL验证；不要只改单元断言。
2. 统一到期资格与宽限期截止：凡有效expiresAt到期均进入处理，正常手动／自动续费已提交则重读新期限；未续费的blocked/error/manual等状态不能仅因标签不进扫描。无期限免费实例不推断期限。删除和续费边界用同一截止来源，迟封停或缺封停时间不延长使用。
3. 到期动作独立调度、启动补扫和五分钟兜底；续费／日期修改后刷新时间计划，系统重启与时钟变化重新核对。只显示页面封停不足以验收，必须实际Stopped、客户新登录不可用，已建立连接结束。
4. 统一后台执行门禁：过期后禁止原排队开机／重启／重装／恢复再次启动；区分未执行客户任务、实际在途操作、终端exec、snapshot／proxy失败状态，自动取消／核验收尾，错误隔离到具体实例。
5. 实际stop前禁用该实例boot.autostart并持久原策略，续费后按原策略恢复；核宿主重启后到期客机保持Stopped。无法联系宿主需明确真实连接故障并持续修复；需要主控失联期间精确执行时，应在宿主保存受认证截止并核撤销／续费更新，不能声称仅五分钟主控巡查已具备该能力。
6. 完成合法restore/recreate/换机时原子更新当前UUID／创建时间，并兼容已有成功恢复回执；当前原客户机器、磁盘、网络和已付期限均需核验。其它机器／同名新资源不可由旧账期误停误删。
7. 故障注入覆盖：null旧重装、只存UUID、已恢复UUID、过期无plan、手工封停但Running、迟封停／无suspendedAt、后台重启补扫、长期exec、快照blocked、停机丢回执、远端stop在途、单目标续费读取失败、续费与停删竞争、宽限期边界及真实容器／磁盘／转发清理回池。

本次只读核验的JHTONE现有程序删除截止为**11月13日10:45:00.052**；从当前expiresAt起算72小时为10:44:29。当前尚未到删除截止，但早已到停机期限。未停止不能用来推迟宽限期。

## 本轮验证与范围

- 主控取证仅SELECT／BEGIN READ ONLY、日志／代码读取；没有触发手动巡查、连接宿主／客户、stop、freeze、delete或改数据库／配置。SQL的无时区时间字段用原始文本取值并按应用UTC惯例与Prisma／界面核对，避免pg驱动按机器时区再次偏移8小时。
- 部署身份解析模块与两个正式发行包逐字节hash匹配；本地实际旧记录复现E01。现有`registered-guest-identity`、`billing-expiry-enforcement`、`billing-expiry-delete`、`billing-expiry-race-guards`四守卫全部通过，证明现有测试未覆盖上述缺口，**不表示修好**。
- 只读取证保存在仓库外private/payincus/hardening29/instance28-after188-20261112与instance-expiry-thorough-20261112；本地复现和守卫日志在ignored `logs/expiry188-*`。不提交凭据或私有原始输出。
- 本轮产品源码未改，未提交推送或发行；下一步为按此清单修源码并做隔离验收。生产客户实际停机仍未完成，不用诊断报告冒充处理成功。

## 第二轮继续彻查：实际执行与新增根因

Owner要求「查得不够彻底，继续彻查」。本轮读取原源码，独立本地PG真实migrate，受信HTTPS模拟Incus／Caddy、真实WebSocket建立终端数据与控制连接，调用实际调度器、worker和HTTP路由。**是实际业务代码／数据库／协议执行，不是真实Incus客机磁盘或生产客户SSH验证。产品源码未改。** 观察条目有重复，不用数量代替完整入口与失败链路。

### 停机前被跳过、整轮延迟和续费边界

- **E03／E04深化（实际调度器）：** 有expiresAt但packagePlanId=null仍Running、巡查failureCount=0；已手工封停但过期Running不被系统expired扫描选择。到期五天但刚写suspendedAt的实例不进入删除；缺suspendedAt也漏删。仍Running、到期超过五天的实例则仍可自动补续，实际续费成功。当前保留期取决于状态标签与封停时间，不能满足从有效到期截止统一执行。
- **E08深化（实际整轮）：** 一台自动续费读取出错，executeAutoRenew收尾抛错，executeExpiryEnforcement直接return。不相关autoRenew=false实例远端Running、DB running，没有stop。不能用其它目标异常阻止当前目标重读账期后执行。
- **E12深化（实际lease）：** 活30分钟分布式expiry-suspend或expiry-delete lease导致锁未取得后静默return；stopCalls=0或deleteCalls=0，failureCount可为0。进程终止后尚未失效lease也会延迟执行；当前未等待锁释放后自动继续同一轮。
- **并发槽饥饿（实际lane＋调度器）：** 五个实例计费lane被占用，等待先消耗全部pLimit(5)槽，第六个无关到期实例不进入stop，巡查持续running。释放前五个后才停止第六个。每目标远端deadline不能覆盖进入lane前的无界等待。
- **E17方案删除竞争（实际DB函数＋调度器）：** 正常canDeletePlan在有关联实例时确实拒绝，不能称所有方案删除都会遗留实例。但检查返回可删后、deletePlan前，另一创建合法提交；实际deletePlan使FK SetNull，保留expiresAt，后续巡查忽略。位置db/package-plans.ts:321,345、routes/packages.ts:2958、schema Instance.packagePlan。实跑原检查／创建／删除函数的交错，不冒称已跑两个实际HTTP购买／删除请求；不是JHTONE根因。
- **E05边界：** 仅五分钟整点cron，无截止时刻调度／启动即时补扫；前面串行管理修复、已受理删除、换机恢复、自动续费和恢复任务，后面stop通知逐用户同步await后才开始delete。通知各有超时，不说完全无时限，但规模与故障会继续拖延截止动作。services/instance-patrol.ts:18、billing-scheduler.ts:1255,1289。

### 真正可以重新开机／继续连接的入口

| 入口 | 实际执行结果 | 代码 |
|---|---|---|
| E09-A：旧排队start | expired+suspended、远端Stopped，claimNextTask认领，executeTask下发start，任务COMPLETED、远端Running、DB仍suspended | workers/instanceTaskWorker.ts:511,574,760；db/instance-tasks.ts:341 |
| E09-B：普通用户PAT | 有效services:operate token，对expired但DB stopped实例POST actions得202；实际worker完成并Running | routes/public-api.ts:594,1664；查询未选expiresAt |
| E09-C：恢复失败回滚 | expired+suspended原实例，真实POST restore rollback得200，并start为Running | routes/backups.ts:948,1024；未核当前账期，原机器主要检查存在性 |
| E16：终端 | expired但DB running可得票据并实际建立mTLS exec数据／控制双WebSocket；巡查写suspended后会话仍存活，exec挡stop，stopCalls=0 | routes/terminal.ts:162；db/terminal-opening-authorization.ts:20；expiry未调用closeInstanceSessions |
| E10：自启 | 实际成功Stopped后回读boot.autostart仍true；宿主／Incus重启可能自启，Agent无客户账期协议 | billing-scheduler.ts:701；agent/ |

实验使用自己的隔离用户、有效PAT与正常会话，没有伪造admin权限。账户、token、归属和隔离保护需保留；问题是状态标签代替当前有效截止，且共享start/restart低层只核隔离配置。页面拒绝新请求不能替代每次真正远端开机／重试前核账期。

### 合法身份格式与恢复后的登记

- **E14：等价时间文本（实际PG／TLS stop）：** 保存`.123Z`、远端`.123000000Z`代表同一时刻，字符串比较误拒、stopCalls=0。billing-scheduler.ts:725,830。后续精修须保留精度并区分合法尾零／时区规范化和真实不同时刻，不能一律截毫秒放宽身份。
- **E15：空段遮盖完整记录（实际PG／TLS stop）：** recoveryIdentity={}通过`??`遮住完整managedCleanup，返回空身份且stop不下发。registered-guest-identity.ts:17。需要按完整性核验候选来源；不可无条件相信同名当前容器。
- **E11深化（实际restore成功）：** 原UUID／created_at与导入的新UUID／created_at不同；实际restore worker成功后最终只写storagePool／restoredFrom／name等，未更新recoveryIdentity／managedCleanup，解析仍旧UUID。restoreTaskWorker.ts:343。解析器也不读取restoreTask，后续停删会误拒合法新实例。
- **E02来源覆盖：** 普通用户旧非池createInstanceAsync及admin旧普通创建分支没有统一回读当前身份落库；机器池pool-provisioning和managed-instance-provision则有。当前#27仅UUID无createdAt，不能泛称所有新机器均无登记。应完整核旧交付／恢复回执，确定原客户目标后补齐。

### 错误续接中的永久循环和续费恢复

- **E20中断recreate循环（实际cleanup服务＋调度器）：** 实例到期变suspended，中断recreate清理先拒suspended；六次后任务仍PROCESSING、progress=manual_intervention，cleanupAttempts=6，后续自动扫描不再认领，却继续阻stop／delete。本地运行六次原服务后巡查仍Running、stopCalls=0。instance-reinstall-identity.ts:200,252,341。程序在「停机等PROCESSING、清理又拒suspended」之间循环，不能仅加失败隔离或直接删除资源保护。
- **E19自动续费同源失败（实际续费事务＋worker）：** 旧NULL rebuild身份允许自动补续提交一笔扣款／renew账单，queueRenewalResume保存uuid=null；实际worker标FAILED、terminal=true，retryRenewalResumes不再排队，客机仍Stopped。renewal-resume.ts:30,51,86,200、billing-operations.ts:764。**没有重复扣款**，但没有完成自动恢复。
- **手动续费的正确行为（实际事务）：** 解除系统到期封停为DB stopped，远端仍Stopped，不创建自动start任务，待用户开机。自动补续则有专用开机任务。专用resume已核最新paidUntil、当前expiresAt、真实账单、归属、隔离及竞争；缺身份和六次预算后terminal缺自动修复闭环。不能笼统宣称所有续费都会自动Running。
- **E18真实锁死锁：** recoverPoolHost先锁host FOR UPDATE再instance，expiry先instance FOR UPDATE再host FOR SHARE。对两个实际服务在第一把锁后加入本地时序屏障，原SQL／锁类型不变，真实PG报`40P01`；该轮stop未发。host-pool-recovery.ts:330,336、billing-scheduler.ts:709,712。PG会回滚一方，当前只留下后续重试，不能说整个系统永久死锁；不是JHTONE线上原因。fixture恢复最终被库存条件拒绝，但在核库存前已持有这两把锁。IPv6同步有先实例advisory锁的保护，不凭表面行锁顺序断言其必死锁。
- **E21远端边界（实际stop）：** Starting在force stop前被拒，stopCalls=0；原容器已404仍stop failure，没有「已不存在」独立闭环。Frozen→Stopped和VM类型stop已实跑成功，stop不依赖客机系统服务，但本轮客机响应是fixture。
- **丢回执：** stop已成功但响应丢失，下轮已Stopped不重复stop正确；already-stopped未补instance.expiry_stop_reconciled日志，历史可能持续只有pending。
- **维护恢复不能一概误报：** customer-boot-recovery.ts:113,122已有到期检查、能选择stop；host-maintenance-plan.ts:67的before.state=suspended分支却优先要求远端Stopped，否则blocked，跳过后续expired→stop。本地函数确认。维护fence会挡一般停删，需用现有精确目标能力协调自动收尾，不盲取消磁盘重建。

### E13：删除中仍在Running的明确路径

实际PG／TLS／Caddy故障注入：billing-scheduler.ts:877先写status=deleted、deletionBillingPending=true，:890先cleanup代理，:908才stop。Caddy失败时远端仍Running、stopCalls=0；下一普通stop巡查排除deleted，delete重试继续卡代理清理。该路径可无限继续，必须将到期目标实际停止与代理清理分别续接。

已有库存保护仍有效：queueDeletedPoolHost仅在远端delete确认后设置poolFaulted，bookkeeping未完仍占用；真正DELETE后核原容器不存在，所有storage pool的default项目原系统卷／快照、dedicated forwards均消失，再清平台端口／备份快照策略／流量／IP／IPv6／公网IPv4占用，重算资源并保留历史实付。**DB deleted不代表远端已删；库存保留也不代表已停止客户使用。**

范围纠正：一般verifyInstanceDeleted只核原系统卷／快照与dedicated forward，不按名字删未归属custom卷；当前客户隔离禁止额外磁盘挂载，整池库存核验又拒custom／其它项目／未知实例及转发残留。不能把此范围限制误报为机器池必然带客户额外盘回卖。客户自己上传到外部存储的备份属于独立权限／记录范围，本轮没有授权或测试删除外部对象。生产真实Incus磁盘／快照／转发完整清理仍须修后验收。

### 全部相关入口覆盖与尚未实跑范围

| 流程 | 检查结论／本轮证据 |
|---|---|
| 五分钟停机／删除／补续 | 实际PG／TLS调度器覆盖选择、宽限期、锁、任务、身份、Caddy、丢响应及等待饥饿 |
| Web start／restart | 源码只限suspended标签；旧start实际worker；restart源码，未新跑完整restart |
| PAT／OAuth power | 实际PAT鉴权＋HTTP＋worker；OAuth共用判断代码，未新跑OAuth完整授权 |
| 终端票据／初建／存活／重连 | 实际票据、双WebSocket、巡查；重连共用opening授权代码，未称本轮全部重连故障实跑 |
| rebuild／recreate | 新guard拒suspended、核原/新身份并正确落新身份，但check／complete无expiresAt；中断清理六次实跑，未称重装全流程实跑 |
| clone／change_host | 有授权、原/新身份和源副本清理；需补实际start前统一期限门禁，仅代码审查 |
| restore／restore rollback | 实际成功restore后身份陈旧、实际rollback过期开机；其它备份／所有系统未全实跑 |
| 机器池replace_host | 成功落新身份正确，但assertActive只看task PROCESSING、最终只拒deleted，可覆suspended为running；host-replacement.ts:118,207,215代码，未跑完整换机交付 |
| 旧宿主批量迁移 | hosts.ts:5648复制旧snapshottedSpecs给新容器，未写新身份；此入口明确拒dedicated／singleTenant，不是机器池路径；仅代码 |
| 普通／admin／pool新建 | 对照身份落库覆盖；池与managed有回读，旧普通分支缺；未称所有系统创建实跑 |
| 网络／IPv6自动start/restart | 低层隔离与恢复原设备保护存在，但缺账期final gate；ipv6-route-recovery.ts:15、network-payload-builder.ts:399,443代码 |
| 宿主维护／启动恢复 | 部分到期判断正确，suspended基线＋Running blocked，函数实证 |
| 状态同步／Agent | 状态同步不复活suspended/deleted正确，但不执行账期stop；Agent无客户账期截止协议，仅源码 |
| 手动／自动续费恢复 | 两实际续费事务＋自动worker，手动stopped、自动缺身份terminal |
| 宿主失联／主控离线／宿主重启 | 无持久宿主截止执行能力；自启未禁已回读，未称真实离线／重启验收 |

所有start／restart／reinstall／restore／迁移实际下发前须核最新账期；真正迁移在途需自动确定当前承载位置和原回执，不能拿旧名误停其它机器。无期限免费实例不推断期限，已提交新续费不误停误删。

### 最终实验与私有证据

本地DB均127.0.0.1:55438的独立专用数据库，真实migrate；受信HTTPS提供可控Incus／Caddy响应，WebSocket确实建立exec数据／控制连接。不是生产执行或原生Incus磁盘实证。

| ignored日志／结果文件 | 范围 | 最终自然退出 |
|---|---|---|
| expiry188-deep-lab-round3.log／deep-lab-results.json | SQL NULL、lease、exec、blocked snapshot、PENDING、无plan／manual、丢stop、自启、Caddy删中Running | 0 |
| expiry188-deep-power-round4.log／deep-power-results.json | 实际旧start worker、实际rollback HTTP | 0，资源关闭 |
| expiry188-restore-identity.log／restored-identity-results.json | 实际成功restore后旧身份 | 0 |
| expiry188-deep-scan.log／deep-scan-results.json | 整轮退出、迟封停／无时间、Running过期五天补续、lane饥饿 | 0，资源关闭 |
| expiry188-deep-final-boundary.log／deep-final-boundary-results.json | 404、Frozen、VM、Starting、卷范围、维护基线 | 0，资源关闭 |
| expiry188-deep-identity.log／deep-identity-results.json | 时间文本、空段遮盖、404闭环 | 0，资源关闭 |
| expiry188-deep-access-round6.log／deep-access-results.json | PAT、终端、方案竞争、补续terminal、手动续费、六次清理循环、40P01 | 0，资源关闭 |
| expiry188-inspection-guards.log | 既有4停删守卫 | 0，证明覆盖不足，不是修好 |

结果文件表中省略前缀部分均为`logs/expiry188-`加所列名字。早期fixture字段缺失、网络地址缺失、SQLSTATE提取断言错误及关闭超时保留失败日志；使用最终自然exit0且核资源关闭的完整轮，不用部分成功输出冒充整体通过。

最新19:47取证直接PG BEGIN READ ONLY／SELECT／ROLLBACK，原始证据在仓库外private/payincus/hardening29/instance-expiry-thorough-20261112；先前解析与部署日志在instance28-after188-20261112。全部仅主控，不进入宿主／客户、触发巡检、stop/freeze/delete或改生产。无时区字段用原文本按应用UTC对照，凭据／token／原始私有输出不提交。

### 下一修复阶段的验收门槛

统一当前expiresAt及宽限期、补精确截止与启动补扫，处理合法历史／恢复身份；分类未执行任务、exec和真实在途并自动收尾；独立先实际stop再清代理／磁盘／转发，关原boot.autostart并保存用户原意；有界公平调度和统一锁顺序，修PROCESSING／terminal永久阻挡；日志只在真实Stopped或已核消失后闭环。真实旧PG数据、所有入口／并发／丢回执／重启、真实Incus与SSH停止、容器与系统卷／快照／转发删除及原价回池须修后验收。

**本轮已深化为可复现的链路审查，仍未修产品或生产；JHTONE实际停止、所有缺口修复和新版本验收尚未完成。**
