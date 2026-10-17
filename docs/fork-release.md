# 安装与发布

维护仓库为 `mastalee928/payincus`。该仓库已解除 GitHub Fork 关系，独立开发、发布和部署；引入外部改动仍需经过审查和测试。原 BSD 3-Clause 许可证及版权声明继续保留，发行包携带 `LICENSE`。

## 发布来源

| 用途 | 来源 |
| --- | --- |
| 源码与问题跟踪 | `https://github.com/mastalee928/payincus` |
| 新安装脚本 | `https://raw.githubusercontent.com/mastalee928/payincus/main/scripts/install-panel.sh` |
| 面板发行包与 OTA manifest | 本仓库 `v*` Release |
| 宿主机 Agent | 本仓库 `agent-v*` Release |

本仓库的安装器、后端默认配置、部署模板和文档均使用以上仓库。既有主控的 `.env` 不会因更新源码自动改变，需明确设置：

```dotenv
SYSTEM_UPDATE_RELEASE_REPOSITORY=mastalee928/payincus
INCUDAL_AGENT_RELEASE_REPOSITORY=mastalee928/payincus
```

生产服务保持单个后端进程。先备份数据库、配置与证书，再更新。修改仓库地址不会生成发行包；没有可用 Release 时，新安装和在线更新不能完成。

## 发布流程

1. 在本仓库开发并完成类型检查、相关守卫、全套测试和双端构建。新交付流程还需在测试宿主机验收。
2. 将经过审查的代码提交并推送到本仓库。如果本次修改 Agent，同步提高 `agent/VERSION`，等待 `Agent Build & Release` 测试、构建和发布成功；只改代码而不修改版本不会自动发布 Agent。首次或补发可手动运行该工作流并勾选 `publish_release`。
3. 再手动运行 `Build & Release` 做预览构建与全新安装验证。推送 `vX.Y.Z` 标签后，同一工作流分别在 Linux amd64 / arm64 构建并安装；两种架构全部通过后，才发布发行包、SHA256 校验文件和 OTA manifest。安装验收检查源码版本、全部迁移及 IPv6 数据字段，并通过新装面板的默认更新源下载两种架构的正式 Agent，校验版本、大小和 SHA256，执行本机架构二进制确认包含 IPv6 能力。不能用工作区的临时 Agent 替代正式资产。
4. 确认两种架构资产齐全、校验通过后再更新主控。Agent Release 不占用面板的 `latest` 标记。
5. 更新后验证主控健康状态、用户端与管理端、安装脚本、Agent 心跳，以及这次变更涉及的业务流程。

首次迁移或验收可以使用从本仓库构建、带校验清单的本地 Agent 目录（`INCUDAL_AGENT_RELEASE_DIR`）。这属于临时部署方式；切换到 GitHub 发布后应清空该覆盖配置，并再次验证 Agent manifest 和下载。

`HANDOFF.md` 记录当前源码、发行与主控验证状态。上游历史运行记录已归档，不能用来证明本仓库的 Actions、Release 或当前主控已经验证。2026-10-15 已完成直接部署及双机换机验收，详细运行证据另存于维护者工作区内部，不随公开发行包发布。

## 已发布版本

- 面板 [v1.6.3](https://github.com/mastalee928/payincus/releases/tag/v1.6.3)，发行源码 `f8d2ca450e01a10a54ae5f57b75e4f80821371dd`，已设为面板 latest。修复后台在线更新任务未能启动时的失败可见性与阻塞问题（含可取消未启动任务），并包含购物车与开通结果页界面精修、实例高级配置仅限管理员。
- 面板 [v1.6.2](https://github.com/mastalee928/payincus/releases/tag/v1.6.2)，发行源码 `2b81ce66e99c0941df8f579f085be59ce909541f`，已设为面板 latest。包含多 IPv6、首页与 45 区域选购、购物车及 UPAY Pro 更新。
- [正式发布工作流](https://github.com/mastalee928/payincus/actions/runs/38878414833) 已完成 Linux amd64 / arm64 的构建与全新安装验证，包含 209 条数据库迁移、IPv6 数据字段、唯一后端、双端访问、管理员登录、机器池 API、SSH 管理网关及正式 Agent 下载和执行。
- 公开安装包的实际 SHA256、大小、OTA manifest、版本与源码提交均已核对；两种架构均携带原 LICENSE。
- [Agent v1.0.3](https://github.com/mastalee928/payincus/releases/tag/agent-v1.0.3) 已发布，包含 Linux amd64 / arm64 二进制。发布前通过 Go 测试及真实隔离网络中的双 IPv6 数据包、协议限制、地址变更与恢复验收；不占用面板 latest。

新安装使用 README 的一键安装命令即可获取本仓库最新稳定发行包。已确认测试主控的“运维—版本更新”能发现 `v1.6.3` 并完成升级（主控现运行 `v1.6.3`）；现有面板的运行版本以实际部署为准（本次已确认主控运行 v1.6.3）。两台测试宿主已自动升级到正式 Agent `v1.0.3`，心跳、IPv6 和端口策略正常。
