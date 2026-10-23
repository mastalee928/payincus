import { isIPv4 } from 'node:net'
import { normalizeOnboardingAddress, OnboardingError } from './host-onboarding.js'

export interface StableGatewayEndpoint { hostname: string; port: number }
export function validateStableGatewayEndpoint(input: unknown): StableGatewayEndpoint {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OnboardingError('GATEWAY_DNS_INVALID')
  const value = input as Record<string, unknown>
  if (Object.keys(value).sort().join(',') !== 'hostname,port' || typeof value.hostname !== 'string' ||
      !Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535) throw new OnboardingError('GATEWAY_DNS_INVALID')
  const hostname = normalizeOnboardingAddress(value.hostname)
  if (isIPv4(hostname)) throw new OnboardingError('GATEWAY_DNS_REQUIRED')
  return { hostname, port: Number(value.port) }
}
export const stableGatewayEndpointText = (value: StableGatewayEndpoint) => `${value.hostname}:${value.port}`
