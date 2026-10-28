# 反代站点持久操作恢复规格

本文件是本地实现规格，不是生产、发行或完整灾备验收声明。

## 不变量

- 用户可改变的远端站点配置必须先在 PostgreSQL 提交授权意图，再向 Caddy 写入。站点原配置表示最后确认生效值；未确认的新目标保存在操作记录中。
- 每站点只有一个未决操作。请求包含明确目标、当前 revision 及 requestId；重复请求返回同一收据，不重复取反或新建操作。
- 每个站点具有永久随机 siteKey；Caddy 路由身份携带 siteKey 和 revision。仅操作当前 siteKey 的路由；同域名的其他身份、更高 revision、失配 ETag 都不能被旧执行覆盖。
- 远端成功但 SQL 或 commit 失败时，原已提交意图继续存在。恢复先读远端，再补回执或按当前代次应用，禁止盲写旧配置补偿。
- 新增远端动作复用实例操作锁以及 instance→host→actor→site→operation 锁顺序。执行前核对当前实例归属、Incus身份、IPv4、宿主连接身份及当前账号/会话资格。
- 未决操作阻止转移、重建、迁移、删除及记录清理跨越站点身份。身份变化必须保留 blocked 操作和域名占用，不能自动把旧意图用于新用户、新宿主。
- 操作记录不随站点、实例、宿主级联删除。删除只有在远端确认不存在后才移除站点，保留操作收据。
- Worker 是唯一 Node 后端内的受限任务，不增加后端副本；同宿主配置写入串行，任务领取、精确 attempt 完成和恢复均持久化。
- 密码、令牌及认证头不写入操作快照、错误或公开日志。宿主连接身份只存摘要；worker使用当前已核验凭据，摘要变化进入阻塞。
- IPv4 网络同步必须复用本执行器，不能另行写 Caddy 后绕过 revision 或清除其他代次状态。

## 接口

保留六个站点接口。create和纯remark修改仍为普通短事务；DNS激活、refresh、真实配置修改、toggle和delete先提交持久意图。远端动作需要 requestId 和 expectedRevision；toggle还必须提供 enabled。DELETE使用JSON body。

新增 POST /instances/:id/sites/:siteId/retry，仅重新授权并重试同一未决目标，不更换配置。列表及单站点响应追加 siteKey、revision、appliedRevision、syncPending、operationId、operationAction、operationState、nextRetryAt；旧 enabled/targetPort/httpsEnabled 保持已确认值。

完成返回200；已接受待执行返回202并含pending=true。可重试故障和身份阻塞返回准确错误及操作收据，站点记录保留。前端不能将202当配置成功或删除成功；刷新页面后应能看到持久状态并重试。

## 验证门槛与待验证边界

- 真实PostgreSQL/Fastify：意图事务失败零远端调用；远端成功后配置/审计写入失败及commit失败仍可恢复；重复requestId；旧attempt/新revision；删除重试保留域名。
- 真实Caddy：siteKey/revision身份、完整配置ETag、迟到旧写、412重试、删除不影响新身份及相邻域名。
- 生命周期：未决操作与转移/重建/迁移/销毁/宿主凭据变化的竞争；身份变化不得写入新目标。
- 网络同步：地址已落库而站点应用失败后仍可恢复，用户配置变更和地址同步不得互相清除待处理状态。
- 重启：pending/applying/结果未知分别恢复，旧请求迟到不得覆盖更新代次，数据库离线不得伪造完成。
- UI：202、错误、blocked、重试、重复点击、刷新恢复和最终删除；保持桌面/移动布局及真实权限。

实现、对应守卫、真实Caddy、本地UI、发行包和生产证据分别记录。没有完成实际验证的项目继续列为未完成。
