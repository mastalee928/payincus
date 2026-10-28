# PayIncus 暂停交接（2026-10-28，北京时间）

> **最新接续**：a370299已push；R271 backfill严格参数/成功后计数、dry-run独立planned已修。真实5CLI+5非法参数零探测/纯parser矩阵、2守卫、覆盖CLI和完整src的tsc exit0准备push，无待poll。先前临时tsconfig缺typeRoots失败已补后通过；无产品src变更沿用刚完成build。下一项R279 InstanceDetailView主详情/套餐/统计/traffic/transfer/task读取缺route+session generation，路由watch可重复建timer；相关源已读，尚无前端编辑。impeccable已使用过/context不要重跑，harden与craft-floor已读。R269/327/完整灾备未完。

> **最新接续**：a805dc4已push；R274 gift-days共用billing lane/实例操作锁、当前身份/session/任务与当前expiry/status计算、version递增、免费持久审计同事务已修。真实PG/Fastify先红后绿、9身份/账号竞争与封停/并发6次/真实续费/混合批量/审计失败、原续费完整回归、4守卫/最终后端build含tsc exit0、manifest191/95通过准备push，无待poll。初轮同名fixture3账号与关联记录已精确清理。下一段R271维护backfill严格--host-id/未知参数拒绝与成功计数（原代码/真实CLI夹具已读）；327、R269超时/强杀/原生Incus与完整灾备仍待。ee98c6e/5b8b7ff/7f226ad CI success。

> **最新接续**：ee98c6e已push；R272 quota事务current actor/session/instance/host身份与共享实例/端口锁、实际用量/site0不限/null语义已修。真实Fastify/PG先红后绿、7守卫+最终quota重跑、最终后端build含tsc exit0/manifest191/94准备push，无待poll。端口原120秒租期耗尽的在途写/其它写入口/原生Incus未验。下一项R274 hosts.ts约6719 gift-days，完整route、performRenewal和withInstanceBillingMutation、expiry守卫已读，尚未编辑。须current expiry/归属/封停和原shared billing lane+实例锁防覆盖；免费赠送零账款。327持续，7f226ad CI success。

> **最新接续**：5b8b7ff已push；R272 quota显式null不再转undefined，真实Fastify/PG先红后绿（admin/host owner四字段、省略/0/边界/越权/零财务），3守卫/最终后端build含tsc exit0/manifest191/94通过准备单项push，无待poll。下一段quota锁内current actor/host/instance、用量与创建串行；备份createBackupWithQuotaReservation须继续读，siteLimit=0不限/null继承套餐或默认10，端口只计非systemManaged。R269超时/强杀、R274仍待。5e86550/65b755c/c188aac CI success；两个R271 CI仍运行。327持续。

> **最新接续**：7f226ad已push；R271底层网络持久化和backfill当前host/instance身份/版本/原IP/操作门禁、每次观察消费版本已修。14PG+47接口+5真实CLI/完整proxy回归、3守卫、后端最终build含tsc exit0、manifest191/93通过准备push，无待poll。维护CLI关闭连接并延后100ms退出解决security timer挂住及Windows同步exit断言；旧getAllHosts无user_id改另查完整宿主。临时gift目录已精确逐文件清理。下一项R272 instances.ts约4876–4995 quotas已定位，须读完整路由/db quota/create site/守卫再改；R269超时、R274赠送时长仍待，327持续。

> **最新接续**：5e86550已push；R271三个运维同步复用身份/版本/当前会话/工作流门禁，状态和IP同事务，保封停且零Incus/Caddy写；47实际API/PG/mTLS、完整proxy-site-operations回归、3守卫/最终后端build含tsc exit0/manifest191/92通过准备push，无待poll。接续底层instance-network-sync直接写与backfill脚本host/版本保护（代码已全读未改）；R271整体仍待。c188aac CI success；65b755c/5e86550最后运行，327持续。

> **最新接续**：65b755c已push，R270赠送准备IP/storage同事务、原身份/资源CAS补偿、必需IP失败拒绝、inbox失败保202已修；13真实Fastify/PG+mTLS场景与零账款/占用底数/失败日志、6守卫、最终后端build含tsc exit0、manifest191/91通过准备push，无待poll。R271 instance-network-sync.ts完整已读仅not-deleted、无host/CAS，相关调用点和守卫须继续读，尚未改。R269通用超时与强杀恢复/通知outbox待，327持续。初始3测试账号已清理，临时证书目录尚留本地不提交。

> **最新接续**：c188aac已push，CI40766741756最后运行。R270实测发现public-ipv4.ts LEFT JOIN全表FOR UPDATE在PG报0A000，改锁a地址行；专项真实PG先红后绿、3守卫/build含tsc exit0、manifest191/90通过准备单项push。host-gift-preparation新专项尚未提交，产品补偿未改；先完成提交再继续storage/IP/cloud-init同步补偿和inbox失败不污染202。初次夹具缺fingerprint创建的gift-90a8413d三本地测试账号待清理；无生产变更，327持续。

> **最新接续**：5b68d13已push。R269人工删除四入口pending/IP收尾、原attempt/endpoint哈希身份、共用30秒stop/delete/absence/operation/forward核验已修；16拒绝+正常/账目/旧refund接口409/record-only保留真实PG+mTLS完整exit0，20创建回归/8守卫/最终后端build含tsc exit0，准备阶段push，无待poll。接R270 hosts.ts赠送提交后准备失败（IP/cloud-init/storage）与createInboxMessage失败202污染；createLog本身已吞错为误判，完整route及相关守卫/storage resolver/预占已读未编辑。R269通用超时与强杀/事务退出续跑仍待，327持续。

> **最新接续**：d80aacb已push且CI success，R264/265 CI也success。R269 managed失败回调已先确认原连接/attempt/UUID/Stopped/精确404/无pending operation/转发移除后事务释放，20真实PG+mTLS场景、4守卫、后端build含tsc最终exit0/manifest191常规89排除，准备阶段push；无待poll。继续补人工销毁后的provisioningCleanupPending与publicIPv4收尾：instances.ts单删、instance-destroy.ts单/批、hosts.ts finalizeHostBatchDelete均未清此标记，通用删除当前也只看delete回执。对应delete/user-destroy守卫与admin-instance-delete-integration完整相关段已读未改。R270 storage提交后失败仍待，createLog本身已吞错，先前“日志失败返回500”须纠正。327未完整。

