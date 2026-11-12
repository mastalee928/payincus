# 到期停删整份修复、五轮审视与两遍排查

记录：2026-11-12，北京时间；源码基线 `7dc5d22a265de422a474efb9b829c4ac1382557d`，43 个产品文件的最终哈希保存在 ignored `logs/expiry-fix-five-review-source.json`。本批尚未提交、推送、发行或部署。此文记录后续修复，前一份[彻查报告](expiry-stop-delete-audit-2026-11-12.md)保留当时未修源码及只读生产事实。

## 范围和实际状态

Owner 要求修好整份 E01–E21，不能缩成最后的 UUID 例外或只改两条停删判断。已完成下面的源码修改、五轮不同重点的代码审视，以及两遍完整九组数据库／协议／故障排查。普通用户、宿主所有者不能改续费价格、管理员只改当前实例、原价回池的回归也包含在两遍中。

当前有限 `expiresAt` 与数据库绑定决定到期目标。历史 UUID、创建时间、旧任务、手工暂停标签、缺套餐、快照／反代状态、终端、旧 lease 或其它实例续费异常不再作为到期停机的业务前置拒绝。实际下发 Incus `stop(force=true)` 后回读 `Stopped`；页面封停、HTTP 200、请求已经发送均不能代替完成。保存原自启策略并回读 `boot.autostart=false`；宽限期统一为有效到期时间加 72 小时。

宽限期后先处理远端停删，再清反代和平台分配；无法确认不会提前回池。一机一卖、当前客户独占且持有宿主行锁时清理所有项目中的实例／恢复副本，最终核实例列表为空，核系统卷／快照／转发；共享宿主仅处理当前目标，不能删其他客户。已支付账单与旧价格历史保留。

生产仍仅授权只读主控。本阶段没有连生产宿主、客户、触发线上巡检、代停删或改部署。19:47 的 JHTONE 只读诊断是历史证据，新代码尚未在线上生效，不能据本地结果说客户已经停止。

## 五轮代码审视

每轮均结合实际调用链、相关守卫和故障实验，发现问题后补修；不是把同一个测试跑五遍称为审查。

| 轮次 | 审视重点与发现 | 精修及证据 |
|---|---|---|
| 1 | 账期、旧登记和事务；发现保存原自启策略的 PostgreSQL 写失败会使事务 abort，仍可能阻止后续 stop | 统一有效期限、宽限期和 NULL rebuild；用 savepoint 恢复记账失败后的事务，仍先执行物理 stop。`expiry-fix-audit1-regression.exit=0`、对应 guards=0 |
| 2 | 所有实际开机入口与检查后竞争；恢复失败 rollback、旧 worker、PAT、终端与底层 start 均须复核账期 | 低层开机带当前实例行锁，恢复／换机新名字绑定原客户账期；原自启策略恢复受锁、只更新独立 JSON leaf，不反复覆盖用户设置。`expiry-fix-audit2-regression.exit=0`、types=0 |
| 3 | 五分钟调度、续费与失败隔离；长 repair、忙 billing lane、通知、单目标补续读取异常仍可能拖延资源动作 | 截止唤醒独立于整轮修复，按实例 ID 去重；启动立即补扫，账期提交后刷新，每分钟重查、失败十秒重查；单目标报错继续其他目标。`expiry-fix-audit3-regression.exit=0` |
| 4 | 宽限期删除、跨项目副本、回池和锁顺序；旧删除意图／创建 pending、某副本失败、反代异常可能卡住收尾 | 远端删除先于反代，全项目逐目标失败后继续；确认远端后收尾任务，清两个 pending 标记和密码，保存账单；实例→宿主统一行锁顺序。`expiry-fix-audit4-concurrency.exit=0` |
| 5 | 最终 diff、权限／账务／其他客户保护、守卫夹具和证据一致性 | 旧守卫适配新的 scoped start，不降低权限和数据断言；核 43 个产品文件冻结哈希、全量清单及最后失败项。`expiry-fix-audit5-guards.exit=0`、types=0；最终构建=0 |

审视后的两遍排查覆盖最终冻结产品代码。接续时重新计算全部 43 个文件哈希、18 份日志哈希均一致，没有用修改前的成功证明修改后源码。

## E01–E21 修复对照

