# PayIncus 暂停交接（2026-10-28，北京时间）

> **当前施工更新**：上传队列授权/固定目标与存储修改删除竞争阶段已实现，真实PG/Fastify/mTLS及相关守卫通过；证据见HANDOFF最顶部。下一段每attempt文件与持久恢复、30秒退避、null startedAt僵尸、远端在途身份与备份delete/restore门禁；下方“尚未编辑”是历史。用户阶段commit/push授权继续生效。

> **最新接续点**：全部旧积压及后续修复已分批push main，最新业务提交`7a38eca`，对应CI 40644502640为7/7 success；记录前工作区干净，无未推送commit。下一批备份队列当前授权/身份与持久恢复尚未编辑，定位和验证证据见HANDOFF最顶部。三台测试机不限用途授权与私有资料保留，不重复索要凭据。

> **后续阶段**：`437ff02`、`8465e9d`已推送且各自CI 7/7通过。备份上传同秒文件冲突已修；正在保存备份导出TLS身份/背压/取消与截止，专项和后端构建已过，最新以HANDOFF顶部为准。旧暂停正文仅历史，继续源码及已授权三台测试机核验。

> **阶段保存更新**：Owner已授权把旧聊天和当前聊天全部积压提交推送，再继续修；248文件已在`c277ba3`推送并核对远端，旧文中的禁止提交与暂停描述仅属历史。GitHub常规Agent Linux测试通过；主CI因漏声明jsdom失败，声明已补且frozen/Markdown专项通过，接续结果见HANDOFF顶部。三台测试机用途不受旧分工限制，域名系统解析均正确，旧SSH身份仍在查证。不把保存源码当作发行验收。

> **接手更新（2026-10-28）**：本聊天持续施工，原暂停已结束。最新自动快照持久恢复、25场景、实际后端浏览器、188/188、224新鲜迁移及删除/转移回归见 `HANDOFF.md` 顶部。运行PG仍为55438 `takeover_20261028_pool_test`，新鲜迁移库为 `takeover_auto_final_20261028_pool_test`，站点页真实后端202/409/502与重试/删除浏览器也通过，UI夹具已关闭。下文仅是历史暂停快照，不据其旧失败状态重做已完成工作。手工资源持久恢复、其它生命周期、327项和真机/网关完整目标继续。未提交或发行。

本文件是源码施工交接，不是完成、发行或生产验收声明。新模型按 `OWNER_REQUIREMENTS.md` → `AGENTS.md` → `OPERATIONS_HANDOFF.md` → `HANDOFF.md` → 本文件读取。逐项基线在 `REVIEW_CHECKLIST_AUDIT.md`，修复状态在 `REVIEW_CHECKLIST_FIXES.md`，网关目标仍看 `GATEWAY_PROGRESS.md`。用户要求暂停并交给其他模型；所有代理已停止编辑和测试。

## 当前 Git / 环境

- 工作区 `C:/payincus`，`main` HEAD `0e8010371c8eb7a0eeaef9b9a1d0df6caf312092`，正式发行仍是 v1.7.7。大量已修改/未跟踪源码和测试均保留；不要 `reset`、`checkout`、清理未跟踪文件或覆盖同名文件。当前施工**没有** commit、push、tag、Release、生产 OTA/DNS、客户实例或账目操作。
- 用户自行销毁实例“仅删除、不退款、不写余额/退款账单”是最高业务约束；管理员可选退款和创建失败自动退款保持。复验 `logs/review-user-no-refund-after-finance.log` 通过（真实本机PG/Fastify/mTLS，Incus进程是替身）；未触碰历史错账。
- 127.0.0.1:55438 隔离PostgreSQL已正常停止，数据和日志保留在 `logs/review-no-refund-pgdata/`、`logs/review-no-refund-pg.log`。恢复使用已有 `@embedded-postgres/windows-x64/native/bin/pg_ctl.exe`，只启动这个明确目录和端口。本地站点UI夹具端口19641也已停止。凭据只在仓库外 `C:/Users/adminuser/.codex/private/payincus/`；不得输出、提交或上传。测试机旧SSH身份不匹配，不可绕过pin声称真机验收。

## 已有分项证据

- 外部327项初审与按编号修复台账已建立，仍有大量“待精修/部分精修”；不能以本批完成替代全清单。已做的2FA、邮箱、账号、命令、OAuth、财务、续费、SSH、Agent凭据等专项证据在 `HANDOFF.md` 与台账。本轮额外站内信、管理员余额、AFF、用户列表、批量端口、批量配置、Caddy早期修补和IPv4同步专项均有 `logs/review-*-final.log` 或相应专项日志；日志各自注明真PG、Fastify、TLS/Incus替身的证据边界。
- `pnpm test` 在**后续持久Caddy/转移/自动快照施工之前**跑完188项：186过、2项守卫检查旧源码位置而失败，见 `logs/test-run-20261027-232403`；这2项守卫已按新的真正执行位置保留安全断言并在 `logs/test-run-20261027-233304` 5/5复验。**从未有当前最终代码状态的188/188全绿**。
- 独立空库在Caddy/transfer新增迁移前实际应用220项成功：`logs/review-current-stage-migration-deploy.log`。后续又新增 `20261027020000_proxy_site_operations`、`20261027030000_transfer_cleanup_state`，因此最终完整空库迁移需要重验。原运行夹具库无Prisma迁移历史，单独SQL应用新增列；不要伪造baseline。
- 早期双前端构建和dist边界 `logs/review-current-stage-client-build.log` 通过；**之后**用户站点UI又改了，须重新双端build。Lint当时0 errors/664既有warnings，见 `logs/review-current-stage-lint.log`；不能当作最终源码Lint。
- 站点UI本地隔离浏览器真实点击202待处理、明确toggle、同操作重试、原生删除确认、确认后移除、迟到响应、三宽度/三语/深浅色通过 `logs/review-proxy-ui-browser-final.log`；截图在 `logs/proxy-sites-ui-fixture/`，纯夹具不等于真实后端验收。设计检查 `logs/review-proxy-ui-inspection-verified.log` 0 FAIL/1 WARN，WARN为仅一行测试站点的独立夹具页面余白。UI源码在 `client/src/components/instance/InstanceSitesTab.vue`、两端API与三语。最终真实后端合同、202/409/502和刷新恢复仍待浏览器验收。
- Go Agent upgrade R081/082/083：Windows/arm64 upgrade包测试和Linux amd64/arm64 vet/测试**编译**/Agent构建通过 `logs/review-agent-upgrade-*-final.log`；report R085/086/087仅Linux两架构交叉编译/vet通过 `logs/review-agent-report-cross-final.log`。Linux flock强杀、systemd及report实跑**未做**，Agent版本仍1.0.3，无Agent发行。两份用户遗留 `agent/internal/controllerconfig/*_linux_test.go` 不属于本批，不要丢弃。

