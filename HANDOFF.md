# 版本与验证记录

维护仓库：[mastalee928/payincus](https://github.com/mastalee928/payincus)。GitHub Fork 关系已于 2026-10-16 解除；仓库地址和提交历史保留。原 BSD 3-Clause 许可证与版权声明继续保留在 LICENSE。

## 当前源码与发布状态

- 面板 [v1.6.1](https://github.com/mastalee928/payincus/releases/tag/v1.6.1) 与 [Agent v1.0.2](https://github.com/mastalee928/payincus/releases/tag/agent-v1.0.2) 已发布。面板发行源码为 `737c6863a36c436de8f9071e1831015f285b872b`；后续 main 提交不改变已发布标签或安装包。
- 此前 GitHub main 停留在 b140752，后续功能只在维护者工作区及测试主控直接部署。`429e858` 已补齐完整功能，后续提交修复全新安装验证中发现的问题。
- 源码包括机器池、定价、购物车、一机一卖、Alpine 接入、1 GiB swap、WireGuard 管理、全端口 TCP/TCP+UDP、故障换机、公网 IPv4 自动同步及用户/管理员 PUSH。
- 安装器、OTA、Agent、文档和问题反馈均使用本仓库。新安装增加管理网关配置，发行包包含完整迁移、探测、网络、swap 与网关脚本。
- 本地类型检查及全套配置测试已逐项通过；安装器、仓库来源、部署配置、OTA 与网关参数守卫通过。Lint 无错误，保留已有样式警告；文档构建通过。
- [正式发布工作流](https://github.com/mastalee928/payincus/actions/runs/38789679660) 全部成功：Ubuntu 24.04 amd64 / arm64 分别构建并从真实发行包全新安装，通过 207 条数据库迁移、唯一后端启动、双端访问、管理员登录、机器池 API 与固定主机指纹 SSH 网关验证。
- 已实际下载两种架构的公开安装包，确认 SHA256、文件大小、OTA manifest、包内版本与 Git 提交一致；包内 LICENSE 与发行源码原文一致。GitHub 的面板 latest 为 v1.6.1。
- [源码 CI](https://github.com/mastalee928/payincus/actions/runs/38788543345)、[Agent 发布](https://github.com/mastalee928/payincus/actions/runs/38783090823) 均通过；[本仓库文档站](https://mastalee928.github.io/payincus/) 已上线。

## 2026-10-16 首页与选购界面源码

- 首页使用真实机器池商品目录，展示国旗、资源、月价和库存；公共购买入口统一为“购买主机”。选购页保留完整 45 个区域，售罄和未上架区域标灰。
- 新增可复用的入场、筛选和加购反馈组件，支持减少动态。Vue Bits 的 AnimatedContent 适配使用现有 GSAP；来源与许可保存在 `client/public/THIRD_PARTY_NOTICES.md`。支付、库存和实例交付逻辑未改动。
- 本地 client/server 类型检查、前端路由守卫、三语 key 与 23,540 条文案编译、机器池守卫、双端构建及 dist 边界守卫通过。隔离浏览器已验证商品预选、多台加购、登录返回、售罄、空目录、失败重试、三语、深浅色、手机布局和减少动态。
- 此节记录 main 源码与本地验收；上述稳定 Release 尚未包含本次界面更新。测试主控静态更新的备份与浏览器实证另存内部记录。

## 测试主控的既有证据

维护者测试主控使用 v1.6.1-preview.3 直接部署，尚未由本轮操作切换到稳定 Release。普通用户余额购买、公网密码 SSH、TCP/UDP 切换、两台 Alpine 无备份故障换机、故障隔离恢复、公网 IPv4 更换与同步，以及用户和管理员 PUSH 已完成测试。隔离 PostgreSQL 数据库另有库存、扣费、任务租约、换机和权限测试。

本轮已将该主控的面板与 Agent 更新源切换到本仓库，并清空临时 Agent 目录覆盖。主控从 GitHub 下载的两种 Agent、实际提供的 Agent manifest 与二进制下载均已核对 SHA256；唯一后端及双端健康检查正常。此项验证不代表主控已 OTA 至稳定面板版本。

外部支付、客户公网 IPv6、异地备份恢复不在这次真机验收范围。无备份换机不会恢复旧磁盘；旧机完全失联时需由运维在云厂商侧隔离，系统不能保证远端旧实例已经停止。

实际主控地址、测试账号、备份路径与逐步验收记录保存在维护者工作区内部文档中，不随公开源码发布。上游历史运行记录已归档，不代表本仓库当前生产状态。

## 继续维护

先读 AGENTS.md 与 [操作手册](OPERATIONS_HANDOFF.md)。每次发布必须分别记录源码提交、本地检查、Actions、Release 资产、安装验证及线上验收。功能说明见 [机器池文档](docs/host-pool.md)，发布步骤见 [安装与发布](docs/fork-release.md)。