> **最新接续**：R265 84430db已push。R258历史CI40759254570失败为terms lifecycle末尾读到退出动画旧DOM，新增waitClosed和新请求数断言后实际Chrome/语法/路由守卫通过准备单项push；R259/260 CI success。无待poll进程。R269完整managed helper/失败补偿与端口守卫、Incus delete/state/client、超时清理和宿主赠送后半段已读，未改产品；须同时防远端未确认便释放及迟到回调删除错误目标。默认机器池不混用，327持续。

> **最新接续**：R264 1761a79已push。R265专用user/instance流量额度PUT缺monthlyLimit拒绝400，真实PG先红后绿、2守卫/manifest191常规88排除/后端build含tsc最终exit0，准备单项push；无待poll进程。接R269 managed-instance-provision.ts失败先释放资源/IPv4后远端delete吞错，完整helper已读，须读补偿/端口守卫和独占保护再实证最小修；R270赠送提交后storage解析与日志/消息异常随后。PG原隔离库仍运行，凭据只本地。327持续，默认机器池一机一卖不变。

> **最新接续**：866d9f4已push。R264手动实例流量reset统一锁内actor/session/host/instance/sample校验已修，真实Fastify/PG先红后绿，禁用/撤销/转让/删除/收费/配额/基线及并发balance log通过；后端types/build、4流量守卫/manifest通过准备单项push。PG已恢复127.0.0.1:55438原logs/review-no-refund-pgdata，数据库takeover_prize_20261029_pool_test；仅测试库，凭据通过logs/run-traffic-auth.cjs本地读取不输出。无待poll构建，旧测试定时器残留已终止。下一项R265专用/user/instance traffic limit缺monthlyLimit目前parser返回null，完整路由/守卫已读，先PG复现再只在这两个入口要求字段；不要擅改其他表单空字符串语义。327持续。

> **最新接续**：6c9dfe5已push。R260实际支付页面五渠道三语/无raw key/空密码/1440与390通过，@示例仅目录已无页面引用；3守卫/manifest通过，新夹具与专项接CI准备单项push。无待poll。下一项R264流量reset管理员/宿主旧授权及普通用户会话，已读traffic route/DB withInstanceTrafficResetLock/getTrafficResetSample/reset helper、test-traffic-reset-locks及user-write-authorization；须先真实PG先红再最小修，保收费/流量基线/一机一卖。327未完整。

> **最新接续**：d8c8e33已push。R259引号/图片说明/危险标签协议事件/外链属性实际Chrome与主动事件探针通过、截图已看，新专项接CI、manifest通过准备单项push，产品无改沿用R258最终构建。接R260 scripts/test-payment-locales.mjs/fixtures/payment-locales，未登记未提交，读取实际页面五渠道三语，无支付配置写入。327持续。

> **最新接续**：f1cc7c7已push，98ad127/b4e0ef8 CI success。R258子tokens浏览器补验时发现task path.d丢失，已修URI regex错误字符范围及未知数字协议，Chrome+jsdom先红后绿、3守卫/lint/最终完整双端types build/dist通过准备单项push。R259 scripts/test-markdown-attributes.mjs已通过未登记未提交；R260支付locale夹具+专项正在运行session18931，尚未登记。无其他本地进程，327持续。

> **最新接续**：98ad127已push。R257此前表格源码修复已补实际Chrome：普通/仅表头/空单元格及inline tokens、1440/390截图通过，新增专项接CI与manifest通过准备单项push。产品无改，沿用刚完成的构建。接R258扩展嵌套/任务/引用tokens，再R259引号与DOM属性实际浏览器；无待poll本地进程，327持续。

> **最新接续**：b4e0ef8已push，00de40e CI success。R256条款KeepAlive显隐/abort/卸载/迟到正文保护已修，Chrome与语言回归/4守卫/lint/双端types build/dist/manifest通过准备单项push，无待poll。本地表格专项scripts/test-markdown-browser.mjs已通过、截图已看，留R257单项登记提交，接R258/259浏览器证据，再R260。R264流量route/DB sample/reset及锁守卫已读，后端未改。327持续。

> **最新接续**：2d12e6c已push；18e5d85 CI success。R255条款当前语言/同语言成功缓存/旧回执和迟到正文隔离已修，Chrome先红后绿/三语截图/4守卫/lint/双端types build/dist/manifest通过准备单项push。无待poll。R256已Chrome先红离页Teleport遗留，scripts/test-terms-lifecycle.mjs未登记未提交，随后加KeepAlive/卸载/abort；scripts/test-markdown-browser.mjs也未登记未运行，留R257。法律内容保持，327持续。

> **最新接续**：00de40e已push，CI40754421823最后运行。R253旧套餐刷新门禁/当前选项检查/镜像清旧已修，Chrome专项及旧套餐写/机器池两回归、4守卫/lint/双端types build/dist/manifest通过准备单项push。无待poll本地进程。R255条款语言切换已真实先红，新scripts/test-terms-language.mjs与fixtures/terms-modal未登记未提交，产品未改；先语言/缓存与迟到正文，再R256关闭/KeepAlive/卸载，再Markdown浏览器补验。327未完整。

> **最新接续**：18e5d85已push，CI40753458066最后仍运行。R252旧套餐写回执/新草稿/旧凭据隔离已修，Chrome先红后绿与机器池回归、4守卫/lint/双端types build（最终exit0）/dist/manifest通过准备单项push。无待poll本地进程。下一项R253旧套餐镜像/宿主刷新中仍可提交，`scripts/test-admin-package-options.mjs`已先红，未登记未提交，产品尚未改；补读取门禁/清旧镜像/当前选择核验，复用旧套餐和机器池回归。327与完整灾备未完成。

> **最新接续**：机器池读取dfae114已push，CI40752294978最后运行；47be7e3 CI success。默认pool不再等待旧套餐，按需加载/失败重开已Chrome先红后绿/读写两回归/3守卫/lint/双端types build/dist/manifest通过准备push。下一项旧套餐R252草稿清空已先红，scripts/test-admin-package-create.mjs待提交，后端admin-billing创建完整/守卫/HostSelector已读，产品尚未改；修旧回执/凭据，再R253镜像门禁。327持续。

> **最新接续**：机器池回执47be7e3已push，CI40751161454最后运行；R250 CI success。机器池读取ready/持久错误/重试/代次/session/cache/在途写返回等待已修，Chrome先红后绿+完整写回归/3守卫/lint/双端types build/dist/manifest通过准备push，无待poll。下一项父AdminInstanceCreateView默认pool仍被onMounted旧套餐load阻挡，先解除主流程依赖，代码已读未改；再旧套餐R252/253，327继续。当前无真实开通/扣费。

