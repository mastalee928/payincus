import { createHash } from 'node:crypto'
import { normalizeOnboardingAddress, isOnboardingPublicIPv4 } from './host-onboarding.js'
export class LocalGatewaySetupError extends Error {
  constructor(public readonly code: string) { super(code) }
}
export const SIMPLE_GATEWAY_PLAN_TTL = 300000
export function localGatewaySetupId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_INVALID')
  return value
}
export interface SimpleGatewayRequest {
  schemaVersion: 2; id: string; operation: 'prepare' | 'apply'; actorId: number; createdAt: number
  publicHost: string | null; approvedCredentialHash: string; approvedSessionId: string; planHash?: string
}
export function validateSimpleGatewayRequest(value: unknown, now = Date.now()): SimpleGatewayRequest {
  const bad = (): never => { throw new LocalGatewaySetupError('SIMPLE_GATEWAY_INVALID') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad()
  const row = value as Record<string, unknown>
  const fields = ['schemaVersion', 'id', 'operation', 'actorId', 'createdAt', 'publicHost',
    'approvedCredentialHash', 'approvedSessionId', ...(row.operation === 'apply' ? ['planHash'] : [])]
  if (Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field)) ||
    row.schemaVersion !== 2 || !['prepare', 'apply'].includes(String(row.operation)) ||
    !Number.isSafeInteger(row.actorId) || Number(row.actorId) < 1 || !Number.isSafeInteger(row.createdAt) ||
    Number(row.createdAt) > now + 5000 || now - Number(row.createdAt) > SIMPLE_GATEWAY_PLAN_TTL ||
    typeof row.approvedCredentialHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.approvedCredentialHash) ||
    typeof row.approvedSessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.approvedSessionId) ||
    (row.operation === 'apply' && (typeof row.planHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.planHash)))) return bad()
  localGatewaySetupId(row.id)
  if (row.publicHost !== null) {
    try { if (typeof row.publicHost !== 'string' || normalizeOnboardingAddress(row.publicHost) !== row.publicHost) return bad() } catch { return bad() }
  }
  return row as unknown as SimpleGatewayRequest
}
export function simpleGatewayPlanHash(request: SimpleGatewayRequest, observedStateHash: string, publicHost = request.publicHost) {
  const fields = { schemaVersion: request.schemaVersion, id: request.id, actorId: request.actorId,
    createdAt: request.createdAt, publicHost: request.publicHost,
    approvedCredentialHash: request.approvedCredentialHash, approvedSessionId: request.approvedSessionId }
  return createHash('sha256').update('payincus/local-controller-gateway/v2\n' + JSON.stringify(fields) + '\n' + observedStateHash + '\n' + publicHost).digest('hex')
}
export function detectedGatewayPublicIPv4(value: string) {
  const address = value.trim()
  if (!isOnboardingPublicIPv4(address)) throw new LocalGatewaySetupError('SIMPLE_GATEWAY_PUBLIC_ADDRESS_UNAVAILABLE')
  return address
}
