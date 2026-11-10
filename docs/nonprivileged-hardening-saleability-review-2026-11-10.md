# 非特权加固与销售恢复复审（2026-11-10，hardening42）

本轮按 owner 最新要求，聚焦“容器非特权加固导致不可售”的完整恢复链路，同时检查当前 AMD64 和未来 ARM64。确认并修复三个会造成卡售、再次下架或显示库存与实际分配不一致的问题。六项相关专项、后端类型检查、后端构建及测试清单检查通过；此结论限于本机源码与隔离测试。

分支为 `codex/automatic-hardening-grub`，HEAD 为 `2620f05ba44a7ffd23bb9a3fe84a73aecb7109c4`。当前包含前阶段累计未提交修改，不能用 HEAD 单独代表已验证源码，也不能把整个工作区 diff 都归为本轮。精确文件摘要及前轮关联见本地 `logs/hardening42-evidence-index.json`；hardening40、hardening41 的历史证据保持。

## 1. 回退后重新验收通过，应自然恢复可售

此前维护门禁接受合法的 `aborted` 作为维护结束，但库存 SQL 仅接受 `verified`。若准备安全回退后，环境已满足防护要求，正常加固队列即使重新写入当前版本的完整成功回执，库存仍为零。

已在 `host-resource-usage.ts` 将合法、未下发重启的回退记录纳入结束状态。回退本身不授予可售资格：外层仍要求当前加固 revision、`verified`、`finished` 和未过期的下次检查时间；库存与实际分配还核完整维护记录及当前管理身份。原回退历史保留，没有清除维护 JSON 或直接把数据库标绿。

真实本机 PostgreSQL 先复现“队列成功、就绪计数仍为0”，修后 AMD64、ARM64 均通过。失败日志：`logs/hardening42-stock-before.log`。

## 2. 旧准备次数耗尽，不得覆盖新的成功结果

此前 `prepareAutomaticHostMaintenance` 在判断当前防护已通过之前，先处理旧回退记录的准备次数耗尽；正常队列刚取得的新成功状态，会被旧预算改回 `needs-maintenance` 并延后检查。

现先判断已有非终态维护，再沿用原逻辑判断是否已经完整成功或 AppArmor 已通过，随后才处理历史准备预算和冷却。没有清空次数、追加预算或扩大远端写入权限。当前仍不健康且预算耗尽的宿主，继续保留明确原因并拒绝新增远端动作。

真实 PostgreSQL 先复现成功状态被覆盖，修后验证状态与可售资格保持、零额外连接或命令；原耗尽失败专项仍通过。失败日志：`logs/hardening42-exhausted-before.log`。

## 3. 库存与实际分配器使用相同的身份和维护检查

实际带行锁的分配器已有 `hardeningReceiptMatches`，但管理库存和公开商品目录的库存统计此前只使用 SQL 就绪条件。畸形回退记录或管理身份改变后的旧回执可显示有货，实际分配时又被拒绝。

`host-pool-prices.ts` 与 `host-inventory.ts` 现也调用相同检查。新增 `hardeningStockSelect` 仅选取服务器内部核验需要的字段，不改变接口响应结构，不返回证书、指纹或节点密钥；专项检查响应中不存在夹具证书和指纹。实际分配器保留取锁后重新读取与复核，未放宽下单门禁。

真实 PostgreSQL 和库存路由先复现虚假库存，修后四处结果一致：池库存、公开目录、管理员库存、带行锁分配器。失败日志：`logs/hardening42-stock-receipt-before.log`。库存展示仍是查询时快照，随后发生占用或状态变化时，最终分配器会按锁内最新事实裁定。

## AMD64 与 ARM64 范围

