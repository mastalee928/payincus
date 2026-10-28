export type TicketReplyNotice = { subject?: string; hostName?: string; replyFrom?: string; message?: string; ticketId?: number }

export const TICKET_REPLY_TITLE = '💬 工单有新回复'
export function formatTicketReplyNotice(data: TicketReplyNotice): string {
  let message = `工单「${data.subject}」有新回复`
  if (data.hostName) message += `\n节点: ${data.hostName}`
  if (data.replyFrom) message += `\n来自: ${data.replyFrom}`
  if (data.message) message += `\n${data.message}`
  return message + '\n请前往工单页面查看详情'
}
