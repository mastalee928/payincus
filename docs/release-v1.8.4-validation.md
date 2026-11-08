# v1.8.4 发行验证记录

v1.8.4已正式发行并完成下列同来源CI、双架构首装与公开资产核验。本次未代做生产部署；各项证据范围分别记录。

## 本版范围

- Alpine OpenSSH适用官方安全修订，保持客户原密码、配置、主机密钥及持续SSH/SFTP验证；非特权与危险配置/设备门禁。
- 已有和新增宿主持久安全检查、适用补丁与详细状态。Agent v1.0.5新增启动标识上报，供原身份维护核验。需要重启的方案必须通过对应系统/架构原生验收才放行；本版白名单仍为空。
- 自动续费保留余额不足时的意愿，暂停保留期内充值足额后补续；同用户按到期时间、实例ID有序逐笔处理，允许部分续费，截止/删除后不补扣。系统到期暂停补续后按原身份自动开机，失败只续接开机。
- 管理员修改实例到期时间与用户邮箱，服务端核当前权限、旧表单及并发边界；改期不扣费退款，改邮箱撤销旧Web会话与验证码并审计。
- 已配置本机网关仅只读重新检查；防旧计划、并发及重复确认重写。
- 首页切洲聚焦、移动端全部无文字/选洲显示就近城市，修正新加坡西部等名称、密集布局、窗口变化和手势；指定标题/品牌/导航局部禁选。

## 既有本机及原生证据

