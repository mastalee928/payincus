# 内置 Debian 11 镜像替换（候选）

Owner提供xkatld/zjmf-lxd-server两份Debian11容器资产，要求修好后替代旧失效官方源，并随安装包内置，避免每次在线获取。已下载核GitHub资产hash、真实ELF/metadata架构和Debian11系统。原包没有cloud-init/templates，带有固定SSH主机密钥和machine-id，不可直接作为平台客户云镜像交付。

- AMD64原包：128196729 bytes，SHA256 `7343b1d120bfadde3888c221d959501b9991ffaea81e60f977555c94775ab463`。
- ARM64原包：126189063 bytes，SHA256 `54fb35a5532b1c17c3102237b31fa4086166f09339aa723f44d8ed0846864831`。

构建阶段固定下载/验hash、流式转换，移除预置SSH主机密钥和machine-id、锁原账户密码，保留原Debian服务文件UID/GID，加入平台首次启动cloud-init引导和NoCloud模板。两种架构同时放`server/images/`，带构建manifest；发行实际tar守卫逐文件核内置镜像。大二进制为构建产物，原包保存在构建cache，不写普通Git。

运行阶段仅核本地包manifest/hash，按目标宿主真实架构经原mTLS二进制导入Incus。首次导入后缓存复用，缓存不存在从主控内置文件再次导入；无GitHub或其它远端下载回退。原`images:debian/11/cloud`及ARM别名/ID继续使用，拦截旧远端源为本地fingerprint，不删原镜像数据库记录/白名单/已有实例或历史账务。两份仅容器镜像，VM不可用。

重装先验证并导入镜像再清快照/修改磁盘；使用本地镜像属性，不再请求失效官方别名。新镜像自己的cloud-init disable marker由首次安装器持有，正常平台初始化完成、密码/SSH/网络验收成功才交付，不标手工完成。后续停启和重启不重跑初装，不清客户数据。

当前本地固定原hash/转换/两实际tar、mTLS大文件导入并发/缓存复用测试通过，测试禁全部fetch验证运行无下载；对应类型、镜像/实例初始化/冲突守卫通过，原双架构参数化PG/mTLS重装回归92场景及6次新同意重装通过。完整219、双架构真实Debian11开通/重装/停启/重启、候选首装/旧升级/包验签及目标主控热更新实证仍待。正式发行继续暂停，不能将基本格式兼容当作上线成功。
