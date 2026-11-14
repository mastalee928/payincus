# Alpine 停启后的 DNS 丢失

目标实证：候选70f75c6/Agent1.0.13上，测试#42的Alpine3.21 TinyCloud重装完成，stop/start任务672也完成，但随后150秒持续IPv6出口探针失败。实际SSH密钥交换成功、地址与原转发存在；两个HTTPS回显域名均curl exit6。`/etc/resolv.conf`为0字节，dhcpcd的eth0 DHCP状态仍保存正确DNS。日志显示ifupdown已启动每接口dhcpcd，平台初始化又登记全局dhcpcd，下一次启动出现DHCPv6端口占用、重复路由与同一resolver临时文件竞争。

## 五轮代码审视

1. **首次创建和重装。** Alpine生成器保留发行版DHCP客户端依赖，新增openresolv，删除平台额外的global dhcpcd启动登记。原ifupdown或cloud-init管理客户地址；不修改客户IP/密码、通用镜像或其它系统的服务。
2. **已有实例自动恢复。** 只认Alpine、已完成的平台初始化及旧生成脚本中的确切登记命令、eth0 DHCP配置；只移除指向发行版原服务的default链接。安装脚本沿已认证的专用IPv6同步链执行。现有进程不被kill或网络服务重启，下一次正常启动不再双开。
3. **DNS与客户配置保护。** 只为空的普通resolv.conf，从现存DHCP lease提取nameserver并原子写入；非空客户配置和符号链接保持。仅可信dhcpcd/本修复生成的resolver允许补发行版openresolv及种入现有DNS。包下载沿当前分支和原APK签名，15秒上限，失败仍留实际失败并自动下轮重试。
4. **真实异步验证。** 首启正确不能代替后续RA与DHCP事件。新增原生TinyCloud场景从旧双客户端/缺openresolv/空DNS开始，通过产品同步修复，确认boot未变；再做两次stop/start，各等待45秒后检查DNS、单客户端、域名解析，原SSH与初始化标记保持。另验客户resolver符号链接不被改写。
5. **打包及目标验收。** 新模块必须进入实际双架构tar并与本地build逐字核对；完整CI、真实双首装/六旧worker升级、主控热更新后#42自然恢复及最终两架构全镜像矩阵分开记录。矩阵补延迟DNS检查与实际OS家族/版本判断，旧失败记录不改绿。

当前源码5c8d966c已提交推送，后端type-check/build、dedicated-delivery及host-public-ipv6守卫通过。双架构原生新场景、候选完整包和现场修复尚待终态；本文件不是完成或正式发行声明。#27/#41正常运行，授权一次停启已经完成，不重复操作。

Owner随后强调现有及未来全部宿主：范围复查发现仅IPv6同步会遗漏无公网IPv6宿主，补入现有按游标遍历全部机器池的后台维护及正常专用交付/停启检查，复用原实例锁、当前绑定、受信endpoint与UUID，DNS步骤不依赖IPv6库存。每台资源修复与DNS修复分别捕获异常，单项失败不阻断另一项或后续宿主；到期/封停/在途/Stopped不启动客机修DNS。新增双架构PG/mTLS验证IPv4-only可执行、复用名称错UUID拒绝、已到期不执行，并把原生TinyCloud旧状态测试入口改为真正池维护函数。不能以#42通过替代这项全池覆盖。当前目标仍preview-70f75c6，新增覆盖尚未热更新。

cd1b1787同来源原生CI43553546558的TinyCloud job132321170069/132321170189已分别success，原日志含实际池维护恢复、两次后续启动、SSH及清理通过。十二Incus兼容场景43553546621、Agent43553546711与Alpine43553546626成功；两实际tar原pin签名、243迁移、全池DNS新模块与本地build一致、用户无改价入口独立核验通过。完整CI六综合分片、双首装/旧worker预览43553542894尾段仍在运行。候选仅暂存代码目录外，未激活；不把这一阶段写成目标全池已修好。
