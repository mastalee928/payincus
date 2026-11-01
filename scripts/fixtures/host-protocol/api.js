export const pending = [], reads = [], creates = []
export const host = id => ({ id, name: `PayIncus-${id}`, architecture: 'x86_64', resourcePreset: 'E2', customerDiskGiB: 30,
  cpuAllowanceMax: 200, memoryMax: 768, status: 'online', instanceCount: 0, instances: [], stock: 'available', regionGroup: '日本东部（东京）',
  portProtocol: { requested: 'tcp_udp', applied: 'tcp_udp', status: 'applied' } })
export const inventory = [11, 12, 13].map(host)
export default { hosts: { abusePolicy: async () => ({ policy: { revision: 0, blockBt: false, blockMining: false }, summary: { total: 0, applied: 0, pending: 0, retrying: 0, offline: 0, unsupported: 0, unconfigured: 0, conflict: 0 }, hosts: [], total: 0, page: 1, pages: 1 }) }, hostOnboarding: {
  inventory: async query => { reads.push(query); return { hosts: structuredClone(inventory), total: inventory.length, groups: [],
    summary: { total: inventory.length, available: inventory.length, assigned: 0, unavailable: 0 },
    ungrouped: { total: inventory.length, available: inventory.length, assigned: 0, unavailable: 0 } } },
  setProtocols: (hostIds, protocol) => new Promise((resolve, reject) => pending.push({ hostIds, protocol, resolve, reject })),
  groups: async () => ({ groups: [] }), gateway: async () => ({ ready: true }), list: async () => ({ batches: [], total: 0, gatewaySshHost: null }),
  create: async data => { creates.push(structuredClone(data)); return { id: 'fixture-batch' } },
} }
