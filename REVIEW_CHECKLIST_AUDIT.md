# 外部327项审查清单核对

核对日期：2026-10-27。当前基线：`0e8010371c8eb7a0eeaef9b9a1d0df6caf312092`（main，v1.7.7之后的台账提交）。对方清单源码06d3563、dev合并311f003，不能互当验证证据。

按原编号定向读实现、调用链和既有守卫。本文是核查报告，不是修复完成或上线声明；本轮未改业务代码、未提交推送、未发布或操作生产。优先级保留对方标记，实际修复顺序须按本项目可达性/影响重新评估。

一机一卖继续保持宿主独占、库存占用、交付/退款/删除保护。主控/网关仅IPv4可用且宿主/客机IPv6独立；OSS恢复、固定管理身份、唯一写者和客户数据面要求均保留。不照搬退役备份/多副本/立即释放库存等不同架构方案。

统计（从下表生成）：存在 189；部分存在 57；已有防护 53；实现不同 24；待运行验证 4；合计327。存在=有具体代码缺口，未等同生产漏洞；部分存在=该复合条目的部分症状已有防护；已有防护=原症状的当前代码防护已定位，非零bug保证；实现不同=当前入口/实现不同，不照搬；待运行验证/待代码复核不可当完成。

## 验证证据

- 基线全套`pnpm test`：181/181通过，0失败，6m55s，日志`logs/test-run-20261027-125519`。包含前后端type-check和注册守卫；不否定未覆盖的并发/迟到响应缺陷。
- 本轮最小源码复现：`node logs/review-checklist-repro.cjs`，提取实际函数或transpile完整Markdown模块，在无DB/无网络夹具执行。结果`logs/review-checklist-repro-results.json`：R1-001、153、154、155、163、215、236、257、258、259与相关HTML清理缺口实际复现。提取函数不是完整路由/真实Incus证据。
- 金额/流量边界：`node logs/review-boundary-probes.cjs`，从实际充值路由提取金额判断，在隔离输入下复现R1-036；PG bigint parser确实拒负数/小数/溢出，并将空串视null。结果`logs/review-boundary-probes.json`，不代表外部支付完成或数据库入账。
- 静态资产扫描：`node logs/review-static-probes.cjs`，178份SVG中48份缺少引用ID；结果`logs/review-static-probes.json`。未运行资产重建或改界面。
- 尚未做本次独立DB并发攻击/支付故障注入、浏览器交互全流程、Linux Agent故障注入、Debian13/14真机或公网/生产验收。HTML未引号事件属性仍保留是输出复现，未执行浏览器攻击。

## 定向修复建议

先补鉴权/账户变更的原值CAS、事务消费和会话代次；严格易支付到账金额与状态门禁；安装失败保留原env；Incus取消必须精确实例匹配；交付补偿须先确认远端删除才释放独占库存/IP。随后处理前端请求代次/草稿快照、pool连接配置代次、Agent升级/收集期限及Markdown真实解析/HTML白名单。修复拆小批，每批读对应守卫、补必要行为验证；不得改用户独占模式或用跳过真实网络检查换取成功。

## 优先处理与现有守卫

以下为本库修复排序建议。原327项含同一根因的多个症状，不能把189+57直接当作246个独立漏洞；代码窗口的存在也不证明客户已被影响。

| 范围 | 重点条目 | 当前证据与应保留的约束 | 已有守卫入口 |
|---|---|---|---|
| 到账金额 | R1-036 | 缺失/非法金额通过判断已源码隔离复现，保留订单号、状态、幂等到账保护 | test-recharge-query-guards.ts、test-recharge-accounting-guards.ts、test-recharge-state-transitions.ts |
| 会话及敏感账户变更 | R1-001/003/004/009/012/026/037 | 重复字符漏检已复现；原值CAS、事务消费及执行者资格需补竞态验证，继续单后端 | test-auth-session-status-guards.ts、test-operation-verification-code-storage.ts、test-oauth-bind-session-guard.ts |
| 安装保留环境 | R1-295 | 旧env凭据提取失败会删文件，需保留原身份并明确失败，不能自动换密钥 | 安装流程/全新安装与恢复验收；本轮未执行安装 |
| 实例操作与补偿 | R1-142/145/147/148/154/269 | 精确操作匹配已复现；失败保留清理依据，远端删除确认后处理资源，独占机器池保护继续保留 | test-instance-recreate-consistency.ts、test-instance-create-failure-compensation.ts、test-instance-delete-incus-order.ts、test-host-public-ipv6.ts |
| 异步页面目标及草稿 | R1-055/057/219/248/279/281/285/287/301/304/305 | 账户、路由、选择集合及提交草稿需绑定请求代次和提交快照 | test-frontend-route-guards.ts、test-frontend-i18n-keys.ts；另需延迟响应浏览器夹具 |
| Markdown输出 | R1-257/258/259 | 表格异常与原引号破坏属性已复现；相关未引号事件属性仍保留，未做浏览器攻击验证 | 当前静态前端守卫不覆盖实际Markdown解析；修复时补真实输入行为验证 |

上述守卫文件均在`server/scripts/`。基线通过不能代替新边界测试。原一机一卖、新版退款/删除保护、网关IPv4-only与宿主/客机IPv6独立均为修复不变量。

按原优先级统计：

| 原级别 | 存在 | 部分存在 | 已有防护 | 实现不同 | 待运行验证 |
|---|---:|---:|---:|---:|---:|
| P1 | 57 | 23 | 16 | 6 | 0 |
| P2 | 116 | 29 | 34 | 13 | 4 |
| P3 | 16 | 5 | 3 | 5 | 0 |

剩余运行核验为R1-084（跨语言心跳哈希向量）、R1-260（具体消息/支付占位符）、R1-315（三语实际控件）、R1-326（390px长Webhook布局）。其他“存在/部分存在”中标注的竞态和真实运行影响亦未全部复现。

清单完整性校验：327唯一编号，原问题与原优先级逐字对齐；所有证据文件路径存在且行号不越界。原清单SHA256：`d069338f5800aba9b592b7444a5cc8d36dde7b5b83cd4a7c242fc1a5cfa38320`。

## 逐项记录

