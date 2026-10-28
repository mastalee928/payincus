import { Prisma } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { prisma } from './prisma.js'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'
import { caddyCredentialDigest, caddyGrantActor, type CaddyScriptGrant } from '../lib/caddy-script-token.js'

export type CaddyHostSnapshot = {
  id: number; userId: number; username: string | null; password: string | null; port: number | null
  ipAddress: string | null; natPublicIp: string | null
}

async function lockCaddyHost(tx: Prisma.TransactionClient, hostId: number, actor: WriteActor) {
  await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
  const host = await tx.host.findUnique({ where: { id: hostId } })
  if (!host) throw new Error('HOST_NOT_FOUND')
  if (!await authorizeUserWrite(tx, actor.id, actor)) throw new Error('CADDY_ACTOR_FORBIDDEN')
  const currentActor = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } })
  if (host.userId !== actor.id && currentActor?.role !== 'admin') throw new Error('CADDY_ACTOR_FORBIDDEN')
  return host
}

function sameCredentials(host: { userId: number; caddyUsername: string | null; caddyPassword: string | null; caddyPort: number | null; ipAddress: string | null; natPublicIp: string | null }, expected: CaddyHostSnapshot) {
  return host.userId === expected.userId && host.caddyUsername === expected.username &&
    host.caddyPassword === expected.password && host.caddyPort === expected.port &&
    host.ipAddress === expected.ipAddress && host.natPublicIp === expected.natPublicIp
}

export async function prepareHostCaddyCredentials(hostId: number, actor: WriteActor, reset = false) {
  return prisma.$transaction(async tx => {
    const host = await lockCaddyHost(tx, hostId, actor)
    const isNewCredentials = reset || !host.caddyUsername || !host.caddyPassword
    const username = isNewCredentials ? `caddy_${randomBytes(8).toString('hex')}` : host.caddyUsername!
    const password = isNewCredentials ? randomBytes(24).toString('base64url') : host.caddyPassword!
    const port = host.caddyPort || 8444
    if (isNewCredentials) await tx.host.update({ where: { id: hostId }, data: {
      caddyUsername: username, caddyPassword: password, caddyPort: port,
      ...(reset ? { caddyEnabled: false } : {})
    } })
    const currentRole = (await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { role: true } })).role
    return { host: { id: host.id, name: host.name }, username, password, port, isNewCredentials,
      scriptGrant: { hostId, ownerId: host.userId, actorId: actor.id, role: currentRole, sid: actor.sid!, iat: actor.iat!,
        credentials: caddyCredentialDigest({ ...host, caddyUsername: username, caddyPassword: password, caddyPort: port }) } }
  })
}

/** A download token cannot outlive its issuing session, ownership or credentials. */
export async function loadCaddyScriptCredentials(grant: CaddyScriptGrant): Promise<string> {
  return prisma.$transaction(async tx => {
    const host = await lockCaddyHost(tx, grant.hostId, caddyGrantActor(grant))
    const currentRole = (await tx.user.findUniqueOrThrow({ where: { id: grant.actorId }, select: { role: true } })).role
    if (grant.expiresAt <= Date.now() || host.userId !== grant.ownerId || currentRole !== grant.role ||
      caddyCredentialDigest(host) !== grant.credentials || !host.caddyPassword) throw new Error('CADDY_CONFIG_CHANGED')
    return host.caddyPassword
  })
}

export async function checkHostCaddyCredentials(expected: CaddyHostSnapshot, actor: WriteActor): Promise<void> {
  await prisma.$transaction(async tx => {
    const host = await lockCaddyHost(tx, expected.id, actor)
    if (!sameCredentials(host, expected)) throw new Error('CADDY_CONFIG_CHANGED')
  })
}

export async function confirmHostCaddyCredentials(expected: CaddyHostSnapshot, actor: WriteActor): Promise<void> {
  await prisma.$transaction(async tx => {
    const host = await lockCaddyHost(tx, expected.id, actor)
    if (!sameCredentials(host, expected)) throw new Error('CADDY_CONFIG_CHANGED')
    await tx.host.update({ where: { id: host.id }, data: { caddyEnabled: true } })
  })
}