> **最新接续**：R250 8c3c138已push，CI40749600296最后运行。管理员默认机器池写回执/父目标查询上下文保护已修，实际完整页面Chrome先红后绿/3守卫/lint/双端types build/dist/manifest通过准备push。下一项AdminPoolInstanceCreate refresh失败仍用旧库存镜像可提交已真实先红，scripts/test-admin-pool-create-load.mjs未提交、产品未改。机器池读取需ready、错误/成功空态分开、缓存/session旧读取隔离/返回等待写settle，注意保持原请求幂等。旧套餐R252/253单独待，327继续。

> **最新接续**：R249 6053510已push且CI success。R250宿主详情初读身份/host/session/cache隔离、持久retry/辅助错误与重试保资源通过Chrome/4守卫/lint/最终双端types build/dist，准备单项push；无待poll。Owner提醒管理员默认机器池一机一卖，已核AdminPoolInstanceCreate→pool-orders route/service，后端预占/幂等/三种收费集成断言已读。下一项优先机器池旧success读当前username与离页导航；新scripts/fixtures/admin-pool-create三文件尚未提交、产品未改。旧套餐R252/253单独待，不混为机器池验收。327持续。

> **最新接续**：R247 3a760c2已push，CI40745605752最后运行。R249创建上下文代次/旧成功错误静默/草稿快照保新输入与自用不导航已修，Chrome先红后绿及R247/248回归/3守卫/lint/双端types build/dist通过准备push，无待poll。接R250整页初读成功门禁/持久retry、host/session/cache清旧身份套餐密钥配额并重读，方案/镜像读取也绑定该上下文；当前仅onMounted loadData且异常toast后伪装空套餐。完整组件/后端/守卫已读，327持续。

> **最新接续**：R248 c7e8f28已push，CI40744550016最后运行。R247方案/镜像独立seq+host/session/package绑定、selection代次/刷新禁创建与当前列表校验，Chrome先红后绿/3守卫/lint/双端types build/dist通过准备push，无待poll本地任务。下一项R249 HostCreateInstanceTab旧写回执清空新草稿/离页导航或提示；R250初读失败/host/session/KeepAlive后整页重载随后。后端create-for-user到资源预留与交付代码已读不改，327持续。

> **最新接续**：R245 f6e0390已push且CI success，R243/R242 CI也success。R248目标输入失效/查询seq与host/session/cache/身份匹配、成功提示用已提交payload已修，Chrome先红后绿/4守卫/lint/最终双端types build/dist/manifest通过准备push；无待poll。继续R247套餐方案/镜像乱序，再R249写回执和草稿、R250初读/host生命周期。HostCreateInstanceTab完整组件/父v-if/API及hosts create-for-user资源预留交付段已读，后端保持。新host-create-instance夹具可复用扩展，327持续。

> **最新接续**：R243 e3cd05a已push。R245等级初读ready/type校验/错误retry/同步保存与字段冻结/类型session缓存卸载隔离通过Chrome、共享reward回归、4守卫/lint/双端types build/dist/manifest准备push；无待poll本地进程。接R248 HostCreateInstanceTab赠送目标输入改变后仍用旧targetUser，先P1；再R247方案/镜像乱序、R249写回执/草稿及R250初读/host生命周期。组件/父v-if/API/hosts lookup和create-for-user校验/相关守卫已读未改，完整交付后段仍要继续读。R244旧汇总未全面验，327持续。

> **最新接续**：R242 46593e1已push，CI40741048390最后运行。R243反馈优先claim.snapshot，legacy匹配类型回退，三类批量/自然过期/延迟清理与R241/242 Chrome回归、3守卫/lint/双端types build/dist通过准备push。R245初读失败空配置已真实Chrome先红（takeover-vip-rules-before.log）；新scripts/test-vip-level-rules.mjs及vip-reward-editor夹具扩展未提交，产品VipLevelRulesEditor未改。对应组件/父调用/路由/replaceVipRules/守卫已读。无待poll本地进程，327持续。

> **最新接续**：R241 c468e21已push且CI最终success，R239 CI也success。R242单项/批量及不同奖励统一writing门禁，Chrome先红后绿/3守卫/lint/双端types build/dist通过准备push。下一项R243反馈应优先claim.snapshot.type/title/config，旧卡片只兼容回退；timer已在R241清理，继续验证批量延迟与自然过期。R245等级编辑初读失败缺ready已读，327持续。

> **最新接续**：R239 5b5d3ed已push，R240 CI最终success。R241 active/session/KeepAlive/GET取消+代次/错误retry/在途写settle/旧反馈timer清理已修，Chrome/4守卫/lint/双端types build/dist/manifest通过准备push，无待poll本地任务。继续R242同上下文单项与批量互斥（另有不同单项旧overview），再R243用claim snapshot反馈；VipBenefitHall与后端领取/守卫已读。R245 VipLevelRulesEditor初读失败仍可空保存已读未改，327持续。

> **最新接续**：R240 c465d9a已push，CI40735740894仍运行。R239同步门禁/快照/冻结、成功ID与删除回写、部分失败强制重读、会话/KeepAlive/方案读取隔离修复验证通过准备push；Chrome/4守卫/lint/双端types build/dist。下一项R241用户VipBenefitHall父为v-show，需传active；R242单项/批量重叠与旧overview，R243旧卡片优先snapshot及timer。三项代码/领取后端/守卫已读；新scripts/fixtures/vip-benefit-hall三文件尚未提交。327持续。

> **最新接续**：R238 fe425fd已push且CI最终success。R240舍入后0余额奖励前后端拒绝、正常舍入兼容，真实PG/Chrome/4守卫/双端types build/dist/lint/manifest通过准备单项push，无待poll任务。继续R239逐条保存的snapshot/门禁/成功ID回写/部分失败强制重读与生命周期；再R241用户领取。侧栏购物车d4822de已完成且推送，其他入口保留。327持续。

> **最新接续**：R237 e0b14c6已push。R238说明null不回退旧值单行修复，真实Fastify/PG先红后绿（balance/points清空/省略/重读/金额保持）、后端types/2守卫/manifest通过准备push；无待poll。接R239管理员VipBenefitHallSettings逐条保存部分失败重复创建/缺snapshot与门禁，R240正小数归一化成0，R241用户领取列表生命周期。相关文件/服务/路由/VIP守卫已读，327持续。

> **最新接续**：R234 ebafb0f已push，R235 CI最终success。R237无入口CheckinModal删除、兑换守卫转当前入口，3守卫/双端types build/dist/引用复核通过准备push。下一项R238 VIP null说明已真实PG先红；新server/scripts/test-review-vip-reward-description.ts尚未提交，服务normalizeRewardData第458行null??base是根因，读写路由/服务/对应VIP守卫已读。无待poll任务。R239/240/241后续，327持续。

