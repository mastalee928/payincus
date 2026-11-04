# v1.8.2 发行验证记录

2026-11-05：正式发行、全部关联CI及公开资产核验完成。源码 `b70a9f56b9a06d72c0d91c6bebd984db9e7c68c5`，tree `2dd572ace1f390f84dc23ac18dd0374ba3fe8d1c`；[PR #4](https://github.com/mastalee928/payincus/pull/4) 精确快进main，注释tag对象 `5973f499c0cc82a9318c7e321886446c3729a9a0` 固定指向该源码。

[v1.8.2 Release](https://github.com/mastalee928/payincus/releases/tag/v1.8.2) 于2026-11-04T15:29:15Z发布，非draft/prerelease，panel latest=v1.8.2。文档后续更新不移动稳定tag或重新打包。下述隔离恢复遗漏已确认，发行通过不代表该遗漏已修复。

## Actions实际结果

| 运行 | 终态与来源 |
| --- | --- |
| [候选CI 41835355829](https://github.com/mastalee928/payincus/actions/runs/41835355829) | 十job success；实际PR checkout `99a887abbb7412ae35f682f586b98162a84c160c`，tree同候选 |
| [双架构预览41835346983](https://github.com/mastalee928/payincus/actions/runs/41835346983) | 四必需job success，Release预期skipped；完整checkout同正式源码 |
| [main CI41855600457](https://github.com/mastalee928/payincus/actions/runs/41855600457) | 十job success；每job实际checkout同完整正式源码 |
| [正式41855613144](https://github.com/mastalee928/payincus/actions/runs/41855613144) | 五job success；双原生构建、双首装与Release独立核同来源 |

最终同SHA关联运行查询只发现以上四运行，全部终态；无新增Agent/Pages运行。209完整守卫、240迁移、唯一后台、双前端、公开Agent、备份预检/还原/改变后回退续接、SQL/ZIP完整性、旧版CRLF迁移和拒绝条件通过。main完整Pool业务步骤及日志已核，复用此前九job成功日志。

六公开资产实际下载并核API digest/大小、独立SHA256、OTA URL/架构、240迁移、修复编译文件、LICENSE、root归属/路径/原生架构。每包包含双架构网关组件，沿原独立受信Ed25519基线核签名、20文件hash/大小/权限/ELF；catalog与payload完整sourceCommit同正式源码，version/OTA短提交另核完整身份。

| 资产 | 字节 | SHA256 |
| --- | ---: | --- |
| incudal-v1.8.2-linux-amd64.tar.gz | 214172891 | `86fbc64cbc795aeb2565ba7c9b8495a8ebe3fc3c44b203c9ca49c84a0744ffc5` |
| incudal-v1.8.2-linux-amd64.tar.gz.sha256 | 100 | `b7fb9f49f9efe3aec159a1f6321e33240780a7d720663cf1f5237f200fa2e41b` |
| incudal-v1.8.2-linux-arm64.tar.gz | 213423279 | `ec7918d253730a5ad86f40370a9aeb3ca9b703b806485a82074a5e3b6d2c936c` |
| incudal-v1.8.2-linux-arm64.tar.gz.sha256 | 100 | `fd73fae13170a03b4d2769c7824126aefb93b345aba50346304f6e36bd560c36` |
| incudal-v1.8.2-ota-manifest.json | 994 | `dddf26575e9c0695ad07b76b3f3982058c668bf720951fba3634025e0ac9581e` |
| ota-manifest.json | 994 | `dddf26575e9c0695ad07b76b3f3982058c668bf720951fba3634025e0ac9581e` |

两manifest字节一致。Release说明回读一致，更新后六资产/latest复核。Agent v1.0.4原tag来源 `76e779df77e52cbe96ee2e103d57dd951dba4e1e`、tree `359dcf6657f8666e1274a2b21bc556c2dbf28270` 和三公开资产hash/大小/更新时间保持，复用原实际下载证据。

维护者本机证据位于ignored `logs/release-v1.8.2-{candidate-ci,preview,formal,main-ci,panel-assets,public-release}-verified.json`及逐job日志；不把私有运维材料上传公开仓库。

## 包含范围

| 修正 | 已有证据 |
| --- | --- |
| 失败接入重装重试、正式删除后再接入、当前IP重复反馈 | 独立真实PG、SSH认证与受限网关协议，lease/回执丢失/并发和实际Vue页面 |
| OCI公网变化与旧IP回收复用 | A `1.1.1.1→1.1.1.2`、B获得 `1.1.1.1`，两套不同实际SSH握手，错误key拒绝、自动退避与现址查询正确 |
| 当前地址与库存 | 有效地址唯一索引及维护trigger，旧地址保持历史而释放占用，现用/隐藏Host保留有效占用，待核地址不销售 |
| OSS与接入清理兼容 | 受限retirements资产认证加密往返，隐藏任务仍保留现用Host原管理路由；真实pg_dump/pg_restore保留IP保护及重试期限 |
| 用户活动来源IP | 实际HTTP、双层本机代理及伪造头隔离，显式外部代理配置保持；历史记录不改写 |
| 购买选择与界面 | 洲/地区变化即时清失效配置、镜像和数量，迟到请求不恢复旧选择；横排居中库存文案；实际Vue/Chrome三语三宽深浅 |
| 首页三态主题 | 真实系统偏好变化、跨页与持久选择、重复初始化与监听清理 |

支付和普通OSS自动还原修复已经在v1.8.1，本版沿用；其发行记录见 [v1.8.1验证](release-v1.8.1-validation.md)。没有更改 Agent v1.0.4 文件/版本，保留原标签及公开资产；正式收尾仍核验其身份。

## 已完成的发行门槛

1. 候选提交的源码CI全部终态，无未处理失败，逐job实际checkout和候选tree身份一致。
2. 同提交双架构预览构建/首装及恢复演练通过；预览Release预期跳过。
3. main快进到同提交，正式注释tag固定指向候选；正式双构建、双首装及Release成功后实际下载六资产。
4. 核独立SHA256/大小、OTA清单、240迁移、双端与编译修正、LICENSE、原生架构、网关catalog/payload完整sourceCommit及独立Ed25519受信签名。
5. 发行说明回读一致，panel latest=v1.8.2，Agent原身份/资产保持，最终CI与台账完成。

Windows专项的WG/Incus和OCI公网映射是适配器；SSH与PG真实运行。Linux命名空间中新的受限peer清理和回执文件权限由本次独立CI项验证，不以Windows边界适配器代替。首装OSS使用本地传输替身。真实OCI换IP、真实新B OSS灾备与原宿主/客户连接、近千台及72小时仍为独立未验收项。

## 已知遗漏与生产证据

在线宿主可能保留“旧清理任务done，但后来再次故障隔离”的组合。扫描和手动重试跳过旧done任务，没有新的只读恢复核验周期，导致IPv4/IPv6保持pending。诊断已核原身份、当前Agent/协议和空库存均满足恢复条件；该遗漏在v1.8.2尚未修复。不能靠反复点击IPv6同步解除，也不应重放旧删除授权或直接改数据库保护。

该目标历史显示旧实例删除后已解除隔离，随后新实例开通失败补偿流程再次设置隔离，失败实例已清理，旧done任务仍被保留。没有找到该次开通的具体失败步骤日志，不猜测SSH、IPv6或换IP原因。Owner确认受影响宿主未更换IP，另一宿主换IP已成功；这两种流程分别记录。后续修复按新源码身份处理，不移动已发行tag。

只读诊断实际读得目标主控v1.8.2 / `b70a9f56b9a0`，deployedAt2026-11-04T16:53:54.766Z；本agent没有执行升级，目标已升级不等于全部生产验收。首装OSS是本地传输替身；真实OCI与原Agent客户公网、真实OSS全新B完整灾备、独立备用接管、近千台/72小时仍未全面验收。

网页步骤见 [升级与检查](release-v1.8.2-owner-click-test.md)。
