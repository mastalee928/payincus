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
  } finally { clearTimeout(timer) }
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
