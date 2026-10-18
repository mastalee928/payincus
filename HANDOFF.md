# 版本与验证记录

维护仓库：[mastalee928/payincus](https://github.com/mastalee928/payincus)。GitHub Fork 关系已于 2026-10-16 解除；仓库地址和提交历史保留。原 BSD 3-Clause 许可证与版权声明继续保留在 LICENSE。

## 当前源码与发布状态

- 面板 [v1.6.6](https://github.com/mastalee928/payincus/releases/tag/v1.6.6) 已正式发布，发行源码 `9f1a14a799a9600a4aa6a3c84f9cffa7d68ad087`（注解标签 `v1.6.6`，对象 `55bdb1dcfba1197b42a050ad8bf130afccaf6410`）；GitHub 面板 latest 为 v1.6.6，测试主控已通过面板 OTA 升级至 v1.6.6；其后的仪表盘负载条修复为未发版源码提交，随下一次发布进入安装包。下方 v1.6.5 及其“已通过面板 OTA 升级至 v1.6.5”为当时状态。
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
