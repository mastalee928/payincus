export const pending = [], calls = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default {
  systemConfig: { async getPublic() { return { hostingMarketEntryEnabled: true } } },
  packages: {
    getHostingZones: () => defer('zones'),
    async list(source) { calls.push({ kind: 'packages', source }); return { packages: [] } },
    async getRegions(source) { calls.push({ kind: 'regions', source }); return { regions: [] } },
    async getPlans() { return { plans: [] } }, async get() { return { package: {} } },
  },
  users: { async get() { return { user: { quota: null } } } },
  sshKeys: { async list() { return { keys: [{ id: 1, name: 'Fixture key' }] } } },
  instances: { async getAvailableHosts() { return { hosts: [] } }, create: data => defer('create', data) },
  images: { async getSystemImages() { return { images: [] } } },
  initCommands: { async getAvailable() { return { commands: [] } } },
  aff: { validateCode: (code, planId) => defer('promo', { code, planId }) },
}
