# v1.8.6 验证记录

核验时间：2026-11-11 02:18 UTC。面板 [v1.8.6](https://github.com/mastalee928/payincus/releases/tag/v1.8.6) 与配套 [Agent v1.0.6](https://github.com/mastalee928/payincus/releases/tag/agent-v1.0.6) 已公开发行；面板为最新稳定版。此次仅发行软件，未代部署生产。

## 源码与发行身份

- 正式完整源码：`00b39869a85a592ec50f3d67935d409968613a86`；tree：`bb256ed37bab9c2e8619af5779a8edd7726acf9a`。
- main 从 `fea9d66cfeeb0a2ce804a644d9ddd3e14c2b9f8f` 非强制快进至该提交；[PR #9](https://github.com/mastalee928/payincus/pull/9) 已合并，mergeCommit 与正式源码相同。
- 注释标签 v1.8.6：`3a5bb59ec510357d249ea92af5da4bf154f778f1`，解引用指向上述正式源码；历史稳定标签未移动。
- Agent v1.0.6 的完整来源为 `fea9d66cfeeb0a2ce804a644d9ddd3e14c2b9f8f`，已先行公开并核实三项资产。面板随后仅补充Node SSH生成器补丁与回归；Agent源码树、构建脚本、工作流和安装／协议输入逐项完全相同，继续使用原稳定Agent资产。新面板预览与正式首装独立验证该依赖组合。后续文档提交不改变标签源码。

## 本版范围

1. 修复普通巡检抢占接入维护、旧等待状态、完成回执未结束入库等问题。沿当前权限、租约、SSH／Agent／Incus身份继续原任务；无客户与无清理占用、完整防护回执后才进入一机一卖可售。
2. 纯净 Alpine／Debian 准备依赖、准确UTC、ipinfo有效IANA当地时区、时间同步、内核支持时BBR及至少1GiB磁盘swap。原swap不缩小不关闭，密码严格加密保存、成功清理；包锁、下载和临时网络故障按阶段退避。
3. 配套Agent持续隔离客户访问OCI元数据、私网与已识别管理地址；保留宿主OCI探测、必要DNS／IPv6、普通公网连接来源和密码登录。已识别管理验收连接定向转换来源，防护失败不发布可售回执。
4. 旧nft使用0600唯一临时文件原子加载并完整回读；systemd／OpenRC防护依赖失败后自动续接，OpenRC安装时刷新依赖缓存，保留手工停止与原客户运行状态。
5. SSH依赖生成Ed25519时仅移除ASN.1的unused-bits字节，保留公钥零前缀；确定性同步／异步、签名和真实SSH验证覆盖，原身份不变。
6. 保留前期实例生命周期、重装原身份、IPv6预占、失败清理回池及相关业务修复。累计241个数据库迁移。

三轮问题与修复见[客户防护复审](customer-infrastructure-protection-review-2026-11-11.md)、[全自动接入复审](automatic-onboarding-three-round-review-2026-11-10.md)；一机一卖范围见[五轮审视](host-pool-lifecycle-review-2026-11-10.md)。

## 当前面板来源全部关联运行

| 工作流 | Run ID | 终态 |
| --- | --- | --- |
| [CI / pull_request](https://github.com/mastalee928/payincus/actions/runs/42908470060) | 42908470060 | success |
| [Alpine SSH security / pull_request](https://github.com/mastalee928/payincus/actions/runs/42908470077) | 42908470077 | success |
| [Build & Release / workflow_dispatch](https://github.com/mastalee928/payincus/actions/runs/42908807624) | 42908807624 | success |
| [CI / push](https://github.com/mastalee928/payincus/actions/runs/42927242059) | 42927242059 | success |
| [Build & Release / push](https://github.com/mastalee928/payincus/actions/runs/42943161374) | 42943161374 | success |

逐job从日志提取实际完整checkout并核提交／tree。候选CI与main CI均为十job全部success，包含真实Incus清理；预览双构建和双首装success，发布job预期skipped；正式双构建、双首装和发布共五job全部success。

- Agent双架构：由原Agent来源的候选与正式原生运行核实际客户网络包、OCI metadata与已有连接阻断、管理来源转换、普通来源保留、IPv6与门户、旧OCI回包共存、nft原子／幂等／漂移恢复、systemd与Alpine OpenRC依赖失败→修复后续接→保留手工停止。Agent来源及链接见下方资产证据，与新面板的Node补丁来源分别记录。
- Alpine七组旧版官方签名APK原生验证：原密码／新登录、错误／长／空密码拒绝、持续SSH／SFTP、幂等及reload失败恢复。旧包仅隔离测试，未收入安装包。
- 两架构维护与接入专项：原超期请求、条件回退、退避／单次重启、完整回执、完成前崩溃续接、失效lease／FAILED清理占用拒绝、真实PG库存与带锁分配器；引导和远端命令夹具不等同真实整机重启。
- 付款／余额／续费／购买／重放／删除清理、管理员权限与行锁、原实例身份和浏览器流程全部纳入完整CI；本批购买、换机、回池及开通专项本机亦通过。
- 215项守卫、类型、双端与后端构建通过。双原生首装核241迁移、唯一后台、双前端、管理员登录、公开Agent下载；完整备份／预检／恢复／改变后回退／续接／SQL与加密ZIP／旧版CRLF迁移及拒绝断言全部通过。

历史失败保留：main CI `42906307040` 的Ed25519公钥零前缀缺陷由上述新来源完整CI和确定性回归关闭，原运行八job成功、Lint失败、依赖Build跳过，不计为成功运行。旧nft管道兼容、OpenRC依赖缓存、旧官方APK CDN、赠送／购买／换机库存测试前提及重复取时时间窗口均保留原日志与闭环。实际产品问题最小修复，测试补前提未降低产品门槛；最终候选完整运行关闭这些失败。旧预览依赖公开Agent v1.0.5被正确拒绝，由v1.0.6公开后的新面板完整预览关闭，未用测试二进制替代公开资产。

## 六项公开面板资产

所有文件实际下载并独立核API digest／大小／SHA256。双OTA清单字节一致，两个架构URL／hash／大小与实际tar一致。

| 资产 | 字节 | SHA256 |
| --- | ---: | --- |
| incudal-v1.8.6-linux-amd64.tar.gz | 214454575 | `d92ab050ccd97d851757481e5cad5e2de21e6fd4fba575aef828591a45dcfc48` |
| incudal-v1.8.6-linux-amd64.tar.gz.sha256 | 100 | `415ec012399c713fa107898466896b6af130e8a425a3face122442f524e8b53f` |
| incudal-v1.8.6-linux-arm64.tar.gz | 213670636 | `b264d0010c0610b838c211dd71541628f830e3c1b76afecae42a2d6074db7ba4` |
| incudal-v1.8.6-linux-arm64.tar.gz.sha256 | 100 | `24dbbafef01f0c4fcb746a885ea46393704f1728229d20d48851f4f7a4323a8d` |
| incudal-v1.8.6-ota-manifest.json | 993 | `82918c8a50bdb1d853dc34c4d264df0b0252d1f08ea2259e4b73a4b029969da6` |
| ota-manifest.json | 993 | `82918c8a50bdb1d853dc34c4d264df0b0252d1f08ea2259e4b73a4b029969da6` |

两包检查版本、241迁移、LICENSE、root归属、安全路径与原生ELF架构；新增准备模板／防护及身份模块、既有业务修复编译文件和双端首页标记均存在；两包安装的ssh2生成器与已验补丁字节一致，锁文件及patch同时入包。每包双架构网关的catalog及签名payload均绑定完整正式sourceCommit；20文件hash／大小／模式／ELF逐项核。Ed25519公钥沿用v1.8.5原受信基线，未信任包内新key。Release说明回读一致，六资产未变且latest=v1.8.6。

## Agent公开资产

| 资产 | 字节 | SHA256 |
| --- | ---: | --- |
| incudal-agent-aarch64-v1.0.6 | 5111960 | `52aea6349cf9c2bbbe1261e72c05a87cc041b6a7ddd31c166c1784b2d723c5c2` |
| incudal-agent-x86_64-v1.0.6 | 5410968 | `1c381d5cc2e2c8e804c53b0a1a634aa6dee3f17e4610db03fb336ecf951ef4a7` |
| LICENSE | 1496 | `5659dbf51fa91752f85fe0fb6677086ac1fbc368768ac3d230a70af86afdad6b` |

三公开文件与原Agent来源候选artifact逐字节摘要一致；候选Agent [42883551153](https://github.com/mastalee928/payincus/actions/runs/42883551153)、正式原生Agent [42903794983](https://github.com/mastalee928/payincus/actions/runs/42903794983)、原main Agent [42906307022](https://github.com/mastalee928/payincus/actions/runs/42906307022)／Alpine [42906307160](https://github.com/mastalee928/payincus/actions/runs/42906307160)均全必需终态通过，日志保持原SHA归属；双ELF架构、版本及新防护标记通过。原v1.0.5 tag、三资产hash／大小／更新时间保持基线不变；原main关联Agent发布检查同源同摘要后跳过重复发布；新面板依赖补丁未触发Agent发布。

## 实证边界

自动改引导已原生放行范围仍仅 `alpine-apparmor-grub-v1:x86_64`。ARM／Debian已有完整防护时可验收，但需要未验收引导方案时继续保护并显示具体原因；不能承诺任意身份冲突、坏盘、未知安装中断、云平台或网络阻断均无条件自动变可售。可售还要求已有商品分组和定价。

本次不代生产OTA、宿主重启、客户操作或OSS恢复。双首装OSS使用本地传输替身；完整纯净宿主原生接入端到端、真实客户公网／全端口、真实OSS全新B灾备、独立备用、千台／72小时仍各自未验收。源码、CI和软件发行不等于目标机器已升级或生产恢复。

管理员网页升级和检查见[操作清单](release-v1.8.6-owner-click-test.md)。
