export const pending = []
export const snapshot = { instanceId: 41, ownerId: 2, hostId: 3, incusId: 'isolated-guest', price: '10.00', final: false, billingCycle: 1, revision: 'a'.repeat(64) }
const request = (method, id, data) => new Promise((resolve, reject) => {
  if (new URLSearchParams(location.search).has('inspect')) return resolve({ ...snapshot, instanceId: id })
  pending.push({ method, id, data, resolve, reject })
})
export default {
  admin: { getInstanceRenewalPrice: id => request('get', id), setInstanceRenewalPrice: (id, data) => request('put', id, data) },
  billing: { getInstanceBilling: id => request('billing', id), getUserBalance: () => request('balance'),
    renewInstance: (id, months, expectedAmount) => request('renew', id, { months, expectedAmount }) }
}
