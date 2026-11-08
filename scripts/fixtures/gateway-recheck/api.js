export const fixture = { mode: 'ready', calls: [], failCheck: false, delay: false, pending: null }
const query = new URLSearchParams(location.search)
fixture.mode = query.get('mode') || 'ready'
const fresh = () => fixture.mode === 'fresh'
const gateway = () => fresh() ? { ready: false, setupAllowed: true, setupBlockedCode: null, code: 'GATEWAY_NOT_CONFIGURED' } : {
  ready: fixture.mode !== 'offline', local: true, target: '127.0.0.1', setupAllowed: false, setupBlockedCode: 'SIMPLE_GATEWAY_ALREADY_CONFIGURED',
  ...(fixture.mode === 'offline' ? { code: 'SSH_CONNECT_FAILED' } : { gateway: { controlIp: '10.253.240.1', network: '10.253.240.0/20', sshHost: 'gateway.example.com' } }) }
const plan = () => ({ id: '11111111-1111-4111-8111-111111111111', actorId: 1, state: 'awaiting_confirmation', step: 'confirm', updatedAt: new Date().toISOString(), errorCode: null,
  plan: { planHash: 'a'.repeat(64), expiresAt: Date.now() + 300000, hostCapacity: 4093, existingWireGuard: false, identitiesPreserved: true, backendRestart: true, publicHost: 'gateway.example.com', target: 'local-controller' } })
export default { hostOnboarding: {
  gatewaySetupStatus: async () => { fixture.calls.push('history'); return { available: true, gateway: gateway(), latest: fresh() ? null : plan() } },
  checkControllerGateway: async () => {
    fixture.calls.push('check')
    if (fixture.delay) await new Promise(resolve => { fixture.pending = resolve })
    if (fixture.failCheck) throw { code: 'NETWORK_ERROR' }
    return gateway()
  },
  configureControllerGateway: async () => { fixture.calls.push('prepare'); return plan() },
  confirmControllerGateway: async () => { fixture.calls.push('confirm'); return { ...plan(), state: 'queued', step: 'configure', plan: undefined } },
  controllerGatewayTask: async () => { fixture.calls.push('task'); return plan() },
  gatewayEndpoint: async () => ({ endpoint: fresh() ? null : { hostname: 'gateway.example.com', port: 51820 }, revision: 1 }),
  gatewayDnsHosts: async () => ({ hosts: [] }),
  managementGateways: async () => ({ gateways: [], preparations: [] }),
} }
