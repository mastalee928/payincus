# 客户资源限额与开通中 IPv6 展示

Incus修复固定artifact双架构原生切换43518949938已success：原daemon SIGTERM平滑退出、固定官方7.0.1回补daemon启动后客机UUID/PID/boot/文件保持，sysinfo=128MiB。Agent1.0.11将对应架构压缩daemon嵌入已有可信升级包、构建依赖官方源码/精确patchedSource hash，不依赖永久历史artifact；主控持久门禁→原实例许可→Agent真实原PID/启动时间、库依赖、backups/重载/回读及回滚→原身份回执解除，新旧普通加固保持该门禁。PG/mTLS许可/续接/阻新任务/回执/完整重装账务回归已过，新自动函数同来源CI、全部回滚/真实目标应用仍待。此前原始sysinfo失败及试验记录保留，不能宣称这一批已上线。

Owner已确认资源截图是自用SSH工具，不是本程序资源页面；后续不做该工具UI或PayIncus资源页面改造。实际Incus/cgroup内存768MiB/4096MiB与Btrfs30GiB配额已修正，八运行池客户/proc及只读资源视图回读全部正确。外部工具的df/statfs可能显示34GiB整池，不等于客户可写34GiB；sysinfo的旧Alpine Incus归属失败另行修复。

现场sysinfo专项未闭环：Alpine Incus7.0.1监控进程cmdline为空，原findContainerForPid只认标题`[lxc monitor]`，用monitor PID的namespace回退无法对应guest；Incus debug事件明确`Failed to find container for monitor 26821`，限时SSH ctypes.sysinfo返回宿主1013125120B，而/proc和实际cgroup为768MiB。#37无guest timeout的额外诊断曾挂住monitor，主控Error；核原进程/父进程后只kill测试诊断恢复同boot Running。不得把这次恢复当sysinfo修好了。原地标题试验未有效且已恢复原空argv，不用于产品。固定官方7.0.1源码hash回补上游cgroup识别与第一payload/monitor路径锚定安全修复的双架构构建正在验证；后续必须真测旧daemon无客户重启替换/重载和sysinfo精确值。正式未发布。

后续同来源bebeb93f的双实际tar、243迁移、原签名及全部旧升级/首装预览43495815626通过，Agent43495823040 success且无正式Release。正常主控manifest五分钟缓存更新后自动升级34/34到候选1.0.10，所有资源工具回执ready、宿主online且未新增poolFaulted。八运行池实例/proc+cgroup+只读视图7项正确；历史#27持久managedCleanup有原UUID和受信endpointHash但没有createdAt，旧后台修正误跳过。只为精确旧配额修复接受原UUID+原endpoint持久证据，仍核受信宿主、最新绑定/任务、ETag与原UUID，不以同名替代；双架构PG/mTLS新增缺时间正确修复/错误endpoint拒绝/幂等与账務保持通过，server types/build完成。AMD/ARM各24可选镜像矩阵20:06UTC启动，已开始真实重装/停启/重启/SSH/IPv6/内存视图逐项验收，执行期间不升级backend。

2026-11-14 03:19最新目标实证：热更新任务44成功，主控运行preview-3773087（37730870e006）、243迁移，原worker/签名/DB支付/双前端检查通过。34台宿主自然升级到候选Agent1.0.9，全部online/poolFaulted=false；E2/ARM1C后台MiB限额及Btrfs30GiB qgroup已经生效，88份持久镜像收据、136文件18.66GB更新期间全部保留、无新下载。旧#36任务225自然FAILED且远端Stopped，允许正常重新选镜像。

现存客机资源挂载发现目标环境缺口：Alpine6.18内核下直接跨命名空间bind返回EINVAL（两架构同样），即使原身份、procfs、工具与LXCFS服务正常；Ubuntu原生CI的成功不能代替此现场旧实例路径。已在仅授权测试#37/#40以原UUID/PID核验复现并验证open_tree/mount_setattr/move_mount、固定原proc目录/namespace/自身二进制fd方案，无客户重启，内存读数实际786432kB/4194304kB。源码候选Agent1.0.10补此路径，只读/noexec/nosuid/nodev、固定资源文件白名单与坏helper调用拒绝；全自动升级和同来源双架构CI仍待。旧运行客机sysinfo设置下次正常启动生效，不强制重启其它客户。

37730870最终本地221/221、双端build、参数化双架构PG/mTLS和CI43485353719 29/29（14原生）、Agent43485353405、Alpine43485353416及预览43485353098全部success。新挂载修复改变Agent来源，上述结果只代表前一来源，必须另核新来源；全部ARM可选镜像操作矩阵尚未启动，正式未发行。

本批主控只读取证，E2 #37数据库200%/768MiB/30720MiB、Incus2核/768MB/root30720MB；ARM1C #40数据库100%/4096MiB/30720MiB、Incus1核/4096MB/root30720MB。宿主49/53均无LXCFS，客户/proc显示宿主989380kB/6061232kB，磁盘df显示整个34GiB池。Btrfs qgroup确有28.61GiB限制；不能说磁盘无限或客户真正获得34G。内存cgroup为768000000/4096000000 bytes，存在MB与MiB单位错配。

源码创建/更新资源/重装统一MiB，平台库值不改；磁盘配额改为真实30GiB，保留4GiB宿主池储备。旧池客户后台定向修正精确原数值的MB→MiB，原UUID/创建时间/受信管理/实例锁/ETag/最新任务/维护/恢复核验，实际回读且不改账期、价格或客户文件。恢复兼容精确旧MB成对限额与新MiB成对限额，禁止混合单位放宽资源审计。

新Alpine/Debian宿主安装LXCFS；Agent新v1.0.9为已接入池宿主自动准备包/原服务，保留包变更模拟/版本及安全路径检查，不重启Incus或客户。主控仅为当前原身份运行客户发resourceGuests，Agent核原UUID/PID后补资源proc只读挂载；新启动使用发行版LXCFS hook，原实例直接挂载方案尚待双架构原生验证。Btrfs的df显示池容量而非qgroup，实际配额已取证；截图采样工具来源还待owner回复，不能承诺任意外部工具都按配额显示。

开通结果组件原hasIpv6接受creating/updating，导致“实例就绪后显示连接地址和端口”下面额外IPv6配置提示。仅ready状态渲染原IPv6组件；成功后原文案、地址和交付门槛保留。真实browser创建/pending/refund/updating/ready、复制ABA及三宽深浅通过；frontend路线/i18n守卫通过，双build仍在收尾。

本地MiB与恢复专项、7相关守卫、额外5资源/隔离/恢复及3启动守卫通过；参数化双架构PG/mTLS原重装/新同意、旧池单位修正/幂等和账务保持完成，最后build/types通过，Linux双架构provisioning交叉编译过。Windows全Agent因原report/syscall.Statfs不适用于Windows而失败，原生完整Go检查待CI；不将cross compile当服务/挂载实证。新的LXCFS现有客户真实挂载/1024MiB cgroup/原SSH、容器磁盘配额及目标OTA均待；正式发行须全部闭环。
