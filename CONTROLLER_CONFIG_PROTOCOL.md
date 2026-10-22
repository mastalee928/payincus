# 主控候选发现协议与当前实现

日期：2026-10-23。当前实现提供受信候选读取和宿主观察状态持久化；网关激活、Agent 地址切换和管理写权限尚未接入。

关联：[接管研究](CONTROLLER_TAKEOVER_RESEARCH.md)、[施工与验收](GATEWAY_IMPLEMENTATION_SPEC.md)、[版本证据](HANDOFF.md)。

## 1. 组件边界

| 组件 | 已实现职责 | 当前待实现职责 |
| --- | --- | --- |
| Node 配置协议 | Ed25519 签名、严格结构、平台/宿主绑定、代次冲突检测 | 控制租约、网络执行 |
| 独立 HTTPS 服务 | 已登记节点读取、持久防重放、停启与进程互斥 | 网页认证、受权登记/发布 API、OSS 调度、见证仲裁 |
| 候选状态库 | 内部持久登记、撤销墓碑、幂等发布、历史代次防回退 | 管理员/主控身份授权、信任轮换 |
| Go 客户端 | 独立 HTTPS 签名请求、TLS/响应校验、候选验证 | 自动轮询、更新当前 Agent、执行系统指令 |
| Go Linux 状态库 | 加锁、原子写入并同步最高已观察代次 | 活动控制权、旧 SSH/Incus 写连接隔离 |

独立服务不导入 PayIncus app、Prisma、业务鉴权或平台备份调度；私有业务后端继续只有一个进程。新包未接入现有 Agent main，因此安装此源码本身不会重连现有宿主。

## 2. 签名候选

外层字段按 schemaVersion、keyId、payload、signature 顺序编码为无空白 JSON。payload 是规范 JSON 字节的标准 base64；signature 是 64 字节 Ed25519 签名的标准 base64。

签名字节为 `payincus/controller-prepare/v1\n` + keyId + `\n` + payload。keyId 是 `key_` 加原始 32 字节公钥的 SHA256；验证根必须预先登记在节点上，不能取自响应。

载荷规范字段顺序由 Node parseControllerPrepareConfig 与 Go PrepareConfig 共同定义：schemaVersion、purpose、platformId、nodeId、controllerId、requestId、epoch、sequence、issuedAt、expiresAt、panelBaseUrl、gateway。gateway 包含 gatewayId、endpointHost、endpointPort、publicKey、nodeAddress、controlAddress。

- purpose 固定为 controller-prepare；未知命令、字段、重复键、非规范数值和编码均拒绝。
- epoch/sequence 用正十进制字符串，最大 int64，避免 JavaScript 精度损失。同代次不同内容、低代次拒绝；新 epoch 可以从 sequence 1 开始。
- 时间为毫秒整数，最长有效期 15 分钟，签发时间允许提前 30 秒，过期严格拒绝；到达时间再次校验。
- 面板是规范 HTTPS origin；网关是 DNS 名或受校验的公网 IPv4，加独立 UDP 端口。v1 不支持 IPv6 网关入口。
- 管理地址在 10/8 内，两端不能相同，拒绝现有 Incus 10.10.0.0/22。实际安装还必须检查网段、主机地址、路由冲突及 DNS 解析结果，协议格式校验不代替环境预检。
- 外层上限 12 KiB，载荷上限 6 KiB；TLS 信任与应用签名均需通过。

所有验证结果的 canWrite 固定为 false。已观察候选不是活动网关，也不是见证颁发的授权。

## 3. 节点读取证明

节点向预登记的 HTTPS 地址请求 `GET /v1/controller-config`，禁止 HTTP、查询参数、重定向和响应中的发现地址递归替换。

请求头为 X-Payincus-Platform-ID、X-Payincus-Node-ID、X-Payincus-Timestamp、X-Payincus-Nonce、X-Payincus-Signature。签名字节为 `payincus/controller-config-read/v1\n`，接下来的 GET、精确 authority、路径、平台 ID、节点 ID、时间、nonce 用换行连接。节点自己的 Ed25519 私钥只签读取请求，不签全平台配置。

时间窗口为正负 30 秒，nonce 为随机 24 字节的无填充 base64url。服务先持久保留 nonce，再返回候选；存储错误时拒绝。节点撤销或公钥变化在异步存储后再次检查。响应不包含 OSS、管理员或控制根凭据。

CF 可作为 HTTPS 传输入口，代理须保留配置的 Host、路径和请求头，禁用缓存；此 API 不能返回 Access 交互登录页。WireGuard UDP 仍需直连入口。正式独立发现服务尚未在公网 CF 部署验收，已有 CF 实证仅为项目心跳 API。

## 4. 独立服务启动与存储

显式入口为 `node server/dist/scripts/run-controller-discovery.js /absolute/private/config.json`。这是受控开发组件入口，尚未提供一键安装或页面初始化。

