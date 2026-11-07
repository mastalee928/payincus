# 2026-11-06 宿主内存检查与隔离优化

Owner要求一起检查 seoul-amd-2 与没有客户实例的 seoul-amd-3。本轮通过原登记 SSH/Incus 身份只读采集，时间为 2026-11-05 23:27–23:38 UTC（北京时间 11月6日 07:27–07:38）；没有修改生产配置、重启服务、清缓存、关闭swap、部署或操作客户。

## 统计口径

Agent v1.0.4 按 `/proc/meminfo` 的 `MemTotal - MemAvailable` 上报整机使用量，包含客户实例与宿主服务、内核及可用内存估计中的保留量。不是Agent自身内存，也不是所有进程RSS简单相加。`MemAvailable` 已考虑可回收文件缓存；不能再把全部Buffers/Cached减一次，或把数字差异直接认定为显示错误。

下表用MiB（1024²字节）。进程使用PSS分摊共享页，整机使用为上述Agent口径；cgroup包含内核、缓存等，三种口径不能直接相加。客户配置显示768MB，Incus API实际total=768000000字节，约732MiB。

## 实际结果

| 宿主 | 客户 | 整机使用 / 总量 | Incus主进程PSS | Agent PSS | swap |
|---|---|---|---|---|---|
| seoul-amd-2 | #28运行 | 423–437 / 966 | 142–149 | 12.8 | 整机约136；Incus主进程约110，另一监控进程约18 |
| seoul-amd-3 | 无 | 截图336；采集334–357 / 966 | 114–115 | 13.0 | 0 |
| seoul-amd-1（空机对照） | 无 | 525–536 / 966 | 249–251 | 12.5 | 整机约10 |
| jeddah-amd-1（空机对照） | 无 | 317–327 / 966 | 96.7 | 13.1 | 0 |

- 28台启用Agent的宿主中，26台无客户实例；本次Agent快照的空机使用中位333MiB，范围314–525MiB。深采样仅上述目标/对照，未对全部宿主执行大矩阵。
- seoul-amd-2客户#28的Incus内存使用在连续检查中约59–62MiB，客户swap_usage=0；其768额度没有全部分配为驻留内存。
- 独立网关域名刷新Python进程约5–10MiB。Agent占用约13MiB，优化Agent无法解释或消除整机数百MiB基础占用。
- 两轮12/20秒vmstat检查均没有新增pswpin/pswpout/majorfault或oom_kill，累计oom_kill=0。只能证明短采样未见活动交换/OOM，不能替代长期或满负载验收。PSI接口未返回内容，不能说PSI=0。
- seoul-amd-2的Incus服务cgroup历史峰值约690MiB，空机seoul-amd-1约607MiB；峰值没有事件时间及业务关联，不能把它归因于某次交付或本轮检查。
- Alpine 3.24.3/OpenRC、Incus 7.0.1、Seoul宿主kernel 6.18.58-0-virt，Incus二进制Go build版本1.26.9。内核min_free_kbytes=45056、swappiness=60。systemd模板里的Agent限额并未自动适用于这些OpenRC机器。

## 可优化方向与证据范围

Incus受信 `/1.0/metrics` 的Go堆分配量：seoul-amd-2约12MiB、seoul-amd-3约6.35MiB、seoul-amd-1约8.54MiB。Go Sys减heap_released约28–31MiB；运行时已归还大量空闲堆。其余PSS包含非Go分配、映射和可能的大页膨胀，不能仅凭进程PSS就判定Go堆泄漏或认为设置GOMEMLIMIT必定有效。

三台Seoul的透明大页均为 `enabled=[always]`，2MiB尺寸继承全局设置，`khugepaged/max_ptes_none=511`。Incus smaps中的匿名大页分别约82MiB、46MiB、164MiB；seoul-amd-1约224MiB匿名内存，而实际Go堆约9MiB。大页用量证明存在优化候选，**不证明全部大页是浪费，也不等于可直接节省的字节数**。原生分配/高水位残留与大页因素仍需隔离对照确认，当前不能诊断内存泄漏。