> **最新接续**：R235 81421ec已push，bdadd1c CI最终success。R234通知现取详情回填，读失败禁写/原地retry、旧上下文隔离/保存冻结已修，真实PG三种合同/Chrome与R235回归/4守卫/双端types build/dist/lint通过准备单项push；无待poll。下一项R237旧CheckinModal无入口，再R238–241 VipBenefitHallSettings/用户领取生命周期，按高危先读守卫。327持续。

> **最新接续**：bdadd1c徽章计数测试修正已push。R235已完整初步修复验证准备单项push：revision迁移+DB行锁增量+旧版拒绝+前端详情/冻结/部分失败重读；PG真抽奖竞争、Chrome三语/旧回执矩阵、5守卫/双端build/前后端types/dist/client lint通过。新DB为127.0.0.1:55438/takeover_prize_20261029_pool_test，凭据仍只本地；server无ESLint配置不能记通过。无待poll任务。下一项R234通知列表未带配置，需改取详情后回填，纠正旧误判；327持续。

> **最新接续**：侧栏d4822de已push。R233 CI40721596289因toast自然过期导致数量断言失败；徽章夹具改累计新增ID+updated值JSON序列化，两个Chrome专项及真实过期断言通过准备独立push。R235库存仍未提交，PG/前后端types/5守卫/双端build/dist/lint已有通过；prize浏览器初轮通过，累计toast回归因并行负载挂载未就绪失败，已加15秒有界就绪等待待跑。R234初审误判，列表API不含notificationConfig，后续修详情读取并更正台账。无其他待poll进程。

> **最新接续**：owner插入要求仅隐藏用户左侧购物车，已单行移除并同步OWNER要求；Chrome桌面/手机/折叠三语与顶部入口、2守卫/双端build/dist/lint通过准备单项push。R233 f6bf2e0已push。继续未提交R235：schema+revision迁移、DB/route/guard初改和新server/scripts/test-review-prize-stock.ts；client API为避免未完成合同污染侧栏build已恢复，须继续加expectedRevision/replenishAmount与前端。新隔离DB takeover_prize_20261029_pool_test已完整migrate通过，旧DB迁移记录不一致不要硬resolve。无待poll本地session。327持续。

> **最新接续**：R232 773cd93已push，CI40720597481仍运行。R233徽章操作后从刷新实例iconBadgeId同步父组件（null有效）、失败retry补同步/缺目标不报成功已修，Chrome/4守卫/双端types build/dist/lint通过准备单项push。无待poll本地进程。继续R235管理员抽奖补货旧库存覆盖；R234已有通知回填，非待修缺陷。327持续。

> **最新接续**：f300868/71c6038/19a0ef8的CI均success。R232 InstanceBadgeModal读取/操作跨上下文生命周期已修，Chrome/4守卫/双端types build/dist/lint通过准备push，无本地待poll。接着R233同上下文保存后emit应来自刷新实例iconBadgeId（null也有效），currentBadgeId不能回退旧prop；后端getBadgeOverview使用Promise.all非一致快照要保边界。R235补货旧remain覆盖已读定位。327持续。

> **最新接续**：R231 71c6038已push。Chrome启动器增加自己端口文件+stderr双就绪、45秒截止和诊断/清理，受控专项及真实selector/image通过准备独立push；Linux真实超时根因仍未知，后续CI核验。无本地待poll。下一项R232/233 InstanceBadgeModal初始可见/关闭重开/ID/session回执与刷新后emit。327持续。

> **最新接续**：R227 19a0ef8已push、CI40715873444 Chrome启动超时已rerun。R231 BadgeCenter概览/六操作生命周期已修，真实Vue/API夹具、5守卫/双端types build/dist/lint通过准备push。无本地待poll。下一项先补Chrome启动诊断与有限启动恢复，再R232/233 InstanceBadgeModal；327持续，源截图/夹具在logs/badge-center-browser。

> **最新接续**：R228 fc9b1c6已push，R229 CI成功。R227按现有配色重建缺渐变48资产，原defs/几何保持，2守卫/双端types build/dist、Chrome48背景恢复与178动画回归通过准备push；新增scripts/lib/badge-gradients.mjs。无本地待poll。下一项R231 BadgeCenter概览/动作生命周期，已读组件/API/娱乐路由/积分锁守卫未改；R232/233同InstanceBadgeModal后续。327持续。

> **最新接续**：R229 a93a007已push；R228生肖分号/星座art/178减少动态已修，Chrome178文档+18变换采样+reduce、2守卫/双端types build/dist通过准备push。无本地session待poll。下一项R227渐变48份缺失，原HTML仓库/历史/Desktop/Downloads未找到；可按现有九组描边色恢复主题渐变，需注明重建并浏览器验证，不伪称还原原始色值。327持续。

> **最新接续**：R230 5ca08c0/R226 2567007 CI均success，941cbdc重跑success。R229 generator只收集文档style、178SVG清9026段JSX约2.36MB，2守卫/双端types build/dist、Chrome178图冻结动画像素一致通过准备push；190常规/66环境排除。无后台进程。下一项R228（goat/rooster/tiger缺分号，星座art无keyframes），R227缺渐变48份仍未修；原HTML不存在，327持续。

> **最新接续**：R226 2567007已push；R230 BadgeImage目录迟到/旧img错误修复，真实Vue/HTTP图片专项、2守卫/双端types build/dist/lint通过准备单项push，无待poll进程。R229 generator收集器已编辑，新scripts/lib/badge-styles.mjs与test-badge-styles.mjs未跟踪、专项先红；178 SVG尚未清JSX，原aaaa/bbbb.html及git历史均未找到，不执行生成器目录清除。CI941cbdc重跑与2567007待核；327持续。

> **最新接续**：R226巡检可见性/缓存/session/GET取消/旧回执/在途写门禁及历史保护已修，Chrome/4守卫/双端types build/server types/dist通过，准备单项push。R214 941cbdc已push；CI40708802507 Chrome启动超时已rerun失败任务待核。R230新增浏览器夹具已复现目录迟到占位，源码未改，三夹具+test-badge-image.mjs未跟踪留下一项。无本地后台session；327未完成。

> **最新接续**：R221 2eb96b1已push，R220 CI40707194072最终success。R214删除5个未用导出/getCycleDays仅内部化，纠正Dashboard局部同名误判，3守卫/双端types build/dist/lint通过准备单项push。构建session92209已完成，无待poll进程。接着R226隐藏/缓存巡检面板轮询门禁，已读组件与守卫尚未改；327持续。

