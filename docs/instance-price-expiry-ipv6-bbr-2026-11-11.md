# 单实例续费价、到期停机、IPv6 与 BBR：本轮检查和修复

后续综合复审与四项新增边界修复见[2026-11-12综合审视](comprehensive-instance-review-2026-11-12.md)。较新源码／失败及验证以该报告与HANDOFF顶部为准；前次证据保留。

2026-11-11。Owner补充完后授权统一检查／本地修复；现有主控与原宿主管理通道仅授权查看。本轮源码候选面板v1.8.7、Agentv1.0.7，均未提交推送或正式发行；没有在生产改价、停机、冻结、重启、改配置／数据库、部署或操作客户数据。

## 生产只读发现

检查对象为实例#28/JHTONE、宿主seoul-amd-2。通过此前固定主控SSH身份、宿主原SSH pin及Incus mTLS证书查看，不接受新身份；数据库事务设置READ ONLY。原始脱敏运行记录与受限原日志保存在仓库外私有 `C:/Users/adminuser/.codex/private/payincus/hardening29/instance28-20261111.*` 与 `instance28-bbr-20261111.*`，未放入公开包。

| Owner现象 | 实际原因及证据 |
|---|---|
| 到期显示封停，但SSH可用／Incus仍Running | 数据库2026-11-10 10:45（北京时间）标为系统到期封停，原UUID／创建时间与实际客机匹配；无在途实例任务、恢复保护关闭。五分钟巡检反复报 `EXPIRY_STOP_IDENTITY_UNVERIFIED`。最新历史任务是旧worker的原地rebuild／COMPLETED、replacementState为空；身份解析错误把这条任务解释为缺失新客机身份，抛弃保存的原身份，导致一直拒绝远端停机。没有通过清DB或现场强制stop修复。 |
| 公网IPv6已经显示，却仍“配置中” | 宿主只有1条实际公网分配；实例mapping原已verified、configured=true，后来因数据库封停写成pending／`IPV6_INSTANCE_STOPPED`，展示函数仍返回pending。已分配／已验证身份和客机是否正在运行是两种状态，不能把正常停机显示成配置未完成。 |
| incus list有3条IPv6 | 全部3条`fdc8…`是内部ULA，公网仅1条`2603…`。两条内部地址分别用于TCP/UDP及默认／ICMP等协议：Incus要求显式端口目标不同于默认目标，两条都不能随意删除。第三条是同网桥前缀、由NIC MAC派生且带`mngtmpaddr`的旧SLAAC残留；旧cloud-init还保留过时eth1静态配置。不是3个公网地址，也不以隐藏列表代替网络修复。 |
| BBR仍cubic | 宿主和客机当前算法均cubic；宿主可用列表reno／cubic，默认qdisc=pfifo_fast，没有BBR持久文件。后续只读modinfo确认同运行内核的官方签名tcp_bbr模块文件存在；尚未加载。v1.8.6新接入prepare会尝试BBR，旧宿主升级和运行客户网络命名空间未有持续补齐。模块存在与已实际使用BBR分开。 |

只读检查时生产唯一backend active、NRestarts=0，版本仍v1.8.6，Agentv1.0.6。**生产#28仍Running／封停不一致，BBR仍未被本轮应用**；本地修复通过不等于线上已恢复。

## 本地实现

### 1. 管理员独占当前实例续费价，回池重卖按原价

再次做两轮检查，分别核金额／身份／账务和断线重试／界面：