建议按以下顺序验证：

1. **仅Incus Go堆关闭大页的隔离A/B试验。** 当前1.26.9运行时源码仍支持 `GODEBUG=disablethp=1`，对新分配Go堆使用MADV_NOHUGEPAGE；只在Incus环境设置并合并原GODEBUG，不能覆盖其他值。它不覆盖全部native内存，GC元数据仍可能使用大页，因此节省量须实测。用同OS/kernel/包和同等待时间，测稳定PSS、AnonHugePages、峰值、CPU与API延迟，重现原管理轮询及交付/删除/备份流程；比较客户持续连接与新登录、IPv4/IPv6、流量和原身份。
2. **进一步核非Go匿名内存与重复业务后的增长/回落。** 若关闭Go堆大页后仍保留大差异，追踪Incus/原生库分配与官方同分支修订；只有找到适用修复并通过相同流程，才安排更新，不能为了内存数字直接升级大版本。
3. **按客户满额度核验宿主余量。** 空机仍有约630MiB的MemAvailable，1GiB宿主配置768MB（约732MiB）客户额度没有足够余量承诺全额度驻留且不用swap。当前客户用量低、短采样平稳不代表满载通过；应测试额定负载和管理任务峰值，再决定服务优化、实际容量或销售额度。

不作为本轮方案：宿主全局关闭THP（会影响客户）、对Incus启动器套PR_SET_THP_DISABLE（跨fork/exec继承，可能影响新客机）、盲目降低内核保留/配置硬内存限额、定时重启Incus、drop_caches或swapoff。这些措施不能直接修复原因，也可能影响管理/客户。Alpine原OpenRC `stop()` 调用 `incusd shutdown`；不能把常规restart等同于无客户影响的daemon-only重载。本轮没有执行这些操作，也没有保证某个目标内存值或生产零影响。

## 依据与本地证据

