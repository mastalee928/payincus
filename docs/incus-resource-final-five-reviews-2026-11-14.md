# 最终资源与自动修复五轮审视

产品来源：面板控制面 `aa8a291d184135b27945e5636c0f08bab8258bfe`，Agent 最终 `6c8b36ed0f91c51fb6c0091bd53c054963bf2912` / v1.0.12。后者没有新增前后端业务源码变化，增加空操作完整响应检查、真实空池原生与对应版本。正式发行尚未执行。

## 第一轮：真实规格和新旧实例

数据库规格使用 MiB，创建、资源修改和重装由 `incusResourceSize` 生成相同单位；E2 为 2C/768MiB/30GiB，ARM1C 为 1C/4096MiB/30GiB。旧 MB 限额只按原 UUID、受信 endpoint、当前绑定、锁和 ETag 定向更新，保留价格、账期与磁盘。恢复核验只接受完整的旧 MB 或新 MiB 配对，不能混合放宽。

目标 9 台运行实例最终 `/proc/meminfo`、cgroup、只读 LXCFS 与 Incus 30GiB 配额全部准确。Btrfs 的 `df`/statfs 可显示 34GiB 整池容量，真实可写限额由 30GiB qgroup 控制，不把外部工具总量当作超配。用户截图来自外部 SSH 工具，不新增平台资源 UI。

## 第二轮：sysinfo 根因和既有客户保护

Alpine Incus 7.0.1 的 monitor argv 为空导致原 sysinfo 服务无法识别客机。固定官方源码 SHA，回补按 kernel cgroup 首个 payload/monitor 定位并保留上游锚定保护；双架构构建、ELF/动态库/hash 和实际 syscall 验收。对应压缩 daemon 嵌入 Agent 自身架构，未把客户镜像塞进发行包。

只对已登记单租户宿主下发当前受信 Agent 的有限期许可；宿主和客机 UUID/状态不匹配不启动替换。主控持久门禁保护首次创建，精确到期 stop/delete capability 保持。Agent 只平滑重载 daemon，不停止客户。现场八台既有客户/测试客机 PID、boot、UUID保持；#42 是另行正常用户停启测试。宿主 boot 全保持。

## 第三轮：命令输出与空库存

原 command stdout/stderr 合并可能污染 JSON，修为 Incus 固定本地 socket、分开的有界诊断输出；原 root 工具/路径验证保持。实际空库存 Incus `query` 在 metadata={} 时输出零字节，早先六客机原生存在诊断操作，没有覆盖这一形态，导致目标 34 台停在 prepared。改 `query --raw` 并严格核 sync/200/非 null metadata/所有操作已终态；不能把空文本或错误响应当成空库存。

新增真正空池等待存储初始化操作收尾、确认普通 query 零字节、完整 envelope 和真实自动重载。最终 AMD/ARM × 正常、准备中断、回滚重试、空池八场全部成功。现场 1.0.12 正常 manifest 自动升级 34/34，原任务自然 verified 34/34；正常公开目录/分配器核 25 台空库存可售，未清数据库门禁标绿。

## 第四轮：中断、回滚和主控续接

服务失败后已恢复旧 binary、但仍留 reloading 会导致下轮 NewHash 拒绝；新增 rolling-back 持久状态，下轮先恢复旧服务/原客户，再重试。prepared 原子恢复文件使原进程 exe 带 deleted，不能仅按路径误拒；固定原 exe fd 内容 hash、PID start-time 前后与当前旧 binary 一致才续接。

主控先等 daemon API、Agent先等许可的互等已修：仅已保存 prepared、匹配 request/hash/原 host、当前 Agent 和原实例绑定的 pending 可续原许可，不连接等待中的 daemon；verified 解除仍实际 mTLS 核验。异请求拒绝、当前绑定变化拒绝，PG/mTLS真实回归及账务保持通过。包锁、后台任务和正在执行的 Incus 操作不被取消或删除。

## 第五轮：镜像、订单、升级和实购

Debian11/Ubuntu25.10 双架构管理员记录、专用文件与缓存已撤除；其余镜像保留 `/var/lib/incudal-images` 独立持久库，热更新前后224文件18.66GB的文件尺寸/时间戳清单一致。开通中 creating/updating/refund/error 不显示多余 IPv6，成功仍显示地址。用户 dist 不含续费改价入口，管理员权限/原价回池和第三方失败真实退款入余额的既有回归纳入完整 CI。

候选46原 worker升级成功，DB243迁移无待执行、原平台/网关身份、双前端和支付检查通过。一次失败发生在前置seal：候选Agent暂存于代码内新增3文件；核0原文件变化后移到代码外，恢复原seal一致并续同一尚未开始的任务46。以后暂存候选不进入原发行目录，不重签清单接受未知文件。

最终6c8b36ed完整CI43534756776 29/29、Agent43534756798、Alpine43534756814、八原生43534756899均成功；无tag预览43534750911双首装/六原v1.8.9 worker升级（迁移留库和故障回滚再升级）成功。实际候选包独立原pin签名、hash/source/243迁移、用户边界、退款模块和无图库通过。源码/包/目标证据分开保留。

修复后实购#43/qa1810-final-alpine使用真实poolbuyer账户、原定价10+1、单次扣11元；实际开通、网页stop/start/restart、远端Stopped/Running、SSH/IPv6、768MiB和30GiB及sysinfo准确。#42/test-arm-2旧进程未载入sysinfo规则，正常用户stop/start后4GiB准确，凭据/UUID/账期保持。旧真实客户#27/#41也属于未载入规则的历史启动；需要正常重启生效，当前未授权代停启，owner选择仍待。不能把其/proc与cgroup准确或daemon修复完成说成当前sysinfo已准确。

Owner随后明确授权#27/#41停启，两台原管理API任务均完成；确认Stopped及Running、sysinfo768MiB、SSH/公网IPv6/原UUID/凭据/系统文件/账期价格保持。#27旧单值内部IPv6被状态同步清null，原地址仍在guest且公网映射未变，实际核验并记录。该项此前“待选择”已完成。

守护进程替换后的全镜像补跑追加发现#38 Btrfs重装目标File exists，尚须根因与源码修复；静态sysinfo探针整段base64超过Incus请求体属测试传输问题。当前未正式发版，完整新daemon矩阵等待这些问题闭环。完整证据与未完成项见 HANDOFF.md、customer-resource-accuracy-2026-11-14.md。密码、token、管理密钥和原始记录只在仓库外私有目录。