本机专项已分别覆盖真实PG/Fastify/JWT、权限/资金/锁竞争/故障回滚、受信HTTPS协议边界、Vue/Chrome三语/深浅/多尺寸/触摸。详细范围见[邮箱](admin-user-email.md)、[改期](admin-instance-expiry.md)、[网关](gateway-recheck-2026-11-09.md)、[自动续费](auto-renew-retention-2026-11-08.md)、[安全维护](automatic-security-hardening.md)。同线程原生Alpine专项已覆盖AMD64六分支与ARM64 3.22，最终历史运行[42426418362](https://github.com/mastalee928/payincus/actions/runs/42426418362)；新版仍核自身来源CI。

## 正式发行证据

- 正式源码：`2c3201122bfface31b7c20e6497437b5814ce699`；tree：`512e37424d51cf66fab1a7ade5c3ca2323fd94de`。
- 候选PR实际checkout：`3cb612ea094764fb679e921c4ae130d7caa6d3a9`，独立核tree相同；[PR #6](https://github.com/mastalee928/payincus/pull/6)合入main的提交与正式源码一致。
- 注释稳定tag对象：`6a516f547ba52b3816450e1041cdf5b945f8eda4`，解引用到上述源码；后续验证文档提交不移动tag。
- [v1.8.4 Release](https://github.com/mastalee928/payincus/releases/tag/v1.8.4)公开时间：`2026-11-08T23:40:17Z`，非draft、非prerelease，panel latest=v1.8.4；说明已写入并回读一致。

| 工作流 | 事件 | 运行 | 结果 |
|---|---|---|---|
| Agent Build & Release | pull_request | [42512962052](https://github.com/mastalee928/payincus/actions/runs/42512962052) | success |
| CI | pull_request | [42512962099](https://github.com/mastalee928/payincus/actions/runs/42512962099) | success |
| Alpine SSH security | pull_request | [42512962116](https://github.com/mastalee928/payincus/actions/runs/42512962116) | success |
| Agent Build & Release | workflow_dispatch | [42523460346](https://github.com/mastalee928/payincus/actions/runs/42523460346) | success |
| Build & Release | workflow_dispatch | [42523751752](https://github.com/mastalee928/payincus/actions/runs/42523751752) | success |
| Alpine SSH security | push | [42524993258](https://github.com/mastalee928/payincus/actions/runs/42524993258) | success |
| CI | push | [42524993262](https://github.com/mastalee928/payincus/actions/runs/42524993262) | success |
| Agent Build & Release | push | [42524993286](https://github.com/mastalee928/payincus/actions/runs/42524993286) | success |
| Build & Release | push | [42535118475](https://github.com/mastalee928/payincus/actions/runs/42535118475) | success |

候选与main CI各十job全部终态成功，逐job核实际checkout及归档日志；Alpine九job与Agent关联运行全部独立核验。预览四必需job成功且发布步骤skipped；正式五job独立成功，不以预览替代正式。213守卫、241迁移、AMD64/ARM64原生首装、唯一后台、双前端、公开Agent、完整备份/预检/恢复/改变后回退续接、SQL ZIP完整性及旧CRLF历史/错误来源拒绝均核实际日志。首装OSS仍为本地传输替身。

## 公开资产实测

六资产实际下载并核API digest、字节数及SHA256；两个OTA清单字节一致，架构/URL/大小/hash与两tar一致。包内版本、241迁移、LICENSE、root归属、安全路径、原生架构及本版编译文件均已检查。双端首页、管理员编辑与网关/隔离/续费标记已核；每包双架构网关组件的20文件、权限/ELF、完整sourceCommit与Ed25519签名独立验证，公钥沿用v1.8.3原受信基线。

| 公开资产 | 字节 | SHA256 |
|---|---:|---|
| `incudal-v1.8.4-linux-amd64.tar.gz` | 214375962 | `ba876a777af9077420f29f5b7573c88cdf44beef9ac5e1080cf93ce8b9b1133f` |
| `incudal-v1.8.4-linux-amd64.tar.gz.sha256` | 100 | `cec2a23c0165ce8f19754dd65f192af1c3f6cba3610b8778a26cb94f85cebe96` |
| `incudal-v1.8.4-linux-arm64.tar.gz` | 213613756 | `f2a472d0e0b605dbc28c5b1c4b4cccfac1887da1e2af6960b77712f9a7f0b54a` |
| `incudal-v1.8.4-linux-arm64.tar.gz.sha256` | 100 | `442ee780f5f250a2f5f86371753ed07d856294c4a6bfac35b2f38eef498a6cc4` |
| `incudal-v1.8.4-ota-manifest.json` | 996 | `09ea4f0ab3fdfcc8dcb7dd6d579a15e89eda6b5798b620838b2642a9517aa397` |
| `ota-manifest.json` | 996 | `09ea4f0ab3fdfcc8dcb7dd6d579a15e89eda6b5798b620838b2642a9517aa397` |

Agent [v1.0.5](https://github.com/mastalee928/payincus/releases/tag/agent-v1.0.5)同源码发布，AMD64/ARM64二进制与LICENSE三资产实际下载核API digest/大小、ELF/版本/boot_id；main重复发布路径核同源同hash后跳过，不覆盖。原v1.0.4稳定tag和三资产摘要、大小、更新时间保持原基线。

## 本轮失败及修复闭环

三次旧候选CI失败原日志保留：快照测试返回空metadata、赠送测试丢弃生成的type/profiles/devices，均由正确隔离门禁拒绝；只修对应夹具并新增零写入/唯一开机断言。第三次为独占Incus客户端事务内维护查询额外申请连接，单PG连接实测超时；进程上限及备份删除复用当前事务，保留最终维护门禁/原TLS pin/独占transport关闭。真实单连接维护阻断零写入、恢复续接、精确备份缺失与幂等、三种90秒超时/无迟到写入、权限/并发/COMMIT失败及完整备份删除均通过。本机类型、相关守卫与后端构建通过；上述失败均由最终候选完整CI和main同来源CI闭环。

## 尚未验收的范围

本版发行不等于生产已更新。内存优化实验默认关闭；原生自动内核/AppArmor准备、宿主重启/真实客户恢复、VM/冻结恢复、独立救援及同故障域熔断尚未整体验收，不能自动放行未验证方案。既有未知身份和未满足隔离条件的客户保留明确阻断，不猜测当前同名实例身份或转换特权配置。

首装OSS使用本地传输替身。真实OSS全新B灾备、独立备用接管、真实客户公网持续观察、近千台与72小时仍须各自验收。Chrome设备模拟不等于真实iOS/Android测试。本轮不修改生产账号、DNS、OSS、客户或宿主，不执行生产OTA。

## 升级检查

见[网页升级与检查](release-v1.8.4-owner-click-test.md)。源码、运行与资产实测见本页上文。
