export const pending = []
export const state = { paused: false, hosts: [], batches: [] }
const defer = (kind, id) => new Promise((resolve, reject) => pending.push({ kind, id, resolve, reject }))
const counts = () => ({ total: state.hosts.length, assigned: state.hosts.length, available: 0, unavailable: 0 })
const response = () => ({ hosts: state.hosts, total: state.hosts.length, totalPages: 1 })
export default {
 hosts: { list: () => state.paused ? defer('list') : Promise.resolve(response()), listHosted: () => Promise.resolve(response()), get: id => state.paused ? defer('host', id) : Promise.resolve({ host: state.hosts.find(h => h.id === id) }), getAgentStatus: id => Promise.resolve({ host: { id }, agent: { id: 1,hostId:id,agentId:'isolated-fixture',enabled:true,status:'online',version:'1.0.4',latestVersion:'1.0.4',versionStatus:'latest',capabilities:[],lastSeenAt:new Date().toISOString(),lastReport:{incus:{available:true},resources:{cpuTotal:2,memoryTotalMb:768},metrics:{heartbeatIntervalSeconds:30}} } }) },
 instances: { list: params => Promise.resolve({ instances: [{id:1,hostId:params.hostId,cpu:200,memory:768,disk:30720}], page: 1, pageSize: 100, total: 1, totalPages: 1 }) }, traffic: { getHostTrafficHistory: () => Promise.resolve({ data: [], summary: { totalUsed: '0', totalUsedFormatted: '0 B', totalLimit: '0', totalLimitFormatted: '0 B' }, periodStart: '2026-11-01', periodEnd: '2026-11-30' }) },
 hostOnboarding: {
 gateway: () => Promise.resolve({ ready: true }), groups: () => Promise.resolve({ groups: [] }),
 list: () => Promise.resolve({ batches: state.batches, total: state.batches.length, retirements: [], retirementTotal: 0 }),
 inventory: () => Promise.resolve({ ...response(), groups: [], summary: counts(), ungrouped: counts() }),
 getPublicIp: id => state.paused ? defer('ip', id) : Promise.resolve(state.hosts.find(h => h.id === id).publicIpSync),
 syncPublicIp: (id, settings) => defer('sync', id),
 }
}