| 编号 | 最终修改 | 实际验证范围 |
|---|---|---|
| E01 | 合法旧原地 rebuild SQL／JSON NULL、空对象兼容，不遮完整保存身份；强制到期 stop 不依赖解析器成功 | 真实 PG NULL、原 worker／调度器；普通变更或损坏替换回执仍拒绝自动开机 |
| E02 | 普通用户／admin 旧创建在首开机前持久真实 UUID、创建时间；缺时间时核已存相同 UUID 自动补齐 | 旧 UUID 自动补登和自动续费恢复；不同 UUID 不作为续费开机的原身份学习 |
| E03 | 有效 expiresAt 的无 plan、手工暂停和非正常标签仍停删 | no-plan／manual 等实际调度器，均回读 Stopped |
| E04 | 续费与删除按 expiresAt+72h；迟封停、无 suspendedAt 不延长 | 三种宽限期样例实际删除；已经过期五天且价格为零也不再补扣 |
| E05 | 独立截止调度、启动补扫、每分钟重查、故障十秒重查，账期提交刷新 | 实際启动和截止唤醒在下一次五分钟 tick 之前执行；长期修复不占用截止入口 |
| E06 | 本地未执行 start/restart 取消；到期精确 stop/delete 可越维护业务 fence，实际在途操作分类收尾 | PENDING、blocked snapshot、PROCESSING 与可取消远端操作故障注入 |
| E07 | 到期关闭当前终端会话，不让 exec 成为永久 stop 前置门禁 | 真实双 WebSocket 建立、到期关闭、回读 Stopped |
| E08 | 每目标续费读取失败继续；整轮续费错误不 return，中断等待后每目标重读已付期限 | 单读取异常／不自动续费的无关客户仍停机；成功提交续费不被误停 |
| E09 | admission、worker、reinstall check/complete、replace、restore、网络恢复以及底层 start/restart/unfreeze 统一当前账期检查 | PAT、旧队列、rollback 与重建／换机 worker 实跑；底层门禁和并发行锁 |
| E10 | 到期停止后核禁自启，原策略持久保存；正常付费后按原策略恢复 | PostgreSQL 写失败、丢回执、自启恢复受锁及避免再次覆盖。主控离线期间宿主持久截止协议尚未新增 |
| E11 | restore 持久新 UUID/createdAt，最终原子落当前登记；解析更晚成功恢复回执 | 16 组实际恢复 worker／PG/TLS 故障场景；最终 DB 写失败不假称完成 |
| E12 | 到期 stop/delete 不受旧 30 分钟 lease／busy lane skip；具体 pending 和真实 stop/absence 回执分开 | lease、五 busy lane 第六客户、锁超时重试、HTTP no-op、丢 stop/delete |
| E13 | 先远端 stop/delete，再清反代；失败 pending 仍保库存，但不以此替代停机 | 反代失败情况下物理资源仍停删；清理恢复后幂等收尾 |
| E14 | RFC3339 时间精确纳秒／时区／尾零规范化，不粗截毫秒 | 等价尾零／时区接受，非法日期及真实纳秒差拒绝 |
| E15 | 按有效身份选择保存段，空 recoveryIdentity 不遮完整 managedCleanup | 空段／缺时间与旧任务变体；强制 stop 不因历史身份差拒绝 |
| E16 | 终端票据、初建、重连均核当前账期；到期主动关闭存活连接 | 实际票据／双连接／关闭；完整公网客户 SSH 本轮未验证 |
| E17 | deletePlan 内锁方案并重查实例，阻检查与创建提交间竞争导致 SetNull | 实际检查后合法创建提交，再执行删除事务被拒；到期选择另不依赖 plan |
| E18 | recovery、expiry、instance deletion、pool cleanup 统一实例→宿主锁顺序 | 两个实际服务并发屏障，真实 PG 不再 40P01；行锁超时后重试成功 |
| E19 | 已付续费的缺身份自动核补，暂时故障超过六次继续重试，只确认运行后完成 | 六次暂时失败后 Running；已接受开机丢回执不重复启动或扣款。后来的手动停机／转移／停用继续使旧意图失效 |
| E20 | 中断 recreate 清理不因 suspended 拒绝，去永久六次上限；过期副本不能再启动 | rebuild/recreate/clone/change_host 两架构业务 fixture 约 80 组；一机一卖全项目残留清理 |
| E21 | Starting／Unknown 仍下 force stop；404 独立确认 absent；GET 失败仍尝试实际动作 | 实际调度器：Starting、Unknown、Frozen、VM 类型及丢响应。VM 状态响应为 fixture，非原生 KVM |

## 两遍彻底排查

每遍使用九个独立空数据库、真实 Prisma migration、当前业务函数／HTTP／worker，以及受信 HTTPS/WebSocket fixture。十八组均自然退出 0，结果及日志哈希在 ignored `logs/expiry-fix-thorough-1-index.json` 与 `-2-index.json`；总 exit 均为 0。

| 每遍组别 | 入口／故障范围 |
|---|---|
| execution | PAT、旧 start worker、restore rollback、终端；NULL／缺 plan／手工暂停／错误 UUID／创建时间／空段／快照任务；lease／lane；Starting/Unknown；GET 失败、no-op、丢 stop/delete、操作取消；真实 PG trigger 写失败；单续费读取异常；启动补扫和精确截止 |
| concurrency | 已提交续费避免旧 stop、真实行锁超时后重试、recovery 不死锁、一机一卖全项目副本核空 |
| billing | 实际账务调度、掉线重连、已付不误停、一次扣款、宽限期、重启幂等、恢复保护、通知、删除 pending／确认后释放 |
| resume | 原账单/paidUntil、手动停机/转移优先、丢 start 回执、不重复扣款、暂时失败超过六次仍可恢复 |
| credit | 充值唤醒补续、扫描中追加、宽限期等待余额时整体回滚、旧 selection 不扣新所有者 |
| restore | 16 组实际 worker 故障；原 pool／UUID／设备、操作先落库再等待、权限撤销、受损 manifest、远端失败及最终 DB 失败 |
| reinstall | 约 80 组 x86_64/aarch64 的 rebuild/recreate/clone/change_host，原身份、账期、新身份与清理回执保护 |
| price | 普通用户、宿主所有者、伪造角色／旧接口拒绝；仅当前有效管理员、并发旧窗口、合法金额、账务与审计事务 |
| resale | 旧实例改价→确认清理空池→同宿主再次预订/账单：新实例原定价 10、override=null，旧 override=1.23 保留；创建客机响应仍为 fixture，不冒充完整原生售卖交付 |