Linux 需要 Node 22 和 `/usr/bin/flock`。配置及 TLS 文件为当前服务用户拥有、0600、单硬链接普通文件；配置目录与状态目录为 0700，祖先目录不能由不受信用户写入。拒绝符号链接。Windows 可运行协议守卫，但不支持正式持久服务启动。

配置严格包含 schemaVersion=1、authority（外部精确 Host）、listenHost=127.0.0.1、listenPort（1024–65535）、stateDirectory（绝对规范路径）、trustedConfigKeys（keyId→原始公钥 base64）。配置同目录准备 tls.key、tls.crt；状态树预先登记：

```text
state/
  service.lock
  nodes/<node-id>.json
  nonces/<node-id>/<sha256>.json
```

节点记录为 platformId、nodeId、enabled、publicKey、candidate。内部 createControllerCandidateStore 已提供登记、幂等发布和撤销；调用者仍须完成独立授权。它没有公开 HTTP 入口，不能直接把本地文件入口开放为网页文件写入。Linux 写操作使用独立 mutation.lock；多个调用实例同进程按目录串行，不同进程抢锁失败须重试。记录临时写入、文件同步、原子改名和目录同步后才成功返回。

发布先验签已存候选并取得最高代次；即使它过期，也只能由更高代次的有效候选替换，同代次不同内容拒绝。撤销保留身份、最高代次和 nonce，不删除节点或允许 enroll 自动复活；信任轮换须后续显式协议。已提交改名后若目录同步失败会报告失败，调用者应重读后幂等重试，不能回退旧版本。

同状态目录只能有一个独立服务；不同端口不能绕过锁。flock 保留在 Node 的打开文件描述符上，正常退出或强制终止都会释放，重启无需删除遗留锁。nonce 同步到文件和目录，重启后仍拒绝重放；每节点最多 256 个活动 nonce，目录枚举有边界。源 IP 限流 120 次/分钟，最多 4096 个计数器、256 条连接；代理后的节点共享源限流，正式规模和可配置限流仍需后续验收。

Go observed.json、observe.lock 放在宿主独立 0700 目录，不能随历史平台数据库恢复回退。先加锁读取磁盘最高代次，验证成功后临时文件同步、原子改名、目录同步。损坏、错误权限、链接或持久化失败均拒绝，不重置状态绕过。

## 5. 验证与下一道门禁

已覆盖 73 份相同 Node/Go 测试向量、Go Linux 状态并发/文件边界、TLS/身份/响应失败，以及 Node 独立 HTTPS 服务和真实 CLI。Linux 真机验证包括强制退出重启、同目录第二进程拒绝、防重放保留；正式独立 CLI 与实际 Go 客户端完成双向签名验证。

持久状态库已有边界守卫和 HTTPS 发布/撤销联调；后续需接入受权登记/发布管理协议，再做独立原子见证和宿主写者隔离，之后接受限网络维护、双通道和页面任务。真实宿主握手、真实 Agent 心跳、SSH/Incus 身份和旧写者隔离同时通过才标记接管完成。网关自主 OSS 备份、独立 Web 认证及全链路故障演练仍未完成。

## 6. 写者隔离的实测边界

显式 Linux root 验收入口：`INCUDAL_CONTROLLER_FENCE_NETNS_TEST=1 python3 scripts/test-controller-fence-netns.py`。脚本自行进入新的未命名网络命名空间，确认与父命名空间不同才配置接口/nft；不写入主控或宿主真实规则。它不属于普通全套守卫，需要 Linux 的 unshare、ip、nft 及内核权限。

实测证明：在 conntrack established 放行之前拒绝旧管理源，能同时阻断旧连接后续字节和新连接；新管理源、已有及新建客户测试端口继续通过。同批实验也证明断开传输连接不会取消已接受的操作。当前测试使用 TCP echo 与后台任务夹具，没有运行真实 WireGuard、SSH 或 Incus。

现有代码入口复审覆盖 configure-oci-node-network.sh、onboarding-ssh.ts、incus-client.ts、incus-pool.ts、terminal-proxy.ts、instanceTaskWorker.ts、hostOnboardingWorker.ts、auto-policy-scheduler.ts 与 host-pool-recovery.ts。Incus 长任务提交后可独立运行，连接池和终端也可能保留旧连接；仅新后端停止写不能约束已失联旧后端。客户公网 SSH 的交付验证是访问客户实例，不可当作宿主恢复路径或由宿主管理门禁误拦。

下一阶段门禁顺序：获得独立见证候选授权→宿主拒绝旧写连接及新旧管理凭据旁路→清点并中止/等待旧的可识别写任务→持久记录隔离回执→新写租约激活→资源/实例核对。无法证明旧操作结束时保持接管待核对，不能只凭新握手成功继续创建或出售。租约过期或见证失联时拒绝新管理写入，保留客户规则与磁盘；网络分区和旧主控复活需真实专用宿主验证。
