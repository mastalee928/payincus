# v1.8.9发行验证

正式source=73337d2c8f25969e67b1584b6cf570997264d152，PR12已合入；与全绿候选d3aa8ca23f4357d774ce66bd2062c4757f07d830源码树相同。生产未部署，仅源码与隔离／发行验证授权。

- 五轮审视及P01–P20对应修复见 instance-provisioning-five-reviews-2026-11-13.md。本地全量219/219，后续相关types/build/守卫、真实PG两遍九组回归通过；前期失败及诊断保留。
- 当前候选CI43297365382：原生12/12六系统×双架构真实Incus/初始化/原密码SSH/清理success；完整27/27全部success。Agent同source43297364963 success，Alpine维护43297365369九项success。
- 预览43297411954 success：双构建、双首装、六条原v1.8.8包worker正常／迁移留库／后半程故障回滚再升级全部success；Release预期skipped。两实际tar无重复，修复模块hash一致，242迁移完整，root属主，四份21文件组件原pin签名、文件hash/size/source/版本/架构独立核通过。
- Agentv1.0.8正式43295979532，source=de246805e233bca57031d947d6be4ae018d2cef5，五job成功；候选与Agent源码输入无变化。实际下载AMD64 5484696字节SHA256 8351147066886d1efa1c251182bfcd064342920d0cdd3679e7bde28d587f6d6f；ARM64 5177496字节SHA256 1ecd95e766c90001f8288fc921286d836dbac6aa958082cc231ab68b71573863；API digest一致。
- [面板v1.8.9](https://github.com/mastalee928/payincus/releases/tag/v1.8.9)2026-11-12T20:57:03Z正式公开且latest；[正式发行43302419882](https://github.com/mastalee928/payincus/actions/runs/43302419882)11/11全部success（双构建／双首装／六旧升级／Release）。两正式包源码73337d2c8f25，242迁移，原签名四组件文件／hash／size／root属主与修复模块核通过。
- main重跑43302361534仍在后半程，已有原生12项、types/build/Agent及维护通过，最终整轮终态另记；正式release已通过其必需全部检查，候选CI27/27独立保留。

| 正式资产 | 字节 | SHA256 |
| --- | --- | --- |
| incudal-v1.8.9-linux-amd64.tar.gz | 214533850 | b09278a85f0dd68d627772860f5ed4cf3a7234ba16cd0bff49c9ad1c8d955aba |
| incudal-v1.8.9-linux-arm64.tar.gz | 213757692 | 0d5aed1d634691a6da6ec253a2c988425a0bebb2d30d8bcd6488f1b63d14db2e |
| incudal-v1.8.9-ota-manifest.json / ota-manifest.json | 1070各 | e2ce1ad294661232d8d7521ceaf4475c2cf0545676b0c011a2f97fcbba615f8b |

公开六资产API digest／size与实际下载或同发布artifact hash一致，两checksum及两OTA清单逐字一致、source／版本／架构／hash核通过。发行说明已改为具体修复与验收范围。

未完成的生产OTA／全池实际部署、公网IPv6全端口／KVM／完整OSS新B灾备分别保留，不用发行或fixture冒称生产成功。BBR继续可选，不作为可售门槛。
