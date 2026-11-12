export const pending = []
export const fixture = { batches: [], hardening: null }
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params, resolve, reject }))
const counts = { total: 0, available: 0, assigned: 0, unavailable: 0 }
export const adminApi = { hostOnboarding: {
  gateway: () => Promise.resolve({ ready: true }),
  groups: () => Promise.resolve({ groups: [] }),
  list: params => Promise.resolve({ batches: fixture.batches, total: fixture.batches.length, retirements: [], retirementTotal: 0, gatewaySshHost: 'gateway.example.com' }),
  securityHardening: () => Promise.resolve(fixture.hardening),
  inventory: params => { pending.push({ kind: 'inventory', params }); return Promise.resolve({ hosts: [], total: 0, groups: [], summary: counts, ungrouped: counts }) },
  checkAddress: address => request('address', { address }),
  create: data => request('create', data),
} }
export default adminApi
