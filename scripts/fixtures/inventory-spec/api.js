export const pending = []
export const reads = []
export default { hostOnboarding: {
  inventory: async query => {
    reads.push(query)
    return { hosts: [], total: 0, groups: [], summary: { total: 0, available: 0, assigned: 0, unavailable: 0 }, ungrouped: { total: 0, available: 0, assigned: 0, unavailable: 0 } }
  },
  updateSpec: data => new Promise((resolve, reject) => pending.push({ data, resolve, reject })),
} }