> **最新接续**：R220 fa3174d已push。R221两前端的空描述/null SLA已修，真实Vue弹窗payload/重开、真实PG/Fastify合同、4守卫/双端types build/dist/lint通过准备单项push；新专项已接CI，189常规/64环境排除。随后R214退役导出，已定位未编辑；MyPackages其它生命周期/后端授权仍待，327未完成。无待poll任务。

> **最新接续**：R219 5c9ab36已push。R220保存固定ID/快照/门禁/字段冻结/成功锁存及旧回执保护已修，Chrome/3守卫/双端types build/dist/lint通过准备单独push。R221已有隔离PG/Fastify合同测试通过，新`server/scripts/test-review-package-empty-fields.ts`尚未提交，前端空描述/null SLA仍待改。无后台session；327继续。

> **最新接续**：R219 PackageForm读取按route/ID/session代次保护，辅助host/list/pool不迟到覆盖，详情失败重试/无详情禁保存已修，Chrome真实路由矩阵/3守卫/双端types build/dist/lint通过准备push。R213 48a05c9与R212/README修正CI均success。下一段R220保存完成不能导航离开新页面，现已定位尚未编辑；R221空描述/SLA后续。无待poll任务，327未完整。

> **最新接续**：R213隐式Turnstile退役工具已清，保留函数逐字未变，4守卫/双端类型build/dist/lint通过准备单项push。无待poll进程。R214 Dashboard同名问候实为局部函数，共享导出可删；getCycleDays仅去export保内部调用。R219/220 PackageForm仍未编辑，当前已排除KeepAlive但同名路由参数切换仍复用，需seq/session/保存回执；R221的SLA在MyPackagesView弹窗。327未完。

> **最新接续**：README修正484c06d已push。R212会话标识/失效截止、AFF null唯一性及分元单位注释已核代码修正，4守卫/Prisma validate/类型/去注释无变化通过；准备单项保存。随后R213：只删useTurnstile旧composable及utils的3个隐式导出，保留readTurnstileToken与focusTurnstileSection（现行登录注册有调用）。327继续。

> **最新接续**：R222 87e1c69已push。R210 README不存在链接改为已跟踪网关说明，仓库守卫通过单独保存；不存在“本地生成文件遮盖”证据，漏检是未跑README仓库守卫。随后保存R212仅注释修正，再继续R213等。无后台测试/build待poll；327未完成。

> **最新接续**：R215 94ddcca已push。R222后台写入/256条界限/清空竞争/应用缓存隔离已修，实际Chrome双源及受控专项、双端类型build/dist与路由守卫通过，准备单独保存。R210 CI40701860321失败是README指向未跟踪v1.7.7.md，随后立即修链接。R212 schema/security注释已编辑，4守卫/Prisma validate通过待独立保存。327未完整。

> **最新接续**：R210 4d17604已push，R204/211/207的CI均success；R215实际PB/EB修复早已存在，本轮core-boundaries复验通过并纠正错写Cloud-init的台账，准备单项保存。正在继续R222 SW生命周期及容量，再做R212/213/214/219–221。无待poll进程；327未完成，不按旧暂停文本停工。

> **最新接续**：R207 d1cf5d9已push。R210文档按实际源码/正式Release修正，中英部署/介绍/实例能力及README、自动版本日志完成，部署文档守卫/VitePress build通过准备保存。接续R212 Prisma注释、R213旧Turnstile孤立工具、R214未用格式化/计费导出、R219–221套餐表单和R222 SW。另发现R215修复台账误写Cloud-init内容，实际formatBytes已支持PB/EB且core-boundaries有断言，需纠正文档映射。327仍未完整。

> **最新接续**：R211 f090338已push；R207旧认证外壳和useM3Auth删除完成，无调用复查、2守卫/双端类型build/dist通过准备保存。所有本地build进程已结束。下一项R210文档精修，须纠正初审Redis“过时”推断：安装脚本确实安装启动Redis，但后端无client/URL引用。稳定版v1.7.7已read-only核实正式Release；未改生产。327继续。

> **最新接续**：R204 77bb816已push，CI40699019799最后运行。R211旧server兼容策略类型已清，引用复查/build/3守卫通过单独保存；R207两旧前端文件删除仍待双端build收尾，session46205，不要丢改动。下一项R210文档，已查安装器确实仍安装Redis，不能机械删除依赖说明；后端无Redis client、仅PG持久+单进程内存态需说明。327持续。

> **最新接续**：R201 996d3db已push且CI40690320503 success。R204两个未使用组件已删除，无导入/标签/自动注册，路由守卫/双端类型构建/dist通过准备保存。下一项R207旧认证外壳/专属useM3Auth（仅互引）；R210文档及R211旧兼容类型待。Owner问首页首尔/悉尼有亮点无字，已解释为HomeRegionAtlas409行固定三地+选中标签；未改地图。327持续精修。

> **最新接续**：R200 85d2068已push且CI40684971583 success。R201无调用数据库优化模块已删除，10导出/运行入口复核、server types/build及2配额守卫通过，准备逐项保存。R204 LazyImage/VirtualList、R207 PublicAuthShell/useM3Auth已读但未改，继续核查自动注册与调用者后清理。327未完整。

> **最新接续**：R198 0b35de6已push且CI40676412491 success。R200启停固定状态、逐行操作锁、列表/session竞争和失败重试已修，真实Chrome页面及两弹窗回归、3守卫/lint/双端类型构建/dist通过，准备逐项保存。接续R201退役数据库优化包装、R204/207未使用组件、R210文档/R211无调用类型等；逐个核对再处理。327未完成，不因阶段总结停工。

> **最新接续**：R199 eaf703f已push，CI40672004189 success。R198编辑保存同步门禁/快照/会话代次/关闭保护/成功锁存及父先关窗再刷新已修，真实Chrome组件+父页面夹具、3守卫/lint/双端类型构建/dist通过，准备逐项保存。下一项R200启停重复反转与列表/session/删除并发；相关代码已读未改。327仍未完整。

> **最新接续**：R197 80f109e已push，CI40668834430 success。R199详情目标/session/复制/关闭与卸载代次已修，真实Chrome/Vue夹具矩阵、3守卫/lint/双端类型构建/dist边界通过，准备逐项保存。下一项R198保存弹窗，代码及父调用已读未改；父onModalSave等待列表后才关弹窗也需处理，避免期间重复保存/迟到关闭。R200启停随后。327未完整，不停止。

> **最新接续**：a77c891 API状态已push且CI40666472803 success；97c929e也success。R197选择器distro/session/卸载迟到请求与失败重试已修，真实Chrome/Vue延迟API矩阵、三语/两尺寸截图、3守卫/lint/双端build/dist边界通过，准备保存。impeccable已按窄修使用/两轮视觉确认；下一项R198/199编辑与详情弹窗，代码已读未改。327未完整。

