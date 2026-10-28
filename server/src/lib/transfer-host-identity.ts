import { createHash } from 'node:crypto'
import type { Host } from '@prisma/client'

export function transferHostIdentity(host: Host): string {
  return createHash('sha256').update(JSON.stringify([host.id, host.userId, host.url,
    host.certPath, host.keyPath, host.serverCertificate, host.serverFingerprint])).digest('hex')
}
