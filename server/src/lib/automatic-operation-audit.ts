import { redactAuditText } from './risk-audit.js'

function reasonText(error: string): string {
  const reasons: Record<string, string> = {
    'agent-offline': '尚未收到宿主 Agent 的有效心跳',
    'not-ready': '宿主安装、存储或 Agent 能力尚未满足可售条件',
    'capacity': '宿主可用资源不足以满足当前规格',
    'projects': '宿主存在其他 Incus 项目，系统保留其中的数据',
    'assigned': '宿主仍有客户资源占用，不能释放为可售库存',
    'assigned-not-ready': '已售实例的存储或网络登记尚未通过核验',
    'assigned-mismatch': '宿主实际实例与已售实例登记不一致',
    'unknown-instance': '发现无法确认为原任务目标的实例，系统保留该实例',
    'unknown-forward': '发现无法确认为原任务所有的网络转发，系统保留该转发',
    'volumes': '发现尚未释放或无法确认归属的存储卷或快照',
    INCUS_STORAGE_STATE_UNKNOWN: '宿主未返回有效的存储清单，磁盘释放尚不能确认',
    INCUS_NETWORK_STATE_UNKNOWN: '宿主未返回有效的网络清单，转发释放尚不能确认',
    INCUS_DELETE_NOT_VERIFIED: '原实例仍存在，删除尚未完成',
    UNEXPECTED_RESIDUE: '只读核验发现遗留资源，系统保留资源并继续核对',
    DELETION_BOOKKEEPING_PENDING: '原删除任务的资源或账目结算尚未完成',
    SOURCE_DELIVERY_EVIDENCE_MISSING: '没有找到这台原客户机器的成功交付记录',
    SOURCE_NEWER_TASK_EXISTS: '这台客户机器已有后续操作，原恢复任务暂不修改状态',
    AGENT_REPAIR_REMOTE_FAILED: '原管理连接已核验，但 Agent 配置修复尚未收到成功回执',
    AGENT_REPAIR_SECRET_INVALID: '已保存的 Agent 认证配置未通过完整性检查，系统没有下发',
    HOST_TLS_IDENTITY_MISSING: '缺少原宿主的受信证书记录，系统没有重新信任未知身份',
    HOST_TLS_NOT_TRUSTED: '宿主没有认可原管理证书，系统保留原信任记录'
  }
  if (error.includes(',')) return [...new Set(error.split(',').map(value => reasonText(value.trim())))].join('；')
  if (reasons[error]) return reasons[error]
  const upper = error.toUpperCase()
  if (/AUTHORITY|AUTHORIZATION/.test(upper)) return '原操作权限当前无效，系统保留保护并继续核验权限状态'
  if (/RECOVERY_HELD/.test(upper)) return '备份恢复保护正在生效，保护解除后自动继续'
  if (/DISABLED/.test(upper)) return '原 Agent 已禁用，系统保留禁用状态'
  if (/SUPERSEDED|CHANGED|IDENTITY|UNKNOWN|TRUST|SECRET_INVALID/.test(upper)) return '当前身份或登记与原任务不一致，系统保留数据并继续核对'
  if (/BUSY|TASK/.test(upper)) return '关联操作尚未结束，系统保留任务并稍后继续'
  if (/DISK|VOLUME|SNAPSHOT/.test(upper)) return '磁盘或快照释放尚未核验完成，库存继续保留'
  if (/FORWARD|NETWORK|PROTOCOL/.test(upper)) return '网络或转发状态尚未通过核验，系统继续自动复查'
  if (/STOP/.test(upper)) return '原实例尚未确认停止，系统不会提前删除或释放库存'
  if (/PROXY/.test(upper)) return '代理站点清理尚未完成，系统保留任务并自动续接'
  if (/OFFLINE|UNREACHABLE|CONNECT|TIMEOUT|MANAGEMENT_REPAIR_RETRY/.test(upper)) return '管理通道暂未得到有效响应，系统已安排自动重连'
  return '本步骤尚未核验完成，系统保留任务、数据和资源占用并自动重试'
}

/** Human-readable, searchable audit text; never include transport credentials. */
export function automaticOperationAudit(input: {
  hostId: number; hostName: string; stage: string; attempt: number; result: string
  error?: string; nextAttemptAt?: string; instanceId?: number
}) {
  return redactAuditText([
    `宿主 ${input.hostName} (#${input.hostId})`,
    input.instanceId ? `实例 #${input.instanceId}` : '',
    `自动处理：${input.stage}`, `第 ${input.attempt} 次`, input.result,
    input.error ? `原因：${reasonText(input.error)}` : '',
    input.nextAttemptAt ? `下次自动重试：${input.nextAttemptAt}` : ''
  ].filter(Boolean).join('；')).slice(0, 1500)
}