## 施工中，禁止直接提交或发版

1. **Caddy持久操作未闭合。** `docs/proxy-site-operation-recovery.md` 是目标规格。`server/src/db/proxy-site-operations.ts`、`proxy-site-operation-guards.ts`、worker、v3 `caddy-client.ts`、六站点路由、schema/迁移和IPv4同步初稿已写；`logs/review-proxy-site-operations.log` 真PG/Fastify/TLS API替身专项通过，但未做最终守卫、真实Caddy v3、重启/失联和双端完整验收。IPv4变化遇旧未决upsert目标IP失配会blocked，尚缺带代次的supersede恢复；旧attempt不可复活。tombstone已调整为零流量matcher，**真实Caddy尚未核验**。`test:review-proxy-site-operations` 尚未在 `server/package.json`/`scripts/run-tests.mjs` 登记，需确认脚本命令/归类。
2. **转移/生命周期未闭合。** `server/src/services/transfer-cleanup.ts`、`InstanceTransfer.cleanupState`、30000迁移、accept/push初接和多处未决站点门禁已写。固定原站点/端口/快照/备份清单、processing直到清理完成、专属实例全端口/IPv4/IPv6/磁盘/库存不动是必须守护的不变量。旧 `test-admin-instance-push-integration` 还未在调整夹具后重跑，新服务没有完整真PG/Incus/Caddy失败注入。旧宿主批量迁移持久claim、生命周期v3 Caddy删除、到期路径、快照自动策略互斥、重试/精确远端确认、共享端口双协议及host计数均要闭合；不能把原先“提交后重新全扫并删除”带回来。上述流程当前**不可上线**。
3. **自动快照调度器中途编辑。** `server/src/services/auto-policy-scheduler.ts` 的 `executeAutoSnapshot` 改为共享实例锁事务，但调用方 `executeLockedAutoSnapshot` 仍传旧参数，旧常量/导入残留，**可能编译失败**；尚无类型、守卫或运行验证。下一模型先修此文件的调用/锁顺序，或在不丢其它工作区修改的前提下恢复其可运行状态。不能使用破坏性Git命令。
4. **巡检成功观察CAS刚改，未验。** `server/src/services/status-scheduler.ts` 已加入成功结果的instance锁、身份和updatedAt代次检查，防旧响应覆盖新状态；改动发生在前述188项全量之后，尚无对应真PG/mTLS成功观察竞态测试。失败观察“不因此删除/释放资源”已通过 `logs/review-sync-observation-protection-integration.log`。保持一机一卖库存占用。
5. 用户站点UI与后端outbox在接线时分别施工，须核对 `client/src/types/proxy-sites.ts` 和两端API、组件与最新后端字段/错误展开。站点页面不应在202时提示生效或在远端未确认时移除；重试保留requestId，toggle有明确enabled/expectedRevision。前端代码最后定向typecheck/浏览器夹具通过，最终真实后端集成和最终双端build未做。

## 恢复顺序

1. 只读核对上述文件及各代理最后留言，`git status --short`，保留所有用户/其他代理修改。先使中途`auto-policy-scheduler.ts`和最新schema/Prisma Client编译通过；登记未分类活体专项，跑`pnpm test:check`。
2. Caddy outbox的IP supersede、零流量tombstone真实Caddy、重启stale applying、412/迟到代次、身份变更及远端成功DB失败回执；联动transfer/lifecycle固定清理，完成真实PG/Fastify/TLS/Incus边界测试。任何未决意图不得被转移/重建/删除悄然抹去。
3. 真Linux Debian13/14上Go Agent锁/解压/取消、网关IPv4-only与宿主/客机IPv6独立、独立/备用网关及A完全失联→B全新OSS恢复仍须按OWNER_REQUIREMENTS和GATEWAY_PROGRESS分别验收；当前三机SSH身份尚未核实，不绕过。
4. 继续外部327项确实存在的必修/应修，不要仅因这批专项目录多就宣称整体完成。稳定后重新空库全部迁移、188项全量、相关活体专项、双端/后端build、Lint、人工diff和浏览器验收。同提交双架构预览、正式包核验及条件达标后的commit/push/Release才可进入；不包含生产OTA、DNS、客户删除/退款或DD。

仓库 `logs/` 为本地忽略证据，交接文件不包含密码、token或密钥。阶段性测试只说明对应边界，不将源码、替身、发行包和生产实证混写。