- [Go GC指南：透明大页与内存限制](https://go.dev/doc/gc-guide#Linux_transparent_huge_pages)
- [Linux透明大页管理](https://docs.kernel.org/admin-guide/mm/transhuge.html)
- [Go 1.26.9内存实现](https://github.com/golang/go/blob/go1.26.9/src/runtime/mem_linux.go)
- [Alpine 3.24 Incus打包](https://gitlab.alpinelinux.org/alpine/aports/-/blob/3.24-stable/community/incus/APKBUILD)

原始脱敏快照与只读采集器保存在ignored `logs/host-memory-*`：inventory、runtime、seoul3、details、incus-metrics、mappings、runtime-build。内存映射只输出类别/系统库名，不输出内存内容、业务路径、凭据或环境全量。SSH密码/私钥沿已有私有档案在内存中使用，不写入公开记录。检查脚本均自然exit0，三台映射/版本检查仍确认#28运行、两台对照无客户。

## 2026-11-07 隔离优化进度

Owner随后要求“开始优化”，本轮继续源码与隔离验证。`server/templates/install-alpine.sh` 增加仅新装小内存宿主可用的实验入口；默认关闭，必须显式设置 `INCUDAL_EXPERIMENTAL_INCUS_MEMORY=1` 才会准备配置。现存 Incus 进程、socket 或数据库会跳过；仅修改 root 普通配置文件，保留权限、其他 GODEBUG 与管理员显式 disablethp 值，语法检查后原子替换。入口没有重启命令、全局 THP 修改、内存限额或客户配置修改。

最终三项相关守卫、211项清单校验与 Bash 语法通过；server 类型检查和构建通过。实际 Alpine 上运行最终专项，普通默认保持原文件，幂等、Unix symlink拒绝和权限保持均通过；官方 OpenRC 配置另有 root/640、shell解析与环境保持证据。

隔离机使用官方 Alpine 3.24.3 AMD64 ISO（SHA256 `cdc1bc0efc64d8d611bf3733f54868172a545888dfd726f518bf279bcb0ff1af`），kernel 6.18.58-0-virt、Incus 7.0.1，与已读取的 Seoul 版本一致。使用专用磁盘和独立 Incus 数据目录，没有生产数据。早期模拟器退出和数据库 context deadline 超时的日志保留；超时轮没有有效 A/B 数据，不作为优化失败或内存泄漏证据。调整为虚拟计时后，原配置与优化配置均成功初始化并完成相同24轮管理请求。

三组管理流程已完整结束，原配置/优化/恢复原配置的RSS分别78484/73988/75688KiB，AnonHugePages分别24576/8192/20480KiB。前两组PSS为77879/73410KiB，但恢复原配置组PSS58112KiB受到同时开始的客机测试Incus共享文件页影响，不能当成同条件PSS比较；该执行重叠已记录，不能用完整结束代替实验有效性。RSS在优化组比原配置低约4.4MiB、比恢复原配置低约1.7MiB，只能说明这轮小幅差异，尚无重复实验证据。大页下降16MiB并不等于省16MiB物理内存。API每轮中位148.9/120.6/118.8ms，最大432.0/724.3/1370.5ms；虚拟计时和慢模拟器不能代表生产速度，不能据此承诺性能提升。

客机测试未完成：原夹具复制全部宿主库并压缩，在慢模拟器上耗时过长；确认没有创建客机后，停止本轮确切夹具进程，复用已准备根目录，仅打包SSH必需库继续。续接时Incus仍在初始化，最后未得到客机结果文件。已保存诊断、同步专用盘并正常关闭本轮QEMU，exit0且PID已消失；没有遗留活动测试。缺少客机SSH、IPv4/IPv6、备份/删除、继承及持续连接证据，不写通过。观察SSH结束的exit0也不能替代测试结果文件。

这个初步收益不足以解释线上Incus114–251MiB差异，因此实验入口默认关闭，不随普通安装自动推广。seoul-amd-2/3及其他生产宿主没有应用本轮设置，客户原密码/实例/连接未在生产改动。仍需代表性原生环境重复对照、非Go匿名分配追踪、真实客机连接/网络/备份与额定负载验证；当前没有嵌套KVM，虚拟机客户未验收。此前Alpine SSH安全补丁仍为下一次实际安装包必含项，与实验内存设置分开处理。

本地日志：`host-memory-final-related-suite2.log`、`host-memory-final-manifest.log`、`host-memory-server-{type,build}.log`、`host-memory-vm-final-guard2.log`、`host-memory-openrc-config-native.log`；A/B及客机实际结果继续保存在 `host-memory-vm-*`，未终态项不写通过。

下一次验证先复用专用盘与镜像，不重复下载、装包、尝试已崩溃的模拟器；在具备可用原生Linux/硬件虚拟化的隔离环境中，先完成客户流程，再串行重复同一来源原配置/优化/恢复原配置，禁止在采样结束前启动另一个Incus。记录RSS/PSS及共享页、Go与native匿名页、CPU/延迟和业务峰值，补齐全部客户检查后才决定启用。当前本轮交付是实验入口及证据记录，宿主占用问题尚未解决。

北京时间11月7日01:15，追加受信只读检查seoul-amd-3与seoul-amd-1：两者均无客户，Incus PID及startTicks与前轮一致。纳入采集的匿名映射RSS分别63928/214080KiB，大页40960/151552KiB；这是映射子集，不是整机或进程全部PSS。固定地址区间分类没有识别Go堆，不能把“other-anonymous”当成已证实C/native内存；需要运行时分配证据才能归因。该检查未读内存内容、修改服务或客户，日志 `host-memory-anonymous-readonly.json` / `host-memory-anonymous-inspection.log` 自然exit0。不据此盲设GOMEMLIMIT、malloc参数或调用生产分配器回收。
