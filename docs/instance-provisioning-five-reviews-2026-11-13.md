# 实例开通修复与五轮审视

2026-11-13。范围为P01–P20检查清单中的确认问题、旧入口及当前创建状态／清理竞争。候选面板v1.8.9、Agentv1.0.8；生产仍仅主控只读，本轮未部署。

| 轮次 | 详细检查与修正 | 验证与限制 |
| --- | --- | --- |
| 1 创建／退款 | 创建前持久attempt，逐远端写复查当前归属、账期、配置与host身份；所有入口确认Running，旧失败清理先stop/delete／磁盘／转发再结资源；失败日志不阻退款 | 5相关守卫通过，真实PG/mTLS七场景；接入与SSH旧断言修正，不冒充原生 |
| 2 宿主依赖 | 新Alpine接入补apparmor-utils，3.22/3.23与3.24 profiles包分支；Agent新旧宿主公平30秒补查，有限包锁／下载重试、工具执行与库加载核验，文件丢失自动重装 | 新鲜签名回执守卫；Go系统包／安全计划回归，两架构Linux交叉编译；原生Docker待CI |
| 3 初始化 | apt及setup不吞错；runcmd必要命令合成fail-fast脚本与成功marker；SSH全局策略先于Include/Match并核sshd -t/-T；普通/admin/managed等待成功marker；新迁移目标补首启准备 | 18镜像版本×container/VM×两认证配置与协议测试通过，4相关守卫通过；六实际Incus/SSH矩阵已加入双架构CI，待终态 |
| 4 停删／资源竞争 | 实例先宿主统一锁序、created UUID早保存、finalize锁下复查期限；待清理所有入口重新扫描、单台失败不终止整轮，32目标／4并发／总接收预算；当前改价／原价回卖和期限守卫不放宽 | PG九组完整回归第一遍全通过；创建29场景除deadline首次夹具提前注入外通过，deadline固定注入后＋剩余四场景通过 |
| 5 最终diff／发行 | 原v1.8.8 worker作升级起点、21文件原登记＋迁移留库／故障回滚；新双架构工具原生漂移与六系统真实首次创建门槛；管理员告警共享路径补回 | 219条全量首次216过3失败，补告警＋回执／SSH夹具后定向全过；最终全量、两遍PG第二遍、同SHA CI／预览／资产尚在进行，不声称上线门槛完成 |

P15原库存guest保护是误判，保留正确门禁。P14旧QEMU CPU不能证明OCI RHEL失败，不修改客户特权或硬件判据。P20 cloud-init页面状态不作为交付证明，新生成配置消费独立marker。未使用backup helper限制source.type不能被调用数据覆盖。

本次原生本地初始化命令遭automatic approval review拒绝（仅提供blocked by policy），未执行宿主setup；不换壳绕过，继续仓库一次性CI。Windows原生go test ./...被既有report syscall.Statfs平台代码阻止，两架构Linux编译成功与CI原生Go测试分开。frozen安装同时重建依赖链接使第二遍resume首次MODULE_NOT_FOUND，链接恢复后续跑，保留失败记录。

仍需核全部Actions、实际包签名与原worker升级；未完成的公网IPv6／全端口／KVM／生产点击／完整OSS灾备独立保留。不得将测试脚本生成或检查退出当作六系统成功；不代退款追扣、客户重建、生产停止／删除或OTA。

最终本地219/219全量自然exit0（logs/test-run-20261113-013523），两遍九组共18场真实PG／mTLS回归已完成；第二遍resume依赖安装冲突后恢复通过。候选0dcb2d24已推PR12，同来源CI发现工具探针把unsquashfs正常非零当坏工具、部分fixture缺新回执及exec输出；均补原语义后测试。六系统CI首次Alpine已创建Running但marker未就绪，仍未通过；追加live脱敏诊断继续定位，不能发布。
