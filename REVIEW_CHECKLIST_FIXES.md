# 外部审查清单修复台账

2026-10-28工单API关闭/重开追加（R186关联调用链）：current token/user/app/grant及当前ticket归属/status同事务，返回实际记录；累计160真实PG+bearer竞争、双类型正常/重放/错误动作与DB故障回滚通过takeover-ticket-public-status-final.log，7守卫/build/types通过。其它API与普通事件通知/外部持久投递、完整ABA和真机仍待，327未完成。

2026-10-28工单API回复追加（R186关联调用链）：PAT/POA当前授权现保护消息与状态/响应时限同事务；累计68创建/回复真实PG+bearer竞争通过takeover-ticket-public-reply-r1.log，正常解决后回复重开、网站42回归、7守卫/build/types通过。关闭/重开入口及其它API仍待，327不记完成。

2026-10-28工单API授权追加（R186关联调用链）：创建同事务复核当前PAT/POA及user/app/grant权限、身份、到期/撤销；34真实PG+bearer路由竞争及有效创建、撤销锁等待通过takeover-ticket-public-create-r1.log，网站42权限与关联目标回归、7守卫/build/types通过。回复/关闭及其它Public API写入尚未接此保护，不扩大为全API/327完成；详见HANDOFF。

2026-10-28旧恢复回滚追加：缺失持久副本身份的FAILED任务在连接宿主前拒绝409，owner/host owner/admin实际PG/Fastify均零远端I/O；原授权/stop矩阵、3守卫和server build/type-check通过。f6571c6已推且CI40656767813成功；完整恢复续跑/人工回滚仍待，随后继续R1-183。

2026-10-28恢复替换追加（R069实际运行后端、R137关联边界）：原/临时UUID和设备/原池、固定资源清单、阶段/operation已持久；替换不动原双栈forward，异常/重启/超时保留副本及PROCESSING门禁，末尾DB清理与完成同事务。真实PG/mTLS15故障场景、授权/传输/上传删除回归、5/5守卫、后端构建/类型与第228迁移升级通过，见HANDOFF。持久续跑、安全人工rollback、真实Incus磁盘/网络和SIGKILL仍待，327整体不改为完成。

2026-10-28恢复停止确认追加：1299ce6授权阶段已推送；worker不再吞stop异常，90秒共用截止与Stopped确认、未知状态拒绝，导入前失败零临时清理/禁止错误回滚；真实mTLS和PG/Fastify worker专项、5/5守卫通过，见HANDOFF。下一步处理原/临时UUID、唯一副本与持久门禁；发现普通deleteInstance会删除独占IPv4/IPv6转发，恢复替换需要独立路径与完整网络核验，未提前记完成。

2026-10-28恢复任务授权追加（R069实际运行队列、R137关联边界）：入队/领取/执行准备 current actor/session、实例与host/backup绑定、独立owner、10任务队列与工作流门禁，取消和无远端任务拒回滚已修；持久attempt CAS/UUID临时名、固定恢复主连接与准备失败零远端补偿。真实PG/Fastify/mTLS专项、上传删除回归、4/4守卫、server类型/构建及227迁移通过，见HANDOFF顶部。远端阶段UUID/副本完整性/停止确认/持久恢复与rollback仍未完成，不上调R137或327整体状态。

2026-10-28恢复传输追加：5a8f9e5删除阶段已推；恢复POST+等待共享截止和取消，原TLS身份、来源释放、终态失败立即退出、精确404存在性、错误响应限长通过实际mTLS专项，新增入口接CI。类型/构建和3/3守卫见HANDOFF；restore worker原副本/UUID/授权与持久恢复继续待修。

2026-10-28备份删除追加：8d73ab3已推且CI7/7；删除改current actor/instance/host/backup共享锁、精确HTTP404确认、失败保留本地记录，锁内拒并发上传/恢复。真实PG/Fastify/mTLS含远端成功/PG提交失败/精确404重试通过；4/4守卫、类型/构建见HANDOFF。同步删除不算强杀持久恢复，R137关联资源与327仍保持未完整。

2026-10-28上传执行批次追加：eac0b06已推且CI 7/7；每claim持久UUID/文件名、30秒退避、旧attempt回执和远端补偿隔离、重启/空开始时间中断及清理未确认记录通过真实PG/mTLS专项。长文件名保留唯一后缀；5/5守卫、第226迁移升级、类型/构建见HANDOFF。未把中断标记算完整远端恢复，327状态不整体上调。

2026-10-28备份队列追加（R069实际运行后端、R137转移关联边界）：上传入队/领取/执行准备固定actor/session及实例/备份/host/storage身份；当前归属、未决操作、host队列上限、取消与存储删除竞争已补。真实PG/Fastify/mTLS专项、5/5守卫、类型/构建和第225迁移升级证据见HANDOFF顶部；不新增虚构原编号、不把该阶段算R137或327整体完成。远端attempt持久恢复及create/delete/restore继续。

2026-10-28导出专项：修复独立Incus备份export Agent丢失server pin、主动enqueue无限缓存和取消不终止源连接；按需流、30分钟总截止、错误体限长及来源关闭已验。真实mTLS正常/换证书拒绝/背压/无人读取及外部取消/legacy，真实PG上传回归通过；8465e9d CI 7/7通过。备份恢复持久身份等剩余范围见HANDOFF，不上调327整体状态。

2026-10-28备份上传追加：相同秒不同任务文件名加入taskId、终态/不存在/本进程重复执行零远端，真实PG/mTLS+存储替身验证通过。日志失败误删初判经helper内部catch与真实trigger纠正，未将已有保护算新增修复。任务授权/归属、持久恢复和导出专用TLS仍待，详见HANDOFF顶部。此前积压c277ba3与依赖修正437ff02已推送，437ff02源码CI 7/7通过；327与完整网关仍未完成。

2026-10-28自动快照追加：持久计划、先新后旧、原身份/在途任务确认、五次退避及原操作重试，25个真实PG/mTLS边界场景通过；快照页真实后端浏览器、全量188/188、224新鲜迁移通过，证据见HANDOFF顶部。R133/136相关手工快照当前锁内复核与自动快照门禁已补；手工操作自己的进程强杀回执和其它生命周期仍待，继续部分状态。

2026-10-27 持续记录。初审见REVIEW_CHECKLIST_AUDIT.md；原327编号全部保留。已改源码不等于完成；尚未覆盖运行、UI或真机者继续标待验。一机一卖与客户保护保持，本阶段未发布/部署。

2026-10-28接手进展：R133/134/136/137/138转移已改固定原资源清单、先清理后交割、失败持久processing、原目标名称/host身份/UUID及会话复核、双协议端口计数、确认删除和DB失败幂等恢复。`takeover-transfer-cleanup-integration.log` 14场景及 `takeover-transfer-routes-integration.log` 通过（真PG、Incus/Caddy边界替身）；进程强杀、页面重试、真实Linux Incus及其它生命周期仍在补验，条目继续部分状态。此前自动快照/巡检/Caddy/IPv4 supersede证据与剩余缺口详见HANDOFF接手章节；327项未整体完成。

额外优先bug：用户自行销毁不退款，单台/批量源码与隔离PG+mTLS接口验证通过，页面文案不改；真Incus/生产未验。证据见HANDOFF.md与logs/review-user-no-refund-integration.log。

