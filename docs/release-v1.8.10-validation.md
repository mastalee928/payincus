# v1.8.10验证与发行记录

2026-11-14正式面板已公开，最终source92829310、main CI43568136335 29/29success。正式43568813210双构建/双首装/六旧worker升级全部success，但publish job被跳过：正式路径的preview-agent刻意skipped，GitHub的隐式success条件沿间接依赖阻止末尾发布。已在后续源码给release job增加always()并逐项要求build/fresh-install/legacy-upgrade成功，仓库守卫通过。此版未移动tag或重打包，逐job核原正式来源与全部成功门槛后，用该run原两个tar及同格式OTA清单公开发布；公开资产另行重新下载验digest/source。流程修复不改变已验证产品包。

正式发行进行中：PR14已于06:48:42UTC合并，最终main与面板注释tag解引用均为9282931002563528c22e4079f1c12721a5ff1f11；tag对象794d3b87bd5aa222f253198aece72146afb2e7dc。Agent v1.0.14已公开，main43568136313全成功，下载资产与候选逐字一致：AMD64 27885720B SHA04ac54ea0f5494f9727757880836353d53a9a011cca7580bf96f78638ba51b30，ARM64 25297048B SHA5c496c7440334e7007bcb12433938d3c8dee7d1aa17a88704613e3cc441420ff，LICENSE1496B SHA5659dbf51fa91752f85fe0fb6677086ac1fbc368768ac3d230a70af86afdad6b。面板正式43568813210进行中，公开包待核；mainCI43568136335仍尾段。目标已部署相同源码候选，但不是正式包OTA证据。

2026-11-14 06:46 UTC上线前验收完成：累计AMD24/24（cd1b已过16+92829310新增8）、ARM24/24（cd1b已过12+92829310新增12），各镜像重装/实际OS/确认Stopped/启动/重启/原SSH凭据与marker/IPv6/DNS/proc+cgroup+sysinfo通过，续测余额999854.88保持、原newPurchase账单AMD5/ARM2保持。初轮ARM差额仅独立#44新购11元，实际balanceLog/订单/账单逐项核清。#44本版本TinyCloud新购与停启/重启全验通过。34台Agent1.0.14/new hash verified/online/BBR applied，23空库存可售，无在途任务；退役镜像记录为空，图库224文件18,659,690,538B/hash337c714453a6b5102e51f4c849156df161e5d0619197e68c803b75505c3a7e4d与更新前一致。#27/#41原UUID/密码/文件/账期价格/自授权停启后的PID与boot保持，SSH/IPv6/sysinfo768MiB再次通过；新候选backend NRestarts=0。正式发布可开始，公开Release与资产仍需独立验收。

最新候选9282931002563528c22e4079f1c12721a5ff1f11：CI43561792581 29/29，12兼容原生43561792696、Agent43561792709、Alpine43561792652、无tag预览43561790220双首装及六原v1.8.9 worker正常/迁移留库/后半程回退再升级全部success，公开Release跳过。实际双tar原pin签名/source/243迁移/新DNS与SSH/onDispatch/心跳模块同本地build独立通过；Agent仍已验证1.0.14。目标更新49于06:05:49UTC成功preview-9282931；#38重新选Edge任务833真实磁盘Edge、SSH/IPv6/768MiB/30GiB/原UUID账期价格通过。完整镜像续测仍在运行，未正式发行；旧cd1b矩阵因SSH二次error后台退出中断，只保留AMD16/ARM12真实passed，未测项继续验，不能将#44新购11元误算为重装扣款。

