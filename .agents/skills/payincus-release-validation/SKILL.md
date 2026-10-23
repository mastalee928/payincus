---
name: payincus-release-validation
description: 排查和验证 PayIncus 的 GitHub 双架构发行预览、全新安装及备份恢复失败，区分源码、安装包、恢复演练和线上证据。用于发版前检查或收到 Actions 失败通知时；不替代完整网关灾备验收。
---

# PayIncus 双架构发版验证

先定位当前 PayIncus 仓库根，读取 `AGENTS.md`、`OPERATIONS_HANDOFF.md` 和 `HANDOFF.md`。它们决定运维事实和授权边界。本 skill 不授予 commit、push、tag、Release、OTA 或测试机故障注入权限；使用当前会话已有授权，缺少授权时先把改动和验证做到可审查。

## 按当前证据推进

1. 核对 `git status --short` 和 `git log`，保留无关改动。确认本次工作流的完整 `headSha`，不要根据邮件标题或旧运行结论猜测。
2. 查看具体运行的 job/step；失败时读取该运行日志。优先用固定 job ID 和终态结论，观察超时不等于任务停止，不因观察超时自动重跑。
3. 将失败定位到构建、验签、首装、服务启动、备份、恢复、数据完整性或跨版本迁移中的具体步骤。必要时读取实际 artifact 的文件和元数据；源码构建成功不能证明首装或恢复通过。
4. 根据实际日志在本地或已授权隔离 Linux 环境复现，只改根因相关代码。权限、支付、交付、OTA 等领域按仓库要求先读代码与守卫。对签名包保持目录/文件/权限/身份检查，不能为使测试变绿放宽信任。
5. 跑相关 type-check、守卫和构建。前端变更另跑路由/i18n/双端构建和真实浏览器。Linux 权限、systemd、OpenRC、WireGuard 及实际数据库迁移需对应运行证据，Windows 的语法检查或夹具不能替代。
6. 按已授权范围提交推送已验证阶段，并在同一提交运行预览。新的失败步骤是继续排查的证据；同一未改变根因或输入的失败不要无依据重复运行。所有本次必需 job 成功后才报告预览通过，预览 Release job 的预期 skipped 不等于发布。
7. 在 `HANDOFF.md` 分别记录源码提交、测试、Actions/首装、资产、云端实证和目标主控验收。工程进行中同步 `GATEWAY_PROGRESS.md` 的实际缺口，不能根据提交数、测试数量或阶段内通过项宣布整个 P0–P6/AC01–AC34 完成。

常用只读命令：

```text
gh run view <run-id> --json status,conclusion,headSha,url,jobs
gh run view <run-id> --log-failed
gh api repos/<owner>/<repo>/actions/runs/<run-id>/artifacts
node scripts/run-tests.mjs --check
node scripts/run-tests.mjs --only <相关守卫关键字>
```

日志先在本地检查和脱敏，再摘录。不要将 `.env`、完整私钥、SSH 密码、API token、cookie、签名凭据或临时下载 URL 写入 skill、台账、提交或截图。

## 证据范围

| 证据 | 能证明的范围 |
|---|---|
| 本地守卫/类型检查 | 对应源码约束与测试场景 |
| 源码 CI / 原生组件构建 | 该提交的源码与组件包检查 |
| AMD64、ARM64 实际首装及恢复演练 | 同提交 artifact 在对应一次性机器上的安装和演练 |
| Release/tag/校验资产 | 实际发行身份、来源与可下载内容 |
| 授权目标主控 OTA / 浏览器 / 宿主流程 | 该目标已部署且受影响流程实际通过 |
| 独立 OSS / 故障切换 / 72 小时验收 | 各自真实场景，不能由本地存储夹具或短时断网替代 |

遇到权限、sudo、预览备份或迁移失败时，按需读 [首装故障案例](references/fresh-install-failures.md)。它记录已实证的模式；症状相似仍须核对当前版本和环境。

## 仓库里最容易忽略的条件

- 私有业务后端必须单实例。测试网关/见证可以独立运行，不能为验证启动第二个业务后端。
- `pnpm test` 使用逐条 spawn 清单；`--check` 只校验清单。不要用超长 `&&` 命令或不可靠的 shell 退出码当作全量证据。
- 预览无 tag 时不会发布 Release。触发新预览可复用已明确授权；正式 tag、Release 和目标机器部署按会话授权与实际门槛执行。
- 支持新预览归档不等于支持任意历史预览跨提交恢复；完整灾备还要保存原身份、核对较新撤销/账目并完成宿主重连。

已验证的案例基线：2026-10-23，源码 `7dd0887e80fc8d6317bf456f699e6f142c4eb94d`，[预览 39952149465](https://github.com/mastalee928/payincus/actions/runs/39952149465) 的双构建、双首装全部 success，Release 预期 skipped。它不是当前运行结果，也不是正式发行或完整灾备完成证明；使用 skill 时重新读取最新证据。