- 真实PG复现设置最终价后仍锁历史AFF码，优惠结算会阻塞原已不使用优惠的续费。现最终价的手动、自动和报价路径完全不查AFF/VIP，未设置最终价者继续原优惠流程；保留原扣款、幂等与过期门槛。
- 浏览器复现畸形HTTP200仍报续费成功。新增单台／批量回执检查：金额、月数／日期、批量目标唯一性和成功／失败数量一致；畸形结果保留原请求编号、不报成功，重试取回原结果。客户报价核实例id和金额；同会话token更新不丢有效报价，换用户／目标或ABA仍失效。
- Owner强调用户不能改价后，真实JWT/PG专项复现普通宿主所有者通过旧宿主接口修改价格。现退役该写路径，有效管理员也只返回“请到实例详情修改”，不再写价格；删除旧宿主卡片与详情按钮、弹窗和新旧API客户端。
- 新最终价API与旧管理员差价API均经服务端当前管理员鉴权／事务再核，客户、宿主所有者、伪造管理员role／header、PAT／OAuth、过期／撤销会话均拒绝。普通config／rename注入billingPrice／renewalPrice等字段不写价格。
- 首次加强dist检查发现用户包仍含静态`renewal-price-edit`片段。现拆出管理员专用异步行组件，用户包没有按钮／编辑器／旧改价客户端；不是只靠v-if隐藏。桌面／手机列表18组及管理员编辑器18组三语／亮暗实际浏览器通过。
- 独立PG专项：旧用户实例改为¥1.23→确认删除后真实清理流程逐项核空→同一宿主重卖，新实例 `renewalPrice=null`、billingPrice=¥10，新购买账单=¥10。机器池定价1000分、影子商品价格保持；旧实例只保留历史续费覆盖价。远端空机清单是隔离替身，新销售后实际客机开通不属该定价专项证明。

详见此前[单实例功能报告](admin-instance-renewal-price-2026-11-11.md)，本节覆盖其中旧宿主入口仍可用的先前状态。

### 2. 到期真正停机

`registeredGuestIdentity`仅对旧**原地rebuild已完成、同宿主、目标host为空或相同、空任务状态**复用原保存UUID／创建时间。重建／迁移／换机、部分回执或目标身份不符仍拒绝；不读取现时同名客机来生成新信任。

原五分钟停机流程继续取得当前实例／宿主锁，核原UUID、完整创建时间、project与`ephemeral=false`；最新续费、转移、删除、恢复保护或在途任务优先。只有实际Stopped回读才算停机，失败继续保留封停和重试；不把DB封停当停机成功。

### 3. IPv6显示和内部地址

保存的mapping仍属原宿主／客机、已configured、全部ready且primary存在时，`IPV6_INSTANCE_STOPPED`只说明客户未运行；用户继续显示已确认地址，去掉虚假的“配置中”。缺验证、换宿主、配置失败和真正pending仍显示未完成，不自动变绿。

IPv6配置脚本只删除可证明的旧地址：同原管理前缀、精确MAC-derived EUI-64、实际`mngtmpaddr`标志、不是任何当前mapping；保留两条协议映射、静态地址、其他前缀、IPv4及客户文件。使用POSIX/BusyBox awk和固定shell算法，最小Alpine不依赖Python。重启后若旧网络程序再次产生旧地址，原自动IPv6协调器再核和清理；不重写客户网络配置，不承诺只有一条内部ULA。客户正常看到的公网仍按真实分配数量展示。

### 4. BBR自动补齐

新增Agent性能协调器，仅已登记管理宿主启动，约每分钟检查，单轮45秒／单命令4秒。优先探测当前内核并加载已有tcp_bbr／sch_fq，具备能力才写固定root配置和核实际算法；不升级／替换内核，不改余额、密码、客户磁盘或网络地址，不重启客户。systemd modules-load.d及OpenRC `/etc/modules`各自持久，已有配置／模块保持，symlink或未知管理员配置拒绝。状态通过heartbeat runtime.bbr报告applied／pending／unsupported和具体原因，辅助失败不阻断心跳。

运行的受管非特权容器经本机Incus清单绑定UUID、两次PID／状态、固定netns fd与当前宿主namespace区分，只进入客户**网络**命名空间执行宿主可信sysctl；不进入客户挂载空间或执行客户脚本。保持停机／Frozen实例不启动，身份／namespace变化拒绝，不放开客户特权。

本轮BBR自动调整覆盖宿主和Incus受管Linux容器；**VM有独立内核，本轮不修改现存VM的来宾内核设置**，不能将容器网络命名空间实证称为KVM客机BBR验收。未知内核能力明确unsupported，不靠盲装包／换内核达到bbr。必要客户端root自行更改设置后的受控复核仍依赖原身份与运行条件。

Agent源码候选从v1.0.6递增v1.0.7，历史tag／公开资产不动。未来正式发行须先完成同来源Agent验证并核新资产，不能只更新panel或复用v1.0.6来证明本批BBR已部署。