2026-11-14当前源码cd1b1787667e4ddea7c6b2945f229260a0bfdb4f/Agent1.0.14正在验收；目标主控候选47仍preview-70f75c6/1.0.13。#27/#41已按owner授权各停启一次并确认sysinfo768MiB、原UUID/密码/公钥/账期/价格/SSH/公网IPv6，不再待授权。34宿主新daemon verified/online/宿主BBR applied，24空库存可售。#38旧重装残留先在Btrfs目录、后在配置PUT缺volume登记暴露遗漏，5384edbe补完整恢复链并12原生/双首装/六旧worker预览43551270721成功，但尚未目标再热更。随后#42 TinyCloud停启DNS随机清空，5c8d966c修双dhcpcd竞争与resolver，双架构真实旧DNS恢复/两次停启及预览43552219969成功。Owner明确全池及新接入覆盖，cd1b1787追加IPv4-only后台维护/正常交付入口，双PG/mTLS及完整104任务重装/换机回归通过，同来源CI43553546558/预览43553542894继续。最终目标#38、全池DNS和全部镜像矩阵未完成，正式未发行；下方阶段记录不得覆盖当前状态。

2026-11-14最新产品6c8b36ed/Agent1.0.12：完整CI43534756776 29/29、Agent43534756798、Alpine43534756814和8自动native43534756899全部success；无tag预览43534750911双首装、六原v1.8.9worker升级和回滚再升级全部success。实际包原pin/signature/source/243迁移/用户价格边界/退款模块/无图库过。主控候选46已运行preview-aa8a291，正常manifest自动Agent1.0.12并完成34/34兼容修复；34分配器就绪、25空库存可售，9运行实例资源配额/proc/cgroup准确，原UUID/账期价格和镜像库保持。AMD/ARM各24镜像完整矩阵完成；修复后实购#43及网页停启重启/SSH/IPv6/sysinfo通过。#42旧运行实例正常停启后sysinfo4GiB；真实客户#27/#41未载入旧进程规则，owner的是否停启选择仍待，正式发布尚未执行。详见[最终五轮](incus-resource-final-five-reviews-2026-11-14.md)。下面的暂停/待测为各历史阶段，不能覆盖最新事实。

2026-11-14最新：Owner完整目标恢复全部上线门槛通过后的发行授权；下方“仍正式暂停”仅历史阶段。最终产品609377755459f2df84ad3d03788357d35c2a0db8的CI43499445962 29/29、Agent43499445858、Alpine43499445943全部success，预览43499441752双构建/候选Agent/双首装/六原v1.8.9worker正常升级/迁移留库/故障回退再升级11必需job success，公开Release skipped。双真实tar原pin签名/source/243迁移/退款及用户改价边界/无大镜像库通过。目标热更新45成功preview-6093777，34宿主候选1.0.10自然升级全ready，历史缺createdAt池配额后台修复；剩余AMD2/ARM13镜像全操作仍在运行，正式面板1.8.10/Agent1.0.10未发布，不提前发。

最新产品来源818cc09737e9e73a748737d693a4e16e6483c608：CI43422268917最终29/29（14原生）、Alpine43422268867 9/9、Agent43422268848通过，无tag预览43422312032十必需job通过/Release skipped，双包本次模块/原pin签名/hash/size/权限/242迁移独立核通过。主控候选热更新42成功preview-818cc09，x86当前22可选镜像完整操作矩阵、ARM#53原生加固与自然接入及10+1定价上架完成。正式版本仍暂停，完整ARM用户矩阵待owner新增宿主；无v1.8.10tag/Release。

**最新约束：正式发行暂停，需owner后续明确恢复。** 主控当前preview-282d831（任务40），PR14继续候选修复；x86矩阵17/24、两官方下架、五可用项待测，之后排查新加坡西部ARM加固及ARM矩阵。以下旧“允许正式发行”仅历史记录，已被owner新指令取代。新矩阵修复见[记录](rebuild-matrix-followup-2026-11-13.md)，不得推正式tag。

最后来源d5e7c854ae9c08ba581de9b8ec679e02667ab05b完整CI43345508215最终27/27success；六系统×双架构机器池12/12、Alpine43345508238success、预览43345595678十必需jobsuccess和两实际包独立核全部完成。原批与新增退款全部修完并同来源验收，现在允许正式合入发行；正式Release资产、主控OTA及实购另验。

