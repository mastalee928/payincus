# 首装故障案例：2026-10-23

以下路径均相对当前 PayIncus 仓库根。案例用于缩小排查范围，不能直接证明新环境有同一根因。

## 签名组件权限与来源

症状：组件构建通过，root staging 后 `GATEWAY_PACKAGE_REJECTED`。

`scripts/verify-gateway-component-package.py` 按固定清单核对文件哈希、模式、属主、完整路径与 ELF 架构。严格 umask077 下普通 `cp -R` 可把签名文件模式改窄；本次修复使用 `cp -R --preserve=mode --no-preserve=ownership`，目的地仍由 root 创建并校验。构建器也显式设置最终模式。不要补写 manifest 来适配损坏文件、从待安装包自行信任公钥，或允许额外文件。

Python 导入可能留下 `__pycache__`，严格包覆盖检查会拒绝。受信包执行使用 `-I -B` 并禁止导入生成字节码。重新验签实际目标目录，不能只检查源包。相关守卫：`test-gateway-component-package.py`、`test-gateway-controller-provisioning.py` 和 `test:gateway-task-guards`。

## 受信父目录

症状：两种首装都在 `release-directory` 阶段拒绝，而实际包在 `/root` 下验签通过。

运行 39947515057 的非敏感元数据确认：两个 GitHub runner 的 `/opt` 是 root:root/0777，父路径可被其他用户写，`enrollment.directory()` 正确拒绝。`scripts/smoke-fresh-install.sh` 限定一次性 GitHub-hosted、root、没有既有 `/opt/incudal`；在这个范围内核验 `/opt` 非链接且 root 所有，再 `chmod go-w /opt`。

仅调整已授权测试环境。不能把该命令照搬到未知生产机，或让生产验证器接受可写父目录。取证只输出固定路径的 uid/gid/mode/nlink/size/是否链接；不输出文件内容或异常里的秘密。

## sudo 解析差异

症状：新版 sudo parser 报 `wildcards are not allowed in command arguments` 或 `unknown setting: requiretty`。

本仓库使用 root 固定 `/usr/local/libexec/incudal/systemctl` wrapper。它只允许三个参数：`start`、`--no-block`、固定管理任务模板的合法 ID。实际 root worker 仍验证源码封存与操作互斥。

将 sudoers 授权限定到这个 wrapper 路径，保留精确参数/模板/ID验证；不授权 `/usr/bin/systemctl` 或任意 shell。网关安装前核对 wrapper 属主模式、不可写父目录和受信源码逐字节一致。网关、备份、OTA及原子布局迁移不能残留 parser 不兼容的 wildcard 规则。`requiretty` 在本项目不是必要安全配置，已移除可选设置。

验证应包括 `visudo -cf`、真实服务用户调用合法任务、错误服务/动作/额外参数/通配符拒绝，并跑安装、OTA、部署和备份守卫。固定 systemctl 替身只能证明 sudo/参数入口，真实 worker/systemd 结果另有证据。

## preview 版号与备份归档

症状：首装和登录通过，备份报 `OSS_ARCHIVE_INVALID`，运行版本为 `preview-<commit>`。

`platform-backup-compatibility.ts` 已允许同提交 preview 恢复，而 `platform-backup-archive.ts` 曾只接受数字版本，导致归档在生成时失败。允许严格 `preview-[a-f0-9]{7,40}` manifest，保留其它格式/路径/哈希/大小/认证检查。

新增回归证明合法 preview 可以实际加密→认证解密→读取相同 manifest；过短、非十六进制、超长 preview 拒绝。`assertBackupVersion` 仍拒绝不同 preview 以及 preview 与稳定版本互换。不要把该修复变成任意版本兼容开关。相关入口：`test:platform-backup-guards`、`smoke-platform-backup.mjs`。

## 跨版本迁移夹具权限

症状：备份、恢复、ZIP完整性都通过，`smoke-platform-backup-compatibility.mjs` 的首次 Prisma 迁移报 `OSS_BACKUP_MIGRATION_FAILED`。

首装 runner 使用 umask077。兼容演练在临时目录创建受信 migration/Prisma夹具，但 `migrateBackupDatabase()` 以 incudal 用户执行，未显式设置模式的目录/文件不可读。

只将该无密钥临时应用夹具目录设0755、普通文件0644，跳过既有 node_modules 链接；独立数据库名与清理路径限制保持。不要改生产迁移用户为 root、扩大线上 `.env`/密钥权限或运行备份里携带的迁移脚本。

在实际 umask077、真实 PostgreSQL 与 incudal 运行身份下复验：旧版本/已核实 CRLF历史升级、金额精度保持；新于目标的备份、PG大版本不符、结构漂移、目标变化及未知迁移 checksum 均拒绝。该测试不切换业务数据库。

## CI 提供 token 但新装后台仍走匿名请求

2026-10-24 预览40058665238：双构建和ARM64首装成功，AMD64首装的公开Agent清单断言404；日志确认GitHub匿名403限流。工作流已传INCUDAL_AGENT_RELEASE_TOKEN，但安装器新建.env的heredoc固定写空值；只有既有.env路径调用补齐逻辑。修正初始生成读取显式提供值，并在首装smoke请求Agent之前检查环境文件及实际唯一后端进程收到该值。

断言只输出布尔结果/固定说明，不把token作为assert.equal的actual/expected打印。保持公开Agent、版本、双架构大小/hash和原生运行验收，不用本地替身或取消断言来消除失败。新装/非空保留/空值补齐/无提供值/不记录token需分别验证；Linux的root:incudal/0640及真实systemd服务用户接收与Windows静态测试分开。不要仅根据403认定是同一问题：有token时也可能被上游限流，先核对实际进程环境。

## 成功记录的边界

`7dd0887e80fc8d6317bf456f699e6f142c4eb94d` 的预览 [39952149465](https://github.com/mastalee928/payincus/actions/runs/39952149465) 通过 AMD64/ARM64 构建、全新安装、唯一后台/双端登录/机器池/Agent、身份登记、备份预检/恢复/回滚/续跑、完整数据库/ZIP和迁移兼容检查。OSS transport 在首装演练中使用本地替身；真实云OSS、DNS换机、主备写者隔离和72小时离线要求分别验收。

这次预览的 Release job 是 skipped，没有通过它发布正式版本。原失败运行保留在 `HANDOFF.md`；新的运行以当前 job结论、提交和实际 artifact 为准。
