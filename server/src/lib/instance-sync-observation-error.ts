import { prisma } from '../db/prisma.js'
import { redactAuditText } from './risk-audit.js'

/** A missing/error response is an observation failure, never delete authority. */
export async function recordUnverifiedInstanceObservation(input: {
  source: 'host_batch' | 'scheduler'
  instanceId: number
  hostId: number
  incusId: string
  actorId?: number
  error: unknown
}): Promise<string> {
  const cause = redactAuditText(input.error instanceof Error ? input.error.message : String(input.error)).slice(0, 2000)
  let message = `INSTANCE_SYNC_UNVERIFIED: 未能确认宿主机 #${input.hostId} 上实例 #${input.instanceId} (${input.incusId}) 的实际状态：${cause}。实例记录、资源与库存占用已保留；请核对节点实际实例后重试。`
  try {
    // Keep the observed identities even after a transfer/rename. No FK locks:
    // the current instance or account may be held by the competing operation.
    await prisma.log.create({ data: { userId: null, instanceId: null, module: 'instance',
      action: 'instance.sync_unverified', content: redactAuditText(`${input.source}; actor=${input.actorId ?? 'system'}; ${message}`),
      result: 'failed' } })
  } catch (error) {
    console.error('[InstanceSync] Failed to persist unverified observation:', redactAuditText(error instanceof Error ? error.message : String(error)))
    message += ' 错误记录未能保存，请保留本次错误并检查数据库。'
  }
  return message
}
