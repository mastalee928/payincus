# v1.8.7 发行验证记录

2026-11-12已公开发行 [面板v1.8.7](https://github.com/mastalee928/payincus/releases/tag/v1.8.7) 与 [Agentv1.0.7](https://github.com/mastalee928/payincus/releases/tag/agent-v1.0.7)。面板latest=v1.8.7。三轮审视后精修、提交推送、最终同来源CI、六片集成、双架构首装恢复和六公开资产均完成；没有代部署生产。

正式源码 `41077946d0c789fe510aff53dd67675b101ffe3c`，tree `0d402f51ebd098a8a0017ae6bfdbbd92133c9358`，与完整通过候选 `835f06c615b5727747cb41abc1f54c7f05ce0324` 同树。PR #10已合入；v1.8.7注释tag对象 `3bf8a977b594f1123f0d2f3921d9690e479123b9` 解引用正式源码。Agent公开source=`c99067be2c5d2e0439dc8abd9f9aea1b6a5ba778`，其后仅面板账务／测试／发行校验变化，Agent全部构建协议输入及最终asset逐字节一致，原Agent tag与资产保持，main工作流验相同后跳过重复发布。

## 三轮及本地证据

[三轮审视](instance-patrol-three-round-review-2026-11-12.md)覆盖管理员单实例最终续费价／用户禁改／回池原价、机器池宿主BBR自动修复与不可用售卖兜底、实际到期Stopped与截止远端容器／卷／快照／转发删除、五分钟自动判断／原任务续接及可售回收。

本机最终计价／权限／恢复竞态PG专项、完整停删／远端在途／自动回池PG＋HTTPS、原Agent断联配置恢复、双架构库存／目录／分配器、续费恢复和浏览器18组通过。双端完整build、严格用户dist、server tsc、Lint（0 errors，已有样式warnings）、固定Agent测试二进制自然exit0通过。218项守卫最初单轮在工具会话切换时中断观察，逐条184成功日志＋34项完整自然exit0覆盖所有218（旧VIP断言修正后另过），不冒充中断轮整体exit0；最终云端同来源218守卫及全部15项CI终态通过。

## 同来源运行

| 来源／工作流 | Run | 当前事实 |
|---|---:|---|
| f9e3055b Agent PR | 43124615703 | 全必需success，发布预期skipped；双架构hostBBR／客户保持native及完整Go |
| f9e3055b Agent预览 | 43124656028 | success，发布预期skipped |
| f9e3055b Alpine | 43124616178 | failure：两维护专项旧ONBOARDING_PENDING断言不接受新具体错误；七原生SSH分项success不当全绿 |
| f9e3055b CI | 43124616176 | failure：auto-renew-credit第225行发现整轮失败信号丢失；真Incus分项success不能替代整体 |
| f9e3055b面板预览 | 43124651492 | success，Release预期skipped；旧来源不能代替最终来源 |
| c99067be Agent PR | 43125282285 | 全必需success，发布预期skipped；已下载候选双ELF及LICENSE核hash／架构／hostBBR标记 |
| c99067be Alpine | 43125282383 | 全9job success，双维护失败闭环 |
| c99067be CI | 43125283000 | failure：同整轮补续信号回归，失败保留并在新来源修复 |
| c99067be面板预览 | 43125343124 | 全success／Release预期skipped；双包独立核242迁移、用户无编辑器、受信组件 |
| c99067be Agent发行 | 43125623656 | 全success；三公开文件下载与候选hash／size／API digest一致 |
| 9a2feaac CI／预览 | 43128955952／43128949024 | CI failure：旧心跳回执断言漏sourceCheckedAt；预览success，失败由后续修正闭环 |
| cb31b4ef CI | 43129303540 | failure：同旧心跳回执断言；产品受控字段及权限拒绝保持，后续修正闭环 |
| cb31b4ef Alpine | 43129303655 | 全success |
| cb31b4ef Agent | 43129303755 | 全success／Release预期skipped，最终artifact与原公开v1.0.7逐字节一致 |
| cb31b4ef面板预览 | 43129297857 | success／Release预期skipped，双包独立核验通过 |

| dc7b0f80分片CI／预览 | 43138469655／43138461754 | CI failure仅独立网关步骤被误加分片条件；六池片均success。预览success；新来源修复独立job |
| 835f06c6最终CI | 43138646402 | 15/15success：全部原236池步骤六片＋独立网关6步骤，未删测试／改命令／放宽时限 |
| 835f06c6 Alpine／Agent | 43138646313／43138646528 | 全必需success，Agent发布预期skipped；原生AMD64／ARM64 hostBBR与客户namespace保持 |
| 835f06c6最终预览 | 43138640777 | 双构建／双首装／恢复success，Release预期skipped |
| main CI | 43142231591 | 正式source，全部15job success |
| main Alpine／Agent | 43142231543／43142231877 | 全success；Agent发布校验来源输入与hash一致，跳过资产覆盖 |
| v1.8.7正式发行 | 43142302663 | 正式source，双构建／双首装／Release五job全部success |

所有必需终态已查，日志及精确hash存ignored `logs/release187-*`和最终索引；失败保留，新来源关闭问题。旧稳定v1.8.6／Agentv1.0.6未修改。正式与预览实际242迁移、唯一后台、公开Agent下载、完整本地传输备份／恢复／SQL／加密ZIP／续接通过，OSS为适配器不是公网灾备实证。

## 六公开面板资产

| 文件 | 字节 | SHA256 |
|---|---:|---|
| incudal-v1.8.7-linux-amd64.tar.gz | 214498305 | `d61948c466b415951230abcb4426604b4aebec4842a31f222186aa38b3ef552a` |
| incudal-v1.8.7-linux-amd64.tar.gz.sha256 | 100 | `381f117113f5618afeb61b8c34aee4b3c6b84922b06349e7916d7ffd704161cd` |
| incudal-v1.8.7-linux-arm64.tar.gz | 213725956 | `b7a11b87f1242d36a9fb7116e26bc0484c79bc96034dbbaf29d1c4de103b38eb` |
| incudal-v1.8.7-linux-arm64.tar.gz.sha256 | 100 | `8e1a90d35830ff49684dfff82a28000ebe37a4ff50f98f4457b6eadcaf722e48` |
| incudal-v1.8.7-ota-manifest.json | 1070 | `9f87c53e0b0f5c2057e135f71e031594628e7b5860b91c30c1643e0c34552d37` |
| ota-manifest.json | 1070 | `9f87c53e0b0f5c2057e135f71e031594628e7b5860b91c30c1643e0c34552d37` |

所有文件实际下载，API digest／size与hash一致；双OTA字节一致、架构URL／hash／size匹配tar。两个正式包核源码、242迁移、root归属／安全路径、用户dist无改价编辑器、管理员入口、巡查及远端操作模块、新迁移和前批精修。双网关签名沿v1.8.5原受信公钥独立验证，21文件hash／模式／ELF及sourceCommit确认，未信任包内新key。发行说明回读一致，latest=v1.8.7。

## Agent公开资产

| 文件 | 字节 | SHA256 |
|---|---:|---|
| incudal-agent-aarch64-v1.0.7 | 5177496 | `307122e5a5f38ca5106ad093c2226ab3016274d003cfeabbd91b1023155dad2b` |
| incudal-agent-x86_64-v1.0.7 | 5451928 | `7d33583531db78ca5c5e68310444aab1d0f25d57a8042c721575f90009c44ba5` |
| LICENSE | 1496 | `5659dbf51fa91752f85fe0fb6677086ac1fbc368768ac3d230a70af86afdad6b` |

实际下载核公开API digest／size、候选和最终build逐字节相同；native hostBBR实际回读、客户namespace算法保持、文件与修复进程保护、完整Go测试和双架构防护通过。模块工具缺失修复的包管理器为真实子进程适配器，未冒充实际Debian缺包安装。

## 发行范围及限制

新增nullable `instances.renewal_price`迁移，没有历史回填；只有管理员实例详情能设下次每期最终价，零元有效、不叠加AFF/VIP，不补扣退款、不改历史已付账期。用户及宿主所有者的旧改价接口已退役，用户包不含编辑器。实例彻底删除回池后新销售照原池定价。

BBR只给机器池宿主，新接入和已接入后台跟进，加载现内核模块／修索引／补受限kmod工具，程序配置漂移只追加固定值并保留管理员内容，实际bbr回读。无法安全开启保留原算法销售；不进入客户namespace、不换核或重启客户。主控／网关平滑持续校时、接入回执与续接、IPv6已确认显示／精确旧SLAAC清理的前批修复同时入包。

五分钟巡查确认真实Stopped；系统到期封停72小时截止未续费执行宿主Incus容器／磁盘／快照／专属转发删除，确认后结算库存。已付自动补续、管理员／客户权限与原身份维持；失联不能立即远程动作，恢复后自动核验续接。未知新身份或客户数据不能自动接纳／删除。

这次只发布软件。生产OTA／停删／配置／DNS没有执行。完整纯净宿主原生接入、ARM／Debian新引导维护、真实OSS全新B灾备、独立备用、客户公网全端口持续连接及千台72小时各自未验收。首装OSS为本地传输适配器，软件发行不能代替这些目标。
