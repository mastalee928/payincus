# 版本与验证记录

## 2026-10-31 R114 机器池规格保存的旧回执与弹窗修复

- inventory-r114-before.log真实Chrome复现卸载后旧成功仍toast（1≠0）。仅调整HostInventoryPanel规格入口：固定请求payload/目标/同步draft revision、当前管理员/原会话/存储与生命周期，账户/筛选/页切换或缓存停用清草稿；在途不重开/重复提交/关闭，旧结果不清当前草稿、不提示、不刷新。响应必须success=true且updated等于本次唯一目标数，合法磁盘档和架构继续保留；失败持久显示本地化原因并可用原保存按钮重试。其它组/SSH/协议写入与后端授权/审计合同不借本项扩大验收。
- inventory-r114-complete.log自然exit0：卸载零toast/额外请求，26组旧成功/失败（cache/account/sid/role/storage/目标和磁盘ABA/filter/page）、重复/open/close门禁、same-sid token更新、6坏回执、5非法磁盘、混合架构拒绝、两机器批量payload/真实数量通过。18组简繁英×1440/768/390×深浅实际输入/禁用/持久失败/retry/长名称/44px/Tab/Escape全部通过；18份taste报告零FAIL/零WARN，最终三宽截图已查看。API为可控边界，没有修改真实机器规格。
- 焦点检查初次失败：同步visibility回调早于Teleport form挂载；改表单ref post-watch后真实焦点进入。旧modal渐变、手机紫色按钮与深色hint对比度分别被实际taste拦下，局部黑白平面样式/中性focus/44px修复；原失败日志保留。原布局和一机一卖保持，无重新设计全机器池，背景其它区域不在本次视觉结论内。
- 最终产品冻结后inventory-r114-build-final.log两端vue-tsc/Vite自然exit0；guards-complete三项3/3（route/i18n/host-pool）、lint-final零诊断、dist、JS语法、YAML和198清单检查通过。早期build成功发生在最后焦点/样式改动前，不冒作最终证据。新增长期浏览器专项登记CI及活体排除。
- R120已推fe8634688b0699fc9d36a10ce72294bf1168f51a / CI41156853752；R121 2a32f9bb20f14da90bcbe57b059fb906d0dace2e / CI41156893704。ci-r114-final-refresh.log自然exit0，新增终态1cd70bdd518613eb1c9dc4ad017527723632fecb / CI41144490983 success，其余仍跟，未发现新失败。
- R114后313/327（95.7%，覆盖非完整验收）、14项初审；实际后端规格行锁等待后的当前管理员/审计同事务、所有其它库存弹窗与真实宿主尚待。预计剩余初审阶段6–12小时，未知复现及原生/外部/灾备不含在内，不能给全项目可靠完工日期；分段保存后继续。

## 2026-10-31 R121 Caddy 取消任务与锁释放前提复审

- 完整检查caddy.sh及其实际命令生成链：手工shell只有EXIT cleanup_caddy_install，负责暂存文件和失败时服务状态恢复；没有后台cancel接口、lease/flock、解锁后返回继续安装的handler。数据库也无Caddy安装任务，因此原外部分支“取消后释放任务锁仍继续修改”的前提不适用。
- 不因模型不同而声明信号处理完整：安装提交阶段的TERM/INT/进程崩溃、并发手工运行及系统配置回滚没有本轮运行实证，保留为Linux安装内部缺口。未改变shell、没有运行root安装或把网关任务混作Caddy任务，既有R116–119原生API/凭据专项边界保持。
- R090完整身份f0822dfb1d4bd1b1754c4f8ccb294fb582ccfe63 / CI41156787528；R120已推fe863468。R121后312/327（95.4%，含部分/待验收）、15项初审；CI刷新ci-r090-refresh.log自然exit0，其余终态持续跟踪，完整灾备未完成。

## 2026-10-31 R120 Caddy 后台安装任务前提复审

- 完整核对/hosts/:id/caddy/generate、reset、confirm及host-caddy-credentials。generate只在host行锁/current actor授权内生成或复用凭据并返回手工下载命令；reset是显式轮换；没有创建持久Caddy安装任务、覆盖任务记录或后台安装调度。schema仅有host的enabled/username/password/port配置。不能套用外部分支“安装任务与凭据同事务”的修法。
- 当前凭据生成/确认竞争仍由R118/R119处理：原授权/owner/credential快照和probe前后复核，review-caddy-proxy-final.log既有真实PG/Fastify/HTTPS证据保持。此轮仅代码复审，不重跑未变逻辑；它不证明远端shell安装失败后数据库/服务自动一致，也不覆盖审计写入失败和Linux安装。后续对应缺口保留，不把生成命令当安装完成。
- R089已推5c11482e553c42f98d0ba945c1f154f9d57d64ab / CI41156761493；R090已推f0822dfb，完整身份下一段登记。R120后311/327（95.1%，含部分/待验收）、16项初审，CI及项内缺口继续。

## 2026-10-31 R090 Agent dry-run 凭据遮蔽复验

- 共用R088的原脚本运行：systemd/OpenRC×一次性安装token/静态Agent凭据四组合，输出不含所植入token、secret或token模式的模拟secret，配置包含<redacted>，token下载路径包含<redacted-install-token>；每组合零下载/服务调用，未创建安装目录。agent-installer-second.log10用例自然exit0，原命令守卫/语法/清单均过，无产品修改。
- 范围仅安装token与Agent secret的普通dry-run输出；管理员自行传入带其它凭据的URL、shell调试trace、真实服务日志及崩溃恢复不由此证明安全。真实Linux安装/外部认证下载仍保留待验收。
- 完整已推身份：R088 a969d79686a2ad5f2254142240306b5741586d37 / CI41156714810；R089的完整身份随下一次CI登记。R090后310/327（94.8%，含部分/待验收）、17项初审。测试和文档分项保存，不新增三次产品修复；CI持续跟踪，未生产部署。

## 2026-10-31 R089 Agent 失败保留旧安装复验

- 复用R088完整原安装脚本的10用例运行。父目录被普通文件占用、下载失败、SHA256不符、暂存程序冒烟失败四种故障均非零退出；原binary/config/service逐字节cmp保持，服务边界零变更，前三种故障在领取token前退出；冒烟失败已领取token，不能误称仍可复用原token。暂存文件全部清理。
- 原脚本在冒烟成功后才备份和替换正式文件，对应原preflight覆盖旧安装问题已有防护。agent-installer-second.log自然exit0及R088同份语法/守卫/清单证据共用，无产品修改或无变化重跑。本条不覆盖提交后服务失败回滚、进程崩溃/信号或真实Linux启动，不以隔离文件保持替代那些验收。
- R089后309/327（94.5%，含部分/待验收）、18项初审；R088测试已推，所有阶段CI继续。随后归档R090并继续Caddy与其它未复验条目。

## 2026-10-31 R088 Agent 自定义新目录安装复验

- 新增test-agent-installer.mjs/sh执行未经改写的完整agent-install.sh：根身份、服务管理器和网络为边界夹具，临时目录、manifest解析、SHA256、文件staging、冒烟及正式文件替换真实执行。两个架构名称的全新嵌套目录均下载manifest成功，事件严格manifest→binary→token→smoke，最终二进制/配置/服务文件正确且无暂存残留；当前preflight先准备BIN/CONFIG/SERVICE父目录，原R088失败不再存在，无产品修改。
- agent-installer-second.log自然exit0，10个隔离用例全部通过（其余失败保旧及dry-run场景由R089/R090分别归档）；第一次夹具错误把shell的`[`参数算成2个、漏末尾`]`，导致假报systemd未运行，first.log保留，修为精确3参数。真实Linux init/systemd/OpenRC、原生amd64/arm64程序、外部下载和真实宿主心跳仍未验收；不将假uname架构当原生双架构实机。
- 现有agent-install-command守卫1/1、JS/Bash语法、198清单有效、YAML和diff检查通过。测试加入常规清单及CI独立步骤。Python无PyYAML及client无yaml的两次检查工具错误未算成功，改用仓库实际js-yaml解析；产品无变化，复用上阶段产品types/build，不重复无关构建。
- R191已推ab2bdfcecb56a7273362318bdeacc97e1f0c6bfd / CI41156261206。R088后308/327（94.2%，含部分/待验收）、19项初审；R089/R090随后分别登记，共用这次测试，不计成三次产品修复。所有CI继续，完整项目与灾备未完成。

## 2026-10-31 R191 Telegram 工单入口差异复审

- 核对实际注册的/api/telegram、完整webhook及telegramBotCommands：仅处理/start绑定、/join及别名、/join_vip、/notify；其它文本返回使用说明，没有reply_to_message消费者或工单写入。全库createTicket/addTicketMessage及Prisma工单写入只落在tickets/Public API调用链；notifier的Telegram工单通知为出站sendMessage，formatTicketReplyNotice明确要求前往工单页面查看。原Bot等待锁后回复的运行前提在当前仓库不存在，不新增Bot工单功能。
- 本条为代码级复审，无产品修改、无外部机器人消息；不以此声明绑定/入群授权完整通过。网站与Public API工单授权仍保留R186/R187及后续专项证据/未验收范围，不重复未改源码的构建。
- 上一阶段完整身份补齐：R318 261f1bf3a875f5b2dc6f8063bff518aa55cc4bf0 / CI41155393398；R322 7f2b326f3d8adee72a88c49755cf9ba5f5344d43 / CI41155941672。ci-r191-refresh.log自然exit0、逐run核完整head及job；新增终态c32e82d9e81e4ba3627851f265d054a44d678e2a / CI41144444144 success，其余继续，未发现新失败。
- R191后307/327（93.9%，覆盖而非完整验收）、20项初审；FIXES顶部旧290统计已同步，历史阶段原样保留。当前工作区此前干净，上一阶段均已推送；本条保存后继续Agent安装器与Caddy复验，所有CI跟终态。完整项目与灾备尚未完成，无生产操作。

## 2026-10-31 R322 管理员创建页繁体错误承诺免费

- 简体和英文已说明免费/付费，繁体仍为“為使用者贈送實例，無需支付任何費用”；admin-r322-before.log真实切换繁体后断言失败exit1。仅修改繁体description为“為指定使用者建立免費或付費實例”。当前freeGiftHint无Vue消费者，不能沿初审声称它仍在免费分支显示；实际免费/付费由原单选及计费摘要控制，未改计费逻辑。
- admin-r322-final.log自然exit0：真实管理员页面机器池/原套餐两入口×简繁英标题语义一致，原懒加载/失败重试/空结果缓存回归；繁体1440/390截图已检查无横向溢出。对应route/i18n守卫2/2、pnpm build:client（两端vue-tsc+Vite）exit0，dist边界另检查。仅受控API，没有真实付款/赠送或实例交付；后端沿R276相同源码通过证据。
- R318已推261f1bf3a875f5b2dc6f8063bff518aa55cc4bf0，run ID待下一轮登记；新增终态bb5895f67d4f740e3268ce496df647e2480bb531 / CI41144078810 success，4c90055b2e31d3a5e986f22f003258f7c9bb0733 / CI41143664537 success。其它运行继续，无新增失败。
- R322后306/327（93.6%，含部分/待验收）、21项初审；初审语义遗漏已记OWNER_REQUIREMENTS。完整项目验收及灾备仍未完成，固定v1.7.8未更新、生产未部署。

## 2026-10-31 R318 重装后启动提示复审

- RebuildModal实际显示rebuildModal.manualStartHint，简繁英三份当前值均明确自动启动；英文为“The instance starts automatically after rebuilding.”。旧key及源码注释含manual字样不等于用户仍看到手动提示。executeRebuildTask在rebuild后调用startInstance/IPv6恢复启动，随后等网络并记running，与当前提示一致；未作无必要key重命名。
- 既有2026-10-25密码重装/Alpine自动running记录保留为历史测试站证据，不视作当前源码所有系统或生产验收。当前三语i18n/route及双端build沿R276通过，无产品改动、不重新触发实例重装。R115已推64a6e0fdd84c0e46da5169d363e5606199b70314 / CI41155317977。
- R318后305/327（93.3%，含部分/待验收）、22项初审；原生各来宾/在途任务等内部缺口继续，所有CI跟终态。

## 2026-10-31 R115 库存数量输入与一机一卖模型复审

- HostInventoryPanel中stock只用于available/assigned/unavailable筛选，没有可清空的库存数量输入。规格表单只有E2/ARM预设与30/60/90/120GiB选项；updateSpec提交hostIds/resourcePreset/customerDiskGiB，后端schema必填且额外字段拒绝，磁盘整数下限10。库存汇总来自真实机器、占用/预留/故障/定价与就绪状态，未找到“空库存转0写入数量”的调用链，不引入多租户数量模型。
- inventory-r115-guards.log实际host-pool守卫1/1通过，当前规格/容量/独占约束保留。无产品改动，复用刚过双端及后端build/types；本条仅确认输入模型差异，R114异步规格编辑和完整库存在途授权等仍待，不把该结论当全库存验收。
- R209已推0035148b75e1bbb6b3f6b9207610f171d831ce89 / CI41155230467。R115后304/327（93.0%，含部分/待验收）、23项初审，所有阶段CI继续，原生/外部服务/灾备边界保持。

## 2026-10-31 R209 镜像选择器事件监听生命周期复验

- 原onUnmounted按同回调及capture移除document click/window scroll/resize已有防护，不改产品。image-r209-final.log自然exit0：实际Vue/Vite/Chrome普通/embedded各20次挂载卸载，跟踪真实EventTarget callback身份与capture，120新增=120移除，未匹配删除0、每次卸载残留0。实际外部点击关闭、Ubuntu选择、滚动/resize、打开菜单卸载后的Teleport DOM清除均通过，控制台零错误。
- 新长期专项/夹具已登记CI及活体排除理由；JS语法、197清单及前端route守卫通过。沿相同产品源码刚通过的R276双端/后端构建与类型证据；未修改完整创建页或发出资源创建。此专项不涵盖KeepAlive停用及其它异步创建流程，不能扩张为完整交付验收。
- R306已推0088991d78544e994da09b5ad0b38041825842cf / CI41154886055；R246已推9a6687b9474fefb0f72660041f1f3c41b6155170 / CI41154930643。R209后303/327（92.7%，含部分/待验收）、24项初审；各阶段CI继续跟踪，固定v1.7.8及生产不变。

## 2026-10-31 R246 资源选择组件当前消费者复审

- 实际路由/模板链仍有效：用户/管理员instances/create分别加载InstanceCreateView/AdminInstanceCreateView，MyHostDetailView的create标签加载HostCreateInstanceTab；三者渲染PackageSelector及非付费等条件分支的ResourceSliders，后者实际渲染CPU/内存/磁盘ResourceSlider并向父级写对应字段。不是仅剩测试引用或只有失效import，“全退役可删除”的前提不成立，保留组件。
- 无产品修改；沿同源码刚通过的R276双端build/dist和前端route守卫，未为复审触发客户创建，也不把模板消费者存在当资源交付验收。独占一机一卖、全端口要求和原资源授权待验边界保持。
- R276完整提交c4bf29564b0a0ed6e31cbe09ab4f68f2d7a07ca7 / CI41154813564，原R306随后归档0088991d。R246后302/327（92.4%，含部分/待验收）、25项初审；完整验收仍未完成，CI继续跟踪。

## 2026-10-31 R306 空 IPv6 新节点重复条目归档

- R306与R276引用相同MyHostConfigTab入口，均指合法空IPv6新节点编辑被挡。此次修复及POST→PATCH、真实行锁并发保新配置、浏览器三语三宽和全部types/build/守卫证据完全共用上一段；没有第二次产品修复或无变更重跑。R111“清空既有配置”仍分别保留：mode2/3允许、已有route配置不允许。
- R306归档后301/327（92.0%，含部分/待验收）、26项初审。该数字包含重复条目，不是独立bug数量或完整验收率；原生宿主、外部服务和灾备缺口继续。R276源码已推c4bf2956，完整SHA及CI在下段登记。

## 2026-10-31 R276 空 IPv6 新节点无法保存无关配置

- 初审遗漏真实产品问题：POST允许ipv6Mode=1且subnet/parent均空，MyHostConfigTab与PATCH却要求补齐。host-r276-before.log真实新建201后PATCH描述400；host-r276-browser-before.log真实输入/保存无请求，两者自然exit1。页面仅在有新子网或既有路由配置时要求接口；后端允许原/新两字段均空的无关修改，并省略该空字段写入，避免覆盖并发新配置。
- host-r276-final.log自然exit0：原POST新节点、描述/通知修改、完整其它host字段保持；只补半组拒绝，完整补齐成功、补齐后清空拒绝。真实PG行锁中先补齐IPv6再释放，旧空表单等待后仅改描述，保留新subnet/interface；原mode2/3清空、省略保持、外人拒绝及route-mode清空拒绝均回归。未执行安装脚本、Incus或真实宿主修改，当前身份/模式在其它时序下的并发仍不扩大验收。
- host-r276-browser-verified.log自然exit0：四种mode空字段保存、三语×1440/768/390实际输入/保存、原清空与错误草稿矩阵通过；三宽截图已看，沿用原布局，修正空节点必填标记。完整server+专项/client类型零诊断，3对应守卫及i18n通过，完整pnpm build双端/dist边界/后端自然exit0。第一次守卫逗号筛选未匹配，改重复--only后真实3/3，失败日志保留。专项原CI登记沿用。
- R010已推d347c861ace5188c6956e6c756c05686cb007dcf / CI41153911142；新增终态8af9c430ae9c675e91e0cc1dc6d9514d1da5c22d / CI41143353879 success，672405c45b7ae1eb6df8137dfabe48582565b6c0 / CI41143973573 success。其它阶段继续跟踪，无新失败，历史失败保留。
- R276后300/327（91.7%，含部分/待验收）、27项初审；R306为同一入口随后归档，不算两次独立修复。原生宿主/外部服务/完整灾备仍未完成，固定v1.7.8未重打、未生产部署。

## 2026-10-31 R010 当前鉴权状态复验

- 从app.ts原文抽取ensureActiveAccessToken/ensureCurrentAdmin及四个实际decorator，不改写实现，装入隔离Fastify并使用真实JWT和PG。auth-r010-final.log自然exit0：37请求确认热请求后用户名更新、管理员降权/恢复、banned、session及账户撤销立即生效；其它账户/会话保持可用，iat等于撤销时刻拒绝、晚于时刻允许。用户或撤销查询故障、坏/缺JWT及已删除账户均拒绝；未发现30秒正向授权缓存，无产品修改。
- 完整server+专项类型auth-r010-types-verified.log零诊断exit0、auth-session-status守卫1/1、197项清单检查通过。先前两份types失败来自测试role与iat声明和Prisma故障替身类型，已修正且日志保留；故意注入的查询错误属预期拒绝场景。专项已登记CI；复用相同产品源码的R268后端build，不将隔离原hook执行扩大为完整app登录、在途操作授权或生产验收。
- 补齐已推阶段完整身份：R060 87bc652acaffe5685850bdeac198432016b240c4 / CI41153025903；R069 12d63b3f48c91db6ca80960a7c7cc2e086c4a0c5 / CI41153071656；R223 cbebd0b4443bbb0024c87eadef38a066c6ab5da6 / CI41153135756；R300 3af8cc3e66a2efd8ac8ee91db0b91c85f0331e36 / CI41153252864；R327 de54e2abb25e27b105f3d2e3f1b5b08896a0bd55 / CI41153336748。logs/ci-r010-refresh.log及各run状态核head和步骤，后续CI继续，未新增失败。
- R010归档后299/327（91.4%，含部分/待验收）、28项初审。不是完整验收率；固定v1.7.8、生产和完整灾备未改变。继续检查IPv6空配置新节点与无关字段保存。

## 2026-10-31 R327 删除集成测试证书清理顺序复审

- 完整追到test-admin-instance-delete-integration.ts的TLS资源生命周期：115行创建独立临时目录/证书，174–372行全部单/批用户及管理员删除、在途退款、失败保库存用同一TLS服务；373行finally先closeAllClients再close服务，最后校验绝对临时路径并rm。清理之后只有成功日志和外层app/DB关闭，没有后续代理测试再用已删证书。本库TS专项与外部所述脚本顺序不同，原问题不适用，不无故重排清理。
- 此次代码审查不重跑已验证删除矩阵，不将资源生命周期复审当客户销毁或财务验收；既有证据和失败边界保持。R300文档已推3af8cc3e66a2efd8ac8ee91db0b91c85f0331e36，R327归档后298/327（91.1%，含部分/待验收）、29项初审。

## 2026-10-31 R300 钱包转账入口差异复审

- 逐项核WalletView全部API调用与用户路由：余额/明细/充值单查询、重付/取消/新建和AFF操作，没有用户间余额收款人选择、报价或转账提交入口；transfer_fee/refund仅流水类型映射。/transfers指实例转移，/hosting-wallet是托管收益，不能把同名词当作外部清单的余额转账界面。
- 当前前后端API搜索未发现对应余额转账/预览合同，本项记实现不同、不适用原输入竞态；不新增未授权转账功能。现有钱包读取/充值回执与财务并发仍按原其他编号及HANDOFF证据，代码级复审不等于全钱包验收。无产品变更，不重复无关构建。
- R223文档已推cbebd0b4443bbb0024c87eadef38a066c6ab5da6；R300归档后297/327（90.8%，含部分/待验收），30项初审。CI继续，未生产操作。

## 2026-10-31 R223 AFF 守卫退役依赖复验

- 原两个AFF守卫和当前AFF eligibility专项的直接导入/源码读取已核：守卫读现行mail.ts、mail-autorenew-scheduler.ts及AFF/计费路径，未发现所述已删除邮件模块，相关文件真实存在；不是断言前必然失败的旧脚本。实际aff-r223-guards.log执行两守卫2/2自然exit0，不只检查清单脚本名称。
- 未改产品，不新增相同字符串守卫或重跑未变构建；两守卫仅证明当前断言运行和对应源码约束，不等于真实财务/外部邮件验收，AFF事务专项证据与内部缺口保持原编号。R069文档已推12d63b3f48c91db6ca80960a7c7cc2e086c4a0c5。
- R223归档后296/327（90.5%，含部分/待验收）、31项初审，所有新提交CI继续跟踪。

## 2026-10-31 R069 实例备份后端“已退役”判断复审

- 当前app.ts正式导入并注册backups到/api/instances、storage-configs到/api/storage-configs；唯一后端listen后的正常启动路径清理并启动restoreTaskWorker与backupUploadWorker，非测试专属挂载。上传worker实际调用StorageFactory.create，host-replacement亦消费远端备份；用户API保留get/create/delete/export/upload方法。原外部“明确退役后端只被测试强行挂载”前提在此仓库不成立，不删除可运行后端或provider。
- 本项为当前源码调用链复审，无产品修改，沿既有受影响build/types证据；未为证明入口而另起第二个后端或触发备份任务，不把注册存在当作真实OSS/磁盘恢复验收。R069独立从初审转为实现差异确认，R070孤立StorageSection及provider分别继续，不混同。
- R060文档已推87bc652acaffe5685850bdeac198432016b240c4。R069归档后295/327（90.2%，含部分/待验收）、32项初审；覆盖率包含不适用/重复项，完整修复与验收率仍不能由此推出，CI与内部待办继续。

## 2026-10-31 R060 退役恢复前端重复清单归档

- 复核R060原描述与当前文件/引用：BackupManager.vue及restoreTask.ts已在5b056333035d145037fd75acec79f099eea8470a随R059删除1215行，当前client/server/scripts无BackupManager/useBackupStore旧运行引用。原双端build、route/i18n/backup-task-race/core四守卫及dist证据见R059；没有重复删文件或用清单编号制造第二次产品修复。
- 实际实例backup/storage路由及restore/upload workers继续存在，平台OSS恢复组件仍保留；R060仅指不可达旧恢复跟踪前端，不代表后端退役或完整备份验收。此次代码复审无产品改动，不重跑未变的删除验证。R268已推adfb0b99e13290fb045ff82e92a9ad431b6e8142 / CI41152885260，完整head已核、排队中。
- R060归档后294/327（89.9%，含部分/待验收）、33项初审；R059/R060共享一次实现证据，294并非独立bug数量或完整验收通过数，原完整灾备及各项内部缺口继续。

## 2026-10-31 R268 VM 网络修改丢失 MAC 匹配修复

- 原初审只看到调用方传nicMacs，未核生成器实际读取；vm-network-r268-before.log退出1证明输出没有match/macaddress。generateCloudInitNetworkConfig现验证并输出各网卡MAC匹配；同步/移除沿现有设备、expanded设备及volatile取真实身份，不把已有VM网卡的未知MAC猜成按名称新生成值。VM缺主网卡/既有IPv6网卡身份时GET后拒绝、零PUT/重启；新增eth1才生成并与设备同值，继承设备及IPv4地址保留。
- vm-network-r268-guards.log四项4/4（新运行专项、原IPv6恢复、独占交付、宿主IPv6）与完整server+专项最终types、后端build、197清单检查全部退出0。新专项另经实际IncusClient/本机mTLS序列运行vm-network-r268-transport.log退出0：显式/volatile/expanded/继承主网卡/新增IPv6、继承IPv6设备、移除保主MAC、三缺失身份、PUT失败零重启、容器原命名配置与非法MAC拒绝；磁盘/代理/profile/description/原config和UUID保持。常规运行与mTLS专项分别登记清单/CI。
- 仅生成配置及隔离mTLS证据；真实VM来宾重启和网络持续性、IP路由在途授权与持久失败、继承网卡移除及原默认地址回退等边界未扩大验收。无真实客户配置/重启或生产操作。R273已推eb032df272c2546c052e288d720d87652112ad29 / CI41152322538；新增终态41141251933/6470b529fe4031ce543589874234879ad872fbf2、41141331712/31a627ee3ffa38ba71835c0bfd65fa028755f0f7、41141678816/121df3ff36b70717bc07723ca163c31eca1c9c46、41142013356/76d1d6e58e6f6de2c7103fb45344e0645ec391ca均success；其他提交继续跟踪，无新增失败。
- R268归档后293/327（89.6%，含部分/待验收）、34项初审；完整项目与灾备验收仍未完成。

## 2026-10-31 R273 单端口审计失败与设备回滚边界复验

- 当前helper边界有效，未改产品。沿原PG/Fastify/mTLS批量专项补真实logs INSERT触发器：TCP/UDP各一次审计失败均到达原createLog，成功映射和精确设备保持，重复请求PORT_IN_USE且零设备写；原13条映射和设备保持。另真实Incus PUT500撤销本次DB预留，旧设备/映射/余额/账单保持，失败审计一条，端口锁释放。日志port-r273-final.log自然exit0，原R139/R140完整回归同过。
- 完整server+专项types零诊断、port-mapping-safety守卫1/1退出0，未改产品复用package-r266-build；原专项已在CI。第一次新增断言误把宿主库存快照计数当单端口实时计数，实际原helper只写port_mappings，改为保持原宿主计数、另严格核完整映射行及远端设备，失败日志保留。审计缺失的持久补录、强杀后恢复、原生Incus和公网数据面另验，本项不改变一机一卖全端口。
- R266已推5da88518935a8df2c8898be5d0e3314e08d82c5d / CI41152056846，已核完整head与job，正在排队。R273归档后292/327（89.3%，含部分/待验收），35项仍初审，完整项目验收未完成，后续源码CI继续跟到终态，无生产操作。

## 2026-10-31 R266 地区查询私有套餐过滤修复

- 纠正原“已有防护”初审：真实Fastify/PG普通用户传source=all，200返回其他用户与管理员私有套餐编号及地区，package-r266-before-product.log自然exit1。仅TypeScript来源联合类型不能校验HTTP输入；地区入口现明确拒绝未知、空白及重复来源，公开分支基础查询默认globalShared=true，四种合法来源及好友授权保持。
- package-r266-final-product.log自然exit0：四来源/default、两用户独立分享、同宿主混合私有绑定、屏蔽/停用/不存在专区、8非法来源和8非法专区编号、公开地区5来源及普通用户伪造admin scope均核。管理员正常托管列表与owner邮箱可读；整组用户/套餐/绑定/方案/专区/屏蔽/账目/审计快照保持。认证为隔离hook，原JWT/当前管理员校验及真实网页端到端不是此专项证据，无宿主连接或生产数据操作。
- 最终完整server+专项types零诊断、3/3套餐/共享/托管ID守卫、后端build与测试清单检查全部退出0，专项登记Linux CI。初次Logo夹具违反原HTTP URL约束、runner从根目录找不到tsx、复制来的250ms连接期限导致夹具连接超时、专项类型推断失败分别保日志，均不是产品泄露证据；runner改server目录及产品默认5000ms，仅类型标注修正后的运行逻辑不变。
- 线速修复2f507291a29148b6e21683aaae1066acc2d25e17已核远端，对应CI41151264665。新增终态CI41140946141 / fe1a9316531b86b9b4b808f25dcba1517f8f3a81全部success；本轮所有已存待定CI均刷新具体job与完整head，logs/ci-r266-summary.json保存结果，无新失败，旧41134810809失败继续保留。v1.7.8固定c77b68c5aab9d3e6f48f4091c7dce111c055465a的正式/预览/文档继续success，不含本段后续源码。
- R266归档后291/327（89.0%，含部分/待验收）、36项保留初审。不是完整验收率；原生交付、在途读取授权及完整灾备等各项内部缺口仍按原记录继续，未部署生产。

## 2026-10-31 套餐线速单位换算溢出修复

- plan-bandwidth-overflow-before.log退出1，真实创建接口把307位数Gbit换算成InfinityMbit仍返回200并保存。normalizer对单位换算结果要求正安全整数，旧纯数字字节格式先BigInt换算后检查安全上限，避免非有限/失真数值继续进入带宽仲裁和Incus；正常小数Gbit、空值/0及旧字节格式保留。
- plan-bandwidth-overflow-final.log退出0：原220字段矩阵加5种溢出×创建/更新共230拒绝请求，完整记录保持；正常上下界及1.5Gbit通过。新增运行守卫验证两种格式的安全整数最大值、超界/乘法溢出、400位字节数及正常小数换算。完整server+专项types零诊断、线速/流量/方案3守卫3/3、后端build均退出0。
- R267已推168dc2046a13c3bc5ceb51b8a01264ddfe72555f / CI41151016588；新增终态41140251020 / 01e1e2c09a149b29e1699df0b4cefdd3e921ff54、41140423395 / ba1e4b3cbd3c14097f144a0785e2f52127a3ba93全部success。已刷新其余待定运行具体job，未发现新失败，完整记录logs/ci-state-<run>.json。本补修不重复增加290/327（88.7%，含部分/待验收）及37初审；既有不合法存量数据未迁移、原生带宽交付另验，无生产操作。

## 2026-10-31 R267 套餐方案资源及金额边界复验

- 原方案normalizePackagePlanInput资源/金额/流量校验有效，未改产品。package-r267-boundaries.log退出0：创建/更新共220个非法字段请求400，覆盖11整数范围/类型、小数、空值、PG bigint、布尔、重置费、SLA与非法线速格式；每次完整用户/套餐/方案/审计/账目保持。其它用户403；合法低/高边界逐字段核DB，流量PG最大值及1.5Gbit→1500Mbit准确，零实例交付。
- 完整server+专项types零诊断、方案输入及BigInt两守卫2/2退出0，专项登记CI。未改产品复用batch-r022-build。该范围不代表已有实例配额传播/当前权限在途竞争或超大线速换算已验，后续继续；现有schema union strict提示保留，不等同失败。
- R140已推76b0b3f10b1989d84654636dca80e4ebf620262f / CI41150644583；R267归档后290/327（88.7%，含部分/待验收）、37初审。完整验收仍未结束，所有推送CI继续跟踪，未生产操作。

## 2026-10-31 R140 旧共享NAT重提范围边界复验

- 沿原R139真实PG/Fastify/mTLS专项扩展，产品统一finalMappings范围/配额检查有效。ports-r140-boundaries-final.log退出0：新增tcp/udp/both分别超出两端6场请求拒绝且映射/设备/余额/审计/宿主计数保持；真实下界10000与上界10100各both成功，DB与mTLS设备对应，合计13条准确映射。原缺项/重复/数组/private区间、both双配额、自动分配及409建议后重提全部保持。
- 首轮新增合法边界放在自动分配后，10000已被同轮分配，原正确报占用导致测试失败；把显式边界验证移到自动分配前，未改变产品冲突规则。类型首次protocol数组被推断string，固定字面量后最终完整types零诊断、端口安全守卫1/1退出0。原专项现补入CI；临时目录删除先验证绝对路径属于系统temp。本项不涉及专属机器全端口/用户界面，不改变一机一卖。
- 无产品修改复用同产品batch-r022-build；原生Incus、外部公网数据面与完整灾备另验。R029已推e7bc5d5aa692b8c22a69417f6f40371d77fac85a / CI41150341170，新增CI41139600444 / 3538403ec31d939f70f3c319bf233aa55acf051f全部success。归档后289/327（88.4%，含部分/待验收）、38初审；所有已推阶段继续跟终态。

## 2026-10-31 R029 自动续费关闭与旧候选竞争复验

- 原资格条件有效，无产品改动。renew-r029-selection.log退出0：running/stopped/因到期暂停三状态通过原updateAutoRenew关闭后旧候选各重试3次，完整账户/实例/流水/账单/站内信保持；重新开启后各8并发只一笔续费与扣款。真实行锁使续费进入后等待账户行，关闭请求按原规则返回忙而不是虚报关闭成功；到账后关闭成功，后续再次自动续费零扣款。
- 三次失败上限、1小时重试间隔、待删除/待清理、手动暂停5种在途候选变化均拒绝且完整快照不变；共4次合法续费，余额100到60，4条账单/流水，池全归还且无idle事务。只调用原数据库计费函数，不执行宿主开停或调度器外部通知，不将此扩大为自然调度及公网数据面验收。
- 最终完整server+专项types零诊断、两计费守卫2/2退出0；首次类型失败为未使用Instance导入，已移除，保留日志。未改产品复用batch-r022-build，专项登记CI。R023已推dfa92b1bf3cc061496ad907ed4b308ef8a931395 / CI41149979889，R022 1857957813d3b6b3eb3b93e95a50d5ab15574fe8 / CI41149736312；新增终态41139128809 / 9d4f4c2c829b7484eb06d3443d43f38447f64c57及41139402498 / 97ad2b6f828c9d7d7c606a45cedfc6354a5b7c1f全部success。
- R029归档后288/327（88.1%，含部分/待验收）、39项初审。所有已推阶段CI继续跟踪，完整项目和灾备验收仍未完成，未生产操作。

## 2026-10-31 R023 批量流量限额边界复验归档

- 沿R022同一batch-r022-input-complete退出0，原parseNullablePostgresBigIntInput有效，无新增产品修改。原Fastify/PG入口17种负数/小数/后缀/指数/溢出/非法类型拒绝且完整user/host/instance/ledger/audit保持；正常0、1、9007199254740993、9223372036854775807、空白包裹合法整数、空串和null共7种精确入库，不经过JS浮点取整，完整其他字段保持，仅原version+1/updatedAt按正常更新。
- 同一正常双目标请求与7次流量更新共8条汇总审计，其他实例不变、余额与宿主资源不变、零Incus连接。原批量完整回归/types/build及批量守卫已过，另resource-quota-bigint守卫1/1退出0；无变化不重跑。真实宿主数据面和强杀后对账另验。
- R022已推18579578，本条归档后287/327（87.8%，含部分/待验收）、40项初审；完整验收仍不可用327减287推算。所有阶段CI继续，历史失败保留；未发新包或生产操作。

## 2026-10-31 R022 批量目标完整性与编号上限

- 原完整性检查有效：含creating/deleted/另宿主/缺失目标的请求全部拒绝且有效目标不变。补查PG Int上限复现混入2147483648返回500，batch-r022-input-before.log退出1；标量host parser及实例ID集合补2147483647上限，仍沿原角色/全部目标检查及写入流程。
- batch-r022-input-complete.log退出0：19非法/不完整target请求全部400，非宿主owner403，完整user/host/instance/ledger/audit保持、零Incus connect；正常running+stopped两目标均成功且计数2。另17非法流量及7合法边界同专项通过，流量证据随后按原R023归档。
- 完整server+专项types零诊断、批量配置守卫、后端build及原PG批量授权/任务/归属/行锁/计数故障回滚专项均退出0。夹具最初误以为成功更新不加version、将两目标单请求审计数算成两条，依据原写入version+1及每请求一条汇总修正，两个失败日志保留；没有放宽目标或金额断言。新专项已登记CI。
- 卡密编号修复已推27b96b76147fc246b1430ba912828d72a66d61ed / CI41149368730；新增终态CI41138737969 / d5a02f0f7385fa1fc7ca3d21c343009a8f1ed659全部success。R022归档后286/327（87.5%，含部分/待验收），41初审；原生Incus、强杀后对账与完整灾备保留，未操作生产。

## 2026-10-31 卡密编号上限与混合批次拒绝

- gift-ids-before.log退出1复现真实产品缺陷：ids含有效用户出资卡与2147483648时，先禁用有效卡、将余额18退到20，再PG整数越界返回500。scalar parser与normalizeIdList补2147483647上限，在调用任何单项/批量写入前拒绝；未重构批次事务或退款规则。
- gift-ids-final-complete.log退出0：57个非法编号请求覆盖管理启用/禁用/删除、用户撤销和两批量入口，混合批次完整cards/users/ledger/audit保持；4个合法上界不存在编号404；正常管理员批量禁用和用户重复撤销各只退款一次。用户真实出资、余额/退款流水检查，认证为隔离hook，未操作真实卡密或生产资金。
- 完整server+专项最终types零诊断、卡密守卫1/1、后端build及原财务授权/故障回滚回归均退出0；首次专项类型诊断因InjectOptions.url可以是对象，改断言提示为String，不影响产品或断言范围。新增专项已接CI与清单。此补修沿卡密编号不新增327计数，285/327（87.2%，含部分/待验收）、42初审保持。
- R043已推5a0cdeb413b0c150284974659501e9b7c5cffa7c / CI41148971640；最新CI未见新失败，全部推送阶段继续跟终态。固定v1.7.8不包含本段后续源码，未新发版或生产部署。

## 2026-10-31 R043 卡密生成数量与总面值复验

- 原数量schema与DB安全整数检查有效，未改产品。gift-r043-counts.log退出0：真实Fastify/PG管理员批量入口拒20种非法数量及缺失数量，DB直调另10种非整数/溢出/NaN/无穷均拒；每次完整用户、卡密、ledger、审计快照保持。3种总面值/入账值超限拒绝；1/2/499/500张真实生成共1002张，返回和存储ID集合一致、代码唯一/格式正确、金额及100000总面值上限正确，4条批次审计，用户余额不变且零余额流水。
- 身份hook提供隔离admin，原allowlist及事务当前资格执行；只临时设置本进程环境allowlist且finally恢复，未改全局配置，所有卡密/审计/用户精确清理。完整server+专项types零诊断、卡密守卫1/1退出0，专项已登记Linux CI；相同产品build沿上一已过结果，不重复构建。
- R035已推83c5874667e3766725a843779d520cf934ff5a77 / CI41148700715。新增终态CI41137537472 / 48f5a82dcdb605754b348bef202c795932b98ea3全部success；最新各阶段继续跟踪。R043归档后285/327（87.2%，含部分/待验收），42项保留初审；卡密编号PG上限仍需单独核查，完整验收及灾备未完成，生产不变。

## 2026-10-31 R035 充值终态真实行锁竞争复验

- 原产品状态条件有效，没有修改产品源码。test-review-recharge-terminal-states使用真实PG原DB helper：13种到账先持订单行锁、失败/取消/元数据/过期更新随后真实阻塞；另8种失败/取消先排队、到账后排队。全部核pg_blocking_pids实际等待链，事务释放后仅胜出状态可写，余额与13条到账流水精确一致，4条失败站内信只来自真正失败转换。
- recharge-r035-terminal-monitor.log退出0：21场竞争加completed/failed/cancelled/refunded的28次终态无修改检查，完整记录含metadata保持，重复完成不再次入账，已有expectedPaymentDetails冲突语义保持；池全部归还、无idle transaction、零外发。此为隔离DB函数证据，支付路由真验签另见上一节，不代表真实供应商付款或生产验收。
- 首轮夹具用了不存在的inactive枚举；第二轮观察pg_stat_activity复用持锁事务的统计快照，看不到新连接导致8秒等待并触发5秒事务超时，两份失败日志均保留，不算产品状态机失败。现用独立autocommit只读观察连接并将观察上限压到3秒，实际21场竞争共约6秒结束；未增大产品事务timeout。
- 最终完整server+专项types零诊断、3对应守卫3/3已收退出0；专项已登记脚本、清单与CI。未改产品，后端build沿用同产品源码recharge-callback-race-build。前段352cf62eb11941463fb310a038a1a649f4ea5284已推送，CI41148117616排队。R035归档后284/327（86.9%，含部分/待验收），43项仍初审，完整灾备及其他内部待验项保持。

## 2026-10-31 支付回调在途换单保护

- recharge-callback-race-product-before.log真实复现旧易支付回调在重新支付后仍200/completed、余额+9；最初夹具mock.method不适用Prisma代理的失败单独保留，不算产品证据。GET/POST回调现在向全部渠道的metadata/complete/cancel/fail传原paymentDetails，同语句CAS拒绝旧选择并返回409；重试已过期回调仍按原规则确认忽略。
- recharge-callback-race-final.log退出0：真实PG及原Fastify路由，易支付GET/POST、Heleket paid/check/cancel/fail、Antom S/U/F，原SQL NULL/已有attempt共18场景。真实MD5/RSA验签；无效签名400，旧在途回调409且新记录完整保持、余额/ledger/inbox不增、零callback；新回调正常到账一次，重复不重复入账。供应商网络和外部通知未执行，未操作生产。
- recharge-callback-race-types零诊断、guards 6/6、后端build及recharge-callback-upay-regression均已收退出0；UPAY新建隔离库全迁移及原签名/金额/重复/repay/旧快照回归通过，finally仅清本轮新库。专项已登记脚本、清单与Linux CI；此段仍归原充值编号，283/327（86.5%，含部分/待验收）、44项初审不变。
- 前段d8b3344d9f9541437e35b81fd450031ec4d9e548对应CI41147296829排队。新增终态41137000191 / 3c2880b1e67fb8e5133e5e02517afc7e9565f677全部success；历史41134810809失败保留，其夹具修正后的Linux已过。其他已推阶段继续跟终态，固定v1.7.8及生产部署不变；下一项R035终态竞争复验。

## 2026-10-31 用户支付结果查询在途换单保护

- recharge-verify-before.log自然exit1：用户verify查询时通过原DB helper重建支付尝试，旧易支付paid仍200/completed且余额+9。verify现向所有metadata/complete/cancel/fail传原paymentDetails，复用同语句CAS，冲突409；未改供应商签名/金额/用户归属和正常通知规则。
- recharge-verify-final.log自然exit0：易支付paid、Heleket paid/check/cancel/fail、Antom SUCCESS/PROCESSING/CANCELLED/FAIL×原空/已有尝试共18场景，旧查询全部409且新订单完整字段/余额/ledger/inbox保持、零callback；随后各新尝试正常一次到账。Antom使用实际客户端RSA验签，仅DNS及响应为受控本地夹具；无供应商网络、外部通知或生产操作。
- 完整server+专项types零诊断、6对应守卫6/6、后端build自然exit0，新专项及清单登记LinuxCI。之前兼容修正caa7c597af40527bb23fcec248dc85e9037729f3 / CI41146647164。此段仍原充值编号，不增283/327及44初审；供应商callback在途竞争下一项，完整项目/灾备验收未完成。

## 2026-10-31 UPAY Pro 共享充值函数兼容回归

- 新建仅本机隔离*_upaypro_test库并执行全迁移，再运行原UPAY Pro集成；recharge-upay-regression.log自然exit1定位专用冲突异常把原「订单状态已变更」改成内部英文标识，既有stale-completion错误合同断言失败。保留专用异常类型供管理员409映射，恢复兼容中文文案，不放宽旧支付尝试或账目断言。
- recharge-upay-regression-final.log自然exit0：全新迁移及原创建/回调/金额/重复/重新支付竞争/旧凭据快照/易支付与手动渠道回归全部通过，脚本finally仅清本轮新库；provider请求受控，无公网投递。完整types零诊断、充值单号/状态/UPAY三守卫3/3、后端build自然exit0。
- 上段8f27751175171854d6b598159d458026faf97944 / CI41146317552已记录；该回归发现及修复作为独立阶段保存。283/327（86.5%，含部分/待验收）及44初审不变，用户verify和callback在途竞争继续，固定v1.7.8及生产不变。

## 2026-10-31 管理员同步待付与取消分支重核当前授权

- recharge-sync-revocation-before.log自然exit1：Heleket查询途中admin降权后check分支仍200并修改订单元数据。metadata与cancel helper新增可选actor，在同一事务先锁并核当前账户状态/角色/session，再执行原支付选择CAS及状态更新；admin入口传actor。原complete/fail已有授权保持，自动供应商调用不要求虚构Web会话。
- recharge-sync-revocation-final.log自然exit0：两渠道20组完整正常及竞争回归，易支付paid与Heleket check/cancel/fail/paid×降权/封禁/注销共15种在途撤销全部403，原订单完整保持、余额/ledger/inbox不增、零callback。恢复原admin后正常同步成功；换单10竞争、错配订单、SQL/JSON空值、加密/snapshot/并发等保持。
- 完整server+专项types零诊断、5守卫5/5、财务授权/故障回滚回归与后端build自然exit0。无实际支付/邮件或生产操作。上段0ab0a08730a016b890aae85daded46403db39800 / CI41145752070，既有CI16运行/8排队未见新失败；283/327（86.5%，含部分/待验收）、44初审不变，用户verify/callback在途选择竞争仍待。共享DB函数变更另补现有UPAY Pro集成回归。

## 2026-10-31 管理员同步的在途重新支付竞争

- recharge-sync-race-before.log自然exit1：provider查询尚未返回时经真实updatePendingRechargePaymentSelection换新尝试，旧paid回执仍200/completed并加余额。admin现在携带查询前paymentDetails；metadata/complete/cancel/fail的实际updateMany同语句比较原值，已换则抛明确冲突并返回409，不能在路由先读后无条件写。Prisma SQL NULL与JSON null均按无尝试匹配，undefined保原未指定约束调用的语义。
- recharge-sync-race-null-final.log自然exit0：两渠道共18组完整同步；已有尝试/原SQL NULL两类竞争，易支付paid及Heleket paid/check/cancel/fail共10个在途切换，旧结果全部409，新支付完整记录、余额/ledger/inbox保持，零旧callback；之后新尝试可正常一次同步。原错误单号、加密/旧格式/snapshot、8并发和已完成重复同步继续通过，JSON null正常同步另验。
- 最终完整server+专项types零诊断、5守卫5/5、原财务授权与回滚回归recharge-sync-race-finance-regression自然exit0（在途禁用/降权/注销、ledger故障全回滚等），后端构建自然exit0。provider响应与身份hook受控，真实PG及路由，未外部支付或生产资金。
- 688b3b2aa3b2c67b0f31beed7327556b5747885b / CI41145226472已记录。本段不增加283/327（86.5%，含部分/待验收）及44初审。用户verify/供应商callback的在途选择竞争，以及admin元数据/取消分支当前授权仍应继续核查，不把本段扩大为全入口验收。

## 2026-10-31 管理员充值同步使用当前支付订单

- recharge-attempt-before.log自然exit1：重新支付后paymentAttempt.current已有新网关单号，admin同步仍查询原orderNo，未查到新付款。将原用户路由的当前支付单号及原单号解析移到既有recharge-order-guard共用，保持原字段/后缀/归属和非法数据回退规则；管理员两渠道查询与返回单号比较使用同一当前号，内部余额/回调记录仍关联原平台订单。
- recharge-attempt-cleanup-final.log自然exit0：原十组加密/快照/八并发及错误返回单号矩阵保持，新增两渠道当前支付尝试都查正确后缀单号并一次入账/审计/通知，重复同步无写；helper覆盖非法结构和别单后缀回退。完整server+专项types零诊断、5守卫5/5及后端build自然exit0。新专项finally明确清当前夹具审计，避免用户删除SET NULL留下孤立测试日志；最后回归包含该清理修正。
- 此段尚不包括查询过程中发生repay的竞争与原Heleket元数据/失败分支并发，继续单独实测。无外部支付或生产操作；283/327及44初审不变。上一修复ebdf13c4bcb99b836a0a330333779eff7e7a70e9 / CI41144733563；旧CI41133775870 / 2fadbc74976606844798a0960d1bfa0cc8eed866新增全部success，其它有步骤推进且未见新失败。

## 2026-10-31 管理员充值同步拒绝错误订单号

- R039/040继续复审发现admin-billing sync遗漏用户verify已有的供应商返回订单号检查。recharge-sync-order-product-before.log自然exit1：易支付返回different-order仍200/completed，实际余额+9、新增ledger及inbox各1，不能仅凭HTTP回执说明风险。
- 两渠道复用isRechargeGatewayOrderNoMatch，匹配当前查询的订单号才继续。Heleket验证在paymentDetails合并及pending/cancel/fail分支前，错误订单的未付款或终态也不会修改当前订单。recharge-sync-order-final.log自然exit0：两渠道各6种缺失/非法/错误订单号400且user/record/ledger/inbox/callback/audit完整快照保持；Heleket另3种错误订单状态同样零修改；原十组解密/快照/8并发及重复同步保持。
- 完整server+专项types零诊断、5对应守卫5/5、后端build自然exit0；原CI专项涵新矩阵。仍未外部支付查询/生产写入。重新支付后的当前支付尝试和在途切换另有缺口，下一段继续，不把此次订单号比较宣称为全同步安全完成。
- R040已推1cd70bdd518613eb1c9dc4ad017527723632fecb / CI41144490983，R039 CI41144444144。新增全success：41132963545 / b21da655f1a9f2c4b393e8ac715a725c91e2e764、41134142331 / 9bc1b31de908a697bcce4ece88b42ec2064541e7；其它阶段继续，历史失败保留。本补修归原充值项，不增283/327（86.5%，含部分/待验收）及44项初审计数。

## 2026-10-31 R040 管理员充值同步重复通知复验归档

- 原实际admin-billing sync只在completedNow=true时写成功审计及站内信，防重复逻辑有效。沿R039同一已完成PG/Fastify专项，两渠道各8个请求在供应商查询屏障前均读到pending，释放后均200、仅一个synced=true，余额仅加9、ledger/callback/audit/inbox各一条；再同步3次不调用供应商且记录数量不变。
- 同recharge-r039-sync-final自然exit0、完整types/4守卫与同产品build，不重跑相同代码。仅站内信真实落库，不涉及外部通知或生产资金；没有将“无重复”解释为进程崩溃/通知插入失败时的必达保证。返回错误订单号及在途重新支付仍继续复验。
- R039已推c32e82d9e81e4ba3627851f265d054a44d678e2a。归档后283/327（86.5%，含部分/待验收），44项保初审；全部修复与完整灾备仍未完成。

## 2026-10-31 R039 管理员充值同步有效配置解密复验

- 原admin-billing实际sync入口通过getPaymentProviderById取得解密配置，再解析订单配置快照，原未解密缺陷未复现。新增test-review-recharge-sync用实际createPaymentProvider写入加密配置，检查原库值不含测试密钥，并在实际provider客户端请求处验证有效凭据/签名；请求响应被截获，不发送外部支付查询或邮件。
- recharge-r039-sync-final.log自然exit0：易支付及Heleket各5组（加密、旧JSON字符串、旧对象、加密订单快照覆盖已更换现配置、8并发）。十笔实际PG同步均仅一次入账9元/账单10元，余额、ledger、callback、审计、站内信各一次；同笔再同步3次均synced=false且零新查询/写入。并发原callback唯一约束冲突由原分支处理，保留日志，不当未捕获失败。
- 完整server+专项types零诊断、四对应守卫4/4与清单自然exit0，专项登记CI；无产品修改，复用redeem-r262-ids-build同源码成功。首份recharge-r039-sync.log因夹具使用Log.description（实际为content）失败，已修，不算产品证据。当前复验不包括订单返回编号错配或在途重新支付，继续核查该相关缺口。
- R189已推bb5895f67d4f740e3268ce496df647e2480bb531 / CI41144078810。R039后282/327（86.2%，含部分/待验收），45项初审；新专项通知唯一性证据随后归R040。未生产操作，固定v1.7.8保持。

## 2026-10-31 R189 工单图片响应大小上限证据归档

- R189与R188使用同一原图片代理入口，产品已有50MiB逐段上限；沿已完成ticket-r188-transport自然exit0证据归档，不重复运行未改变代码。远端声明超过上限即拒绝并取消；无Content-Length实际大流达到上限后取消，生产者没发完整200MiB且停止后计数不再增长。恰好50MiB返回200且逐字节正确，attachment.sizeBytes=3不被当作可信远端大小。
- 原R190长期专项另覆盖伪短Content-Length持续流超限、读取失败和未读body回收；该旧部分是截获fetch，不能冒充HTTP协议能读取声明长度之外的正文。新增真实HTTP流、正常边界、两阶段15秒与完整PG记录保持证据详上一节，完整types/两守卫及同源码build保持。
- R188已推672405c45b7ae1eb6df8137dfabe48582565b6c0 / CI41143973573。本次仅把真实可复核证据归回R189编号，281/327（85.9%，含部分/待验收），46项仍初审；外部图床、浏览器、其余完整验收继续，不是全部完成。

## 2026-10-31 R188 工单图片出站真实传输复验

- 原URL与连接期安全dispatcher、manual redirect防护有效，无产品改动。新增test-review-ticket-image-transport调用原Fastify图片路由和真实PG，允许的公网目标仅桥接本机HTTP，DNS重绑定使用原安全dispatcher发起连接并拒绝；不会访问外部图床。
- ticket-r188-transport.log自然exit0：其他用户404零外发、12种私网/等价IP/本地主机/非HTTP地址拒绝，4种连接期DNS结果（普通私网、两种映射IPv6、混合公网/私网）均两次预检查后真实连接期拒绝，零/private请求；302不跟随。声明超限及持续大流及时取消，实际生产者未发送完整200MiB，恰好50MiB允许且内容正确，附件声明3字节不替代全局上限。
- 无headers15037ms、半body15029ms后原15秒期限结束且active=0；恢复正常读取成功，ticket/message/attachment完整原记录保持。清理前无活跃响应，独立dispatcher关闭后socket=0。身份hook及预检查DNS为夹具，实际路由/PG/HTTP/取消/连接期拒绝；未真实图床、浏览器或生产验收。
- 完整server+专项types零诊断、图片安全/安全出站两守卫2/2自然exit0；新专项登记CI，复用相同产品源码的redeem-r262-ids-build成功结果。首次守卫only名outbound-security不存在，未执行；更正真实名字后成功，旧日志保留。本条后280/327（85.6%，含部分/待验收），47项保初审分类；同专项大小证据另归R189，不提前重复计数。
- R262补验已推4c90055b2e31d3a5e986f22f003258f7c9bb0733 / CI41143664537。最近7条旧运行均继续推进后续浏览器检查、无新增失败，完整状态保存logs/ci-state-<run>.json；所有已推阶段继续跟终态。固定v1.7.8及生产不变。

## 2026-10-31 R262 补验 PostgreSQL 编号上限

- redeem-r262-ids-before.log自然exit1复现GET /hosts/2147483648/redeem-codes进入PG integer越界500。仅本组路径/批量共用parser补2147483647上限，不扩大到其它接口或改变既有schema数值转换规则。
- redeem-r262-ids-final.log自然exit0：96个非法/越界请求覆盖六个host入口、三个code入口及批量数字/字符串；10个合法不存在编号仍404，完整业务记录不变；原宿主隔离和批量原子拒绝全回归。兑换管理/一致性两守卫2/2、后端build和最终完整server+专项types零诊断自然exit0。专项请求数组最初被TS推断仅数字，显式InjectOptions[]后修正；该夹具类型失败不算产品失败。
- R262第一段已推8af9c430ae9c675e91e0cc1dc6d9514d1da5c22d / CI41143353879。新增终态CI41132122560 / 0777d97ea70efa820f8dad158e4f034dfe657439全部success；其它阶段继续，固定v1.7.8和生产不变。本补验仍归R262，279/327（85.3%，含部分/待验收）及48项初审不重复计数。

## 2026-10-31 R262 兑换码宿主隔离与批量拒绝原子性

- 单项修改/删除及使用记录的ForHost隔离原本有效；新增真实PG/Fastify复验发现混入另一宿主或不存在编号的批量请求先修改本宿主有效码，再返回404。redeem-r262-product-before.log自然exit1显示未使用码被删除、已使用码被禁用。现在同一advisory锁事务内先确认找到全部请求编号，再读取使用记录并修改；不完整批次零修改返回，由原路由报告404。
- redeem-r262-final.log自然exit0：跨宿主PATCH/DELETE/usages拒绝、非owner读取/批量拒绝；混合外宿主/缺失/重复编号批次保持code/usage/host/instance/log完整快照；合法混合批次仍409 REDEEM_CODE_USED、删除未用码并禁用已用码，使用历史和另宿主码保持。真实PG及路由，身份hook为夹具；未进行客户资源兑换、浏览器管理操作或生产部署。
- 完整server及专项types零诊断、兑换管理/一致性两守卫2/2、测试清单检查及后端build自然exit0，专项登记LinuxCI。最早redeem-r262-before.log使用不存在的createdBy字段，是夹具失败，不算产品证据；新夹具清理覆盖部分初始化失败。提交身份接续核对。
- 前段R047已推defed03e57b95f0dedb3cc38fa4840ba6fdb3269 / CI41142676109；R175关联CI41131838318 / 67f3b47cafc956ad59fb426bd18d61324f788982现已全部success，其余阶段继续跟踪，原失败41134810809保留。R262后279/327（85.3%，含部分/待验收），48项仍保初审分类；完整验收尚未完成，固定v1.7.8不变。

## 2026-10-31 R047 通知渠道枚举复验与 PostgreSQL 编号边界

- 原非法type枚举及状态归一化已有防护，原safe integer编号仍接受2147483648后进入PG越界500；notification-r047-before.log自然exit1。只在用户/admin两个共用编号parser加PG Int上限，五个个人入口及四个全局入口统一拒绝，不改通知发送或授权规则。
- notification-r047-final.log自然exit0：14非法值×9入口126次400、9个合法不存在上界404；原个人/全局读取成功且凭据掩码保持，6非法type拒绝、4非法/重复status安全归一化；原channel/log/audit完整记录不变、零fetch发送。完整server+专项types零诊断、三对应守卫3/3、manifest与后端build自然exit0，长期专项已登记CI。身份hook受控，未向外部通知或生产写入。
- R007已推663d8065391c445b9f6ac1be9ac4473ee36e4f19 / CI41142415324。旧R174源码CI41131579517 / 94214b23b6fd92fa2edd74170b2bad393964bf02已全success，其余阶段继续；历史失败保持。R047后278/327项（85.0%，含部分/待验收），49项保初审分类，完整验收尚未完成。

## 2026-10-31 R007 OAuth 跳转防护复验与锚点结果参数

- 原相对路径校验拒绝双斜杠/反斜杠/编码反斜杠及控制字符，外站绕过未复现。扩展实际authorize+callback的21输入矩阵时，oauth-r007-final.log自然exit1暴露原redirectWithQuery把结果拼到#fragment后，合法带锚点页面收不到error。只把追加参数放到fragment前，原路径/已有query/fragment、外站限制和默认目的地不变。
- oauth-r007-success-final.log自然exit0：21组输入经原Fastify路由，authorize签发state仅存校验后本地路径，callback再次校验旧签名输入；非法目标均留本地，正常query/hash保持、missing_code可读；真实PG绑定成功时success=bound_github、keep=1及#oauth均保持。原当前授权/撤销/CAS/加密/失败回滚同轮通过，provider/JWT沿受控夹具，无外部登录。
- 产品与专项types零诊断、redirect与OAuth守卫2/2、后端build自然exit0；原CI专项覆盖新增矩阵。中间补丁因守卫上下文不匹配被原子拒绝，随后一次误重跑仍旧产品的失败保留，不计修复通过；最终修正确认实际源码及自然终态。
- R005已推76d1d6e58e6f6de2c7103fb45344e0645ec391ca / CI41142013356。R007后277/327项（84.7%，含部分/待验收），50项保初审分类。未做浏览器外站授权或生产部署，固定v1.7.8不变。

## 2026-10-31 R005 OAuth nonce 清理与精确到期边界

- 原按条清理而非整表clear确实保护未到期nonce；但清理使用expiresAt<=now，两个验证器却使用age>TTL。控制Date.now并调用实际注册清理回调，oauth-r005-both-before.log自然exit1：state和login code恰到TTL时已消费记录被清理后可再消费，未使用凭证在该时刻也仍有效。只将两个验证器改为age>=TTL，到期即拒绝，与清理一致；10分钟/60秒期限及单后端进程不变量不变。
- oauth-r005-final.log自然exit0：实际签发/验签/消费函数及原清理callback，过期旧记录不复活、未过期已用记录清理后拒绝、每种20并发唯一次、错误签名不消耗原凭证、两种精确TTL已用/未用全部拒绝。仅时钟可控，不等待真实10分钟；无数据库业务改动。第一份oauth-r005-before.log是未提供模块所需DB环境，保留但非产品证据。
- 原真实PG/Fastify OAuth配置/回调/兑换/解绑回归oauth-r005-regression.log自然exit0，当前权限、撤销、绑定CAS与失败回滚保持；提供商响应及JWT签发为原夹具。完整server+专项types零诊断、security/config与OAuth两守卫3/3、manifest及后端build自然exit0。新专项已登记CI，未进行外部OAuth授权或生产登录。
- R170已推121df3ff36b70717bc07723ca163c31eca1c9c46 / CI41141678816，之前各阶段CI继续。R005后276/327项（84.4%，含部分/待验收），51项保初审分类，完整验收率另计，不改变固定v1.7.8或生产。

## 2026-10-31 R170 抽奖通知出站补验与未读正文回收

- 原地址预检查/实际连接期safe dispatcher、manual redirect及15秒期限均有效；复审新增发现Discord成功和webhook成功/失败只看status，正文未消费也未取消。lottery-r170-before.log自然exit1：正常回执及记录已经落定，仍残留3个未结束响应。仅在这两发送分支finally取消剩余body，保原通知成功/失败规则与Discord错误读取。
- lottery-r170-final.log自然exit0：原sendLotteryWinNotification+实际PG，Telegram/Discord/Webhook正常sent；Discord和webhook的私有URL、302与普通/映射IPv6 DNS重绑定全部保notificationSent=false、零/private，连接拒绝使用原dispatcher。五种headers/半body真实停滞约15059–15072ms后保未通知、记录其它字段完整不变。三个不读取正文的已完成结果即刻取消响应，清理前active=0，独立dispatcher结束后socket=0。
- 正常/停滞HTTP仅桥接到本机并保原请求参数，DNS预检/连接结果受控；未做公网投递、抽奖扣款/奖品发放或客户实例操作。完整server+专项types零诊断、通知/出站守卫2/2、manifest与后端build自然exit0，专项已接CI。
- R175文档已推31a627ee3ffa38ba71835c0bfd65fa028755f0f7 / CI41141331712，R173的CI41141251933及之前15条继续。R170后275/327项（84.1%，含部分/待验收），52项保初审分类；历史失败与所有待验收范围保持，固定v1.7.8不变。

## 2026-10-31 R175 关闭会话后重连资源回收证据归档

- 重新核对terminal-proxy：close先递增generation、abort本轮controller、移除activeSessions、清heartbeat和原双socket；重连在等待后及新双socket/授权事务完成后都核当前对象/generation/client/abort，不再接纳已关闭会话。
- 本条与R174/R177已有专项属于同一实际调用链，未重复运行未变代码。git diff 67f3b47cafc956ad59fb426bd18d61324f788982 HEAD -- terminal-proxy及test-review-terminal-reconnect为空；既有terminal-r177-product-reconnect.log自然exit0及完整types/build证据保持。CI41131838318同完整head的Terminal reconnects cancel pending requests和Terminal reconnects recheck current authorization两step均success，整体仍运行。
- 可执行证据覆盖12组backoff/POST/握手×user/session/instance/all取消，在迟到回执释放前实际socket归零；另三组双账户隔离、client close/error、VM取消零fallback、正常VM fallback和正常重连、20秒期限后原请求关闭再独立重试。不是仅靠activeSessions=0推断资源已释放；未覆盖原生Incus与长期公网连接，因此该缺口继续保留。
- R173已推6470b529fe4031ce543589874234879ad872fbf2 / CI41141251933。R175证据归入原编号后274/327项（83.8%，含部分/待验收），53项保初审分类；没有新增产品改动或生产部署。

## 2026-10-31 R173 自定义 Telegram 超时与日志补验

- 原sendToChannel的Telegram分支已有15秒AbortSignal及manual redirect，本项未改产品。新增长期专项调用真实sendToChannel和PG日志，只把fetch目的地桥接到本机HTTP，保留method/body/redirect/signal；不向外部机器人发送。
- logs/custom-telegram-r173-final.log自然exit0：disabled专用渠道仍可正常发送、原Markdown与链接payload保持；远端拒绝/非法JSON/302/缺配置均落failed，302零跳转。无headers15046ms、半body15043ms后返回失败且真实响应已取消、PG零pending，1.5秒后零迟到sent；恢复后同渠道再次sent、原failed保留且enabled仍false。残留socket先确认零请求空闲替代连接，再关独立dispatcher归零，不通过强关活跃响应冒充取消通过。
- 完整server+专项types零诊断、notification-fetch守卫1/1、清单自然exit0；只有专项和CI登记变化，复用相同产品源码的turnstile-r171-build成功证据。专项接入LinuxCI，尚非外部Telegram投递验收。
- R171已推fe1a9316531b86b9b4b808f25dcba1517f8f3a81 / CI41140946141；截至本轮15条待核CI均继续到后续步骤，无新增失败，逐项完整head/step保logs/ci-state-<run>.json。R173后273/327项（83.5%，含部分/待验收），54项保初审分类；阶段修复在固定v1.7.8之后，未生产部署。

## 2026-10-31 R171 Turnstile 公开可用状态与认证门禁一致

- 原登录/注册/找回密码共用turnstileVerifier，关闭时跳过的后端行为正确；但公开配置只看enabled与site key，不看secret key。logs/turnstile-r171-before.log自然exit1证实enabled=true/site有值/secret缺失时公开仍true，而后端跳过。仅公开配置复用getTurnstileConfig并以开关和完整两密钥计算可用状态，只返回site key，不返回secret；管理员原配置值和后端验证规则保持。
- logs/turnstile-r171-final.log自然exit0：实际PG通过原updateSystemConfigs切换八种开关/密钥组合；真实公开接口与登录/注册/注册邮件/找回邮件/重置密码五个原preHandler一致，缺token400、无效及非法JSON403、仅合法token通过。断言实际注册钩子同为turnstileVerifier，并在其后204截停，未执行登录/注册/邮件/密码修改；外部Cloudflare响应受控，不代表实际挑战或浏览器验收。配置原值finally恢复，测试密钥不输出。
- 完整server+专项types零诊断、系统配置/认证/Turnstile三个守卫3/3、manifest及后端build自然exit0，专项已登记CI。R178已推ba1e4b3cbd3c14097f144a0785e2f52127a3ba93 / CI41140423395，R277为01e1e2c09a149b29e1699df0b4cefdd3e921ff54 / CI41140251020，仍跟终态。
- R171进入复验后272/327项（83.2%，含部分/待验收），55项保初审分类；不是完整验收率。固定v1.7.8不变，未部署生产。当前后续14条源码CI仍待终态，失败历史及原生/公网/灾备缺口保持。

## 2026-10-31 R178 保存终端命令并发上限复验

- 代码复审确认每个用户在同一事务中先取advisory lock，再检查当前授权、COUNT及INSERT；100条限制已有保护，未改产品逻辑。旧R195专项已有十并发数量断言，本次进一步要求九个失败全部为400/MAX_COMMANDS_REACHED，不能把其它500当成正确限流。
- logs/command-r178-quota-final.log自然exit0：99条加10并发仅一条201、九条明确额度拒绝，数据库100条且只新增一条成功审计；满额再试原100条完整记录和审计数量保持。原48编号、初始化50上限、独立字段并发编辑、删除竞争、当前撤销/封禁校验同轮通过。完整server+专项types零诊断、终端命令守卫1/1自然exit0；本轮只有专项/文档变化，复用前一阶段相同产品源码的成功build，不重复构建。
- R277已推01e1e2c09a149b29e1699df0b4cefdd3e921ff54 / CI41140251020，仍运行。R178进入复验后271/327项（82.9%，含部分/待验收），56项仍保初审分类。未部署生产；认证hook和隔离PG不代表生产登录/终端执行验收。

## 2026-10-31 R277 运维审计分页复验与编号上界

- 原分页小数/无效值进入Prisma的说法未复现。真实Fastify/PG中默认20、空值默认20、1/50/51及最大safe integer上限50、13类非法或重复pageSize拒绝、扫描和操作时间降序、当前宿主/实例筛选、跨宿主空结果、非owner拒绝及admin读取均通过。
- 同入口新发现hostId/instanceId接受2147483648后分别进入host和scan查询导致PG integer越界500，logs/host-audit-r277-product-before.log自然exit1。只在该history路由补PG Int上界，不改共享parser及现有分页大整数夹50行为，不据此宣称全部hosts接口编号都已补齐。
- logs/host-audit-r277-final.log自然exit0：上述分页和隔离场景、非法/越界ID、合法不存在上界、host/instance/scan/action/log完整记录不变、零Incus连接。完整server+新专项types零诊断、host-route-id守卫1/1、清单与后端build自然exit0；专项登记Linux CI。认证hook为测试身份，实际PG和路由；不替代公网部署或原生审计扫描执行。第一份host-audit-r277-before.log是夹具缺authenticateAdmin注册失败，保留但不算产品复现。
- 上段R132已推3538403ec31d939f70f3c319bf233aa55acf051f / CI41139600444，另11条源码CI仍有步骤推进、无新增失败，历史41134810809保留。R277转入复验后270/327项（82.6%，含部分/待验收）、57项保初审分类；这不是完整修复率。未部署生产，固定v1.7.8不变。

## 2026-10-31 R132 反代实例/站点 PostgreSQL 编号边界

- 旧共用parser仅限制safe integer，GET /instances/2147483648/sites进入PG integer越界500，logs/proxy-r132-id-before.log自然exit1。加PG Int上界，覆盖九处instanceId与七处siteId；原当前权限、持久操作计划和Caddy执行不改。
- logs/proxy-r132-id-final.log自然exit0：14种非法×16入口224请求全部400，16合法不存在上界404；已有列表及关闭HTTPS的证书查询200，instance/site/operation/audit完整记录不变、零Caddy dispatch。新专项登记CI，完整server+专项types/对应守卫/清单/build自然exit0。此项仅编号边界，无远端站点重新配置或外部DNS/证书验收。
- R95已推97ad2b6f828c9d7d7c606a45cedfc6354a5b7c1f：CI41139402498运行，Agent Build & Release 41139402494 success；这是Agent工作流结果，不代表新平台版本或生产升级。R66 CI41139128809继续。
- CI41127725085 / 0c1cd6772eda7be9683dd28b64268c6f8cdf44b3全success。R275 CI41137537472已通过新增进程数两专项并推进后续，整体继续；其余旧批未终态，历史41134810809失败保持。R132入复验后269项（含部分/待验收）、58项保初审分类。

## 2026-10-31 R95 Agent宿主接口 PostgreSQL 编号边界

- 原parser拒数字后缀，但2147483648仍进入prisma.host.findUnique并integer越界500，logs/agent-r95-id-before.log自然exit1。仅共用parsePositiveId补2147483647上界，六处宿主状态/升级/安装命令/凭据入口统一拒绝；不修改HMAC认证、凭据轮换或真实升级流程。
- logs/agent-r95-id-final.log自然exit0：14非法/越界ID×6入口84次400，6合法不存在上界404，已有未安装Agent宿主的用户/admin状态接口200；原host/agent安装令牌与凭据字段/nonce/audit完整状态不变，零外部发行或宿主请求。安装资料只内存比较不输出。完整server+专项types、2守卫、清单及后端build自然exit0；新专项已接CI。该范围不声称实机Agent升级验收。
- R66已推9d4f4c2c829b7484eb06d3443d43f38447f64c57 / CI41139128809，R202/R203为d5a02f0f7385fa1fc7ca3d21c343009a8f1ed659 / 41138737969，均运行中；R275与工单修正CI继续。R95进入复验后268项（含部分/待验收）、59项保初审分类。R132反代同类编号复审正在另段进行。

## 2026-10-31 R66 快照接口 PostgreSQL 编号边界

- 原“已有防护”仅拒绝小数/后缀，safe integer仍包含PG Int越界。logs/snapshot-r66-id-before.log自然exit1：实际Fastify GET /instances/2147483648/snapshots进入prisma.instance.findUnique后integer越界500。共用parser的数字/字符串分支加2147483647上限，覆盖七处instanceId和两处snapshotId，不改创建/删除/恢复权限或流程。
- 新test-review-snapshot-id-boundaries.ts登记CI。logs/snapshot-r66-id-final.log自然exit0：14非法/越界ID×9请求共126次400，8个合法不存在上界404；既有快照列表/策略读取成功，instance/snapshot/policy/operation/audit完整快照不变、零宿主连接。对应snapshot守卫、完整server+专项types、清单、后端build自然exit0。限于编号校验范围，不将此项算作所有原生快照流程新验收。
- R202/R203已推d5a02f0f7385fa1fc7ca3d21c343009a8f1ed659 / CI41138737969运行中；R275与工单CI修正运行41137537472/41137000191持续。R66入复验后267项进入修复/复验（含部分/待验收）、60项保初审分类；不等于完整验收完成率。仍在固定v1.7.8之后，未生产部署。

## 2026-10-31 R202 映射IPv6出站绕过修复、R203实际流量通知期限补验

- R202复审纠正：已有safeFetch连接期校验，但isIpv6PrivateOrReserved仅匹配点分IPv4映射，实际DNS返回十六进制::ffff:7f00:1会漏判。logs/traffic-r202-mapped-before.log自然exit1：原sendTrafficWarningNotification、真实PG、实际safeOutboundDispatcher，预检查DNS为公网、连接DNS为映射loopback时，隔离HTTP服务确实收到一次/private且通知sent。只访问本机专用服务，无外部通知或客户目标。
- 共享校验先规范化IPv6再拆两组十六进制映射回IPv4，沿原IPv4保留/私有段策略判断；展开loopback/unspecified也统一拒绝，不可规范化的带scope地址拒绝。公共IPv6/公共IPv4映射保持。原扩展守卫先自然exit1，修后存储/出站动态lookup与通知/支付回调/反代等7守卫通过；scope分支最终2守卫另复验。最终完整server+专项types及build均自然exit0。
- 新test-review-traffic-notification-transport.ts登记CI，logs/traffic-r202-r203-product-final.log自然exit0：warning和throttled两真实入口×Telegram/Discord，正常JSON/204落sent；Discord302不跟随、私有URL零fetch，普通和映射IPv6的DNS重绑定均经真实dispatcher三次拒绝、零/private。DNS两阶段结果受控，不是外部公网DNS演练；正常/停滞HTTP只替换传输目的地且保留原method/body/signal，dispatcher连接校验在两种重绑定场景单独实测。
- R203原15秒AbortSignal有效，未改发送期限。两入口×两渠道×无headers/半body共8场景均三次、每次约15秒、加退避总51841–52081ms，实际PG日志全部failed、零pending、活动response归零；独立测试dispatcher关闭后socket归零，不代表外部Telegram/Discord投递验收。
- 纠错保留：旧logs/review-notification-transport.log只测通用notifier，不能冒充流量通知器；本次正确入口补验。第一版traffic-r202-r203-transport-first.log因socket数8≠0自然exit1，检查证实8条是取消后Undici新建且未发过HTTP请求的空闲替代连接，所有24个停滞响应均已取消。最终显式断言每条残留连接请求数0，再关闭独立测试dispatcher；未通过停止响应或强制关闭活跃请求来掩盖超时故障。
- R275已推48f5a82dcdb605754b348bef202c795932b98ea3，CI41137537472继续；工单夹具修正3c2880b1e67fb8e5133e5e02517afc7e9565f677 / 41137000191已越过原失败步骤，整体仍未终态。历史41134810809失败保持。此阶段使266项进入修复/复验（含部分/待验收）、61项保初审分类，不是266项全部修完；仍无生产部署。

## 2026-10-31 R275 进程数提升授权、并发与总期限（阶段保存）

- 原单次Incus失败确实返回500并恢复精确旧值（含null），原“失败假成功”不成立；但process-boost-auth-before.log实证认证后降权仍200并PUT。新增logs/process-boost-race-before-product.log用fe12ac20原路由（只调整临时副本import路径）与真实PG/批量路由确定性复现：批量配置已成功提交700，更早提升PUT迟到失败后把DB覆盖回null，自然exit1；第一份before日志仅夹具fastify路径缺失，不算产品复现。
- 新instance-process-boost复用统一实例advisory/行锁、host及当前actor/status/sid/role授权，锁后确认原实例/宿主身份、任务/转移/快照/反代门禁和套餐类型；远端成功才更新同事务DB，失败不再事务外覆盖旧值。container1000/vm2000、原配置与设备保持。独立短期IncusClient沿当前锁定证书身份，90秒总期限从申请事务前开始，覆盖冷mTLS/GET/PUT及busy重试，finally关闭；不修改共享池和其他调用者。
- PUT或COMMIT之后失败返回PARTIAL_FAILURE与请求上限、原/当前数据库观察值和远端unknown，不假称远端已回滚；具体cause保留服务日志。冲突失败审计以内容保留actor/instance编号，外键留null避免竞争者仍持行锁时拖延409；成功审计保持关联。
- logs/process-boost-complete-final.log自然exit0：null/650失败后保持、重试与类型上限、四种当前角色/封禁/会话撤销拒绝、八组实际PG身份/账号锁等待、六类未就绪/任务门禁、先成功及先失败两种提升与batch竞争、及时忙响应、后续700保持；真实延迟外键COMMIT失败证明回调成功返回后失败，远端1000/DB650明确报告且失败审计持久。该专项Incus协议为替身，PG及Fastify是实际调用。
- logs/process-boost-wire-first.log自然exit0：唯一PG连接下原Fastify/原IncusClient+本地认证mTLS，冷连成功/远端拒绝/重试/指纹不符拒绝；握手无响应90044ms、PUT响应体中断90041ms、持续busy90759ms退出，socket0、idle1/waiting0、零idle-in-transaction且额外2.2秒零迟到请求；随后正常操作成功。首次types发现夹具Duplex类型不匹配已修，最终server+两专项零诊断；对应守卫2/2、清单与后端build自然exit0。测试登记CI；尚无原生Incus/公网长期运行或生产部署证据。
- 上段CI夹具修正已推3c2880b1e67fb8e5133e5e02517afc7e9565f677，新CI41137000191在运行；历史fe12ac20/41134810809失败保留。其它七批仍向后推进，无新失败。R275进入复验后264项进入修复/复验（含部分及待验收）、63项保留初审分类；不是264项全部完成。本修复在固定v1.7.8之后。

## 2026-10-31 R182 CI 并发夹具编号顺序修正

- 最新已推fe12ac20dcc580fa3b54a020fb777aabf22ab5b5的CI41134810809失败，job124334530550，步骤Ticket auto-close serializes with public reply deletion and returns only committed receipts。原日志logs/ci-41134810809-failed.log保留：两张成功工单都已通知，失败为test-review-ticket-autoclose.ts的subject数组顺序断言；不是关单丢通知复发。其它六job成功。
- 根因是Promise.all并发INSERT分配自增ID的顺序不保证与输入下标一致，夹具查询按ID排序、预期却按输入排序。创建后按实际ID排序确定第一/中间/末张工单；仍严格断言失败单保resolved、两条成功通知与日志、重试补一条、再跑无重复和全部失败零新增。不修改产品调度器/通知行为。
- logs/ticket-r182-ci-order-fixed.log自然exit0，完整server与该专项types零诊断自然exit0。后端build已在同产品源码自然exit0。修正需新提交LinuxCI复核，历史失败不抹除。
- CI41123203452 / 9d0845c8a7b623a3fa22bbbbb42ce31cd0693b56已全success；v1.7.8正式41131263041、预览41115228247、源码41115227451、文档41115227538均为c77b68c5aab9d3e6f48f4091c7dce111c055465a且success。其余七批旧源码CI继续，R275未提交修复与mTLS专项正在独立收尾，不包含于本次测试修正提交。

## 2026-10-31 R182 自动关单部分失败保留通知回执（阶段保存）

- 复审原通知“已有防护”发现反向缺口：autoCloseTickets逐单提交，但中途一次事务失败使整个Promise拒绝，之前已关闭的工单回执丢失、调度器不再发站内信/成功日志，后续候选也跳过。ticket-r182-partial-before.log自然exit1复现第一单已关闭而批次无回执。
- 产品最小改动在每单事务外捕获失败，带工单ID和具体错误记服务日志，失败单保留resolved、成功回执继续收集并处理后续单；原调度器只遍历成功回执。没有改变单单事务的回滚/原行锁和候选门禁，也没有把失败单写成成功。
- ticket-r182-product-complete.log自然exit0：原两序删除/回复竞争与八并发唯一次关闭保持；中间回调失败和真实PG行锁3秒超时均只影响对应工单，后续成功回执保持，解锁后只补原失败单。原startTicketAutoCloseScheduler/原sendNotification在实际PG运行，部分失败只落两条站内信及两条成功日志，下周期补一条、再执行零重复，全部失败零新增成功通知/日志且三工单仍resolved。配置仅进程缓存、候选仅隔离测试记录，无外部通知渠道/Telegram绑定；原自然一小时周期及生产未验。日志失败明细为服务日志，未新增数据库失败审计。
- 最终完整server+扩展专项types零诊断，ticket-auto-close/success/query/public-api-resource四守卫4/4与后端build自然exit0。最初单失败旧测试预期throw按新逐单返回空回执更新，原先红记录保留；本次不是跨进程崩溃后的持久通知outbox保证。
- R195已推9bc1b31de908a697bcce4ece88b42ec2064541e7，CI41134142331；R176为2fadbc74976606844798a0960d1bfa0cc8eed866 / CI41133775870，发行文档b21da655f1a9f2c4b393e8ac715a725c91e2e764 / CI41132963545，均继续到终态。当前263项进入修复/复验、64项初审分类，含部分与待验收，不代表263全修好。此修复在固定v1.7.8之后。

## 2026-10-31 R195 初始化命令 PostgreSQL 编号边界（阶段保存）

- 复审纠正“已有防护”：JavaScript safe integer仍包含超出PG Int的2147483648；原Fastify GET /init/2147483648实际500，command-r195-boundary-before.log自然exit1并记录数据库integer越界。仅在初始化命令共用parser增加2147483647上限，覆盖详情/编辑/删除，保留严格十进制及原权限。
- 扩展原test-review-command-integration.ts并接入LinuxCI。command-r195-boundary-final.log自然exit0：16种非法编号×GET/PUT/DELETE共48次400，最大合法不存在编号三次404，正常详情200；原命令完整行与审计数不变。原50/100名额十并发、独立字段并发编辑、删除竞争、空白、撤销与封禁拒绝均保持。types零诊断、2/2对应守卫、清单和后端build自然exit0，无前端改动。
- 上段终端审计修复已推2fadbc74976606844798a0960d1bfa0cc8eed866，CI41133775870已核完整headSha仍运行；b21da655文档CI41132963545及前五批继续。此阶段在v1.7.8之后，未改变tag或生产。R195转入复验，当前262项进入修复/复验（含部分及待验收）、65项初审分类，不能按减法宣称仅剩65项。

## 2026-10-31 R176 名额补验与终端审计外键死锁修复（阶段保存）

- 上轮terminal-reservation-check.log自然exit1，不能把close回执加200ms等待当全部授权事务结束。PG原日志明确等待环为logs INSERT（先user外键KEY SHARE、后instance外键KEY SHARE）与终端授权（先instance FOR UPDATE、后user FOR UPDATE）。新确定性隔离PG测试不重置数据行，先持user KEY SHARE、确认授权实际被阻塞后插入真实审计；terminal-reservations-deterministic-before.log自然exit1并复现40P01，证实产品锁冲突。
- 产品仅将终端授权instance行锁改为FOR NO KEY UPDATE，仍阻止行修改和删除，并保留原操作advisory锁、host/package锁和当前账户/会话授权；允许审计外键KEY SHARE，避免相反锁序循环。未删除审计、放宽限额或调整连接池。实例任务/转移创建继续在同一操作advisory与instance行锁内，不能通过纯FK插入绕过产品门禁。
- 新server/scripts/test-review-terminal-reservations.ts登记活体专项及Linux CI。terminal-reservations-complete.log自然exit0：确定性真实PG等待链双方完成；实例UPDATE/DELETE实际等待授权结束后执行并回滚，原实例保持；并发原WebSocket路由单实例3、跨三实例单用户5名额，撤销后等待全部事务及8条审计落定，零宿主POST；释放后正常双mTLS socket连接、连接/断开审计各一条、socket与session归零。
- terminal-reservations-opening-regression.log与reconnect-regression.log自然exit0，原九类当前授权/目标变化、真实锁竞争、三角色允许、20秒总期限、COMMIT失败及初连/重连事务pending撤销清理均保留。完整server+新专项types零诊断，3/3守卫、测试清单及后端build自然exit0。无前端变更；原生Incus及公网长期终端未验。
- 测试纠错：首轮新夹具用户限额断言遇乱序请求；改顺序请求又被更早的通用WS限额拒绝，实际code为WS_LIMIT_EXCEEDED，不能判为产品名额失效。最终三实例分配确保任何单实例不超3，全部真实路由先通过通用预检查再竞争claim，明确断言USER_LIMIT_EXCEEDED；所有取消事务与审计自然完成后才下一轮。初types的Prisma delegate包装签名与误用websocket-security-guards也已纠正，失败记录保留不计通过。
- 发行证据文档已推b21da655f1a9f2c4b393e8ac715a725c91e2e764，其CI41132963545继续。R176原名额防护确认，新增死锁归终端授权同链；本阶段在v1.7.8固定tag之后，后续源码CI另跟。原327进度现261项进入修复/复验、66项仍保留初审分类，均不代表完整精修结束。

## 2026-10-31 v1.7.8 正式发行完成（未部署生产）

- Release：https://github.com/mastalee928/payincus/releases/tag/v1.7.8 ，publishedAt为2026-10-30T21:40:09Z。annotated tag精确指向c77b68c5aab9d3e6f48f4091c7dce111c055465a；正式运行41131263041整体success，双构建、双首装与发布五job全部成功。
- AMD64首装job124326102688、ARM64首装job124326102582日志分别保存logs/release-v1.7.8/install-{amd64,arm64}.log：230迁移、唯一后端/双前端/admin登录、正式安装Prisma重复八连接超时及迟到BEGIN回滚归还、整库共享快照/ZIP与ZIP64恢复、历史迁移均通过。备份演练OSS传输仍为模拟，不代表公网OSS整机灾备。
- 正式AMD64包212050377字节，SHA256 f65add6dcea66925496a7755fdf665db0dc5b72b15bc471afe07cf14d93a6ea0；ARM64包211248190字节，SHA256 563e0d29586993a80b60fd67940a7f796f249251970c3e8606c05ccb85b85cac。两包源码/版本/root归属、冻结Prisma patch及两Node runtime、同事务复用、清理期限、地图和三语资源核验自然exit0。下载的两个sha256及两份一致OTA manifest与实际包字节/hash/大小/下载URL完全匹配，也与Release资产digest一致。
- 后续主分支0777d97ea70efa820f8dad158e4f034dfe657439已推，包含94214b23的R174、67f3b47c的R177和0777d97e的R181；这些不在固定v1.7.8内。CI41123203452/41127725085/41131579517/41131838318/41132122560仍须逐个到终态，payincus-ci保持ACTIVE。
- 原327项当前260项进入修复/复验（含部分及待验收）、67项保留初审分类，不能称260项全部完成或仅剩67项。继续精修，不以发行替代完整网关/灾备验收；没有生产OTA、DNS或客户操作。

## 2026-10-31 R181 自动关闭与回复删除串行化（阶段保存）

- R177已推67f3b47cafc956ad59fb426bd18d61324f788982，CI41131838318继续跟终态。R181只在自动关闭逐项事务内读取前新增原ticket FOR UPDATE与3秒锁等待上限，复用现行回复/删除/改状态的工单锁。新test-review-ticket-autoclose.ts登记独立PG专项与LinuxCI。
- ticket-r181-product-integration.log自然exit0：管理员删除先提交后自动关闭重读末条客户消息拒绝；自动关闭先持锁时删除等待；客户回复先提交时重读拒绝；八并发/重复ID唯一次关闭回执、新回复/客户末条/无消息拒绝、失败事务完整回滚。原三工单回归/产品types/build/四守卫另收终态；两次--only误用不存在public-api脚本被清单拒绝，均未运行且不计通过，已按实际public-api-resource-guards重跑。
- 最终ticket-r181-product-{integration,regression,types,build,guards}.log全部自然exit0：原42类网站/160类PAT-POA及对象绑定、首消息故障回滚保持；四守卫4/4、完整server与新长期测试types零诊断、后端构建和测试清单有效。无前端变更，未实测外部通知服务。本次修复在v1.7.8固定tag之后，不误报已在发行包内。

## 2026-10-31 R177 重连当前授权与待提交连接取消迁入（阶段保存）

- R174已推94214b23b6fd92fa2edd74170b2bad393964bf02，CI41131579517启动，须跟终态。第二段保留原authorizeOpening闭包，每次重连复用当前账户/会话/角色、原实例/宿主/套餐与运行/转移门禁；授权或DB失败关闭用户会话，后端连接故障沿原有界重试。
- 初连/重连已建立但尚未交给session的pair绑定原取消信号，pending事务期间撤销立即关闭，finally移除监听；成功后由原session生命周期管理。新test-review-terminal-reconnect-authorization.ts持久保存原route九类拒绝、五PG锁竞争、真实COMMIT失败及两pending窗口测试，登记清单与CI。产品types/build及受影响全部专项继续收自然退出，详细先红后绿证据在下。
- 最终terminal-r177-product-{authority,opening-pg,opening,reconnect,types,guards,build}.log全部自然exit0：真实路由九类变更拒绝、五PG锁竞争、三角色正常、等待撤销/5秒锁超时/总20秒、真实COMMIT外键23503及初连/重连pending事务撤销均清双socket；原扩大取消/VM与初连授权保持。完整服务端+四长期测试零类型诊断，三守卫/清单/后端构建通过。没有前端变更；原生Incus UUID/长期公网终端仍另验。

## 2026-10-31 R174 重连取消与总期限迁入主分支（阶段保存）

- v1.7.8 tag已冻结后，先迁入独立R174修复：重连从backoff开始20秒总期限，取消信号覆盖等待、POST及双握手；用户/登录会话/实例/全局关闭立即取消在途请求，finally清本轮timer/controller后才递归重试，原generation与VM正常fallback保持。
- 新长期test-review-terminal-reconnect.ts登记server脚本/活体清单排除理由及LinuxCI。terminal-r174-product-reconnect.log真实mTLS自然exit0：12组backoff/POST/握手×四撤销范围在释放迟到回执前实际socket归零，三范围双账户并发隔离，client close/error、VM撤销不fallback及正常fallback、正常重连/20秒到期后独立重试通过。
- terminal-r174-product-pg.log、opening.log、guards.log与build.log全部自然exit0，原真实PG/Fastify/mTLS初连授权与三终端/WebSocket守卫保持；完整server+三专项types零诊断，test manifest有效。无前端变更，v1.7.8固定tag不含本次后续修复；R177重连当前授权及pending提交取消下一段，原生Incus长期终端仍待。

## 2026-10-31 v1.7.8 正式发行已启动（等待构建及首装）

- 冻结产品c77b68c5aab9d3e6f48f4091c7dce111c055465a的源码CI41115227451已整体success，七job全成功；同提交文档41115227538与双架构预览41115228247成功，预览发布步骤预期skipped。实际预览包及本地196/196证据见下。
- 按owner已授权发行，annotated tag v1.7.8精确指向c77b68c5并推送；启动时main为文档提交0c1cd6772eda7be9683dd28b64268c6f8cdf44b3，没有把后续临时候选纳入发行。正式任务41131263041完整headSha一致，双构建/双首装及Release/资产核验继续；tag推送不等于发行成功或生产部署。
- 文档提交9d0845c8/0c1cd677对应CI41123203452/41127725085六job成功、Pool仍运行；同样跟到终态，不能以产品候选成功替代它们。payincus-ci保持ACTIVE。没有生产OTA、DNS或客户操作。

## 2026-10-31 发行冻结期间终端与工单并发补验（尚未迁入产品）

- main已推9d0845c8a7b623a3fa22bbbbb42ce31cd0693b56，仅交接/清单文档；发行产品保持c77b68c5aab9d3e6f48f4091c7dce111c055465a。源码CI41115227451六job成功、Pool已过146步继续；9d0845c8的CI41123203452也六job成功、Pool继续。现有payincus-ci heartbeat ACTIVE，不重复在途任务；v1.7.8尚未tag/Release。
- R177原WebSocket路由初连后直接提交DB封禁、断后端，基线仍发重连POST（terminal-reconnect-authority-before.log自然exit1）。正式封禁路由另有closeUserSessions，不能解释成全部正式封禁失效；缺口是重连自身未复核当前授权。临时合并R174/R177副本logs/terminal-proxy-reconnect-authority-candidate.ts保原初连授权闭包，每次重连在原实例/host/current actor/package锁内复核，保20秒总期限、取消、失败关双socket及正常后端有界重试；产品未改。
- 最终terminal-authority-pg-boundaries-verified.log自然exit0：原route九类已提交授权/目标变化全部零重连POST；session/banned/transferred/host-url/demoted五类实际pg_blocking_pids锁竞争提交后拒绝；owner/host owner/admin正常重连。等待PG锁期间撤销零迟到POST，5秒锁超时关闭，3.2秒锁等待后卡POST合计约20秒取消并释放目标锁。两临时表延迟外键在回调正常完成后的真实COMMIT失败（23503/commitTransaction栈），已连双socket关闭且无第二次connected回执；主动回调失败同样保持。terminal-authority-cancel-regression.log与terminal-authority-opening-pg.log均自然exit0，原取消矩阵/初连授权回归保持；完整server+两测试虚拟原路径types最终0（terminal-authority-pg-boundaries-types-verified.log）。
- 本轮测试纠错：初次类型检查未用导入已修；“真实COMMIT失败”初夹具临时表引用永久users表，实际42P16建表失败，虽socket清理断言过，不能作为COMMIT证据。已改双临时表并强制回调正常完成/外键错误断言。另一轮轮询session当前controller错过旧controller已取消且已开始下次重试，改捕获本轮controller检查；原错轮exit1保留。最终只以上verified轮作为完整证据。
- R181复审纠正：原“已有防护”只涵盖新回复updatedAt CAS；管理员deleteTicketMessage不改ticket.updatedAt，自动关闭读完最后客服回复后，删除先提交仍能关闭，review-ticket-autoclose-delete-before.log自然exit1，实际deleteWon=true/closed=1。临时副本logs/tickets-autoclose-candidate.ts只在autoClose每项事务读取前加3秒lock_timeout及原ticket FOR UPDATE，协调现有回复/删除锁。review-ticket-autoclose-expanded-staged.log自然exit0：关闭先锁时删除等待；删除/客户新回复先持锁提交后关闭重读拒绝，八并发/重复ID只一成功回执，新回复/客户末条/无消息拒绝，事务失败完整回滚。加载器核候选SHA256 0000bf4d2be977541832314716888672a3cd0e348c36e0934ac9e5c59b267e1a。临时脚本首次括号错误、加载器strip-only不支持参数属性均已修，未算产品故障。
- R181候选完整server及长期测试虚拟路径types零诊断（ticket-autoclose-candidate-types.log），原三专项ticket-autoclose-candidate-original-regression.log全部自然exit0：网站42权限/对象/状态竞争、真实PAT/POA鉴权160类竞争、原对象绑定与首消息故障回滚；加载器确认同候选。没有外部通知或附件服务；产品迁入仍待发行之后。
- R177进一步边界复现：两通道成功但授权事务尚未提交时撤销，旧临时候选未立即关新socket（terminal-reconnect-pending-commit-before.log自然exit1），用户会话已关闭；需要给未发布pair绑定本轮取消监听并在成功接管或finally移除。临时候选已补，pending-commit-fixed/types回归运行中；此前verified轮不覆盖本次新增改动。
- R177重连pending提交窗口最终pending-commit-fixed/types自然exit0；立即取消监听使事务仍held时双socket先关闭、无第二次connected。后续terminal-pending-commit-cancel-regression.log与terminal-pending-commit-opening-regression.log自然exit0，加载候选SHA256 1215884b607b6cfb0b138e067f94a5a1fedb593d9b0a45060824fb4804c05157；扩大取消矩阵和原初连授权保持。初连相同pending提交窗口另外补验中，不把旧初连回归当这个新增场景证据。
- 同类初连pending事务撤销也先红（terminal-initial-pending-commit-before.log），临时副本为初连signal同步绑定未发布pair取消监听；terminal-initial-pending-commit-fixed.log和types自然exit0，完整重连权限/PG锁/真实COMMIT失败及两类pending撤销均通过。再次冻结候选后仅复跑受影响原opening/mTLS/PG与reconnect取消，terminal-final-*日志待收终态。正式产品仍未迁入。
- 最终候选SHA256 5820c06b2cb8f4a4ab845b9d477c3b349cfc077b481650116d936c02b8f9b797：terminal-final-opening-mtls.log、terminal-final-opening-pg.log与terminal-final-reconnect-cancel.log全部自然exit0；同候选完整server/两长期测试types零诊断。初连/重连普通成功、VM fallback、四范围撤销/并发隔离、原route授权/20秒期限和提交失败均保留，尚须正式产品迁入、守卫/build及新CI。
- 上述两段为隔离真实PG和本地mTLS证据，原生Incus终端/持续公网连接及工单外部通知仍未验。先完成已授权v1.7.8发行，随后分别迁入产品、保存长期测试、登记清单/CI、构建/守卫并逐段提交推送。此前259含部分/68初审为历史口径；R181本轮从初审转入复验且尚未落地，不能增加完整修复数。没有生产操作。

## 2026-10-31 地图所有可售地区名称与基础避让（阶段保存）

- 冻结产品提交为c77b68c5aab9d3e6f48f4091c7dce111c055465a；源码CI41115227451、文档41115227538与双架构预览41115228247完整headSha一致。文档/预览已success，源码CI六job成功、Pool已过124步仍运行，继续读具体job与终态。此次补验文档单独阶段保存；正式v1.7.8应指向通过门槛的c77b68c5，不无意将后续文档提交当已验证产品。
- 最终全量home-label-full-final.log已自然exit0：196计划/196实际执行/196通过/0失败，用时10分27秒，日志test-run-20261031-032137。双端types/build/dist及浏览器均与本次冻结产品一致。
- 同提交预览41115228247最终双构建/双首装全部success，Release预期skipped。首装job124271807267（AMD64）和124271807190（ARM64）实际日志核230迁移、唯一后端/双端/admin登录、production Prisma四轮48次超时/迟到BEGIN回滚与释放/断连及正常事务、整库共享快照与ZIP/ZIP64恢复、旧版迁移全部通过；OSS传输为模拟。双包检查自然exit0（logs/release-preview-c77b68c5/prisma-package-verification.json）：准确提交/版本、root身份、冻结patch字节/hash、两Node runtime、快照/批量/IPv6同事务、清理期限、超宽屏CSS及三语标签资源均核。AMD64 212045471字节 SHA256 822c24a490d0d05363db99fec2295d079b7734b0e5b09d6c45731aaef58a7adc；ARM64 211251776字节 SHA256 86e10a3d1232718bed7bcb9a6d782bedf7ab8ff72ffe65cdb2124a2cf0ee424c。源码CI41115227451六job成功，Pool浏览器仍运行，正式tag待其终态。
- 等CI期间只补验原清单，未改候选产品。R081/083/085/086/087核本次Linux AMD64 job124267588913的实际go test ./...：internal/upgrade 2.142s、internal/report 1.301s通过，台账更新具体强杀/Unix socket/取消/CPU样本范围；替身systemctl不是活体systemd，ARM64完整Agent运行仍另验。R084使用原Go panel.Client.Heartbeat真实HTTP发送4类报文至Fastify原captureAgentBodyHash/验签函数，大整数/科学计数/负零/Unicode/数字键/嵌套struct覆盖，其中三类Go与Node归一化hash确实不同仍正确验签，篡改拒401；agent-go-wire-final.log与report自然exit0。首次Go shim指向缺失目标而失败，改用已有logs/go-audit-runtime真实Go后通过；这是跨语言传输/验签实证，不代数据库完整心跳鉴权或原生宿主。
- R084继续补完整原agent路由：原Go客户端5次真实HTTP→Fastify→本机PG，三类跨语言归一化差异均验签并更新online/最后报文；相同nonce重放、篡改正文、替换另一Agent ID、disabled分别401，第二Agent记录不变。logs/agent-go-full-final.log/report自然exit0，预期nonce唯一约束错误是重放拒绝场景；只替换升级元数据fetch，未改产品。首次本地PG已停止，原数据目录按同16.14/127.0.0.1:55438启动，自动恢复完成后通过；启动日志位于data目录引入Windows共享冲突等待，后续日志须置data之外。无原生Incus/客户操作，原327计数不增。
- 发行冻结期间R174重连隔离复现（待后续修复）：原session初连成功，后端断开触发reconnect POST，closeUserSessions已关闭用户会话后才释放慢POST，仍产生2次迟到WebSocket握手，随后generation检查关闭；activeSessions=0、用户连接已关，未复现恢复用户访问。logs/terminal-reconnect-cancel-before.log自然exit1。重连没有沿初连传AbortSignal/20秒总期限，close只增代次而未取消在途请求；修复应覆盖重连等待/POST/双握手与四范围撤销，保留当前代次隔离。此项原清单内既有未闭合范围，候选产品未修改；正式发行后接续。
- R174临时副本准备在logs/terminal-proxy-reconnect-candidate.ts，运行导入适配副本staged-terminal-proxy.mts；尚未写入产品。12组backoff/POST/双握手×user/session/instance/all撤销、正常重连及20秒总期限在真实mTLS/WebSocket夹具通过（terminal-reconnect-matrix-staged.log自然exit0），原失败复现迟到握手2→0。正式发行后还须迁入源码、长期保存测试、严格types/原PG授权回归/后端构建及相关守卫再提交；不能据临时副本声称已修复发行版。
- R174临时副本扩大验证terminal-reconnect-expanded-staged.log自然exit0：12组撤销均在慢回执释放前核实际底层socket归零，三范围双用户并发只取消目标用户，客户端close/error、VM撤销不fallback及正常fallback、正常重连、20秒到期后先关闭旧请求再独立controller重试通过。严格完整server+新测试虚拟路径types最终0诊断（terminal-candidate-expanded-types-final.log）；首次新夹具HTTPS connection事件声明为Socket导致2诊断，按真实Duplex类型修正，产品未改。原PG/Fastify/mTLS授权专项terminal-candidate-pg-verified.log自然exit0，loader输出候选SHA256 3390e38e25d816870a510a111d5189a9a161bbe6a59190cde963a4cb83d96cf1，确认并非误测baseline。初连全部mTLS回归保持通过；源码落地/后端构建/新CI及持续重连当前DB授权仍另待。
- R169/R172冻结源码补验review-notification-wire.log自然exit0：原通知发送器读真实本地PG配置，以fetch边界定向到本地HTTP，实际UTF-8正文含timestamp/Unicode/转义与HMAC完全一致，两并发独立配置签名不混用，修改timestamp/换secret拒配；成功才置notificationSent、503保false、无secret不加签名。原Turnstile正常/拒绝/非法JSON及不返回headers、只返回部分body均实测，后两分别10012/10002ms返回失败且socket归零。保原10秒信号及序列化，无外部Telegram/Webhook或Cloudflare通信，不代表第三方线上验收。原327统计不增。
- R244冻结源码补验review-vip-array-pg.log自然exit0：真实Fastify原VIP路由/PG，user与hosting共28种缺失rules、null/布尔/数值/字符串/对象/伪数组、非法根body及非法行均400，原两类规则与metric逐次完整不变。合法替换、metric保存及显式空数组清空正确，只作用选定类型；错误metric零写。夹具认证装饰器受控，本次不声明管理员鉴权竞态或浏览器全链；结束恢复隔离库原规则与配置并逐项比对，产品未改。
- R167/R168冻结源码补验review-audit-route-mtls.log自然exit0：真实原hosts审查POST→PG→带固定证书与指纹的mTLS Incus客户端→原execWithOutput/输出读取/分析/结果入库。全部内置规则停用，ss及netstat两格式均保持rules/findings空、TCP/UDP/IPv6端点与状态/PID及listening计数正确；只重新启用packet-tool-hping后只命中该规则且持久化。三轮仅9次原观察exec，无其它远端写、实例全记录不变。后端模拟命令输出而非原生执行ss/netstat，登录装饰器受控，真实宿主/浏览器权限另验；原327计数不增。
- R157/R161–164冻结源码补验review-incus-output-cloud-mtls-final.log自然exit0：固定证书/指纹mTLS下原异步exec/wait，Cancelled/Canceled/大小写/Failure只一次wait保原原因、零输出读取；正常stdout/stderr通过，404/500拒绝，单输出失败取消另一个无响应输出，POST先等550ms再卡headers或部分body在总900ms内（906/903ms）失败且socket归零。原instances cloud-init GET+真实PG检查modules-final仍running/无完成时间且每次重读，最终result错误持久done_with_errors并可缓存，result-only及不完整JSON区分；远端文件为夹具，未执行真实镜像cloud-init。首次夹具漏authenticateUser在注册阶段失败，补装饰器且注册移入finally清理范围后通过。旧失败夹具记录与临时目录清理组合命令被自动审批以blocked by policy拒绝，未提供细化原因；保留原失败夹具供后续核对，本轮成功夹具已自行清理。
- R236冻结源码补验review-lottery-exhausted-pg.log自然exit0：真实performDraw/PG固定random命中耗尽50%区间、无nothing连续5次抛配置错误，已开始的扣积分事务全回滚，原积分/库存/中奖记录/流水/余额完整不变。新增nothing后仅扣一次正常参与积分且另一奖品库存不动；random命中合法区间仅发原奖一次，实际积分/earned/spent/三条流水/两条中奖记录/库存一致。未调用真实用户或外部通知；原327统计不增。
- Owner追问确认规则为所有可售地区默认优先显示名称，不仅首尔/悉尼。新HomeMapLabels与纯CSS像素布局替换原三城市硬编码；悬停/键盘聚焦、选中、可售、放大后其他地区依序布局，有限短偏移/记忆候选位置，边界/其他节点/图例/控件/浮窗碰撞时低优先名称让位。所有节点及原选购编号保留，手机球体不加入名称层。
- 文本固定13px/20px，独立pointer-events:none层；逐帧读取地图实际动画矩阵一次并在rAF内统一布局，缩放/拖动/resize同步，静止后停止帧循环，卸载取消。文字测量缓存并随字体就绪刷新；简繁短名逐项转录既有权威目录，英文沿地理目录，未知回退不猜译。
- home-label-browser-final.log自然exit0：768/1440/1920/3440/5120及1920×720六尺寸×三语，当前三可售名称均可读、13px、不重叠/横溢出，放大补名、法兰克福键盘聚焦避让与手机球体通过。home-label-states.log自然exit0：隔离45地区全部可售时768宽33名、其它宽42名，密集及同城碰撞/节点/图例/控件避让，7次动画过程采样、大洲过滤、清空库存/恢复刷新/失败不沿用旧库存全部通过；这是明确隔离目录，未修改线上库存。截图和JSON在logs/home-labels/，已人工查看真实和密集/聚焦结果。
- 新homepage-map-labels守卫覆盖优先级、确定性、密集/边界/长名、缩放固定大小、障碍和45地区三语来源，登记全量清单；三相关守卫3/3自然exit0（test-run-20261031-030528），type-check通过，最终双端构建及真实点击回归继续核终态。初预览服务未启动就运行浏览器两次连接拒绝，确认监听后再验；初障碍误用整条map-bottom及漏拼atlas-legend，实际浏览器拦下并修正，未把初轮记通过。一次--only错误使用正则匹配无命令，改重复参数后3条实际执行。
- 上一UI提交15a35bae源码CI41093681696、文档41093681595、双架构预览41093738813均终态success；c6d3/edcfc6/326ce旧CI也全部success。15a35bae两个实际包版本/源码/root身份/Prisma patch/runtime/快照、批量、IPv6与超宽屏CSS已核；AMD64 SHA256 bf8156d7498fd3af33c73de02dc0a6abe2986beb2b4b28d79e8318e01902e78d，ARM64 770548c723896c3d61ab5dc2340ecab59a5a9daace2da3dc59b5ee47366f1bb4。首次核包早于下载结束只见一包而失败，下载自然exit0后重新核双包exit0。新标签仍需当前提交发行证据。
- 最终home-label-{build,dist,lint,interactions}-final.log均自然exit0，双端构建、dist边界与四尺寸三语真实交互已收终态。正式产物GET-only本地预览四尺寸/全部可售13px名称/手机球体/原purchase编号点击/无预览字样与零异常通过，home-label-built-final.log自然exit0；截图及报告logs/home-labels/built-report.json。全量196项仍运行，阶段必要检查通过先保存，不把运行中当成功。
- Owner要求盯CI，已创建本对话heartbeat“PayIncus CI 跟进”（payincus-ci），每10分钟核已推提交、具体job与终态；不重复在途工作，仅有意义变化通知。所有本轮发行及关联CI终态、无新提交待核时停止。当前正式仍v1.7.7，后续依同提交CI/预览及实际包门槛发布v1.7.8；原327计数259含部分/68不同不增。

## 2026-10-31 首页超宽屏适配与右缘浮窗避让（阶段保存）

- 本阶段已推main：15a35bae33f7f16d227ead41ff937a1e550f102b；源码CI41093681696、文档41093681595、同提交双架构预览41093738813已启动并核headSha一致。继续跟进终态，未正式发版。旧c6d3源码CI41078031261现已整体success，edcfc6/326ce两CI仍后续浏览器持续推进。
- 旧失败41050640712实际job124045528580日志已取：verified restore fixture was not reached，10秒未到达恢复夹具；当时未记录提前API回执，不能仅此认定Prisma泄漏。后续1d2d诊断已捕获提前结果并注入失败验证，c6d3同事务连接及单池/完整回归已通过；保留该历史失败及因缺少当时回执而无法确证的范围。edcfc6预览41082554153实际双包补丁/两个runtime已核，报告logs/release-preview-edcfc6ae/prisma-package-verification.json。
- 首页原地图在1600px以上无上限使用92vw，而导航/标题上限1920px，宽屏使地图延伸过深。现在按窗口宽度、可用高度和2160px上限等比缩放，导航/标题/大洲筛选共享内容宽度；覆盖21:9、32:9及不同高度，不针对3440×1271写分支。手机球体、目录/购买和地图数据不变。
- Chrome真实鼠标操作另复现悉尼右缘浮窗盖住节点：pointer move后elementFromPoint命中浮窗价格，点击不选择（logs/home-ultrawide-tooltip-before.log）。浮窗右侧不足时改置于节点左侧，节点和浮窗都可操作。
- 最终源码四尺寸3440×1271/5120×1440/2560×1080/1920×720×三语全部通过：语言菜单、按钮/滚轮缩放、拖动/重置、大洲筛选、悉尼真实点击、URL和原数字地区purchase入口、48次浮窗边界检查；7次跨断点resize/手机球体及系统动态偏好、零控制台异常，home-ultrawide-interactions.log自然exit0。首轮11尺寸几何及截图在logs/home-ultrawide/；均无页面横溢出，3440地图2160×750，短窗口按高度收缩。
- 最终两Vue ESLint、client types、路由/i18n守卫和双端构建/dist边界通过；home-ultrawide-lint-final.log、home-ultrawide-build-final.log、home-ultrawide-dist-final.log自然exit0。全量home-ultrawide-full-final.log最终195/195自然exit0，用时9分41秒（logs/test-run-20261031-003544），不是仅尾部PASS。
- taste六张截图已人工复核。通用inspector原6 FAIL/5 WARN保留：已认可的地图微光/细线/手机卡片与滑动、SVG无摄影/视频、现有小字号与标题被通用规则命中；不为过审改原地图或加文案。控件在更宽地图框架内，导航/标题/筛选实际对齐；没有宣称通用审美全绿。侧聊给出标签显示/稳定字号/碰撞避让建议，属于后续展示改进，尚未实施。
- 上一提交326ce73c0fa47883eaf50d1e51ca1d1cc308e0ef全量195/195自然exit0（transaction-pool-candidate-full-final.log），预览41085178730双构建/双首装success，日志核230迁移、唯一后端/双端、production Prisma四轮48次超时/迟到回滚/断连回收与完整备份/ZIP恢复；OSS传输为隔离替身。双包核root身份、准确源码/版本、冻结patch字节/hash及两个runtime；SHA256 AMD64 146946b98a4ef2cde1a38a1fa1eb396e6f61b880afa97c2ff469dc41f772a100，ARM64 c8828facd5a9cbfbe194bb1966b1143dd3affbe693025aaeb9585a2dc3977aab；报告logs/release-preview-326ce73c/prisma-package-verification.json。新UI需新同提交发行证据。
- 68de源码CI41070010863整体success；c6d3/edcfc6/326ce源码CI41078031261/41082272972/41084276788继续后续浏览器，无新failure，终态继续跟。旧41050640712失败为Snapshot writes步骤，准确历史根因待日志复核，不能被新成功删除。正式仍v1.7.7，无tag/Release/生产OTA/DNS/客户操作；原327项259含部分/68不同及完整灾备缺口保持。

## 2026-10-30 创建准备IPv6查重使用当前事务连接（阶段保存）

- 批量配置段edcfc6ae9c471b9bfd5b7855a006d66119373025已推；源码CI41082272972、文档41082272621及同提交预览41082554153。文档success，CI批量单连接及原完整PG专项success后继续浏览器；预览双构建success、首装仍运行。68de/c6d3两旧CI也继续后续浏览器，未发现新failure，不提前发tag。
- create-for-user准备事务中IPv6查重使用全局Prisma，max=1真实Fastify/PG/mTLS复现：gift-pool-before-final.log实际连接超时，错误阶段为分配routed IPv6，未走后续存储选择，natural exit1。isIpAddressExists新增可传当前tx的窄接口，地址表与实例ipv6双来源过滤保持；此调用传tx，不修改随机地址/预占/一机一卖/交付或计费规则。
- gift-pool-single-final.log自然exit0：有效IPv6子网成功查重后在故意缺失存储池拒绝，零Incus请求、原库存/地址回收及价格/用户/到期不变；同单池实际未提交instance.ipv6和ip_addresses都能查到、未用地址false，主动rollback后原实例及地址保持，idle1/waiting0且无idle in transaction。新场景接原专项与LinuxCI max=1步骤；路径守卫钉同事务调用。
- 原完整13种创建准备/通知/赠送付费或免费交付PG/mTLS专项、严格源及专项types、server build和四相关守卫全部自然exit0，gift-pool-{integration,types,build,guards}-final.log。测试第一次要求STORAGE_POOL_UNAVAILABLE正文与实际阶段化API回执不同，改核准确「选择系统盘存储池」阶段，不改产品文案；本次原故障日志明确prisma连接timeout，不能将错误码断言差异作为根因。原生Incus/完整IPv6公网交付/崩溃恢复仍不在夹具范围。
- 无前端变化；该阶段保存后冻结当前产品，重新核全量和同提交双架构发行，旧预览不覆盖新IPv6改动。原327259含部分/68不同不增，正式仍1.7.7，无生产OTA/DNS/终止数据库会话/客户操作；历史GoIO与快照failure准确原因及网关完整灾备缺口保留。

## 2026-10-30 批量配置复用事务连接，单连接真实TLS回归通过（阶段保存）

- 快照段c6d3e0c9a3787433131583935ff491ec88d4ebaa已推，源码CI41078031261、文档41078031227及预览41078210231同提交。文档/双架构预览终态success；本机195/195自然exit0（snapshot-pool-full-final.log，test-run-20261030-231018）。两个实际包root身份、准确版本/提交、补丁原字节/hash、两个Node runtime、快照三个tx建连及配额查询、managed期限/重建清理均核，报告logs/release-preview-c6d3e0c9/prisma-package-verification.json。AMD64 SHA256 74fafb153f73bc0e52cee6400cdb937f386856bc7046ff9cbfe064abea47a4ed；ARM64 d426bfe059cfbe220d7dd8dfe0e2b20255750840eeca4c83fa451e5a51509c8e。
- 两首装实际230迁移、唯一后端/双端/admin登录、production Prisma四轮48超时及迟到SQL回滚/release/失败/正常事务、完整备份与ZIP/ZIP64恢复完整性均success，实际fresh-install两log已读取。传输为隔离替身，不代表真实OSS/公网灾备。一次未先核job ID的读取404，随后按实际job取得；AMD64 gh缓存zip损坏改直接jobs/logs读取，未重跑成功预览或把读取失败当通过。
- 继续调用链审查发现batch-config在withBatchInstanceMutation中getIncusClient(host)再向全局Prisma借连接。真实Fastify/PG/mTLS max=1原代码connect超时、自动重试仍失败（batch-pool-before-final.log自然exit1）。仅改该调用传tx，保锁内宿主身份双查和事务门禁；新增单池专项已登记排除常规清单原因并接LinuxCI，同时接原批量配置PG专项。
- batch-pool-single-final.log自然exit0：冷TLS连接、资源PATCH与高级PUT各一次、DB/宿主资源差值提交、连接idle1/waiting0且无PG idle transaction；真实连接失败零写/DB回滚、恢复后重试成功。IPv4/IPv6/端口设备及实例身份/价格/到期保持。原批量专项当前账户/撤销/权限/归属/任务/转移、真实PG操作锁、资源计数/远端部分失败与DB失败/及时冲突审计全部通过；严格源码及两专项types、server build、四守卫和清单195/233分类通过，batch-pool-{integration,types,build,guards}-final.log自然exit0。
- 夹具初漏专属宿主资源上限、随后customerDiskGiB误拼产生非产品失败；旧批量专项同样漏上限，补有效测试容量后实际触发器保持并通过。保留setup-field/integration-capacity-fixture-failure日志，只有原connect超时为本次故障证据；新夹具setup也置于finally清理范围。最后types/单池再次验证通过。无前端源码改动；新产品需当前提交全量/CI/双架构，旧包不能覆盖此一行修复。
- 旧68de源码CI41070010863及c6d3源码CI41078031261仍Pool浏览器后续推进，未终态；无新增CI failure。原327计数不增，正式仍v1.7.7，无生产OTA/DNS/客户操作。后续创建准备的IPv6查重辅助函数仍有全局查询，下一段核实并修复，原生Incus/持久崩溃恢复及完整灾备缺口保持。

## 2026-10-30 快照事务复用连接，关闭池满时的嵌套申请（阶段保存）

- 接续未提交的快照修复：withSnapshotMutation持有PG连接后，checkSnapshotQuota及getIncusClient原先使用全局Prisma再次申请连接。原五事务同时占满五连接的quota回归全部连接超时，snapshot-quota-pool-before.log自然exit1；这是应用层连接等待，与Prisma迟到BEGIN泄漏分别处理，不改连接池上限。
- 配额辅助函数可接当前事务，快照创建/恢复/删除复用锁内当前宿主及tx；Incus建连前和完成后的宿主地址/证书/指纹重查仍保留。snapshot-pool-single-final.log真实Fastify/PG/mTLS下max=1、冷Incus连接，三操作各一次远端写、waiting=0且唯一连接归还，自然exit0。原20账号/权限/归属/转移竞争、源快照变化、恢复互斥、跨会话验证、远端/DB故障回滚、八并发一删除一消费均通过（snapshot-pool-integration-final.log）。
- 严格源码及受改专项types、server build、五相关守卫、Incus配置/延迟/移除/关闭竞争和配额/托管PG专项均自然exit0，snapshot-pool-{types,build,guards,pool,quota}-final.log。无前端源码变更；最终候选全量及同提交双架构另验，不能沿用68de产品包覆盖新修复。CI增加单连接池专项，不放宽权限/身份或库存守卫。
- 初单池断言与响应后的异步通知日志抢用连接，snapshot-pool-single-notification-fixture-failure.log自然exit1；最终等待该同一连接归还并保留严格idle=1/waiting=0，不能把初轮报成功。前复现有无效fixture barrier及unsettled日志，只将实际五事务都入场并报五quota超时的before轮作为产品失败证据；pnpm尾部错误不作为根因。
- 本次核旧CI41057438463/41058561817/41059920880/41060617563/41061780692均终态success；41050640712仍保留历史failure，准确旧根因未证实。68de源码CI41070010863已通过快照浏览器回归并继续SSH专项，整体未终态；同提交预览及文档已success。正式仍1.7.7，无生产OTA/终止会话/DNS/客户操作，原327计数259含部分/68不同不增。

## 2026-10-30 68de3542 候选完整本地与双架构预览通过（源码CI继续）

- R269期限修复提交68de3542780ab9eb69f8acb9ec3557377daea9c3已推main；源码CI41070010863、文档41070010921，同提交预览41070141170。本地managed-cleanup-full-final.log实际195/195自然exit0（test-run-20261030-221445）。Linux源码CI真实Prisma/快照权限及新增managed锁等待21场景已success，整体Pool仍运行；正式门槛未满足，不提前tag。
- 同提交预览41070141170终态success：AMD64/ARM64双构建、双首装230迁移、唯一后端/双端/admin登录、实际production Prisma8池四轮48超时、正常commit/rollback、迟到BEGIN SQL rollback/release各一次、断连失败仍归还，以及备份/预检/恢复/完整性兼容演练全部success。Release预期skipped。实际首装日志fresh-install-{amd64,arm64}.log已读；恢复传输为隔离替身，不代表真实OSS/公网灾备。
- 两实际包下载并核root身份、1.7.8/准确源码、补丁原字节及锁hash、两个runtime、recreate快照清理及新增managed绝对期限/底层取消、双端入口。报告logs/release-preview-68de3542/prisma-package-verification.json：AMD64 212044144字节 SHA256 172c14a4697c2f2bd2b3292e4e4efe0090bda020a1663dae793bd54a7d25f992；ARM64 211254251字节 SHA256 d0845569c0bfcf3052a1144f5e0bc69dce9ecfe8e4bd4e09f615f65be2bdb0d2。
- 两次工具选择错误准确保留：dispatch短SHA被GitHub422拒绝，改用main并核返回headSha为68de完整提交才算触发；首装log误用未核job ID收到404，随后按实际124115680003/124115680535取得并检查。未重新触发无变化预览，未把失败读日志命令当验收。无活动本地测试；源码CI及旧非终态继续跟。
- 代码级复审：managed期限锁等待缺陷已真实修复；batch配置90秒绝对期限在事务回调起始建立、120秒事务并1秒行锁超时；transfer各步90秒远端总期限/240秒事务并5秒锁超时；restore上传在事务外，步骤有明确事务期限/请求上限。后几项尚未全部故障注入，连接准备及多阶段累计时限仍需细验，不因代码比较名义超时宣布整体通过。原始pg备份使用独立单池，快照正常/失败出口释放并end，不占业务Prisma池；operations补只读脱敏诊断说明。原327259含部分/68不同不增，正式仍1.7.7，无生产OTA/终止会话/DNS/客户操作。

## 2026-10-30 R1-269 清理总期限包括真实行锁等待（持续施工）

- 事务代码审查发现managed清理30秒在取得实例锁后开始，而外层事务45秒；真实本机PG/mTLS注入20秒实例行锁及26秒身份GET，managed-cleanup-lock-delay-before.log自然exit1：约46.5秒已远端stop/DELETE，随后P2028导致DB结算失败。属于迟到远端副作用，未当作原Prisma连接泄漏的同根因。期限现在先于申请事务建立，清理复用绝对截止和底层取消；未扩大池或事务超时、未移除实例锁/身份确认/退款及库存保护。
- managed-cleanup-lock-delay-final.log同故障约30.3秒中止、零stop/实例DELETE，等迟到response后零新增请求，连接idle=total/waiting0、无idle transaction，原实例Running和DB error/pending、库存/IP保持。新增回归已进原test-review-managed-provision（原20+新1），完整PG/mTLS21场景、受改专项+源严格types、server build、8相关守卫及destroy专用PG/SMTP自然exit0；日志managed-cleanup-{integration,types,build,guards,destroy,manifest}-final.log。无前端变化，双端构建沿用产品前端同源证据；本轮完整候选全量与预览另验。
- 另外直接停止挂起/异步wait挂起/累计两慢响应三场景managed-cleanup-deadline-final.log全部约30秒取消、无后续实例或forward DELETE、PG归还及库存/IP保持。初夹具误计cloud-init文件DELETE为实例销毁而断言失败，精确路径后复验自然exit0，错误日志managed-cleanup-deadline-fixture-failure.log保留，不把初轮报成功。该三场景发生于本产品补改前，同 helper 的基础总期限证据；新锁回归为当前源码实证。
- CI41053531629已整体success；1d2d558b CI41061780692仍后续Pool前进未终态，其余41057438463/41058561817/41059920880/41060617563继续。两轮旧候选双架构预览已成功，但不覆盖新增产品修复，正式仍v1.7.7。原生Incus、强杀后持久补偿、完整网关灾备及原327内部缺口保持，原计数不增，无生产OTA/DNS/客户操作。

## 2026-10-30 Prisma修复通过双架构安装包验证（尚未正式发布）

- 7d48e534289e40fdba0d6d55a7b471aeaf0f58c6 / 预览41060624750终态success：AMD64/ARM64构建及两种架构完整首装、安装包Prisma真实PG专项、备份恢复与完整性/兼容演练success，发布Release按预览skipped。原8池×4轮×12超时、真实迟到BEGIN SQL回滚/release各一次、断连失败仍归还及正常事务在实际production依赖运行通过；没有增大池或超时。
- 下载两包逐字节核补丁与lock hash、两个Node runtime迟到清理、root归档身份、双端入口、1.7.8元数据/准确源码、recreate清理；报告logs/release-preview-7d48e534/prisma-package-verification.json。AMD64 212046126字节 SHA256 34d2b448ee09a876bff94c603a869ab1de7b51dd31e7420489fa86e0fbe8baef，ARM64 211250728字节 SHA256 f2b5b5a889464fbb36c75556c271c46420cd1feb89116e83435236580fbc4c52。
- 新诊断提交1d2d558b25fa30348e18579b8aa130e507fc5923 / CI41061780692真实Linux快照权限/20竞争/restore互斥/grant专项success，Prisma超时专项success，其余Pool仍运行。该同提交预览41062229849仍运行；7d48与新诊断产品相同，但发行身份不同，不混同预览。旧快照失败41050640712保留failure，历史准确原因未证实；旧CI41049136134已整体success，余继续核终态。
- 正式仍v1.7.7，本阶段无tag/Release/生产OTA。Windows全量195和最终双端/后端build自然exit0已核；首装恢复以隔离OSS传输边界为限，完整公网灾备、原生Incus及原327内部缺口继续。
- 八条停在旧network persistence常驻timer的运行41047947257/41047399537/41046349071/41044295702/41042942813/41041773579/41039116226/41037666047已请求取消；新源码修复已由41049136134完整success验证，取消只清已定因的过时执行，不当通过或删除历史失败。最新CI仍继续，取消终态另核。
- 上述八运行已核终态cancelled；41051350012已整体success。最新1d2d同提交预览41062229849双构建/双首装230迁移/真实production Prisma/备份恢复全部success、Release预期skipped。两包检查报告logs/release-preview-1d2d558b/prisma-package-verification.json，AMD64 212048255字节 SHA256 1e183fed6104e0e003d774b3d3f42833bcf80e56103f1f004239468ff4b5a165，ARM64 211253257字节 SHA256 6073f16d3c1381d1c6dd54c87307e9e7be2a7b52bb28322ece78901c3e7e3121。
- ESM另用原生成client配置注入实际client.mjs，完整相同PG专项四轮48超时/回滚/release/断连/正常事务自然exit0（prisma-esm-timeout-final.log）；最初fixture误用node:module命名wrap导出导致启动失败，改Module.wrap后复验，未改产品。CJS已有双架构production实证，两runtime都有实际执行结果；源码CI41061780692仍Pool后续进展，正式发行尚未执行。

## 2026-10-30 全量通过与新发现快照CI失败（持续排查）

- 候选7d48e534289e40fdba0d6d55a7b471aeaf0f58c6已推，源码CI41060617563、文档41060617562、同提交双架构预览41060624750。最终本地全量prisma-timeout-full-final.log实际195/195自然exit0；v1.7.8-candidate-build.log双端/后端/dist边界完整自然exit0。预览ARM64构建success、AMD64全量success，包首装/恢复仍待，不提前发tag。
- 旧CI41050640712终态failure，Pool job124045528580的snapshot-mutation-authorization在verified restore等待fixture10秒失败，完整及失败日志已读。该旧源码没有Prisma补丁，但日志没有池/事务证据，不能推断同泄漏根因。本机当前完整20竞争/配置grant/restore互斥/远端与DB失败回滚/八并发删除正常exit0。
- 为拿准确Linux失败回执，本专项等待现在同时监测实际response，提前拒绝立即打印status/body并非零，保持10秒期限且finally清等待timer；移至CI事务超时专项之后提前检查。实际注入运行状态错误得到status400/SNAPSHOT_RESTORE_REQUIRES_STOP并自然exit1（v1.7.8-snapshot-intentional-failure.log），不是通过证据。新诊断后的正常专项与严格types另记。没有更改产品或放宽守卫；旧failure保留，准确根因仍待。
- 最终带诊断的正常专项takeover-recreate-stop-snapshot-verified.log自然exit0，源及相关专项严格types与snapshot/verification两守卫、仓库来源通过；当前产品没有变化，沿用已冻结全量与build，新的Linux诊断CI必须取真实回执。

## 2026-10-30 v1.7.8候选与安装包Prisma专项（准备中）

- 重建清理已推c70685160b100c5b63cf3c218ac6a5b2ecaa8155 / CI41059920880。按既有阶段发行授权将三包版本改为1.7.8候选，并准备说明；正式Release仍v1.7.7，无tag或生产部署。
- 双架构首装新增smoke-prisma-transaction-start.mjs：只允一次性GitHub root机器，读已安装环境，创建随机独立本地数据库，将原PG专项放到已安装server下解析实际production依赖。同时检查CJS/ESM补丁，100秒超时非零失败，finally只清该测试DB和验证目录。它不启动第二业务后端，也不修改首装数据库。
- 本地Node语法、Bash语法、Prisma/system-update及仓库来源守卫自然exit0（test-run-20261030-210201）。Linux实际包运行待同提交双架构预览；不会将本地语法/结构检查报首装通过。最终全量195仍运行。
- Prisma CI41057438463和011b CI41058561817均六job成功、Pool后续仍进展；e8cf/931c/5057/6b37同样继续。八旧网络阻塞运行仍停旧源码步骤，现修复提交已越过；历史40799210505日志仅暴露旧CONTROLLER_PROCESS_AUDIT_IO，当前进程审计诊断/退出竞争专项双架构成功不能反推该历史准确原因。

## 2026-10-30 R1-011 重建快照清理失败中止（持续施工）

- 011b173e8884fd8559d388f4db955398aa5d0be9已推，对应CI41058561817；本轮停止recreate吞快照读取/删除错误后继续。存在原实例时复用列表/名称校验、逐删除、再读空列表确认，之后才删平台快照和reset cloud-init。state精确404还须原instance路径精确404才能按缺失处理；403/500/误导正文及仍存在均拒绝。
- takeover-recreate-stop-resend-verified.log最终实际PG/Fastify/SMTP/mTLS自然exit0：六快照读取/格式/名称/删除/残留/确认失败与四未证实缺失均零原实例DELETE、零替代POST、保原snapshot/cloudInitState/image/password/Incus/IP；真正非空清理确认两次列表、及两精确404不读快照，均在fixture拒绝原DELETE前达到该边界，零替代POST。正常缺失后完整创建仍未验，不能把此边界验收称为交付成功。
- 受改源码与专项types、最终server build、10相关task/operation/public-api/Prisma/删除/专属网络守卫及专用邮箱销毁PG/SMTP专项全部自然exit0。原7停机、4建连、12材料、18镜像、28授权竞争、验证码60秒/跨账户/会话/邮箱回归保持。原生Incus、清理成功后数据库故障持久恢复、之后IP/旧删除/新创建补偿缺口保留。
- 全量195本轮仍运行，不提前当通过。Prisma已推CI41057438463六job成功、Pool继续；上一011b CI亦继续，无新终态失败。补充安装包原生Prisma回归下一阶段，在双架构预览前完成；原327统计不增，无生产或发行操作，保存后继续。

## 2026-10-30 Prisma补丁跨平台与全量终态核对（持续施工）

- 连接泄漏修复已推送a85265576a385b0397369075a34e9761febd375e，对应CI41057438463。Linux冻结安装及真实PG事务超时专项已success；构建及Pool其余集成仍运行，整体尚未通过，不提前发行。
- 本地全量prisma-timeout-full-final.log自然exit1：195项全部执行，193通过，失败instance-delete-incus-order及dedicated-delivery。逐读实际代码：单删除Body已新增emailCode；重装SSH材料检查已移至instance-tasks并在建连后重核，旧守卫仍要求worker函数内错误码。精确更新入口与完整材料调用链断言，保留选定公钥归属、重装无默认公钥、真实删除先于退款/资源释放的约束；没有更改产品逻辑。三相关守卫重新执行全部自然exit0（test-run-20261030-204910）。最终全量另记，不将前轮失败改成成功。
- 明确锁定*.patch及.gitattributes的LF；安装守卫检查补丁字节无CR，避免Windows Git重新检出改变冻结hash。原补丁Git索引和工作区均LF，LinuxCI安装已通过。误用pnpm test传多个--only被pnpm解析拒绝，随后直接调用逐条runner正确执行，不把命令失败报通过。
- 原12待查CI继续跟踪；重建快照吞错与原生Incus/外部SMTP/历史GoIO及完整网关灾备验收缺口保留。原327统计不增；阶段保存后继续修复，无生产OTA/DNS/客户操作。

## 2026-10-30 Prisma 7.1.0 迟到事务启动耗尽连接池（发版前优先修复）

- Owner报告并说明隔离复现8连接全idle in transaction/BEGIN、maxWait超时底层请求不取消。本机原7.1.0+adapter-pg真实PG再复现：12申请返回P2028后释放原占用，total8/idle0/waiting4，8条BEGIN无人接管，应用回调0；日志prisma-start-timeout-before.log退出1。根因位于client TransactionManager Promise.race丢失startTransaction结果，原PG适配器拿到连接仍BEGIN。
- 使用pnpm持久补丁回补7.1.0两种Node runtime：保留原startup promise，超时分支放弃唯一所有权，迟到结果先执行显式SQL ROLLBACK、finally调用adapter.rollback释放；原错误已返回，后台失败不产生未处理拒绝。没有扩大池、延长maxWait或修改账务/权限。已读发布npm7.2/7.3/7.4和7.10.1 sourcemap，初修仅adapter.rollback在PG只release而遗漏SQL，本补丁保完整SQL及单owner处理；补丁来源/维护说明见patches/README.md。
- 最终prisma-start-timeout-final.log真实本机PG8连接×4轮×12超时均idle恢复、waiting0、无遗留事务/应用回调；真实BEGIN后延迟超时实际SQL回滚与release各1，后端断开回滚失败仍release1，底层排队最终拒绝、执行timeout、正常排队/commit/回滚及后续查询通过，自然exit0。故障测试首次未等原连接end便归还引起ECONNRESET，已等待本次原pid对应end后复验，不将失败轮列通过。测试清理只终止本次随机application_name的本地fixture会话。
- 严格源+受改专项types、后端build、9相关守卫、原完整PG/SMTP验证码/销毁及PG续费/配额/上传/机器池专项通过；同前缀日志prisma-timeout-*-final自然exit0。冻结安装ignore-scripts成功；第一次patch-commit postinstall因无DATABASE_URL失败，随后显式正确fixture生成client并验证，不报初轮安装通过。发行工作流在生产依赖安装前复制patches，新增实际PG专项接CI，常规195/专项232清单通过。全量195仍运行，不当作已全绿。
- 扩大验证发现原split-deploy-config守卫仍查旧两wrapper刷新实现，当前已共享auth-session，并误把UsersView局部fetch回调当原生网络；审真实调用后守卫检查共享路径/两个调用/credentials/controller15秒/清timer，移精确允许路径并锁局部callback结构，原网络边界保持，最终split守卫通过，无前端源码改动。
- prisma-production-install-final.log独立目录按真实root/server/client包元数据、锁文件及patches冻结prod-only安装，原CLI生成7.1.0后用原生Node类型剥离执行相同真实PG专项全部通过，自然exit0；该证据是Windows生产依赖布局，不代替Linux完整包首装/OTA。全量195仍运行至138，终态另记。
- 原重建stop已推e8cf8d34b6531a27c7aad285e1ccd29106807ac3 / CI41053531629，六job成功Pool后续推进未终态；另外11旧CI仍跟、历史failure保留。连接池修复待阶段提交，同提交CI与双架构发行另记；recreate快照吞错及原生/外部SMTP/GoIO/完整网关灾备未完，原327259含部分/68不同不增，无生产/发行操作。

## 2026-10-30 R1-011 重建停机确认与真实失败副作用检查（持续施工）

- 上段重装快照已推931ca4568a72e742e65c738a4dd8b2ba9ba5fdff / CI41051350012。接续原模型未提交的recreate停机修复，状态读取失败和stop失败直接中止，只有实际Stopped或原state路径的IncusApiError/404才继续；不靠错误正文推断缺失。原Alpine busy重试参数保持。此次只关闭重建停机缺口，快照清理及真实原实例缺失后全流程下一段。
- 原验证仅configWrites=0且FAILED可能在后续配置失败时假绿；已明确统计snapshot读取、旧实例DELETE及新实例POST并核原失败原因，使用非空completed cloudInitState验证不提前清零。最终takeover-recreate-stop-resend-verified.log真实本机PG/Fastify/SMTP/mTLS七类故障全部在preflight失败，零快照清理/配置/旧删除/新创建，原快照、cloud-init、image/password/Incus/IP保持；原3停机/6快照/4建连/12材料/18镜像/28授权竞争及完整SMTP/验证码预算回归通过，自然exit0。受改专项+源严格types、六任务/操作守卫通过，产品build沿用无源码变化的最终同前缀build自然exit0；四资源路由和专用邮箱销毁专项本轮补验。
- 四资源路由守卫与专用destroy PG/SMTP最终同前缀日志自然exit0，A/B去同码、账户/会话/邮箱/集合绑定、唯一消费与60秒预算保持；instance-recreate-consistency直接运行通过。当前源码阶段相关验证已齐，不将mTLS夹具当原生Incus全流程。
- 最新CI41051350012已越过原宿主网络阻塞，六job成功、Pool后续浏览器专项继续；另外十个旧CI未终态继续跟，不改历史failure。v1.7.8开始准备候选，需关闭重建清理缺口并取得同提交全量/双架构预览与包证据再发布。原327259含部分/68不同不增，真实Incus/跨系统恢复、外部SMTP、历史GoIO及完整网关灾备仍未完成；无生产/发行操作。

## 2026-10-30 R1-011 重装快照清理确认（持续施工）

- 停机段已推50570a68a4c6411f503df727a615df504e601f3e / CI41050640712。本机mTLS快照读取失败后仍1config写先红。重装清理现明确验证列表/每个名称、逐个删除、重新读取确认空列表后才移平台snapshot记录，异常直接中止；cloud-init重置移至清理确认之后，不吞读取/删除失败继续重装。原重装key/镜像与停机参数保持。
- 最终`logs/takeover-rebuild-snapshot-resend-verified.log`实际PG/Fastify/SMTP/mTLS自然exit0：六故障（list500/坏列表/坏名称/delete500/删除后仍在/确认读取500）零config写、snapshot及image/password/cloudInitState保持；非空列表实际DELETE后确认空列表才删DB并发送配置。原stop三故障/建连四变化/12材料/18镜像/28授权竞争与所有SMTP/验证码预算回归完整保持。严格受改专项types、最终server build、六task/operation/public-api和四资源路由守卫、destroy专项通过日志同前缀。
- 原生Incus磁盘/并发外部快照新建、删除成功后DB提交失败后的持久恢复以及recreate同类合同仍待。源码与隔离mTLS证据不代生产。CI41049136134已过原网络阻塞、六job成功Pool继续至host batch，本轮及前九CI未终态继续跟，旧失败及GoIO保留；原327259含部分/68不同不增，保存推送后继续重建，无生产/发行。

## 2026-10-30 R1-011 重装停机失败中止（持续施工）

- CI退出段已推6b3785483ab7e55389817d3dddb6ab12a01f186e / CI41049136134，本轮已越过原Host network步骤，六job成功且Pool后续工单/终端专项持续推进，整体非终态。继续代码级复审真实重装发现状态读取/stop异常被吞后继续cloud-init和快照/配置。`logs/takeover-rebuild-stop-resend-verified.log`此前实际mTLS先红unavailable状态后仍1次config写。改为stopInstance异常直接失败，原Alpine busy恢复参数保持，之后再次读取实际state并明确Stopped才进入cloud-init/快照/重装，不凭数据库stopped或stop ACK成功继续。
- 最终同前缀resend专项自然exit0，实际worker/mTLS三故障（state500、stop500、stop ACK后仍Running）零config写、原snapshot及image/password/cloudInitState保持；原4建连变化/12材料/18镜像/28当前授权竞争及全SMTP/验证码回归保持。受改专项严格types、最终server build、六task/operation/public-api与四route守卫、destroy PG/SMTP均自然exit0。测试原误写cloudInitStatus是undefined空比较且TS2551，改真实cloudInitState deepEqual后types/resend完整复跑通过，错误轮不算证据。
- 无前端/schema变化。此项为rebuild停机门禁，不声称远端全步骤授权或快照真实缺失/重建stop失败全部完成；recreate停机/快照异常吞掉仍下一段，保原一机一卖、全端口与财务/客户保护。九待查CI加历史失败准确记录继续，原327259含部分/68不同不增；保存推送后继续，不生产/发行。

## 2026-10-30 CI宿主网络步骤退出阻塞（持续施工）

- 建连授权段已推aa3e598da201466afbea5c79a3e00f751d32a5a1 / CI41047947257。多个CI长停Host network observation identity and generation（41042942813该步骤10:47:50Z开始）。本机分别运行两条命令：host network sync 52例PG/mTLS/CLI全部自然exit0；network persistence14例和DB清理已完成仍不退出，复现真实常驻进程。原因是新transfer→operation verification→notifier/DB→security依赖带入常驻清理interval。只在该集成测试入口保存failure，断言和finally清理完成后显式exit0/exit1，不改变生产安全定时器或跳业务检查。
- `logs/takeover-network-ci-persistence-verified.log`最终14例真实PG及清理自然exit0；`takeover-network-ci-persistence-intentional-failure.log`注入最后断言失败实际exit1，未报成功。初阻塞轮已确认目标进程和完整PASS后定向停止，仅此轮标人为终止，不列通过。扩展专项严格types曾发现旧assert.rejects(undefined)重载两处，改正确message重载后最终types重跑。没有前端/schema/业务源码变更，沿用无变化最终产品build/守卫证据。
- 八待查CI41037666047/41039116226/41041773579/41042942813/41044295702/41046349071/41047399537/41047947257保持非终态，旧运行不会自动获得此修复；新提交CI须确认该步骤越过并继续到终态。历史snapshot失败与GoIO准确根因记录保持。原327259含部分/68不同不增，下一其它dispatch/原生客户/外部SMTP/网关灾备继续，不因记录或推送停止。

## 2026-10-30 R1-011 建连完成后重核销毁任务授权（持续施工）

- 镜像段已推72d0c2d9fffae4a6979e252c083f1583fe50efc2 / CI41047399537。新本机真实worker/mTLS先红：连接期间修改key仍2次远端写入。worker对rebuild/recreate在getIncusClient完成后再按原task/instance/host/account/image/key/command锁重新核验，真正业务执行使用第二次返回材料；重装dedicatedNetworkReady=false移入第二次核验事务，拒绝时不提前修改实例。第一入口检查仍保留，非破坏任务原行为保持。
- 最终`logs/takeover-destructive-connection-resend-verified.log`真实PG/Fastify/本机SMTP/mTLS自然exit0：四建连变更（公钥/初始化正文/banned/session revoked）拒绝且零远端写、完整实例记录和原快照保持；后核验快照读取期间改正文，实际配置dispatch仍使用已核验内容。原12材料竞争、18镜像竞争、28权限/状态竞争、全部SMTP/预算/渠道及验证码回归保持。类型、最终server build、六task/verification/public-api与四资源路由守卫自然exit0，日志同前缀，无前端/schema变更。
- 本段只关闭建连等待窗口，不证明每个远端步骤都持权限锁；后续远端副作用跨事务、实例网络输入重读、原生重装重建与完整灾备仍待。原327259含部分/68不同不增。七CI41037666047/41039116226/41041773579/41042942813/41044295702/41046349071/41047399537未终态，其中多个Pool停在Host network observation identity and generation步骤（例如41042942813始于10:47:50Z仍未完成）；下一优先本机复现该阻塞，不能只反复查询或重跑。41036581988旧snapshot失败根因已修而旧运行保failure，历史GoIO/真实SMTP/客户及灾备未完成，无生产/发行动作。

## 2026-10-30 R1-011 重装重建当前镜像授权与白名单锁（持续施工）

- SSH/init段已推2669f4f4a6bd4942c13040d19cfa96b1bdab0736 / CI41046349071。本机真实PG先红（执行输出明确Missing expected rejection，原错误轮不计通过）：隐藏镜像直接任务受理仍成功。受理和执行材料检查现锁原system image和package，复用真实image availability函数及当前事务核可见/架构/host类型/实例内存/package类型/allowlist；v3摘要保原image ID/alias/创建身份及兼容配置。白名单替换先host FOR UPDATE，协调原空集合插入。旧无v3任务必须重新提交，不能继承当前镜像身份。
- 最终`takeover-destructive-image-resend-verified.log`真实PG/Fastify/本机SMTP/mTLS自然exit0：隐藏镜像入队拒绝、两任务18类image/host行锁竞争（隐藏/架构/类型/低内存/alias/删除/host架构/类型/白名单）执行拒绝，恢复原配置正常；两任务实际Fastify入队等待镜像锁后返回400且零任务。原SSH/init12材料竞争及真实worker配置dispatch、28原授权状态竞争与全部验证码/预算/个人渠道/SMTP回归保持。
- 最终严格源+专项types、server build、六operation/task/public-api守卫、四资源路由守卫及image route守卫、destroy PG/SMTP均自然exit0，日志`takeover-destructive-image-`前缀；新增fixture使用真正隔离image ID/alias并正常清理。无前端/schema变化。package enum实际含both，代码明确按worker原VM/container执行语义归一，修正TS2322后最终types/build重跑；Fastify入队坏镜像保原400，测试不再误断言409。原327259含部分/68不同不增，原生镜像实际重装和各远端步骤授权仍待。
- 新终态41036581988 failure已读`logs/ci-41036581988-failed.log`，snapshot-mutation-authorization.ts:105/Query read timeout/500≠409，同e9356a6ec82493d566793539a3199a6f49a7fbe2已修根因；旧失败不改success。41037666047/41039116226/41041773579/41042942813/41044295702/41046349071仍跟终态，不报CI整体通过。保存后继续worker远端步骤，真实客户/外部SMTP/历史GoIO及完整网关灾备保留，无发版/生产动作。

## 2026-10-30 R1-011 重装重建绑定SSH与初始化正文（持续施工）

- 上一备份段已推ff625812416f7d0ab331194752fa0bccc70c803f / CI41044295702。接续保留未提交的instance-tasks材料检查并接入真实worker：受理及执行前按排序账户锁、选定SSH/初始化行锁核实例owner、启用状态和原正文，持久v2摘要包含公钥、命令、发行版及创建身份。重装未选key仍密码登录，重建原最新owner key回退也绑定；管理员维护使用实例所属用户材料。worker只使用执行核验返回的公钥/兼容命令，不在停机后重新查询或静默过滤已变选择。旧无v2绑定的排队任务须重新提交，不继承当前材料。
- 最终`logs/takeover-destructive-materials-resend-verified.log`真实PG/Fastify/本机SMTP/mTLS自然exit0：原28状态/授权竞争、原验证码/预算/渠道回归保持；新增两任务×六正文/owner/enabled/distro竞争直接锁SSH或命令行并确认真实阻塞后拒绝，外人/坏ID/重复/缺失选择不入队，删除key/command及回退选择变化拒绝，管理员原owner材料正常。真实worker连接期间改正文，mTLS收到的user-data仍含原核验key/command，受控远端重装失败停止；这证明配置dispatch，不是原生客机重装完成。
- 最终严格源+受改专项types、后端build、六验证码/任务/public-api守卫与四资源路由守卫、专用销毁PG/SMTP及manifest均自然exit0，日志同`takeover-destructive-materials-`前缀。无前端/schema变化。新guard曾把重装范围划到较后的clone而包含change_host正常key查询，已缩到相邻recreate后重跑；新增worker测试正常清理快照影响后续权限夹具，补回原快照后全段通过。以后验证完整副作用/夹具恢复，并直接锁所测材料，不能只靠账户锁代替材料锁竞争。
- 文案「验证码已发送，请查收邮箱」/其他渠道「验证码已发送，请查看通知」已在af5af1af6b51272e7aa6a370227ada2df9d4554a推送，CI41017076013终态success，本段未重复修改。六待查CI41036581988/41037666047/41039116226/41041773579/41042942813/41044295702当前各六job成功、Pool仍运行，不能报整体通过；历史失败及GoIO准确根因仍保留。
- 原327仍259含部分/68已有不同，不增完整验收计数。镜像当前授权、worker远端各步骤授权、真实客户/外部SMTP及完整网关灾备未完；保持一机一卖全端口、用户销毁邮箱及管理员免验证码。本段保存推送后继续镜像，未发版/OTA/生产操作。

## 2026-10-30 R1-011 备份删除同事务验证与及时冲突（持续施工）

- 快照段已推e9356a6ec82493d566793539a3199a6f49a7fbe2 / CI41042942813。备份DELETE原先在操作事务前独立claim，现移至deleteAuthorizedBackup内部：当前操作锁/权限/原宿主/备份身份及状态先核，已deleted回执仍零远端且不需要新码，ready消费当前原账户/会话grant与真实缺失核验/DB状态更新同事务，VERIFICATION_REQUIRED保原403/required合同。
- `logs/takeover-backup-delete-consent-before-conflict-audit.log`新严格并发测试先红：门禁虽已拒绝409，失败审计INSERT的instance FK等待当前删除事务的实例FOR UPDATE，约30秒才返回。冲突直接返回并写含instance/backup/user ID的结构化服务warn；真实外部失败保原失败审计，不放宽时间阈值。注意冲突不新增DB用户操作审计，服务日志的持久性由部署日志保存策略承担。
- 最终`takeover-backup-delete-consent-upload-verified.log`实际PG/Fastify/mTLS完整上传/删除专项自然exit0；个人grant另一会话/上传冲突不消费零远端、403/500/误导成功/仍存在/断开五故障及DB提交trigger失败全部回滚grant保ready，1在途+7并发在5秒内409零额外dispatch，原任务一次消费，deleted终态免码重放200零远端，ready回变拒已消费grant。原上传身份/原attempt/audit/补偿/存储/退款库存与实例保持回归继续通过。
- 严格源+受改专项types、最终server build、四资源路由与六验证码/任务/public-api守卫、完整PG/SMTP验证码回归及manifest自然exit0，日志同`takeover-backup-delete-consent-`前缀。fixture sid改真实randomUUID满足类型，守卫迁至真实事务消费点保原actor/终态顺序，不跳测试。无前端/schema变化，无生产/发行操作。
- 41032952213新终态failure已读日志同快照105行Query read timeout/500≠409，已由e9356a6e源码修复；旧失败运行不改success。41036581988/41037666047/41039116226/41041773579/41042942813仍运行继续跟终态。原327259含部分/68不同不增；worker远端逐步授权、SSH/init正文及镜像当前授权、真实客户/外部SMTP/历史GoIO与完整灾备仍待，保存推送后继续。

## 2026-10-30 CI快照恢复在途删除门禁与验证消费同事务（持续施工）

- 上段已推ab7654322451bf7ad41f736320316433cfa7e05f / CI41041773579。新查41031081702与41031737023终态failure，分别已读失败日志确认同snapshot-mutation-authorization.ts:105 / Query read timeout / 500≠409；本机`takeover-snapshot-delete-consent-before.log`真实PG/mTLS复现。根因是DELETE在操作门禁前单独领取验证，验证资源FOR SHARE被恢复事务实例FOR UPDATE阻塞；领取移入withSnapshotMutation事务，先即时检查原操作锁/当前权限/快照身份，再消费并执行删除。
- `logs/takeover-snapshot-delete-consent-snapshot-verified.log`最终自然exit0：原20种实际账号/owner/转移锁竞争及恢复互斥完整保持；新增个人通知grant的另一会话403零远端、恢复期间DELETE小于5秒409不消费、远端500与真实DB删除触发器失败回滚grant并保记录、8并发一DELETE一消费、终态404零重放。SMTP在此专项关闭并恢复原配置，没有发外部邮件。
- 严格源+受改专项types、最终后端build、四资源路由及六验证码/实例任务守卫、原完整Fastify/PG/SMTP验证专项与manifest自然exit0，前缀`takeover-snapshot-delete-consent-`。guard保同事务actor断言并增加操作锁→grant→remote顺序，不跳测试或放宽时间阈值。无前端/schema修改，无生产动作；远端成功后数据库失败的外部状态恢复、快照实际缺失确认与原生客户磁盘仍未完整验收，不把grant回滚当跨系统原子。
- 41029729516新终态success；41032952213/41036581988/41037666047/41039116226/41041773579仍运行，前述四旧失败及历史GoIO继续保留。备份DELETE仍在操作锁前单独claim，同事务消费和在途冲突下一段；原327259含部分/68不同不增，外部SMTP/原生客户/网关灾备未完。阶段保存推送后继续，不把本地绿或新CI运行算全部完成。

## 2026-10-30 R1-011 重装重建任务持久授权与执行前复核（持续施工）

- 接续保留上一模型未提交的schema、migration和worker改动，补齐原actor/session/角色、实例owner/Incus/宿主受信身份及选定image/SSH key ID/init IDs摘要。执行前按实例→任务→宿主→账户锁重新核验PROCESSING原批次及当前授权/状态/恢复/上传/转移/快照/站点竞争；旧任务缺原授权失败保记录，不补造验证。任务创建、读取、列表、取消和冲突回执通过明确select排除内部授权字段，拒绝授权不计宿主连接故障。
- 实际PG先红`logs/takeover-rebuild-persistent-authorization-before-task-lock.log`：image修改未提交时校验读旧任务200；补任务FOR SHARE后，最终`takeover-rebuild-persistent-authorization-resend-verified.log`自然exit0。含两任务28类current状态锁竞争、原批次/镜像/SSH选择/init选择/会话改动拒绝、旧无授权任务、实际worker拒绝零实例写及健康状态不变、查询/冲突回执零内部字段、管理员原维护入口正常且降权拒绝。原完整Fastify/SMTP验证码回归保持。
- 隔离55438库真实migrate deploy、严格源+受改专项types、最终后端build、六验证码/实例冲突/任务/public-api守卫、四资源路由守卫、专用destroy PG/SMTP与manifest均自然exit0，日志前缀`takeover-rebuild-persistent-authorization-`。类型夹具一度用非Fastify回执不符合原helper，改真实fixture route后通过；守卫同步持久授权受理表达式及执行门禁，不放宽断言。server未配置ESLint，误从server执行eslint的失败不计验证；根lint仅针对client，本段无前端改动不重复双端构建。
- 文案反馈已核：三语自然查收提示在af5af1af6b51272e7aa6a370227ada2df9d4554a已推且CI41017076013终态success，未重复改动。原327仍259含部分/68不同，当前只补执行入口，不宣称远端每一步持锁或SSH公钥/init正文/镜像授权在途变更、原生客户重装重建完整验收；一机一卖全端口及管理员销毁免验证码保持。
- 新查41028619415终态success。41031081702终态failure已读`logs/ci-41031081702-failed.log`：snapshot-mutation-authorization.ts:105恢复期间DELETE前验证码领取等待原实例锁到Query read timeout，500≠409；下一段复现并修门禁顺序/同事务消费，不能重跑掩盖。41029729516/41031737023/41032952213/41036581988/41037666047/41039116226仍运行，41034830579/41035809878旧备份失败源码已修但旧运行仍failure。历史Go IO准确根因、外部SMTP/原生客户/完整灾备保持；阶段提交推送后继续，无发行/OTA/生产操作。

> 2026-10-28 用户已要求本聊天接手并继续；原暂停状态结束。当前仍是源码施工与隔离验证阶段，未满足发行条件。接续入口见 [PAUSED_REVIEW_HANDOFF.md](PAUSED_REVIEW_HANDOFF.md)。

## 2026-10-30 R1-011 重装/重建任务当前授权与验证入队同事务（持续施工）

- 转移段已推89c059ba6aeeb140607216b97bd98bbf2689eebd / CI41037666047。下一真实PG先红`logs/takeover-rebuild-current-admission-before.log`：已banned旧actor仍创建rebuild任务。两用户入口不再在镜像验证前提前消费grant，最终任务受理在实例/宿主/current账号锁内核原owner/host/Incus/宿主摘要、status/session/role及恢复/上传/转移竞争，user入口仍owner-only、host入口保current宿主owner/admin原维护权限；用户grant消费与任务插入同事务，稳定403/409错误保原记录。
- 最终`takeover-rebuild-current-admission-resend-verified.log`实际PG/Fastify/SMTP自然exit0：两任务×九类current账号/资源/状态/上传/恢复/转移排队变化拒绝且grant未消费，实际PG任务插入失败回滚grant，八并发一任务一grant；无关用户与管理员不能借user入口，current管理员host维护入口正常免用户grant。原通知写/全部验证码目标/权限/SMTP/预算回归保持。严格源+受改专项types、后端最终build、六验证码/实例冲突/任务/public-api守卫及四资源路由守卫自然exit0，日志同前缀。上传夹具0号存储违反真实FK的错误轮不计通过，最终改为隔离真实storage并正常清理。
- 此段只完成受理当前授权/原目标/消费入队，任务尚未持久保存原授权/身份供worker再核，SSH key和初始化命令在途变更、镜像授权及实际远端执行合同仍待；不宣称已完成重装重建全流程。无前端/schema/生产变化，一机一卖与全端口保持。CI41036581988已越过原失败上传且六job成功整体仍运行，41037666047仍推进；41026234390新增终态success，五旧CI与两已修源码但旧运行失败、历史GoIO准确根因/原生客户/外部SMTP/完整灾备继续跟。原327259含部分/68不同不增，保存后继续。

## 2026-10-30 R1-011 转移验证领取、当前授权和手续费同事务（持续施工）

- 备份回执段已推2f5d205a200d6d069c6973683ad247639adad205 / CI41036581988，当前六job成功且Pool已通过原失败上传专项，整体未终态。通知CI41035809878终态failure失败日志已读取确认同479行403≠200；两历史失败保留，修复实证不冒充旧运行成功。
- 实际PG先红`takeover-transfer-current-authorization-before.log`：转移创建事务不核原sid撤销仍扣费成功。现用户/管理员路由只查验证要求，最终createTransferWithFee在原instance/host锁、按ID排序源/目标/actor账户锁内重核原Incus/宿主身份、status/role/session及真实手续费，传当前actor；grant领取复用调用者事务，验证记录消费、扣手续费和转移创建一并提交或回滚。通知配置新增与验证码目标读取同账户锁保持；手续费改变不默默扣新价。
- 最终`logs/takeover-transfer-current-authorization-push-verified.log`实际PG/Fastify自然exit0：原管理员/用户PUSH财务、取消退款、原一机一卖专属网络/账期完整回归；新增余额不足后grant回滚、session撤销零扣费，五类真实account/instance/host行锁排队后current停用/撤销/目标停用/Incus或URL变化拒绝且grant/余额保持，八并发一次grant/一笔手续费/一次转移。原SMTP/权限/绑定/预算、2FA、专用销毁邮箱实际回归、严格源+受改专项types、后端最终build、四operation/通知守卫及四资源路由守卫全部自然exit0，日志同前缀。测试费率案例移至独立实例避免新并发fixture污染旧计数，最终重跑types/PUSH通过。
- 无前端/schema/生产变化。此仅转移创建的验证/授权/扣费事务；重装重建任务受理/执行、快照/备份删除grant后dispatch及其它内部缺口下一段，原327259含部分/68不同不增。41025555281/41024907571/41024139392/41023032382已success；六旧CI仍运行与历史GoIO准确根因/原生客户/外部SMTP/完整灾备保留，阶段保存后继续。

## 2026-10-30 CI备份删除终态回执回归修复（持续施工）

- 通知配置段已推送4c329dcf94e9daae50418d82e181461fb9964f82 / CI41035809878。资源绑定CI41034830579已failure，失败日志明确上传专项479行已deleted备份DELETE重放403≠200；本机原PG/mTLS专项`logs/takeover-backup-terminal-replay-before.log`复现同一失败。保留deleted资源不能发码/领取的规则，路由只对原已deleted快照请求terminalOnly回执，沿原instance/host/current账号/backup锁和任务门禁重新核验后返回；锁内变为ready时409且零远端DELETE，其他ready删除仍需验证。
- 最终`takeover-backup-terminal-replay-upload-verified.log`实际PG/Fastify/mTLS自然exit0：配置个人渠道的deleted重放200零远端调用，撤销会话403；真实宿主行锁排队后backup变ready拒409，随后无grant的ready删除403，原远端403/500/断开/仍存在保护、上传/恢复竞争、确认缺失才提交、提交失败补偿与完整上传专项保持。严格源+受改专项types、后端最终build、四资源路由和四验证码/个人通知守卫均自然exit0，日志同前缀。专项旧assert.rejects(undefined)重载改正确消息重载后types/upload重跑通过，不放宽类型或断言。
- CI41035809878的Pool同上传步骤已failure，其余六job中Build尚运行，终态日志可取后继续确认；本次根因已实际修复，新推送CI仍需跟终态。41024907571/41024139392/41023032382已success，七个更旧CI仍运行；历史GoIO准确根因、外部SMTP/原生客户/完整灾备及grant后写/dispatch未完保持。无前端/schema/生产改动，原327259含部分/68已有不同不增，阶段保存后继续。

## 2026-10-30 个人通知配置写入的当前授权与并发开关（持续施工）

- 资源身份绑定已推送5e77874f2d0fb14150f94fdf105fe3e59c88b9fa / CI41034830579。下一真实Fastify/PG先红`takeover-notification-current-write-before.log`：banned旧actor仍201新增个人通知渠道。新增/修改/删除/开关改为当前账户行锁授权事务，当前sid/账户撤销、归属、个人范围及经验证渠道类型重新核验；所有调用传request.user，账号锁也协调验证码读取与个人渠道新增（含空渠道）。开关从锁内当前enabled求反，不再用路由旧值覆盖并发操作，稳定401/403/409回执。
- 最终`logs/takeover-notification-current-write-resend-verified.log`真实PG/Fastify/SMTP自然exit0：新增三类current授权真实锁排队；修改/删除/开关三操作×停用/会话撤销/全账号撤销/owner/global/alert六变化拒绝且原name/config/enabled保持，渠道type变化409且不覆盖；八并发开关四开四关，正常新增修改删除通过。原资源身份/账户/SMTP/预算/权限矩阵回归保持；严格源+受改专项types、后端最终build、四operation/user-notification/log守卫自然exit0，日志同前缀。无前端/schema变化。
- 新CI41034830579已终态failure：六job成功，Pool在`test:review-upload-completion-integration.ts:479`失败403≠200。已读失败日志`logs/ci-41034830579-failed.log`并定位：已deleted备份的幂等DELETE重放原本200零远端调用，被新资源领取门禁拒绝；下一段修真正已终态回执且在事务锁内阻止状态回变后免验证删除，不跳过测试。41024139392/41023032382已success，其余八旧CI仍运行须跟，历史GoIO准确根因仍未证实。个人配置测试发送和审计原子、管理员全局配置以及grant后业务dispatch合同不在本段，原327259含部分/68不同保持，保存后继续。

## 2026-10-30 R1-011 验证码及领取记录绑定原资源身份（持续施工）

- 资源权限段已推送15cdc486c93e3390c1c8e0c8c8c76e1173d699b1 / CI41032952213。实际SMTP在途变更归属仍激活旧码的先红证据为`logs/takeover-verification-resource-binding-before.log`。现资源记录使用`notification-resource:v1:`摘要绑定原账户/会话/通知目标、实例归属与Incus身份、宿主受信连接身份、快照/备份原名称和创建时间及当前角色；准备、投递ACK、verify/check/isVerified/claim均在事务锁内重核。ACK身份变化保失败标记和原发送冷却；旧仅session/target绑定码须重发，不自动继承新目标。
- 最终真实Fastify/PG/本机SMTP专项`takeover-verification-resource-binding-resend-verified.log`自然exit0：SMTP在途owner/Incus变化不激活；Incus ID、宿主URL及owner变化拒旧verify/check/claim且不消耗attempt/grant；snapshot/backup原远端名称变化拒旧码和领取，恢复原身份正常领取。原账户/目标/并发/预算与权限矩阵保持。实际PUSH和销毁邮箱回归、严格源+受改专项types、后端build、两operation与四资源路由守卫、清单校验均自然exit0，日志同前缀。最终测试夹具TS7022补明确number后重跑types/resend通过，不放宽严格配置；仅测试修改沿用已通过产品build，无前端/schema变更。
- CI41023032382已终态success；41024139392/41024907571/41025555281/41026234390/41028619415/41029729516/41031081702/41031737023/41032952213仍运行，最新运行六job成功、Pool集成继续，无新失败。保留历史40799210505准确Go IO根因未证实、外部SMTP/原生客户/完整灾备缺口；此段不保证grant领取之后业务写/dispatch全程原子，也不闭合新增通知渠道串行。原327计数259含部分/68已有不同保持，保存后继续。

## 2026-10-30 R1-011 验证码三个入口先核资源当前归属权限（持续施工）

- 无渠道授权段已推068aab64b55f373cdc200761064cf06955af5b1c / CI41031737023。下一实际PG先红`takeover-verification-resource-permission-before.log`：无通知账户对别人的reinstall目标request/check200免验证。新增独立只读事务权限器，request/verify/check三个入口在免验证、发送和grant验证之前锁实例/宿主/子资源并核当前账号及真实role；缺失/已删/超PG Int目标403，重装重建只owner，转移owner或当前管理员代转移，实例/快照/备份删除保owner/hostOwner/admin原边界。
- `takeover-verification-resource-permission-resend-verified.log`实际Fastify/PG/SMTP自然exit0：四角色×六操作×三路由权限矩阵，缺失/超Int目标零邮件零grant；原已发码的request/verify/check在真实实例owner变更锁排队后403，原码/attempt/记录完整不变。测试原虚拟资源编号改为9条真实隔离instance和snapshot/backup，正常清理；原SMTP/绑定/预算/渠道竞争全部回归保持。
- 最终源+受改专项严格types、后端build、两operation守卫与四资源路由守卫、实际PUSH及destroy PG/SMTP回归全部自然exit0，日志前缀`logs/takeover-verification-resource-permission-`。无前端/schema变化，不重复最终双端构建。权限锁只覆盖入口检查，不扩为后续发送ACK/verify/claim原归属持久绑定或grant后写/dispatch全程事务；这些及配置插入整体串行下一段继续，生产客户与原生验收未操作。
- CI41019111832/41019531979/41020374764已success；41023032382/41024139392/41024907571/41025555281/41026234390/41028619415/41029729516/41031081702/41031737023仍运行无新失败须跟。原327259含部分/68不同计数不增，历史GoIO/外部SMTP/原生客户/完整灾备继续，阶段保存后接续。

## 2026-10-30 R1-011 无个人渠道的验证码请求/查询当前授权（持续施工）

- 资源会话段已推9732f96149a6b41bdf62fa5c32af5885c46432bb / CI41031081702。实际PG先红`takeover-verification-no-channel-auth-before.log`：banned但旧authenticate actor仍在时，无个人渠道request返回200免验证。现checkOperationVerificationRequirement同一事务最先锁账户核当前授权，再锁已有渠道并判断required/当前绑定grant；request资源免验证分支与check路由共用它，停用/撤销返回稳定AUTHENTICATION_STATE_CHANGED，不再提前输出verified=true。
- 最终`takeover-verification-no-channel-auth-resend-verified.log`实际Fastify/PG/SMTP自然exit0，含无渠道request/check的banned/session撤销拒绝、两阶段实际账户FOR UPDATE排队后拒绝及正常免渠道合同；原账户/资源session-target绑定、预算、SMTP ACK/失败、渠道三阶段竞争、8并发单claim全回归。严格专项+源types、后端build、两operation守卫与原2FA/destroy PG/SMTP均自然exit0，日志前缀`logs/takeover-verification-no-channel-auth-`，无前端/schema改动。
- 当前授权回执修复不等于资源归属权限、grant后业务写/远端dispatch或新增渠道串行闭合；这些及外部SMTP/原生机器/完整灾备继续。CI41019111832/41019531979/41020374764已success；41023032382/41024139392/41024907571/41025555281/41026234390/41028619415/41029729516/41031081702仍运行无新失败须跟。原327259含部分/68不同不增，历史GoIO保留，阶段保存后继续。

## 2026-10-30 R1-011 资源验证码绑定原会话并要求当前领取授权（持续施工）

- 通知目标段已推dc370b1df7dfd05275c9f42ee58338172740b52b / CI41029729516。下一真实PG/Fastify先红`takeover-verification-resource-session-before.log`：同账户第二合法会话资源verify仍200。现`notification-session:v1:`摘要绑定账户/sid和原个人渠道id/type/config；request/verify/check/claim匹配原会话，别的会话请求不能撤销原码或绕过60秒。摘要不持久存凭据或明文sid，旧仅目标绑定的资源grant须重新验证。
- 领取前必须提供当前actor并在账户行锁中核active/撤销；无个人渠道的资源免验证也在该当前授权之后，坏个人配置不能走免验证。实例重装/重建/宿主所有者删除、快照、备份、转移和管理员代转移均传原request.user。管理员直接删除免验证码和用户自销毁独立邮箱规则保持，原专属机器全端口与一机一卖库存/财务合同不变。
- 最终`logs/takeover-verification-resource-session-resend-verified.log`自然exit0：资源第二会话request/verify/check/claim均拒绝且零新投递/原attempt和grant保持，原会话正常；未提供actor/banned/revoked在无个人渠道也不能领取；原三阶段渠道锁竞争及8并发唯一领取、账号session/email/60秒/SMTP状态完整回归保持。`push-verified.log`实际管理员第二sid403、原grant不消费/原用户余额不变后原sid正常；原手续费/退款/转移/专属网络保护完整通过。
- 最终受改专项+源严格types、后端build、两operation守卫、四resource路由守卫、manifest194/231、实际2FA和专用destroy PG/SMTP回归全部自然exit0，日志同前缀。无前端/schema变化，沿用无变化最终双端/Chrome证据。当前actor与通知锁仅到grant消费事务，不宣称之后业务写/远端dispatch及新渠道插入整体串行完整闭合；资源归属权限与这些竞态下一段继续。
- CI41019111832/41019531979/41020374764已终态success，41023032382/41024139392/41024907571/41025555281/41026234390/41028619415/41029729516仍运行且无新失败，持续查终态；历史40799210505准确IO根因、外部邮件/原生宿主/全部灾备未完保留。原327259含部分/68不同计数不增，阶段保存后继续。

## 2026-10-30 R1-011 资源验证码使用时重核当前个人通知目标（持续施工）

- 账户绑定段已推3a838c4bafd1e7bbd933492ebc02efcf6b88fdc6 / CI41028619415。下一实际PG/Fastify先红`takeover-verification-resource-target-before.log`：改个人渠道后未再request，旧码verify仍200。现verify/check/claim各自事务对已有个人渠道行`FOR SHARE`，固定原createdAt/id顺序重读enabled/isGlobal/alertCategory及config摘要；只有当前目标摘要匹配才验证/消费，不靠再次发送撤销旧目标资格。
- `takeover-verification-resource-target-resend-verified.log`最终自然exit0：未重发直接改目标拒旧verify/check/claim且attempt/grant不变；三阶段实际PG行锁排队后重读变更并拒绝，8并发当前目标grant只消费1次。原账户session/email绑定、当前鉴权排队、SMTP ACK/失败/60秒预算、个人/全局/管理员渠道与destroy空间完整回归保持。
- 最终专项严格types、后端build、两operation守卫和四instance/snapshot/backup/transfer路由守卫均自然exit0；实际管理员/用户PUSH及专用销毁PG/SMTP回归同样exit0，日志前缀`logs/takeover-verification-resource-target-`。管理员PUSH测试夹具补原真实渠道摘要，不恢复旧无绑定grant。初夹具在Fastify已ready后注册路线被拒，已移至启动前；JsonValue回写改为原明确fixture配置，错误轮不列通过。产品无前端/schema改动，不重跑无变化双端构建。
- 本段只闭合已有渠道目标变更与grant事务消费，不保证新增渠道插入的整体串行快照；资源code/grant原session绑定、资源权限/当前actor在真正业务写入时重核和通知配置写授权完整合同仍待。原无个人通知渠道的资源免验证合同保持，用户自行销毁仍独立强制邮箱验证；不能把此段当资源全验收。
- CI41017076013/41015808583/41014322522已success；41019111832/41019531979/41020374764/41023032382/41024139392/41024907571/41025555281/41026234390/41028619415仍运行且无新失败，持续跟终态。原327259含部分/68不同与历史GoIO/原生宿主/外部SMTP/完整灾备未完保持；阶段保存后继续。

## 2026-10-30 R1-011 账户验证码及验证记录绑定原会话与邮箱（持续施工）

- 接续保留上一模型未提交源码，补齐最终验证。账号操作的验证码与grant使用`account-session:v1:`摘要绑定账户、原sid及邮箱；request重复回执、verify、check、claim及profile同一事务消费均按该绑定检查。摘要不保存明文sid/邮箱，旧无绑定账号码及grant须重发，不能自动继承当前会话。账户60秒预算、资源通知目标与专用销毁邮箱流程保持。
- 实际Fastify/PG/本机SMTP完整专项`takeover-verification-account-binding-resend-verified.log`自然exit0：另一合法会话不能验证或消耗原尝试次数，邮箱变化拒旧码；check/claim拒跨会话/邮箱，8并发只消费1次，旧无绑定码/grant拒绝。原SMTP ACK/失败/预算/授权排队/个人目标完整回归保持。`profile-verified.log`新增profile事务跨会话/旧收件邮箱拒绝且两grant、新邮箱code及账户字段不变；原故障回滚和6并发唯一修改通过。
- 专项严格类型、后端最终build、两operation守卫、auth-session守卫、manifest194/231及diff全部自然exit0；`twofactor-verified.log`和`destroy-verified.log`实际回归均exit0，销毁A/B去同码、原会话/邮箱/集合绑定、单次消费和60秒预算保持。日志前缀均为`logs/takeover-verification-account-binding-`。未改前端，沿用原最终Chrome/双端证据；无需重复构建。
- 接续验证第一次误用了历史55432测试库，原服务已停且schema较旧；错误轮不计通过。已确认当前55438隔离库并用既有连接完成最终回归，误启动的55432已正常关闭。类型夹具补正确typeRoots/ES2023，不修改产品编译配置。真实外部SMTP/客户原生操作/完整灾备未验收；generic资源码的当前通知目标与会话绑定、资源权限完整合同仍待，不扩大本段范围。
- 文案纠正已在af5af1af6b51272e7aa6a370227ada2df9d4554a保存并推送，简中「验证码已发送，请查收邮箱」及非邮件「验证码已发送，请查看通知」，三语同步，倒计时表达冷却。CI41014322522/41015808583/41017076013已终态success；41019111832/41019531979/41020374764/41023032382/41024139392/41024907571/41025555281/41026234390仍运行、无新失败，须持续跟终态。历史40799210505准确IO根因未证明保留。原327计数259含部分/68已有不同不变，保存后继续。

## 2026-10-30 R1-011 验证已投递码时当前账户/会话授权（持续施工）

- 准备授权段已推355d39e554268eba746ee1b33b79adec8d0419b5 / CI41025555281。真实PG/SMTP先红takeover-verification-verify-auth-before.log：已发码后账号banned，旧鉴权仍可200标verified。现verify传request.user，同一事务最先authorizeUserWrite锁current账户与撤销；正确码CAS、错误尝试bounded increment与回读同事务，未提供actor/不匹配/当前停用撤销拒绝且不修改记录。
- 最终PG/SMTP与实际Fastify完整专项74877自然exit0（takeover-verification-verify-auth-pg-final）：已发码banned/session撤销零记录变化，3类真实FOR UPDATE排队后拒绝，八并发正确码只有一次grant。原准备/ACK current身份、预算/目标/SMTP状态完整回归，以及原2FA与destroy邮箱A/B/会话/邮箱集合/预算全部自然exit0。源+所有受改专项严格types86544、最终server51635、两operation守卫21903均自然exit0（test-run-20261030-162150）；diff修正继承空白并通过，无业务追加改动、无前端/schema迁移。
- 此段只有当前认证门禁，尚未为通用已发送码/grant持久绑定原session/email；同一账户另一合法会话、change-email后的旧grant/check/claim及profile事务需下一段闭合。不得把本段权限回归当完整绑定完成。原327259含部分/68不同和原生/灾备内部验收不变，保存推送后继续。
- CI41014322522与41015808583均7job终态success；41017076013/41019111832/41019531979/41020374764/41023032382/41024139392/41024907571/41025555281仍运行、无新失败须跟。Go两架构真实专项/package已success，历史40799210505准确IO分支未证明保留；无生产/发行。

## 2026-10-30 R1-011 通用验证码准备与投递回执当前授权（持续施工）

- 账户预算段已推d55c7ef7f032eafed37409affa1a26417997f33c / CI41024907571。真实PG/SMTP先红takeover-verification-current-auth-before.log：鉴权替身已给旧会话、账号当前banned仍200新增邮件。现request传真实request.user，准备事务先用原authorizeUserWrite锁账户并核当前status/sid/iat撤销及捕获邮箱，通知渠道检查当前归属/启用/个人/配置摘要；未提供当前actor同样拒绝。发送不持数据库锁，SMTP成功后在新事务再次核当前授权与收件目标，仅通过才CAS激活原记录；变更保failed7和发送时间，不能验证。
- takeover-verification-current-auth-pg-final.log实际Fastify/PG/SMTP全回归自然exit0：停用/会话撤销零邮件，新会话正常；四类真实account FOR UPDATE排队竞争（banned/email/session/user-level撤销）实际等待后拒发信，三类SMTP ACK在途变化不激活/旧码拒绝。原个人目标、账户预算/八并发、失败/尝试/消费/过期清理全回归。销毁邮箱A/B去同码与session/email/set/单次消费/预算、实际2FA回归再次exit0。
- 最终受改专项+src严格types93716自然exit0（测试beforeQueued补number避免TS循环推断）、server最终build32269自然exit0、两operation守卫63414自然exit0（test-run-20261030-161540）、manifest194/231/diff过，无活动测试build。无前端/schema变更。此仅准备和成功回执当前授权；已发送码后续verify/check/claim仍缺通用session/email持久绑定，资源授权与通知配置修改并发完整合同另待，不扩已完成范围。
- CI41014322522已终态success；41015808583/41017076013/41019111832/41019531979/41020374764/41023032382/41024139392/41024907571仍推进，无新失败。Go两架构实际专项及package已success但历史40799210505准确根因未知保留。保存推送后继续通用码与grant会话邮箱绑定及原327内部项，259含部分/68不同不变，无生产/发行。

## 2026-10-30 R1-011 通用敏感验证码账户发送预算（持续施工）

- 个人目标段已推2909625494e3dc1f49a7bc4926014c1efb0400dd / CI41024139392。真实PG/SMTP先红takeover-verification-account-budget-before.log：disable_2fa发信后立即切change_password仍200新增邮件。现保原操作/资源锁，最先加generic-account账户锁；所有generic状态发送历史跨操作/资源检查60秒，单业务后端另保精确recordId账户在途门禁，原行被清理且超过60秒仍不并发发不同操作。失败/耗尽/消费保budget原实现沿用，过期清理保最近60秒generic发送时间，不修改destroy专用记录或其小时预算。
- 实际PG/SMTP完整final-verified自然exit0（84968）：跨操作与资源切换、八混合操作/资源并发单邮件、另账户正常、在途跨时限/行被删除仍拒其它操作、失败/耗尽/消费跨操作仍限发、过期清理不失发送历史且61秒清理可重发。原个人目标/受控Telegram、SMTP ACK/拒收/中断/尝试与唯一消费全回归，销毁邮箱真实A/B碰撞/session/email/set/60秒与小时预算及实际2FA再回归全exit0。
- 最后源+四专项严格types31358自然exit0，最终server build85382自然exit0，两operation守卫及manifest194/231/diff通过（test-run-20261030-160849）。无前端改动/无schema迁移；此为generic账户预算，不扩大为所有注册或销毁邮件共享同一预算，也不把其原独立合同改变。当前session/email绑定与资源权限/投递时身份变化仍待，原327259含部分/68不同和灾备继续。
- CI41014322522已7job终态success；41015808583接近末校对专项仍运行，41017076013/41019111832/41019531979/41020374764/41023032382/41024139392继续推进、未发现新失败。Go41023032382双架构20次实际/proc及package job成功，历史40799210505准确根因仍未证明保留。保存推送后继续，不暂停、不生产、不发行。

## 2026-10-30 R1-011 通用验证码个人通知目标一致性（持续施工）

- 实际PG/受控Telegram先红takeover-verification-channel-before.log：页面选择管理员告警444444、实际发送另取无排序个人列表，所显示目标与真实投递不一致。现仅选enabled个人渠道（isGlobal=false/alertCategory=null），按createdAt/id确定顺序；整行快照同用于提示与发送，每次传输重试不重新读库选择。资源email原被当作账户邮箱发送，现用配置email并正确遮蔽；账户操作继续强制账户邮箱，销毁专用邮箱流程保持。
- 通知目标只保存id/type/config的SHA256摘要到通用记录resourceType，不存凭据/明文目标。冷却重复读取若当前目标不匹配旧记录，撤销旧码/grant资格并保createdAt，返回剩余冷却而不谎称新目标已发送；不绕60秒。配置损坏返回SEND_FAILED且零发信/零记录，不误判无渠道绕验证。此段不声称已完成通用当前会话/邮箱验证或发送过程中渠道撤销合同。
- 最终takeover-verification-channel-pg-final.log自然exit0：真实PG与SMTP、实际Fastify、受控Telegram投递验证个人/全局/管理员/禁用/同时间ID选择、真实目标/冷却旧提示、目标变更旧码拒绝、发送快照配置保持、个人email实际收件人与坏配置；原发送ACK/失败/中断/耗尽/消费预算及八并发全回归。destroy-final与2fa-final自然exit0：原A/B强制同码重抽、账户/session/email/set绑定、60秒/小时预算、唯一消费与2FA验证/撤销均保持。
- 原源types与最终受改专项+源types、后端最终build36218自然exit0，四守卫13939自然exit0（test-run-20261030-160334）、manifest194/231、CI YAML/diff通过。无前端改动，沿用已记录最终双端/Chrome；Telegram为受控transport，外部Telegram/SMTP、原生客户完整操作不据此计验收。下一继续通用账户预算/会话邮箱绑定，原327259含部分/68不同和完整网关灾备缺口不变。
- Go段57711ea2e4dc123ec9d2cad0299c670d85c662b2 / 41023032382两架构20次实际/proc专项及package job成功，整CI仍Pool运行。此前六CI41014322522/41015808583/41017076013/41019111832/41019531979/41020374764仍推进，无新失败，继续跟终态；历史Go准确根因未证明保留。阶段提交推送后继续，无生产/发行。

## 2026-10-30 Linux 进程审计退出竞态与失败诊断（持续施工）

- 本段已推57711ea2e4dc123ec9d2cad0299c670d85c662b2 / CI41023032382。Linux amd64与arm64各20次真实/proc、打开stat后子进程退出及脱敏/身份/文件边界专项均终态success，两网关组件package job也success；整次CI的Pool集成仍运行，不宣称总CI通过。历史40799210505无足够诊断，准确根因未证明，仍保留。

- 历史 CI40799210505 / commit3fd4488099bbaec13ed4ff15f1f9eda198a86539 的 TestReadActualProcAuditAndCancellation 返回 CONTROLLER_PROCESS_AUDIT_IO，失败日志只有通用错误码，尚不能准确证明原失败分支。代码复核发现 procfs 已打开 stat 在进程退出后可返回 ESRCH，原 read/stat 错误被归为 INVALID 或通用 IO。现保留原始错误供内部分类，ENOENT/ESRCH 在两次采集均标 StableSnapshot=false；写者审计共享同一分类。权限、IO、格式错误继续拒绝，绝不据退出竞态授予接管。失败诊断仅固定 phase/reason 与原错误码，不输出 OS 路径、进程名、命令或环境。取消在读取目录前检查。
- 新增实际 Linux 子进程打开 stat 后退出的回归、两扫描退出注入、权限/EIO/格式脱敏、PID/父进程/UID/名称/启动时间变化与文件边界检查。Windows 受影响 controllerconfig/maintenance 实际测试与 vet 自然 exit0，日志 takeover-process-audit-windows-final.log / windows-vet.log；Go -work 保留临时产物，避免本机测试通过后清理临时 exe 时出现拒绝访问；具体阻拦来源未证明。Windows 全套仍因原 report.go 使用 Linux Statfs 不支持 Windows 而失败，不能宣称全套通过。
- Linux amd64/arm64 最终测试编译与 vet、Linux amd64 Agent 全模块 build 自然 exit0，证据 takeover-process-audit-linux-{amd64,arm64}-compile.log / linux-build.log。controller-config-guards 完整专项自然 exit0（test-run-20261030-155000），manifest194/231、gofmt、CI YAML 与 diff 检查通过。双架构 CI 新增有界20次实际 /proc 与退出竞态专项（120秒）；本机不具备 Linux 运行环境，编译不等于实跑。三台测试机仍身份未核实，未绕过 SSH pin；历史 CI 准确根因继续保留，不据本段将其关闭。
- 前消费历史段已推 bf58eeda1fe6dda79fb266f8ee78d95fd1eb70a1 / CI41020374764。此前六次 CI41014322522、41015808583、41017076013、41019111832、41019531979、41020374764 仍运行、其它六 job 成功，继续查终态。原327计数259含部分/68已有或不同不变。保存本段后继续通用验证码通知目标一致性；当前邮箱/会话绑定、跨操作账户预算、真实宿主与完整灾备仍待，无生产或发行。

## 2026-10-30 R1-011 通用验证码验证/消费后保发送记录（持续施工）

- 尝试耗尽段已推3b2ac7b3f5c64a6da6dede85fb3c55f03b97a594/CI41019531979。下一实际PG/SMTP先红takeover-verification-consume-budget-before.log：验证成功后立即request200新增邮件；原消费deleteMany同样丢发送时间。现request读取同operation/resource最新所有状态，60秒内verified/耗尽均限发；重发仅撤销旧code/grant并保历史。generic claim及旧consume改条件updateMany清verifiedAt，保verified=true和原createdAt，既不能再verify也不能replay；profile事务同样清verifiedAt，账户写/撤销失败完整回滚保grant。无schema迁移，不改销毁专用记录或原鉴权/退款/全端口交付合同。
- 实际PG/SMTP完整专项自然exit0（takeover-verification-consume-budget-pg-first.log），原验证/消费八并发唯一claim、60秒限发/61秒新邮件及旧grant不复活通过。profile/reset/register全PG74056自然exit0，takeover-verification-consume-budget-profile-final.log含旧凭据/邮箱冲突/撤销trigger故障回滚和六并发唯一profile提交；admin/user PUSH48108自然exit0含授权/验证/费用/失败退款/专属不停止与网络账期保持；实际2FA与destroy-email再次自然exit0。测试只改“记录删除”断言为“资格已撤销、发送时间保持”，不放宽业务保护。
- 所有受改专项+src类型32265自然exit0、server build2568自然exit0、三鉴权/operation守卫91339自然exit0（test-run-20261030-152456），manifest194/231及diff通过；新增profile和admin PUSH实际专项接CI。无前端改动，沿用3ac末Chrome/双端不重复构建，无生产/外部SMTP或原生客户验收。
- 前五CI41014322522/41015808583/41017076013/41019111832/41019531979仍运行，继续跟终态；40799210505历史GoIO待准确定位。原327259含部分/68不同计数保持；generic跨操作统一账户预算/当前会话邮箱绑定/通知目标完整合同及灾备另待。保存推送后继续。

## 2026-10-30 R1-011 通用验证码尝试耗尽仍保重发冷却（持续施工）

- 前投递段3ac7b8a5074b0e7977f43f1cb791673d70b59a52/CI41019111832已推；原recordFailedVerificationAttempt第五次后deleteMany，实际PG/SMTP先红takeover-verification-attempt-budget-before.log：五次错误后立刻request200并新增邮件。现以未验证/未过期/generic/attempts<5条件updateMany原子增加，保耗尽记录用于原发送时间，最大5；并发错误不越成pending6/failed7，也不删除或复活旧已验证记录。数据库故障不冒充正常错误上限。
- 实际PG/SMTP67448自然exit0，takeover-verification-attempt-budget-pg-final.log：五次耗尽保冷却、正确旧码拒绝、61秒可重发、八错误并发最多5且零额外邮件，原发送ACK/拒收/中断/账户/destroy隔离完整回归。原实际2FA disable再次自然exit0（takeover-verification-attempt-budget-2fa-final.log），密码/TOTP错误保grant及正确消费/revoke保持。
- 源+专项types55383/server build68054/两operation守卫test-run-20261030-151802均自然exit0，diff通过。本段无前端变更，沿用3ac7b8a5末双端/Chrome，不重复构建，也不扩大为外部SMTP或完整客户操作。
- 2026-10-30末CI快照：41014322522集成105/172步骤完成、41015808583为89/173、41017076013为67/174；各六其它job成功、Pool仍运行，41019111832也未终态，继续查。原327259含部分/68不同计数不增，generic已消费和跨操作预算/当前身份/通知目标、历史GoIO及灾备继续，不宣称完整验收。

## 2026-10-30 R1-011/013 通用验证码真实投递状态（持续施工）

- 本段已推3ac7b8a5074b0e7977f43f1cb791673d70b59a52，远端main一致，CI41019111832运行。随后真实PG/SMTP已复现尝试耗尽删除记录绕过60秒重发预算，下一段保耗尽记录及并发次数封顶精修；原generic跨操作/已消费预算与完整身份仍保留。

- 重发段af5af1af6b51272e7aa6a370227ada2df9d4554a已推/CI41017076013仍运行。真实SMTP延迟最终ACK先红：首邮件未被接受，重复请求却200 alreadySent；发送失败原删除记录还可绕过冷却。现沿原user/operation/resource锁预存不可验证的pending标记，单后端按固定请求key保在途门禁，邮件/通知成功后精确recordId/hash/状态/有效期CAS激活，失败保不可验证记录及原发送时间；在途跨60秒/行被删除仍不重发，旧进程pending无当前I/O转failed，冷却后可重试。失败只返回稳定错误，不把原SMTP内容暴露到UI。持久标记复用attempts的6/7值，无schema迁移；原0–4验证次数门禁及销毁专用标记空间保持。
- 新PG/SMTP78146自然exit0，takeover-verification-delivery-pg-final.log覆盖原61秒/并发单邮件/账户隔离、延迟ACK零成功与提前验证拒绝、跨60秒和移除DB标记仍拒绝并行、ACK后可验证、550失败保冷却且61秒后重试、模拟旧进程pending恢复与destroy-email记录不变。原实际2FA47900及destroy96415真实PG/SMTP全回归自然exit0；含A/B同码强制碰撞、账户/session/email/set/一次消费/60秒/hour限制保持。真实SMTP服务在本机隔离，认证及外部账户不是生产实证。
- 前端pending保持request、不toast success，SEND_FAILED/限流使用三语自然错误及真实剩余倒计时，request页禁用重发也直接显示倒计时；取消/旧context清timer保持。提取原countdown避免零秒递减，旧请求行为不变。失败红字浅色3.6:1被实际taste拦下，局部改为深红/深色浅红；不扩通用选择器。
- 末actual Chrome33065自然exit0，takeover-verification-delivery-ui-last.log：三语pending/失败实际error/零新增toast/disabled倒计时/取消，原14旧child context与36冻结motion×locale×width×theme全回归；新增18失败截图+18输入截图，36inspect全零findings，全部图经两contact-sheet及全尺寸重点图复核。旧toast自然消失导致数量断言2!=3误报，改按新增ID检查；改CSS期间HMR轮不算末证据。
- source+专项types78426自然exit0，server build38279自然exit0；有效client ESLint94590无错警，末四守卫67886自然exit0（test-run-20261030-151029），manifest194常规231专项有效。冻结产品唯一双端82148自然exit0，takeover-verification-delivery-dual-final.log含两types/user1m16s/admin50.09s/NATURAL_EXIT_CODE=0；末dist-final通过。pnpm --only误解析及无server ESLint配置的命令错误已改用真实runner/client配置，不列为通过证据。
- 仍保留generic已验证/已消费后的发送预算、不同操作/资源统一账户预算、验证当前会话/邮箱及完整通知渠道目标一致性等内部缺口；本段不声称全部解决。外部SMTP/真实客户完整流程/原327整体UI与灾备未完成。a292/41014322522、bfb/41015808583及af5/41017076013仍需跟终态，历史GoIO40799210505继续待定位；阶段保存推送后继续。

## 2026-10-30 R1-013 通用敏感验证码重发与提示（持续施工）

- 本段已提交推送af5af1af6b51272e7aa6a370227ada2df9d4554a，远端main同提交，CI41017076013运行；下一继续SMTP在途及失败回执代码/真实投递审查，未因阶段保存停止。

- MyHosts段已推bfb45feebbb615ac6be349293159ca322493bf8d，对应CI41015808583；后端校对a292a95527d50faec9a52d6ddd0e71d116808a94/41014322522仍运行，两次各六job成功、Pool integration继续推进。41006712461已七job终态success。历史Go进程审计IO失败40799210505仍待准确复现，不因本地通过删除。
- 原通用敏感验证码前端60秒允许重发，后端120秒以内复用旧记录；真实PG/本地SMTP先红：61秒后仍只有一封邮件。现同原user/operation/resource事务advisory锁下使用60秒，将alreadySent及剩余resendAfter与验证码expiresIn分开返回；前端使用实际剩余冷却，旧服务器缺字段仍按60秒。保留原验证和销毁专用账户/会话/邮箱/实例集合绑定、60秒及去同码合同。
- Owner纠正文案后，邮箱提示改「验证码已发送，请查收邮箱」，其他渠道「验证码已发送，请查看通知」，繁体/英文同步；等待交倒计时，不向用户解释旧码或后台回执。现有记录回执用info，新发送用success；已同步OWNER_REQUIREMENTS。
- 原Fastify route/隔离PG55438与本地真实SMTP专项90923自然exit0，takeover-verification-resend-pg-final.log：61秒新邮件、30秒剩余冷却、精确60秒八并发只新增一封、账户隔离/正确验证、generic不改destroy-email记录；响应无数字/哈希/完整邮箱。专项接CI/manifest，不启动第二业务后端。
- 最后actual Chrome93557自然exit0，takeover-verification-resend-ui-final.log：实际30秒倒计时、重复发送零dispatch、自然中文提示、原禁用2FA全部回归、14旧child context与36三语三宽深浅动态偏好冻结动画/44px/Tab/Escape通过。18末截图和完整contact-sheet已看，18实际inspect报告findings均为空；视觉critique见logs/two-factor-verification/visual-critique.txt。初轮HMR失败不算最终证据。
- server build52903、源与专项测试types59776、末ESLint76422无错警、route/i18n/operation-verification三守卫84902（test-run-20261030-144854）均自然exit0；manifest有效。唯一最终双端7727自然exit0，takeover-verification-resend-dual-final.log含两次vue-tsc/user1m4s/admin56.02s/NATURAL_EXIT_CODE=0；末dist-final自然exit0。未因记录修改重复构建。
- 本段仅修同user/operation/resource重发合同，不声称全账户全操作统一预算；SMTP在途/失败删除记录及消费后的发送预算等内部缺口仍待，外部SMTP/客户完整操作、原327其它内部验收和完整灾备未完成。保存推送后继续这些缺口与待查CI。

## 2026-10-30 R1-020 我的节点完整批量校对（持续施工）

- 后端校对已推a292a95527d50faec9a52d6ddd0e71d116808a94，CI41014322522运行。41005762182现七job终态success，41006712461仍Pool integration运行，继续查终态；历史GoIO未删除。
- 原MyHosts pageSize1000只取100条，首100离线时漏掉后137在线节点；初版实际Vue红为未请求第2页。现按100完整严格页/ID/name/status/可见owner读取自有节点，管理员明确scope:mine（原mine:true未过滤管理员全库，现修为自有范围），普通用户保mine字符串true；完整读取后冻结在线目标、逐台单请求执行。固定account/role/sid/同步代次/scope/cache/unmount，重复调用门禁，旧回执不继续发写、不toast、不refresh；在途底层请求结束后才释放全局门禁。刷新回执另固定当前列表页/筛选。列表原读/create/delete/test/takeover完整生命周期仍另待。
- 严格六before/after/diff/hasChanges合同，非法成功回执计失败；失败不吞也不报整批成功，显示真实已处理/成功/修正/失败、完整节点名/编号/错误，实际重试只选失败固定目标。浅深黑白44px键盘重试和局部高对比错误文字；不改变全端口交付或用户网络入口。
- 最终actual Chrome48567自然exit0，takeover-my-host-calibration-complete.log：237全页/首100离线137顺序write、重复门禁/真实failed-only retry、6坏页/foreign owner零写、普通owner过滤、40旧list/write成功失败身份scope缓存ABA/unmount回执、6坏写合同及18三语三宽深浅截图/44px/focus/实际颜色/无横溢通过。新深色detail4.2:1已修；首视觉focus=false因夹具未结束refresh使按钮合法disabled，补回执修正；probe原始对象在color层，错误测试读取已修。没有放宽产品断言。
- 全18末图和visual-sheet已看，visual-critique及18实际taste judge报告保留：旧空卡gradient/紫色button shadow/静态panel shadow各屏3FAIL，桌面4WARN其余3WARN；静态lint6FAIL/16WARN是旧uppercase表头和其它旧样式，原description/hosted标签低对比待。新错误块检查通过，不称整页UI完成。
- 最后route/i18n72878自然exit0（test-run-20261030-143756），host-pool50753通过；有效ESLint末无错警，manifest194常规230专项、node语法/diff过。冻结产品唯一双端build85173自然exit0，takeover-my-host-calibration-dual-final.log含两次vue-tsc、user1m21/admin52.85s及NATURAL_EXIT_CODE=0；末dist-final通过。新增Chrome专项接CI，受控API与后端真实PG证据分开，无生产/原生客户实证。
- 原327仍259含部分记录/68已有不同，R020所列分页分项源码均已有修复，但跨页事务快照/原完整页面及后端外部流程另待，不称编号整体完成。保存推送后继续原内部验收缺口，下一先核通用敏感验证码60秒前端/120秒后端合同；销毁专用60秒保持。

## 2026-10-30 R1-020 宿主资源校对事务与当前权限（持续施工）

- 前段7418ea68e7b1638b8b388dc2db4f66ebce600fde已推、CI41006712461仍运行；41000607228/41001679848/41003054433/41005024391现终态success，41005762182仍运行。最后两轮六job成功、Pool integration运行，继续跟终态，历史GoIO保留。
- 原校对两次独立写host，createLog吞审计失败；getHostById未带natPortsUsedCount导致before端口误报0。实际Fastify/PG先红takeover-host-recalculate-before.log：真实日志trigger异常仍200成功并改资源。现事务锁实例（含deleted）→host→补齐新提交实例/映射端口→账号，复核active、sid/iat及账户/会话撤销、当前role与固定host归属；统计、六资源/配额一次更新和本地化审计同事务，审计异常回滚。原非deleted计数、系统映射计入及配额对齐到已用合同保持，未改客户网络/全端口交付。
- 初版Serializable真实PG暴露：撤销仅持account锁插入invalidation、未更新account行时旧快照漏读撤销。已改READ COMMITTED与输入行锁，等待后读取已提交撤销；Prisma7适配器SQLSTATE在嵌套或直接cause中，精确冲突映射409，普通审计/数据库失败不冒充冲突。锁等待5秒、事务15秒，冲突显式刷新重试，不自动重放写。
- 本机隔离PostgreSQL16.10、55438、*_pool_test与原Fastify route专项26733自然exit0，takeover-host-recalculate-inputs-final.log：审计失败六字段回滚、before/after/diff/重复无变化，6类排队账户/role/归属/会话撤销真实pg_blocking_pids等待拒写，host+instance及instance单独资源变化、端口删除等待后统计，合法owner/admin、六并发成功审计一一对应、非法sid/ID与零财务写。临时diagnostic已移除，初版/syntax失败不计最终证据。
- server types93262、独立测试types88972、最终server build16094自然exit0；5/5资源原子/host-pool/log-localization/instance-quota-zero/resource-quota-bigint守卫50089自然exit0（test-run-20261030-142621），manifest194常规229专项及diff检查通过。PG专项已接CI，仅app.inject测试路由，未启动第二业务后端。前端未改沿用前段双端build，不当真实生产/原生宿主/全量验收。
- 原327仍259含部分记录/68已有不同，内部待验未去重计数。本段保存推送后继续MyHosts完整批量目标、固定上下文/busy/旧回执及失败明细，list/create/takeover与其它内部验收/外部邮件/完整灾备保留。

## 2026-10-30 R1-020 套餐宿主名称完整分页（持续施工）

- 宿主统计已推ea2d08e5301f17c7b2532218f9d7c2e09f3fcbb9/CI41005762182。40998161357现七job终态success；41000607228/41001679848/41003054433/41005024391/41005762182仍运行，继续查终态。其它内部缺口保持。
- 原MyPackages pageSize1000仅返回100宿主，影响名称及名称搜索。现用原hosts route按100全页读取，严格metadata/ID/name，普通用户保mine字符串true及可见owner核对，管理员原所有宿主范围保持；全部读取后发布名称。独立host/session/generation/seq/KeepAlive/unmount门禁，旧回执停止后续页，失败保同context上次完整清单并持久error/retry；离页返回即使首次package读取仍pending也重读宿主。套餐列表scope/filter读取和套餐/方案写、列表表格锁定布局均保持，它们的完整旧回执/写授权另待，不能扩成本页整体完成。
- actual Chrome32827自然exit0，takeover-package-host-pagination-final.log：237全页第三页名称及实际名称搜索、六非法页/普通用户foreign owner拒绝、failed refresh last-good/实际retry、16旧身份/路由缓存ABA与superseded成功失败回执、真实空、18三语三宽深浅44px键盘inverse颜色/no横溢通过。红为原100条提前发布；夹具在PackageForm首屏先发hosts及角色更新后旧form再探测导致请求计数错误两轮已按nextTick后清pending修正，不能当产品失败或最终证据。18最后截图已看及visual-critique；背景package受控pending、原紫色/旧整页对比度仍待。
- 原actual PackageForm及方案弹窗60431自然exit0，takeover-package-host-pagination-form-regression.log；保空description/null SLA/原价格与读写生命周期。末route130345/i18n130344、有效lint47626、manifest194常规228专项/node语法/diff检查通过。冻结产品后的唯一双端build55612自然exit0，takeover-package-host-pagination-dual-final.log含两次vue-tsc与NATURAL_EXIT_CODE=0；末dist-final后保存；不可因记录修改重复构建。
- 原327仍259含部分/68已有不同，内部待验未去重计数；R020本段后仅MyHosts批量calibrate完整目标/当前授权待源码精修，不能说全部只剩1。已读校对route与资源helper，发现写入非事务/日志失败以及当前权限复核另需实际PG审查，先规格根因和守卫，不机械扩大批量写。无生产/发行动作，保存后继续。

## 2026-10-30 R1-020 宿主完整实例资源统计（持续施工）

- 本段已推ea2d08e5301f17c7b2532218f9d7c2e09f3fcbb9，CI41005762182运行；继续MyPackages完整宿主名称，产品尚未改，actual Chrome分页专项已准备。


- 工单014646d8085d69b852fe5380b72b1124f4632fa0已推、CI41005024391运行；40996832087已七job终态success。40998161357/41000607228/41001679848/41003054433及本段CI仍运行须跟终态；旧GoIO与其它未完不删除。
- 读取真实instances route/权限/资源字段、HostInfoTab与既有reads/metrics守卫。原pageSize1000被后端限制100，237条total但资源只加前100条；actual Chrome红为cpuUsed200提前发布。现按100全页固定hostId/当前host-session-generation-sequence读取，metadata/ID去重/可见hostId及host_id/非负有限资源字段全部通过才发布统计。可空旧字段贡献0保持；溢出聚合拒绝，失败保上次完整当前值与实际block retry。管理权限、资源校对/Agent升级等写操作未变，统计仅只读；跨页无数据库事务快照，等数量替换/状态变化强一致另待。
- actual Chrome87971自然exit0，takeover-host-info-pagination-complete.log：237台474CPU/121344MiB/242688MiB三页完整、13非法/重复/foreign/非有限中间页、失败保last-good/实际retry、22旧host-session-cache-ABA-unmount-supersession成功失败回执零后续页、空值0和非有限聚合保护/九三语三宽截图无横溢通过。首轮也自然exit0，实际产品先红两轮保留。原reads16796与最终更新metadata异常reads71979自然exit0；metrics62687自然exit0，原真实指标缺失/0/非法与轮询保持。仅浏览器受控API，不是原生宿主实证。
- 最后route125224/core125257、有效ESLint41866、manifest194常规227专项/node语法/diff检查通过。双端含types最终49982自然exit0，日志takeover-host-info-pagination-dual.log含44.47/59.40秒及NATURAL_EXIT_CODE=0；末dist-final.log自然exit0后保存。9最终截图已查看三宽三语主要图及完整sheet；未改本项UI样式，不把Agent/traffic受控loading的背景视作整个页面完成。
- 原327仍259含部分/68已有不同，内部未完验收未去重汇总；此分项后R020另MyPackages宿主名称完整页和MyHosts写calibrate完整目标/授权两处继续，不能报总剩余为2或0。完整网关/SSH身份/真实邮件等保持，无生产/发行动作。单项保存推送后继续。

## 2026-10-30 R1-020 工单完整实例选项（持续施工）

- 本段已提交推送014646d8085d69b852fe5380b72b1124f4632fa0，CI41005024391运行；40996832087已七job终态success，余四前序和本段继续跟终态。已继续HostInfo完整统计，实际Chrome先红为237条总数却只计算前100条cpuUsed200，产品尚未改；不以保存停止。


- 接续保留上一段未提交修改，终端7c8558a3c834b2a27dd03672b41625eba44b44a7已推、CI41003054433运行。40995350722现七job终态success；40996832087/40998161357/41000607228/41001679848/41003054433仍运行，逐次跟终态，历史Go进程审计IO失败仍待定位。
- 工单关联实例沿真实list分页合同按100顺序读取全部页，校验metadata/长度/ID/name/status及可见owner；全页通过才发布选项。旧会话/角色/账户/路由/缓存/ABA/卸载及更新读取使旧第二页停止后续dispatch，失败持久显示错误与实际重试，不再伪装没有实例。实际第三页实例237可从原下拉选择并随原发工单payload提交；不更改工单权限/后端/实例交付及一机一卖全端口。
- actual Chrome专项29250自然exit0，takeover-ticket-instance-pagination-final-colors.log：237条三页/七类坏中间页/22旧成功失败回执/实际error-retry/合法空及18三语三宽深浅主题44px键盘和无横溢通过。新对比度断言先红为深色1:1；原modal-content通用bg-white匹配dark:bg-white导致暗底黑字，局部专用class/颜色覆盖后严格主题色与19.8:1对比度通过。18最终截图已逐宽三语深浅查看，并保存visual-critique.txt；整页原玻璃/紫色按钮及提示弱对比度仍待，不把此控件当整页精修。
- 原工单actions/lifecycle专项已自然exit0，takeover-ticket-instance-pagination-actions-final.log及lifecycle-final.log；原三守卫123135、最后route124233、有效ESLint50599及manifest194常规226专项通过。最终源码仅最后双端构建37684有效，takeover-ticket-instance-pagination-dual-last.log含两次vue-tsc、45.65/48.98秒及NATURAL_EXIT_CODE=0；末dist-last.log自然exit0，最后taste报告13528自然exit0（takeover-ticket-instance-pagination-taste-complete.log）；18报告保存原整页finding，edited retry无低对比度；提交保存后继续；此前build虽结束但期间改了selector，不计最终证据。
- R020剩余MyPackages宿主名称全页/MyHosts写calibrate全页与授权/HostInfo完整实例统计三处；原327仍259含部分修复复验/68已有不同，内部验收总数未去重汇总，不能报剩余0。阶段保存推送后立即继续HostInfo，实际宿主/外部邮件/SSH身份及完整网关灾备保留；没有发行/OTA/生产动作。

## 2026-10-30 R1-020 终端完整实例选择器（持续施工）

- 控制台分页阶段已推送be4b515c1e497f1968a59053a259a55825768719，CI41001679848运行。前40993940514已七job终态success；40995350722/40996832087/40998161357/41000607228/41001679848仍运行无新失败，持续跟终态。
- 终端原limit100后端不识别，可能默认20；现复用completePages按100顺序读取完整instances，严格页数/总数/长度/ID、两种owner字段及status字符串后再映射选择器。旧session/cache/unmount/superseded第二页停止后续请求。失败保留明确instancesError，实际黑白44pxRetry和role=alert，使用现有translateError接普通API错误对象，防止失败被解释为零台可用。连接票据/Cloud-init/全端口交付行为保持；只修完整选项与错误块，旧整个选择弹窗的玻璃/紫色/重复说明等UI仍待。
- 实际Chrome99719自然exit0，takeover-terminal-pagination-final.log：237条三页、第一百条以后137台running可搜索并选择237；七类坏中间页、失败实际retry、18旧回执、真实空合同与三语三宽error/44px焦点和无横溢通过。截图手机/英文桌面已看。原基线在实际Vue来源路径以只读替换器复现limit100红断言，takeover-terminal-pagination-source-baseline.log；早期夹具未记录data和替换路径未命中/依赖解析失败轮不计产品先红或最终验证。测试替换器已移除。
- 原terminal session50399与lifecycle44024自然exit0，takeover-terminal-pagination-session-final.log及takeover-terminal-pagination-lifecycle-final.log；三守卫test-run-20261030-122302/有效lint/node语法/manifest194常规225专项已通过，新专项登记CI。冻结后唯一双端build13918自然exit0，takeover-terminal-pagination-build-final.log含两次vue-tsc，user53.74秒/admin52.85秒；末dist takeover-terminal-pagination-dist-final.log自然exit0。无真实外部邮件/原生宿主/生产动作。
- R020控制台已保存，本终端末验证后保存；Tickets/MyPackages/MyHosts写calibrate/HostInfo四处仍待。259含部分修复复验/68不同/0未进入记录不等于所有内部验收通过；GoIO/SSH身份/外部邮件/完整网关灾备继续。

## 2026-10-30 R1-020 控制台完整实例分页（持续施工）

- R013已提交推送fd56f21af691a6087e48676fe21d362bc6154a63，对应CI41000607228。前40992598123现七job终态success；40993940514/40995350722/40996832087/40998161357/41000607228仍运行且无新失败，继续跟终态，不能算全部CI通过。
- 已读实例真实route/DB分页、Dashboard生命周期及对应守卫。原控制台pageSize1000被后端限制100，现通过小型completePages读取器按100顺序取页，校验页号/总数/页数/每页长度/ID与可见owner字段，固定首响应总数；仅在完整读取后发布统计。重复/缺页/总数改变失败保留上次完整当前摘要，旧session/route/cache/卸载回执停止下一页。单次最多100000项，超出明确读取失败，不静默截断。后端权限、排序及100上限保持；跨页不构成数据库事务快照，同数量替换/状态变化的强一致快照另待，不能声称具备该保证。
- 实际Chrome分页专项47084自然exit0，takeover-dashboard-pagination-first.log：237条三页/137运行100停止/五条最近展示；15异常中间页、首metadata上限/合法空、失败retry及20旧第二页成功失败回执均通过。原源码先红为pageSize1000与缺page；实际产品已修。原控制台session专项63600自然exit0，takeover-dashboard-pagination-session-final.log：20旧五请求摘要、single pending、same-sid、非法身份、当前失败retry、三语三宽及卸载timer回归通过；末截图手机/英文桌面已看，旧紫色/玻璃整体UI仍未精修。
- 三守卫test-run-20261030-120834自然exit0；有效lint无错警、node语法/diff检查及manifest194常规/224专项通过，新分页专项已登记CI。冻结后唯一双端构建33969自然exit0，takeover-dashboard-pagination-build-final.log含两次vue-tsc，user46.63秒/admin48.43秒；末dist边界takeover-dashboard-pagination-dist-final.log自然exit0。仅浏览器受控API及真实后端代码合同审查，无客户生产/原生宿主流程或发行。
- 原327现259含部分修复复验/68已有不同/0未进入记录，并非全部验收完成。R020另五处Tickets/Terminal/MyPackages/MyHosts批量calibrate/HostInfo仍待；批量calibrate是写操作，先核授权/固定目标/离页撤销，不能机械扩大批量dispatch。原327的其它内部验收/Go进程审计IO失败/外部邮件/测试机SSH身份/完整网关灾备仍未结束。每阶段验证保存推送后继续。

## 2026-10-30 R1-013 禁用双重验证的敏感验证接线

- 先读TwoFactorSection/PasswordSection、auth禁用路由、verification routes/service和对应守卫。禁用2FA收到VERIFICATION_REQUIRED时显示实际敏感弹窗；固定原password/TOTP与session/scope/draft快照，verified只重试一次，等待期间父输入/操作冻结。取消清password/code/pending；草稿ABA、sessionABA、role/account变化、KeepAlive离页/卸载均失效旧子回执。后端现有密码/TOTP/claim/CAS/revocation逻辑保持，没有管理员删除或销毁专用邮箱逻辑变更。
- 2FA弹窗按原黑白方向局部覆盖玻璃/紫色、取消入场/离场动画、44px触控、ARIA标题/输入标签、初始focus/Tab/Escape与关闭focus恢复。复用既有Achromatic方向，未新绘制品牌。实际Chrome完整专项6618自然exit0，takeover-two-factor-verification-complete-final.log：14旧发送/验证回执、错误验证/重复emit/固定重试/坏回执/取消秘密与36三语三宽深浅动态偏好冻结动画组。18截图已看，taste modal-only报告0FAIL/0WARN；背景设置表单旧暗色黑字及危险文本对比度也已局部修。
- 本机PG55438隔离库/Fastify actual auth/verification routes5857自然exit0，takeover-two-factor-verification-backend-last.log：无grant/错误账户与操作拒绝，真实bcrypt/TOTP、verify路由后重试、错误凭据保grant、禁用清全部秘密并原子撤销refresh/access、重放拒绝及B保持。鉴权替身受控，禁止外部fetch，没有真实邮件发送，不能作为端到端收信证据。严格全部server源+专项类型16591自然exit0，takeover-two-factor-verification-types-verified.log；client类型27205及最终双端两次vue-tsc通过。有效lint、四守卫test-run-20261030-115725、manifest194常规/223专项与node语法通过。四旧2FA scope/session/busy/receipts与实际Password敏感弹窗回归97838自然exit0。
- 冻结后唯一最终双端build70198自然exit0，takeover-two-factor-verification-build-verified.log，末dist takeover-two-factor-verification-dist-last.log自然exit0。中间重复/HMR和定向停止轮不计最终源码证据；footer颜色误覆盖被taste拦下并修，错误与下次检查写OWNER_REQUIREMENTS。通用发送前端60/后端120秒合同仍待后续小段修复，销毁专用邮箱60秒规则独立不变；完整供应商邮件/账户真机及整页其它范围保留。
- R008已push f89cf43aef76685379fd10f95edfdca7667dc393/CI40998161357。40989729533、40992045627现七job终态success；40992598123/40993940514/40995350722/40996832087/40998161357各六job成功、Pool持续前进，仍跟终态。旧40799210505失败日志已读，实际proc审计IO确切分支尚未复现，不删除待办。原327258含部分/68不同/1待R020，阶段保存后继续分页与内部缺口，无生产/发行动作。

## 2026-10-30 R1-008 管理员OAuth登录配置繁体与密钥保留

- 已推送f89cf43aef76685379fd10f95edfdca7667dc393，对应CI40998161357运行；继续跟终态，不以推送或运行中为通过。
- 繁体源缺admin.oauth组，末尾mergeMissingMessages使实际显示回退英文；早期“裸翻译键”判断纠正。补齐31项繁体文本，原生标题/留空不变更说明守卫先红后绿。现有后端保留旧密钥实现保持，增加实际PUT省略/空值/UNCHANGED输入的PG回归；测试JWT仅记录sign输入，明确测试替身转换，不放宽产品类型。
- Chrome实际OAuthConfigView三语×1440/768/390、编辑/空密钥/实际submit/省略密钥payload/弹窗边界通过，takeover-oauth-locales-browser-final.log自然exit0，九图已看。本机PG/Fastify原OAuth回归及三种密钥保留takeover-oauth-locales-backend-resumed.log自然exit0；fixture-oauth-revocation-failure为预期故障注入。严格源+专项tsc25623自然exit0，takeover-oauth-locales-types-resumed.log；有效根ESLint显式client/eslint.config.js通过，takeover-oauth-locales-lint-resumed-final.log。初次省略配置的lint未执行，不计通过。
- route/oauth-secret/oauth-provider三守卫test-run-20261030-112533和最终i18n守卫通过。末双端构建43526含两次vue-tsc自然exit0（50.05s/51.87s），takeover-oauth-locales-dual-build.log；末dist97877自然exit0，takeover-oauth-locales-dist-final.log；manifest194常规/221专项合法，新增浏览器专项已登记CI。此次只修登录配置文案组，原页面玻璃/紫色按钮及外部OAuth应用区硬编码中文、真实供应商登录另待，不声称整页精修完成。
- 上一R144/R145已推送2d03a5fa3762e20cd6c92a653a25fd460c34cb51，CI40996832087。六个待查40989729533/40992045627/40992598123/40993940514/40995350722/40996832087当前各六job成功、Pool仍运行，详情logs/takeover-ci-<ID>-latest.json，继续跟终态；旧Go审计IO失败不删除。原327现257含部分/68已有不同/2待（R013/R020），内部未验范围继续，不发行/OTA/DNS或生产动作。

## 2026-10-30 R1-144/R1-145 源站点清理先于资源替换

- 接续保留已有未提交源码，重新读取worker、proxy-site mutation/operation及重建/任务冲突/取消守卫。源清单和instance/owner/host/Incus/连接身份持久保存在任务replacementState；在recreate原实例stop/delete与change_host目标预占/创建之前必须取得每站点的已核身份Caddy删除回执。缺启用/地址/凭据、远端失败都阻断替换，保留站点依据与原实例/专属网络就绪状态。finalizer仅拒绝残留站点，不再deleteMany或切数据库后吞Caddy失败。
- 失败任务仅在cleaning_proxy_sites/pending且原身份一致时继续已提交删除意图；自动重试与原用户鉴权手动retry保留lifecycle权限和原claim，成功不重复POST。新owner/Incus/宿主凭据/task phase/site revision拒绝，已有cleared任务不扩大清理新站点。此安全预检可能已清理部分站点后阻断后续资源替换，回执逐站点保留，不能声称全部业务动作原子回滚。
- 本机PG55438原隔离库和本机实际HTTPS Caddy配置替身/Fastify通过takeover-instance-site-cleanup-run-final-resumed.log自然exit0：recreate/change_host各缺配置/写失败保源、失败任务自动/手动重试、正常/重复回执、五身份变化零POST、无关route保持。前一复核轮缺PATH中的openssl而未执行，明确指定已安装Git OpenSSL后成功；不计失败轮。严格源+专项tsc21137、server含tsc构建55969和根目录有效ESLint60492自然exit0；初pnpm-filter lint错误工作目录未执行，不计通过。4/4守卫test-run-20261030-111802自然exit0，manifest194常规/220专项合法。
- 没有前端改动，不重复双端构建；没有真实Incus/原生Linux Caddy迁移或客户/生产动作。完整替换/持续客户网络、远端成功后DB提交失败恢复、历史Go进程审计IO及完整网关灾备仍待。原327现256含部分/68已有不同/3待；3待为R008/R013/R020，不把已记录项的内部缺口删掉。
- 末原站点操作完整回归takeover-instance-site-cleanup-proxy-regression.log/39578自然exit0：真实PG/Fastify/TLS的七类持久意图/身份/撤销/进程退出、IPv4代次替换、ETag重试、远端成功/SQL回滚重试、删除墓碑及lifecycle gate通过。故障注入日志中的fixture-proxy-log-failure与fixture-replacement-intent-failure为预期回滚场景，不是漏查失败；该底层回归不替代整个重建/迁移worker故障流程。
- R177已推送ff95fbf10e3ec5d6b98310cd94506263110822d9/CI40995350722；当前40989729533/40992045627/40992598123/40993940514/40995350722均六job成功、Pool专项持续前进，尚无终态。详情保存在logs/takeover-ci-<ID>-resumed.json；继续跟到终态，历史失败不抹去。阶段提交推送后继续三个待精修和内部验收，不发行/OTA/DNS或操作客户。

## 2026-10-30 R1-177 初始终端连接最后授权

- R174已提交推送c589bf260d630f9b90fcac3e8d857a4f43f94f7d，远端main一致、CI40993940514运行。R177读完整terminal route/proxy、session/terminal守卫、现user-write authorization/instance lane/transfer gate及真实DB映射，固定初始expected instance/host/createdAt/package/type。opening已登记后进入PG事务，实例advisory+row/宿主shared/当前账户/套餐shared锁下复核当前role/sid/iat、归属/目标/running与清理/活动任务/转移，初连持锁到完成；原owner/host-owner/admin权限保留。
- 初始连接总20秒覆盖最终授权等待、POST/双握手，事务25秒为外层；撤销中断POST、失败清opening监听，事务失败后关闭已成功的两个后台socket。不把transaction回滚当作远端自动回滚，不改客户数据/网络/全端口。既有票据单次消费及前置初审保持；用户缺sid/iat不建立新终端。
- 本地PG原55438已停，依原postmaster.opts路径启动原隔离数据目录，自动完成WAL恢复后ready；无新业务后端/生产操作。takeover-terminal-authorization-complete.log/11522自然exit0：真实Fastify/WebSocket读取后5组session/banned/transferred/replaced/host-url全部零POST；9组真实pg_blocking_pids锁竞争零dispatch，当前三角色/缺sid-iat/类型变化，实际mTLS持锁撤销、无回执20秒释放、真实事务在双ws成功后抛错并清资源。仅隔离PG/本机HTTPS/mTLS/ws，不等于真实Incus/Chrome/生产。
- server含tsc build13673自然exit0（takeover-terminal-authorization-server-build.log），最终严格专项类型（含所有server源码）51519自然exit0；此前缺Fastify环境声明、临时config typeRoots及夹具generic断言失败均不算通过，已修配置/明确受控reader cast。3/3守卫test-run-20261030-105953自然exit0，R174全TLS回归takeover-terminal-authorization-opening-regression.log自然exit0，manifest194/219合法。根pnpm --only被自身解析及错误用regex only两轮未执行，最终三次实际--only逐项通过；新专项已登记CI，未重复无关前端构建。
- 原327现254含部分/68已有不同/5待，持续重连撤销/最新身份及真实IncusUUID/审计失败恢复仍未验。R008/013当前实现与已做三语/2FA专项需纠正旧台账，随后继续R020及R144/145残留路由。最新40989729533/40992045627/40992598123/40993940514各六jobsuccess、Pool继续前进，仍待终态；历史GoIO/测试机SSH/真实邮件及完整灾备保留，不发行/生产。
- 末扩展takeover-terminal-authorization-final-verified.log/52315自然exit0：原五旧route/九PG竞争和所有deadline/commit失败场景仍过，额外三种合法角色均经真实Fastify/ws及双mTLS成功建立/关闭；末完整源+专项类型25725自然exit0（takeover-terminal-authorization-types-final-verified.log）。无本项运行测试/build待poll，阶段保存后继续。

## 2026-10-30 R1-174 终端建连中途撤销

- 保留接续时未提交的源码/测试/CI登记，读实际proxy/routes与auth-session、terminal-route守卫；实际HTTPS/mTLS专项先红为closeUserSessions返回0，旧opening未登记。现同步登记opening user/instance/sid与取消器，四关闭范围立即abort POST/握手，不等迟到回执、不触发VM回退；成对失败清socket、监听及计时器，active删除先于客户端close避免递归。
- takeover-terminal-opening-last.log实际本机TLS/data/control ws专项通过：POST与握手×四范围撤销、双用户并发隔离、client close/error、失败retry、已断开客户端零POST、正常container/VM fallback和全部清理。3/3守卫test-run-20261030-104400全过。接续无仍在运行的本项build/tsc，旧日志无自然退出回执不能补记成功，必要重核server构建41800自然exit0（takeover-terminal-opening-server-build-recovered.log）及专项严格tsc自然exit0（takeover-terminal-opening-types-recovered.log）。恢复时首次专项类型日志路径误写C:/logs，未执行，不计通过；修到仓库logs后成功。
- 新专项已登记server/EXCLUDED_FROM_SUITE/CI；仅受控客户端与本机实际HTTPS/mTLS/真实ws，不等于真实Incus或浏览器/生产。重连阶段取消/总截止、实例持久UUID和最新权限持续核验另待；R177最后前置授权复核随后继续。无前端改动，不重复双端构建。原327现253含部分/68已有不同/6待，内部验收缺口不删。
- R059已推送5b056333035d145037fd75acec79f099eea8470a，对应40992598123运行；R057/40984944304已终态success，R073/40989729533和R074/40992045627仍各六job成功、Pool持续前进，继续跟。历史GoIO/三机SSH身份/真实邮件及完整灾备保留。按owner逐项提交推送后继续R177，不发行/生产。

## 2026-10-30 R1-059 孤立恢复组件及全局任务store

- 完整读BackupManager996行/restoreTask219行，应用两入口、路由、组件、Vite所有plugins/alias、静态/动态导入与脚本全搜。store只有BackupManager消费者；组件无消费者或动态/全局自动注册。仅清这两个孤立文件，不将旧store竞态修改搬入当前不同备份栈；历史初审仍保留当时证据。
- 实际backups路由/restoreTaskWorker/platform-backup-worker、AliyunOssView及OssRecoveryReview/Reconcile、两router/API/InstanceDetail十SHA256逐个前后保持，最终运行源码零孤立符号引用。4/4守卫test-run-20261030-103155（route/i18n/backup-task-race/review-core-boundaries）自然exit0；末双端含两次vue-tsc构建72497自然exit0，日志takeover-retired-restore-dual-build-final.log；末dist takeover-retired-restore-dist-final.log自然exit0。两次core守卫别名错误轮未执行，不计通过，最终按实际脚本名执行。无新增UI/业务/权限/网络动作，孤立入口无真机流程可验，不充OSS/客户实例恢复证据。
- 原327现252含部分/68已有不同/7待；单项提交推送后继续R174/177终端建连撤销窗口，已有早close/error但activeSessions注册迟于后台连接、路由最后授权复核仍需实测。R074 9b0535612ede6d7c705d6b9c6124525f3c060112/40992045627运行，40984944304及40989729533仍Pool持续前进，无新增失败；旧GoIO/SSH身份、真实邮件/客户与完整灾备仍未完成，不生产/发行。

## 2026-10-30 R1-074 通知渠道操作与替换草稿

- 已提交推送9b0535612ede6d7c705d6b9c6124525f3c060112，HEAD=远端main，新CI40992045627运行；接R059仅删除无运行消费者的BackupManager与旧store，实际备份/OSS/worker/router/API十文件SHA保持，构建与守卫继续，未提前计R059。前40983222814七jobsuccess，40984944304及40989729533仍待终态。

- 实际组件先红重复create发两次请求。四写共享在途锁，固定已确认渠道目标、account/role/sid、同步代次及auth存储快照；cache/account改变不提前释放旧请求锁，旧成功/失败不能toast、清替换草稿或重读新账户。create固定提交config/name和同步草稿revision，取消/重开同值也保留新草稿；取消清敏感config。delete确认显示渠道名并在确认后再核目标；toggle提示依据真实enabled回执。真实create/message/toggle合同严格验证，当前失败持久显示并可用原按钮重试。
- 最终受控Chrome takeover-notification-actions-final-complete.log /49822自然exit0：64旧操作成功失败、重复/交叠四写、detached config、替换草稿/同值重开、reload失败、12坏回执、confirmation身份改变和cache锁释放；三语三宽实际input/save重复点击/失败retry及全部行按钮；18三语三宽深浅布局、三种渠道label/44px和长名/secret清理。takeover-notification-actions-reads-final-complete.log /26393自然exit0完整R073回归含42旧读/21坏读/36首帧两motion与焦点。只用本机实际Chrome和受控API，不等于真实邮件或后端并发验收。
- 局部taste沿Achromatic ledger seed242843060，修继承紫色主按钮/光晕和深色低对比label，不重抽方案。最后form深浅三宽各0FAIL/1WARN（短设置段落外的留白）；history各0FAIL/0WARN。两类全部24末fold/page图已看，critique为logs/notification-actions/critique.md；静态box-shadow:none/backdrop-filter:none词法警告是取消现全局效果。完整Profile布局/真实发送仍另验。
- 末4/4守卫test-run-20261030-102315、manifest、有效client目录lint零错警通过；最后双端含两次vue-tsc构建74600自然exit0，takeover-notification-actions-dual-build-final-verified.log(user1m16s/admin52.22s)，末dist takeover-notification-actions-dist-final-complete.log自然exit0。两次守卫命令错误、根目录ESLint缺config与同一浏览器tick输入后点击disabled按钮的夹具失败均不计通过，已按真实入口/渲染更新顺序纠正。
- 原327现251含部分/68已有不同/8待；先单项提交推送再接R059。前8721068f802128ac3450022afcb997d45376cfd3/40983222814七job终态success；40984944304和40989729533各六job成功、Pool继续前进，仍待终态。历史40799210505 Go进程审计IO根因未定，三测试机既有SSH身份缺口/真实邮件/完整灾备保留，不生产/发行。

## 2026-10-30 R1-073 通知历史当前读取及弹窗精修

- 阶段保存fdacee96a6da35ca37a1f82831ab976ef744f1c4已推送远端main，CI40989729533运行。R074重复create先红2≠1，当前四操作busy/提交快照/草稿代次/旧session回执初稿已写，运行专项继续；不可将其初稿算已完成。前12516448f298f4e8c06137f8aae717393c2a161e/40981291834现七job终态success；40983222814、40984944304及本项CI继续跟。

- 实际Vue组件先红：较早全部历史覆盖较新失败筛选。列表、历史及统计分别绑定account/role/sid、auth存储对齐、generation/请求序号、当前页及筛选；close/reopen和KeepAlive/unmount清旧展示与敏感草稿，旧成功/失败/finally不能写新状态。列表仅接受后端脱敏preview，不解析不存在的config；严格分页/行/统计合同，独立PG计数不强制瞬间等式，缩页重读合法页。当前读取失败持久显示真实retry，同视图保最近成功数据，loading/empty/合法零区分。
- 末受控Chrome专项takeover-notification-reads-last.log自然exit0：42旧list/history/stats成功失败、account/sid/role/ABA/logout/cache/unmount、filterABA/存储未同步零dispatch、pending关闭重开、oldfinally、21坏响应、三类实际retry、零stats/same-sid刷新、缩页与36组首帧44px/三语三宽深浅两motion/Escape及opener焦点。实际组件+API受控，不等于外部邮件送达或真实cookie后端验收。
- 弹窗沿Achromatic ledger seed242843060、keep palette/type，取消继承scale-in/玻璃/重阴影，提高对比及13px小字，复用焦点trap。先红首帧41.8px后保44px严格断言，修正watch时modal ref尚未挂载与Vue :global选择器被编成全局.dark，最后深浅三宽inspect各0FAIL/0WARN，十二张末截图已看，critique保存在logs/notification-reads/critique.md。普通列表原结构及通知发送/权限规则保持；R074写回执和重复操作仍待。
- 4/4末守卫test-run-20261030-095755、manifest与末lint零错警通过；最终双端含vue-tsc构建16387自然exit0，takeover-notification-reads-dual-build-last.log（user见原日志/admin53.11s），末dist takeover-notification-reads-dist-last.log自然exit0。250含部分/68已有不同/9待，保存后继续R074，已先红重复create两次请求。历史3bb81c495e86e08d810073b1f90d732fb0cb59e3/40978319474、498ed0d316e0e02f0cfc3e8a5aca2ad7e3f5d235/40979555768、27a57a5343e63aef66c8c4472d097a49847e781c/40979936516具体七job均终态success；40981291834、40983222814、40984944304仍运行，继续跟。历史Go进程审计IO未定位，三测试机SSH既有身份缺口保持，不生产/发行。

## 2026-10-30 R1-057 双API共享刷新及旧操作重试保护

- 已提交推送7606cebfdedc9259000889269c4e8479d6ee7018，HEAD=远端main，新CI40984944304运行；接R073通知历史读取，已完整读NotificationSection、Profile消费者、actualAPI/通知routes和两通知守卫，尚未改其产品源码。前Caddy40974379396与旧账单组件40975365166终态success，五其它前序CI继续跟；不生产/发行。

- 真Chrome先红：用户与管理API各自锁使同session同时两次refresh（before-actual：2≠1）。仅两wrapper原重复刷新/拦截器段落移到小型auth-session绑定器，各业务模块、URL、超时、凭据发送与错误额外字段保持，登录目的地仍各端本地。固定auth store身份/同步代次和原存储值，dispatch前同步捕获，实际transport前再核；旧成功/401/主动刷新及queued retry不得回写或借替换token发旧操作。same-sid已刷新token可单次重试，全部queued request有一次重试上限，15秒abort/5秒频控仍保留。
- 真实Axios浏览器adapter与fetch受控，最后完整takeover-auth-refresh-final-complete.log自然exit0：共享主动/被动队列、28旧refresh成功/401、旧HTTP成功/401、storage事件前未同步零dispatch、两端第二401退出/旧queued零重试、replacement锁旧finally、503保身份/当前refresh401零dispatch、十非法token/合法role变化invalidate，以及memory-only跨端退出后新login成功。fixture第一次错误选Node axios导致process undefined已纠正浏览器ESM；其次静态导入先于受控adapter导致零fixture请求已用动态import纠正，失败轮均不计通过。无真实客户、cookie、外部OAuth或生产写入。
- identity44组回归85138和实际两login页44046自然exit0；4/4末守卫test-run-20261030-091346、manifest、末lint零错警通过。最后types15395/build90589自然exit0（user约62s/admin51.73s），最后源码含当前存储不对齐时只允许认证入口、旧业务零dispatch；最后完整专项9058自然exit0。末dist takeover-auth-refresh-dist-final.log自然exit0。R056保存8721068f802128ac3450022afcb997d45376cfd3/CI40983222814仍in_progress；前40974379396、40975365166success，其余四前序CI继续跟。原327现249含部分/68已有不同/10待；R057完整cookie/OAuth/注册交换与原内部缺口保持，保存后接R073/074，不停工。

## 2026-10-30 错误记录复核与 R1-056 当前身份回执

- 本阶段已提交推送8721068f802128ac3450022afcb997d45376cfd3，远端main一致，新CI40983222814运行。前Caddy修复提交b8b88f02de22b9bc003a6d7203bdce0d08f7ed76对应40974379396已completed/success，具体七job全部success；其余五前序CI与本阶段CI继续查终态。阶段保存后已接R057双API刷新，源码及对应鉴权/前端/dist守卫已读；原并发cookie/OAuth与历史Go IO未解决。

- 按owner最新要求核对已保存错误：进度回复后停工、漏查CI终态及Caddy首帧缩放漏测。根因、纠正与下次接续检查已补充OWNER_REQUIREMENTS §5；本阶段将其随源码保存，随后继续R057，不以记录错误结束工作。
- R056保留上一轮未提交改动，补当前account/role/sid、同步generation和读取序号、存储当前值核对；身份切换/跨标签clear/延迟事件及ABA立即清user/quota。旧me成功/401、登录与登出回执不得改替换会话；当前登出立即清私有信息并阻止身份读取，仍先发送原后端登出再清token，当前网络失败保已确认身份。same-sid刷新保留身份，当前401正常退出；接口和后端会话权限规则保持。
- 最终真实Chrome受控API专项takeover-auth-session-final-verified.log自然exit0：44旧身份成功/401、读取先后/零quota/same-sid、十非法身份、四旧登录、十登出完成与实际storage事件。原实际两登录页回归15370自然exit0、控制台20旧摘要/三语三宽/late mount回归50459自然exit0；client types95749、最后lint零错警、4/4相关守卫test-run-20261030-085548、manifest通过。最后双端build48388含各自vue-tsc自然exit0（user46.21s/admin48.26s），末dist守卫takeover-auth-session-dist-final.log自然exit0。无视觉变化；受控API不替代真实跨标签后端cookie并发、OAuth/注册旧交换或R057刷新重试链路，内部缺口保留。原327现248含部分/68已有不同/11待，不是全验收数。
- 最新CI40981291834/12516448f298f4e8c06137f8aae717393c2a161e六job success，Pool在邮箱销毁专项运行；40974379396/b8b88f02de22b9bc003a6d7203bdce0d08f7ed76六job success及三个Caddy专项success、Pool后续配置/积分专项仍运行。其余40979936516、40979555768、40978319474、40975365166继续待查终态，不能记整轮通过。历史40799210505原生Go进程审计IO仍未定位；本机无WSL发行版，三测试机既有SSH身份缺口保持，不放宽认证。

## 2026-10-30 R1-055 / R1-058 控制台摘要会话与轮询生命周期

- 已提交推送12516448f298f4e8c06137f8aae717393c2a161e，HEAD=远端main，新CI40981291834运行；40974379396三个Caddy专项（读取、操作、首帧36组）现在均success，Pool仍继续配置专项，不能计整轮CI完成。

- 实际Dashboard五请求先红：account2新结果后account1旧结果把auth身份写回1；另独立卸载复现mounted等待结束又新建timer。现固定account/role/sid/route及同步代次、KeepAlive/unmount立即清摘要/停止timer，mounted/activated同步共用activate，一次初读/一条timer/当前单在途。五读取Promise.allSettled后复核当前，严格inventory数组/正ID/重复/归属、me ID/role；只在当前允许身份和摘要写入。必要读取失败持久retry、401当前stop，optional失败保最后确认当前余额/积分，零/空正确。请求不会取消远端业务，本项均只读；auth store/API refresh另项。
- 完整最终takeover-dashboard-session-complete.log自然exit0：20旧account/sid/role/logout/session-cache-route ABA/unmount五请求摘要，旧finally不释放新在途、同sid保持/初读不重复、失败actual retry/foreign me与坏inventory拒绝、合法空/真零、三语1440/768/390实际retry及全页无横溢、late mount零timer/数据。SSHKeysSection当前已有R075/076防护，takeover-dashboard-ssh-session-regression.log真实14旧回执/坏list/retry复验自然exit0，不重复改其源码。
- client types82650自然exit0，目标lint-final零错警（一处既有多空行warning移除），2/2route-i18n(test-run-20261030-083603)、manifest/语法/diff通过；最终双端build8779含两次vue-tsc自然exit0(user51.32秒/admin48.67秒)，末dist守卫通过。最初类型合同与script重复const失败已修，失败轮不计通过。三语三宽9终图已全看；仅摘要逻辑，不改旧紫色spark/光晕、低对比/长手机指标布局，整页taste/UI仍未达上线验收，不用这一项假称全页面精修。
- 原327更新247有修复/复验（含部分）/68已有不同/12待，已记录内部缺口继续。R166已push27a57a5343e63aef66c8c4472d097a49847e781c/CI40979936516运行；前40974379396 Caddy读取与操作已success、首帧专项当前in_progress，其Pool及其它新CI仍非终态，不计整体CI通过。阶段保存后接R056当前auth identity旧回执/跨标签identity清理，再R057双API refresh，先读高危源码与守卫，保留Linux IO、SSH pin和完整灾备缺口，不生产/发行。

## 2026-10-30 R1-166 无调用旧重试模块

- 已提交推送27a57a5343e63aef66c8c4472d097a49847e781c，HEAD=远端main，CI40979936516运行；下一项期间跟终态。

- 完整读取288行server/src/lib/retry.ts，运行源码、脚本、前端、agent、部署、文档与CI搜索无该模块导入/动态加载/重新导出，withRetry等仅自身定义与内部使用；同名backup/batch-config本地函数和gateway-journal是不同实现。仅删除孤立模块，不凭参考清单删除其它实际JSON验证。
- 六受保护gateway journal/installation worker/backup upload/batch config/Incus实例/Agent源码SHA256修改前后保持；最终引用搜索没有旧模块消费者，git diff通过。server含tsc build70853自然exit0；4/4常规core-boundaries/incus-pool/agent-install/backup-task-race（test-run-20261030-082633）正常exit0；额外实际gateway-installation-guards涵盖journal忙锁重试与lease拒绝自然exit0（takeover-retired-retry-gateway-guard.log）。没有孤立模块活体流程可验，不将清理当作真实备份/网关交付重试验收；本地既有dist的历史文件不充新干净发行产物证据。
- 原327更新245有修复/复验（含部分）/68已有不同/14待。R054已push498ed0d316e0e02f0cfc3e8a5aca2ad7e3f5d235/CI40979555768，新CI仍运行；前40974379396/40975365166/40978319474须继续跟集成终态。R055完整复读发现SSH隔离已随R075/076实现，Dashboard仍无session代次、并有R058晚mount建timer，下一先真实复现这两项；原Linux IO/网关灾备及内部缺口保留，不生产/发行。

## 2026-10-30 R1-054 未读计数与布局轮询清理

- 本项已提交推送498ed0d316e0e02f0cfc3e8a5aca2ad7e3f5d235，HEAD与远端main一致；新CI40979555768运行，后续跟到终态。该SHA同时登记上一R048完整SHA/CI。

- 真实Chrome先红：clearUnread后旧响应把0恢复8；实际AppLayout卸载仍保留initialized=true、一个15秒timer与visibility listener。store固定当前账户/role/sid与同步代次，本地clear/decrement、会话切换与stop使旧响应失效，当前轮询/refresh/可见性共享一个在途读取，旧finally不得释放新请求锁。同sid token更新保持，非法count保留最后确认值，合法0显示0；layout卸载stopPolling。仅一处既有多空行lint warning顺手去掉，无样式/API或后端修改。
- logs/takeover-inbox-polling-final.log自然exit0：14旧account/sid/role/logout/ABA/stop/restart成功失败回执，清零/递减与新通知、重复tick/refresh/visibility单请求，坏count/失败retry/真零、旧finally隔离，以及实际AppLayout卸载清timer/listener、旧响应不能恢复、重挂恰一轮。专项test:review-inbox-polling已登记server/EXCLUDED/CI；interval夹具保留真实callback与登记/清理，主动触发15秒callback以免等待，API受控。未测试真实账户通知或跨标签页，NotificationBell与auth旧回执仍独立缺口。
- R048完整冻结源码回归takeover-inbox-polling-receipts-regression.log自然exit0含90旧回执/三语三宽44px；有效目标lint-final零错警，route/i18n 2/2(test-run-20261030-081843)、manifest/语法/diff通过。双端含两次vue-tsc build session50242自然exit0，user59.90秒/admin48.97秒，末dist守卫通过（takeover-inbox-polling-dist-final.log）。本项无视觉变化，沿R048已验局部UI，不重跑taste或完整套。
- 原327现244有修复/复验（含部分）/68已有不同/15待，不是全验收数。R048已push3bb81c495e86e08d810073b1f90d732fb0cb59e3，远端一致，新CI40978319474及40974379396/40975365166均其它六job成功、Pool继续顺序运行，不计通过。旧四失败已读/已记录；历史40799210505已再次读取原日志明确TestReadActualProcAuditAndCancellation的IO失败，代码审查尚不足确认根因，未改Go或降低门禁。阶段单项提交推送后继续R166已读孤立retry及R055缓存，不生产/发行。

## 2026-10-30 R1-048 站内信读取、已读与删除回执

- 本项已提交推送3bb81c495e86e08d810073b1f90d732fb0cb59e3，HEAD与远端main一致；新CI40978319474仍in_progress。该SHA包含错误规则、源码、专项与交接；下一R054期间继续跟终态。

- Chrome先复现旧列表覆盖新列表；固定账户、role、sid、路由、分页、筛选与同步代次/请求序号，KeepAlive及卸载清旧数据。严格归属、消息结构与分页，读取失败持久显示可重试，未确认列表不允许写入。四类写入共享在途门禁，strict success/count，旧回执不修改新列表、计数或通知。
- 已读立即移出未读筛选；删末页末条回退合法页并重新读取，同账户切筛选时原写完成再次同步当前列表。保留现有点击路由行为，旧点击完成不导航替换视图；实际按钮禁用/aria-label及内容键盘操作，手机44px。局部去渐变/光晕/阴影、改善时间与描述对比，后端接口/权限/消息发送保持。
- 最终无HMR冻结源码logs/takeover-inbox-complete-verified.log自然exit0：最新响应、未读移除/末页回退、90组旧读写account/sid/role/logout/ABA/cache/unmount/route/filter回执，坏读写与持久重试、重复/交叉门禁、count=0、切筛选再同步、旧点击和三语1440/768/390实际按钮/手机44px。最后双端含vue-tsc build自然exit0（takeover-inbox-final-dual-build.log），route/i18n 2/2（test-run-20261030-080551）、目标lint零错警、manifest分类与diff通过；最后构建后dist守卫takeover-inbox-dist-final.log通过。早期带HMR或端口冲突轮不计最终通过。
- 专项test:review-inbox-receipts已登记server/EXCLUDED_FROM_SUITE/CI。taste沿Achromatic ledger seed242843060，浅深三宽0FAIL/1WARN，短消息列表留白保持实际内容，12终图已查看，critique 7.3存logs/inbox-receipts-critique.md。受控API、独立组件与测试消息不代替真实账户、完整shell、后端并发、外部邮件或NotificationBell/未读store验收；未读store下一R054。原327现243有修复/复验（含部分）/68已有防护或不同/16待，已记录项内部缺口仍保留。
- R072已commit/push025c3bf888c7f6acc1654aaaaa5b213a426b9425，远端main一致。最新40974379396/b8b88f02de22b9bc003a6d7203bdce0d08f7ed76与40975365166/025c3bf888c7f6acc1654aaaaa5b213a426b9425均六job成功、Pool集成仍in_progress，不计CI成功。旧40968364762/40969838036/40970307707/40970700657全部completed/failure，原失败日志logs/takeover-ci-<ID>-failed.log均已读，均旧源码Caddy手机44px；原失败不抹去、不重跑旧提交。历史40799210505 Go进程审计IO仍未修，三测试机身份不匹配/缺pin仍未发远端命令；继续代码审查保留原生Linux缺口。
- Owner再次要求记录错误；OWNER_REQUIREMENTS §5已明确事实/根因/修正/下次检查，随本阶段保存。阶段提交推送后继续R054及CI终态，未操作生产/客户/Release/tag/OTA/DNS。

## 2026-10-30 R1-072 清理无调用的旧个人账单组件

- 已完整读取667行BillingSection及其调用/路由/对应守卫，当前ProfileView明确余额移至WalletView，应用/路由/自动组件导入均无BillingSection消费者；最终搜索仅余两条翻译注释。只删除孤立组件，保留翻译兼容、实际Wallet/Profile/user router/API与充值后端。实际页面无此组件的运行流程可验，不将清理残留当作余额/支付生命周期修复。
- 3/3相关守卫route/i18n/balance-change-amount正常exit0（test-run-20261030-074148）；第一次把--only当正则未匹配，不计通过，已按repeatable substring正确重跑。双端build含各自vue-tsc最终exit0，user47.78秒/admin49.38秒，末dist守卫过。删除无样式或交互变化，沿现有UI；受保护Wallet/Profile/router/recharge源码SHA256修改前后保持。日志takeover-r072-dual-build、guards-final、dist-final及references-before/after；未跑完整套或客户充值。
- 上阶段Caddy修复与错误记录已提交推送b8b88f02de22b9bc003a6d7203bdce0d08f7ed76，远端main核一致；对应CI40974379396仍in_progress，不能计通过。旧四CI40968364762/40969838036/40970307707/40970700657仍pool job运行，其它job已成功。历史Go进程审计IO尚未修；三台测试机资料已读，固定Ed25519再试A/B仍身份不匹配、C无已核pin，未接受新身份或发远端命令，继续代码级审查。容量可见性旧失败已有c6be3789准确测量及真实1px遮挡负对照；新CI终态继续核验。
- 原327编号更新为242有修复/复验（含部分）、68已有防护/不同初审、17待精修。242不是全验收数，真实宿主、外部服务、部分项内部缺口及完整网关灾备继续。此项验证完成即按授权提交推送，再接R048站内信当前读取/未读过滤/删末页回退，不因本次错误记录完成停工。

## 2026-10-30 纠正停工与CI漏查，修复Caddy弹窗首帧触控尺寸

- 执行错误已写入OWNER_REQUIREMENTS §5：在未完修复的进度回复后停止、未跟进in_progress CI终态。以后阶段汇报后继续；每次推送记完整commit/运行ID、跟踪具体job终态，失败先读原日志，不将本地绿或阶段提交当完成。原327仍241有修复/复验（含部分）、68已有防护/不同实现、18待精修，已记录项内部缺口继续保留。
- 已读取CI40962294025、40963306413、40964780673失败原日志，均在Host Caddy operations手机44px断言。真实Chrome冻结动画复现modal-content继承scale-in首帧scale(0.95)，按钮实际约41.8px，reduce模式也缩小；仅等待动画后测量导致漏查。只在HostCaddyTab弹窗取消animation/transform，保留其它组件和44px严格断言，未改后端/凭据/客户网络。
- 新增test:review-host-caddy-touch并登记server脚本、专项分类与CI。真实Chrome冻结动画两偏好×两主题×三语×三宽36组全部通过；完整四操作/72旧操作/24旧复制及三语三宽真实控件、键盘回归通过，日志takeover-ci-caddy-touch-frozen-final.log与takeover-ci-caddy-actions-final.log。浅色中文与深色英文手机末截图复看，沿既有Achromatic ledger；本次局部尺寸修复不充当完整父页或Linux Caddy安装验收。
- client类型、组件有效ESLint、语法/manifest检查、五相关守卫（test-run-20261030-072652）通过；最终双端build含两次vue-tsc完成、之后末route与dist守卫通过，日志takeover-ci-caddy-build.log、takeover-ci-caddy-route-final.log、takeover-ci-caddy-dist-final.log。未重复完整套或生产/发行。
- 40968364762/40969838036/40970307707/40970700657最新仍in_progress，各其它六job成功；旧源码不含本次修复，不能计7/7或声称已修其运行。历史失败通知另外查到40799210505原生Go进程审计IO与40817435630容量可见性；已读原日志，是否在后续提交解决须按同文件历史和新运行证据核对。历史失败保留原failure，不靠重跑抹去。此阶段按已授权提交推送，登记新完整SHA及运行ID后继续原清单和CI终态。

## 2026-10-30 R1-156 保留重装镜像读取，清理无调用写入与旧长轮询

- R165已commit/push08a2b9ca核远端干净。完整符号与动态import复核纠正初审：instanceTaskWorker重装属性同步确实使用getImageAlias/getImage，因此保留两读取及IncusImage/IncusImageAlias。仅移除其它9个无调用镜像列表/拉取/别名写/删除/存在性函数、无人消费的barrel镜像导出、PullImageOptions和仅旧拉取调用的waitForOperationLong；现行waitForOperation/mapInstanceStatus保持。四文件净减267行，无worker/路由/前端/DB修改。
- 修改前后两个读取、现行wait/status函数逐字相同，重装worker SHA相同；最终运行目录无被移除符号，实际动态import及属性同步仍在。受控request专项真实执行保留两函数的alias→fingerprint→properties、准确路径和失败传播（logs/takeover-retired-incus-images-read-regression.log正常exit0）。此证据不等于实际重装客机/公网镜像拉取验收；没有无调用旧函数的活体流程可验。
- server build70086最终正常exit0含tsc/复制gateway UI；五守卫53343正常exit0（logs/test-run-20261030-070353）core-boundaries/image-route/instance-operation-conflict/dedicated-delivery/incus-certificate-paths，5/5共14秒。根显式config四文件lint零错警、最终引用/保留函数比对/diff通过。未改前端，不重复双端build，未跑完整套/生产/客户/发行。
- 原327编号：241有修复或复验记录（含部分）/68保留已有防护或不同初审/18待精修。241不是全部验收通过数；后端并发/真实宿主/外部服务及整页UI仍按各条未完范围保留。按owner授权本项提交推送，然后继续，不以维护残留清理冒充完整重装或网关灾备验收。

## 2026-10-30 R1-165 无调用者网络适配器残留

- R113已commit/pushc174586c且HEAD与origin/main一致、工作区干净。重新搜索server源码/脚本、client、deploy、scripts和docs-site，listNetworks/getNetwork仅定义在incus-network，IncusNetwork只被该模块引用，index仅导出，没有运行调用者。移除21行适配器、3行barrel导出及7行孤立类型，无数据库/前端修改。先前搜索不存在模板目录的轮不作为最终证据，最终日志takeover-retired-incus-network-before-references-final.log搜索无错误。
- 八个现行网络实现修改前后SHA256一致：专属全端口、IPv6、实例桥接、网络同步、清理、宿主公网发现及机器池恢复均保持。清理后运行目录无旧符号或导入，server/dist入口及类型无旧导出。退役模块无活体流程可验，不以本段代替原生网络或客户实例验收。
- server build84536最终正常exit0，含tsc与gateway UI复制；四守卫85974正常exit0（logs/test-run-20261030-070028）：core-boundaries/incus-pool/host-pool/incus-certificate-paths，14秒4/4。根显式config目标lint零错警与diff通过；未改前端，不重跑双端build，未跑完整套/生产/发行。
- 新增R165记录后240项有修复/复验（含部分）/68保留已有防护或不同初审/19待精修。下一R156复核发现instanceTaskWorker重装仍动态导入getImageAlias/getImage，旧「整个镜像适配器无调用」结论有误；保留两个实际读取及类型，仅处理真正无调用导出和旧长轮询，不删除重装属性同步。当前R156尚未修改，不提前计完成；完整327/真实宿主/网关灾备继续。

## 2026-10-30 R1-113 实际宿主类型拒绝三语与写前保护复验

- R110已commit/push91681263。纠正旧清单「写后warning正文硬编码」：现后端PATCH在写前返回400及HOST_INSTANCE_TYPE_MISMATCH/packages，不再返回warnings。实际Chrome先红显示errors.HOST_INSTANCE_TYPE_MISMATCH；补简体/繁体/英文说明与下一步，组件te确认有翻译才t，未知code回退原message。api.hosts.update从错误Host类型改真实{message:string}，唯一使用者保留运行时message检查；不改变后端类型规则、客户网络和交付。
- Chrome34044最终正常exit0，三语1440/768/390真实save/拒绝/持久错误/草稿保留/重试与未知code回退通过，9张实际截图已全部查看；R110完整submit回归40895正常exit0含22旧回执和同步五开关门禁。真实隔离Fastify/PG logs/takeover-host-config-type-pg.log正常exit0：container套餐拒vm、vm套餐拒container时全部host字段保持、零成功audit，核packages且无warnings；foreign403、compatible及both200与精确message通过。只本机隔离PG，无Incus请求；不将此项当作当前权限或并发类型绑定窗口已全验。
- client types74125/server types25767、两TS专项types54391、client目标lint91956均正常exit0；四守卫74069（logs/test-run-20261030-064836）route/i18n/package-host-type/host-pool通过。server目录无eslint配置和client基准路径ignored轮均不计通过，最终从根目录调用client ESLint并显式配置，两TS有效检查零错警（logs/takeover-host-config-type-server-lint-root.log）。manifest194常规/209专项分类与脚本语法/diff通过，两个新专项已接CI。
- 最终双端含vue-tsc build88829正常exit0，user54.64秒/admin51.41秒；末dist边界守卫c17cad正常exit0。本项仅错误文案/类型合同，无布局改动，沿R110局部taste结果，不把9截图当整张配置页UI验收。未重跑完整套；外部邮件、真实Linux宿主、后端配置并发、生产及发行另验。
- 原327编号：239项已有修复或复验记录（含部分），68项保留已有防护/实现不同等初审结论，20项待精修/运行复核。239不是完整验收通过数，剩余全部工作还包括已记录项内的未完范围。按owner授权本项提交推送后继续；原网关完整灾备未完成，不操作生产/客户/OTA或发行。

## 2026-10-30 R1-110 配置草稿与当前保存回执

- R111596ee48a已push核远端。真实Chrome先红：同host父刷新覆盖未保存描述。现在cleanDraft为ref、dirty/pending保留表单，clean状态才接父刷新；host/account/role/sid/同步代次、草稿代次/ABA、KeepAlive/unmount固定保存目标和payload。原写锁保留至finally；全fieldset禁用，国家与五个开关另加同步门禁，旧成功/失败不通知/emit/改新草稿。严格实际PATCH非空message，当前失败持久保留且原save retry；删除已退役post-write warning，实际类型拒绝三语R113另续。
- final-last90956正常exit0：22旧host/session/draft ABA/cache/unmount回执、dirty/clean父refresh/pending草稿、固定payload/repeat锁、cache回来原锁、坏message及当前失败retry/same sid/用户前缀，三语三宽实际save/失败/44px过。新开关专项复现同一tick保存后仍可点击，补toggleSetting同步busy门禁后过；先前开关span误标role及不合法用户夹具失败均不计通过。R112endpoint39369原八URL/24修改组合/六坏port三语回归正常exit0；R111最终clear53040正常exit0，无HMR轮；前清空轮有fixture HMR不作为最终证据。
- client类型25029、组件lint最后87776序列、五守卫87776（logs/test-run-20261030-064006）正常exit0；manifest194常规207专项/语法/diff与CI登记过。双端含vue-tsc build27707正常exit0，之后仅局部contrast/开关off背景CSS修改，两端vite补构68621正常exit0；末dist守卫正常exit0，两端末CSS包含text-secondary与开关轨道声明。错误的--only匹配轮未执行守卫、不计通过，无待poll。
- taste沿Achromatic ledger seed242843060无重抽：手机开关触控/轨道分离、黑白/focus/减少motion、提示字13px及浅深可读性。最终浅深三宽0FAIL/0WARN，12终图和三语9图全看；static0FAIL/4WARN为浮层shadow及三个none声明，critique7.14存logs/host-config-submit-critique.md。整张长配置页/国家下拉完整键盘/标签及真实宿主全流程仍另验。
- 新增R110后238有修复复验含部分/68已有防护不同/21待。前三阶段CI最新查询仍in_progress，不宣称CI成功。即提交推送，然后R113当前HOST_INSTANCE_TYPE_MISMATCH错误三语与真实写前拒绝复验；真实客户/生产/发行/327及完整网关灾备未完。

## 2026-10-30 R1-111 明确提交描述与 IPv6 字段清空

- R112141c5f7a已push核远端一致。真实Chrome先红清空description/subnet payload仍undefined。location现保留显式空字符串，IPv6父接口/subnet发送trim后空字符串，沿现有PATCH normalize→null，不以undefined遗漏。明确mode2/3允许清空已退用subnet和parent；剩余subnet及mode1保父接口门禁，mode缺失沿原谨慎规则，不改后端必要路由配置拒绝或客户IPv6/全端口。
- clear-final13138正常exit0：mode2/3八组合/空白trim、保留subnet缺接口与mode1双清空拒写、后端拒绝不发saved且保草稿、三语三宽实际清输入/save过。R112endpoint回归8268正常exit0，原八URL/24修改组合/六坏port及三语真实控件过；本段UI布局不改，沿R112已查看三语9截图，不声称原长配置页完成。
- 真实本地Fastify/PG final-exit：mode2/3空description落空字符串、subnet/parent落null，原mode/URL保持；字段省略保原值、foreign actor403、route-mode三类清空400且所有字段保持，最终正常exit0。首根目录tsx缺失轮/初import维护timer未自然退出均不计通过；初轮已完成清理，定向停止后补cleanup后退出并重跑成功。只本机已迁移隔离库，不请求真实Incus。
- client types65105、server types61862、组件lint33568和五守卫76006（logs/test-run-20261030-061305）正常exit0；manifest194常规206专项/语法diff接CI有效。新PG专项独立TS56390及最终双端build99750含两端vue-tsc/末dist正常exit0，无待poll；专项配置首次typeRoots路径错误保留不计过。只有4行payload及mode门禁改动；旧PATCH audit独立提交等非本项验收范围。
- 新增R111记录后237有修复复验含部分/68已有防护不同/22待。真实宿主/完整327及网关灾备未完，不发行/生产/客户操作。补最后证据即提交推送，再接R110同host父refresh草稿/current session/cache/重复保存和R113退役warning分支纠正。

## 2026-10-30 R1-112 宿主配置保留原连接地址

- R109操作27000e3a已push核远端一致。真实Vue/Chrome先红：仅改描述，原http/path地址被重建https:8443。新增小型host-config-endpoint helper：URL.port为空时按HTTP80/HTTPS443解释，保留显式非标准端口；无关编辑或改后恢复原值完全不传url，避免重登记连接。实际地址/端口改变用原URL只替换hostname/port，保留协议/path/query/hash；IPv6方括号正确，非法safe integer端口拒写。不改后端地址安全校验、管理身份、网络或实例。
- endpoint-final68686正常exit0：八原URL默认/显式port、HTTP/HTTPS/path/query/hash/IPv6、24地址-port组合及IPv6替换、六坏port和恢复原值、三语三宽实际port-input/save零横溢通过。全部9实际截图已看；只字段逻辑，现有长配置页UI/紫色控件与父refresh/draft/session、清空字段、类型不兼容分支另待，未借本段声称整页完成。
- client types84499与lint30139零错警、四守卫39732（logs/test-run-20261030-060303）正常exit0，专项登记server/EXCLUDED/CI，manifest194常规204专项/语法/diff有效。双端build56976含两端vue-tsc正常exit0，末dist守卫正常exit0；两端产物含新的默认端口及原URL路径保留helper，不计中途transform为通过。
- 新增R112记录后累计236有修复复验（含部分）/68已有防护不同/23待。不是真实宿主重连接验收；未运行完整套/生产/客户/发行。阶段保存后接R110草稿/session/重复与R111清空，R113后端现已写前拒绝不兼容，不照搬旧warning分支。原全端口/IPv6/网关灾备目标保留。

## 2026-10-30 R1-109 Caddy 操作、凭据弹窗与复制（源码段落）

- R108/109读取已commit/push6a36ce98核远端一致。真实Chrome操作先红：连续generate发两次请求。四操作现统一在途门禁、固定host/account/role/sid/同步代次及命令/弹窗代次，当前操作期间不允许读/重复/交叉提交；切换目标和缓存返回可读当前状态，旧操作锁保持至原请求结束。旧成功/失败不得展示凭据、通知、关新弹窗或刷新新host。reset原生确认后复核context；confirm必须当前命令弹窗及凭据，test要求已启用。
- strict generate/reset凭据和port、generate的isNewCredentials、confirm非空message、test的bool/count/DNS；合法connected=false/0显示持久失败，不伪装成功。失败当前入口可retry、confirm失败保留弹窗。敏感命令/password换host/session/cache/unmount/关闭清空；copy等待实际Promise、共享在途锁/持久失败与真实按钮retry，旧弹窗/凭据ABA和旧account回执不通知。只改前端，不改Caddy后端鉴权、脚本及客户网络。
- final-r4与读取回归合并session99800最终正常exit0：72旧四操作回执、cache锁/原生确认context/弹窗ABA/same sid/读写隔离、非法回执/失败重试/合法disconnected零、复制24旧回执/拒绝/不支持/同步throw、三语1440/768/390真实generate/confirm/copy、dialog聚焦/Tab/Shift-Tab/Escape与44px通过；R108全部36旧读/9坏status/14坏sites/分页缩页回归通过。首轮焦点/点击缩放44px/Escape失败均已修，不计失败轮为通过；定向停止inspect-only10232不计自然完成，无测试服务需保留。
- taste沿Achromatic ledger seed242843060无重抽，原玻璃/蓝色提示改局部实色黑白，遮罩隔开背景，按钮缩放禁用、copy44px/focus与dialog标注、关闭清凭据；终浅深三宽0FAIL/WARN12图及真实三语错误截图9图已全部查看，critique7.4见logs/host-caddy-actions-critique.md。无真实密码/token，fixture仅display-only文案及example.test/文档地址。完整父页与真实Linux/Caddy/系统剪贴板仍另验。
- client type-check20491、最后五相关守卫62004（logs/test-run-20261030-055210）、组件lint85921、脚本syntax/manifest194常规203专项分类与CI登记/diff通过；最终双端build49208含两端vue-tsc正常exit0，末dist守卫最终exit0；两端实际末CSS有黑白主按钮/取消transform及不透明弹窗声明，构建完成后核产物。先前pnpm --only参数错误轮未计通过。上一6a36ce98 CI查询仍in_progress，不能计CI绿。
- 累计仍235有修复复验含部分/68已有防护不同/24待，不重复计R109。真实Caddy流程、完整327与原网关灾备仍未完成；本段保存后接MyHostConfigTab R110–113，R113后端已在写前拒绝类型不兼容而非返回warning，应纠正退役分支；R112原协议/路径/默认端口丢失、R111清空字段和R110重复/父刷新边界继续。不发行/生产/客户操作。

## 2026-10-30 R1-108 与 R1-109 读取段落：Caddy 状态和站点分页

- 实际Chrome先红：启用status后watcher与reader重复请求sites两次。现仅当前status成功触发一次；status/sites独立序号、固定host/account/role/sid/同步代次、KeepAlive/卸载隔离。换页同步清旧页及invalidate，缩页自动重读最后合法页；合法total=0/totalPages=0保持空态，显示页数归一到1。strict结构/行/页与persistent实际retry、refresh失败保当前确认内容，不把未知/失败冒充未启用或空列表，初读未确认禁止四操作。
- final-clean52087受控真实Vue/Chrome完整通过后供inspect；定向停止自己的serve后，final-exit95846正常exit0：36旧status/sites回执、9坏status/14坏sites、实际retry/零写/反序/disable/last-good/page ABA/缩页/合法零/same sid、三语1440/768/390真实prev-next与44px全部通过。HMR旧轮、端口冲突和停止serve均不计自然通过。
- build62979双端含两端vue-tsc最终exit0，末dist守卫exit0；末route/i18n/host-route-id三守卫16413（logs/test-run-20261030-052536）exit0。client目录最后组件ESLint零错警/脚本syntax/diff和manifest194常规202专项有效，CI登记。根目录lint配置错误和错误输出路径轮不计通过；已按client目录重跑。
- taste沿Achromatic ledger seed242843060，无重抽；局部none阴影/13px辅助文字/对比/手机44px及focus/减少动效。终浅深三宽0FAIL/0WARN，12图已全看，critique7.2记录logs/host-caddy-reads-critique.md。允许no-title/no-hero/unused-canvas仅隔离子组件测试壳，不声称父页或命令弹窗整体完成；构造8站点、文档IP和example.test独立夹具，无真实凭据。
- 四操作generate/reset/confirm/test及copy旧回执、共用锁/命令展示代次仍下一段；原Caddy后端保持，未实际Linux安装/客户/生产/完整套验证。本次两编号新增读取记录，累计235有修复复验（含部分）/68已有防护不同/24待；235含未完项，完整327和网关灾备继续。按owner授权阶段commit/push后接R109操作，不发行/OTA。

## 2026-10-30 R1-106/107 宿主镜像策略初读与保存回执

- R104后端40923e7d已push核远端一致。清单106/107实际为HostImagesTab镜像策略，纠正初续“自动快照策略”的误认。真实Chrome先红：初读失败后savePolicy仍发出默认策略PUT；现policyReady/错误状态门禁，读取序号、固定host/account/role/sid/同步代次、KeepAlive/卸载隔离、初读失败持久retry与refresh失败保最后确认内容。未确认架构/类型不显示默认x86或container，strict policy检查合法集合/类型/目标。
- 保存固定提交useDefault/镜像集合及draft同步代次，全局原在途锁保到finally，当前保存拒refresh/模式/镜像变化/重复写；换host及缓存返回可读新目标但原写锁保留。save使用真实PUT返回的完整策略，不再追加会覆新草稿的GET；严格成功/目标/集合/message，旧成功失败/draft ABA不toast/改新内容。保存失败保原草稿与持久错误，实际保存按钮可retry；合法default空镜像集合保持可保存。不改后端白名单资格/创建交付/管理员权限逻辑。
- final-no-hmr20553最终exit0：真实Vue/Chrome两读反序、36旧read/write host/session/ABA/cache/unmount回执、14非法policy和DOM retry/last-good、保存锁/固定payload/实际失败retry/四坏write/draft ABA、缓存返回锁、same sid/default空、三语三宽实际模式/镜像/搜索/save及44px/零横溢通过。host ABA夹具改为两个实际渲染目标；同tick父值未渲染的变化不冒充已切页面。最初CDP代理数组序列化断言改为展开，HMR打断轮/port冲突/终止serve不计通过。
- client types5080、最后三守卫81712（logs/test-run-20261030-051503）、组件ESLint零错警、清单194常规201专项/语法/diff通过；最后双端build32077含两端vue-tsc最终exit0，末dist守卫exit0，两端末btn-primary黑白!important产物验证通过（首次CSS断言误期待父scope，已据实际Vue产物纠正）。专项登记server/EXCLUDED/CI，当前CI另核，未全套/真实账户或宿主写。
- taste沿Achromatic ledger seed242843060，无重抽；局部去全局重阴影、13px辅助字/对比、选中黑白与保存按钮真实黑白、44px/focus/aria-pressed/busy及减少动效。终浅深1440/768/3900 FAIL/1 WARN，全部12图已看，critique7.4见logs/host-images-critique.md；WARN短夹具3镜像的desktop页尾留白，不为填空添加假镜像、不当完整父页密度通过；静态0FAIL/1WARN为主动shadow:none声明。before2FAIL/3WARN及中途紫色保存按钮已修。
- 原后端saveHostAllowedImages并发写/当前授权及独立审计原子性另待代码级精修；不能把受控前端回执说成后端权限和生产验收。两编号分别新增修复复验记录，累计233有修复复验（含部分）/68已有防护不同/26待，233内部仍未完成；完整327/网关灾备继续。阶段提交推送后接R108/109 Caddy读取及操作生命周期，未生产/发行/客户操作。

## 2026-10-30 R1-104 宿主批量延期事务与当前授权（后端段落）

- 真实Fastify/PG先红：第二实例到期写失败后第一实例已延期。现按实例ID顺序持有billing lane、操作advisory与行锁，宿主共享锁和账户统一排序锁内复核当前管理员/会话、实例归属/宿主/Incus身份/套餐及清理、转移、快照和反代任务；重读最新到期时间后统一事务延期、version递增、批次审计和每位用户一条站内信。保留原expiry+days语义、手动/到期封停及全部无关字段，不新增收费、退款或余额记录。
- 外部通知复用已提交站内信，并检查真实failed返回值；外部发送失败有日志而延期仍成功。未知数据库错误不承诺没有变更，提示先核对到期时间与操作日志再决定重试。批次目标固定为读取时的付费实例集合；请求结果丢失后的跨请求幂等及外部Bot投递可靠性仍待，不能把事务回滚解释为所有重试都安全。
- takeover-host-extend-all-before真实故障先红，final-r4 session28564最终exit0：第二expiry/审计/第二inbox故障全部回滚及故障移除后仅延期一次、真实pg_blocking_pids到期竞争、九类身份/管理员降权封禁注销等待竞争、七类任务就绪前后竞争、第二实例advisory冲突、原封停/过期基准、六并发整批累加、真实付费续费lane/单次扣款与旧version拒绝、外部email失败零网络且已提交结果/站内信去重、365/八非法输入/零目标及免费删除无到期筛选通过。管理员仍可给其他owner的宿主延期。
- 原gift-days完整真实PG回归69268最终exit0；server build53341含tsc/独立专项types40538均最终exit0；四相关守卫46039最终4/4通过（logs/test-run-20261030-045636），清单194常规200专项分类有效。新helper/专项/守卫ESLint68047零错警。扩展至两个旧文件lint发现原有notifier1504无用转义及hosts九未用catch警告，已核HEAD存在，不计全文件lint通过；根lint只检查client。首次运行旧PG缺auto_snapshot_operations、错误--only分隔方式及错误lint配置的失败轮均保留且不算通过。
- 新建独立本地数据库并应用全部仓库迁移；旧PG及旧库保留，不触及生产或三台远端机器。新专项登记server/EXCLUDED/CI；本段无前端变更沿fcf775e4双端构建，CI另核，未全套/生产/Incus交付验证。R104分阶段不重复计数，仍231有修复复验（含部分）/68已有防护不同/28待；完整327、其中部分项和网关灾备未完成。阶段验证完成后按owner授权立即commit/push，再接R106/R107策略初读与保存竞争。

## 2026-10-30 R1-104 延期整数与当前表单（部分精修）

- R103已commit/push `ad28746a47a358cab3e8727f4ed600f59845afa9`核远端一致。R104前端只允许1–365 safe integer，固定提交host/days/route/session及表单同步代次，复用六操作原在途门禁/读写隔离，旧route/session/dialog/draft ABA/cache/unmount回执不通知或关新表单。输入/关闭/重复确认在途锁住，失败持久保留弹窗与实际retry；success/count/message严格，合法零保持零。
- 原paidInstanceCount永远0却显示会延期0台，改三语说明只声明实际有到期时间的付费实例；没有伪造预检数量，不改后端筛选、续费/客户网络或退款。黑白平实表单/44px控件、真实label、dialog与aria-busy，无新增确认词。现有后端逐条写/中途失败通用错误、通知提交后失败仍待下一段，前端严格回执不能替代后端幂等和部分结果。
- before95643实际Chrome小数1.5仍发请求先红exit1；final-verified62401最终exit0：七坏days零写、24旧回执、交叉操作原锁、严格坏回执/正常same sid及三语三宽DOM输入/确认/失败retry。R103回归19495最终exit0，132旧回执与实际按钮通过。双端build87502含两端vue-tsc最终exit0，最后dist-final和两端CSS/翻译markerexit0，无待poll；末三守卫55374、ESLint17288、语法/diff/清单通过。初lint属性顺序warn已纠正，未计初轮零警告。
- taste沿Achromatic ledger seed242843060，无重抽；浅深1440/768/390全部12图已查看，0FAIL/WARN，局部critique7.2见logs/host-detail-extend-critique.md；静态0FAIL/10WARN为原URL mono及主动none声明。不当真实宿主或正常子标签密度证据。新专项已登记server/EXCLUDED/CI，194常规199专项合法。阶段计231有修复/复验（含部分）/68已有不同/28待，231内部仍有未完成范围；R104后端/完整327/网关灾备持续未完，无发行/生产/客户写。

## 2026-10-30 R1-103 宿主详情操作与删除准备绑定当前页面

- test/verify/删除前实例计数/确认删除/regenerate/verifyAfter共用在途门禁，固定host、route fullPath、account/role/sid与同步代次。切宿主/会话ABA、缓存离页、卸载及弹窗/草稿ABA后旧success/catch不通知、不导航、不写当前命令/验证态、不触发当前读；原锁保留至原请求finally结束。当前写使旧读失效，当前写期间暂停读取，旧目标写不阻止新目标/缓存返回读取。正常同sid刷新与两端详情入口保持。
- 删除准备拒缺失/非法total，不把失败当0；test/verify仅严格success:true，生成命令严格类型/非空/长度，delete按真实后端message核验，修正两端API的void声明。失败就地持久显示，删除失败保留确认及原按钮重试，在途关闭/字段/重复点击锁住；重装false退出验证中可重试。沿taste黑白/13px手机辅助文字/44px按钮、深浅红对比/无blur，繁体补真实「操作失敗」。没有后端业务、客户实例/全端口/IPv6规则修改。
- before实际Chrome重复test=2先红；final-all-locale session69744最终exit0：132旧回执、六写交叉/重复门禁、合法false/坏回执、计数与名称确认、cache锁/同sid/管理员入口、读写反序，三语三宽实际测试与重装/删除按钮/失败retry通过。末脚本误await未释放loadHost和同tick input+disabled button点击的失败轮均已修正，不算通过。R102读取20旧回执37547、R105复制30旧回执74101最终exit0。
- client类型45973、最后三守卫/ESLint、194常规198专项清单与脚本语法/diff通过；专项登记server/EXCLUDED/CI。最终双端build-final-translation33532含两端vue-tsc最终exit0，末dist-final及两端CSS/繁体产物检查exit0，无待poll。早先在样式编辑中开始构建使user漏末CSS标记，已重建并最后核对，不算失败轮产物通过。taste沿Achromatic ledger seed242843060，无重抽；浅深三宽12终图全部看0 FAIL/1 WARN，hero-void为父页面空子标签夹具；删除两主题手机与深色重装末图0 FAIL/WARN，末三语九图已看，critique7.2见logs/host-detail-actions-critique.md。静态0 FAIL/7 WARN为真实URL mono与主动none声明，不当整页零警告证据。
- R102666e6089远端一致；阶段保存后230有修复/复验（含部分）/68已有防护不同/29待。仍含部分未完、跨浏览器/后端请求幂等、真实宿主执行/完整327及网关灾备未验，不发行/生产/客户操作。R104前端整数与固定输入/操作回执、后端extend-all逐条成功后中断通用错误仍待；实际route/计费lane、gift-days授权及相应守卫已读，不机械宣称原回执存在failedCount。

## 2026-10-30 R1-102 宿主详情读取不能覆盖当前路由

- 实际Chrome先红A旧读取覆盖已返回的B。详情get现独立序号并固定route fullPath/account/role/sid/同步代次，切路由/账户ABA、缓存离页与卸载立即清旧host/弹窗/命令；旧success/catch/finally不写当前数据、不跳走、不释放当前loader。初读/缓存返回避免重复，same sid正常刷新保持当前读取；严格正safe integer路由和返回host目标/必需字段，坏回执可实际重试。
- 初读失败持久留在页面、不router.replace；同目标refresh失败保最后成功host。错误状态平实黑白，提供标题/唯一实际重试/返回，手机retry44px，减少动态效果时停止壳入口动画。后端get权限与客户实例/IPv6/一机一卖保持。R103操作回执仍待，不将本次读取修复说成整页全部操作已验收。
- reads-before旧11覆盖12先红。final-verified12423最终exit0：真实父页面20旧成功/失败回执、同页反序/旧finally、10坏回执及DOM retry、五坏ID零GET、same sid/cache重读/三语三宽通过。R105复制完整30旧回执回归2729最终exit0，缓存/管理员入口夹具补等待当前read完成；先前夹具未回新读取引发resolve undefined已纠正。最初TS union错误已改unknown与实际类型守卫，不计失败轮通过。
- 最终双端build29414含两端vue-tsc与末dist均exit0、最终route/i18n与lint42037通过、脚本语法/diff/manifest194常规197专项有效，产物两端包含host-read-empty及错误重试。专项已登记server/EXCLUDED_FROM_SUITE/CI。taste沿Achromatic ledger seed242843060，终浅深三宽0 FAIL/1 WARN，12图全部看/critique7.2；hero-void为未加载数据后的空白，不填假数据，不宣称完整正常详情密度通过。
- b71fd666已push核远端；R0980c39fb6e CI现success，后续CI另核。阶段保存后229有修复/复验（含部分）/68已有防护或不同/30待；其中部分项/真实宿主写/完整327/灾备仍未完成。未发行/生产/客户操作，PG55438保留。下一R103宿主test/verify/delete/regenerate/verifyAfter回执与在途操作，再R104延期整数/真实部分执行链路。

## 2026-10-30 R1-105 重装命令复制等待与当前弹窗回执

- 实际Chrome先红：剪贴板Promise未完成已有成功toast。现await完成才成功，在途锁、disabled/aria-busy，权限拒绝/不支持/同步throw就地三语错误、实际按钮可重试；绑定原宿主、两端详情路由、account/role/sid、命令/弹窗同步代次、KeepAlive与卸载。host/route/session/command/dialog ABA拒旧成功和失败，同sid刷新保当前复制。
- 离开宿主、换账户、缓存离页、卸载及显式关闭清空敏感命令/关闭弹窗；原在途复制锁保到原请求finally结束，避免缓存返回重复提交。这里只修复制与命令清理，生成安装/验证回执及宿主详情读取仍归R102/R103；未执行重装、DD或真实宿主写。
- final-verified session79993最终exit0：真实MyHostDetailView实际按钮、30组旧回执、重复/失败retry、三语三宽、缓存锁/敏感命令清空、管理员路由与same sid通过，零系统剪贴板写，DISPLAY-ONLY文案。--serve11104已核命令定向停止，终止不计通过；早期缺44px和动画过渡中间态已修，失败轮不计通过。
- taste沿Achromatic ledger seed242843060，局部平实弹窗、去渐变/blur/按钮阴影、44px控件/13px手机文字/可访问名称及dialog语义；浅深三宽最后0 FAIL/1 WARN，共12终图全部查看。hero-void来自背后未挂子标签的父页面夹具，不当整页密度证据，无allow；评审logs/host-detail-copy-critique.md，局部7.2。静态0 FAIL/1 WARN为原真实URL mono；整页UI与真实重装流程另验。
- frontend route/i18n、host-pool守卫、client type-check86416、末lint99784、语法/diff/manifest194常规196专项有效；最终双端build-verified34915含两端vue-tsc与末dist均最终exit0，无待poll，产物含最后局部控件样式/命令清理。新专项已登记server/EXCLUDED_FROM_SUITE/CI。R09968807cb6已push且核远端，当前CI仍另核；阶段保存后228有修复/复验（含部分）、68已有防护/实现不同、31待精修，部分项真实运行/完整327/灾备仍未完成。PG55438保留，未发行/生产/客户操作；下一R104延期整数与部分失败统计，当前extend-all后端未返回failedCount，不机械套入旧清单描述，需沿实际部分执行失败链路审查。

## 2026-10-30 R1-099 宿主四类操作绑定当前目标

- 升级、生成安装命令、资源校对及IPv6同步固定原host/account/role/sid/同步代次与生命周期；切宿主、会话ABA、缓存离页和卸载后旧成功/失败不通知、不刷新、不写当前Agent或安装命令。四写共享在途门禁，缓存返回保留原锁至原请求结束；当前失败就地持久显示并支持原按钮重试。
- 严格检查四类回执的目标、类型及合法值，保留合法false结果。安装开始清旧命令并使旧Agent读取失效，成功安装结果不被旧读取覆盖；当前安装期间暂停该目标读取，旧目标安装不阻止新宿主或缓存返回读取。未改后端权限、执行/资源校对/客户IPv6、一机一卖与配额规则。
- mutations-before实际Chrome先红：A升级后切B仍显示旧成功。final-verified session51058最终exit0：四写72组旧成功/失败回执、冲突重复锁、非法回执/失败重试/合法false、确认时换账号、安装旧读覆盖、缓存返回锁及同sid通过；三语1440/768/390实际资源校对按钮/错误文字无横溢。--serve11624已核命令定向停止，其终止不作专项通过证据。
- R098读取回归18667、R100复制回归37912、client类型21927、ESLint39706、最终双端build含vue-tsc97899均最终exit0；frontend route/i18n、Agent auth/version/route-id/install-command/redaction与host-pool守卫、末dist、语法/diff/manifest分类通过。日志takeover-host-info-mutations-*；新专项已登记server/EXCLUDED_FROM_SUITE/CI，当前提交CI另核，不提前声称通过。
- taste沿Achromatic ledger seed242843060；浅深三宽最终各0 FAIL/0 WARN，12终图全部查看，评审logs/host-info-mutations-critique.md，局部评分7.2。仅受控API、DISPLAY-ONLY命令与文档网段，无真实宿主写或真实token。阶段保存后227有修复/复验（含部分）、68已有防护/实现不同、32待精修；真实宿主执行、其中部分项完整验收、完整327与网关灾备仍未完成。未发行/生产/客户操作，PG55438保留。下一R105重新安装命令复制，再续R102–104宿主详情。

## 2026-10-30 R1-100 安装命令复制确认真实完成

- 实际Chrome先红：clipboard Promise未完成已显示成功。现await完成，捕捉拒绝、不支持及同步throw；在途重复门禁，按钮disabled/aria-busy，失败三语持久提示并可实际按钮重试。绑定原host/session/生命周期及command/expiry同步代次，命令或账户ABA拒旧成功/失败，缓存离页清原命令；同sid刷新保当前复制。
- copy-final-verified实际Vue/Chrome24旧回执、延迟成功、重复、失败/不支持/同步throw/实际retry、同sid及三语三宽/390触摸高度通过，session1129最终exit0；仅DISPLAY-ONLY文字/模拟剪贴板，不生成、展示或复制真实token，零系统剪贴板写。最后双端build-last session9987与末dist均exit0，无待poll，--serve进程17700已定向停止。早期尺寸测试API名称错误已改为已有setViewport，不计失败轮通过。
- client type-check、frontend route/i18n、Agent install-command守卫、ESLint无错警、R098三读完整回归、语法/manifest/CI分类通过。taste沿Achromatic ledger seed242843060黑白方向，初截图平板复制按钮被说明挤成两行，改shrink-0/nowrap；最终浅深三宽各0FAIL/0WARN，全部12终图已看，评审logs/host-info-copy-critique.md，static仍32既有WARN，不代表整页UI完成。
- R098已push0c39fb6e并核远端。阶段保存后226有修复/复验含部分、68已有不同、33待；R099四写回执、真实宿主/系统剪贴板/完整327及网关灾备继续，未发行/生产/客户操作，PG55438保留。

## 2026-10-30 R1-098 宿主信息读取与轮询绑定当前页面

- 真实Chrome先红旧读2覆盖新读3。实例配额、流量历史、Agent状态现各自使用读取序号，并绑定宿主ID、账户/role/sid、同步代次及页面活动状态；切宿主、账户、缓存离页和卸载立即清旧数据及安装命令、停止轮询。已排队旧轮询拒读；当前自动轮询不与未完成读取重叠。同sid正常刷新token保持当前请求。
- takeover-host-info-reads-final-complete真实Vue/Chrome覆盖三类反序、18组宿主/账户/ABA/cache/unmount旧成功失败回执与旧排队轮询、缓存返回三读、18种非法响应与实际retry、失败refresh保留最后成功值；session70734已确认最终exit0。三块错误持久显示、不以读取失败假报零资源/空历史或未安装；重试按钮手机44px、focus和长错误换行保留。
- client type-check、frontend route/i18n、host-pool守卫、ESLint无错警、脚本语法及manifest分类通过；双端最终build含vue-tsc（session93189）最终exit0，最终dist守卫exit0，无待poll。此前final-2夹具ABA失败和初轮TS接口instances缺声明错误已修，未计初轮通过。R101异常metric回归已通过。
- taste沿R101 Achromatic ledger seed242843060，未重抽方向；最终浅深1440/768/390全部12图已看，0 FAIL/1 WARN：初读失败时资源卡与基本信息卡保持同排高度，空白用于避免状态切换移动邻块，未隐藏数据或豁免检测。浅色错误文字4.4:1已改为较深红通过；static仍32既有WARN，同R101，不声称整体UI零警告。
- af7d42e1已push核远端。本项阶段保存后225有修复/复验含部分、68已有不同、34待；R099写回执、R100复制和真实宿主/完整327/网关灾备仍待。仅源码与隔离组件受控读取证据，未发行/生产/客户操作；PG55438保留。

## 2026-10-30 R1-101 宿主监控异常指标安全渲染

- 实际Vue/Chrome先红value.toFixed is not a function；后端HMAC报告保留原始resources/metrics，旧记录字段并非TS保证。仅在HostInfoTab显示前检查object容器与数值类型/有限/非负，未测量为-、进度空；真实0%/0负载/0m/0核心保持零，合法超过100%的标值保留、bar限定100%，不改后端上报/客户行为。
- host-info-metrics-final-6真实组件：12非法标量、坏容器、零/缺失/正常数值、心跳间隔默认与120秒、三语三宽/零业务写通过。frontend route/i18n及host-pool守卫通过；最终ESLint无错警，早期新增wrapper缩进警告已移除并保留原三root。显式resources/metrics声明修复初轮type错误；最后双端build-final-2含vue-tsc已poll95557 exit0、末dist守卫exit0，无待poll。
- taste Achromatic ledger seed242843060沿现有品牌字体，局部文字对比/13px、44px触摸/focus、tabular figures、去静态阴影/紫色/渐变。浅深1440/768/390 final-2各fold/page全部12图已看，0 FAIL/0 WARN，无allow；静态taste lint无FAIL、32既有mono/过渡/loading/scoped-shadow与tooltip WARN单独记录，不声称零警告。夹具使用虚构测试宿主与计算合计4096B流量，不是账户整页或真实宿主验收。
- fc154113已push核远端；本项阶段保存后224有修复/复验含部分、68已有不同、35待。下一R098三读/轮询反序实际先红2覆盖3，专项暂留未登记不纳本项；R099/100操作和复制待后续。未发行/生产/客户操作，PG55438保留。

## 2026-10-30 R1-097 合并并发 Agent 发行缓存空缺

- 实际Fastify/HMAC/PG受控并发先红：20个public manifest请求发出20次相同metadata查询。现未完成的manifest刷新由同一Promise共享；二进制按version/name/小写SHA共享在途下载，成功/失败/null均finally释放对应任务，SHA验证后才进入原缓存。保留可信URL、64MiB限制、双架构完整性、原5分钟缓存与stale/限流重试。
- takeover-agent-release-concurrency-final-2本地真实路由：20 manifest＋7 HMAC心跳共用响应头/正文卡顿查询、两架构各hash一次；连续心跳1秒截止后共用后台刷新、后来升级SHA正确。metadata/checksum失败、缺架构、过期stale60秒再刷新、429共享重试通过。24 binary exact/latest/大写SHA共享header/body下载；五类失败（HTTP/错误hash/无body/网络/正文中断）16等待者拒绝并共享后续重试；5组version/name/hash各8并发保持隔离，错误query零上游请求。
- final-2专项、types-final、7 Agent守卫、server build含tsc及R096三stall回归均已poll最终exit0，无待poll。初专项TS四个隐式any已通过明确FastifyInstance修正，未计初轮TS通过。manifest194常规191专项、CI登记、diff审查通过；前端未改沿R080双端build/dist。后台去重依赖项目唯一后端不变量，不支持多进程缓存协同。
- 743ff1a0已push核远端；本项阶段保存后223有修复/复验含部分、68已有不同、36待。真实Go/Linux宿主、真实GitHub故障与完整327/灾备尚未全面验收，未发行/生产/客户操作。下一R098–101宿主信息页read/poll、操作回执/复制及非法metric边界，源码已读，PG55438保留。

## 2026-10-30 R1-096 心跳可选升级查询等待上限

- 外部升级metadata响应头、metadata正文或二进制checksum正文卡住时，原心跳会等待15秒外部截止及重试，超过Go默认10秒请求期限。现仅为可选升级信息等待最多1秒，超时/查询失败返回available:false；后台查询保留原截止、重试和SHA校验，后续心跳仍可获得完整升级信息。
- takeover-agent-upgrade-deadline-before实际HMAC/本地PG先红exit1；final三种受控卡顿均在1.7秒测试窗口内返回200、记录online，释放卡顿后收到正确SHA升级，exit0。7对应Agent守卫、R094完整旧身份/五真实锁竞争/7并发/nonce回归、专项types、server build含tsc均最终exit0（48375/43414已poll）。manifest194常规190专项与CI分类通过，diff已审。
- 本项1秒仅限制可选升级等待，不承诺整个心跳所有DB写入均1秒，也不取消共享后台查询。源码及本地隔离API证据；真实Go/Linux宿主、GitHub慢网络、完整327及灾备仍未全面验收，未发行/改生产/操作客户。前端未改，沿R080双端build/dist。
- 136eb897已push核远端；本项阶段保存后222有修复/复验含部分、68已有不同、37待。下一R097合并并发metadata和相同版本/name/hash二进制下载，继续保留SHA/可信URL/双架构和失败重试。PG55438保留。

## 2026-10-30 R1-094 心跳提交复核当前 Agent 身份

- 实际HMAC/nonce通过后禁用Agent，旧heartbeat仍200并标online先红。现协议确认、实例状态、流量事务及最后heartbeat逐次复核当前Agent id/host/secret/enabled/status并持行锁；锁序host→Agent与凭据轮换一致，写目标预先用UPDATE避免并发锁升级死锁。仅数据库监控报告，不改客户转发/全端口/实例运行状态业务或重建身份。
- takeover-agent-heartbeat-current-final-5实际Fastify/HMAC/PG：disabled/status-disabled/轮换/同ID换secret四种旧认证拒绝且记录保持；五个pg_blocking_pids实测等待（协议/实例/流量/心跳host锁及直接Agent锁）禁用先提交后拒旧写。已先合法提交的报告保留，后续拒写不伪装整包回滚；7并发完整报告、正常protocol/status/snapshot和nonce重放通过exit0。首次夹具nonce代理未触发、BigInt序列化错误均已修，不计产品先红。
- 7对应Agent常规守卫全部通过；原credential/权限/7并发/token/nonce回滚及R093格式重试回归exit0。server build-final含tsc与专项types最终exit0，diff/manifest194常规189专项分类与CI登记通过。前端没变沿R080最终双端build/dist；真实Go/Linux宿主及生产另验，未发行或操作客户。
- 160b90ed已push核远端；本项阶段保存后221有修复/复验含部分、68已有不同、38待。下一R096/R097元数据/二进制cache miss与心跳截止已读源码/版本守卫，尚未修改。PG55438保留。

## 2026-10-30 R1-093 安装令牌拒绝无效 Agent 密钥

- R092已先完成解密/hash与消费同事务，本项仍缺格式验证。追加真实Fastify/PG安装配置接口先红：格式无效但hash匹配仍200且消费token。现消费前复用Agent secret格式校验并拒前后空白，失败403、完整Agent记录与token保持；不放宽现有格式或替换原管理身份。
- takeover-agent-secret-final真实本地PG六非法格式（空/短/越界/非法字符/尾换行）、恢复原密文后同token合法重试、no-store/重复403、32/96合法边界及原7并发签发/一次消费/权限撤销/nonce和token回滚全部exit0。Agent认证/install-command/redaction三守卫exit0，server build含tsc、独立server type-check、专项TS/diff通过，无待poll。尝试server ESLint无eslint.config，未计通过；已有types/守卫/代码审查覆盖本次3行变更。
- 仅源码与隔离API/PG证据，不是Go安装、真实宿主或生产验收；前端未改，沿R080最终双端build/dist。ea539e25已push核远端，本项保存后220有修复/复验含部分、68已有不同、39待；继续R094心跳认证后禁用窗口。没有发行/生产/真实账户或通知操作。

## 2026-10-30 R1-080 Telegram 绑定页当前状态与操作隔离

- 真实Chrome重复生成先红2请求；本轮追加实际checkbox失败后显示反向、保存后旧刷新覆盖两个先红回归。读取绑定account/role/sid/同步代次/序号及cache/unmount，三写共享busy、固定绑定目标和独立目标代次，A→B→A也不得重新接受旧回执；同sid刷新保持当前请求。通知仅在确认回执后显示新值，失败保留原值和三语持久错误/重试。
- 严格核验绑定状态、写message/通知bool及HTTPS当前bot唯一start参数和期限；链接过期/账户/目标/离页清理，旧复制完成不通知。telegram-profile最终56旧读写、三个目标ABA、读写反序/缓存返回锁/交叉提交/非法回执/实际三个控件和retry/过期均exit0。所有显示链接只用固定测试标记，无外部Telegram请求/通知或真实账户操作。
- taste沿现有黑白方向局部修按钮/阴影/文字对比/刷新防挤压/13px提示/手机44px与focus；浅深1440/768/390最终0 FAIL、0 WARN，全部实际截图已看。仅isolated组件允许no-title/no-hero/unused-canvas/hero-void（无整页壳、下方空白），不代表账户整页UI或外部Telegram绑定验收。
- 对应frontend三守卫、user-telegram-notify、auth-session-status、lint/脚本语法/diff/manifest194常规188专项分类与接CI通过；takeover-telegram-profile-build-final-2双端含vue-tsc最终exit0（6744已poll），最后dist守卫exit0，无待poll。b7697523已push核远端；本项阶段保存后219有修复/复验含部分、68已有不同、40待。下一R093无效Agent secret格式先红200已修，六非法/修复原token重试/两合法边界及原PG回归通过，独立提交；其修改不纳入R080。

## 2026-10-30 R1-078 登录历史当前页与账户隔离

- 真实Chrome第3页先回、第2页后回覆盖先红；读现绑定account/role/sid/同步代次/独立序号/选中页/cache/unmount。切页清旧页记录，同页失败保留当前已读记录；切账户离页清IP/设备/总数。分页缩减自动读当前有效末页，严格验证响应字段与记录，失败提供三语持久retry，不以空历史伪装读取失败。
- history-reads最终反序分页/同页refresh/缩页、14旧回执、十非法读/实际retry、same sid、演示记录隐藏/真实零空态/实际next按钮exit0；初末尾按钮断言硬写中文而locale被保留，测试改现三语key后final通过，产品未做特殊绕过。原11UA/devices回归exit0。五守卫/lint/语法/diff/manifest194常规187专项接CI有效、双端types build92523与末dist最终exit0，无待poll，三语三宽截图已看。
- 71f81c93已push核远端，218有修复/复验含部分/68已有不同/41待。原整体UI及真实账户另验；下一R080 TelegramBindingSection已读route/types/notify守卫，未改。客户/完整327/网关灾备未完成。

## 2026-10-29 R1-079 登录历史移动设备与浏览器识别

- 实际Chrome调用原组件先红Android被Linux抢先匹配；iPhone/iPad与Opera同类顺序问题修为移动设备优先、Opera/Edge/Firefox/Chrome先于Safari，补CriOS/FxiOS。不改变后端登录记录、IP隐藏规则、鉴权或分页，R078列表生命周期单独继续。
- read-only实际Vue/Chrome11个UA样本含Android/iPhone/iPad、Opera、桌面与iOS Chrome/Firefox/Edge通过exit0，三语三宽DOM与截图已看。5对应frontend/auth-session/demo守卫、lint/语法/diff/manifest194常规186专项接CI有效；双端types build55992及最后dist最终exit0，无待poll。仅设备识别精修，原深色低对比/整页UI与真实账户另验。
- b3ac8a57已push核远端，217含部分/68已有不同/42待；R078实际第3页先回、第2页后回覆盖已先红，新test-login-history-reads未完成留工作区，未加入本阶段。

## 2026-10-29 R1-075 SSH写操作与私钥展示生命周期

- 真实Chrome重复create先红2请求；三写现共用busy函数门禁，固定提交草稿/当前delete ID，严格确认message及create/generate key回执。旧account/role/sid/ABA/cache/unmount回执不得发通知、刷新新账户或展示私钥，旧在途锁在缓存返回后仍保持至完成；生成结果窗口未关闭前禁止再次生成覆盖。输入长度/当前库存/字段取消在途保护与三语持久失败提示已补。
- 生成私钥仅当前会话/展示代次可复制下载；关闭/换账户/缓存离页/卸载清字符串与计时器，撤销Blob URL、取消延后click并移除data URL链接，旧复制完成不标新结果已复制。测试只用展示标记，不生成/保存真实私钥，不将凭据放入截图或日志。
- ssh-key-submit最终三写冲突/重复、42旧回执、非法写回执、当前失败retry/same sid/后来草稿、已有私钥清理、两下载路径取消/Blob释放、缓存返回锁保持/释放、非法ID/输入/字段busy通过exit0。原list14旧读与dates回归exit0；四守卫/lint/语法/diff/manifest194常规185专项接CI过，双端types build69310及末dist最终exit0，无待poll，三宽三语截图已看。原整体UI低对比/紫色等仍未验收。
- 8debfe9c已push核远端，计数216有修复/复验含部分/68已有不同/43待。阶段保存后继续R078/079登录历史读取及UA识别，真实账户/外部私钥保存与完整327/灾备另验。

## 2026-10-29 R1-076 SSH列表当前会话与分页缩减

- 真实Chrome反序读先红：新请求返回key2后旧首读将其覆盖key1。现以账户/role/sid、同步代次、独立读取序号与KeepAlive/unmount活动状态保护；切换清列表/页码/草稿/已显示私钥，同sid刷新保留。合法列表缩减同步夹紧currentPage，非法/失败列表持久错误、失败refresh保留当前已验证列表，实际重试按钮与三语提示可操作。
- ssh-key-list最终反序、11→1分页、14旧回执/七非法读/实际retry/same sid/cache返回唯一读/三宽三语零写exit0，R077 dates回归exit0；实际最终截图均已看。四对应frontend/ssh-route守卫、lint/语法/diff/manifest194常规184专项及最终双端types build通过；初user包早于语言提示调整，15220补构建user最终exit0，核两包当前bool/inline三语提示，末dist守卫exit0，无待poll。
- 原样式紫色/阴影、深色低对比/删除触摸面积不属于本阶段整体UI验收。计数215含部分/68已有不同/44待。0afd7b22已push核远端；下一R075实际重复create已先红2次，脚本test-ssh-key-submit未完成只留工作区，不加入本阶段。真实账户、生成及外部私钥保存另验。

## 2026-10-29 销毁表格实例编号释义与长名称复验

- Owner追问名称下#1是否内部机器编号；实际destroy-info返回instance.id，与宿主host_id及Incus名称不同。单台与批量改为三语明确「实例编号：{id}」，保持原名称完整break-words换行/定宽区域列。机器池创建前缀API限制60字符，后续rename显示名称限制100；本次未改名称规则或销毁/验证接口。
- destroy-email-ui最终三语编号断言、中文/无空格英文/100位连续数字完整保留且弹窗/表格零横溢、原邮箱门禁/8旧发送回执/四旧销毁回执/重试/键盘通过exit0。batch-billing实际Chrome原续费/销毁生命周期与中文桌面/英文390长数字名称和明确编号全部exit0，未操作真实账户或实例。
- 对应route/i18n及额外public-callback三个守卫、26762条三语message compile、五个前端文件lint、两脚本语法/diff/manifest有效通过；双端build含vue-tsc最终exit0（99958已poll）及最后dist守卫exit0，无待poll。taste沿原黑白组件方向，浅/深三宽0 FAIL/0 WARN，全部截图及本地critique已看/留存；批量原统计布局等不属本次整体UI验收。
- R077已提交并推送2794bb58，远端main一致。此编号补充不重复计入原327清单，仍214有修复/复验（含部分）/68已有不同/45待；原R075/076、真实外部邮件/客户流程与完整网关灾备继续。

## 2026-10-29 R1-077 SSH 公钥创建日期字段

- 当前GET list/detail已明确返回createdAt，SSHKeysSection却读created_at；ssh-key-dates-before实际Vue/Chrome两条合法服务端日期都缺失先红。产品只改该span为createdAt || '—'，保持原ISO显示格式及sm以下隐藏日期的既有布局，不改真实密钥/list/生成/添加/删除和权限。
- ssh-key-dates-final两真实camelCase受控列表日期、三语1440/768/390零横溢且零key mutation通过exit0，最终截图全部已看；不是当前账户密钥验收。route/i18n/ssh-key-route-id三守卫、lint零错警/语法/diff、manifest194常规183专项接CI过；双端build含types最终exit0，接续已poll session21535确认结束，最终dist边界守卫exit0，无待poll。原整体UI紫色shadow/深色灰字/删除键触摸面积仍另待，不用小字段修复声明整页UI完成。
- 08ce5c2f已push核远端main一致，214有修复/复验（含部分）/68已有不同/45待；R075/76同组件session/busy/生成私钥生命周期继续，完整327/原生客户及网关灾备未完。阶段提交推送后继续。

## 2026-10-29 R1-071 头像保存保留本次提交与账户生命周期

- avatar-submit-before实际Chrome提交identicon、等待期间草稿改rings，旧实现把rings标已保存先红。现固定submittedStyle/userId/session代次；同turn重复/未登录/缓存停用/非法style拒写，选择字段与邮箱/折叠在途禁用。回执只更新该次style，不把后来的选择标保存；空message/旧session或卸载回执不写authStore，不假成功，失败持久avatarError保留重试。默认空style不误判修改。
- AccountSection详情读以session/seq/cache/unmount隔离并验证返回user.id，失败持久实际retry，返回只重读一次；session变化关闭邮箱弹窗/清详情及草稿，原ChangeEmailModal自身保护继续。avatar-submit-final3实际Vue/Chrome提交style后改草稿、重复/字段busy、14旧write与14旧read、same sid、非法写回执/详情、反序detail及实际DOM retry最终exit0；首轮测试把未释放模拟Promise返回给CDP造成timeout已修，产品未以延时绕过。
- 4对应route/i18n/auth-session/user-id守卫、lint零错警/语法/diff/manifest194常规182专项接CI已过；takeover-avatar-submit-build双端build含vue-tsc与dist最终exit0，无待poll，三宽三语截图已看/无横溢。真实UserAvatar保留，仅测试fixture将图片边界换本地SVG字母，无外部DiceBear/真实头像账户写入；整体原UI低对比/紫色shadow仍另验，不做全局改造。
- 5bd53976已push核远端；213有修复/复验（含部分）/68已有不同/46待，完整327/真实用户写入与网关灾备未完，阶段提交推送后继续原编号。

## 2026-10-29 R1-068 自动快照通知当前归属与名称复验

- 当前phase每阶段重读实例/宿主/策略、归属改变拒绝，最终事务日志与completed通知使用当前instance/host，原清单旧快照症状不再存在。本阶段不重复改产品；原auto-snapshot集成新增renamed_queued/owner_changed，真实PG与认证TLS远端边界检验。
- 排队后改实例/宿主名称：实际站内信data与content使用当前两名称、原snapshotName，唯一原owner通知，成功审计用当前实例名称。排队后改owner：blocked、零远端effect、双方零成功站内信/成功审计；恢复原owner后同一操作完成一次/仅原owner通知，原客户字段保持。第一轮因测试改owner的updatedAt未重建基线失败，修测试基线后takeover-snapshot-notification-current-final完整30条PASS且exit0；两守卫/独立test types/diff全部过，只改既有已分类专项，产品未变沿同源码build/types，不重复构建。
- 真实PG/站内信与mTLS替身不是外部Telegram/邮件或Linux磁盘验收，通知发送期间再次变化的边界另评。c31eebbe已push核远端，6e31/a171/2153 CI现success，其后三阶段仍in_progress。唯一212有修复/复验（含部分）/68已有不同/47待；整体327、原生快照及完整网关灾备未完。阶段提交推送后继续R071账户头像草稿，源码/用户route及守卫已读、尚未改。

## 2026-10-29 R1-062 快照有效读取与成功回执（部分）

- snapshot-receipts-before实际Chrome初读尚未完成已发创建先红。现两资源独立ready/error与读代次，valid GET列表/Boolean policy后才允许五类写；严格正整数/去重snapshot ID、实际incusName/Boolean stateful/时间/大小及四种间隔/持久operation回执。GET失败持久显示实际刷新按钮，未知配额/策略显示—且不误报暂无快照；原成功数据读取可达。按当前写receipt核非空message、create ID/name/description/Incus名、retry原UUID及operation shape，空错回执保草稿/error，不清列表或假成功；恢复retry必须两确认读取成功且无原operation才报恢复完成。
- client Snapshot类型与两API声明校正为现服务器实际camelCase/Boolean与create {message,snapshot}/delete/restore {message}，只改类型及消费检查，后端接口未改。第一次独立vue-tsc指出hasMessage类型谓词使交叉字段窄化，已改普通boolean并继续实际双端构建；不把第一次类型失败说成通过。
- receipts-final2实际Chrome16非法GET/22非法write与合法重试、ready门禁、持久DOM retry、失败未知空态及确认读失败零恢复success通过exit0。原session36旧读90旧写、submit25冲突16旧草稿、bool四间隔回归最终exit0。4守卫及最后route/i18n、lint零错警/语法/diff和manifest194常规181专项接CI有效；takeover-snapshot-receipts-build双端含vue-tsc最终exit0，user产物已核未知状态逻辑，dist边界最终exit0，无待poll。三宽三语最终error截图已看、无横溢；原阴影/低对比仍整体UI未验，不扩大样式重做。
- c0a20070已push核远端main一致；211含部分/68已有不同/48待不变，R062已覆盖本轮具体生命周期/互斥/草稿/回执，真实Linux流程与整体UI验收另待，不称全部327或网关灾备完成。阶段验证后独立commit/push并继续清单。

## 2026-10-29 R1-062 快照写入互斥与草稿回执（部分）

- snapshot-submit-before实际Chrome创建在途仍能删除，2次请求先红。五类变更create/delete/restore/policy/retry现共享同步busy；模板字段、开关、取消/关闭及另开表单在途禁用，函数也拒绝冲突。提交固定policy对象副本与snapshot/operation原始ID，回执绑定同步草稿与两弹窗版本（含编辑/开关ABA），旧成功失败不清新草稿、不关新弹窗、不提示或启动后续读取；失败保留可重试。loadPolicy在写入busy期间不覆盖form或使当前提交失效，之后重新打开策略用实际policy回填。
- takeover-snapshot-submit-final3实际Vue/Chrome25冲突组合、16旧草稿成功失败/编辑ABA/弹窗ABA/另开弹窗、调用者改policy对象、源快照ID变化、后台策略读取与当前失败成功重试通过exit0；包含最后retry刷新后owns检查收紧。原snapshot-session36旧读90旧写回归exit0，原bool读取四间隔回归exit0，三宽三语busy截图已看/无水平溢出；受控API无原生快照写入。4守卫及最后route/i18n两回归、lint零错警/语法/diff/manifest194常规180专项接CI通过；takeover-snapshot-submit-build双端含vue-tsc与dist最终exit0，无待poll，核user构建包含最终owns逻辑。
- 5382dfad已push且核远端main一致。唯一211含部分/68已有不同/48待不变；严格GET/成功回执、ready加载门禁、原样式整体UI与真实Linux快照另续，当前不称全部R062验收，完整327/灾备未完。按Owner授权本阶段独立commit/push后继续。

## 2026-10-29 R1-062 快照会话与缓存生命周期隔离（部分）

- snapshot-session-before实际Chrome更换sid后仍保留旧私密草稿先红。SnapshotManager现以账户/role/有效sid（旧token用完整身份）及实例代次判定当前回执；同sid正常token刷新保留。同步context变化、KeepAlive停用及卸载清列表/策略/错误/两弹窗和草稿，返回只重新读取一次两资源；无会话、非法实例及未激活不读写。已发出的每类写请求不在context切换时提前解busy，原finally只释放该类在途操作。
- takeover-snapshot-session-final实际Vue/Chrome36旧读取与90旧写入成功/失败回执覆盖sid/account/role/logout/target及两种ABA/cache/unmount，无旧数据/错误/提示/草稿污染；五类在途跨实例保持busy直到settle可重试，同sid合法保存与缓存返回重读通过exit0。布尔策略原完整回归takeover-snapshot-session-bool-regression exit0，三宽三语截图已看、无水平溢出。受控API没有真实Incus/策略写入；只是生命周期修复，草稿编辑/开关ABA、各写操作全局互斥、严格读取与成功回执下一段继续，不声称R062完整完成。
- snapshot-route/frontend-route/i18n/auth-session四守卫、lint零错警、脚本语法/diff通过，专项已分类到manifest194常规179专项与接CI。takeover-snapshot-session-build双端build含vue-tsc与dist边界最终exit0，无待poll；截图保留原渐变/紫色按钮/深色低对比问题，未做样式变更或整体taste验收。没有新增设计方向/素材；真实宿主与完整327/灾备另验。
- 唯一211有修复/复验记录（含部分）/68已有防护或实现不同/48待精修，R062只新增一次记录。3a248d7a已push核远端；a088/c23 CI success，后续几批仍in_progress。阶段完成对应检查后按Owner授权提交推送并继续R062下一段，不发行或操作生产。

## 2026-10-29 R1-063/R1-064 快照变更当前授权与恢复锁复验

- 当前四条快照写路由已走withSnapshotMutation，事务中重读实例归属/位置、账户status/sid/当前管理员role及转移/在途工作；删除/恢复重读源快照、恢复重核stopped，锁覆盖远端effect。原静态待核结论过时，本阶段不重复改产品。
- 新snapshot-mutation-authorization真实Fastify/PG四操作(create/delete/restore/policy)×封禁/撤销sid/管理员降权/归属变化/进行中转移共20竞态：以pg_blocking_pids确认请求真正等待对应写锁，之后旧请求403/409、零认证TLS远端写，快照及策略保持。另两源快照incusName替换及恢复前running拒旧目标；真实PUT恢复在TLS边界悬挂时，DELETE同源409且源快照存在。合法四操作对照实际执行通过，完整专项exit0。
- takeover-snapshot-mutation-authorization及3对应snapshot/auth-session/auto-policy守卫、独立测试TS检查exit0，diff/manifest194常规178专项有效并接CI，无待poll。仅新增测试，沿同产品2153阶段server types/build与前端已有构建；测试机证书/数据自行清理，未操作原生客户磁盘。HTTP鉴权只用隔离header建立actor，写入实际数据库授权/锁没有替换；不是全链真实网页登录或Linux快照验收。
- 唯一210有修复/复验记录（含部分）/68已有防护或实现不同/49待精修，R063/R064指定后端症状补实证；R062前端会话/草稿/busy/卸载仍待，不混计。75ebd77f已push核远端，a08895d1/c23c6a7e CI现全部success，之后仍in_progress。阶段提交推送后继续R062，完整327/原生宿主及网关灾备未完。

## 2026-10-29 R1-067 失败恢复保留新排程复验

- 旧updateSnapshotPolicyLastRun只有定义，没有当前scheduler或其它源码消费者。当前auto-snapshot-operations失败只写attemptId约束的操作error/nextRetryAt及审计，不写snapshotPolicy，成功finalize才在实例/策略锁内读取当前间隔更新。本阶段按实际路径补验证，不机械改无调用旧函数。
- 原真实PG/mTLS集成追加new_schedule_failure/disabled_schedule_failure：旧排队操作已发生远端create，随后改成1440分钟未来新排程或关闭且nextRunAt=null，远端报告仍在处理导致当前attempt失败。完整policy（enabled/interval/last/next时间）保持逐字段相同，零追加远端写；之后原身份恢复仅重试同一操作。takeover-snapshot-failure-schedule-final完整28条PASS且exit0，覆盖原杀进程/禁用/过期/失败/锁与新增两反例。
- 两对应auto-policy/snapshot守卫与独立集成TS类型检查exit0，diff通过；只改已登记专项测试，无产品变更，沿用2153阶段server类型/build及前端已过构建，不重复编译或新加manifest项。Incus为认证TLS边界替身，原生磁盘/真实宿主及成功恢复时禁用策略排程的语义另验；不宣称完整调度验收。
- 唯一208有修复/复验记录（含部分）/68已有防护或实现不同/51待精修，原R067失败覆盖新排程指定症状已复验。2153e7c1已push核远端，a08895d1 CI全部success，其后仍in_progress。按Owner阶段提交推送继续R063/R064当前认证与实例事务锁运行证据；完整327/灾备未完成。

## 2026-10-29 R1-065 快照策略更新重新排程

- 实际PUT路由upsert的update分支只写enabled/intervalMinutes，保留旧nextRunAt；snapshot-policy-schedule-before真实Fastify/PG从10改1440先红。现仅在原withSnapshotMutation实例/账户事务锁内读取当前策略：启用且间隔未变、已有排程时保留；改间隔/重新启用/缺排程从当前成功更新时间加新间隔；关闭清空nextRunAt，lastRunAt不变。创建与更新同规则，不改快照远端/退款/库存/全端口或调度器。
- takeover-snapshot-policy-schedule-final2真实Fastify/PG增减三种间隔、原样保排程、关闭null/重新启用、非法interval/他人/撤销sid拒绝且排程不变、实例全字段及零snapshot保持exit0。专项已清自身夹具后显式exit，与仓库既有集成一致；第一轮PASS后全库import遗留句柄的进程只停精确该测试，最终重跑exit0。未停止本地PG或操作生产。
- snapshot-route/auth-session与auto-policy-scheduler三对应守卫、server类型、独立测试TS（node/ES2023/Fastify声明）、server build全exit0；manifest194常规177专项有效，新专项接CI。takeover-snapshot-policy-schedule-auto-regression原完整真实PG/mTLS回归26条PASS最终exit0，包括远端拒绝/身份变化/禁用/过期/事务失败/杀进程重试/限次及恢复保护；Incus边界仍测试替身，不是原生客户磁盘或Linux验收。前端无改，既有双端build保持。
- 207有修复/复验记录（含部分）/68已有防护或实现不同/52待精修。a1716d42已push核远端，四上批CI查询仍in_progress。完整327/原生快照/网关灾备未完成；下一R067旧failure finalizer函数当前无消费者，继续按实际调用链复核，不机械修改退役代码。

## 2026-10-29 R1-061 快照策略布尔读取与原样保存复验

- 原清单是SnapshotManager快照策略，不是防火墙。当前产品已在c277ba30改为Boolean(res.enabled)，GET实际返回boolean，PUT接受boolean与10/60/360/1440间隔；本阶段不重复修改产品或扩大到客机备份。
- 新snapshot-policy-ui真实Vue/Chrome通过true/false×四间隔读取→点实际aria-label编辑按钮→核checkbox→点实际保存→核精确instanceId/boolean/intervalMinutes payload→当前回执刷新。原样保存不会将true变false。三语1440/768/390弹窗截图已查看、无水平溢出；受控API未改真实策略/快照或操作Incus。首轮夹具错误以文字找纯图标按钮，改按真实aria-label后takeover-snapshot-policy-ui-final exit0。
- snapshot-route/frontend-route/i18n三守卫exit0、脚本语法与diff check、manifest194常规176专项分类有效并接CI，无待poll。产品未改，沿用同产品最终双端types build/dist证据。此次只补R061运行证据；弹窗原样式/深色灰字与完整会话生命周期没有整体UI验收，不能以此代表自动调度或真实宿主快照通过。
- 唯一206有修复/复验记录（含部分）/68已有防护或实现不同/53待精修，原待修R061本次关闭指定症状；完整327/原生宿主及灾备未完成。6e31eaa9已push核远端；上三批CI仍in_progress。下一R065快照间隔更新后的nextRunAt与相关PG调度证据继续核查。

## 2026-10-29 R1-315/R1-326 三语与手机长 Webhook 运行复验

- 两项原产品修复已在当前源码，本阶段不重复改Telegram或定价行为。新增test-telegram-pricing-locales实际Vue/Chrome专项并接CI/manifest：三语Telegram控件、管理员邀请码定价标题/资源/价格/有效期及switch可访问名均实际渲染；语言切换不发请求，原余额0.01/积分1步长、min0、合法零及开关状态保持。
- 浏览器用仅测试进程的host-resolver-rules将三段63字符的example.test长域名映射127.0.0.1，没有修改系统DNS/hosts。配置地址由实际buildPublicApiUrl沿当前长origin生成；当前地址另含300字符测试query。1440/768/390三语完整文字、换行及元素/全页宽度通过；不是外部Telegram或HTTPS回调验收，零配置/渠道/邮箱写入。takeover-telegram-pricing-locales-final3 exit0，18张最终截图全部查看。首两轮检查脚本集合API/英文末尾空格比较及整页无关中文范围修后复跑，不计产品失败。
- 原bindings18旧回执及settings-receipts读取/保存/真实retry回归分别takeover-telegram-pricing-bindings-regression/settings-regression exit0；route/i18n守卫、脚本语法、diff check通过，manifest194常规175专项分类有效。产品源码未变，沿用c23c6a7e前最终双端含vue-tsc构建及password-policy-dist已过的同产品代码，不重复构建。
- taste实浏览器测量已保存logs/telegram-pricing-locales/measurements.json，**整页视觉未通过**：Telegram各宽3 FAIL、2–4 WARN；设置各宽3 FAIL（390为4）、0–1 WARN，集中原有gradient/button-fx/heavy-shadow/glass，另灰字对比/小字。没有放行或修改全局样式来掩盖。截图评审：名称/地址和定价字段无横溢，浅色开关和深色禁用/说明可读性仍需单独精修；当前设计5.5/可用6/内容8，整体按FAIL上限不超过6。此为R315/R326功能与布局范围复验，不是整页UI验收；无新设计draw/图片素材。
- c23c6a7e已push且远端核一致，a08895d1/c23c6a7e CI仍in_progress。唯一205有修复/复验记录（含部分）/68已有防护或实现不同/54待精修不变，两原已改编号不重复计数；完整327/真实宿主/灾备未完。按Owner阶段提交推送后继续原清单。

## 2026-10-29 R1-320 修改密码提示与后台规则一致

- PasswordSection 的6位提示/门禁与后台 validatePassword 的8–128位、大小写字母和数字不一致。现前端按相同规则拒绝非法值且零API请求，新密码输入限制8–128，三语规则放在输入框下持久显示并用aria-describedby关联；不改后端、旧密码验证、二次验证、会话/草稿隔离及成功后重新登录流程。
- takeover-password-policy-receipts 实际Vue/Chrome三语各5类非法输入零请求、合法8/128边界精确payload及原非法回执/真实SensitiveVerification request→verify→重试→清登录跳转通过exit0；scope原32旧session/account/role/logout/draft/ABA/cache回执、busy/卸载与取消grant回归exit0。三语1440/768/390截图已查看，规则完整可读，无水平溢出；仅受控API，未修改真实账户密码或外部邮箱。
- 对应route/i18n/auth-session-status守卫、lint零错警、最终双端build含vue-tsc及takeover-password-policy-dist构建边界全部exit0；manifest194常规174专项分类有效，无待poll。上批a08895d1已核远端main，查询CI仍in_progress，不能算通过。本阶段按Owner授权单独提交推送，不发行或操作生产。
- 327唯一编号205有修复/复验记录（含部分）/68已有防护或实现不同/54待精修，205内部未完范围仍继续。下一R315三语与R326长Webhook原源码已有修改，补实际手机浏览器验证；完整327、真实宿主及灾备仍未完成。

## 2026-10-29 用户销毁邮箱保护与 R1-319 充值确认

- Owner追加：用户单台、批量、异常及本人通用DELETE必须账户邮箱验证码；管理员替用户删除免邮箱。新服务绑定账户、有效sid、当前邮箱和排序实例集合，10分钟有效、一次消费、5次错码、同账户60秒限发及每小时5次发送预算；发送失败和已消费记录保留预算。邮件走原mailer，不依赖通知渠道。PG全局分配锁与随机碰撞重试避免有效期内A/B同码；只存SHA256，不返数字或完整邮箱。发送在途不能消费；通用验证隔离销毁专用记录，不得晋升grant或清除预算。
- 单台/异常与批量统一邮箱字段。按Owner最新要求删除名称输入/DESTROY短语，表格列名称、实际地区与实例记录编号（未知为—）；保留不可恢复说明、持久错误、44px控件、键盘焦点及目标/会话隔离。前端60秒倒计时；邮件失败三语引导「发工单」。用已安装taste-skill沿用原纯黑白体系小范围精修，未draw新方向；浅深色1440/768/390检查0 FAIL/0 WARN且截图已看，放行仅针对实际浮层遮挡/阴影/居中留白。Osaka/example.test为隔离夹具。
- `takeover-destroy-email-pg-60s.log`真实PG+本地SMTP exit0：强制A/B同随机数仍发不同码、互换/换sid/邮箱/集合拒绝、8并发一次消费、重放/过期/五错/撤销/封禁/归属变化/发送失败拒绝；换目标/会话、消费和失败不能绕过60秒，通用验证不能变更专用记录。`takeover-destroy-email-delete-final2.log`真实PG/Fastify及TLS Incus边界替身单/批付费/免费/异常零退款零余额账目、管理员选择退款/免邮箱与失败库存保护exit0；不是真实客户邮箱收件箱或Linux Incus验收。
- `takeover-destroy-email-ui-final11.log`实际Vue/Chrome唯一邮箱输入/名称地区表格、发送/失败/重试/倒计时、8旧邮件回执、无邮箱/busy/焦点；实际详情异常入口经dialog、精确payload/重复/重试及4旧写结果、Wallet三语勾选门禁（零充值请求）exit0。`takeover-destroy-email-batch-no-name-final.log`原批量目标/权限/session/cache/卸载与失败回归exit0。开发自动重载中断已复跑；对比度/重复attribute/缺i18n key均修后最终过。
- 5相关守卫过，最后UI变更后`takeover-destroy-email-ui-guards-complete.log`route/i18n再过；server-build-60s、client `takeover-destroy-email-build-final-complete.log`双端含vue-tsc exit0，lint-complete零错警，独立TS test-types-final3 exit0（ES2023/node types/Fastify声明）；manifest194常规174专项，两新专项接CI。27c05f79/4da9fdf2 CI已核success；本阶段CI推送后另核。
- R319三语充值确认不再承诺销毁退余额/PUSH免费，手续费以转移页为准，未改计费。327唯一编号204有修复/复验（含部分）/68已有防护或实现不同/55待精修；新增邮箱独立记录不重复计数。完整327、外部邮件/真实宿主与灾备仍未完成。按Owner授权阶段提交推送，不发行、不生产OTA/DNS或操作客户。下一R320已读PasswordSection、users PATCH、validatePassword及既有密码回归：前端6位、后台8–128含大小写/数字，继续。
- Owner询问#1含义：这是实例记录id，不是宿主/机器池编号。同一名称下用于区分对象。追加`takeover-destroy-email-long-names.log`真实Chrome长中文/连续英文完整文字及390px表格/弹窗/page宽度检查exit0，截图已看；高度过长沿现有弹窗内部滚动，未截断名称。最终dist边界守卫exit0，无待poll。

## 2026-10-29 R1-317 两端登录即时重复提交门禁

- 4da9fdf2已push。login-before实际Chrome连续handleLogin发2次先红。Login/AdminLogin函数第一行现在拒loading，演示登录先拒在途以免覆盖当前输入；OAuth函数和按钮也拒在途。管理端await原安全router.push到完成再解锁。仅补入口互斥，不改authStore、后端登录/2FA/恢复码/Turnstile规则或双端账号驱离。
- login-final-r3实际Vue/Chrome两端重复函数/演示/在途OAuth、失败重试、正常各自console路由、缺输入/缺challenge零写、TOTP和恢复码原payload分支通过exit0；专项使用实际authStore和两页面，Turnstile组件仅受控token夹具，不是外部挑战验收。第一轮脚本check误引用浏览器闭包admin已修后重跑，首截图本地logo路径缺失已用client/public后最终三宽三语截图确认。3守卫（route/auth-session/i18n）、lint最终零错警/route-final、manifest194常规172专项及双端build含vue-tsc最终exit0/dist通过，无待poll，专项接CI。
- R317进入部分修复，327唯一编号203有修复/复验（含部分）/68已有防护或实现不同/56待精修；203内其它认证/登录离页旧回执、跨页面/跨标签/后台幂等仍另验。未创建真实账号会话、调用外部OAuth/Turnstile或改生产。下一R319已核Wallet rechargeNotice及transfer_fee扣费、用户销毁零退款守卫，三语仍错误承诺销毁退款/PUSH免费，尚未改。完整327/灾备仍未完成。

## 2026-10-29 R1-316 Telegram 渠道保存草稿与真实确认

- cdd11a2a已push。submit-before真实Chrome先红：保存期间四字段仍未冻结。create/update现函数即时busy，禁字段/取消/新建/另编辑；固定payload/id/read/session/draft代次，旧成功失败不关窗、不提示、不刷新，新草稿ABA亦隔离。同sid正常刷新保持；合法失败保草稿。原未改掩码Token才省略，编辑成其它含省略号字符串仍发后台严格验证，避免静默成功不生效。
- update核非空message，create另核实际新channel正整数ID/name/type/enabled；无效回执不成功/刷新，持久提示先刷新列表核对再重试。成功同步关窗清秘密后刷新列表，channels辅助读也独立seq/session/激活，旧finally不覆当前loader。后台/API行为未改。
- submit-final-r2实际Chrome36旧回执（2模式×9变化×2结果）、busy/关闭/失败重试/same sid/十非法回执/原与编辑掩码、channels旧读及三宽三语截图通过exit0；editor20旧读取与bindings18旧回执完整回归exit0。4守卫/lint零错警/manifest194常规171专项通过。首次类型检查联合返回值channel推断失败，修为unknown记录收窄后types-final exit0；最终build-final双端含vue-tsc进程exit0/dist-final2通过，无待poll。仅真实Vue/受控API，未TG/实际写渠道。
- 202/68/57含部分不重复加编号，R316其它配置读取、删/测试/解绑写入和后台当前授权/审计原子性仍待。此前9730aa27、5c8e925b、8f759572、4675ea2d、1a306d92、cdd11a2a的CI现均success。下一R317已读两登录页、authStore/真实login route与守卫；真实Chrome login-before连续handleLogin发2次先红，login-submit夹具未提交且产品未改。完整327和网关灾备仍未完成。

## 2026-10-29 R1-316 Telegram 渠道详情目标与就绪门禁

- 绑定阶段1a306d92已push。editor-before实际Chrome先红：先点1再点2，旧1详情将当前editor改回1。现打开即清旧表单并固定ID/read sequence/admin session/show/page；换目标、关闭/新建、session ABA/cache/unmount撤销旧回执，same sid正常刷新保持。加载与错误保持当前渠道#ID，ready前函数/按钮均拒写，严格详情id/name/type/enabled/config及掩码字段类型核验；失败持久role alert/DOM retry，关闭清秘密草稿，新建独立ready。
- editor-final实际Chrome目标反序/旧finally、20旧读取、八非法详情/ready门禁、same sid/false enabled/关闭清秘密、三语实际retry全部exit0；bindings-regression原18旧回执与搜索/分页/非法/重试/0回归exit0。三宽三语错误截图均已查看，无水平溢出；4守卫/lint零错警/manifest194常规170专项、双端build含vue-tsc最终exit0/dist通过，无待poll，专项接CI。仅真实Vue/受控API，未实际TG或渠道写。
- R316仍部分，202/68/57含部分不重复加编号。下一保存字段冻结/固定payload/draft/session回执及成功确认已核后台create返回message+channel、update返回message；scripts/test-telegram-channel-submit.mjs下一阶段夹具尚未提交，不混入本批。其它配置/写入、后台审计/权限与完整真实渠道仍待。完整327/灾备未完成。

## 2026-10-29 R1-316 Telegram 绑定搜索与分页读取

- R314 4675ea2d已push核远端。bindings-before实际Chrome先红：旧search反序覆盖Current user为Obsolete user。现固定search/page/pageSize、独立read sequence和admin account/role/sid、页面激活；同步草稿/ABA/session/cache/unmount撤销旧回执，旧finally不结束新loader，同sid刷新不重读。会话/缓存清私密绑定及门槛，激活重读；page先固定当前请求，回执必须同页和pageSize。
- 列表/total/page/group/每条binding身份、stats和eligibility先整体核验，异常不部分落入列表；错误持久显示role alert与DOM retry，保持搜索草稿，合法空列表total0不算失败。未知门槛不再显示无限loading。三语invalidBindings文案新增；原页面11个html-indent警告只修缩进，最终lint零错警。
- final-r3实际Chrome搜索/分页反序、旧finally、18旧回执、same sid、九类无效回执及实际retry/0全部exit0；三宽三语错误截图已看，无水平溢出。4守卫（route/i18n/admin-notification/user-telegram）、最终route、lint、manifest194常规169专项分类通过；build双端含vue-tsc最终exit0/dist，专项接CI，无待poll。真实Vue/受控API，没有调用Telegram、解绑真实账户或写渠道；channel editor及同页其它写入/配置读取仍下一段，后台未改。
- R316进入部分修复，327唯一编号202有修复/复验记录（含部分）/68已有防护或实现不同/57待精修，202内部仍未完。6e643b4a与f696eb76 CI已success；9730aa27/5c8e925b/8f759572/4675ea2d查询时仍in_progress，不能算已通过。完整327与网关灾备仍未完成。

## 2026-10-29 R1-314 单抽与十连互斥及迟到结果隔离

- 上批8f759572已push。实际Chrome before先红：十连pending时spin仍发1次draw。两函数入口现在共用即时busy门禁，转盘单抽/活动选择/再次抽按钮同步禁止交错；固定活动ID、奖品数组快照、account/role/sid与页面/主子tab代次。旧成功/失败不写结果、提示或辅助刷新；同sid正常token刷新保持。单抽成功仅一个可清理timer覆盖动画到结果/解锁，失败立即释放；离页/缓存/卸载取消timer与灯泡。原HTTP在途保持busy至finally，不因切页允许同组件再写。
- points/lotteries辅助读增加session/独立sequence与激活门禁，反序/旧finally不覆盖当前数据及loader；会话/缓存切换清私密积分和活动，激活重读。真实Chrome final原48文案与final-r2原80文案均为误计；实际最终2操作×10变化×2结果=40旧回执（每操作20），全部exit0，脚本改用实际循环计数。current-final另通过互斥/失败重试/禁选择、动画busy、实际徽章分支remainingPoints、same sid及旧读取/合法0（跳过重复旧写矩阵，日志0是本次未跑该矩阵）。三宽三语截图已查看；fixture只替换无关VIP/BadgeCenter，实际抽奖页及奖励弹窗运行。
- route/entertainment/i18n三守卫、lint零错警、双端build含vue-tsc最终exit0/dist及manifest194常规168专项分类通过，专项登记CI；日志前缀takeover-lottery-draw，无待poll。仅真实Vue与受控API，未发真实抽奖、扣积分/发奖或TG通知；后端performDraw/事务与一机一卖保持，真实奖励/断网幂等及整条认证验收仍待。
- R314进入部分修复，327唯一编号201有修复/复验记录（含部分）/68已有防护或实现不同/58待精修，201内部仍有未完范围。下一R316 Telegram bindings与channel编辑读取已读源及通知守卫：缺target/read代次，产品尚未改。完整327和网关灾备仍未完成。

## 2026-10-29 R1-323 套餐启动提示符合 Incus 语义

- R312提交5c8e925b已push并核远端一致。本批仅改简体/繁体/英文六条packageForm.hints：高priority先启动；delay为本实例启动后、下一个实例启动前的等待时间。已核server/src/lib/incus/incus-instances.ts原值直传字段，并读取Incus官方instance_options文档的priority最高先启动、delay启动后等待下一实例定义（https://linuxcontainers.org/incus/docs/main/reference/instance_options/）。不改字段范围、默认值、后端映射或交付行为。
- takeover-package-boot-hints-browser实际Vue/Chrome沿用R312全矩阵exit0，三宽三语截图均已查看，英文390长提示正常两行且无水平溢出；对应route/i18n/package-input三守卫及locale lint零错警通过。build双端含vue-tsc最终exit0、dist通过；日志前缀takeover-package-boot-hints。此项为文案验证，不声称真实宿主自动开机顺序验收。
- 按327唯一编号现200有修复/复验记录（含部分）/68已有防护或实现不同/59待精修，200内部未完范围仍需继续。下一R314已读实际spin/multiDraw、KeepAlive及娱乐守卫，单抽遗漏十连互斥、结果/解锁timer未清理和旧回执仍存在；独立浏览器夹具开始准备，产品尚未改。完整327与网关灾备仍未完成。

## 2026-10-29 R1-312 套餐合法零优先级保留

- 上批9730aa27已push。本批修PackageFormView读取及提交CPU/启动优先级0被默认10/20覆盖；仅null/缺省读取使用默认，提交要求原范围整数，空白、非数字、小数及越界拒写。CPU范围0–10、启动优先级0–100不变；启动延迟5–600和关机超时30–600不扩大为允许0。PackageSelector当前只展示props.packages，没有对方嵌入packageId读取路径，保留实现不同结论。
- takeover-package-priorities-before真实Chrome加载0得到10先红；final读/提交数字和字符串0、null/缺省默认、四合法边界与十非法输入通过exit0，原完整package-form读取/保存/session/description/plan modal回归exit0。三宽三语截图均已查看，无水平溢出。4守卫（frontend-route/package-input/package-route-id/package-host-type）、lint零错警及manifest194常规/167专项分类通过；build双端含vue-tsc与dist最终进程exit0，专项接CI。日志前缀takeover-package-priorities，截图logs/package-priorities；无待poll。
- 仅真实Vue与受控API，未写真实套餐/数据库、操作宿主或交付客户实例；后端及一机一卖全端口逻辑未改，实际Incus交付验收仍待。按唯一327编号现199有修复/复验记录（含部分）/68已有防护或实现不同/60待精修；199内部未完范围继续保留。下一R323三语启动提示语义已核现有Incus字段映射，尚未改。完整327和网关灾备仍未完成，本批阶段提交推送继续。

## 2026-10-29 R1-310 SMTP 测试固定收件人与确认回执

- 6e643b4a已push。smtp-before实际Chrome先红连续send两次请求。两测试函数共享即时busy（含SMTP保存），固定session/页面/SMTP草稿/收件人代次，旧成功失败静默；scope变更清测试邮箱及提示，在途busy保持到finally。输入变化清旧提示，新地址不被旧回执清除；当前同sid成功使用提交时email。连接测试核真实success/message，发送另核accepted=1/rejected=0/pending=0及有效邮箱；只显示邮件服务接受，不声明收件箱已收到。
- smtp-final-r3实际Chrome两操作×8变化×2结果=32旧回执（各16，前一日志文案32每操作已纠正），重复/交叉、四卸载、八基础非法回执/四acceptance反例/四邮箱、same sid与失败重试通过exit0；drafts19组回归exit0。测试提示持久显示role alert/status，发送输入窄屏改单列；三宽三语错误截图已看。4守卫（route/i18n/smtp-proof/admin）、lint零错警、smtp-build双端含vue-tsc exit0/dist、manifest194常规166专项分类通过，专项接CI，全进程exit0。
- 仅真实Vue与合成API，没有调用外部SMTP或发送真实邮件；后台原SMTP审计与提供商回执保持，保存SMTP业务不改。R310仍部分，198/68/61不变，完整327/灾备未完。下一R312套餐零优先级已核PackageForm与守卫/route，CPU和启动优先级0合法，启动延迟最小5、关机超时最小30不把0误判合法；尚未改。

## 2026-10-29 R1-310 系统设置读取就绪与真实保存确认

- f696eb76已push。receipts-before真实Chrome先红初读失败仍1次默认写。现在首次全量读取ready门禁与持久configLoadError/实际reload按钮；读取失败/无效时不展示可写默认表单，函数也拒写。全列表先核条目/重复key/基础字段、boolean/有限整数小数及JSON数组/五级VIP结构再更新；不要求全库固定key齐全，但保存组缺已读取key拒写。完整读移除此次缺失旧基线，保仍由另一个当前读控制的字段与全部草稿。
- 分组写只接受真实非空message；非法回执无成功toast/辅助刷新，保固定草稿和持久分组error，合法重试清本组错误。错误标明现有三语分组标题；修正Error.message为不可枚举时被spread丢失。receipts-final-r3实际Chrome初失败/DOM retry、12类非法列表、缺key、5类写回执与合法/失败重试全部exit0；scope12读12写/卸载候选和drafts19组回归均exit0。三宽三语错误截图已看，设计检测只报原导航border-b-2误判。
- receipts-build双端含vue-tsc exit0及dist通过；最后缺key两行后client types-final与lint-current零错警通过，4对应守卫通过，manifest194常规165专项分类，receipts专项接CI。所有进程exit0，无待poll。仅真实Vue/受控API，不是生产配置或外部SMTP；后端权限/配置逐行写入及审计不改，本页SMTP测试current目标/busy/回执下一段继续。198/68/61含部分不变，R310尚部分，完整327与灾备未完成。

## 2026-10-29 R1-310 系统设置管理员会话与读取隔离

- a77e7c80 已push。scope-before 实际Chrome先红旧管理员读取把当前brand填成Old session brand。读取/分组保存现绑定account/role/sid与页面代次，session ABA/cache/unmount撤销旧成功、失败和刷新；同步清form秘密/配置/测试邮箱/候选，重入或新admin重新读取，同sid正常token刷新保留。旧在途组busy直到原finally，首次加载期间函数门禁阻写；全量loader独立seq，旧finally不结束新loader。
- popup候选读取同样绑定当前session/seq，旧候选不能覆盖新列表或结束新loading。七个公共配置辅助刷新入口仅在当前成功保存后执行；旧写回执不能再触发配置store刷新。scope-final-r4 实际Chrome12旧读+12旧写、四卸载成功失败、同sid、busy/current loading、候选反序与publicReads计数通过exit0，drafts-final19组全回归exit0。首轮回归中编辑共享夹具触发Vite reload的失败已顺序重跑，不计产品根因；截图前最后fresh避免只截到loading，三宽三语已看。
- scope-build双端含vue-tsc exit0、dist通过、4相关守卫及lint零错警通过，manifest194常规/164专项分类通过，scope专项登记CI。scope/drafts/构建进程均已exit0，无待poll。仅真实Vue/受控API，真实管理员系统写入、初读ready/持久错误retry、严格成功回执/数据形状和SMTP测试当前目标仍待；后台权限/审计未修改。R310仍部分、198/68/61含部分不变，完整327和灾备未完，本批阶段保存继续。

## 2026-10-29 R1-310 系统设置分组保存保留草稿

- 上批密码确认与验证联动 a77d2e74 已核远端 main。系统设置 drafts-before 实际 Chrome 先红：保存注册设置后品牌草稿由 Unsaved brand 变为 Incudal。现在 saveConfigGroup 固定提交字段的编辑代次，loadConfigs 只合并该分组；逐字段同步 deep watcher 保留其它组、保存及刷新期间的新输入、改回原值和 JSON 嵌套草稿。读取代次按字段独立，两个分组反序回执不互相覆盖基线；保存开始拒较早初读，同组函数入口 busy 拒重复。
- 后台刷新不切整页 loading，失败保留既有基线与草稿；未继续编辑的密码使用真实读取回执掩码。drafts-final-r3 实际 Chrome 19 分组、两分组反序、同组重复、初读反序/新草稿、刷新失败和掩码通过 exit0；首轮夹具误造缺失 VIP 等级引起渲染错误已改为合法五等级嵌套编辑，不记产品失败。三宽三语浅深截图已看；既有导航 border-b-2 被设计检测误报为卡片厚边，不改既有导航。
- client type-check、4 守卫（frontend-route/i18n/ticket-auto-close/admin-route，最后去空行再跑 route）、修改文件 lint 零错警通过；drafts-build 双端构建含 vue-tsc exit0，drafts-dist 通过，manifest194常规/163专项分类通过。浏览器专项登记 server 脚本、EXCLUDED_FROM_SUITE 原因与 CI。源码真实 Vue/受控 API 验收，不是生产配置写入；会话/缓存/卸载、严格回执和完整真实管理员流程下一段继续。
- R310 进入部分精修，唯一原编号198有修复/复验记录（含部分）/68已有防护或实现不同/61待精修，198内部仍有未完成范围。完整327和网关灾备未完成；本批仅阶段提交推送，不发版或操作生产。

## 2026-10-29 R1-309 密码成功确认与敏感验证组件联动

- 4888de63已push。receipts-before实际Chrome先红空回执仍passwordSuccess=true；初次及验证重试现在核实际非空message与reauthRequired=true，非法回执保草稿/持久error且不成功、不登出。个人密码更新实际必撤销session，删不再合法的reauth=false成功timer分支，统一当前session/generation延迟清登录，保持旧session隔离。
- receipts-final实际Chrome12初次/verified非法回执、原实际SensitiveVerification request→verify→父组件仅原payload retry→确认→clearLocalAuth+/login路径，以及新密码草稿改变时旧子verify不再发写请求通过exit0。scope-regression原32旧回执/busy/取消/计时器回归exit0，4守卫、lint零错警、receipts-build双端build含vue-tsc exit0/dist、manifest194常规162专项通过，三宽错误截图已看，专项接CI。仅真实Vue和受控API，外部SMTP/TOTP/客户真实密码修改仍待。
- 本批核正R311写入及R309scope两专项循环：各2路径×8变化×2结果=32旧回执，旧台账64已纠正；2FA24读/56写和邮箱80保持。R309仍部分，197/68/62不变，完整327和灾备未完。下一R310已读SystemConfigView，旧loadAll实际为loadConfigs，保存组后它仍覆全form；组内/组外草稿保护、read/session回执下一段继续。

## 2026-10-29 R1-309 密码验证重试的固定草稿与会话

- 874f4ef7已push。scope-before真实Chrome先红旧VERIFICATION_REQUIRED捕获replacement-password；初次及验证后重试现固定用户/currentPassword/newPassword和session/draft代次，pending绑定原上下文。账号/角色/sid/草稿ABA/cache/unmount变化清密码/待验证/timer/提示，取消验证清pending，重复verified仅一请求；在途busy保留直到原finally，字段及验证弹窗打开时阻新提交，结束重试清pending。
- 成功清草稿/原timer；成功提示和延迟清登录计时器绑定原session/generation，换会话/离页/卸载撤销，same sid刷新保留。scope-final-r3实际Chrome32初次/verified旧成功失败、busy/字段、四旧验证回调、取消/重试与三宽截图通过exit0；旧成功timer不能清新通知、旧reauth不能登出新session、正常same sid实际clearLocalAuth及/login跳转均通过。四相关守卫、lint零错警、scope-build双端含vue-tsc exit0，最后清pending两行的最终user build/dist以收尾日志记录；manifest194常规161专项通过，专项接CI。真实Vue/受控API和合成密码不等于实际客户密码变更。
- R309进入部分精修，唯一197有修复复验（含部分）/68已有防护实现不同/62待精修，197内部仍未完。成功回执严格校验和真实SensitiveVerification联动下段继续；后台current会话/验证grant/密码变更及撤销事务已有，不重复误报。完整327及网关灾备未完成。
- 最终user build日志takeover-password-scope-final-user-build.log含vue-tsc exit0、scope-dist.log通过；无待poll，最后两行清pending已在用户产物验证，管理端沿双端完整build。准备保存后继续成功回执与组件联动。

## 2026-10-29 R1-311 帮助文章保存的固定草稿与回执

- 41b694a4已push。writes-before真实Chrome先红旧session保存仍toast成功；创建/编辑现固定mode/id/完整payload及session/read/draft代次，草稿ABA、关闭、账号/角色/sid/卸载失效拒旧成功和错误。在途busy阻重复与另开目标，字段/取消/关闭冻结；正常同sid刷新保留。创建校验真实message及新article id/title/slug，更新校验实际message（后端不返回article），非法回执持久error保草稿，成功后原列表刷新保持。
- writes-final-r2实际Chrome32旧成功失败回执、两busy/DOM字段关闭/失败重试、八非法回执/合法及same sid/unmount通过exit0，reads-regression原读取矩阵exit0。三宽busy/error截图已看；3守卫/lint零错警/writes-build双端build含vue-tsc exit0/dist/manifest194常规160专项通过，专项接CI。后台审计/列表/分类并发和实际生产文章流程未验，本段不改后台。只读核54901d15/a83d28dd CI已success，三后续批仍in_progress；196/68/63含部分不变。
- 下一R309 PasswordSection完整及敏感验证组件、users PATCH/事务和守卫已读：catch读取变化后的草稿、旧timer及无busy仍待修；authStore.clearLocalAuth已确认存在，调用名称没有问题，不误报缺方法。完整327与灾备继续未完。

## 2026-10-29 R1-311 帮助编辑器当前目标读取

- 285f355e已push。reads-before实际Chrome先红A晚回令B编辑表单变为Article1；读取现绑定请求序号、文章id、编辑/创建模式、弹窗、admin/account/sid及卸载，同步清旧表单/ready，same sid刷新保留。加载与保存状态分开，旧finally不解除当前加载；失败持久留在弹窗并提供实际重试按钮，响应id必须匹配，未ready禁止保存。此段未闭合写回执、列表或分类并发。
- help-editor-reads-final-r3实际Chrome16旧成功失败目标/ABA/create/close/session/account/role/logout案例、反序loading、读取中零保存、当前失败/按钮重试、错id、same sid和卸载通过exit0。三宽截图发现390发布/置顶出界，表单窄屏改单列、开关wrap后真实DOM边界和截图通过。frontend-route/i18n/admin-route三个守卫、lint零错警、reads-build双端build含vue-tsc exit0、最终手机变更final-admin-build含vue-tsc exit0/dist、manifest194常规159专项通过，专项接CI。仅真实Vue/受控API，不是生产文章编辑验收。
- R311进入部分精修，唯一196有修复复验记录（含部分）/68已有防护实现不同/63待精修，196内部仍有未完范围。a0c33846 CI最新已success，其后数批最后仍in_progress；完整327及灾备未完。下一段编辑保存busy/字段关闭、固定输入/session/draft旧回执与真实message校验继续；后台help create/update及实际回执已读，未修改。

## 2026-10-29 R1-313 邮箱验证码与实际成功回执

- 67815d7b已push。非数字六字符当前验证码原仍发送，receipts-before实际Chrome先红；现在当前/新邮箱两函数与按钮要求六位数字，输入提供numeric/one-time-code提示。当前发送核真实success/email/目标/有效expiresIn（首次成功不保证message），验证核success/verified/message，新邮箱发送核message/未来expiresAt，更新核message/reauthRequired=false；按实际users响应契约固定提交邮箱，不要求不存在的user/email字段。无效回执持久错误、保步骤/草稿且不假报成功，合法重试通过。
- 当前重发等待不超过原120秒或实际剩余有效期，新邮箱不超过60秒或剩余有效期；VERIFICATION_REQUIRED重新进入当前验证并清两组验证码/目标/发送标记/timer，保新邮箱地址；未绑定邮箱的异常明确显示错误。receipts-final-r2实际Chrome16输入/23回执反例、四合法重试、短期重发、两种过期清理/重新验证及绑定异常通过exit0；scope-regression原80旧回执全回归exit0。3守卫、lint零错警、receipts-build双端build含vue-tsc exit0/dist、manifest194常规158专项通过，三宽三语浅深截图已看，专项登记CI。
- 只读核ce044cd6/95ea1508/41ada0d8 CI已success，a0c33846/54901d15/a83d28dd/67815d7b最后仍运行，不冒称全绿。R313仍部分，195/68/64含部分，实际邮件和客户完整变更未验，R013等及完整327/灾备仍未完。下一R311帮助编辑器已建实际Chrome先红A晚回把B表单变为Article1，产品尚未改。

## 2026-10-29 R1-313 邮箱变更固定目标与会话隔离

- a83d28dd已push。旧邮箱发送晚回标记新邮箱已发送的Chrome先红已复现；四操作现在固定用户、邮箱、验证码及session/draft代次，账号/角色/sid/邮箱/步骤/草稿/弹窗/卸载变化撤销旧成功和错误。正常同sid刷新保留；同步清草稿及计时器，旧请求busy保留至finally结束。四函数首个await前共享busy和步骤门禁，发送受倒计时保护，输入/关闭/取消/确认在途禁用，保存与updated使用提交时邮箱。
- logs/takeover-change-email-scope-final-r2.log实际Chrome通过四类即时重复/交叉操作、失败重试/正常目标、80个旧成功失败回执及same sid/卸载矩阵，进程exit0。scope-build.log双端build含vue-tsc exit0；route/i18n/operation-verification三个守卫、scope-dist.log产物边界、lint零错警、manifest194常规/157排除专项通过。三宽三语浅深截图已检查，专项接CI；真实Vue/受控API证据不等于实际邮件发送或客户账号变更。
- R313进入部分精修，唯一原编号现195有修复复验记录（含部分）/68已有防护或实现不同/64待精修；195内部仍有未完成范围。邮箱严格输入、实际回执/倒计时及敏感验证过期处理下段继续；完整327和网关灾备未完成。纠正旧2FA session台账计数：实际为24个旧读取案例及56个旧写回执案例。

## 2026-10-29 R1-307 双重验证输入与真实回执

- 54901d15已push。非数字六字符原仍提交，receipts-before实际Chrome先红abcdef请求1次。启用/禁用/恢复码重生成函数与按钮要求六位数字；设置回执核非空secret、PNG data QR、八个唯一格式恢复码，启用/禁用核非空message，重生成核真实恢复码集合。非法回执持久error保模式不显示成功；成功重生成清密码/验证码，辅助计数失败不改写已确认成功。
- receipts-final.log实际Chrome21验证码反例、五设置回执反例、12三类写回执反例、四合法重试/辅助计数失败通过；busy/session完整回归exit0。3守卫/lint零错警/receipts-build双端build含vue-tsc exit0/dist/manifest194/156通过，专项接CI。三宽UI沿busy回归截图，fixture材料为明确不可用合成数据。R013敏感验证接线与真实TOTP流程未完；新ChangeEmail专项真实先红旧邮箱返回标新地址，产品未改，下一段继续，194/68/65含部分。

## 2026-10-29 R1-307 双重验证会话与敏感状态隔离

- a0c33846已push。实际Chrome session-before旧status跨session enabled=true先红；现绑定active/account/role/sid（正常同sid token刷新保留），scope同步撤销读取并清密钥/恢复码/密码/验证码/模式/提示。写固定输入和context/draft代次，旧成功失败静默，在途busy保留至原请求结束，再重读当前身份。缓存离页/卸载显式失效，成功timer统一管理和清理，启用后清设置秘密；恢复码辅助读取不占写busy。
- takeover-two-factor-session-final-r2.log真实Chrome24读取及56写旧成功失败session/account/role/logout/ABA/cache/draft、当前busy、same sid四类正常、秘密即时清除、旧timer不能清新通知与卸载通过；卸载watcher已停止导致旧读取仍写的首轮失败已修为显式invalidateContext。busy/read两完整回归exit0，3守卫及最终route、lint零错警、session-final-build双端build含vue-tsc exit0/dist通过，manifest194/155，专项接CI。无生产2FA操作。回执内容严格校验、TOTP输入与R013敏感验证接线/完整流程仍待，194/68/65含部分。

## 2026-10-29 R1-307 双重验证状态读取就绪与重试

- 41ada0d8已push。原status失败显示未启用并能setup，reads-before实际Chrome先红；现statusReady/loading/error区分未知与实际禁用，写函数和切模式要求已成功读取。状态/恢复码计数独立seq，同步清旧值/错误/loading；严格真实boolean、非负安全整数且计数相加一致，0剩余有效。失败持久retry，旧finally不关闭新loading；mutation与enabled变化取消旧恢复码计数，禁用成功不被旧计数回填，刷新不留旧成功/错误。
- takeover-two-factor-reads-final-r3.log实际Chrome初失败setup零请求、重试/乱序/旧finally/非法状态与计数/0/写后旧计数矩阵通过，busy-regression完整回归exit0；三宽三语截图已看，截图发现的旧成功已清。三守卫、lint零错警、reads-build双端build含vue-tsc exit0、user-final-build最新两行变更复构exit0、dist通过，manifest194/154，读专项接CI。响应式对象夹具断言错误已修，不记产品根因。
- 下一段session-before.log实际Chrome已先红：替换session后旧status仍enabled=true；session/cache/unmount/write receipts/timer产品尚未改，新的session专项不混此读阶段提交。194/68/65含部分、R013敏感验证和完整流程仍待。

## 2026-10-29 R1-307 双重验证设置即时提交门禁

- 95ea1508已push。TwoFactorSection开始设置/启用/禁用/重新生成恢复码四函数在首个await之前统一loading门禁，忙时拒其它写操作；取消和另开模式同步门禁，输入/取消/确认/Done按钮在途禁用。失败后保草稿并重新可提交，原后端TOTP/敏感验证与会话撤销不变。
- takeover-two-factor-busy-before.log实际Chrome连续setup先红2次请求；final.log四类重复和交叉提交零新增请求、取消不改变模式、真实DOM字段按钮disabled、失败重试及四正常回执通过，三宽三语浅深截图已看。route/i18n/auth-session三个守卫、lint零错警、busy-build.log双端build含vue-tsc exit0/dist通过、manifest194/153通过，专项登记CI。仅真实Vue/受控API，不是实际账户启停2FA；初读ready/session/cache与写回执/定时器隔离、R013敏感验证接线另续。
- R307进入部分修复，按唯一原编号现194项有修复/复验记录（含部分）、68已有防护/实现不同、65待精修，剩余仍含194组中未完成范围。完整327与网关灾备未完成。

## 2026-10-29 R1-305 托管冻结金额精确计算

- ce044cd6已push。实际PG先红0.10+0.70冻结记录扣0.80返回400不足，原JS求和为0.7999999999999999；现冻结求和、比较、逐条剩余扣减使用Prisma.Decimal，保持最早来源扣减与原锁/审计事务。route拒绝多于两位小数，防0.001等写成零金额或隐式四舍五入。
- takeover-user-hosting-cents-before.log先红→final.log真实PG四组多源分币扣到0并无遗留冻结行，十组正负超精度输入400且零写；原审计8/账目4/回执4失败全回滚、正常/欠款与8当前权限竞争全回归通过。三个相关守卫、cents-build.log后端build含tsc exit0、cents-script-types.log专项类型exit0，既有PG专项接CI不增清单数量。冻结扣减历史信息保留与断网幂等另续，193/68/66及完整未完范围保持。

## 2026-10-29 R1-305 托管调账审计与回执事务

- a065fd7b已push。原托管route三分支已有当前admin/session/目标事务锁，不误报缺权限；问题是管理员createLog事务外吞错，实际PG审计trigger先红仍200且已写账。现三分支共享原用户/hosting锁事务，available或frozen变更、账目、管理员审计与实际余额/冻结回执同事务；任一写入或回执读取失败全回滚。原金额、冻结最早扣减、30天解冻及运营收入排除管理员赠款保持。
- takeover-user-hosting-write-before-r3.log真实PG先红；final-r2.log八审计失败/四账目失败恢复全部源冻结记录、四回执读取故障（实际PG事务+限定代理注入）全回滚，14正常加减/分币/扣到0/跨冻结记录与欠款回执、五非法/不足零写、八实际封禁/降权/单及全session撤销锁竞争通过。hosting/user-route-id/auth-session-status/log-localization四守卫，write-build.log后端build含tsc exit0、script-types.log独立专项类型exit0、manifest194/152通过，PG专项登记CI。PG55438在环境切换后已停止，先确认无server再恢复原数据目录；初失联和fixture缺hook不计产品先红，不停止此数据库。
- CI只读核373ad333/50239a0d/c5eb8e98/b5d26214/6509acde/29225dde/3d90abd3已success；a065fd7b仍运行。未生产部署。托管小数精度、冻结扣减历史审计及断网后幂等继续，193/68/66含部分、完整327及网关灾备未完成。

## 2026-10-29 R1-305 托管余额读取与调整回执

- 基于已push的373ad333，托管余额概览/明细/调整页独立read序号，绑定当前user/session/modal/tab/page和打开代次；同步清数据/loading/error，旧目标/ABA/cache/卸载回执拒绝。校验真实user.id、有限金额、非负冻结与明细/分页；允许业务实际欠款与负金额销毁明细，显示不重复负号。错误持久retry，标签切回重取，明细按实际pageSize算页数，手机三标签完整显示。
- 调整严格两位十进制0.01–99999999.99、type/operation和200字理由；函数即时busy、保存中字段/标签/关闭/另开目标保护。固定userId/参数及session/目标/弹窗/草稿代次，旧成功失败静默；回执要求真实success与有限金额，接受0及既有欠款。失败保草稿和持久error，成功先切overview再赋实际余额，辅助列表scope隔离，旧读取不覆盖已确认余额。
- reads-before.log真实Chrome先红20被旧10覆盖；submit-before.log先红跨session仍toast/刷新。takeover-user-hosting-reads-current.log与submit-current.log真实Chrome全矩阵exit0，包含读写用户/session/ABA/cache/草稿/卸载、busy/字段/关闭、retry/非法回执/0/欠款、金额边界和辅助读取；三宽三语浅深截图已检查。最终双端build含vue-tsc日志takeover-user-hosting-final-build-r2.log exit0；4同源守卫由Node原生TS运行通过（final-native-route/hosting/user-id/i18n.log），dist边界final-native-dist.log通过，lint零错警，manifest194/151通过，两专项登记CI。tsx环境ENOMEM与自动审批503阻止的旧执行不计通过；owner开启完全权限后本地Chrome恢复。后台托管审计原子/事务回执与断网幂等仍待，真实客户完整流程未完成。
- R305仍部分，193/68/66不变；完整327及网关灾备未完成。

## 2026-10-29 R1-305 用户积分调整当前权限与审计事务

- 50239a0d已push。原已鉴权的封禁管理员仍可积分写入，takeover-user-points-write-before.log真实PG先红200。adminAdjustPoints现在必传actor，积分锁后复用lockAdministrativeUserMutation，在upsert/变更前锁当前目标及管理员并核status/role/sid/iat撤销；权限变化403、目标消失404。积分、累计计数、pointsLog与lottery.points.adjust审计同事务，审计读取已锁姓名、原日志本地化；route移除事务外createLog。
- takeover-user-points-write-final-r2.log真实PG：四当前身份反例/四实际封禁降权单会话全会话撤销竞争；正负两审计失败+两账目失败全回滚，五正常正负/扣到0/1000000精确计数和一条账目审计，四非法/不足及三计数溢出零写，两并发扣7仅一成功并保3，缺sid/iat和无积分记录封禁零upsert全部通过。4守卫、后端build含tsc exit0、manifest194/149通过；专项scripts独立类型检查exit0，CI登记。原后台路线/其它积分消费保持；网络失败重试幂等、托管余额与完整真实客户流程仍待。
- R305仍部分，193/68/66不变；完整327及网关灾备未完成。

## 2026-10-29 R1-305 用户积分调整输入与写回执

- c5eb8e9已push。UsersView积分写入严格非零整数±1000000（对齐真实Web route）、200字理由，不再parseInt截断小数/坏字符串；统一canAdjustPoints与函数即时busy，保存中fieldset/取消/背景/另开目标受保护。固定userId/参数及session/目标/弹窗/草稿代次，旧成功失败静默；成功必须真实success及Int范围newPoints，合法0接受，失败留草稿与持久error；辅助列表读取绑定成功后的scope，不覆盖后来新开弹窗。
- takeover-user-points-submit-before.log真实Chrome先红旧会话回执仍toast+刷新；final.log22组目标/session/ABA/close/tab/draft/cache旧成功失败、立即重复/字段关闭、严格整数理由、正负及上限/0、六组非法回执、retry/同sid/卸载/旧辅助列表全部通过。types/4守卫/lint零错警/manifest194/148、三宽三语浅深截图已检查；余额写完整回归exit0，takeover-user-points-submit-build.log双端build含vue-tsc exit0/dist通过，专项接CI。真实Vue组件/受控API；后台积分当前admin/session核验与审计事务、托管余额及完整真实流程仍待，不扩大本段。
- R305仍部分，193/68/66不变，完整327及网关灾备未完成。

## 2026-10-29 R1-305 用户余额调整审计原子提交

- b5d2621已push。原balance route事务外createLog吞审计写错，真实PG trigger先红仍200并已调账。现adminAdjustBalance复用原changeBalanceInTransaction，余额/账目/当前admin与session行锁核验/管理员操作审计同事务；任一落库失败全回滚。审计读取已锁目标姓名与实际两位小数金额，沿用日志本地化；route不再事务外追加重复审计。未改gift/审批/历史账目。
- takeover-user-balance-audit-final.log真实PG/Fastify四组审计失败、两组账目失败全回滚，六组加减/扣到0/分币/上限正常精确回执；四非法/不足余额零写、四当前管理员权限/撤销反例及四实际行锁竞争均通过。4守卫通过，takeover-user-balance-audit-build.log后端build含tsc exit0；独立scripts类型检查exit0、manifest194/147通过，PG专项接CI。server目录无ESLint配置，本段以tsc/守卫/实际PG及代码审查验证。只使用local *_pool_test隔离数据库，不是生产调账；邮件持久投递和断网后重试幂等仍待。
- R305保持部分，193/68/66统计不变；完整327、真实客户完整流程和网关灾备仍未完成。

## 2026-10-29 R1-305 用户余额调整写回执与输入

- 6509acd已push。余额调整固定userId/金额/理由，统一canAdjustBalance与函数即时busy；保存期间锁字段、tab、关闭和另开用户，锁跨session变化直到原请求退出。严格十进制两位小数、0.01–99999999.99、明确add/deduct与500字理由；错误留草稿并持久显示。回执核实际newBalance、admin_adjust账目ID/金额/前后余额连续性；目标/session/ABA/cache/草稿变化后旧成功失败静默，同sid刷新保留。
- takeover-user-balance-submit-before.log真实Chrome先红旧写跨session仍通知；final.log完整金额/type/reason、立即重复、忙字段/关闭、22组旧回执、失败重试、非法回执、0余额/上限/分、同sid/卸载及辅助刷新隔离通过。用户列表补请求序号和查询/session范围，写入后辅助刷新绑定原scope；已确认成功不因读取失败误报调账失败。types、4守卫、lint零错警、manifest194/146、三宽三语截图已检查；takeover-user-balance-submit-build.log双端build含vue-tsc exit0、dist.log边界通过，专项接CI。真实Vue组件/受控API证据；后台审计原子性、断网后调账幂等和完整真实账户流程仍待，积分/托管余额另续。
- 统计维持193/68/66且193含部分；R305不重复计数。只读核863914d/e8cb278 CI success，91e8e57/3d90abd/29225dd/6509acd仍运行；完整327及网关灾备未完成。

## 2026-10-29 R1-305 用户余额与登录弹窗读取隔离

- 29225dd已push。UsersView余额概览/明细/充值及登录记录独立请求序号，绑定当前用户、会话、弹窗代次、tab/page/filter；变化同步清数据/错误/loading，缓存离页/卸载取消接受旧回执，同sid刷新保持。接口失败持久留在对应弹窗并提供retry，不显示成功空表；验证回执金额、分页及实际用户身份（接口有userId时）。登录每页50对齐后台限幅，页数按实际pageSize计算。
- takeover-user-dialog-reads-before.log真实Chrome先红：用户2当前20被用户1晚回执改成10；final-r2.log四类完整目标/ABA/session/account/role/logout/close/tab/cache/page/filter、旧finally不能关新loading、错误retry/非法回执、金额0/空列表/跨用户数据、同sid/卸载通过。1440/768/390中英浅深及手机四类正常数据截图已检查，修手机四标签裁切为2×2；type-check、三守卫、单文件lint零错警、manifest194/145通过。takeover-user-dialog-reads-build.log双端build含vue-tsc exit0，dist.log边界通过，专项接CI。夹具为真实Vue组件/受控API，不是客户账户数据；余额调整写回执/重复与金额输入仍下一项，宿主余额/积分/其它用户操作未扩大。
- R305由待修进入部分修复，327现193项已有修复/复验记录（含部分）、68项已有防护/实现不同、66项待精修；剩余还包括193内未完成范围，完整327/网关灾备未完成。

## 2026-10-29 R1-304 改价请求拒绝隐式结算和版本转换

- 3d90abd已push。四个单/批预览及提交入口要求settleBalance真实布尔；批量实例ID及版本快照仅接受安全整数、拒绝重复目标/快照，不再Number转换null/false/字符串。单台可选expectedVersion保留，但提供时必须为非负安全整数。已核本仓库调用仅BillingView，原页面发送数值/布尔与唯一选择；不改计费公式或旧数据。
- takeover-billing-price-input-before.log真实PG/Fastify先红：settleBalance字符串false被当真执行并返回200；input-final.log四入口共67组非法结算、ID和version明确400且零价格/账目/日志改动。正常0/涨价、结算true/false、version0、审计回滚与当前权限/资格锁竞争全部回归通过。三个相关守卫、manifest194/144与diff通过，takeover-billing-price-input-build.log后端build含tsc exit0；原PG测试与外部/生产分别记录。只读核CI：c6be378运行40820987374成功，863914d/e8cb278/91e8e57/3d90abd仍运行。
- R304仍部分修复：余额锁顺序/归属及支付记录并发、通知持久化与完整真实计费流程继续核查；327维持192/68/67，不能把已记录192视为全部完成。

## 2026-10-29 R1-304 改价事务复核当前管理员与会话

- 91e8e57已push。单/批写入在锁定目标实例后复用authorizeUserWrite锁管理员账号、检查active、当前admin角色与sid/iat撤销记录；实例行锁按ID排序。单台价格不变分支也进入同一锁和当前身份核验，再返回原不变结果，避免提前成功。该阶段仅写路由，预览读取与其它后台操作未扩大。
- takeover-billing-price-auth-before.log实际PG/Fastify先红：封禁事务持有管理员行锁期间旧请求仍200；auth-final.log通过单/批封禁/降权/session/全session八组真实等待竞争，16组缺sid/iat/降权/封禁含不变请求、两个较新iat可用对照、目标变deleted/free四组行锁竞争；旧请求均零计费/零成功日志。原审计失败与完整正常结算矩阵同时回归通过。实例锁稳定事务内资格检查，不代表归属变化、续费/转移/删除全链路并发已全部验收。
- admin-billing-route-id/log-localization/auth-session-status三守卫、manifest194/144与diff通过；takeover-billing-price-auth-build.log后端build含tsc exit0。原PG仅本地隔离库、无外部通知渠道/Incus，前端沿e8cb278验证。代码复核确认现有单/批余额明细已从实际更新余额反推before，不因旧读取便断言明细错误；用户余额锁顺序、归属/支付记录变化与通知持久性仍待后续；R304仍部分，327维持192/68/67。

## 2026-10-29 R1-304 改价操作审计与计费同事务

- e8cb278已push。单台和批量原createLog在计费事务外且吞掉写入失败，现使用各自tx.log.create，操作码/模块/结果与原中文化入口保持；单台日志使用事务内实际实例名并绑定instanceId。审计失败与价格、version、余额、余额明细及计费记录一起回滚，不修改全局createLog的其他调用。
- test-review-billing-price-audit.ts真实PG/Fastify以限定admin/action的临时日志trigger注入失败，before-r5.log先红：单台不结算改为0仍返回200（预期500）；final.log单/批×0/涨价×结算/不结算8组失败全回滚，8组正常写及余额连续/方向、版本防重结算、价格不变2组通过。保留专属IPv4标志和已付到期，不连接Incus或外部通知渠道。初跑PG停止/恢复中及夹具hook/枚举错误不是产品先红；原隔离PG55438已自动恢复。
- admin-billing-route-id/log-localization/auth-session-status三守卫、manifest194/144与diff通过；takeover-billing-price-audit-build.log后端build含tsc exit0，专项已接CI。前端没有改动，沿e8cb278双端构建与浏览器证据。此项补齐审计原子性，当前管理员权限/撤销与计费对象并发锁仍待精修，通知持久性另验；R304仍部分，327维持192/68/67。

## 2026-10-29 R1-304 改价写回执与失败后重新预览

- 863914d已push。单/批改价固定请求目标、价格、结算与版本；保存时阻止重复提交、另开改价、关闭/取消/背景及编辑输入。会话/账号/权限、离页缓存、弹窗/草稿变化的独立代次拒收旧成功/失败，包括变化后恢复原值；同sid刷新仍接受当前成功。
- 当前写失败持久显示原错误、保留草稿，清预览与版本，必须显式重取预览后才能提交；不接受错误附带preview。成功回执需success=true和非空message，辅助读取不再占用改价busy或变成改价失败；辅助读取按写入scope/新草稿及读取序号隔离，旧成功后的列表/概览不能覆盖新操作。其他原有列表/概览调用未做全页身份隔离，不能扩大本阶段结论。
- takeover-billing-price-submit-before.log旧session成功toast先红；r1/r2真实Chrome单/批busy、错误/版本、目标/选择/结算、session及草稿ABA、缓存、同sid、无效回执、成功辅助读取失败/新草稿/新读取矩阵通过，preview-regression.log原预览全矩阵通过；三宽中英/浅深错误截图已检查。client type-check、三守卫guards-r2、manifest194/143、eslint0error9原有缩进warning通过。build.log最终双端构建含vue-tsc exit0、dist.log边界守卫通过；写专项已接CI。此为实际Vue组件/受控API夹具，真实PG计费与后台当前授权/审计事务待后续，R304仍部分修复；327维持192/68/67。

## 2026-10-29 R1-304 价格预览立即失效与确认门禁

- c6be378已push。BillingView单台和批量在价格、结算方式、目标/选择或会话变化时同步作废旧预览与请求代次，150ms防抖期间立即进入加载；提交函数与按钮均要求当前预览、实际版本快照和余额。价格上限对齐后端100000，0价格/版本0有效；预览余额/剩余天数0不回退列表旧值，弹窗金额与余额不足判断同源。
- test-billing-price-preview.mjs真实Chrome先红（before.log：20改30同事件直接提交，实际1次API）→final-r4完整通过：单/批防抖窗口、晚回执、ABA、价格/结算/目标/选择、session/account/role/logout、同session刷新、离页缓存/卸载、非法价格/回执、零价格/余额、错误保留与重试、确认实际payload与重复提交。1440/768/390截图已看，修掉截图发现的余额0却显示旧100；后端收费/退款链路仅审查，本阶段未跑真实计费事务。
- client type-check、frontend-route/frontend-i18n/admin-billing-route-id三守卫、manifest194/142通过；eslint零错误、9条原有充值记录缩进warning（不在本次改动区域）。takeover-billing-price-preview-build-final-r2.log最终双端构建含vue-tsc exit0，dist.log边界守卫通过，新增Chrome专项已接CI。
- 本项先修预览与首次提交门禁；提交后会话切换的旧成功回执、失败后错误预览/旧版本重用、辅助刷新以及后台审计事务仍待下一段。R304从待修进入部分修复，327按唯一编号现192项已有修复/复验（含部分）、68项已有防护/实现不同、67项待精修；192不是全部完成。

## 2026-10-29 R1-303 存储容量浏览器断言收敛

- 3b033ce已push。针对be0ba6c CI的容量弹窗可见性失败，保留实际布局核验，等待真实字体/有限弹窗动画结束后测量；相邻DOMRect边界允许0.001px计算误差。未修改产品布局/业务，也不关闭真实动画来掩盖问题。
- takeover-storage-layout-diagnostic.log实际Chrome中英20宽度组合通过；rounding.log在原生scale(0.95–1)复现相邻边界约0.00003px偏差可触发旧严格比较。这解释了可复现的同类失败，但历史CI没有几何明细，不能据此断言唯一原因。final-r2.log通过1440/768/390正常/实际scale0.955与人为1px遮挡必须失败的正反校验；新增失败时边界详情与断言前截图。语法/路由守卫通过，上一提交双端构建不变；该测试已接CI，待新提交实际运行。

## 2026-10-29 R1-303 存储编辑只提交实际改动字段

- 35dd8ba已push。HostStorageTab编辑弹窗固定打开时描述/用途基线；只改用途发送purpose-only进入既有本地事务，扩容不附带旧描述/用途，明确清空描述仍传空字符串；未登记用途的显示默认不自动落库。无修改或恢复原值保存直接关闭，不写API、不刷新、不报保存成功；失败重试保留原基线，列表异步刷新不改变用户实际改动字段。
- 真实Chrome先红：takeover-storage-edit-payload-before-r2.log确认用途操作夹带旧描述；final.log通过DOM用途选择/保存、两种用途、描述清空、容量、组合、null、无修改、失败重试及列表刷新矩阵，原目标/session/cache/busy/旧回执完整回归通过。inputs.log容量边界回归通过；1440/768/390截图已检查，既有布局无变更。夹具验证的是实际Vue组件与请求参数，不是宿主磁盘操作。
- client type-check、frontend-route/frontend-i18n/host-route-id三守卫、单文件eslint零错警、manifest194/141及diff通过；takeover-storage-edit-payload-build.log双端构建含vue-tsc exit0，dist.log边界守卫通过。原writes专项已在CI，无新增常规测试计数。只完成R303的前端接线，不新增原编号；混合远端操作权限/持久恢复仍待。
- 顺带核CI：be0ba6c的Go步骤已通过，但storage-inputs可见性断言失败（takeover-ci-be0ba6c-failure.log）；旧3fd4488的/proc IO错误不能据一次后续通过宣称根因已修。35dd8ba等后续CI仍运行，完整327/网关灾备未完成。

## 2026-10-29 R1-303 用途专用提交当前权限与审计事务

- 060b8c0已push。只传purpose的PATCH现在完全本地提交，不连接Incus；检查实际登记池，不再对零匹配返回成功。事务内按host/share→pool/update→actor/update锁顺序复核当前宿主归属、池身份/时间/实际字段及active/session/current role；用途与原storage.update审计同提交，失败均回滚。混合description/size变更仍走原远端路径，其授权/持久恢复不能算已覆盖。
- test-review-storage-purpose.ts真实PG/Fastify先红离线宿主500；takeover-storage-purpose-auth-final-r2.log通过离线保存、missing404、owner/admin、非owner/无sid、8组真实锁竞争（封禁、单session/全session撤销、host owner、pool描述/name、同时间戳config、admin降权），全部旧请求拒写且零成功审计；真实审计trigger失败回滚用途。原容量/用途/ETag/错误矩阵auth-regression.log通过。
- 后端最终build含tsc、host-route-id/host-pool/auth-session-status三守卫、manifest194/141、diff通过，专项登记CI。无前端改动；发现当前UI总发description，因此普通页面只改用途仍会走混合路径，下一段需按打开时基线只提交改过字段并浏览器验证。本项是后端专用路径阶段，不能扩成全部存储权限修复。

## 2026-10-29 R1-303 存储导入必须确认不存在

- 4c95b8b已push。useExisting原先吞掉getStoragePool全部异常，403仍发送POST导入，实际PG/Fastify/mTLS先红见takeover-storage-import-before.log。现只接受该编码池路径的IncusApiError404进入导入；鉴权、网络、服务端错误保留，getStoragePool核实际name/非空driver/config字典且编码路径，不能把错误对象登记成已有池。
- takeover-storage-import-final.log通过403/500/断开/错池名/数组配置/缺driver零POST、零DB与成功日志，已有真实池只关联并保实际驱动配置、重复关联不再读取、确切404导入并核后续详情、导入/核验失败不登记成功。远端是隔离mTLS协议夹具，不是真实VG/文件系统导入；远端导入成功但确认失败的恢复/幂等仍后续。
- 后端build含tsc、host-route-id/host-migration-consistency/incus-certificate-paths三守卫、manifest194/140和diff通过，证据takeover-storage-import-{build,guards,manifest}.log，专项登记CI。无前端文件变更。下一段继续平台用途/元数据的当前权限与零匹配假成功；远端变更持久恢复及完整R303/327/R269/Go proc/灾备未完成。

## 2026-10-29 R1-303 容量更新预检查与误判纠正

- ba82a01已push核远端。固定Incus1806849的backend.go:295已有统一Pool cannot be shrunk，三驱动Truncate前受此保护，不能报告上游必然缩容损坏。平台此前只校验正数，现按本次ETag读取的真实当前容量做BigInt比较，在远端PATCH前明确拒缩容、未知/非法/max当前容量和dir容量更新；空容量仍允许描述/用途，等量不同单位移除size避免触发无效扩容。其它驱动实际支持与物理设备限制仍由Incus检查，本项不写死安装路径或推断Loop身份。
- takeover-storage-resize-before.log隔离mTLS显示平台会发送缩容，表示前置校验缺失，不当作原生Incus允许缩容。final.log验证lvm/zfs/btrfs、大于2^53字节、GiB/MB/相同单位、dir与描述-only；api-final.log真实PG/Fastify通过400/409具体code、零PATCH、用途描述不变，先前容量/用途/ETag错误矩阵全部回归。后端build含tsc、3守卫、manifest194/139、diff通过，沿原CI专项。无原生Linux磁盘调整/生产操作。
- R303下一段发现useExisting在任何getStoragePool错误后都当作不存在并可能导入，需仅精确404进入导入，其它鉴权/网络/服务器错误保留；尚未修改。当前授权、远端DB恢复、原生存储验收、R269/Go proc/327及完整灾备未完成。

## 2026-10-29 R1-303 存储更新保留描述与配置版本

- 088165e用途修复已push核远端。上游Incus固定18068492788d26b3aad307b1331703c0d69c27db的storage_pools.go确认PATCH只合并config，省略description仍以空字符串更新。现在更新前读取真实池名/描述及ETag，复制本次提交，省略描述时保当前值，明确空字符串仍清空；PATCH携带If-Match并共用120秒期限。仅平台用途的空远端更新直接跳过，冲突不盲重试，API以409持久提示刷新重新确认。
- 新test-review-storage-update.ts真实固定证书mTLS先红描述被清空；takeover-storage-update-final.log通过描述/配置保留、明确清空、空操作、缺ETag/错池名/读失败零写、412旧写保新配置、更新失败及证书变化零HTTP。先红后的Node24/Windows清理附加UV_HANDLE_CLOSING断言不作为产品根因，最终正常exit0。
- 实际PG/Fastify扩展takeover-storage-update-api-final.log通过409/502/读写失败时不改本地用途描述、不记成功日志，以及用途和原容量矩阵；底层mTLS fixture现在维护真实池状态并验证If-Match，PATCH用例先建立已有池。takeover-storage-update-transport-regression.log原恢复传输的sync/async/总截止/取消/固定TLS/404语义回归通过。后端build含tsc、4相关守卫、manifest194/139、diff通过，专项接CI；无前端产品改动。
- ETag保护远端读取与本次配置写入，不代替当前账号/宿主授权、远端成功但本地提交失败的恢复，以及真实Linux存储驱动验收。容量缩减/驱动限制继续核查固定上游公共层及实际调用；327/R303/R269/Go proc/完整灾备仍未完成。

## 2026-10-29 R1-303 存储池用途保存

- be0ba6c已push核远端。实际PATCH传purpose但db.updateStoragePool的类型及字段映射均遗漏用途，接口200而仍按原用途选系统盘。新增StoragePurpose字段及条件更新，route采用明确UpdateStoragePoolData避免any掩盖丢字段；省略用途仍保原值，配置及其他池不改。
- 扩展现有真实PG/Fastify/mTLS专项，takeover-storage-purpose-before.log先红200后仍instance_data；takeover-storage-purpose-final.log通过双向切换、系统盘资格跟随、组合描述与用途、空描述/省略用途保留、其他池不变、非法用途400零远端，原容量30非法/14合法及省略矩阵回归通过。mTLS端为协议夹具；没有真实Incus磁盘或客户实例写入。
- 后端build含tsc、host-route-id/host-pool/dedicated-delivery三守卫、manifest194/138与diff检查通过，证据takeover-storage-purpose-{build,guards,manifest}.log；扩展专项沿原CI入口，无前端文件改动。存储变更当前授权、远端/DB原子性、驱动容量能力、并发创建/更新仍继续，未以此小项声明R303/327或完整灾备完成。

## 2026-10-29 宿主分页真实字段与修复统计复核

- 97eafe3已push并核远端一致。接续草稿的getHostsPaginated漏select architecture，ARM在实际GET /hosts被默认显示x86；同时漏IPv6公网/绑定地址、IPv4绑定地址及IPv6同步状态。现补选取与映射，两条带/不带owner查询均按name、id排序，跨owner同名分页顺序明确。仅列表读取，未改一机一卖或客户网络交付。
- takeover-host-pagination-before.log真实PG/Fastify复现aarch64返回x86_64；早期final夹具把同owner的104台都命同名，被已有user_id+name唯一约束拒绝，未记通过。本次改为104个独立测试owner的同名节点，保留DB约束；takeover-host-pagination-final-r2.log exit0，105条两页无重复/遗漏、includeOwner两分支、hosted列表/用户筛选、IPv4-only空值、ARM网络状态、证书路径不出API及普通用户不能越权均通过。只创建/清理本次随机前缀的隔离库记录，未连接真实宿主。
- 后端build含tsc exit0（takeover-host-pagination-build.log），host-route-id/host-migration-consistency/host-public-ipv6三守卫通过（takeover-host-pagination-guards-final.log），manifest194/138及diff检查通过。专项登记CI；首轮误以正则组合传--only，清单拒跑，改重复--only后实际3/3通过。本项无前端变更，未重跑无变化双端构建；分页期间并发新增/删除的一致快照与真实宿主/生产验收仍待。
- 重新按327原编号统计，发现R021已随80cadce的R301批量配置修复，R324已随6c8b219/0444f64的R302配额编辑/提交修复，旧行漏登记。本次核当前源码及已有Chrome成功日志并补交叉引用：现191项已有修复/复验（含部分及待运行）、68项保留已有防护/实现不同、68项待精修。不是本次多修两项；191不是完整验收数，剩余还包括其未完成范围。R303分段不重复加数。
- 下一段继续R303存储驱动/禁止缩容与当前授权、兑换事务日志及旧迁移并发补偿；R269通用持久恢复、Go实际/proc CI失败、完整网关灾备继续未完成。本项不是发行或部署证据。

## 2026-10-29 R1-303 存储容量API边界

- f440d33已push核远端。创建和修改存储池接口在Incus连接前校验显式容量：正整数、Incus支持的大小写敏感字节单位、有符号64位总字节上限；保留合法历史单位和首尾空白规范化，省略容量仍允许描述清空/用途修改，显式空/零/负数/非法单位/小数后缀/溢出拒绝400。页面可精确的小数此前已转换整数字节，后台不隐式取整。
- test-review-storage-size.ts原回环先红-1GiB到Incus准备500，扩展真实PG/Fastify+mTLS先红非法空容量仍发连接；takeover-storage-size-api-final.log完整exit0，30组非法创建/修改检查零远端请求与零池记录，14组合法单位/上限/字节有效写payload和省略size描述修改通过。mTLS为隔离传输fixture，不是真实Incus磁盘调整；只清理该夹具记录/临时证书，凭据未提交。
- 后端build含tsc exit0（takeover-storage-size-api-build.log）；host-route-id新增实际解析边界、host-migration-consistency、incus-certificate-paths共3守卫通过（takeover-storage-size-api-guards-r3.log），manifest194/137，专项接CI。首轮only不存在直接拒跑；随后迁移守卫因编辑工具写CRLF导致严格LF片段失配，恢复LF后全部通过，未放松断言。
- 当前授权、远端/DB/日志原子性、驱动支持/仅扩容、同名分页和旧迁移补偿仍待；327编号统计仍189有修复/复验（含部分）、68保留防护/不同实现、70待精修。Go proc/R269/完整灾备未完成。

## 2026-10-29 R1-303 存储容量输入与弹窗滚动

- b97fff5已push核远端。创建/编辑容量按完整十进制格式与GiB/TiB单位校验，BigInt精确比较至少1当前单位及有符号64位字节上限，合法小数精确转为整数字节（Incus原生只解析整数+单位），不能整字节表示者拒绝；拒绝负数、零、指数/垃圾后缀和超范围，编辑空字符串保持只改描述，数字0不再静默省略。文本数字输入保留原始值交由校验，不让Vue number隐式转换掩盖非法格式；错误三语齐全。
- takeover-storage-inputs-before.log真实Chrome先红-1GiB发出请求；final-r4完整矩阵exit0，含create/edit零与省略、单位/格式/范围、小数、真实输入及1440/390两视口。原读取/写入回归通过；最终route/i18n/host-route-id三守卫通过；新增滚动wrapper引起289项缩进warn，纯缩进修正后lint-final零错警，逐行lstrip核对无语义改动，types通过。截图发现fieldset内部滚动溢出，改外层div滚动，错误/按钮固定可见且不与表单重叠，第三次截图及几何断言核验。最终双端build含vue-tsc exit0（takeover-storage-inputs-build-final-r2.log）、dist通过（takeover-storage-inputs-dist.log），manifest194/136，专项接CI。
- Incus上游shared/units/units.go固定blob afbce5283a07e8fb4d616c9a5415b8ac53091423代码核对只接收整数+单位，因此小数精确转换B；本机Go shim目标缺失，原生解析试跑未执行，未把该日志算通过。真实Incus扩容仍待。
- 后台test-review-storage-size.ts已真实PG/Fastify先红：-1GiB未在远端连接前拒绝400，而进入Incus准备并500；见takeover-storage-size-api-before.log；扩展mTLS夹具before-r2还先红空容量连接宿主，原后台尚未修改，专项不随此批提交。下一步独立修API格式/上限/单位边界；驱动真实扩容能力、禁止缩容、当前授权及远端/DB原子性继续待验，本批不操作真实宿主磁盘。
- 按327原编号去重统计：189项已有修复或复验记录（含部分完成/欠真机），68项保留已有防护/实现不同结论，70项待精修或运行复核。189不能全算完成，剩余包括70及189中的未完成范围；R303分项提交不重复增加编号数量。327/R269/Go proc与完整灾备未完成。

## 2026-10-29 R1-303 兑换码复制回执与批量结果弹窗

- 03450cf已push并核远端；8e9e15d CI已success，4cde9e6/09c6c77/03450cf最后运行。单码/批量复制增加请求序号、host/session/页面及结果弹窗代次，校验当前码值/批次；旧回执及旧定时器不覆盖新反馈，切换/卸载清理定时器，剪贴板拒绝或不可用持久显示失败。实际剪贴板写入是受控fixture，未读取或覆盖owner系统剪贴板。
- 批量结果弹窗补role/aria、初始焦点、Tab/Escape与返回焦点，创建弹窗关闭不会抢走结果焦点；限高滚动、长批次/码值换行、固定可见关闭和复制按钮。底层兑换码创建/兑换/库存/账目未改。
- takeover-redeem-copy-before.log真实Chrome先红旧host复制回执误标记；takeover-redeem-copy-final.log完整exit0，含反序/拒绝/retry/旧计时器、未知码值、host ABA/session/role/account/logout/filter/cache/unmount、同sid、同ID码值变化、真实创建后批量复制/关闭重开、两视口100码列表与键盘。读取/写入完整回归各exit0；types、route/i18n/redeem-code-management三守卫、lint零错警、manifest194/135通过。最终双端build含vue-tsc exit0（takeover-redeem-copy-build.log），dist另见takeover-redeem-copy-dist.log；专项已接CI。
- 下一项存储容量test-host-storage-inputs.mjs未提交，Chrome先红负容量发送到host，产品未改；需完整数字/单位/0与省略区分、扩容/驱动能力和后端参数校验，原生Incus容量调整与后端授权/原子性仍待。327/R269/Go proc与完整灾备未完成。

## 2026-10-29 R1-303 旧迁移写目标、父入口与结果

- 09c6c77已push核远端。迁移提交复制源/目标/实例ID/镜像/套餐，绑定session及页面/弹窗代次；重复和在途关闭拒绝，跨切换保留busy，旧成功/失败不刷新新源或改写新弹窗。回执校验全部ID唯一性及成功/失败计数，部分成功结果页不可重放整批；当前失败持久展示。
- 父入口真实Chrome复现点击同tick勾选从1变2导致迁移2（takeover-migrate-parent-before-r3.log）；现在点击同步复制实例及ID，提交前复核当前归属/Incus/宿主/套餐/类型，缺失、deleted或专属实例拒绝。父子busy联动，列表刷新失败保留已完成迁移结果，键盘焦点/Tab/Escape完善。专属机器仍走机器池换机，全端口交付及用户隐藏端口转发保持，未执行客户或原生Incus迁移。
- takeover-migrate-writes-final.log与takeover-migrate-parent-final.log完整Chrome矩阵exit0，含目标/source ABA/session/role/account/logout/cache/unmount/reopen、回执、当前身份、同页刷新、辅助失败、真实点击、键盘及两视口截图；读取与batch-config完整回归分别见takeover-migrate-writes-read-regression.log/parent-regression.log。Chrome清理稍慢；检查时测试进程已退出，未实际终止任何进程，全部自然exit0。
- client types、route/i18n/host-migration-consistency三守卫、lint零错警、manifest194/134通过，两个新专项接Chrome CI。最终双端build含vue-tsc exit0（takeover-migrate-writes-build.log），dist单独守卫见takeover-migrate-writes-dist.log。首轮父夹具按钮翻译名错误及一次Python缺UTF-8均修正，第三次准确复现目标错选；不把夹具错误当产品证据。
- 迁移后台当前授权/并发/补偿、宿主分页同名排序/并发变化仍待。下一项兑换复制已建test-host-redeem-copy.mjs独立先红，产品未改；旧clipboard回执/拒绝处理、批量结果弹窗需继续。327/R269/Go proc与完整灾备均未完成。

## 2026-10-29 R1-303 旧迁移目标读取与选择

- 4cde9e6已push核远端；27cb569源码CI已success，8e9e15d/4cde9e6最后仍运行。旧迁移host/images/plans读取分别绑定请求序号、源/目标、session、visible及cache生命周期；旧回执不覆盖当前选择。错误持久显示并可重试，失败/未知选项禁止提交。删除原300ms关闭回调，重开不再被旧回调清空。
- 宿主原pageSize200被后端限制100且只读一页，现按100逐页读取完成后展示，校验真实分页/条目/重复ID；同目标刷新保仍有效镜像/套餐。待迁移实例在打开时复制，付费要求/计数和提交ID统一此快照，非法/缺失/超过30项不提交；机器池专属迁移409门禁及旧后端流程保持。该阶段未操作真实客户或Incus迁移。
- takeover-migrate-reads-before.log真实Chrome先红旧images覆盖目标；takeover-migrate-reads-final.log通过多页宿主、目标ABA、同目标反序、刷新保选项、错误retry、非法回执、源/session/role/account/logout/cache/unmount/close、固定选择/非法提交和两视口。types、route/i18n/host-migration-consistency三守卫、lint零错警、manifest194/132通过，新专项接Chrome CI。最终双端build含vue-tsc exit0与dist通过，分别见takeover-migrate-reads-build.log/takeover-migrate-reads-dist.log。
- 下一项test-host-migrate-writes.mjs已先红旧source写回执触发新source的success刷新（takeover-migrate-writes-before.log）；扩展固定目标/重复/关闭/session/非法回执/部分成功不可重放矩阵已写未跑，写产品未修。父入口同步固定与current实例复核、写回执隔离及后台并发/补偿仍待，宿主分页同名排序/并发列表变化需后端另核；327/R269/Go proc/完整灾备未完成。

## 2026-10-29 R1-303 宿主兑换码写目标与结果

- 8e9e15d已push核远端；0444f64/794e336/a27e991源码CI已success，27cb569/8e9e15d最后仍运行。创建/启停/批量删除共用busy门禁，绑定host/session/页面及弹窗代次；切换/重开旧回执不刷新或关闭当前页，跨切换保留在途busy。删除固定开框时ID/码值并保后来新选择，启停固定方向且更新同页刷新后的对象，成功失效旧列表；辅助读失败不改写已提交结果。
- 创建数值/数量/使用次数完整整数与范围、资源类型/日期/备注校验，提交固定草稿，批量回执数量/唯一性及单码ID检查；失败持久显示。使用过或并发消失的码返回409/404后刷新实际部分结果，保错误提示，不伪装全部删除。创建/删除弹窗busy禁关闭/禁改，标签、键盘焦点/Escape/Tab和手机限高完善；手机列表全选入口保留。后台事务/当前授权及日志失败一致性未改。
- takeover-redeem-writes-before.log Chrome先红旧create刷新新host；最终takeover-redeem-writes-final-r3.log完整矩阵通过，含create/toggle/delete重复/目标/旧回执/会话/cache/关闭、批量与部分结果、新勾选、输入边界、同sid/旧列表、真实点击/手机全选及两视口截图。takeover-redeem-writes-read-regression.log读取完整回归通过；受控API没有真实兑换码写入。首轮浏览器清理滞留，核进程后仅终止该夹具Chrome，脚本随后exit0；r2/r3均自然关闭浏览器和server并exit0。缺翻译key与control-regex lint已修后重跑。
- client types、最终双端build含vue-tsc exit0（takeover-redeem-writes-build.log）、3守卫（route/i18n/redeem-code-management）、lint零错警、manifest194/131通过；dist记录takeover-redeem-writes-dist.log。新写专项接Chrome CI。复制剪贴板回执/批量结果弹窗与输入文案细化仍需继续，不能记R303整体完成。
- 下一项MigrateHostModal读取已Chrome先红：切目标后旧images覆盖新目标（takeover-migrate-reads-before.log）；host-migrate三fixture及test-host-migrate-reads.mjs未提交，产品迁移未改，完整组件、父调用、后端迁移route及consistency守卫已读。需host/plans/images请求序号、session/弹窗生命周期、固定选择与300ms关闭回调；旧后台迁移并发/补偿另待，专属机器409门禁保持。327/R269/Go proc/完整灾备未完成。

## 2026-10-29 R1-303 宿主兑换码读取与分页

- 27cb569已push核远端；其CI类型/构建/双架构组件及部分集成通过，交付集成最后仍运行。兑换码列表/options/usages分别绑定host/session/请求序号/激活状态，旧回执不回写，切host/账号/角色/logout/cache/unmount清列表、选中与弹窗；同sid刷新保留。错误持久重试，非法回执拒绝，同页保有效选择、翻页/筛选清选择，删除末页回退合法页。
- options必须成功读取才创建，刷新不覆盖新草稿，默认值按重置后的CPU类型；使用记录支持真实limit/offset翻页和最后页修正，绑定code与弹窗代次。手机原表格裁掉右侧操作，已改桌面定宽表/手机卡片，分页显示实际页数和条数；使用记录dialog/键盘焦点/Tab/Escape补齐。历史p码只读兼容保留，创建仍仅c/r/d/t；后端资源兑换及专属机器交付未改。
- takeover-redeem-reads-before.log旧host覆盖先红；takeover-redeem-reads-final-r5.log真实Chrome完整矩阵通过，含反序/ABA/筛选/分页/选择/错误retry/options草稿/usage重开/各生命周期、退役p码、两视口所有按钮可见及键盘。初轮测试直接序列化Vue Proxy失败，改提取JSON；截图发现裁切、i18n守卫发现缺key、焦点专项发现误绑相邻弹窗，均修复后重跑。p码兼容专项先红后通过，未恢复创建。
- client types及最终双端build含vue-tsc exit0（takeover-redeem-reads-build-final.log）、3守卫（route/i18n/redeem-code-management，takeover-redeem-reads-guards-r4.log）、lint零错警、manifest194/130通过；dist另记takeover-redeem-reads-dist.log。新读取专项已接Chrome CI，受控API没有真实兑换码写入。
- 下一项test-host-redeem-writes.mjs已先红旧create刷新另一host（takeover-redeem-writes-before.log），扩展create/toggle/delete/目标/重复/关闭/session/新选择/部分删除矩阵已写未跑，产品写回执未改；前后端route/DB/管理守卫已读。需固定写目标与代次、busy/关闭/旧回执、真实启停方向、使用过的码删除409后实际禁用刷新，后端授权/批量事务及日志失败一致性另待。327/R269/Go proc/完整灾备未完成。

## 2026-10-29 R1-303 宿主存储写操作目标与回执

- a27e991已push核远端；0444f64/794e336/a27e991源码CI最后仍运行。Storage创建/导入/编辑/删除共用busy门禁，写入固定host/session/激活与弹窗代次；旧回执不刷新新宿主、不关闭新弹窗，跨切换保留在途busy。编辑名称固定，创建名完整校验；当前错误持久展示，辅助列表失败不误报写失败，成功失效较早读取。使用中、非Created及数据库fallback存储池禁止从页面删除。
- 弹窗提交期间禁改/禁关闭，键盘Escape/Tab与焦点恢复补齐，手机限高滚动。takeover-storage-writes-before.log先红旧create刷新另一host；takeover-storage-writes-final-r2.log真实Chrome通过四类操作、重复/互斥/关闭、错误重试、辅助失败、host/session/account/role/logout/cache/unmount、旧读取及强制重开等矩阵。读取完整回归与两视口截图通过；受控API未执行真实Incus存储写入。
- client types、route/i18n/host-route-id三守卫、lint零错警、manifest194/129通过；takeover-storage-writes-build.log最终双端build exit0，takeover-storage-writes-dist.log通过。专项已接Chrome CI。后台存储授权/远端与DB原子性、数字大小完整校验另待，不能视为存储全流程完成。
- 下一项兑换码读取夹具已先红host1迟到覆盖host2（takeover-redeem-reads-before.log），产品尚未改；列表/options/usages目标、session与请求序号需继续，写操作另分批。机器池一机一卖全端口及用户隐藏转发入口保持，未操作客户网络。327/R269/Go proc CI/完整灾备未完成。

## 2026-10-29 R1-303 宿主存储列表读取隔离

- 794e336已push核远端；6c8b219源码CI已success，0444f64/794e336最后仍运行。Storage列表按host/session/请求序号和激活状态绑定，mount/activated只初读一次；换host/账号/logout/cache/unmount清列表和旧弹窗。旧成功、失败与finally不覆盖当前列表/loading，非法ID不发请求，非法/重复条目拒绝；错误持久显示且可重试，Incus不可达的数据库fallback警告在有/无列表时均展示。
- takeover-storage-reads-before.log Chrome先红host1迟到覆盖host2；takeover-storage-reads-final-r2.log通过同host反序、host ABA、错误retry、非法回执/ID、session/role/account/logout/cache/unmount、同sid刷新和fallback警告。1440中文/390英文截图已核，前端受控API无真实存储写入；列表名称/配置换行以适应手机。
- client types、route/i18n/host-route-id三守卫、lint零错警、manifest194/128均通过；最终双端build exit0与dist检查通过，新专项已接CI。
- 下一项test-host-storage-writes.mjs已先红旧create刷新另一host并关闭新弹窗，完整create/import/edit/delete、重复、旧回执、retry矩阵已写未跑；产品写函数未改。相关route/Incus调用/DB/守卫已读，下一步固定目标/草稿与操作代次、busy/关闭门禁、持久错误、成功与辅助读取分离，后台授权/远端与DB原子性仍另待。327/R269/Go proc CI/完整灾备未完成。

## 2026-10-29 R1-303 旧批量迁移的专属机器入口隔离

- 0444f64已push核远端；8218018源码CI已success，0444f64/6c8b219最后仍运行。旧批量迁移为套餐新建后删源，增加专属实例及singleTenant源/目标宿主的整批拒绝，沿现有DEDICATED_HOST_CHANGE_MANAGED提示使用机器池故障换机，在Incus连接/资源预占前返回409；普通套餐迁移既有权限及路径保留。没有改动专属交付、全端口或实际客户数据。
- takeover-migrate-dedicated-before-r2.log真实Fastify/PG先红：专属实例进入源Incus连接并因测试未配置证书失败。最终takeover-migrate-dedicated-final-r3.log通过admin/host owner×专属实例/源宿主/目标宿主/混合选择、非owner拒绝、普通套餐保留原连接阶段；逐次比对实例/宿主/地址/到期/余额/账单不变。端点仅闭合回环，未执行原生Incus迁移。夹具首轮错用billingRecord、随后单租户约束拒绝两实例/规格不足，改合法夹具并保留DB约束后通过。
- 后端build含tsc exit0、host-migration-consistency/host-route-id/host-pool/dedicated-delivery四守卫通过、manifest194/127和diff检查通过。专项登记CI。server无ESLint配置/脚本，直接调用失败如实保留，不借用前端规则伪装通过；本次采用类型、相关守卫及代码审查。没有前端改动。
- 此项只补现存专属目标入口隔离，不代表旧批量迁移并发事务/资源补偿已安全，也不代替机器池换机实证；中途身份和host角色竞态随旧迁移事务继续修。R303下一步Storage/Redeem列表读代次、迁移弹窗目标/读取/写回执；Go实际/proc CI、R269、327和完整灾备仍未完成。

## 2026-10-29 R1-302 配额提交校验与回执隔离

- 6c8b219已push核远端；6cacb0a/e488cb8源码CI已success，8218018/6c8b219最后仍运行。配额提交仅管理员/宿主owner当前页面可用，函数与按钮共享busy门禁；固定实例/宿主/归属/Incus身份与session代次，切换后及ABA旧回执不提示、不刷新。跨切换保留在途busy，成功只归一化未再编辑字段，较早轮询失效，新草稿保留；辅助读取失败不改写已成功结果。
- 端口1–1000/快照0–1000完整整数校验，空输入发送null，NaN/Infinity/非完整数字拒绝；按真实使用量校验null/0下限。PATCH只发送有变化的字段，保留原端口0（包含专属机器）；单独声明真实配额API请求/回执类型，三语文案改为准确无额度语义，标签/错误关联补齐。专属交付/整地址与全端口规则未改。
- 先红takeover-quota-submit-before.log；最终takeover-quota-submit-final-r4.log真实Chrome通过0/null/空值/范围/实际用量、原生非法数字/按钮、重复/失败重试、新草稿/旧读取、换目标/权限/会话/logout/unmount/ABA与管理员。两视口截图已核。r3原生badInput断言因Vue回写重置DOM标记失败，改断言实际非法表单与零提交后完整重跑，未修改产品规避。
- client类型、3守卫、lint0error/48既有模板warning、manifest194/126、编辑及详情生命周期两完整Chrome回归、双端build exit0/dist通过。新增专项接CI；真实Fastify/PG的0/null/角色/并发验证沿上一阶段证据，后台规则未修改。前端类型首轮报旧导入/数值返回类型，修正后通过；pnpm参数解析失败后直接调用同一run-tests.mjs，3项均执行通过。
- R303完整迁移route已读：旧批量迁移走新建/删源而非机器池replace_host，缺专属实例和singleTenant宿主显式隔离，且UI读取/目标/回执及失败补偿仍待。先补一机一卖门禁并实证，再继续UI；未执行任何客户迁移。Go实际/proc CI失败、R269、327项及完整网关灾备仍未完成。

## 2026-10-29 R1-302 配额编辑载入与草稿保护

- 8218018已push核远端。详情配额表单优先读取真实snake_case并保留兼容字段，0/null不折叠；以每字段原值判断是否有编辑，轮询只更新未改字段，不冲掉草稿。子表单双向同步带相等门禁，父刷新与新实例切换正确跟随；用真实quota_usage/remaining_quota显示用户使用量，系统端口不混入，快照最低值按0及实际用量。
- `takeover-quota-editor-before.log`Chrome先红真实5/3显示null/null；`takeover-quota-editor-final.log`通过真实字段/用量、子表单刷新、原生输入与轮询保草稿、换实例0/null及1440中文/390英文截图。client types、3守卫、lint0error/48既有模板warning、manifest194/125、完整详情及配额显示两Chrome回归、双端build exit0/dist通过，专项接CI。
- Owner再次确认全端口和用户不显示端口转发，已写OWNER_REQUIREMENTS。复核pool-orders专属标记、dedicated-network整IPv4地址与IPv6 TCP/UDP 1–65535交付、InstanceNetworkTab专属门禁均保持。新增`takeover-dedicated-customer-port-ui.log`真实Chrome专属用户桌面/手机显示公网地址且零端口转发/配额入口，截图已核；host-pool与dedicated-delivery两守卫通过。没有改交付、客户网络或生产。
- 下一项`test-instance-quota-submit.mjs`与API夹具扩展未提交：`takeover-quota-submit-before.log`已先红无快照时0被拒，矩阵继续；本批未修提交。需校验完整整数/空值按null、snapshot0、按钮/函数busy与当前资格、固定对象/session/旧回执、成功刷新不误报和新草稿保护，并纠正“空或0自动补额度”文案。R302整体/327/R269/完整灾备未完成，3fd4488实际/proc CI失败仍待。

## 2026-10-29 R1-302 配额显示与实际执行对齐

- e488cb8已push核远端；80cadce/5c9b825源码CI已success。宿主列表和工单实例卡的端口/快照/备份0显示有限额度，站点0仍无限；缺使用量保持未知，不从0剩余伪造用量。详情保留无限站点入口，快照缺额度按实际0处理。后台详情端口/快照/备份空值默认改为实际执行的0，备份计数仅含creating/ready，排除error/deleted，系统端口继续不占用配额。
- Chrome先红见`takeover-host-quota-before.log`、`takeover-quota-ticket-before.log`、`takeover-quota-tabs-before.log`；最终`takeover-quota-host-final-r2.log`与`takeover-quota-views-final-r4.log`通过0/有限/null/未知、继承入口与桌面手机。截图已核，详情夹具补齐task/traffic等待，避免在骨架页截图；独立Vite缓存避免并发夹具冲突。受控API没有客户写操作。
- 旧本地库缺新表，未当业务先红；新建专用takeover_quota_20261029_pool_test并229正式迁移成功后，`takeover-quota-detail-before-r2.log`真实Fastify/PG先红默认20/5/3。`takeover-quota-detail-final-r2.log`完整通过admin/owner/buyer、0/null/默认/站点继承、端口/快照/备份使用量以及原并发授权/预占/回滚矩阵。夹具曾误给非空套餐siteLimit传null，已改合法矩阵并恢复原套餐值后完整重跑。
- client types、后端build含tsc、5守卫（route/i18n/instance-quota-zero/port-mapping-safety/instance-route-id）、manifest194/124、最终双端build exit0/dist通过。lint零错误，48处既有详情模板warning未扩改；完整详情/工单卡Chrome生命周期回归通过，详情首轮并发未挂载后独立重跑成功。两新Chrome专项接CI，真实配额专项沿原CI扩展。
- R302详情配额编辑仍读camelCase而真实响应为snake_case，端口用量还把系统端口算入；空值/0提交、子表单同步及写回执另待，未提前记完整。R303迁移/存储/兑换读取及后台迁移保护继续，3fd4488进程审计CI失败仍待Linux实证，327/R269/完整灾备未完成。

## 2026-10-29 R1-301 批量配置角色字段

- 6cacb0a已push核远端。普通宿主所有者不再显示SWAP与IO/网络/进程/启动高级分区；构建配置、实际发送和重试均核管理员字段清单，直接传入也拒绝并持久提示。管理员保留原12表单字段与原分区，基础资源/配额正常使用。后端已有请求前及锁内当前角色门禁保持，一机一卖不变。
- `takeover-host-batch-roles-before.log`Chrome先红owner可发swapSize；`takeover-host-batch-roles-final.log`通过12字段表单拒绝、14字段直接调用拒绝、普通CPU/site0有效、管理员全部有效、切角色旧回执与两视口。1440中文/390英文截图已核；受控API无真实客户配置修改。
- client types、3守卫（route/i18n/batch-config）、lint零错警、manifest194/122、完整生命周期及数字两Chrome回归、最终双端build exit0/dist通过，专项登记Chrome CI。
- 3fd4488源码CI40799210505失败于Go `TestReadActualProcAuditAndCancellation`，错误`CONTROLLER_PROCESS_AUDIT_IO`，已保存`takeover-ci-3fd4488-failure.log`并读实际/proc审计与守卫，未修或冒称CI绿。专用测试机资料已重新读取；两个固定指纹连接在握手阶段拒绝，第三无已核固定身份（`takeover-test-machine-runtime.log`），未绕过身份或运行远端命令。后续继续排查；R302宿主/工单配额0与默认、详情站点0隐藏、后台默认及备份计数一致性均需续修。R301/327/R269及完整灾备未完成。

## 2026-10-29 R1-301 批量配置数字与零值

- 80cadce已push核远端。批量配置按完整数值语法和后端范围验证，按钮与函数都拒绝截断/非有限/超范围输入；CPU/内存blur不再静默取整。区分原生number输入0与空值，保留各字段原有null语义；流量按十进制系数和BigInt精确换算字节并限制PG bigint，正数舍入成0拒绝，存储带宽单位规范化且保留原有整数iops。
- `takeover-host-batch-inputs-before.log`Chrome先红CPU1e2变1；`takeover-host-batch-inputs-final.log`通过数值/范围/0/null/精确流量、原生输入与IOPS。复核发现本批正则误拦原有100iops，专项先红后补回并最终重跑通过；1440中文/390英文截图已核。受控API无客户配置写入，后台schema/锁/资源规则保持。
- client types、3守卫（route/i18n/batch-config）、批量配置完整生命周期回归、最终lint零错警、manifest194/121通过；IOPS兼容修正后最终双端build（`takeover-host-batch-inputs-final-build.log`）exit0/dist通过，专项登记Chrome CI。
- 后续角色专项`takeover-host-batch-roles-before.log`已先红普通host owner仍发swapSize请求，扩矩阵已写未跑，角色产品未改。R302配额显示先红0端口/快照显示无限，后台详情默认与实际执行也需继续对齐；两项未完成脚本不混此提交。R301/327/R269及完整灾备未完成。

## 2026-10-29 R1-301 批量配置目标与重试回执

- 5c9b825已push核远端。父入口固定已选实例，空选择不再走未在UI开放的全部实例路径；子弹窗按host/session/激活/打开代次隔离，提交复制目标和配置，busy覆盖重开。旧回执不显示或刷新新页；当前错误持久显示，在途禁改表单。Done先保留成功判断再通知父列表，重试仅用服务器允许的失败ID与原配置，累计成功及requiresReview失败继续保留。
- `takeover-host-batch-config-before.log`Chrome先红弹窗选1改勾2发2；`takeover-host-batch-config-final.log`通过固定目标/空选择/重复、Done刷新、仅失败重试/原配置/保人工核查失败、非法及失败回执、host/query/session/cache/logout/unmount。1440中文/390英文截图、Tab焦点循环已核。受控API无客户资源写入，原后台锁/当前身份/资源计数与requiresReview规则保持。首个补验并发加载未挂载，后续完整重跑exit0，未更改产品以绕过错误。
- client types、3守卫（route/i18n/batch-config）及最终route重跑、最终lint零错警、读取及单实例完整Chrome回归、manifest194/120、最终双端build exit0/dist通过；专项接Chrome CI。
- 下一项独立`test-host-batch-config-inputs.mjs`已Chrome先红（`takeover-host-batch-inputs-before.log`）：CPU输入1e2提交1。扩展边界/0/null/流量矩阵已写未跑，数字产品未改，不混此提交。parseInt/parseFloat截断、Vue number输入0被truthy改null、blur静默取整、角色高级字段继续；后端schema与原UI范围已读。R301/327/R269及完整灾备未完成。

## 2026-10-29 R1-301 单实例同步与Swap回执

- 3fd4488已push核远端；98ca675源码CI已success，daaf349/d54246a/3fd4488最后运行。sync/swap固定实例与host/query/session/激活代次，互相覆盖同实例在途门禁，旧回执不提示或刷新新页面；当前sync成功要求success:true。Swap在读取前置busy，强制读当前配置并核序号，失败不得用旧缓存继续；按当前admin-only、running/stopped容器资格确认固定开关方向。成功更新当前列表对象、失效旧配置/在途列表，辅助读失败不误报已提交操作失败；逐实例错误持久保留。
- `takeover-host-single-before.log`Chrome先红旧sync刷新新host；`takeover-host-single-final.log`通过固定sync/swap、重复/准备读门禁、配置失败与取消、非法回执/失败重试、同页已返回/在途列表、旧config、session/同sid/cache/query/host/logout/unmount及两视口。1440中文/390英文截图已核，无溢出或运行异常。初次并发构建时夹具未及时挂载，增加有界等待真实list后最终通过；非产品失败。受控API无真实客户Swap/Incus写入。
- client types、4守卫（route/i18n/operation-conflict/instance-route-id）、lint零错警、读取及重建完整Chrome回归、manifest194/119、最终双端build exit0/dist通过；专项接Chrome CI。后台Swap原当前授权与Incus/DB原子性仍待，R271后台同步保护保持。
- 下一项host-batch-config四文件Chrome先红（`takeover-host-batch-config-before.log`）：开弹窗选1，下一DOM更新改勾2后提交2。扩展矩阵已写未跑，产品批量配置未改；父入口/子完整脚本、batch-config route前半/事务/对应守卫已读。需固定目标、session/回执和busy、成功后Done先清结果导致漏refresh、仅失败重试保原config；数字parseInt与角色字段另需继续。R301/327/R269及完整灾备未完成。

## 2026-10-29 R1-301 重建入口准备数据与固定目标

- d54246a已push核远端；28a1565/a021f9a源码CI已success，98ca675/daaf349/d54246a最后运行。重建父入口固定实例/host/session/打开代次，镜像与SSH公钥列表一起通过当前校验后展示，旧成功/失败不能重开或覆盖其它目标；准备与写入重复门禁。提交核当前本人归属、非封停、内存/类型未变、当前镜像/key选项和命令ID，复制参数，旧回执静默；有效task回执成功后独立刷新，失败持久显示。子弹窗仅增加可选error/disabled，沿用已有选项/session规则；后台重建与机器池一机一卖未改。
- `takeover-host-recreate-before.log`Chrome先红切host旧images/keys重开；`takeover-host-recreate-final.log`通过准备ABA/关闭/失败后重试、空key与非法输入、固定写入/命令副本/重复、当前及旧回执、列表并发、归属/封停、host/query/session/cache/logout/unmount与真实按钮点击。1440中文/390英文截图已核；受控API不执行真实重建或客户磁盘操作。补点击初轮选择器误选列表删除按钮，收紧至弹窗后通过，产品未因此改动。
- client types、4守卫（route/i18n/recreate-consistency/task-query）、lint零错警、通知及读取两个Chrome回归、manifest194/118、最终双端build exit0/dist通过；专项已接Chrome CI。首次guard筛选误用正则，runner拒绝后改重复--only四项，最终4/4通过。
- 下一项host-single-actions四文件已Chrome先红（`takeover-host-single-before.log`）：旧single sync回执刷新新host。sync/swap前后端与operation-conflict/route-ID守卫已读；产品尚未改，矩阵已写未跑。需写回执身份、Swap读配置前busy与新鲜配置、当前目标回写、后台admin-only对应前端门禁。Swap后台当前授权/远端与DB原子性、重建后台锁内当前身份等仍待；R301/327/R269/完整灾备未完成。

## 2026-10-29 R1-301 通知目标、草稿与回执隔离

- daaf349已push核远端；5f2085b源码CI已success，28a1565/a021f9a/98ca675/daaf349最后仍运行。通知固定打开弹窗时的实例集合，数量与提交一致；函数/按钮共同核当前列表、会话、目标和trim后标题1–200/正文1–5000。在途禁重开/重复提交，host/query/session/cache旧回执静默；当前成功保留后来标题、正文及email选择，当前失败持久显示。回执success/count/email计数校验，键盘焦点和关闭门禁补齐。
- `takeover-host-notify-before.log`Chrome先红弹窗1改勾2发2；`takeover-host-notify-matrix.log`通过固定收件实例、重复、新草稿、边界/trim、失败及旧回执、同查询刷新/同sid刷新、host/session/cache/logout/unmount。1440中文/390英文截图与焦点循环已核。受控API未发送真实站内信或邮件；原后端接收人锁与投递事务保持，后台投递不据此新增验收。
- client types、3守卫（route/i18n/inbox-query）、lint零错警、reset及读取两个完整Chrome回归、manifest194/117、最终双端build exit0/dist通过；专项接Chrome CI。
- 下一项重建父入口四文件已Chrome先红（`takeover-host-recreate-before.log`）：切host后旧images/keys仍重新打开弹窗。相关前后端与recreate consistency/route守卫已读，产品重建未改，新夹具不混本提交。须固定准备目标与选项、会话/弹窗及写回执；子RecreateModal已有当前选项/session保护，机器池一机一卖保持。R301/327/R269及完整灾备未完成。

## 2026-10-29 R1-321 流量重置后的带宽提示

- 98ca675已push核远端。三语resetTrafficWarning移除“不会自动恢复/手动恢复固定1Mbps”的错误提示，改为重置后自动检查额度并更新在线运行实例的带宽；账户/实例仍超额继续限速，离线/停止待恢复运行后检查。已逐层核对traffic reset route→running实例查询→scheduler checkAndThrottle/checkAndRestore→带宽仲裁，未改原恢复逻辑或声称网络不可达仍即时恢复。
- `takeover-r321-browser.log`完整reset Chrome回归、1440中文/390英文新文案截图已核无溢出；client types、4守卫（route/i18n/traffic-reset-locks/plan-bandwidth-limit-guards）、三locale lint零错警、最终双端build exit0/dist通过。仅文案变更，实际Incus带宽恢复沿既有专项/原生验收范围，不据此新增生产验证。
- 下一段R301通知四文件先红保持未提交，产品notify未改，目标/新草稿/重复/失败/host/session/cache扩展矩阵已写未跑；完整inbox route及受锁接收人事务/守卫已读。重建父入口仍有迟到images/keys重开与写回执待修，子RecreateModal自身已有当前选项和session门禁，勿重复重写子组件。327/R269/完整灾备未完成。

## 2026-10-29 R1-301 流量重置回执与辅助读取隔离

- a021f9a已push核远端；9c3c320/d855f91源码CI已success，5f2085b/28a1565/a021f9a最后仍运行。reset固定实例/host/session/弹窗代次，按钮与函数门禁、在途禁重开；成功立即关闭确认，独立刷新traffic并复用读取序号，后续读取失败不再把已提交重置报失败。旧回执静默，当前失败持久显示；同页当前列表更新目标，在途旧列表由新查询失效，键盘与关闭保护补齐。
- `takeover-host-reset-before.log`Chrome先红换host旧reset仍继续traffic读；`takeover-host-reset-final.log`通过固定目标/重复/关闭、success:false/失败重试、成功后traffic失败、旧traffic反序、列表已返回/仍在途、host/query/session/cache/logout/unmount。1440中文/390英文截图及键盘已核。受控API没有真实流量清零、客户扣款或带宽写入；后台R271当前授权与计费/基线保持。
- client types、3守卫（route/i18n/traffic-reset-locks）、lint零错警、price及读取完整Chrome回归、manifest194/116、最终双端build exit0/dist通过；专项接Chrome CI。全套与原生带宽恢复不能据此视为完成。
- R321三语resetTrafficWarning仍错误要求手动恢复带宽，已定位并读scheduler及带宽仲裁：重置后对在线运行实例自动核对账户/实例限额再恢复配置带宽，离线/停止或仍超账户额度不会即时恢复，下一项修文案。另host-notify-lifecycle四文件已先红弹窗1改勾2发送2，扩矩阵已写未跑，产品通知未改；完整inbox route/current recipient事务与guard已读。R301/327/R269/完整灾备未完成。

## 2026-10-29 R1-301 续费价格弹窗与新草稿保护

- 28a1565已push核远端。价格弹窗固定当前付费实例，严格有限0–99999及变化值，按钮/函数共用门禁；提交固定host/instance/price和modal/session代次，旧回执静默，在途禁止重开。当前成功更新现有列表对象并保后来输入；同页已返回列表仍正确落价，在途旧列表通过重取当前列表失效。错误持久显示，金额输入窄屏可缩，月份复用三语，增加键盘焦点/关闭保护。
- `takeover-host-price-before.log`Chrome先红host1旧15污染host2原10；`takeover-host-price-final.log`通过重复/关闭、非法/相同/零/99999、保新草稿、失败重试、错误ID/金额回执、刷新已返回与仍在途、付费资格、host/session/cache/logout/unmount，1440中文/390英文截图和键盘已核。受控API，无实际客户改价或发送通知。
- client types、3守卫（route/i18n/host-route-id）、lint零错警、gift及读取两个完整Chrome回归、manifest194/115、最终双端build exit0/dist通过；专项接Chrome CI。后台原续费价格非原子当前授权/计价与通知事务仍待，不以本前端修复代替后台验收。
- 下一段host-reset-lifecycle四文件已先红（`takeover-host-reset-before.log`）：切host后旧reset仍继续发原实例traffic读取；扩展矩阵已写未跑，产品reset未改。已读完整traffic reset route、事务/当前授权、traffic-reset-locks与R271后端专项；前端须隔离旧write/traffic，成功后立即结束确认，辅助读取失败不能把已完成reset报失败。R301/327/R269及完整灾备未完成。

## 2026-10-29 R1-301 赠送时长确认与部分失败重试

- 5f2085b已push核远端一致；9c3c320/d855f91/5f2085b源码CI最后仍运行。赠送弹窗固定已选付费ID，显示数量和提交集合一致；按钮/函数共同要求当前列表、session/激活、合法付费目标及1–365安全整数。原host/ids/days固定，在途跨切换保持busy，旧回执不清新选择；当前成功只移除成功ID，部分失败留明细并仅保失败重试目标，服务器skipped明确接受且不重送成功对象。
- `takeover-host-gift-before.log`Chrome先红弹窗1改勾2提交2；`takeover-host-gift-final.log`通过付费/免费混合、严格天数及365、重复/关闭、失败重试/部分失败、服务器跳过与非法回执、同页刷新不丢成功、host/session/cache/logout/unmount。键盘焦点循环及1440中文/390英文截图已核；错误字符串按发生时语言保存。受控API不实际延长客户到期或写账款。
- client types、3守卫（route/i18n/host-route-id）、lint零错警、批量状态及读取两个完整Chrome回归、manifest194/114、最终双端build exit0/dist通过；专项接Chrome CI。R274后台gift-days当前身份/到期事务保持，未重复执行该无变更DB专项或声称原生到期并发已验收。
- 下一项续费价格四文件夹具已独立先红（`takeover-host-price-before.log`）：host1旧价格回执把host2新目标从10改15。前后端完整price路径、body范围与原host守卫已读，矩阵已写未跑，产品价格函数未改；需目标/弹窗/session回执绑定、有限0–99999、保新输入与当前列表对象。后台价格更新仍为非原子当前授权，另列待审。R301/327/R269/完整灾备未完成。

## 2026-10-29 R1-301 宿主批量封停、解封与状态同步

- d855f91已push核远端；39073c6/bf645b1源码CI已success，9c3c320/d855f91最后仍运行。封停固定弹窗目标/原因与打开代次，三种操作捕获原host/ids及列表/session上下文；按钮和函数共享资格/在途门禁，三种状态写之间防重复并发。旧成功/失败不刷新或清新选择，成功只移除返回成功ID，失败及服务器跳过目标继续保留，明细和请求错误持久显示。
- `takeover-host-batch-before.log`Chrome先红弹窗1改勾2却提交2；`takeover-host-batch-matrix.log`通过固定目标/原因、重复/关闭门禁、部分失败及服务端跳过、错误重试/非法回执、查询/host/session/cache/logout/unmount、同sid刷新、键盘焦点循环与Escape。1440中文/390英文截图已核，受控API无真实封停/解封或Incus/客户网络写入。
- client types、3守卫（route/i18n/host-route-id）、lint零错警、删除及列表两个完整浏览器回归、manifest194/113及最终双端build exit0通过，专项接Chrome CI；dist边界检查另有同阶段日志。后台封停实际停止失败仍记录封停、解封当前状态/授权原子性等不由此次UI修复宣称解决，继续代码级复核。
- 下一段赠送时长已Chrome先红（`takeover-host-gift-before.log`）：弹窗1改勾2提交2；四文件夹具与扩展矩阵未提交，产品赠送尚未改。已读gift-days完整route/事务与原R274守卫，前端需固定付费目标、严格1–365整数、busy/旧回执/部分失败；保持原后台零计费与当前归属事务。R301整体、327/R269及完整网关灾备未完成。

## 2026-10-29 R1-301 宿主批量删除目标与回执隔离

- 9c3c320已push核远端；fb874b9源码CI已success，39073c6/bf645b1/9c3c320最后仍运行。删除弹窗固定打开时的目标，预览严格核对ID集合和有限非负退款金额；确认按钮/函数共同核当前激活、session、列表、目标和退款预览。提交固定host/ids/reason/refund/databaseOnly，在途跨切换保持busy；旧预览/写回执静默，成功保后来勾选，部分失败保明细及失败目标，刷新后重取预览。
- `takeover-host-delete-before.log`真实Chrome先红预览1改勾2却提交2；`takeover-host-delete-matrix.log`通过固定目标、重复/关闭函数门禁、旧预览、两种删除及退款参数、错误重试、换host旧成功、在途禁重开、错/缺/重复ID和非法金额、部分失败、session旧失败、cache/unmount。管理员不退款时预览失败仍允许删除的既有规则保留。1440中文/390英文截图已核，API受控，无真实客户删除/退款或库存写入。
- client types、4守卫（route/i18n/user-destroy-incus-order/instance-delete-incus-order）、R301列表完整回归、lint零错警、manifest194/112及最终双端build exit0/dist通过，删除专项已接Chrome CI。后端权限、退款/远端删除与库存释放规则未改，本项前端验证不代替原生删除验收。
- R301后续封停/解封/同步/赠送、价格、流量重置、重建、通知仍待；批量封停仍使用确认时可变勾选且无函数busy门禁，已读完整相关前后端和host route守卫，下一段继续。327/R269/完整网关灾备未完成。

## 2026-10-29 R1-301 宿主实例列表与辅助读取隔离

- bf645b1已push核远端；e0d71d0源码CI已success。HostInstancesTab列表按序号/host/session/激活绑定，mount/activated仅初读一次，流量与详情各自序号隔离。新查询清旧列表/展开/选择，同查询保仍存在勾选；失败持久错误重试、分页末页纠正、重复/非法/错host响应拒绝。离页/注销/卸载清数据和浮层，同sid刷新不重置。
- `takeover-host-reads-before.log`Chrome先红old覆盖new；`takeover-host-reads-final-r2.log`通过搜索ABA/分页/页长/选择、失败重试/末页、错host/重复、流量与详情反序、宿主/账号/session/cache/logout/unmount。追加同页删除失败刷新保明细并重取当前预览、目标移除清选择。1440中文/390英文截图已核；受控API无实际客户读取或写操作。
- client最终types、3守卫、lint零错警、manifest194/111、最终双端build exit0/dist通过；专项接Chrome CI。初次guard筛选不存在instance-query直接拒绝，改真实名称后通过；原API列表类型缺instances字段使断言不重叠，经unknown边界及运行时校验修正，最终类型/构建通过。
- 下一段R301删除已独立Chrome先红（`takeover-host-delete-before.log`）：预览1改勾2后提交2。host-delete-lifecycle四文件及扩展矩阵未提交，产品删除函数未改；相关前后端preview/delete、管理员/宿主退款边界和原生删除守卫已读。先固定删除目标和modal/session/旧写回执，后续封停/赠送/价格/通知另修。R301整体、327/R269/完整灾备未完成。

## 2026-10-29 R1-298 节点脚本非交互参数与确认

- 39073c6已push核远端一致；95bf9e9源码CI已success。原面板注入值本来已优先合并，保留该行为。Ubuntu/Debian模板新增--yes/-y明确确认；非交互缺mode/token/确认、非法mode/port与卸载/Agent菜单在detect_system之前退出，未传port采用8443，Agent心跳仍60。交互流程与普通确认保留；帮助及docs/host-install-noninteractive.md说明参数。
- `takeover-host-inputs-before.log`Bash真实抽取函数先红已有port但缺确认仍read；`takeover-host-inputs-final.log`19组合通过（默认/明确/短参数/注入IPv6/缺确认/环境不隐式确认/缺值/非法值/菜单），read替身均未被调用。仅测试副本绕root检查并将系统安装替换为边界探针，未安装实际宿主；首次夹具长-c被Windows截断，改临时脚本文件后复现与验证。
- Bash语法、3相关守卫、manifest194/110、最终后端build含tsc exit0；专项登记总清单/CI。无前端变更。完整Linux首装、交互TTY与各网络原生流程仍按已有发行实证分别验收。
- R299原终端按钮嵌套与生命周期已由R282/R283/R284的935dac5/cc5fd54/c71d25c处理，复核当前结构并交叉登记，避免同缺陷重复计数。下一项R301 HostInstancesTab列表/流量/展开详情尚缺请求和宿主/session身份，源码与相关route/guard已读，产品未改；其批量预览/写操作独立续修。327/R269/完整灾备未完成。

## 2026-10-29 R1-297 样例数据脚本限制为本地专库

- fb874b9已push核远端；bd068fe源码CI已success。两seed最先导入共同环境门禁：仅test/development且显式ALLOW_LOCAL_SAMPLE_SEED=1、精确loopback主机、合法*_seed_test库名、PostgreSQL协议/端口、无URL参数/片段才能加载数据库模块。删除bulk的密码子串判定及FORCE绕过、停止输出共享测试密码；操作边界见docs/sample-data.md。
- `takeover-seed-safety-before.log`真实Node脚本配数据库loader替身先红production仍触达DB；`takeover-seed-safety-final.log`两脚本各23拒绝（含生产/未启用/普通库/远程/URL覆盖/旧force）均零DB模块初始化，4本地有效配置各到达替身边界。未执行真实seed写库，不把门禁测试扩大成完整样例数据构建验收。
- 原server tsconfig不含scripts；新增tsconfig.scripts-seed.json将两脚本与完整src纳入检查，暴露既有死声明/未用变量与IPv6字面量类型推宽，最小删除死代码并收紧字面量后`takeover-seed-safety-types-registered.log`exit0。2相关守卫、manifest193/110通过，门禁专项与类型检查均入总清单及CI。无server/src/前端产物变更，沿用前项已完成双端build。
- R293单点、R294实际init、R296升级变量只读结论仍成立；R295已随完整installer guard复核。下一项R298本地Bash抽取main/端口/心跳/确认函数、替换系统写操作后先红：已有port但缺确认仍读终端；脚本夹具首次过长-c被Windows截断已改写文件，最终先红为实际read。产品未改，下一项独立修复。327/R269/完整灾备未完成。

## 2026-10-29 R1-292 工单附件禁用状态与预览生命周期

- e0d71d0已push核远端一致。TicketImageUploader在禁用/卸载后拒绝remove/openPicker/file change，非法索引不误删末项；清空文件输入允许重选，类型/容量拒绝不再发空更新，数组原地变化同步更新并回收预览URL。删除按钮增加disabled/可访问名称与键盘显现，手机44px热区，添加按钮不压缩。
- `takeover-ticket-uploader-before.log`Chrome先红disabled仍删文件；`takeover-ticket-uploader-final.log`通过按钮/函数/迟到选择零更新、正常增删、非法索引/容量/MIME、原地数组与卸载URL回收、桌面/手机。键盘显现检查首次读到80ms过渡中间透明度，改等动画结束后断言，最终通过；1440中文/390英文截图已核。真实Chrome与本地File，不上传附件或发送工单。
- client types、3守卫（route/i18n/ticket-image-security）、lint零错警、manifest191/110、最终双端build exit0/dist通过；专项接Chrome CI。父工单提交与后端附件安全保持。
- 后续只读复核：R293两流量图已有单点防护；R294生产init只校验12位/非占位符，16位hex默认密码不会被拒；R296升级version已有定义。R295现有无效env保留测试随`takeover-installer-review.log`完整installer守卫exit0，Windows Bash不冒充Linux首装。R297数据库替身专项初次先红，产品尚未改，下一段精确复现并补样例脚本本地专库门禁。327/R269/完整灾备未完成。

## 2026-10-29 R1-291 端口冲突完整数值校验与提交保护

- 95bf9e9已push核远端一致；8756778源码CI已success，bd068fe/95bf9e9最后运行。PortConflictModal拒绝部分整数、小数/指数和非安全端口，按数值识别22/022重复，支持单边范围并拒绝非法范围、空/重复原端口清单。深监听冲突更新建议值，确认按钮和函数共用当前可见/有效/session/激活/在途门禁，即时锁防同tick重复emit；在途使用建议不覆盖草稿。
- `takeover-port-conflict-before.log`真实Chrome先红22x仍提交22；`takeover-port-conflict-final.log`通过非法字符串、边界、数值重复、范围、清单替换/原地更新、建议、重复提交、关闭/session/cache/logout/unmount。手机截图发现建议标签挤窄输入框，改为两列并把标签放至输入下方，最终1440中文/390英文截图及输入宽度断言通过，五位端口完整可编辑。
- client types、3相关守卫及最终route复跑、lint零错警、manifest191/109、最终双端build exit0/dist通过，专项接Chrome CI。API受控只捕获确认事件，未下发真实端口；后台批量端口范围/协议/预留保持，父写回执与原生网络流程另待。
- R292上传器四文件专项已先红（`takeover-ticket-uploader-before.log`）：disabled仍可removeFile；完整矩阵已写未运行，产品未改，不混本项提交。源与TicketsView disabled调用已读。327项、R269通用持久恢复和完整网关灾备未完成。

## 2026-10-29 R1-290 重装/重建镜像与密钥成员校验

- bd068fe已push核远端一致；440a34c源码CI已success，8756778/bd068fe最后运行。两弹窗深监听当前镜像/密钥列表，失效选择清除并按原默认规则选择可用项，保仍有效选择；提交函数与按钮共用当前成员/visible/loading/session/激活门禁，即时锁防props回写前双emit，初始化命令数组复制，换镜像清旧命令。注销/换session关闭浮层，缓存离页隐藏并清输入。
- 保持重装默认密码登录、SSH key可选；重建仍须有效key。`takeover-reinstall-selection-before.log`Chrome先红移除镜像仍emit旧alias；`takeover-reinstall-selection-final.log`两弹窗通过替换/原地修改/清空列表、有效选择保留、错误alias/key函数拒绝、密码only/必选key、复制命令、重复/在途关闭重开、session/cache/logout/unmount。夹具直接切换KeepAlive组件曾触发Vue deactivate错误，改为先卸载再分别挂载验证，最终无运行异常。
- 1440中文/390英文两弹窗截图已核；API受控，只捕获submit事件，无实际重装/重建/数据删除。client types、5守卫（含dedicated-delivery/password与recreate-consistency）、lint零错警、manifest191/108、最终双端build exit0/dist通过；最后只去一处尾空格无语义改动，专项接Chrome CI。
- 下一项R291四文件port-conflict夹具先红（`takeover-port-conflict-before.log`）：22x仍emit22；完整非法数值/重复/范围/冲突更新矩阵已写但未运行，产品未改，不混本提交。PortConflictModal、父重提交与批量ports后台/port-mapping-safety守卫已读。R292 TicketImageUploader disabled下remove与file-change未守卫也已读未改。父重装/端口写回执与原生流程、327/R269/完整灾备仍待。

## 2026-10-29 R1-289 实例日志搜索与页面生命周期

- 8756778已push核远端一致；f31a86a源码CI已success，440a34c/8756778最后运行。InstanceLogsTab读取固定实例ID/名称、账号session与请求序号，旧success/error/finally静默；mount+activated仅加载一次，缓存离页/卸载清数据与回执，重新激活重读。改变搜索/页码/页长先清旧结果，失败明确错误和重试，拒错误实例响应、修正超出末页，展开状态仅保当前日志。
- `takeover-instance-logs-before.log`Chrome先红old覆盖new；`takeover-instance-logs-matrix.log`通过搜索ABA/旧失败、翻页反序/页长/reset、当前失败重试/末页收缩、展开去残留、实例/名称/session/账号切换、同sid刷新、缓存/注销/非法ID/错实例与卸载。1440中文/390英文截图已核，固定PC表格和手机卡片保持；真实Chrome配受控API，不访问客户日志。
- client types、5相关守卫、manifest191/107、最终双端build exit0/dist通过，专项接Chrome CI。lint0错误，69处既有表格缩进warning保持，无无关格式整理。后端日志原有权限/脱敏保持；独立LogsView及其它读取生命周期不算本段完成。
- 下一项R290四文件reinstall-selection夹具已先红（`takeover-reinstall-selection-before.log`）：可用镜像删除后仍emit旧debian/12。两modal完整代码、父open/doRebuild/doRecreate、后台镜像/密钥/验证与任务、recreate-consistency/image/dedicated-delivery相关守卫已读；产品未改，不混本提交。保持重装密码默认/可选key，重建要求key；父写回执与强杀/原生任务另待。327/R269/完整灾备未完。

## 2026-10-29 R1-288 旧套餐创建优惠码回执与报价绑定

- 440a34c已push并核远端一致，源码CI40786941481最后运行。默认`/purchase`仍走PoolPurchaseWizard一机一卖；本项旧`/instances/create`的优惠码按code/plan/package/source/价格/可用状态/账号session/路由/激活代次隔离。输入或选择改变同步清旧折扣，校验序号拒旧success/error/finally及重复；校验中禁止提交，Turnstile await后再核上下文，失效不发创建请求。补API响应既有commissionRate/error类型，无后台计价或交付改动。
- `takeover-create-promo-before.log`Chrome先红旧90%覆盖新20%；`takeover-create-promo-matrix.log`通过码ABA、改码/方案/价格/列表/重置立即失效、重复验证、无效折扣/返利率、失败重试、托管禁用、同sid刷新/换账号/注销、缓存/路由/卸载、验证中零create、Turnstile间换码零create及正常固定promo payload。1440中文/390英文截图已核；受控API不创建客户机器、不扣款。
- 同次浏览器证实首次zone:7会先等专区列表再请求正确zone source，原清单该症状当前已有保护；未擅自改该初始化。client types、4守卫、lint零error/warning、manifest191/106及最终双端build exit0/dist通过，专项登记Chrome CI。正常创建其它读取/提交完整生命周期、后台预览价与实际价完整绑定另待，不能扩成机器池交付验收。
- 下一项R289四文件instance-logs夹具已先红（`takeover-instance-logs-before.log`）：旧搜索覆盖新搜索。InstanceLogsTab完整代码、父页挂载、日志routes/DB身份过滤与两个日志守卫已读，产品未改，不混本提交。LogsView也有独立旧读风险；R290两弹窗初始化/提交已读但未动。327/R269/完整灾备未完成。

## 2026-10-29 R1-287 批量续费与销毁预览对象绑定

- f31a86a已push核远端一致；d0b1c91与75a227e源码CI已success，f31a86a最后仍运行。续费/销毁确认固定已展示预览的可操作ID，数量显示同一目标集合；两种弹窗绑定账号/角色/session、路由、激活与打开代次，旧预览/写回执不污染新页面。请求在途保持busy防重复，后来勾选不被成功回执清空；预览需完整无重复匹配目标，续费余额/折扣金额有限有效，保持1个月与用户销毁零退款。
- `takeover-batch-billing-before.log`真实Chrome先红预览1选2却提交2；`takeover-batch-billing-matrix.log`通过固定eligible集合、仅1月、预览中禁止提交、重复确认、不同目标ABA、错/缺/重复ID、无效金额/余额失败与不足、canRenew/canDestroy门禁、DESTROY、同sid刷新/换账号/权限/注销、cache/session旧写回执、当前失败重试/部分成功、新selection保护与卸载。1440中文与390英文两弹窗截图已核；API受控，无真实客户扣款/销毁。
- client types、4相关守卫、manifest191/105、最终双端build exit0及dist边界通过，浏览器专项登记Chrome CI。lint使用client目录配置后0错误，12处既有模板缩进/换行warning保留，未作无关格式改动；根目录首次调用无eslint配置exit2已纠正。施工中watch提前读取isAdmin导致挂载失败已修，最终浏览器运行无异常。
- 下一项R288四文件create-promo夹具已先红（`takeover-create-promo-before.log`）：SECOND的20%折扣被FIRST旧90%覆盖；同次浏览器证实首次专区7会等待zones并正确请求zone:7，非现存错误。产品未改，不混入本提交。该项是旧`/instances/create`，默认`/purchase`机器池一机一卖不变；后端AFF/create与对应守卫已读。列表自身旧读取/双timer、后台报价/权限完整事务、原生流程及327/R269/完整灾备仍待。

## 2026-10-29 R1-286 工单实例卡请求与轮询生命周期

- 75a227e已push核远端一致；d0b1c91/75a227e源码CI最后仍运行。实例卡按账号/角色/session、props实例与激活代次隔离；详情/配置/任务组合读取及await stats后再核当前，stats/task各自序号，错详情ID拒绝。计时器只在当前激活实例创建；停用/卸载清全部timer，终端子组件按代次重新挂载/离页卸载，避免旧连接复用新实例。
- start/stop/restart/sync/suspend/unsuspend/delete捕获原目标，函数复用按钮资格并阻重复，在途操作跨切换保持busy；旧成功/失败不写状态、不弹提示、不重建timer，settle后刷新当前卡。原后台权限、退款和资源行为不改，共享TerminalModal自身全部异步路径仍有独立待项。
- `takeover-ticket-card-before.log`Chrome先红卸载stats后3250ms再次请求；`takeover-ticket-card-final.log`通过卸载零poll、实例ABA/同sid刷新/换账号、stats乱序、task乱序/终态刷新、旧error/错实例、固定操作/重复/当前失败与TASK_IN_PROGRESS、跨session/cache操作、注销及最终卸载3250ms零请求。1440中文/390英文截图已核，无横向溢出/运行异常；API受控，无真实Incus重启/删除/退款。
- client types、5守卫、最终lint零error/warning、manifest191/104、最终双端build exit0和dist边界通过；专项登记Chrome CI。
- 下一项R287四文件instance-batch-billing夹具已先红（`takeover-batch-billing-before.log`）：预览1后选2，确认发送2；InstancesView相关批量预览/提交/生命周期、续费与销毁批量routes/helper及billing-ID/user-destroy守卫已读，产品未改，不混本提交。续费固定已预览可操作ID、单月选项和用户销毁零退款保留，后台当前报价/权限及原生流程不扩大验收；327/R269/完整灾备未完。

## 2026-10-29 R1-285 关联工单写入与新草稿保护

- d0b1c91已push核远端一致，c71d25c源码CI40782179348已success，d0b1c91最后仍运行。关闭/重开/状态、删除消息固定ticket/message，函数与按钮busy门禁；旧结果不改新工单、不提示或导航。备注/通知/关联对象固定参数与各自草稿revision，成功仅清原输入，busy跨重开保持；创建固定附件副本，新输入或离页后不清草稿/不跳转，当前成功仍进入新工单。
- 状态写入前后失效旧详情/支持读取；重开同工单早于旧写入落地时重新读当前状态，初始详情未到先延后刷新；删除失效旧翻页、去掉当前消息且释放附件URL，并核当前成员。后端权限、通知投递、计费和实例操作未改。
- `takeover-ticket-actions-before.log`Chrome先红关闭1污染2；`takeover-ticket-actions-final.log`通过当前/旧关闭重开状态、重复门禁、固定admin目标/新草稿、当前失败与旧失败、严格关联ID、删除去重、同工单初读与旧close竞争、创建新草稿/当前跳转/离页、普通用户admin动作零调用、logout/unmount。管理员1440中文/390英文截图已核，无横向溢出/运行异常；通知调用仅受控API，不发送真实通知。
- `takeover-ticket-actions-detail-regression.log`上一批完整详情/回复/附件回归通过；client types、5相关守卫、lint零error/warning、manifest191/103、最终双端build exit0及dist边界通过；新专项已登记CI。受控浏览器不代替后端PG/原生端到端验收，R285按已验证前端范围记录。
- 下一项R286四文件ticket-instance-card夹具先红（`takeover-ticket-card-before.log`）：卸载后迟到stats恢复polling，3250ms后再次请求；组件完整读取/操作/生命周期、相关实例routes与任务守卫已读，产品未改，不混入本提交。共享TerminalModal独立生命周期、327/R269/完整灾备仍待。

## 2026-10-29 R1-285 工单详情、回复与附件回执隔离

- c71d25c已push核远端一致，cc5fd54源码CI40780854170已success，c71d25c最后仍运行。工单页面按严格route ID、账号/角色/session、打开及缓存代次隔离；详情拒错目标，列表/未读/支持上下文/实例列表各自序号，旧success/error/finally不覆盖当前。离页取消搜索计时、清详情/草稿/附件和灯箱，同sid刷新保持。
- 回复固定ticket/content/附件副本，函数和按钮同canReply、在途计数防重复；成功仅清原草稿，保后来文字/附件。离开重开同工单后旧回复settle触发当前消息重读，若初始详情仍在加载则延后重读，保新草稿。翻页成功才提交page且去重，失败不回退其它页；附件独立代次与当前消息成员检查，旧blob不创建URL，重读/离页释放已有URL；图片下载不再阻塞消息正文/回复。
- `takeover-ticket-lifecycle-before.log`Chrome先红工单1覆盖2；`takeover-ticket-lifecycle-final.log`通过route ABA、旧error/finally、翻页重复/失败、固定回复/新文字附件、closed拦截、同工单重开在途回复与初始读取竞争、图片迟到/释放/灯箱、错目标、同sid/换session/logout、支持上下文乱序、缓存离页、列表旧读及卸载。1440中文/390英文截图已核，无横向溢出/运行异常；真实Chrome配受控API，未宣称实际邮件/通知或PG工单写入。
- client types、5相关守卫及最终route/success复跑、lint零error/warning、manifest191/102、最终双端build exit0及dist边界通过；专项已登记Chrome CI。
- 后续关联写入仍待：关闭/重开/状态、删消息、内部备注/通知/关联、创建。`takeover-ticket-actions-before.log`已Chrome先红：关闭1旧回执把2显示closed，新专项不混本次提交。R286实例卡已读，旧stats/任务/写回执和卸载后重建timer仍待；327/R269/完整灾备未完成。

## 2026-10-29 R1-284 快捷命令草稿与会话隔离

- cc5fd54已push核远端一致；935dac5源码CI40779050593已success，e799c90/cc5fd54最后仍运行。快捷命令绑定账号/角色/session、KeepAlive与手机显隐代次，列表独立序号和ready门禁，失败清旧内容并保留重试。相同sid刷新保持，退出或切换清旧列表/选择/草稿，旧success/error/finally不污染新上下文。
- create/update固定提交参数和编辑目标，成功不清随后修改的草稿；delete固定原目标且保留后来选择。在途写跨重开保持busy，settle后重新加载当前会话再允许执行。选择和编辑拆独立button；修手机容器同时relative/fixed造成的文字左溢出。
- `takeover-terminal-commands-before.log`Chrome先红保存清新草稿；`takeover-terminal-commands-final.log`通过新输入/切编辑保留、重复保存、固定目标、旧error/list/finally、失败重试、同sid/换session/logout、delete改选、缓存/手机在途写及卸载。1440中文/390英文截图已核，零运行异常/横向溢出，手机过渡结束标题位置非负。`takeover-terminal-commands-parent-regression.log`父终端R282回归通过，API受控，不等于真实命令落库或SSH执行。
- client types、3相关守卫及最终route复跑、lint零error/warning、manifest191/101通过。双端build exit0后手机样式再变更，已补最终user build exit0（`takeover-terminal-commands-user-final-build.log`），最终dist边界通过；专项登记Chrome CI。
- 下一项R285真实Chrome先红（`takeover-ticket-lifecycle-before.log`）：路由切到2后旧工单1响应覆盖当前详情；工单详情/回复/附件/支持上下文及后端相关授权守卫已读，产品未改，四个新夹具不混进本提交。327、R269和完整灾备未完成。

## 2026-10-29 R1-283 终端会话与连接回执隔离

- e799c90已push核远端一致，090afa6源码CI40778093662已success；e799c90/935dac5最后仍运行。TerminalView换账号/角色/session及logout销毁旧标签、连接/重连timer、实例列表与浮层，同sid刷新保持。实例列表单独请求序号与缓存激活校验，清旧列表/选择；只允许当前运行实例建立新标签。
- cloud-init绑定原tab对象/instance/session与请求序号，关闭/被新检查替代/skip后旧响应不写状态或连接；当前失败继续原允许连接规则。ticket绑定tab/实例/会话与连接attempt；WebSocket消息/错误/关闭/重连及异步Blob读取均核当前socket，旧连接不写到新tab。关闭先失效attempt与socket，再实际close；同会话普通KeepAlive保留连接。
- `takeover-terminal-session-before.log`Chrome先红logout仍1标签；`takeover-terminal-session-final.log`通过logout/同sid刷新、列表重叠/旧finally/缓存、关闭/并行/skip/session旧cloud-init、旧ticket/attempt与当前ticket、旧socket事件零重连、当前错误重试/异常关闭新ticket和卸载后票据不建连接。`takeover-terminal-session-lifecycle-regression.log`上一批完整缓存/剪贴板/fresh-mobile回归通过。真实Chrome配受控API/WebSocket，未宣称原生SSH/Incus连接实证；初次socket替身被Vue代理导致身份断言失败，修为native等效markRaw后通过，非产品回退。
- client types、4守卫、lint零error/warning、manifest191/100、最终双端build exit0和dist边界通过。R284命令栏独立账户/草稿生命周期仍待，不把终端父页修复扩大为所有子组件。
- 下一项R284四文件夹具已先红（takeover-terminal-commands-before.log）：save完成无条件cancelEditor清新草稿。源、后端create/update/delete及current user/session事务/原守卫已读，产品尚未改；这些测试不混入本项提交。327、R269和完整灾备未完成。

## 2026-10-29 R1-282 终端缓存页快捷键与粘贴隔离

- 935dac5已push核远端一致；aab5bbc源码CI40776614927已success，090afa6/935dac5最后运行。TerminalView激活/停用独立注册和移除页面监听，离页收起搜索/选择器/帮助/设置/移动命令菜单/右键/链接浮层并释放焦点；正常缓存保留已有终端连接，卸载才销毁。输入框自己的快捷键保持，xterm输入仍可使用终端快捷键。
- 剪贴板读取及延迟聚焦/fit绑定页面代次、session、标签及当前socket，离页/标签ABA/session变更/连接替换后不发送旧粘贴；快捷命令发送入口也要求当前页面。标签激活和关闭由嵌套button改为独立button，增加各自可访问语义；保持原标签和会话操作。
- `takeover-terminal-lifecycle-before.log`真实KeepAlive Chrome先红；`takeover-terminal-lifecycle-final.log`通过缓存离页不截键、3次重激活不重复监听、全部瞬态浮层清除、输入框不截键、旧粘贴静默/当前粘贴一次、标签ABA/session迟到粘贴拦截、缓存连接保持及卸载关闭。1440中文浅色/390英文深色与全新移动设备分支截图已核，零运行异常/横向溢出；WebSocket与clipboard为夹具，不宣称真实SSH会话验证。
- client types、4守卫及最终route复跑、lint（1既有unused catch warning，无error）、manifest191/99、最终双端build exit0及dist边界通过；专项登记Chrome CI。R283实际session切换清旧tab/实例列表/cloud-init和票据全生命周期、R284快捷命令草稿仍待，不能把本段UI隔离当完整终端授权修复。
- 下一项R283已另建test-terminal-session.mjs先红，logout后旧tab仍保留，源/相关守卫已读，测试不混进本项提交；327/R269/完整灾备仍未完成。

## 2026-10-29 R1-281 升级预览与提交目标一致

- 090afa6已push核远端一致，CI40778093662最后运行；aab5bbc的CI40776614927最后仍运行。ChangePlanModal绑定打开代次/session/实例及套餐/现有方案信息，方案列表及预览各自序号；选择变化同步清预览，错误newPlan/oldPlan响应拒绝，失败后清旧列表和提交资格。确认按钮与函数共用canSubmit，要求当前有效可售升级方案、已完成且目标匹配的预览及余额。
- 提交固定已预览instanceId/planId，在途写跨关闭重开保持busy；旧成功/失败不关闭、不覆盖新状态。当前重启提醒在当前成功回执立即显示，移除可能落到新页面的500ms定时提醒。未更改后台计费、资源预留或Incus同步。
- `takeover-change-plan-before.log`真实Chrome先红：切到3且新预览尚未返回时仍可发送change；`takeover-change-plan-browser-final.log`通过选择ABA、旧success/error/finally、错目标预览、同sid刷新/新session/instance/package/currentPlan变化、列表失败重试、余额/不可售/不可升级拦截、固定提交/重复点击/重开busy、旧写回执、当前失败重试/KVM提醒及logout/unmount。1440中文浅色/390英文深色截图已核，零横向溢出和运行异常，API为受控夹具。
- client types、4相关守卫、lint无error/warning、最终双端build exit0、dist边界及manifest191/98通过，专项已登记CI。本段不宣称后台完整当前授权/报价锁定/远端配置失败恢复通过；这些仍沿原清单继续，327及完整灾备未完。
- 下一项R282终端KeepAlive离页仍截获快捷键已Chrome先红（takeover-terminal-lifecycle-before.log），缓存页/剪贴板测试夹具暂不混入本提交；TerminalView生命周期/输入/连接及相关守卫已读，产品尚未改。R283 cloud-init/session与R284命令草稿单独继续。

## 2026-10-29 R1-280 转移弹窗与二次验证回执

- aab5bbc已push核远端一致，CI40776614927最后运行；05de4a5/a370299/a805dc4源码CI均success。TransferModal每次打开/实例/session独立代次，余额及搜索旧成功/失败/finally隔离，输入ABA搜索失效；当前搜索响应须匹配用户名。转移固定instanceId/username/remark及草稿版本，在途写跨重开保持busy到settle，旧结果不提示、不关闭新表单。原用户名绑定已有防护，未计作本轮新增。
- 二次验证绑定本次提交的草稿和独立子组件key，旧verified不重试当前草稿；SensitiveVerificationModal本身也补show/resource/operation/session与卸载隔离、重复请求函数门禁、当前verified:true检查及倒计时清理。服务端明确success:true/required:false时仍经原转移API重试，由后端重新检查验证要求；未改后端验证、权限、收费或交割逻辑。
- `takeover-transfer-modal-before.log`Chrome先红复现关闭重开旧余额999覆盖；`takeover-transfer-modal-final.log`真实Chrome通过余额/search ABA与旧finally、错误目标/封禁目标、同sid刷新/换session/换实例、固定写参数/重复点击/旧成功错误、新旧验证码交错、验证false/失败/当前成功重试、关闭重开/无需验证返回、logout/unmount无孤儿倒计时。1440中文浅色/390英文深色截图已核，无横向溢出，无运行时异常；API受控夹具，不等于真实转移/通知发送。
- client types、4相关守卫、lint（无error，4模板排版warning）、最终双端build exit0、dist边界、manifest191/97通过，专项登记CI。初轮测试使用DOM Transition节点而非实际验证组件，已修测试定位；不记为产品缺陷。共享验证组件其它父页面完整业务流程未全部跑过；后端真实交割沿此前专项证据，本项无生产操作。
- 下一项R281 ChangePlanModal已Chrome先红：选择3后加载新预览时，handle仍按旧预览发送change请求；新夹具四文件不混入本项提交。327、R269和完整灾备持续未完成。

## 2026-10-29 R1-279 实例详情读取与轮询隔离

- 05de4a5已push。详情读取绑定路由名称/完整正整数ID、账号角色/session、页面代次和各类请求序号；切换实例、退出及重登立即清旧状态。主详情拒绝错误目标响应，套餐/配额/统计/流量/快照/转移/任务/cloud-init的迟到成功、失败和finally不再污染当前页面。操作开始前的旧状态读取失效；任务与刷新计时器按当前代次管理，避免快速切换重复建立。
- `takeover-instance-detail-before.log`真实Chrome先红；`takeover-instance-detail-browser-final.log`通过A→B→A、旧错误/finally/套餐、轮询乱序、操作前读取、session变更/同sid刷新/logout、统计/流量/快照/cloud-init/任务旧回执、错误目标及重试、单刷新timer与卸载5200ms无新请求。1440中文浅色/390英文深色截图已检查，无横向溢出、无运行时异常。API为受控夹具，不等于远端实例流程。
- client types、route/i18n守卫、lint（48条既有格式warning，无error）、最终双端build exit0、dist边界及manifest191常规/96环境排除通过；专项已登记Chrome CI。日志为`takeover-instance-detail-*`，截图在`logs/instance-detail-reads/`。
- 本段仅完成读取隔离；操作/改名/重建/删除等写回执、密码及子组件生命周期仍待。R280转移弹窗关闭重开旧余额覆盖已另用Chrome先红，测试夹具暂不混入本项提交。未操作生产/客户实例，327、R269及完整灾备未完成。

## 2026-10-29 R1-271 维护参数与真实成功计数

- a370299已push，CI40774057115最后运行；a805dc4的CI40773184822也仍运行。backfill的--host-id现在只接受1至2147483647完整十进制整数，未知/重复参数直接失败，不将错误过滤器视作全库。写入完成后才计changed/ipv4Changed/ipv6Changed；dry-run单列planned/ipv4Planned/ipv6Planned，实际changed为0。
- `takeover-backfill-count-before.log`真实CLI先红：数据库约束失败仍changed=1；`takeover-backfill-final.log`5真实PG+mTLS CLI通过身份/连接变更、SQL失败、成功、dry-run；`takeover-backfill-invalid-cli.log`5非法参数组合实际命令exit1、零宿主探测，另纯parser覆盖空/0/负/小数/科学计数/hex/前导0/空白/NaN/溢出/重复/未知与合法最大值。2守卫通过；scripts不在原server tsconfig，另用本地tsconfig包含本CLI和完整src，补正确typeRoots后tsc最终exit0（takeover-backfill-types-final.log/.exit）。本项没有运行时代码/前端变化，沿用a370299最终后端构建。
- 原生Incus/生产未操作；R271 baseline宿主资源快照竞争与完整网络ABA仍待。下一项R279 InstanceDetailView迟到详情/套餐/统计和路由轮询，已读实际主加载与依赖读取，尚未编辑前端。327、R269和完整灾备持续。

## 2026-10-29 R1-274 赠送时长保留当前续费与封停

- a805dc4已push，CI40773184822最后运行；ee98c6e/5b8b7ff/7f226ad CI均success。gift-days每实例共用withInstanceBillingMutation（续费与到期远端动作同lane），实例操作锁/行锁+宿主共享锁下核current owner/host/incusId/付费套餐、当前宿主所有者及session，拒创建/清理/转移和未完成任务/快照/站点操作。以锁内max(now,current expiry)增加天数并递增version，不按列表旧快照覆盖；仅当前expired封停清除，人工封停保持。
- 赠送与instance.gift_days持久审计同事务，审计失败全部回滚；不写余额/退款/收费账单，不启动或停止远端实例。批量保持逐项成功失败和免费跳过；未拥有宿主的管理员无额外越权通道。DB错误给可重试说明、服务日志保原错误和目标ID。
- `takeover-host-gift-days-before.log`先红：并发延长30天被旧赠送覆盖。`takeover-host-gift-days-server-final.log`真实Fastify/PG通过9身份/账号/session竞争、当前人工/expired封停、过期/无到期起点、7工作流拒绝、共享实例锁、6并发赠送累计/version/审计与零账款、实际performRenewal后赠送保持付费末期与仅一扣款、旧续费拒重复扣款、审计触发器失败回滚、边界/非owner、普通宿主owner与成功/失败/免费混合批量。原renewal专项完整回归也通过；原生Incus与真实expiry远端停止未验。
- 4相关守卫、最终后端build含tsc exit0、manifest191/95通过，新专项接PG CI。初次fixture因两个宿主同名触发唯一约束，已修命名/失败传播，3账号及关联夹具按确切ID/名称/本机URL核对后完整清理。
- 不含跨请求幂等键、全局ABA与多进程（架构仍单后端）验收。继续R271 backfill严格参数与成功计数（已读原代码/真实CLI夹具），以及327其它待项；R269超时/强杀、完整灾备未完成。

## 2026-10-29 R1-272 配额用量与当前授权事务

- ee98c6e已push；7f226ad的CI40769861511已success，5b8b7ff/ee98c6e最后仍运行。quota提交现共用实例操作锁/行锁、宿主共享锁和当前账号/session，核原instance owner/host/incusId及host owner，拒创建/清理/转移/任务和未收尾快照/站点操作。手工端口修改与quota共用原port-mappings锁，锁后统计并同事务写全部已提交字段。
- 对齐真实消费口径：端口排除systemManaged；备份只计creating/ready；站点全部计数，0不限、null继承套餐或默认10。端口/快照/备份null按有效0检查，不再绕过现有用量；未提交字段保持，不因其它历史超额阻止本次独立字段调整。封停实例仍可管理配额，状态不变；审计站点0改为unlimited。
- `takeover-instance-quota-usage-before.log`先红复现2站点仍能调成1；`takeover-instance-quota-atomic-server-final.log`真实Fastify/PG通过用量/null/省略、7账号禁用/降权/session竞争、5实例/宿主身份竞争、创建/清理/任务/转移及持久操作拒绝、手工端口锁等待后重计、站点真实POST与backup预留/snapshot事务并发、不同字段并发保存、SQL失败全部回滚及零账款。快照并发使用真实withSnapshotMutation与计数/插入callback，不声称远端快照流程；无Incus/Caddy外部写。
- 7相关守卫通过，最终quota守卫重跑通过，manifest191/94；首次build发现Host DTO的user_id可选类型，修正为接受可选快照但身份不匹配拒绝后最终build含tsc exit0。守卫曾把host身份比较中的undefined误当配额转换，已去掉不必要转换并通过。无前端变更。
- 原端口锁120秒租期耗尽时的在途写、其它配额写入口、全局ABA/强杀及原生Incus未在本段验收；R272不扩大为全系统配额验收。接R274赠送时长，原完整路由/续费事务/expiry守卫已读。R269及327/完整灾备仍待。

## 2026-10-29 R1-272 配额显式 null 保存

- 5b8b7ff已push核远端一致；其CI40771202126及7f226ad的40769861511仍运行，5e86550/65b755c/c188aac已success。PATCH /instances/:id/quota原把null转为undefined，清空操作返回成功但未保存；现保留null，省略字段仍不改变，显式0与既有范围不变。旧守卫错误要求null转undefined，已纠正并接真实PG专项至CI。
- `takeover-instance-quota-null-before.log`先红，`takeover-instance-quota-null-server.log`真实Fastify/PG接口覆盖管理员/宿主所有者四字段null、字段省略、0、1000、非法输入、客户越权与零财务写入；3守卫、后端build含tsc最终exit0、manifest191常规/94环境排除通过。无前端改动或远端I/O。
- 仅null保存局部完成；用量检查、current actor/target与创建串行继续施工。站点真实语义为0不限、null继承套餐或默认10；端口只计非systemManaged，不能照旧注释误改业务。R269超时/强杀续跑、R274赠送时长及327/完整灾备仍未完成。

## 2026-10-29 R1-271 底层网络快照与维护脚本

- 7f226ad已push。底层persist写入要求hostId/userId/incusId/updatedAt/原双栈地址和宿主身份，操作锁+实例行锁+宿主共享锁下复核，拒绝创建/清理/转移及活动任务。每次接受观察都单调推进版本，含地址没变；IP主记录与实例地址同事务。proxy包装调整状态更新顺序，原反代语义保持。
- backfill脚本在远端读取前捕获完整宿主及实例身份；getAllHosts旧DTO不含user_id，另读真实记录，避免无条件拒绝正常维护。失败返回非零，关闭连接后等待句柄回调再显式退出，避免原后台定时器挂住；同步后立即exit在Windows引发libuv assertion，已在实际CLI修复并验证。
- `takeover-network-persistence-before.log`先复现换宿主旧写仍成功；`takeover-network-persistence-server-final.log`14真实PG情形exit0（身份/版本/地址/任务/删除/创建/约束回滚、正常、无变化消费版本、并发仅一次成功）。`takeover-network-persistence-complete.log`47原API回归+5实际维护CLI（host/连接变化、DB失败、正常、dry-run）exit0；完整proxy回归、3守卫、后端最终build含tsc exit0、manifest191/93通过。临时gift-90a8413d账号及证书目录已完整清理，不提交私档或日志。
- 原生Incus、公网/客户网络未验；host基线资源快照竞争、维护命令参数解析/统计口径等未在本项精修，R269超时/强杀续跑仍待。接R272 instances.ts /:id/quotas，schema已有0/null但写入null变undefined、少siteCount与创建串行检查；已定位未编辑。327/完整灾备未完成。

## 2026-10-29 R1-271 三个运维同步入口拒绝旧观察

- 5e86550已push，CI40768936185最后运行；c188aac的CI40766741756最终success。复核纠正：原用户sync-status/宿主批量sync已走带身份/版本/会话的事务保护；baseline-sync、network-repair、ops单实例sync仍先无条件改状态再写IP。三个入口现在复用syncObservedInstanceNetwork，提交时核host连接/归属、instance标识/owner/updatedAt/原地址、当前会话和任务门禁；状态与IP一起事务写入，保suspended，观察入口不触发Caddy外部写入。
- `takeover-host-network-sync-before.log`真实API先复现探测中改挂宿主仍成功；`takeover-host-network-sync-server-complete.log`47真实Fastify/PG/mTLS场景exit0：3入口各15情形及2已封停正常同步，含迁移/标识/owner/版本/地址/宿主连接与归属变化、禁用/session撤销、cleanup/待任务、删除/封停、IP约束失败事务回滚、正常双栈。自定义IP保留，删除trigger清IP后不重建，失败不推进lastSyncedAt、不触碰Incus写入。初轮夹具重复IPv6与删除trigger断言已纠正，产品保护未放宽。
- 原proxy-site-operations完整回归exit0（takeover-host-network-sync-proxy-regression.log），含IPv4替换、拒绝/重试/墓碑、真实SQL故障和进程强杀；3守卫、后端最终build含tsc exit0、manifest191/92通过，新专项接CI。无前端改动。
- 底层instance-network-sync的直接写入口与维护backfill脚本仍缺完整版本保护，下一段继续；baseline宿主资源快照写本身、原生Incus、公网IPv6/客户验收不在本段。R271及327/灾备不作整体完成声明。

## 2026-10-29 R1-270 赠送创建准备补偿与通知隔离

- 65b755c已push核远端一致，CI40767977505最后运行，c188aac的40766741756也仍运行。赠送落库后的IP预留/cloud-init/存储准备现在同一事务，锁实例核对本次user/host/incusId/资源/network/port/status/pending；必需NAT/routed IPv6失败立即拒绝。准备回滚后，仅本次creating归属可在一个事务置error及归还CPU/内存/磁盘/原端口预占；失权或补偿DB错误保留资源并返回已有instanceId。零金额赠送账单保留，不造退款。
- 交付调用后独立处理站内信失败，保202并持久失败日志。准备错误保宿主/实例/失败步骤和处理说明。createLog自身吞错原本已保护，本次不冒称修日志500。NAT分配器增加可选tx client，原调用默认行为保持；默认机器池一机一卖未改。
- `takeover-host-gift-preparation-before.log`先复现storage失败500，`takeover-host-gift-inbox-before.log`先复现已运行仍500；`takeover-host-gift-preparation-server-final.log`真实Fastify/PG+mTLS夹具13场景exit0：NAT/公网存储丢失、两种地址耗尽、NAT写失败、IPv6错误、存储写失败、状态/资源变化、补偿约束失败、站内信失败和免费/付费正常；核零远端失败准备、原资源底数、IP回滚、零退款/余额保持与失败日志。6守卫、后端最终build含tsc exit0、manifest191/91通过，新专项接CI。初次夹具缺fingerprint的3本地账号已精确清理。
- 原生Incus/真实OS、强杀持久恢复、通知重试/outbox和跨请求幂等未验；R269通用超时仍待。R271 network-sync仅not-deleted无host/版本条件已读，下一项继续。327与完整灾备未完成。

## 2026-10-29 R1-270 前置：独立IPv4库存行锁

- c188aac已push；其CI40766741756最后仍运行。实测赠送准备路径发现reservePublicIpv4ForInstance的LEFT JOIN使用未限定FOR UPDATE，PostgreSQL直接0A000拒绝。改为FOR UPDATE OF a，只锁地址库存行，保SKIP LOCKED/禁用池/网关回退合同。
- `logs/takeover-public-ipv4-before.log`真实PG先红；`takeover-public-ipv4-server.log`通过无池与有池地址、DNS/网关回退、禁用池、缺网关自动禁用、并发最后一地址、事务回滚与释放。3守卫、后端build含tsc最终exit0、manifest191常规/90环境排除通过，专项接PG CI。没有原生Incus/生产操作。
- R270准备补偿产品未改，新host-gift-preparation专项仍在施工未提交；继续存储/IP失败统一补偿及站内信不得污染202，默认机器池一机一卖保持，327未完成。

## 2026-10-29 R1-269 人工删除残留的身份与库存收尾

- 自动回调5b68d13已push；失败时在原快照中合并本次attempt和endpoint SHA256，保其它字段且不存管理URL。自动与人工共用30秒清理核验；用户单/批destroy、管理员单删与宿主批删先核原身份，确认删除后清pending和释放公网IPv4，节点批删据此重算库存。旧delete-and-refund对pending明确409并指向现有核验入口；仅记录删除继续保pending/IP占用/宿主隔离。
- `takeover-managed-cleanup-delete-before.log`真实API先复现销毁成功pending仍true；`takeover-managed-cleanup-delete-complete.log`最终exit0通过四入口成功、16个缺身份/错误attempt/错误endpoint/假删除回执拒绝场景、旧接口两模式409、仅记录零Incus及保占用、原用户零退款/零账目与管理员退款选择。真实PG+mTLS，认证hook夹具，未原生Incus或客户操作。
- `takeover-managed-cleanup-identity-provision-final.log`20创建场景及持久身份哈希回归最终exit0；8守卫、后端最终build含tsc exit0通过。一次删除专项全库账目计数被并行创建专项干扰，现按本专项三账号计数，串行完整重跑；一次文件CRLF使静态section匹配失败已恢复LF并通过，一次错守卫名被runner拒绝不计执行。无前端改动。
- R269通用超时清理/进程强杀、事务中途退出后的人工续跑仍待；缺旧身份的pending拒绝自动清理，需按真实身份核对，不能编造原标记。R270后续：存储/IP/cloud-init在提交后失败无统一补偿，站内信失败能干扰202；createLog自身已吞错，纠正旧“日志异常导致500”描述。327与完整灾备仍未完成。

## 2026-10-29 R1-269 旧托管失败先确认远端清理

- d80aacb已push并核远端一致；R264/265及条款同步CI40761263661/40761931015/40762367663均success。managed创建绑定原user/host/incusId，远端加入本次随机标记，清理复用原mTLS连接并核标记/UUID。失去creating终结权的迟到成功/失败不再自行stop/delete；失败先置error及provisioningCleanupPending，保原失败退款独立执行。
- 清理在实例行锁下复核归属/资源，30秒共用远端截止，确认Stopped、精确GET404、无关联运行operation及转发实际移除，才同一事务清pending并扣宿主资源/释放公网IPv4。远端不确定或DB提交失败保留占用与持久失败日志；不以文本“not found”当确认，未知同名实例不删除。
- `logs/takeover-managed-provision-before.log`真实PG+mTLS先复现delete拒绝仍CPU125→75；`takeover-managed-provision-server-final.log`最终exit0覆盖20场景：stop/delete拒绝/未确认、UUID变化、伪404/500、转发失败/未移除、既有同名、在途create、精确缺失/正常清理、失权、host URL变化、资源变更、行锁竞争、真实约束触发DB回滚、正常成功及成功CAS失权；每项重入均零重复I/O/退款/扣资源。OpenSSL初次不在PATH已指定本机Git版本。模拟Incus经真实双向TLS，无原生Incus交付/生产验证。
- 后端build含tsc最终exit0、4守卫、manifest191常规89环境排除通过，新专项接PG CI。共享removeDedicatedForward只收窄所需类型，运行逻辑不变。当前仅完成R269自动失败回调这一段；人工销毁后的pending标记/公网IPv4收尾、通用超时清理及强杀持久恢复仍待继续，R269整体不记完整。默认机器池链路、327及完整灾备不作完成声明。

## 2026-10-29 条款浏览器测试退出动画同步

- R265 84430db已push并核远端一致。补查R258 d8c8e33 CI40759254570失败在terms lifecycle末尾，读取到了正在离场的旧正文；R259 6c9dfe5 CI40759334826和R260 866d9f4 CI40759523451均success。专项隐藏弹窗后先等待原有退出动画移除DOM，再卸载/重建；加新组件首次显示只发一次新请求断言。
- `logs/takeover-terms-lifecycle-transition.log`实际Chrome专项最终exit0，语法检查和frontend-route-guards通过；两次误写守卫关键字被runner拒绝并未执行，最终正确守卫日志为`takeover-terms-lifecycle-transition-guards.log`。只改测试，产品及构建产物不变；不把后续偶然CI成功视作此次失败已自然消失。R269/270继续。

## 2026-10-29 R1-265 流量额度缺字段不再清为无限

- R264 1761a79已push并核远端一致。专用用户/实例traffic limit PUT要求body显式包含monthlyLimit，缺字段或null body返回400；共享bigint parser及其它配置表单的缺省保留、null/空字符串显式清空合同保持。
- `logs/takeover-traffic-limit-before.log`真实Fastify/PG先复现空payload返回200并清额度；`takeover-traffic-limit-server.log`通过两个入口缺省/null body、负数/数字类型/小数/对象/数组/空白/溢出拒绝，零/trim字符串/PG bigint最大值/null/空字符串/正常额度兼容，用量和余额明细保持。认证hook为夹具、实例停止，无Incus或生产操作。
- 两项流量守卫、manifest191常规88环境排除通过；后端build含tsc最终exit0（`takeover-traffic-limit-build.exit`），专项已接现有PG CI。无前端改动。继续R269旧托管创建失败补偿与R270宿主赠送提交后的错误处理；默认机器池一机一卖保持。327与完整灾备未完成。

## 2026-10-29 R1-264 流量重置提交时复核权限

- R260 866d9f4已push并核远端一致；R257 f1cc7c7 CI40757170502最终success。用户手动reset的管理员/宿主/付费所有者统一走原实例与用户流量锁、事务；实例行锁后核当前owner/host及采样身份/状态，宿主共享行锁与排序用户行锁后检查当前账号/角色/sid撤销和宿主归属。失权403、目标变化409，拒绝不推进基线、不改用量/配额/余额。原免费与付费规则保持，锁等待后重读余额用于账本。
- `logs/takeover-traffic-auth-before-ready.log`真实PG先复现管理员被禁仍返回200并重置；`takeover-traffic-auth-server-complete.log`最终exit0通过admin/host/owner禁用/会话/全会话及降权、宿主/实例转让/删除竞争、免费/付费正常、陌生人/余额不足、2500−100用量、额外额度清理、原计数基线和并发扣费后balanceBefore=20的日志。实际Fastify/PG行锁，认证hook为固定身份夹具，实例均停止态，未连接Incus或真实支付。
- 后端types/build exit0、4项流量守卫、manifest191常规87环境排除通过，新PG专项接CI。初次PG未启动/夹具缺authenticateAdmin已分别纠正；旧专项因security定时器未退出，在自己数据清理后终止两个残留测试进程，最终专项显式结束且退出0。原本地PG数据目录自动恢复后运行127.0.0.1:55438，凭据不记录；启动等待shell已退出，不关闭测试库。
- 只改手动实例重置入口与采样携带身份，不把本项当所有定时重置、运行中Incus带宽、跨服务任务或生产验收完成。R265继续核专用流量额度API缺monthlyLimit是否意外清为无限，shared parser空字符串在其他UI中的显式清空语义须保留。327与完整灾备未完成。

## 2026-10-29 R1-260 支付三语与占位符运行证据

- R259 6c9dfe5已push并核远端一致。`logs/takeover-payment-locales-browser.log`实际PaymentProvidersView/Chrome覆盖zh-CN/zh-TW/en与yipay/heleket/upaypro/antom/manual五种已实现渠道，当前控件标签/占位符无原始key，密码字段保持空；1440/390截图检查通过。API仅受控list一次，没有任何保存/支付请求。
- 原Heleket示例key已修为i18n字面@并在三语实际runtime精确等于USDT@TRON等多行文本；当前页面已无此key的控件引用，明确是保留目录消息验证，不称现有textarea截图。原review-locale-messages的目标namespace编译和本项i18n/route共3守卫通过，manifest191常规86环境排除通过，Chrome专项接CI。产品与翻译无新增改动，沿用R258最终构建。
- 原清单未提供全部缺失key集合，本项不宣称所有消息穷尽显示通过；邀请码R308/315与TG长Webhook R326仍需各自页面验证。接R264流量锁内权限竞态，route/DB/守卫及现有user-write authorization已读未改。327与完整灾备未完成。

## 2026-10-29 R1-259 Markdown属性与DOM过滤浏览器证据

- R258 d8c8e33已push并核远端一致。本项补此前escapeHtml/DOMPurify源码的真实Chrome证据：`logs/takeover-markdown-attributes-browser.log`通过链接title及图片title/说明中的引号、&、尖括号、格式化链接、外链noopener/noreferrer和数字相对URL；脚本/iframe/object/事件属性与危险/未知协议移除。主动触发error/load/click后执行计数仍0，保留平台提示图标几何。
- 实际TermsOfServiceModal/受控内容、桌面手机截图已检查；故意失效图片用于onerror验证，不是生产图片丢失。仅新增专项、CI和台账，沿用上一项最终类型/守卫/双端build/dist，manifest191常规85环境排除通过。证明已列测试输入，不声称穷尽所有恶意HTML或完成327。下一项R260支付页面三语专项继续。

## 2026-10-29 R1-258 Markdown嵌套内容与可见图形

- R257 f1cc7c7已push；R256 98ad127 CI40757078467、R255 b4e0ef8 CI40756107209最终success。实际Chrome子tokens验证覆盖格式化链接、嵌套引用/列表、勾选/未勾选任务、有序列表与字面代码；截图发现已勾图标缺失，进一步确认DOMPurify清掉path.d。浏览器及jsdom新增断言均先红（takeover-markdown-tokens-before.log、takeover-markdown-geometry-before.log）。
- 根因是URI正则否定字符集的`.-:`意外包含数字，导致以M数字开头的SVG路径及数字相对链接被过滤。连字符移至尾部、完整识别协议中的数字，保留HTTP/HTTPS/mailto/tel及相对URL，拒绝脚本/data/未知协议；标签与属性白名单不放宽。仅修一行正则并加解释。
- `takeover-markdown-tokens-browser-final.log`实际任务checkmark非空几何及嵌套矩阵通过，手机勾选/外链图标截图已看；3守卫通过，整理等价正则以满足lint后再跑Markdown runtime，lint通过。为覆盖最终源码完整重跑双端vue-tsc/build（build-final.exit=0），dist通过。旧首轮构建不作为最终源码证据。R259引号/属性独立浏览器已通过未提交，下一项登记；327和完整灾备未完成。

## 2026-10-29 R1-257 Markdown表格浏览器证据

- R256 98ad127已push并核远端一致。本项复核此前已改的renderer.table：使用token.header和token.rows按cell.tokens渲染，不再错误地将单元格当数组。`logs/takeover-markdown-table-browser.log`实际Chrome/TermsOfServiceModal通过普通表、仅表头、空单元格、加粗/链接/code及桌面1440/手机390无整页横溢，截图已看。
- 只新增实际浏览器专项及CI入口、台账，未改产品或法律正文；现有Markdown runtime和刚完成的4守卫/双端types build/dist证据沿用，manifest191常规84环境排除通过。R258子tokens与R259引号/属性运行证据随后分项补，不能以表格通过覆盖全部Markdown安全性或327。

## 2026-10-29 R1-256 条款离页隐藏与取消读取

- R255 b4e0ef8已push并核远端一致，R252 00de40e CI40754421823最终success。条款显隐绑定KeepAlive活跃状态，关闭/切语言/离页/卸载取消fetch并失效代次；迟到响应和body不回填。缓存页隐藏时不读取，返回按当前语言恢复，原同语言成功内容仍复用；法律内容与正常关闭行为保持。
- `logs/takeover-terms-lifecycle-before.log`实际Chrome先复现离页Teleport遗留；`takeover-terms-lifecycle-browser-final.log`通过隐藏移除/无请求、abort后强制旧回执、关闭重开/成功缓存、body迟到、卸载重建与初始隐藏。第一次关闭断言落在退出动画中，改为最多2秒等待DOM实际移除，未更改产品动画或放宽最终结果。语言完整回归与三语截图、4守卫/lint/双端vue-tsc/build最终exit0/dist和manifest191常规83环境排除通过，新专项接CI；split-deploy allowlist仍锁同源tos URL，仅增加signal。
- R257表格真实Chrome专项已通过普通/仅表头/空单元格/inline tokens/1440与390，截图已看，scripts/test-markdown-browser.mjs未登记未提交，留下一项。随后R258/259及R260继续。流量R264路由与重置锁守卫已读，管理员/宿主旧授权仍需锁内复审。327与完整灾备未完成，无生产改动。

## 2026-10-29 R1-255 条款正文跟随当前语言

- R253 2d12e6c已push并核远端一致；默认机器池18e5d85 CI40753458066最终success。条款监听当前语言及显示状态，以现有zh/en源选择正文；切换清旧文，已成功同语言内容可复用，迟到success/error/finally与response.text不覆盖新语言。简繁继续共享原zh文件，法律正文不改。
- `logs/takeover-terms-language-before.log`实际Chrome先复现切英文仅标题变而正文不重读；`takeover-terms-language-browser.log`通过显隐切换语言、简繁共享、乱序/迟到正文、404重试及三语1440/390。截图已检查；同源fetch为受控夹具。4守卫（含split-deploy静态资源合同与Markdown runtime）、lint、双端vue-tsc/build最终exit0、dist/manifest191常规82环境排除通过，新专项接CI。最终仅变量名与原静态资源allowlist对齐，URL行为相同。
- R256已单独先红：KeepAlive离页后Teleport仍覆盖其他页（`takeover-terms-lifecycle-before.log`），专项未登记未提交；随后补缓存活跃/卸载与取消读取。Markdown浏览器表格专项也仅准备未验。327与完整灾备继续，无生产改动。

## 2026-10-29 R1-253 旧套餐刷新期间禁用旧选择

- R252 00de40e已push并核远端一致，CI40754421823最后仍运行。旧套餐创建要求套餐/方案/宿主/镜像读取结束，并核当前套餐、宿主和镜像属于已加载选项。镜像读取开始即清旧选项，成功后仅当原选择仍兼容才恢复；保留原128MB阈值与计费/交付合同。
- `logs/takeover-admin-package-options-before.log`真实Chrome先复现刷新中旧镜像仍可提交；`takeover-admin-package-options-browser-final.log`通过刷新/直接submit禁写、旧成功失败/finally、当前镜像与宿主失败、最终精确payload、同阈值内内存调整及兼容镜像保留。旧套餐写回执和默认机器池两回归（三语1440/390）、4守卫、lint、双端vue-tsc/build最终exit0、dist和manifest191常规/81环境排除通过；初次pnpm参数被拒未执行守卫，改直接调用统一runner后4/4通过。
- API受控，没有真实开通或扣费。新专项接CI。R255条款切语言仍显示旧正文已另行先红（`takeover-terms-language-before.log`），新夹具/专项未登记未提交，产品未改；R256生命周期和R257–259浏览器验证随后。327与完整灾备未完成。

## 2026-10-29 R1-252 旧套餐创建回执与草稿隔离

- 默认机器池入口18e5d85已push并核远端一致，CI40753458066最后仍运行。旧套餐创建绑定username/session/route/cache/资源来源代次及提交草稿快照；旧成功失败不能清空新输入、显示旧凭据或污染当前错误。正常成功提示、凭据展示和原重置保持，后端创建、计费和交付合同未改。
- `logs/takeover-admin-package-write-before.log`真实Chrome先复现新名称被旧成功清空；`takeover-admin-package-write-browser.log`通过新草稿/目标保留、十连单请求、session/cache/route/source/unmount旧凭据隔离、当前失败保草稿及正常成功重置；三语1440/390截图已检查。机器池回归、4守卫、lint、双端vue-tsc/build（最终退出码0）、dist与manifest191常规/80环境排除通过。API受控，没有真实创建、收费或生产变更。
- 新旧套餐Chrome专项已接CI。下一项R253镜像/宿主刷新期间仍可提交已先红（`takeover-admin-package-options-before.log`），专项未登记未提交，产品尚未改；327与完整灾备继续，实际资源交付不记已验。

## 2026-10-29 管理员默认机器池不等待旧套餐

- 机器池读取dfae114已push并核远端一致，CI40752294978最后运行；回执47be7e3 CI40751161454最终success。管理员创建页默认立即显示机器池与目标输入，只有点击「原有套餐」时才加载旧套餐及其方案/宿主/镜像，成功结果页内缓存；旧请求慢或失败不能阻挡切回机器池，失败后重开原有套餐可重试。
- `logs/takeover-admin-pool-entry-before.log`真实页面先复现默认pool仍调用并等待旧packages；`takeover-admin-pool-entry-browser-final.log`通过默认零旧请求、按需读取、旧请求慢/失败仍可切回、失败重试/成功空态缓存。read/write-regression两专项及三语桌面/手机回归、3守卫/lint/双端vue-tsc/build/dist/manifest191常规79环境排除通过。实际页面受控API，无开通/扣费/生产改动。
- 旧套餐R252新草稿被成功回执清空已单独Chrome先红（takeover-admin-package-write-before.log），下一项修它的旧回执/凭据显示，R253旧镜像刷新门禁仍待。机器池一机一卖与原有套餐分支证据继续分开，327与完整灾备未完成。

## 2026-10-29 R1-253 关联主流程：机器池读取失败禁止旧数据创建

- 机器池写回执47be7e3已push并核远端一致，CI40751161454最后仍运行；R250 CI40749600296最终success。AdminPoolInstanceCreate以ready隔离读取完成，失败持久显示并通过刷新重试；成功空库存与初读失败分开。目录/镜像绑定读取代次和session/cache活跃状态，旧成功失败/finally不回填，缓存返回若在途创建先等写结束再刷新。
- `logs/takeover-admin-pool-read-before.log`实际管理员页面先复现refresh失败仍可提交旧库存/镜像；`takeover-admin-pool-read-browser-final.log`通过初读/目录/镜像失败禁写、成功空态、重试保草稿和未知结果请求ID、E2/ARM容器镜像选择与VM排除、旧兄弟请求/会话/缓存隐藏/卸载、SID刷新和在途写返回等待。`takeover-admin-pool-read-write-regression.log`回归上一项完整写入矩阵及三语桌面/手机，错误截图已看。3守卫/lint/双端vue-tsc/build/dist/manifest191常规78环境排除通过，新读取Chrome专项接CI。
- 受控API，没有真实开通/扣费/生产操作。原机器池一机一卖及后端价格/库存/权限核验不变。代码复审发现父页面仍在默认pool显示前等待旧套餐/方案请求，下一项先解除该主流程依赖；旧套餐R252/253与327剩余仍继续，不能记全量完成。

## 2026-10-29 R1-252 关联主流程：管理员机器池创建回执

- R250 8c3c138已push并核远端一致，CI40749600296最后运行。按owner提醒优先核管理员默认机器池：父页面目标查询加入session/cache/卸载代次与响应身份/状态核验；AdminPoolInstanceCreate写入捕获payload，绑定username/session/route/cache/请求编号，旧成功失败不能改当前提示或导航。保留机器池一机一卖、请求幂等、免费/付费免首月/扣首月的既有后端与原字段冻结。
- `logs/takeover-admin-pool-write-before.log`真实管理员页面先复现alice请求后换bob仍导航旧实例；`takeover-admin-pool-write-browser-final.log`通过当前默认pool、目标ABA/会话/SID/缓存/离页/切资源来源/卸载/退出、lookup错误身份/禁用用户、十连点单请求、固定payload、未知失败与退款未结重试同ID、已失败并结清后新ID、三种收费参数、当前正常成功导航，三语1440/390已截图检查。3守卫/lint/双端vue-tsc/build/dist/manifest191常规77环境排除通过；新实际页面Chrome专项接CI。
- 后端pool-orders路由/service及hosts独占预占链已复审，既有集成覆盖目标归属、三种收费及重放返回原实例；本项未改后端，浏览器API受控，无真实生产开通或扣费。下一项机器池refresh失败后仍可用旧数据提交已Chrome先红（takeover-admin-pool-read-before.log），独立继续。旧套餐R252写回执/R253刷新门禁仍待；不能将主流程修复说成这两旧分支或327全部完成。

## 2026-10-29 R1-250 宿主创建初读失败与上下文隔离

- R249 6053510已push且CI40746847268最终success；R247/R248 CI也最终success。HostCreateInstanceTab初读及方案/镜像绑定host/session/cache代次，核对auth.me身份，切换清旧套餐/密钥/配额与表单。当前初读成功才可创建；失败持久显示并重试，与成功无套餐分开；方案重试保留资源输入。在途创建返回缓存页先等写结束再重新读取。
- `logs/takeover-host-create-load-before.log`先复现初读失败伪装空套餐；`takeover-host-create-load-browser-final.log`实际Chrome/Vue通过me/packages/keys失败重试及旧成功失败、身份不符、host/session/cache/隐藏/卸载/退出/无效host、辅助错误重试保草稿，完整回归R247/248/249和三语1440/390。错误与正常截图已检查。4守卫、lint、最终双端vue-tsc/build及dist通过；日志前缀`takeover-host-create-load-*`。首轮构建随对话中断且无最终退出码，另完整运行`build-final.log`并核最终退出码0。
- API为受控夹具，无真实创建或生产部署。Owner再次提醒管理员默认已走机器池：AdminInstanceCreateView默认pool→AdminPoolInstanceCreate→/instances/admin/pool-create→placePoolOrder，后端独占预占/目标归属/请求幂等已有实现及集成断言。R250仅宿主详情分支；接续优先修机器池旧写回执，再单独处理R252/253旧套餐分支。327与完整灾备仍未完成。

## 2026-10-29 R1-249 宿主创建旧回执与新草稿

- R247 3a760c2已push并核远端一致，CI40745605752最后运行。自用/赠送创建捕获页面host/session/route/cache代次，旧success/error不能toast、导航或清草稿；请求开始保留草稿快照，仅草稿不变时执行原重置/导航，初始化命令ID数组也复制到提交payload。R248已将赠送成功名称固定到请求payload，本项继续保护整个写回执。
- `logs/takeover-host-create-save-before.log`真实Chrome先复现等待期间的新目标被成功回执清空；`takeover-host-create-save-browser.log`通过赠送新草稿保留、缓存离开返回/换host/session/卸载旧成功失败静默、当前失败保输入、自用新草稿不导航/离页回执不导航，以及R247/248完整回归。3守卫/lint/双端vue-tsc/build/dist通过。实际Vue+受控API，无真实创建/客户网络/凭据显示。
- 本项保留单组件在途门禁；不声称重载浏览器后的后端create幂等。R250初读失败重试与host/session整体刷新仍未修，327与完整灾备继续。

## 2026-10-29 R1-247 宿主创建方案与镜像乱序

- R248 c7e8f28已push并核远端一致，CI40744550016最后仍运行。方案/镜像分别维护请求序号，并绑定请求时host/session/package；套餐选择自身也有代次，旧方案完成不能继续发起新图像读取。开始读取清旧方案/镜像，成功/失败/finally仅当前请求可回填，创建要求辅助读取结束且镜像属于当前列表。
- `logs/takeover-host-create-options-before.log`真实Chrome先复现快速切换后旧方案覆盖当前选择；`takeover-host-create-options-browser.log`通过方案旧成功、镜像旧成功/失败/finally、刷新禁创建、最终planId和image精确匹配，并回归R248矩阵/三语1440/390。受控API，无实际实例交付。只按现有内存阈值触发图像刷新，未改变可用镜像后端策略。
- `takeover-host-create-options-guards.log`3/3、Vue lint、双端vue-tsc/build与dist通过。R249写入旧回执/新草稿、R250初读/host整体生命周期仍未修；327与完整灾备未完成。

## 2026-10-29 R1-248 宿主赠送目标验证一致性

- R245 f6e0390已push且CI40742907887最终success；R243 CI40742141406及R242 CI40741048390也success。HostCreateInstanceTab输入用户名改变立即清旧targetUser/验证，提交要求当前trim用户名与已核身份一致。查询以序号/host/session/模式/缓存活跃状态检查，旧成功与失败、错误身份、无效ID不能回填；同SID刷新保留，换host/会话/缓存返回重新验证。
- 新验证清空targetUser后，保存回执不可再从它读用户名，成功提示改用已提交payload.username，真实Chrome补保存期间改输入不抛空对象且提示原收件人。完整写后草稿/离页隔离留R249，初读身份/host更新留R250，方案/镜像乱序留R247；不把这一局部保护宣称全部创建生命周期完成。
- `logs/takeover-host-gift-target-before.log`先复现alice已验证后输入bob按钮仍可提交；`takeover-host-gift-target-browser-final.log`实际Vue/Chrome通过立即禁写、直接form submit、查询成功失败乱序、错误身份/inactive/无SSH、SID/session/host/cache、trim精确目标、十连提交和在途改输入回执，以及三语1440/390。API受控，无真实创建/消息发送；截图已看。hosts lookup/create-for-user授权/套餐/镜像/资源预留与交付代码及对应守卫已读，后端不改。
- `takeover-host-gift-target-guards-final.log`4/4、Vue lint、最终双端vue-tsc/build、dist和清单191常规/76环境排除通过，新Chrome专项接CI。首轮build跨越成功提示单行补改，已完整重跑最终源码build；不冒充生产归属/实例交付验收。327与完整灾备继续。

## 2026-10-29 R1-245 VIP等级读取失败禁空保存

- R243 e3cd05a已push并核远端一致。VIP等级编辑器必须当前类型/session成功读取后才启用保存和字段，错误持久显示/retry；检查响应type和rules数组，原用户/托管十级规则、阈值、badge与固定表格保持。同步保存门禁/字段冻结/固定type与payload，当前失败保草稿，旧类型/session/KeepAlive/卸载回执不回填或提示，缓存返回等待在途写settle再读。
- `logs/takeover-vip-rules-before.log`真实Chrome先复现初读失败仍发送空规则。后端replaceVipRules已核空数组会delete该type规则，本项不改变后端合法替换合同。`takeover-vip-rules-browser.log`实际Vue通过初读错误禁写/重试、十连点/冻结、正常保存与失败保草稿、user/hosting乱序与在途切换、session/同SID/缓存/卸载/退出、三语1440/390；截图已看。API受控，没有真实服务器VIP规则变更。
- `takeover-vip-rules-guards.log`4/4、Vue lint零报告、双端vue-tsc/build、dist和manifest191常规/75环境排除通过；复用夹具的奖励编辑专项`takeover-vip-rules-reward-regression.log`也通过。新等级Chrome专项接CI。后端跨管理员替换竞争未新增版本保护；327与完整灾备继续。
- 下一组R247–250 HostCreateInstanceTab已读主要组件/父v-if/API/hosts lookup与create-for-user校验链/host守卫；R248目标用户名改变未清旧验证，P1优先，尚未编辑。R244为跨域旧项验证汇总仍未全面完成，不能跳过其未验范围。

## 2026-10-29 R1-243 VIP领取反馈使用实际快照

- R242 46593e1已push并核远端一致，CI40741048390最后仍运行。反馈优先claim.snapshot的type/title/config，旧卡片仅用于缺失快照且类型相符的兼容回退；批量余额/积分/待发实例均按本次服务端领取快照展示。R241已清两级timer，本项补自然过期与批量延迟边界验证。
- `logs/takeover-vip-feedback-before.log`真实Chrome先复现snapshot新名称仍显示旧卡片；`takeover-vip-feedback-browser.log`最终通过新名称/类型/数额、三类批量、legacy回退、真实4550ms自然过期、响应同任务隐藏后延迟反馈不出现，并回归R241/242。首轮计数错误取了正在move动画的两张卡，已改统计实际DOM提示卡，总数3未降低断言。API受控，非线上实际到账验证。
- `takeover-vip-feedback-guards.log`3/3、Vue lint零报告、双端vue-tsc/build及dist通过。下一项R245真实Chrome已先红：初读失败后仍发空规则替换；后端空数组明确会delete该type规则，源码及守卫已读。新rules专项/夹具扩展尚未提交，327持续。

## 2026-10-29 R1-242 VIP领取互斥

- R241 c468e21已push并核远端一致，CI40739551744最终success；R239 CI40737293969最终success。当前页面任一单项/批量领取在途时统一禁下一笔，两个入口同步检查writing；不同奖励也串行，避免旧overview覆盖较新领取结果。后端用户领取锁、次数、资金/积分锁与逐笔批量合同保持，未新增跨浏览器幂等。
- `logs/takeover-vip-claim-before.log`真实Chrome先复现单项在途仍发1次bulk；`takeover-vip-claim-browser.log`修改后单项/批量十连点和双向互斥、不同奖励串行/正确ID/最终按钮保持已领，并完整回归R241矩阵通过。受控API，无实际余额/积分发放；PASS总结文案沿用生命周期文字，新增断言已实际执行。
- `takeover-vip-claim-guards.log`3/3、相关Vue lint、双端vue-tsc/build与dist通过。剩余R243反馈仍优先旧卡片信息，随后单独修；327及完整灾备未完成。

## 2026-10-29 R1-241 VIP大厅读取与可见周期

- R239 5b5d3ed已push并核远端一致，CI40737293969仍运行；R240 CI40735740894最终success。父Entertainment的v-show现在传active，组件按挂载/KeepAlive/页签/session建立上下文，GET可取消且迟到success/error/finally拒绝。初读/恢复读失败持久显示并提供重试，失败状态不允许领取；同SID token刷新不重载。
- 已发领取不当作可取消动作：隐藏不释放其门禁，返回/换会话等最后在途写settle后读实际结果，旧回执不覆盖页面或弹提示。反馈两个timer记录并在隐藏/换会话/卸载清除；卸载旧读写不能影响新实例。单项与批量的同上下文重叠留R242，反馈snapshot优先级留R243，不宣称全部领取竞争已修。
- `logs/takeover-vip-hall-before.log`真实Vue/Chrome先复现隐藏返回请求数仍1；`takeover-vip-hall-browser.log`最终通过v-show/KeepAlive/旧读取消后强制回执、读错误重试、token/session/退出、单项和批量在途写、失败恢复读、反馈清除/卸载和三语1440/390。API为受控夹具，无真实发奖或账目变化；截图已看桌面中文/手机英文。
- `takeover-vip-hall-guards.log`4/4、相关前端lint零报告、双端vue-tsc/build、dist boundary及清单191常规/74环境排除通过，新Chrome专项接CI。后端领取锁/次数/资金/快照实现已读，未改；不能将前端夹具当成线上账目验收。327及完整灾备继续。

## 2026-10-29 R1-239 VIP奖励分步保存恢复

- R240 c465d9a已push并核远端一致，CI40735740894仍运行。管理员保存加同步门禁、固定ID/草稿payload快照和fieldset冻结；成功create立即记回服务器ID，成功delete移出待删队列。部分失败/结果不确定/保存后重读失败持久提示，必须重新读取核对实际结果，未保存草稿明确会被替换，禁止盲目整批重发。
- 读取按会话/挂载/KeepAlive/代次保护，初读失败禁编辑并提供重试，套餐方案旧成功/失败/finally同样隔离。同SID token刷新保草稿；缓存离开不释放在途写门禁，返回先等写settle再读实际状态，旧批次不继续下一条、不显示成功。卸载旧实例不能更新新组件。后端仍逐条非原子、create未新增幂等合同，跨浏览器/跨管理员以及请求结果不明时的后端竞争不属于此项保证。
- `logs/takeover-vip-save-before.log`实际Chrome先红：十连点发10次请求；`takeover-vip-save-browser.log`最终通过同步十连点/字段冻结/固定payload、部分create-delete成功后失联与重读、恢复后只update、成功写后重读失败、初读retry、同SID/换会话/退出、KeepAlive在途写及卸载、方案旧回执/三语1440/390。首轮新增成功请求后金额回归仍断言总数0，已改比较调用前后数量；产品金额断言未放宽。截图已看桌面中文/手机英文，API受控，无真实领取。
- `takeover-vip-save-guards.log`4/4、改动Vue lint零报告、双端vue-tsc/build及dist通过。没有修改后端合同，沿用R238/240真实PG证据，不冒称本项做过跨管理员或生产保存验收。R241–243用户领取生命周期/并发/反馈继续，327与完整灾备未完成。

## 2026-10-29 R1-240 VIP余额奖励归一化下界

- R238 fe425fd已push且CI40732783340最终success。后端normalizeMoney在原有限数/上限校验基础上拒绝舍入后为0；管理员表单同样在发请求前拒绝舍入0与超界。0.005→0.01、12.345→12.35保持原兼容，不改领取/计费逻辑。
- `logs/takeover-vip-amount-before.log`实际Fastify/隔离PG先复现极小正数返回200；`takeover-vip-amount-server.log`修改后新增/修改拒0、负数、舍入0与超界，失败保原config、正常舍入以及R238说明回归通过。`takeover-vip-amount-browser.log`实际Vue/Chrome验证请求前拦截与精确payload，三语1440/390截图已看；API为受控夹具，无真实奖励领取。
- `takeover-vip-amount-guards.log`4/4、server types、双端vue-tsc/build、dist boundary、改动Vue lint零报告和清单191常规/73环境排除通过。浏览器专项已接CI；server测试最后仅调整PASS总结文案，断言已运行。未宣称全套/线上验收。R239逐条保存及R241领取生命周期继续，327与完整灾备未完成。

## 2026-10-29 R1-238 VIP奖励说明显式清空

- R237 e0b14c6已push并核远端一致。normalizeRewardData仅当description为undefined才取旧说明，显式null/空串/空白交给原normalizer清空；前端原本就把空输入传null，无需修改。奖励数值/类型/领取/资源交付保持。
- `logs/takeover-vip-description-before.log`实际Fastify/PG先复现null仍返回Restore me；`takeover-vip-description-server.log`修改后balance/points两类型的null/空串/空白、回执与重新列表、缺省保原文、配置金额与disabled保持均通过，无领取或账目/实例写入。身份hook为夹具，测试只清自己新建且无claim的记录。
- `takeover-vip-description-types.log`后端类型、`takeover-vip-description-guards.log`2/2 VIP路由/积分余额锁守卫、diff及清单191常规/72环境排除通过；真实PG专项接CI。仅server单行变更，不重复前端构建。不代表跨管理员保存竞争或真实奖励领取已验，R239/240/241继续。

## 2026-10-29 R1-237 无入口签到弹窗

- R234 ebafb0f已push并核远端一致，R235 CI40727283504最终success。已核双端入口、Vite、组件标签及导入，CheckinModal没有应用调用/自动注册；删除整份旧礼盒弹窗及局部样式。当前Entertainment的签到/资源池/兑换及后端保持。原编号称分享辅助，但当前文件并无独立分享函数，仅分享规则展示；不虚构删掉额外函数。
- redeem-code-management守卫原先只读取退役弹窗的三条规则key，改检查当前Entertainment真实兑换调用/按钮；原三语兑换文案及后端管理/归属/库存/流量守卫保持。`logs/takeover-retired-checkin-references.log`运行和测试无旧引用，`takeover-retired-checkin-guards.log`3/3、双端vue-tsc/build、dist和diff通过。死代码无运行入口，不冒充签到生产验收。
- R238真实Fastify/隔离PG专项已先复现null说明仍恢复旧文本（`takeover-vip-description-before.log`），新测试文件尚未提交，后端单行修复随后分项验证。327持续。

## 2026-10-29 R1-234 通知配置读取链路

- R235 81421ec已push并核远端一致，CI40727283504仍运行；徽章测试修正bdadd1c CI40725732406最终success。纠正通知初审：列表从未返回notificationConfig，有回填代码不能证明表单收到配置。
- 通知弹窗现在按ID读取详情后回填，读取失败/目标不匹配/未知通知类型时禁保存并持久retry。关闭/重开/会话/缓存/卸载清旧配置并拒旧回执；保存固定ID/快照、同步禁重复与冻结，旧保存不关闭新上下文，当前错误保留草稿。token/Discord地址/secret输入隐藏显示，字段增加可访问名称，手机长表单允许滚动。不改通知发送器/后端接口或实际账号配置。
- `logs/takeover-lottery-notification-server.log`真实Fastify/PG验证三种配置保存后详情完整返回、列表仍不含凭据；所有值均为inert示例，无消息发送。`takeover-lottery-notification-browser-final.log`真实Vue/Chrome通过三种回填及精确payload、十连点、字段冻结、读取失败禁覆盖/重试、旧请求/会话/缓存及null默认值，并完整回归R235。首轮退出DOM仍处200ms过渡，等待后最终通过。三语1440/390截图已看，示例token遮蔽。
- `takeover-lottery-notification-guards.log`4/4、build双端vue-tsc/build、server types、dist及lint零报告通过；复用已接CI专项。未提供通知跨管理员版本冲突解决或真实外部发送验收。下一项R237无入口旧CheckinModal，再R238–241 VIP奖励空说明/重复保存/数值/读取生命周期；327与完整灾备仍未完成。

## 2026-10-29 R1-235 抽奖库存增量与编辑版本

- 徽章测试修正bdadd1c已push并核远端一致。奖品PUT改为expectedRevision+replenishAmount，拒绝旧客户端绝对remainQuantity及缺失/旧版本；revision持久递增，抽奖扣库不改变编辑版本。迁移`20261029001000_lottery_prize_revision`只加默认0列，上线前仍须正常migrate。
- 管理修改取得奖品行锁后读当前库存并原子increment，保留期间消耗；普通有限数量编辑不重置剩余。null明确无限、无限转有限初始化数量，points/nothing清限量，有限补货及最终值均核PG Int上限。抽奖在选中奖品后也取行锁，旧RepeatableRead快照变更交由原路由整体重试，保留积分/余额锁和发奖语义。
- 前端打开先取详情，提交固定草稿/版本；保存同步禁重复、冻结字段/关闭，失败持久提示并禁重发，必须重读实际保存结果，清已提交补货与未保存草稿。旧会话/缓存/关闭读取或写入回执不继续批次、不弹成功。多奖品仍逐个API请求，不是原子批量事务；整活动并发概率校验、创建幂等、生产奖品验收仍不属本项完成范围。
- `logs/takeover-prize-stock-server-final.log`真实Fastify/全新本地PG通过实际抽奖后编辑、8并发同版本仅1次补货、重复旧请求、行锁等待期间扣库、实际抽奖竞争重试、null/类型转换/上下界/旧客户端拒绝。日志40001是刻意制造并发后按原路由合同重试成功；身份中间件为夹具。`takeover-prize-stock-fresh-migrate.log`全新库全迁移通过，旧隔离库actor_sid迁移记录不一致保留，不硬标已执行。
- `takeover-prize-stock-browser-final.log`实际Vue/Chrome通过详情门禁、增量payload、十连点/冻结、部分失败阻断/重读、清空/非法值、关闭/会话/缓存及三语1440/390；截图已看。早期fixture仅按按钮文字找桌面图标及200ms退出DOM/并行挂载就绪导致误判，最终匹配实际title、等待退出/15秒有界挂载后通过；toast累计事件保持。`takeover-prize-stock-guards.log`5/5、前后端types、双端build、dist、client lint零报告、manifest191常规/71环境排除通过，两专项接CI。server未配置独立ESLint（手动调用退出2），以后端类型/守卫/真实PG及代码审查验证，不记server lint通过。
- 下一项R234已纠正初审：列表不含notificationConfig，虽然弹窗有回填分支也无法收到已保存值；待修详情读取及覆盖风险。327、完整网关灾备未完成，无生产更新。

## 2026-10-29 徽章浏览器提示计数修正

- R233 f6bf2e0的CI40721596289最终失败：6/7任务success，instance-badge最后卸载断言中可见toast从3自然过期成2，错误日志`logs/takeover-r233-ci-failure.log`。不是Chrome启动超时，不以重跑掩盖断言问题。
- 测试夹具现在同步观察实际toast新增ID，累计记录发生的提示，比较调用次数不比较正在显示的数量；badgeUpdates显式JSON序列化避免CDP返回Vue代理空对象。原产品toast及过期计时器完全保留，新增真实等待3400ms后可见toast为0而累计效果不变断言。
- `takeover-toast-evidence-instance.log`及`takeover-toast-evidence-center.log`两个实际Vue/Chrome专项通过。仅改测试，不改产品、不需要重复产品build。用户侧栏d4822de已push并核远端一致；R235继续未提交，前后端types/5守卫/双端build/dist/PG和前端初轮矩阵已通过，新toast事件计数回归需等浏览器夹具真正挂载再运行。

## 2026-10-29 用户左侧导航隐藏购物车

- 按owner最新要求，仅移除`side-nav-items-user.ts`中的checkout菜单项；同一SideNav的桌面/折叠/手机抽屉同步生效。购物车路由、页面、顶部按钮和创建实例中的其他入口未修改，要求同步OWNER_REQUIREMENTS。
- `logs/takeover-sidebar-cart-browser.log`实际SideNav/CartButton在Chrome三语/1440与390/折叠通过：侧栏无购物车，创建实例/我的实例仍在，顶部购物车点击进入`/checkout`。截图`logs/sidebar-cart-fixture/1440.png`及390.png已看；本地配置夹具，不是生产账号验收。初次本地夹具把Chrome profile放Vite watch目录造成EBUSY，改独立profile并禁watch后通过；一次性检查只留logs。
- `takeover-sidebar-cart-guards.log`2/2、`takeover-sidebar-cart-build.log`双端vue-tsc/build、dist/lint/diff通过。未部署生产。本项单独commit/push；R233 f6bf2e0已push，R232 CI40720597481最终success，R233 CI40721596289仍运行。
- R235库存修复仍在工作区未完成：已初改DB/路由/revision迁移，前端合同尚待同步，绝不夹入本提交。旧隔离库migrate因既有actor_sid列/迁移记录不符失败；全新`takeover_prize_20261029_pool_test`完整迁移通过，继续在新库专项验证。327持续。

## 2026-10-28 R1-233 实例徽章写后状态同步

- R232 `773cd93`已push，CI40720597481仍运行。本项apply/remove后重新读取当前实例的iconBadgeId并同步父组件，null是有效清空；不再emit旧ownership或固定null。当前ownership同时匹配实例及实际徽章，避免概览并行读取时旧归属遮盖新图标。
- 写入结果不确定时也重新读取；刷新失败不emit、不报成功，持久retry成功后补同步。当前实例已不可访问时不冒充核验成功。关闭、换实例/会话等清同步标记，原生命周期门禁保持。后端getBadgeOverview仍为多表Promise.all，不是事务一致快照或服务器幂等。
- `logs/takeover-instance-badge-result-browser-final.log`实际Vue/Pinia/父组件与受控API通过保存后变更/清空、移除后被替换、刷新失败及重试、写入失败后核状态、目标消失和R232全回归；`takeover-instance-badge-result-guards.log`4/4、`takeover-instance-badge-result-build.log`双端类型/build、dist/lint/diff通过。无真实账户徽章写入，证据不扩大为生产验收。
- 下一项R235抽奖补货仍用旧remainQuantity覆盖期间消耗，继续核数据库原子更新、整数/无限库存边界与重复保存。R234通知设置已有回填，保留误判结论；327及完整网关灾备未完成。

## 2026-10-28 R1-232 实例徽章弹窗读取生命周期

- 启动器`f300868` CI40718065602、R231 `71c6038` CI40717505609、R227重跑CI40715873444均最终success。
- InstanceBadgeModal初次visible即读；关闭/重开、instanceId/session、KeepAlive切换与卸载取消GET、清旧overview/error并失效所有回执。apply/remove固定目标与周期，旧完成不toast/emit，未结束写保门禁。读取失败原地重试，缺当前可管理实例/读取失败时禁写，失活不显示Teleport。
- `logs/takeover-instance-badge-browser.log`实际Vue/Pinia/KeepAlive、延迟API通过初始打开一次、ID/重开/会话/同SID/缓存/卸载、旧成功失败、取消/retry、apply/remove 10连点及在途跨上下文回执；三语1440/390截图已看桌面中文/手机英文。`takeover-instance-badge-guards.log`4/4、`takeover-instance-badge-build.log`双端vue-tsc/build、dist/lint通过；191常规/69环境排除清单通过，新专项接CI。
- R233同一上下文保存后emit旧ownership/null以及currentBadgeId回退旧prop仍独立待修；不要把R232视为整个弹窗已完成。无真实账户徽章/积分写入，327持续。

## 2026-10-28 浏览器专项启动诊断补强

- R231 `71c6038`已push且远端一致。941cbdc/19a0ef8的CI都曾在同一个init-command-selector步骤出现Chrome启动20秒超时，前者rerun成功，后者仍待；原helper只等stderr且超时不输出已收集诊断，现有日志不足以判定Linux真实根因。
- `.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs`启动同时检查自己的DevToolsActivePort和分段stderr、只接收本机调试地址；45秒有界截止、spawn/退出错误与限长stderr回报，失败清自身Chrome/临时profile，成功后继续排空stderr，Windows后台窗口隐藏。没有重试或跳过任何测试断言。
- `logs/takeover-browser-startup-guards-final.log`分段日志/仅端口文件/非法端口/spawn/退出/超时/限长及监听清理通过；`takeover-browser-startup-chrome.log`真实Chrome完整命令选择器通过，`takeover-browser-startup-image.log`真实图片恢复通过，node --check与191常规/68排除清单校验通过。本项仅测试工具，不改产品构建；Linux失败是否消失须看后续CI，不提前记根治。
- 接着R232/233实例徽章弹窗，已读源；327持续。

## 2026-10-28 R1-231 徽章中心读取与动作生命周期

- R227 `19a0ef8`已push并核远端一致；CI40715873444再次在Chrome启动20秒超时，已rerun失败任务，待最终。R228 CI40714895982最终success。
- BadgeCenter概览绑定KeepAlive/session/请求代次，隐藏/卸载取消GET并拒迟到数据、avatar覆盖与finally；返回刷新，读取失败持久原地重试且错误状态不能继续写。随机/十连/自选/头像/实例佩戴/取消均同步门禁，旧动作不能toast/emit/弹奖励窗口；离页关窗口，未结束写请求保busy，回来后重新核状态。没有改服务器积分/归属语义或新增后端幂等。
- `logs/takeover-badge-center-browser-verified.log`实际Vue/Pinia/Router/KeepAlive与延迟API，通过旧概览/头像、缓存/会话/同SID/卸载、retry、10连点、操作中离页/换会话、旧post-write刷新与emit、实例ID/ownership快照。首次测试十连按钮key写错，修为源码实际randomMultiButton后通过；三语1440/390截图与错误状态保留`logs/badge-center-browser/`，已看手机英文/桌面错误。API是夹具，非真实积分/实例写入。
- `takeover-badge-center-guards.log`5/5、`takeover-badge-center-build.log`双端vue-tsc/build、dist及lint-final通过；专项接CI，190常规/68环境排除。下一项优先补Chrome启动诊断（重复超时只有笼统错误，不能猜定根因），然后R232/233实例徽章弹窗。327与完整灾备未完成。

## 2026-10-28 R1-227 星座生肖缺失背景渐变

- R228 `fc9b1c6`已push并核远端一致，R229 CI40713907888最终success。原HTML源未找到，本次按已存在九组元素描边色重建18组深浅主题背景，不宣称还原原始色值。只补48份实际缺失的渐变定义，既有defs、几何/路径/动画不变；生成器使用同一helper、已有定义原样保留、未知缺项明确报错。
- `logs/takeover-badge-gradients-guards.log`2/2通过（全178文件引用齐全无重复ID，18组合/已有定义保留/未知拒绝、实际生成器夹具），`takeover-badge-gradients-build.log`双端vue-tsc/build、dist通过。`takeover-badge-gradients-browser.log`真实Chrome48份前后图片全部增加可见背景像素，新增defs以外内容逐字不变；`logs/badge-gradients-browser/repaired-48.png`已看深浅主题。`takeover-badge-gradients-motion.log`178文档关键帧/18变换/reduce回归通过。
- 下一项R231 BadgeCenter概览缓存返回/旧回执与关联动作生命周期：已读源与娱乐路由/积分锁守卫尚未编辑。R232/233实际均是InstanceBadgeModal，继续保初始可见、instance/session代次及刷新后回传数据问题，不能把R230图片修复当作这些完成。327与完整灾备仍未完成。

## 2026-10-28 R1-228 徽章动画声明与减少动态

- R229 `a93a007`已push且远端一致。tiger/goat/rooster两主题各修一处animation/transform-origin缺分号；aquarius/cancer/gemini/libra/pisces/scorpio两主题补原art旋转关键帧。178资产加入减少动态CSS，生成器共用幂等归一化，原几何/颜色/有效其它动画保持。
- `logs/takeover-badge-motion-browser-verified.log`真实Chrome iframe读取实际SVG，178份声明均有解析关键帧，18修复目标在时间轴0与1/4周期的transform不同；切reduce后178文档无动画且所有元素animation-name为none。首轮未明确系统动态偏好/触发样式计算读不到动画，最终显式no-preference+layout flush并验证SVG文档类型；不以零动画误判成功。
- `takeover-badge-motion-guards.log`2/2含实际生成器夹具、`takeover-badge-motion-build.log`双端vue-tsc/build、dist与190常规/67环境排除清单通过。浏览器专项接CI；采样变换与reduce通过不代表全动画性能/所有自然帧视觉验收。下一项R227的48资产缺渐变仍待，原HTML缺失已查Desktop/Downloads无匹配。327与完整灾备未完成。

## 2026-10-28 R1-229 SVG注入JSX样式文本

- R230 `5ca08c0`与R226 `2567007`均已push且CI40711540441/40710740342最终success；R214 CI40708802507失败任务重跑后success。
- 生成器改为只收集脚本外文档style，组件局部CSS继续实际JSX渲染。178份已生成SVG仅移除9026段重复注入的JSX原文、减少2361642字节；有效局部CSS及全部非style图形/defs逐字不变。原文件备份在`logs/badge-styles-before/`，没有在仓库资产目录运行会清目录的生成器。
- `logs/takeover-badge-styles-guards.log`2/2通过（新增常规专项实际在新建隔离logs目录运行原生成器、核共享/局部style各一份、检查178资产），总清单190/66排除。`takeover-badge-styles-build.log`双端vue-tsc/build与dist通过；`takeover-badge-styles-browser.log`Chrome对178份前后图像关闭动画后逐像素一致，图形/有效局部CSS比较一致，截图`logs/badge-styles-browser/all-badges.png`已看。冻结图像比较不代表全动态逐帧验证。
- R227的48份缺渐变及R228的生肖缺分号/星座art关键帧仍独立待修；源aaaa/bbbb.html及对应git历史未找到，不能宣称完整目录从原源重建通过。327与完整灾备仍未完成。

## 2026-10-28 R1-230 徽章目录迟到后的图片恢复

- R226 `2567007`已push并核远端一致。BadgeImage实际图片地址与失败状态分离，目录返回新地址自动重试，相同失败地址的元数据更新不反复请求；按最终URL重建img，并核事件currentTarget是当前img，防被移除旧节点error污染新图。未改徽章目录API/业务或图形样式。
- `logs/takeover-badge-image-before-final.log`真实Vue/Pinia和HTTP图片复现目录已返回但仍占位；`takeover-badge-image-browser-final.log`通过迟到目录、深浅主题、ID/URL变化、旧节点error、稳定失败占位和新地址恢复。首次夹具middleware挂在Vite fallback之后造成图片响应错误，调整到configureServer后才取得上述复现；首版捕获URL的事件函数仍被Vue缓存invoker影响，最终currentTarget核验通过。
- `takeover-badge-image-build.log`双端vue-tsc/build、`takeover-badge-image-dist.log`、`takeover-badge-image-guards-final.log`2/2及lint-final通过；新专项接CI，189常规/66环境排除清单校验通过。没有线上图像/目录变更。下一项R229生成器已改只收集文档style，专项先红；178份SVG混入JSX文本尚待清理，原HTML缺失，保留资产图形。327持续。

## 2026-10-28 R1-226 巡检面板隐藏与缓存生命周期

- R214 `941cbdc`已push且远端一致；R221 CI40708054717最终success。R214 CI40708802507中6/7任务成功，Pool任务在init-command-selector的Chrome启动20秒超时，未进入断言，已仅重跑失败任务待最终结果；不记为代码断言失败或全绿。
- Billing显式传overview active，巡检面板结合KeepAlive/窗口可见性/session/历史标签控制一个串行timer，隐藏清计时器并取消旧GET；迟到success/error/finally均拒绝，返回立即刷新。已提交start/run不因隐藏释放busy门禁，旧写回执不覆盖新状态，返回后重新读实际状态。历史查询同样绑定可见周期，保同会话筛选页码，换会话重建。
- `logs/takeover-expiry-panel-browser-final.log`实际Vue组件/Pinia/Router/KeepAlive与延迟API，通过首次无双请求、15秒/5秒单timer、v-show/缓存/可见性/session/同SID/退出、旧成功失败与finally、10连点/操作中离页/返回/失败重试/恢复保护、历史筛选分页及卸载；GET取消后夹具故意仍回执检验防线。计时器和visibility是受控注入，非自然等待/真实后台巡检。
- `takeover-expiry-panel-guards-final.log`4/4、`takeover-expiry-panel-build-final.log`双端vue-tsc/build、`takeover-expiry-panel-server-types.log`及dist通过。初轮build跨越接口签名编辑发生类型错误，最终完整重跑通过；首个pnpm test参数调用失败，随后直接调用总入口完整4项通过。新组件/API lint零报告，Billing既有9处缩进警告核对HEAD未改。三语1440/390截图保留`logs/expiry-panel-browser/`，已看桌面中文/手机英文，未做完整对比度量测。专项接CI、189常规/65环境排除清单通过。
- 下一项R230已写浏览器夹具并复现目录迟到后仍占位（`takeover-badge-image-before-final.log`），源码尚未改；R227–229生成器引用的原HTML仓库缺失，先保已有资产核查，不运行递归重建目录。327与完整灾备未完成。

## 2026-10-28 R1-214 未用格式化与计费导出

- R221 `2eb96b1`已push并核远端一致，R220 CI40707194072最终success。本项删除formatters中4个无调用导出及billing中的calculatePriceDiff；getCycleDays只去export，保留日价内部调用，现行日价/折扣及页面局部函数不变。纠正初审将Dashboard局部getTimeGreeting误认为共享导出的结论。
- `logs/takeover-retired-utils-guards.log`3/3、`takeover-retired-utils-build.log`双端vue-tsc/build、`takeover-retired-utils-dist.log`和lint通过，references/after日志核实导入与局部同名函数。被删工具无现行运行入口；此项为代码/类型/构建验证，不声明线上计费验收。
- 下一项R226：账单overview的v-show与KeepAlive离页缺轮询门禁，已读组件/相关守卫，尚未编辑。327与完整灾备仍未完成。

## 2026-10-28 R1-221 套餐与方案空字段保存

- R220 `fa3174d`已push并核远端一致。PackageForm描述清空保留空字符串，MyPackages方案描述trim后仍提交空串，SLA数字输入清空时Vue产生的空字符串转为null；实际后端早已支持，不改服务器合同或价格单位。SLA属于MyPackages方案弹窗，不是PackageForm字段，纠正原台账混写。
- `logs/takeover-package-empty-browser-final.log`实际Vue组件/路由及方案弹窗通过空描述/null SLA payload、保存后列表返回空值再打开仍空、1234分价格不变，同时回归读写生命周期。初轮重开命中过渡期已退出DOM，最终等待实际关闭/新输入挂载后通过；截图`logs/package-form-browser/plan-cleared.png`已看。接口为可控夹具。
- `takeover-package-empty-server.log`真实Fastify+隔离PostgreSQL通过所有者/管理员更新空字段、恢复、省略保原值、SLA异常拒绝、无权用户403及价格保持；身份中间件是测试替身，fixture无宿主/客户实例。专项已接CI并登记64环境排除，常规189条清单校验通过。
- `takeover-package-empty-guards.log`4/4、`takeover-package-empty-build.log`双端vue-tsc/build、`takeover-package-empty-server-types.log`、`takeover-package-empty-dist.log`和lint通过；detector仅源码regex非元素检查。MyPackages其它列表/弹窗生命周期和后端授权竞争仍需独立精修，不把空值修复当作套餐全流程已完成。327持续。

## 2026-10-28 R1-220 套餐保存回执与重复提交

- R219 `5c9ab36`已push并核远端一致。保存同步拒重复/未就绪/存储池未完成请求，固定提交时ID和hostIds数组；表单在saving/saved禁用，离页仍可操作。旧成功、失败、finally按原上下文核验，不影响新目标、账号或页面。成功锁存与导航错误分开，已保存但导航被拒时不重发写入。
- `logs/takeover-package-save-browser.log`实际Chrome/Vue Router与延迟API通过10次提交一次请求、字段冻结、ID/hostIds快照、失败保草稿重试、旧成功/失败/finally与新保存竞争、离页/会话切换、同SID刷新、导航被拒后的成功锁存和正常创建/编辑。三语/桌面手机截图检查通过；API为夹具，非真实账户保存。
- `takeover-package-save-guards.log`3/3、`takeover-package-save-build.log`双端类型build、`takeover-package-save-dist.log`边界通过；新增fieldset导致的缩进已全部整理，`takeover-package-save-lint-final.log`零报告。没有服务器幂等/断网结果协调，不把UI请求门禁当作后端当前权限原子核验。
- 下一项R221已先在真实隔离PG/Fastify核验已有空值合同（`takeover-package-empty-server.log`）：空描述/null SLA可清、缺省保值、错误SLA拒绝、无权403及价格保持；前端仍待改，独立测试脚本尚未提交。327与完整灾备仍未完成。

## 2026-10-28 R1-219 套餐编辑读取上下文

- R213 `48a05c9`已push且CI40705117888最终success；R212 CI40704378740及README修正CI40704237821均success。R222所在87e1c69的CI40703832945仍受修正前README断链失败，后续成功CI已包含该源码和真实Chrome专项。
- 当前App早已排除PackageForm的KeepAlive，原“缓存”描述不完全对应，但同名路由切换会复用组件。详情与辅助请求现绑定路由名/ID/session代次，立即清旧表单，取消旧详情并拒不匹配响应ID；旧成功/失败/finally、宿主范围和存储池不能覆盖新目标。未取得本次详情禁保存，失败留当前页提供重试，同SID令牌刷新保草稿，卸载/退出失效。
- `logs/takeover-package-context-browser-final.log`实际Vue Router/KeepAlive排除及源码组件、可控延迟API通过快速切换/旧错误/错误ID/原地重试/辅助迟到/换会话/退出/同SID刷新/创建编辑/离开再进入。三语1440/390深浅截图和错误状态在`logs/package-form-browser/`已检查；纯API夹具，不是账户/宿主/套餐写入真后端验收。
- `takeover-package-context-guards-final.log`3/3、`takeover-package-context-build.log`双端类型build、`takeover-package-context-server-types.log`、`takeover-package-context-dist.log`、lint/diff通过。detector仅.vue regex且无报告，不算完整元素/视觉检查。浏览器专项接CI并列63环境排除；189常规清单。下一项R220保存迟到导航/快照/重复提交，R221空描述与SLA仍未完成；327持续。

## 2026-10-28 R1-213 退役隐式Turnstile工具

- R212 `803df02`已push并核远端一致。逐个追踪导出与调用者后删除无入口的useTurnstile composable及utils中3个隐式验证导出；现行TurnstileWidget、登录/注册/找回密码的readTurnstileToken与focusTurnstileSection保留且逐字未变，GiftCards页面自己的getTurnstileToken不属于旧工具。没有移除现行验证码或后端验证。
- `logs/takeover-retired-turnstile-final-references.log`源调用及保留函数比对、`takeover-retired-turnstile-guards.log`4/4路由/认证/实例验证码/礼品卡守卫、`takeover-retired-turnstile-build.log`双端类型build、`takeover-retired-turnstile-dist.log`边界及`takeover-retired-turnstile-lint.log`通过。没有旧隐式工具的活体入口，不冒充Cloudflare真实验证。
- README修正CI40704237821已通过Lint/仓库守卫及各集成任务，最后Build仍运行。下一项R214初审需纠正：Dashboard的getTimeGreeting是本地函数，并未用共享导出；getCycleDays在calculateDailyPrice内部实际调用，仅去export。R219/220读请求/保存仍待修，R221的SLA位于MyPackagesView方案弹窗，不能误认为PackageForm有此字段。327继续。

## 2026-10-28 R1-212 Prisma注释与单位

- README链接修正`484c06d`已push并核远端一致。R212读取真实会话生成/撤销、AFF创建、套餐开通换算和邮箱购买/续费后，只修正schema及security的相关注释。JWT sid是refresh token SHA-256摘要前32位，用户级失效使用__USER_LEVEL__而非null，iat等于截止时间也失效；PG普通唯一约束允许多个null，AFF现行代码明确允许多个全局码。
- PackagePlan.price为分，Instance.billingPrice与MailPlan.price为元，均说明按各自billingCycle整周期。User邮箱订阅模块仍使用，不应按清单措辞当作已退役。没有改金额、鉴权、唯一约束或数据库内容。
- `logs/takeover-schema-comments-guards.log`4/4鉴权/推荐/套餐/邮箱相关守卫、`takeover-schema-comments-validate.log`Prisma validate、`takeover-sw-server-types.log`后端类型通过；`takeover-schema-comments-only.log`对比HEAD去除注释后的schema/security内容完全相等，无需migration。仅维护注释，不声称新的线上业务验收。继续R213等，327未完成。

## 2026-10-28 R1-210 README链接回归修正

- R222 `87e1c69`已push并核对远端一致。R210的README误指向不存在的v1.7.7发布说明；本机Test-Path与git ls-files均确认不存在，前次部署文档守卫/VitePress构建没有覆盖README链接。上一节所写“本地生成文件造成漏检”是未核实推断，本节纠正。
- README改为已跟踪的`docs/gateway-setup-v1.7.7.md`，保留真正Release链接；`logs/takeover-readme-link-guards.log`仓库来源/README全部本地链接/安装发行守卫通过。仅链接修复，无需重建未改的文档站或客户端；后续CI另验。

## 2026-10-28 R1-222 静态缓存后台写入与容量

- 完整缓存写入/裁剪Promise在fetch事件内同步登记waitUntil；网络响应独立返回。缓存修改与手动清空串行，成功写入后裁剪至256条；存储失败记录固定警告且不污染队列。清空增加代次，旧下载不能在清空确认后回填。激活只删除本应用旧缓存，断网只读取当前版本，避免误取其它缓存。
- `logs/takeover-sw-lifecycle.log`运行实际worker源码，受控慢写/280并发/打开、写入、删除故障/清空竞争/非200与排除路径通过。`takeover-sw-browser-final.log`真实Chrome在两个独立本地HTTP源注册原worker，网络断连命中/未命中、清空确认及280资源写入后的256条上限通过。首轮5秒夹具提前判容量失败，最终改为等最后排队写入回执后检查；无生产站点改动。
- `takeover-sw-guards.log`2/2、`takeover-sw-build.log`双端vue-tsc/build、`takeover-sw-server-types.log`后端类型、`takeover-sw-dist.log`边界通过，JS语法与diff检查通过。新受控专项进入189条常规清单，真实浏览器专项登记62项环境排除并接CI。256仅限制条目数，不是总字节配额。
- R215 `94ddcca`已push。R210 CI40701860321最终失败：README链接`docs-site/release-notes/v1.7.7.md`不存在，本轮所跑文档检查未覆盖README；日志`takeover-docs-ci-failure.log`。正在单独纠正链接/重验，不能记CI全绿。R212只改注释已完成本地编辑，分项验证保存；327与网关灾备仍未完成。

## 2026-10-28 R1-215 大流量单位证据纠正

- 已确认formatBytes的PB/EB、单位索引上下界及非有限/非正数防护已在此前源码修复。本轮`logs/takeover-format-bytes-evidence.log`重新运行现有core-boundaries专项通过，包含1024**5 → 1.0 PB、1024**6 → 1.0 EB、Infinity → 0 B；仅纠正R215误填的Cloud-init说明，不重复实现、不新增无意义测试。
- R210 `4d17604`已推送并核对远端一致，工作区干净；R204 CI40699019799、R211 CI40699573526及R207 CI40699736282均最终success。R210文档站部署40701860325成功，源码CI40701860321仍在运行；文档站部署不等于面板生产部署。
- 随后精修R222静态缓存后台写入生命周期，再继续Prisma注释/旧Turnstile与套餐表单。327项及完整网关灾备仍未完成。

## 2026-10-28 R1-210 备份、迁移与部署事实文档

- README正式版更新为已核实的v1.7.7（非draft/非prerelease，2026-10-27发布），main后续修复与正式发行分开。中文/英文介绍、环境和手动部署说明明确：安装器仍安装启动Redis，但后端无Redis client/共享状态，已有systemd依赖不能直接移除；私有后端只能单Node进程。
- 明确Prisma/PostgreSQL已运行与每版仍须migrate deploy的区别，手动命令显式ENV_FILE=/opt/incudal/.env。对照实际详情入口/自动调度/后端路由补充：实例快照受配额控制、实例备份后端仍在但当前无独立标签、自动调度只执行快照；OSS平台备份不包含客户VPS磁盘，完整灾备未验收。R210初审中笼统的Redis过时判断已纠正。
- `logs/takeover-docs-facts-guards.log`部署文档守卫与`takeover-docs-facts-build.log`VitePress中英文完整构建通过；构建器生成的版本日志同步保存。仅文档，不改安装器/数据库/运行环境，不把文档验证当作实装验收。下一项R212等，327未完整。

## 2026-10-28 R1-207 退役认证外壳及样式

- R211 `f090338554f3b079596b2e58988d6776edd050d3`已推送并核远端一致。R207删除只互相引用的`PublicAuthShell.vue`与`useM3Auth.ts`，当前登录/注册/管理员登录不使用它们，双端入口/Vite也无自动注册。PlanetScene在当前源码本就不存在，不虚构删除第三文件。
- `logs/takeover-retired-auth-references.log`无引用、`takeover-retired-auth-guards.log`2/2路由/i18n守卫、`takeover-retired-auth-build.log`双端类型+构建、`takeover-retired-auth-dist.log`边界检查通过。无对应运行页面可验，现行认证行为不改。
- 下一项R210当前说明与部署事实：安装器仍安装/启动Redis、后端并未使用Redis持久化状态，应分别解释；Prisma/PostgreSQL早已运行，正常部署仍须migrate deploy，实例备份与OSS平台备份能力边界分开。327未完整。

## 2026-10-28 R1-211 旧备份策略兼容类型

- 删除`server/src/types/database.ts`内无调用的旧`BackupPolicy`/`SnapshotPolicy`接口（旧小时/保留数字段），修正文件头为Prisma/PostgreSQL适配层的snake_case兼容行类型。实际Prisma策略模型、现行DB方法和client同名API类型继续保留，未删除备份/快照能力。
- 已读兼容类型所有import及当前备份/快照策略方法和相关守卫。`logs/takeover-retired-policy-references.log`server源码/脚本无引用，`takeover-retired-policy-build.log`server类型编译+build、`takeover-retired-policy-guards.log`3/3自动策略/备份ID/快照路由守卫通过。无运行行为/数据库变更；不冒充真实备份恢复验收。
- R204 `77bb816f44e6bdebd5cab8eb4e304b9c792708ce`已推送，CI40699019799最后运行。R207独立前端清理仍在完成双端构建，分开提交；327未完整。

## 2026-10-28 R1-204 无调用图片与虚拟列表组件

- R201 `996d3db0e7c605758f202fb0edffaa020fb22229` 已推送并核远端一致，CI40690320503最终success。
- 完整读取`LazyImage.vue`/`VirtualList.vue`及双端入口/Vite组件加载方式后，删除两个无调用残留。全源码、标签大小写/短横写法、运行脚本与组件注册均无引用；当前应用无自动扫描注册机制。保留实际图片与列表页面，不把死代码维护清理记作运行缺陷修复。
- `logs/takeover-retired-components-references.log`无引用、`takeover-retired-components-guards.log`路由守卫、`takeover-retired-components-build.log`双端类型+构建、`takeover-retired-components-dist.log`边界检查通过。没有对应活体页面可验。随后R207旧认证外壳/专属样式，327仍未完整。
- Owner询问首页亮点地区缺文字：已查明`HomeRegionAtlas.vue`409行仅对San Jose/Ashburn/Frankfurt及当前选中地区渲染常驻标签，亮点独立依据真实库存；首尔/悉尼地名数据存在。已解释原因，本项尚未修改地图。

## 2026-10-28 R1-201 退役数据库优化包装

- R200 `85d2068b70a735d65294d71e0d5a1553dc0180d4` 已推送并核远端一致，CI40684971583最终success。
- 删除无入口的`server/src/db/optimizations.ts`及其10个导出。删除前完整读取模块、DB导出入口/应用动态加载与配额守卫，确认无业务调用；原文件中的批量配额写法、游标/轻查询并非正在执行的业务路径，不移植到现行配额/实例代码。历史审计文本保留，不当作运行引用。
- `logs/takeover-retired-db-references.log`复核运行源码/脚本/部署无导入和10个符号引用，`takeover-retired-db-types.log`、`takeover-retired-db-build.log`、`takeover-retired-db-guards.log`两项配额守卫通过。无数据库/客户数据改动；退役代码没有活体流程可验，不据此声称实例/配额生产回归。早期搜索引用了当前不存在的旧模板目录，已纠正路径并以最终无错误搜索为准。继续R204/207等，327未完整。

## 2026-10-28 R1-200 初始化命令启停与列表竞争

- R198 `0b35de61514843aefb345501376cb7dcc351157b` 已推送并核远端一致，CI40676412491最终success。
- 启停固定本次enabled值，按ID和唯一操作标识串行同一行编辑/启停/删除，成功只写固定状态；删除成功才移除。列表按请求序号/session取消和丢弃旧结果，写入前后失效旧读取，页码按新总数收敛；换会话/卸载清状态，旧操作finally不释放新操作。刷新失败保留已确认记录并展示失败重试，不冒充空列表。
- `logs/takeover-init-toggle-browser.log`真实Chrome/Vue页面+延迟API通过10次点击1次明确状态写入、行操作门禁、失败重试、刷新失败保留状态、两行交错成功/列表倒序、会话替换/同SID刷新、旧失败/finally、删除成功/失败及卸载；详情/编辑/父页面矩阵同时回归。三语/1440与390/深浅截图已检查。删除确认在夹具中替换，仅验证并发逻辑；无真实账户写入。
- 3/3守卫`takeover-init-toggle-guards.log`、双端类型+构建`takeover-init-toggle-build.log`、dist边界`takeover-init-toggle-dist.log`、lint和diff检查通过；源码regex detector无报告项，不代表完整视觉/可访问性验收。后端跨浏览器并发没有新增版本CAS/幂等；真正后端流程仍待。随后继续R201等维护残留与其余编号，327未完整。

## 2026-10-28 R1-198 初始化命令保存与编辑生命周期

- R199 `eaf703fb39670b8b5e516fd703f6f425699e08b0` 已推送并核远端一致，CI40672004189最终success。
- 保存门禁覆盖重复提交、详情/发行版加载、关闭、卸载及已成功提交；提交固定ID与表单数组快照，保存中禁用表单/各关闭入口，失败保留草稿并可重试。按目标/session清理读请求和关闭计时器，旧保存成功/失败/finally不写新表单，同SID刷新保留草稿。发行版名称实时随语言更新，字段具可访问名称。父页面保存成功立即关旧弹窗，再刷新列表，旧刷新不再关闭新草稿。
- `logs/takeover-init-editor-browser-final.log`真实Chrome/Vue源码组件+延迟API通过10次同步保存仅1请求、所有关闭入口、失败保留/重试、成功锁存、目标与读/写/session竞争、卸载、退出、创建及发行版兜底/通用排他；实际ExtensionsView父页面保存与迟到列表/新草稿也通过。三语/1440与390/深浅截图已检查，非真实账户和后端写入验收。
- 3/3守卫`takeover-init-editor-guards.log`、双端类型+构建`takeover-init-editor-build.log`、dist边界`takeover-init-editor-dist.log`、lint通过，源码regex detector无报告项（不覆盖元素检查）。尚不提供服务器请求幂等/网络断开后的结果协调；实际后端联调仍待。下一项R200启停，327未完成。

## 2026-10-28 R1-199 初始化命令详情生命周期

- R197 `80f109e203ba3619dd0825133512aa0070ce0af2` 已推送并核远端一致，CI40668834430最终success。
- 详情按命令ID/updatedAt与会话身份重新加载，立即清旧内容并取消旧请求；成功、失败、finally、复制回执和关闭回调均绑定原目标代次。关闭/卸载清理两个计时器，旧关闭不影响复用后的弹窗；同SID刷新保持内容，退出清除。标题优先使用同次详情名称，长名称/备注可换行，关闭按钮有可访问名称及44px目标。
- `logs/takeover-init-detail-browser.log`真实Chrome/Vue组件与延迟API/clipboard夹具通过目标/会话切换、旧成功/失败/finally、取消、复制内容快照/旧成功与失败、反馈过期、关闭计时器复用/卸载、退出、当前失败及同SID刷新；三语/1440与390/深浅/长内容截图在`logs/init-command-modals/`，已检查桌面与手机。不是实际账户、后端或系统剪贴板验收。
- 3/3守卫`takeover-init-detail-guards.log`、双端类型+构建`takeover-init-detail-build.log`、dist边界`takeover-init-detail-dist.log`、lint和清单校验通过。detector仅源码regex检查，无报告项，不覆盖元素对比度；未冒充完整可访问性验收。专项已登记CI（188常规/61排除）。保存后继续R198/R200；327仍未完整。

## 2026-10-28 R1-197 初始化命令选择器

- API状态`a77c891734224ce310684991cc8f770a67f57ea9`已push并核远端一致，CI40666472803最终success；回复97c929e CI40666069748最终success。
- 选择器每次distro/session切换启动新请求、取消旧请求并立即清旧选择，响应/finally用序号和原distro/session复核；同SID正常刷新保留选择，换会话/卸载取消并拒迟到回写。失败独立显示三语错误与重试，不再假称无可用命令。折叠使用原生button/aria-expanded，辅助文本提高可读性，收纳操作44px高度，展开遵从减少动效。
- `logs/takeover-init-selector-browser-final.log`真实Chrome/Vue源码+延迟API夹具通过快速切换、旧成功/失败/finally、选择清除、空distro、失败重试、新会话/同SID刷新、卸载、键盘展开，1440/390视口与三语/深浅主题截图在`logs/init-command-selector/`。测试传输是可控Promise，不是实际开通/重装或真实账户验收。前几轮夹具Tailwind加载、键盘事件和Vue Proxy序列化问题已修，最终日志才是通过证据。
- 对应3/3守卫`takeover-init-selector-guards-final.log`、双端vue-tsc+build `takeover-init-selector-build-final.log`、dist边界`takeover-init-selector-dist-boundary-final2.log`、组件lint `takeover-init-selector-lint.log`通过；impeccable detector零项，截图检查后已一次修辅助对比度并确认。浏览器专项登记CI，常规188/60活体排除。R198/199编辑/详情和R200启停随后继续，327仍未完成。

## 2026-10-28 工单Public API关闭与重开

- 回复`97c929ee34de5b4e356fdae3f8463514d7d3fb7b`已push并核远端一致，CI40666069748检查时运行；创建66f5a66 CI40665664450最终success。
- API关闭/重开改为事务锁当前工单、当前归属和PAT/POA完整授权，原status值相同才提交；用户仅close/reopen，不开放客服状态。返回时间使用实际提交记录，保留原关闭同时写resolvedAt/closedAt语义。归属变化或删除404、状态变化409、失效授权403。
- `logs/takeover-ticket-public-status-final.log`累计160真实PG/helper/真实bearer路由竞争通过（136账户/令牌/应用/授权，24关闭重开时状态/归属/删除变化），双类型正常关闭/重开、重复409/无效动作400、故障trigger零状态与时间写入、创建回复回归。7/7守卫`takeover-ticket-public-status-guards.log`、server build `takeover-ticket-public-status-build.log`、专项类型`takeover-ticket-public-status-types.log`通过。
- 只绑定status值，未提供跨请求幂等或完整ABA版本。工单API创建/回复/状态已接current credential事务保护，其它API写入、通知当前接收目标与持久外发、图床/浏览器/生产验收仍待。下段转R197初始化命令选择器，避免遗漏原清单前端；327仍未完成。

## 2026-10-28 工单Public API回复的当前授权

- 创建`66f5a6694038dc4e5c238dd73de36bd9d7a4e80e`已push并核远端一致，CI40665664450检查时运行；图片3fd9971 CI40664740228最终success。
- API回复将bearer原绑定传入消息事务，当前ticket/host/发送账户核验后持PAT或OAuth app/grant/token锁复核权限，消息、状态重开和响应时限更新只在成功授权后同事务提交。API继续仅代表创建者公开回复，无客服身份。
- `logs/takeover-ticket-public-reply-r1.log`累计68实际PG/helper/真实bearer路由创建及回复竞争通过，失效回复零消息并保持updatedAt/首响应/状态；正常PAT/POA回复已解决工单重开in_progress且清resolvedAt。网站42权限场景`takeover-ticket-public-reply-web.log`、7/7守卫`takeover-ticket-public-reply-guards.log`、server build `takeover-ticket-public-reply-build.log`、类型`takeover-ticket-public-reply-types.log`通过。
- 未图床/浏览器/生产；API关闭/重开仍是旧snapshot更新逻辑，下一段接事务授权与状态绑定。其它API写入、普通通知及外部持久投递继续待；327未完整。

## 2026-10-28 工单Public API创建的当前授权

- 图片代理`3fd9971968912123b784991383e9d3e372afeed0`已push并核远端一致，CI40664740228记录时运行；ID bb35a0a CI40664055361最终success。
- 新内部API授权绑定在bearer核验后捕获令牌身份，创建事务在instance/host/current user核验后持PAT行共享锁；OAuth按app→grant→token锁，检查当前active、完整用户/令牌/应用/授权绑定、撤销、到期和各层tickets:write。持锁直到工单/首消息/附件同事务提交，锁等待限制3秒；不会把摘要或内部绑定返回API。缺原grant的旧OAuth写入拒绝，需重新授权。
- `logs/takeover-ticket-public-create-r1.log`34实际PG/Fastify helper/真实bearer路由竞争通过，覆盖PAT/POA撤销/删除/过期/缩权/身份变化/封禁及OAuth app停用/缩权/grant撤销/缩权/失去关联；实例锁确保鉴权后状态才变化。有效PAT/POA各只创建一工单及首消息、错误user/grant拒绝、撤销等待已取得的事务锁；无外部渠道。网站42权限矩阵`takeover-ticket-public-create-web.log`、关联转移/回滚`takeover-ticket-public-create-target.log`回归通过。
- 7/7守卫`takeover-ticket-public-create-guards.log`、server build `takeover-ticket-public-create-build.log`、专项类型`takeover-ticket-public-create-types.log`通过；新增专项登记CI。未实际图床/浏览器/生产，本段只覆盖创建，回复/状态/Public API其它写入尚未接此事务门禁。327仍未完成，下一段回复，再关闭/重开。

## 2026-10-28 R1-190 图片代理错误与上游释放

- ID范围`bb35a0a9cb876bf14e9af9d53164a0aae8646f82`已push并核远端一致，CI40664055361记录时运行；通知5772373 CI40663666326最终success。
- 图片代理保留URL/连接期私网校验、manual重定向和50MiB逐块上限；统一finally中断请求、释放reader并取消未读body，涵盖HTTP错误、重定向、非法MIME、头部超限及读取失败。超限/超时/读取失败只返回固定UPSTREAM_ERROR提示，不暴露异常正文。复审也纠正旧描述：原INTERNAL_ERROR实际会移除details，用户收到通用错误而不是可见的“过大”。
- `logs/takeover-ticket-image-r1.log`15实际PG/Fastify场景通过：越权零外发、私网零fetch、302/503、HTML/SVG及无安全MIME、声明超限、伪短长度持续流超限、reset/fetch错误、真实15秒body超时、正常bytes/MIME回退/私有缓存/nosniff及释放。fetch传输被截获，没有实际图床/公网socket；不冒充外部集成。
- 5/5守卫`takeover-ticket-image-guards-final.log`、server build `takeover-ticket-image-build.log`、专项类型`takeover-ticket-image-types-final.log`、188清单/58活体排除检查通过。新PG专项登记CI。初次守卫only错写无匹配名称及初次专项tsc闭包类型失败均已更正，不算通过证据。327及PAT/POA在途授权、普通事件通知/外部outbox等仍待。

## 2026-10-28 R1-184/185 工单ID数据库上限复审

- 通知`57723738a58f641d2e3e3d13b0aad6df0d9b7f1d`已push并核远端一致；关联对象510e903 CI40662708627最终success。
- 纠正原R184/185“已有防护”：safe integer仍大于PostgreSQL Int可接受范围，实际Fastify `/tickets/2147483648`复现500，见`logs/takeover-ticket-id-before.log`。网站共用ID解析现限制1..2147483647，覆盖工单/消息/附件/host路径、可选实例与host查询、关联对象数字及字符串正文。未扩大到Public API其它资源解析，其同类边界单独待修。
- `logs/takeover-ticket-id-final.log`实际PG/Fastify154无效ID路径/查询/正文全部400，数据库最大有效但不存在ID404、普通工单200，工单/消息/备注/关联/站内信无改动；原四路由分页和搜索专项同次回归通过。4/4守卫`takeover-ticket-id-guards.log`、server build `takeover-ticket-id-build.log`、专项类型`takeover-ticket-id-types.log`通过。没有生产或浏览器验收。
- 下一小项R190图片读取超限与中断分类及上游释放，再继续API授权与原清单其它范围；327仍未完成。

## 2026-10-28 R1-186 客服通知原子记录与正文

- 关联对象`510e903a77465bd8eba5bfeb67b27e563e189c7a`已push并核远端一致，CI40662708627检查时运行；备注4ef8b02 CI40662179580最终success。
- 显式客服通知先锁工单、当前管理员/接收账户，核对接收人、active/admin及session，再同事务创建站内信和内部备注。任何一条写入失败均回滚，不外发；提交后仅发送外部渠道，不重复写站内信。共用模板现在保留管理员填写的正文和当前作者，普通通知默认行为保持。
- `logs/takeover-ticket-notice-authorization-final.log`累计42真实PG/Fastify权限/归属/状态竞争通过，新增通知封禁/注销/降权三竞争、两表拒写trigger原子回滚、错误接收人拒绝、成功实际正文/作者且仅一条站内信；另验默认通知继续独立写站内信且原无正文格式不变。5/5守卫`takeover-ticket-notice-guards.log`、server build `takeover-ticket-notice-build.log`、类型`takeover-ticket-notice-types.log`通过。
- 测试账户没有外部通知渠道；未实际外发/浏览器/生产验收。本批不提供外部投递持久outbox或请求幂等，普通创建/回复/关闭通知目标及PAT/POA在途撤销仍待，327仍未完成。下段继续原清单与这些明确缺口。

## 2026-10-28 R1-186 客服关联对象

- 备注`4ef8b029b01ffa0158e4fe9aa67ac377ce235fde`已push并核远端一致，CI40662179580检查时运行；删除23358c2 CI40661681682最终success。
- 关联对象在事务内锁实际实例/host/充值记录/订单处理记录并验证当前归属，再锁工单核对原关联身份，最后current admin/session核验与upsert同事务。大于PG整数范围对象ID拒绝；作者用当前用户名，重复关联仍幂等。
- `logs/takeover-ticket-link-authorization.log`累计39真实PG/Fastify竞争（关联新增封禁/注销/降权3）通过；`takeover-ticket-link-target.log`原创建关联回归、实例转移后的instance/host关联拒绝与全部四类正常关联通过。5/5守卫`takeover-ticket-link-guards.log`、server build `takeover-ticket-link-build.log`和专项类型`takeover-ticket-link-types.log`通过。未生产/浏览器/外发操作。
- R186剩余通知发送的授权/原子记录与PAT在途撤销继续；通知模板另发现未展示管理员输入正文，下一小项处理。327仍未完成。

## 2026-10-28 R1-186 内部备注当前管理员

- 删除消息`23358c2751d4b7ad652642f7aba5266a7ce24e9d`已push并核远端一致，CI40661681682检查时运行；回复d29ca3a CI40660948686、状态fadec04 CI40661288207最终success。
- 内部备注创建事务锁工单和当前管理员，必需actor/session并核对active/admin与撤销，持久作者使用当前数据库用户名。显式备注路由返回403/404；通知入口记录备注也传完整actor，但通知本身仍先于备注执行，完整通知原子性是后续独立项。
- `logs/takeover-ticket-note-authorization.log`真实PG/Fastify累计36竞争（新增备注3）通过，降权/封禁/注销不写备注，缺session/错工单拒绝、合法作者名称正确；前面创建/回复/状态/删除及拒删DB故障同测回归。5/5守卫`takeover-ticket-note-guards.log`、server build `takeover-ticket-note-build.log`、专项类型`takeover-ticket-note-types.log`通过。没有实际通知或附件服务调用，R186/327仍部分。

## 2026-10-28 R1-186 管理员删除工单消息

- 状态/关闭`fadec046200eaac035c92bd47a44e469b174f6ba`已push并核远端一致；对应CI40661288207与前批回复CI40660948686的最终状态后续继续核验。
- 删除消息事务锁ticket/message/current admin，复核消息所属工单、active/admin及SID/IAT撤销；只在DB删除提交后返回该消息的固定附件provider清单给既有清理器。降权/封禁/注销、错误工单、已删重放均不返回清理清单，避免旧权限删除与预读附件不一致。
- `logs/takeover-ticket-delete-authorization-final.log`真实PG/Fastify累计33竞争通过（创建8/回复12/状态关闭10/删除3），删除失败trigger保留消息及附件，正确删除仅返回原固定清单，wrong ticket/replay拒绝。5/5守卫`takeover-ticket-delete-guards.log`、server build `takeover-ticket-delete-build.log`和专项类型`takeover-ticket-delete-types.log`通过；最后仅测试增加拒删trigger，无业务再次改动。
- 远端附件服务未调用，DB提交后清理失败的持久重试不在本小项；备注/链接/通知授权与PAT仍待，327和完整实机验收不记完成。按owner要求继续逐项推送。

## 2026-10-28 R1-186 工单状态与关闭

- 创建授权e244d8f的CI40660398704最终success；回复授权`d29ca3a7f76151b88b7ddcf1f29521ef71fa7072`已push、远端一致，CI40660948686检查时仍运行。
- 状态/关闭两个网站入口把actor、操作类别及原status传入必需参数，事务锁ticket/host/current account后重核session、角色和当前处理资格。创建者仍仅可关闭或将已关闭工单重开open，客服可处理状态；原status改变返回409，不以旧页面动作覆盖新状态。SLA、resolved/closed时间使用锁内记录同事务写入。
- `logs/takeover-ticket-status-authorization-r1.log`真实PG/Fastify通过新增两个入口十个封禁/注销/降权/host转移/原状态变化竞争，原创建8+回复12同次回归；正常客户关闭/重开、客服解决及客户越权/旧状态拒绝保持。5/5守卫`takeover-ticket-status-guards.log`、server build `takeover-ticket-status-build.log`和专项类型`takeover-ticket-status-types.log`通过。
- 状态CAS目前绑定status值，未宣称解决所有ABA或客户端草稿代次问题。备注/关联对象/删消息/通知授权、PAT和附件完整流程继续待修，327整体与真机未完成；本段按授权保存推送后继续。

## 2026-10-28 R1-186 工单回复当前权限

- R187的eaef6ea CI40659933408最终success；创建会话保护`e244d8fabe2b4200fc968e86cc997d95362f8f4a`已push并核远端一致，CI40660398704检查时仍运行。
- 回复事务锁工单→host→发送人，重核当前active、完整web actor/session/角色、工单创建者或当前host owner/admin。`isFromOwner`必须与当前权限匹配，不能以旧客服标记写入；Public API无web actor只允许当前创建者且不能冒充客服。工单闭合门禁和首响应/SLA变更在同事务，网站/Public API授权异常正常403/404并保留附件失败清理。
- `logs/takeover-ticket-reply-authorization-r1.log`真实PG/Fastify：原创建八竞争加回复十二竞争（helper/网站封禁、单/全session撤销、降权、host转移、closed），拒绝零消息与首响应写入；正常host客服、客户回复/已解决重开、错误客服标记和非web创建者路径通过。5/5工单/Public API守卫`takeover-ticket-reply-guards.log`、server build `takeover-ticket-reply-build.log`、专项类型`takeover-ticket-reply-types.log`通过。
- 其它状态/关闭/备注/链接/删除消息、通知授权和PAT在途撤销仍未完成；未真实附件服务、浏览器或生产验收。按owner要求此项先保存推送，继续下一入口。

## 2026-10-28 R1-186 创建工单当前账户与会话

- R187提交`eaef6ea6a36fbb11d6dd0e90648ea4c99a289461`已push并核远端一致，CI40659933408检查时仍在运行。
- 网站创建工单将完整actor/session传入DB，实例/host核验后锁当前账户，在同事务检查active、原角色、SID/IAT与用户级/会话级撤销，成功后才创建工单和首消息。缺会话、错actor、封禁/注销/降权返回403，附件仍走既有失败清理。非网站创建也检查当前active，但PAT/POA在途撤销本段尚未覆盖。
- `logs/takeover-ticket-authorization-r1.log`真实PG/Fastify helper/网站八个封禁/单会话撤销/全会话撤销/降权行锁竞争均拒绝且零工单消息；合法user/admin、缺SID/错actor与非网站banned同测通过。`takeover-ticket-authorization-target-regression.log`原R187六场景及原子回滚回归通过。4/4守卫`takeover-ticket-authorization-guards.log`、server build `takeover-ticket-authorization-build.log`和含三个工单专项的独立类型`takeover-ticket-authorization-types.log`通过，专项已接CI。
- R186仍部分：回复/状态/备注/链接/删消息及通知目标仍需逐个补，附件上传、真实PAT全流程、浏览器未验；没有SMTP/外发消息、前端/生产/迁移操作。按owner每小项保存后继续。

## 2026-10-28 R1-187 工单创建关联实例复核

- R183提交`84f8464c95c67012b64dfbc178aad06d53c40d62`已push并核远端一致，[CI40658726890](https://github.com/mastalee928/payincus/actions/runs/40658726890)success。
- 创建工单事务内持原实例/宿主行锁，核对实例当前owner、host与未删除状态后才写工单及首条消息；不允许无实例却任意关联host。网站和Public API共享此helper，目标变化均在附件清理后返回409。不会以旧路由快照决定提交关联。
- `logs/takeover-ticket-target-r1.log`实际PG/Fastify验证helper和网站路由共六种竞争：事务先改owner/host/deleted并持锁，实际观察pg阻塞后提交变化，创建409/目标异常且零工单消息；正常关联/无实例创建及首条消息trigger故障全回滚通过。Public API共用helper与守卫已核，完整PAT认证/附件服务未实跑；R186当前账户/session和通知目标仍需后续修复，不能称工单权限全面完成。
- server build/type-check `takeover-ticket-target-build.log`、包含两专项的独立类型检查`takeover-ticket-target-typecheck.log`与4/4工单/Public API守卫`takeover-ticket-target-guards.log`通过。新专项已接CI；无迁移/前端/生产操作，按owner授权保存后继续。

## 2026-10-28 R1-183 工单分页与数字搜索

- 旧恢复无身份回滚修复`5e3d3a1860892d9b14ecbc702bbaa7db99c014ed`已推送main、远端一致，[CI40657754668](https://github.com/mastalee928/payincus/actions/runs/40657754668)success。
- 四个工单列表/消息入口拒绝非完整十进制与不安全整数，DB共享分页再次限制乘积offset到有符号32位范围；超界回首页且响应元数据一致，正常pageSize仍最多100。数字搜索只将可表示的正整数ID加入PG条件，大数/科学记数/十六进制继续作为原文字匹配；重复search参数不再调用数组trim报500。
- `logs/takeover-ticket-pagination-r3.log`真实PG/Fastify通过四路由与四DB helper异常值/重复参数/偏移临界/有效二页及末页/100上限/大数字主题搜索，原工单消息未改。前两次fixture漏注册requireAdmin导致路由注册失败，补全后实际运行通过，不当作业务失败；第一轮孤立测试用户/host无客户数据。
- 后端build/type-check `takeover-ticket-pagination-build.log`、专项类型检查`takeover-ticket-pagination-test-types-final.log`、4/4工单守卫`takeover-ticket-pagination-guards.log`通过；清单188项/55专项合法`takeover-ticket-pagination-manifest.log`，新专项已接入CI。未前端/浏览器/生产验收，不重复无关构建。R186/187工单写入授权与关联目标是后续独立小项，327未全部完成。

## 2026-10-28 旧恢复任务拒绝无身份回滚

- 上批`f6571c6dfaf8ef6c0f5d78677d3da845a36766c3`已推送main并核远端一致，[CI40656767813](https://github.com/mastalee928/payincus/actions/runs/40656767813)success。
- 旧FAILED任务没有持久副本UUID，不能仅凭原名存在就启动同名实例、删除临时副本。回滚入口新增缺失recoveryState立即409，所有副本和记录保持；拒绝发生在创建Incus连接前。实例owner/host owner/admin三权限真实PG/Fastify回归均零远端I/O，`logs/takeover-restore-legacy-authorization.log`通过；原授权及stop矩阵同次通过。3/3守卫`takeover-restore-legacy-guards.log`和server build/type-check `takeover-restore-legacy-build.log`通过。
- 本小项只封住旧记录的无身份误删路径，不是人工恢复已完成；已有持久状态的续跑、回滚操作、查询和真实Incus恢复继续待验。接续原清单R1-183工单分页/数字搜索边界，不因恢复模块阶段保存停止327项精修。

## 2026-10-28 恢复替换身份与未决副本保护

- 前批停止确认`f8dd60c9b7b5d4c86f05ffbdb7778456b614e571`已推送main；[CI40654013875](https://github.com/mastalee928/payincus/actions/runs/40654013875)最终success。Owner再次明确每个可核验小项完成即提交推送并继续，已同步OWNER_REQUIREMENTS；327项仍未全部完成。
- 新增持久`recovery_state`：原/临时UUID、类型、根盘池、设备与受保护配置摘要、原备份/快照ID和名称、阶段与导入operation。先提交意图再远端操作；补采复用固定连接。stop/delete/rename/start持实例和当前授权锁，阶段间重核原归属、host身份、备份、账户/session与attempt。导入使用原实际根盘池；停止状态、设备/地址及UUID不符时保留两份。
- 替换删除只调用原实例精确API并确认该路径404，不调用会删除独占转发的普通deleteInstance；重命名后核验原名绑定临时UUID，启动后确认Running。失败不按名称清理副本；异常、重启、超时保留PROCESSING/manual_intervention及操作门禁。新建备份锁内拒未决恢复。末尾只清原固定清单，实例更新与COMPLETED同事务；终态写失败整段DB回滚。
- 实际PG/mTLS15场景`logs/takeover-restore-replacement-final.log`通过：错误IPv6/池/UUID、原名复用、封禁、后增备份、导入/删除/断连/重命名/启动/最后DB失败；至少保留一份，所有场景零网络转发API请求，原双栈/归属字段保留。授权`takeover-restore-replacement-auth-final.log`、停止与传输`takeover-restore-replacement-transport.log`、上传/删除回归`takeover-restore-replacement-upload.log`通过；磁盘内容和客户连接仍为Incus边界替身，未真实Incus或SIGKILL验收。
- 后端build/type-check `takeover-restore-replacement-build.log`、`takeover-restore-identity-typecheck-r3.log`及两个专项脚本独立类型检查`takeover-restore-replacement-test-types.log`通过；5/5相关守卫`takeover-restore-replacement-guards-final.log`通过。旧终态字符串守卫失败后按PROCESSING保护分支更新；两次筛选参数错误没有运行测试，不计通过。既有227迁移隔离库实际应用第228条成功，`takeover-restore-replacement-migration.log`；无生产迁移。
- 本段是阶段保护，未形成恢复闭环：持久续跑/安全人工rollback、旧FAILED回滚和查询展示仍需补齐；PROCESSING保护会占宿主恢复/上传队列。真实磁盘/网络、完整网关灾备和327清单仍待。本段无前端改动，未重复全量或双端构建，没有发布、OTA、DNS或客户操作。

## 2026-10-28 恢复前停止确认

- 上批恢复授权`1299ce6ebe762f871ac9ae2fd25d8febc3e0bfc8`已普通push main并核对远端一致；[CI40653341209](https://github.com/mastalee928/payincus/actions/runs/40653341209)最终7/7 success，Linux已执行新增授权PG专项。额外恢复一致性守卫`logs/takeover-restore-auth-consistency-guard.log`通过；新增专项独立类型检查`logs/takeover-restore-auth-test-types-final.log`通过。
- 移除恢复worker吞掉stop异常后继续导入/删除原实例的逻辑。恢复专用stop先读实际状态、必要时停止、再确认Stopped；未知状态拒绝，查询和PUT共用90秒截止。`importStarted`与远端停止分开：导入前失败不清理任何临时副本、标记import_not_started，也不能借rollback删除未知临时资源。此标记仍不是完整持久operation恢复。
- `logs/takeover-restore-stop-transport.log`真实mTLS覆盖已Stopped、成功停止、未知状态、状态403、stop500、成功回执但仍Running、stop/查询挂起总截止，并回归原流传输矩阵。`logs/takeover-restore-stop-worker.log`真实PG/Fastify/mTLS实际worker验证stop500和成功但仍Running均FAILED/import_not_started，备份仍ready、零导出/导入/副本删除、回滚拒绝，前批授权/队列/attempt矩阵同次通过。5/5相关守卫`logs/takeover-restore-stop-guards.log`；真实Incus磁盘/网络和SIGKILL仍未验。
- 后续复审新定位：`incus-instances.deleteInstance`会顺带`removeDedicatedForward`，当前恢复替换原实例调用它可能删除按原实例名归属的IPv4/IPv6转发，且恢复后没有对应重建。必须在原/临时UUID、原设备/双栈地址/存储完整性绑定之后，用仅替换客机的删除确认路径保留原转发；不能简单跳过删除确认或据名称存在认定副本安全。原清单、失败/重启持续门禁、rollback与完整灾备继续待修。
- 本段server type-check和build通过`logs/takeover-restore-stop-typecheck.log`、`logs/takeover-restore-stop-build.log`。没有新增迁移或前端改动；本次业务及证据按owner授权再次阶段保存，不是发布或生产更新。

## 2026-10-28 恢复任务当前授权与入队绑定

- 按owner要求继续分段提交推送。前一docs HEAD `fb5e14aa9bca52a537bfc052f3d4035dc6615d76`对应CI40651321886、f9e7e9f对应40651228111均success；此前四批业务各自7/7的证据保持。本节是新增源码阶段，不把前一CI当作当前改动验证。
- 恢复入队锁host→instance并锁原实例/host/backup/操作人账户；实例owner与task操作人分开保存，保留实例owner、host owner、当前admin三种既有权限。重新检查当前账户/session、原归属/Incus名、ready备份ID/名称/创建时间、原host TLS摘要。每宿主10个PENDING上限与插入同锁，快照/站点/转移/upload/instance任务及清理/账务未决门禁生效。
- 领取/执行准备再核对持久绑定，旧无绑定任务明确失败；仅从session取sid/iat，不允许附带id覆盖任务操作人。临时名改为随机UUID，领取持久attempt UUID，进度/终态/退回队列CAS绑定attempt、startedAt、identityHash。拒不存在/终态/本进程重复执行后才记录running；结束释放独立Incus连接。恢复主连接使用固定host TLS快照，授权或连接准备失败不触发远端补偿；未开始任务和准备失败任务不能经rollback启动/删除远端资源。取消在实例锁内复核当前权限/session和路由instanceId。
- `logs/takeover-restore-auth-final.log`真实本机PG/Fastify/mTLS专项正常exit 0：14种目标/session变化分别在入队/领取/执行前、admin降权、三种操作人正常入口及mTLS派发、旧任务、7类未决门禁、恢复保护、取消竞争、10任务队列及唯一临时名、PG入队trigger失败、重复执行/旧attempt结果不覆盖后继、无远端操作任务拒回滚。mTLS只验证执行准备及拒绝边界，认证middleware为夹具，不是客机磁盘完整恢复。
- 上批上传/备份删除回归`logs/takeover-restore-auth-upload-regression.log`exit 0；4/4相关守卫`logs/takeover-restore-auth-guards.log`；server类型`logs/takeover-restore-auth-typecheck-final.log`、后端build`logs/takeover-restore-auth-build.log`通过。新增专项登记并接入原CI PG job，清单188/53活体排除检查通过。升级库实际追加第227迁移`logs/takeover-restore-auth-migration.log`；运行夹具库单独SQL应用，不伪造迁移历史。本轮无前端改动、未重跑整套188。
- 首轮专项实际抓到session附带id覆盖actor的问题，已修复；r2–r5为夹具站点必填字段/实例任务枚举错误；r6断言结束后因导入路由的维护interval未退出，明确终止该夹具进程后补清理完成退出，最终日志正常退出。首次生成client缺DATABASE_URL和并发日志占用、临时测试tsconfig的types路径/断言类型修正均不作为通过证据。
- **仍未完成**：远端开始后的逐步授权/UUID/原设备与磁盘绑定、原副本停止确认、临时副本完整验证、原清单及operation持久回执、失败/重启持续门禁、真正rollback/SIGKILL。流量补采仍使用原helper重新查询host，不能称整个流程所有远端读取都固定；旧worker的stop异常吞掉、按名称清理副本及旧超时FAILED逻辑仍待下批。327及完整网关/OSS灾备保持未完成，三机可信SSH身份仍按私有档案核验，无生产/tag/Release操作。

## 2026-10-28 连续四批保存与下一阶段规格

- 本轮四个业务阶段均已推送main并分别核对远端：上传当前授权`eac0b068916b55e7af82347526b3d4ec91886046`、上传attempt与退避`8d73ab341b83d1f7b3b729a3fcf2659143e8e867`、备份删除确认`5a8f9e53ce6a79d3813257343687d0b907f88695`、恢复传输`5e63e8e951a6064e8f93b537652e13785b858ebc`。前三批源码CI分别40648563020/40649284830/40650075642，均7/7 success。
- 最新[CI40650542350](https://github.com/mastalee928/payincus/actions/runs/40650542350)绑定5e63e8e，最终7/7 success；Linux已实际执行新增恢复传输及扩展上传/删除专项。四批业务提交各自CI全部成功；后续docs-only提交的CI身份与业务提交分别记录，不混为同一head。
- 当前业务源码已全部提交推送；恢复worker新一轮仅完成代码复审与[详细规格](docs/restore-task-recovery-review.md)，**未编辑**restoreTaskWorker/db restore/rollback核心。原UUID/临时UUID、原备份关系、失效授权和未决任务持久门禁、逐阶段远端确认及SIGKILL矩阵是下批重点。
- 两个隔离PG库仍在127.0.0.1:55438：运行夹具takeover_20261028_pool_test（新列单独SQL应用），迁移证据库takeover_auto_final_20261028_pool_test（226条实际迁移历史）。本轮未重跑完整188；每批类型、相关守卫、后端build、mTLS/PG专项分别见下文。前端无改动，不把server缺ESLint配置说成lint通过。
- 三台专用测试机资料/不限用途授权保持；SSH可信身份来源仍未闭合，本轮未新连远端或操作生产。327项、真实Incus/OSS和完整网关灾备仍未完成，继续逐段修复与提交推送。

## 2026-10-28 恢复传输截止与远端错误分类

- 前一删除阶段`5a8f9e53ce6a79d3813257343687d0b907f88695`已普通push main并核对远端；CI40650075642已启动，记录时上传/删除PG集成、双架构组件、计费与网关候选成功，其余仍在运行，不提前记全绿。
- `restoreFromStream`不再使用独立旧轮询：旧逻辑把`disk full`等真实Failure按文案误判为临时错误并循环。改用已有有截止/取消的waitForOperation，POST与等待共享总期限，默认5分钟；外部signal、失败响应64KiB上限、限定原/1.0/operations路径、拒未知响应类型。专用transport复用原CA/pin，finally关闭该连接与来源流，不关闭共享client。
- `instanceExists`仅精确资源路径HTTP404返回false；403/断连等未知状态抛错，使恢复失败保护路径保留临时副本，不能把网络未知解释为不存在。实例查询/重命名路径编码；原副本UUID核验及持久阶段仍待。
- 新`test:review-restore-transport`实际本机mTLS验证同步/异步完整字节、disk-full/cancel只轮询一次、拒绝错误/坏路径/坏类型/超限响应、上传停滞和轮询停滞总截止、外部及预取消、来源销毁、服务端换证书零HTTP拒绝、原API client仍可用，以及存在/404/403区分，通过`logs/takeover-restore-transport.log`。已登记测试入口/排除原因并接入原CI隔离job。
- server类型/构建`logs/takeover-restore-transport-typecheck.log`、`logs/takeover-restore-transport-build.log`；3/3相关守卫与加强后备份守卫`logs/takeover-restore-transport-guards.log`、`logs/takeover-restore-transport-final-guard.log`通过，清单188项/52活体排除登记检查通过。本阶段没有完整restore worker实机或磁盘恢复证据，不能将传输专项当成主控OSS灾备验收。
- 下一优先：restore任务创建/领取/执行及rollback固定actor/session、原host/instance/backup/UUID与持久阶段，删除旧原实例前验证临时恢复副本、失败保留唯一数据；backup create/delete及上传强杀恢复/真实存储回执、三台SSH身份、327/完整网关目标仍未完成。

## 2026-10-28 备份删除确认与共享操作锁

- 上一批`8d73ab341b83d1f7b3b729a3fcf2659143e8e867`已普通push并核对origin；[CI 40649284830](https://github.com/mastalee928/payincus/actions/runs/40649284830)7/7 success。此前eac0b06也7/7。每段源码/测试/备忘及时推送，无积压到327整体完成。
- 修复备份删除catch所有远端错误后仍软删数据库的问题。复用实例共享锁、current actor/session/归属、host行锁和未决snapshot/proxy/transfer/upload/restore门禁，锁保持至远端确认与本地提交。绑定请求早期host身份和备份原名称，固定原mTLS连接；创建中备份拒删，已deleted记录不再远端操作。
- IncusApiError携带实际HTTP状态和原request path；只有该备份精确路径的404可视为不存在，async operation的404或连接/403/500不能冒充资源缺失。DELETE后再GET确认不存在，仍存在则保留ready。HTTP错误即使JSON伪装sync成功也拒绝。
- `logs/takeover-backup-delete-final.log`真实PG/Fastify/mTLS专项通过：403/500/伪sync500/断连/删除后仍存在保留记录，旧owner/撤销session/变更host与活跃上传零删除请求；持锁远端等待时新upload/restore拒绝；确认缺失成功，terminal重复零远端；远端已删后PG trigger阻止落库保留ready，再以精确404重试完成。前两批上传回归同次通过，真实磁盘和存储仍是边界替身。
- 4/4相关守卫（含Incus池）`logs/takeover-backup-delete-final-guards.log`，server类型/后端构建`logs/takeover-backup-delete-final-typecheck.log`和`logs/takeover-backup-delete-final-build.log`。本批不新增schema、不改前端；不把当前专项当整套188或生产验证。
- 下一段仍需：手工backup create/delete的持久远端operation回执与SIGKILL、restore固定原身份/UUID/原副本保护、真正上传在途撤销/provider总截止和远端清理核对。同步事务锁仅保护当前进程操作，进程强杀后自动恢复仍未闭合；327和完整网关灾备继续，三台机身份核验另行保留。

## 2026-10-28 上传执行批次隔离与重试状态

- 前一授权/目标修复`eac0b068916b55e7af82347526b3d4ec91886046`已普通push main并核对远端；[CI 40648563020](https://github.com/mastalee928/payincus/actions/runs/40648563020)全部7/7 success，新增上传真实PG专项已在Linux执行。阶段推送继续，不是发版或生产更新。
- 每次领取持久生成attempt UUID和远端文件名，再开始远端I/O；同task同毫秒的新attempt也不会覆盖旧文件，补偿只清理本次文件。进度/终态/重试/运行时超时清理CAS包含UUID、startedAt和retryCount。文件名最多255 ASCII字符，截短描述前缀而保留完整task/attempt/时间后缀。
- 真正持久nextAttemptAt并由claim执行30秒重试等待；失败来源未开始上传时不误删，上传失败而远端清理不确认则FAILED/cleanup_required、保留filename和错误且不自动重试。单后端启动时将旧PROCESSING标interrupted，保留已持久文件名供核对；运行时null startedAt也能退出卡死，当前进程仍执行的任务不被清理。
- `logs/takeover-upload-attempt-final.log`真实PG/Fastify/mTLS专项通过：完整前阶段回归、新旧attempt同startedAt/retryCount仍由UUID隔离、旧失败不删新文件、30秒等待/启动后仍等待、重试新文件、清理失败持久回执及零自动重试、当前运行保护、重启中断文件保留、null时间、长文件名。存储仍为内存替身；调用启动恢复helper不冒充SIGKILL/真实OSS恢复。
- 后端type-check/build通过`logs/takeover-upload-attempt-typecheck.log`、`logs/takeover-upload-attempt-build.log`；最后文件名/日志改动后构建`logs/takeover-upload-attempt-final-build.log`。5/5相关守卫`logs/takeover-upload-attempt-guards.log`及加强后的备份守卫`logs/takeover-upload-attempt-final-guards.log`通过。第226条迁移在既有空库逐条迁移基础上升级成功`logs/takeover-upload-attempt-migration.log`。
- 未完成：上传中断后的远端完整性/清理自动核对、强杀恢复及凭据变更后的原存储回执；真正传输期间授权变化/实例UUID及备份删除门禁、provider总截止；backup create/delete/restore持久工作流、327项及A失联→B真实OSS恢复仍待。旧任务没有attempt不补造远端授权，明确失败后重新提交。没有生产操作或正式发行。

## 2026-10-28 上传队列当前授权与固定目标

- 上传入队在host/instance/user任务锁及目标行锁内重新核对当前账户、会话撤销、实例owner/host/Incus名、ready备份及存储归属；请求早期宿主身份和存储连接摘要在事务内比对。每宿主10个PENDING上限与入队同锁，快照/站点/转移/其他实例任务门禁生效。
- 新迁移仅新增actorSid/actorIat/identityHash，不复制存储凭据。领取与执行准备阶段再次校验原任务身份；旧无绑定任务明确失败，不用当前记录伪造授权。使用本次已核对的Incus客户端/CA/pin与存储配置，避免连接池重读后改投新host。恢复保护期间不入队/领取/执行；取消任务复核current actor/session，历史状态仅原任务用户可见。
- 存储更新/删除与入队共享user锁和storage行锁，活跃任务期间拒绝修改/删除，避免FK级联删除新任务；更新核对原updatedAt。worker进度/成功/失败/重试写入增加startedAt/retryCount条件，旧执行结果不能覆盖新attempt的数据库状态。
- `logs/takeover-upload-auth-final.log`真实本机PG+Fastify路由+mTLS导出通过：11种身份/授权变化分别在入队、领取、执行前核验，旧任务、取消竞争、快照/站点/转移、恢复保护、并发队列上限、存储删除竞争、旧owner历史隔离、旧attempt数据库结果隔离；原正常上传/日志失败/同秒文件/失败清理/实例字段保持回归通过。认证中间件与存储传输为明确替身，不等于真实Incus磁盘/OSS。
- 相关5/5守卫`logs/takeover-upload-auth-final-guards.log`；server类型/构建见`logs/takeover-upload-auth-final-typecheck.log`、`logs/takeover-upload-auth-final-build.log`。225迁移清单在此前空库224条基础上实际升级成功`logs/takeover-upload-auth-migration.log`。原CI隔离PG专项已直接覆盖扩展测试；前一docs提交92fe0b0的CI 40645797730 success，不冒充本批CI。
- 首轮夹具PUT/PATCH与不可解析地址错误、旧日志计数断言错误已修，失败日志r1–r3保留；r4真实发现入队宿主旧身份未绑定，补expectedHostIdentity后通过r5与final。直接server ESLint因仓库没有server/root配置无法运行；根lint实际只校验client，不将其当server lint通过。
- **下一段仍需修**：上传每次attempt远端文件身份与持久恢复/30秒退避、null startedAt僵尸、存储失败清理回执、开始传输后的身份/会话变化与手工备份删除共享门禁；本批只完成入队/领取/执行准备及数据库结果隔离。备份create/delete/restore和327/完整网关仍未完成。未动生产、tag或Release；按owner授权先保存本段再继续。

## 2026-10-28 阶段远端确认（当前接续点）

- 已按owner要求连续提交并推送：`c277ba3`保存旧聊天与当前积压248文件；`437ff02`补Markdown测试依赖；`8465e9d`隔离备份上传文件；`7a38eca0cdf97f88dcec551c1cd3028538af7536`修复备份导出身份与流控制。每次均普通push main，无强推，最新业务提交已核对`git ls-remote`相同；记录前工作区干净且无领先未推送commit。
- 最新[CI 40644502640](https://github.com/mastalee928/payincus/actions/runs/40644502640)对应`7a38eca`，7个job全部success；Linux实际新增上传/导出集成及双架构组件、类型、构建、计费/交付删除/网关候选通过。此前`437ff02`、`8465e9d`的CI也全部成功，首次`c277ba3`锁清单失败原因和修复见下文，不隐去失败历史。
- 这是一段落保存，不是327项或完整A失联→B真实OSS恢复验收。下批优先备份create/upload/restore锁内当前actor/session、实例归属与宿主/存储身份、未决操作门禁及持久恢复。已只读定位`db/backups.ts`、`db/backup-upload-tasks.ts`、`db/restore-tasks.ts`、`routes/backups.ts`和两worker，未开始这些授权/队列核心改动。
- 三台专用测试机全部已找回私有资料，系统解析地址均正确；用途可重新分配，不受旧网关角色限制。只读SSH握手查证尚未完成可信身份闭合：A/B与旧可信pin不符，C目前只找到旧观察记录。详细记录在仓库外`takeover-connection-audit-20261028.private.json`；未发送密码/未改远端。继续独立源码与CI验证，不因该问题搁置项目、不要求owner重复给资料。

## 2026-10-28 备份导出身份与流控制

- 前一阶段`8465e9d606588d540718d001b29a097cf91e8a27`已推送并核对远端；[CI运行40641931069](https://github.com/mastalee928/payincus/actions/runs/40641931069)7/7通过，新增上传集成已实际在Linux/PG执行。阶段推送习惯继续，无tag/Release/生产操作。
- Incus常规API与独立导出连接统一从原client生成TLS transport，保留已登记CA与fingerprint；修正备份导出专用Agent无条件关闭服务端认证。旧手工登记无pin兼容行为未改，不能把它说成新身份验收。导出资源名逐段编码并拒绝dot segment。
- 流由`pull`按需读一个chunk，避免`start`中循环无界enqueue；取消/读取失败直接销毁专用连接，总期限默认30分钟，外部AbortSignal可提前终止，无消费者也执行截止。错误响应最多读取约4KiB。上传provider提前失败时finally销毁来源Node流，避免导出连接挂起。
- 实际mTLS验证正常内容/长度、常规API已连后换证书的新导出拒绝且零HTTP请求、256MiB慢消费者背压、取消远端关闭、停滞与无人消费超时、外部取消/预取消、错误体上限、后续正常导出及legacy兼容通过`logs/takeover-backup-export-final.log`。真实PG上传回归`logs/takeover-backup-export-upload-regression.log`通过，存储仍为接口替身；server类型/后端构建及4/4相关守卫见`logs/takeover-backup-export-typecheck.log`、`logs/takeover-backup-export-build.log`、`logs/takeover-backup-export-guards.log`。新增专项登记并接入CI原隔离job。
- 未完范围保留：restore上传与其它专用连接逐一审查、备份任务固定原身份与持久恢复、真实OSS/Incus磁盘、三台SSH身份来源及327/完整网关目标。当前分项不等同于所有备份流程验收。

## 2026-10-28 备份上传文件隔离与阶段 CI

- `437ff0217f72d31733a35a5a89811e00c491c5d4`已推送；[CI运行40639322152](https://github.com/mastalee928/payincus/actions/runs/40639322152)7/7成功，含双架构网关组件、计费到期、交付删除、远端候选、类型与双端构建。仅源码CI，不代表正式发行/全新安装/完整网关验收。
- 追加代码复审：备份上传任务的远端名称只有秒级时间，同一用户/实例/备份在同一秒的不同任务可能互相覆盖，后一任务失败清理会删前一任务文件；现名称加入任务ID，保留原扩展名和可读字段。执行入口拒绝非PROCESSING/重复本进程执行，数据库读取失败或任务不存在不泄漏running集合。单进程限制保持。
- 初步怀疑“上传后日志失败会触发补偿”经调用链和真实PG trigger推翻：`sendNotification`和`createLog`已有内部catch；未保留多余业务修改。专项真实注入日志失败，确认已成功文件与COMPLETED回执保留。冻结Date以确保相同秒，失败新任务只删自身文件，原成功文件不变；另含终态/取消/不存在零远端、同任务并发单执行及实例字段保持。真实PG+mTLS Incus导出、存储接口显式内存夹具，通过`logs/takeover-upload-completion-final.log`；未连接真实OSS/Incus磁盘。
- server类型、后端构建通过`logs/takeover-upload-typecheck.log`与`logs/takeover-upload-final-build.log`；2项备份守卫`logs/takeover-upload-guards.log`，补充断言后的复验另见`logs/takeover-upload-final-guards.log`。新增专项登记并接入CI既有隔离PG job，无前端变更。
- 后续仍须修任务创建/领取的当前归属与存储身份复核、固定远端意图/进程强杀恢复、Incus专用导出流证书绑定/背压及截止。当前getIncusClient池会从DB重读证书，因此调用者未传pin字段本身不是缺陷；另建export Agent的`rejectUnauthorized:false`才是需要继续处理的真实缺口。三台专用测试机用途授权已记录，系统域名解析正确，SSH身份来源未确认前不以扫描公钥替代可信记录。

## 2026-10-28 全部积压阶段保存与 Agent 代码复审

- **阶段提交已推送并核对远端**：`c277ba30a2180606e14fe96a071e096359b2c832`，248文件，包含旧聊天与本聊天积压。推送后工作区干净，无本地领先提交。之后继续施工按阶段保存，不等全部目标完成。
- 同提交[Agent运行40638325677](https://github.com/mastalee928/payincus/actions/runs/40638325677)成功，实际Linux `go test ./...`（含report、upgrade与常规controllerconfig）及IPv6 namespace包测试通过；发行步骤skipped，Agent未发行。需显式root/远端条件的网关迁移审计不据此声称已运行。日志`logs/takeover-checkpoint-agent-actions.log`，此证据补足下方“待Linux实跑”中的常规Agent测试，不能替代真实systemd服务或Incus宿主流程。
- 同提交[CI运行40638325831](https://github.com/mastalee928/payincus/actions/runs/40638325831)在依赖安装失败：锁文件已有jsdom，server/package.json漏devDependency，而Markdown安全测试实际require它。已补`jsdom:^26.1.0`，离线锁文件再生成与原锁完全一致、frozen-lockfile校验及实际Markdown运行测试通过（`logs/takeover-checkpoint-frozen-lockfile.log`、`logs/takeover-checkpoint-markdown-final.log`）；保持CI frozen校验，后续提交重新验证。
- Owner明确将此前聊天与本聊天全部积压源码、测试、迁移、规格及交接资料一起分阶段提交推送，之后继续修；授权已写入OWNER_REQUIREMENTS。基线main与远端均为0e80103，提交前无本地领先commit，积压均为工作区。正式平台/Agent版本不变；本次不打tag、不发Release、不做生产OTA。
- 暂存范围包含旧网关两份Linux测试与旧安装的design-taste-frontend技能及锁文件；两个恢复规格新增精确gitignore例外。日志、数据库、运行产物与仓库外私有连接资料不纳入。
- 用户要求无法完整运行部分先做代码级审查。本次逐段核对升级下载/解压上限、flock的稳定inode与旧PID处理、systemd重启确认/超时、Incus采集取消/并发/部分结果、CPU统计、远端见证mTLS/租约与隔离测试。CPU累积计数倒退时无符号减法可能形成错误占用率，已补倒退拒绝及正常/异常样本测试；旧网关错误holder断言曾重用已消费nonce，已改新nonce+错误身份真实签名并补正确身份对照，租约过期等待补总截止取消。
- `pnpm test:agent`已实际尝试，Windows因原有Linux专用`syscall.Statfs`不能构建report包；该调用在提交基线已存在，不为本批新回归。可运行的Windows升级/controllerconfig包通过，其余Linux部分以代码审查与amd64/arm64 vet、测试编译和Agent构建分别记录，不能称Linux测试已执行。日志：`logs/takeover-checkpoint-agent-final.log`、`logs/takeover-checkpoint-go-native-final.log`、`logs/takeover-checkpoint-agent-reviewed-cross.log`。
- 三台专用测试机私有记录与域名均已找回。Owner已允许重新分配全部测试用途，后续先核对旧身份及操作记录再补Linux实跑；A/B旧pin矛盾、C缺可靠历史pin仍须查明，未将观察到的公钥静默转为已认证身份。327项、真实Incus/独立备用/完整OSS灾备仍未完成。提交和远端确认结果在下一条阶段记录补写。

## 2026-10-28 自动快照持久恢复（源码与隔离验收）

- 自动快照改为先提交固定实例/owner/host身份、Incus UUID、唯一快照名称和原轮换目标，确认新快照后才删除旧快照。原操作保存 pending/applying/retry/blocked 状态，五次自动尝试后停止自动执行；原用户、宿主所有者或管理员经当前会话复核可重试。重试不重选目标，Incus 在途操作未完成时不凭列表名称提前删除旧快照。
- 调度器先恢复已有操作，禁用策略后仍核验不确定结果；不依赖崩溃遗留30分钟租约。未写远端的计划可取消；已有UUID的操作须检查在途任务和快照清单才决定结束或恢复。每阶段重新检查平台恢复保护，保护内零远端动作。不能据本批替代完整OSS/网关灾备。
- 手工快照 create/delete/restore 和策略更新已补锁内 current instance/host/owner/session 复核，快照动作与转移/重建/恢复队列及未决自动快照互斥；实例删除、换机、转移、轻/重任务领取及到期删除claim补独立快照门禁。手工快照自身进程强杀后的持久回执、其它备份/端口/host批量迁移仍未全部闭合。
- 原快照页补持久失败、原操作重试、刷新状态；修正enabled布尔合同，切换instanceId/卸载/异步乱序不串写。三语、三宽度、深浅色、键盘与44px热区及真实Vue→Fastify→PG→mTLS边界通过 `logs/takeover-auto-ui-browser.log`；截图与复现脚本 `logs/snapshot-ui/`，夹具已正常关闭。
- **25个自动快照场景通过** `logs/takeover-auto-durable-recovery-hold.log`：包含创建/删除/最终提交故障、旧快照保护、假成功、UUID/pin/会话变化、并发、禁用/到期后恢复、fresh/stale attempt、真实子进程SIGKILL、五次失败、远端仍在执行和恢复保护。实际使用本机PG与mTLS Incus API替身；真实Linux/Incus磁盘快照尚未验收。
- **全量188/188通过** `logs/takeover-auto-full-suite.log` / `logs/test-run-20261028-121614`（9m12s）。全量期间追加的恢复保护在专项25场景与最终server build覆盖，最终定向3/3 `logs/takeover-auto-final-guards.log`；双端/后端build和dist边界 `logs/takeover-auto-full-build.log`，最终server `logs/takeover-auto-server-final-build.log`。Lint 0 errors/658 warnings `logs/takeover-auto-lint.log`。
- 新鲜独立库 `takeover_auto_final_20261028_pool_test` 实际224迁移全部成功 `logs/takeover-auto-empty-migration.log`；运行库增量见 `logs/takeover-auto-operation-migration.log`。转移15场景回归 `logs/takeover-auto-transfer-regression.log` 通过；删除首次缺OpenSSL路径，修正进程PATH后 `logs/takeover-auto-delete-regression-final.log` 通过，用户所有自毁类型零退款/零余额账单，管理员退款选择保持。
- 轻/重任务claim追加未决快照阻断及终态后领取通过 `logs/takeover-auto-task-claim-regression.log`。站点页实际Vue→Fastify→PG→TLS Caddy边界浏览器通过 `logs/takeover-proxy-ui-backend-browser.log`：202不报完成、502持久失败/刷新、409冲突、同requestId重试、显式toggle与确认后延迟删除、三宽度/三语/深浅色。202场景在真实数据库注入fresh applying，再由真实service完成；不是完整worker调度或真实Caddy服务器证据。`logs/proxy-sites-ui-backend/`留存脚本/截图，夹具已关闭。
- 未commit/push/tag/Release/生产OTA/DNS/客户操作。327项未整体完成；剩余优先继续手工资源操作持久恢复、其它生命周期、Linux与网关真机。上述分项通过不代表已达到发行条件。

## 2026-10-28 接手恢复与转移清理（进行中）

- 自动快照调用/类型恢复、实例操作锁与原宿主证书绑定已修；真实PG+mTLS边界7场景通过 `logs/takeover-auto-snapshot-integration-verified.log`。自动快照远端成功后DB失败/进程中断恢复仍未闭合，不能算完整完成。
- 巡检成功观察CAS与本地冲突不误降级宿主，18场景通过 `logs/takeover-sync-success-cas-integration-verified.log`。真实Windows Caddy v3 tombstone零流量/旧代次拒绝通过 `logs/takeover-caddy-v3-runtime.log`；不是Debian/公网ACME证据。
- IPv4 supersede保留原未决端口/HTTPS/备注，新IP新代次原子替代、旧receipt禁止执行，专项 `logs/takeover-proxy-ipv4-supersede-integration.log` 通过。schema新增superseded迁移；先前独立空库222迁移成功，随后增量223项，最终新鲜空库223项仍待重验。
- 双端及后端build `logs/takeover-full-build.log` 通过；当时全量188执行186过2失败 `logs/takeover-full-suite.log`。两项失败守卫已按helper/outbox真实位置保留安全意图修正，定向2/2 `logs/takeover-updated-route-guards.log` 通过；尚未得到最终代码全量188/188。
- 转移恢复原固定清单和目标名，逐阶段共享instance锁、host身份摘要/Incus UUID、会话与归属/工作流复核、进程内互斥与持久attempt、确认后清资源/重计端口、finalize拒绝清单外残余资源。空cleanupState禁止直接executeTransfer；失败不回滚pending从而开放原资源。
- 接收/推送真实PG/Fastify边界 `logs/takeover-transfer-routes-integration.log` 通过，删除了旧测试中手工清空cleanupState和重设pending的绕行；夹具IPv6改为每宿主唯一以遵守完整迁移的真实约束。
- 新转移专项 `logs/takeover-transfer-cleanup-integration.log` 14场景通过：共享双协议双栈、专属保护、rename/port/snapshot/backup远端成功DB失败、Caddy拒绝、文本404失败、虚假删除成功、宿主pin、UUID变更、会话撤销、并发和清单外资源。是真PG+mTLS Incus/TLS Caddy API边界替身，真实Incus磁盘/网络及进程强杀后续仍待验。页面重试入口、最终类型/守卫/构建及其它生命周期联动仍在继续。
- 本轮仍未commit/push/tag/Release/生产OTA/DNS/客户实例或账目操作。327项、自动快照、独立备用网关与A完全失联→B OSS恢复目标继续保留；测试机SSH身份问题未绕过。
- 转移追加进程强杀恢复后15场景通过 `logs/takeover-transfer-cleanup-final.log`：真正子进程在远端删除后被终止，后续按固定UUID/清单与持久阶段恢复。交割前再次核对远端残余快照/备份及DB残余资源。原接收/推送专项通过；不会把新主人的资源扩入删除清单。
- 用户转移页已增加处理中原记录重试与持久错误，手机44px按钮、键盘可达；真实Vue源码→Fastify→PG→mTLS边界浏览器复验通过 `logs/takeover-transfer-ui-browser-final.log`，3宽度/3语/深浅色，刷新保留失败、发送/接收双方原路由重试完成。截图/脚本在 `logs/transfer-ui/`，本机服务器已关闭；头像使用本地空替身，未验证外部头像服务。无新增业务确认流程。
- Caddy专项追加连续两次412后成功、fresh applying零远端、stale attempt替换、变pin/撤销会话拒supersede、applying supersede旧attempt禁执行、真实子进程远端提交后强杀并恢复读取回执（零重复POST），全部通过 `logs/takeover-proxy-restart-integration.log`。
- **当前阶段全量188/188通过**（8m40s）`logs/takeover-transfer-full-suite.log` / `logs/test-run-20261028-110557`。双端/后端build及dist边界 `logs/takeover-transfer-full-build.log` 通过；手机按钮尺寸随后微调，双端构建追加结果见 `logs/takeover-transfer-touch-build.log`。新鲜空库实际223迁移全部通过 `logs/takeover-final-empty-migration.log`（`takeover_final_20261028_pool_test`）。Lint 0 errors/676 warnings `logs/takeover-transfer-lint.log`；本次TransfersView新增格式警告随后定向修正，见 `logs/takeover-transfer-view-lint.log`。
- 后续明确待项：自动快照持久意图/失败回执和远端成功DB失败恢复；手工快照/备份等早期预检与转移并发窗口；其它到期/重建/改节点/host迁移生命周期；Caddy完整站点UI真后端合同；327适用项及Linux/网关真机。188全绿不能替代这些未覆盖流程。

## 2026-10-27 接续精修：站内信、Caddy复审及初始化实跑（源码阶段）

- R049/050/051：四个站内信发送入口锁内current sender/session/host/instance/recipients；管理员消息、宿主消息和公告history同事务，多收件人邮件排期也同事务。单邮件仍在提交后向已授权快照直接投递。真实PG/Fastify封禁/注销/降权/宿主变更、实例转移后当前收件人、操作锁冲突和history/queue trigger回滚通过logs/review-inbox-send-integration.log；fixture-inbox-write-failure为预期故障注入，没有SMTP发送。相关4/4 logs/test-run-20261027-224442，server类型review-typecheck-inbox-final.log通过。
- 独立复审补Caddy LRU：每次请求重新取得存活Agent且刷新LRU，GET在途被淘汰后POST继续、旧client复用、关闭通过logs/review-caddy-lifecycle.log；Fastify实际请求/错误日志中的caddy-script路径token已脱敏。Nginx外层访问日志尚须处理，不能称全链路无泄露。
- 证书入口补日期/hostname/TLS信任共同核验，只有全部通过为valid；公网DNS及固定IP/SNI保留。真实TLS正确链/自签/错域名/过期/未生效/缺中间CA通过logs/review-proxy-certificates.log；无前端修改。
- R254已有init-env去重补丁经真实Bash五组临时ENV_FILE执行通过，fresh/重跑身份保持/空重复键/已有含等号值/CRLF/不打印敏感材料，logs/review-init-env-execution-final.log；相关2/2 logs/test-run-20261027-224403。Windows执行不替代Linux文件权限。
- 纠正上一节范围：Caddy自身拒绝reload回滚不等于远端成功后DB故障可恢复，后者仍缺持久意图/恢复；共享instance锁也未覆盖transfers提交后全扫清理，R133/134/136/137/138仍需固定清单和持久门禁；hosts/instances地址同步旧snapshot delete/add也待修。台账R123/124/127/130/131降为部分，避免把分项通过写成端到端完成。
- 中断后沙箱tsx os.userInfo ENOMEM及原PG停止阻碍执行，自动批准仅本机专项后已重启原127.0.0.1:55438隔离集群；没有生产连接/客户数据。新专项按清单登记，整批最终全量/构建/人工审视与发行仍未做。没有commit/push/tag/Release/OTA/DNS/客户操作。

- 接续新增R019真实列表查询实证：1人页/100人页均11条SQL，2002登录历史只取1，徽章/计数/余额/空值/脱敏保持，logs/review-user-list-integration-final.log；type通过，4项守卫test-run-20261027-225458及demo修正过时提交标记后test-run-20261027-225746单项通过。R139完整private区间/空数组/配额/both/自动/冲突重提真实PG/Fastify+mTLS通过review-batch-port-range-integration.log；边界为Incus替身。
- 管理员普通余额adjust/gift和审批创建/批准/驳回传current actor/session入事务，5入口降权拒绝、注销/封禁零写、5并发批准1入账、充值退款仍负向收回、ledger trigger故障回滚通过review-admin-balance-integration.log；相关4/4 test-run-20261027-231225。orders case及Public API资格并未因此完成，R026继续部分。
- Caddy脚本路径Nginx侧新增独立location禁用access/error原始URL日志，保持proxy headers；真实生成配置检查与完整隔离installer guards通过review-installer-caddy-log-guards.log，未重新配置任何线上Nginx。外部CDN/自建proxy日志不在此次修改范围。
- 一次本地清单去重脚本使用错误PowerShell通配模式造成scripts/run-tests.mjs误清空，已读取HEAD原执行器重建并补回全部本轮专项；没有重置Git/丢弃业务修改。node --check及manifest检查通过review-manifest-recovered.log/latest，188项守卫保留；不得将误清空时执行视为测试通过（没有以空文件通过结果作为证据）。

- R032独立复审纠正：两个AFF返佣helper缺enabled，邮箱手动/自动续费能给已停用码返佣。现新绑定/资格/折扣/佣金同事务复核、历史迁移永久绑定保留；新增真实竞争验证后将新购锁顺序改为host/用户→AFF，admin先账户检查，AFF余额锁非阻塞竞争409；实例/邮箱自动续费竞争不消耗尝试预算、不关闭。review-aff-eligibility-integration.log与8/8 test-run-20261027-231442通过；真实Incus新购/迁移未验。
- 此后统一server类型review-typecheck-progress-final.log通过；既有财务review-finance-after-admin-aff.log再验通过。用户自行销毁专项review-user-no-refund-after-finance.log已再次通过：paid/free/error/单批用户销毁账目变化0，管理员退款选项及拒删记录保护保持。日志中的invalid.example.test通知失败为隔离夹具，未操作真实客户。

- R024/025批量配置锁内current actor/session/host/instance身份/任务/transfer，每次重试重读；字段与当前host资源差值一次事务、取消批末旧快照增量。真实PG/Fastify+Incus边界替身并发/旧归属/同值重放/部分远端失败/DB计数trigger回滚通过review-batch-config-integration-final.log；类型review-batch-config-typecheck-final.log、4/4 test-run-20261027-231808、最终目标投影后batch守卫232017通过。失败准确requiresReview，不自动盲重试；审计FK锁超时250ms后无FK保留标识。进程在远端写入后被杀仍缺持久操作计划/重启自动对账，此两项继续标部分。
- R142/143新增ProxySite.ipv4SyncPending（migration 20261027010000_proxy_ipv4_sync_pending）：两处sync将状态/IP/主IP/待同步标记在共享操作锁事务保存；逐site锁内复核current owner/host/Incus身份及登记证书/站点开关再原子addSite，失败或远端成功DB失败保留标记，后续sync无IP变化仍重试。保留suspended，Caddy错误不进入missing-Incus删除路径。review-proxy-ipv4-sync-integration-final.log、type review-proxy-ipv4-typecheck-final.log与3/3 test-run-20261027-232329通过。无独立timer，其它network同步入口未全部接入。
- 新列已实际SQL应用纯夹具库（review-proxy-ipv4-fixture-migration.log）；原夹具库无migration台账，完整deploy的P3005留存且未baseline。独立空库完整220项迁移验证另跑，结果须以其日志为准。当前全量188守卫运行中，不能引用旧基线宣布本批全绿。

- 当前阶段全量188项实际跑完186过/2失败（test-run-20261027-232403，7m52s）；失败为security-config仍在hosts.ts找已迁出的Caddy签名helper、operation-verification仍要求users route直接claim而实际已移db/users.ts同事务消费。已按实际调用链增强定位而非删断言，5/5 follow-up test-run-20261027-233304通过；未把旧全量改写成188全绿。
- 站内信复审补两管理员广播按ID统一锁发送者/实际接收人，避免父用户行与inbox FK互等；review-inbox-send-concurrency-final.log通过。调账超上限输入改400，review-admin-balance-final.log通过，包含真实并发/故障回滚。
- 独立空库实际220项prisma migrate deploy全部通过review-current-stage-migration-deploy.log；库名仅记logs/review-current-stage-migration-db.txt。本机运行时没有createdb.exe，首次命令未创建库，后改使用已装pg客户端CREATE DATABASE；不影响原夹具库，也没有baseline旧库。
- 当前双前端构建和dist边界结果见review-current-stage-client-build.log；Lint review-current-stage-lint.log为0 errors/664 warnings，不自动格式化无关UI。本批无新前端源码修改，早先UI审视待项仍保留。
## 2026-10-27 外部清单精修：Agent凭据及Caddy站点（源码阶段）

- Agent R091/092：身份/秘密/nonce与install token同事务，host锁内current actor/session/owner或host token；decrypt/hash成功后CAS消费。并发7签发仅最新、7消费1次、中途封禁/降权/注销/转移、trigger故障回滚通过logs/review-agent-credentials-integration.log；Go真安装/心跳未验。相关3/3 logs/test-run-20261027-211708。
- Caddy R116–131适用项：v2无损域名ID、legacy exact host+ETag删除、实际HTTP404、HTTP-only skip/protocol；复制原http配置原子ETag写，412最多3次且90秒总预算，保留已有监听。六入口共享instance操作锁/current regular actor/session/owner/readiness/expiry/workflow，quota锁内重算；transfer等待提交，拒删/缺配置保留record/error，拒绝更新保留旧site。错误commit后返回、日志同事务。
- generate/reset/confirm复核host当前owner/actor及probe前后credentials/address；安装脚本token绑定签发session/role/owner和exact credential digest，下载再次检查，旧命令需重生成。CA内容hash绑定pool key、LRU100淘汰close、app onClose已接。
- logs/review-caddy-proxy-final.log通过真实PG/Fastify/HTTPS：6入口ban/注销/role/转移/未就绪/busy、quota并发只1、transfer锁等待、字段重试合并、拒删/缺配置重试、旧安装命令拒绝、disabled pending DNS匹配不启用、CA路径内容变化/淘汰close；DNS/Caddy API为边界夹具。
- 官方Caddy2.11.7 Windows amd64按官方SHA512核验，原生进程实际TLS/Basic Auth/根ETag子路径更新、HTTP Host请求、无效handler原子reload回滚、IPv6 dial/legacy删除通过logs/review-caddy-runtime-validation-final.log。不是Debian13/14安装/ACME公网签发验收。
- 首次夹具误写任务枚举/params及void返回、runtime校验算法/括号/Host与无效dial判断均已修，失败日志留存。首次runtime validate未隔离存储并自动加Java测试CA，已按唯一alias+SHA256删除该测试新增CA；后续validate/run均隔离存储且install_trust=false，没有持久系统信任变化。
- 最终server类型logs/review-typecheck-caddy-final.log、相关6/6 logs/test-run-20261027-221326通过；test:check188/35专项合法。server无ESLint配置，两次命令失败未算通过；根pnpm lint仅client，最终另跑。未全量/最终双端build/327完整审视/预览，无commit/push/tag/Release/OTA/DNS/客户操作；R133和其余原编号继续。用户销毁不退款与一机一卖保留。

## 2026-10-27 外部清单精修：账号、命令、连接池和任务（源码阶段）

- 接续原327项初审，按原编号增量记录于REVIEW_CHECKLIST_FIXES.md。本阶段没有commit/push/tag/Release/生产OTA/DNS/客户账目操作；正式v1.7.7与旧181/181基线不代表当前候选完成。
- 用户自行销毁无退款在新连接池上再跑真实PG/Fastify/mTLS集成通过，latest logs/review-user-no-refund-integration-latest.log；单台/批量/paid/free/error/已退/重放/并发其它退款/远端拒删保持财务表差量0及库存删除顺序。Incus进程/磁盘仍为边界替身。
- 2FA CAS/恢复码/撤销故障回滚通过logs/review-2fa-integration-latest.log；邮箱发送/用途/attempt/consumption/profile/reset/register事务通过logs/review-verification-integration-profile.log。schema新增attempts/consumedAt；独立空PG实际migrate deploy应用全部219迁移，logs/review-migration-deploy.log；未生产迁移。
- SSH真实公钥解析、异步RSA4096、duplicate/20上限、禁用/撤销写入通过logs/review-ssh-keys-integration-final.log。命令模板50/100上限、并发字段合并、delete/update及403门禁通过logs/review-command-integration-final.log。
- 本次管理员账号真实Fastify/PG验证通过logs/review-admin-account-integration.log：邮箱大小写并发唯一分配、初始banned/配额同事务，reset/封禁/取消2FA/OAuth/role/撤销注入持久写失败全回滚、actor降权/注销及删除与目标角色提升/余额冲突保护。并未完成其余管理员余额/配额入口。
- 邀请码handler与支付fee配置仅own-property、通知完整整数及PG offset限制：真实Fastify/PG边界通过logs/review-config-pagination-integration.log，对应5/5守卫logs/test-run-20261027-200553。类型检查logs/review-typecheck-admin2.log通过，后续OAuth/任务改动需新检查。
- IPv6启动恢复实际设备identity及失败恢复行为/recreate/cancel守卫3/3通过logs/test-run-20261027-190006；Linux真实route恢复未验。任务领取5上限/instance互斥/host&type/status CAS真实PG通过logs/review-task-claim-integration.log；连接池配置/迟到代次行为通过review-incus-pool。执行尝试及timeout继续核查。
- pnpm test:check清单188项、27活体/产物专项排除合法；尚未当前候选最终全量/最终构建/全部清单人工审视或发行。独立PG仅127.0.0.1:55438，无客户数据；测试凭据不进入台账。首要完整网关灾备/P0–P6继续未完成。

- 后续OAuth绑定/回调/换码及自助解绑、续费服务期/归属/托管资格/会话和quota/托管调整真实PG验证分别通过review-oauth-integration-final.log、review-renewal-integration.log、review-quota-hosting-integration.log；provider fetch为边界夹具，未做生产OAuth/客户流程。
- AFF转换/批准/拒绝、管理员充值complete/fail/sync、全部卡密变更提交内current actor/session；卡密allowlist从事务PG直接读取。中途封禁/降权/注销/移出allowlist不写账，重复结算/兑换及退款一次、账单trigger失败全回滚，通过logs/review-finance-authorization-integration.log；其中fixture-finance-ledger-failure为预期注入。管理员sync旧金额解析也补严，缺失/非法实付金额拒绝。
- email/instance尝试finalizer及instance startup/runtime回收按startedAt/retryCount/type/status/到期复核，迟到扫描不覆盖new attempt；165 fresh不挤掉due stopped选择通过logs/review-queue-sync-integration-final.log。其余worker/财务/前端/Agent清单继续，不能称整个327项完成。
- 清单188项/31专项重新check通过，新增finance专项后还需复查。早期两次筛选使用逗号失败已改重复--only；finance首次夹具遗漏authenticateAdmin注册失败，补齐后成功。无客户数据/生产操作，无发布。


## 2026-10-27 用户自行销毁不退款（源码修复，未发布）

- Owner实测弹窗显示无退款，但后端单台/批量仍结算剩余价值、增加余额并写退款账目。`instance-destroy.ts`已移除两个用户入口的财务结算，预览及结果金额固定0，复用既有非退款删除通知；页面文案未改。销毁审计单独保留0金额，不写余额/退款账单，不扣回托管及AFF。管理员退款选项与创建失败自动退款保持；未修改历史账目或生产客户。
- 后端类型检查与销毁/管理员删除/充值守卫3/3通过，日志`logs/review-typecheck-no-refund.log`、`logs/test-run-20261027-163814/summary.txt`。独立本地PostgreSQL16.10新建schema库`review_no_refund_pool_test`，真实Fastify路由与mTLS Incus接口集成通过：未到期付费、免费、异常及免手续费参数、批量重复ID、已退实例、重复请求、并发既有退款、远端拒删全部检查余额与账目差量；管理员退款/不退款与删失败保护保持。日志`logs/review-user-no-refund-integration.log`。Incus进程/磁盘由隔离HTTP服务模拟，不能当作真实Incus主机或生产部署验收。
- 外部327项精修仍在进行，前节初审为历史基线，不能据本小节宣称整份清单完成。没有本阶段commit/push/tag/Release/OTA/DNS/客户操作。

## 2026-10-27 外部327项清单定向核查（未修复、未发布）

- Owner要求按本地外部清单逐项核对，不进行无目标全库审查，也不照搬不同分支架构。[REVIEW_CHECKLIST_AUDIT.md](REVIEW_CHECKLIST_AUDIT.md)保存原327个编号、问题、优先级、当前证据及差异；基线HEAD为`0e8010371c8eb7a0eeaef9b9a1d0df6caf312092`。189项存在代码缺口、57项部分存在、53项已有防护、24项实现不同、4项待运行验证；包含重复根因和维护残留，不是246个独立漏洞，也不代表已影响生产。
- 保留一机一卖、独占库存与交付/退款/删除保护、单后端、IPv4-only主控/网关与宿主/客户IPv6独立。明确纠正对方不适用项：本库客机备份后端仍注册运行、资源选择组件仍有消费者、改节点任务目标已有正确记录、默认管理员密码不能按通用校验推断首装必失败；不据清单删除OSS或放松远端删除确认。
- 基线全套`pnpm test`181/181通过（`logs/test-run-20261027-125519/summary.txt`）；源码提取/transpile隔离复现R1-001/153/154/155/163/215/236/257/258/259及相关HTML清理缺口，金额源码判断另复现R1-036缺失/非法值通过门禁，PG bigint输入拒负数/小数/溢出。静态扫描178 SVG中48个文件缺引用ID。结果在忽略目录`logs/review-checklist-repro-results.json`、`review-boundary-probes.json`、`review-static-probes.json`；不是完整支付入账、浏览器攻击、真实Incus或生产影响证据。
- 报告完整性检查327唯一编号、原问题/优先级逐字一致、证据路径存在及行号不越界，结果`logs/review-report-validation.json`。R1-084跨语言哈希、R1-260具体消息/占位符、R1-315三语实际控件、R1-326手机长Webhook仍待运行；其它已定位竞态也未全部DB/浏览器复现。没有本轮业务代码修改、commit/push/tag/Release/生产操作；原有Agent测试与技能安装工作区保持。

## 2026-10-27 v1.7.7 正式发行与再次代码复审

- 修复提交`ef12578eaa99a943808a162b0548a2be868a40f2`已推送main；[源码CI40446366307](https://github.com/mastalee928/payincus/actions/runs/40446366307)所有job成功，包含独立PG远端设置、IPv6/删除集成、Linux安装执行器、Go全量/竞态及双架构组件验签。Agent构建40446366305成功，Publish预期skipped，仍沿用Agent v1.0.3。
- [同提交预览40446366982](https://github.com/mastalee928/payincus/actions/runs/40446366982)双构建、双首装全部成功，Release预期skipped。AMD64原生181/181；两架构实际应用218迁移、单后端、双前端、管理员登录及管理身份核验通过；备份/预检/恢复/回滚/续跑、整库SQL完整性与ZIP/迁移兼容演练通过，OSS传输为隔离替身，不计真实云端灾备。
- 实际下载预览AMD64包SHA256为`4f92547519b8d1505cccfbccd456f130f67dca561847cc6b798d70ff7234fb69`，ARM64为`062236b501c89e30e6fa11edcbb181ab1fcd4f7f724612ac9e4936f08ec5cc92`。两包源码、version元数据、归档root身份、双前端/许可证、四份20文件独立组件签名/哈希/大小/模式/ELF及本次修复内容通过；固定组件公钥与原正式发行及GitHub配置一致。预览包浏览器实际操作表单、打开并提交确认后显示回执且当前仍本机，SSH/root/数据为隔离边界；390px无横溢出、可见主控件44px，截图已本地保存。
- [v1.7.7正式Release](https://github.com/mastalee928/payincus/releases/tag/v1.7.7)已公开发布，非draft/非prerelease，latest为v1.7.7。正式tag绑定上述提交；[正式流程40447477254](https://github.com/mastalee928/payincus/actions/runs/40447477254)双构建、双首装与Release全部success。两架构正式包实际218迁移、单后端、双前端、管理员登录、管理身份、备份/预检/恢复/回滚/续跑、整库完整性与兼容检查通过；OSS传输仍为隔离替身。没有生产OTA、DD、DNS或客户操作。
- 公开正式AMD64包SHA256为`d45fd04df7a9c5301c3794dbad2c912c8667d755d7d0a9eda5d6a53f8c9653e0`，ARM64为`250c06a5fcb13f11fa0cffc5ce9800e36413d87168217a8cae393a2f06769821`，分别211708006/210916752字节。实际下载六份公开资产均与GitHub digest、双SHA256文件及OTA清单一致；两份OTA清单逐字节相同，版本/tag/源码身份及双架构下载URL核验通过。两包再次通过四份20文件组件独立验签/哈希/大小/模式/ELF、归档root身份、双前端/许可证/地图、新迁移及最终错误预算/原任务重试/IPv6回归修复内容核验，证据在忽略目录logs/release-v1.7.7/formal-package-result.json及formal-manifest-result.json。

- Owner明确再次代码审查后发版，本阶段范围为独立网关页面、外部/备用候选检查安装、持久错误和IPv4-only网关回归；完整接管/切回/新IP主控恢复与公网灾备仍未完成，见GATEWAY_PROGRESS及docs/gateway-setup-v1.7.7.md。前节未发版是上一轮事实，后续发行结果在本节追加。
- 第二轮逐项审查SSH固定地址/身份、签名组件/受限路径、Python退出1的严格公开错误对象、worker部分写入状态、资源保留、退役边界、错误历史投影及IPv6分类。补修同步冲突检查70秒预算（下一轮须预留45秒），前端等待100秒；预算不足明确持久超时且不创建新安装。已有安装候选隐藏准备重试；本机预检完整接收6种公开错误，不丢弃缺工具/超时原因。
- 实际隔离PG回归已通过，总预算失败只检查一次、不创建安装、错误持久；等待确认候选禁止准备重试。日志review2-remote-pg-final.log。Lint0 errors/664既有warnings；Go目标包通过；双前端/后端构建与dist边界通过，最终相关与全量结果另追加。没有生产OTA、DNS改动、客户操作或接受新的测试机SSH密钥。
- 本轮181/181全量通过（logs/test-run-20261027-114051，8m26s）；后续预检错误/预算/提示相关10/10通过（logs/test-run-20261027-114515，2m7s）。最终server构建通过；实际构建浏览器复核当前本机与安装候选分离、外部表单和未接管说明。暂存凭据扫描通过，无关Agent测试/技能安装未纳入提交。接下来在同一完整源码提交运行CI与双架构发行预览，结果未出前不声称发行验证完成。

## 2026-10-27 上线审视：当前网关候选未达到正式发布条件

- Owner要求达到上线标准后推送发版。本轮未提交、推送、tag、Release或生产OTA；正式版仍v1.7.6。下列代码修复和局部实证不代表独立/备用网关已经可接管。
- 修复DNS-only校验后SSH重复解析可能指向不同IP：后续检查固定使用本次已核验公网IPv4，DNS失败保留具体公开代码。远端前置失败记录严格投影/验证字段、大小与请求键，不返回旧备份任意JSON或额外凭据字段；域名格式失败持久记录，非法地址内容不存。数据库先筛选失败再限制，近期成功不挤掉未解决失败；已退役机器不占当前列表。相同用途远端安装候选在串行事务内保留，取消不释放可能已写入的资源；未投入管理候选仍可软退役重新检查。
- 安装错误链补齐：Python计划/执行器只返回格式受限公开代码，区分超时/缺工具；Node本机与远端固定执行路径读取严格错误对象，worker及任务保留具体原因，部分执行仍为needs_review，不清身份或保留资源。SSH错误也允许进入失败记录，避免只接受GATEWAY前缀导致原错误丢失。新增三语超时/命令/通道不匹配和用途占用说明。
- 预检守卫新增真实package脚本并加入根testGuards，避免漏跑。CI新增隔离PostgreSQL远端计划/中断/域名固定/凭据边界任务，当前仅工作流源码，未触发新提交Actions。
- 本轮全量180/180（logs/test-run-20261027-104856）；增登记后181/181（logs/test-run-20261027-110032，8m10s）。最后用途/失败筛选修改后相关12/12（logs/test-run-20261027-110721）；后续仅手机按钮44px样式修复另做路由/i18n/构建复验，不把较早全量冒称后续每个状态再次全量通过。
- 实际隔离PG远端设置通过（release-review-remote-final.log）、任务日志12项（release-review-task-final.log）、安装密码/MFA/一次材料12项（release-review-installation-integration.log）通过。新增部分执行夹具首次遗漏数据库租约/批准字段，被原CHECK拒绝；两次失败保留，补齐夹具后通过，未改约束。
- 双前端/后端构建和dist边界通过（release-review-build-final.log），最后三语管理员构建通过；Lint0 errors/664既有warnings。Go目标包使用既有解压工具链通过（release-review-go-runtime.log），Linux双架构交叉构建通过；系统Go shim无法启动保留记录。Windows Python probe及公开错误纯测试通过，Linux root/systemd部分跳过。构建曾与编辑交错读到未使用import而失败，去掉后server-final及完整build-final通过。
- 最新实际构建浏览器操作外部表单、打开确认框、填写并点击确认，回执显示安装完成且当前仍本机，候选明确未接管；数据/SSH/root为隔离夹具。390px无横向溢出；安装折叠按钮38px补44px。release-review-mobile.png是视口截图，不声称全页/独立原生检查器通过。
- 最后44px修改后admin构建退出0（release-review-admin-touch-final.log）、路由/i18n2/2（logs/test-run-20261027-111156）、dist边界通过（release-review-dist-final.log）。浏览器重新载入最终构建，390px页面/内容宽度一致，所有可见main按钮/输入框高度至少44px；最终视口截图release-review-mobile-final.png。视口恢复默认并保留页面。CI YAML使用项目现有js-yaml解析通过；前次尝试不存在的yaml根依赖失败不算通过证据。
- **正式发布阻碍**：远端检查最长17次同步SSH/命令，前端90秒可能先于后台完成；缺依赖自动补齐未实现；主控/宿主第二通道、已有网关attach/update、独立OSS覆盖/较新撤销合并、真实readiness与唯一写者交接、接管/切回/新IP主控恢复尚未实现。千台apply/restart仍有20秒总截止且逐peer启动ip命令，缺Linux规模运行实证，清单容量不代表千台完成。三机原SSH身份尚未核实、Debian13/14原生真机流程未验收，不绕过pin制造成功。完整P0–P6/AC01–AC34/72小时仍未完成。

## 2026-10-27 网关独立导航与扩展施工（未发版）

- 最新要求与本轮证据已补GATEWAY_PROGRESS：Debian13/14允许IPv4-only，网关IPv6不影响宿主/客户IPv6；同步和异步的协议族/路由不可用进入原认证Incus客机核验，保留错误身份/出口阻断，双地址映射/转发不变回归通过。没有原Debian13/14网关安装真机实证，不能称全兼容完成。
- 完整180/180、随后相关8/8及独立PG/双构建分别记录；前置错误持久记录、DNS目标绑定、未用候选软退役与旧记录不可重试补齐。外部/备用确认及重试经隔离浏览器实际操作，远端/灾备不是夹具验收。完整接管、自修与OSS恢复缺口详见GATEWAY_PROGRESS，保持未完成。本轮未提交、推送、tag、发版或生产OTA。

- Owner最新要求左侧「网关」紧挨「机器池」上方，新增`/admin/gateways`管理员路由复用完整配置组件；机器池移除重复网关标签，保留宿主/接入任务及未就绪时的配置链接。三语、权限、API、确认框与材料领取边界保持。
- `logs/test-run-20261027-092159`的client类型、前端路由/i18n、host-pool4/4通过；双端构建、dist-boundary、相关前端ESLint、server build通过。浏览器实际构建在19535独立夹具验1440/768/390、左右键、三语、深浅主题、侧栏顺序及手机菜单关闭；备用计划/安装确认实际提交返回夹具回执，无真实SSH或root执行，不计真机接管。
- 独立PG远端设置集成通过冲突规划、中断续接、幂等/目标变化拒绝、加密凭据与安装任务不会被较新检查挤掉回归。容量及未完成门禁见GATEWAY_PROGRESS。完整测试机连接资料只存仓库外本地私有档案，读取入口见OWNER_REQUIREMENTS；A/B旧SSH身份与当前不符、C无可靠旧指纹，未认证/未远端变更。本阶段未提交/推送/tag/发布/生产OTA；正式v1.7.6证据保留。

维护仓库：[mastalee928/payincus](https://github.com/mastalee928/payincus)。GitHub Fork 关系已于 2026-10-16 解除；仓库地址和提交历史保留。原 BSD 3-Clause 许可证与版权声明继续保留在 LICENSE。

## 2026-10-27 v1.7.6 最终源码审视与候选验证

- [v1.7.6正式Release](https://github.com/mastalee928/payincus/releases/tag/v1.7.6)已发布，非draft、非prerelease，latest为v1.7.6；[正式流程40368811024](https://github.com/mastalee928/payincus/actions/runs/40368811024)双构建、双首装和Release全部success，tag保持绑定修复提交fb328e87cad431fc53d89a098205b6e0b5a04151。实际下载的公开正式包AMD64 SHA256为`cdb693b1007a5b9174550d6f1de56bb95e70210eb8a2418a09b288245f1d1993`，ARM64为`ed19fc08fb6003e3dc8eea27b05d6f8494e3e234b0715475f3fb0986cd8d1ba2`，分别211672465/210863420字节，与各自SHA256文件、GitHub digest及OTA清单完全一致，两份清单逐字节相同。公开双包再次核验版本/完整源码身份、新迁移及修复内容、root归档所有权、许可证、双前端和四份独立签名组件；每份20文件的哈希/大小/模式与ELF架构通过。证据在忽略目录logs/release-v1.7.6/formal-package-result.json及formal-manifest-result.json；正式包管理员创建页另以隔离数据实操，最终桌面/平板/手机与深浅色截图已人工查看。
- 本轮保留既有Agent v1.0.3，没有发布无关Go改动。生产未OTA、未销毁客户或修改退款，现有故障隔离未解除。72组SSH生成/统一原生解析/真实协议验证不等于Ubuntu、Rocky、Alma、CentOS每个原始镜像均已完成全新交付或VM启动；真实公网A整机失联/B从OSS恢复、全部P0–P6/四拓扑/72小时仍未整体验收。
- 修复提交`fb328e87cad431fc53d89a098205b6e0b5a04151`已推送main；[源码CI40366648035](https://github.com/mastalee928/payincus/actions/runs/40366648035)全部success，包含新增机器池/IPv6/删除隔离PG与实际双向TLS边界集成。[同提交预览40366668498](https://github.com/mastalee928/payincus/actions/runs/40366668498)双构建、双首装全部success，Release预期skipped；AMD64完整180/180。两种首装均应用218条迁移，唯一后端、双前端、管理员登录、管理身份、Agent下载、备份预检/恢复/回滚/续跑及完整数据库/ZIP/迁移兼容演练通过；OSS transport为隔离替身，不等于真实云端灾备。
- 实际预览AMD64包SHA256为`cb7a7009ebec3a2ff4d3a1b70d22d842097d35aacf84c90764da59ed58fb6a2d`，ARM64为`b285639328bc9bbb34e2d4cecf300255929df210daabfe72a0ae2146fe70169d`。两包版本preview-fb328e8、源码fb328e87cad4、组件版本1.7.6及完整源码身份一致；四份组件清单均按独立固定公钥验签，每份20文件哈希/大小/模式与ELF架构通过，归档root所有，双端、许可证、新迁移与本轮修复存在。预览包实际浏览器再次核对单月续费、零退款确认及点击确认后仅显示销毁成功，数据为独立夹具。
- 正式tag v1.7.6绑定上述同一提交；正式流程与公开资产按本节最终结果记录，发行不等于生产更新。
- Owner明确授权审视、提交推送和发版，范围为九项及本轮紧急交付/销毁修复；不包含生产OTA、客户删除退款或公网DNS变更。IPv6统一复用第1项修复，不做重复实现。
- 审视补齐管理员单删/批删实际Incus停机，失败保留记录/库存/账目；用户销毁在共享余额锁内再次计算退款上限，创建失败回调不对已被销毁认领的实例退款。独立PG+实际HTTPS双向TLS的Incus边界覆盖error/Running、退款选择、角色权限、重放、远端失败保留、预览后退款交错，均通过；远端进程/磁盘为受控边界，不记为生产删除。
- 容器/VM的72组SSH生成策略及真实SSH2算法/密码/root检查通过，VM补齐RHEL/Alpine客户端工具；旧Include能力使用stdin配置检测。Alpine3.21及Debian13原客户只读公网登录、跨区公网IPv6证据沿用前节；Ubuntu/Rocky/Alma/CentOS各版本全新镜像与VM启动仍未完整实机验收。
- 最终业务源码全套180/180（logs/test-run-20261027-004244，8m41s）、双端/后端构建和全站Lint0 errors通过。随后UI审视补齐实例列表批量续费仅1月（此前只改详情）、单选布局和管理员退款提示；相关路由/i18n/类型/构建复验单独记录。新隔离CI job覆盖机器池、IPv6和删除数据库集成，避免仅静态守卫。
- 编译后本地浏览器已操作指定用户、机器池免费/付费及首月扣费、原套餐资源、TCP默认/TCP+UDP、默认展开/地区、本机计划→单域名→确认成功→重新进入成功收起、节点退款选择→确认删除。数据是明确独立夹具，无生产代理；不把夹具结果当生产验收。1440/768/390人工截图与检查保存于忽略目录。检查发现旧应用壳装饰与新创建主按钮渐变/阴影，页面局部去除后复验，保留现有导航。
- 最终已发版，源码、同提交Actions、首装、包核查与浏览器证据分别记录。生产仍保持原部署，完整灾备门槛不变。

## 2026-10-26 紧急排查：Alpine 新建／换机失败与 IPv4-only 主控的 IPv6 核验（源码未发布）

- Owner重新核对九项源码完成情况。确认TCP默认及更多设置展开、45地区补齐迁移、单月续费、地图wheel处理均已有对应实现；管理员资源池／原套餐创建入口、本机计划／域名复用／成功折叠也已接入，但不能仅凭存在代码宣布完整UI／流程完成。进一步发现管理员单删与节点批删仍按DB状态running才停机，遗漏error记录对应Running容器；现已补为原停机函数查询实际Incus状态后删除，权限／管理员不退款／批量退款选择和删除失败回退保持，新增共同守卫。单删／批删顺序、用户销毁、操作验证守卫通过，相关类型／构建与Lint按本轮记录核验。IPv6修复统一作为原九项第1项，复用本轮代码和实证，后续只补完整候选验收，不拆成重复修复；九项仍未声明整体完成。

- Owner随后要求补查Debian、Ubuntu、Rocky Linux、AlmaLinux、CentOS。矩阵扩大到18个OS／版本别名×容器／虚拟机×仅密码／公钥加密码，共72组；覆盖Alpine3.21/3.23/3.24 cloud及tinycloud、Debian10–13、Ubuntu20.04/22.04/24.04、Rocky8/9、Alma8/9、CentOS7/8-Stream/9-Stream的生成配置、实际SSH服务名和包管理路径。这些别名是兼容性测试输入，不声明所有旧版本仍提供可售或可下载镜像。
- 补查修正VM路径中「99后读优先」的错误假设：平台策略改为`00-incudal-force.conf`，旧平台99文件按原初始化脚本清理；CentOS7容器与VM改用yum；两个生成器插入Include前用独立stdin配置交给实际sshd解析，避免不支持该指令的版本启动失败。首个能力检测实现误用`sshd -o Include`，原生验证发现该选项即使在新sshd也不支持，已修成配置文件解析后复跑两类型的支持／不支持四分支通过。不会把首次失败计为通过。
- 交付核验补读ECDSA主机公钥，并只接受认证Incus内取得的Ed25519／ECDSA／RSA登记集合；此前只固定数组首项可能拒绝不同算法的合法协商。真实SSH协议守卫增加ECDSA/RSA服务端、登记集合匹配与错误身份在密码认证前拒绝，保留原密码及root命令核验，不信任未登记的公网密钥。
- 原生Linux统一OpenSSH解析器使用各组实际生成策略，72组均得到passwordauthentication/permitrootlogin/pubkeyauthentication=yes；生成setup脚本（含特殊字符的夹具密码）均通过sh -n。Include分支中，支持使用真实sshd，不支持使用返回失败的受控探测边界；它不等于在CentOS7原镜像内启动其旧sshd。首次大块测试输入造成失败诊断被巨型源码行淹没，保留失败，压缩重复夹具传输后完成复跑。独立临时目录全部清理，没有改运行中的SSH配置或客户盘。证据在忽略目录`os-ssh-matrix-native-result.json`及构造脚本／输入文件。
- 修复后的纯SSH核验模块通过stdin独立执行，现有Alpine3.21实例17及Debian13实例20的真实公网root原密码登录通过，原生产服务不被覆盖。Ubuntu/Rocky/Alma/CentOS各版本的真实镜像全新开通、VM开机仍未验收，不能把统一解析器或SSH2夹具当各发行版完整实机成功。最终相关类型、构建、密码／交付、创建失败补偿、实例重建及IPv6守卫继续按本轮结果记录；未提交、推送、发布或改生产。

- 后续owner报告实例21「立即销毁」退款描述错误且提交失败。真实用户GET destroy-info返回refundAmount=0/maxRefundable=0，账单为newPurchase11和创建失败自动退款-11；页面旧固定文案却承诺再次退款。后端日志两次均为`Instance is running`：数据库error状态使旧用户销毁helper跳过停机，真实容器仍Running，Incus拒绝删除。源码helper现无条件调用原stopInstance（该函数读取真实远端状态，Stopped时不发送停机），之后仍需确认deleteInstance及其自带的独占转发清理成功，再进入原退款／资源释放；失败回退、归属和任务冲突守卫保留。
- 用户页错误销毁流程先读取带feeWaiver=error的真实预览，canDestroy=false时不提交；零退款用独立简繁英文案「本次销毁不产生退款」，有退款时显示预览中的具体余额金额，成功响应refundAmount=0时不再显示「已退款0」。通用异常说明明确已退回余额不会重复退款。修改InstanceDetailView、原API getDestroyInfo及三语文案；增加前端顺序／零退款守卫与真实状态的Incus操作边界回归（Running、Stopped、Frozen）。用户销毁顺序、创建失败补偿、计费查询、前端路由／i18n守卫、双端类型、用户＋管理＋后端完整构建及dist边界通过；ESLint0 errors，详情页已有48项格式警告保持。
- 本地浏览器使用实际构建和真实用户只读接口验证banner与零退款确认；所有生产变更请求被本地服务拒绝，销毁POST仅本地模拟响应。曾在同一真实实例展示中注入4元对照金额，使owner误以为仍会重复退款，已明确更正并撤销；预览恢复为直接返回真实API的0元，没有再次扣费或退款。该对照验证不能作为生产销毁成功的证据。真实生产仍旧代码及原实例记录，完整源码销毁＋退款／库存事务的新包现场终态尚未验收；截图在忽略目录`logs/emergency-alpine-ssh-20261026/destroy-banner-fixed.png`。

- Owner要求先查根因并修复通用源码，防止后续安装者重复遇到问题；当前阶段不以修改客户记录、解除隔离或更新生产替代修复。接续中断对话的目标：主控兼网关保持IPv4-only，经IPv4 WireGuard管理宿主，宿主及客户实例的IPv6不以主控具备IPv6为前提。OWNER_REQUIREMENTS已同步该约束。
- 两台伦敦失败实例18/19使用Alpine3.24/cloud，首尔新增失败实例21使用Alpine3.23/cloud；实际容器均已启动，公网SSH能取得与固定Incus身份内读取相同的客机公钥。真实密码登录被拒绝，客机`sshd -T`均为`passwordauthentication no`。平台原生成器对Alpine设置`ssh_pwauth:false`，生成的`50-cloud-init.conf`先于平台`50-incus.conf`读取；OpenSSH先读值生效，主配置后追加yes不能覆盖。美国Alpine3.21实例17真实登录通过、韩国Debian13实例20交付成功，不能仅按地区判断失败。
- 修改`incus-config-container.ts`为所有已提供客户密码的容器设置`ssh_pwauth:true`，平台策略使用`00-incus.conf`先于cloud-init默认项；新建／按原流程重新初始化镜像共同使用该生成器，不改变现存客机磁盘、密码、主机公钥或业务记录。将原SSH核验函数独立到`lib/dedicated-ssh.ts`并保留原服务导出兼容；固定身份通过后才发送原客户密码，检查真实root登录。`dedicated-delivery.ts`保留原重试门槛，区分连接、身份、密码认证、密码登录关闭及验证命令失败，最终错误保留受控原因，不记录凭据或原始敏感输出。
- 伦敦1的IPv6等待为`IPV6_HOST_QUARANTINED`：此前实例18的换机任务7/8失败，原流程将源／目标置于持久保护，不能以云防火墙错误解释或直接解除。伦敦2及首尔分别为`IPV6_INSTANCE_NOT_READY`，等待此前失败实例交付；三台宿主实际公网IPv6均已通过固定管理身份发现。另美国与韩国正常运行实例的旧IPv6核验为通用`IPV6_DELIVERY_FAILED`；主控实际没有公网IPv6或默认路由，旧代码从主控探测因不可达误判。延续工作区已有的`dedicated-ipv6-probe.ts`／IPv4-only主控核验候选，不启用主控IPv6、不跳过身份或源地址核对。
- 本次新增真实SSH协议回归通过：正常root登录、密码拒绝、错误身份在认证之前拒绝、非root、命令失败和连接不可达；覆盖Alpine3.21/3.23/3.24 cloud及tinycloud、Debian、Ubuntu的生成策略。原生OpenSSH独立临时配置实测旧排序为no，新排序及新cloud-init设置为yes，未改运行中SSH配置。修复诊断模块经stdin在现场独立进程验证实例17成功、18/19/21均为认证拒绝且实际密码认证关闭，未覆盖线上程序。
- IPv4-only主控通过已认证Incus检查美国实例17、韩国实例20：客机固定身份的真实SSH密钥交换、绑定其内部源地址的IPv6 HTTPS出站回显均通过，公网源与登记地址相同。两台客机另经各自公网IPv6互测TCP22完整密钥交换，双向通过且公钥匹配目标Incus身份；这项覆盖该两地址的真实公网入站，不代表伦敦失败客机尚未完成的IPv6配置、全部端口或所有宿主验收。
- 最终server type-check、server build、相关文件ESLint和`git diff --check`通过；dedicated-delivery、instance-create-failure-compensation、instance-recreate-consistency、host-public-ipv6守卫通过。早先验证命令`pnpm test -- --only`被本机pnpm当作自身选项拒绝，改用根`node scripts/run-tests.mjs --only ...`逐项执行，未把未运行命令算通过。新增SSH测试最初CJS命名导入及数据库副作用导致失败／进程不退出，已改默认导入并仅依赖纯SSH核验模块；最终测试正常退出0，无需生产DB。脱敏现场证据在忽略目录`logs/emergency-alpine-ssh-20261026/evidence.json`。
- 当前现场仍为正式v1.7.5，唯一`incudal-backend`PID869991/NRestarts0，health正常；未修改生产代码、DB、客户记录或隔离，未OTA、提交、推送或发布。本次是源码、真实SSH及网络分项验证；修复后的完整发行包全新安装／新购买／换机终态尚未验收，不声明现有故障已经恢复。先前九项候选的其它工作区改动保留，完整灾备与P0–P6验收边界保持。

## 2026-10-26 v1.7.5 正式发行：全球地图首页与手机球体

- Owner明确授权推送和发版本。源码`eb82a4fecb5865ea550e0d36c6aefb1e249fb061`已推送main，正式tag v1.7.5绑定同一提交；[源码CI40228993793](https://github.com/mastalee928/payincus/actions/runs/40228993793)全部success。[发行预览40228994828](https://github.com/mastalee928/payincus/actions/runs/40228994828)AMD64/ARM64双构建和双首装全部success，Release预期skipped；干净检出的180项全量测试180/180通过。
- [正式流程40229999359](https://github.com/mastalee928/payincus/actions/runs/40229999359)双构建、双首装和Release全部success。[v1.7.5公开Release](https://github.com/mastalee928/payincus/releases/tag/v1.7.5)已发布，非draft、非prerelease，面板latest为v1.7.5。现有Agent代码未改，正式agent-v1.0.3双架构资产保留，不另发Agent或改变其latest规则。
- 实际下载公开AMD64包SHA256为`c119eb60499c7f586a35f8765e1a0833fba9ba0d07fb51106a6601d6e6f12109`，ARM64为`8d718b73c134488404958ce901353b965df92c8b8ecf915e4ca08d91b40f7942`，与各自sha256文件、OTA manifest的SHA/尺寸及GitHub资产digest一致；两份OTA清单逐字节相同，源码身份为eb82a4fecb58。正式包与预览SHA分开，预览AMD64为`0c0909583be2e1ded36e32040ea46c0d12e4fc70c49cba4c2723875235ff71cf`，ARM64为`b496ceeb069abe2bb35db4b6f73cd9c354579d37b37f986fab3ea3602cf0ecdd`。
- 两个公开包内四份组件清单按独立固定公钥验签，版本1.7.5、完整源码身份、每份20项实际内容/SHA/大小/模式及ELF架构通过；归档root所有，原BSD许可证、双端页面和地图资源与源码一致。Windows归档检查证明内容、身份及记录模式；原生权限/服务/安装证据来自同提交的双架构首装，不能替代生产实证。
- 新首页已接入原PortalView：桌面宽幅矢量地图，手机默认可旋转球体，原项目三语菜单共用；真实品牌/库存/地区编号及原purchase/login/help/dashboard路径保留。正式首页不显示预览、刷新、调试时间、固定演示站链接或动态开关，动效自动跟随系统辅助功能。实际预览包的三语、球体/首卡/选购与登录路由、菜单焦点，以及公开AMD64包的桌面/默认手机/控件移除再次通过Chrome检查；旋转、双指、候选映射与防误触、平滑定位、系统减少动态切换已分别实测。结果在忽略目录`logs/ui-release-v1.7.5/`。
- 本地全量首次179/180，唯一失败为新静态海岸线fetch未登记；审核并只登记发行包内同源JSON的精确请求后该守卫补跑通过，API边界未放宽。随后同提交预览全量180/180通过。最终相关类型、路由/i18n、Lint、双端构建和dist边界通过；全站Lint仍为既有警告、0 errors。无关Go测试和技能安装改动保持未提交。
- 使用方式：原后台「系统更新」选择v1.7.5，新首页自动启用，手机球体无需额外参数；品牌与外观继续读取原后台配置。本次未执行生产OTA、DNS切换或DD，不声明现有生产主控已部署新首页。A整机失联/公网DNS、完整原子OTA、P0–P6/四拓扑/唯一写者/72小时仍按原证据门槛保留。

## 2026-10-26 首页留白 Demo（此前本地阶段）

- Owner随后明确授权推送和正式发版，候选v1.7.5已将确认版接入原PortalView与原用户路由，独立Demo保留。首页独立页头/页脚只渲染一次，品牌/库存读取原公开接口，购买传真实地区编号，登录/控制台仍按既有身份状态进入原路径。正式页面隐藏预览、刷新及更新时间，移除固定测试站链接；按发版前反馈，正式版和Demo都不再显示动态开关，自动跟随系统减少动态设置且保留球体交互。此前仅本地限制由owner本次授权取代，当前尚未发布或部署生产。
- 正式双端构建、三语/默认球体/真实地区进入purchase及登录路由浏览器检查已通过；本地全量180项执行为179通过、1项静态资源网络守卫拦截。已审核球体读取的发行包内同源海岸线JSON，并仅登记其精确fetch行，API请求规则保持；该守卫补跑通过后才推送。最终去动态按钮的用户构建、类型、路由/i18n与dist边界另已通过，系统减少动态默认/实时切换和正常1.5秒呼吸/650ms定位实测通过。CI与同提交双架构预览待推送后核验，不提前标记正式包门槛完成。Agent运行程序未改，继续使用已有正式agent-v1.0.3双架构资产；两个无关Go测试和技能安装改动留在工作区，不纳入首页候选。

- 本次接手补齐最新导航「产品 / 解决方案 / 控制台」及 Products / Solutions / Console，目标 `/purchase`、`/help`、`/dashboard`。Owner明确纠正语言控件必须沿用本项目实现：已从PublicSiteHeader提取共享PublicLanguageSwitch，保留原菜单及本地保存/Esc/外部点击/焦点行为；正式页头只替换该控件引用，鉴权与路由逻辑未改。补齐Demo简繁英标题、大洲、库存、地区与球体反馈，新增守卫防止繁体误回退英文。
- Owner在当前对话明确手机端默认球体：本地首页无需参数即可显示原矢量球体，桌面仍保持原宽幅地图；`?mobile=map`保留原手机平面对比入口。320px英文标签换行造成首卡末端超首屏已实测发现并用标签行高/内边距修正，仍保持44px热区与球体尺寸。当前结果覆盖此前「默认手机仍平面」阶段结论。
- 本地Chrome导航/三语/持久化/键盘/焦点/320与390默认球体/真实地区3进入purchase验证通过；球体12项实际回归含拖转、双指、候选映射、防误触、平滑旋转/微放大、滚动、默认球体与显式平面回退、桌面92vw保持通过。最终前端类型与路由/i18n守卫通过，修改文件ESLint与独立Demo构建通过；最终用户端与管理端构建分别退出0（`nav-user-build-complete.log` / `nav-admin-build-complete.log`，修改前后源码均保留），产物边界守卫在构建后单独运行通过。1440/768/390检查0 FAIL/0 WARN，最终截图已看；数据与来源不变。
- 原源码/可运行包、原正式页头及手机标签调整前独立回退点记录在HOMEPAGE_DEMO.md。此前Windows沙箱的tsx用户信息读取、预览代理EACCES、CDP连接，以及自动审批短期503均为本地检查环境阻碍；经正常审批和仅本地预览重启后复验，不关闭鉴权/网络安全或绕过生产就绪检查。没有提交/推送/发布/生产OTA，未替换正式首页；首要灾备及四拓扑/72小时仍未完成。

- 后续增加手机独立矢量球体试稿，路径`mobile-globe.html`展示390px交互框，`?mobile=globe`为直接页面；默认手机版/桌面保留现有地图。真实海岸线与点位用同一D3 Geo正交投影，背面不渲染，球体容器46svh，拖转/双指缩放、标签转向及地区卡联动通过Chrome检查。地图源SVG/坐标未改，原有版本及依赖清单已另存。
- 最新精修显示全部六个大洲标签、移除手势说明；中文purchase标题与导航为「创建实例」，对应繁体/英文保持一致。候选项悬停/按住圈亮，确认后650ms旋转及微放大、卡片同步；内部滚动区域132px且标题在外。兼容点击误选已发现并修复，只有另一次按下才确认地区。D3 Geo及GeographicLib完整许可证、数据来源署名已保留。
- 精修Chrome11项回归、类型/修改文件ESLint、前端路由/i18n守卫、双端构建及独立构建通过；1440/768/390截图已检查，显式沿用owner设计的检查范围0 FAIL/0 WARN。320px卡片略超首屏的失败保留并修正为对应窄屏字号/间距；未改变商品、价格或交付流程，仍未部署正式首页。

- Owner确认上方地球，要求只调整下方、保留原作品且可回滚。当前Demo采用minimal展示模式，关闭完整配置表与三步说明；地区选中只显示地区/状态/入口，真实数字地区编号进入现有purchase配置页。品牌和联系信息来自公开系统配置，不捏造库存、价格或延迟。
- 修改前完整保存旧版源码、逐文件SHA256及可运行独立构建包；旧目录版默认展示模式仍保留。地球SVG、坐标JSON及两个组件原有scoped CSS哈希与备份一致。回退脚本已只读检查三项目标与目录边界，未执行回滚；发现后续文件变化时停止，不覆盖其它工作区内容或owner要求。路径与使用边界见[首页Demo说明](HOMEPAGE_DEMO.md)。
- Client类型检查、修改文件ESLint、前端路由/i18n守卫、双端生产构建及独立Demo构建通过。真实Chrome十项交互通过：地区深链、数字地区进入原选购、未上架阻止购买、全域入口、手机触摸、原按钮/双指缩放、暂停、320px窄屏和读失败重试。1440/768/390看图完成；检查器0 FAIL、1个全幅地图控件边距提醒，页脚实际边距一致，保留owner认可地球。
- 本轮没有提交、推送、发版或替换正式首页；完整单机OSS灾备及P0–P6的未验收状态保留。独立Demo仍沿用已有全局样式/三语资源，构建的体积提示不隐瞒。

## 2026-10-25 v1.7.4 正式发行

- 正式标签v1.7.4绑定a208d480af47c2231a1da54cf4c6308833ed8b7d。[正式流程40204464333](https://github.com/mastalee928/payincus/actions/runs/40204464333)双构建、双首装、Release全部success；[公开正式版](https://github.com/mastalee928/payincus/releases/tag/v1.7.4)于15:05:58 UTC发布，非draft、非prerelease。同提交CI40201711740及预览40201711815全部通过。
- 独立下载公开包：AMD64 SHA256 93f63d02825773e17eea58b159e03619e784e8f7bb6f1edcbb0e5bd025197021（211285098字节）；ARM64 8faf13cde73bc8222d79252fb7d94f6a0420ec696e7ed8eb5569689d7d0a7925（210486196字节）。两份OTA清单一致，版本/源码/架构/尺寸/URL与实际内容及SHA文件全部匹配；root归档成员、双端、原BSD许可证与源码身份核验通过。四份组件清单按此前独立固定公钥验签，20项内容/尺寸/模式与ELF架构均正确。
- 完整AMD64预览从v1.7.3安装器升级、正常管理员登录及中文组合查询、自然五分钟持久巡检、完整DB/支付/双端/API/WS/Agent/日志暴露检查已通过，原五客户和管理身份保持；具体预览证据见下节。公开正式包OTA任务6已从完整预览主控受理，正在真实更新；不得用预览证据代替该终态。原生产主控仍v1.7.3，agent没有自动生产OTA。
- 公开正式包OTA任务6已成功：15:09:26→15:19:00 UTC完成preview-a208d48→v1.7.4，实际下载SHA与公开AMD64资产一致、真实Prisma主入口/全部DB支付/双端/API/WS/Agent及日志/头部暴露检查通过，systemd最终success/inactive。原五身份文件、JWT/加密/DB配置保持，十个程序与已核验的a208包一致，唯一后端PID281630/NRestarts0；客户五台UUID/Running/PID保持。属于完整公开包平铺OTA，不冒充v1.7.2跨版本或原子布局。
- 正式OTA结束后还原B测试网站的四个原URL、移除测试域名hosts条目，归档本机短期TLS配置及OTA进程CA drop-in；原JWT/加密/DB及管理身份保持，Nginx语法与重新加载通过，唯一后端PID284166/NRestarts0和健康正常。重启观察超时后只读核验已完成，没有重复执行。检查内存余量后停用并移除临时1GB交换文件，实际Swap=0；随后健康、实际管理员登录与中文续费成功查询200，原客户再次保持。测试证书/配置归档保留在root私有目录，不作72小时基础；无Swap的普通运行复验不等同于无Swap完成OTA。
- 升级后在「计费管理→概览→到期实例巡检→日志查询」按时间、用户名、邮箱、中文描述词搜索；正常/空轮次均留记录，最近90天、每页20条。未接入新宿主DD后普通重试重新核验当前身份，继续root密码；已有管理绑定和客户身份保持。网关仍在「机器池→管理网关」直接检查本机和确认，不填主控SSH；外部独立/备用入口保留。

完整原子OTA、公网DNS/A整机失联（owner按约定上线后实测）、P0–P6/四拓扑/唯一写者/72小时仍未完成。

## 2026-10-25 v1.7.4 同提交预览与发行门槛

- 最终源码a208d480af47c2231a1da54cf4c6308833ed8b7d已推送。[源码CI40201711740](https://github.com/mastalee928/payincus/actions/runs/40201711740)全success；[发行预览40201711815](https://github.com/mastalee928/payincus/actions/runs/40201711815)双构建/双首装全success，Release预期skipped。
- 实际预览AMD64 SHA256 1b85ac49a8b29a0cffd889e8280c10d8fab7649307da7806cb4854531ccb6e41，ARM64 93775854574f04b46c38a7309820eddc6936f872ec31d350a4fbadbdcc6d408f。归档成员root所有、根/后端版本1.7.4、双端页面、完整源码身份与BSD许可证一致；Windows工作树CRLF仅作行尾归一后比对许可证正文。两个包内四份组件清单使用此前独立登记的公钥验签，实际20项文件/大小/模式及ELF架构匹配。原生Linux同包双组件验签和权限检查通过。
- 第一次大包传输观察超时导致不完整归档，未安装；独立传输完整文件并按本地/远端同一SHA校验后才解包。完整AMD64预览通过原安装器在隔离B完成v1.7.3→preview-a208d48升级，退出0、217迁移无待执行。原五个身份文件与JWT/加密/DB配置保持，十个修改程序与实际包逐字节一致，唯一后端PID276000/NRestarts0。没有源码覆盖；这项是安装器升级，最终工作者的同版本完整OTA证据另见前节。
- 完整包实际管理员登录与时间/用户名/邮箱/中文「续费成功」组合查询200且匹配原英文续费；自然14:50和14:55 UTC五分钟巡检的开始/完成持久记录及状态读回通过。完整DB/支付配置、双端静态/API/WS、Agent清单和日志/头部曝光检查均退出0，没有RUN_DB_CHECKS=0。客户五台UUID/Running/PID保持；新包仍使用仅本机受约束短期TLS夹具和临时1GB交换空间，不计真实公网HTTPS/失联灾备。
- 已按既有正式发行授权将v1.7.4 tag绑定a208d48并推送，[正式流程40204464333](https://github.com/mastalee928/payincus/actions/runs/40204464333)进行中；正式公开资产、公开包OTA与目标部署将分别补证据，不将预览SHA当正式包SHA。生产主控当前v1.7.3，agent未自动生产OTA。完整原子OTA、公网DNS/A整机失联（owner按约定上线后实测）、P0–P6/四拓扑/唯一写者/72小时仍按各自门槛保留。

## 2026-10-25 线上新宿主 DD 后重试身份修复

- Owner报告新OCI宿主接入失败后从Ubuntu DD为Alpine，反复填写正确root密码仍报SSH_HOST_KEY_CHANGED。只读核验线上主控实际已由owner升级为正式v1.7.3/9b4110d，唯一后端PID741091/NRestarts0；不沿用旧台账的v1.7.2部署结论。
- 失败任务停在checking，未建立管理地址/peer或宿主记录；原Ubuntu指纹与当前三种SSH主机公钥均不符。线上相同SSH库复核协商结果与独立公钥扫描一致，确实在密码认证之前被旧身份拒绝。Owner明确确认先对接Ubuntu、失败后DD为Alpine，并只使用root密码、不填写指纹；按该明确重装事实，固定新Alpine公钥后实际root认证成功，系统/公钥/未绑定状态核验通过。
- 仅对该未接入任务按旧指纹/状态/updatedAt及空host/management/peer条件更新，原身份处理写入审计，密码只经SSH stdin和加密存储，不进入argv/代码库/日志。重新排队后第7次任务于13:32:00 UTC成功，宿主16，SSH/Incus/Agent核验通过；没有重启或OTA生产主控。修复调用观察因导入计时器未退出而超时，随后先只读核对成功结果，没有重复执行修复。
- Owner要求普通重试直接读取新系统身份，不再拿旧身份重试、不增加指纹输入/额外确认。候选对未建立host/management/peer的失败或取消前置任务，普通重试事务内清理旧SSH指纹和旧资源探测、记录旧指纹审计；绑定状态/指纹/updatedAt防止并发覆盖。已有管理身份继续保留，现场无需手工SSH操作。另将身份记录读取失败与真实公钥不同分别报告。真实SSH夹具已验证正确密码/错误密码/真实指纹不符/存储异常与任务中断；相关类型/守卫/构建及独立PG路由效果继续验证，本修正尚未部署生产。

普通重试修正追加验证已通过：独立空schema模板的本地PostgreSQL *_pool_test库、真实Fastify路由、普通密码重试清旧Ubuntu身份和旧探测、保留原指纹审计、拒绝用户/额外指纹参数、保留已登记管理身份和重复队列保护；原UTC/非UTC租约回归保持。没有启动第二个业务后端，也没有外部SSH/通知。相关类型、SSH/机器池/路由/i18n守卫和双端构建通过；lib中已有控制字符校验正则的Lint禁项仅在检查命令中解释为预期校验，未改安全正则。

## 2026-10-25 v1.7.4 候选：巡检历史与完整 OTA 排障

- Owner追加要求已保存到OWNER_REQUIREMENTS：每五分钟巡检的持久记录、时间/用户名/邮箱/中文描述关键词组合查询，以及正在进行的OTA修复一并交付。新增历史API仅管理员可读，使用现有PostgreSQL日志表，无迁移，最近90天、每页20条且最大50条；每轮开始及完成均记录，包含空轮次。最近状态支持重启后读取，缺少完成记录明确显示中断；自动续费失败计入巡检失败，宿主停机未核验保留待核验结果，扣费/删除条件保持。
- 独立真实PostgreSQL仅复制schema并建立4名夹具用户与1000条日志。时间/用户名/邮箱/简繁体成功失败与续费成功、余额不足、分页、90天边界、异常摘要不返回秘密、空轮次两条记录、新进程读取历史均通过。最初测试脚本因导入调度器的计时器未退出，修成一次性明确退出后重跑成功；初次超时不计通过。Windows源码180/180全量通过，后续OTA停止后端/直接CLI及手机筛选改动已补相关类型、守卫、Lint和双端构建，最终CI/发行包结果另记。
- 界面入口为「计费管理→概览→到期实例巡检」，运行状态与日志查询分开；关键词、筛选、持续错误、空结果、详情、定宽表/手机卡片均可用。手机时间/用户/邮箱条件可展开，默认直接显示关键词和结果。浅深1440/768/390实际截图已检查；状态页检查器0 FAIL/1 WARN（短状态页下方空白），不将空白强行填充成虚假数据。分页及最终截图另补证据；预览夹具与客户真实日志分别记录。
- 隔离B任务1复现24秒未认领就误报失败，可信文件校验实际仍运行；修正为仅观察确实停止的unit并条件更新，避免覆盖刚认领的running。任务2正常pending→认领后，完整包已自带依赖却强制pnpm重装，网络ECONNRESET超时且子进程未立即静默，自动回滚又被systemd总截止打断。保留原备份与现场，按原可信清单校验后人工恢复；第一次人工恢复遗漏缓存目录引起EACCES，补齐后唯一后端恢复。该任务记录明确人工恢复，不计自动回滚通过。
- 任务3使用候选worker下载并验签公开v1.7.3 AMD64包，成功应用、保存迁移前数据库，随后Prisma迁移报P1001。期间隔离机出现内存压力、后台仍读取正在替换的平铺程序树并重启；失败现场复制包含下载/解压缓存，拖长回滚。12:51:33 UTC自动代码回滚和双端/API/WS验证完成，保留数据库备份，数据库不自动倒退；唯一后端健康恢复，五台客户UUID/Running/PID保持。此项是失败后的自动代码回滚实证，不是升级成功，也不能仅凭P1001断言数据库配置错。迁移后警告表示曾尝试迁移，不能据此声称实际迁移已提交；217项原迁移状态随后只读检查无待执行。
- 候选完整包模式验证依赖/生成Client解析路径均位于包内，取消重装依赖及重新生成Client；使用独立新进程直接运行受信包内Prisma CLI，保留迁移前备份和全部DB/支付就绪检查。子进程超时按进程组TERM/KILL并等待停止，无法静默则阻止回滚/清理；替换旧程序树或切current前暂停唯一后端，客户/宿主服务不停止。备份位置立即落库，失败现场排除下载/cache并保留原身份、程序及日志。原生Linux公开完整包依赖与父子进程超时停止再验证通过。
- 任务4已从修正候选经真实管理员API受理并于13:00:47 UTC认领，目标公开v1.7.3，正在验证正常完整OTA。此项为同版本预览→正式重装，不是v1.7.2→v1.7.4跨版本或原子current/releases验证。当前正式版仍v1.7.3，未发v1.7.4、未升级原生产主控、未改正式DNS。B的HTTPS仅限本机受约束短期CA与独立测试域名，未关闭TLS或跳过DB检查，不算真实公网HTTPS/灾备。

- 独立PG浏览器追加实测：905条有效范围记录的1→2→1页、用户名/邮箱/续费失败组合搜索83条5页、手机展开/收起筛选与键盘收起巡检详情通过；摘要无法读取明确提示核对该时间实例日志，原始异常内容不显示。最终双端构建、产物边界/路由/i18n及文档站构建通过。预览代理旧会话引用导致一次401跳转，修正仅本地代理状态引用后复验正常，未修改产品鉴权；截图里的inspection_qa用户来自独立PG，不是客户数据。预览旧CSS缺新增xl四列跨度，核对正式构建含该规则后同步预览CSS重新截图，不冒充正式后台布局。
- 任务4核对发现Prisma CLI只在主模块入口执行，候选用require加载时空跑；不能把退出0当迁移实证。已改成独立解析受信CLI路径后以Node主入口启动，守卫的夹具也按require.main===module执行，能复现该遗漏。正在独立空PG库验证217项迁移真正应用；最终worker完整OTA结果另记，不使用这一次未正确调用的步骤作为迁移验收。
- 隔离机1GB内存，任务4冷启动时额外空库迁移演练争用CPU/内存；已停止只读分页服务并降低演练优先级，后续完整OTA单独运行。更新与手工回滚的健康等待统一为有界180秒，仍须真实健康/全部就绪检查；不把并行演练引起的启动压力混写为纯单独OTA性能实证。

首要A整机失联/公网DNS切换由owner按既有约定上线后实测；完整P0–P6、四拓扑、唯一写者和72小时仍未完成。

候选已推送2c9716061c693d96a0127e385e769e4639e0f6b9，源码CI40196821065与双架构预览40196836648进行中。独立空PostgreSQL使用实际公开v1.7.3包和最终直接CLI函数，真实应用217项迁移、生成131张表并核验instances/logs，通过；不再使用require空跑的步骤作为证据。隔离1GB机器增加临时1GB交换空间后完成该演练，未修改生产或fstab；原五台客户UUID/Running/PID仍保持。任务4因先前并行负载中的冷启动健康超时进入自动回滚，最终源码的正常完整OTA仍需单独复验。

2c97160的源码CI40196821065与双架构预览40196836648已全success（预览Release预期skipped）。任务4自动代码回滚于13:23:57 UTC完成、唯一后端健康恢复；没有把require空跑当迁移验收。最终正确主入口工作者单独执行任务5，13:45:00→13:54:13 UTC成功完成公开v1.7.3完整包OTA，实际Prisma CLI显示217迁移、无待执行，完整DB/支付/双端静态/API/WS/Agent清单与日志/头部曝光检查全部通过；没有强制依赖重装或RUN_DB_CHECKS=0。五个原身份文件及JWT/加密/DB配置保持，唯一后端PID267596/NRestarts0；四个临时URL与安全缺省false的预期修改单列。该证据是最终候选工作者→公开v1.7.3的同版本完整更新，使用1GB物理内存+临时1GB交换空间和仅本机受约束TLS，不冒充v1.7.2→v1.7.4、原子布局或公网灾备。线上未接入宿主重试修正及手机日志首屏收尾将并入新的v1.7.4提交，需新提交同一CI/预览后再发正式版。

原子目录专项发现root helper传入的是旧release的物理appDir，切换current后迁移/校验仍可能在旧目录运行，手工回滚也可能误在无脚本的安装根执行。候选共用活动目录解析，迁移及命令跟随当前受管releases目标，外部目录拒绝；原子布局没有完整包时拒绝Git源码回退。真实Linux目录/子进程验证旧→新CLI主入口→旧回滚目录、拒绝外部目标通过；这只证明目录与执行边界，完整原子OTA仍待单独验收。回滚警告改为「迁移曾尝试」并要求核对记录，避免把尝试误说成已提交迁移。最终手机日志标题与刷新同一行，筛选默认收起，无法解析的巡检摘要显示待核验而不是绿色成功。

## 2026-10-25 v1.7.3 正式发行

- 正式tag v1.7.3绑定9b4110dfb7e7b222b88a977892da7cc4dc32eb9a。[正式流程40179811833](https://github.com/mastalee928/payincus/actions/runs/40179811833)双构建、双首装及Release全部success；[公开Release](https://github.com/mastalee928/payincus/releases/tag/v1.7.3)于09:26:20 UTC发布，非draft、非prerelease。同提交源码CI40177609000与预览40177617003均success。
- 下载实际公开双架构包，SHA256、尺寸、OTA两份清单字节一致、版本/完整源码身份、原BSD许可证、双前端、双架构组件和无需SSH的新worker通过。正式AMD64 SHA256 d1fd3d247906da2be162526aea46d3648b3df862d350372f5f3c7dac3dd8f035；ARM64 75f72a9ed92bae1a73d599d5cbc67e42b9cc0199ff4da79bb40ff1eaafe74a12；这些值与预览分别记录。
- 用此前独立登记的发行公钥核验两个公开包内的四份组件清单：Ed25519签名、源码/版本/架构和每份20项实际文件SHA全部匹配，ELF架构正确。Windows资产检查只证明签名、内容与来源；root权限和原生服务证据来自同提交预览首装及实际Linux完整包流程，不混记。
- 使用方式：原后台“系统更新”选择v1.7.3；升级后“机器池→管理网关”直接检查本机并确认，主控兼网关无需SSH地址/密码。固定网关域名保存一次并自动同步已有宿主，容量4093，逐台错误和重试保留；独立/备用网关显示预留入口。本机配置实际成功截图位于维护者忽略目录local-only-package-success/browser-success.png。
- 原公网主控部署证据仍是v1.7.2，agent没有自动生产OTA、改正式DNS或DD。隔离主控已运行完整v1.7.3预览包并通过本机配置，原五台客户及管理身份保持。生产升级、真实公网DNS切换/A整机失联由owner按此前约定实测；原子OTA和完整P0–P6/四拓扑/72小时仍按各自门槛继续，首要目标未标整体完成。

## 2026-10-25 v1.7.3 同提交预览与完整包本机流程

- 本机无需SSH修正已提交推送9b4110dfb7e7b222b88a977892da7cc4dc32eb9a。[源码CI40177609000](https://github.com/mastalee928/payincus/actions/runs/40177609000)全success；[发行预览40177617003](https://github.com/mastalee928/payincus/actions/runs/40177617003)双构建/双首装全success，Release预期skipped。
- 下载实际双架构预览包，版本/源码/许可证/双前端及新worker一致。预览AMD64 SHA256 f1f611164b3140add16fa9b2e4cd87392a8b04895014b8e43c41b9bd42456536、ARM64 e0dc0dd05e7bbd562e75a0c80c1fe2acd0f1efe15024a37046b16c1c53cd2796。完整AMD64包传到隔离主控后哈希一致，使用此前独立登记的发行公钥验证包内两个架构的签名、20项文件内容和源码身份。
- 在实际隔离主控以完整包安装器完成v1.7.2→v1.7.3非原子布局升级，退出0，数据库备份和旧程序备份保留；没有用源码覆盖新worker。原WG配置、管理SSH/Incus私钥、平台控制私钥与身份及整个.env保持，217迁移无待执行，唯一后端正常。安装启动交叠时首轮独立控制登记核验拒绝，安装完成后原核验器成功；未放宽检查或重建身份，不把首轮拒绝记为成功。
- 完整包经网页执行本机计划与确认，任务1feca9bc-2a5c-46ba-b953-130a096b2d7a于09:13:51 UTC成功、容量4093、唯一后端MainPID224646/NRestarts0。五台客户UUID/Running/PID与原基线一致；再次核对密钥、WG、受保护环境和新worker字节通过。此项为安装器升级及本机流程，未记为原子OTA/真实公网灾备。
- 已授权正式tag v1.7.3绑定9b4110d并推送；正式发行流程40179811833已全success，公开资产见上节独立核验，不使用预览哈希冒充正式资产。公网DNS及A整机失联由owner上线后实测，完整首要目标及P0–P6仍保留未完成。

## 2026-10-25 本机主控兼网关无需 SSH 的修正与实测

- 最新已提交的63598325478ab368f18e4da15fe19c6ac68f230c：[源码CI40175370074](https://github.com/mastalee928/payincus/actions/runs/40175370074)全success；[发行预览40175370842](https://github.com/mastalee928/payincus/actions/runs/40175370842)双构建、双首装全success，Release预期skipped。此前588af59失败的DATABASE_URL占位问题已修复。此包仍为旧SSH两字段方案，不能将其当成本机无需SSH修正的发行证据。
- 按owner纠正，本机配置API只接收请求ID，schema2不携带SSH地址/密码；固定root执行器直接检查本机，复用已保存域名，未保存时自动发现公网IPv4。管理员会话、Origin、撤销、安全文件权限、恢复保护及计划绑定继续严格核验；状态变更/过期必须重新检查，拒绝向此本机接口追加远程执行参数。
- 原生测试主控经实际网页“检查本机并生成计划”→“确认配置网关”，任务93fb1a4c-d0b8-42ee-bec2-b5144837588e在08:35:45 UTC成功，容量4093，唯一后端MainPID213388/NRestarts0。准备阶段真实封存校验耗时约90秒，配置期间后台正常重启，页面等待后显示完成。五台原客户UUID/Running/PID逐项与此前基线一致，原管理私钥/WG peer及JWT、ENCRYPTION_KEY、数据库连接保持。网关环境字段与旧基线的预期修改单独核对，未将整.env/WG文件字节变化误判为身份变化。
- 宿主已安装的自动更新保持成功；网页无本机SSH输入，扩展网关及外部独立/备用入口经过键盘展开验证。浅/深1440、768、390尺寸检查0 FAIL/0 WARN并看图；深色首轮恰逢后台重启，留下读取失败截图，服务恢复后重新检查成功。隔离网络/本机hosts/DNS夹具仍不计真实公网灾备。
- 本轮源码180/180全量检查通过（logs/test-run-20261025-163109），双端生产构建、修改前端ESLint、文档站构建通过；worker两处已有空catch补解释后ESLint通过（仅注释，不改变行为）。同提交新发行证据仍待补齐，尚未打v1.7.3 tag。真实公网DNS及A整机失联由owner上线后实测，首要目标和完整P0–P6保持未完成；不改正式域名、不提前DD。

## 2026-10-25 owner 主控实际 OTA 失败、修复与 v1.7.3 候选

- 当前首要要求以 OWNER_REQUIREMENTS.md 为准：单机主控兼网关 A 整机完全失联，B 全新安装并从 OSS 恢复后宿主自动重连、客户保持正常。此完整新场景尚未验收；旧手工 SSH/逐台补装说明不再作为常规流程，正在替换为网页自动配置。当前正式版仍为 v1.7.2，新 UI 与 v1.7.3 尚未发布。
- 升级兼容修复已提交推送 e40f3acfd1d033eab7ac5bbfa7e24da8ab07d14b，[CI40169352906](https://github.com/mastalee928/payincus/actions/runs/40169352906)全部成功。此提交未发行新版本，不含尚在验收的网页配置执行器。
- 新网页配置仅填当前主控SSH地址和密码，系统先检查连接并生成绑定计划，再确认安装；端口自动读取、原地址不换、至少/20扩容，状态和结果持久保留，密码提交/卸载与worker完成后清除。当前网关状态单独真实核验；原本绑定到旧主控IP的本机SSH跳转复用固定域名，明确自定义bastion仍保留。
- 实际隔离主控验证错误密码返回SSH_AUTH_FAILED、计划过期和确认授权守卫，正确请求完整安装state=succeeded/hostCapacity=4093，唯一后端NRestarts=0；JWT/ENCRYPTION_KEY/数据库配置及原管理密钥/peer保持，五台客户UUID、Running、PID前后相同。真机发现并修复启动前置脚本误调用受限systemctl包装器、确认字段集合不一致；新增回归，相关类型/前端/i18n/授权守卫通过。
- 原生Linux网络命名空间验证/24→/20、4093容量、原密钥/peer/客户路由、幂等和故障回退；1000条实际文件地址保留分配通过（wg为测试边界）。真实PostgreSQL1000条持久DNS队列全部中断续接、最多四路并发、最终1001项安装回执通过（远端部署为测试边界）。实际WG/固定SSH指纹宿主补装经过网页排队/失败持久/重试成功；真实systemd+受限周期解析通过，测试宿主使用命名空间文件/网络映射与独立DNS夹具。旧手工测试解析进程、服务目录与resolver视图问题只在测试环境修正，未修改客户磁盘或真实公网DNS。
- Owner回复无独立公网DNS权限、上线后由自己做真实测试。Agent不切换当前正式gate.mv.ci记录、不注入原主控整机失联；完整首要场景和P0–P6保持未完成。源码/测试、发行预览、正式资产和目标主控部署继续分别记录。
- 最终候选源码全套180项实际逐条运行全部通过（logs/test-run-20261025-154044）；双端生产构建、产物边界、修改前端ESLint、文档站构建、Root原生安装/目录/控制器/域名/1000地址分配及真实内核网络扩容守卫全部通过。浅色/深色1440/768/390尺寸0 FAIL/0 WARN；root主控最终部署唯一后端MainPID198868/NRestarts0、实际网关/20及固定SSH跳转域名核验通过，五台客户保持。该源码检查不等于发行资产或真实公网灾备验收。
- 候选3327fc3已推送，源码CI40174478376在新原生网络测试的wg读取/tmp私钥时报fopen Permission denied；组件双架构及计费集成成功，Build因依赖失败跳过，未宣布CI全过。测试改在/etc/wireguard的独立0700目录存放0600临时私钥，保持系统工具的受限配置路径，不关权限、不跳过真实内核测试；授权Linux复跑通过，新的GitHub同提交验证另记录。
- Owner追加未来外部独立网关与备用/备份网关入口。新增独立展示组件，默认折叠，两个入口各有清晰的预留说明；不调用当前主控安装API，不显示假接管结果。要求和扩展契约已写入OWNER_REQUIREMENTS与实施规格。三语、双端类型/构建、路由守卫及实际展开/切换操作通过。
- 修复后的588af59源码CI40175082885已经通过原生WG网段测试，随后在直接调用新增守卫时缺少DATABASE_URL占位环境；改用根run-tests统一入口（该守卫注入操作边界、不会连接真实DB）。不使用生产数据库、不隐藏失败，新的同提交CI继续复验。

- Owner 从原后台执行任务11升级v1.7.2失败。正式ARM64资产SHA256正确、五个新迁移成功；实际失败为新版install-platform-backup.sh调用控制器安装器时，原root所有且空的控制器目录是0755而要求0700。此前双首装、非原子安装器升级与隔离OSS证据未覆盖该旧机状态，不能代替此次OTA。
- 第一次自动回滚还将数据库SQL备份副本复制到程序根，并把1230个pnpm相对软链接改为同一目标的绝对链接，导致后续封存门禁拒绝。比对原可信清单的23528个程序文件均一致；仅将与保留原备份哈希相同的SQL副本移回root私有区域，按原可信.links还原链接文本，解析目标保持相同，没有盲目重新seal、恢复旧数据库或清空业务数据。未认领的12/13任务明确失败，保留记录。
- 修复空目录后，任务14已通过安装器，但生产就绪检查拒绝旧.env遗漏的PAYMENT_CALLBACK_SKIP_IP_WHITELIST显式false。确认运行代码仅literal true绕过IP检查，补入false保持安全行为；现有供应商来源配置保留，签名/状态/金额/幂等检查继续。完整环境/数据库预检通过后，任务15经后台相同的封存systemd worker真正完成v1.7.1→v1.7.2（04:17:29→04:19:28 UTC），全量生产DB/公网/Agent manifest检查通过，没有RUN_DB_CHECKS=0。
- 原主控当前正式v1.7.2/8eb306e，唯一后端PID679544/NRestarts0与公网健康正常。升级后发现原组件缓存也为空0755，按同一空目录条件收紧为0700，通过已校验完整包的明确--initialize-release准备原平台控制身份，随后正常唯一后端加载；JWT、ENCRYPTION_KEY和数据库连接与本次升级前备份一致，未替换已有客户管理身份。DD及现存宿主逐台补装/最终OSS备份仍按操作说明执行。
- v1.7.3候选只修必要升级兼容：空root目录0755→0700（非空/可写/非root/软链接仍拒绝）；所有备份/部署cp保持verbatimSymlinks；自动与手工回滚共用恢复函数，不把迁移SQL/中断临时SQL复制进程序树；升级补齐遗漏安全false，生产检查也按运行代码解释缺省false而仍拒绝显式true，兼容已安装旧worker。
- 7项真实Linux目录回归、Linux实际回滚/删除原源目录后依赖仍有效及私有SQL保留、缺省环境的真实DB与公网全开校验通过；server类型/构建、修改文件ESLint、系统更新/分层配置/平台备份及安装器守卫通过。Windows缺少symlink权限的分支明确跳过，Linux真机补齐，不算Windows验证了链接。后续候选全套/双架构预览单独记录，当前正式发行仍v1.7.2；尚未发布1.7.3，也未把源代码修复冒充当前正式包内容。P0–P6持续目标保留。

## 2026-10-25 v1.7.2 正式发行与首要场景验收

- 最终源码8eb306e2aba2b39a3bf3746995ae3da51532e3c3的[CI40153761970](https://github.com/mastalee928/payincus/actions/runs/40153761970)和[预览40153762395](https://github.com/mastalee928/payincus/actions/runs/40153762395)成功：双构建、双首装success，预览Release预期skipped。最终AMD64/ARM64完整包均已安装运行，无编译覆盖；独立公钥下双组件验签与完整源码身份通过。预览包SHA256：AMD64 8d3591b27aaf3b2ff9751715ccc2e3a8f08cea6ee960d9df10b784d26a549688，ARM64 1cc5eb7107fbaf70b67c83e085a5b58a446fcd32f0a42d755fc01aa7bec09361，正式重建资产另核对，不复用这些值冒充。
- 真实OSS最终完整包backup20e42109-24f1-4512-ae02-7bf16ef96db9、preview ef9a916b-6327-4b08-816e-8286aab9d8d9、restore、核账与resume全部成功。五台running记录、原账147.25/补续账户0/新购账户10、实例8两笔renew和实例9一笔newPurchase精确保留；原控制/WG/管理SSH/TLS哈希、Bot及绑定保持，保护内SSH/Incus库存5/5匹配。resume实际72秒，验证90秒启动门禁；后端唯一PID165880/NRestarts0，health recoveryHeld=false。此次是同目标机完整恢复复验，独立跨机/新身份空库冷恢复已由c456完整包证明，不能混写。
- 最终8eb恢复后复用原成功买家/订单/实例9，固定受信客机公钥NAT SSH通过；原意向重试200，仍一台/一笔10元正常newPurchase账单与consume关联，余额10、原账147.25，未重复扣费或手工客机初始化。新建202及公钥首次初始化来自前一c456完整业务包实证；最终包复验保持交付行为，证据8eb306e-sale-verification-result.json。
- 原四台UUID/Running与969项持久内容/权限/链接保持，五台实际Running。仅u2的DHCP租约更新和02:00客机定时生成logrotate状态有差异，按实际路径/时间/日志轮转头单独审计，未改原基线或修客机数据。原Incus/WG/SSH身份哈希一致。公网同一严格客机公钥SSH跨完整更新/恢复持续90分钟以上，boot/init起点不变；使用仅向授权测试主控开放的透明命名空间转送，不计客户生产宿主部署。原公网后台PID500181/重启计数0、本机及公网health正常，专用宿主PID102787保持。
- 首轮最终备份已上传并回读，但嵌套测试前缀355字符追加安装/备份ID超过400的校验上限，保留返回OSS_RETENTION_FAILED；明确错误为OSS_PREFIX_INVALID。原归档保留；短独立前缀的新输入全部成功。未放宽校验，此配置长度边界留作后续修复，安装恢复说明推荐短前缀。
- Owner已确认完整OSS恢复后的「OSS完整恢复补续测试-CloudReady」TG到达，无需重绑；自然五分钟与重复巡检、正常补续、删除回执/库存、真实管理员入口、双架构旧平铺升级证据沿用此前分项。原子OTA尚未真机验收，不计为已通过。
- 已按旧聊天明确授权将正式标签v1.7.2指向最终8eb源码并推送；[正式发行40158029302](https://github.com/mastalee928/payincus/actions/runs/40158029302)全部成功：双构建、双首装、Release均success，公开[正式v1.7.2](https://github.com/mastalee928/payincus/releases/tag/v1.7.2)为非草稿/非预发行。两种公开包独立下载，SHA256与两份OTA清单、大小/URL/架构、8eb来源、许可证/双组件/双端页面通过；正式AMD64 SHA256 e5409358bb6e6ad1f9c8ddb491f346ffcc2dfce86c783e66a70793dd057980dc，ARM64 5644fbcd8a6949b6426a4b0f619b6a0b6bb31b668861849eef0bd23ba7d5757e。源码/测试、预览包、正式Release与原站部署分别记录；原站仍保持旧版本，未DD/OTA。
- 新增[DD与OSS恢复操作说明](docs/controller-dd-oss-recovery-v1.7.2.md)：原v1.7.1先升级、已有宿主补装固定域名、制作含新增身份的完整成功备份后才由owner DD；恢复保护内按外部凭证核账，最后解除。文档命令bash语法、相对链接、部署文档守卫、VitePress生产构建与测试清单179项分类检查通过，业务代码未新增变更。公网同一SSH观察持续6229秒（约104分钟）后主动结束，命名透明转送/INPUT规则已撤下，专用客户宿主PID102787保持。源升级夹具后端已停止、仅本轮drop-in归档、原nginx恢复，数据库/身份/客户实例保留。首要场景的软件发行与操作交付完成；owner原站升级/补装及DD按操作说明另行执行。完整P0–P6/AC01–AC34/四拓扑/切换切回/唯一写者/72小时仍保留，持续目标active。

## 可复用发版验证 skill

Owner 要求记录本轮双架构预览全通过的排障方法，新增 [payincus-release-validation](.agents/skills/payincus-release-validation/SKILL.md) 与按需故障参考。覆盖签名模式/来源、root 父目录、sudo 解析差异、preview 归档和迁移夹具权限；要求读取当前运行证据，不从旧成功运行推断新版本。quick_validate、UI YAML、相对引用与脱敏检查通过。该 skill 不扩大部署授权，不把首装预览 success 解释为完整 P0–P6 或正式上线完成。

## 2026-10-25 新完整包升级、自然补续 TG 与启动期限修复

- 当前 c4567c6 的源码CI及双架构预览40145644867均success，Release skipped。两种实际完整包SHA256与独立公钥下的双组件验签通过；AMD64/ARM64均用真实v1.7.1发行包作为非原子布局基线，通过现有安装器--upgrade至c4567c6/v1.7.2，13.37账目标记、原环境值和已有管理身份哈希保持，原数据库/环境/身份备份保留。这是非原子安装器升级，不记为原子OTA；ARM64隔离服务的旧演练覆盖、当前软链写路径及ProtectHome诊断均已保留，最终按实际服务命名空间与受信身份核验，不从安装器退出码推断运行包。
- 新完整ARM64包从独立PG采集四台运行实例、原账147.25、Bot/绑定和一致的续费时间夹具，备份5778a2d7-433e-4b82-b270-7f103bc0d189在真实OSS完成加密/额外副本/回读。源快照库停止且不由升级夹具提供；实际AMD64完整包预检/恢复、原控制/WG/SSH/TLS身份及目标环境/组件保持通过，证据 `c4567c6-full-restore-tg-result.json`。
- 解除保护的30轮一秒健康门禁在低配置目标正常启动超过30秒时失败，产品正确恢复保护。最小修复将健康等待改为90秒实际截止时间，仍要求同一127.0.0.1:3001后端HTTP成功且保护状态完全匹配；45秒就绪和错误状态90秒拒绝回归、备份/安全守卫、server类型与构建通过。两编译模块覆盖实证resume成功；该新修复尚需进入完整候选包，旧包首次失败仍保留。
- 恢复后自然五分钟巡检将受控测试余额10.00→0.00，实例8正常续费账单1→2且仍Running，原Go Agent在B重新心跳。Owner确认已收到「OSS完整恢复补续测试-CloudReady」的新TG消息；Bot/绑定从整库恢复，无需重绑，没有操作原Webhook。配置独立测试机的合法双端源后，真实管理员登录、启动/立即巡检202及重复执行无再次扣费、失败数0通过；此前空管理源导致403为权限守卫正确拒绝。
- 专用宿主公网NAT经固定客机公钥和原客户公钥真实SSH成功，同一公网会话持续观察boot/init不变；仅使用对已授权测试主控开放的透明命名空间转送，保留原防火墙规则，非客户宿主部署。四台原UUID/状态和969项持久路径保持，运行态DHCP租约单独记录。原公网后台PID500181/重启计数0与健康持续正常。
- 新销售首试在预占前因剩余CPU98%不足原100%套餐正确拒绝，未创建实例或扣款；复用已充值测试买家，另建50%测试套餐，保留既有套餐、宿主上限及原实例，继续实际交付。最终完整健康修复包、新销售/连接联合与正式发行仍待收尾；不提前DD或宣称完整P0–P6完成。

## 2026-10-25 跨发行系统 OSS 完整性修复与保护内管理重连

- 完整候选 ef08d03 的真实 Debian ARM64 源库→Ubuntu AMD64 空库预检拒绝 OSS_DATABASE_INTEGRITY_MISMATCH。两端均PostgreSQL16.15；实际schema-only SQL除随机restrict标记及两个pg_dump版本/发行系统头部注释外逐字相同。原错误预检保持失败，没有执行正式恢复或放宽数据校验。
- 最小修复从已认证database.dump的pg_restore清单读取原工具版本，只映射pg_dump固定前导的两条版本注释；原schemaSha256/旧备份格式不变。表行多重集、序列、large object、SQL/函数体及locale继续严格核验；异常版本、非前导伪造及SQL变动回归拒绝。平台备份守卫、安全配置、server类型与构建通过；正确ESLint配置下已有两项诊断与HEAD一致，无新增诊断，不宣称全仓lint通过。
- 在已授权替代主控以ef08d03完整包加两个明确记录的编译模块覆盖，实际产品OSS预检/恢复成功；原Wg/SSH/TLS/控制签名身份哈希恢复，新主控环境/数据库连接/组件保持。Bot配置及用户绑定由整库恢复取得、无需重绑；原账147.25、客户余额0.00、实例8一笔续费以及四台运行实例完整保留，保护保持。证据 `v172-overlay-cold-restore-result.json`；修复后的新完整发行包仍需复验。
- 四台专用客户实例UUID/Running与管理身份保持；969个持久路径项内容/权限/链接相同，唯一变化为正常运行更新的var/lib/dhcpcd/eth0.lease，单独记为运行态，未篡改使测试通过。固定DNS守护进程自动指向替代主控；原防火墙REJECT管理UDP，保留原规则并仅新增专用宿主/恢复端口的命名测试放行，实际握手/管理ping及保护内产品SSH+Incus探测成功，实际库存4/4无缺漏。
- 新客户经真实NAT代理、公钥/固定客机主机公钥维持同一SSH会话跨越冷恢复，boot/init起点不变；此观察来自专用宿主命名空间，并非公网客户跨地域持续连接证明。Owner原公网后台未重启。完整新包冷恢复/通知/双架构升级及正式发行继续；首装修复f9ae856的源码CI与双架构预览40143575619成功，不能替代本次数据库修复新候选。

## 2026-10-25 严格权限首装修复与带 TG 配置的真实 OSS 快照

- 在已授权 AMD64 替代测试主控运行 ef08d03/v1.7.2 完整包安装器，umask077 导致 PostgreSQL 公开验签钥匙为0600，_apt 不可读，APT 报 NO_PUBKEY。原公开钥匙指纹保持，设置0644后实际 apt-get update 验签通过；安装器完成、空库唯一后端与健康正常。源码仅显式设置该公开钥匙0644，运行环境和私钥权限保持。
- 增加安装器隔离回归：严格umask下执行实际 PostgreSQL 安装函数，APT入口检查钥匙权限；Windows Git Bash及真实ARM64 Linux安装守卫通过，split-deploy-config、system-update-guards、server type-check、diff检查通过。pnpm直接调用bash在Windows PATH缺失的首次失败保留，随后用已有Git Bash执行通过；不把失败算作成功。
- 两种实际 ef08d03 完整包SHA256/源码身份与独立固定发行公钥下的双组件验签通过。ARM64独立源库包含四台运行实例、原账147.25、客户余额0.00、此前一笔10.00续费及Bot/绑定；完整产品备份执行器在新测试前缀完成真实OSS加密归档、额外副本与回读，结果 `v172-source-backup-result.json`，备份ID ad4e41cb-22d2-4fb5-a49e-d84c7a998fe1。原源库和身份保留，随后仅停止源测试PG，原源后端保持停止。
- 四台实际客户实例UUID/运行状态以及etc/root/home/srv/var/www/var/lib完整文件内容、权限和链接已留基线；新增客户经过真实NAT代理、公钥和固定客机SSH公钥维持同一SSH连接，客机boot/init起点保持。完整包B冷恢复、前后文件校验、管理DNS重连与双架构升级仍须收尾；正式仍v1.7.1。该源码修复尚未进入新安装包，不将旧候选首装记作新源码包验证。

## 2026-10-25 对话续接与恢复补续 TG 到达确认

- Owner 确认已收到实例名含「恢复补续测试-CloudReady」的续费成功 TG 消息，补齐此前 API 接受后仍待收件人确认的真实到达证据。维护者忽略目录 `tg-renew-result.json` 记录实际调度补续 10.00 元、余额 10.00→0.00、一条正常续费账单；重复巡检没有再次扣款或发送。仅向 owner 已授权绑定投递，未改原站点数据库或 Webhook。
- 配置和绑定在已真实 OSS 恢复的独立测试库中补入，不能据此宣称 Bot 配置/用户绑定已随完整 OSS 冷恢复验证；该门槛继续保留。2026-10-25 重新读取 ef08d03/v1.7.2 的源码 CI 40093230737、完整预览 40093232351：双架构构建/首装均 success，Release skipped，正式发行仍 v1.7.1。
- 首要目标与完整 P0–P6/AC01–AC34/四拓扑/72 小时目标在新对话恢复；继续完整包冷恢复、客户持续连接/持久数据校验及双架构实际升级。Owner 原公网后台保持可用，DD 由 owner 在首要门槛通过后执行。

## 2026-10-24 owner 后台登录恢复与测试覆盖收尾

- 发现公网后台仍被 zz-jointd03 服务覆盖指向独立恢复测试库，owner 无法使用原管理员配置 Bot。停止该覆盖对应后端，移除仅本轮创建且带固定注释的 backend/WireGuard drop-in，恢复原环境、原 WG 和原数据库连接；原 .env/WG 文件摘要与 original-services 记录一致。单一后端恢复正常。
- 原数据库管理员的现存密码校验与 owner 此次提供凭据不匹配；仅恢复其密码哈希并撤销旧会话，保留账号、邮箱、角色、状态、MFA 与全部通知设置。通过现有 createLog 记录访问恢复审计，不记录密码/令牌/哈希。原站点本机与公网真实登录均200/admin，公网健康与页面200。
- 本次登录修复没有停止、重启、迁移宿主或改动客户磁盘；专用宿主服务保持原运行进程。独立恢复库、测试实例及全部恢复身份材料保留，尚未销毁。
- owner 允许测试主控，不等于可持续覆盖其公网后台使其无法配置。后续后台切换/冷恢复在另一台已授权测试主控执行，保留 owner 原后台与当前配置可用；任何单台仍只允许一个业务后端。当前候选仍 ef08d03/v1.7.2，双架构候选构建/首装40093232351已success、Release skipped；本项为环境访问恢复，不计完整包升级/客户数据连续性/TG到达通过。

## 2026-10-24 全新云镜像初始化与 v1.7.2 源码候选

- 已确认公开官方 Alpine 3.24 cloud 完整 rootfs 自带 cloud-init.disabled；Incus 正常运行不能证明用户初始化完成。用户、管理员及托管全新容器路径在创建完成、第一次启动前移除这个固定构建禁用标记。仅显式请求 cloud-init 的容器执行；VM、通用 Incus 创建、既有实例恢复/迁移/重建均不进入该准备函数。缺失标记可继续，其余错误进入现有创建失败/资源与账务补偿，不假报初始化就绪，不清理既有 cloud-init 状态。
- 使用当前完整 d03 包加明确记录的编译模块覆盖，在同一个真实 OSS 恢复库完成新客户连续验收：真实用户购买202、普通非特权 Alpine、公钥自动初始化、正常10元账单及消费关联、20→10余额、真实NAT SSH公钥登录、由原受信 Incus 取得并固定客机SSH公钥。原意向重试200且没有再次扣款，新客户全程没有手工客机初始化。原三台既有实例UUID/Running状态以及原两台磁盘标记保持，源账147.25不变。结果 fresh-cloud-sale-result.json 在维护者忽略目录；这是源码专项，新完整包仍须复验。
- 用命名测试veth和唯一源地址为专用命名空间提供实际外网，保留原FORWARD拒绝及其它路由/管理身份，原规则和转发值另存私有回退记录；不是客户宿主部署。后续换机/主控失联还须客户连接连续性与完整持久数据目录校验，不能仅以一个磁盘标记宣称全部数据验收。
- Owner 已明确主控未正式上线，可用于测试；首要目标达标后由 owner DD 主控，再全新安装正式版。恢复必须只恢复管理身份、连接与已核账数据库，不因此重建、重启、迁移或重置客户实例/磁盘/网络身份。解除保护前核对快照后付款和续费，防止旧记录误停误删。该条件并入优先发行门槛，owner 的 DD 不由 agent 提前执行。
- 恢复后的新自动补续仍经现有 instance_renewed → 站内信/站点TG Bot/用户渠道通知，按用户聚合，失败三次重试并记错误；整库备份包含绑定、开关和Bot配置。当前恢复测试库无TG绑定/配置，真实TG到达未验收，已请求owner指定受控测试账号/群；不把既有实现或发送日志计作真实到达，更不宣称永久自动补发。
- v1.7.2 源码候选的client/server类型、179/179全量检查（logs/test-run-20261024-193526，7m44s）、双端构建/服务器构建/dist边界通过；新增helper ESLint通过，改动已有文件与HEAD逐项比较无新增诊断。旧instances.ts的no-empty错误和unused catch警告仍保留，不宣称全仓lint通过。此前dcedc85预览40086910315双架构构建/首装success、Release预期skipped，不能替代本候选运行。
- 当前源码候选升为1.7.2，正式发行仍1.7.1。本提交随后构建带v1.7.2元数据的完整候选（workflow_dispatch，未tag且Release跳过），继续真实完整包恢复、客户数据/连接、TG到达及双架构升级；全部门槛通过后正式发版和DD重装步骤。完整P0–P6/AC01–AC34/四拓扑/72小时仍保留。

## 2026-10-24 当前 OSS 恢复后的删除库存、真实新购与重试修复

- 接手 01a1692e-f39d-7b01-a40e-a03ec0f50352 后，从 B 实际文件确认最后解除保护任务已成功。原 Go Agent 在 B 持续在线；原账余额 147.25、保留实例续费 1 条、补回实例续费 2 条及准确时间保持，未重复扣款或充值。A 原后端、源测试库和管理通道继续隔离。
- 当前 d03 完整包的后台真实巡检删除未续费测试实例，远端确认不存在后释放 CPU 1、内存 64MB、磁盘 1MB 的测试占用，库存从 3/192/3 恢复为 2/128/2；重复巡检不重复释放，另外两台原 UUID、磁盘和账单保留。四天封停时间是独立恢复库中的时间夹具，不宣称真实经过三天。脱敏证据 joint-d03-delete-result.json。
- 专用 AMD64 宿主原隔离环境仅适用于旧特权 BusyBox 夹具。补齐正式软件包中的 dnsmasq、普通容器 UID/GID、LXC 默认挂载路径、目标网络 sysfs/proc 视图及映射 UID 必需的目录遍历 ACL；原身份、两台保留实例 UUID 和磁盘一致。普通官方 Alpine 容器实际启动/停止/删除预检通过。旧四小时 holder 和 PG 已终止后，复用仍在运行的同包后端视图并重启同一 PG 数据目录，未重建恢复库。未改产品信任或生产配置。
- 独立客户以真实用户登录，在恢复后的 d03 唯一后端购买 10 元普通 Alpine 实例；真实 Incus Running、正常 newPurchase/consume 关联、余额 20→10，源账 147.25 保持。环境未就绪时三笔失败均由正常业务自动退款，随后经真实管理员删除确认远端不存在；账单保留且无重复退款。不存在第二个业务后端。
- 真实订单重试暴露共享 maxInstances=1 的预检查早于幂等返回，成功意向被当作第二台拒绝。仅将共享预检查移至既有包/方案/权限验证和已接受付费意向返回之后；新购的共享配额及事务内检查保持。新守卫约束这一顺序。编译模块专项在同一恢复测试库验证原意向 200、仍仅一实例一账单/余额10；新意向仍400/SHARE_QUOTA_INSTANCES_EXCEEDED。该修复是单路由源码覆盖，不能视作新的完整发行包验收；新资产复验继续。
- server 构建、179/179 全量检查（logs/test-run-20261024-180030，7m48s）和清单检查通过；client/server 类型均在全量中通过。修改文件 ESLint 与 HEAD 基线逐项比较，无新增诊断；原文件仍有既有 no-empty 错误及 unused catch 警告，未冒充完整 lint 通过。未改前端文件。
- 客户 SSH 验收尚未通过：已校验官方 Alpine 3.24 rootfs 确含 /etc/cloud/cloud-init.disabled，用户公钥虽进入实际 Incus user-data，cloud-init 被禁用，授权文件与服务未完成。这是下一项明确交付缺口，不能把容器 Running 算完整客户交付。后续须修复/验收初始化、客户 NAT SSH、新完整包及双架构实际升级；正式仍 v1.7.1，未新 tag/Release/生产 OTA。完整 P0–P6/AC01–AC34/四拓扑/72小时保留。

## 2026-10-24 当前完整候选包真实 OSS 冷恢复复验

- 源码 `d03fdc1fa93ee1928bfef33ca01c92af251e8e8b` 的[源码 CI40064236220](https://github.com/mastalee928/payincus/actions/runs/40064236220)和[预览40064236950](https://github.com/mastalee928/payincus/actions/runs/40064236950)均 success；AMD64/ARM64 构建、全新安装及恢复/回滚全部通过，Release 预期 skipped。此前新.env遗漏 Agent 下载令牌的失败已在这一提交终态关闭。
- 下载同次双架构实际完整包；ARM64 SHA256 `d25e61133bc4d26918d273981fdf852d0643b74807bb001e0742f429d71dc3bc`，AMD64 `7b7004c06bce960a2cc515be55dc1256a9a3e7a330293c13f1d3eec936d76394`。ARM完整包传到物理A/B后哈希一致；使用独立既有发行信任核对并验证包内两架构组件和完整sourceCommit，未加源码覆盖。B独立空数据库、新环境和新控制签名/WG/SSH/TLS身份先完成受信登记，确认新身份与A不同。
- 旧 `preview-101aeba` 备份被当前包以 `OSS_APP_VERSION_UNSUPPORTED` 正确拒绝；未放宽跨预览限制。改在A原测试库的独立副本使用同一候选包创建新的OSS测试前缀；源端自然补续只影响副本，原账库保留。原Go Agent在快照前重新在线。本轮快照余额137.25，之后用正常业务函数完成测试充值20与续费10，余额147.25，保存关联正常账单、准确周期和到账时间；人工渠道测试不冒充外部供应商回调。
- A唯一后端、独立源PG及管理通道确认停止，B只收到OSS输入、摘要和独立账证。新备份 `de7a1d23-85b6-4f4c-b93c-b6038cf7b731`、预检 `96d708c1-be41-4a69-bf45-d86a5b2517f9` 的产品恢复成功：整库、三台付费实例和原控制/WG/管理SSH/Incus TLS摘要一致；B目的环境与新受信组件保留，固定登记验证通过，恢复保护下业务和Agent503。演练旧单元引用及已迁移库冗余迁移调用的失败未计通过；脚本修正后完整产品恢复通过，无产品代码放宽。
- 脱敏实证在维护者忽略目录 `joint-d03-source-result.json` / `joint-d03-restore-result.json`。本阶段尚未解除保护；当前完整前端账单核对、宿主重连、销售交付/删除库存及实际升级继续，正式仍v1.7.1，未tag/Release/生产OTA。完整P0–P6/AC01–AC34/72小时目标保留。

## 2026-10-24 新表单预览的 AMD64 Agent 首装失败修复

- `f3c7592764d69295c152e3f3f24c4bd1caf66e2f` 的[源码 CI40058400498](https://github.com/mastalee928/payincus/actions/runs/40058400498)成功，[预览40058665238](https://github.com/mastalee928/payincus/actions/runs/40058665238)失败：两架构构建及 ARM64 首装成功，AMD64 作业 `120768753351` 已完成迁移、网关登记和服务启动，在读取已发布 Agent 清单时由 GitHub 匿名 403 限流导致面板404，`new installation must resolve a published Agent` 断言失败。未到后续备份恢复验收，Release跳过；不是账单网页构建失败。
- 根因是全新 `generate_env()` 的 heredoc 固定生成空 `INCUDAL_AGENT_RELEASE_TOKEN`，已有 `.env` 路径的补齐逻辑没有在此执行，导致 CI 传入 token 没进入后台。初始生成改为使用显式提供值；既有非空 token 不覆盖、空值补齐保持。首装 smoke 在请求 Agent 前以布尔断言核对 `.env` 和唯一后端 `/proc/<pid>/environ` 中的提供值，不在失败输出暴露凭据；真实公开 Agent 和双架构下载/校验断言保持。
- 安装守卫覆盖 fresh/保留非空/补齐空值/未提供值及不打印 token，保留生产 readonly 路径常量，测试在独立 shell 装载同一组函数。Git Bash 守卫及 JS 语法通过；隔离 Linux 实物环境文件 root:incudal/0640、真实 systemd/incudal 用户收到测试 token 通过，未改原站点/服务。部署、Agent版本和平台备份守卫通过。此项修复仍需新提交双架构预览终态，不能把旧 ARM 成功计为新运行全通过；未tag/Release/生产OTA。

## 2026-10-24 网页补回续费账单与实际到账信息

- 恢复核对表单可补回多笔已完成续费：独立凭证、金额、月数、付款时间及每个账期结束，起点从恢复到期自动连续衔接，最终到期直接取最后账期，避免两个时间输入不一致。仅填写到期与补回正常账单明确区分；添加/移除有上限和焦点回归。充值可填确认净额、到账时间和流水；预览分列到账、续费扣款及其它净额调整。三种语言补齐，所有日期输入保留毫秒。
- 使用完整 `505369b` ARM64 后端、独立新 PG 库、实际 Web 密码/MFA 登录与生产 API 进行浏览器验收（保护为受控夹具）：100→128、订单40/到账38、正常续费10元/1月及精确周期/时间一起落库，消费日志关联账单，现有退款上限查询为10元。错误MFA提示且凭据清空；同内容用新MFA重试返回原记录，复用MFA拒绝，仍仅1账单/2余额日志/1修订，保护保持。没有 mock 请求或另起第二个业务后端。
- 动态账期及最终到期一致、添加/移除焦点、模态Tab边界、1440/768/390、明暗及简中/英文/繁中18组合截图通过，无横向溢出，凭据未导出。修复Vue scoped全局选择器把深色日历控件留在浅色的问题，真实浏览器最终18组合的原生color-scheme一致。沿用黑白/原字体和 achromatic-ledger；Inspector保留原生模态覆盖背景标题、既有OSS边线、12px帮助及长表单滚动的明确范围例外，不宣称无例外检查。
- Client类型、修改文件ESLint、路由/i18n、最终双端构建及dist边界通过。源码API阶段[CI40049459038](https://github.com/mastalee928/payincus/actions/runs/40049459038)和[预览40049674014](https://github.com/mastalee928/payincus/actions/runs/40049674014)双构建/双首装/恢复回滚success，Release预期跳过。实际包传输首轮触及工具时限导致连接工具重置，未计完成；改为可跟踪并发SFTP后全包哈希及独立既有签名信任一致。隔离应用目录700首次启动失败并自动清理，改成安装器755后受保护启动通过，未放宽保护判断。
- 证据维护者忽略目录 `ledger-bill-ui/ledger-browser-result.json`、`ledger-retry-result.json`、`ledger-layout-result.json`、云端隔离目录 `database-result.json`。网页为同源组件验收入口；新完整前端包、真实OSS新账单联验、销售/删除库存/升级仍待继续，正式版本仍v1.7.1，未tag/Release/生产OTA。

## 2026-10-24 恢复核对补回正常续费账单（API 阶段）

- 修复仅修订余额/到期却缺少正常续费账单的缺口。保护内修订可携带外部凭证确认的续费金额、月数、完整周期、付款时间及最新账单 ID；最多 20 条，周期必须从恢复记录到期连续衔接至确认到期，凭证不得重复。正常 renew 账单与 consume 日志关联写入，同一事务保存余额、到期、充值状态和审计；重复请求直接读原结果，已有周期、旧账单快照或已使用凭证拒绝。
- 已到账充值可填写确认净额、到账时间和流水号，保留原订单金额供对照，完成订单及正常充值日志使用确认净额。正常续费扣款和已到账充值纳入填写的最终余额，仅未匹配差额为 admin_adjust；逐条入账保持中间余额不为负且不溢出，不能安全入账时全部回滚。付款/到账时间保留毫秒，续费账单可进入现有消费历史及退款上限/剩余价值报价；零金额的已确认付费方案续费也有账单与零消费证据，不伪造退款金额。
- 原源测试库只读核实了一笔真实 10 元/1 个月续费及关联消费日志，取得原周期和付款时间作为后续 OSS 联验依据。真实独立 PG16/Fastify 新源码验收通过：净额 38 元对照订单 40 元、10 元正常续费、精确周期/时间及退款上限 10 元；同请求重试、不同周期/账户凭证复用、已有周期、旧账单及备份前证据拒绝；多次/零金额续费、余额上限及 journal 故障连同账单全部回滚通过。密码/MFA、反重放、余额 ABA/实例版本和秘密不入审计原有专项继续通过。
- Server 类型/构建、修改 TS ESLint、179/179 全量检查（`logs/test-run-20261024-090746/`，6m42s）及最后新增大于 16KB 的有界凭证请求专项通过。实际测试脚本/编译模块哈希与隔离机器一致；结果 `renewal-ledger-api-result.json` 和 `renewal-ledger-stage-hashes.json` 在维护者忽略目录。该专项使用同源预览加新源码模块、测试 Web 身份和保护夹具，`realOssRestoreHold=false`；网页入口、完整新包/真实 OSS 及销售/删除库存仍待联验，未新发 tag/Release/生产 OTA。

## 2026-10-24 专用宿主整机重启与五分钟自然巡检

- 延续完整包 OSS/账务演练，唯一后端在 08:05 自然触发五分钟巡检（UTC 00:05:00.019→00:05:00.894），失败数 0；上一轮管理员立即执行结束于 UTC 00:03:29.562，下一次自然执行为 UTC 00:10。不是只读取 cron 配置或手动触发的证据。
- 将专用 AMD64 宿主的临时演练入口改为持久 systemd 启动：复用原 Incus 数据目录、证书、实例和磁盘，仅按既有测试实例设置自启动；保留固定域名绑定、原 WG/管理 SSH/Agent 凭据。先验证新命名空间启动，三台原 UUID/磁盘标记一致，两台已续实例 Running、未续实例 Stopped，原网关和应急 SSH socket 保持。首次启用撞到既有同名 transient Agent，未记通过；改用独立持久单元名后通过，未重建实例。
- 实际执行专用宿主整机 reboot；按原独立 SSH 指纹重连，boot ID 与重启前不同。持久宿主/DNS/SSH/Agent 服务自动启动，原独立网关也 active。原 Incus 证书及私钥、宿主 WG 与管理 SSH 密钥摘要、三台实例 UUID 和磁盘标记一致；固定域名产品守护程序自动将原 peer Endpoint 指向 B。两台已续实例自动 Running，未续实例保持 Stopped。
- 重启后再次通过 B 的原 Incus TLS 管理与正式 Go Agent 原凭据心跳（UTC 00:23:25.269），账务仍 137.25，漏续费仍只记一次，充值重放无再次入账。最终再次确认 A 后端/测试 PG inactive、故障保护 active。脱敏结果 `joint101-natural-timer-result.json`、`joint101-reboot-result.json`、`joint101-after-reboot-result.json`，均在维护者忽略目录。
- 完成证据采集后恢复 A/B 原环境和原网关配置，移除本轮后端覆盖，两个原唯一后端 active、NRestarts=0、health ok/recoveryHeld=false；仅停止独立测试 PG，原数据库不动。专用宿主持久测试实例及身份保留供后续验收，原独立网关 active；新测试备份、外部账务证据和修订后的隔离库也保留。
- 本阶段仅为专用隔离宿主整机重启，不是客户宿主部署、控制器 A 整机断电、完整主备切换或 72 小时演练。销售交付、正常账单明细/其它快照后交易完整核对、保留期删除/库存和双架构升级仍需继续；正式发行保持 v1.7.1，未新发 tag/Release，未执行生产 OTA。

## 2026-10-24 完整包 OSS 恢复、保护内网页修订与补续费联合实证

- 使用完整 `101aeba` ARM64 预览包在物理 A 新建真实 OSS 备份 `b1dd3c26-05bf-4750-aee2-032b46ce84d2`，包含三台付费测试实例、原控制签名/WG/SSH/Incus 身份和备份前登记的正式 Go Agent 凭据。备份后用正规业务函数完成 20 元测试充值及一台实例 10 元续费，余额 137.25→147.25；这是人工支付渠道夹具，未冒充外部支付供应商回调。独立证据确认该场景无托管收益及 AFF 记录。
- A 后端、测试 PG 和管理隧道保持停止，应急 SSH 保留；B 仅接收 OSS 位置/密码/配置、摘要和外部账务证据，原私钥及数据库来自 OSS。修正隔离副本权限后的完整恢复运行 `c8efe61171624085b0378f83cc0f2eb4` 成功，preview `735a93e0-e812-494f-81c4-052af4b8bee3`，恢复保护 `1d568f2f-5606-432d-a268-70fd949cfc8e`。原身份摘要、B 已验签组件和目标连接身份核对通过；业务与实际 Agent 心跳 503。首轮隔离 copytree 丢失属组导致后端看不到保护，产品受保护启动失败并回滚；该失败未记通过，按安装器权限修正后先验证回滚保护再重做。
- 只切试验网络内固定域名 DNS，原守护程序自动将 Endpoint 从 A 改 B，无重建 peer。完整包受限网关 SSH、原宿主 SSH 指纹、原 Incus 客户端/服务端 TLS 和三台 Running/磁盘标记通过。隔离网关 SSH 读取同一身份目录，目标占位指纹先被拒绝，再以 owner 已独立核实的 B Ed25519 指纹验证并配置私有 loopback 入口；没有放宽指纹检查，公共 DNS 未修改。
- 真实 Web 密码登录、生产账务 API 及真实 OSS hold 下的网页修订成功：余额 147.25、充值 completed、已完成续费的到期延长（网页时间输入按秒），保护继续启用；修订 `451b2b46-186d-4f0f-a91e-e850c3baf5f1` 持久保存，同一请求重试只返回原记录。网页使用同源组件验收入口，后端为完整包，不能声称此项已验证正式前端资产部署。截图先清除后台 OSS 凭据字段后保存。
- 独立核对此测试场景账务后执行产品 resume。真实管理员启动/立即巡检接口均 202，调度间隔 5 分钟、失败数 0；漏续费实例只新增一次正常续费及 10 元扣款，已修订续费实例不再扣，正规充值完成函数重放返回未再次入账，最终余额 137.25。原 Go Agent v1.0.3 无轮换凭据在 B 恢复 online/lastSeenAt；原生 Incus `cloud-kept`/`cloud-renewed` Running、`cloud-expired` Stopped，三台磁盘标记保留，未到删除保留期不释放占用。最终结果取得后再次确认 A 后端/测试 PG inactive、故障保护 active。
- 脱敏证据：维护者忽略目录 `joint101-restore-result.json`、`joint101-ui-result.json`、`joint101-joint-result.json`、`joint101-reconciliation.jpg`。本阶段未改产品源码。新销售资源交付、已完成续费的正常账单明细/其它快照后订单完整核对、保留期删除及库存联合、五分钟自然触发、宿主整机重启、双架构升级仍需继续；不能据此宣布首要范围或完整 P0–P6/AC01–AC34/72 小时完成，未新增 tag、Release 或生产 OTA。

## 2026-10-24 当前完整预览包与真实 Agent 源端基线

- 源码 `101aeba742cd64968708d833d7997168aef5b38d` 的[源码 CI](https://github.com/mastalee928/payincus/actions/runs/40035690849)与[发行预览](https://github.com/mastalee928/payincus/actions/runs/40035691682)均 success；AMD64/ARM64 构建、全新安装及恢复/回滚通过，Release 预期 skipped。179/179 本地全量检查通过，日志 `logs/test-run-20261024-063147/`。正式发行仍 v1.7.1。
- 下载同次预览的实际双架构资产；完整 ARM64 包 SHA256 `fe06ef4a4d1782e602220051f580dbbfe2c75549de02a98e30f574a7f4a1f6d3` 在物理 A/B 传输后匹配。初始化/刷新前，包内发行公钥与独立保存的既有受信登记比较一致；产品登记器验证两种架构组件、版本和完整源码提交。新隔离环境使用该完整包，未加源码 overlay。
- 旧源临时命名空间结束导致其 tmpfs 控制身份丢失；A 通过生产归档认证和恢复函数从原真实 OSS 备份取回控制签名身份，映射到新包的已验签组件，再由固定登记器验证。原管理 SSH、WireGuard、Incus 客户端和宿主服务端信任保留；本轮私有材料改用持久实体目录，不依赖 tmpfs 保存。
- A 唯一实际 systemd 后端运行完整包；原生 Incus 三台 Running 和磁盘标记核对通过。三台测试实例已登记真实付费计划。正式 Agent v1.0.3 AMD64 资产哈希与 GitHub 发布摘要一致，经原管理隧道访问私有代理至唯一 127.0.0.1:3001 后端；生产 HMAC 验签、心跳落库 online/version/lastSeenAt 和原 Incus socket 读取通过，凭据在下一份备份前入库。脱敏结果 `logs/controller-takeover-research-20261022/joint101-baseline-result.json`。
- 本节仅为当前完整包源端基线；保护内账务、快照后交易、B 恢复后的原 Agent 心跳、补续费/到期/销售联合与整机重启仍需验收。未新增 tag、Release 或生产 OTA，完整 P0–P6/AC01–AC34/72 小时目标保留。

## 2026-10-24 恢复保护内网页账务修订（阶段源码）

- 账户余额行新增「核对并修订」：原生模态窗口读取准确余额/最近日志、可修订到期及未完成充值；提供最终余额、外部凭证/时间、实际续费到期、到账充值与密码/MFA输入。提交前显示净额和选中数量；窗口重试保持请求 ID，凭据发送即清空，不写浏览器持久化。外层解除保护和回滚在编辑期间禁用；Tab 首尾循环、取消及成功后的焦点恢复已验证。
- 新增账户只读明细和分页修订审计，修订后显示已核对数量。旧中断任务历史仍标 running 时曾永久锁住界面，改由服务端 activeTask 驱动操作门禁，历史检查点单独标待核对；当前活动任务仍阻断写入。
- 真实唯一 Fastify 后端/PG16/Web 密码与 MFA 浏览器验收通过：余额、到期及充值修订；错误密码/验证码可见且输入清空；原请求精确重试不改变余额/审计数量，MFA 防重放；审计列表、修订后文案；1440/768/390、明暗主题及三语言无横向溢出。该现场使用隔离测试库和保护夹具，不等于真实 OSS 联合账务验收。新代码上传的 0600 模式曾阻断服务启动，仅修正公开代码为 0644 后通过；原环境/网关配置和单后端已恢复。
- 179/179 全量检查、双端构建/边界、修改文件 ESLint 通过。沿用 achromatic-ledger 与原黑白字体；逐宽度查看实际截图。Inspector 0 FAIL/0 WARN，明确保留四项范围例外：原生弹窗有意遮盖不可交互背景标题；原 OSS 设置边线沿用；12px 仅辅助说明；编辑窗口及背景长设置页需滚动。组件 Lint 的破折号警告为缺失值标记。截图背景曾带出测试 AccessKeyId，已遮蔽重新生成截图/静态快照并检查导出文本无凭据。未新发 tag、Release 或生产 OTA。

## 2026-10-24 恢复保护内账务修订 API（阶段源码）

- 新增受限 `recovery-review/reconcile` 与修订审计读取接口，绑定恢复 taskId、真实快照截止时间、外部凭证编号/核对时间、账户期望余额和最近余额日志 ID，以及实例精确到期/版本和充值期望状态/金额。仅原恢复保护允许提交；回滚保护、旧/跨账户快照、免费/删除/清理或活动任务实例、重复凭证冲突和非法金额均拒绝。网页表单尚待下一阶段。
- 当前管理员密码、MFA 及防重放在同一事务核验；复用原账户余额 advisory lock、余额日志写入与实例串行通道。恢复核对的是外部证据确认的最终余额和已完成的到期延长，不执行宿主动作、不启动 worker、不释放库存。明确确认已到账的充值原子转 completed 并写正规充值余额日志，避免其后支付回调再次入账；净额差异另写 admin_adjust。所有修订和审计在同一事务，凭据不入日志/持久 journal。
- 新迁移保存完整修订前提、结果和凭证去重索引，用户关联保留财务审计。余额视图增加最近日志 ID；有修订后 `snapshotOnly=false`，原始快照与核对后的数据不可混称。Server 类型与构建、11 项相关守卫、修改 TS ESLint、迁移/脚本语法及 179 项清单分类检查通过。
- 真实 Linux PostgreSQL16 + 实际 Fastify 路由/生产密码/MFA 库验收通过：余额 100→130、到期/版本延长、充值 completed；重复与并发重试只记一次，余额 ABA/跨账户/旧版本拒绝；故意让 journal 持久化失败后余额/充值/实例/日志全部回滚；MFA 重放拒绝、秘密未入审计。该专项使用独立克隆数据库、测试 Web 身份和保护夹具，`realOssRestoreHold=false`；不能当作真实 OSS 恢复保护、网页及销售/续费/到期联合验收通过，正式版本仍 v1.7.1。

## 2026-10-24 物理 A 失联后的真实 OSS 恢复与原宿主管理重连

- 源 A 在独立 PG16 与挂载环境中用产品执行器完成整库备份至真实 OSS 新测试前缀，包含原控制签名、WireGuard、管理 SSH、Incus 客户端证书及宿主登记。专用 AMD64 宿主使用原生 Incus，备份前产品 SSH/mTLS 客户端验证三台运行实例和磁盘标记。目标 B 的恢复输入只有云端位置、密码/OSS 配置与校验摘要；原私钥和数据库均由云端归档取得。
- 最终完整运行 `57188cbfd03f4797a4862fe990ad99e3`：停止 A 后端、源测试数据库和管理通道，确认宿主不可达，保留应急 SSH；B 完成云预检、整库与身份激活并保持恢复保护。仅切换试验网络内固定域名的 DNS，产品守护程序自动更新 Endpoint，原公钥重握手；经受限网关 SSH 和原 Incus TLS 证书/指纹验证库存三台一致、仍 Running、磁盘标记不变。最终管理结果落盘后再次核实 A 后端仍 inactive、故障保护仍 active。
- 同一次最终运行验证了真实余额 137.25、目标数据库/JWT/SSH 指纹及受信组件保留、管理员可登录、旧会话拒绝、业务 503、原生 WG 激活，以及显式回滚和解除保护。B 原服务与原环境/网关配置恢复；随后恢复 A 原服务和试验 DNS 基线。前几次失败未记通过：人工观察超时、旧预览测试目录遗漏新 probe helper，以及验证脚本仅断开 Prisma 而未关闭外部 PG pool，导致回滚时空闲连接被管理员终止。改为当前源码 helper、明确观察窗口及现有 closePrismaDatabase 后完整复验成功；另在新进程完成过中断回滚恢复。
- 本节是源码现场验收：同源旧预览包加本轮局部源码 overlay，不能当成当前完整发行包验证。公共 DNS 未改；A 整机断电、宿主整机重启/心跳、快照后账务修订及销售/续费/到期联合验收仍未完成。正式版本仍 v1.7.1，完整 P0–P6/AC01–AC34/72 小时目标保留。

## 2026-10-24 核对入口双架构预览与物理宿主连接基线

- `74d97bbcbe47190f6309f894aa3cebfacfca6986` 的[源码 CI](https://github.com/mastalee928/payincus/actions/runs/40006901699) 已成功；[发行预览](https://github.com/mastalee928/payincus/actions/runs/40007174008) 的 AMD64/ARM64 构建、全新安装及恢复/回滚全部成功，Release 为预期 skipped。正式发行仍 v1.7.1，未新增 tag、Release 或生产 OTA。
- 专用 AMD64 宿主使用官方原生 Incus，三台隔离实例仍运行；独立管理 WireGuard 与另一物理机源 A 连通，沿原公钥和管理 /32 无丢包。固定域名守护程序在该宿主通过真实 DNS/libc 解析源 A 并运行周期检查。测试 DNS 仅存在于隔离网络，未修改公共 DNS；原测试后端和独立网关服务核实仍 active。
- 本节仅为源端连接基线。B 尚未从这份跨机测试备份取得原身份，A 通道失联后的 B 自动重连、SSH/mTLS/心跳及账务修订仍待联合验收；不能视为首要发行目标或完整 HA 已达标。

## 2026-10-24 恢复保护内的网页核对入口（阶段源码）

- OSS 页面新增恢复核对：在保护期间分页读取账户余额、实例到期、充值订单、余额日志及机器池订单意向；显示真实备份截止时间、库存隔离和快照后交易边界。数据库查询使用 repeatable-read/read-only 事务，字段白名单不返回密码、认证材料、私钥路径或支付配置。旧恢复记录无时间时不编造，回滚保持保护并标明回退数据。
- 探测仅经已登记 /32 管理通道，固定 SSH 命令核对宿主接入 ID，并要求原 Incus TLS 证书/指纹及管理地址匹配，再只读比较现存实例；缺失/未知/重复实例不冒充库存就绪，不改余额、到期、实例状态、peer 或占用。受限备份管理员、Web sid/Bearer 和管理员 Origin 边界保留；实际发现跨 Origin 请求未显式拒绝后补齐，失败未记为通过。
- 类型/后端构建、前端双构建、路由/i18n/dist、备份及新增核对守卫、原网关9项Python登记守卫和修改TS ESLint通过；新增守卫登记到全套清单，现planned178（不是本阶段全量执行）。真实隔离 PG/Fastify 证明匿名、普通用户、非授权管理员、跨Origin拒绝，五种分类/金额读取与秘密省略、未知管理身份阻断及业务503通过。真实 OpenSSH/WG证明新探测的身份与错误指纹拒绝、配置不变。
- 真实后端浏览器核对六种宽度/主题、分类切换与失败提示，无横向溢出；设计源码0FAIL/0WARN、渲染0FAIL/0WARN，实际字体与桌面/平板/手机复核。沿用黑白样式，achromatic-ledger seed168876278，保留配色/字体，恢复截止时间和实测连接与快照数据分别标注。证据维护者忽略目录 `recovery-review-api-result.json`、`recovery-probe-ssh-result.json`、`gateway-page-browser/review-browser-result.json`。
- 新备份截止/回滚标记已再跑真实完整OSS restore/rollback/resume，全部成功；原主控服务active、NRestarts0、health正常。该阶段不包含账目修订/补回快照后订单，不宣称跨机器宿主联合验收通过。物理旧A已准备同源ARM64预览包；AMD64专用宿主用官方Incus6.0.0实际启动3台隔离测试容器，原独立网关服务保持，证据 `cross-native-host-result.json`，留供下一阶段实际跨机器测试。

## 2026-10-24 完整隔离 OSS 恢复、原生网关激活与回滚

- 接上方真实整库云备份/预检，正式执行器在独立测试 PG 集群完成 `restore → awaiting_review → rollback → resume`。实际唯一 `incudal-backend` systemd 服务与原生 `wg-quick@incudal-mgmt` 临时复用；恢复保持保护，业务 API 返回 503，管理员可登录，恢复前 JWT 会话拒绝。余额按实际 `Decimal(10,2)` 保持 `137.25`；原控制签名、WireGuard、管理 SSH 和证书哈希匹配，B 的数据库/JWT/已核实 SSH 指纹及受信组件目录保留。
- 原生 WireGuard 恢复后实际监听 51827，显式回滚后回到目标测试配置的 51999；B 原签名私钥、环境加密身份、数据库标记恢复，保护保持，随后明确确认解除保护成功。完整结果 `logs/controller-takeover-research-20261022/platform-cloud-activation-result.json`，原服务回退结果 `platform-cloud-cleanup-result.json`，二者 passed。
- 演练的匿名目录引用未让 systemd 读取同一恢复标记，改用 root 私有实体目录并用内核挂载句柄转入隔离命名空间，进程核对了同一代码和标记。连续演练额外启停曾触发启动限流；仅临时演练覆盖提高额度，清理移除覆盖并重置该测试产生的限流。原业务环境/网关文件哈希相同、唯一后端 active、NRestarts=0、health ok；未变更产品源码或正式启动额度。
- 本轮同一物理测试机内的完整隔离冷恢复通过，不代替跨机器整机故障、宿主重连、备份后交易对账或完整 AC 验收。按 owner 新指令，阶段验证后立即记录推送；首要范围所有门槛通过后立即正式发行并交付使用方法。

## 2026-10-24 完整平台真实 OSS 备份与替代环境预检

- 使用源码 `24b70e1` 已通过双架构预览的实际 ARM64 安装包，运行正式 `runPlatformBackupTask` 备份和预检；OSS 客户端、整库采集/验证、加密归档、额外可读 ZIP、上传回读和完成标记均使用产品实现，没有替换为本地存储。独立 PostgreSQL 16 集群使用新角色、新数据库和临时端口，不捕获或修改现有业务数据库。
- 原测试库删除、原环境和管理密钥替换后，新进程从新 OSS 测试前缀下载并预检。130 张表、442 行、118 个序列的完整性检查，以及证书、WireGuard、管理 SSH 和三份控制签名身份的原文件哈希核对通过；目标使用不同数据加密身份。脱敏结果 `logs/controller-takeover-research-20261022/platform-cloud-preview-result.json`。
- 实际恢复和后续终态见上方完整隔离恢复记录。演练曾因匿名命名空间挂载、测试身份强度、脚本金额精度和连续启停额度失败；失败未记为通过，修正测试环境后完整流程通过并复核原服务回退。
- 本阶段是同一测试主机内的隔离冷恢复实证，尚未验证 A 整机丢失、跨机器 B 恢复、宿主 DNS 重连、备份后账务补偿或完整 AC；正式发行仍 v1.7.1。

## 2026-10-23 对话接手与控制身份真实 OSS 冷恢复

- 接手已中断的网关灾备工作，完整读取原聊天及其关联施工记录；优先范围仍为主控兼网关 A 丢失后 B 从 OSS 恢复、固定域名重连和账务核对，完整 P0–P6/AC01–AC34 与 72 小时离线目标保留。专用测试机、故障注入、新 OSS 测试前缀和分阶段提交推送沿用 owner 明确授权；不据此扩大生产变更范围。
- 当前源码 `24b70e1055b630fed3f966183eb40a5d35ff75e8` 的 [CI 39968460120](https://github.com/mastalee928/payincus/actions/runs/39968460120) 与 [预览 39968464066](https://github.com/mastalee928/payincus/actions/runs/39968464066) 已重新读取终态：源码 CI、AMD64/ARM64 构建和双首装/恢复均 success；Release 为预期 skipped，正式发行仍 v1.7.1。
- 专用测试主控隔离 mount 中，以受信签名组件分别初始化 A/B 身份；使用实际平台归档编码器、真实隔离 PG dump 和生产 OSS 客户端上传/回读三份控制身份。上传完成后移除隔离环境的 A 原身份目录及本地归档/dump，再启动另一 Node 进程，仅从新测试前缀下载、认证和恢复。三份文件哈希匹配、错误密码拒绝、B 新私钥未冒充 A、B 受信组件目录保留及 root 登记验证均通过。
- 脱敏证据为维护者忽略目录 `logs/controller-takeover-research-20261022/controller-cloud-codec-result.json` 和 `controller-cloud-root-result.json`。原测试业务后端 PID/重启计数不变、健康正常。该专项尚未执行完整平台恢复或激活客户管理身份，未验证宿主重连、DNS 故障切换、备份后交易对账或完整 HA，不将其计为联合验收完成。
- 本轮仅补充验证和文档，未改产品源码；平台备份守卫、security-config 文档约束、177 项测试清单校验及 diff 检查通过，未将清单校验记作全量执行。

## 2026-10-23 故障后自动续费补处理（阶段源码）

- 到期巡检先执行自动续费，查询覆盖已到期付费实例及系统到期暂停，沿用原周期和AFF/VIP计价，从当前时间续期；不追扣离线多个周期。手动暂停、免费、已删除/待清理及活动实例/恢复/上传任务排除，恢复保护禁止自动扣款。
- 小时任务与五分钟巡检共用执行promise和通知批次，同一用户的多台实例按余额锁顺序串行。扣款事务在原实例版本之外再次核对自动续费开关、精确到期时间、当前资格与三次上限，陈旧请求导致整个余额事务回滚。失败至少间隔一小时，剩余重试保留已停止磁盘；三次失败且暂停满三天后执行删除，不延长免费运行。
- 真实空PG测试库/HTTPS Incus夹具验证错过36小时/5天的续费、暂停后补续、小时与巡检重叠只扣一次、手动/免费/远期排除、恢复保护、关闭自动续费后的事务回滚，以及一小时重试/三次失败/暂停保留期删除。首轮同一买家并发遇到余额advisory锁冲突，修为按用户串行后整轮通过；不将该失败算作通过。
- 真实Incus6.0.4独立mount/net与临时委派systemd服务验证：运行中的到期容器补续费只扣一次且实际继续Running；随后关闭自动续费并设已过暂停保留期，实际停机/删除/不存在核验、库存释放与重复巡检通过。独立PG夹具和真实Incus证据分别为 `catchup-integration-result.json`、`catchup-real-scheduler-result.json`，均位于维护者本地忽略目录。临时服务退出，原唯一业务后端active且未部署此源码。
- 全量planned/executed/passed177、failed0（`logs/test-run-20261023-215428/summary.txt`，6m35s）；最后事务条件调整后的6项计费守卫、服务器类型/构建及修改TS ESLint通过。前端未变更。本阶段CI/预览随后另记；真实OSS丢失A→B恢复→DNS重连及备份后交易对账仍待联合验收，正式版本保持v1.7.1。

## 当前源码与发布状态

- 面板 [v1.7.1](https://github.com/mastalee928/payincus/releases/tag/v1.7.1) 已正式发布，发行源码 `9d1e5ba47dd6bf0a0937413892dacfeeb15e4a1d`，注解标签对象 `b9e5ca546250ada32e9df55455bba454f54f5a4d`，GitHub 面板 latest 为 v1.7.1。修复旧 OTA 解包保留构建机 UID 导致备份执行器安装回滚的问题；双架构预览、正式首装/恢复演练与公开资产校验通过。测试主控任务 #13 已使用原版 v1.7.0 执行器成功升级至 v1.7.1，2026-10-22 从实际管理后台复核成功日志及运行版本；同日 owner 明确确认已升级至 v1.7.1、正常运行、所有宿主均正常。下方各版本 latest 为当时状态；生产 OTA 未执行。
- 面板 [v1.7.0](https://github.com/mastalee928/payincus/releases/tag/v1.7.0) 已正式发布，发行源码 `33b08791dc62e819fbbff847c38cd9e9ba438a37`，注解标签对象 `e778882f3e20e62067abdcc289136de3d7e0f407`，GitHub 面板 latest 为 v1.7.0。纳入恢复保护、批量/已售恢复、故障状态、客户日志、密码重装及同配置跨区域更换机器；双架构预览与正式首装/恢复演练通过。首页改版已取消，设计样稿和新安装的设计技能未进入发行提交。测试站此前已热更新验证相关功能，生产 OTA 未执行。
- 面板 [v1.6.9](https://github.com/mastalee928/payincus/releases/tag/v1.6.9) 已正式发布，发行源码 `54203107fa138d92f0e29ece97d0c3fe1ed80090`，注解标签对象 `bce6f35d18e9bf00549349db8dc4fb8e4696980f`。GitHub 面板 latest 为 v1.6.9；双架构预览及正式首装/恢复演练、真实 OSS 额外 ZIP 上传/回读/隔离恢复均通过。测试主控已直接热更新验证，生产 OTA 未执行。
- 面板 [v1.6.8](https://github.com/mastalee928/payincus/releases/tag/v1.6.8) 已正式发布，发行源码 `44d26132f02f9bbaeb87c50305e39fb40f65be6c`，注解标签对象 `733c867101089fe1d24b9dd53d25b36c8c0a90a1`。GitHub 面板 latest 为 v1.6.8，双架构预览、正式首装及 Linux 本机备份/恢复/回退演练均成功。真实 OSS 测试桶验收及生产 OTA 未执行。
- 面板 [v1.6.7](https://github.com/mastalee928/payincus/releases/tag/v1.6.7) 已正式发布，发行源码 `fa716ee699e4ff77400b21bd093968c8be5f0dbc`（注解标签 `v1.6.7`，对象 `da4fdd3d1087d8cc59a8b0c4fcedba637ae95a6a`）；GitHub 面板 latest 为 v1.6.7。测试主控已载入 v1.6.7 同源内容（发布前经第六轮内部热替换上机，双端 index.html 与发行包逐字节一致）；面板 OTA 正式升级待执行。下方 v1.6.6 及其“已通过面板 OTA 升级至 v1.6.6”为当时状态。
- 面板 [v1.6.6](https://github.com/mastalee928/payincus/releases/tag/v1.6.6) 已正式发布，发行源码 `9f1a14a799a9600a4aa6a3c84f9cffa7d68ad087`（注解标签 `v1.6.6`，对象 `55bdb1dcfba1197b42a050ad8bf130afccaf6410`）；GitHub 面板 latest 为 v1.6.6，测试主控已通过面板 OTA 升级至 v1.6.6；其后的仪表盘负载条修复等提交已随 v1.6.7 发布。下方 v1.6.5 及其“已通过面板 OTA 升级至 v1.6.5”为当时状态。
- 面板 [v1.6.5](https://github.com/mastalee928/payincus/releases/tag/v1.6.5) 已正式发布，发行源码 `3fb8a0eb9dd95088addf221e538a9eeac4e687f3`（注解标签 `v1.6.5`，对象 `26a2651773e813b7292506c9a7fd776b4672bb16`）；GitHub 面板 latest 为 v1.6.5，测试主控已通过面板 OTA 升级至 v1.6.5。下方 v1.6.4 及其“已通过面板 OTA 升级至 v1.6.4”为当时状态。
- 面板 [v1.6.4](https://github.com/mastalee928/payincus/releases/tag/v1.6.4) 已正式发布，发行源码 `41d87820504977ffb24f895ab6c735a67f17fdaa`（注解标签 `v1.6.4`，对象 `8d39a04ea5d084378664e24ff0c0326758c2d744`）；GitHub 面板 latest 为 v1.6.4，测试主控已通过面板 OTA 升级至 v1.6.4。下方 v1.6.3 及其“已通过面板 OTA 升级至 v1.6.3”为当时状态。
- 面板 [v1.6.3](https://github.com/mastalee928/payincus/releases/tag/v1.6.3) 已正式发布，发行源码 `f8d2ca450e01a10a54ae5f57b75e4f80821371dd`（注解标签 `v1.6.3`，对象 `5d7b3e170a6de887256c5ccc2ba32e8e8d7bb58f`）；GitHub 面板 latest 为 v1.6.3，测试主控已通过面板 OTA 升级至 v1.6.3。下方 v1.6.2 及其“尚未进入新的正式安装包”为当时状态。
- 面板 [v1.6.2](https://github.com/mastalee928/payincus/releases/tag/v1.6.2) 与 [Agent v1.0.3](https://github.com/mastalee928/payincus/releases/tag/agent-v1.0.3) 已正式发布，源码均为 `2b81ce66e99c0941df8f579f085be59ce909541f`；后续源码和文档提交不改变已发布标签或安装包。下方实例配置权限收紧与购物车布局精修属于发布后的源码及测试站更新，尚未进入新的正式安装包。
- 此前 GitHub main 停留在 b140752，后续功能只在维护者工作区及测试主控直接部署。`429e858` 已补齐完整功能，后续提交修复全新安装验证中发现的问题。
- 源码包括机器池、定价、购物车、一机一卖、Alpine / Debian 接入、1 GiB swap、WireGuard 管理、全端口 TCP/TCP+UDP、故障换机、公网 IPv4 与多 IPv6 自动同步、用户/管理员 PUSH，以及首页、45 区域选购和 UPAY Pro 更新。
- 安装器、OTA、Agent、文档和问题反馈均使用本仓库。新安装增加管理网关配置，发行包包含完整迁移、探测、网络、swap 与网关脚本。
- 本地类型检查及全套配置测试已逐项通过；安装器、仓库来源、部署配置、OTA 与网关参数守卫通过。Lint 无错误，保留已有样式警告；文档构建通过。
- [正式发布工作流](https://github.com/mastalee928/payincus/actions/runs/38878414833) 全部成功：Linux amd64 / arm64 分别构建并从真实发行包全新安装，通过 209 条数据库迁移、IPv6 数据字段、唯一后端启动、双端访问、管理员登录、机器池 API、固定主机指纹 SSH 网关及正式 Agent 下载和执行验证。
- 已实际下载两种架构的公开安装包，确认 SHA256、文件大小、OTA manifest、包内版本与 Git 提交一致；检查全部迁移和 IPv6、UPAY 等关键模块，包内 LICENSE 与发行源码原文一致。GitHub 的面板 latest 为 v1.6.2；公开一键安装脚本与发行源码一致。
- [源码 CI](https://github.com/mastalee928/payincus/actions/runs/38877110604)、[Agent 发布](https://github.com/mastalee928/payincus/actions/runs/38877110746) 均通过；[本仓库文档站](https://mastalee928.github.io/payincus/) 已上线。

## 2026-10-23 固定网关域名和宿主补装（阶段源码）

- 后台机器池管理网关增加固定域名/UDP端口设置、逐台宿主补装及失败/缺通道状态。域名保存校验当前公网IPv4/端口；普通用户、无Web sid、跨Origin及未知字段拒绝。配置入库后供新接入使用，随平台整库备份保留；已有宿主不因保存设置被冒充已迁移。
- 受限网关SSH强制命令只增加固定dns操作：目标来自root登记管理/32、公钥与平台请求交叉核对，ssh-keyscan筛选已登记指纹并用独立known_hosts严格连接；不使用客户公网SSH、不接受脚本/路径/任意shell。固定发布脚本通过stdin传递，收到已验证安装回执才记录成功；回执持久绑定宿主公钥/SSH指纹/管理地址，变化后失效。
- root固定DNS程序持久登记节点/本机公钥/网关公钥/管理地址/AllowedIPs/域名/端口。同一明确登记可以幂等补装、恢复中断；信任或固定域名冲突拒绝。守护进程每30秒限定解析公网IPv4，仅更新原peer Endpoint；失败保持现有配置。systemd沙箱和Alpine/OpenRC supervise-daemon自启动/重启；文件/链接/属主/重复字段和原绑定校验保持。
- 真实Ubuntu AMD64测试机的隔离mount/net验证实际WireGuard+libc DNS：A测试网关停止，运行中的同一进程30秒周期更新B Endpoint，实际握手与ping恢复，配置/密钥/路由保持；杀进程后生产10秒RestartSec自动恢复。首次/重复安装固定程序通过，实际systemd沙箱服务独立验证。实际OpenSSH沿WireGuard管理地址首次/重复补装通过，错误指纹拒绝；该SSH测试的init命令使用固定替身，真实init证据分开。
- Alpine3.22隔离rootfs用实际OpenRC/supervise-daemon验证安装/重复、自启动链接、子进程故障重启及原绑定保持；网络启动依赖在夹具中代表已完成网络，未修改物理宿主网络。初次夹具缺sshd权限分离用户、tmpfs目录权限/旧绑定和网络依赖错误均修复并保留失败记录，不放宽生产校验。无实际整机重启证据。
- 真实空PG数据库+远端安装边界夹具覆盖缺管理/恢复保护不下发、失败持久、重试、并发重复拒绝和历史回执身份/域名失效；登记独立 `test:host-gateway-dns-integration` 及排除原因，CI在独立PG16任务运行。root Python两组各9项通过。真实浏览器保存/重读、补装失败→重试、缺身份禁用、三宽度/深浅色无横向溢出；inspector0 FAIL/1空白WARN（独立组件预览余下空白，完整页另有安装记录区块）。
- 全套planned/executed/passed177、failed0（`logs/test-run-20261023-204739/summary.txt`，7m17s），前后端类型、双端生产构建、dist边界、后台构建和新组件ESLint通过；最新小改的相关验证随后记录。证据在本地 `dns-service-runtime-result.json`、`dns-ssh-install-result.json`、`dns-openrc-result.json`、`gateway-page-browser/endpoint-browser-result.json`。未部署原客户宿主或新正式版本；完整OSS身份恢复、旧主控丢失/新IP联合演练、账务补偿及完整P0–P6继续。
- 阶段 b6ecea3 已推送，源码 CI 39957744733 的双架构组件和独立 PG 联调成功，网关守卫因无 DATABASE_URL 失败：通用 onboarding-ssh 顶层导入数据库配置。修正为实际 gatewayCommand 才按需加载端点设置；新增独立无数据库进程的预检回归，Windows 网关全守卫与 Linux 独立预检、服务器类型和构建通过。CI/首装及线上证据分开，本地177项使用占位DB配置曾掩盖此初始化依赖；后续新CI结论另记。
- 修正提交 c8c87f3 [源码 CI 39958461294](https://github.com/mastalee928/payincus/actions/runs/39958461294) 全部 success；原 b6ecea3 [双架构预览 39957814230](https://github.com/mastalee928/payincus/actions/runs/39957814230) 和修正后的 [双架构预览39958463692](https://github.com/mastalee928/payincus/actions/runs/39958463692) 双构建/首装全部成功，Release skipped。CI无数据库初始化依赖错误已闭环，未正式发版或部署客户主控。

## 2026-10-23 同机网关恢复的目标入口映射（新增源码）

- 平台环境恢复继续保留B的数据库登录、网站/公网入口及JWT/SSH指纹，仅恢复原数据加密身份。另核对备份WireGuard Interface中的唯一有效ListenPort，用它映射B现有域名/IP Endpoint端口，避免B新装默认端口与A原配置不一致。拒绝缺失/非法端口、非本机网关映射和缺目标SSH指纹；不从A环境覆盖B的SSH信任。
- Windows及ARM64备份守卫通过，类型和后台构建通过；双架构首装演练补充目标端口不同→恢复原端口→回滚保留目标环境的检查。此检查不是完整OSS A/B冷恢复验收，新预览实证随后记录。
- 映射提交 bb694ff [源码CI39959624357](https://github.com/mastalee928/payincus/actions/runs/39959624357) 和 [双架构预览39959627974](https://github.com/mastalee928/payincus/actions/runs/39959627974) 全部success；两种实际首装/恢复演练确认端口映射及回滚目标环境，Release skipped。

## 2026-10-23 控制签名身份纳入平台归档（新增源码）

- 提交0374bee [源码CI39961966190](https://github.com/mastalee928/payincus/actions/runs/39961966190)全部success；[双架构预览39961969761](https://github.com/mastalee928/payincus/actions/runs/39961969761)的AMD64/ARM64构建和实际首装全部success。两种架构均执行新增控制签名身份备份、恢复后核验和回滚；Release预期skipped，未创建正式发行或部署客户主控。此演练的OSS传输仍为本地替身，真实云端冷恢复/宿主重连联合验收尚未完成。

- 平台备份增加固定controller/signing.pem、identity.json、enrollment.json，备份前完整root登记验证及环境平台ID匹配。归档仅接受三项固定路径，保留加密认证/回读/完整性限制。
- 恢复要求三份完整、私钥摘要/身份/平台/发行信任匹配；旧组件路径不作为恢复目标，使用B已验签登记的组件目录重新生成登记信息，保留A原私钥及平台身份。写文件后和回滚后再次运行固定root登记验证器，失败保护模式不放行；环境平台ID从已核对身份映射。备份不包含可执行旧组件或任意归档路径。
- Windows与真实ARM64回归通过认证加密归档回读、原钥保持/目标目录映射、错误身份/发行信任/路径拒绝。真实Linux隔离mount和实际签名组件先创建两套A/Broot登记，再用生产恢复函数映射A到B，完整Python验证器确认A身份和B组件保持，证据controller-restore-real-result.json。未修改业务后端或客户资源。
- 双架构首装演练补充备份/恢复/回滚的私钥哈希、identity逐字节和登记验证器核对。最终全量177/177、failed0（`logs/test-run-20261023-212304/summary.txt`，6m28s）通过，相关备份守卫及真实root身份映射/ARM64归档回读通过；最终类型和后台构建通过后提交，CI/预览随后单独记录。较新撤销/事件和账目对账、72小时离线与完整OSS A丢失→B接管尚未完成。

## 2026-10-23 五分钟实例到期巡检（阶段源码，未发版）

- Owner 调整优先序：先验收「主控兼网关 A 丢失→B 从 OSS 恢复→固定直连域名切 DNS→原宿主重连」，并覆盖到期/续费和后台巡检；完整 P0–P6、四拓扑与 AC01–AC34 保留后续施工。最新状态见 [工程进度](GATEWAY_PROGRESS.md)。
- 巡检每 5 分钟同时检查当前到期时间、系统暂停状态和实际 Incus 状态，补停机并保留原暂停后 3 天删除政策；排除管理员手动暂停及免费实例，已续费旧暂停状态按最新日期纠正。续费及管理员延期和巡检共用实例串行通道，续费余额/实例版本事务保持；管理员付费/免费延期均递增版本，防止陈旧续费快照覆盖延期。
- 删除先建立远端可达性，失败保留可续费暂停；发送删除后回执不确定则保留 deleted + deletionBillingPending 及占用，不复活可能已经被删除的实例。以后巡检核对实际不存在、清理转发，在宿主行锁事务内释放地址/端口、重算计数、清除待核对标记。恢复保护和实例/恢复/上传任务期间不做冲突动作；等待执行的巡检拿到串行通道后再次核对恢复保护。
- 管理端计费概览增加真实调度状态、运行时间、下一轮、本轮失败、刷新/启动/立即执行。使用原黑白界面与已有字体；浏览器专项 1440/768/390、深浅色、启动/立即执行/失败/重复点击/运行禁用通过，无横向溢出；独立组件预览 inspector 0 FAIL、1 空白 WARN（预览只挂载该新增组件，完整计费页面仍有其它原有区块）。时间/错误计数在进程重启后重置，后台完全停止时不能由页面启动服务。
- 真实 Linux arm64 + 独立空 PostgreSQL + Incus 6.0.4 专用实例联合通过：断网暂停、同快照两笔续费仅一次成功和扣费、重连后续费实例保持 Running、3 天保留期到期停机/删除、确认不存在后库存归零、重复巡检无重复动作。Incus 在独立 mount/net、专用 delegated cgroup 及有界测试单元中运行，应用数据库独立；未改变客户实例或唯一业务后端。初次隔离未挂载 cgroup 控制层导致 LXC 监控 C 库崩溃/回执超时，修正测试环境后真实回执/删除通过，失败样本保留。
- 仓库新增可重复 `test:billing-expiry-integration`（必须显式 opt-in、空本机 *_expiry_test 库及 OpenSSL），覆盖 HTTPS Incus 夹具断网、重试、丢失 DELETE 回执和一次扣费/释放；登记全量排除原因并增加独立 PG16 CI 作业。该夹具与上一条真实 Incus 证据分开。证据：`logs/controller-takeover-research-20261022/expiry-real-scheduler-result.json`、`expiry-integration-result.json`、`gateway-page-browser/expiry-browser-result.json`。
- 最终全套 planned/executed/passed=176、failed=0（6 分 36 秒，`logs/test-run-20261023-190403/summary.txt`），专项 8/8、前后端类型、最终后台构建、此前本阶段双端构建和 dist 边界通过。Lint 0 errors、665 既有告警。源码提交和 Actions 状态另记；无新正式 Release 或客户后端部署；DNS 设置/旧宿主补装/联合 OSS 切换与错过自动续费对账仍未完成。
- 阶段提交 [f84a160](https://github.com/mastalee928/payincus/commit/f84a1601b49eb2f8aec24dc500f3c4ab0a070ac5) 已推送；[CI 39944597711](https://github.com/mastalee928/payincus/actions/runs/39944597711) 五项全部成功：独立 PG16 到期回归、amd64/arm64 组件包、Lint/类型、Build。源码/CI 通过不表示现有主控已部署该巡检。

## 2026-10-23 首装 sudo 解析兼容与拒绝阶段诊断（未发版）

- 后续 sudo 解析器拒绝命令参数里的 wildcard。网关/备份/OTA 安装和原子布局迁移规则统一只授权 root 固定 systemctl wrapper，继续由 wrapper 严格限制三个参数、start/--no-block 及管理任务模板/ID；不授权原始 systemctl。网关安装额外核对 wrapper 父目录不可写、root:root/0755 和发行源码逐字节一致后才安装规则。
- 安装 shell 守卫、网关/OTA/部署/备份 6 项检查、真实 Linux visudo、实际 incudal 用户 sudo 的有效 UUID/错误单元拒绝通过。实际 ARM64 预览包在隔离 mount/空状态目录的原安装入口与新规则均能登记两个架构并生成新独立测试身份，systemctl 在该测试内使用固定命令替身；没有安装到原业务主控全局目录。不能据该结果宣称 CI 首装问题均已修好。
- ARM64 CI 的身份准备拒绝在上述实际包重放中尚未重现。准备器仅增加固定 stage 字段（catalog、环境、组件验证/保存、身份和发布环境），不输出异常或文件内容；14 项 Linux 准备守卫含异常敏感文本不可外泄检查通过。后续预览以阶段提示定位 runner 差异，失败仍保持拒绝；禁止以忽略验签、放宽目录权限或重建已有身份替代修复。
- [acdfece](https://github.com/mastalee928/payincus/commit/acdfece8dd80ed2962abb1afe0801a5588d1655d) 已推送，[源码 CI 39945675497](https://github.com/mastalee928/payincus/actions/runs/39945675497) 成功。[发行预览 39945678206](https://github.com/mastalee928/payincus/actions/runs/39945678206) 两种构建成功，sudo wildcard 错误消失，两种首装均在 release-catalog 阶段拒绝。实际同份 ARM64 新预览包在独立 root 目录核对 catalog/版本/签名组件通过，尚未定位 runner 路径差异；继续细分固定阶段并在失败时输出属主/权限/大小/是否链接等非敏感元数据。Release skipped，无新正式发行。
- 诊断提交 43b668c [源码 CI 39947512535](https://github.com/mastalee928/payincus/actions/runs/39947512535) 成功。[预览 39947515057](https://github.com/mastalee928/payincus/actions/runs/39947515057) 两种构建成功、首装均拒绝 release-directory；非敏感元数据确证两种 GitHub runner 的 /opt 均为 root:root/0777，导致受信父目录检查拒绝，包内文件权限正确。一次性 GitHub 首装测试先核验 root 非链接 /opt 并移除 group/other 写权限，生产验签/登记检查保持。真实 Linux 隔离 mount 重现 0777 拒绝、chmod go-w 后实际签名目录通过，安装 shell 守卫通过；新预览结果单独记录。
- d1ca985 [预览 39948962555](https://github.com/mastalee928/payincus/actions/runs/39948962555) 两种构建成功，目录信任拒绝已消失。AMD64 在后续 OTA sudoers 遇到新版 parser 不支持 requiretty，移除该默认关闭的可选设置；ARM64 已安装、唯一后台/双端/管理员登录/机器池/Agent 下载通过，但备份演练报 OSS_ARCHIVE_INVALID。根因是 manifest 只接受数字版本，而既有 assertBackupVersion 已接受同提交 preview-hex；增加严格 7–40 位十六进制 preview 归档格式支持，同预览认证往返通过，跨预览恢复仍拒绝。Windows 与真实 ARM64 备份守卫、类型和后台构建通过，安装 shell 守卫通过；待后续预览重新核验，不宣称完整首装通过。
- 1f81d80 [预览 39950946588](https://github.com/mastalee928/payincus/actions/runs/39950946588) 两种构建、首装/登录/Agent、备份/预检/恢复/回滚/续跑及完整数据库/ZIP 数据校验通过，最后的历史版本迁移兼容演练均因 OSS_BACKUP_MIGRATION_FAILED 失败。迁移夹具目录继承首装 umask077，但 Prisma 使用 incudal 用户读取；仅将该无密钥、受信临时夹具目录设为0755、文件0644，不放宽生产迁移权限。授权 ARM64 主控仅创建独立临时数据库，在实际 umask077 下完整旧版本/CRLF迁移、金额保持及错误版本/数据库版本/未知迁移拒绝通过；唯一业务后端不变。新预览结果另记，未发布 Release。
- 迁移夹具修复 [7dd0887](https://github.com/mastalee928/payincus/commit/7dd0887) 已推送，[发行预览 39952149465](https://github.com/mastalee928/payincus/actions/runs/39952149465) 完整 success：两个构建及 AMD64/ARM64 全新安装验证均成功，Release 按无 tag 预览设计 skipped。首装包括唯一后台、双端/管理员登录/机器池与 Agent、控制身份登记、备份预检/恢复/回滚/续跑、完整数据库/ZIP 数据和历史版本/CRLF迁移验收；此前失败样本保留。DNS补装/完整OSS故障切换仍未验收，没有新正式Release或客户OTA。

## 2026-10-23 发行预览 AMD64 组件权限修复（未发版）

- 57c8411 源码 CI 39927406425 全部成功；发行预览 39927543459 的 ARM64 面板包构建完成，但 AMD64 在 root 侧组件验签失败，首次安装作业因此未执行。两种组件编译、Node 官方下载 SHA256 和固定签名公钥匹配已通过；不把 ARM64 构建或源码 CI 当作首装通过。
- 后续 c3d28c1 [预览 39929532392](https://github.com/mastalee928/payincus/actions/runs/39929532392) 两种构建成功，但两种首装均失败：AMD64 visudo 拒绝命令参数里的 wildcard；ARM64 在环境生成后拒绝控制身份准备。Release 作业 skipped，没有新 tag/正式资产或 OTA；这两项继续修复，不能把该预览记录为成功。
- 真实 Linux 复现严格 umask 077 下普通 cp -R 改变已签名文件权限，固定验证器按清单拒绝。CI/Release 的 root 拷贝改为 --preserve=mode --no-preserve=ownership，保留已核验来源模式且目标归 root，不放宽验证器。13 组包回归通过，新增先复现无权限保持失败、再验证正确拷贝成功的测试；Node 来源守卫增加两工作流参数约束。修复后的双架构预览另行运行记录。

## 2026-10-23 签名组件发行与首装准备接线（预览待验，未发版）

- Owner 明确授权生成专用 Ed25519 组件发行身份并配置仓库。私钥保存于仓库外受限 Windows ACL 目录，GitHub Secret `GATEWAY_COMPONENT_SIGNING_KEY` 保存私钥、变量 `GATEWAY_COMPONENT_SIGNING_PUBLIC_KEY` 固定公钥；只核对配置名称及公钥摘要，不记录凭据。原控制签名身份与该发行身份独立。
- 发行工作流原生 runner 构建 amd64/arm64 两套独立组件并纳入每个面板包：Node 官方 HTTPS 下载/对应 SHA256 核对、Go 交叉编译、bundle 源码身份守卫、固定公钥匹配、组件签名与 root 侧双架构验签。清单绑定版本/源码提交，首装准备器再次核对面板 version.json、server package 版本和两个架构完整包，不接受包内自行生成的未知信任。
- 新固定首装准备器将受信组件按清单哈希保存至独立 root 私有持久目录，首次显式安装后创建独立控制身份并只补 GATEWAY_PLATFORM_ID；环境文件原子替换，保留其它配置、属主/权限。已有 v2 身份服务启动只刷新组件目录，私钥/平台/固定信任保持；恢复保护期间不自动刷新，缺身份不在重启时重新初始化。没有重新安装网关服务或获取宿主写权。
- Linux 13 组真实双架构签名/文件/权限/并发首装准备回归通过，覆盖环境/原平台保持、错误信任/版本/面板提交、组件篡改/持久副本拒绝、缺身份/重复初始化与软链。网关/安装器/来源守卫、服务器类型与 shell 语法通过；新增 Python 测试登记双架构 CI，发行首装要求实际 catalog/identity 与业务服务用户无法读取控制私钥。前阶段 bb8dacd 的 CI 39924271193 全部成功。实际新双架构发行预览及原安装包首装结果在运行后另记，不能以本地回归替代。
- 此阶段仍不代表完整 HA：控制身份的备份/恢复与较新事件对账、已有 v1 迁移/连接/更新、业务路径与见证接管、全部 34 项及 72 小时演练尚需继续。未打标签、未创建正式 Release、未执行生产 OTA。

## 2026-10-23 显式网关控制身份登记（阶段交付，未发版）

- 增加 root 固定 JSON 登记器与安装器显式 `--configure-gateway-controller --initialize|--refresh|--verify` 入口。正常业务服务启动仍只安装受限 worker，不自动生成身份。初始化验签已登记架构组件后生成独立 Ed25519 控制私钥，root:root/0600，绑定平台/控制公钥摘要/组件信任的 identity.json 与 v2 enrollment.json 原子发布；组件发行公钥不得由待安装软件包自行信任。
- 刷新仅更换已验签组件目录，保留原控制私钥/身份记录/信任根；平台或组件信任改变、私钥替换、身份缺失/损坏、重复初始化、软链、宽权限、部分初始化及并发登记全部拒绝，不自动修复或重建身份。Node 安装驱动兼容已有 v1 登记，对 v2 严格核对 identity.json 和当前私钥公钥摘要；没有扩展 Web 请求的签名/目录/命令权限。
- Linux 新隔离目录的 12 组真实签名/文件权限/并发登记回归通过；使用已有真实受信 ARM64 组件包完成显式初始化→刷新→同一签名身份核对，实际 Node 驱动读取 v2→本机预检/包验签→生成已有安装阻断计划通过。临时替换新测试控制私钥使驱动在访问目标前拒绝，随后按原字节恢复；测试不修改既有网关/业务配置。证据 `gateway-enrollment-live.json`，原唯一后端 PID 99939 保持。
- 相关网关/安装/权限守卫、服务器类型/构建、安装器 shell 语法及完整 installer guards 通过。登记 Python 回归加入 amd64/arm64 组件 CI，发行脚本包含登记器。前阶段 db3e2b4 的 CI 39922181130 已核对全部成功。本阶段不改前端、版本或生产；新增阶段 CI 结果另记。
- 此入口是明确受信登记基础，正式发行签名组件的自动准备、默认平台身份映射、平台备份中的控制身份/较新撤销事件恢复、已有网关连接/更新仍未闭环。不得用显式首次初始化代替旧控制身份灾备恢复；完整 P0–P6、AC01–AC34 及发布门槛仍待继续。

## 2026-10-23 管理网关安装页面与一次性材料领取（阶段交付，未发版）

- 机器池已登记网关新增安装管理：读取实际目标与持久预检配置、生成受信安装计划、查看版本/架构/源码提交/计划摘要/期限/具体变更，当前管理员密码/MFA 与完整任务确认语句提交安装；提供持久任务刷新、未开始取消、逐步执行状态和回执。过期/阻断计划没有安装动作，中断保留待核验及目标占用，不自动重放或通过新任务覆盖。
- 一次领取首次独立登录密码、MFA 密钥和恢复码，Base64 种子转换为验证器可用 Base32，并提供用户主动下载。材料只在页面内存显示，领取后数据库副本立即清除；折叠/离开/保存完成清空显示，不写浏览器存储或剪贴板。领取要求当前密码及已启用的 MFA；列表/计划/日志没有秘密。安装成功继续显示自主备份、宿主写服务和独立证书维护三项缺口，不宣称灾备就绪。
- 实际浏览器合同样本覆盖成功/失败状态、确认取消/Escape/焦点、立即重开窗口、重复提交仅一次请求、期限/阻断、取消、刷新恢复、中断待核验及领取后清除；修复旧 close 事件误清新对话框状态。真接口发现持久预检 request 额外包含服务器身份字段，页面只提取六个安装字段，严格 schema 不放宽；父列表不再把安装任务显示成未完成检查。三语同步，新增行为边界并入现有前端路由守卫。
- 在 owner 核实 SSH 身份的授权测试主控使用新建空隔离 PostgreSQL 数据库，经固定 SSH 本机转发连接真实 API。实际页面检查→真实 root worker 准备/包验签→现场已有安装阻断→无确认安装按钮→取消→刷新后仍 cancelled 全链通过，1440/768/390 无横向溢出；不覆盖已有网关，也不访问业务库。外层 Web 会话与 worker 调度入口仍是明确集成钩子；不是完整生产登录与 sudo 派发链路。成功安装/密码MFA/首次领取的原真实后端证据另行复核，原任务 succeeded、材料/临时凭据已清除，两项独立服务 active/NRestarts=0。
- 沿用 Data terminal（seed 779163351）与现有黑白字体/配色，无重抽。安装明细浅色及手机布局实际 inspector 0 FAIL/0 WARN，源码 monospace 提示用于真实ID/密钥/哈希/路径/地址保留；浏览器样本和真接口证据分别为本地 `gateway-page-browser/installation-browser-result.json`、`installation-live-result.json`。前后端类型、前端路由/i18n、网关任务/路由及控制协议/认证/备份相关守卫、新文件 ESLint、双端构建与 dist 边界通过。未更改业务后端源码、版本、正式 Release 或生产 OTA。
- 此阶段不等于 P3 或 AC01 完整验收。默认受信组件/身份首装接线、已有连接/更新、真实新装与一次领取完整页面链、备用准备/切换/切回/恢复、独立通知与证书维护、全部 34 项及 72 小时离线仍待继续。

## 2026-10-23 后台网关安装任务与受限调度（后端阶段，页面待接）

- 新增安装计划请求、确认、取消和首次凭据领取接口，沿用管理员/Web 会话/管理端 Origin 边界；接口不接受命令、执行路径、签名材料或客户端回执。准备阶段登记期望配置、固定目标和软件包后生成完整计划；确认通过当前密码及已启用的 MFA，批准绑定凭据状态和当前会话。MFA 步数在 PG 持久防重放，密码/MFA 状态改变使旧批准失效；额外按管理员限制连续认证失败。
- 准备租约、计划、回执和一次领取的加密材料进入既有任务日志。主控重启后可读取状态；中断安装保留目标占用，未开始的失败任务可重新规划。后台定时清理过期租约、引导凭据和材料，调度启动失败会显式结束或保留待核验状态。数据库锁明确忙碌时只重试事务，不自动重试 SSH 或特权命令。
- 固定 root worker 通过 UUID 限定的 systemd/sudo 入口运行，与 OTA/恢复共享操作锁，执行前校验已封存代码。平台签名身份及双架构组件目录来自单独 root 私有登记，组件发布签名与平台控制签名要求分离。远端仅传公共受信包与结构化配置，固定 SSH 指纹；首次密码/MFA/恢复码加密回存并绑定原确认会话短期领取，任务列表和日志均隐藏秘密。引导认证材料和正式组件目录的自动初始化/发行接线仍需后续完成。
- 修正只读预检误要求 root：普通后端用户可以读取基础事实，无法读取的特权事实保持阻断，由 root 计划阶段复核。授权 Linux 机器以 nobody 身份实际执行 8 组预检测试通过，没有开放写权限。新 root 调度器不会启动第二套业务后端；独立网关服务不随业务进程停止。
- 两条新增迁移仅应用于新建隔离 PostgreSQL 数据库。既有日志 11 组回归和新增安装 12 组真实事务检查通过，覆盖准备租约、密码/MFA、跨新进程防重放、计划幂等、版本只推进一次、一次领取、凭据变化、真实锁竞争重试、超时占用保留及恢复上下文变化。恢复冻结 SQL 在隔离事务内执行并回滚验证；旧的文本状态网关任务在真实恢复流程的 staging 数据库中冻结，旧批准、会话和秘密清除，避免数据库回退后自动重放。业务库未执行此次迁移或恢复。
- 授权测试主控的 HTTP → 持久计划 → 密码/MFA 确认 → 同一 root worker 函数 → 实际本机安装 → 回执/首次领取已联调。外层会话和调度启动使用明确的集成钩子，密码/MFA、PG、受信包与目标执行为真实实现；不是完整生产 UI/登录链路验收。实际任务成功、全部步骤有回执、配置版本为 1、首次材料及临时 SSH 凭据已清除。末尾重复领取曾误返回 503，修正后在原成功任务上复验为 400/GATEWAY_BOOTSTRAP_UNAVAILABLE/no-store，未重装。原业务后端 PID、默认 IPv4 路由及无计数器 nft 规则保持。
- 另以 incudal 用户的真实 sudo/systemd 入口，在隔离挂载的源码、环境及操作锁下运行已封存 worker：正常执行通过，非法单元名、源码变动及被占用维护锁被拒绝，释放测试锁后正常恢复。全局 wrapper 已按原哈希恢复，临时单元/规则/覆盖文件已移除。首次测试锁的子进程释放不完整导致末次失败，改为测试进程自身持锁后整轮通过，不将失败样本计入通过。
- 服务器类型/构建、网关/认证相关守卫、日志脱敏、OTA、平台备份及来源守卫通过；新增 TS ESLint 与 shell 语法通过。实证 `gateway-installation-api-live.json`、`gateway-controller-helper-live.json`，详细材料在本地 `logs/controller-takeover-research-20261022/`。本阶段未改前端源码、未创建正式 Release、未执行生产 OTA。确认/材料页面、既有网关连接/更新、过期中断的完整恢复、保护模式页面及整体 HA 仍待继续。

## 2026-10-23 独立网关组件包与运行验证（阶段交付，未发版）

- 组件包基础提交 `f27a57c` 已推送；[CI 39895823020](https://github.com/mastalee928/payincus/actions/runs/39895823020) 全部通过，包括 amd64/arm64 原生包构建/验签/进程验收、类型/Lint/守卫及完整构建。
- 后续新增 root 侧完整安装计划和固定新装执行器。计划绑定物理机器、当前预检摘要、包清单哈希、已提交源码身份及平台签名配置，有明确期限；包/平台信任来自单独受保护策略。已有接口、服务、执行文件或安装身份进入连接/迁移流程，不隐式重装。执行器不接受 shell/任意目标路径，持久保存原请求、步骤与独立密钥，中断后仅在原确认仍有效且配置一致时续跑；缺密钥、文件/服务变更和同提交下的另一个签名包拒绝。安装后及重复执行重新检查当前内核接口、公钥、端口、地址和 peer，资源写权仍为 false。
- 授权灾难测试机的新平台测试身份已实际完成 root 安装→两个独立 systemd 服务→真实 HTTPS 登录/状态/退出→重复同请求返回相同回执→服务重启后身份不变。新服务 NRestarts=0，最终内核检查代码在该实际接口执行通过。初次安装前后业务后端 PID、IPv4 默认路由与完整 nft 规则哈希一致；IPv6 原始哈希因 RA 动态 expires 字段变化，不能当作完全一致证据，随后排除该倒计时后的双栈默认拓扑/规则/PID 在新服务重启前后保持一致。没有执行客户实例操作。
- 安装流程使用独立固定证书和随机密码/MFA/恢复码，秘密只留 root 私有 bootstrap 文件；公网 HTTPS 认证使用该证书校验通过。现阶段仍明确列出自主备份登记、宿主写服务及公开证书生命周期阻断，不将固定证书当作完整自动续期方案。实际包内 Python 导入曾生成 __pycache__ 导致严格验签拒绝，已禁止生成字节码，不放宽额外文件守卫。新增安装材料进入固定组件清单，现为 20 项。
- 12 组计划守卫及 10 组执行器文件/中断守卫通过；后者明确使用服务命令替身，不替代上述真实 systemd/公网验收。相关服务器类型、候选/租约/认证/控制台/备份与网关任务守卫、新增 TS ESLint 通过。证据 `logs/controller-takeover-research-20261022/gateway-install-executor-live.json`。页面计划/确认、受限 worker 调度及回执入库接线仍待继续；这一步没有新建业务后端或正式发行版本。
- 接手原目标，继续 P0–P6、四种部署拓扑及 AC01–AC34；每个已验证的大步骤按 owner 授权提交推送，完整上线门槛达成后才正式发版。原目标无 token 预算上限。页面安装/切换、业务管理路径接线、完整故障恢复和 72 小时离线等验收仍未完成。
- 新增显式组件构建器、Ed25519 清单及 Linux 验证器：包含 Node、三个独立 Go 命令、控制台/备份/发现/见证独立 bundle、静态资源和固定安装脚本。固定版本、源码提交、架构、协议和文件清单；拒绝错误签名/身份、篡改、额外文件、链接、错误权限与非匹配 ELF。安装器、构建器、依赖清单与运行源码都必须在已提交且未改动的状态，构建结束再核验来源；无自动生成发行签名身份或发布动作。
- OSS bundle 明确拒绝可选代理分支，保留现有受控 HTTPS 直连；清理上轮试装代理留下的依赖锁变化，锁文件仅增加既有 esbuild 的根构建依赖。包文件显式设置权限，严格 `umask 077` 下仍与验签清单一致；bundle 检查禁止导入业务后端、Prisma、dotenv 和 worker。
- 授权 ARM64 测试主控的隔离源码快照完成真实构建/验签、12 组 Linux 包验证测试及 14 项包内进程验收：独立账号初始化/重复初始化拒绝、HTTPS 登录/退出/恢复码重放拒绝、缺失传输状态返回未就绪、发现读取及重启防重放、见证 mTLS/互斥/持久代次，以及隔离网络中 OSS 失败不发布完成状态。所有服务仅运行于新建测试目录与 loopback，没有启动第二个业务后端。
- 使用包内 Node 和备份入口在新 OSS 测试子前缀实际上传、回读、解密并提取七项 B 网关资料，逐文件哈希与来源一致；恢复资料未激活，不修改 B 身份或客户资源。证据 `logs/controller-takeover-research-20261022/gateway-component-package-live.json`；构建源为独立验收快照，不当作正式发行构建。相关守卫、服务器类型/构建及新增测试 ESLint 通过；本阶段没有前端源码变化。
- CI 新增 amd64/arm64 原生组件构建、独立验签和包内进程验收；提交后的 CI 结果另记。包内运行通过不等于页面安装、受信 root 执行器、全部故障切换或正式 Release 已完成。

## 2026-10-23 签名候选与独立发现基础（隔离实测，完整接管未完成）

- 后台网关任务补齐持久底座：固定平台/网关/物理machine-id与SSH指纹，严格计划哈希、独立步骤operationId、单目标活动任务约束、PG事务前有界排队及跨进程非阻塞锁。失去执行租约转needs_review并保留机器占用，不自动重放；重新确认后要求started步骤对账。全部回执与配置版本校验后只推进一次版本，凭据与执行租约不进入公共select，结束/过期清除凭据。尚未开放任务API、页面执行或特权安装接线，摘要回执不是物理证明，不标HA就绪。
- 任务底座提交9b526f5已推送，[CI 39883087278](https://github.com/mastalee928/payincus/actions/runs/39883087278)成功。随后新增统一只读网关预检：本机固定execFile无需SSH、远端固定python stdin，读取实际机器/系统/服务归属、接口alias与地址、全路由及UDP/TCP监听；错误目标、既有路由重叠、未知服务和占用HTTPS端口阻断。Node严格校验报告并重新计算请求/现场摘要。实际主控ARM64本机执行器、固定SSH指纹的A网关amd64远端执行器、B状态、错误机器ID/占用端口/路由冲突通过；证据 `gateway-preflight-live.json`、`gateway-preflight-local-bound.json`、`gateway-preflight-remote-bound.json`。A/B使用专用Node目录，系统PATH缺Node按事实显示依赖缺口，未自动忽略。Python7组冲突守卫、Node请求/报告边界、双端类型及相关候选/机器池守卫、服务器构建与新文件ESLint通过；尚无页面任务/安装执行接线。
- 预检提交c00591e已推送，[CI 39884135967](https://github.com/mastalee928/payincus/actions/runs/39884135967)成功。继续接机器池只读网关列表/任务查询/inspect路由，要求当前管理员及Web sid/Bearer/精确管理端Origin；严格schema、限量/限频、错误信息只输出固定码。平台ID从配置读取，本机不用SSH，远端固定一个公网IP及SSH指纹。检查报告与摘要回执原子持久，重复请求返回原报告，变更参数复用请求ID/重复物理机器身份拒绝。succeeded仅指检查完成，依赖/冲突阻断仍显示，canWrite=false；没有安装/应急写入口。
- 新报告迁移仅应用隔离库；真实ARM64主控本机检查API、A网关amd64远端检查API均通过登记→预检→持久查询→重复提交，身份重复/参数冲突/本机凭据拒绝；接线后11组真实PG事务回归通过。证据 `gateway-management-route-live.json`、`gateway-management-remote-route-live.json`、`gateway-task-journal-route-regression.json`。真实Fastify权限/Origin/schema守卫已登记根清单与CI（175项），相关类型/管理员/会话/任务守卫、服务器构建、新文件ESLint通过；未改变业务数据库或客户宿主管理入口，完整HA及页面安装仍未完成。
- 检查接口提交3f070ea已推送，[CI 39885428821](https://github.com/mastalee928/payincus/actions/runs/39885428821)成功。机器池新增管理网关页签：本机/独立/已有目标选择、预先核验SSH指纹、临时凭据、管理网段/端口、真实检查及持久阻断。本机无SSH字段，提交/切换/离开清除表单秘密，列表重新检查恢复原身份；新增页签方向键/Home/End及焦点转移。保持黑白token和既有机器池行为，没有安装/控制权按钮冒充可用。
- 使用design-taste-frontend及fixing-accessibility，延续Data terminal（seed779163351，保留品牌字体/配色，无重抽）；浅深色1440/768/390真实浏览器检查0 FAIL/0 WARN，身份/网段等宽提示按用途保留。真实页面调用隔离主控API完成检查→刷新→重查路由冲突、模式切换清凭据、焦点及手机无横向溢出，`gateway-page-browser/live-result.json`；样本会话只在隔离服务，不替代正式权限守卫。双端类型/路由/i18n守卫通过（`logs/test-run-20261023-102154/summary.txt`），双端构建/dist边界/服务器构建及修改文件ESLint通过。发行工作流、首装检查补入预检Python文件，配置示例加入稳定GATEWAY_PLATFORM_ID；正式Release与业务部署未更改。
- 新增迁移仅应用于新建隔离PostgreSQL16数据库；在授权测试主控独立Node22 ARM64目录执行11组真实事务验收，覆盖8路重复请求、跨进程锁竞争、新进程重读UTC租约（数据库会话Asia/Shanghai）、中断保留占用/同operationId对账、回执重放/冲突、精确确认/过期、版本只推进一次、管理员撤销与远端凭据过期清除。两次同机验收通过，证据 `gateway-task-journal-live.json`。跨机SSH隧道样本发现默认5秒事务排队超时，修为事务前排队；新进程首次连接抖动另以同机隔离连接完成正式证据，不把失败样本计作通过。
- 14项新增守卫已登记根清单及CI，清单现174项；相关双端类型、候选/发现、管理员权限、会话状态、机器池守卫通过，服务器构建与新增文件ESLint通过。没有前端文件变更，没有在业务数据库应用迁移，现有唯一测试后端active、NRestarts=0。最新前三阶段提交ac1b09e/183bedd/706af0d的CI与Agent构建已复核成功；本轮不更改版本、标签或正式Release资产。

- 接手原聊天后继续原完整网关/灾备规格（截图最初26项，现行规格已扩展34项）：目标仍为页面灾备准备→新页面恢复并确认→宿主主动读取签名配置/建新通道/上报；双通道、独立备用身份、旧写者隔离、历史副本和部分失败均须交付。没有缩减为测试机通讯修补，旧主控与客户宿主保持原运行状态。
- 新增独立准备隔离 `--prepare-fence`，本地受保护登记ssh/incus端口，远端候选和见证许可均需验签；重读并锁住最高代次，nft检查后重新按当前时间核验有效期，拒绝无关同名表/额外规则/休眠或设备绑定，执行后核验实际规则。仅阻断宿主外部管理INPUT TCP，不开放候选写入、不取消Incus任务、不动客户FORWARD/DNAT、WireGuard、SSH密钥或Agent地址。输出networkFenceApplied=true仍保留凭据/本地进程及活动任务阻断，canWrite=false。
- 真实Linux隔离net namespace中，实际Go生产路径及维护命令验证7项：双签名和磁盘水位→原子规则及重试→缺失登记端口拒绝/隔离后读取失败无成功输出→IPv4/IPv6旧连接字节与新连接拒绝→相同管理端口上的客户DNAT/FORWARD既有/新连接保持→loopback与其它INPUT可用→客户规则一致。Go全包race/vet通过；真实Incus6.0.4在独立mount/net/pid namespace验证活动与结束任务均准确报告，隔离不取消已接受的任务。证据 `management-fence-command-final.json`、`maintenance-prepare-real-incus.json`；新增可复验脚本 `scripts/test-controller-management-fence-netns.py`。尚无重启门禁、旧凭据/进程审计或租约代理，未上客户宿主、未发新版本。
- 本轮全清单通过四分片覆盖173项（44+43+43+43），每个进程独立exit=0，另过服务器编译、Go全包race/vet及真实准备命令/Incus联调；Lint 0错误、665条既有格式告警。分片2记录 `logs/test-run-20261023-033925/summary.txt`；并发分片1/3/4因同秒启动共用日志目录，分别的成功结果另存 `logs/controller-takeover-research-20261022/maintenance-suite-shards.json`，不能只以被覆盖的单份summary作为173项证据。此前单次全量033022因会话中断仅执行部分，不作为全量通过记录。本轮没有前端源码变化，双端构建不作为新增证据。
- Owner更新目标：完成P0–P6，在130.61.72.222测试机核验主控兼网关、独立网关、主控经独立网关及备用网关；旧主控允许作为灾难演练机器。必须复审代码、权限/回放等基础漏洞及实际前端按钮，全部上线门槛达成后才提交最终实现、推送及发版。准备隔离只是阶段成果，不触发提前发版，也不授权破坏客户实例/磁盘/账务。
- P0新增实现决策 `GATEWAY_CONTROL_DESIGN.md`，明确独立单写文件见证的故障/恢复边界、短租约与boot/gate身份、固定管理代理及A/B传输映射。Node/Go短写租约编码36项共同向量通过，Go LeaseGate单调截止/重复不续命/撤销重放/错误持有者与范围/过期和进程重开拒绝通过；逻辑时间随单调时间前进，回拨不复活。最终Go全包race/vet通过，相关Node守卫通过，新增编译及类型证据随后确认。尚未接入见证签发、真实凭据/进程审计、端口代理或资源动作；不能据此标P0完成，见证仍signedWriteLeaseAvailable=false。证据 `write-lease-go.json`。
- 继续补写请求的持有者证明：精确租约/正文哈希、权限、时间和nonce签名，9项Node→Go共同向量通过；错误正文不消耗nonce，8并发同请求仅一次授权，过期证明/改权限拒绝；公开门禁不接受公钥摘要作为写认证。时间校验与租约共用不回退逻辑时间，nonce覆盖整个最长租约并在续期中保留。Go全包race/vet通过；服务器类型检查及编译通过，候选总守卫包括新增租约/证明检查。证据 `write-lease-request-go.json`，仍无真实执行端点或签发。
- 见证继续接入内部短租约签发/续期：固定初始化的见证签名身份，验证新鲜host-fence-receipt及绑定boot/gate/持有者的controller-gate-proof；租约序号原子保存，重启重读并验签落盘对象，错误密钥/新gate/旧epoch/并发冲突拒绝。Windows30项、Linux32项见证守卫通过，Node/Go gate proof编码测试通过，证据 `witness-write-lease-linux.json`。目前使用签名夹具，无实际宿主凭据/进程审计或写代理，公开可用状态仍false，不能标物理隔离/接管已完成；上一条“无签发”为当时状态。
- 准备报告加入真实本机processAudit：确认procfs、两遍核对PID/父链/UID/名称/启动ticks，SSH会话及后代任务计数、监听进程分列、父链变化不冒充稳定；不读取cmdline/environ。真机发现内核启动早期ticks=0合法，已兼容。真实procfs读取/取消、父链循环/缺失及解析边界、最终Go全包race/vet通过，证据 `process-audit-go.json`。脱离SSH的旧任务及本地root写者仍未完成隔离审计，localWriterAuditComplete=false并继续阻断；不能据无SSH会话签发完整物理回执。
- 内部HostOperationExecutor加入固定inspect-operations与既有默认项目实例start/stop/restart协议，拒绝任意Incus路径/原始shell/创建删除/force和路径穿越；先租约+持有者正文证明，再查活动任务/实例身份，最后发固定电源请求。执行上下文受剩余租约时限与Revoke取消绑定，已接受任务仍须后续核对。真实Unix API替身验证错签名不触达、忙任务不写、重复不二次执行、撤销拒绝，Go全包race/vet通过；无网络监听/正式服务，没有更改客户实例。证据 `host-operation-go.json`。
- 真实Incus6.0.4隔离mount/net/pid环境通过内部执行器的租约+持有者证明只读链，活动与结束任务均准确检出；未提交真实实例电源操作。证据 `host-operation-real-incus.json`。随后加入准备前持久network-fence.json及 `--restore-fence`：原子保存签名拒绝授权，启动仅恢复已授权拒绝；隔离网络中删除运行期表模拟规则丢失，恢复与端口变化拒绝、双栈客户转发保持均通过，Go全包race/vet通过，证据 `management-fence-startup.json`。尚无已安装init启动顺序、旧凭据/本地写者完整审计，未标整机重启或完整接管验收。
- Owner 后续明确改为每完成一个大步骤、通过对应验证后立即提交推送，不再积累到全部阶段结束；此前“最终实现完成才提交”不再适用于阶段源码提交。完整灾备验收与发布仍分开记录。
- 继续补齐独立 incudal-maintenance HTTPS 准备服务：TLS1.3 客户端证书认证，逐请求候选/见证验签；只开放检查与拒绝准备，私有/loopback 独立端口、同宿主身份 flock 单服务；先恢复持久签名拒绝再监听。拒绝查询/编码路径、未知接口、超限/压缩正文和并发准备，失败不泄露配置或部分输出；SIGTERM 关闭监听，保留拒绝状态。尚无租约写入口、完整本地写者审计或正式宿主启动安装。
- 本阶段最终全套检查 planned/executed/passed=173、failed=0，`logs/test-run-20261023-044946/summary.txt`；服务器构建通过。独立 Ubuntu 24.04 amd64 的完整 Go race/vet 与维护服务构建通过，证据 `maintenance-service-race.json`；真实隔离 net namespace 中，生产 HTTPS 服务恢复签名隔离后监听、mTLS 检查、不同端口重复服务及缺失状态拒绝、停止关闭监听均通过，双栈客户转发规则保持，证据 `maintenance-service-lifecycle.json`。CI 增加维护命令的 race 检查；没有前端源码改动、真实实例电源操作或整机重启验收，不作为完整P0–P6通过证据。
- 基础阶段提交 [69d9fe6](https://github.com/mastalee928/payincus/commit/69d9fe6eaddba419a17aa33312f2ae4d61f8b33e) 已推送；[CI 39854695406](https://github.com/mastalee928/payincus/actions/runs/39854695406) 和 [Agent 构建 39854695385](https://github.com/mastalee928/payincus/actions/runs/39854695385) 成功，版本与正式发行资产不变。
- 独立见证补齐受信首次初始化、身份清单和mTLS状态/准备/激活/租约接口：签名身份固定，证书精确绑定主控/持有者/节点范围，同节点请求串行；已有/缺失/损坏状态不能重新初始化。Windows26项接口守卫、服务器类型和构建通过；独立Ubuntu amd64真实CLI验证mTLS、重复权威拒绝、重启保留代次、缺失/损坏拒绝、正常退出关闭监听，单节点样本RSS约62MiB，证据 `witness-service-cli.json`。夹具签发租约不构成真实宿主物理隔离，正式部署/恢复流程、宿主采集与写代理尚未完成。
- 见证服务阶段 [01d63c8](https://github.com/mastalee928/payincus/commit/01d63c8916a5e3f3c6e0ffc0cd3c6074948698e6) 已推送，[CI 39856820346](https://github.com/mastalee928/payincus/actions/runs/39856820346) 成功；独立Linux26项接口及正常/强制退出CLI重启验证通过，证据 `witness-service-linux-final.json`。
- 双通道基础增加host-management-channels/v1及独立incudal-channels命令/服务：a/b不同公钥、接口与/32控制路由，预检全部路由表/地址/接口归属，拒绝隐式替换/退役；签名高水位及不可变本地身份持久化，缺失初始化状态拒绝。已过Node/Go10共同向量、服务器类型/相关候选守卫和编译（`logs/test-run-20261023-053639/summary.txt`），完整Go race/vet。实际WireGuard隔离namespace验证双握手、A断链/B保持、客户默认路由不变、运行接口丢失恢复、过期本地恢复/过期更新拒绝、实际命令与单服务及状态丢失防回放；证据 `channels-go-netns-final.json`。尚未配置真实A/B机器通道、正式安装/init顺序、页面或租约写代理，不作为整机HA完成证据。
- 双通道基础 [2cb03a0](https://github.com/mastalee928/payincus/commit/2cb03a0dad21e39015e2426c3c70a332a57079ce) 已推送，[CI 39859758227](https://github.com/mastalee928/payincus/actions/runs/39859758227) 和 [Agent 构建 39859758302](https://github.com/mastalee928/payincus/actions/runs/39859758302) 成功。随后新测试主控arm64通过同源incudal-channels连接两台独立amd64网关专用身份/网段，真实UDP双握手与探测通过，A测试接口停止后B继续、主控健康/默认路由保持，证据 `channels-live-cross-machine.json`。仅使用新建测试接口，不宣称现有客户宿主已双通道覆盖。
- 新增显式通道服务安装计划/哈希检查及systemd/OpenRC单元。实际Debian测试主控systemd通过：错误哈希拒绝且现存unit/进程不变；启动前恢复接口，停止服务不删除通道，丢失B接口后启动重建并在有限18秒探测窗口重握手，主控后端进程及默认路由不变；服务内存约5–11MiB，128MiB限额。证据 `channels-systemd-live.json`，安装器相关守卫通过。整机重启、Alpine/OpenRC、真实宿主与发现/页面下发仍待后续验收。
- 安装阶段[aecc28b](https://github.com/mastalee928/payincus/commit/aecc28b23afb8d71d92dcbefa22babbd4e2f0de3)已推送，[CI 39861248743](https://github.com/mastalee928/payincus/actions/runs/39861248743)成功。后续独立发现增加节点签名路径绑定的双通道领取与持久发布；Go常驻服务可配置独立HTTPS/节点seed/CA，失败报告并保留当前通道。服务器类型/构建/相关守卫通过（`logs/test-run-20261023-060002/summary.txt`），Go全包race/vet通过；独立发现服务守卫增至34项。
- 实际新测试主控Go经独立见证机HTTPS读取并应用新签名通道代次，旧代次再次发布后被宿主持久水位拒绝；停止发现进程时通道服务持续运行，A/B均可达并记录读取失败，证据 `channels-discovery-live.json`。测试中发现A接口down/up丢失独立回程host route，恢复测试路由后双向探测通过；正式网关服务仍需负责持久协调，不以握手替代路由/通信实证。该试验不是现有客户宿主通信接管，也未验证主控整机灾难、网页发布或资源写者隔离。
- 网关传输增加签名配置、持久身份/代次、peer墓碑及独立incudal-gateway服务/安装器。Node/Go10共同向量、服务器类型与相关守卫通过（`logs/test-run-20261023-061816/summary.txt`），完整Go race/vet通过。实际隔离内核验证接口down后的peer回程路由恢复、冲突/签名拒绝、撤销落盘中断后重试、旧快照拒绝及墓碑不能复活；证据 `gateway-transport-go-final.json`。
- 实际两台独立Ubuntu amd64网关安装同源专用传输服务，systemd启动/停止/恢复回程路由及新测试主控双向探测通过，B重启重连测得19289毫秒；证据 `gateway-transport-live.json`。测试机专用网段/身份，不修改客户资源；仍无网关Web/MFA、自主OSS备份、宿主真实审计写代理或完整整机灾难验收，不作为P0–P6全部完成证据。
- 网关协调[1d1ed2d](https://github.com/mastalee928/payincus/commit/1d1ed2d30c19025bf4cd2a442f33e5cc2cf4de60)已推送，[CI 39864715146](https://github.com/mastalee928/payincus/actions/runs/39864715146)和[Agent构建39864715109](https://github.com/mastalee928/payincus/actions/runs/39864715109)成功。
- 本地写者审计补齐固定可执行/配置哈希、UID/capability/Incus管理组、procfs二次进程及exec变化、Incus socket/netlink/BPF描述符、调度清单与NOFOLLOW/文件边界，接入受保护维护登记的可选writerAudit。Linux实际未知root进程、文件权限/取消及非root管理组守卫、完整Go race/vet通过，证据 `writer-audit-go.json`；服务器类型/候选守卫通过（`logs/test-run-20261023-064107/summary.txt`）。事实清点不构成旧授权/本地任务实际隔离，ManagedWriterIsolationVerified仍false、原阻断项保留，未据此签发完整宿主回执。
- 网关独立认证/控制台：scrypt密码、持久TOTP防重放/恢复码消耗/登录锁、账号版本撤销及进程会话；HTTPS Cookie/Origin/CSRF/CSP、限量本机ip/wg状态和固定接口。18项认证及19项HTTPS守卫通过，服务器类型/构建、前端路由、双端构建/dist边界通过；浏览器实际登录、恢复码展开/重放拒绝、刷新、黑白主题/退出，1440/768/390布局无横向溢出。设计源码检查0失败，渲染检查0失败、登录屏留白和skip-link边界识别两条提示已解释；证据 `gateway-console-browser.json`。状态行使用明确样本，不代替真机验收。
- 两台独立Ubuntu amd64网关的真实HTTPS控制台登录/peer接口和完整回程路由/退出/恢复码重放拒绝通过，独立systemd服务NRestarts=0、各约30MiB内存，传输服务持续运行；证据 `gateway-console-live.json`、`gateway-console-systemd.json`。安装器拦截官方Node包保留的非root构建UID，测试目录修正归属后通过。运行配置已移除初始化密码/MFA材料。当前只读及写门禁/备份阻断如实显示，正式独立证书续期、主控页面配置、应急写、OSS自主备份和完整灾难验收尚未完成。
- 自主备份基础加入独立scrypt/AES-GCM归档、身份/文件哈希和受限OSS前缀、回读认证后完成标记、全量历史保留及恢复ID保护；备份/清理与恢复互斥，常驻定时与所有源变更触发。备份失败保留上次完成时间，控制台读取实际覆盖代次。相关服务器类型/构建及17项加密/失败/保留守卫通过（`logs/test-run-20261023-075422/summary.txt`），后续客户端越界操作检查另跑同守卫。
- 在独立B的真实OSS新测试前缀上传/回读/解密、7项资料空目录提取与私钥/传输字节一致通过，另一个测试机器用独立恢复密码从OSS冷恢复哈希一致；证据 `gateway-oss-live.json`、`gateway-oss-cold-recovery.json`。停止新测试主控Node期间，B自主调度完成新云归档，完成时间在故障窗口内，传输/控制台继续；主控已恢复且健康。证据 `gateway-oss-controller-offline.json`。1小时周期下认证配置变化触发新归档，证据 `gateway-oss-change-trigger.json`；实际控制台显示完整备份但保持无写权限，证据 `gateway-oss-status.json`。真实RAM越界、72小时/整机故障、磁盘满/限流/独立告警及完整恢复激活仍未完成，不能据此标P4/P6通过。
- 宿主维护运行状态补齐boot/gate、证书精确主控/持有者绑定、双签名准备/本机采集→节点回执/gate proof→租约→固定操作路径。每次操作先鉴权再审计，磁盘高水位变化撤销、新epoch失败不保留旧写者、旧租约拒绝跨进程重启。完整Go race/vet及实际Linux隔离HTTPS未完成审计拒绝签完整回执、客户双栈规则保持通过；证据 `maintenance-runtime-go.json`。服务器类型/相关守卫通过（`logs/test-run-20261023-081440/summary.txt`）。正式collector仍保留旧授权/本地任务隔离阻断，无真实客户写授权或完整接管声明。
- 迁移审计接入实际sshd有效配置、Include/Match旁路检查及root:root/0600 Incus Unix socket；受审调度树哈希绑定目录/链接/文件变化，未知特权进程及旧任务阻断。修正审计自身临时FD误判，只有完整受审事实才标本地写者隔离。完整Go race/vet、SSH认证方式/树变化守卫及显式三namespace集成通过：真实禁用SSH/root socket/procfs/nft采集后签回执，新增调度任务立即拒绝；证据 `migration-audit-go.json`、`migration-audit-isolated.json`。类型/相关守卫通过（`logs/test-run-20261023-082845/summary.txt`）。本集成Unix API为固定替身，未作为真实Incus电源动作、客户宿主或完整分区验收。
- 后续同源迁移测试在新测试主控arm64隔离mnt/net/pid中连接真实Incus6.0.4，实际SSH有效配置、root-only Unix socket、进程/调度树和nft水位采集→节点回执→签名短租约→固定Incus只读执行通过；原请求重放、3秒实际租约到期和调度变化均拒绝。证据 `migration-runtime-real-incus.json`；完整Go race/vet通过。此项仍使用临时见证签名身份，未执行真实实例电源/远端见证HTTP/客户宿主，完整接管继续施工。

- 本机采集提交 [e9aa5f4](https://github.com/mastalee928/payincus/commit/e9aa5f4b31af9a828a103ac6a8d6e10fb4c4549b) 的 [CI 39830723408](https://github.com/mastalee928/payincus/actions/runs/39830723408) 和 [Agent 构建 39830723410](https://github.com/mastalee928/payincus/actions/runs/39830723410) 成功，未修改VERSION或发布新资产。
- 继续实现host-fence-prepare/v1见证签名准备许可，21项共同Node/Go边界通过；独立incudal-maintenance只读预检严格核对登记/输入、两方签名及最高观察代次后读取本机Incus，尚未完成的网络/凭据/进程审计始终列为阻断，canWrite=false。错误许可不创建状态、高代次后拒绝旧请求、重复预检/错误权限/未知命令与JSON均有命令级守卫。
- 实际Incus6.0.4隔离环境中，由Node见证生成许可、Go独立维护命令读取真实活动/结束任务并持久记录最高代次；有任务时准确阻断，无任务仍不冒充物理隔离。错误许可/不安全登记拒绝；Go全包race/vet通过，类型检查/服务器编译/相关候选守卫通过。证据 `maintenance-cli-go.json`、`maintenance-real-incus.json` 保留本地。未接入正式Agent main/安装服务，未改宿主或主控管理入口。

- 见证提交 [7eb81a3](https://github.com/mastalee928/payincus/commit/7eb81a339afdea2ac495157cc513e30fa64b3fc3) 的 [CI 39829854002](https://github.com/mastalee928/payincus/actions/runs/39829854002) 与 [Agent 构建 39829853941](https://github.com/mastalee928/payincus/actions/runs/39829853941) 成功，版本不变，未发Agent新版本。
- 宿主Go加入独立本机只读Incus操作采集，固定Unix socket GET全部项目操作，安全文件/祖先权限与链接检查、超时/取消、响应大小/操作数量/JSON深度/重复键边界；连接失败、HTTP拒绝/跳转/HTML、未知分组拒绝。Go全包race/vet通过；实际Incus6.0.4隔离任务活动及最终结束分别被Go检出，Node静止门禁同步验证。证据 `quiescence-go-final.json`、`incus-go-quiescence.json`。尚未接入Agent main或宿主写权限执行，原主控/宿主不变。

- 接管前静止检查提交 `7834689` 已推送。后续新增 Node/Go 宿主隔离回执：绑定候选/挑战/bootId及主控代次，要求实际旧连接/凭据隔离和无未结束任务，严格规范字节与30秒有效期。26项跨语言向量、实际Go签名由Node核验、Go race/vet通过；未接入宿主root执行器，签名协议不是实际隔离证明。
- 新增内部独立见证两阶段状态库：更高epoch候选准备→持久挑战→验证宿主回执→内部激活；同请求幂等，冲突/旧代次/错误签名或挑战/过期/不同boot回执拒绝，缺失/损坏状态不自动重建，文件原子同步及进程锁。尚无管理认证、正式初始化/灾备重建、签名写租约和续期，signedWriteLeaseAvailable=false，不改变现有资源控制。
- 见证最终 Windows 23项/Linux 25项守卫通过，包含时钟回拨持久保护和容差内逻辑时间防过期复活。实际Go使用预登记临时节点私钥签署见证挑战回执，Node见证原子激活、进程重开幂等、下一代拒绝旧回执全部通过；证据 `witness-linux.json`、`witness-go-integration.json` 保留本地。此处只有内部状态联调，无真实资源写权限。
- 回执/见证阶段全套173项通过，`logs/test-run-20261023-020837/summary.txt`；之后时间持久保护另过最终服务器类型检查/编译、Windows候选守卫及Linux见证/Go联调。此阶段没有前端变更，无新版本、生产OTA或真实客户宿主控制变更。

- 后续 [8db15c6](https://github.com/mastalee928/payincus/commit/8db15c6fd28973acf3c83fe25ab36b56bdf60b62) 的 [CI 39822967631](https://github.com/mastalee928/payincus/actions/runs/39822967631) 与 [文档部署 39822967641](https://github.com/mastalee928/payincus/actions/runs/39822967641) 成功，未发新版本。
- 补齐只读接管前静止检查 inspectControllerQuiescence：真实 Incus 状态分组、ID/状态码、1024项边界及未知格式拒绝；旧连接/凭据未隔离、SSH进程/本地任务/Incus活动操作存在时阻断。状态码按 Incus 6.0.4 官方定义复核（Operation created=100、Pending=105）。类型检查、服务器编译和已登记候选守卫通过；canActivate 不构成写租约或资源核对成功。
- 从 Debian 包只提取 Incus 6.0.4 与依赖到专用实验目录，在独立 mount/net/pid 命名空间启动真实守护进程，sys/proc/sys保护且隐藏AppArmor控制入口，不安装系统服务/创建客户实例。延迟镜像任务提交后客户端关闭，真实任务继续运行，检查模块拒绝；测试源释放后任务按预期进入Failure，静止检查通过。Failure只表示任务结束，资源完整性仍须另查。验收脚本及调用适配入仓，证据 `logs/controller-takeover-research-20261022/incus-quiescence.json`；不等同于真实网关接管。

- 基础提交 [5e2a3cc](https://github.com/mastalee928/payincus/commit/5e2a3ccfc341b4018a4a811e2e03fcb0339e8544) 已推送；[CI 39819910429](https://github.com/mastalee928/payincus/actions/runs/39819910429) 和 [Agent 构建 39819910433](https://github.com/mastalee928/payincus/actions/runs/39819910433) 均成功，Agent VERSION 未修改，发布作业未触发。文档站本地构建通过；这些结果不等同于线上接管。
- 继续补齐内部候选状态库：受限结构登记、跨实例串行/跨进程 mutation.lock、原子持久发布、过期历史候选最高代次验证、同版本幂等及永久撤销墓碑；撤销不删除身份/nonce，不通过普通 enroll 自动复活。尚未开放受权网页/主控管理接口。Windows 20 项、Linux 22 项状态库边界及 29/43 项 HTTPS/CLI 检查通过；真实 Go 客户端经正式 CLI 验证登记→读取→新配置发布→再读取→撤销→拒绝，仍无写授权。最终全套 173 项通过，`logs/test-run-20261023-011442/summary.txt`；服务器编译通过。
- 新增显式启用的 Linux `scripts/test-controller-fence-netns.py`，在未命名独立网络命名空间验证 8 项网络门禁方向：旧既有/新建管理套接字拒绝、新管理源通过、客户模拟连接保持、重载幂等，并证明已接受的任务不会随连接隔离取消。网络规则仅作用于测试命名空间，未改主控或宿主防火墙；使用 TCP/任务夹具，不冒充真实 WireGuard/SSH/Incus 或完整写者门禁。完整接管仍须执行路径/已启动任务隔离与核对，证据 `logs/controller-takeover-research-20261022/fence-netns.json`。

- 新增 [CONTROLLER_CONFIG_PROTOCOL.md](CONTROLLER_CONFIG_PROTOCOL.md)。Node 与 Go 共用 Ed25519 字节封装、严格结构、平台/节点绑定、毫秒过期和精确 int64 字符串代次；未知命令、重复键、篡改、旧代次及同代次冲突拒绝。候选结果始终 canWrite=false，不授予管理写权。
- Go 新增独立 HTTPS 签名读取和 Linux 最高观察代次存储：校验 TLS、禁止重定向/HTTP、响应限量，磁盘互斥/原子改名/文件及目录同步，重启重新加载；文件损坏、权限/链接/持久化异常拒绝。未接入现有 Agent main，不变更当前心跳或网络指令。
- 独立 Node HTTPS 服务不导入业务后端、Prisma、Web cookie 或平台调度。节点独立签名请求、原点绑定、nonce 持久防重放、异步存储后再次核对撤销，错误信息脱敏。显式 CLI 仅监听 loopback，同状态目录 flock 防多进程，强制退出无需删除遗留锁；配置/TLS/状态均受文件权限及链接守卫约束。
- 73 份共同 Node/Go 向量通过；Windows 27 项 HTTPS/存储检查、Linux 真机 41 项（含正式 CLI、不同端口第二进程拒绝、SIGKILL/SIGTERM 重启、防重放保留和不安全配置拒绝）通过。正式独立 CLI 与实际 Go 客户端通过真实 TLS 双向签名、超 JS 精度代次及可配置地址验证，canWrite=false。Go 全包 race 与 vet 通过。本地证据 `logs/controller-takeover-research-20261022/`，不包含提交的凭据或私有配置。
- 全套 planned/executed/passed=173、failed=0，`logs/test-run-20261023-003759/summary.txt`；之后新增进程锁/CLI检查另过服务器类型检查、编译、候选守卫及 Linux 实测。根 lint 0 错误，保留 665 条既有前端格式告警。无前端源码变化；本阶段未使用网页模拟接管代替真实结果。
- 测试仅在临时独立进程/目录进行，未安装到现有运行后端、未修改原宿主连接、未停止旧主控。最后现存数据核对为 6 宿主、6 Agent、0 临时探针、15 实例；业务后端 MainPID=41330、NRestarts=0（当时核对结果）。
- 持久登记/撤销和候选发布、独立见证/宿主旧写者门禁、受限通道维护、双网关覆盖、页面接管、网关 Web 认证及自主 OSS 备份仍待施工。整体 34 项灾备验收尚未通过；本阶段不发布新标签/版本、不修改 v1.7.1 资产、不执行生产 OTA，后续完整验收后随正常发版纳入。

## 2026-10-22 主控页面接管研究与 CF Agent 通讯实测（当时接管功能未实施）

- Owner要求作为项目通用能力研究：未来正式主控不是本次测试IP，最终操作尽量在PayIncus页面完成。新增 [CONTROLLER_TAKEOVER_RESEARCH.md](CONTROLLER_TAKEOVER_RESEARCH.md)，明确可配置HTTPS上报、直连WireGuard入口、独立签名发现、预建B通道和控制权隔离；不是逐台SSH临时改地址方案。
- 在授权测试主控创建独立临时Host/Agent，仅验证CF公网API传输：有效HMAC心跳HTTP200并记录时间；同一nonce重放HTTP401/AGENT_NONCE_REPLAY；错误签名HTTP401/AGENT_SIGNATURE_INVALID。使用项目实际Go心跳客户端再次验证HTTP200及心跳记录；官方Go临时工具链SHA256已核对。临时身份/nonce清理完成，正式宿主未被伪造在线，旧主控和宿主Endpoint/上报地址未改变。证据仅保留本地 `logs/controller-takeover-research-20261022/`。
- 当前Agent单panel_url、宿主单WireGuard通道，没有旧网关完全失联后从新页面直接重连的能力。正常灾备需提前部署独立发现/备用通道；遗留宿主可经已有受控路径页面补装，全部路径失效时仍须云控制台或经另行授权实现的云远程命令适配，不能承诺凭数据库记录接管。
- 本轮验证只覆盖真实客户端从测试服务器访问CF，不等同于现有客户宿主迁移、管理SSH/Incus接管或跨故障域恢复。接管根签名、节点最高代次、旧写连接隔离和页面任务仍待实施；AC30–AC34补入施工验收，总计34项。用户已选择保留旧主控运行的恢复演练，当前继续遵守此范围。
- 进一步使用隔离HTTPS服务与临时CA/Ed25519身份完成16项独立签名配置拉取检查：地址配置变更、跨节点/平台、篡改、过期、HTTP降级、非法端口、同版本冲突、持久状态重读后旧配置回放、读取nonce回放及不可信证书均按预期处理。旧入口故障由未监听端口模拟，真实旧主控未停止，网关/Agent配置未修改；证据 `logs/controller-takeover-research-20261022/discovery-prototype.json`。原型仅证明读取协议方向，不作为真实切换、控制租约或旧写连接隔离的验收。

## 2026-10-22 网关独立界面、高可用与自主 OSS 备份方案整理（未实施）

- Owner 同意主控页面配置网关、独立网关轻量 Web 界面、活动/备用网关及灾备方向；独立备份沿用阿里云 OSS，在平台定时备份之外增加网关自主调度和变更备份，主控离线时仍可上传。可同桶不同前缀和独立RAM权限，但同桶不代表跨存储故障域。
- 完整流程见 [GATEWAY_HA_PLAN.md](GATEWAY_HA_PLAN.md)，施工要点、难点、阶段交付和29项验收见 [GATEWAY_IMPLEMENTATION_SPEC.md](GATEWAY_IMPLEMENTATION_SPEC.md)。主控离线时网关独立认证/诊断/备份，活动网关失联时从主控经预建备用通道接管；旧控制端和旧连接必须隔离，不能靠页面角色标记防双写。专项补齐「主控本机活动网关A + 独立备用B」服务隔离、双通道、页面切换与整机损坏后的B独立接管；旧主控页面离线时不能作为故障接管入口。
- 控制权见证、统一管理路径/地址映射、宿主双通道和门禁、远端一致性快照、撤销/增量恢复链为施工前架构必决项；见证不由OSS对象存储隐式替代。拟定恢复时间和备份覆盖目标需实际故障演练确认。现有版本没有上述完整高可用能力，本轮仅整理设计，未更改运行代码或生产配置。
- 同机A+独立B策略复审补齐故障处理矩阵、B应急账号/MFA及解密材料预配置、独立systemd服务依赖、升级/卸载不隐式移除B通道、旧端恢复及角色互迁；需求映射与P1–P5阶段门禁纳入AC27–AC29。第一版默认管理员确认接管，自动写接管须另经见证/宿主门禁验收，不将未实施方案写成当前已支持。

## 2026-10-22 OSS 换机恢复兼容性修复与网关指引（测试站热更新，未发新版本）

- Owner 在新装 v1.7.1 测试主控预检旧 OSS 备份时，任务 `5894b378-4911-4b14-8873-4779c8828fce` 返回 `OSS_VERSION_MISMATCH`；实际恢复未执行，数据库未切换、保护未开启。三份旧备份均认证通过，标记版本为 1.6.8、PostgreSQL 16、212 条迁移。最近备份 `509ee35b-8b4e-4540-9dfb-5e220eaefda5` 的唯一历史校验差异为 `202610150001_host_pool_checkout` 同一 SQL 的 CRLF/LF；触发器结构差异也仅为同一受信函数体的换行格式。
- 恢复支持相同版本或同一应用主版本内的较新稳定版本（0.x 限同一 minor），PostgreSQL 大版本仍须一致。先认证归档、按备份编码/libc locale 创建隔离库并验证完整性，再核对当前发行包的完整迁移历史，只接受受信 SQL 的精确 LF/CRLF 校验别名；缺少的迁移仅由当前安装的 Prisma 工具在隔离库执行，不执行备份中的代码。升级后结构须匹配当前程序；未知校验值、较新备份、跨主版本、结构不符与迁移失败明确拒绝。预检绑定目标版本、迁移、发行迁移清单和结构，正式恢复重新验证；同一 commit 的发行预览仅允许自身恢复。
- 完整换机演练发现备份 `en_US.UTF-8` 与新装默认 `C.UTF-8` 的差异；预检/恢复临时库改为继承已认证报告中的编码和排序规则，缺少系统 locale 时明确要求安装后重试。数据/序列/大对象/locale 的完整性校验与会话撤销、库存隔离、恢复保护、回退路径保持。恢复网关时先应用归档配置，再运行受信授权安装器，避免不同管理网段下验证旧运行接口。
- 使用真实 OSS 最近备份，在独立挂载/网络/进程命名空间和独立 PostgreSQL 集群完成预检、数据库/文件切换、保护启动、回退、回退后恢复运行：恢复 4 个用户、6 台宿主、15 条实例；原数据加密密钥、证书、WireGuard 配置和受限 SSH 身份逐项匹配，新机数据库连接、JWT/Cookie 身份、域名及公网管理地址保留。回退恢复目标机原数据和配置；演练不访问旧主控，也不连接客户宿主。数据库与文件恢复真实执行，服务控制使用隔离夹具，不能等同于生产故障切换或真实宿主重连。证据 `logs/recovery-diagnosis-20261022/full-isolated-drill.txt`。
- 新增隔离迁移兼容性演练，验证旧稳定版本与 CRLF 历史升级到目标结构、精确金额保持；较新备份、PostgreSQL 不匹配、结构漂移、预检后目标变化、未知迁移校验值均拒绝。已接入双架构发行首装脚本；本轮 ARM64 实测通过，后续 GitHub 双架构结果另记。
- Owner 确认新测试主控使用其直连公网地址配置本机网关，既有 root 安装器已验证成功。机器池新增可展开的「配置管理网关」指引，三语同步，说明在主控 root 终端执行 `--configure-host-pool`、直连地址、UDP 51820 与复查。当前网页提供指引，不直接执行配置；独立远端网关不是本轮自动完整恢复范围。
- 测试站部署前保存数据库、运行/OSS/网关配置、双端静态文件、受影响后端与原受信清单，回退目录 `/root/incudal-recovery-hotfix-3LvIzw`。只热更新验证代码、说明及双端构建并补齐 seal；最终后端 MainPID=26869、NRestarts=0，唯一监听 `127.0.0.1:3001`、`recoveryHeld=false`。运行配置与部署前逐字节一致，当前库仍只有新装管理员。最终后端模块及双端入口与本地构建逐字节一致。
- 已安装受信 CLI 的真实 OSS 预检 `1e55c355-9a54-4b8d-901e-5f5281e126c7` 成功；管理员 API 预检 `ac744b3e-d104-4f23-bccb-08da7d2886dd` 同样达到 `success/preview_ready`，可进入原确认流程。浏览器确认本机网关就绪、配置指引正常展开。预检绑定发起者且有效期 15 分钟；过期须从后台重新发起。测试站未正式恢复旧数据库，未解除恢复保护或操作客户实例。
- 最终本地全套 planned/executed/passed=172、failed=0（`logs/test-run-20261022-211942/summary.txt`）；双端与后端构建、dist 边界、部署/备份/机器池/前端路由/i18n 守卫、修改前端文件 Lint（0 错误）及文档构建通过。源码及记录按 owner 授权提交推送；不含本地技能配置、真实凭据或私有验收文件。GitHub CI 与下一次双架构发行首装证据独立记录；本轮未打标签、未更新 v1.7.1 发行包、未执行生产 OTA。
- 后续正常发版必须纳入本轮后端恢复修复、网关指引及演练；仅重新下载安装脚本不能给原版 v1.7.1 后端增加此能力。新主控完整恢复指平台快照内数据库和受管身份；不包含 VPS 磁盘、快照后的交易或外部系统。换公网 IP 后需将稳定直连管理域名指向新机，或通过宿主控制通道更新旧 IP Endpoint；主控数据恢复不能宣称离线宿主已自动重连。

## 2026-10-22 CF Tunnel 安装引导与真实首装验收（源码更新，未发新版本）

- 安装器 CF 方案明确为选项 2；增加「内网 Service URL」合并输入框与 Type/URL 分开输入两种填写方式，统一使用 `http://127.0.0.1:80`。输入两端域名后显示实际路由表，说明两端共用本机 Nginx、Path/HTTP Host Header 留空、保存路由后核实 DNS。两端 `.env` 地址仍走既有配置路径，不更改业务 API、鉴权或支付逻辑。
- 修复 cloudflared 安装失败被忽略仍报告成功：隐藏 Token 输入，不打印可能带凭据的原始 CLI 输出；已有服务必须显式输入 `reuse`，不覆盖配置或重启 Tunnel。增加域名/双端构建/端口/Nginx 前置检查、`--configure-cf-tunnel` 补配和 `--check-cf-tunnel` 只读分层诊断；验证当前进程实时连接数、两端正确页面及 JSON 健康 API，任何失败或未知项保持非零退出。
- 真实新域名生效过程中出现浏览器可访问、服务器递归 DNS 仍解析失败的现象。公网 DNS/连接/超时失败最多尝试 3 次，间隔 3 秒；保持原 DNS 与证书验证，不修改系统解析配置。持续失败提示 DNS 缓存或传播延迟、稍后只读复查，无需重装；HTTP 错误、错误页面/健康状态与 TLS 错误不重试。相关守卫覆盖恢复、持续失败、次数边界、已有服务/安装失败与 Token 不泄露；修正夹具受真实主机已有 cloudflared 服务文件影响的问题。
- 经 owner 授权在干净 Debian 13 ARM64 测试服务器从公开 v1.7.1 ARM64 发行包首次安装，使用本轮前期改进版安装器；完成 212 条迁移、唯一后端监听 `127.0.0.1:3001`、Nginx/cloudflared 启动。Owner 保存同一 Tunnel 的两条公网路由后，浏览器用户页和管理员登录成功，用户管理页显示初始管理员；本机 API 登录/查询/退出均返回 200，refresh cookie 为 Secure/HttpOnly 且无 Domain。凭据不写入公开记录。
- 本轮最终脚本与守卫在同一测试服务器的隔离验证目录运行：Linux 安装守卫通过，`--check-cf-tunnel` 返回 0，两端本机及公网页面与各自已安装构建一致、四个 API 反代检查和实时隧道连接均通过。检查前后 `.env`/Nginx 配置哈希及后端/cloudflared MainPID、NRestarts 一致（均未重启）；脱敏证据 `logs/cf-install-20261022/verification.json` 与 `linux-guards-and-diagnostics.txt`，仅保留本地。
- 本地最终检查：全套 planned/executed/passed 均为 172、failed=0（`logs/test-run-20261022-171733/summary.txt`），Windows/Linux 安装守卫、清单校验、仓库来源及部署文档守卫通过；双端/后端构建、dist 边界与文档构建通过。中文及英文安装说明同步。本次不含技能配置与构建自动生成的无关版本日志。
- 本轮按 owner 授权提交并推送源码与验收记录；GitHub Actions 结果单独查看，不能以本地通过代替。未打标签、未重建或替换 v1.7.1 Release 资产、未执行生产 OTA。管理网关安装时暂跳过；实例终端、资源交付和支付回调未在这台新测试机验收，不作为此次网站安装通过的证据。
- 后续发版安排：本次安装器修复随下一次正常面板发版纳入双架构安装包，不为此单独发布新版本。当前官方安装命令从 GitHub main 获取修正版脚本，但已发布 v1.7.1 安装包内附带的脚本仍为旧版；已有用户需要新的 CF 补配或诊断功能时，重新下载 main 的安装脚本即可，无需升级或重装面板。下一次发版应核对包内安装脚本与发行源码一致，并完成对应安装守卫及首装验收。

## 2026-10-22 v1.7.1 正式发行与测试站 OTA 收尾核验

- 发行源码 `9d1e5ba47dd6bf0a0937413892dacfeeb15e4a1d`，标签对象 `b9e5ca546250ada32e9df55455bba454f54f5a4d`。预览 [39614785962](https://github.com/mastalee928/payincus/actions/runs/39614785962)、正式 [39616260761](https://github.com/mastalee928/payincus/actions/runs/39616260761) 均成功：amd64/arm64 构建、归档 root UID/GID 检查、真实发行包首装、212 条迁移、唯一后端、管理员登录、管理网关及备份/预检/恢复/回退/恢复运营演练。OSS 传输在 CI 中使用本地替身。正式发布于北京时间 2026-10-21 22:31:35，非 draft、非 prerelease；本轮 GitHub API 复核 latest 为 v1.7.1。
- 两份已下载公开安装包重新校验通过：amd64 109074252 字节 SHA256 `fdae6bbc3caba1ac269ec42446258904ee8d4c68f1a8c996f66ceba4b26fb263`，arm64 108335628 字节 SHA256 `ff202065b25dc4ec2937d6948b51c97c64763d481c7fadb31c32e030df381e57`。校验文件、资产 digest、两份 OTA manifest、版本与源码身份一致；全部归档成员 UID/GID 均为 0，新执行器包含 `--no-same-owner`，关键运行模块与双端边界通过，设计样稿和技能未包含。证据 `logs/release-v1.7.1/verification.json`。
- 发行源码本地全套 172/172（含双端类型检查，`logs/test-run-20261021-220344/summary.txt`）、双端及后端构建、文档构建通过；Linux [源码 CI 39614784138](https://github.com/mastalee928/payincus/actions/runs/39614784138) 与 [文档 Pages 39614784139](https://github.com/mastalee928/payincus/actions/runs/39614784139) 均成功。
- 本轮直接读取已登录测试管理后台：任务 #13 为 `v1.7.0 → v1.7.1`、成功。日志始于北京时间 2026-10-21 22:35:28，22:37:32 完成；实际执行的是旧 `tar -xzf`，随后备份执行器安装成功，直接覆盖此前失败路径。整目录备份 `/opt/incudal.bak.20261021143528`、预迁移数据库备份 `/opt/incudal.bak.20261021143528/db-pre-migrate-v1.7.1-20261021143528.sql` 均在日志中记录。无待执行迁移，数据库/支付就绪、双端静态资源/API/WS、Agent manifest 和日志凭据检查通过，未跳过 DB 检查。页面运行版本为 v1.7.1、Commit 为 `9d1e5ba47dd6`，部署时间为 22:36:31。
- 2026-10-22 当前测试站健康接口返回 `status=ok`、`recoveryHeld=false`；实际用户概览显示实例 #13/#15 均运行中，名称、San Jose 区域及 2 核/768 MiB/30 GiB 配置可见，用户余额为 999868.90；管理端显示该用户仍有 2 个实例。本轮通过浏览器读取证据，旧 SSH 会话已断开，未重新执行服务器上的全字段/全用户余额快照断言或唯一后端进程检查；此前 #12 的逐项断言见下方，不能当作 #13 的同等验证。
- 2026-10-22 owner 明确确认：「我已经确定升级至1.7.1，并且正常运行，所有宿主均正常，请记录」。据此记录升级与当前运行状态的 owner 实际确认；下方 Frankfurt 宿主离线等内容为历史故障记录，不代表此次确认时的状态。SSH 补充核验已停止，该确认不等同于重新执行全字段快照断言或后端进程数量检查。
- 本轮仅补齐版本台账，不重新发起 OTA、不更改生产；首页设计保持取消，既有 `skills-lock.json` 和 `.agents/` 本地变动不纳入交接提交。

## 2026-10-21 v1.7.0 旧版本 OTA 权限回归与 v1.7.1 修复

- Owner 在测试主控发起任务 #11（v1.6.8 → v1.7.0），北京时间 21:52:31 失败于 `scripts/install-platform-backup.sh`，错误 `Untrusted helper source`，21:54:03 自动代码回滚完成。完整错误保存在失败版本副本中；活动日志在旧布局回滚时被旧备份覆盖，任务记录保留。迁移无新增变更，数据库预迁移备份 `/opt/incudal.bak.20261021135125/db-pre-migrate-v1.7.0-20261021135125.sql` 保留。
- 根因：GitHub 发行包记录构建机 UID 1001，旧 root OTA `tar -xzf` 保留此 UID；备份执行器安装要求来源文件为 root 所有，而更新流程在该安装后才加固权限。首装安装器会预先归一化权限，因此双架构首装通过未覆盖旧 OTA 场景。保持安全校验，修复新执行器 `--no-same-owner` 解包及安装前权限加固，并将后续发行包统一 `--owner=0 --group=0 --numeric-owner`，兼容已安装旧执行器。双架构验证直接检查安装前归档 UID/GID。
- 已备份测试机执行器与环境到 `/root/incudal-ota-owner-fix-iDf6bZ`，只修改已安装执行器的两处权限顺序并同步受信 seal，沿用 owner 的测试站更新授权重试。任务 #12 于北京时间 22:04:26 完成 v1.7.0 更新，数据库/支付就绪、双端 API/静态资源/WS、日志凭据检查通过；服务 `MainPID=1273505`、`NRestarts=0`，恢复保护关闭。实例 ID 13/15 的归属、机器、名称、CPU/内存/磁盘、价格、到期、续费及所有用户余额与更新前逐项一致。后续 v1.7.1 正式发行与任务 #13 成功证据见上方。

## 2026-10-21 v1.7.0 正式发行证据

- 发行源码 `33b08791dc62e819fbbff847c38cd9e9ba438a37`，标签对象 `e778882f3e20e62067abdcc289136de3d7e0f407`。预览 [39608386204](https://github.com/mastalee928/payincus/actions/runs/39608386204)、正式 [39609841694](https://github.com/mastalee928/payincus/actions/runs/39609841694) 均通过双架构构建及首装、212 条迁移、唯一后端、管理员登录、管理网关、备份/预检/恢复/回退/恢复运营演练；OSS 传输在 CI 中使用本地替身。正式发布北京时间 21:47:30，非 draft、非 prerelease。
- 实际下载两份公开安装包，amd64 109195921 字节 SHA256 `fc2a91fe3ca2f0c17cb3a32085f5a1d3a2949d1b06c402b396ac00b3b04917e4`，arm64 108303008 字节 SHA256 `66cf7ac7aaba0440adcdaaedfa694f970545d08827a1cd775c8328f90da1d196`。校验文件、资产 digest、两个 OTA manifest 一致，包内版本/源码/迁移与关键运行模块一致；用户 dist 无管理员换机接口、本地设计及技能未包含。校验记录 `logs/release-v1.7.0/verification.json`。
- 本地最终全套 172/172（`logs/test-run-20261021-211836/summary.txt`）、双端/后端构建、文档构建和 Lint 通过。Linux [源码 CI 39608386337](https://github.com/mastalee928/payincus/actions/runs/39608386337) 包含 Agent 测试通过，文档 Pages [39608386414](https://github.com/mastalee928/payincus/actions/runs/39608386414) 通过。后续旧 OTA 所有权问题及真实更新证据见上方，不将首装通过等同于旧版本 OTA 验证。

## 2026-10-21 PHP 紧急安全通告适用性核对

- 北京时间 20:22 核对 PHP 官网安全预告：计划 10 月 21 日 22:00 发布两项 CVSS v4.0 9.2 安全更新，预告尚未公开具体受影响及修复版本；当时两项转述 CVE 的公开记录查询均返回 404，不能据此断言不存在漏洞，也不能将转述的全版本影响范围当作已核实官方事实。
- 仓库运行栈为 Node.js/Vue/Go，没有 PHP 运行依赖；仅有外部支付/邮件服务的 PHP 路径调用。授权测试主控未发现 PHP 包、进程或 Nginx PHP 执行配置；两台运行客户实例只读检查均未发现 PHP CLI、PHP 软件包或 PHP 进程。未发现本次 PHP 核心漏洞的直接执行入口。
- 该核对仅覆盖仓库及已检查测试环境，不包含未检查的生产主机、全部客户自装应用及外部服务；未做补丁更新，v1.7.0 不宣传为 PHP 漏洞修复版本。

## 2026-10-21 管理员实例详情同配置跨区域更换机器（测试主控，未发版）

- 客户实例列表 → 管理 → 实例详情新增管理员「更换机器」入口，复用已有独占实例换机任务。弹窗默认同区域，可切换所有区域；展示候选地域、名称和公网 IP。管理组件按构建入口动态导入，用户 dist 不含管理 API；使用原生 dialog 管理焦点、Escape 和状态提示，防止旧区域异步响应覆盖新选择或重复轮询。
- 候选查询和事务预占共用规格条件：同机型分组、资源档及架构，CPU、内存和客户磁盘严格等于原实例。跨区域必须显式选择范围，提交再次检查空闲、最近 Agent 心跳、资源及任务占用。异地备份恢复到备份时间点，重新创建系统不自动搬迁当前磁盘数据，必须明确确认；公网 IP 将改变，原计费方案及续费关联保留。客户详情的区域展示改读当前机器区域，保留原计费关联。
- 前后端类型、相关守卫和双端构建/dist 边界通过；全套 172/172 通过（`logs/test-run-20261021-194022/summary.txt`），Lint 0 错误。隔离 `_pool_test` 集成实证通过跨区域允许、默认范围拒绝、大小规格不一致拒绝、管理员权限、并发预占、失败清理、持久隔离与账务保持；临时数据库已删除。
- 测试站更新前保存受影响文件、数据库、配置及证书，备份 `/root/incudal-host-replacement-dIVqN8`，同步 seal。授权从真实管理员客户列表进入 dfsafdsa（ID 13），默认 Frankfurt 无库存，切换所有区域显示三台同配置 San Jose 空机，确认新建系统后任务 #12 于北京时间 19:58:06 完成，从 host #3 切至 #8，状态 running、网络交付就绪。固定宿主身份的公网 SSH 验证成功；客户、名称、CPU/内存/磁盘、原密码、价格、到期、续费/计费关联及用户余额保持；原机器继续隔离，另一个现有客户实例 ID 15 保持。
- 真实客户列表和详情均显示美国西部（圣何塞）、运行中及原价格/到期；无管理换机入口。Owner 要求成功日志统一「更换机器已完成」，已修正源代码并保存旧记录后同步测试站日志 #358。最后后端构建、机器池/日志查询守卫及数据库就绪检查通过；唯一后端 `MainPID=1260453`、`NRestarts=0`、健康正常、`recoveryHeld=false`，seal 已同步。证据截图 `logs/host-replacement-verified.jpg`。源码未提交、未推送、未发版；生产 OTA 未执行。

## 2026-10-21 客户日志隐藏内部地址与重装密码登录（测试主控，未发版）

- 客户日志过去仅部分遮罩 IPv4，仍显示管理网段与 Incus 连接错误。新增 `customer-log-view.ts`，在已鉴权且按用户过滤的日志响应中隐藏内网/回环/link-local/CGNAT IPv4（含旧遮罩值）、内部 IPv6、localhost，并将低层 Incus 连接错误替换为客户可理解的失败提示。历史记录无需迁移即可隐藏，管理员审计内容和数据库原文保持。
- 重装弹窗默认「仅使用 root 密码登录」，SSH 密钥可选；没有密钥时仍可提交，选择密钥才传 `sshKeyId`。执行器移除用户首个密钥自动回退，所选密钥在停止实例/删除快照前复核归属，始终保留新密码生成及密码登录。三语同步，并修正原手动启动文案为实际自动启动。
- 前后端类型检查、后端构建、双端构建/dist 边界、前端路由/i18n、日志查询/日志本地化、实例路由/任务查询、独占交付守卫通过；全套 172 项全部通过（`logs/test-run-20261021-183527/summary.txt`）。新增守卫验证旧遮罩地址、IPv4/IPv6/连接错误隐藏、密码配置/所选密钥注入及无隐式回退。Lint 0 错误，保留既有格式告警；Impeccable 检查空列表。
- 授权测试主控部署前保存双端页面、受影响后端文件和数据库，备份 `/root/incudal-log-rebuild-wFcyjK`，完成 seal 后重启唯一后端。实际客户日志已验证不含 `10.253.240` 或 `EHOSTUNREACH`；重装弹窗无密钥时确认按钮可用，默认密码登录。样本验证不选密钥提交无 sshKeyId，选密钥传所选 ID，英文窄屏无横向溢出。
- Owner 明确授权操作测试站现有用户实例，已实际对 vdfssd（ID 15）执行密码登录重装，任务 #11（北京时间 18:56:20 提交、18:57:01 完成）`COMPLETED`、`sshKeyId=null`、错误为空；Alpine 3.21/cloud 自动启动，实例 running 且 `dedicatedNetworkReady=true`。独立公网 SSH 使用新密码与固定主机身份登录成功，确认 root UID、`AUTHORIZED_KEYS=0`、`PermitRootLogin yes`、`PasswordAuthentication yes`，cloud-init 未注入密钥；密码不输出、不记录。唯一后端 `MainPID=1253626`、`NRestarts=0`、健康正常。源码未提交、未推送、未发新版本；生产 OTA 未执行。

## 2026-10-21 已售宿主无损恢复、实时离线与客户故障状态（测试主控，未发版）

- Owner 进一步确认 fra-amd-1/fra-amd-2 对应云实例已终止，撤销此前“未停用”判断；两台无需重新连接，保留隔离。根因是宿主列表/详情及机器池直接显示历史 `hosts.status=online`，离线告警只更新 Agent 状态。新增 `host-live-status.ts`，上述三个管理员入口按 Agent 最近心跳及配置间隔派生离线状态，维护和无 Agent 的旧节点保持既有语义，不覆盖数据库记录。
- 已售宿主增加 `mode=preserve`：锁定宿主及实例记录，核对唯一既有实例、归属、运行状态、系统盘、IPv4 与 IPv6 转发和额外数据卷；任务、待清理账务、未知系统/项目、地址或状态不匹配时拒绝。通过后只设置 `poolFaulted=false`，不删除实例/磁盘/快照/网络规则，不清零资源占用，不更改用户、价格、到期时间或续费。IPv6 仅因隔离暂停且原映射已验证时，允许使用远端规则核对打破循环依赖；空映射或未知失败仍拒绝。
- 隔离 `_pool_test` 数据库执行既有恢复集成测试并补充已售场景：运行实例、网络和额外卷不匹配拒绝，IPv6 隔离循环、GET-only 远端调用、清理确认、并发及完整账务/资源保持通过。临时库已删除。平台备份/机器池/实例路由/宿主路由/分页/拆分部署等守卫及前后端类型检查、构建通过；全套 172 项检查在 `logs/test-run-20261021-162812/summary.txt` 全过，后续 IPv6 循环补充另经类型/构建/相关守卫及隔离集成验证。
- 实际后台成功恢复 sanjose-amd-2（ID 6），对比恢复前后资源占用和客户记录哈希均一致，既有用户实例保留。3 台此前恢复的 San Jose 空机不变，Frankfurt 两台保留隔离。部署前备份 `/root/incudal-occupied-status-QPDHYZ`，后续 IPv6 循环调整备份 `/root/incudal-preserve-final-AINQJ1/before-host-pool-recovery.js`。
- 客户实例列表、卡片、详情与概览新增独立 `serviceFault` 显示标记，按实时心跳显示「故障」/「Fault」，不显示“宿主离线”或内部原因；原实例 lifecycle 与账务状态保持。实时资源查询离线时返回故障标记而不冒充已确认 running，恢复正常后清除标记。故障时不显示运行中的停止/重启/实例终端操作；续费及既有记录保持。
- 授权登录实际用户 `vm-test.masta.ee` 验证 Frankfurt 实例列表和详情显示「故障」。新双端公开 HTML 与本地最终构建逐字节一致；后端备份 `/root/incudal-customer-fault-RLAd09`，最终前端旧入口 `/root/incudal-customer-final-ui-3LDWD9`。唯一后端 `MainPID=1248250`、`NRestarts=0`、`recoveryHeld=false`，seal 已同步。客户变更全套 172 项通过（`logs/test-run-20261021-172905/summary.txt`），后续概览调整另过前端类型/路由/i18n/双端构建/dist 边界；Lint 0 错误、保留既有格式告警，Impeccable 检查空列表。源码未提交、未推送、未发新版本；生产 OTA 未执行。
- 最终浏览器核验：客户概览中的 Frankfurt 实例显示「故障」且不计入运行中数量，实例卡片与详情同样显示「故障」，无“宿主离线”等内部文案；管理员机器池两台 Frankfurt 显示离线，4 台 San Jose 管理连接在线，其中 ID 6 保留实例并显示已分配，ID 7/8/9 可售。客户列表 San Jose 实例显示已停止，实际任务 #10（2026-10-21 17:38:01）为停止成功，此生命周期变化不由状态显示补丁引起。客户与后台两个源公开 HTML 已与最终本地构建逐字节比对，最终前端变化不重启后端。

## 2026-10-21 批量宿主检查恢复与管理隧道保持（测试主控，未发版）

- 机器池新增「批量检查本页隔离宿主」及勾选后的「检查并恢复所选宿主」。逐台复用原检查/恢复接口，不新增批量绕过路径；逐项显示阻断原因、失败和成功，单项失败后继续后续机器，清理遗留数据仍须确认。适配既有管理 API 的顶层错误报告，状态变化时展示最新阻断条件；查询超时调整为 65 秒，守卫验证顺序、失败隔离和清理确认。每页最多 20 台，相关限流调整为检查 30 次/分钟、恢复 20 次/分钟，鉴权不变。
- 平台恢复及回退原先无条件重启 WireGuard，导致已学习的节点端点和握手丢失。新增 `platform-backup-gateway.ts`：配置与运行状态不变时不重启；同一控制身份同步配置时只保留同一 peer 的有效数字 IP/端口，使用 `wg syncconf`。不同控制身份不继承旧端点，配置中的显式端点优先。角色、密钥、业务门禁与库存隔离不变。发行首装恢复演练增加接口 ifindex 与端点保持断言。
- 前后端类型检查、后端编译、双端构建/dist 边界、前端路由/i18n/平台备份/机器池/拆分部署守卫通过。Linux 测试机从已有备份还原到新 `_pool_test` 隔离库，使用既有宿主恢复集成测试验证鉴权、状态变化、清理确认、部分失败重试、并发及账务保持，已通过，临时库已删除。模拟浏览器验证批量失败后继续及成功保留，390px 英文深色无横向溢出。全套最终检查记录随后补齐。
- 授权测试主控部署前保存数据库、配置、网关配置、受影响后端文件及双端页面，备份 `/root/incudal-batch-recovery-3SbdU3`；最终前端入口旧副本 `/root/incudal-batch-final-ui-s7tMvF`。已补齐 seal，唯一后端 `MainPID=1235779`、`NRestarts=0`、健康接口 `recoveryHeld=false`；运行配置及网关配置与部署前逐字节一致。真实网关验证配置相同及仅注释变化时均不重建接口、不丢已知端点，并还原原文件。
- 实际浏览器批量检查 5 台隔离宿主：sanjose-amd-3（ID 8）与 sanjose-amd-4（ID 9）通过并成功解除隔离；sanjose-amd-1（ID 7）此前 Owner 已单台恢复。这 3 台空闲机器持续上报 Agent，用户 4 条、实例 15 条（2 running、13 deleted）保持。sanjose-amd-2（ID 6）管理连接和现存用户实例匹配，但既有空机恢复检查因实例占用继续阻断，不删除用户实例、不自动置空资源计数。
- fra-amd-2/fra-amd-1（ID 3/4）管理隧道仍不可达，Agent 原始心跳也已过期；Owner 明确未停用宿主，公网 22 已交给用户，暂时无法进入云控制台。当前缺可用的宿主控制通道，真实重连未完成。已提供仅重新加载原 WireGuard 配置和重启监控 Agent 的 `scripts/reconnect-host-management.sh`，不得在用户实例或独立 Cloud Shell 内执行。保持隔离，不宣称全部宿主恢复。源码未提交、未推送、未发新版本，生产 OTA 未执行。

## 2026-10-21 恢复后的保护页面修复（测试主控，未发版）

- Owner 执行 13:01:44 快照恢复后，用户页、机器池页和版本页显示为空。现场恢复任务 `0c419c96-f927-4f5b-827e-bb5e6c1322b4` 成功且 journal 为 `awaiting_review`，健康接口 `recoveryHeld=true`。根因为保护门禁将业务查询返回 `503 PLATFORM_RECOVERY_HELD`，页面把查询失败呈现为没有记录。
- 当前恢复库保留 4 个用户、6 台宿主、15 条实例记录（含历史删除记录）、2 条机器池定价、7 条接入节点和 67 条配置。126 张表按快照相同格式逐行指纹核对，差异仅为宿主 `pool_faulted` 隔离标记、会话撤销以及恢复后登录产生的审计记录；宿主去除隔离标记后的全部字段与快照一致。恢复前数据库 `incudal_before_0c419c96f9274f5b827ebb5e6c1322b4` 仍保留且禁止连接。
- Owner 明确选择保留本次恢复结果、先核对。仅前端增加全局保护提示与 OSS 核对入口，保护期间不渲染无法查询的业务页，OSS 页继续可用；后端门禁、数据库及库存隔离不变。三语文案同步，平台备份守卫补充相关业务查询拒绝与提示结构断言。
- 前后端类型检查、前端路由/i18n/平台备份守卫、双端构建与 dist 边界通过；修改文件 Lint 0 错误（AppLayout 1 条既有格式警告），Impeccable 检查空列表。浏览器验证本地正常/保护状态和核对入口，390px 英文深色宽度及 scrollWidth 均为 390。
- 授权测试主控双端页面已热更新，旧页面备份在 `/root/incudal-recovery-ui-V5d2Xs`。公开两端 index.html 与本地构建逐字节一致；真实后台已登录验证用户、机器池和版本页显示保护提示，恢复核对页仍可访问。唯一后端 `MainPID=1220587`、`NRestarts=0`，保护文件哈希与部署前一致，未重启后端。
- 实时宿主核对：ID 6/7/8/9 可用，ID 6 唯一运行实例与登记一致，ID 7/8/9 无远端实例；ID 3/4 连接报 EHOSTUNREACH，ID 3 登记 1 个运行实例尚未核对。无待执行实例任务。此项仍未完成，不应据数据库一致性解除保护或自动清除库存隔离。源码修复未提交、未推送、未发新版本；生产 OTA 未执行。
- Owner 14:08:47 确认恢复运营，任务 `2997e2f7-38b2-4556-89af-2ed18601a42a` 在启动执行器前被受信文件清单拦截，显示 `OSS_WORKER_STOPPED`；后端未重启、保护未解除。原因是本轮前端热更新漏做 seal。已逐文件确认 125 个新增资源与 2 个 index.html 改动仅属于已验证前端，无删除或后端变化；保存旧清单后执行受信 seal，保护文件哈希不变。WireGuard 配置与 SSH 管理身份均与恢复前逐字节一致。
- 沿用 Owner 的恢复运营确认，补齐清单后通过已安装 CLI 重试：任务 `ce2f3e1c-5daf-423b-a07c-c9ad60c093d4` 于北京时间 14:19:06 达到 `success/resumed`，健康接口 `recoveryHeld=false`，唯一后端 `MainPID=1229991`、`NRestarts=0`。实际后台验证用户 4 条、机器池 6 台、版本与 OTA 资产信息恢复显示；测试主控版本元数据仍为 v1.6.8，v1.6.9 仅部分热更新，未执行新的 OTA。6 台宿主的库存隔离保留；fra-amd-2/fra-amd-1 仍无法通过管理网络连接，宿主实时核对未完成，未对其节点执行变更。

## 2026-10-21 v1.6.9 发布（完整备份、额外 ZIP 与恢复指南）

- [正式发行 39539930557](https://github.com/mastalee928/payincus/actions/runs/39539930557) 的五个作业全部成功，2026-10-21 11:47:37（北京时间）发布，非 draft、非 prerelease。发行源码及标签对象与上方记录一致；amd64 作业完整执行 172 项检查，planned / executed / passed 均为 172、failed 为 0。双架构 Linux 首装及恢复演练使用本地 OSS 传输替身；真实云端证据单独记录在下方。
- 两种架构的公开发行包已下载复核：amd64 109177028 字节、SHA256 `5f8f97cb8ad928ac31ded4eb9308000f86da819cb663c809814d5d121d705016`；arm64 108318101 字节、SHA256 `780f7036271ace68fab685e686c621f9d0bcfc77fa2b4a8220f4d4f3b96d300a`。各自 `.sha256`、GitHub 资产 digest 与 OTA manifest 一致；两份 manifest 逐字节一致，记录 `gitCommit=54203107fa13`、`minimumUpdaterVersion=v0.0.3`、`buildTime=2026-10-21T03:47:25.946Z`。包内版本、212 条迁移、备份模块、双端工具/说明与发行脚本同源均通过；两种架构的双端 index.html 哈希一致，不含本地 `.env` 或 `oss-review.html`。核验记录：`logs/release-v1.6.9/verification.json`。
- 同一发行提交的 [源码 CI 39538543643](https://github.com/mastalee928/payincus/actions/runs/39538543643) 与 [文档 Pages 39538543664](https://github.com/mastalee928/payincus/actions/runs/39538543664) 均成功。公开 main 的安装器、恢复工具和说明与本地源码逐字节一致，发行包内上述脚本与 LICENSE 与发行提交逐字节一致。Agent v1.0.3 仍提供 x86_64/aarch64 两种二进制，面板 latest 仍为 v1.6.9。
- 保留原自动恢复 `payload.enc` 与完成标记，额外上传按 UTC 日期时间命名、使用同一密码的 AES-256 ZIP/ZIP64。ZIP 包含同源整库归档、可移植整库 SQL、按表排列 SQL、权限/配置/身份、快照清单、完整性报告、中文说明和交互工具。
- 备份在共享快照下核对每张表的完整记录、多重集、结构、大对象及归档序列状态；保留原归属/授权和 globals。实际临时库恢复匹配后才打包；ZIP 每项解密哈希与两份 OSS 对象回读均通过才发布 complete 标记。清理失败显示警告；中断清理覆盖额外 ZIP，且限于当前安装命名空间。
- 页面底部直接提供两种中文恢复场景和说明/工具下载；工具使用目标机已安装执行器，交互读取秘密并固定读取目标 .env。旧加密格式读取保持兼容，旧包不会补生成 ZIP。
- 本地 172 项完整检查全部通过（`logs/test-run-20261021-103403/summary.txt`），双端/后端构建和 dist 边界、安装器守卫、冻结依赖通过；Lint 0 错误（663 条既有样式警告）。后续数据库 SQL 导出调整另跑类型/平台备份守卫/后端构建。说明和工具公开副本与发行脚本同源校验通过。
- 浏览器真实点击恢复步骤、说明/工具下载通过；390px 深色样本页面宽度与 scrollWidth 均 390，无横向溢出。样本使用模拟接口；不等同于云端上传或实际恢复。机械 UI 检查返回空列表。
- 测试主控恢复工具 `status` 实际调用成功；公网下载与安装脚本副本逐字节一致（SHA256 `6116600a752ab8df540a002a25c82a1b362ddd3594ee367964753c780480d039`）。新增发行首装断言核对双端公开工具/说明与执行器脚本的副本一致。
- 授权测试主控已热更新，唯一后端健康且 NRestarts=0；更新前保存数据库、运行配置、证书及受影响文件。真实 Linux 隔离演练已通过逐表 SQL、整库 SQL 与原生归档恢复一致性，以及金额、数组下标、序列、大对象、缺表、外部表拒绝等检查。真实 OSS 已验证：备份 e0b7ab24-8998-4814-899a-902f134e5d33，ZIP `payincus-backup-20261021-031730-UTC.zip`（北京时间 11:17:30）1,845,157 字节；相同密码解密全部文件、126 表/1,318 行/118 序列、整库 SQL 与原生归档实际恢复一致，原 payload.enc 预检成功。预检任务 1a91e48a-009d-4f3a-a0f0-83c11037a4a2，配置 revision 与恢复保护保持不变。[双架构预览 39538838380](https://github.com/mastalee928/payincus/actions/runs/39538838380) 和 [正式发行 39539930557](https://github.com/mastalee928/payincus/actions/runs/39539930557) 均通过，包含 212 条迁移、唯一后端、双端登录、备份/预检/恢复/回退/恢复运营、密钥一致性与全库 SQL/原生恢复核对。生产 OTA 未执行。

## 2026-10-20 OSS 设置修复（测试主控热更新，未发版）

- 修复连接区缺少保存/测试入口：仅填写 AccessKey 即可保存或测试列桶权限；选择桶、保存备份密码并通过桶读写测试后才可启用自动备份或立即备份。保存失败显示准确原因并保留表单，三语文案同步。
- 测试主控为旧平铺部署，原先缺少 `/var/lib/incudal-backup` 与备份服务，导致保存失败被错误归类为 `OSS_OPERATION_FAILED`。热更新补齐目录、受限调用和服务；安装/更新/启动检查接入同一安装脚本。真机首次启动检查暴露 `systemctl daemon-reload` 被后端 PATH 中的受限 wrapper 拦截，已改为 `/usr/bin/systemctl daemon-reload` 并补回归守卫。
- 真机复现 OSS V4 根目录浏览签名错误：同一凭据可列桶、读桶区域，带空 `prefix=` 的对象列表失败；省略空参数及非空目录均成功。修复仅省略根目录空参数，继续使用 V4。回归守卫执行已安装 SDK 的真实签名流程，仅替换 HTTP 边界，覆盖根目录、非空目录与分页游标。
- 本地证据：前后端类型检查、7 项相关守卫（部署/前端路由/i18n/系统更新/平台备份及类型检查）、安装器守卫、双端生产构建和 dist 边界守卫通过。签名修复后重新通过后端类型检查、构建和平台备份守卫。首轮守卫记录：`logs/test-run-20261020-222707/summary.txt`。
- 测试主控最终唯一后端 `MainPID=1094590`，健康检查成功、恢复保护关闭，组件及目录权限正常；两端首页与各 9 个关联资源经公网逐字节比对一致，安装脚本与最终 OSS 后端构建哈希也与本地一致。真实管理员 API 的列桶与根目录对象列表均返回 200，未鉴权返回 401；验证保留已有配置。实际浏览器点击目标桶后成功显示根目录的三个目录，无错误提示，凭据字段移出视口后的截图保存在 `logs/oss-hotfix-ociee-verified.png`。另核到测试机 22:54:05 发起的真实备份任务在 22:54:17 达到 `success/complete`；恢复覆盖演练未执行。
- 热更新前备份分别保存在测试主控 `/root/incudal-oss-hotfix-20261020-2236-r2` 和 `/root/incudal-oss-signature-20261020`。本轮仅更新测试主控与本地源码，正式 v1.6.8 标签、Release 安装包和生产部署证据未改变。

## 2026-10-20 v1.6.8 发布（阿里云 OSS 平台备份与恢复）

- 新增管理员「系统 → 阿里云OSS」入口：区域/桶/目录、1/3/5 份保留、1/3/6/12/24/72 小时定时加密备份、预检恢复、保护模式及本地回退。
- 人工代码审视修复 SDK 完成回调空 checkpoint、网关 `.pub` 文件和应用密钥权限、授权文件回退、主密钥一致性、恢复保护登录与发行包安装脚本遗漏。
- 本地验证：172 项全量检查全部通过，双端和后端构建、dist 边界、Bash 安装守卫通过，Lint 0 错误；桌面/窄屏浅深色页面和恢复确认已检查。
- 新增 `scripts/smoke-platform-backup.mjs`，双架构首装 CI 已在一次性 Linux VM 上通过真实 PostgreSQL/systemd 的备份、预检、恢复、回退、恢复登录和跨主密钥一致性检查；仅 OSS 传输以本地文件替代。两边均应用 212 条迁移，确认唯一后端、双端访问、受限管理网关以及配套 Agent v1.0.3 下载和运行。
- 云端 OSS 权限、实际上传与云端异常清理尚待专用测试桶验收；平台备份不包含 VPS 磁盘，换 IP 的 WireGuard 自动重连仍待后续专项。
- [预览运行 39384509063](https://github.com/mastalee928/payincus/actions/runs/39384509063) 成功：双架构构建与首装/恢复验证成功，发布作业按预览设计 skipped。源码 [CI 39384508902](https://github.com/mastalee928/payincus/actions/runs/39384508902) 和文档 Pages [39384508903](https://github.com/mastalee928/payincus/actions/runs/39384508903) 成功。
- [正式发布 39386136385](https://github.com/mastalee928/payincus/actions/runs/39386136385) 的五个作业全部 success：arm64 构建、amd64 构建、两种架构首装/恢复验证、发布 Release。Release 于北京时间 2026-10-20 15:30:53 发布，非 draft、非 prerelease；公开 release notes 已补齐使用和验收边界。
- 两份公开安装包已实际下载复核：amd64 106775535 字节，sha256 `74d97518d0807e3712b803fe6fc5e75436694df8808977f9174f1ca25cdd6f33`；arm64 105928055 字节，sha256 `827311f5721827518de9e548f918a15b756045fcd47c5cbe083d679840b8ff09`。校验文件、版本化及通用 OTA manifest 一致，manifest 和包内元数据均指向 `v1.6.8` / `44d26132f02f`。
- 包内备份 worker/CLI/服务/安装脚本、完整迁移、双端入口与 LICENSE 已确认；双架构前端入口 HTML 哈希一致。未包含 `.env` 或本地 UI 样本。安装包及本地复核记录保存在 Git 忽略的 `logs/release-v1.6.8/`。
- 操作要求已公开到 `docs-site/docs/deployment/oss-backup.md`。本次只发布 GitHub 源码/标签/Release，没有执行生产 OTA。后续台账/版本日志文档提交不改变发行标签及安装包内容。

## 2026-10-18 v1.6.7 发布（机器池面板改版、区域三语化与客户实例打磨）

- 发行源码 `fa716ee699e4ff77400b21bd093968c8be5f0dbc`（`ec7c329` 仪表盘负载条修复、`f006276`/`e74c81a` 机器池面板改版、`0563db7` 选购区域卡片瘦身、`d7b609c` 区域三语与 OCI 机型名、`6a96e1e` 重置密码与精简销毁弹窗、`58e9e9b` 实例面打磨、`f141fa8` 钱包推荐计划隐藏与余额流水文案迁移、`fa716ee` 版本准备）；注解标签 `v1.6.7`（对象 `da4fdd3d1087d8cc59a8b0c4fcedba637ae95a6a`）。[正式发布运行](https://github.com/mastalee928/payincus/actions/runs/39141400802) 运行级结论 success，五个作业全部成功：构建 arm64 2m32s、构建 amd64 5m36s、全新安装验证 arm64 1m23s、全新安装验证 amd64 1m25s、发布 Release 19s（15:38:34Z→15:46:01Z；publishedAt 2026-10-18T15:45:58Z，非 draft、非 prerelease；GitHub 面板 latest 为 v1.6.7）。
- [预览运行](https://github.com/mastalee928/payincus/actions/runs/39140719213)（7m42s）：两个构建作业成功（arm64 2m35s、amd64 5m54s），双架构全新安装验证均成功（arm64 1m39s、amd64 1m34s），`发布 Release` 按预览设计 skipped。
- 公开资产：`incudal-v1.6.7-linux-amd64.tar.gz` 104572352 字节 sha256 `b85ac4b269a59b6c3580bdc55201102a4fe386ee27bba6e899304332959d61dd`；`incudal-v1.6.7-linux-arm64.tar.gz` 103739504 字节 sha256 `5073b7b6f5fe0102c55db3c808ce1d6036daab993daebb70e6920e4e35c55654`；两份 `.sha256` 已重新下载复核通过；`incudal-v1.6.7-ota-manifest.json` 与通用 `ota-manifest.json` 内容一致，记录 `gitCommit=fa716ee699e4`、`minimumUpdaterVersion=v0.0.3`；发行包内 user/admin `index.html` 与本地构建逐字节一致（双架构相同）。
- 同一提交的源码 CI（[39140374936](https://github.com/mastalee928/payincus/actions/runs/39140374936)、[39140704865](https://github.com/mastalee928/payincus/actions/runs/39140704865)）与文档站 Pages 部署（[39140704831](https://github.com/mastalee928/payincus/actions/runs/39140704831)）成功。
- 本地验证：`node scripts/run-tests.mjs` 全部通过（planned / executed / passed 171、failed 0、5m46s）；前后端类型检查、双端生产构建与 dist 边界守卫、Lint（0 错误）通过。
- 本次发布内容：
  - 管理端机器池面板改版（行操作菜单、地区筛选 chips、紧凑行展示公网 IPv4 与 OCI 账号）；选购页区域卡片去掉库存状态行。
  - 45 个区域名称英/繁三语化，选购、首页、结算与实例页面随界面语言显示；客户实例页面显示 OCI 机型名（`VM.Standard.E2.1.Micro` / `VM.Standard.A1.Flex`）。
  - 实例详情「重置密码」替换升级入口（宿主机侧 chpasswd 写入并加密保存）；资源占用面板移除配置编辑入口。
  - 销毁弹窗隐藏内部节点名、删除退款与规则区块、显示 OCI 机型名、顶部警示无退款且不可恢复（三语）。
  - 实例卡去「网络」「流量」行；概览「我的实例」IP 前显示国旗与本地化区域名；IPv6 复制按钮贴地址。
  - 钱包「推荐计划」Tab 隐藏（入口、切换、渲染三层拦截，代码保留待启用）；余额明细内部用语「一机一卖」改为「购买实例」，存量记录经迁移 `202610180003_pool_remark_wording` 统一改写。
  - 订单详情抽屉 Teleport 到 body，修复头部被控制台顶栏遮挡。
- 测试主控上机：发布前第六轮全量热替换（ps48，备份 `/root/incudal-handswap-2026-10-18-round6`）载入 `f141fa8` 构建，双端 `index.html` 与本地构建及发行包逐字节一致；迁移应用后存量「一机一卖」文案 0 条、新文案 14 条；健康检查 200、路由探测与标记抽查全中、seal 23:30。面板 OTA 正式升级至 v1.6.7 待 owner 执行。

## 2026-10-18 v1.6.6 发布（用户 Telegram 通知、管理端分类告警机器人与管理员建号）

- 发行源码 `9f1a14a799a9600a4aa6a3c84f9cffa7d68ad087`（含 `1b109d3` 的用户 Telegram 通知与逐用户聚合、`2e4b71b`/`d4b8621` 管理端分类告警机器人、`7a43fa8` 管理员建号、`ea3fe38` 仪表盘机型展示）；注解标签 `v1.6.6`（对象 `55bdb1dcfba1197b42a050ad8bf130afccaf6410`）。[正式发布运行](https://github.com/mastalee928/payincus/actions/runs/39109797096) 运行级结论 success，五个作业全部成功：构建 arm64 2m33s、构建 amd64 3m49s、全新安装验证 amd64 1m24s、全新安装验证 arm64 1m29s、发布 Release 24s（publishedAt 2026-10-18T08:06:29Z，非 draft、非 prerelease）。
- [预览运行](https://github.com/mastalee928/payincus/actions/runs/39109288989)（7m08s）：两个构建作业成功（arm64 2m33s、amd64 5m34s），双架构全新安装验证均成功（arm64 1m25s、amd64 1m30s），`发布 Release` 按预览设计 skipped。
- 公开资产：`incudal-v1.6.6-linux-amd64.tar.gz` 104591129 字节 sha256 `4cef381fe6510021d417590bb06acf3d3dc07970b0a5919cae33df478bf5d08c`；`incudal-v1.6.6-linux-arm64.tar.gz` 103721559 字节 sha256 `5fda24182f54e933579e7b37e1a1605a30a098d8cbe9f19d94d0806d03e5bd9c`；两份 `.sha256` 与 `incudal-v1.6.6-ota-manifest.json`（另含通用 `ota-manifest.json`，两者内容一致），manifest 记录 `gitCommit=9f1a14a799a9`、`minimumUpdaterVersion=v0.0.3`、`buildTime=2026-10-18T08:06:19.402Z`；两种架构发行包已重新下载并逐字节复核体积与 sha256 一致。
- 同一提交的源码 CI（[39109288202](https://github.com/mastalee928/payincus/actions/runs/39109288202)，Lint & Type Check 1m26s + Build 2m30s）与文档站 Pages 部署（[39109288025](https://github.com/mastalee928/payincus/actions/runs/39109288025)，build 26s + deploy 8s）均成功。
- 本地验证：9f1a14a 上 `node scripts/run-tests.mjs` 全部通过（planned / executed / passed 171、failed 0、5m40s）；前后端类型检查、双端生产构建与 dist 边界守卫、Lint（0 错误、无新增告警）通过。守卫清单 169→171：新增 `test:user-telegram-notify-guards` 与 `test:admin-alert-bots-guards`。
- 9f1a14a 同时包含版本位（三个 `package.json`）、`README.md`、`AGENTS.md` 更新至 v1.6.6 与新增 `docs-site/release-notes/v1.6.6.md`；文档站版本日志按 v1.6.6 重新生成并随本次台账提交。
- 本次发布内容：
  - 用户 Telegram 通知（官方站点 Bot）：绑定后默认开启，覆盖开通成功/失败/超时、手动与自动续费、自动续费失败、充值到账、充值支付失败、临期提醒（T-3/T-2/T-1）与已到期；个人设置提供开关与最近一次推送失败提示，Bot 内支持 `/notify on|off`。
  - 定时通知按「每用户每轮任务一条」聚合防轰炸：临期、已到期与自动续费结果合并发送，站内信 / Telegram / 邮件同档；单台实例文案不变，多台合并为清单（最多 15 台）。
  - 管理端四类分类告警 Bot（工单 / 宿主机 / 财务 / 实例）可在设置页分别配置；工单推送含主题、内容、分类、优先级与附件数量。
  - 管理员可在用户管理页直接建号（复用注册校验、16 位初始密码、审计记录）；仪表盘实例卡片展示机型规格替代 LXC/KVM 标签。
- 测试主控（`51.170.43.169`，旧布局）由 owner 通过面板 OTA 升级至 v1.6.6 并回报成功；本次会话未持有 SSH 通道，主机侧明细（任务号、MainPID、version.json）未采集，以线上产物核验替代：用户端 `vm-test.masta.ee` 的 `index.html`（sha256 `c9877af6ea9e3b85c63152845b7c121e56c3d1de95fd37c85fcf1b0a486d2a0f`）与管理端 `vm-admin.masta.ee` 的 `index.html`（sha256 `5a1776c66ca407207c2c4c46536a9a39779365b63311895e70db7fe3c72ebcd5`）均与发行包内同名文件逐字节一致、资产清单一致（另抽查懒加载资源 8 个文件 sha256 与发行包一致）；v1.6.6 新增路由 `PUT /api/telegram/notification` 未鉴权返回 401（对照既有路由同为 401，路由确已注册；旧版为 404）；`/api/health` 200。
- 发布后源码修复（未发版）：仪表盘「最近实例」卡片底部的负载条把 CPU 配额（如 100%）当作实时占用渲染（配额 >85 恒红，源自 Nimbus 仪表盘改版 `05e94d3`），owner 于升级后报告“总是以为是服务器炸了”；列表接口不含实时占用数据，经 owner 选择直接移除该负载条（提交 `ec7c329`），仅动前端模板与样式、无业务逻辑变化；已过前端路由守卫、前后端类型检查与双端生产构建，随下一次发布进入安装包。
- 已知既有缺陷（同 v1.6.5 记录，本次未涉及）：根 `verify:final-acceptance` 的 POSIX 前缀写法（设计在 Linux 侧执行）；测试主控上的历史 failed 更新单元 `incudal-online-update@1/4/5`。

## 2026-10-18 v1.6.5 发布（Windows 工具链与 Agent 版本清单取数健壮性）

- 发行源码 `3fb8a0eb9dd95088addf221e538a9eeac4e687f3`（含 `67efd41` 的 Agent 403 修复与 `cea16a6` 的 Windows 工具链落地）；注解标签 `v1.6.5`（对象 `26a2651773e813b7292506c9a7fd776b4672bb16`）。[正式发布运行](https://github.com/mastalee928/payincus/actions/runs/39088069681) 运行级结论 success；已取得用时的作业：amd64 构建 3m28s、双架构全新安装验证各 1m30s、发布 Release 25s（publishedAt 2026-10-18T01:58:25Z，非 draft、非 prerelease）。arm64 构建作业在 GitHub 作业接口里结论字段缺失（status 仍为 in_progress、completedAt 为空），属接口数据不一致；该架构的发行包与全新安装验证均已成功产出并通过。
- [预览运行](https://github.com/mastalee928/payincus/actions/runs/39087584812)（7m25s）：两个构建作业成功（arm64 2m42s、amd64 5m52s），双架构全新安装验证均成功（arm64 1m24s、amd64 1m20s，amd64 本次首轮即过；此前 v1.6.3 与 v1.6.4 预览各因新装面板匿名抓取 GitHub 限流失败一次），`发布 Release` 按预览设计 skipped。
- 公开资产：`incudal-v1.6.5-linux-amd64.tar.gz` 104530875 字节 sha256 `8b3676b9dcf4e041cb7f24dcb83a3eb4a504393b5be357a5fa787da104889399`；`incudal-v1.6.5-linux-arm64.tar.gz` 103700049 字节 sha256 `d9273ecf88ee3d4670b4fcf2df528ec7274f731e03cb0be56d30a13941fa4633`；两份 `.sha256` 与 `incudal-v1.6.5-ota-manifest.json`（另含通用 `ota-manifest.json`），manifest 记录 `gitCommit=3fb8a0eb9dd9`、`minimumUpdaterVersion=v0.0.3`。
- 同一提交的源码 CI（[39087584675](https://github.com/mastalee928/payincus/actions/runs/39087584675)，Lint & Type Check 1m45s + Build 2m32s）与文档站 Pages 部署（[39087584738](https://github.com/mastalee928/payincus/actions/runs/39087584738)，42s）均成功。
- 本地验证：main 上 `node scripts/run-tests.mjs` 全部通过（planned / executed / passed 169、failed 0、5m44s）；前后端类型检查、双端生产构建与 dist 边界守卫、`pnpm --dir docs-site --ignore-workspace check:deployment`、`bash scripts/test-install-panel-guards.sh`、`node scripts/run-tests.mjs --check` 与 `pnpm install --frozen-lockfile` 均通过。根 `pnpm test` 现为 `node scripts/run-tests.mjs` + 根 `package.json` 的 169 条 `testGuards` 清单（逐条 spawn；旧版「`&&` 串成超长脚本」在 Windows 上会被 shell 静默截断却退出 0，是本次修复的假绿来源）。
- 本次发布内容：
  - Agent 版本清单取数健壮性：`server/src/routes/agent.ts` 的 GitHub 请求改为有界重试（仅重试 403 rate limit / 429 / 5xx 与网络错误，遵守 Retry-After，其它 4xx 立即失败），连续失败且已有缓存时继续提供旧清单并提示配置 `INCUDAL_AGENT_RELEASE_TOKEN`；`.github/workflows/release.yml` 的全新安装验证注入 `github.token`（本次 amd64 作业日志显示该变量已传入且全程无 403 行），`scripts/install-panel.sh` 与 `scripts/init-env.sh` 把环境中的该变量写入 `.env`。
  - Windows 工具链：根 `test` 改为 `node scripts/run-tests.mjs`（执行前校验每个条目的脚本真实存在，任一失败即以守卫名 + 尾部输出 + 日志路径非零退出）；`.gitattributes` 把源码/文本类扩展名钉为 `text eol=lf`（`*.bat`/`*.cmd`/`*.ps1` 保持 CRLF），逐字节断言的守卫跨平台一致；前端 `dev`/`build` 脚本与根 `dev`/`dev:split`/`dev:user`/`dev:admin` 改用 `cross-env`，根 `devDependencies` 与锁文件根 importer 同步加入 `cross-env@10.1.0`。
  - 发行包纳入 `scripts/run-tests.mjs`：装机目录的 `pnpm test` 不再报模块缺失，而是明确提示缺少工作区 `package.json` 并返回非零退出码（装机形态实测退出 1，无假绿）；守卫套件仍只在源码仓库中运行。
  - 版本位（三个 `package.json`）、`README.md`、`AGENTS.md` 更新至 v1.6.5；新增 `docs-site/release-notes/v1.6.5.md`；文档站版本日志按 v1.6.5 重新生成（两条 version-log 共 +59/−15）并随台账提交。
- 测试主控（`51.170.43.169`，旧布局）经面板 OTA 任务 `7` 由 v1.6.4 升至 v1.6.5：任务 startedAt 2026-10-18T02:00:19.929Z、finishedAt 2026-10-18T02:02:16.427Z（约 1 分 56 秒）；单元 `incudal-online-update@7` 最终 Result=success、ExecMainStatus=0，日志结尾 `System update completed successfully`，并清理了 OTA 下载缓存；升级前整目录备份 `/opt/incudal.bak.20261018020019`。升级后唯一后端实例（`incudal-backend`，MainPID 716294、active/running）、`/api/health` 200、`version.json` 为 `v1.6.5`。
- 真机核验（升级后主站，v1.6.5 在线）：`/api/agent/manifest.json` 返回 200（377 字节，`version=v1.0.3`，含 `linux-amd64` 与 `linux-arm64` 的 sha256 与 size）——本次唯一行为改动路径在线上可用；`/api/health` 返回 `{"status":"ok"}`；面板 OTA 期间自身完成 `verify-split-host` 静态资源与反向代理校验（任务 #7 日志）。
- 另按 owner 授权清理测试主控上 v1.6.3/v1.6.4 期的三个旧备份目录（`/opt/incudal.bak.20261017131225` 2.2G、`.20261017144338` 1.1G、`.20261017172752` 1.1G，合计约 4.4G）：删除前 `df /` 为 196G 中已用 13G（7%）、可用 173G，删除后已用 8.8G（5%）、可用 177G，仅保留本次升级的备份 `/opt/incudal.bak.20261018020019`（1.1G）。
- 工作区清理：四个 `claude/*` worktree 分支（`affectionate-dijkstra-5f9a57`、`gifted-roentgen-494ceb`、`goofy-blackwell-c32240`、`zen-dewdney-bc1653`）确认已全部并入 main 后注销并删除分支；其未提交改动（`.gitattributes`、`AGENTS.md`、`client/package.json`、`package.json`、`pnpm-lock.yaml`、`scripts/run-tests.mjs`）逐字节核对后并入 `cea16a6`，其中 `affectionate` 额外的根 `cross-env` 改动并入 `3fb8a0e`。四个 worktree 目录本体（内容已清空为 0 项）当时被应用进程占用而无法从命令行删除；随后归档拥有它们的四个空闲应用会话，句柄释放，四个空目录已删除（`.claude/worktrees` 只剩空目录）：`affectionate-dijkstra-5f9a57`、`gifted-roentgen-494ceb`、`goofy-blackwell-c32240`、`zen-dewdney-bc1653`。
- 已知既有缺陷（本次未改，均与本次改动无关）：
  - 根 `package.json` 的 `verify:final-acceptance` 仍使用 POSIX 环境变量前缀写法（该脚本设计在 Linux 侧执行，本次未改）。
  - 测试主控上存在 `incudal-online-update@1/4/5` 三个历史 failed 单元（v1.6.2/v1.6.3 期遗留的失败记录，不影响新任务启动）。

## 2026-10-18 v1.6.4 发布（结算可选在线支付渠道、用户导航调整与回调防伪断言）

- 发行源码 `41d87820504977ffb24f895ab6c735a67f17fdaa`；注解标签 `v1.6.4`（对象 `8d39a04ea5d084378664e24ff0c0326758c2d744`）。[正式发布运行](https://github.com/mastalee928/payincus/actions/runs/39053295718) 五个作业全部成功：amd64 / arm64 构建、双架构全新安装验证与发布 Release（`publishedAt 2026-10-17T17:26:38Z`，非 draft、非 prerelease）。
- [预览运行](https://github.com/mastalee928/payincus/actions/runs/39052508600)：两个构建作业成功；`全新安装验证 (arm64)` 首轮通过，`全新安装验证 (amd64)` 首次因新装面板抓取 Agent release 命中 GitHub 403 限流失败（`fetchJsonFromGitHub`，`server/dist/routes/agent.js:404`），`gh run rerun --failed` 重跑后通过，整体结论成功。
- 公开资产：`incudal-v1.6.4-linux-amd64.tar.gz` 104538519 字节 sha256 `5594bdfdc561d315c81f4893cf7ae536f993178f920cd38c3769009d84f310e0`；`incudal-v1.6.4-linux-arm64.tar.gz` 103683820 字节 sha256 `48d5ecc531588ec3deabe517660037283fa5408b39faa34c0d6b344742a6e695`；两份 `.sha256` 与 `incudal-v1.6.4-ota-manifest.json`（另含通用 `ota-manifest.json`），manifest 记录 `gitCommit=41d878205049`、`minimumUpdaterVersion=v0.0.3`。
- 同一提交的源码 CI（[39052465293](https://github.com/mastalee928/payincus/actions/runs/39052465293)，Lint & Type Check + Build）与文档站 Pages 部署（[39052465326](https://github.com/mastalee928/payincus/actions/runs/39052465326)）均成功。
- 本地验证：前后端类型检查、client ESLint（0 error，保留既有样式警告；改动的 CheckoutView 无新增告警、DashboardView 唯一 1 条为 HEAD 既有）、双端生产构建与 dist 边界守卫、文档站构建与 `check:deployment` 全部通过。全套 167 条守卫逐条核验：首次整串（`npm_config_script_shell=bash pnpm test`）在 `user-destroy-incus-order` 之后被 Windows 侧命令串截断（`None of the selected packages has a "test:ins" script`）却仍返回 0；比对根脚本命令清单后补跑缺失的 20 条（`instance-delete-incus-order` 至 `host-public-ipv6`），全部通过，覆盖完整。CI 侧同一守卫步骤在 Linux amd64 上亦为 success。
- 本次发布内容：
  - 购物车结算（含选购页「加入并结算」）可选支付方式：账户余额，或后台已启用的任一在线支付渠道。选网关渠道时按整单金额创建充值单，服务端 `calculateRechargeAmountForCredit` 把手续费补足（易支付手续费外加、其它渠道内扣向上取整，并用 `calculateActualAmount` 逐分校验），保证实际到账不少于订单金额；到账后仍由余额完成整单扣款与开通，购买订单没有新增支付状态。
  - 支付回调防伪断言进入 `test-recharge-accounting-guards`：回调处理函数内必须存在来源 IP 白名单、逐渠道验签（易支付 `verifyWithStatus`、Heleket、UPAY Pro、Antom、通用 `verifyCallbackSignature`）、渠道一致性、仅当前支付尝试有效与去重，且 IP 与签名检查次序必须在 `db.completeRecharge` 之前；结算页只认服务端 `completed`，前端不参与入账。
  - 用户端导航：「购买主机」改为「创建实例」，「实例」改为「我的实例」（新增 `nav.myInstances`，不动共享的 `nav.instances`）；用户端「概览」页创建实例入口直达 `/purchase`；公共站入口与选购页标题同步。
  - 移除用户端「福利」导航与 `/entertainment` 路由（页面代码与 `entertainmentPath()` 保留，便于重新启用）；管理端娱乐页不受影响。
  - 版本位（三个 `package.json`）、`AGENTS.md`、`README.md` 更新至 v1.6.4；新增 `docs-site/release-notes/v1.6.4.md`；文档站版本日志按 v1.6.4 重新生成。
- 测试主控（`51.170.43.169`，旧布局）经面板 OTA 任务 `#6` 由 v1.6.3 升至 v1.6.4：`startedAt 2026-10-17 17:27:51.971`、`finishedAt 17:29:48.126`，日志结尾 `System update completed successfully`；更新前整目录备份 `/opt/incudal.bak.20261017172752`。升级后唯一后端实例（MainPID 501859、`NRestarts=0`、active/running）、`/api/health` 200、`version.json` 为 `v1.6.4`（`gitCommit=41d878205049`，`deployedAt 2026-10-17T17:28:54.367Z`）。
- 真机产物核验（vm-test.masta.ee 线上 v1.6.4 用户端产物）：含「创建实例」「我的实例」与结算网关文案（前往支付 / 等待支付到账 / 打开支付页面）；路由标记 `name:"entertainment"` 已不存在；`/entertainment` 字面量仅存于 API 客户端 chunk（既有端点字符串）。管理端产物 `/admin/entertainment` 完好，未被误伤。
- 已知既有缺陷（本次未改，均与本次改动无关）：
  - Windows 下 `pnpm build` 因 `VITE_APP_ENTRY=user vue-tsc` 这类 POSIX 写法在 cmd 中失败（本次仍以等价命令构建）。
  - 全新安装验证中面板未鉴权抓取 GitHub Agent release 的 403 限流健壮性缺口（v1.6.3 预览与本次预览各复现一次，重跑即过）。
  - Windows 侧根 `pnpm test` 超长命令串截断且退出码误导（本次以比对清单 + 补跑方式绕过）。

## 2026-10-17 v1.6.3 发布（在线更新的失败可见性与阻塞修复）

- 发行源码 `f8d2ca450e01a10a54ae5f57b75e4f80821371dd`；注解标签 `v1.6.3`（对象 `5d7b3e170a6de887256c5ccc2ba32e8e8d7bb58f`）。[正式发布运行](https://github.com/mastalee928/payincus/actions/runs/39041293327) 五个作业全部成功：amd64 / arm64 构建、双架构全新安装验证与发布 Release。
- [预览运行](https://github.com/mastalee928/payincus/actions/runs/39040445406) 首次的 `全新安装验证 (amd64)` 因新装面板抓取 Agent release 命中 GitHub 403 限流而失败（`fetchJsonFromGitHub`，`server/dist/routes/agent.js`），重跑该作业后通过、整体结论为成功；该健壮性缺口已单独记录待修，本次未改动相关代码。
- 公开资产：`incudal-v1.6.3-linux-amd64.tar.gz` 104550174 字节 sha256 `5984472d6c9937e2ebddf9d82c752676fdcc358abaebafa64097c6cff60a4ecc`；`incudal-v1.6.3-linux-arm64.tar.gz` 103705434 字节 sha256 `6ea07ce7de0e90ded81c9c5da9ca0d588c22692b25939235f553a9adda02833f`；两份 `.sha256` 与 `incudal-v1.6.3-ota-manifest.json`（另含通用 `ota-manifest.json`），manifest 记录 `gitCommit=f8d2ca450e01`、`minimumUpdaterVersion=v0.0.3`。
- 同一提交的源码 CI（[39040332118](https://github.com/mastalee928/payincus/actions/runs/39040332118)，Lint & Type Check + Build）与文档站 Pages 部署（[39040332125](https://github.com/mastalee928/payincus/actions/runs/39040332125)）均成功；本地双端类型检查、ESLint（0 error）、全套 169 项守卫（CI 同款占位 `DATABASE_URL`）、双端构建与 dist 边界、文档站构建、`pnpm install --frozen-lockfile` 全部通过。
- 测试主控（`51.170.43.169`，旧布局）经面板 OTA 任务 `#3` 由 v1.6.2 升至 v1.6.3：`startedAt 14:43:38Z`、`finishedAt 14:45:35Z`，日志结尾 `System update completed successfully`；更新前整目录备份 `/opt/incudal.bak.20261017144338`（内含 `db-pre-migrate-v1.6.3-*.sql`）。升级后唯一后端 active、`NRestarts=0`、`/api/health` 正常，`version.json` 为 v1.6.3（`gitCommit=f8d2ca450e01`）。
- 真机验证新行为（临时移走 root helper 以模拟“unit 已启动但 worker 未运行”，此状态下不可能真正安装；验证后 helper 复原、清单重新封存）：
  - 任务 `#4` 未在 24 秒内被认领，被**立即标记为失败**，原因是“更新任务未在 24 秒内启动（unit failed/failed，Result=exit-code，ExecMainStatus=203）…排查命令：journalctl -u 'incudal-online-update@4.service'”；同 unit 的 journal 显示 `Unable to locate executable '/usr/local/libexec/incudal/incudal-online-task'` 与 `status=203/EXEC`，与面板显示的原因一致。
  - 任务 `#5` 在 pending 窗口内经面板取消，HTTP 200 并变为失败（“已由管理员取消：任务从未启动”）；30 秒后未被仍在等待的服务端覆盖，无 pending 残留。
  - 复核状态：helper 属主与权限不变、无残留文件，可信清单 `FILES_MATCH` + `LINKS_MATCH`，任务表仅 2 success / 3 failed，无 pending。
- 同时修正长期过时的版本号：`AGENTS.md`（v1.3.7）与 `README.md`（v1.6.2）更新为 v1.6.3；中英文 OTA 指南与中英文后台总览补齐“未启动任务会自动释放/可取消、失败原因与 journalctl 排查命令”。文档站版本日志已按 v1.6.3 重新生成。
- 已知既有缺陷（本次未改）：Windows 下 `pnpm build` 会因 `client/package.json` 中 `VITE_APP_ENTRY=user vue-tsc` 这类 POSIX 写法在 cmd 中失败，本次构建改用等价命令完成。

## 2026-10-16 实例高级配置仅限管理员（发布后源码与测试部署）

- 源码提交 `b9c1e73211a642d0c90f1de6e187ec4b906f965e` 已推送 main；[源码 CI](https://github.com/mastalee928/payincus/actions/runs/38911749969) 的类型、Lint、Agent 测试及构建均通过。本轮没有新 Release 或 OTA，现有正式安装包不包含本节改动。
- `InstanceDetailView.vue` 从用户端移除整个“配置”页签，以入口条件隔离组件加载及渲染；管理员端保留。用户端生产产物不再包含进程上限提升的界面组件，直接指定配置页签也不能显示它。
- `server/src/routes/instances.ts` 对配置读取、进程上限提升、SWAP 开关及原已禁用的高级配置写入统一使用管理员认证。`batch-config.ts` 同时限制高级配置及 SWAP 字段，非管理员宿主机所有者不能通过批量接口绕过；不调整实例现有资源值。
- 新增不连接数据库或宿主机的真实路由回归，覆盖未登录、实例所有者、其他用户、非管理员宿主机所有者、HEAD/直接请求、伪装请求字段、批量修改的全部受限字段，以及管理员读取和原有参数校验。新增检查已加入根测试流程。Client/Server 类型检查、前端路由、实例路由、管理员权限、鉴权会话、操作冲突、批量配置、i18n、双端构建与产物边界守卫通过。
- 已更新 owner 授权测试主控的两个后端路由模块及用户端静态文件；部署前备份数据库、程序与运行配置，保留旧静态资源，更新前后均执行未跳过数据库的生产就绪检查。后端恢复为唯一进程，公网入口哈希与构建一致，程序校验清单已重新封存。
- 真机验收：普通用户保留旧页面并点击“提高上限”，实际请求 HTTP 403；操作前后进程及 SWAP 配置相同。刷新后不再显示配置入口，附加 `tab=config` 查询和片段仍只能访问普通详情；管理员仍能打开配置页并读取原有值。截图、HTTP 状态、资源快照与部署收据保存在维护者内部验收目录。

## 2026-10-16 购物车布局精修（发布后源码与测试部署）

- 单价、开通费及小计集中展示；登录方式独立于商品清单下方；桌面结算栏集中显示费用、总额与付款入口。窄屏按清单、登录方式、结算顺序排列，极窄屏登录选项纵向展示。
- 仅调整 CheckoutView 的模板、样式及三语界面文案。除图标导入外，结算业务脚本与改动前完全一致；后端、库存、计价、下单、鉴权与实例交付没有改动。
- Client 类型检查、修改文件 ESLint、前端路由、机器池、i18n keys、三语消息编译、双端生产构建及 dist 边界均通过。隔离数据验证数量和金额联动、移除、名称错误、缺货、涨价确认和无密钥状态；桌面、手机、英文深色窄屏验收通过。
- 已更新 owner 授权测试站的用户端静态文件，保留旧资源和备份、最后原子替换入口。真实普通用户页面验证完成，公网入口与构建一致；后端保持原有唯一进程。测试购物车恢复为空，未创建订单或扣费；本轮没有面板 OTA 或新 Release。
- 详细范围与证据见 [购物车布局精修验收](docs/checkout-ui-refinement-20261016.md)。构建日志、截图、源码补丁和部署收据保存在维护者内部验收目录。

## 2026-10-16 v1.6.2 发布集成

- 本次整合 main 上的首页、45 区域选购、购物车与 UPAY Pro 更新，以及此前已在测试环境验收的多 IPv6 交付；保留 `ef798a5` 的 HTTPS 收银台修复。下方 IPv6 专项中的“未提交、未发布”为当时状态。
- 配套 Agent 版本提高为 `v1.0.3`。Agent 发布增加真实 Linux 网络命名空间验收，覆盖双 IPv6 数据包、协议限制、地址生命周期与路由保留。
- 本地按根 `test` 脚本逐项执行的 168 项检查全部通过，涵盖双端类型、业务和前端守卫；新的安装验收脚本通过语法与来源检查。发行包新装验收增加 IPv6 数据字段、发布源码版本及正式 Agent 双架构下载、大小、SHA256 和可执行能力检查。
- [预览安装](https://github.com/mastalee928/payincus/actions/runs/38877337714) 与 [正式发行](https://github.com/mastalee928/payincus/actions/runs/38878414833) 均通过双架构全新安装。公开面板包、OTA manifest、SHA256 和 Agent 双架构资产已独立下载核对；前述直接部署记录与本次 GitHub 新装证据分开保存。
- 现有测试主控的更新检查返回 `latest=v1.6.2`、`updateAvailable=true`、`canManageUpdates=true`，运行标识仍为 `v1.6.1-upaypro.3`，本轮没有执行面板 OTA。两台宿主已通过正常自动升级流程运行正式 Agent `v1.0.3`，心跳、一个/两个 IPv6、库存及端口协议状态正常。

## 2026-10-16 首页与选购界面源码

- 首页使用真实机器池商品目录，展示国旗、资源、月价和库存；公共购买入口统一为“购买主机”。选购页保留完整 45 个区域，售罄和未上架区域标灰。
- 新增可复用的入场、筛选和加购反馈组件，支持减少动态。Vue Bits 的 AnimatedContent 适配使用现有 GSAP；来源与许可保存在 `client/public/THIRD_PARTY_NOTICES.md`。支付、库存和实例交付逻辑未改动。
- 本地 client/server 类型检查、前端路由守卫、三语 key 与 23,540 条文案编译、机器池守卫、双端构建及 dist 边界守卫通过。隔离浏览器已验证商品预选、多台加购、登录返回、售罄、空目录、失败重试、三语、深浅色、手机布局和减少动态。
- 此节记录当时的 main 源码与本地验收；这些界面更新现已包含在正式版 `v1.6.2`。测试主控静态更新的备份与浏览器实证另存内部记录。

## 2026-10-16 UPAY Pro 接入与测试主控更新

- UPAY Pro 接入提交为 `1d37ff0c72bb5e669ee50c959351d77ac711c039`，已推送 main；[对应 CI](https://github.com/mastalee928/payincus/actions/runs/38842372055) 的类型、Lint 与构建检查通过。接口按上游 `a232783` 实现，各支付网络分别配置渠道。
- 固定提交的 166 项完整本地检查通过；Linux arm64 隔离构建完成后端、双端前端及前端路由、产物边界和 UPAY 守卫。部署包使用 LF 换行，未使用工作区未提交内容。
- Owner 授权后，测试主控于北京时间 2026-10-16 11:32 完成直接部署，运行标识为 `v1.6.1-upaypro.1`。应用新增 `202610160001_add_upaypro_payment_provider`，迁移总数为 208；已备份程序、数据库与运行配置，并重新生成 Prisma Client、封存程序文件。
- 更新后唯一后端、双端入口与静态资源、数据库及生产就绪检查、日志与响应头检查通过。实际管理员登录、版本与支付渠道 API 通过；两台 Agent 在线且心跳正常。配置表单的浏览器操作与支付事务已在此前隔离环境验证，真实 UPAY 付款、回调及到账仍待 owner 测试。
- 此项为已提交源码的测试部署，当时未创建新的 Release 或标签；UPAY Pro 及后续修复现已包含在正式版 `v1.6.2`。脱敏部署收据与备份位置保存在内部验收记录。

## 2026-10-16 IPv6 自动同步专项（发布前验收记录）

- 基于已运行的 UPAY Pro 提交 `1d37ff0`，叠加 IPv6 工作区改动部署到维护者测试主控；保留已安装的支付更新。应用 `202610160002_dedicated_ipv6` 后共有 209 条迁移，唯一后端、健康检查和数据库/支付就绪检查通过。此项未提交、未推送，也未发布新的面板或 Agent Release。
- 自动接入的独占宿主从实际物理网卡发现公网 IPv6，支持后加、替换、移除和多地址；宿主地址清单与实例已验证的交付地址分开。管理页面显示地址及同步原因，用户响应只暴露已验证公网地址。
- IPv6 转发与 TCP / TCP+UDP 策略协同；宿主 Agent 补齐必要的邻居发现规则，并以优先级 90 的专用 SNAT 保持各地址出口身份。实例网络配置持久化，Agent 独立协调并恢复网络规则。
- 验收发现旧升级逻辑将所有版本差异当作升级，曾把测试 Agent 换回旧版；面板与 Agent 均已增加版本比较和防降级守卫。两台测试宿主当前运行 `v1.0.3-ipv6.3`，真实心跳包含 `dedicated-ipv6-v1`，主控不再下发降级指令。
- 已通过：类型检查、配置的根检查逐项运行、相关守卫、双端构建及产物边界；新增防降级守卫和全部 Go 测试另行通过。隔离 PostgreSQL 覆盖地址变化、生命周期和客户响应；独立 Linux 网络测试覆盖两个 IPv6 的 TCP/UDP/ICMP、出口地址、NDP、隔离、协议切换及规则重载。
- 真机证据：一个云平台已分配的公网 IPv6 上，密码 SSH 以及端口 1、53、443、8443、65535 的 TCP/UDP 和 TCP-only 策略通过；临时实例重启后 SSH 正常，Agent 服务重启可重建专用 IPv6 规则。正式管理 API、机器池/宿主详情页及地址复制已验证。
- 后续真机发现云平台已分配 IPv6、宿主网卡却未自动配置。Agent 已补齐 OCI IMDS v2 地址同步，按物理网卡 MAC 匹配显式分配地址，维护 `/128` 地址及独立路由；不推测前缀地址，保留无关手工配置，元数据失败时保留现有地址。Debian 13 与 Alpine 的独立网络命名空间均已验证新增、多地址、替换、删除、网卡地址丢失恢复和路由保留；新增代码通过完整 Go 测试与构建。
- Owner 后加到现有用户实例宿主的 IPv6 已自动交付；普通用户真实网络页面显示正确，使用正式密码接口返回的密码经该 IPv6 登录成功，SSH 身份与实例一致。另通过普通用户的正式注册、邀请码、测试余额和购物车结算 API 购买临时 Debian 13 实例，订单及用户实例响应同时返回两个已就绪云 IPv6，IPv4 和两个 IPv6 的密码 SSH 均通过。这项购买走真实 API，未改动原客户会话或手工插入订单数据；不代表外部支付验收。
- 两个真实云 IPv6 的端口 1、53、443、8443、65535 均验证 TCP/TCP+UDP 策略。测试宿主实际整机重启，启动 ID 已变化，IPv4、两个 IPv6、同一密码和 SSH 身份恢复，TCP 模式下 UDP 仍被阻断。原客户的另一台宿主没有重启。
- 临时实例及全部转发已通过正式删除流程清理，测试账号余额归零并停用；测试宿主库存恢复可售，原 TCP 策略已恢复且生效，IPv4/IPv6 同步成功。没有新增稳定 Release 或 Git 提交；源码、部署包哈希、重启证据和无凭据截图保存在内部验收记录。云平台实际撤回地址的场景尚未由 owner 操作，删除与更换已有隔离网络及数据库测试证据。

## 2026-10-16 UPAY 充值下单修复

- 修复已推送 main：`1c5b21d` 修正 Node.js 多地址 DNS lookup 的回调格式，`ef798a5` 让收银台链接固定使用已配置的 HTTPS 域名。UPAY 返回的 AppUrl 可以是反向代理后的 HTTP 地址；仍校验交易号、固定收银台路径、金额、有效期，并拒绝附加查询参数、片段和 URL 凭据，不访问或返回该上游地址。
- 新回归分别复现旧实现失败并验证修复；两次 Linux arm64 隔离快照的 166 项完整检查及后端构建均通过，改动文件 Lint 通过。[DNS 修复 CI](https://github.com/mastalee928/payincus/actions/runs/38853012962) 与 [UPAY 收银台修复 CI](https://github.com/mastalee928/payincus/actions/runs/38854723532) 均成功。
- Owner 授权后，测试主控于北京时间 2026-10-16 13:15 更新为 `v1.6.1-upaypro.3`。两次修复仅替换各自后端模块的四个构建文件及版本元数据；更新前分别备份受影响文件、数据库、运行配置与证书，更新后重新封存程序。既有 IPv6 部署、schema 与 209 条迁移保持原状，本次没有新增迁移。
- 真机验收通过：使用已启用的 USDT-TRC20 渠道创建人民币 10 元待支付订单、打开 HTTPS 收银台、核对保存的币种/网络/交易号、重新支付和打开新的收银台。创建与重新支付均 HTTP 200，未付款状态保持 pending，账户余额不变；本次诊断订单已取消，验证会话已注销。
- 唯一后端、健康检查及未跳过数据库的生产/支付就绪检查通过。真实链上转账、支付回调与最终到账仍待 owner 付款验收。这两次修复当时仅直接部署，后续已整合到正式版 `v1.6.2`。

## 测试主控的既有证据

维护者测试主控此前使用 v1.6.1-preview.3 直接部署；最新测试部署见上方 IPv6 专项记录，尚未切换到稳定 Release。普通用户余额购买、公网密码 SSH、TCP/UDP 切换、两台 Alpine 无备份故障换机、故障隔离恢复、公网 IPv4 更换与同步，以及用户和管理员 PUSH 已完成测试。隔离 PostgreSQL 数据库另有库存、扣费、任务租约、换机和权限测试。

本轮已将该主控的面板与 Agent 更新源切换到本仓库，并清空临时 Agent 目录覆盖。主控从 GitHub 下载的两种 Agent、实际提供的 Agent manifest 与二进制下载均已核对 SHA256；唯一后端及双端健康检查正常。此项验证不代表主控已 OTA 至稳定面板版本。

本节早期验收不包括外部支付、客户公网 IPv6 与异地备份恢复；后续 IPv6 证据见上方专项记录。无备份换机不会恢复旧磁盘；旧机完全失联时需由运维在云厂商侧隔离，系统不能保证远端旧实例已经停止。

实际主控地址、测试账号、备份路径与逐步验收记录保存在维护者工作区内部文档中，不随公开源码发布。上游历史运行记录已归档，不代表本仓库当前生产状态。

## 继续维护

先读 AGENTS.md 与 [操作手册](OPERATIONS_HANDOFF.md)。每次发布必须分别记录源码提交、本地检查、Actions、Release 资产、安装验证及线上验收。功能说明见 [机器池文档](docs/host-pool.md)，发布步骤见 [安装与发布](docs/fork-release.md)。
