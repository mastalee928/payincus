import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { getJwtSigningSecret } from './security.js'
import type { WriteActor } from '../db/user-write-authorization.js'

export type CaddyScriptGrant = {
  version: 2; hostId: number; ownerId: number; actorId: number; role: string
  sid: string; iat: number; expiresAt: number; credentials: string
}

export function caddyCredentialDigest(host: { id: number; userId: number; caddyUsername: string | null; caddyPassword: string | null; caddyPort: number | null }): string {
  return createHash('sha256').update(JSON.stringify([host.id, host.userId, host.caddyUsername, host.caddyPassword, host.caddyPort || 8444])).digest('hex')
}

export function createCaddyScriptToken(grant: Omit<CaddyScriptGrant, 'version' | 'expiresAt'>): string {
  const payload = Buffer.from(JSON.stringify([2, grant.hostId, grant.ownerId, grant.actorId, grant.role,
    grant.sid, grant.iat, Date.now() + 30 * 60 * 1000, grant.credentials])).toString('base64url')
  const signature = createHmac('sha256', getJwtSigningSecret('Caddy script token signing')).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function verifyCaddyScriptToken(token: string): CaddyScriptGrant | null {
  if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null
  const [payload, signature] = token.split('.')
  const expected = createHmac('sha256', getJwtSigningSecret('Caddy script token verification')).update(payload).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!Array.isArray(data) || data.length !== 9) return null
    const [version, hostId, ownerId, actorId, role, sid, iat, expiresAt, credentials] = data
    const grant: CaddyScriptGrant = { version, hostId, ownerId, actorId, role, sid, iat, expiresAt, credentials }
    if (grant.version !== 2 ||
      ![grant.hostId, grant.ownerId, grant.actorId, grant.iat, grant.expiresAt].every(n => Number.isSafeInteger(n) && n > 0) ||
      !['admin', 'user'].includes(grant.role) || typeof grant.sid !== 'string' || !grant.sid || grant.sid.length > 256 ||
      typeof grant.credentials !== 'string' || !/^[a-f0-9]{64}$/.test(grant.credentials) ||
      grant.expiresAt <= Date.now() || grant.expiresAt > Date.now() + 30 * 60 * 1000) return null
    return grant
  } catch { return null }
}

export function caddyGrantActor(grant: CaddyScriptGrant): WriteActor {
  return { id: grant.actorId, sid: grant.sid, iat: grant.iat }
}
