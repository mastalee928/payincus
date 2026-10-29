# 本地样例数据

`server` 的 `seed:test-data` 和 `seed:bulk-local-data` 会创建并更新样例账号、宿主和套餐；批量脚本还会覆盖样例实例、账目等数据。仅用于可丢弃的专用数据库，不在普通开发库、生产库或恢复库执行。

两脚本必须同时满足以下条件，否则在加载数据库模块之前退出：

- 明确设置 `NODE_ENV=test` 或 `development`。
- 明确设置 `ALLOW_LOCAL_SAMPLE_SEED=1`。
- `DATABASE_URL` 使用 PostgreSQL，主机为 `127.0.0.1`、`localhost` 或 `::1`。
- 数据库名为小写字母开头，仅含小写字母、数字和下划线，最多63字符，并以 `_seed_test` 结尾，例如 `incudal_seed_test`。
- 连接URL不含查询参数或片段，避免连接参数覆盖已检查的目标。

先在该专用库完成对应数据库初始化，再执行 `pnpm --filter server seed:test-data` 或 `pnpm --filter server seed:bulk-local-data`。连接凭据通过本地环境注入，不写入公开命令记录。旧 `FORCE_BULK_SEED` 不再绕过检查；远程测试机器需要在那台机器本地连接其专用库。

样例账号使用源码中的固定测试密码，不能投入运营或暴露给客户。`seed:test-data` 会更新名为 `admin` 的测试账号的邮箱、角色与状态；普通管理员和现有业务数据必须放在其他数据库。环境门禁不代替数据库隔离和备份。
