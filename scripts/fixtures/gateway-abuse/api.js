export const requests = [], pending = [], reads = []
export const heldEndpointReads = []
export const fixture = {
  policy: { revision: 3, blockBt: false, blockMining: false },
  endpoint: { endpoint: { hostname: 'control.example.invalid', port: 51820 }, revision: 3, existingHostsNeedUpdate: true, effectiveEndpoint: null },
  hosts: Array.from({ length: 108 }, (_, i) => ({ id: i + 1, name: `PayIncus-${i + 1}`, state: i < 103 ? 'pending' : i === 103 ? 'offline' : i === 104 ? 'retrying' : i === 105 ? 'unsupported' : 'applied', attempts: i === 104 ? 4 : 0, errorCode: i === 104 ? 'APPLY_FAILED' : null, nextRetryAt: i === 104 ? new Date(Date.now() + 60000).toISOString() : null, checkedAt: null, lastSeenAt: null })),
  domains: Object.fromEntries(['independent', 'backup'].map((id, index) => [id, { gatewayId: id, purpose: id, scope: 'console', hostname: `${id}.example.invalid`, desiredHostname: `${id}.example.invalid`, revision: '2', requestId: null, state: 'idle', step: 'idle', errorCode: null, attempt: 0, retryAt: null, channelReady: index === 0, credentialsRequired: index !== 0 }]))
}
const copy = value => structuredClone(value)
const wait = (kind, input, id) => new Promise((resolve, reject) => { requests.push({ kind, input: copy(input), id }); pending.push({ kind, input: copy(input), id, resolve, reject }) })
export default {
  hosts: {
    abusePolicy: async (query = {}) => {
      reads.push({ kind: 'abuse', query: copy(query) })
      const summary = { total: fixture.hosts.length, applied: 0, pending: 0, retrying: 0, offline: 0, unsupported: 0, unconfigured: 0, conflict: 0 }
      fixture.hosts.forEach(row => summary[row.state]++)
      const rows = fixture.hosts.filter(row => (!query.search || row.name.includes(query.search)) && (!query.state || query.state === 'all' || (query.state === 'attention' ? row.state !== 'applied' : row.state === query.state)))
      const pages = Math.max(1, Math.ceil(rows.length / 20)), page = Math.min(query.page || 1, pages)
      return copy({ policy: fixture.policy, summary, hosts: rows.slice((page - 1) * 20, page * 20), page, pages, total: rows.length })
    },
    saveAbusePolicy: input => wait('save-policy', input),
    retryAbusePolicy: revision => wait('retry-all', { revision })
  },
  hostOnboarding: {
    gatewayEndpoint: async () => {
      reads.push({ kind: 'endpoint' })
      if (fixture.holdEndpoint) return new Promise(resolve => heldEndpointReads.push({ resolve }))
      return copy(fixture.endpoint)
    },
    gatewayDnsHosts: async () => ({ hosts: [{ id: 'host-1', name: 'PayIncus-Tokyo', eligible: true, installed: false, running: false, state: 'queued', step: 'connect', error: 'SSH_CONNECT_FAILED', attempt: 9, retryAt: Date.now() + 900000, updatedAt: null }] }),
    saveGatewayEndpoint: input => wait('save-endpoint', input),
    synchronizeGatewayDnsHosts: failedOnly => wait('sync-endpoint', { failedOnly }),
    installGatewayDnsHost: id => wait('sync-host', {}, id),
    gatewayDomain: async id => copy(fixture.domains[id]),
    changeGatewayDomain: (id, input) => wait('save-domain', input, id)
  }
}
