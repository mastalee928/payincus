import { prisma } from '../db/prisma.js'
import { lookup } from 'node:dns/promises'
import { isIPv4 } from 'node:net'
import { isOnboardingPublicIPv4, normalizeOnboardingAddress, OnboardingError } from '../lib/host-onboarding.js'
import { validateStableGatewayEndpoint, stableGatewayEndpointText, type StableGatewayEndpoint } from '../lib/onboarding-gateway-endpoint.js'
import { authorizeUserWrite, type WriteActor } from '../db/user-write-authorization.js'

const key = 'onboarding_gateway_dns_endpoint'
export interface GatewayEndpointPlan extends StableGatewayEndpoint {
  revision: number
  previous: Array<{ hostname: string; revision: number }>
  actor: number | null
}
function readPlan(raw: string): GatewayEndpointPlan {
  const row = JSON.parse(raw)
  const endpoint = validateStableGatewayEndpoint({ hostname: row.hostname, port: row.port })
  const revision = row.revision ?? 0
  if (!Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(row.previous ?? [])) throw new OnboardingError('GATEWAY_DNS_INVALID')
  const previous = (row.previous ?? []).map((item: { hostname: string; revision: number }) => {
    const hostname = validateStableGatewayEndpoint({ hostname: item.hostname, port: endpoint.port }).hostname
    if (!Number.isSafeInteger(item.revision) || item.revision < 0 || item.revision >= revision) throw new OnboardingError('GATEWAY_DNS_INVALID')
    return { hostname, revision: item.revision }
  })
  if (previous.length > 64 || new Set(previous.map((item: { revision: number }) => item.revision)).size !== previous.length) throw new OnboardingError('GATEWAY_DNS_INVALID')
  return { ...endpoint, revision, previous, actor: Number.isSafeInteger(row.actor) && row.actor > 0 ? row.actor : null }
}
export async function loadGatewayEndpointPlan(): Promise<GatewayEndpointPlan | null> {
  const config = await prisma.systemConfig.findUnique({ where: { key }, select: { value: true } })
  return config ? readPlan(config.value) : null
}
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
  const plan = await loadGatewayEndpointPlan()
  return plan ? { hostname: plan.hostname, port: plan.port } : null
}
export async function saveStableGatewayEndpoint(input: unknown, actor?: number, expectedHostname?: string, previousHostname?: string, session?: WriteActor): Promise<StableGatewayEndpoint> {
  const endpoint = validateStableGatewayEndpoint(input)
  await prisma.$transaction(async tx => {
    if (session && (session.id !== actor || !await authorizeUserWrite(tx, session.id, session) ||
        (await tx.user.findUnique({ where: { id: session.id }, select: { role: true } }))?.role !== 'admin')) {
      throw new OnboardingError('GATEWAY_WEB_SESSION_REQUIRED')
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('onboarding_gateway_dns_endpoint'))`
    const record = await tx.systemConfig.findUnique({ where: { key }, select: { value: true } })
    const old = record ? readPlan(record.value) : null
    if (expectedHostname !== undefined && (old?.hostname ?? '') !== expectedHostname) throw new OnboardingError('GATEWAY_DNS_SETTINGS_CONFLICT')
    if (old && old.port !== endpoint.port) throw new OnboardingError('GATEWAY_DNS_PORT_CONFLICT')
    const changed = !!old && old.hostname !== endpoint.hostname
    if (changed && old.previous.length >= 64) throw new OnboardingError('GATEWAY_DNS_HISTORY_LIMIT')
    const revision = old ? old.revision + (changed ? 1 : 0) : 1
    if (!Number.isSafeInteger(revision)) throw new OnboardingError('GATEWAY_DNS_INVALID')
    const seed = previousHostname && previousHostname !== endpoint.hostname ? validateStableGatewayEndpoint({ hostname: previousHostname, port: endpoint.port }).hostname : null
    const value = JSON.stringify({ ...endpoint, revision, previous: changed ? [...old.previous, { hostname: old.hostname, revision: old.revision }] : old?.previous ?? (seed ? [{ hostname: seed, revision: 0 }] : []), actor: actor ?? old?.actor ?? null })
    await tx.systemConfig.upsert({ where: { key }, create: { key, value, type: 'json' }, update: { value } })
  })
  return endpoint
}
export async function currentOnboardingGatewayEndpoint(): Promise<string> {
  const endpoint = await loadStableGatewayEndpoint()
  return endpoint ? stableGatewayEndpointText(endpoint) : process.env.ONBOARDING_WG_ENDPOINT || ''
}
