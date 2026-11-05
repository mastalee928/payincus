import '../config/env.js'
import { maintainAlpineCustomerSsh } from '../services/alpine-ssh-maintenance.js'
import { closePrismaDatabase } from '../db/prisma.js'

// Root/operator fallback only. Nothing runs on backend startup or normal OTA.
const actorId = Number(process.argv[2])
const ids = process.argv.slice(3).map(Number)
if (!Number.isSafeInteger(actorId) || actorId <= 0 || !ids.length || ids.length > 20 ||
  new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647)) {
  console.error('Usage: maintain-alpine-ssh <active-admin-id> <instance-id> [...up to 20 ids]')
  process.exit(1)
}
try {
  for (const id of ids) {
    console.log(JSON.stringify(await maintainAlpineCustomerSsh(id, actorId)))
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'ALPINE_SSH_MAINTENANCE_FAILED')
  process.exitCode = 1
} finally { await closePrismaDatabase() }
// The standalone maintenance process owns no long-running workers.
process.exit(process.exitCode || 0)