> **最新接续**：97c929e回复已推；API关闭/重开事务锁current ticket/owner/status及PAT/POA已修，累计160 PG+真实bearer竞争、正常/重复/故障回滚、7守卫/build/types通过。保存后转R197初始化命令选择器；其它API/普通通知/持久外发/完整ABA仍待。66f5a66 CI40665664450已success，回复CI40666069748最后运行；327未完成。

> **最新接续**：66f5a66创建已推；API回复current PAT/POA事务核验已修，累计68真实PG+bearer竞争、网站42回归、7守卫/build/types通过。保存后API关闭/重开事务授权与状态绑定，当前仍旧直接updateMany。图片CI40664740228已success；创建CI40665664450最后运行。327仍未完整。

> **最新接续**：3fd9971图片修复已推；工单API创建PAT/POA current token/user/app/grant锁内授权已修，34 PG+真实bearer竞争、网站42/目标回归、7守卫/build/types通过。保存后继续回复、状态关闭/重开入口，当前新helper尚未保护这些或其它API写入。bb35a0a CI40664055361已success，图片CI40664740228最后运行。327继续。

> **最新接续**：bb35a0a ID修复已推，5772373 CI40663666326已success。R190图片代理固定错误分类、reader/未读body/请求释放已修；15 PG/Fastify+截获fetch（真实15秒body截止）、5守卫/build/types通过，新专项接CI。保存后继续PAT/POA工单在途授权及原清单；327/真图床/外部通知持久性未完成。

> **最新接续**：通知5772373已推。R184/185初审纠正并修PG Int ID上限，先实际复现500，再154非法ID400/合法最大404/正常200、分页回归、4守卫/build/types通过。保存后R190图片错误分类；PAT/POA及普通通知/外发持久性继续待，327未完整。510e903 CI40662708627已success。

> **最新接续**：显式客服通知current admin/session/接收人、站内信+备注同事务与正文展示已修，42实际PG竞争+两表故障回滚+默认通知回归、5守卫/build/types通过。510e903已push，CI40662708627最后运行；4ef8b02 CI已success。保存后继续PAT/POA在途撤销及R190等原清单项，普通事件通知/外部outbox仍未完成。全部327继续施工。

> **最新接续**：R186关联对象当前admin/session及实例/host/充值/订单对象归属事务锁已修；累计39权限竞争和instance/host转移拒绝、四类型正常关联、5守卫/build/types通过。保存后修客服通知原子记录与正文展示，再PAT在途撤销。4ef8b02已push，CI40662179580运行；23358c2 CI已success。327仍未完整。

> **最新接续**：R186内部备注管理员/session事务复核和当前作者已修，累计36实际PG/Fastify竞争、5守卫/build/types通过；保存后继续关联对象和通知原子提交。23358c2已push，CI40661681682最后运行；d29ca3a/fadec04 CI已success。当前通知仍先发送后记录，不能当作已修。327仍未完成。

> **最新接续**：R186管理员删除工单消息current admin/session/归属事务复核+固定附件清单已修，累计33真实PG/Fastify竞争、拒删trigger、5守卫/build/types通过。保存后继续内部备注/关联对象/通知及PAT。fadec04已push，CI40661288207与d29ca3a CI40660948686继续核最终结果；证据见HANDOFF。无需owner再次授权commit/push。

> **最新接续**：R186状态/关闭current actor/session/角色/host与原status值复核已修；创建8+回复12+状态10实际PG/Fastify、5守卫/build/types通过。保存后继续管理员备注/删消息，再关联对象/通知/PAT。d29ca3a已push，CI40660948686最后运行；e244d8f CI已success。327仍部分，按HANDOFF最新逐批继续。

> **最新接续**：R186回复当前ticket/host/actor/session及客服身份已修，原创建8+回复12真实PG/Fastify竞争、5守卫/build/types通过；按小项提交推送。下段状态/关闭入口，再备注/链接/删除消息/通知与PAT。e244d8f已push，CI40660398704最后仍运行；eaef6ea CI已成功。全部327仍未完成。

> **最新接续**：R186网站创建工单当前账户/角色/session同事务复核已修，八个真实PG/Fastify竞争、R187回归、4守卫/build/types通过；新专项登记CI。保存后继续回复入口及其余工单mutation，R186仍部分。eaef6ea已push，CI40659933408最后检查仍运行；查最终状态记下批。三台测试机身份和完整327/网关/恢复闭环仍未完成。

> **最新接续**：R187创建工单关联实例当前owner/host/deleted事务复核已修，六个真实PG行锁竞争+网站路由、正常提交/DB故障回滚、4守卫和build/types通过；准备保存，下一段R186账户/session及其它工单变更授权。R183的84f8464已push且CI40658726890成功。全清单、恢复续跑与真机验收继续未完成。

> **当前接续**：R1-183工单分页和数字搜索已修，真实PG/Fastify四路由及helper矩阵、4守卫、server build和专项类型通过，新专项已接CI；按授权保存后继续R187创建工单实例关联的事务复核，再R186其它写入授权。5e3d3a1已push且CI40657754668成功。恢复续跑/真正回滚/真机验收仍未完成，详见HANDOFF。

> **当前接续**：f6571c6恢复替换阶段已push且CI40656767813成功。旧FAILED缺副本身份的rollback现已零远端拒绝，三角色实际PG/Fastify、3守卫与server build/type-check通过；保存后转R1-183工单分页/数字搜索。完整恢复续跑仍待，不将这一保护视为完成。

> **最新接续，以此为准**：恢复替换已增加recovery_state持久原/临时UUID、设备摘要、原存储池和固定清单；专用delete保留双栈转发，异常/重启/超时继续PROCESSING门禁，末尾事务原子落库。15故障场景和授权/传输/上传删除专项、5守卫、类型/build与228迁移通过。按owner授权提交推送后继续安全rollback/续跑与其它原编号；当前保护不是完整恢复闭环。证据在HANDOFF顶部，三机可信SSH及真实磁盘/网络仍待验，不因历史暂停停工。

> **最新段落**：恢复授权1299ce6已推送；随后stop异常不吞、真实Stopped确认/90秒截止、导入前不清理副本及拒错误回滚已修，两个mTLS/PG专项与5守卫通过。最新日志/CI看HANDOFF。后续重点原/临时UUID、副本完整性、未决持久门禁、rollback；另发现普通deleteInstance附带删除原独占双栈转发，恢复替换须保留。下方旧暂停及“核心未编辑”内容仅历史。

