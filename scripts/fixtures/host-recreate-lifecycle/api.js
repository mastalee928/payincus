export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params, resolve, reject }))
export default {
  instances: { list: params => request('list', params), recreate: (id, data) => request('recreate', { id, ...data }) },
  images: { getSystemImages: (type, memory, hostId) => request('images', { type, memory, hostId }) },
  sshKeys: { list: () => request('keys', {}) },
  initCommands: { getAvailable: async () => ({ commands: [], templates: [] }) },
  traffic: { getInstanceTraffic: async () => ({ monthlyUsed: '0', monthlyUsedFormatted: '0 B', monthlyLimit: null, monthlyLimitFormatted: null, percentage: 0 }) },
}
