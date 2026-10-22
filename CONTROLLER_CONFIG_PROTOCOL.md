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

已新增 inspectControllerQuiescence 只读检查：严格解析实际 Incus 的状态→数组分组、ID/状态码一致性，拒绝未知/非递归格式；任何活动操作、遗留凭据旁路、未隔离旧连接、SSH 进程或本地任务都阻断。canActivate 只表示输入事实无未结束工作，既不是签名回执，也不是资源一致性结论或写租约；宿主执行器仍需实际收集、绑定代次并签名。

真实 Incus 6.0.4 在隔离 mount/net/pid 命名空间及独立状态目录验证：提交延迟镜像任务后关闭客户端连接，任务仍运行；本模块准确拒绝，任务最终失败结束后才认定工作静止。失败任务的资源核对仍必须单独完成。实验不创建容器，不改系统 Incus 服务，不接管客户宿主。测试程序为 scripts/test-controller-quiescence-incus.py，需先在专用 Linux ARM64 实验目录提取 Debian 的 incus-base、incus-client 及依赖，并编译服务器；当前依赖布局只验证 ARM64。

复验时明确配置 INCUDAL_INCUS_TEST_ROOT（含 rootfs 提取目录）、INCUDAL_QUIESCENCE_CHECK_SCRIPT（仓库 scripts/check-controller-quiescence.mjs 的绝对路径），设置 INCUDAL_INCUS_QUIESCENCE_TEST=1 并保存父 net/mnt/pid 命名空间标识到 INCUDAL_PARENT_NET/MNT/PID；随后由 unshare --mount --net --pid --fork --mount-proc 启动 Python 程序。脚本在任何 mount 或服务启动之前核对三个 namespace 必须不同。sys 与 proc/sys 只读，隐藏 AppArmor 控制目录，状态目录每轮新建；服务在 finally 终止，数据与日志留在专用实验目录，不进入备份或发行资产。该显式真机测试不加入普通无基础设施守卫清单。

## 7. 宿主隔离回执及见证基础

Node/Go 已实现 host-fence-receipt/v1 协议。节点使用自己的预登记 Ed25519 身份签名，载荷绑定平台、节点、主控、请求、epoch/sequence、候选载荷哈希、24字节随机挑战与当前 bootId。最长有效期30秒，时钟容差5秒；要求旧连接/遗留凭据已阻断且SSH进程、本地任务和Incus活动操作均为0。域分离为 `payincus/host-fence-receipt/v1\n`；外层 schemaVersion、payload、signature，严格规范编码和4KiB上限。未知字段、重复键、错签名、错节点/候选/挑战及过期均拒绝。签名函数本身无法替代宿主实际执行，当前未接入 root 维护组件。

独立内部 createControllerWitness 已有持久两阶段基础：受信候选只能以更高epoch准备接管，随机挑战保存后等待宿主签名回执；激活前核对回执全部绑定。同请求可幂等重试，并发不同主控同代次不能双激活，重新启动重读最高代次。新准备废弃旧回执；状态缺失/损坏/不安全权限拒绝，不能自动初始化epoch1。Linux 使用独立目录mutation.lock、原子改名、文件/目录同步。

当前见证是受控内部文件状态库，每节点使用独立目录并预配置初始身份。尚无正式初始化/灾备重建、管理认证、签名写租约、租约续期、服务部署/复制协议；始终报告 signedWriteLeaseAvailable=false。active 只表示内部已核验回执，期限不超回执，不会让现有Agent/SSH/Incus执行资源操作。独立权威目录必须位于主控/A故障域之外，并禁止复制旧快照作为并行活动权威；完整多故障域见证及宿主启动/过期门禁需后续验收。

已验证共同26项回执向量、实际Go签名→Node核验，以及Windows/Linux见证准备/激活/并发/重启/损坏检查。它们验证协议和持久状态方向，不代表主控恢复后已能在页面接管宿主。

见证状态新增 lastObservedAt：持久时间只前进，超过5秒回拨拒绝；在容差内仍按最高观察时间校验过期，不能复活已过期请求。当前只验证单机进程重启及文件持久状态，不承诺旧磁盘快照、整台见证替换或多副本安全恢复。正式签名租约还须引入受信见证身份/代次恢复、宿主boot与单调时钟执行，完成分区验收前不开放写。