## 验证与证据

| 项目 | 本轮结果 |
|---|---|
| 管理员独占与旧用户入口 | `logs/renewal-price-adminonly-admin-only.log`：真实JWT／Fastify／PG客户／宿主所有者／伪造role各新旧接口拒绝，config／rename不可注入；原账务／最终价正常与授权竞态通过。修前旧宿主越权复现`renewal-price-admin-only-before.log`保留。 |
| 用户界面、管理员编辑 | `renewal-price-adminonly-host-ui.log`／`combined-admin-price-browser.log`，分别18组宿主列表、18组三语宽度亮暗编辑器和异常回执／会话／键盘通过；实际截图已看。 |
| 原价回池重卖 | `combined-resale-round4.log`，真实PG定价／清理／同宿主新买方账单通过。最初夹具无presets字段、缺原nat端口造成正确拒绝，已修夹具，产品库存门槛保持。 |
| 到期停机完整流程 | `combined-expiry-full.log`，独立空`*_expiry_test` PostgreSQL＋HTTPS Incus/Caddy，旧原地rebuild后的停机、只停原身份、重复／重连、续费／停删竞争与清理回池通过，最终passed=true、stopCount9／deleteCount5。`combined-resume-round2.log`原自动补续恢复及未知重建拒绝通过。 |
| IPv6状态与清理 | `combined-ipv6-final.log`真实PG停止／封停保留已确认mapping；`combined-ipv6-browser.log`三语两宽真实Vue显示通过；`combined-ipv6-legacy-awk.log`精确selector静态／当前／其他前缀保护通过；Linux串口实际BusyBox awk返回正确旧地址、exit0。未在生产删除地址。 |
| BBR实际Linux | `combined-bbr-linux.log`：Alpine3.24／x86_64隔离QEMU，实际内核加载和固定netns设置／回读、宿主保持／错误namespace拒绝、完整engine真实sysctl＋受控Incus清单、root配置／模块原内容保留与symlink拒绝，最后BBR_FINAL3_EXIT=0。先前整体测试资源先结束导致HOST_APPLY_FAILED保留；修测试namespace生命周期、未放宽产品命令期限。 |
| Agent | 本地performance单元通过；Linux目标AMD64／ARM64完整Agent交叉build通过、Linux目标全14个有测试包编译通过、全库go vet通过（`combined-agent-all-compile.log`／`combined-agent-vet.log`）。**未将全包编译称为全包实际go test通过**；本轮只实际执行performance包／Linuxnative。双架构AgentCI已增加nativeBBR，本轮未推送运行CI。ARM真实BBR与全部Agent原生回归仍需发行阶段独立实证。 |
| 前端／后端最终构建 | `combined-final-build2.log`完整pnpm build自然exit0、user/admin类型与构建、加强dist边界和server构建通过。`combined-final-build.log`首次用户按钮残留失败保持。user包无renewal-price-edit/dialog／旧客户端，admin包实际包含新组件。 |
| 守卫／清单／Lint | 最终9项`combined-guards-verified.log`与4项`combined-final-extra-guards.log`均全通过；总清单218项校验通过（新增identity守卫、resale／awk／browser活体归类）。相关ESLint0错误／无新告警、diff检查通过；未重跑全218项，不伪称全量CI已通过。 |

所有最终日志有独立`.exit`，源码精确sha256另存ignored本轮证据索引。中间失败保留。临时QEMU／HTTP传输／浏览器／测试进程已定向结束；主动关闭VM后串口logger出现ConnectionReset是清理回执，不覆盖内部BBR／awk自然exit0。

## 尚未部署与范围

这批修复没有应用生产，#28当前实际停机与BBR仍须owner按正式更新后核验；不自行代部署、stop／freeze或修改网络／价格。公网持续SSH／所有端口、完整低资源长期重启、ARM/VM原生和完整新包安装／OTA不由局部夹具证明。原Debian／ARM引导、旧版网页升级、真实OSS灾备／独立备用／千台72小时要求继续保留。

v1.8.7和Agentv1.0.7只是工作区候选，发行保持暂停，后续是否发布以owner明确指示为准。
