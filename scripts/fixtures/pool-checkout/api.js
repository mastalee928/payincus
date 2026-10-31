export const requests = []
const ask = (kind, data) => new Promise((resolve, reject) => requests.push({ kind, data, resolve, reject }))
export default {
  packages: { getPublicCatalog: () => ask('catalog') }, sshKeys: { list: () => ask('keys') },
  config: { getPublic: async () => ({}) },
  auth: { me: async () => ({ user: { id: 1, username: 'seoul', role: 'user' } }) },
  instances: { poolOrder: data => ask('buy', data), getPoolOrder: id => ask('order', id) },
  billing: { getPaymentProviders: () => ask('providers'), createRechargeOrder: (...data) => ask('charge', data),
    getRechargeOrder: id => ask('charge-status', id), verifyRechargeOrder: id => ask('verify', id) }
}