> **当前施工点**：恢复任务入队/领取/执行准备的当前授权、原目标绑定、队列/工作流门禁、attempt和取消已实现，真实PG/Fastify/mTLS专项及上传删除回归通过。已追加第227迁移；按owner授权保存后继续。下批仍是原/临时UUID、stop确认、恢复副本完整性、远端operation持久阶段、未决门禁和rollback；详细证据与旧故障记录看HANDOFF最顶部，不能再按下方“核心尚未编辑”历史项重做。完整327/网关/OSS未完成。

> **最新保存点**：连续四批eac0b06/8d73ab3/5a8f9e5/5e63e8e都已push main，各自CI最终7/7；5e63e8e对应CI40650542350。新restore主流程只读复审与规格在`docs/restore-task-recovery-review.md`，核心尚未编辑。HANDOFF顶部列全部日志、迁移和待办；按owner授权继续分批保存，禁止据历史暂停停止工作。

> **接续优先**：上传授权eac0b06与attempt8d73ab3已推且各CI7/7，删除5a8f9e5也已推。随后恢复传输总截止/原pin/终态失败/精确404与专项已通过，正在阶段保存。下一批restore worker原身份/UUID/授权/持久阶段与rollback尚未编辑；详见HANDOFF顶部。本轮无前端/生产/发行改动，旧暂停和“无全绿”条目不能覆盖新的实际分项证据。

> **最新阶段**：eac0b06、8d73ab3均已推main且各自CI7/7。第三段备份删除失败保留/精确404确认/current身份与共享锁已验；接续看HANDOFF最顶部及Git实际HEAD。下一段backup create/delete远端持久回执、restore原身份/副本保护、上传在途/清理恢复；不重做已通过的三段。旧暂停文本仅历史，owner已持续授权分段commit/push。

> **最新接续**：授权/身份阶段eac0b06已推main，CI40648563020为7/7；随后attempt UUID/持久filename、30秒nextAttemptAt、cleanup_required/interrupted和null时间清理阶段已验证并准备保存。接续以HANDOFF最顶部为准，运行PG仍55438；下一段远端回执/强杀恢复、传输在途与backup create/delete/restore边界仍未完成。无生产改动。

> **当前施工更新**：上传队列授权/固定目标与存储修改删除竞争阶段已实现，真实PG/Fastify/mTLS及相关守卫通过；证据见HANDOFF最顶部。下一段每attempt文件与持久恢复、30秒退避、null startedAt僵尸、远端在途身份与备份delete/restore门禁；下方“尚未编辑”是历史。用户阶段commit/push授权继续生效。

> **最新接续点**：全部旧积压及后续修复已分批push main，最新业务提交`7a38eca`，对应CI 40644502640为7/7 success；记录前工作区干净，无未推送commit。下一批备份队列当前授权/身份与持久恢复尚未编辑，定位和验证证据见HANDOFF最顶部。三台测试机不限用途授权与私有资料保留，不重复索要凭据。

> **后续阶段**：`437ff02`、`8465e9d`已推送且各自CI 7/7通过。备份上传同秒文件冲突已修；正在保存备份导出TLS身份/背压/取消与截止，专项和后端构建已过，最新以HANDOFF顶部为准。旧暂停正文仅历史，继续源码及已授权三台测试机核验。

> **阶段保存更新**：Owner已授权把旧聊天和当前聊天全部积压提交推送，再继续修；248文件已在`c277ba3`推送并核对远端，旧文中的禁止提交与暂停描述仅属历史。GitHub常规Agent Linux测试通过；主CI因漏声明jsdom失败，声明已补且frozen/Markdown专项通过，接续结果见HANDOFF顶部。三台测试机用途不受旧分工限制，域名系统解析均正确，旧SSH身份仍在查证。不把保存源码当作发行验收。

> **接手更新（2026-10-28）**：本聊天持续施工，原暂停已结束。最新自动快照持久恢复、25场景、实际后端浏览器、188/188、224新鲜迁移及删除/转移回归见 `HANDOFF.md` 顶部。运行PG仍为55438 `takeover_20261028_pool_test`，新鲜迁移库为 `takeover_auto_final_20261028_pool_test`，站点页真实后端202/409/502与重试/删除浏览器也通过，UI夹具已关闭。下文仅是历史暂停快照，不据其旧失败状态重做已完成工作。手工资源持久恢复、其它生命周期、327项和真机/网关完整目标继续。未提交或发行。

本文件是源码施工交接，不是完成、发行或生产验收声明。新模型按 `OWNER_REQUIREMENTS.md` → `AGENTS.md` → `OPERATIONS_HANDOFF.md` → `HANDOFF.md` → 本文件读取。逐项基线在 `REVIEW_CHECKLIST_AUDIT.md`，修复状态在 `REVIEW_CHECKLIST_FIXES.md`，网关目标仍看 `GATEWAY_PROGRESS.md`。用户要求暂停并交给其他模型；所有代理已停止编辑和测试。

## 当前 Git / 环境

- 工作区 `C:/payincus`，`main` HEAD `0e8010371c8eb7a0eeaef9b9a1d0df6caf312092`，正式发行仍是 v1.7.7。大量已修改/未跟踪源码和测试均保留；不要 `reset`、`checkout`、清理未跟踪文件或覆盖同名文件。当前施工**没有** commit、push、tag、Release、生产 OTA/DNS、客户实例或账目操作。
- 用户自行销毁实例“仅删除、不退款、不写余额/退款账单”是最高业务约束；管理员可选退款和创建失败自动退款保持。复验 `logs/review-user-no-refund-after-finance.log` 通过（真实本机PG/Fastify/mTLS，Incus进程是替身）；未触碰历史错账。
- 127.0.0.1:55438 隔离PostgreSQL已正常停止，数据和日志保留在 `logs/review-no-refund-pgdata/`、`logs/review-no-refund-pg.log`。恢复使用已有 `@embedded-postgres/windows-x64/native/bin/pg_ctl.exe`，只启动这个明确目录和端口。本地站点UI夹具端口19641也已停止。凭据只在仓库外 `C:/Users/adminuser/.codex/private/payincus/`；不得输出、提交或上传。测试机旧SSH身份不匹配，不可绕过pin声称真机验收。

## 已有分项证据

