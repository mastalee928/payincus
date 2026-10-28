# 版本与验证记录

> 2026-10-28 用户已要求本聊天接手并继续；原暂停状态结束。当前仍是源码施工与隔离验证阶段，未满足发行条件。接续入口见 [PAUSED_REVIEW_HANDOFF.md](PAUSED_REVIEW_HANDOFF.md)。

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
