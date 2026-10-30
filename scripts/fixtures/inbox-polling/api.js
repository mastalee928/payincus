export const pending = []
export default {
  inbox: { getUnreadCount: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
  systemConfig: { getPublic: async () => ({ requireInviteCode: false }) }
}