最终来源d5e7c854预览43345595678已终态success：十必需job全部success，Release预期skipped；双构建、双首装、六原v1.8.9worker升级及后半程回滚再升级全部通过。完整CI43345508215尚在审查尾段，无已知失败。不能据此提前正式发布，等待最后CI终态。

最终补充源码d5e7c854ae9c08ba581de9b8ec679e02667ab05b已推PR13：真实第三方开通失败自动退余额、同事务／去重／后台失败续查、新文案及订单／恢复账务精修。专项和五轮见failed-checkout-wallet-refund-2026-11-13.md。本地218/219后外层超时的Agent守卫同源码单跑10场景通过，所有对应守卫有通过证据；其余types/build/PG/browser成功。

最后来源CI43345508215原生池12/12success，整体尚未结束；Alpine43345508238已success。最后预览43345595678运行中，不能用下面旧原批绿代替。Owner新增正式全绿后主控OTA＋实购授权，地址已改vm.oci.ee；无正式Release／OTA／实购，待终态。

最后双预览包已逐文件独立核通过：来源d5e7c854ae9c、242迁移、原pin签名／四组件21文件hash／size／mode／ELF架构，IP／退款／恢复模块同最后build，新余额提示与管理退款API打包存在；用户续费改价入口不存在。日志failed-refund-preview-package-verify.log自然exit0。正式包身份及生产更新仍待。

原批源码2f0ff43f940bda0244dff885b4ace5d90ff73e71，PR13。修复IP巡查错误阻断正常机器池创建和管理退款API缺失，结果页不对已失败退款实例显示IPv6配置中。详细五轮见pool-ip-provisioning-race-2026-11-13.md。

- 本地全量219/219、最终类型／相关守卫／双端构建／dist边界、实际PG巡查竞争、退款状态与真实管理API及生产bundle浏览器全部自然exit0。
- CI43337700170同来源六系统×双架构真正机器池交付12/12 success（创建前及初始化巡查、宿主真实防护工具回执、公网原密码SSH、final gate及完整清理）；其它必需job仍运行，整轮未终态。
- Alpine维护43337700105全部success，Agent产品输入未改保持v1.0.8。
- 预览进展：双实际包构建、双首装以及正常／已迁移升级四job已success，两个故障回滚再升级仍运行；首装回读一后端／两前端／管理员登录／242迁移及管理组件成功。CI剩六分片审查尾段运行，未终态；不提前合入或发行。
- 原批预览43337716631最终success：10个必需job全部success（双构建、双首装、六原v1.8.9 worker升级），发布Release预期skipped。两条后半程失败真实回滚到旧代码后再升级通过，原身份和库保留；无正式Release。CI剩六分片尾段继续核终态。
- 原批CI43337700170最终27/27全部success（2026-11-13T00:57Z观察终态），12原生机器池交付及所有审查分片已完成。该批验证闭环，现在按owner执行顺序开始已授权第三方失败退款入余额；必须同最终源码再验后正式发行。原批来源与后续来源分开保存。
- 无tag发行预览43337716631正在运行：双构建／双首装／六原v1.8.9 worker升级与回滚再升级尚未完成；无公开Release。
- 两预览实际tar独立核通过：来源2f0ff43f940b、完整242迁移、根属主／无重复或越界链接、IP与交付后端模块同最终build、管理员退款API存在、用户续费价编辑无入口；四组件原pin签名／21文件hash、size、mode及ELF架构一致。早先本地server/dist漏最后catch修正是本地旧build，按提交重建后逐字一致；实际云端包正确。校验记录ignored logs/pool-followup-preview-package-verify.log，不能拿旧本地build声称漏包。
- Owner新增第三方付款开通失败自动退账户余额及新提示已明确授权，但要求先处理原批次，且所有补充一起修好后才正式发行。因此**当前不得打正式tag或发布新版**，先核原批验证终态再实现排队账务改动。

生产仅主控只读取证，没有OTA、宿主／客户操作或历史退款现场处理。最终资金去向修复的源码与验证证据待后续追加；本记录不是完成声明。
