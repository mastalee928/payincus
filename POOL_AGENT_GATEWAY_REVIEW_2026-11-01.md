# 机器池、Agent、网关两轮审查（2026-11-01）

审查基线：`893df4b9dec91caa50423eabeb9af01b2a8b69d1`。本轮是代码审视和定向复现，未修改业务实现、未操作生产、未发布。既有首页/警告CI由另一对话负责，Node24监控保持独立。

第一轮沿机器池下单/资源预占/创建失败补偿/解除隔离、Go Agent心跳/升级/控制器发现、后端上报、网关候选/安装/任务台账/域名传播调用链检查，并对照P01–P09及已有守卫。第二轮独立交叉核对身份与锁、异步任务交错、取消边界和现有测试合同；五项发现都有代码或受控函数复现支持。这里的两轮不表示全仓所有分支、真实PG并发或云宿主流程完整验收。

## 确认发现

### RAG-01 / P1：更换域名只改面板，已绑定宿主拒绝迁移

- 页面入口：`client/src/components/host/ManagementGatewayPanel.vue:110–122`，本机网关就绪后可修改域名并保存。外部当前网关没有等价的域名编辑入口；下方`GatewayEndpointPanel`固定`manage-domain=false`。
- `server/src/routes/onboarding-gateway-endpoint.ts:79–86`只核新旧域名解析到同一IPv4，然后立即保存新配置和排队。实际下发经过`host-gateway-dns.ts`、`onboarding-ssh.ts`、`onboarding-gateway.py`、安装脚本，进入`refresh-host-gateway-endpoint.py:160–165`。
- 宿主已登记绑定时要求`saved == desired`，包含hostname。因此原身份、端口、管理网段全部不变也拒绝新域名；`scripts/test-host-gateway-dns.py:143`明确测试这种拒绝，没有另一个显式域名迁移合同。
- 影响：面板保存成功但原宿主仍解析旧域名。旧域名失效时，原宿主管理通道无法依靠新域名重连；不能向owner承诺保存即换绑完成。
- 复现：`logs/review-gateway-domain-enroll.py`执行真实enroll，只有受保护文件I/O替换为夹具，同域名幂等成功、新域名在写入前拒绝，自然exit0。未实测Linux文件权限或WireGuard。
- 修复边界：显式旧绑定到新绑定的迁移，核当前代次与原身份，旧请求不得覆盖新配置；逐宿主确认并保留失败/重试。不能简单删除`saved == desired`来解除保护。

### RAG-02 / P1：解除隔离超时后，清理仍可发出DELETE

- `server/src/services/host-pool-recovery.ts:51–58`仅用Promise.race限制等待时间，未取消内部操作；`:236`用它包装`removeDedicatedForward`。
- `server/src/lib/incus/dedicated-network.ts:62–76`在读取转发列表后逐个DELETE，没有接收外层取消信号。真实Incus客户端默认单请求120秒，与外层8秒不是同一个截止时间。
- 复现：实际bounded函数源码与真实removeDedicatedForward，GET延迟至外层8秒拒绝后释放，仍发出DELETE。第二轮独立重跑日志`logs/review-pool-round2-late-cleanup.log`，8001ms出现outer-rejected后再出现DELETE，自然exit0。
- 影响：界面已显示失败、恢复事务退出后，清理工作仍可能继续，失去原事务保护。60秒事务预算也未贯穿循环，但累计超60秒情形只做代码核查，未另造长测试。
- 修复边界：总截止时间和AbortSignal贯穿查询、等待及每次远端写，超时后不启动后续删除；保持未确认清理时库存隔离。

### RAG-03 / P2：解除隔离事务再次申请全局数据库连接

- `server/src/services/host-pool-recovery.ts:213–217`已持有事务连接，内部`:129`却调用`connect(host)`，未传事务db；默认`getIncusClient`在`incus-pool.ts:95`先通过全局Prisma读连接配置，即使命中缓存也如此。
- 单连接或连接池被恢复事务占满时，额外查询等不到连接，最终被当成宿主unreachable。现有恢复集成测试注入假connect，未覆盖真实连接器路径。
- `host-pool-recovery.ts:227`的审计写入同样使用全局连接，且`createLog`吞异常；只修连接器仍可能缺少预期的清理前持久审计。
- 复现：`logs/review-pool-round1-connection-probe.mts`调用真实恢复服务/连接器/createLog，以受控单连接边界触发额外申请。第二轮`logs/review-pool-round2-connection.log`再次确认缓存连接仍误报unreachable；仅注入事务复用的对照暴露审计异常被吞，自然exit0。不是实际PG池饥饿实测。
- 修复边界：读取复用当前事务，清理前审计需明确持久化与失败合同；不能用扩大池或延长等待代替修复。