| 编号 | 初审 | 本阶段状态 | 修改及验证 |
|---|---|---|---|
| R1-001 | 存在 | 源码已改/验证范围见右栏 | security.ts 重置共享正则 lastIndex；core boundaries |
| R1-002 | 部分存在 | 源码已修/隔离PG验证通过 | 邮箱注册锁、验证码次数/用途/过期与业务提交同事务；注册/profile/reset并发、旧认证状态及撤销故障回滚通过 logs/review-verification-integration-profile.log；admin创建大小写邮箱/初始状态配额及重置通过 logs/review-admin-account-integration.log；未生产验收 |
| R1-003 | 存在 | 源码已修/隔离PG验证通过 | 2FA状态CAS、恢复码单次消费、完整已验证认证字段、enable/disable同事务撤销；logs/review-2fa-integration-latest.log；密码修改同事务通过 logs/review-verification-integration-profile.log |
| R1-004 | 存在 | 源码已修/隔离PG验证通过 | 2FA状态CAS、恢复码单次消费、完整已验证认证字段、enable/disable同事务撤销；logs/review-2fa-integration-latest.log；密码修改同事务通过 logs/review-verification-integration-profile.log |
| R1-005 | 已有防护 | 保留初审结论 | nonce按到期逐项移除，没有在TTL内整表clear；保留单Node部署约束。 |
| R1-006 | 部分存在 | 源码已修/隔离PG验证通过 | 实际缺口在oauth.ts绑定/回调：binding身份及updatedAt CAS、current user/session、callback起始认证时间、exchange当前角色与绑定；自助解绑和撤销同事务。logs/review-oauth-integration-final.log；provider HTTPS为fetch夹具 |
| R1-007 | 已有防护 | 保留初审结论 | 已有反斜杠、编码与控制字符的严格校验。 |
| R1-008 | 部分存在 | 待精修/运行复核 | 空秘密/UNCHANGED已有保留逻辑；繁体整组文案须独立核验，不根据旧清单判断缺失。 |
| R1-009 | 存在 | 部分精修/继续核查 | 账号与OAuth自助解绑同事务撤销，callback/exchange拒旧绑定与在途撤销；故障回滚通过 review-admin-account-integration.log、review-oauth-integration-final.log；其它入口仍按原编号继续 |
| R1-010 | 实现不同 | 保留初审结论 | 请求认证读取最新用户和invalidations；无对方30秒正向认证缓存，多后端副本本项目不支持。 |
| R1-011 | 部分存在 | 源码已修/隔离PG验证通过 | 邮箱注册锁、验证码次数/用途/过期与业务提交同事务；注册/profile/reset并发、旧认证状态及撤销故障回滚通过 logs/review-verification-integration-profile.log；admin创建大小写邮箱/初始状态配额及重置通过 logs/review-admin-account-integration.log；未生产验收 |
| R1-012 | 存在 | 源码已修/隔离PG验证通过 | 2FA状态CAS、恢复码单次消费、完整已验证认证字段、enable/disable同事务撤销；logs/review-2fa-integration-latest.log；密码修改同事务通过 logs/review-verification-integration-profile.log |
| R1-013 | 部分存在 | 待精修/运行复核 | 禁用直接调用API，未接SensitiveVerificationModal；倒计时与三语需另核。 |
| R1-014 | 部分存在 | 源码已修/隔离PG验证通过 | 邮箱注册锁、验证码次数/用途/过期与业务提交同事务；注册/profile/reset并发、旧认证状态及撤销故障回滚通过 logs/review-verification-integration-profile.log；admin创建大小写邮箱/初始状态配额及重置通过 logs/review-admin-account-integration.log；未生产验收 |
| R1-015 | 部分存在 | 源码已修/隔离PG验证通过 | 删除事务锁actor/target并重新检查角色、余额、全部关联阻断；保留原FK冲突及库存关联；真实PG角色提升占锁后删除拒绝及非零余额保护通过 logs/review-admin-account-integration.log |
| R1-016 | 存在 | 源码已修/隔离PG验证通过 | 异步RSA4096、真实ssh2/crypto公钥解析、单行/canonical blob、账户锁串行duplicate/20上限及当前角色状态会话；logs/review-ssh-keys-integration-final.log |
| R1-017 | 实现不同 | 源码已修/隔离PG验证通过 | 邮箱注册锁、验证码次数/用途/过期与业务提交同事务；注册/profile/reset并发、旧认证状态及撤销故障回滚通过 logs/review-verification-integration-profile.log；admin创建大小写邮箱/初始状态配额及重置通过 logs/review-admin-account-integration.log；未生产验收 |
| R1-018 | 部分存在 | 源码已修/隔离PG验证通过 | 邀请码handler/支付fee own-property访问拒继承；通知完整正整数及PG offset上限；真实Fastify/PG非法后缀、小数、溢出、有效筛选分页与账目无写入通过 logs/review-config-pagination-integration.log；相关5/5 logs/test-run-20261027-200553 |
| R1-019 | 部分存在 | 源码已修/隔离PG验证通过 | 初审纠正：N+1、单页用户全部登录历史读取、avatar_badge_id漏映射三项均存在；固定批量列表1人/100人均11SQL，2002历史仅返回1，徽章/统计/演示脱敏正确。logs/review-user-list-integration-final.log；type与相关5项通过 |
| R1-020 | 部分存在 | 待精修/运行复核 | 用户页和登录记录已有限幅正整数parser，实例页也有专用parser；完整选择器的客户端单页读取另见R301，不能报告所有分页均NaN/无上限。 |
| R1-021 | 存在 | 待精修/运行复核 | handleDone清result后handleClose不再触发success；失败重试结果替换会遗失已成功计数。 |
| R1-022 | 已有防护 | 保留初审结论 | 目标完整性及流量BigInt安全输入已有校验，不能移植旧负值修法。 |
| R1-023 | 已有防护 | 保留初审结论 | 目标完整性及流量BigInt安全输入已有校验，不能移植旧负值修法。 |
| R1-024 | 存在 | 部分精修/隔离PG验证通过 | 每实例共享操作锁、current actor/session/host/target/readiness/tasks/transfer门禁，队列只留目标身份，重试重新核验；review-batch-config-integration-final.log、4项相关守卫及最终batch守卫通过。进程远端写后崩溃仍缺持久计划/恢复 |
| R1-025 | 存在 | 部分精修/隔离PG验证通过 | 资源/配额/SWAP/高级字段与host当前差值同事务，取消批末旧增量；并发同值不重复计数，部分远端失败requiresReview且不盲目重试，准确审计限时写入。review-batch-config-integration-final.log；真实Incus/崩溃恢复未验 |
| R1-026 | 部分存在 | 部分精修/继续核查 | 原账号/quota重算/托管余额已验；本轮普通余额adjust/gift及调账申请/批准/驳回current admin/session事务门禁通过review-admin-balance-integration.log、相关4/4 test-run-20261027-231225。orders独立操作case/Public API在途资格及配额设置仍需继续核查 |
| R1-027 | 存在 | 源码已修/隔离PG验证通过 | increaseOwnQuota锁当前user/quota、当前步长与50%usage、status/session复核；7并发仅1增额，旧请求不降低新限额。logs/review-quota-hosting-integration.log |
| R1-028 | 存在 | 源码已修/隔离PG验证通过 | autoRenew共享instance锁、current owner/status/paid/cleanup/session CAS；真实单/批route及旧owner拒绝。logs/review-renewal-integration.log |
| R1-029 | 已有防护 | 保留初审结论 | 自动续费updateMany重新核对autoRenewEligibility及expires/version，旧候选不直接决定扣款。 |
| R1-030 | 存在 | 源码已修/隔离PG验证通过 | 过期续费periodStart与end均以now为起点，未到期以原expiry；period/refund基数、并发仅1扣款和ledger失败全回滚。logs/review-renewal-integration.log |
| R1-031 | 部分存在 | 部分精修/继续核查 | renewal事务内锁instance/host/accounts及余额、当前owner/status/plan/expiry/托管资格/session，6旧snapshot仅1成功；logs/review-renewal-integration.log。Public API在途PAT撤销另评 |
| R1-032 | 部分存在 | 源码已修/隔离PG验证通过 | 纠正初审：两个返佣helper原缺enabled，邮箱续费可给已禁用码返佣。现AFF资格/费率锁到结算、旧绑定迁移保留、admin current session；顶层host/user/AFF顺序复审，竞争409零写并保留自动续费预算。review-aff-eligibility-integration.log、8/8 test-run-20261027-231442；真实Incus新购/迁移未验 |
| R1-033 | 存在 | 源码已修/隔离PG验证通过 | AFF转换余额锁内current active/session；中途封禁与注销拦截、6并发余额仅支持5笔、ledger故障全回滚。logs/review-finance-authorization-integration.log |
| R1-034 | 部分存在 | 源码已修/隔离PG验证通过 | AFF批准/拒绝事务内current admin/session、pending CAS；中途降权两入口拒绝与重复批准仅1结算。logs/review-finance-authorization-integration.log |
| R1-035 | 已有防护 | 保留初审结论 | 失败/取消条件限定pending或paid，不覆盖completed。 |
| R1-036 | 存在 | 源码已修/隔离PG验证通过 | 严格正十进制付款金额补齐用户查询/回调及管理员sync；真实PG/Fastify admin sync拒缺失/0/后缀/负/NaN且不写账。logs/review-finance-authorization-integration.log；provider fetch夹具 |
| R1-037 | 存在 | 源码已修/隔离PG验证通过 | 纠正接续摘要：recharge.ts手动complete/fail和admin-billing.ts sync均实际存在；传actor到tx检查current admin/session，自动供应商完成保留。中途降权/注销拒写、重复到账1笔、ledger故障回滚。logs/review-finance-authorization-integration.log |
| R1-038 | 存在 | 源码已修/隔离PG验证通过 | 邀请码handler/支付fee own-property访问拒继承；通知完整正整数及PG offset上限；真实Fastify/PG非法后缀、小数、溢出、有效筛选分页与账目无写入通过 logs/review-config-pagination-integration.log；相关5/5 logs/test-run-20261027-200553 |
| R1-039 | 已有防护 | 保留初审结论 | 渠道getter统一decryptProviderConfig，再用于同步查询，原未解密问题不成立。 |
| R1-040 | 已有防护 | 保留初审结论 | 到账消息仅completion.completedNow发送，已有重复完成门禁。 |
| R1-041 | 部分存在 | 源码已修/隔离PG验证通过 | 所有卡密admin mutation传actor，tx current admin/session和直接PG读取allowlist；中途降权7入口及cached allowlist移除拒写。用户发行/撤销current session；正常退款一次规则保留。logs/review-finance-authorization-integration.log |
| R1-042 | 部分存在 | 源码已修/隔离PG验证通过 | redeem余额/card锁后current active/session，封禁/注销拒写、并发5仅1兑换；保留issuer不可自兑及过期持久化、撤销一次退款。logs/review-finance-authorization-integration.log |
| R1-043 | 已有防护 | 保留初审结论 | 生成数量已有安全整数和范围验证，不再静默截断。 |
| R1-044 | 实现不同 | 保留初审结论 | 当前表单常驻且固定第一页100条；无对方所述弹窗关闭或末页分页实现，超100条展示另评。 |
| R1-045 | 部分存在 | 源码已修/隔离PG验证通过 | 邀请码handler/支付fee own-property访问拒继承；通知完整正整数及PG offset上限；真实Fastify/PG非法后缀、小数、溢出、有效筛选分页与账目无写入通过 logs/review-config-pagination-integration.log；相关5/5 logs/test-run-20261027-200553 |
| R1-046 | 实现不同 | 保留初审结论 | 当前表单常驻且固定第一页100条；无对方所述弹窗关闭或末页分页实现，超100条展示另评。 |
| R1-047 | 已有防护 | 保留初审结论 | 通知enum已normalize且资源ID严格正安全整数；admin-notification-channels同样。原unchecked enum/数字前缀问题不成立。 |
| R1-048 | 存在 | 待精修/运行复核 | load缺请求代次，未读视图标记已读后不移出旧列表；删末条total--但不回退越界页。待浏览器延迟夹具。 |
| R1-049 | 存在 | 源码已修/隔离PG验证通过 | admin direct/broadcast current actor/session锁内核验，消息与history同事务；降权/注销拒写、history trigger失败全回滚。logs/review-inbox-send-integration.log，相关4/4 logs/test-run-20261027-224442 |
| R1-050 | 存在 | 源码已修/隔离PG验证通过 | host/instance通知锁实例/host/current accounts后重新选收件人；host转移拒发送，实例新归属收到且旧owner无消息，冲突409；批量邮件同事务入队、单邮件用已提交授权快照。logs/review-inbox-send-integration.log；未发送SMTP |
| R1-051 | 存在 | 源码已修/隔离PG验证通过 | 四入口inbox/history同事务，批量email queue也同提交；history或queue trigger失败消息/历史/任务均0，保留每60秒队列排期。logs/review-inbox-send-integration.log |
| R1-052 | 部分存在 | 源码已修/隔离PG验证通过 | email timeout包含NULL且不抢fresh；instance startup/runtime均按exact startedAt/retryCount/type/status和到期复核，仅已变更才通知；old candidate不覆盖new attempt。logs/review-queue-sync-integration-final.log |
| R1-053 | 部分存在 | 源码已修/隔离PG验证通过 | 邮件与实例finalizer绑定claim startedAt+retryCount，旧/重复完成拒绝；超时回收同样CAS。logs/review-queue-sync-integration-final.log |
| R1-054 | 部分存在 | 待精修/运行复核 | 旧unread响应可覆盖本地清除；layout卸载轮询清理须逐条检查实际调用。 |
| R1-055 | 存在 | 待精修/运行复核 | Dashboard/SSH缓存缺完整账户session隔离；会话切换后可能复用上一账户结果。待延迟响应浏览器夹具。 |
| R1-056 | 存在 | 待精修/运行复核 | identity读取与refresh缺generation绑定；旧请求可能回写新会话或用替换账户token重试旧操作。待会话切换动态验证。 |
| R1-057 | 存在 | 待精修/运行复核 | identity读取与refresh缺generation绑定；旧请求可能回写新会话或用替换账户token重试旧操作。待会话切换动态验证。 |
| R1-058 | 存在 | 待精修/运行复核 | mount await后建立timer，卸载清理先发生仍会重建轮询。 |
| R1-059 | 部分存在 | 待精修/运行复核 | startRestore未在首个await前占busy，全局activeTask在轮询完成后被直接回写，缺账户/任务代次。BackupManager当前消费者可达性与后端实际备份栈不同，不能据此删平台OSS。 |
| R1-060 | 实现不同 | 保留初审结论 | 前端疑似无当前页面消费者；不代表后端或平台OSS备份已退役，不据此删除整栈。 |
| R1-061 | 存在 | 待精修/运行复核 | 策略API返回Boolean，编辑读取enabled===1导致已启用策略显示关闭。 |
| R1-062 | 存在 | 待精修/运行复核 | 快照变更缺session/target generation及完整busy门禁，旧完成可能覆盖草稿或卸载后继续。 |
| R1-063 | 部分存在 | 待精修/运行复核 | 请求authenticateUser已有认证，快照权限依赖先读的user/instance/hostOwner；写入前缺统一最新actor资格核验，封禁/降权在途边界待DB复现。 |
| R1-064 | 存在 | 待精修/运行复核 | 删除/恢复/策略先校验快照与实例后异步远端操作，删除未与恢复统一锁；转移后仍可能作用旧目标。 |
| R1-065 | 存在 | 待精修/运行复核 | upsert create有nextRunAt而update只有enabled/intervalMinutes，修改间隔保留旧下次执行时间。 |
| R1-066 | 已有防护 | 保留初审结论 | parsePositiveId严格正整数及safe integer；不接受小数ID。 |
| R1-067 | 存在 | 待精修/运行复核 | scheduler失败后updateSnapshotPolicyLastRun重新读interval却不核对enabled/原schedule再写，旧失败可覆盖新排程。 |
| R1-068 | 部分存在 | 待精修/运行复核 | 锁后重读policy/instance/host eligibility，旧排队资格已有保护；执行后异步通知仍沿用该次快照的名称/归属。 |
| R1-069 | 实现不同 | 保留初审结论 | backupRoutes/storageConfig和restoreTaskWorker/backupUploadWorker实际注册启动；本库客机备份后端未退役。 |
| R1-070 | 实现不同 | 保留初审结论 | storage配置与provider栈仍有后端消费者，不能因前端孤立按对方方案删掉。 |
| R1-071 | 存在 | 待精修/运行复核 | 提交selectedAvatarStyle，await后使用当时当前选择更新authStore，后来未提交的选择误标已保存。 |
| R1-072 | 存在 | 待精修/运行复核 | 应用页面未导入该孤立组件，仍重复Wallet界面实现；只属维护残留，不据此删除正在使用的Wallet或账务后端。 |
| R1-073 | 存在 | 待精修/运行复核 | 读列表/变更完成缺目标和请求代次绑定；过滤改变、替换草稿与重复行操作有竞态窗口。 |
| R1-074 | 存在 | 待精修/运行复核 | 读列表/变更完成缺目标和请求代次绑定；过滤改变、替换草稿与重复行操作有竞态窗口。 |
| R1-075 | 存在 | 待精修/运行复核 | 列表和生成/保存缺完整session/请求代次与busy函数门禁，旧响应和分页收缩未统一防护。 |
| R1-076 | 存在 | 待精修/运行复核 | 列表和生成/保存缺完整session/请求代次与busy函数门禁，旧响应和分页收缩未统一防护。 |
| R1-077 | 存在 | 待精修/运行复核 | 显示created_at而API字段createdAt，创建日期缺失。 |
| R1-078 | 存在 | 待精修/运行复核 | 列表无反序响应保护；UA先Linux/MacOS/Chrome再Android/iPhone/Opera导致误分类。 |
| R1-079 | 存在 | 待精修/运行复核 | 列表无反序响应保护；UA先Linux/MacOS/Chrome再Android/iPhone/Opera导致误分类。 |
| R1-080 | 存在 | 待精修/运行复核 | 绑定读取与操作结果未完整绑定目标/会话代次，旧链接/状态可回写。 |
| R1-081 | 存在 | 源码已修/代码复审/待Linux实跑 | Linux稳定inode flock、确认死亡旧PID可恢复，活PID/歧义/软链拒绝，不删除锁路径；owner强杀测试已写，Linux双架构vet/测试编译通过，Windows升级包通过；实际Linux故障注入待补 |
| R1-082 | 存在 | 源码已修/本机升级包通过 | 下载及gzip全部成员展开均限总大小，边界/损坏/超限不改旧文件；Windows升级包实际通过，Linux双架构vet/测试编译通过；正式Agent未发布 |
| R1-083 | 存在 | 源码已修/代码复审/待Linux实跑 | systemd定时任务优先，fallback有界等待--no-block确认，不遗留随defer cancel被杀的子进程；取消与deadline测试已写并双架构编译，真实systemd待补 |
| R1-084 | 待运行验证 | 源码已改/验证范围见右栏 | 捕获 Agent 原始报文 SHA256，兼容旧规范化哈希；wire-body/auth guard；真实Go/宿主待验 |
| R1-085 | 存在 | 源码已修/代码复审/待Linux实跑 | shutdown context贯穿list/state，20秒总截止、3并发，部分失败标truncated，超时不报告完整空列表；取消/部分失败测试已写，双架构vet/测试编译通过 |
| R1-086 | 存在 | 源码已修/代码复审/待Linux实跑 | 排除guest/guest-nice重复计数，解析防溢出；复审追加CPU累计计数倒退拒绝，正常/倒退/无变化/异常idle样本测试已写；双架构编译通过 |
| R1-087 | 存在 | 源码已修/代码复审/待Linux实跑 | 检测强制ModeSocket，普通文件拒绝与真实Unix socket测试已写，双架构vet/测试编译通过；Windows被基线Statfs调用阻断，未伪称实跑 |
| R1-088 | 已有防护 | 保留初审结论 | 已有目录准备、preflight/staging及dry-run凭据处理；不照搬旧覆盖安装修法，Linux真实安装另验。 |
| R1-089 | 已有防护 | 保留初审结论 | 已有目录准备、preflight/staging及dry-run凭据处理；不照搬旧覆盖安装修法，Linux真实安装另验。 |
| R1-090 | 已有防护 | 保留初审结论 | 已有目录准备、preflight/staging及dry-run凭据处理；不照搬旧覆盖安装修法，Linux真实安装另验。 |
| R1-091 | 存在 | 源码已修/隔离PG验证通过 | Agent凭据发行锁内复核current owner/actor/role/status/session或current host安装token；转移/封禁/注销/降权拒绝。logs/review-agent-credentials-integration.log；Go真安装未验 |
| R1-092 | 存在 | 源码已修/隔离PG验证通过 | identity/secret/nonce和install token同事务轮换，消费先decrypt/hash核验再CAS；7并发发行仅最新token，消费仅1次，故障回滚及坏密文不消费。logs/review-agent-credentials-integration.log |
| R1-093 | 存在 | 待精修/运行复核 | rotate与install token非原子；consume先写tokenUsed再decryptSecret，解密失败也消耗token。 |
| R1-094 | 存在 | 待精修/运行复核 | heartbeat认证后多个await，最终写入未约束enabled/status；禁用到写入窗口仍可上报。 |
| R1-095 | 已有防护 | 保留初审结论 | hostId使用parsePositiveId及safe integer，严格拒绝数字后缀。 |
| R1-096 | 存在 | 待精修/运行复核 | 升级metadata查询无singleflight且可超过Agent10秒请求期限，缓存miss重复拉取。 |
| R1-097 | 存在 | 待精修/运行复核 | 升级metadata查询无singleflight且可超过Agent10秒请求期限，缓存miss重复拉取。 |
| R1-098 | 存在 | 待精修/运行复核 | 轮询/操作缺目标代次绑定；clipboard未await；formatPercent对非法类型缺保护。各项浏览器动态复核未做。 |
| R1-099 | 存在 | 待精修/运行复核 | 轮询/操作缺目标代次绑定；clipboard未await；formatPercent对非法类型缺保护。各项浏览器动态复核未做。 |
| R1-100 | 存在 | 待精修/运行复核 | 轮询/操作缺目标代次绑定；clipboard未await；formatPercent对非法类型缺保护。各项浏览器动态复核未做。 |
| R1-101 | 存在 | 待精修/运行复核 | 轮询/操作缺目标代次绑定；clipboard未await；formatPercent对非法类型缺保护。各项浏览器动态复核未做。 |
| R1-102 | 存在 | 待精修/运行复核 | 宿主读取与操作无route generation；批量延期仅范围不integer并隐藏失败数；copy未等待clipboard。 |
| R1-103 | 存在 | 待精修/运行复核 | 宿主读取与操作无route generation；批量延期仅范围不integer并隐藏失败数；copy未等待clipboard。 |
| R1-104 | 存在 | 待精修/运行复核 | 宿主读取与操作无route generation；批量延期仅范围不integer并隐藏失败数；copy未等待clipboard。 |
| R1-105 | 存在 | 待精修/运行复核 | 宿主读取与操作无route generation；批量延期仅范围不integer并隐藏失败数；copy未等待clipboard。 |
| R1-106 | 存在 | 待精修/运行复核 | canSave未限制loading/初读成功；失败可保存默认策略，保存后loadPolicy覆盖新草稿。 |
| R1-107 | 存在 | 待精修/运行复核 | canSave未限制loading/初读成功；失败可保存默认策略，保存后loadPolicy覆盖新草稿。 |
| R1-108 | 存在 | 待精修/运行复核 | list/status/action缺host和request generation，失败残留旧数据，迟到结果可作用当前视图。 |
| R1-109 | 存在 | 待精修/运行复核 | list/status/action缺host和request generation，失败残留旧数据，迟到结果可作用当前视图。 |
| R1-110 | 存在 | 待精修/运行复核 | watch整个host重置draft；save函数缺busy guard，父刷新和重复提交边界不足。 |
| R1-111 | 存在 | 待精修/运行复核 | 清空location/IPv6转undefined，不传字段无法清空已有配置。 |
| R1-112 | 存在 | 待精修/运行复核 | 统一buildHostApiUrl重建连接地址，可能丢原协议、路径及默认443，改无关字段也变化。 |
| R1-113 | 存在 | 待精修/运行复核 | 节点类型警告虽前缀调用t，但正文warning.message及“套餐:”硬编码，繁体/英文不能完整本地化。 |
| R1-114 | 实现不同 | 保留初审结论 | 没有对方快速多租户库存数量编辑器；本库独占规格/库存枚举，saveSpec有busy及固定磁盘档。不得迁入对方库存数量模型。 |
| R1-115 | 实现不同 | 保留初审结论 | 本库通过独占规格和枚举机器管理库存，无对方必填stock输入清空为0的同类入口；保持一机一卖。 |
| R1-116 | 存在 | 源码已修/真实Caddy API验证通过 | v2域名无损ID；legacy exact host+ETag删除，避免label碰撞；HTTP-only protocol及automatic_https.skip同次提交。logs/review-caddy-proxy-final.log、review-caddy-runtime-validation-final.log；Windows原生Caddy2.11.7，Linux安装未验 |
| R1-117 | 存在 | 源码已修/真实Caddy API验证通过 | delete只吞实际HTTP404，正文404不吞500；legacy exact host和ETag；真实原生API删除/重放与TLS夹具500通过。logs/review-caddy-proxy-final.log、review-caddy-runtime-validation-final.log |
| R1-118 | 部分存在 | 源码已修/隔离PG验证通过 | Caddy generate/reset/confirm提交内current actor/session/owner及current credentials；下载token绑定签发会话/角色/归属/凭据，注销/转移/重置旧命令拒绝。logs/review-caddy-proxy-final.log；Linux安装未验 |
| R1-119 | 存在 | 源码已修/隔离PG验证通过 | host锁内生成/复用/重置，confirm前后核对owner/credential/port/address；probe期间password变更409且不启用。logs/review-caddy-proxy-final.log |
| R1-120 | 实现不同 | 保留初审结论 | 本库生成手工安装命令并保存凭据，没有对方持久后台Caddy安装任务；相关凭据更新竞态已列R119，不能套用对方任务原子化实现。 |
| R1-121 | 实现不同 | 保留初审结论 | 本库为手工Caddy shell安装，未找到对方后台取消任务/锁释放后继续安装模型；不将网关任务与Caddy任务混为一谈。 |
| R1-122 | 存在 | 源码已修/真实Caddy API验证通过 | HTTP-only automatic_https.skip与protocol匹配同一次ETag原子更新，保留已有绑定监听/其它服务器；真实HTTP请求到fixture upstream。logs/review-caddy-runtime-validation-final.log |
| R1-123 | 存在 | 部分精修/继续核查 | 远端拒删/缺配置保留DB error、atomic addSite拒绝保留旧config已验；远端已成功后SQL或commit失败仍缺持久恢复意图/补偿，需继续修。logs/review-caddy-proxy-final.log |
| R1-124 | 存在 | 部分精修/继续核查 | Caddy自身ETag原子reload回滚真实进程已验，但跨远端成功/DB失败仍未覆盖；hosts地址同步路径还保留旧快照及delete/add，须继续修 |
| R1-125 | 部分存在 | 源码已修/TLS行为验证通过 | CA内容hash、LRU100、app onClose；补每次request重取live Agent并刷新LRU，GET在途淘汰后POST续跑与旧client复用通过review-caddy-lifecycle.log；CA替换证据review-caddy-proxy-final.log |
| R1-126 | 存在 | 源码已修/隔离PG验证通过 | check-dns锁内current site pending且enabled才激活；DNS匹配但disabled pending无Caddy请求/无状态启用。DNS为夹具，logs/review-caddy-proxy-final.log |
| R1-127 | 存在 | 部分精修/继续核查 | 六入口current actor/session/owner与quota锁内重算通过review-caddy-proxy-final.log；共享锁只覆盖转移归属提交，后续R133旧资源清理仍未修，不能称真实完整转移并发安全 |
| R1-128 | 存在 | 源码已修/隔离PG验证通过 | current running/stopped、paid expiry/cleanup/billing pending、实例/恢复/备份任务及pending/processing transfer门禁；creating/error/deleted/suspended/过期/清理/busy实测拒绝。logs/review-caddy-proxy-final.log；无resourcesReleased字段 |
| R1-129 | 存在 | 源码已修/隔离PG验证通过 | PATCH及其它5入口锁内current actor/status/session/owner，remark-only同门禁；封禁6入口、注销/提升为admin及旧owner拒写。logs/review-caddy-proxy-final.log |
| R1-130 | 存在 | 部分精修/继续核查 | mutation共享instance锁，配置期间transfer提交等待、当前owner与字段合并通过review-caddy-proxy-final.log；真实transfer提交后仍全扫清理，R133需持久清单/门禁 |
| R1-131 | 存在 | 部分精修/继续核查 | 用户delete远端失败保留记录已验；转移清理和其它调用路径仍有失败丢DB及旧快照问题，R133待持久清单处理 |
| R1-132 | 已有防护 | 保留初审结论 | ID parser严格正整数与safe integer，拒绝后缀/小数，原数字前缀误操作已防。 |
| R1-133 | 存在 | 部分精修/隔离运行通过 | 转移先保存固定原站点/资源清单，清理确认后再交割；PG+mTLS/TLS十五场景含进程强杀通过takeover-transfer-cleanup-final.log。并发资源创建入口及真实Incus仍需联动复核。 |
| R1-134 | 存在 | 部分精修/隔离运行通过 | 原host/pin/UUID/owner/session与attempt逐阶段核验，处理中沿原计划重试；专属Incus名称、双栈/端口/磁盘字段保持。接收/推送及真实后端浏览器通过，真实客户网络未验。 |
| R1-135 | 部分存在 | 源码已修/TLS行为验证通过 | Caddy CA内容hash/LRU100/关闭已修，补request重取live Agent，GET在途淘汰后POST成功及旧client复用；review-caddy-lifecycle.log、review-caddy-proxy-final.log |
| R1-136 | 存在 | 部分精修/隔离运行通过 | 固定快照名精确列表确认删除，远端成功DB回滚和进程强杀后重试不重复删除；清单外资源阻止交割。其它快照/生命周期并发仍需联动复核。 |
| R1-137 | 存在 | 部分精修/隔离运行通过 | 固定备份名精确确认删除后标deleted，拒绝/未确认保持记录，远端成功DB失败可续做；takeover-transfer-cleanup-final.log。其它备份生命周期仍待验。 |
| R1-138 | 存在 | 源码已修/隔离运行通过 | 共享TCP/UDP及-v6设备确认后删除mapping，同事务重计host实际端口；专属端口不动。PG计数及DB失败重试通过takeover-transfer-cleanup-final.log；真实Incus规则另验。 |
| R1-139 | 部分存在 | 源码已修/隔离PG与mTLS验证通过 | 显式portMappings非空/数量匹配/声明private范围，结合原去重完整覆盖；both配额、自动分配及真实409建议后重提通过logs/review-batch-port-range-integration.log，Incus边界fixture |
| R1-140 | 已有防护 | 保留初审结论 | 统一finalMappings对公网NAT区间与both计数进行校验，冲突重试数组不直接跳过。 |
| R1-141 | 部分存在 | 源码已修/TLS行为验证通过 | 同R125连接池组，CA内容绑定和LRU生命周期、请求时复用live Agent已真实TLS验证；review-caddy-lifecycle.log |
| R1-142 | 存在 | 源码已修/隔离PG与TLS验证通过 | 两处用户sync的IP及ipv4SyncPending同事务，远端原子addSite，失败/DB提交失败保留flag；同IP再次sync重试、缺配置保留、suspended保护通过review-proxy-ipv4-sync-integration-final.log。无独立timer worker，其它网络入口未一并接入 |
| R1-143 | 部分存在 | 源码已修/隔离PG与TLS验证通过 | 同instance锁重读current site enabled/status、owner/incusId/host及证书登记身份，disable/转移/旧观察拒绝，Caddy错误不会进not-found删实例分支；review-proxy-ipv4-sync-integration-final.log，相关3/3 test-run-20261027-232329 |
| R1-144 | 部分存在 | 待精修/运行复核 | cleanupRecreatedInstanceRecords删proxySites；远端清理在源Caddy缺配置时跳过。不能因此把重建记录清理等同远端清理成功，需残留路由夹具。 |
| R1-145 | 存在 | 待精修/运行复核 | change_host事务先删proxySites并切host，之后才清源Caddy；失败时旧路由仍在而数据库重试依据已丢。 |
| R1-146 | 部分存在 | 源码已修/TLS行为验证通过 | 同R125连接池组，CA内容绑定和LRU生命周期、请求时复用live Agent已真实TLS验证；review-caddy-lifecycle.log |
| R1-147 | 存在 | 源码已修/真实Linux待验 | 从Incus实际eth1 routed设备恢复，成功不抛旧错；暂移/启动/恢复失败保留精确错误并恢复完整原devices；行为边界与recreate/cancel 3/3 logs/test-run-20261027-190006；不跳宿主/客户IPv6核验 |
| R1-148 | 存在 | 源码已修/真实Linux待验 | 从Incus实际eth1 routed设备恢复，成功不抛旧错；暂移/启动/恢复失败保留精确错误并恢复完整原devices；行为边界与recreate/cancel 3/3 logs/test-run-20261027-190006；不跳宿主/客户IPv6核验 |
| R1-149 | 存在 | 源码已修/真实Linux待验 | 从Incus实际eth1 routed设备恢复，成功不抛旧错；暂移/启动/恢复失败保留精确错误并恢复完整原devices；行为边界与recreate/cancel 3/3 logs/test-run-20261027-190006；不跳宿主/客户IPv6核验 |
| R1-150 | 存在 | 源码已修/隔离PG验证通过 | host锁内复核5轻任务上限、instance互斥及host/type/status=PENDING条件领取；取消不复活及heavy互斥通过 logs/review-task-claim-integration.log；执行尝试身份/超时继续复核 |
| R1-151 | 存在 | 源码已修/隔离PG验证通过 | host锁内复核5轻任务上限、instance互斥及host/type/status=PENDING条件领取；取消不复活及heavy互斥通过 logs/review-task-claim-integration.log；执行尝试身份/超时继续复核 |
| R1-152 | 已有防护 | 保留初审结论 | 路由task.hostId明确设targetHostId，worker以该字段取目标且executeChangeHostTask校验target；原hostId含义不一致导致全失败问题不成立。 |
| R1-153 | 存在 | 源码已改/验证范围见右栏 | Incus操作精确资源路径、取消状态和总期限及输出读取错误；core boundaries；真实Incus待验 |
| R1-154 | 存在 | 源码已改/验证范围见右栏 | Incus操作精确资源路径、取消状态和总期限及输出读取错误；core boundaries；真实Incus待验 |
| R1-155 | 存在 | 源码已改/验证范围见右栏 | Incus操作精确资源路径、取消状态和总期限及输出读取错误；core boundaries；真实Incus待验 |
| R1-156 | 存在 | 待精修/运行复核 | 旧镜像适配器经index导出，但相关list/get/pull/alias函数未发现运行调用者；长轮询waitForOperationLong只被该孤立适配器使用，属于维护残留，不代表正在使用的镜像交付退役。 |
| R1-157 | 存在 | 源码已改/验证范围见右栏 | Incus操作精确资源路径、取消状态和总期限及输出读取错误；core boundaries；真实Incus待验 |
| R1-158 | 存在 | 源码已修/行为与mTLS集成通过 | DB最新url/cert/key/fingerprint配置、singleflight/代次/lookup迟到保护，先失效后close；12并发/lookup/connect/close行为通过review-incus-pool守卫，删除真实PG+mTLS latest logs/review-user-no-refund-integration-latest.log |
| R1-159 | 存在 | 源码已修/行为与mTLS集成通过 | DB最新url/cert/key/fingerprint配置、singleflight/代次/lookup迟到保护，先失效后close；12并发/lookup/connect/close行为通过review-incus-pool守卫，删除真实PG+mTLS latest logs/review-user-no-refund-integration-latest.log |
| R1-160 | 存在 | 源码已修/行为与mTLS集成通过 | DB最新url/cert/key/fingerprint配置、singleflight/代次/lookup迟到保护，先失效后close；12并发/lookup/connect/close行为通过review-incus-pool守卫，删除真实PG+mTLS latest logs/review-user-no-refund-integration-latest.log |
| R1-161 | 存在 | 源码已改/验证范围见右栏 | Incus操作精确资源路径、取消状态和总期限及输出读取错误；core boundaries；真实Incus待验 |
| R1-162 | 存在 | 源码已改/验证范围见右栏 | Incus操作精确资源路径、取消状态和总期限及输出读取错误；core boundaries；真实Incus待验 |
| R1-163 | 存在 | 源码已改/验证范围见右栏 | Incus操作精确资源路径、取消状态和总期限及输出读取错误；core boundaries；真实Incus待验 |
| R1-164 | 存在 | 源码已改/验证范围见右栏 | Incus操作精确资源路径、取消状态和总期限及输出读取错误；core boundaries；真实Incus待验 |
| R1-165 | 存在 | 待精修/运行复核 | listNetworks/getNetwork只定义并经barrel导出，未发现业务调用者；IncusNetwork类型依赖该孤立模块。仅维护残留。 |
| R1-166 | 部分存在 | 待精修/运行复核 | 通用withRetry等只在本模块内部/注释出现，无应用导入，旧retry模块孤立；未找到对方四项JSON结构校验同类模块，不能凭清单删除其它实际校验。 |
| R1-167 | 存在 | 源码已改/验证范围见右栏 | Turnstile deadline、webhook bytes、审计解析/规则、VIP payload、env去重、抽奖概率、同步筛选；部分行为/守卫通过；签名、VIP、脚本、调度具体流程仍待 |
| R1-168 | 存在 | 源码已改/验证范围见右栏 | Turnstile deadline、webhook bytes、审计解析/规则、VIP payload、env去重、抽奖概率、同步筛选；部分行为/守卫通过；签名、VIP、脚本、调度具体流程仍待 |
| R1-169 | 存在 | 源码已改/验证范围见右栏 | Turnstile deadline、webhook bytes、审计解析/规则、VIP payload、env去重、抽奖概率、同步筛选；部分行为/守卫通过；签名、VIP、脚本、调度具体流程仍待 |
| R1-170 | 已有防护 | 保留初审结论 | 已有safeFetch连接时校验及AbortSignal.timeout，出站绕过问题不成立。 |
| R1-171 | 已有防护 | 保留初审结论 | login/register/forgot统一verifier，enabled=false直接跳过；完整site/secret条件一致。 |
| R1-172 | 存在 | 源码已改/验证范围见右栏 | Turnstile deadline、webhook bytes、审计解析/规则、VIP payload、env去重、抽奖概率、同步筛选；部分行为/守卫通过；签名、VIP、脚本、调度具体流程仍待 |
| R1-173 | 已有防护 | 保留初审结论 | 自定义Telegram发送已有AbortSignal.timeout，不按旧清单重复改。 |
| R1-174 | 部分存在 | 待精修/运行复核 | 异步前已注册close/error，断开后关闭新建连接；尚未activeSessions登记时的凭据撤销仍需复核。 |
| R1-175 | 已有防护 | 保留初审结论 | 重连等待后及新连接完成后核对activeSessions对象、reconnectGeneration和client状态，不符关闭新socket。 |
| R1-176 | 已有防护 | 保留初审结论 | 所有异步建连前同步claimTerminalConnection预留名额，close释放pending且release幂等。 |
| R1-177 | 部分存在 | 待精修/运行复核 | 票据领取后已有会话撤销检查和最新用户读取，再经实例/宿主/套餐await后createTerminalSession；最后建连前缺统一再验证，窗口待撤销/转移时序夹具，而非完全未认证。 |
| R1-178 | 已有防护 | 保留初审结论 | 事务advisory lock串行count和insert，100条上限已有并发保护。 |
| R1-179 | 存在 | 源码已修/隔离PG验证通过 | command创建上限同事务、current actor/status/session、编辑最新合并或仅patch提交字段、delete/update返回正确403/404；空白/重复/50及100上限/并发编辑/取消与撤销通过 logs/review-command-integration-final.log |
| R1-180 | 存在 | 源码已修/隔离PG验证通过 | command创建上限同事务、current actor/status/session、编辑最新合并或仅patch提交字段、delete/update返回正确403/404；空白/重复/50及100上限/并发编辑/取消与撤销通过 logs/review-command-integration-final.log |
| R1-181 | 已有防护 | 保留初审结论 | 逐项事务重新读resolved/最后回复，updateMany约束updatedAt；仅实际closedTickets发送通知日志。 |
| R1-182 | 已有防护 | 保留初审结论 | 逐项事务重新读resolved/最后回复，updateMany约束updatedAt；仅实际closedTickets发送通知日志。 |
| R1-183 | 部分存在 | 源码已修/隔离PG验证通过 | 完整十进制/safe integer与DB offset乘积限32位；四路由/helper非法及重复参数、有效二页/末页/100上限/偏移临界通过takeover-ticket-pagination-r3.log。数字搜索超PG整数范围按原文字匹配，重复search不500；4守卫、后端build与专项类型通过，浏览器/生产未验 |
| R1-184 | 部分存在（复审纠正） | 源码已修/隔离PG验证通过 | 原safe integer仍越过PG Int上限；实际2147483648复现500后加入2147483647上限。154路径/查询/正文非法ID400、最大合法但不存在404、正常200且无写入，分页回归/4守卫/build/types通过takeover-ticket-id-final.log |
| R1-185 | 部分存在（复审纠正） | 源码已修/隔离PG验证通过 | 错误可选ID原已拒绝而非静默丢弃，但PG范围未受限；可选instance/host及关联对象数字/字符串统一数据库整数范围，证据同R184。Public API其它资源边界单独待修 |
| R1-186 | 存在 | 部分精修/隔离PG验证通过 | 创建8+回复12+状态关闭10+删除3+备注3+链接3+通知3竞争通过takeover-ticket-notice-authorization-final.log；当前actor/session/归属与删除清单保护。显式通知站内信+备注原子提交、正文和当前作者、无重复站内信、默认通知回归通过；5守卫/build/types通过。普通事件通知目标/PAT/外部投递及附件持久清理仍待 |
| R1-187 | 存在 | 源码已修/隔离PG验证通过 | createTicket事务持instance/host行锁，重核owner/host/未删除，网站与Public API目标冲突409；实际PG/Fastify helper及网站6个行锁竞争、正常关联/无实例、首消息故障全回滚通过takeover-ticket-target-r1.log，4守卫与build/type通过。PAT/附件完整实跑及R186当前账户/通知仍待 |
| R1-188 | 已有防护 | 保留初审结论 | assertSafeHttpUrl+safeFetch连接校验，redirect manual；stream逐段限制MAX_TICKET_IMAGE_SIZE。 |
| R1-189 | 已有防护 | 保留初审结论 | assertSafeHttpUrl+safeFetch连接校验，redirect manual；stream逐段限制MAX_TICKET_IMAGE_SIZE。 |
| R1-190 | 部分存在 | 源码已修/隔离PG验证通过 | 原body异常已有502且INTERNAL_ERROR隐藏details；现固定区分超限/超时/读取失败。reader释放、请求abort及未读body取消覆盖HTTP/MIME/限长/中断；15实际PG/Fastify+截获fetch场景含真实15秒截止通过takeover-ticket-image-r1.log，5守卫/build/types通过，实际图床/浏览器未验 |
| R1-191 | 实现不同 | 保留初审结论 | 当前Telegram路由未发现Bot工单回复入口，主要绑定/webhook/群组功能；现行网站工单写入风险另见R186/187，不据旧Bot清单虚构本库运行调用链。 |
| R1-192 | 存在 | 源码已修/隔离PG验证通过 | command创建上限同事务、current actor/status/session、编辑最新合并或仅patch提交字段、delete/update返回正确403/404；空白/重复/50及100上限/并发编辑/取消与撤销通过 logs/review-command-integration-final.log |
| R1-193 | 存在 | 源码已修/隔离PG验证通过 | command创建上限同事务、current actor/status/session、编辑最新合并或仅patch提交字段、delete/update返回正确403/404；空白/重复/50及100上限/并发编辑/取消与撤销通过 logs/review-command-integration-final.log |
| R1-194 | 存在 | 源码已修/隔离PG验证通过 | command创建上限同事务、current actor/status/session、编辑最新合并或仅patch提交字段、delete/update返回正确403/404；空白/重复/50及100上限/并发编辑/取消与撤销通过 logs/review-command-integration-final.log |
| R1-195 | 已有防护 | 保留初审结论 | 严格数字正ID及safe integer，已拒绝小数/溢出。 |
| R1-196 | 存在 | 源码已修/隔离PG验证通过 | command创建上限同事务、current actor/status/session、编辑最新合并或仅patch提交字段、delete/update返回正确403/404；空白/重复/50及100上限/并发编辑/取消与撤销通过 logs/review-command-integration-final.log |
| R1-197 | 存在 | 源码已修/真实浏览器夹具通过 | distro/session序号与AbortController，切换清旧选择、迟到成功/失败/finally及卸载忽略，同SID刷新保留；三语失败重试、键盘/移动可用。真实Chrome源码组件延迟API矩阵takeover-init-selector-browser-final.log、3守卫/lint/双端build/dist边界通过；完整开通/重装未验 |
| R1-198 | 存在 | 源码已修/真实浏览器夹具通过 | 保存前同步门禁/固定ID和表单快照/成功锁存、等待中禁所有关闭入口、失败保草稿；目标/session/卸载隔离旧读写及计时器，同SID刷新保草稿，父先关窗再刷列表。takeover-init-editor-browser-final.log真实组件+父页面竞争通过，3守卫/lint/双端类型构建/dist边界通过；实际后端联调/请求幂等未验 |
| R1-199 | 存在 | 源码已修/真实浏览器夹具通过 | 详情ID/updatedAt/session代次、取消、清旧内容、标题正文一致；复制快照/回执及两计时器随关闭/卸载/复用失效，同SID刷新保留。takeover-init-detail-browser.log真实Chrome源码组件竞争、长内容三语/两尺寸通过，3守卫/lint/双端类型构建/dist边界通过；实际账户后端/系统剪贴板未验 |
| R1-200 | 存在 | 源码已修/真实浏览器夹具通过 | 固定enabled、逐行操作门禁/唯一标识、列表序号/session/取消、失败保留确认状态并重试、删除成功才移除、换会话/卸载旧回调失效。takeover-init-toggle-browser.log真实Chrome页面10次点击/交错列表/新旧会话/删除竞争通过；3守卫/lint/双端类型构建/dist边界通过，真实后端及跨浏览器CAS未验 |
| R1-201 | 存在 | 退役残留已清理/类型构建通过 | 完整读模块与DB入口后删除optimizations.ts及10个无调用导出；运行源码/脚本/部署无引用，takeover-retired-db-references/types/build/guards日志通过（2配额守卫），不改现行配额/实例逻辑或数据库。无活体入口可验，不计生产流程验收 |
| R1-202 | 已有防护 | 保留初审结论 | Discord使用safeFetch连接时校验；Telegram/Discord均有15秒AbortSignal，覆盖响应body读取期限。 |
| R1-203 | 已有防护 | 保留初审结论 | Discord使用safeFetch连接时校验；Telegram/Discord均有15秒AbortSignal，覆盖响应body读取期限。 |
| R1-204 | 存在 | 退役残留已清理/双端类型构建通过 | 删除LazyImage/VirtualList；双端入口/Vite无自动注册，源码/标签/脚本零调用。takeover-retired-components-references/guards/build/dist通过；无对应活体页面，现有业务图片/列表入口保留 |
| R1-205 | 实现不同 | 保留初审结论 | 未找到对方InstanceBillingTab账单面板；当前续费modal及独立Orders/Billing实现不同，不虚构相同关闭重开入口。 |
| R1-206 | 实现不同 | 保留初审结论 | 未找到对方实例账单面板分页实现；当前订单页另有分页，不能直接套用旧面板越界修法。 |
| R1-207 | 存在 | 退役残留已清理/双端类型构建通过 | 删除仅互引无消费者的PublicAuthShell/useM3Auth；PlanetScene原本不存在。takeover-retired-auth-references/guards/build/dist通过，2路由/i18n守卫，现行登录注册入口保留，无对应活体旧页面可验 |
| R1-208 | 存在 | 源码已修/隔离PG验证通过 | getInstancesToSync下推due筛选后take，165 fresh running不挤掉old stopped。logs/review-queue-sync-integration-final.log；真实Linux周期sync仍待 |
| R1-209 | 已有防护 | 保留初审结论 | onUnmounted已remove全局click handler，原累积监听问题不成立。 |
| R1-210 | 部分存在 | 文档已精修/构建通过 | README正式v1.7.7、实例快照/备份后端与无独立标签/自动调度缺口、OSS不含VPS磁盘；中英部署说明Redis实际安装但无后端client、单Node、每版迁移与ENV_FILE。初审纠正安装器Redis非虚假残留；takeover-docs-facts-guards/build通过，不代表实装验收 |
| R1-211 | 存在 | 退役类型已清理/编译守卫通过 | 仅删除server兼容BackupPolicy/SnapshotPolicy及纠正SQLite文件头；Prisma模型/DB方法/client实际类型保留。takeover-retired-policy-references/build/guards通过，3备份/快照守卫，无数据库或运行行为改动 |
| R1-212 | 部分存在 | 已精修/仅注释 | 核对实际消费者后注明JWT sid是refresh SHA-256前32位、用户级用__USER_LEVEL__、iat边界与PG null唯一语义；AFF允许多个全局码；PackagePlan分与Instance/MailPlan元分开。邮箱订阅模块仍使用，纠正“旧模块”暗示。4守卫、Prisma validate、类型及去注释前后相等验证通过；无schema/runtime变更与迁移。 |
| R1-213 | 存在 | 退役工具已清理/构建守卫通过 | 删除无调用useTurnstile及utils的getGlobalTurnstile/getTurnstileToken/withTurnstile；保留现行可见组件与readTurnstileToken/focusTurnstileSection，保留GiftCards独立同名函数。引用检查与保留函数逐字相等、4守卫、双端类型build/dist、lint通过；无旧入口可实跑，不声称Cloudflare实站验证。 |
| R1-214 | 部分存在 | 待精修/运行复核 | getTimeGreeting在Dashboard、calculateDailyPrice在ChangePlan、calculateDiscountedPrice在Billing实际使用；getCycleDays/calculatePriceDiff等部分无client调用，不照搬全部六项删除。 |
| R1-215 | 存在 | 已修/既有行为复验 | formatBytes已支持PB/EB并钳制单位索引，非有限数/非正数返回0 B；本轮复跑core-boundaries的1024**5、1024**6与Infinity断言通过（logs/takeover-format-bytes-evidence.log）。纠正本行曾错填Cloud-init证据；未重复修改运行源码，不据此声称客户流量采集实测。 |
| R1-216 | 实现不同 | 保留初审结论 | 本库无对方PackageDetailView；当前套餐页面生命周期按现有入口另核，不能声称旧详情修法适用。 |
| R1-217 | 实现不同 | 保留初审结论 | 本库无对方PackageDetailView；当前套餐页面生命周期按现有入口另核，不能声称旧详情修法适用。 |
| R1-218 | 实现不同 | 保留初审结论 | 本库无对方PackageDetailView；当前套餐页面生命周期按现有入口另核，不能声称旧详情修法适用。 |
| R1-219 | 存在 | 读取阶段已精修/浏览器通过 | 当前App已排除PackageForm的KeepAlive，但同名路由切换仍复用；已按路由/ID/session失效旧详情与辅助列表/存储池、清表单并取消详情、核对响应ID。失败原地重试，未取得当前详情禁止保存，同SID刷新保草稿。真实Chrome/Vue Router延迟回执矩阵、3守卫、双端类型build/dist通过；保存后误跳转另列R220，真实后端套餐写入仍待。 |
| R1-220 | 存在 | 已精修/浏览器通过 | 保存同步门禁、固定ID与hostIds快照、saving/saved禁用字段、等待所选存储池；旧成功/失败/finally按上下文拒绝，离页不跳回，成功锁存防导航取消后重发。实际Chrome十连提交/失败重试/目标与会话切换/旧finally/离页/同SID/正常创建编辑通过；3守卫、双端types build/dist/lint通过。未加服务器幂等或超时结果协调。 |
| R1-221 | 存在 | 待精修/运行复核 | loadPackage无seq，保存用当前route；旧完成可导航离新页面；清description转undefined不能清已有值，SLA另验。 |
| R1-222 | 部分存在 | 已精修/本地Chrome通过 | 完整写入/裁剪同步登记waitUntil，写入与清空串行，新增256条上限；存储失败不丢成功网络响应，清空代次拒绝旧下载回填，限定本应用/当前版本缓存。受控延迟/280并发/故障恢复专项及真实Chrome双源注册、断网回退、清空、容量通过；路由守卫、双端类型build/dist通过。未生产部署；256是条目上限而非磁盘字节配额。 |
| R1-223 | 实现不同 | 保留初审结论 | 未找到对方依赖退役邮件模块的旧AFF脚本；本库两个AFF守卫有清单且已在181项基线实际通过。 |
| R1-224 | 实现不同 | 保留初审结论 | 未发现旧UserHistoryView；现行UsersView登录弹窗异步目标风险已列R305，不能虚构旧历史页面。 |
| R1-225 | 已有防护 | 保留初审结论 | refresh/action已有sequence、disposed和busy门禁，原旧请求覆盖新运行并停轮询已有保护。 |
| R1-226 | 部分存在 | 待精修/运行复核 | poll看document visibility，但缺组件v-show/KeepAlive激活门禁；Billing页面自身无同类timer。 |
| R1-227 | 存在 | 待精修/运行复核 | 无修改静态扫描178份SVG，48份含缺失url(#id)引用，如dark/aquarius的bg-a-air-d；未运行会重建目录的生成器。 |
| R1-228 | 存在 | 待精修/运行复核 | 生肖样式含animation...alternate transform-origin缺分号；aquarius内animation:art而未找到@keyframes art。静态生成资产证据，实际动效仍需浏览器。 |
| R1-229 | 存在 | 待精修/运行复核 | 全html正则收集<style>块并逐SVG注入，连JSX {`...`}原文也重复输出到178资产的相关系列；未运行会重建目录的生成器。 |
| R1-230 | 存在 | 待精修/运行复核 | 仅watch badgeId/theme，目录返回真实assetURL后不清fallback状态。 |
| R1-231 | 存在 | 待精修/运行复核 | onMounted loadOverview，缺onActivated及请求代次/卸载保护；缓存返回不刷新、旧完成仍回写。 |
| R1-232 | 存在 | 待精修/运行复核 | 仅watch visible无immediate；emit可沿用旧ownership结果，初始打开/关闭重开需要代次绑定。 |
| R1-233 | 存在 | 待精修/运行复核 | 仅watch visible无immediate；emit可沿用旧ownership结果，初始打开/关闭重开需要代次绑定。 |
| R1-234 | 已有防护 | 保留初审结论 | openNotificationModal先读取已保存notificationConfig回填表单，原未加载问题不成立。 |
| R1-235 | 存在 | 待精修/运行复核 | 保存补货以旧remainQuantity+replenishAmount提交adminUpdatePrize，可覆盖期间抽奖减少的库存。 |
| R1-236 | 存在 | 源码已改/验证范围见右栏 | Turnstile deadline、webhook bytes、审计解析/规则、VIP payload、env去重、抽奖概率、同步筛选；部分行为/守卫通过；签名、VIP、脚本、调度具体流程仍待 |
| R1-237 | 存在 | 待精修/运行复核 | 旧CheckinModal无应用导入/注册调用者；当前签到入口走Entertainment实现，旧弹窗内分享辅助为孤立代码，未删除现行签到后端。 |
| R1-238 | 存在 | 待精修/运行复核 | description null??base恢复旧说明；逐条保存部分失败无成功id记录，重试重复；正小数舍入0后缺再次校验，后端同步核验。 |
| R1-239 | 存在 | 待精修/运行复核 | description null??base恢复旧说明；逐条保存部分失败无成功id记录，重试重复；正小数舍入0后缺再次校验，后端同步核验。 |
| R1-240 | 存在 | 待精修/运行复核 | description null??base恢复旧说明；逐条保存部分失败无成功id记录，重试重复；正小数舍入0后缺再次校验，后端同步核验。 |
| R1-241 | 存在 | 待精修/运行复核 | loadBenefits缺sequence及activated生命周期，页面返回/旧请求的刷新与失败恢复缺口仍在。 |
| R1-242 | 存在 | 待精修/运行复核 | claimAll只按bulkClaiming门禁，不拒已有claimingIds，单项与批量可重叠；load旧概览也无代次。 |
| R1-243 | 存在 | 待精修/运行复核 | 领取反馈优先旧reward卡片而非claim snapshot，setTimeout无卸载清理，可能跨页显示过时数额/反馈。 |
| R1-244 | 存在 | 源码已改/验证范围见右栏 | Turnstile deadline、webhook bytes、审计解析/规则、VIP payload、env去重、抽奖概率、同步筛选；部分行为/守卫通过；签名、VIP、脚本、调度具体流程仍待 |
| R1-245 | 存在 | 待精修/运行复核 | 初读失败空表仍可保存，缺成功加载条件。 |
| R1-246 | 已有防护 | 保留初审结论 | ResourceSlider/ResourceSliders/PackageSelector仍由InstanceCreateView、AdminInstanceCreateView、HostCreateInstanceTab维护代码导入使用；原全退役结论不成立，保留。 |
| R1-247 | 存在 | 待精修/运行复核 | 套餐/镜像加载无seq；canSubmitGift未匹配当前targetUsername；完成反馈和初读缺目标/生命周期保护。 |
| R1-248 | 存在 | 待精修/运行复核 | 套餐/镜像加载无seq；canSubmitGift未匹配当前targetUsername；完成反馈和初读缺目标/生命周期保护。 |
| R1-249 | 存在 | 待精修/运行复核 | 套餐/镜像加载无seq；canSubmitGift未匹配当前targetUsername；完成反馈和初读缺目标/生命周期保护。 |
| R1-250 | 存在 | 待精修/运行复核 | 套餐/镜像加载无seq；canSubmitGift未匹配当前targetUsername；完成反馈和初读缺目标/生命周期保护。 |
| R1-251 | 已有防护 | 保留初审结论 | username查询有seq且输入变化清目标，提交核对当前身份；不按旧修法改赠送归属。 |
| R1-252 | 存在 | 待精修/运行复核 | 创建完成toast/凭据/重置draft无dispose；canSubmit缺!imagesLoading，刷新中旧镜像仍可提交。 |
| R1-253 | 存在 | 待精修/运行复核 | 创建完成toast/凭据/重置draft无dispose；canSubmit缺!imagesLoading，刷新中旧镜像仍可提交。 |
| R1-254 | 存在 | 源码已修/真实脚本执行通过 | init-env现去重实现5次真实Bash执行覆盖fresh/重复身份保持/空重复/有效含等号值/CRLF/不打印生成材料；logs/review-init-env-execution-final.log、相关2/2 logs/test-run-20261027-224403。Windows执行不代表Linux权限验收 |
| R1-255 | 存在 | 待精修/运行复核 | 首次语言结果缓存，切语言和重开缺完整request generation，旧条款可能覆盖当前。 |
| R1-256 | 存在 | 待精修/运行复核 | 首次语言结果缓存，切语言和重开缺完整request generation，旧条款可能覆盖当前。 |
| R1-257 | 存在 | 源码已改/验证范围见右栏 | Markdown tokens渲染及DOMPurify白名单；jsdom；浏览器待验 |
| R1-258 | 存在 | 源码已改/验证范围见右栏 | Markdown tokens渲染及DOMPurify白名单；jsdom；浏览器待验 |
| R1-259 | 存在 | 源码已改/验证范围见右栏 | Markdown tokens渲染及DOMPurify白名单；jsdom；浏览器待验 |
| R1-260 | 待运行验证 | 源码已改/验证范围见右栏 | 三语邀请码控件/实际i18n运行及长地址换行；locale runtime；手机浏览器待验 |
| R1-261 | 实现不同 | 保留初审结论 | 本库新矢量地图/球体采用当前目录与坐标实现，未发现对方旧datacenter地图文件；不据此替换现行地图编码。 |
| R1-262 | 已有防护 | 保留初审结论 | update/delete/batch/usages使用ForHost约束且校验code归属host，旧跨节点缺口已有防护。 |
| R1-263 | 已有防护 | 保留初审结论 | 当前仅数据库移除有保留远端/磁盘及暂停销售说明，不能当完整销毁或释放可售库存。 |
| R1-264 | 部分存在 | 待精修/运行复核 | 付费实例所有者在锁内重读userId/状态和当前package/plan价格，原全部沿用旧归属/价格不成立；管理员/宿主免费分支仍用请求旧授权直接reset，付费分支未复核当前actor状态。 |
| R1-265 | 部分存在 | 待精修/运行复核 | 流量parser拒负数/非数字/超过PG bigint；实例更新缺省明确保留原值，但nullable parser将空字符串视null，清空与显式无限语义仍需按各入口核对，不能判全部允许负数。 |
| R1-266 | 已有防护 | 保留初审结论 | 地区official/market/zone有active/hidden/globalShared/owner角色及专区授权；好友地区限定getSharedToUser集合；所有者列表/admin scope有requireAdmin或isAdmin门禁。原无过滤泄露私有套餐问题的当前防护已定位。 |
| R1-267 | 已有防护 | 保留初审结论 | normalizePackagePlanInput以整数范围校验CPU/内存/磁盘/配额/价格/周期，流量通过PG bigint parser；不是直接缺省写负数/溢出。 |
| R1-268 | 已有防护 | 保留初审结论 | syncInstanceNetwork及removeInstanceIpv6向cloud-init传nicMacs，保留已有eth0/eth1 hwaddr或按实例生成；原完全忽略MAC匹配的代码已有防护，不拿此结论代替所有VM真机重启验收。 |
| R1-269 | 部分存在 | 待精修/运行复核 | managed路径成功updateMany已有status creating CAS；失败先回滚宿主资源/释放公网IPv4/补偿账目，之后远端delete失败被吞。实际残留/IP重分配风险需集成夹具；独占机器池路径的保护不能据此改为立即释放。 |
| R1-270 | 存在 | 待精修/运行复核 | 赠送DB提交后resolve storage可能失败无外层补偿；启动provision后日志/消息失败返回500误导重试。 |
| R1-271 | 存在 | 待精修/运行复核 | 网络结果持久化仅not deleted，缺host/version CAS；旧Incus结果可覆盖迁移/任务后新状态。 |
| R1-272 | 部分存在 | 待精修/运行复核 | quota API已有整数范围及显式0校验，null转undefined不能清空；缺current site count和实例锁，与创建不串行。 |
| R1-273 | 已有防护 | 保留初审结论 | helper的设备/DB回滚在helper内完成，路由成功日志在helper返回之后，不再因路由审计异常进入设备回滚。 |
| R1-274 | 存在 | 待精修/运行复核 | giftDays按旧实例expires/status写，无version/实例锁，覆盖并发续费/销毁/迁移/封停风险。 |
| R1-275 | 已有防护 | 保留初审结论 | 远端失败回滚previousProcesses并返回500，回滚失败PARTIAL_FAILURE；原假成功阻重试问题不成立。 |
| R1-276 | 已有防护 | 保留初审结论 | requiresIpv6ParentInterface仅当前或旧subnet有值时要求接口，IPv6全部留空可保存；清空已有值仍见R1-111。 |
| R1-277 | 已有防护 | 保留初审结论 | 审计使用parseHostAuditHistoryPageSize严格parser，与其他宽松分页不能混同。 |
| R1-278 | 已有防护 | 保留初审结论 | 销毁读取真实退款预览与已退款状态，无再次承诺全额；保持远端未删不释放资源。 |
| R1-279 | 存在 | 待精修/运行复核 | loadInstance await GET后直接回写无route sequence，后续端口读取instance.value可能换目标；actionLoading只是入口门禁。 |
| R1-280 | 部分存在 | 待精修/运行复核 | canTransfer核对输入用户名与targetUser，watch清目标且search核对searchedUsername，原失配已防；关闭重开代次另验。 |
| R1-281 | 存在 | 待精修/运行复核 | preview返回直接赋值、提交读取当前selectedPlanId，未绑定已预览套餐与当前选择。 |
| R1-282 | 存在 | 待精修/运行复核 | keep-alive仅unmount清键盘监听；cloud-init/命令结果缺完整会话代次；保存后清当前草稿；页签button嵌套button。 |
| R1-283 | 存在 | 待精修/运行复核 | keep-alive仅unmount清键盘监听；cloud-init/命令结果缺完整会话代次；保存后清当前草稿；页签button嵌套button。 |
| R1-284 | 存在 | 待精修/运行复核 | keep-alive仅unmount清键盘监听；cloud-init/命令结果缺完整会话代次；保存后清当前草稿；页签button嵌套button。 |
| R1-285 | 存在 | 待精修/运行复核 | openTicketDetail Promise.all后直接赋selectedTicket/messages；reply await后push当前messages并清当前draft，缺固定ticket代次。 |
| R1-286 | 部分存在 | 待精修/运行复核 | 已有latestRequestId，但核对后await loadStats再建timer，卸载/目标改变仍可在间隙发生。 |
| R1-287 | 存在 | 待精修/运行复核 | 预览捕获ID，确认却重新读selectedBillingActionIds，提交集合可与已预览付款对象不一致。 |
| R1-288 | 部分存在 | 待精修/运行复核 | 优惠码校验缺request sequence，旧结果可污染当前报价；首次专区来源是否错误需另对路由初始化，不按此一症状判全部成立。 |
| R1-289 | 存在 | 待精修/运行复核 | loadLogs缺请求代次，搜索反序完成能覆盖当前条件。 |
| R1-290 | 存在 | 待精修/运行复核 | Rebuild watch清失效SSH key但不清失效image；Recreate两者都不清，submit只验证非空而未验证当前列表成员。 |
| R1-291 | 存在 | 待精修/运行复核 | parseInt接受22x/22.5且22/022字符串判重失效；handleConfirm缺allValid函数守卫。 |
| R1-292 | 存在 | 待精修/运行复核 | removeFile及移除按钮未按disabled限制。 |
| R1-293 | 已有防护 | 保留初审结论 | 单点length===1用50；HostInfoTab也Math.max(length-1,1)，不除零。 |
| R1-294 | 实现不同 | 保留初审结论 | 安装默认hex16未满足通用复杂度，但实际init只校验12位/非占位符，不调用通用validatePassword；不能报告首装必失败。策略一致性另修。 |
| R1-295 | 存在 | 源码已改/验证范围见右栏 | 旧env解析失败保留原文件；installer guard |
| R1-296 | 已有防护 | 保留初审结论 | 升级summary版本变量已有定义，原未定义退出问题不成立。 |
| R1-297 | 部分存在 | 待精修/运行复核 | test seed无环境门禁；bulk seed用URL字符串includes和FORCE_BULK_SEED=1可覆盖，保护不足。未运行任何seed。 |
| R1-298 | 部分存在 | 待精修/运行复核 | 注入参数已先合并，旧拒绝问题已防；未给port与confirm仍read，非交互可等待终端。 |
| R1-299 | 存在 | 待精修/运行复核 | keep-alive仅unmount清键盘监听；cloud-init/命令结果缺完整会话代次；保存后清当前草稿；页签button嵌套button。 |
| R1-300 | 实现不同 | 保留初审结论 | 未发现对方余额转账/预览功能入口，不能误指现有实例PUSH或AFF兑换；新增同类功能时才适用。 |
| R1-301 | 部分存在 | 待精修/运行复核 | HostInventoryPanel列表有sequence/disposed且过滤selection；HostInstancesTab列表无seq，deletePreview有seq/selection而gift/pricing等缺，按具体操作分别修。 |
| R1-302 | 部分存在 | 待精修/运行复核 | getQuotaLimit用??保留0，getQuotaUsage(0)返回null；其它前端默认及代理后端siteLimit0按无限仍不一致，不能说所有0均被默认20/5覆盖。 |
| R1-303 | 存在 | 待精修/运行复核 | Storage/Redeem列表虽watch hostId，却await后直接回写无seq；迁移镜像同样无目标代次，handleSubmit缺isSubmitting入口门禁，close的300ms清理能影响重开草稿。 |
| R1-304 | 存在 | 待精修/运行复核 | 预览有requestId，但150ms防抖期间未立即清旧preview/id，变价后旧预览仍可提交。 |
| R1-305 | 存在 | 待精修/运行复核 | 余额/登录弹窗异步未绑定当前user；submitAdjustBalance缺函数busy guard，可串用户/重复提交。 |
| R1-306 | 已有防护 | 保留初审结论 | requiresIpv6ParentInterface仅当前或旧subnet有值时要求接口，IPv6全部留空可保存；清空已有值仍见R1-111。 |
| R1-307 | 部分存在 | 待精修/运行复核 | 2FA startSetup/enable等缺函数busy门禁；ChangeEmail已有busy与卸载清理但邮箱await未绑定目标，细项另见R313，不能笼统说所有保护都无。 |
| R1-308 | 部分存在 | 源码已改/验证范围见右栏 | 三语邀请码控件/实际i18n运行及长地址换行；locale runtime；手机浏览器待验 |
| R1-309 | 存在 | 待精修/运行复核 | catch用当时当前draft存pending，验证重试可用新草稿；旧成功timer清新会话。 |
| R1-310 | 存在 | 待精修/运行复核 | 保存一个设置组后loadAll重置全组，其他组及等待期间新草稿丢失。 |
| R1-311 | 存在 | 待精修/运行复核 | openEdit先改id后await回写内容，无seq，A响应可写进B编辑目标。 |
| R1-312 | 部分存在 | 待精修/运行复核 | 当前PackageSelector只展示props.packages，无对方嵌入packageId加载；priority 0用／／20确被默认覆盖。 |
| R1-313 | 部分存在 | 待精修/运行复核 | 已有close busy/watch/unmount清timer；sendNewEmailCode await后未绑定邮箱/session，旧邮箱结果仍可标记新邮箱。 |
| R1-314 | 存在 | 待精修/运行复核 | multiDraw拒isSpinning，但spin不拒isMultiDrawing；结果setTimeout未随卸载清理，可与十连交错或离页后弹窗。 |
| R1-315 | 待运行验证 | 源码已改/验证范围见右栏 | 三语邀请码控件/实际i18n运行及长地址换行；locale runtime；手机浏览器待验 |
| R1-316 | 存在 | 待精修/运行复核 | bindings搜索/editor读取缺请求和当前目标代次，反序结果可显示旧对象。 |
| R1-317 | 存在 | 待精修/运行复核 | Login/AdminLogin handleLogin缺函数入口loading guard；按钮disabled仅阻常规鼠标，不能防重复事件/函数调用。 |
| R1-318 | 已有防护 | 保留初审结论 | manualStartHint已描述重装后自动启动。 |
| R1-319 | 存在 | 待精修/运行复核 | rechargeNotice仍写PUSH免费，而transferFee可非0；zh-CN/en均见原文。 |
| R1-320 | 存在 | 待精修/运行复核 | 前端提示/校验6位与后端8位加复杂度不一致。 |
| R1-321 | 部分存在 | 待精修/运行复核 | reset后已有reconcileTrafficStateForInstanceIds；用户文案仍须逐处对照，不能删除正常恢复逻辑。 |
| R1-322 | 已有防护 | 保留初审结论 | 管理员创建description已免费或付费；freeGiftHint只在免费赠送分支，不是整页都说免费。 |
| R1-323 | 存在 | 待精修/运行复核 | bootPriority写越小越先，与Incus高priority优先相反；startupDelay写启动前等待，与启动后延时语义不同。 |
| R1-324 | 存在 | 待精修/运行复核 | 初始quotaForm读取camelCase portLimit/snapshotLimit，API返回snake_case；calculateRemainingQuota也camelCase加／／0，真实配额字段/零值被误读。 |
| R1-325 | 实现不同 | 保留初审结论 | managed失败保留error，与独占pool交付/退款/隔离库存不同；不能为了释放库存将远端未确认删除直接标deleted，先保留并核查实际残留。 |
| R1-326 | 待运行验证 | 源码已改/验证范围见右栏 | 三语邀请码控件/实际i18n运行及长地址换行；locale runtime；手机浏览器待验 |
| R1-327 | 实现不同 | 保留初审结论 | 本库管理员删除集成是TS脚本、测试finally在整套结束清理；未发现对方共享证书提前删除的同类脚本，不照搬旧修法。 |
