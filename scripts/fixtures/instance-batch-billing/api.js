export const pending = [], calls = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
const instance = id => ({ id, name: `Fixture ${id}`, status: 'running', user_id: 1, packagePlanId: id, cpu: 100, memory: 512, disk: 5120, created_at: '2030-01-01T00:00:00Z', host: { id, name: `Host ${id}`, country_code: 'us' } })
export default {
  systemConfig: { async getPublic() { return {} } },
  instances: { async list() { calls.push('list'); return { instances: [instance(1), instance(2)], total: 2, totalPages: 1, availableCountries: [] } } },
  users: { async get(id) { return { user: { id, username: `Fixture ${id}` } } } },
  billing: {
    previewBatchRenew: ids => defer('renew-preview', { ids }), getUserBalance: () => defer('balance'),
    renewInstancesBatch: (ids, months) => defer('renew', { ids, months }),
    getBatchDestroyInfo: ids => defer('destroy-preview', { ids }), destroyInstancesBatch: (ids, emailCode) => defer('destroy', { ids, emailCode }),
    requestDestroyVerification: ids => defer('destroy-code', { ids }),
    setAutoRenewBatch: (ids, autoRenew) => defer('auto-renew', { ids, autoRenew }),
  },
}