Go 已新增 ReadIncusQuiescence：只访问显式配置的本机安全 Unix socket，固定GET全部项目操作，不携带远程凭据、不跟随跳转；5秒超时、1MiB/1024操作限制、JSON重复键及深度限制、响应/状态分组严格核对。权限、链接、API失败、未知格式或取消请求拒绝；不把连不上等同于无任务。真实隔离Incus已验证Go本机读取活动/结束状态。复验脚本可用 INCUDAL_GO_QUIESCENCE_PROBE 指定临时采集探针（输出Active数量），不将临时探针打包进正式Agent。

## 8. 见证准备许可和独立维护预检

host-fence-prepare/v1 由独立见证签名，域分离为 `payincus/host-fence-prepare/v1\n` + keyId + `\n` + payload。载荷包含witnessId、平台/宿主/主控/请求、epoch/sequence、候选哈希、挑战和60秒以内有效期。宿主持预登记的独立见证公钥，不从请求自行建立信任。只有见证内部preparing状态可生成许可；许可不能执行客户资源写入。21项共同Node/Go向量及见证准备/活动阶段守卫通过。

新增独立 incudal-maintenance 命令，支持 `--inspect --enrollment <绝对路径>` 与显式 `--prepare-fence --enrollment <绝对路径>`，两个模式互斥。登记文件为0600、直属目录0700、当前用户拥有的单链接普通文件；严格拒绝不受信祖先、符号链接、重复/未知JSON和超限输入。登记字段为schemaVersion、platformId、nodeId、witnessId、candidateKeys、witnessKeys、incusSocket、observedStateDirectory；准备隔离还必须预登记managementPorts（ssh、incus两个不同TCP端口），端口不得来自远端请求。stdin只接收candidate与preparePermit两项签名封装，输出仅为计划/阻断项，不含签名根、节点密钥或OSS凭据。

另增互斥 `--restore-fence --enrollment <绝对路径>` 供本机启动恢复：读取受保护的network-fence.json及最高水位，按历史有效时间验签原候选和准备许可，只恢复已授权拒绝规则，不消费远端新请求、不接受历史写租约。

顺序：先核验候选+见证许可，成功后加锁原子记录宿主最高观察代次，再次核对有效期/代次并读取本机Incus。无任务也仍显示network-fence-not-applied、legacy-credential-audit-required、local-process-audit-required，readyForFencing/canWrite固定false。错误许可不会写入观察状态，旧请求不能覆盖较高代次，重复预检幂等。只修改独立观察文件，不修改路由、防火墙、WireGuard、AgentURL或客户数据。

独立命令未加入正式Agent安装/升级服务或发行资产，当前仅可从源码构建作受控验收。真实隔离Incus已验证有/无活动任务、错误许可、不安全登记及最高代次记录；Go全包race/vet和命令级回归通过。它是受限执行器的准备入口，SSH进程/旧授权处理、签名写租约执行及页面任务尚待实现。

## 9. 宿主外部管理 TCP 的准备隔离

`--prepare-fence` 先校验双签名并记录最高观察代次、确认本机Incus读取可用，再通过固定 `/usr/sbin/nft` 执行仅拒绝的INPUT规则。执行必须为Linux root，观察目录及祖先均root拥有且不可组/其它用户写；以network-fence.lock和observe.lock共同互斥并重读磁盘observed.json，不能信任调用者传入的旧水位。缺失/损坏状态拒绝，较高代次观察不能与旧请求执行并发。nft清单与检查之后按当前时间再验许可，过期不能开始修改。

规则位于独立 `inet incudal_controller_fence` 表，在priority=-200的INPUT中拒绝所有非lo接口到预登记管理TCP端口的流量，包括已有连接后续字节；本机检查保留。此阶段候选主控也不能直接写入。首次使用create table防止并发出现的同名表被合并；已有表必须严格匹配归属标记、hook/priority、端口和表达式，未知字段/额外规则/休眠标记拒绝。检查和替换为原子事务，执行后读取实际表确认，错误不删除当前隔离。

隔离不操作FORWARD、OUTPUT、客户DNAT/IPv6规则、WireGuard配置、SSH密钥或Incus任务。命令隔离后重读本机任务；查询失败不输出成功且保留已施加的拒绝规则。只有本次实际施加并核验成功才返回networkFenceApplied=true，仍报告legacy-credential-audit-required、local-process-audit-required及任何active-incus-operations，canWrite/readyForFencing始终false，不签发完整隔离回执。

