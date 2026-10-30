export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params, resolve, reject }))
export default {
  instances: { list: params => request('instances', params) }, auth: { me: () => request('me') },
  billing: { getUserBalance: () => request('balance') }, vipLevels: { getMyOverview: () => request('vip') },
  entertainment: { getPoints: () => request('points') }, systemConfig: { getPublic: async () => ({ requireInviteCode: false }) }
}