两遍中的 Incus／Caddy 客机状态和磁盘大部分为 fixture；真实 PostgreSQL、权限事务、TLS 和 WebSocket 不是原生客机磁盘或客户公网连接证据。未修改 client，本轮价格 UI/双端边界沿用原发行证据，全量前端守卫与类型仍覆盖；不宣称本轮新增桌面／手机视觉验收。

## 最终验证与尚缺实证

- 全量清单实际执行 218 条：216 通过，Agent 安装本机 60 秒超时和旧 backup scoped-start 字符串守卫两条失败。后者只修守卫并定向通过，installer 原脚本／原 60 秒时限再次完成十场景并通过，耗时 57 秒。**218 条均有最终通过证据，但没有声称存在一次完整全绿 run。** 原失败日志和 exit=1 保留。
- 最终 server type-check、构建、五个关键守卫、lint 自然 exit=0。lint 为零 error、369 条既有前端 warning。新增两个 PG/TLS 集成脚本已登记 server scripts 与 `EXCLUDED_FROM_SUITE` 原因；清单校验通过，未静默漏跑。
- 最终依据：`expiry-fix-full-suite-final.log`、`expiry-fix-final-two-guards.log`、`expiry-fix-installer-final.log`、`expiry-fix-audit5-types.log`、`expiry-fix-final-build-server.log`，汇总 `expiry-fix-final-evidence-summary.json`。这些均本地 ignored，凭据与私有原始证据不提交。
- 本地一次性 Alpine 3.24／kernel 6.18.58／Incus 7.0.1 原生容器实证已通过：最终 `expiry-native-ssh-final3.exit=0`、`expiry-native-final-result.json`。当前产品调度器与真实 PostgreSQL／受信 Incus TLS 执行，故意保存错误历史身份仍将运行容器实际停为 Stopped；原 SSH 会话结束、新 SSH 登录拒绝，自启 false、原 true 策略持久保存，付费后原策略回读恢复；宽限期外真实 DELETE 后所有项目列表为空，系统卷／快照与实际 dedicated forward 消失，平台两个 pending 清零、资源计数归零。客户 SSH 是本地 QEMU 转发→隔离宿主 socat→实际 Incus dedicated forward→客机 SSH，不是客户公网互联网验证。宿主元数据／账期为专用库测试数据，客机／磁盘／快照／转发／SSH 均为真实操作。
- 原生环境运行在 Windows ARM64 本机 QEMU 的 TCG x86_64 Linux 中。前一 w32 双重模拟环境 Incus 内部 cowsql 超时、未就绪，原失败保留；改用 ARM64 本机 QEMU 并在隔离 Linux 正常挂载 cgroup2 后通过。SSH测试首轮错误把管理IP作为客户转发IP，导致管理TLS被转进客机；只修测试网络为独立 192.0.2.99 与 loopback relay，产品代码未改。后续脚本未监听预期开机失败时的二次 SSH error 已补测试资源收尾，不以部分日志称成功。最终源码43文件哈希仍一致。真实 KVM、完整宿主断电重启和主控离线验收未做。
- 最终另经宿主 CLI 独立核 `incus list --all-projects --format=json`、`incus storage volume list expiry-test --all-projects --format=json`、`incus network forward list incusbr0 --format=json` 均 `[]`，不只依赖主控状态或测试脚本断言。临时数据库仅清本次专用用户／宿主／实例；已核一次性 QEMU PID／启动命令后停止，私有材料留在仓库外。
- 不可达宿主不能凭空执行／确认 Stopped。本批自动恢复既有受信管理通道并重试，不能信任未知新 TLS/SSH 身份；灾备账务核对保护继续保留，旧 OSS 未核账期不得误停已付客户。尚未实现主控完全离线时由宿主持久执行客户截止的 Agent 协议，不能承诺所有离线情况实时停机。

## 接续操作规则

读取 OWNER_REQUIREMENTS、此文与操作／版本台账后，先核当前改动、自然 exit 和冻结哈希。本地容器完整停删／SSH实证已完成；若后续发现产品问题，必要最小修复后更新哈希并重跑受影响审视／两遍证据。生产目前只读，不直接修主控或操作客户；发行、公开资产、OTA 与 JHTONE 实际 Stopped／删除仍须另列证据，不沿用本地通过。原生 KVM／完整宿主重启和离线协议不能沿用容器本地结果。
