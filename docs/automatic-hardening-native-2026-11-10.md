# AMD64 Alpine/GRUB 原生加固验收

Owner 已授权空闲宿主独立测试、必要的一次重启，以及通过后的程序逐台自动处理。此原生验收记录不代表其他架构或引导布局通过；本轮28台AMD64的最终生产结果另见[复审报告](automatic-hardening-sales-review-2026-11-10.md)和HANDOFF。

2026-11-09 18:57–19:15 UTC，在空闲 AMD64 宿主的 Alpine 3.24.3 / GRUB / Incus 7.0.1 原系统上，以原登记管理身份创建独立非特权持久测试实例，限制 128 MiB 内存、2 GiB 磁盘。没有客户订单、账务或真实客户试验。

当前 `host-security-maintenance.py` SHA256 `d304107be87390ddb48a840c0c1a61809fffc3b585281b2955f2a1e229f084cf` 完成官方同分支依赖规划、精确安装、单线程规则编译和引导准备四轮，保留原引导文件 0600 权限。原宿主 SSH 身份、网络配置、桥接网络、默认 profile 与转发均保持。

原固定模板持久登记一次重启后，宿主正常重新连接，Agent 上报同一新启动标识，AppArmor 实际启用。先经受限正式检查通道验证新启动防护、SSH 补丁、资源与 Agent，再启动原测试 UUID。测试实例实际 UID/GID 映射保持、Seccomp=2、Incus AppArmor enforce；原密码、SSH 密钥、文件 hash/权限/内容与网络保持，自启动策略恢复。完成后的同一重启请求再次调用保持同一启动标识，没有再次重启。

重启前后均以真实 SSH 密码协议验证原密码登录、错误密码及 5000 字节错误长密码拒绝、原会话继续可用与 SFTP 读取。通道经原受信宿主管理连接及 Incus exec 转接至测试实例 loopback；这不是客户公网 NAT 验收。实际 Incus AppArmor 策略对宿主危险文件的仅打开操作产生拒绝，未写入或触发系统动作。

库存巡检正确识别未登记测试实例并保留 IP 保护；测试清理没有改数据库保护。仅停止/删除原测试 UUID 和本次导入镜像，恢复原空库存与原网络；留下 root-only 验收/维护历史回执。后续由自然巡检再次核验。

据此仅激活 `alpine-apparmor-grub-v1:x86_64`。检查版本更新为 `customer-hardening-v4`，由程序重新完整检查，保留原写入预算和受信身份，不通过手工写数据库标绿。ARM64、Extlinux、VM/Frozen、独立救援以及真实 OSS 全新 B、客户公网和规模/72 小时仍需各自验收。

本地私有证据位于仓库外 `hardening29/hardening33-native-*.json`；不公开密码、原配置或管理地址。生产批量部署、逐台维护及最终可售结果另记 HANDOFF/GATEWAY_PROGRESS。
