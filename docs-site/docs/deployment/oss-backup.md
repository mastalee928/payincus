# 阿里云 OSS 平台备份

管理员后台「系统」分组的 OAuth 下方提供「阿里云OSS」。平台备份包含完整数据库、机器池分组和已接入宿主的登记信息、运行环境、受管证书，以及本机管理网关的 WireGuard/SSH 身份与节点地址登记。

客户 VPS 磁盘、远端独立网关文件、外部图床及邮箱原件需另行保护。换 IP 后的 WireGuard 自动重连不在当前范围内。

## 安装要求

要求标准 `/opt/incudal` Linux/systemd 部署、本机 PostgreSQL、非超级用户的应用数据库角色及同大版本 `pg_dump`/`pg_restore`。恢复另需本机 postgres peer 管理通道。私有后端仍只能运行一个实例。

新安装会安装备份执行器。**从旧版升级时须检查执行器是否存在**：旧 OTA worker 未必会执行新版新增的安装步骤。需要补装时，在经授权的维护窗口、确认运行的是已验证发行源码后执行：

```bash
# 原子布局
sudo bash /opt/incudal/current/scripts/install-platform-backup.sh

# 旧平铺布局使用 /opt/incudal/scripts/install-platform-backup.sh
```

脚本安装 `incudal-platform-backup@.service`、受限 sudo wrapper、状态目录和后端 drop-in；不会额外启动 API 实例。备份和 systemd OTA 共用维护锁，不能同时执行。不要绕过帮助程序并行维护数据库、轮换密钥或替换受管文件。

## 配置与备份

1. 准备专用 RAM 凭据、私有 Standard 桶和独立备份密码。当前严格保留策略拒绝启用/曾启用版本控制、WORM 或启用生命周期规则的桶。
2. 填写区域、桶名、目录和凭据，先保持定时备份关闭并保存；已有秘密字段留空表示保持。
3. 测试连接会验证桶条件，并执行探测对象写入、读取和删除。确认成功后再开启自动备份。
4. 上传周期可选 1/3/6/12/24/72 小时，保留最新 1/3/5 份。新包回读校验后才标记完成并清理旧备份。

默认仅用户名为 `admin` 的管理员可管理备份。需授权其他管理员时，由维护者设置 `PLATFORM_BACKUP_ALLOWED_ADMIN_IDS` 为明确的正整数 ID 列表。演示环境不开放备份管理。

最小 RAM 权限按能力拆分：列桶、新建/删除桶、桶地域/ACL/版本控制/WORM/生命周期读取，以及专用前缀内对象读写、删除、分片上传和清理。没有列桶权限时可手动填写已授权桶名。应在专用测试桶核验实际权限，不要求默认授予整个账号 OSS 全权限。

密码须另行安全保存，旧包仍需要其原密码。当前包采用 scrypt 与 AES-256-GCM，单包上限 32 GiB；只有完整认证通过才会提取。平台运行配置中的秘密也加密保存，网页不回传秘密原文或密文。

## 从备份恢复

1. 隔离旧主控，准备相同应用版本、迁移历史、PostgreSQL 大版本的目标安装。数据库损坏时先保留原数据，再准备可用的同版本目标库；本功能不修复数据库集群。
2. 新机配置可访问原桶的凭据，填写原安装前缀查找备份。系统不会自动接管原安装的备份清理命名空间。
3. 输入原密码执行恢复预检，下载认证后在隔离数据库实际还原。预检有效期 15 分钟，绑定发起管理员。
4. 输入页面显示的 `RESTORE <预检ID>` 确认。系统设置数据库外的持久化恢复保护，停止后端，切换数据库和受管文件，再启动受保护的唯一后端。
5. 保护期内业务、Agent、回调、WebSocket 和后台业务任务暂停；旧会话/API 凭据失效，待处理任务和机器池库存需核对。管理员密码登录及必要验证码配置仍可用。
6. 核对真实支付、宿主、实例、库存、权限与任务后，输入 `RESUME AFTER RECONCILIATION` 恢复运营。需要回退时，在保护仍有效期间使用 `ROLLBACK RESTORE`；回退后仍保持保护。

恢复 `.env` 时自动合并原 `ENCRYPTION_KEY`，保留目标机数据库连接、JWT 身份和运行控制。其余原配置保存在私有归档中供人工映射。换 IP 时须核对域名、第三方回调/白名单、网关指纹及节点 Endpoint，不能假定恢复数据库便会自动连通宿主。

恢复与回退均关闭备份调度并清除测试状态，需重新测试后显式开启。回退数据库与私有证据不自动删除，由维护者验收后决定清理；不要直接删保护标记。

## 后台无法登录时

root 可使用命令行入口，参数不携带凭据。例如原子布局读取任务状态：

```bash
sudo env NODE_ENV=production ENV_FILE=/opt/incudal/.env \
  /usr/bin/node /opt/incudal/current/server/dist/scripts/platform-backup-cli.js status
```

平铺布局去掉路径中的 `current/`。其他命令从标准输入读取 JSON，秘密使用 root 0600 的本地输入文件，不写到 shell 历史、工单或聊天中。

| 命令 | 输入字段 |
| --- | --- |
| `configure` | region、bucket、prefix、accessKeyId、accessKeySecret、backupPassword、intervalHours、retention；保存后保持调度关闭 |
| `backup` | 无 |
| `preview` | prefix、password |
| `restore` | previewId、confirmation（`RESTORE <previewId>`） |
| `rollback` | confirmation（`ROLLBACK RESTORE`） |
| `resume` | confirmation（`RESUME AFTER RECONCILIATION`） |

CLI 预检只能由 CLI 确认恢复。状态目录为 `/var/lib/incudal-backup`，其中 `private` 仅 root 可读，包含明文恢复暂存、回退文件及 journal，禁止公开。

## 验证范围

本地测试覆盖配置、加密、错误密码、篡改、文件边界、保留策略和已安装 SDK 的真实上传代码路径；HTTP 边界使用替身。发布 CI 在一次性 Linux 主控上检查数据库、systemd、恢复保护、回退及主密钥一致性，OSS 存储使用本地文件替身。

**真实阿里云 OSS RAM 权限、上传与云端故障清理仍需专用测试桶验收。** 首次正式启用前应完成真实备份和恢复演练，不能把 CI、本地测试或 GitHub 发版等同于生产主控已验证。
