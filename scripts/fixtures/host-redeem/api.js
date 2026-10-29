export const pending = []
const defer = (kind, hostId, params) => new Promise((resolve, reject) => pending.push({ kind, hostId, params, resolve, reject }))
export default { hosts: {
  getRedeemCodes: (hostId, params) => defer('list', hostId, params),
  getRedeemCodeOptions: () => defer('options'),
  getRedeemCodeUsages: (hostId, codeId, params) => defer('usages', hostId, { codeId, ...params }),
  createRedeemCode: (hostId, data) => defer('create', hostId, data),
  updateRedeemCode: (hostId, codeId, data) => defer('toggle', hostId, { codeId, ...data }),
  batchDeleteRedeemCodes: (hostId, ids) => defer('delete', hostId, { ids }),
} }
