# 已配置网关重复操作保护

2026-11-09，下一版源码，尚未发行或部署。

原先本机网关已经配置完成，仍可生成并确认新安装计划；确认会重新写入配置并重启一次主控后台。现有网关的入口改为「重新检查」，调用独立只读 API，只检查原受信 SSH 管理连接和网关状态，不调用安装执行器、不重写配置、不重启后台或宿主、不排队下发宿主 DNS 配置。

已配置、暂时离线、配置部分缺失及旧确认计划均不能通过此入口重新安装。首次全新配置仍保留检查→计划→确认。配置变化、域名变更、迁移和恢复分别使用对应流程；检查失败显示具体错误，不以重装或重新生成身份处理。

## 实现范围

- `ManagementGatewayPanel.vue`：仅服务端明确允许首次配置且没有当前网关/已保存域名时开放安装。旧计划停用，连续点击检查合并为一个请求；开始与确认前再读当前状态，等待期间切换账号/退出后不继续下发配置，确认绑定原审阅计划与域名。检查结果不代替宿主逐台验收。
- `GET /host-onboarding/gateway/setup/check`：管理员鉴权、禁止缓存，只读状态，不读取或改变安装任务历史。原状态 SSH helper 可能创建或占用自己的锁文件；没有网关配置或网络变更。
- 服务层在 prepare/confirm 前阻止已有网关；受限 root worker 在平台维护锁内、实际配置前再次检查，覆盖旧页面/旧请求与并发排队。
- 判断依据为现有网关环境配置、磁盘配置、已登记网关域名/宿主管理地址和原管理身份文件，不以连接成功与否判断可重装。无法读取必要信息时不继续。新装主控自带的 controller enrollment 不作为已装本机网关依据。
- 普通后台只检查可读应用密钥；root worker 额外检查私有 WireGuard 配置和管理密钥，避免普通后台无权访问 root 目录就误封全部首次安装。

## 验证

- `test:simple-gateway-setup`：原请求格式、会话、Origin、不可变计划与恢复保护守卫，加上重复安装/磁盘状态/登记身份/未知读取保护。真实本机 SSH 及实际 HTTP/service 连续检查仅发送 `status`；离线、错误指纹、部分配置、旧确认/直接 API 均阻止安装，原密钥未变。数据库读取使用隔离替身，未连接生产。
- `test:gateway-recheck-ui`：真实 Vue/Chrome，简中/繁中/英文，1440/768/390，含平板暗色；旧计划隐藏、重复检查、离线/网络失败、确认前另一管理员完成配置，以及全新安装保留显式确认均通过。API 为本地固定数据，未执行真实首次安装。
- 服务端 type-check、前端 route/i18n 守卫、双端 build（均含 vue-tsc）、dist boundary 全部 exit 0。保留已有大 chunk 提示。
- 证据：`logs/gateway-recheck-service.log`、`logs/gateway-recheck-route.log`、`logs/test-run-20261109-004708/090-server-test-frontend-i18n-keys.log`、`logs/gateway-recheck-server-types.log`、`logs/gateway-recheck-browser.log`、`logs/gateway-recheck-build.log`、`logs/gateway-recheck-dist.log`。

设计检查沿用项目黑白管理界面；Achromatic ledger，seed 1190642502。三宽度截图已查看；最终 inspect 0 FAIL/0 WARN，允许隔离示例域名 `example.com`，并修正测试外壳副标题对比度。源码 lint 的三个 shadow WARN 实际均为 `box-shadow: none`。详见 `.taste-skill/gateway-recheck/`，示例网关容量4093、宿主0台仅用于隔离展示。

没有重跑全量发行/原生首装，没有 commit/push、移动稳定 tag、生产 OTA、网关重配或客户操作。本次不能替代真实主控故障后的 OSS/独立网关灾备验收。
