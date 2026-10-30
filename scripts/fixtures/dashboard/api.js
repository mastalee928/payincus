export const pending = []
const request = kind => new Promise((resolve, reject) => pending.push({ kind, resolve, reject }))
export default {
  instances: { list: () => request('instances') }, auth: { me: () => request('me') },
  billing: { getUserBalance: () => request('balance') }, vipLevels: { getMyOverview: () => request('vip') },
  entertainment: { getPoints: () => request('points') }, systemConfig: { getPublic: async () => ({ requireInviteCode: false }) }
}
