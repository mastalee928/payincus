# 自动加固独立复审（2026-11-10，hardening41）

接续前轮三轮审视，独立检查 Incus 非特权隔离、自动维护准备、重启后客户恢复及中断回退。本轮确认并修复三类边界问题，已通过对应本地隔离测试、后端类型检查与构建。新增修改尚未经过真实 Alpine/Incus 宿主验收，没有连接主控、部署、提交、推送或发行。

分支仍为 `codex/automatic-hardening-grub`，HEAD 为 `2620f05ba44a7ffd23bb9a3fe84a73aecb7109c4`。工作区包含前阶段和前轮的累计未提交修改；不能把整个 diff 都归为本轮，也不能用 HEAD 单独代表当前源码。精确文件 SHA256 见本地 `logs/hardening41-evidence-index.json`；前轮 `hardening40` 证据保留。

## 1. 恢复时再次限定原容器类型

初次采集只接受持久 container，但恢复器此前仅复核 UUID、attempt、受保护配置和网络，未再次限定类型。配置摘要不包含 type；本机真实 PostgreSQL 和固定证书 mTLS 夹具复现：KVM 目标复制同一组标识和配置时，旧恢复器未按预期拒绝。此证据说明维护恢复检查遗漏，不能据此断言普通客户可以修改宿主上的实例类型。

`customer-boot-recovery.ts` 和 `host-security-maintenance.ts` 现分别在恢复器、协调器远端基线检查中要求 `type === 'container'`，否则返回 `HARDENING_VM_RUNTIME_UNVERIFIED`，不给开机授权。回归同时覆盖两个入口，验证零新增客户开机、零新增宿主重启、自启保护保留；原 container 的正常恢复继续通过。正常 KVM 产品路径没有改动，KVM 自动维护仍待独立原生验收。

失败证据：`logs/hardening41-customer-type-before.log`。修后：`logs/hardening41-customer-boot-recovery.log`。

## 2. 准备动作在耗时读取后重新检查期限

旧协调器在远端基线检查前计算过期状态，耗时检查结束后可能仍下发 prepare；分步依赖准备续接也有同一窗口。远端执行器原先只有请求入口检查，客户配置 GET 或系统预检耗时跨过请求期限后，仍可能安装依赖、修改自启或引导配置。

修复包括：

- 协调器首次 prepare 和准备续接在远端检查结束后重核持久 deadline。
- 通道对 prepare/reboot 都要求有效且未过期的 deadline，wire 有效期取维护截止时间和59秒上限的较早者。
- Python 执行器在依赖安装/策略编译、服务启动项和引导写入前重新核请求期；客户配置 GET 后、实际带 ETag 的 PUT 前也重新核验。
- 已接受的有界包安装保留原任务记录，不通过超时强行回滚系统包；状态查询、原配置回退及客户恢复仍使用新短期请求，可在原维护期限之后续接。

测试覆盖首次和续接基线跨期限、安装前过期零安装、客户 GET 跨期限零 PUT、过期后只查询/回退，以及新请求恢复同一 preparing 记录。首次客户越期回归确实观察到一次旧 PUT，修后为零；不是只检查错误消息。

失败证据：`logs/hardening41-prepare-expiry-before.log`、`logs/hardening41-python-before.log` 和 `logs/hardening41-python-edge-before.log`。

## 3. 准备和回退均保护期间出现的新引导文件

准备及回退先读取引导文件，随后可能等待服务启动项或客户 API 操作；旧代码最后可能用早先读到的内容覆盖期间出现的新修改。两条路径均已用本地临时文件及延迟写入夹具复现。

现在在实际替换引导文件前重新读取受保护路径，核对当前内容属于本请求原始/目标摘要且权限仍为原值。发现新内容或权限变化时保留新文件及未完成记录，不标准备/回退成功。既有 `0700` GRUB 权限保留及原内容幂等恢复继续通过。此检查关闭已复现的耗时窗口，不承诺任意外部 root 写入与文件替换之间完全不存在竞态。

失败证据：`logs/hardening41-python-before.log`、`logs/hardening41-python-edge-before.log`。修后：`logs/hardening41-python-plan.log`。

## 本地验证

以下进程均自然 exit 0，最终日志及文件摘要已归档：

| 检查 | 本地证据 |
| --- | --- |
| 客户恢复完整专项（真实 PostgreSQL、固定证书 mTLS） | `logs/hardening41-customer-boot-recovery.log` |
| 主控维护专项（真实 PostgreSQL、远端协议/时钟夹具） | `logs/hardening41-host-security-maintenance.log` |
| 安全加固守卫（包括 Python 执行器测试） | `logs/hardening41-security-hardening-guards.log` |
| 持久自动加固队列专项（真实 PostgreSQL） | `logs/hardening41-security-hardening-queue.log` |
| Python 维护计划18项测试 | `logs/hardening41-python-plan.log` |
| 后端类型检查、构建 | `logs/hardening41-server-types.log`、`logs/hardening41-server-build.log` |
| diff 空白检查 | `logs/hardening41-diff-check.log` |

数据库启动器限定本机 loopback 独立 `_pool_test` 数据库；没有使用生产执行器。新断言加入现有专项，没有新增测试入口；未重复全部守卫或前端构建，本轮没有新增 UI 修改。回归过程中修正过两个夹具问题：依赖模拟器未接收新增 callback、协调器类型测试被预设的 AppArmor 失败先行挡住。两个失败日志单独保留，不当作产品故障或通过证据。

原权限撤销/恢复保护、单次重启、丢准备/开机/恢复回执续接、最新停删/到期意图、原停机/暂停客户保持停止、原身份/密码/网络与失败预算保护仍通过。前轮未受影响的 SSH、IP、补续及交付专项仅沿用原证据，没有冒称本轮重新执行。

## 尚未验收的范围

本次只有本机源码和隔离验证，未重新做原生内核/引导、真实宿主重启、客户公网或新安装包验收。远端 shell、内核与 Incus 启动使用明确的测试替身，不能等同真机成功。原生放行列表仍只有 `alpine-apparmor-grub-v1:x86_64`；ARM64/Extlinux/VM/Frozen/救援未扩大。此前28台 AMD64 生产结果只属于此前已部署补丁，不能覆盖本轮新增修改。真实 OSS 全新 B 灾备、独立备用及千台72小时保持独立待验收。
