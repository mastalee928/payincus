# 自动加固三轮代码审视（2026-11-10）

本轮完成非特权隔离、自动维护续接、客户恢复与可售门禁的三轮源码审视及对应本地隔离回归。全部新增修改留在本机，未连接主控、未部署、未提交或推送，稳定 tag、Release 与安装包未改变。此前生产结果仍以 HANDOFF 的历史实证为准，不能将本轮通过解释为新修复已上线。

## 第一轮：权限、隔离与原身份

检查管理员路由及数据库当前权限、Incus 创建/开机/重启/解冻/设备修改/快照和导入恢复边界、profile 继承、raw 配置、宿主设备/socket、UID/GID 与 Seccomp。当前拒绝客户特权模式，并保留密码初始化、非特权 nesting 及正常 KVM 配置路径。

发现并修复：SSH 维护服务没有先拒绝客户删机意图，也没有在服务入口显式检查持久宿主维护门禁。真实生产 Incus 客户端已有通用写门禁，但不能依赖底层报错代替服务的完整前置判断。现管理员和自动入口在连接前检查维护/删机/运行实例到期状态，并在密码握手和预检完成后、实际补丁之前再次检查到期时间。未重置客户密码或关闭密码登录。

本地 PostgreSQL 回归先复现“已有删机意图仍成功返回”的旧行为；修后拒绝且零补丁/零密码会话。另覆盖过期、畸形持久维护记录、握手期间跨过到期时间、普通用户和撤销会话、原身份、短/长真实数据库锁。

## 第二轮：调度、并发、期限与中断续接

检查队列 lease、实例到宿主取锁顺序、1500ms 有界等待、持久维护全局门禁、原请求准备与回退预算、Agent/远端 journal、新 boot 和失败回执续接。保持单后端、单目标维护；等待不扩大为重装、换身份、盲目重复重启或清保护。

发现并修复：最终回执原先只检查绑定/lease，未重新检查当前管理员、自动策略和宿主就绪；并且可用旧 state 覆盖检查结束后新登记的 maintenance。现在最终事务重新核权和维护门禁，保留当前 maintenance；离线、安装待完成、策略关闭、管理员撤销、新维护记录均拒绝旧成功。

发现并修复：主控作出重启决定后，最后一次远端基线检查可能跨过维护期限；宿主最后一次检查也可能跨过请求期限。现主控实际 dispatch 前再次核期限；wire 请求有效期取原维护 deadline 与59秒上限的较早者，缺失/无效重启期限拒绝；宿主在基线检查后、写持久 reboot barrier 前再次核期限。过期的 status/rollback 与原 boot 回退仍可续接。

主控 PostgreSQL/时钟夹具先复现过期后仍 dispatch 一次；Python journal 夹具先复现检查结束后越期仍写 barrier。修后均为零重启下发、原 prepared journal 保留，并按原请求回退。Python 夹具不代表 Linux 原生启动验收。

## 第三轮：客户最新意图、恢复与可售

检查到期/封停/停机/删除优先级、原客户 UUID/attempt/endpoint、持久实例与受保护配置、原网络 hash、原密码、新 boot/AppArmor/Agent 先验、精确 start/stop/只读 SSH capability、任务恢复与最终可售分配检查。新接入仍需当前原 lease、完整检查和 Agent；occupied 宿主仍占用。ARM64、Extlinux、VM/Frozen/救援的原生维护放行范围没有扩大。

发现并修复：最终回执未核对检查结束后的新删机意图、到期及在途宿主/客户任务；成功探测还会在最终结果拒绝之前清零更新失败预算。现在这些最新意图使旧成功等待，原任务保持 PENDING；只有最终完整结果确实 verified 才清零预算。初次检查同样拒绝已有删机意图和到期仍运行的客户。

本地 PostgreSQL 回归先复现新删机意图仍标 verified；修后过期/删机/新 stop 任务拒绝旧成功，撤销权限后 updateAttempts=3 保留。客户恢复与补续开机专项核原身份/密码/配置/网络、最新停删/到期/封停、丢响应后无重复开机，以及失败后不重复扣款。

## 本地验证与证据

11项对应专项最终自然 exit 0：

- `customer-isolation`
- `alpine-ssh-maintenance`
- `security-hardening-queue`
- `host-security-maintenance`
- `security-hardening-guards`（含15项 Python 维护 journal/依赖/引导夹具）
- `customer-boot-recovery`（真实本机 PostgreSQL、固定证书 mTLS/HTTP）
- `alpine-ssh-security-guards`
- `host-public-ip-integration`
- `host-public-ipv6-integration`
- `renewal-resume-integration`
- `dedicated-delivery`（含本机真实 SSH 协议及原密码检查）

后端 `type-check`、`build:server` 和 `git diff --check` 通过。仅后端与测试/文档有本轮新修改；已有前端改动保留，没有本轮新 UI 修改。未重复全套守卫或大矩阵。

证据：`logs/hardening40-*.log` 与 `logs/hardening40-evidence-index.json`。测试启动器限定 `127.0.0.1:55438` 的独立 `_pool_test` 数据库；没有使用生产执行器。失败前后的复现结果在本轮工具输出保留，最终日志记录修后结果。

## 范围与剩余验收

本轮新修改仅完成代码与本地协议/数据库验证。没有重新做真实 Alpine/Incus 宿主启动、客户公网连接或新版包验收；此前28台 AMD64生产证据不能代替本轮改动上线后的验证。ARM64/Extlinux/VM/Frozen/救援、真实 OSS 全新B完整灾备、独立备用与千台72小时继续单独待验收。非特权容器共享宿主内核，当前检查不能证明任何内核逃逸都不存在。