| 编号 | 原优先级 | 原问题 | 本库结论 | 当前代码证据/差异 |
|---|---|---|---|---|
| R1-001 | P1 | 共享危险字符检查状态导致重复非法输入漏检 | 存在 | [server/src/lib/security.ts:220](<C:/payincus/server/src/lib/security.ts:220>)：共享/g正则在containsDangerousChars直接test；同一!输入4次为true/false/true/false，已隔离复现。 |
| R1-002 | P1 | 邮箱验证码跨用途复用、发送限额失效及暴力尝试无上限 | 部分存在 | [server/src/db/email-verification.ts](<C:/payincus/server/src/db/email-verification.ts>)：发送计数、过期、创建分开；成功消费与清理会移除计数依据，错误尝试无上限；general兼容需保留既有守卫的业务语义。 |
| R1-003 | P1 | 并发登录重复消费恢复码，其他码可能被旧数组恢复 | 存在 | [server/src/routes/auth.ts](<C:/payincus/server/src/routes/auth.ts>)：恢复码数组先读再splice/save，无CAS；两个并发消费可沿用同一旧数组。待独立DB竞态复现。 |
| R1-004 | P1 | 2FA 设置、启用与恢复码更新存在陈旧状态覆盖 | 存在 | [server/src/routes/auth.ts](<C:/payincus/server/src/routes/auth.ts>)：2FA及密码变更先读取、验证再异步更新，无原值CAS；disable2FA缺secret分支跳过TOTP。待并发复现。 |
| R1-005 | P1 | OAuth state/一次性登录码定时清空nonce后在TTL内可重放 | 已有防护 | [server/src/lib/security.ts](<C:/payincus/server/src/lib/security.ts>)：nonce按到期逐项移除，没有在TTL内整表clear；保留单Node部署约束。 |
| R1-006 | P1 | OAuth回调沿用已撤销会话及陈旧提供商绑定/账户信息 | 部分存在 | [server/src/routes/oauth-provider.ts](<C:/payincus/server/src/routes/oauth-provider.ts>)：已复核撤销/active，但提供商绑定与用户读取后仍有异步间隙，绑定写无CAS；不能宣称整个旧问题原样存在。 |
| R1-007 | P1 | 相对重定向允许反斜杠形式导致外部导航 | 已有防护 | [server/src/lib/redirect-validator.ts](<C:/payincus/server/src/lib/redirect-validator.ts>)：已有反斜杠、编码与控制字符的严格校验。 |
| R1-008 | P2 | OAuth设置留空密钥写入UNCHANGED，破坏已有登录配置，繁体UI缺少整组文案 | 部分存在 | [server/src/routes/oauth.ts](<C:/payincus/server/src/routes/oauth.ts>)：空秘密/UNCHANGED已有保留逻辑；繁体整组文案须独立核验，不根据旧清单判断缺失。 |
| R1-009 | P1 | 撤销会话吞数据库错误，密码/2FA/封禁与令牌撤销分离 | 存在 | [server/src/lib/security.ts:794](<C:/payincus/server/src/lib/security.ts:794>)：revokeRefreshToken及invalidateUserAccessTokens捕获撤销错误；revokeAllUserRefreshTokens直接传播错误，不能说全部撤销都吞错。密码/2FA更新与部分撤销分离，故障影响待注入。 |
| R1-010 | P1 | 认证成功缓存30秒保留跨进程撤销、删除和旧管理员权限 | 实现不同 | [server/src/app.ts](<C:/payincus/server/src/app.ts>)：请求认证读取最新用户和invalidations；无对方30秒正向认证缓存，多后端副本本项目不支持。 |
| R1-011 | P1 | 操作验证码尝试无上限、并发发送/验证/消费及过期grant仍可用 | 部分存在 | [server/src/lib/operation-verification.ts](<C:/payincus/server/src/lib/operation-verification.ts>)：发送锁、5次attempt及原子claim已有；grant查询/领取未核对expiresAt，仍须补到期边界。 |
| R1-012 | P1 | 已验证旧密码/2FA密钥可覆盖并发更新，缺失密钥也可禁用2FA | 存在 | [server/src/routes/auth.ts](<C:/payincus/server/src/routes/auth.ts>)：2FA及密码变更先读取、验证再异步更新，无原值CAS；disable2FA缺secret分支跳过TOTP。待并发复现。 |
| R1-013 | P2 | 账户2FA禁用未接二次验证弹窗，倒计时和繁体文案不一致 | 部分存在 | [client/src/components/profile/TwoFactorSection.vue](<C:/payincus/client/src/components/profile/TwoFactorSection.vue>)：禁用直接调用API，未接SensitiveVerificationModal；倒计时与三语需另核。 |
| R1-014 | P1 | 邮箱分配跨注册/admin/profile竞态，验证码在失败操作前消耗 | 部分存在 | [server/src/routes/auth.ts](<C:/payincus/server/src/routes/auth.ts>)：数据库邮箱唯一约束已有；验证码先消费，之后邮箱分配冲突仍可能失败。应原子分配/消费，保留唯一约束。 |
| R1-015 | P1 | 删除套餐所有者会清除他人实例付费关联，封禁/删除与角色提升竞态 | 部分存在 | [server/src/routes/users.ts](<C:/payincus/server/src/routes/users.ts>)：关联阻断及FK ConflictError已有，不能直接删除他人付费关联；角色/状态变更竞态仍需事务级复核。 |
| R1-016 | P1 | 同步RSA生成阻塞服务，SSH公钥无实际校验且重复/数量并发无保护 | 存在 | [server/src/routes/ssh-keys.ts](<C:/payincus/server/src/routes/ssh-keys.ts>)：同步RSA生成、仅文本校验公钥；重复与数量先读后写，无串行/CAS。 |
| R1-017 | P1 | 密码找回提前消耗验证码并重置凭据，邮件发送失败仍返回成功 | 实现不同 | [server/src/routes/auth.ts:1357](<C:/payincus/server/src/routes/auth.ts:1357>)：找回密码由用户提交新密码，不发送临时密码；验证码消费后hash/2FA清理/密码更新/撤销分开仍有原子性缺口。 |
| R1-018 | P2 | 邀请码资源继承属性通过校验导致500，邀请码及登录记录分页NaN/负数错误 | 部分存在 | [server/src/lib/invite-pricing.ts:145](<C:/payincus/server/src/lib/invite-pricing.ts:145>)：resource in handlers仍接受继承属性；用户登录记录等分页已有严格parser，不把整条旧问题原样迁入。 |
| R1-019 | P2 | 管理员用户列表N+1和全量login history读取，avatar badge丢失 | 部分存在 | [server/src/routes/users.ts](<C:/payincus/server/src/routes/users.ts>)：列表仍有N+1；登录历史已批量查询且返回avatarBadgeId，不能照搬整条优化。 |
| R1-020 | P2 | 用户/节点/实例分页NaN和无上限，多处完整选择器只读取一页 | 部分存在 | [server/src/routes/users.ts:211](<C:/payincus/server/src/routes/users.ts:211>)：用户页和登录记录已有限幅正整数parser，实例页也有专用parser；完整选择器的客户端单页读取另见R301，不能报告所有分页均NaN/无上限。 |
| R1-021 | P2 | 批量配置Done清空结果阻止成功refresh，重试失败丢掉已成功状态 | 存在 | [client/src/components/host/BatchConfigModal.vue:310](<C:/payincus/client/src/components/host/BatchConfigModal.vue:310>)：handleDone清result后handleClose不再触发success；失败重试结果替换会遗失已成功计数。 |
| R1-022 | P2 | 批量配置遗漏不可修改的请求目标，却报告全部成功 | 已有防护 | [server/src/routes/batch-config.ts](<C:/payincus/server/src/routes/batch-config.ts>)：目标完整性及流量BigInt安全输入已有校验，不能移植旧负值修法。 |
| R1-023 | P2 | 批量配置流量限额缺少输入验证，成功写入负值 | 已有防护 | [server/src/routes/batch-config.ts](<C:/payincus/server/src/routes/batch-config.ts>)：目标完整性及流量BigInt安全输入已有校验，不能移植旧负值修法。 |
| R1-024 | P1 | 批量配置写入前未重新核对当前角色、封禁状态和宿主机归属 | 存在 | [server/src/routes/batch-config.ts](<C:/payincus/server/src/routes/batch-config.ts>)：批量配额/SWAP/高级配置沿用宿主与实例旧快照，未与转移锁统一串行；待转移及降权竞态测试。 |
| R1-025 | P1 | 批量配额、SWAP和高级配置未遵守实例转移锁 | 存在 | [server/src/routes/batch-config.ts](<C:/payincus/server/src/routes/batch-config.ts>)：批量配额/SWAP/高级配置沿用宿主与实例旧快照，未与转移锁统一串行；待转移及降权竞态测试。 |
| R1-026 | P1 | 管理员被降级后11类账户与财务操作仍成功写入 | 部分存在 | [server/src/routes/users.ts:777](<C:/payincus/server/src/routes/users.ts:777>)：角色写事务锁定目标与最后管理员、同事务撤销目标会话，但不读取执行者最新角色；余额/配额/状态等仍主要依赖onRequest的管理员资格。已定位写入窗口，未逐11类做降权DB竞态实证。 |
| R1-027 | P1 | 自行增加配额使用过时账户与配额数据并覆盖并发上限 | 存在 | [server/src/routes/users.ts:966](<C:/payincus/server/src/routes/users.ts:966>)：增加配额读取旧quota再写，无原值/version CAS。 |
| R1-028 | P1 | 自动续费设置使用过时账户及实例归属状态写入 | 存在 | [server/src/db/billing-operations.ts:1005](<C:/payincus/server/src/db/billing-operations.ts:1005>)：updateAutoRenew写入仅按实例id，未同时约束当前归属/状态。 |
| R1-029 | P1 | 关闭自动续费后调度仍按旧候选快照扣费 | 已有防护 | [server/src/db/billing-operations.ts](<C:/payincus/server/src/db/billing-operations.ts>)：自动续费updateMany重新核对autoRenewEligibility及expires/version，旧候选不直接决定扣款。 |
| R1-030 | P1 | 已过期续费错误账单服务起点低估剩余退款价值 | 存在 | [server/src/db/billing-operations.ts:695](<C:/payincus/server/src/db/billing-operations.ts:695>)：过期续费periodStart沿用旧expiresAt，服务期起点和退款基数存在偏差。 |
| R1-031 | P1 | 手动续费使用过时账户权限和托管续费限制 | 部分存在 | [server/src/db/billing-operations.ts:593](<C:/payincus/server/src/db/billing-operations.ts:593>)：余额锁内只读取balance，实例CAS已有version/notdeleted，但手动续费未在相同边界核对当前actor/status/托管权限；自动续费已有eligibility。待DB竞态。 |
| R1-032 | P1 | 停用 AFF 优惠码仍可校验绑定并获折扣返利 | 部分存在 | [server/src/db/aff.ts](<C:/payincus/server/src/db/aff.ts>)：优惠码校验与返利已有enabled检查；停用和后续绑定之间的写入边界仍需竞态验证。 |
| R1-033 | P1 | 被封禁账户在认证后仍能完成 AFF 余额转化 | 存在 | [server/src/db/aff.ts:675](<C:/payincus/server/src/db/aff.ts:675>)：AFF余额转化在事务内读affBalance/balance，没有核对账户最新status；封禁发生在认证之后的写入窗口待DB复现。 |
| R1-034 | P1 | 管理员降级后 AFF 审批仍改变申请及余额 | 部分存在 | [server/src/db/aff.ts:858](<C:/payincus/server/src/db/aff.ts:858>)：批准pending条件更新已有，避免重复批准；写入事务未复核执行者最新管理员资格。 |
| R1-035 | P1 | 充值取消或失败写入覆盖已到账状态 | 已有防护 | [server/src/db/recharge-records.ts](<C:/payincus/server/src/db/recharge-records.ts>)：失败/取消条件限定pending或paid，不覆盖completed。 |
| R1-036 | P1 | 易支付主动查询缺失或非法金额仍自动入账 | 存在 | [server/src/routes/recharge.ts:1732](<C:/payincus/server/src/routes/recharge.ts:1732>)：已提取源码金额判断隔离执行：缺失、garbage、0、-1及10junk均通过金额门禁，11相对订单10被拒绝。此前订单/渠道状态校验仍有，不等同真实伪充值完成；需严格有限正金额和完整格式校验。 |
| R1-037 | P1 | 管理员降级后手动充值处理仍能写入 | 存在 | [server/src/db/recharge-records.ts:298](<C:/payincus/server/src/db/recharge-records.ts:298>)：manual-complete传operator作为callbackData；completeRecharge有余额锁及订单状态CAS，但不接收actor门禁，管理员降权后的在途完成窗口仍在。 |
| R1-038 | P2 | 支付方式手续费继承原型属性并生成非法金额链接 | 存在 | [server/src/db/payment-providers.ts:494](<C:/payincus/server/src/db/payment-providers.ts:494>)：普通对象feeMap[method]可读继承属性；需要在入口枚举及金额链验证实际可达输入。 |
| R1-039 | P1 | 管理员同步未解密支付渠道配置而在网关查询前失败 | 已有防护 | [server/src/db/payment-providers.ts:188](<C:/payincus/server/src/db/payment-providers.ts:188>)：渠道getter统一decryptProviderConfig，再用于同步查询，原未解密问题不成立。 |
| R1-040 | P2 | 单笔管理员同步重复生成充值到账站内信 | 已有防护 | [server/src/routes/recharge.ts:2133](<C:/payincus/server/src/routes/recharge.ts:2133>)：到账消息仅completion.completedNow发送，已有重复完成门禁。 |
| R1-041 | P1 | 支付渠道与卡密管理写入使用已失效的管理员权限 | 部分存在 | [server/src/routes/gift-cards.ts:85](<C:/payincus/server/src/routes/gift-cards.ts:85>)：卡密管理已有管理员与生产allowlist，支付/卡密写入依赖请求开始的授权；异步后未统一传actor到事务核验。不是缺失全部管理权限，实际降权竞态待验证。 |
| R1-042 | P1 | 卡密兑换未在到账事务核对当前账户与渠道状态 | 部分存在 | [server/src/db/gift-cards.ts](<C:/payincus/server/src/db/gift-cards.ts>)：卡密状态锁已有；兑换锁后账户只select balance，未重新核对status。 |
| R1-043 | P2 | 卡密生成接受小数数量并静默截断 | 已有防护 | [server/src/routes/gift-cards.ts](<C:/payincus/server/src/routes/gift-cards.ts>)：生成数量已有安全整数和范围验证，不再静默截断。 |
| R1-044 | P2 | 生成卡密时关闭弹窗会丢失一次性密码结果 | 实现不同 | [client/src/views/admin/GiftCardsView.vue](<C:/payincus/client/src/views/admin/GiftCardsView.vue>)：当前表单常驻且固定第一页100条；无对方所述弹窗关闭或末页分页实现，超100条展示另评。 |
| R1-045 | P2 | 通知、公告、日志和卡密列表未限制安全页码与公告页大小 | 部分存在 | [server/src/routes/notifications.ts:50](<C:/payincus/server/src/routes/notifications.ts:50>)：inbox/logs/announcements已有严格parser和pageSize上限；notifications列表仍parseInt接受后缀/小数且缺safe integer。各接口分别处理。 |
| R1-046 | P2 | 卡密末页删除后不回到有效页并隐藏仍存在的卡密 | 实现不同 | [client/src/views/admin/GiftCardsView.vue](<C:/payincus/client/src/views/admin/GiftCardsView.vue>)：当前表单常驻且固定第一页100条；无对方所述弹窗关闭或末页分页实现，超100条展示另评。 |
| R1-047 | P2 | Notification enum and resource IDs reach Prisma unchecked or address the wrong integer row | 已有防护 | [server/src/routes/notifications.ts](<C:/payincus/server/src/routes/notifications.ts>)：通知enum已normalize且资源ID严格正安全整数；admin-notification-channels同样。原unchecked enum/数字前缀问题不成立。 |
| R1-048 | P2 | Inbox deletion and read mutations retain invalid page or stale unread rows | 存在 | [client/src/views/InboxView.vue](<C:/payincus/client/src/views/InboxView.vue>)：load缺请求代次，未读视图标记已读后不移出旧列表；删末条total--但不回退越界页。待浏览器延迟夹具。 |
| R1-049 | P1 | Notification writes retain stale sender authorization | 存在 | [server/src/routes/inbox.ts:440](<C:/payincus/server/src/routes/inbox.ts:440>)：admin/send读取请求旧role后await findUser再createInboxMessage，写入helper不接actor；认证后降权窗口在代码上存在。 |
| R1-050 | P1 | Host and instance notification delivery uses stale ownership and recipients | 存在 | [server/src/routes/inbox.ts:269](<C:/payincus/server/src/routes/inbox.ts:269>)：宿主广播与实例消息读取旧归属/收件人后await SMTP及批量创建，写入未复核当前归属；实际转移竞态待DB/邮件夹具。 |
| R1-051 | P2 | Announcement history failure leaves committed inbox messages | 存在 | [server/src/routes/inbox.ts:219](<C:/payincus/server/src/routes/inbox.ts:219>)：createBulkMessages后另行createAnnouncement，历史失败不会回滚已发站内信。 |
| R1-052 | P2 | Email queue startup recovery steals active work and timeout recovery can leave null-start tasks blocking the queue | 部分存在 | [server/src/workers/hostNotificationEmailWorker.ts](<C:/payincus/server/src/workers/hostNotificationEmailWorker.ts>)：startup只恢复10分钟旧任务/NULL，避免直接抢全部active；timeout的NULL startedAt仍需处理。 |
| R1-053 | P2 | Email queue stale completion overwrites newer attempt state and consumes duplicate retries | 部分存在 | [server/src/db/host-notification-email-tasks.ts](<C:/payincus/server/src/db/host-notification-email-tasks.ts>)：finalizer约束status/retryCount，但无startedAt尝试身份，迟到完成可能覆盖新尝试。 |
| R1-054 | P2 | In-flight unread responses restore cleared state and inbox polling survives layout unmount | 部分存在 | [client/src/stores/inbox.ts](<C:/payincus/client/src/stores/inbox.ts>)：旧unread响应可覆盖本地清除；layout卸载轮询清理须逐条检查实际调用。 |
| R1-055 | P1 | Session changes reuse previous account dashboard summary and SSH key caches | 存在 | [client/src/stores/auth.ts](<C:/payincus/client/src/stores/auth.ts>)：Dashboard/SSH缓存缺完整账户session隔离；会话切换后可能复用上一账户结果。待延迟响应浏览器夹具。 |
| R1-056 | P2 | Late identity reads restore signed-out user state or invalidate a new session;storage replacement keeps prior identity | 存在 | [client/src/api/index.ts](<C:/payincus/client/src/api/index.ts>)：identity读取与refresh缺generation绑定；旧请求可能回写新会话或用替换账户token重试旧操作。待会话切换动态验证。 |
| R1-057 | P1 | Late token refresh restores a prior session or retries an old mutation with replacement account credentials | 存在 | [client/src/api/index.ts](<C:/payincus/client/src/api/index.ts>)：identity读取与refresh缺generation绑定；旧请求可能回写新会话或用替换账户token重试旧操作。待会话切换动态验证。 |
| R1-058 | P2 | Late dashboard mount completion restarts polling after unmount | 存在 | [client/src/views/DashboardView.vue](<C:/payincus/client/src/views/DashboardView.vue>)：mount await后建立timer，卸载清理先发生仍会重建轮询。 |
| R1-059 | P3 | Global restore tracking accepts duplicate starts and late results overwrite replacement tasks across account changes | 部分存在 | [client/src/stores/restoreTask.ts](<C:/payincus/client/src/stores/restoreTask.ts>)：startRestore未在首个await前占busy，全局activeTask在轮询完成后被直接回写，缺账户/任务代次。BackupManager当前消费者可达性与后端实际备份栈不同，不能据此删平台OSS。 |
| R1-060 | P3 | Unreachable instance backup frontend and restore state retained despite no page or route consumer | 实现不同 | [client/src/components/BackupManager.vue](<C:/payincus/client/src/components/BackupManager.vue>)：前端疑似无当前页面消费者；不代表后端或平台OSS备份已退役，不据此删除整栈。 |
| R1-061 | P2 | Snapshot policy editor treats actual Boolean enabled as numeric and disables enabled policy on unchanged save | 存在 | [client/src/components/SnapshotManager.vue](<C:/payincus/client/src/components/SnapshotManager.vue>)：策略API返回Boolean，编辑读取enabled===1导致已启用策略显示关闭。 |
| R1-062 | P2 | Snapshot UI accepts duplicate/conflicting mutations and stale callbacks discard drafts or continue work after disposal | 存在 | [client/src/components/SnapshotManager.vue](<C:/payincus/client/src/components/SnapshotManager.vue>)：快照变更缺session/target generation及完整busy门禁，旧完成可能覆盖草稿或卸载后继续。 |
| R1-063 | P1 | Snapshot mutations accept banned actors and managed snapshots trust obsolete administrator roles | 部分存在 | [server/src/routes/snapshots.ts](<C:/payincus/server/src/routes/snapshots.ts>)：请求authenticateUser已有认证，快照权限依赖先读的user/instance/hostOwner；写入前缺统一最新actor资格核验，封禁/降权在途边界待DB复现。 |
| R1-064 | P1 | Snapshot delete/restore/policy use stale ownership or state and delete can remove a source during restore | 存在 | [server/src/routes/snapshots.ts](<C:/payincus/server/src/routes/snapshots.ts>)：删除/恢复/策略先校验快照与实例后异步远端操作，删除未与恢复统一锁；转移后仍可能作用旧目标。 |
| R1-065 | P2 | Snapshot policy interval changes retain the old next execution time | 存在 | [server/src/db/snapshots.ts:118](<C:/payincus/server/src/db/snapshots.ts:118>)：upsert create有nextRunAt而update只有enabled/intervalMinutes，修改间隔保留旧下次执行时间。 |
| R1-066 | P2 | Snapshot endpoints accept fractional resource IDs and overflow inputs produce server errors | 已有防护 | [server/src/routes/snapshots.ts:29](<C:/payincus/server/src/routes/snapshots.ts:29>)：parsePositiveId严格正整数及safe integer；不接受小数ID。 |
| R1-067 | P2 | Snapshot scheduler failure finalizer overwrites newer or disabled policy schedules | 存在 | [server/src/db/snapshots.ts:135](<C:/payincus/server/src/db/snapshots.ts:135>)：scheduler失败后updateSnapshotPolicyLastRun重新读interval却不核对enabled/原schedule再写，旧失败可覆盖新排程。 |
| R1-068 | P2 | Queued automatic snapshots use obsolete owner and names for notification and audit | 部分存在 | [server/src/services/auto-policy-scheduler.ts:228](<C:/payincus/server/src/services/auto-policy-scheduler.ts:228>)：锁后重读policy/instance/host eligibility，旧排队资格已有保护；执行后异步通知仍沿用该次快照的名称/归属。 |
| R1-069 | P3 | Explicitly retired instance backup routes and workers remain compiled and are artificially mounted only by tests | 实现不同 | [server/src/app.ts:546](<C:/payincus/server/src/app.ts:546>)：backupRoutes/storageConfig和restoreTaskWorker/backupUploadWorker实际注册启动；本库客机备份后端未退役。 |
| R1-070 | P3 | Retired instance backup storage configuration UI and provider stack have no application consumers | 实现不同 | [server/src/app.ts:549](<C:/payincus/server/src/app.ts:549>)：storage配置与provider栈仍有后端消费者，不能因前端孤立按对方方案删掉。 |
| R1-071 | P2 | Avatar save completion marks a later unsubmitted selection as persisted | 存在 | [client/src/components/profile/AccountSection.vue:44](<C:/payincus/client/src/components/profile/AccountSection.vue:44>)：提交selectedAvatarStyle，await后使用当时当前选择更新authStore，后来未提交的选择误标已保存。 |
| R1-072 | P3 | Orphan profile billing component duplicates the live wallet implementation | 存在 | [client/src/components/profile/BillingSection.vue](<C:/payincus/client/src/components/profile/BillingSection.vue>)：应用页面未导入该孤立组件，仍重复Wallet界面实现；只属维护残留，不据此删除正在使用的Wallet或账务后端。 |
| R1-073 | P2 | Notification history accepts stale responses after a newer filter is selected | 存在 | [client/src/components/profile/NotificationSection.vue](<C:/payincus/client/src/components/profile/NotificationSection.vue>)：读列表/变更完成缺目标和请求代次绑定；过滤改变、替换草稿与重复行操作有竞态窗口。 |
| R1-074 | P2 | Notification mutations discard replacement drafts and allow duplicate row operations | 存在 | [client/src/components/profile/NotificationSection.vue](<C:/payincus/client/src/components/profile/NotificationSection.vue>)：读列表/变更完成缺目标和请求代次绑定；过滤改变、替换草稿与重复行操作有竞态窗口。 |
| R1-075 | P2 | SSH key form mutations allow duplicate writes and generation overwrites the first private result | 存在 | [client/src/components/profile/SSHKeysSection.vue](<C:/payincus/client/src/components/profile/SSHKeysSection.vue>)：列表和生成/保存缺完整session/请求代次与busy函数门禁，旧响应和分页收缩未统一防护。 |
| R1-076 | P2 | SSH key list accepts obsolete results and can strand remaining keys after pagination shrinks | 存在 | [client/src/components/profile/SSHKeysSection.vue](<C:/payincus/client/src/components/profile/SSHKeysSection.vue>)：列表和生成/保存缺完整session/请求代次与busy函数门禁，旧响应和分页收缩未统一防护。 |
| R1-077 | P3 | SSH key creation dates use a field absent from the API response | 存在 | [client/src/components/profile/SSHKeysSection.vue](<C:/payincus/client/src/components/profile/SSHKeysSection.vue>)：显示created_at而API字段createdAt，创建日期缺失。 |
| R1-078 | P2 | Login history late responses overwrite the selected page | 存在 | [client/src/components/profile/LoginHistorySection.vue](<C:/payincus/client/src/components/profile/LoginHistorySection.vue>)：列表无反序响应保护；UA先Linux/MacOS/Chrome再Android/iPhone/Opera导致误分类。 |
| R1-079 | P3 | Login history classifies mobile devices and Opera as desktop or Chrome | 存在 | [client/src/components/profile/LoginHistorySection.vue](<C:/payincus/client/src/components/profile/LoginHistorySection.vue>)：列表无反序响应保护；UA先Linux/MacOS/Chrome再Android/iPhone/Opera导致误分类。 |
| R1-080 | P2 | Telegram binding operations permit obsolete links and stale bound state | 存在 | [client/src/components/profile/TelegramBindingSection.vue](<C:/payincus/client/src/components/profile/TelegramBindingSection.vue>)：绑定读取与操作结果未完整绑定目标/会话代次，旧链接/状态可回写。 |
| R1-081 | P2 | Agent upgrade lock permanently blocks future upgrades after owner exits | 存在 | [agent/internal/upgrade/upgrade.go](<C:/payincus/agent/internal/upgrade/upgrade.go>)：O_EXCL锁无陈旧owner回收；gunzip无展开大小上限；后台systemd重启沿用defer cancel的CommandContext。未做Linux故障注入。 |
| R1-082 | P2 | Agent upgrade decompression bypasses the configured size limit | 存在 | [agent/internal/upgrade/upgrade.go](<C:/payincus/agent/internal/upgrade/upgrade.go>)：O_EXCL锁无陈旧owner回收；gunzip无展开大小上限；后台systemd重启沿用defer cancel的CommandContext。未做Linux故障注入。 |
| R1-083 | P2 | Fallback systemd restart is killed by cancellation after Apply returns | 存在 | [agent/internal/upgrade/upgrade.go](<C:/payincus/agent/internal/upgrade/upgrade.go>)：O_EXCL锁无陈旧owner回收；gunzip无展开大小上限；后台systemd重启沿用defer cancel的CommandContext。未做Linux故障注入。 |
| R1-084 | P2 | Agent heartbeat body hashes differ across Go JSON and JavaScript normalization | 待运行验证 | [agent/internal/protocol/signing.go](<C:/payincus/agent/internal/protocol/signing.go>)：Go已标准化typed report、排序且关闭HTML转义，server stableStringifyAgentBody也排序；数字词法与Unicode需跨语言向量核对，不能仅凭不同语言宣称真实心跳失败。 |
| R1-085 | P2 | Agent Incus reporting ignores shutdown and has no total collection deadline | 存在 | [agent/internal/report/incus.go](<C:/payincus/agent/internal/report/incus.go>)：收集未贯穿shutdown context且无总时限，仅局部请求时间不足以限制整体。 |
| R1-086 | P2 | Host CPU usage double counts guest and guest-nice time | 存在 | [agent/internal/report/report.go](<C:/payincus/agent/internal/report/report.go>)：CPU统计重复计guest/guest-nice，Linux样本需进一步运行验证。 |
| R1-087 | P3 | Incus availability accepts ordinary files as sockets | 存在 | [agent/internal/report/report.go:91](<C:/payincus/agent/internal/report/report.go:91>)：Incus检测接受普通非目录文件，未强制ModeSocket。 |
| R1-088 | P2 | Agent installer fails manifest download for a new custom installation directory | 已有防护 | [server/templates/agent-install.sh](<C:/payincus/server/templates/agent-install.sh>)：已有目录准备、preflight/staging及dry-run凭据处理；不照搬旧覆盖安装修法，Linux真实安装另验。 |
| R1-089 | P2 | Failed Agent installation preflight overwrites the working installation | 已有防护 | [server/templates/agent-install.sh](<C:/payincus/server/templates/agent-install.sh>)：已有目录准备、preflight/staging及dry-run凭据处理；不照搬旧覆盖安装修法，Linux真实安装另验。 |
| R1-090 | P2 | Agent dry-run output discloses installation credentials | 已有防护 | [server/templates/agent-install.sh](<C:/payincus/server/templates/agent-install.sh>)：已有目录准备、preflight/staging及dry-run凭据处理；不照搬旧覆盖安装修法，Linux真实安装另验。 |
| R1-091 | P1 | Agent credentials issuance uses stale actor and host ownership permissions | 存在 | [server/src/routes/agent.ts:1334](<C:/payincus/server/src/routes/agent.ts:1334>)：install-command先读宿主及请求actor授权后issueHostAgentInstallToken，helper不接actor，发行凭据前没有最新归属/资格CAS。 |
| R1-092 | P2 | Agent credential and install-token rotation is not atomic or serialized | 存在 | [server/src/lib/host-agent-credentials.ts](<C:/payincus/server/src/lib/host-agent-credentials.ts>)：rotate与install token非原子；consume先写tokenUsed再decryptSecret，解密失败也消耗token。 |
| R1-093 | P2 | Install-token consumption returns invalid Agent secrets and consumes the token | 存在 | [server/src/lib/host-agent-credentials.ts](<C:/payincus/server/src/lib/host-agent-credentials.ts>)：rotate与install token非原子；consume先写tokenUsed再decryptSecret，解密失败也消耗token。 |
| R1-094 | P2 | Agent disabled after authentication can still publish a heartbeat | 存在 | [server/src/routes/agent.ts:1578](<C:/payincus/server/src/routes/agent.ts:1578>)：heartbeat认证后多个await，最终写入未约束enabled/status；禁用到写入窗口仍可上报。 |
| R1-095 | P2 | Agent host endpoints accept malformed numeric ID suffixes | 已有防护 | [server/src/routes/agent.ts:136](<C:/payincus/server/src/routes/agent.ts:136>)：hostId使用parsePositiveId及safe integer，严格拒绝数字后缀。 |
| R1-096 | P2 | Optional Agent release lookup can stall authenticated heartbeats beyond the Agent request deadline | 存在 | [server/src/routes/agent.ts](<C:/payincus/server/src/routes/agent.ts>)：升级metadata查询无singleflight且可超过Agent10秒请求期限，缓存miss重复拉取。 |
| R1-097 | P2 | Concurrent Agent release cache misses duplicate upstream metadata and binary downloads | 存在 | [server/src/routes/agent.ts](<C:/payincus/server/src/routes/agent.ts>)：升级metadata查询无singleflight且可超过Agent10秒请求期限，缓存miss重复拉取。 |
| R1-098 | P2 | Host info reads and polling survive their view or overwrite current state | 存在 | [client/src/components/host/HostInfoTab.vue](<C:/payincus/client/src/components/host/HostInfoTab.vue>)：轮询/操作缺目标代次绑定；clipboard未await；formatPercent对非法类型缺保护。各项浏览器动态复核未做。 |
| R1-099 | P2 | Host Agent and recalculation mutation completions affect obsolete views | 存在 | [client/src/components/host/HostInfoTab.vue](<C:/payincus/client/src/components/host/HostInfoTab.vue>)：轮询/操作缺目标代次绑定；clipboard未await；formatPercent对非法类型缺保护。各项浏览器动态复核未做。 |
| R1-100 | P2 | Agent command copy reports success before clipboard completion | 存在 | [client/src/components/host/HostInfoTab.vue](<C:/payincus/client/src/components/host/HostInfoTab.vue>)：轮询/操作缺目标代次绑定；clipboard未await；formatPercent对非法类型缺保护。各项浏览器动态复核未做。 |
| R1-101 | P2 | Unvalidated Agent report metrics can crash host info rendering | 存在 | [client/src/components/host/HostInfoTab.vue](<C:/payincus/client/src/components/host/HostInfoTab.vue>)：轮询/操作缺目标代次绑定；clipboard未await；formatPercent对非法类型缺保护。各项浏览器动态复核未做。 |
| R1-102 | P1 | Host detail stale route requests replace the currently actionable host | 存在 | [client/src/views/resources/MyHostDetailView.vue](<C:/payincus/client/src/views/resources/MyHostDetailView.vue>)：宿主读取与操作无route generation；批量延期仅范围不integer并隐藏失败数；copy未等待clipboard。 |
| R1-103 | P2 | Host detail actions and modal preflights outlive their route and permit duplicate writes | 存在 | [client/src/views/resources/MyHostDetailView.vue](<C:/payincus/client/src/views/resources/MyHostDetailView.vue>)：宿主读取与操作无route generation；批量延期仅范围不integer并隐藏失败数；copy未等待clipboard。 |
| R1-104 | P2 | Host batch extension confirmation accepts fractional days and hides failed counts | 存在 | [client/src/views/resources/MyHostDetailView.vue](<C:/payincus/client/src/views/resources/MyHostDetailView.vue>)：宿主读取与操作无route generation；批量延期仅范围不integer并隐藏失败数；copy未等待clipboard。 |
| R1-105 | P2 | Host reinstall command copy reports success before clipboard completion | 存在 | [client/src/views/resources/MyHostDetailView.vue](<C:/payincus/client/src/views/resources/MyHostDetailView.vue>)：宿主读取与操作无route generation；批量延期仅范围不integer并隐藏失败数；copy未等待clipboard。 |
| R1-106 | P2 | Host image policy read failure and stale responses allow writing unknown or different-host state | 存在 | [client/src/components/host/HostImagesTab.vue](<C:/payincus/client/src/components/host/HostImagesTab.vue>)：canSave未限制loading/初读成功；失败可保存默认策略，保存后loadPolicy覆盖新草稿。 |
| R1-107 | P2 | Host image policy save permits concurrent draft changes and obsolete completion effects | 存在 | [client/src/components/host/HostImagesTab.vue](<C:/payincus/client/src/components/host/HostImagesTab.vue>)：canSave未限制loading/初读成功；失败可保存默认策略，保存后loadPolicy覆盖新草稿。 |
| R1-108 | P2 | Caddy site pagination accepts obsolete responses and disguises failed reads as empty data | 存在 | [client/src/components/host/HostCaddyTab.vue](<C:/payincus/client/src/components/host/HostCaddyTab.vue>)：list/status/action缺host和request generation，失败残留旧数据，迟到结果可作用当前视图。 |
| R1-109 | P2 | Caddy status and operation completions outlive their current host or component | 存在 | [client/src/components/host/HostCaddyTab.vue](<C:/payincus/client/src/components/host/HostCaddyTab.vue>)：list/status/action缺host和request generation，失败残留旧数据，迟到结果可作用当前视图。 |
| R1-110 | P2 | Host configuration save permits duplicate requests and parent refresh discards in-progress drafts | 存在 | [client/src/components/host/MyHostConfigTab.vue:160](<C:/payincus/client/src/components/host/MyHostConfigTab.vue:160>)：watch整个host重置draft；save函数缺busy guard，父刷新和重复提交边界不足。 |
| R1-111 | P2 | Host configuration silently omits cleared description and optional IPv6 fields | 存在 | [client/src/components/host/MyHostConfigTab.vue:298](<C:/payincus/client/src/components/host/MyHostConfigTab.vue:298>)：清空location/IPv6转undefined，不传字段无法清空已有配置。 |
| R1-112 | P1 | Saving unrelated host configuration changes existing connection origin | 存在 | [client/src/components/host/MyHostConfigTab.vue:293](<C:/payincus/client/src/components/host/MyHostConfigTab.vue:293>)：统一buildHostApiUrl重建连接地址，可能丢原协议、路径及默认443，改无关字段也变化。 |
| R1-113 | P2 | Host type change warning bypasses configured locale | 存在 | [client/src/components/host/MyHostConfigTab.vue:323](<C:/payincus/client/src/components/host/MyHostConfigTab.vue:323>)：节点类型警告虽前缀调用t，但正文warning.message及“套餐:”硬编码，繁体/英文不能完整本地化。 |
| R1-114 | P2 | Quick stock editor completion and drafts outlive the current target | 实现不同 | [client/src/components/host/HostInventoryPanel.vue](<C:/payincus/client/src/components/host/HostInventoryPanel.vue>)：没有对方快速多租户库存数量编辑器；本库独占规格/库存枚举，saveSpec有busy及固定磁盘档。不得迁入对方库存数量模型。 |
| R1-115 | P2 | Clearing the required stock field silently submits zero | 实现不同 | [client/src/components/host/HostInventoryPanel.vue](<C:/payincus/client/src/components/host/HostInventoryPanel.vue>)：本库通过独占规格和枚举机器管理库存，无对方必填stock输入清空为0的同类入口；保持一机一卖。 |
| R1-116 | P1 | Caddy 域名路由 ID 碰撞导致操作另一用户站点 | 存在 | [server/src/lib/caddy-client.ts](<C:/payincus/server/src/lib/caddy-client.ts>)：路由id用domain.replace点为横线会碰撞；删除用error.message.includes404吞正文错误；HTTP-only仍共享443自动证书逻辑。 |
| R1-117 | P2 | Caddy 删除将错误正文中的404误认为路由不存在 | 存在 | [server/src/lib/caddy-client.ts](<C:/payincus/server/src/lib/caddy-client.ts>)：路由id用domain.replace点为横线会碰撞；删除用error.message.includes404吞正文错误；HTTP-only仍共享443自动证书逻辑。 |
| R1-118 | P1 | Caddy 安装在认证后封禁或管理员降权后仍可写入和连接 | 部分存在 | [server/src/routes/hosts.ts:4120](<C:/payincus/server/src/routes/hosts.ts:4120>)：本库是caddy/generate生成安装脚本，旧host授权后生成并更新配置，未传actor到写入；不是对方自动连接远端安装流程，降权写窗口仍需核验。 |
| R1-119 | P1 | Caddy 安装使用旧宿主机快照覆盖新所有者凭据 | 存在 | [server/src/routes/hosts.ts:4120](<C:/payincus/server/src/routes/hosts.ts:4120>)：生成Caddy配置后prisma.host.update仅按id，未同时约束原owner/配置版本；转移或并发编辑可被旧生成结果覆盖。 |
| R1-120 | P2 | Caddy 安装任务和凭据更新不原子，失败丢失先前安装记录 | 实现不同 | [server/src/routes/hosts.ts:4120](<C:/payincus/server/src/routes/hosts.ts:4120>)：本库生成手工安装命令并保存凭据，没有对方持久后台Caddy安装任务；相关凭据更新竞态已列R119，不能套用对方任务原子化实现。 |
| R1-121 | P1 | Caddy 安装收到终止信号后释放锁却继续修改系统 | 实现不同 | [server/templates/caddy.sh](<C:/payincus/server/templates/caddy.sh>)：本库为手工Caddy shell安装，未找到对方后台取消任务/锁释放后继续安装模型；不将网关任务与Caddy任务混为一谈。 |
| R1-122 | P2 | HTTP-only 反代站点仍触发 Caddy 自动证书签发 | 存在 | [server/src/lib/caddy-client.ts](<C:/payincus/server/src/lib/caddy-client.ts>)：路由id用domain.replace点为横线会碰撞；删除用error.message.includes404吞正文错误；HTTP-only仍共享443自动证书逻辑。 |
| R1-123 | P1 | 反代删除上游失败仍删除数据库记录，留下不可管理的路由 | 存在 | [server/src/routes/proxy-sites.ts](<C:/payincus/server/src/routes/proxy-sites.ts>)：删除远端失败或缺配置仍丢DB清理记录；刷新先delete再add，新配置失败中断旧站点。 |
| R1-124 | P1 | 反代刷新与修改先删旧路由，新配置失败导致站点中断 | 存在 | [server/src/routes/proxy-sites.ts](<C:/payincus/server/src/routes/proxy-sites.ts>)：删除远端失败或缺配置仍丢DB清理记录；刷新先delete再add，新配置失败中断旧站点。 |
| R1-125 | P2 | 反代管理请求未关闭 Caddy 客户端连接 | 部分存在 | [server/src/lib/caddy-client.ts:13](<C:/payincus/server/src/lib/caddy-client.ts:13>)：有全局Agent cache复用，不是每次请求创建一个泄漏；仍无淘汰/生命周期关闭，同CA路径更新复用旧信任需处理。 |
| R1-126 | P1 | DNS 检查激活已禁用站点而数据库仍标记禁用 | 存在 | [server/src/routes/proxy-sites.ts:419](<C:/payincus/server/src/routes/proxy-sites.ts:419>)：DNS检查只按status pending激活，未要求enabled；addSite后status active可让数据库disabled与远端启用分歧。 |
| R1-127 | P1 | 反代创建事务未复核当前账号状态与普通用户权限 | 存在 | [server/src/routes/proxy-sites.ts](<C:/payincus/server/src/routes/proxy-sites.ts>)：创建依赖请求旧actor与实例归属，经host/domain/count等await后createProxySite，写入不重新核对账户当前状态/角色。 |
| R1-128 | P2 | 反代创建允许已过期、已释放资源或执行操作任务中的实例 | 存在 | [server/src/routes/proxy-sites.ts](<C:/payincus/server/src/routes/proxy-sites.ts>)：创建仅明确阻止suspended，未统一检查expired/deleted/resourcesReleased或活动操作任务；实际可达状态待夹具。 |
| R1-129 | P1 | 反代修改未复核当前账号权限，认证后封禁仍可提交 | 存在 | [server/src/routes/proxy-sites.ts](<C:/payincus/server/src/routes/proxy-sites.ts>)：编辑沿用请求授权与旧site归属，远端/DB修改前无最新actor状态门禁。 |
| R1-130 | P1 | 反代修改使用过时实例快照且未串行化，与转移和禁用产生越权或状态分歧 | 存在 | [server/src/routes/proxy-sites.ts](<C:/payincus/server/src/routes/proxy-sites.ts>)：编辑读取site/instance旧快照，多次await后远端及数据库写未与转移/禁用统一串行或CAS。 |
| R1-131 | P1 | Caddy 配置缺失时删除站点仍丢弃数据库清理记录 | 存在 | [server/src/routes/proxy-sites.ts](<C:/payincus/server/src/routes/proxy-sites.ts>)：删除远端失败或缺配置仍丢DB清理记录；刷新先delete再add，新配置失败中断旧站点。 |
| R1-132 | P2 | 反代路由宽松解析资源 ID，错误标识仍修改数字前缀对应站点 | 已有防护 | [server/src/routes/proxy-sites.ts:36](<C:/payincus/server/src/routes/proxy-sites.ts:36>)：ID parser严格正整数与safe integer，拒绝后缀/小数，原数字前缀误操作已防。 |
| R1-133 | P1 | 转让提交后查询并清理代理站点，误删新主人合法创建的站点 | 存在 | [server/src/routes/transfers.ts](<C:/payincus/server/src/routes/transfers.ts>)：归属提交后再查当前站点/快照/端口清理，可能删新主人资源；远端失败仍丢记录。独占一机一卖转移必须单独保留。 |
| R1-134 | P1 | 转让忽略 Caddy 清理失败或配置缺失，删除数据库记录而遗留旧路由 | 存在 | [server/src/routes/transfers.ts](<C:/payincus/server/src/routes/transfers.ts>)：归属提交后再查当前站点/快照/端口清理，可能删新主人资源；远端失败仍丢记录。独占一机一卖转移必须单独保留。 |
| R1-135 | P2 | 转让清理反代站点未关闭 Caddy 客户端 | 部分存在 | [server/src/lib/caddy-client.ts:13](<C:/payincus/server/src/lib/caddy-client.ts:13>)：有全局Agent cache复用，不是每次请求创建一个泄漏；仍无淘汰/生命周期关闭，同CA路径更新复用旧信任需处理。 |
| R1-136 | P1 | 转让提交后清理当前快照与策略，误删新主人已成功保存的资源 | 存在 | [server/src/routes/transfers.ts](<C:/payincus/server/src/routes/transfers.ts>)：归属提交后再查当前站点/快照/端口清理，可能删新主人资源；远端失败仍丢记录。独占一机一卖转移必须单独保留。 |
| R1-137 | P1 | 转让忽略端口、快照和历史备份远端清理失败，丢失记录而遗留旧资源 | 存在 | [server/src/routes/transfers.ts](<C:/payincus/server/src/routes/transfers.ts>)：归属提交后再查当前站点/快照/端口清理，可能删新主人资源；远端失败仍丢记录。独占一机一卖转移必须单独保留。 |
| R1-138 | P2 | 转让删除实际端口映射后未同步宿主机已用端口计数 | 存在 | [server/src/db/port-mappings.ts:276](<C:/payincus/server/src/db/port-mappings.ts:276>)：transfers两处删除映射后未重计natPortsUsedCount；deletePortMapping helper仅删除行，不更新宿主计数。 |
| R1-139 | P1 | 批量端口自定义数组绕过声明区间与实例配额 | 部分存在 | [server/src/routes/instances.ts](<C:/payincus/server/src/routes/instances.ts>)：批量finalMappings已有数量/唯一性/配额/公网范围校验；缺匹配声明private区间。 |
| R1-140 | P1 | 批量端口冲突重试数组绕过宿主机公网端口范围 | 已有防护 | [server/src/routes/instances.ts](<C:/payincus/server/src/routes/instances.ts>)：统一finalMappings对公网NAT区间与both计数进行校验，冲突重试数组不直接跳过。 |
| R1-141 | P2 | 主机 Caddy 测试与地址同步未关闭连接客户端 | 部分存在 | [server/src/lib/caddy-client.ts:13](<C:/payincus/server/src/lib/caddy-client.ts:13>)：有全局Agent cache复用，不是每次请求创建一个泄漏；仍无淘汰/生命周期关闭，同CA路径更新复用旧信任需处理。 |
| R1-142 | P1 | 实例地址同步先删除代理路由且失败后无法重试 | 存在 | [server/src/routes/instances.ts:3361](<C:/payincus/server/src/routes/instances.ts:3361>)：先持久化新IPv4再deleteSite/addSite，失败只记录；下次IPv4未变化便不重试，旧远端路由已丢。批量宿主同步同样。 |
| R1-143 | P1 | 并发站点禁用被过期的实例地址同步重新启用 | 部分存在 | [server/src/routes/hosts.ts:4712](<C:/payincus/server/src/routes/hosts.ts:4712>)：同步有site.status active && site.enabled检查，不会故意启用已读到的禁用站点；读取后并发disable与delete/add仍无统一锁，可能重新启用。 |
| R1-144 | P1 | 重建在 Caddy 配置缺失时跳过远端清理却删除站点记录 | 部分存在 | [server/src/workers/instanceTaskWorker.ts](<C:/payincus/server/src/workers/instanceTaskWorker.ts>)：cleanupRecreatedInstanceRecords删proxySites；远端清理在源Caddy缺配置时跳过。不能因此把重建记录清理等同远端清理成功，需残留路由夹具。 |
| R1-145 | P1 | 改节点先切换数据库丢失站点后才清理旧 Caddy 路由 | 存在 | [server/src/workers/instanceTaskWorker.ts:1989](<C:/payincus/server/src/workers/instanceTaskWorker.ts:1989>)：change_host事务先删proxySites并切host，之后才清源Caddy；失败时旧路由仍在而数据库重试依据已丢。 |
| R1-146 | P2 | 重建和改节点清理 Caddy 客户端未关闭 | 部分存在 | [server/src/lib/caddy-client.ts:13](<C:/payincus/server/src/lib/caddy-client.ts:13>)：有全局Agent cache复用，不是每次请求创建一个泄漏；仍无淘汰/生命周期关闭，同CA路径更新复用旧信任需处理。 |
| R1-147 | P2 | 启动或重启成功恢复 IPv6 后仍抛原始错误并保留错误任务和实例状态 | 存在 | [server/src/workers/instanceTaskWorker.ts](<C:/payincus/server/src/workers/instanceTaskWorker.ts>)：IPv6 file-exists回退成功仍抛旧err；暂移eth1后再次失败缺finally恢复；rebuildDevices仅VM赋值，容器分支不可达。不能削弱宿主/客机IPv6验证。 |
| R1-148 | P1 | 启动、重启和重装的路由回退再次失败后不恢复临时移除的 eth1 | 存在 | [server/src/workers/instanceTaskWorker.ts](<C:/payincus/server/src/workers/instanceTaskWorker.ts>)：IPv6 file-exists回退成功仍抛旧err；暂移eth1后再次失败缺finally恢复；rebuildDevices仅VM赋值，容器分支不可达。不能削弱宿主/客机IPv6验证。 |
| R1-149 | P2 | 容器重装的 IPv6 路由恢复分支因只读取 VM 设备变量而不可达 | 存在 | [server/src/workers/instanceTaskWorker.ts](<C:/payincus/server/src/workers/instanceTaskWorker.ts>)：IPv6 file-exists回退成功仍抛旧err；暂移eth1后再次失败缺finally恢复；rebuildDevices仅VM赋值，容器分支不可达。不能削弱宿主/客机IPv6验证。 |
| R1-150 | P2 | 重叠轮询各自重新计算并发配额导致同宿主机同时启动超过五个任务 | 存在 | [server/src/workers/instanceTaskWorker.ts:414](<C:/payincus/server/src/workers/instanceTaskWorker.ts:414>)：claim锁后未重计轻任务5上限；选PENDING后等待实例锁，无status CAS即可更新启动。 |
| R1-151 | P1 | 任务领取在等待行锁后无条件更新导致已成功取消的轻重任务被重新启动 | 存在 | [server/src/workers/instanceTaskWorker.ts:414](<C:/payincus/server/src/workers/instanceTaskWorker.ts:414>)：claim锁后未重计轻任务5上限；选PENDING后等待实例锁，无status CAS即可更新启动。 |
| R1-152 | P1 | 改节点路由和任务创建对 hostId 含义不一致导致所有合法请求失败 | 已有防护 | [server/src/routes/instances.ts:3564](<C:/payincus/server/src/routes/instances.ts:3564>)：路由task.hostId明确设targetHostId，worker以该字段取目标且executeChangeHostTask校验target；原hostId含义不一致导致全失败问题不成立。 |
| R1-153 | P2 | Incus 按状态分组的操作列表未被展平导致忙碌恢复无法找到过期更新 | 存在 | [server/src/lib/incus/incus-instances.ts:30](<C:/payincus/server/src/lib/incus/incus-instances.ts:30>)：隔离复现：状态数组未展平、i-10误匹配i-1、Updating instance未识别。必须精确实例身份且限制可取消操作。 |
| R1-154 | P1 | Incus 过期更新取消以实例名前缀匹配导致误取消另一实例操作 | 存在 | [server/src/lib/incus/incus-instances.ts:30](<C:/payincus/server/src/lib/incus/incus-instances.ts:30>)：隔离复现：状态数组未展平、i-10误匹配i-1、Updating instance未识别。必须精确实例身份且限制可取消操作。 |
| R1-155 | P2 | Incus 官方 Updating instance 描述未被识别导致忙碌更新取消策略失效 | 存在 | [server/src/lib/incus/incus-instances.ts:30](<C:/payincus/server/src/lib/incus/incus-instances.ts:30>)：隔离复现：状态数组未展平、i-10误匹配i-1、Updating instance未识别。必须精确实例身份且限制可取消操作。 |
| R1-156 | P3 | 无调用入口的 Incus 镜像下载与管理适配器及独占长轮询残留 | 存在 | [server/src/lib/incus/incus-images.ts](<C:/payincus/server/src/lib/incus/incus-images.ts>)：旧镜像适配器经index导出，但相关list/get/pull/alias函数未发现运行调用者；长轮询waitForOperationLong只被该孤立适配器使用，属于维护残留，不代表正在使用的镜像交付退役。 |
| R1-157 | P2 | Incus 已取消的异步操作仍轮询到总超时并丢失取消原因 | 存在 | [server/src/lib/incus/incus-utils.ts](<C:/payincus/server/src/lib/incus/incus-utils.ts>)：waitForOperation只Success/Failure，没有Cancelled终态，取消后持续轮询至总超时。 |
| R1-158 | P1 | Incus 连接池仅按节点 ID 复用而忽略当前地址或证书配置 | 存在 | [server/src/lib/incus/incus-pool.ts:78](<C:/payincus/server/src/lib/incus/incus-pool.ts:78>)：仅host.id缓存；remove先awaitclose后delete、pending连接不失效；closeAll等待后clear存在旧配置重入竞态。 |
| R1-159 | P1 | 清理 Incus 连接时未失效进行中的连接导致旧配置重新进入缓存 | 存在 | [server/src/lib/incus/incus-pool.ts:78](<C:/payincus/server/src/lib/incus/incus-pool.ts:78>)：仅host.id缓存；remove先awaitclose后delete、pending连接不失效；closeAll等待后clear存在旧配置重入竞态。 |
| R1-160 | P2 | Incus 连接清理等待关闭时仍向并发调用者返回已关闭连接 | 存在 | [server/src/lib/incus/incus-pool.ts:78](<C:/payincus/server/src/lib/incus/incus-pool.ts:78>)：仅host.id缓存；remove先awaitclose后delete、pending连接不失效；closeAll等待后clear存在旧配置重入竞态。 |
| R1-161 | P2 | Incus 命令输出读取不受调用方总时限约束 | 存在 | [server/src/lib/incus/incus-instances.ts:917](<C:/payincus/server/src/lib/incus/incus-instances.ts:917>)：execWithOutput的timeout只传exec，后续readFile缺调用方剩余总期限。 |
| R1-162 | P2 | Incus 输出读取失败被当成成功空输出或把 HTTP 错误正文当命令输出 | 存在 | [server/src/lib/incus/incus-instances.ts:917](<C:/payincus/server/src/lib/incus/incus-instances.ts:917>)：输出readFile catch返回空字符串且不检查HTTP statusCode，错误可被当成功空输出或错误正文。 |
| R1-163 | P2 | Cloud-init 将仍在执行的 modules-final 阶段判成完成并永久缓存 | 存在 | [server/src/lib/cloud-init-status.ts:155](<C:/payincus/server/src/lib/cloud-init-status.ts:155>)：实际detectCloudInitStatus模拟modules-final得ready=true/done，错误完成可永久缓存；已隔离复现。 |
| R1-164 | P2 | Cloud-init 忽略最后阶段完成记录并丢失该阶段错误 | 存在 | [server/src/lib/cloud-init-status.ts](<C:/payincus/server/src/lib/cloud-init-status.ts>)：仅读status.json/boot-finished，未核对result.json最终阶段错误。 |
| R1-165 | P3 | 未使用的 Incus 网络适配器与孤立资源类型残留 | 存在 | [server/src/lib/incus/incus-network.ts](<C:/payincus/server/src/lib/incus/incus-network.ts>)：listNetworks/getNetwork只定义并经barrel导出，未发现业务调用者；IncusNetwork类型依赖该孤立模块。仅维护残留。 |
| R1-166 | P3 | 无调用的旧重试模块和四项 JSON 结构校验残留 | 部分存在 | [server/src/lib/retry.ts](<C:/payincus/server/src/lib/retry.ts>)：通用withRetry等只在本模块内部/注释出现，无应用导入，旧retry模块孤立；未找到对方四项JSON结构校验同类模块，不能凭清单删除其它实际校验。 |
| R1-167 | P2 | 停用所有审查规则后分析器重新使用全部内置规则 | 存在 | [server/src/lib/instance-audit.ts:384](<C:/payincus/server/src/lib/instance-audit.ts:384>)：空rules回退全部内置；parseConnections固定ss列，netstat回退不同列序不适配。 |
| R1-168 | P2 | 主机审查 netstat 回退输出被按 ss 列顺序解析 | 存在 | [server/src/lib/instance-audit.ts:384](<C:/payincus/server/src/lib/instance-audit.ts:384>)：空rules回退全部内置；parseConnections固定ss列，netstat回退不同列序不适配。 |
| R1-169 | P2 | 抽奖 Webhook 签名遗漏实际发送正文中的时间戳 | 存在 | [server/src/lib/lottery-notifier.ts:242](<C:/payincus/server/src/lib/lottery-notifier.ts:242>)：签名JSON(payload)，发送JSON({...payload,timestamp})，签名与实际body不同。 |
| R1-170 | P1 | 抽奖出站通知绕过连接时地址校验和限时发送 | 已有防护 | [server/src/lib/lottery-notifier.ts:249](<C:/payincus/server/src/lib/lottery-notifier.ts:249>)：已有safeFetch连接时校验及AbortSignal.timeout，出站绕过问题不成立。 |
| R1-171 | P1 | 登录和找回密码的 Turnstile 配置开关行为与前端及注册校验相反 | 已有防护 | [server/src/lib/turnstile.ts:82](<C:/payincus/server/src/lib/turnstile.ts:82>)：login/register/forgot统一verifier，enabled=false直接跳过；完整site/secret条件一致。 |
| R1-172 | P2 | Turnstile 验证请求缺少总超时使认证请求长期挂起 | 存在 | [server/src/lib/turnstile.ts:48](<C:/payincus/server/src/lib/turnstile.ts:48>)：fetch及response.json无AbortSignal总超时，认证可长时间等待。 |
| R1-173 | P2 | 自定义 Telegram 发送无超时阻塞通知与等待它的业务流程 | 已有防护 | [server/src/lib/notifier.ts:1677](<C:/payincus/server/src/lib/notifier.ts:1677>)：自定义Telegram发送已有AbortSignal.timeout，不按旧清单重复改。 |
| R1-174 | P1 | 终端连接建立期间未登记会话导致断开或撤销后仍建立后台连接 | 部分存在 | [server/src/lib/terminal-proxy.ts:546](<C:/payincus/server/src/lib/terminal-proxy.ts:546>)：异步前已注册close/error，断开后关闭新建连接；尚未activeSessions登记时的凭据撤销仍需复核。 |
| R1-175 | P2 | 终端重连在会话关闭后继续建立无记录的后台连接 | 已有防护 | [server/src/lib/terminal-proxy.ts:300](<C:/payincus/server/src/lib/terminal-proxy.ts:300>)：重连等待后及新连接完成后核对activeSessions对象、reconnectGeneration和client状态，不符关闭新socket。 |
| R1-176 | P2 | 终端路由最终连接数检查与建立之间的异步查询允许超过配额 | 已有防护 | [server/src/routes/terminal.ts:401](<C:/payincus/server/src/routes/terminal.ts:401>)：所有异步建连前同步claimTerminalConnection预留名额，close释放pending且release幂等。 |
| R1-177 | P1 | 终端路由使用异步查询前的授权状态在注销封禁或实例变化后连接 | 部分存在 | [server/src/routes/terminal.ts:285](<C:/payincus/server/src/routes/terminal.ts:285>)：票据领取后已有会话撤销检查和最新用户读取，再经实例/宿主/套餐await后createTerminalSession；最后建连前缺统一再验证，窗口待撤销/转移时序夹具，而非完全未认证。 |
| R1-178 | P2 | 保存终端命令计数与插入分离允许并发超过100条 | 已有防护 | [server/src/db/terminal-saved-commands.ts:152](<C:/payincus/server/src/db/terminal-saved-commands.ts:152>)：事务advisory lock串行count和insert，100条上限已有并发保护。 |
| R1-179 | P2 | 保存终端命令的旧行快照覆盖并发字段且删除竞争产生500 | 存在 | [server/src/db/terminal-saved-commands.ts:243](<C:/payincus/server/src/db/terminal-saved-commands.ts:243>)：根据旧行生成nextName/Command/Description后全部写回，覆盖未提交字段并发更新；删除后无updated行仍map结果。 |
| R1-180 | P2 | 保存终端命令写操作沿用认证前账号状态 | 存在 | [server/src/db/terminal-saved-commands.ts](<C:/payincus/server/src/db/terminal-saved-commands.ts>)：创建事务/更新仅userId，不核对最新账户状态和会话；待认证后封禁复现。 |
| R1-181 | P2 | 工单自动关闭使用旧解决时间和旧候选忽略最新回复 | 已有防护 | [server/src/db/tickets.ts:1348](<C:/payincus/server/src/db/tickets.ts:1348>)：逐项事务重新读resolved/最后回复，updateMany约束updatedAt；仅实际closedTickets发送通知日志。 |
| R1-182 | P2 | 工单自动关闭未成功时仍发送关闭通知和成功日志 | 已有防护 | [server/src/db/tickets.ts:1348](<C:/payincus/server/src/db/tickets.ts:1348>)：逐项事务重新读resolved/最后回复，updateMany约束updatedAt；仅实际closedTickets发送通知日志。 |
| R1-183 | P2 | 工单分页允许负数/小数与非有限输入并产生500和错误元数据 | 部分存在 | [server/src/routes/tickets.ts:93](<C:/payincus/server/src/routes/tickets.ts:93>)：正整数parser拒绝非整数/非有限但未safe integer；部分take有max，offset边界待独立DB验证。 |
| R1-184 | P2 | 工单ID校验接受小数并截断为真实工单/消息ID，超范围返回500 | 部分存在（2026-10-28复审纠正） | 原strict safe ID已拒小数，但2147483648实际PG/Fastify仍500，初审未覆盖PG Int上限；现已修且154边界请求通过，见修复台账。 |
| R1-185 | P2 | 错误的可选实例ID被静默丢弃并创建错误关联工单 | 部分存在（2026-10-28复审纠正） | 原错误optional已返回null并报错、不静默丢弃；数据库Int范围仍漏限，本批与R184统一修复并验证，见修复台账。 |
| R1-186 | P1 | 网站工单写入未在事务内复核当前账户与会话，封禁/登出/管理员降级仍可写入 | 存在 | [server/src/db/tickets.ts:297](<C:/payincus/server/src/db/tickets.ts:297>)：网站工单路由先授权，图片上传等await之后事务直接create；事务未接actor/session核验，认证后封禁/注销/降权窗口待DB实证。 |
| R1-187 | P2 | 创建工单的实例归属/删除状态检查与写入分离，实例转移或删除后仍关联旧权限 | 存在 | [server/src/routes/tickets.ts](<C:/payincus/server/src/routes/tickets.ts>)：创建先查实例归属后await图片上传再db.createTicket，写入事务没有重新核对实例归属/删除状态。 |
| R1-188 | P1 | 工单图片代理未校验目标或跳转，可读取图床返回的内网地址 | 已有防护 | [server/src/routes/tickets.ts:364](<C:/payincus/server/src/routes/tickets.ts:364>)：assertSafeHttpUrl+safeFetch连接校验，redirect manual；stream逐段限制MAX_TICKET_IMAGE_SIZE。 |
| R1-189 | P2 | 工单图片代理无响应体大小限制，可将超过附件记录的内容完整缓冲 | 已有防护 | [server/src/routes/tickets.ts:364](<C:/payincus/server/src/routes/tickets.ts:364>)：assertSafeHttpUrl+safeFetch连接校验，redirect manual；stream逐段限制MAX_TICKET_IMAGE_SIZE。 |
| R1-190 | P2 | 工单图片代理响应体重置和超时未被捕获，返回500 | 部分存在 | [server/src/routes/tickets.ts:389](<C:/payincus/server/src/routes/tickets.ts:389>)：body异常已捕获返回502，原500问题已防；超时/reset统一说image too large，错误准确性仍差。 |
| R1-191 | P1 | Bot工单回复等待写锁后沿用旧账户/权限，封禁或角色/宿主机归属变更后仍可回复 | 实现不同 | [server/src/routes/telegram.ts](<C:/payincus/server/src/routes/telegram.ts>)：当前Telegram路由未发现Bot工单回复入口，主要绑定/webhook/群组功能；现行网站工单写入风险另见R186/187，不据旧Bot清单虚构本库运行调用链。 |
| R1-192 | P2 | 初始化命令计数与创建分离允许并发超过50条 | 存在 | [server/src/db/custom-init-commands.ts:143](<C:/payincus/server/src/db/custom-init-commands.ts:143>)：count与create分离；写入不复核status；find旧行后update(id)与delete竞态；name仅trim后可空，command可全空白。 |
| R1-193 | P2 | 初始化命令写操作沿用旧账号状态与会话权限 | 存在 | [server/src/db/custom-init-commands.ts:143](<C:/payincus/server/src/db/custom-init-commands.ts:143>)：count与create分离；写入不复核status；find旧行后update(id)与delete竞态；name仅trim后可空，command可全空白。 |
| R1-194 | P2 | 初始化命令更新与删除竞争返回500 | 存在 | [server/src/db/custom-init-commands.ts:143](<C:/payincus/server/src/db/custom-init-commands.ts:143>)：count与create分离；写入不复核status；find旧行后update(id)与delete竞态；name仅trim后可空，command可全空白。 |
| R1-195 | P2 | 初始化命令ID未限制整数边界，分数操作错误记录并返回500 | 已有防护 | [server/src/routes/custom-init-commands.ts:23](<C:/payincus/server/src/routes/custom-init-commands.ts:23>)：严格数字正ID及safe integer，已拒绝小数/溢出。 |
| R1-196 | P2 | 初始化命令接受空白名称与无效空白内容 | 存在 | [server/src/db/custom-init-commands.ts:143](<C:/payincus/server/src/db/custom-init-commands.ts:143>)：count与create分离；写入不复核status；find旧行后update(id)与delete竞态；name仅trim后可空，command可全空白。 |
| R1-197 | P2 | 初始化命令选择器切换发行版时丢失请求并显示旧命令 | 存在 | [client/src/components/extensions/InitCommandSelector.vue](<C:/payincus/client/src/components/extensions/InitCommandSelector.vue>)：loading时直接return，新distro变化请求被丢且可能显示旧命令。 |
| R1-198 | P2 | 初始化命令保存重复提交且等待时关闭丢失表单 | 存在 | [client/src/components/extensions/InitCommandModal.vue](<C:/payincus/client/src/components/extensions/InitCommandModal.vue>)：保存/详情缺完整props目标及session生命周期；关闭、复用与迟到响应需要统一门禁（详情另见InitCommandDetailModal）。 |
| R1-199 | P2 | 初始化命令详情复用时标题与内容来自不同记录 | 存在 | [client/src/components/extensions/InitCommandModal.vue](<C:/payincus/client/src/components/extensions/InitCommandModal.vue>)：保存/详情缺完整props目标及session生命周期；关闭、复用与迟到响应需要统一门禁（详情另见InitCommandDetailModal）。 |
| R1-200 | P2 | 初始化命令重复禁用后界面错误显示启用 | 存在 | [client/src/views/ExtensionsView.vue](<C:/payincus/client/src/views/ExtensionsView.vue>)：toggle await后cmd.enabled=!cmd.enabled；重复同动作会错误反转UI。 |
| R1-201 | P3 | 数据库优化包装模块无任何运行入口或调用者，保留退役查询残留 | 存在 | [server/src/db/optimizations.ts](<C:/payincus/server/src/db/optimizations.ts>)：批量/游标/轻查询导出仅在该包装模块定义，未发现运行入口import或业务调用，属维护残留；不做全库重构。 |
| R1-202 | P1 | 流量 Discord 通知预校验 DNS 后使用未经连接校验的请求，可访问私有目标 | 已有防护 | [server/src/services/traffic-notifier.ts:352](<C:/payincus/server/src/services/traffic-notifier.ts:352>)：Discord使用safeFetch连接时校验；Telegram/Discord均有15秒AbortSignal，覆盖响应body读取期限。 |
| R1-203 | P2 | 流量 Telegram 与 Discord 发送请求或错误响应体停滞时无截止时间 | 已有防护 | [server/src/services/traffic-notifier.ts:352](<C:/payincus/server/src/services/traffic-notifier.ts:352>)：Discord使用safeFetch连接时校验；Telegram/Discord均有15秒AbortSignal，覆盖响应body读取期限。 |
| R1-204 | P3 | LazyImage 与 VirtualList 组件没有应用入口或调用者，保留未使用残留 | 存在 | [client/src/components/LazyImage.vue](<C:/payincus/client/src/components/LazyImage.vue>)：LazyImage/VirtualList未发现应用导入或注册调用者，属维护残留，未执行组件删除。 |
| R1-205 | P2 | 实例账单面板关闭再打开后，旧请求覆盖当前账单结果 | 实现不同 | [client/src/components/instance/modals/RenewModal.vue](<C:/payincus/client/src/components/instance/modals/RenewModal.vue>)：未找到对方InstanceBillingTab账单面板；当前续费modal及独立Orders/Billing实现不同，不虚构相同关闭重开入口。 |
| R1-206 | P2 | 实例账单总数减少时停留在越界页，空记录与隐藏分页无法恢复 | 实现不同 | [client/src/views/OrdersView.vue](<C:/payincus/client/src/views/OrdersView.vue>)：未找到对方实例账单面板分页实现；当前订单页另有分页，不能直接套用旧面板越界修法。 |
| R1-207 | P3 | 旧 PublicAuthShell、专属 useM3Auth 与 PlanetScene 已无应用调用者 | 存在 | [client/src/components/public/PublicAuthShell.vue](<C:/payincus/client/src/components/public/PublicAuthShell.vue>)：PublicAuthShell/useM3Auth仅旧代码互引、无现行页面消费者；PlanetScene未找到，不能说三者均有同文件残留。 |
| R1-208 | P2 | 状态调度器先截取近期记录再筛选到期实例，积压实例持续被遗漏 | 存在 | [server/src/services/status-scheduler.ts:125](<C:/payincus/server/src/services/status-scheduler.ts:125>)：先order status/updatedAt desc并take batchSize*3，再筛选due；近期非due候选能持续挤掉较旧待同步实例。 |
| R1-209 | P3 | 镜像选择器卸载后保留全局点击监听，重复进入页面累积失效处理器 | 已有防护 | [client/src/components/instance/ImageSelector.vue:122](<C:/payincus/client/src/components/instance/ImageSelector.vue:122>)：onUnmounted已remove全局click handler，原累积监听问题不成立。 |
| R1-210 | P3 | README实例备份能力和部署文档迁移状态描述已过时 | 部分存在 | [README.md](<C:/payincus/README.md>)：部分备份/Redis/迁移描述过时；客机备份后端仍运行，不据对方退役描述删除功能。 |
| R1-211 | P3 | 数据库兼容行类型残留无调用的旧BackupPolicy与SnapshotPolicy定义 | 存在 | [server/src/types/database.ts](<C:/payincus/server/src/types/database.ts>)：server兼容BackupPolicy/SnapshotPolicy定义无server调用者；client同名类型是独立实际定义，不能混为server使用。 |
| R1-212 | P3 | Prisma注释仍描述旧域名邮箱、失效标记和全局AFF限制且价格单位不明确 | 部分存在 | [server/prisma/schema.prisma:515](<C:/payincus/server/prisma/schema.prisma:515>)：User仍留域名邮箱系统标题，token注释仍写refresh前缀/null用户级而实际身份演进；多数金额已明确元/Bytes等，不判全部价格单位缺失。仅维护文档项。 |
| R1-213 | P3 | 旧隐式Turnstile工具和composable只互相引用，没有应用调用者 | 存在 | [client/src/composables/useTurnstile.ts](<C:/payincus/client/src/composables/useTurnstile.ts>)：旧composable/utils仅互引；现行TurnstileWidget使用独立实现。只判旧工具孤立，不删除现行验证。 |
| R1-214 | P3 | 共享格式化与前端计费工具保留六个无调用导出 | 部分存在 | [client/src/utils/billing.ts](<C:/payincus/client/src/utils/billing.ts>)：getTimeGreeting在Dashboard、calculateDailyPrice在ChangePlan、calculateDiscountedPrice在Billing实际使用；getCycleDays/calculatePriceDiff等部分无client调用，不照搬全部六项删除。 |
| R1-215 | P2 | 合法大流量计数或限额达到1024TB时共享显示工具输出undefined单位 | 存在 | [client/src/utils/formatters.ts:32](<C:/payincus/client/src/utils/formatters.ts:32>)：formatBytes(1024**5)实际返回1.0 undefined；需钳制单位/处理异常数字。 |
| R1-216 | P2 | 套餐详情旧路由请求成功覆盖当前套餐，旧请求失败跳离当前页面 | 实现不同 | [client/src/views/resources/MyPackagesView.vue](<C:/payincus/client/src/views/resources/MyPackagesView.vue>)：本库无对方PackageDetailView；当前套餐页面生命周期按现有入口另核，不能声称旧详情修法适用。 |
| R1-217 | P2 | 缓存套餐详情停用后请求仍跳转其他页面，再进入同套餐不刷新 | 实现不同 | [client/src/views/resources/MyPackagesView.vue](<C:/payincus/client/src/views/resources/MyPackagesView.vue>)：本库无对方PackageDetailView；当前套餐页面生命周期按现有入口另核，不能声称旧详情修法适用。 |
| R1-218 | P2 | 旧套餐删除完成后跳离当前其他套餐页面 | 实现不同 | [client/src/views/resources/MyPackagesView.vue](<C:/payincus/client/src/views/resources/MyPackagesView.vue>)：本库无对方PackageDetailView；当前套餐页面生命周期按现有入口另核，不能声称旧详情修法适用。 |
| R1-219 | P1 | 缓存方案编辑页显示旧方案内容却保存到新路由方案 | 存在 | [client/src/views/resources/PackageFormView.vue](<C:/payincus/client/src/views/resources/PackageFormView.vue>)：loadPackage无seq，保存用当前route；旧完成可导航离新页面；清description转undefined不能清已有值，SLA另验。 |
| R1-220 | P2 | 方案保存结束后跳离用户已进入的其他页面 | 存在 | [client/src/views/resources/PackageFormView.vue](<C:/payincus/client/src/views/resources/PackageFormView.vue>)：loadPackage无seq，保存用当前route；旧完成可导航离新页面；清description转undefined不能清已有值，SLA另验。 |
| R1-221 | P2 | 方案描述与SLA无法正确清空 | 存在 | [client/src/views/resources/PackageFormView.vue](<C:/payincus/client/src/views/resources/PackageFormView.vue>)：loadPackage无seq，保存用当前route；旧完成可导航离新页面；清description转undefined不能清已有值，SLA另验。 |
| R1-222 | P2 | 静态缓存写入未纳入Service Worker后台生命周期且先于完成清理，突破条目上限 | 部分存在 | [client/public/sw.js:102](<C:/payincus/client/public/sw.js:102>)：cache.put未返回给waitUntil，生命周期可能提早结束；本库无对方条目上限实现。 |
| R1-223 | P3 | 遗留AFF回归脚本仍读取退役邮件模块，运行时在任何断言前失败 | 实现不同 | [server/package.json](<C:/payincus/server/package.json>)：未找到对方依赖退役邮件模块的旧AFF脚本；本库两个AFF守卫有清单且已在181项基线实际通过。 |
| R1-224 | P2 | 管理员用户历史页缓存未随目标用户和再次进入刷新，显示上一账户身份与财务记录 | 实现不同 | [client/src/views/admin/UsersView.vue](<C:/payincus/client/src/views/admin/UsersView.vue>)：未发现旧UserHistoryView；现行UsersView登录弹窗异步目标风险已列R305，不能虚构旧历史页面。 |
| R1-225 | P2 | 到期巡检旧请求覆盖新启动的运行状态并停止轮询 | 已有防护 | [client/src/components/admin/ExpiryEnforcementPanel.vue](<C:/payincus/client/src/components/admin/ExpiryEnforcementPanel.vue>)：refresh/action已有sequence、disposed和busy门禁，原旧请求覆盖新运行并停轮询已有保护。 |
| R1-226 | P2 | 隐藏巡检标签和缓存账单页继续轮询，并在其他页面报错 | 部分存在 | [client/src/components/admin/ExpiryEnforcementPanel.vue](<C:/payincus/client/src/components/admin/ExpiryEnforcementPanel.vue>)：poll看document visibility，但缺组件v-show/KeepAlive激活门禁；Billing页面自身无同类timer。 |
| R1-227 | P2 | 星座生肖徽章引用缺失渐变，背景未绘制 | 存在 | [client/public/badges](<C:/payincus/client/public/badges>)：无修改静态扫描178份SVG，48份含缺失url(#id)引用，如dark/aquarius的bg-a-air-d；未运行会重建目录的生成器。 |
| R1-228 | P2 | 生肖核心动画声明缺少分号、部分星座旋转缺少关键帧 | 存在 | [client/public/badges/dark/dog.svg:35](<C:/payincus/client/public/badges/dark/dog.svg:35>)：生肖样式含animation...alternate transform-origin缺分号；aquarius内animation:art而未找到@keyframes art。静态生成资产证据，实际动效仍需浏览器。 |
| R1-229 | P3 | 徽章生成器将JSX样式表达式重复写入每份SVG | 存在 | [scripts/generate-badges-from-html.mjs:230](<C:/payincus/scripts/generate-badges-from-html.mjs:230>)：全html正则收集<style>块并逐SVG注入，连JSX {`...`}原文也重复输出到178资产的相关系列；未运行会重建目录的生成器。 |
| R1-230 | P2 | 徽章目录返回实际图片地址后仍保持失败占位符 | 存在 | [client/src/components/BadgeImage.vue](<C:/payincus/client/src/components/BadgeImage.vue>)：仅watch badgeId/theme，目录返回真实assetURL后不清fallback状态。 |
| R1-231 | P2 | 徽章中心缓存返回不刷新且离开后仍处理请求结果 | 存在 | [client/src/components/entertainment/BadgeCenter.vue](<C:/payincus/client/src/components/entertainment/BadgeCenter.vue>)：onMounted loadOverview，缺onActivated及请求代次/卸载保护；缓存返回不刷新、旧完成仍回写。 |
| R1-232 | P2 | 实例徽章弹窗初始显示和关闭重开时读取状态不完整 | 存在 | [client/src/components/instance/InstanceBadgeModal.vue](<C:/payincus/client/src/components/instance/InstanceBadgeModal.vue>)：仅watch visible无immediate；emit可沿用旧ownership结果，初始打开/关闭重开需要代次绑定。 |
| R1-233 | P2 | 实例徽章弹窗刷新后仍向父组件回传旧请求徽章 | 存在 | [client/src/components/instance/InstanceBadgeModal.vue](<C:/payincus/client/src/components/instance/InstanceBadgeModal.vue>)：仅watch visible无immediate；emit可沿用旧ownership结果，初始打开/关闭重开需要代次绑定。 |
| R1-234 | P2 | 抽奖通知配置编辑未加载已保存的配置 | 已有防护 | [client/src/views/admin/EntertainmentView.vue:471](<C:/payincus/client/src/views/admin/EntertainmentView.vue:471>)：openNotificationModal先读取已保存notificationConfig回填表单，原未加载问题不成立。 |
| R1-235 | P2 | 管理端保存奖品将过期剩余库存写回数据库 | 存在 | [client/src/views/admin/EntertainmentView.vue:411](<C:/payincus/client/src/views/admin/EntertainmentView.vue:411>)：保存补货以旧remainQuantity+replenishAmount提交adminUpdatePrize，可覆盖期间抽奖减少的库存。 |
| R1-236 | P2 | 缺少谢谢参与奖品时耗尽概率区间被分给后续奖品 | 存在 | [server/src/db/lottery.ts:508](<C:/payincus/server/src/db/lottery.ts:508>)：固定random=0.1命中已耗尽50%区间、无nothing，实际返回后续奖品2；已隔离复现。 |
| R1-237 | P3 | 旧签到礼盒弹窗及分享辅助逻辑成为无入口残留 | 存在 | [client/src/components/CheckinModal.vue](<C:/payincus/client/src/components/CheckinModal.vue>)：旧CheckinModal无应用导入/注册调用者；当前签到入口走Entertainment实现，旧弹窗内分享辅助为孤立代码，未删除现行签到后端。 |
| R1-238 | P2 | VIP奖励说明显式清空后恢复旧内容 | 存在 | [client/src/components/admin/VipBenefitHallSettings.vue](<C:/payincus/client/src/components/admin/VipBenefitHallSettings.vue>)：description null??base恢复旧说明；逐条保存部分失败无成功id记录，重试重复；正小数舍入0后缺再次校验，后端同步核验。 |
| R1-239 | P2 | VIP奖励批量保存部分失败后重试重复创建并重删阻断 | 存在 | [client/src/components/admin/VipBenefitHallSettings.vue](<C:/payincus/client/src/components/admin/VipBenefitHallSettings.vue>)：description null??base恢复旧说明；逐条保存部分失败无成功id记录，重试重复；正小数舍入0后缺再次校验，后端同步核验。 |
| R1-240 | P2 | VIP余额奖励正小数舍入为零仍创建成功 | 存在 | [client/src/components/admin/VipBenefitHallSettings.vue](<C:/payincus/client/src/components/admin/VipBenefitHallSettings.vue>)：description null??base恢复旧说明；逐条保存部分失败无成功id记录，重试重复；正小数舍入0后缺再次校验，后端同步核验。 |
| R1-241 | P2 | VIP大厅隐藏与缓存返回缺少读取生命周期和失败重试 | 存在 | [client/src/components/entertainment/VipBenefitHall.vue](<C:/payincus/client/src/components/entertainment/VipBenefitHall.vue>)：loadBenefits缺sequence及activated生命周期，页面返回/旧请求的刷新与失败恢复缺口仍在。 |
| R1-242 | P2 | VIP单项与批量领取重叠并让旧概览恢复领取按钮 | 存在 | [client/src/components/entertainment/VipBenefitHall.vue](<C:/payincus/client/src/components/entertainment/VipBenefitHall.vue>)：claimAll只按bulkClaiming门禁，不拒已有claimingIds，单项与批量可重叠；load旧概览也无代次。 |
| R1-243 | P2 | VIP奖励反馈使用旧卡片文案数额且计时器越过页面生命周期 | 存在 | [client/src/components/entertainment/VipBenefitHall.vue](<C:/payincus/client/src/components/entertainment/VipBenefitHall.vue>)：领取反馈优先旧reward卡片而非claim snapshot，setTimeout无卸载清理，可能跨页显示过时数额/反馈。 |
| R1-244 | P1 | VIP规则替换接口把缺失或非数组输入当空规则清空配置 | 存在 | [server/src/routes/vip-levels.ts:58](<C:/payincus/server/src/routes/vip-levels.ts:58>)：非数组输入当[]替换规则，缺失/错型可清空配置。 |
| R1-245 | P2 | VIP规则初次读取失败后空编辑器仍可保存清空配置 | 存在 | [client/src/components/admin/VipLevelRulesEditor.vue](<C:/payincus/client/src/components/admin/VipLevelRulesEditor.vue>)：初读失败空表仍可保存，缺成功加载条件。 |
| R1-246 | P3 | 旧实例资源滑块与套餐选择组件已无维护代码引用 | 已有防护 | [client/src/components/instance/ResourceSlider.vue](<C:/payincus/client/src/components/instance/ResourceSlider.vue>)：ResourceSlider/ResourceSliders/PackageSelector仍由InstanceCreateView、AdminInstanceCreateView、HostCreateInstanceTab维护代码导入使用；原全退役结论不成立，保留。 |
| R1-247 | P2 | 切换宿主机创建套餐时旧方案和镜像覆盖当前选择 | 存在 | [client/src/components/host/HostCreateInstanceTab.vue](<C:/payincus/client/src/components/host/HostCreateInstanceTab.vue>)：套餐/镜像加载无seq；canSubmitGift未匹配当前targetUsername；完成反馈和初读缺目标/生命周期保护。 |
| R1-248 | P1 | 赠送目标修改或查询乱序后可创建给此前已验证的其他用户 | 存在 | [client/src/components/host/HostCreateInstanceTab.vue](<C:/payincus/client/src/components/host/HostCreateInstanceTab.vue>)：套餐/镜像加载无seq；canSubmitGift未匹配当前targetUsername；完成反馈和初读缺目标/生命周期保护。 |
| R1-249 | P2 | 创建完成反馈使用后来修改的目标且离开页面后仍生效 | 存在 | [client/src/components/host/HostCreateInstanceTab.vue](<C:/payincus/client/src/components/host/HostCreateInstanceTab.vue>)：套餐/镜像加载无seq；canSubmitGift未匹配当前targetUsername；完成反馈和初读缺目标/生命周期保护。 |
| R1-250 | P2 | 创建页未随节点与页面生命周期更新且初读失败无重试 | 存在 | [client/src/components/host/HostCreateInstanceTab.vue](<C:/payincus/client/src/components/host/HostCreateInstanceTab.vue>)：套餐/镜像加载无seq；canSubmitGift未匹配当前targetUsername；完成反馈和初读缺目标/生命周期保护。 |
| R1-251 | P1 | 管理员创建目标输入和异步验证失配导致给其他用户创建实例 | 已有防护 | [client/src/views/admin/AdminInstanceCreateView.vue](<C:/payincus/client/src/views/admin/AdminInstanceCreateView.vue>)：username查询有seq且输入变化清目标，提交核对当前身份；不按旧修法改赠送归属。 |
| R1-252 | P1 | 管理员创建期间新草稿被清空且页面离开后仍展示实例凭据 | 存在 | [client/src/views/admin/AdminInstanceCreateView.vue](<C:/payincus/client/src/views/admin/AdminInstanceCreateView.vue>)：创建完成toast/凭据/重置draft无dispose；canSubmit缺!imagesLoading，刷新中旧镜像仍可提交。 |
| R1-253 | P2 | 管理员镜像刷新中旧选项仍能用于创建 | 存在 | [client/src/views/admin/AdminInstanceCreateView.vue](<C:/payincus/client/src/views/admin/AdminInstanceCreateView.vue>)：创建完成toast/凭据/重置draft无dispose；canSubmit缺!imagesLoading，刷新中旧镜像仍可提交。 |
| R1-254 | P2 | 环境初始化只替换重复变量的首项，最后空值仍导致部署配置失效 | 存在 | [scripts/init-env.sh:57](<C:/payincus/scripts/init-env.sh:57>)：重复env变量只替换首项，读取最后空值仍使配置失效。 |
| R1-255 | P2 | 服务条款复用首次语言缓存，切换中英文后仍显示旧语言 | 存在 | [client/src/components/TermsOfServiceModal.vue](<C:/payincus/client/src/components/TermsOfServiceModal.vue>)：首次语言结果缓存，切语言和重开缺完整request generation，旧条款可能覆盖当前。 |
| R1-256 | P2 | 条款弹窗旧请求污染重开状态，缓存页面离开后仍覆盖其他页面 | 存在 | [client/src/components/TermsOfServiceModal.vue](<C:/payincus/client/src/components/TermsOfServiceModal.vue>)：首次语言结果缓存，切语言和重开缺完整request generation，旧条款可能覆盖当前。 |
| R1-257 | P2 | 共享 Markdown 表格渲染器错误地把表头单元格当数组，合法表格直接报错 | 存在 | [client/src/utils/markdown.ts](<C:/payincus/client/src/utils/markdown.ts>)：实际复现table row.map异常、链接/引用保留**原始语法**、title原引号破坏属性；另复现sanitizeHtml保留未引号onerror，未执行浏览器攻击。 |
| R1-258 | P2 | 自定义 Markdown 渲染忽略子 token，链接、引用、嵌套与任务列表显示原始语法 | 存在 | [client/src/utils/markdown.ts](<C:/payincus/client/src/utils/markdown.ts>)：实际复现table row.map异常、链接/引用保留**原始语法**、title原引号破坏属性；另复现sanitizeHtml保留未引号onerror，未执行浏览器攻击。 |
| R1-259 | P2 | Markdown 链接标题与图片说明未编码引号，破坏属性和可读内容 | 存在 | [client/src/utils/markdown.ts](<C:/payincus/client/src/utils/markdown.ts>)：实际复现table row.map异常、链接/引用保留**原始语法**、title原引号破坏属性；另复现sanitizeHtml保留未引号onerror，未执行浏览器攻击。 |
| R1-260 | P2 | 三语消息缺键与支付渠道占位符语法错误 | 待运行验证 | [client/src/locales/zh-CN.ts](<C:/payincus/client/src/locales/zh-CN.ts>)：基线i18n key守卫通过，不能据外部清单说整套三语缺键；硬编码邀请码页已定位R308。未提供原缺键/占位符的具体集合，本轮不把静态全绿当逐消息编译和实际显示验证。 |
| R1-261 | P3 | 数据中心地图文件扩展名与真实AVIF编码不符 | 实现不同 | [client/src/utils/homeRegionAtlas.ts](<C:/payincus/client/src/utils/homeRegionAtlas.ts>)：本库新矢量地图/球体采用当前目录与坐标实现，未发现对方旧datacenter地图文件；不据此替换现行地图编码。 |
| R1-262 | P1 | 兑换码管理与使用记录缺少所属节点约束 | 已有防护 | [server/src/routes/redeem-codes.ts:415](<C:/payincus/server/src/routes/redeem-codes.ts:415>)：update/delete/batch/usages使用ForHost约束且校验code归属host，旧跨节点缺口已有防护。 |
| R1-263 | P2 | 仅移除面板记录却向用户宣称实例已销毁 | 已有防护 | [client/src/components/host/HostInstancesTab.vue](<C:/payincus/client/src/components/host/HostInstancesTab.vue>)：当前仅数据库移除有保留远端/磁盘及暂停销售说明，不能当完整销毁或释放可售库存。 |
| R1-264 | P1 | 流量重置未复核最新归属与套餐价格 | 部分存在 | [server/src/routes/traffic.ts:374](<C:/payincus/server/src/routes/traffic.ts:374>)：付费实例所有者在锁内重读userId/状态和当前package/plan价格，原全部沿用旧归属/价格不成立；管理员/宿主免费分支仍用请求旧授权直接reset，付费分支未复核当前actor状态。 |
| R1-265 | P2 | 流量额度接受负数溢出与缺省清空 | 部分存在 | [server/src/lib/bigint-input.ts](<C:/payincus/server/src/lib/bigint-input.ts>)：流量parser拒负数/非数字/超过PG bigint；实例更新缺省明确保留原值，但nullable parser将空字符串视null，清空与显式无限语义仍需按各入口核对，不能判全部允许负数。 |
| R1-266 | P1 | 套餐地区和所有者接口泄露私有套餐信息 | 已有防护 | [server/src/routes/packages.ts:2982](<C:/payincus/server/src/routes/packages.ts:2982>)：地区official/market/zone有active/hidden/globalShared/owner角色及专区授权；好友地区限定getSharedToUser集合；所有者列表/admin scope有requireAdmin或isAdmin门禁。原无过滤泄露私有套餐问题的当前防护已定位。 |
| R1-267 | P2 | 方案规格与流量输入缺少合法范围校验 | 已有防护 | [server/src/routes/packages.ts:330](<C:/payincus/server/src/routes/packages.ts:330>)：normalizePackagePlanInput以整数范围校验CPU/内存/磁盘/配额/价格/周期，流量通过PG bigint parser；不是直接缺省写负数/溢出。 |
| R1-268 | P1 | VM网络修改忽略MAC匹配，重启后可能失联 | 已有防护 | [server/src/lib/network-payload-builder.ts:334](<C:/payincus/server/src/lib/network-payload-builder.ts:334>)：syncInstanceNetwork及removeInstanceIpv6向cloud-init传nicMacs，保留已有eth0/eth1 hwaddr或按实例生成；原完全忽略MAC匹配的代码已有防护，不拿此结论代替所有VM真机重启验收。 |
| R1-269 | P1 | 托管交付失败未释放资源且可覆盖超时终结 | 部分存在 | [server/src/lib/managed-instance-provision.ts](<C:/payincus/server/src/lib/managed-instance-provision.ts>)：managed路径成功updateMany已有status creating CAS；失败先回滚宿主资源/释放公网IPv4/补偿账目，之后远端delete失败被吞。实际残留/IP重分配风险需集成夹具；独占机器池路径的保护不能据此改为立即释放。 |
| R1-270 | P1 | 赠送实例交付启动前失败保留资源占用，日志失败干扰已启动交付 | 存在 | [server/src/routes/hosts.ts](<C:/payincus/server/src/routes/hosts.ts>)：赠送DB提交后resolve storage可能失败无外层补偿；启动provision后日志/消息失败返回500误导重试。 |
| R1-271 | P1 | 实时统计和运维同步使用过时Incus结果覆盖迁移/任务后的状态与地址 | 存在 | [server/src/services/status-scheduler.ts](<C:/payincus/server/src/services/status-scheduler.ts>)：网络结果持久化仅not deleted，缺host/version CAS；旧Incus结果可覆盖迁移/任务后新状态。 |
| R1-272 | P2 | 配额0和null混淆、已有站点使用量未校验、配额写入未与创建串行 | 部分存在 | [server/src/routes/instances.ts:4880](<C:/payincus/server/src/routes/instances.ts:4880>)：quota API已有整数范围及显式0校验，null转undefined不能清空；缺current site count和实例锁，与创建不串行。 |
| R1-273 | P1 | 单端口创建审计失败后删除已提交代理设备，残留数据库映射 | 已有防护 | [server/src/lib/instance-port-mapping.ts](<C:/payincus/server/src/lib/instance-port-mapping.ts>)：helper的设备/DB回滚在helper内完成，路由成功日志在helper返回之后，不再因路由审计异常进入设备回滚。 |
| R1-274 | P1 | 赠送时长覆盖并发续费/销毁/节点迁移/人工封停 | 存在 | [server/src/routes/hosts.ts:6923](<C:/payincus/server/src/routes/hosts.ts:6923>)：giftDays按旧实例expires/status写，无version/实例锁，覆盖并发续费/销毁/迁移/封停风险。 |
| R1-275 | P2 | 进程数提升先写数据库，远程失败后却报成功并阻止重试 | 已有防护 | [server/src/routes/instances.ts:5872](<C:/payincus/server/src/routes/instances.ts:5872>)：远端失败回滚previousProcesses并返回500，回滚失败PARTIAL_FAILURE；原假成功阻重试问题不成立。 |
| R1-276 | P2 | 允许IPv6留空创建的节点无法修改无关配置 | 已有防护 | [client/src/components/host/MyHostConfigTab.vue](<C:/payincus/client/src/components/host/MyHostConfigTab.vue>)：requiresIpv6ParentInterface仅当前或旧subnet有值时要求接口，IPv6全部留空可保存；清空已有值仍见R1-111。 |
| R1-277 | P2 | 运维审计分页小数或无效值进入Prisma产生错误 | 已有防护 | [server/src/routes/hosts.ts:8150](<C:/payincus/server/src/routes/hosts.ts:8150>)：审计使用parseHostAuditHistoryPageSize严格parser，与其他宽松分页不能混同。 |
| R1-278 | P2 | 首次销毁文案错误承诺全额退款 | 已有防护 | [client/src/components/instance/modals/DestroyInstanceModal.vue](<C:/payincus/client/src/components/instance/modals/DestroyInstanceModal.vue>)：销毁读取真实退款预览与已退款状态，无再次承诺全额；保持远端未删不释放资源。 |
| R1-279 | P1 | 实例详情旧请求覆盖当前实例并可使连续端口操作换目标 | 存在 | [client/src/views/InstanceDetailView.vue:870](<C:/payincus/client/src/views/InstanceDetailView.vue:870>)：loadInstance await GET后直接回写无route sequence，后续端口读取instance.value可能换目标；actionLoading只是入口门禁。 |
| R1-280 | P1 | 转移目标沿用已修改输入对应的旧查询身份 | 部分存在 | [client/src/components/instance/modals/TransferModal.vue](<C:/payincus/client/src/components/instance/modals/TransferModal.vue>)：canTransfer核对输入用户名与targetUser，watch清目标且search核对searchedUsername，原失配已防；关闭重开代次另验。 |
| R1-281 | P1 | 升级预览与实际提交方案不一致 | 存在 | [client/src/components/instance/modals/ChangePlanModal.vue](<C:/payincus/client/src/components/instance/modals/ChangePlanModal.vue>)：preview返回直接赋值、提交读取当前selectedPlanId，未绑定已预览套餐与当前选择。 |
| R1-282 | P2 | 缓存终端在别页处理粘贴快捷键并保留浮层 | 存在 | [client/src/views/TerminalView.vue](<C:/payincus/client/src/views/TerminalView.vue>)：keep-alive仅unmount清键盘监听；cloud-init/命令结果缺完整会话代次；保存后清当前草稿；页签button嵌套button。 |
| R1-283 | P2 | 终端实例切换和旧cloud-init检查跨会话污染状态 | 存在 | [client/src/views/TerminalView.vue](<C:/payincus/client/src/views/TerminalView.vue>)：keep-alive仅unmount清键盘监听；cloud-init/命令结果缺完整会话代次；保存后清当前草稿；页签button嵌套button。 |
| R1-284 | P2 | 快捷命令保存完成清除后来新草稿 | 存在 | [client/src/views/TerminalView.vue](<C:/payincus/client/src/views/TerminalView.vue>)：keep-alive仅unmount清键盘监听；cloud-init/命令结果缺完整会话代次；保存后清当前草稿；页签button嵌套button。 |
| R1-285 | P1 | 工单详情和回信异步结果跨工单回写 | 存在 | [client/src/views/TicketsView.vue:352](<C:/payincus/client/src/views/TicketsView.vue:352>)：openTicketDetail Promise.all后直接赋selectedTicket/messages；reply await后push当前messages并清当前draft，缺固定ticket代次。 |
| R1-286 | P2 | 工单实例卡卸载后旧读重建轮询并跨实例状态回写 | 部分存在 | [client/src/components/tickets/TicketInstanceOwnerCard.vue](<C:/payincus/client/src/components/tickets/TicketInstanceOwnerCard.vue>)：已有latestRequestId，但核对后await loadStats再建timer，卸载/目标改变仍可在间隙发生。 |
| R1-287 | P2 | 批量付费确认使用变化后的列表选中ID | 存在 | [client/src/views/InstancesView.vue:1289](<C:/payincus/client/src/views/InstancesView.vue:1289>)：预览捕获ID，确认却重新读selectedBillingActionIds，提交集合可与已预览付款对象不一致。 |
| R1-288 | P2 | 首次专区购买链接错误回落官方来源及优惠码旧结果污染报价 | 部分存在 | [client/src/views/InstanceCreateView.vue:870](<C:/payincus/client/src/views/InstanceCreateView.vue:870>)：优惠码校验缺request sequence，旧结果可污染当前报价；首次专区来源是否错误需另对路由初始化，不按此一症状判全部成立。 |
| R1-289 | P2 | 实例日志搜索反序覆盖当前条件 | 存在 | [client/src/components/instance/InstanceLogsTab.vue:39](<C:/payincus/client/src/components/instance/InstanceLogsTab.vue:39>)：loadLogs缺请求代次，搜索反序完成能覆盖当前条件。 |
| R1-290 | P2 | 重装和重建列表变更后保留已失效镜像/密钥 | 存在 | [client/src/components/instance/modals/RebuildModal.vue](<C:/payincus/client/src/components/instance/modals/RebuildModal.vue>)：Rebuild watch清失效SSH key但不清失效image；Recreate两者都不清，submit只验证非空而未验证当前列表成员。 |
| R1-291 | P2 | 端口冲突校验接受部分整数且数字重复未识别 | 存在 | [client/src/components/instance/modals/PortConflictModal.vue](<C:/payincus/client/src/components/instance/modals/PortConflictModal.vue>)：parseInt接受22x/22.5且22/022字符串判重失效；handleConfirm缺allValid函数守卫。 |
| R1-292 | P3 | 禁用附件上传时仍可删除已选文件 | 存在 | [client/src/components/tickets/TicketImageUploader.vue](<C:/payincus/client/src/components/tickets/TicketImageUploader.vue>)：removeFile及移除按钮未按disabled限制。 |
| R1-293 | P3 | 单日流量图X坐标除零 | 已有防护 | [client/src/components/instance/TrafficStats.vue:341](<C:/payincus/client/src/components/instance/TrafficStats.vue:341>)：单点length===1用50；HostInfoTab也Math.max(length-1,1)，不除零。 |
| R1-294 | P1 | 初始管理员密码被生产初始化拒绝 | 实现不同 | [server/src/db/init-prisma.ts:16](<C:/payincus/server/src/db/init-prisma.ts:16>)：安装默认hex16未满足通用复杂度，但实际init只校验12位/非占位符，不调用通用validatePassword；不能报告首装必失败。策略一致性另修。 |
| R1-295 | P1 | 安装时解析凭据失败会删除现有密钥配置 | 存在 | [scripts/install-panel.sh:2064](<C:/payincus/scripts/install-panel.sh:2064>)：提取凭据失败分支rm ENV_FILE，会删除已有密钥环境配置；需保留原文件并非零失败。 |
| R1-296 | P2 | 升级成功提示使用未定义变量导致异常退出 | 已有防护 | [scripts/install-panel.sh](<C:/payincus/scripts/install-panel.sh>)：升级summary版本变量已有定义，原未定义退出问题不成立。 |
| R1-297 | P1 | 样例数据脚本可修改普通环境管理员与创建固定密码账号 | 部分存在 | [server/scripts/seed-test-data.ts](<C:/payincus/server/scripts/seed-test-data.ts>)：test seed无环境门禁；bulk seed用URL字符串includes和FORCE_BULK_SEED=1可覆盖，保护不足。未运行任何seed。 |
| R1-298 | P2 | 非交互节点安装错误拒绝注入参数并等待终端输入 | 部分存在 | [server/templates/install.sh:3237](<C:/payincus/server/templates/install.sh:3237>)：注入参数已先合并，旧拒绝问题已防；未给port与confirm仍read，非交互可等待终端。 |
| R1-299 | P3 | 终端页签将关闭按钮嵌套在切换按钮内 | 存在 | [client/src/views/TerminalView.vue](<C:/payincus/client/src/views/TerminalView.vue>)：keep-alive仅unmount清键盘监听；cloud-init/命令结果缺完整会话代次；保存后清当前草稿；页签button嵌套button。 |
| R1-300 | P1 | 转账旧收款人/预览响应覆盖新输入，重复提交 | 实现不同 | [client/src/views/WalletView.vue](<C:/payincus/client/src/views/WalletView.vue>)：未发现对方余额转账/预览功能入口，不能误指现有实例PUSH或AFF兑换；新增同类功能时才适用。 |
| R1-301 | P1 | 节点列表及操作预览跨分页/节点/实例沿用，批量目标与界面不一致 | 部分存在 | [client/src/components/host/HostInstancesTab.vue](<C:/payincus/client/src/components/host/HostInstancesTab.vue>)：HostInventoryPanel列表有sequence/disposed且过滤selection；HostInstancesTab列表无seq，deletePreview有seq/selection而gift/pricing等缺，按具体操作分别修。 |
| R1-302 | P2 | 零配额显示无限或默认20/5，与实际执行不一致 | 部分存在 | [client/src/components/host/HostInstancesTab.vue](<C:/payincus/client/src/components/host/HostInstancesTab.vue>)：getQuotaLimit用??保留0，getQuotaUsage(0)返回null；其它前端默认及代理后端siteLimit0按无限仍不一致，不能说所有0均被默认20/5覆盖。 |
| R1-303 | P2 | 存储/兑换列表和迁移镜像响应覆盖新目标；操作重复提交 | 存在 | [client/src/components/host/MigrateHostModal.vue:160](<C:/payincus/client/src/components/host/MigrateHostModal.vue:160>)：Storage/Redeem列表虽watch hostId，却await后直接回写无seq；迁移镜像同样无目标代次，handleSubmit缺isSubmitting入口门禁，close的300ms清理能影响重开草稿。 |
| R1-304 | P1 | 价格/结算更改后旧预览在防抖期间可提交 | 存在 | [client/src/views/admin/BillingView.vue](<C:/payincus/client/src/views/admin/BillingView.vue>)：预览有requestId，但150ms防抖期间未立即清旧preview/id，变价后旧预览仍可提交。 |
| R1-305 | P1 | 切换用户弹窗串余额/登录数据，金额修改可重复提交 | 存在 | [client/src/views/admin/UsersView.vue](<C:/payincus/client/src/views/admin/UsersView.vue>)：余额/登录弹窗异步未绑定当前user；submitAdjustBalance缺函数busy guard，可串用户/重复提交。 |
| R1-306 | P2 | IPv6留空的合法新节点配置页仍无法保存 | 已有防护 | [client/src/components/host/MyHostConfigTab.vue](<C:/payincus/client/src/components/host/MyHostConfigTab.vue>)：requiresIpv6ParentInterface仅当前或旧subnet有值时要求接口，IPv6全部留空可保存；清空已有值仍见R1-111。 |
| R1-307 | P2 | 重复操作、邮箱验证码跨输入和初始加载可操作的边界 | 部分存在 | [client/src/components/profile/TwoFactorSection.vue](<C:/payincus/client/src/components/profile/TwoFactorSection.vue>)：2FA startSetup/enable等缺函数busy门禁；ChangeEmail已有busy与卸载清理但邮箱await未绑定目标，细项另见R313，不能笼统说所有保护都无。 |
| R1-308 | P2 | 运维审计与邀请码页硬编码中文 | 部分存在 | [client/src/views/admin/SystemConfigView.vue:1085](<C:/payincus/client/src/views/admin/SystemConfigView.vue:1085>)：邀请码定价标题、解释、资源标签硬编码中文；到期巡检历史已三语，不把整套运维审计都判无本地化。 |
| R1-309 | P1 | 密码验证重试使用变化后的草稿且旧成功回调可清理新会话 | 存在 | [client/src/components/profile/PasswordSection.vue](<C:/payincus/client/src/components/profile/PasswordSection.vue>)：catch用当时当前draft存pending，验证重试可用新草稿；旧成功timer清新会话。 |
| R1-310 | P2 | 保存设置组后全表刷新清除其它组和保存期间的新草稿 | 存在 | [client/src/views/admin/SystemConfigView.vue](<C:/payincus/client/src/views/admin/SystemConfigView.vue>)：保存一个设置组后loadAll重置全组，其他组及等待期间新草稿丢失。 |
| R1-311 | P2 | 帮助编辑迟到响应将A内容放入B编辑目标 | 存在 | [client/src/views/admin/HelpManageView.vue](<C:/payincus/client/src/views/admin/HelpManageView.vue>)：openEdit先改id后await回写内容，无seq，A响应可写进B编辑目标。 |
| R1-312 | P2 | 嵌入套餐ID切换不刷新，合法优先级0被默认值覆盖 | 部分存在 | [client/src/views/resources/PackageFormView.vue](<C:/payincus/client/src/views/resources/PackageFormView.vue>)：当前PackageSelector只展示props.packages，无对方嵌入packageId加载；priority 0用&#124;&#124;20确被默认覆盖。 |
| R1-313 | P2 | 验证码旧邮箱响应标记新邮箱已发送，离开后定时器继续 | 部分存在 | [client/src/components/profile/ChangeEmailModal.vue](<C:/payincus/client/src/components/profile/ChangeEmailModal.vue>)：已有close busy/watch/unmount清timer；sendNewEmailCode await后未绑定邮箱/session，旧邮箱结果仍可标记新邮箱。 |
| R1-314 | P2 | 抽奖单抽可与十连并发，离页后结果定时器再次弹窗 | 存在 | [client/src/views/EntertainmentView.vue](<C:/payincus/client/src/views/EntertainmentView.vue>)：multiDraw拒isSpinning，但spin不拒isMultiDrawing；结果setTimeout未随卸载清理，可与十连交错或离页后弹窗。 |
| R1-315 | P2 | Telegram页面和邀请码定价缺少三语 | 待运行验证 | [client/src/locales/zh-TW.ts](<C:/payincus/client/src/locales/zh-TW.ts>)：当前已新增大量Telegram三语，不能直接判整页缺；静态i18n守卫通过，逐控件实际显示仍待浏览器。 |
| R1-316 | P2 | Telegram渠道编辑/绑定搜索反序显示旧对象 | 存在 | [client/src/views/admin/TelegramConfigView.vue](<C:/payincus/client/src/views/admin/TelegramConfigView.vue>)：bindings搜索/editor读取缺请求和当前目标代次，反序结果可显示旧对象。 |
| R1-317 | P3 | 登录入口缺少提交中防重复 | 存在 | [client/src/views/LoginView.vue](<C:/payincus/client/src/views/LoginView.vue>)：Login/AdminLogin handleLogin缺函数入口loading guard；按钮disabled仅阻常规鼠标，不能防重复事件/函数调用。 |
| R1-318 | P2 | 重装完成自动开机却提示手动启动 | 已有防护 | [client/src/locales/zh-CN.ts:2215](<C:/payincus/client/src/locales/zh-CN.ts:2215>)：manualStartHint已描述重装后自动启动。 |
| R1-319 | P2 | 充值确认错误声明实例转移免费 | 存在 | [client/src/locales/zh-CN.ts:1040](<C:/payincus/client/src/locales/zh-CN.ts:1040>)：rechargeNotice仍写PUSH免费，而transferFee可非0；zh-CN/en均见原文。 |
| R1-320 | P2 | 密码修改提示与后端8位复杂度要求不一致 | 存在 | [client/src/components/profile/PasswordSection.vue](<C:/payincus/client/src/components/profile/PasswordSection.vue>)：前端提示/校验6位与后端8位加复杂度不一致。 |
| R1-321 | P2 | 流量重置提示错误要求手动恢复带宽 | 部分存在 | [server/src/routes/instances.ts](<C:/payincus/server/src/routes/instances.ts>)：reset后已有reconcileTrafficStateForInstanceIds；用户文案仍须逐处对照，不能删除正常恢复逻辑。 |
| R1-322 | P2 | 管理员创建提示错误宣称所有实例免费 | 已有防护 | [client/src/locales/zh-CN.ts:3429](<C:/payincus/client/src/locales/zh-CN.ts:3429>)：管理员创建description已免费或付费；freeGiftHint只在免费赠送分支，不是整页都说免费。 |
| R1-323 | P2 | 启动优先级与延迟提示方向相反 | 存在 | [client/src/locales/zh-CN.ts:6406](<C:/payincus/client/src/locales/zh-CN.ts:6406>)：bootPriority写越小越先，与Incus高priority优先相反；startupDelay写启动前等待，与启动后延时语义不同。 |
| R1-324 | P2 | 配额表单未读取实际接口字段且吞掉零/空值 | 存在 | [client/src/views/InstanceDetailView.vue:924](<C:/payincus/client/src/views/InstanceDetailView.vue:924>)：初始quotaForm读取camelCase portLimit/snapshotLimit，API返回snake_case；calculateRemainingQuota也camelCase加&#124;&#124;0，真实配额字段/零值被误读。 |
| R1-325 | P2 | 失败交付清理完成后状态未删除导致库存未释放 | 实现不同 | [server/src/lib/managed-instance-provision.ts](<C:/payincus/server/src/lib/managed-instance-provision.ts>)：managed失败保留error，与独占pool交付/退款/隔离库存不同；不能为了释放库存将远端未确认删除直接标deleted，先保留并核查实际残留。 |
| R1-326 | P2 | Telegram Webhook地址导致390px屏幕横向溢出 | 待运行验证 | [client/src/views/admin/TelegramConfigView.vue:760](<C:/payincus/client/src/views/admin/TelegramConfigView.vue:760>)：当前webhook span已有break-all，不能仅凭旧清单判390px必溢出；需真实构建长URL/三语浏览器验证，未做本轮UI修改。 |
| R1-327 | P2 | 集成测试在后续代理测试前清理共用证书 | 实现不同 | [server/scripts/test-admin-instance-delete-integration.ts](<C:/payincus/server/scripts/test-admin-instance-delete-integration.ts>)：本库管理员删除集成是TS脚本、测试finally在整套结束清理；未发现对方共享证书提前删除的同类脚本，不照搬旧修法。 |