新增显式验收 `scripts/test-controller-management-fence-netns.py`：Linux root下先创建与父环境不同的未命名net namespace，另建client/server子namespace；实际编译Go测试入口校验签名、受保护状态并调用生产nft路径。IPv4/IPv6既有及新管理连接拒绝，同端口客户DNAT/FORWARD、loopback检查和其它服务通过，客户表保持一致；同时验证维护命令缺失端口拒绝、未完成审计阻断及隔离后读取失败不冒充成功。

复验需先在agent目录 `go test -c -o <绝对路径>/management-fence.test ./internal/controllerconfig` 和 `go test -c -o <绝对路径>/maintenance-command.test ./cmd/incudal-maintenance`，设置INCUDAL_MANAGEMENT_FENCE_NETNS_TEST=1、INCUDAL_MANAGEMENT_FENCE_TEST_BINARY和INCUDAL_MAINTENANCE_FENCE_TEST_BINARY后执行Python脚本。它需要unshare/nsenter/ip/nft/sysctl及内核权限，不加入普通守卫；普通Go测试不修改真实网络。真实Incus6.0.4在隔离mount/net/pid环境另验准备命令活动任务及结束状态。

这是运行期准备隔离，尚无重启时持久重装/启动门禁、遗留授权/本地进程审计、租约代理或实际WireGuard/SSH写权限接管。不能安装到客户宿主并据此宣称完整旧写者隔离或灾备完成。

后续新增network-fence.json：施加前先原子保存双签名对象和本地端口、文件/目录同步；启动恢复重读最高代次并验原许可，只恢复拒绝。隔离net namespace已验证删除运行期表后恢复成功、端口变化拒绝及客户规则保持，独立命令恢复输出canWrite=false。尚未安装systemd/OpenRC启动单元并绑定SSH/Incus启动顺序，整机重启时序的完整门禁仍需验收；上一段“无持久重装”为此前阶段。

## 10. 短写租约编码及单调门禁（尚未签发或接入代理）

controller-write-lease/v1使用独立域分离、Ed25519见证签名及规范JSON封装，最长30秒，无写权限的正向时间容差。绑定见证/平台/宿主/主控/请求、最高epoch与sequence、候选哈希、leaseId与单调leaseSequence、内核bootId、每次维护进程启动的新gateId、持有者公钥摘要和固定权限列表。当前范围只有inspect、instance-power、management-channel；未知/重复/乱序权限、任意shell、过期、错误身份、gate和签名均拒绝。

36项Node/Go共同向量验证相同编码及时间/身份/权限边界。Go LeaseGate使用单调截止，重复同一对象不刷新时限，同序号不同内容和低序号拒绝；Revoke保留已观察序号防重放，进程新gateId不能沿用旧租约。记录单调经过时间及逻辑墙钟，时间回退不能复活续期。维护服务必须从真实隔离审计生成绑定、持久保留最高序号并为每次启动创建新gateId；模块自身不开放端口或root执行权限。

Revoke关闭该gate直到重建，不允许更高leaseSequence把已撤销门禁重新打开。请求还核对逻辑墙钟未跨租约expiresAt；宿主进程暂停/系统时间前进不能仅靠仍剩余的单调截止继续放行。见证续期仅可缩小此前权限，扩大范围须重新准备/授权。

见证内部issueWriteLease已经支持由受信宿主回执及gate proof签发/续期；调用者不能传入新的见证密钥，签名身份在初始化时固定。保存后的租约逐次验签并与状态/序号核对，过期对象保留高水位；签发/续期先原子保存再返回。新gate/持有者需更高epoch重新准备，当前最长授权窗口仍不超候选15分钟，每次续期需新鲜宿主证明。内部Linux32项/Windows30项守卫通过。公共服务仍报告signedWriteLeaseAvailable=false，因为真实凭据/进程审计、节点服务及写代理尚未接入；夹具签名不代表物理门禁完成。

controller-gate-proof/v1由宿主身份签名，绑定完整隔离回执哈希、当前bootId/gateId、候选和持有者，最长30秒，禁止未来签发。它把维护进程重启身份带入租约，不修改原host-fence-receipt/v1的字节兼容。当前只有编码/签名及内部见证联调，实际维护服务须自行采集事实，不能让请求填写“隔离成功”。

