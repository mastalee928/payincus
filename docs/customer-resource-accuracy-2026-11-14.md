# 客户资源限额与开通中 IPv6 展示

本批主控只读取证，E2 #37数据库200%/768MiB/30720MiB、Incus2核/768MB/root30720MB；ARM1C #40数据库100%/4096MiB/30720MiB、Incus1核/4096MB/root30720MB。宿主49/53均无LXCFS，客户/proc显示宿主989380kB/6061232kB，磁盘df显示整个34GiB池。Btrfs qgroup确有28.61GiB限制；不能说磁盘无限或客户真正获得34G。内存cgroup为768000000/4096000000 bytes，存在MB与MiB单位错配。

源码创建/更新资源/重装统一MiB，平台库值不改；磁盘配额改为真实30GiB，保留4GiB宿主池储备。旧池客户后台定向修正精确原数值的MB→MiB，原UUID/创建时间/受信管理/实例锁/ETag/最新任务/维护/恢复核验，实际回读且不改账期、价格或客户文件。恢复兼容精确旧MB成对限额与新MiB成对限额，禁止混合单位放宽资源审计。

新Alpine/Debian宿主安装LXCFS；Agent新v1.0.9为已接入池宿主自动准备包/原服务，保留包变更模拟/版本及安全路径检查，不重启Incus或客户。主控仅为当前原身份运行客户发resourceGuests，Agent核原UUID/PID后补资源proc只读挂载；新启动使用发行版LXCFS hook，原实例直接挂载方案尚待双架构原生验证。Btrfs的df显示池容量而非qgroup，实际配额已取证；截图采样工具来源还待owner回复，不能承诺任意外部工具都按配额显示。

开通结果组件原hasIpv6接受creating/updating，导致“实例就绪后显示连接地址和端口”下面额外IPv6配置提示。仅ready状态渲染原IPv6组件；成功后原文案、地址和交付门槛保留。真实browser创建/pending/refund/updating/ready、复制ABA及三宽深浅通过；frontend路线/i18n守卫通过，双build仍在收尾。

本地MiB与恢复专项、7相关守卫、额外5资源/隔离/恢复及3启动守卫通过；参数化双架构PG/mTLS原重装/新同意、旧池单位修正/幂等和账务保持完成，最后build/types通过，Linux双架构provisioning交叉编译过。Windows全Agent因原report/syscall.Statfs不适用于Windows而失败，原生完整Go检查待CI；不将cross compile当服务/挂载实证。新的LXCFS现有客户真实挂载/1024MiB cgroup/原SSH、容器磁盘配额及目标OTA均待；正式发行须全部闭环。
