# v1.8.3 修复与发行验证

状态：**已正式发行，发行核验完成**。[v1.8.3 Release](https://github.com/mastalee928/payincus/releases/tag/v1.8.3) 于 `2026-11-04T21:27:53Z` 公开发布，非草稿、非预发行；核验时 panel latest 为 v1.8.3。候选和 main CI 各十个 job、预览四个必需 job、正式构建/首装/发布五个 job 均已终态通过，六项公开资产已实际下载核验。本次未代做生产升级或解除隔离，生产受影响流程仍须按[网页检查指南](release-v1.8.3-owner-click-test.md)验收。

## 正式来源与运行

- 完整源码：`1ac022b567ee959d0d44df70462c73e9683f08d6`。
- 源码 tree：`c75c12e4313dba81d1b17a29f8c5b95c12fec09b`。
- main 从 `6ddd67d8c38099f5c29aebd890c131bea6113b02` 精确非 force 快进；[PR #5](https://github.com/mastalee928/payincus/pull/5) 于 `2026-11-04T21:16:01Z` 合并，mergeCommit 同完整源码。
- 注释 tag `v1.8.3` 对象：`bc0639ba9ece29ce334c7ed56cfc6c8a345a7926`，解引用同完整源码。后续文档提交不改变 tag、安装包或源码来源。

| 运行 | 终态与实际来源 |
|---|---|
| [候选 CI 41894899709](https://github.com/mastalee928/payincus/actions/runs/41894899709) | 十个 job success；实际 PR checkout `df33a8fc35f3c0c18d58f8593c04d2d1ba456f73`，独立核 tree 与正式源码一致 |
| [双架构预览 41894888749](https://github.com/mastalee928/payincus/actions/runs/41894888749) | 四个必需 job success，Release 预期 skipped；实际 checkout 同完整源码 |
| [main CI 41914468073](https://github.com/mastalee928/payincus/actions/runs/41914468073) | 十个 job 全部 success；每个实际 checkout 同完整源码，最终日志于 `2026-11-04T23:09:02Z` 核验 |
| [正式 Build & Release 41914476956](https://github.com/mastalee928/payincus/actions/runs/41914476956) | 双构建、双原生首装和发布共五个 job success；每个实际 checkout 同完整源码 |

最后按完整 SHA 发现的关联运行仅上述四项，全部终态 success，无新增 Agent/Pages 运行或未处理发行失败。候选、预览、正式、main 逐 job 原始日志及摘要均已归档；预览没有代替正式首装。

候选与 main 的 Pool 综合 job 均核步骤16、58、78–81、90，以及本批二次隔离、真实 PostgreSQL 转移竞争/耗尽续接、管理员字段隔离、完整 App 和三语实际触摸日志。旧候选 `2a7f80ff` 的 CI41887788857 唯一 step99 触摸断言失败保留历史；最新提交仅改测试定位与输入稳定，保留44px、三语真实触摸及全部业务断言，候选与 main 均通过。原用例本机也曾自然通过，不能由旧失败推断产品触控故障或确定 Linux 调度原因。

正式双架构首装独立核209条完整守卫清单、240项迁移、唯一后台、双前端、管理员登录和公开 Agent 下载；备份预检、原数据库/网关身份还原、改变后回退续接、SQL/ZIP/ZIP64完整性通过。金融值、数组边界、序列、大对象损坏、缺表、未知迁移校验和、较新备份、PostgreSQL版本/目标变化等拒绝条件及旧版CRLF迁移均通过。OSS传输使用一次性虚拟机上的本地替身，不含客户宿主。

## 六项公开资产

六项均实际下载，独立 SHA256 和字节大小与 GitHub API digest/size 一致；两份 OTA manifest 字节相同，架构、下载 URL、包大小/hash 均与实际 tar 对应。

| 资产 | 字节 | SHA256 |
|---|---:|---|
| `incudal-v1.8.3-linux-amd64.tar.gz` | 214176614 | `b6ead81c50180d5d84f11e4aff5e08b4b850f0637fd1fe0574215fc57568246e` |
| `incudal-v1.8.3-linux-amd64.tar.gz.sha256` | 100 | `f8e8b3a3f982ae71345e2df7da9e2865d6eaba5fcc6bae76fa920496fd1a27eb` |
| `incudal-v1.8.3-linux-arm64.tar.gz` | 213431430 | `9b67415d0b83317446e6c384a131a95071b6aa41d77703271d0e0c05e05dce9b` |
| `incudal-v1.8.3-linux-arm64.tar.gz.sha256` | 100 | `18052576f3e16d227280f9020b61184fa3ac66034fb3c32f7a9237e165583f2c` |
| `incudal-v1.8.3-ota-manifest.json` | 997 | `71d270e9d4df3903b5b1208a6209f5af91227d0d18d374148a2f20589ea8d2a1` |
| `ota-manifest.json` | 997 | `71d270e9d4df3903b5b1208a6209f5af91227d0d18d374148a2f20589ea8d2a1` |

双 tar 已核包内版本1.8.3、240迁移、LICENSE、root归属、安全路径、原生依赖架构、隔离/转移及 worker 修复编译文件；用户/管理员前端的首页高度、InfoHint、品牌副标题、余额、activeTransfer、OCI账号与公网地址编译标记均存在。

每包包含 AMD64/ARM64 两套网关组件。独立使用 v1.8.2 沿用的原受信 Ed25519 公钥验签，公钥文件 SHA256 为 `283cf89274107ad3ae2ef546f7b26197f12ada4a06948700759d58b97a2eed76`；未从新包学习信任。各组件20个文件的 hash/大小/权限/ELF架构和完整文件集合均核验，catalog 与签名 payload 的完整 sourceCommit 同正式源码。version.json/OTA 的12位提交由完整来源独立核对。

Release说明更新后回读一致，六资产元数据未变、latest=v1.8.3。Agent继续v1.0.4：原 tag 来源 `76e779df77e52cbe96ee2e103d57dd951dba4e1e`、tree `359dcf6657f8666e1274a2b21bc556c2dbf28270`，三公开资产 hash/大小/更新时间与原实际下载基线一致，没有移动或重发。

完整本地证据为 ignored `logs/release-v1.8.3-{candidate-ci,preview,formal,main-ci,panel-assets,public-release,agent-after-main}-verified.json` 及对应原日志。公开记录不包含运行凭据或生产备份。

## 修复

- 清理done后再次隔离：新只读身份/库存核验周期，扫描和原重试入口都能续接；不携带旧删除授权，保留未知残留、客户、原身份和保留数据策略。失败开通首次原因和时间持久记录。
- 转移并发冲突：仅最终数据库事务四次有限重试，每次重新核授权/归属/资源；耗尽后保存阶段和退避，原计划自动续接，完成通知新用户。手续费与完成回执幂等，页面显示状态并限制冲突操作。
- 管理工单显示当前公网IPv4及OCI账号标签；账号标签仅管理员详情返回。
- 首页按实际内容与窗口剩余高度调整地图，手机底部可滚达；原地图/球体和主题保持。
- 自动续费说明支持悬停、键盘和手机点击，三语有效。
- 创建实例浏览器标题使用实际网站名称/副标题，旧SEO卸载不恢复过期标题。
- 余额支付项显示该账户当前余额，保留原付款及会话隔离。

## 本机证据

隔离真实PostgreSQL专项自然exit0：转移mTLS/Caddy边界、真实40001触发和并发提交快照、重试耗尽/退避/自动续接、手续费一次、原身份与UUID；续费和自动续费转移门禁；故障恢复；done后二次隔离及断线/未知数据/身份变化/扫描重试并发；开通失败原因与退款清理；实例API管理员账号标签隔离和转移状态。无生产写入。

真实Vue/Chrome：完整App首页→创建实例及品牌配置更新/SEO清理；六种宽高、125%/150%缩放对应CSS视口与设备比例、长副标题、三语/三宽/深浅主题；说明三语真实触控、焦点/Escape/关闭；工单公网/OCI与原会话/轮询回归；直接购买和购物车余额及原付款回归。截图已检查底部可达和说明无遮挡。

对应route、i18n、transfer-query、host-pool、ticket-query/success、billing-expiry-race、scheduler/startup、platform-recovery-safety守卫通过；类型、双端构建/边界、服务端构建通过。本机未跑全套大矩阵，CI负责完整209清单和关联专项。定向lint无errors，保留既有页面缩进等warnings。详细日志和源码hash在本地ignored `logs/v1.8.3-local-evidence.json`。

## 未验收范围

v1.8.2稳定tag和Agent v1.0.4原tag/资产保持。此前目标只读确认已部署v1.8.2，deployedAt为 `2026-11-04T16:53:54.766Z`，本agent未代做该升级；本次没有代部署v1.8.3，也没有读得其生产部署或解除隔离的实证。

故障宿主没有换IP，其再次隔离来自后续开通失败补偿与旧done任务未重新排队；另一宿主换IP成功属于独立事实。历史首次开通的确切失败步骤没有保留日志，不能猜为SSH、IPv6或升级原因。新版记录新失败原因、只读核验和有限续接，但不承诺自动修复未知身份、残留客户数据或全部异常。

真实OCI/原Agent与客户公网持续连接、真实OSS全新B完整灾备、独立备用接管、近千台/72小时仍未全面验收，不能由源码、发行或网页更新成功替代。参见[owner网页检查](release-v1.8.3-owner-click-test.md)。
