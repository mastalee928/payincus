import { prisma } from '../db/prisma.js'
import { lookup } from 'node:dns/promises'
import { isIPv4 } from 'node:net'
import { isOnboardingPublicIPv4, normalizeOnboardingAddress, OnboardingError } from '../lib/host-onboarding.js'
import { validateStableGatewayEndpoint, stableGatewayEndpointText, type StableGatewayEndpoint } from '../lib/onboarding-gateway-endpoint.js'

const key = 'onboarding_gateway_dns_endpoint'
export async function resolveGatewayEndpointAddress(value: string): Promise<string> {
  const hostname = normalizeOnboardingAddress(value)
  if (isIPv4(hostname)) return hostname
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const answers = await Promise.race([
      lookup(hostname, { family: 4, all: true }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new OnboardingError('GATEWAY_DNS_LOOKUP_FAILED')), 8000) })
    ])
    const addresses = [...new Set(answers.map(answer => answer.address))]
    if (addresses.length !== 1 || !isOnboardingPublicIPv4(addresses[0])) throw new OnboardingError('GATEWAY_DNS_LOOKUP_FAILED')
    return addresses[0]
  } catch (error) {
    throw error instanceof OnboardingError ? error : new OnboardingError('GATEWAY_DNS_LOOKUP_FAILED')
  } finally { clearTimeout(timer) }
}
export async function resolveRemoteGatewayDomain(address: string, hostname: string, resolve = resolveGatewayEndpointAddress) {
  const domain = validateStableGatewayEndpoint({ hostname, port: 51820 }).hostname
  let target: string, endpoint: string
  try { [target, endpoint] = await Promise.all([resolve(address), resolve(domain)]) }
  catch (error) { throw error instanceof OnboardingError ? error : new OnboardingError('GATEWAY_DNS_LOOKUP_FAILED') }
  if (!isOnboardingPublicIPv4(target) || !isOnboardingPublicIPv4(endpoint)) throw new OnboardingError('GATEWAY_DNS_LOOKUP_FAILED')
  if (target !== endpoint) throw new OnboardingError('GATEWAY_DNS_TARGET_MISMATCH')
  return { hostname: domain, address: target }
}
export async function verifyRemoteGatewayDomain(address: string, hostname: string, resolve = resolveGatewayEndpointAddress) {
  return (await resolveRemoteGatewayDomain(address, hostname, resolve)).hostname
}
export async function loadStableGatewayEndpoint(): Promise<StableGatewayEndpoint | null> {
  const config = await prisma.systemConfig.findUnique({ where: { key }, select: { value: true } })
  return config ? validateStableGatewayEndpoint(JSON.parse(config.value)) : null
}
export async function saveStableGatewayEndpoint(input: unknown): Promise<StableGatewayEndpoint> {
  const endpoint = validateStableGatewayEndpoint(input)
  await prisma.systemConfig.upsert({ where: { key }, create: { key, value: JSON.stringify(endpoint), type: 'json' }, update: { value: JSON.stringify(endpoint) } })
  return endpoint
}
export async function currentOnboardingGatewayEndpoint(): Promise<string> {
  const endpoint = await loadStableGatewayEndpoint()
  return endpoint ? stableGatewayEndpointText(endpoint) : process.env.ONBOARDING_WG_ENDPOINT || ''
}