### RAG-04 / P2：迟到Agent报告未复核实例宿主及归属

- `server/src/services/agent-instance-report.ts:405–418`先取得实例快照，`:232–236`在流量写事务中只复核status，未核hostId/incusId/userId，`:275`仍更新旧userId配额。
- 真实身份变化入口为`server/src/db/transfers.ts:687`与`server/src/services/host-replacement.ts:172`。Agent凭据锁不会撤销之前读到的实例快照，流量锁也不等于转移/换机的实例操作锁。
- 复现：`logs/review-agent-identity-probe.mts`调用真实报告服务、内存数据库边界模拟读取后转移/换机。第二轮`logs/review-agent-identity-round2.log`确认旧用户101仍被计流量；换机后状态写被host条件拦下而trafficUpdated仍为1，自然exit0。换机删除旧流量快照时也可能先污染新快照基线，不保证每次都直接形成同样增量。
- 修复边界：在同一事务中协调实例锁并复核hostId/incusId/userId，身份变化拒绝旧样本，再更新快照和配额；核锁顺序避免引入新死锁。

### RAG-05 / P2：域名更新与旧安装并发时漏排队

- `server/src/services/host-gateway-dns.ts:80`排除正在运行的宿主；`:62`旧安装结束未复核当前端点即记成功，`:103`调度器只选queued。
- 复现：旧域名安装停在部署边界→保存新端点→queue返回0→旧安装结束→installed=false但state=succeeded→三次调度均不补装。真实服务与队列函数、内存DB/SSH夹具，`logs/review-gateway-domain-race.cjs`及第二轮`logs/review-gateway-domain-race-round2.log`自然exit0。
- 影响：保存新域名后部分宿主不会自动更新，手动重试才有机会继续。与RAG-01独立：即便补上宿主迁移，本项仍会漏调度。
- 修复边界：持久化期望配置版本，旧安装完成发现落后时重新入队，不能把旧回执当当前配置成功。

## 验证与排除

- 本轮通过：机器池守卫、网关任务守卫（含预检/组件/安装守卫）、端点路由守卫、Agent认证和报告状态守卫。它们通过不代表覆盖上述并发场景。
- 端点守卫首轮因未设置DATABASE_URL在加载阶段退出1；随后使用不可连接的本地占位URL运行其无DB访问夹具，自然exit0，日志分别保留`review-gateway-endpoint-guard.log`与`review-gateway-endpoint-guard-configured.log`。
- Go main/panel/upgrade/controllerconfig进行了两轮代码及测试合同核查，未确认额外缺陷。Scoop路径指向Go 1.26.5但bin缺go.exe，其他标准位置也未找到可用工具链，所以未运行Go测试、未安装工具链。
- 升级自重启中断后不立即回滚是已有测试合同；HTTP允许本机/私网配置，不据此推断生产暴露。控制器发现单独要求HTTPS、禁止重定向并校验签名与序号。
- 候选退役后的machineId冲突未列为新问题：实际按钮明确“已重装此候选，重新检查”，普通重试复用原gatewayId，不能以未DD就退役的假设认定正常重试必坏。
- 已登记的完整HA、独立/备用接管、公网DNS切换、真实OSS整机恢复和长时验收缺口继续保留，本轮未重新证明或宣称完成。

## 对换绑域名的直接结论

目前不能可靠地在网关页面完成已绑定域名的直接更换。本机页面有编辑/保存入口，并要求新域名指向当前网关同一公网IPv4，但宿主永久绑定拒绝迁移，且并发排队还有缺口；外部网关页面目前没有对应的完整换绑入口。

“原域名不变，只改变其A记录”与“把域名A换成域名B”是两个不同流程。前者已有周期解析设计，仍需保持原身份并满足恢复验收；不能据此前者能力声称后者可用。修复并逐宿主确认迁移前，不应停用原域名。