| 检查 | AMD64 | ARM64 |
| --- | --- | --- |
| 目标架构识别 | `x86_64`，取目标实际报告 | `aarch64`，取目标实际报告 |
| 目标探测脚本和报告解析 | 4 KiB 页测试通过 | 4 / 16 / 64 KiB 页测试通过；8 KiB 报告拒绝更新 |
| 销售恢复专项 | E2，200% CPU / 768 MiB，4 KiB | ARM2C，200% CPU / 8192 MiB，64 KiB |
| 已有完整防护 | 重新验收后，空闲宿主恢复可售 | 同一完整链路通过，不因主控是 AMD64 而拒绝 |
| 新接入 | 原接入 lease 完成且完整防护通过后可售 | 同一接入门禁通过，完成后清理临时凭据 |
| 自动改引导并重启 | 仍仅放行已有原生证据的 Alpine / GRUB 方案 | 原生未验收，不放行；返回 `HARDENING_NATIVE_ACCEPTANCE_REQUIRED`，零连接/命令 |

目标探测使用目标的 `os.uname().machine` 与 `SC_PAGE_SIZE`，不继承主控架构。资源池保留 E2 / ARM 规格与目标架构匹配，实际分配器取锁后再次核验。上述 ARM 测试是本机不同目标报告和协议的隔离测试，不是 ARM 原生内核、真实重启或客户恢复验收。

## 本地验证

以下检查均自然 exit 0，日志和最终源码摘要列入本轮证据索引：

| 检查 | 日志 |
| --- | --- |
| 新增销售恢复专项 `test:hardening-saleability` | `logs/hardening42-hardening-saleability.log` |
| 主控维护专项 `test:host-security-maintenance` | `logs/hardening42-host-security-maintenance.log` |
| 持久加固队列 `test:security-hardening-queue` | `logs/hardening42-security-hardening-queue.log` |
| 安全加固守卫，含 Python 目标探测及维护执行器测试 | `logs/hardening42-security-hardening-guards.log` |
| 机器池守卫 `test:host-pool-guards` | `logs/hardening42-host-pool-guards.log` |
| 真实锁等待后的库存/架构复核 `test:review-pool-stock` | `logs/hardening42-review-pool-stock.log` |
| 后端类型检查 | `logs/hardening42-server-types.log` |
| 后端构建 | `logs/hardening42-server-build.log` |
| 测试清单完整性 | `logs/hardening42-test-manifest.log` |
| diff 空白检查 | `logs/hardening42-diff-check.log` |

新增专项使用独立 loopback PostgreSQL、真实加固队列、库存和公开目录函数、管理员库存处理器，以及真实带行锁的分配器。远端 SSH / 内核 / Incus 返回值使用明确的测试替身；管理员鉴权使用测试装饰器，本专项不替代真实鉴权测试。通过改变测试目标的防护报告，再调用实际队列取得成功回执，不直接写成功状态来证明恢复。

专项还覆盖缺 AppArmor、成功回执过期、畸形维护记录、不一致的 `rebootIssued`、管理身份变化、有客户占用、准备/等启动/恢复/阻断期间不可售，以及新接入尚未结束时不可售。原架构、资源、地址、管理身份和占用保护保持。维护与加固队列原有并发、丢回执、权限撤销、停删意图及客户保护回归继续通过。

新增入口已登记到 `server/package.json`，并以“需要本机隔离 PostgreSQL”为由登记到 `scripts/run-tests.mjs` 的集成测试清单。没有重复全部守卫或前端构建，本轮未新增前端修改。

测试开发中曾发生两架构夹具使用同一公网地址触发真实唯一约束的问题，现使用不冲突的隔离地址，最终专项通过。原日志保留为 `logs/hardening42-fixture-address-error.log`，不当作产品故障，也不作为通过证据。

## 交付与未验收范围

本轮未连接主控，未部署、OTA、重启真实宿主或操作客户，也未提交、推送、打 tag 或发行。稳定 v1.8.5 安装包不包含本轮新增修复。此前28台 AMD64 / 26台空闲可售 / 两客户恢复是此前生产阶段证据，不能证明本轮代码已上线。

原生放行列表仍仅为 `alpine-apparmor-grub-v1:x86_64`。ARM64 自动启动维护、其他引导方案、VM / Frozen / 独立救援，以及本轮新增代码的真实 Alpine / Incus 验收仍未完成。真实 OSS 全新 B 灾备、独立备用与千台72小时验收仍分别保留。
