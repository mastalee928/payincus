import { isIP } from 'node:net'
import { customerIpv6View } from './host-public-ipv6.js'

export function publicInstanceIpv6(value: string | null | undefined): string | null {
  return value && isIP(value) === 6 && /^[23][0-9a-f]{0,3}:/i.test(value) ? value : null
}

/** Keep infrastructure names and management addresses out of customer API responses. */
export function applyCustomerInstanceView(response: Record<string, any>, instance: {
  dedicated_ipv4?: boolean; dedicated_network_ready?: boolean; public_ip_sync_blocked?: boolean
  dedicated_ipv6?: unknown; host_id?: number; incus_id?: string | null
  service_fault?: boolean
}, admin: boolean): void {
  response.dedicatedIpv4 = instance.dedicated_ipv4 === true
  response.serviceFault = instance.service_fault === true
  response.publicIpUpdating = instance.public_ip_sync_blocked === true
  response.dedicatedNetworkReady = instance.dedicated_network_ready === true && !response.publicIpUpdating
  delete response.dedicated_ipv6
  delete response.dedicatedIpv6
  if (!admin) {
    if (response.host && typeof response.host === 'object') {
      response.host = { ...response.host, name: '', ip_address: null }
    }
    delete response.hostIpAddress
    delete response.host_ip_address
    delete response.hostIpv6Gateway
    delete response.host_ipv6_address
    delete response.hostNatPublicIpv6
    delete response.hostAnnouncement
  }
  if (!response.dedicatedIpv4) return
  response.monthlyTrafficLimit = null
  response.portLimit = 0
  response.port_limit = 0
  response.port_mappings = []
  response.ssh_port = response.dedicatedNetworkReady ? 22 : null
  response.ipv6 = publicInstanceIpv6(response.ipv6)
  const ipv6 = customerIpv6View(instance.dedicated_ipv6, { hostId: instance.host_id, instanceName: instance.incus_id ?? undefined, networkReady: instance.dedicated_network_ready })
  response.publicIpv6Addresses = ipv6 ? ipv6.addresses : response.ipv6 ? [response.ipv6] : []
  response.publicIpv6Status = ipv6?.status ?? (response.ipv6 ? 'ready' : 'none')
  if (ipv6) response.ipv6 = ipv6.primary
  if (!admin) {
    response.ipv4 = response.dedicatedNetworkReady ? (response.nat_public_ip ?? response.natPublicIp ?? null) : null
    response.limitsIngress = null
    response.limitsEgress = null
    response.hostOwnerInfo = null
    if (!response.dedicatedNetworkReady) {
      response.nat_public_ip = null; response.natPublicIp = null
      if (response.host && typeof response.host === 'object') response.host.nat_public_ip = null
    }
  }
}
