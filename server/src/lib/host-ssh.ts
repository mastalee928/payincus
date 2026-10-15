import { shellQuote } from './host-onboarding.js'

export interface HostSshConnection {
  host: string | null
  port: number | null
  username: string | null
  command: string | null
  gatewayCommand: string | null
  viaGateway: boolean
}

export function hostSshConnection(host: {
  managementSshHost: string | null; managementSshPort: number | null; managementSshUser: string | null
  onboardingNode: { managementIp: string | null; sshPort: number } | null
}, gateway: { host?: string; port?: number; username?: string } = {}): HostSshConnection {
  const node = host.onboardingNode
  const address = host.managementSshHost || node?.managementIp || null
  const port = host.managementSshPort ?? (node?.managementIp ? node.sshPort : null)
  const username = host.managementSshUser || (node?.managementIp ? 'root' : null)
  const viaGateway = Boolean(node?.managementIp && address === node.managementIp)
  const destination = address && username ? shellQuote(`${username}@${address}`) : null
  return {
    host: address, port, username, viaGateway,
    command: destination && port ? `ssh ${viaGateway ? '-i /root/.ssh/incudal-host-management ' : ''}-p ${port} ${destination}` : null,
    gatewayCommand: viaGateway && gateway.host
      ? `ssh -p ${gateway.port || 22} ${shellQuote(`${gateway.username || 'root'}@${gateway.host}`)}` : null
  }
}
