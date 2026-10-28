export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params: params === undefined ? undefined : JSON.parse(JSON.stringify(params)), resolve, reject }))
export default { entertainment: {
  getBadgeCatalog: async () => ({ series: [], badges: [] }),
  adminGetLotteries: params => request('list', params),
  adminGetLottery: id => request('detail', { id }),
  adminUpdatePrize: (id, data) => request('update', { id, data }),
  adminCreatePrize: (id, data) => request('create', { id, data }),
  adminDeletePrize: id => request('delete', { id }),
  adminUpdateNotification: (id, data) => request('notification', { id, data }),
} }