- 外部327项初审与按编号修复台账已建立，仍有大量“待精修/部分精修”；不能以本批完成替代全清单。已做的2FA、邮箱、账号、命令、OAuth、财务、续费、SSH、Agent凭据等专项证据在 `HANDOFF.md` 与台账。本轮额外站内信、管理员余额、AFF、用户列表、批量端口、批量配置、Caddy早期修补和IPv4同步专项均有 `logs/review-*-final.log` 或相应专项日志；日志各自注明真PG、Fastify、TLS/Incus替身的证据边界。
- `pnpm test` 在**后续持久Caddy/转移/自动快照施工之前**跑完188项：186过、2项守卫检查旧源码位置而失败，见 `logs/test-run-20261027-232403`；这2项守卫已按新的真正执行位置保留安全断言并在 `logs/test-run-20261027-233304` 5/5复验。**从未有当前最终代码状态的188/188全绿**。
- 独立空库在Caddy/transfer新增迁移前实际应用220项成功：`logs/review-current-stage-migration-deploy.log`。后续又新增 `20261027020000_proxy_site_operations`、`20261027030000_transfer_cleanup_state`，因此最终完整空库迁移需要重验。原运行夹具库无Prisma迁移历史，单独SQL应用新增列；不要伪造baseline。
- 早期双前端构建和dist边界 `logs/review-current-stage-client-build.log` 通过；**之后**用户站点UI又改了，须重新双端build。Lint当时0 errors/664既有warnings，见 `logs/review-current-stage-lint.log`；不能当作最终源码Lint。
- 站点UI本地隔离浏览器真实点击202待处理、明确toggle、同操作重试、原生删除确认、确认后移除、迟到响应、三宽度/三语/深浅色通过 `logs/review-proxy-ui-browser-final.log`；截图在 `logs/proxy-sites-ui-fixture/`，纯夹具不等于真实后端验收。设计检查 `logs/review-proxy-ui-inspection-verified.log` 0 FAIL/1 WARN，WARN为仅一行测试站点的独立夹具页面余白。UI源码在 `client/src/components/instance/InstanceSitesTab.vue`、两端API与三语。最终真实后端合同、202/409/502和刷新恢复仍待浏览器验收。
- Go Agent upgrade R081/082/083：Windows/arm64 upgrade包测试和Linux amd64/arm64 vet/测试**编译**/Agent构建通过 `logs/review-agent-upgrade-*-final.log`；report R085/086/087仅Linux两架构交叉编译/vet通过 `logs/review-agent-report-cross-final.log`。Linux flock强杀、systemd及report实跑**未做**，Agent版本仍1.0.3，无Agent发行。两份用户遗留 `agent/internal/controllerconfig/*_linux_test.go` 不属于本批，不要丢弃。

## 施工中，禁止直接提交或发版

1. **Caddy持久操作未闭合。** `docs/proxy-site-operation-recovery.md` 是目标规格。`server/src/db/proxy-site-operations.ts`、`proxy-site-operation-guards.ts`、worker、v3 `caddy-client.ts`、六站点路由、schema/迁移和IPv4同步初稿已写；`logs/review-proxy-site-operations.log` 真PG/Fastify/TLS API替身专项通过，但未做最终守卫、真实Caddy v3、重启/失联和双端完整验收。IPv4变化遇旧未决upsert目标IP失配会blocked，尚缺带代次的supersede恢复；旧attempt不可复活。tombstone已调整为零流量matcher，**真实Caddy尚未核验**。`test:review-proxy-site-operations` 尚未在 `server/package.json`/`scripts/run-tests.mjs` 登记，需确认脚本命令/归类。
2. **转移/生命周期未闭合。** `server/src/services/transfer-cleanup.ts`、`InstanceTransfer.cleanupState`、30000迁移、accept/push初接和多处未决站点门禁已写。固定原站点/端口/快照/备份清单、processing直到清理完成、专属实例全端口/IPv4/IPv6/磁盘/库存不动是必须守护的不变量。旧 `test-admin-instance-push-integration` 还未在调整夹具后重跑，新服务没有完整真PG/Incus/Caddy失败注入。旧宿主批量迁移持久claim、生命周期v3 Caddy删除、到期路径、快照自动策略互斥、重试/精确远端确认、共享端口双协议及host计数均要闭合；不能把原先“提交后重新全扫并删除”带回来。上述流程当前**不可上线**。
3. **自动快照调度器中途编辑。** `server/src/services/auto-policy-scheduler.ts` 的 `executeAutoSnapshot` 改为共享实例锁事务，但调用方 `executeLockedAutoSnapshot` 仍传旧参数，旧常量/导入残留，**可能编译失败**；尚无类型、守卫或运行验证。下一模型先修此文件的调用/锁顺序，或在不丢其它工作区修改的前提下恢复其可运行状态。不能使用破坏性Git命令。
4. **巡检成功观察CAS刚改，未验。** `server/src/services/status-scheduler.ts` 已加入成功结果的instance锁、身份和updatedAt代次检查，防旧响应覆盖新状态；改动发生在前述188项全量之后，尚无对应真PG/mTLS成功观察竞态测试。失败观察“不因此删除/释放资源”已通过 `logs/review-sync-observation-protection-integration.log`。保持一机一卖库存占用。
5. 用户站点UI与后端outbox在接线时分别施工，须核对 `client/src/types/proxy-sites.ts` 和两端API、组件与最新后端字段/错误展开。站点页面不应在202时提示生效或在远端未确认时移除；重试保留requestId，toggle有明确enabled/expectedRevision。前端代码最后定向typecheck/浏览器夹具通过，最终真实后端集成和最终双端build未做。

## 恢复顺序

1. 只读核对上述文件及各代理最后留言，`git status --short`，保留所有用户/其他代理修改。先使中途`auto-policy-scheduler.ts`和最新schema/Prisma Client编译通过；登记未分类活体专项，跑`pnpm test:check`。
2. Caddy outbox的IP supersede、零流量tombstone真实Caddy、重启stale applying、412/迟到代次、身份变更及远端成功DB失败回执；联动transfer/lifecycle固定清理，完成真实PG/Fastify/TLS/Incus边界测试。任何未决意图不得被转移/重建/删除悄然抹去。
3. 真Linux Debian13/14上Go Agent锁/解压/取消、网关IPv4-only与宿主/客机IPv6独立、独立/备用网关及A完全失联→B全新OSS恢复仍须按OWNER_REQUIREMENTS和GATEWAY_PROGRESS分别验收；当前三机SSH身份尚未核实，不绕过。
4. 继续外部327项确实存在的必修/应修，不要仅因这批专项目录多就宣称整体完成。稳定后重新空库全部迁移、188项全量、相关活体专项、双端/后端build、Lint、人工diff和浏览器验收。同提交双架构预览、正式包核验及条件达标后的commit/push/Release才可进入；不包含生产OTA、DNS、客户删除/退款或DD。

仓库 `logs/` 为本地忽略证据，交接文件不包含密码、token或密钥。阶段性测试只说明对应边界，不将源码、替身、发行包和生产实证混写。
