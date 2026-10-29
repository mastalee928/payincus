export const pending = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default {
  systemConfig: { getPublic: async () => ({}) },
  instances: {
    get: async id => ({ instance: { id, name: id === 1 ? 'Osaka server' : 'Sydney server', incus_id: `isolated-${id}`, host_id: 10, user_id: 1,
      status: 'error', image: 'debian/12', cpu: 100, memory: 512, disk: 2048, network_mode: 'nat', package_id: null,
      dedicatedIpv4: true, dedicatedNetworkReady: true, snapshotLimit: 0, host: { name: 'Isolated host', user_id: 2 } } }),
    getActiveTask: async () => ({ task: null }),
    getSnapshots: async () => ({ snapshots: [] }),
    checkCloudInitStatus: async () => ({ complete: true }),
  },
  traffic: { getInstanceTraffic: async () => null },
  transfers: { list: async () => ({ transfers: [] }) },
  logs: { list: async () => ({ logs: [], total: 0 }) },
  terminalSavedCommands: { list: async () => ({ commands: [] }) },
  billing: {
    getDestroyInfo: async id => ({ canDestroy: true, isFreeInstance: true, refund: { refundAmount: 0, feeAmount: 0 },
      instance: { id, name: id === 1 ? 'Osaka server' : 'Sydney server', hostName: 'Isolated host', planName: null } }),
    destroyInstance: (id, data) => defer('destroy', { id, ...data }),
    requestDestroyVerification: ids => new URLSearchParams(location.search).has('inspect')
      ? Promise.resolve({ success: true, channel: 'email', maskedTarget: 'is***@example.test', resendAfter: 60 }) : defer('code', { ids }),
    getUserBalance: async () => ({ balance: { balance: 0, totalRecharge: 0, totalConsume: 0, destroyedValue: 0 } }),
    getPaymentProviders: async () => ({ providers: [{ id: 1, name: 'Isolated payment', type: 'epay', minAmount: 1, maxAmount: null, methods: ['alipay'], feeRate: 0, feeFixed: 0 }] }),
    createRechargeOrder: (...data) => defer('recharge', data),
  },
}
