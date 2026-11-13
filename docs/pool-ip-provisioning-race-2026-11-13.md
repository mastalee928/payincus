# v1.8.9后开通失败：公网巡查与交付相互阻断

2026-11-13。Owner截图订单8d3584fd-7fbb-4664-9865-7fe5fdfbd255／test-1；仅只读主控，不进入生产宿主或客户、不部署或修改账务。

## 现场证据

- 主控确实运行v1.8.9／73337d2c8f25，唯一backend active／running且NRestarts=0；host38 hyderabad-amd-1 Agentv1.0.8，当前工具ready及客户网络防护applied，原加固verified、身份相符。
- 实例33 images:alpine/3.24/cloud于23:25:24Z创建；宿主原Incus实例已创建并启动、分配IP，23:26:25.036Z后台host.public_ip.observed记录IP_INSTANCE_NOT_READY，23:26:49.580Z创建最终检查报Pool host no longer satisfies delivery readiness。
- 初始错误不再是缺aa-exec。巡查对creating且dedicatedNetworkReady=false的实例把宿主publicIpSyncBlocked设true；同实例finalize使用dedicatedHostReadyWhere拒该标记。正常创建与定期巡查相互阻断。
- 11元余额consume#74／refund#75，全额原余额恢复；newPurchase#49／refund#50；实例deleted、pending两个false，host.verify_empty于23:27:12Z完成、资源计数0。回池／退款成功不表示该创建已交付。

## 漏检与修复范围

v1.8.9十二类原生镜像测试真实创建和SSH通过，但fixture没有purchaseBatchId／dedicatedIpv4，没有调用prepareDedicatedDelivery及pool final fence，且未运行后台公网巡查。此前报告“真实创建／SSH”有其范围，但把它用于整条机器池交付完成声明不充分。此次补到真正一机一卖创建和最后交付，不能再以普通路径通过代替。

- 保留原已验证地址：当前paid pool creating owns guest，原publicIp/bind未变化、物理地址仍在、受信管理在线、无其他任务／维护／隔离／未结清时，巡查不改客户forward、不试未完成的SSH、不制造IP故障。真实地址、设置、身份、管理liveness及其他失败继续阻断。
- 历史创建专属误报可在同已验证地址／bind的当前证据下自动恢复；真实IP／SSH设置变化保留IP_INSTANCE_BUSY，不转换为可恢复的IP_INSTANCE_NOT_READY。离线、认证、维护及账务问题不被豁免。
- 创建失败已退款时不再渲染“IPv6正在配置”的误导卡；活实例IPv6正常状态保留。
- 管理退款面板的api.checkout在admin构建被remap到没有checkout模块的API文件，真实请求之前报undefined.refunds。补admin退款列表／回执登记方法，沿原admin认证；校验列表数组／成功回执，失败不清输入。新增读取原Vite配置、真实admin.ts、认证HTTP及生产bundle的浏览器回归，避免用户API夹具漏检。

管理退款补充五轮：①真实alias与两调用；②原admin会话／登录重定向／后端权限未改；③重复点击、503、无效列表／成功回执，未保存输入保留；④桌面／手机、tab关闭与账号切换旧响应拒绝；⑤production bundle真实HTTP加载。最后浏览器自然exit0，见ignored logs/admin-refunds-browser-final.log。第三方开通失败自动退余额是owner随后新增授权，明确先完成本批再做，因此本批不改资金去向；待办及执行顺序记OWNER_REQUIREMENTS。
- 原生六系统×双架构更换为purchaseBatchId＋dedicatedIpv4，实际宿主Go guestguard／provisioning生成执行回执，真实Incus地址forward与密码SSH，创建前／初始化中主动跑同产品IP巡查，最终检查running＋dedicatedNetworkReady，失败退款／磁盘／forward全清后释放。

## 五轮详细审视

| 轮次 | 检查重点 | 实际结果 |
| --- | --- | --- |
| 1 实际根因 | 对应订单、面板／Agent版本、DB日志、final gate | 只读原日志确定IP_INSTANCE_NOT_READY先于final拒绝；11元全退与清理分开核 |
| 2 条件与回执 | 旧verified地址、creating前后IP字段、历史误报 | 新真实PG regression旧源码assert blocked=false失败，补修后通过；current identity/security unchanged |
| 3 真实故障 | 地址变化／离线／强制观察／新设置／多次续查 | 真实变化持续blocked，旧专属误报可恢复，写／SSH验证计数保持，不改原定价和账期 |
| 4 覆盖边界 | 12原生普通路径遗漏、真正pool final fence、Go真实防护 | fixture改actual pool direct create＋physical/public alias forward／真实SSH与后台巡查；编译通过，CI待验 |
| 5 UI／权限／发行 | 退款无IPv6配置中、双端产物、版本兼容 | client/server types、相关5guards、双端build、IP深度回归通过；结果browser状态检查通过，最终终态待；Agent产品未改保持1.0.8，下一panel1.8.10，旧worker从1.8.9升级／回滚必须验 |

最后冻结核验：本地全量219/219自然exit0；冻结server类型、route/i18n、dist边界、repository来源、Go Linux fixture编译、shell语法通过。真实PG付款回归新增易支付和USDT的失败负债未到账／回执完成状态，自然exit0（checkout-refunds-frozen.log）；结果browser和admin真实alias／生产bundle均自然exit0。期间新文案试改已撤出本批，原资金去向和三个语言文案不变。数据库回归专库必须每轮新建：复用前轮非空库使reservation fixture竞争到旧库存，属于隔离输入错误，改新专库后通过；不修改产品门槛。新UI fixture解决依赖解析／旧请求跨页面收尾等测试环境问题，最终不替换admin API本身。

尚未完成：新来源CI真正池原生全链路／发行旧升级及生产生效。不能将源码修复或旧十二普通镜像通过称此次生产已修，owner依旧自行OTA。证据在仓库外private/payincus/hardening29/provision189-*与ignored logs/pool-followup-*，原密码／密钥不提交。
