# 2026-11-12 本批实例问题综合代码复审

按owner要求将单实例最终续费价、管理员权限、回池原定价、到期实际停机／截止删除、续费恢复、IPv6状态与旧地址、BBR一起复审。先读取OWNER_REQUIREMENTS与当前台账／差异，检查活动任务，未重新开始旧清单。当前仍为本地源码与隔离验证；没有新生产连接／写入、提交推送、tag或发行，v1.8.7／Agentv1.0.7保持工作区候选。

## 新发现与精修

| 问题 | 修改 | 证据 |
|---|---|---|
| 手动续费只在入口受恢复保护，已鉴权请求等待账户行锁时恢复保护开启，实际扣款仍可能继续 | 实际续费lane内开始、扣款前、更新账期前和提交前均核recoveryHeld，手动／PublicAPI及自动续费一致保护；抛错使余额、账本、期限同事务回滚 | 修前`comprehensive-20261112-renewal-before.log`确实未拒绝；修后真实PG专项通过，并独立观察pg_blocking_pids真实等待后开启保护，账务及期限完全保持 |
| 封停期间发现新公网IPv6，只保留旧ready mappings，展示误将全部分配当作ready | 在协调结果／等待状态保存完整assignedAddresses，只有当前全部分配都有ready mapping才去掉“配置中”；旧格式没有该字段仍兼容，下轮实际发现会补齐 | 修前`comprehensive-20261112-ipv6-before.log`得到错误ready；修后新增第三地址仍只展示两条旧已确认地址、status=pending，停止不配置客户；恢复后正常同步 |
| OpenRC BBR读模块清单后截断写入，可能覆盖管理员刚增加的模块；BBR生成配置仅凭首行标记可覆盖附加设置 | 模块写入打开原文件no-follow，锁后复读并比对期望内容，只O_APPEND固定缺失模块，不截断旧数据；配置仅接受内容完全相同或精确旧格式，额外管理员行保留为冲突 | 原截断／宽泛前缀接纳为代码级明确缺陷；Linux实测过期模块快照拒绝且新管理员模块原样保持，symlink拒绝、生成配置中的管理员附加行不覆盖，完整BBRengine仍正常 |
| 旧原地重装的null／数组／字符串回执被record()归为空对象，误走合法旧任务兼容 | 仅replacementState真实非null对象且无字段才允许旧原地rebuild使用原保存身份；COMPLETED／同宿主要求保持。损坏、部分重建／迁移及未知身份继续拒绝 | 修前`comprehensive-20261112-identity-before.log`确实错误返回原身份；修后null／数组／字符串／部分uuid／错误宿主均返回未确认，合法旧空对象与完整换机通过 |

本轮前端产品源码没有变化；后台字段`assignedAddresses`只用于真实状态判定，不是给用户填写的新技术参数。不为复审改变手动续费的开机合同：手动续费解除到期封停为Stopped，用户手动启动；自动补续才同事务排队受保护自动开机。手动／风控封停不自动解除，已删／进入删除不能复活。

## 交叉核对结果

- 当前用户实例最终价与机器池商品价分开；保存不改已付账单、余额、到期、商品或其他实例，零元与金额精度沿用已验收实现。新旧改价接口仅管理员，退役宿主入口无写入；用户无编辑器／旧客户端，原config／rename不可注入价格。
- 回池销售从机器池定价及新create记录获取价格；旧实例覆盖价不传到新实例。沿用同宿主原价回售专项，无修改的路径不重复跑。
- 每五分钟先补续，再续接自动开机、到期停机与删除；系统封停起72小时截止后不自动补扣，实际确认客机／磁盘／转发释放才回池，失败保护保持。原身份回执修正已通过完整真实PG／HTTPS停删与补续测试。
- 自动IPv6扫描覆盖已自动接入的一机一卖宿主；运行与管理／任务／隔离条件满足才配置旧地址清理。停机不自动启动，恢复运行后续接。保留两个协议所需内部映射，只删可证明的同前缀MAC-derived SLAAC，不删客户静态／未知地址。
- BBR仅现内核支持才启用，不换内核／重启客户；固定宿主工具进入已核UUID／PID的网络命名空间，不执行客户挂载空间脚本。心跳状态锁独立，不因性能协调阻塞采集。停机／Frozen不启动；VM独立内核仍是未覆盖来宾范围，ARMnative性能实证继续待补。

## 本轮最终验证

| 检查 | 结果与日志（均有独立.exit） |
|---|---|
| 单实例改价／权限／续费及新恢复行锁竞态 | `logs/comprehensive-20261112-renewal-final.log` exit0，真实PG／生产JWT装饰器，新增保护开启期间手动续费零扣款／零账单／期限保持，原最终价／普通用户拒绝／批量／幂等／审计回滚保持 |
| IPv6库存／停止／新分配／换机显示 | `logs/comprehensive-20261112-ipv6-after.log` exit0，真实PG新增地址不伪报ready，停止保持原分配，新增/撤销/任务/隔离边界及IPv4保护 |
| 原身份严格解析 | `logs/comprehensive-20261112-identity-final.log` exit0；合法旧rebuild原uuid、完整换机、畸形／部分／不同宿主拒绝 |
| 到期停机／截止删除／库存／补续 | `logs/comprehensive-20261112-expiry-final.log` exit0，独立空*_expiry_test数据库＋HTTPS Incus/Caddy，最终passed=true／stop9／delete5。`logs/comprehensive-20261112-resume-final.log` exit0，丢回执、后续停机/封停、身份与权限竞态、不重复扣费／开机保持 |
| Linux BBR实际运行与文件保护 | `logs/comprehensive-20261112-bbr-native.log`串口终态COMPREHENSIVE_BBR_EXIT=0，真实Alpine3.24／x86_64内核BBR、固定namespace、完整engine真实sysctl／受控Incus清单、管理员新模块／附加配置保留、symlink拒绝。Windowsperformance单元也通过 |
| Agent验证 | LinuxAMD64／ARM64完整Agent编译通过，定向go vet通过；本轮最终二进制`incudal-agent-comprehensive-amd64/arm64`。没有把编译冒充全部Agent原生go test或ARM实际性能验收 |
| 后端类型／构建 | 最终`logs/comprehensive-20261112-server-build-final.log`自然exit0，tsc与server静态资产构建通过；本轮只改后端／Agent，前端复用上轮实际双端build／严格dist和浏览器 |
| 对应守卫 | `logs/comprehensive-20261112-guards.log`5/5；最终identity新增拒绝另自然通过。未扩展重跑全218项，不宣称CI通过 |

最终source hashes与日志索引另存ignored `logs/comprehensive-20261112-evidence-index.json`。所有修前失败保留；本轮验收仅新增／受影响范围，不重复旧全套。临时Linux VM／HTTP传输定向停止；关闭后串口logger连接重置是清理事件，内部测试自然exit0已保存。

## 当前范围

生产仍未应用修复；#28到期Running和BBR现态的前次只读证据保留，本轮不再登录生产。正式包、同来源CI／双架构首装／OTA、ARMnative／VM来宾BBR、完整公网持续连接及原灾备／规模项仍需独立证据。发行暂停保持。
