export const pending = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default { users: {
  list: params => defer('users', params),
  getLoginRecords: (id, params) => defer('login', { id, ...params }),
}, admin: {
  getUserBalance: id => defer('balance', { id }),
  getUserBalanceLogs: (id, params) => defer('logs', { id, ...params }),
  getRechargeOrders: params => defer('recharge', params),
  adjustUserBalance: (id, amount, remark) => defer('adjust', { id, amount, remark }),
  getHostingBalanceLogs: (id, params) => defer('hosting-read', { id, ...params }),
  adjustHostingBalance: (id, type, amount, reason) => defer('hosting-adjust', { id, type, amount, reason }),
}, entertainment: {
  adminAdjustPoints: (id, amount, remark) => defer('points-adjust', { id, amount, remark }),
} }
