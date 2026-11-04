import { isTransactionConflict } from './transaction-conflict.js'

/** User-facing reasons deliberately exclude Prisma, SQL and transport internals. */
export function transferFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (['数据同时更新，转移结果尚未提交；后台将自动重试', '操作账号或登录授权已变化，恢复有效授权后才能继续转移', '实例归属或原身份核验未通过；保留原实例，后台继续核验', '发现转移计划外的新资源；保留这些资源，核对后才能继续', '关联操作仍未完成，后台将按原转移进度继续处理', '实例或宿主暂不满足转移条件，条件恢复后后台继续处理', '转移步骤尚未核验完成；原实例与库存继续保留，后台自动重试'].includes(message)) return message
  if (isTransactionConflict(error) || message === 'TRANSFER_DATABASE_RETRY_PENDING') return '数据同时更新，转移结果尚未提交；后台将自动重试'
  if (/FORBIDDEN|BANNED/.test(message)) return '操作账号或登录授权已变化，恢复有效授权后才能继续转移'
  if (/IDENTITY|SOURCE_CHANGED|STATE_INVALID|STATE_CHANGED/.test(message)) return '实例归属或原身份核验未通过；保留原实例，后台继续核验'
  if (/RESOURCES_CHANGED/.test(message)) return '发现转移计划外的新资源；保留这些资源，核对后才能继续'
  if (/BUSY|PENDING/.test(message)) return '关联操作仍未完成，后台将按原转移进度继续处理'
  if (/INVALID_STATUS/.test(message)) return '实例或宿主暂不满足转移条件，条件恢复后后台继续处理'
  return '转移步骤尚未核验完成；原实例与库存继续保留，后台自动重试'
}