写请求还需持有者Ed25519证明，绑定完整租约SHA256、权限、精确正文SHA256、规范毫秒时间及24字节nonce，域分离controller-lease-request/v1。接收端自行对最多64KiB正文求哈希，不能相信未验签的摘要；同一门禁内nonce最多1024项并保留整个最长租约期，续期不清空，重复并发仅一次通过。错误正文/租约/范围、过期时间和错签名不消耗nonce。Node签名→Go校验9项共同向量及并发重放测试通过。仅知道持有者公钥摘要不能调用写请求授权，公开端点必须走证明验证。

## 11. 宿主进程事实采集（完整本地写者审计未完成）

准备报告增加processAudit，固定读取真实procfs、两遍核对PID/父PID/开始ticks/UID/名称，最多32768项，检查取消和格式/权限失败；不读取cmdline或environ避免凭据进入日志。SSH守护进程子会话及其后代计入会话任务，监听守护进程单独计数；父链缺失/进程变化标StableSnapshot=false，环和无界链拒绝。启动最初ticks=0属于有效内核事实，不当作错误。

真实Linux采集、解析边界和Go全包race/vet通过。进程数/父链不是完整本地写者证明：已脱离SSH的脚本、定时任务、Incus自动任务和其它root写者需要专门持久任务登记及授权隔离。因此localWriterAuditComplete仍固定false，不移除local-process-audit-required，不生成完整隔离回执。

## 12. 固定宿主操作执行模块（未安装服务）

HostOperationExecutor只接受schemaVersion=1、inspect-operations，或instance-power指定默认项目既有实例及start/stop/restart。拒绝任意URL、shell、创建/删除/重装、force、未知字段、重复键和实例路径穿越；不对其它项目自动授权。请求正文绑定持有者证明、租约范围与nonce后，读取实际Incus活动任务；有任务不提交电源操作，身份/type不匹配拒绝。固定PUT state包含timeout=60、force=false，不等待异步任务伪装完成，只返回接受的operationId。

执行绑定剩余租约的context，Revoke同时取消在途请求；这不取消Incus已接受的操作，仍需实际任务/资源核对。调用模块前维护服务必须完成本地凭据/进程审计与启动门禁；本模块没有开启网络监听，也没有绕过未完成的物理审计。替身Unix API守卫覆盖错误身份/证明、忙任务、正文/路径限制、重放和撤销，真实Incus只读检查另有隔离证据；实际实例电源动作尚待专用实例验收。

## 13. 独立 HTTPS 准备服务

显式入口为 `incudal-maintenance --serve <绝对配置路径>`，仅支持 Linux root。它独立于监控 Agent，尚未通过正式安装器部署到宿主。配置包含 schemaVersion=1、enrollment、listenAddress、tlsCertificate、tlsPrivateKey、clientCa；配置、登记及 TLS 文件遵循 0600/直属目录0700、受信祖先及单链接普通文件约束。

listenAddress 必须为规范的 loopback 或私有管理 IP 和独立端口，不接受通配或公网监听，也不能与登记的 SSH/Incus 端口重合。同一观察状态目录的 maintenance-service.lock 在服务整个生命周期由 flock 持有，另一个端口不能绕过单实例锁。打开端口之前必须从持久签名状态恢复拒绝规则；缺失、损坏、错误身份或端口变化均拒绝启动，不从空状态重建授权。

TLS 最低1.3，客户端必须提供由预登记 CA 验证的证书。客户端认证只提供传输身份，候选及见证许可仍逐请求验签和检查宿主绑定。只提供 POST /v1/inspect 和 POST /v1/prepare，拒绝查询参数、编码路径、任意代理和资源写入口；仅接受 application/json、最多20000字节，不接受压缩正文。并发准备返回409，不排队执行重复变更。失败仅输出固定错误码，丢弃任何部分成功输出；响应禁止缓存。

SIGTERM/中断关闭监听，已安装拒绝规则仍保留。该服务不接收写租约、不创建完整隔离回执，canWrite 始终 false；旧凭据与本地任务审计、受限写代理、systemd/OpenRC 启动顺序及首次准备入口仍待后续施工。隔离 Linux 网络环境已验证真实服务恢复后监听、mTLS 检查、重复监听拒绝、停止关闭端口、缺失状态不监听以及双栈客户转发保持；HTTPS 守卫另验证无证书/其它 CA、接口及正文限制、失败输出和并发边界。
