import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/verification.ts'), 'utf8')
const sensitiveOperationRouteFiles = [
  '../src/routes/auth.ts',
  '../src/routes/users.ts',
  '../src/routes/instances.ts',
  '../src/routes/backups.ts',
  '../src/routes/snapshots.ts',
  '../src/routes/transfers.ts'
] as const
const sensitiveOperationRouteSources = sensitiveOperationRouteFiles.map(file => ({
  file,
  source: readFileSync(resolve(__dirname, file), 'utf8')
}))

assert.ok(
  source.includes('const POSITIVE_RESOURCE_ID_PATTERN = /^[1-9]\\d*$/') &&
    source.includes('function parsePositiveResourceIdString(value: string): number | null') &&
    source.includes('function parsePositiveResourceIdNumber(value: unknown): number | null') &&
    source.includes('function normalizeResourceIdForOperation(') &&
    source.includes('return isResourceOperation(operationType)') &&
    source.includes('Number.isSafeInteger(value)'),
  'operation verification routes must use strict positive safe-integer resource ID parsing and preserve resource/account operation contracts'
)

assert.equal(
  source.match(/normalizeResourceIdForOperation\(operationType, resourceId\)/g)?.length ?? 0,
  3,
  'request, verify, and check routes must normalize operation resource IDs'
)

assert.equal(
  source.match(/code: 'INVALID_RESOURCE_ID'/g)?.length ?? 0,
  3,
  'operation verification routes must return a stable resource ID validation error'
)

assert.equal(
  source.match(/resourceId: \{ type: 'integer', minimum: 1 \}/g)?.length ?? 0,
  2,
  'request and verify schemas must reject non-integer body resource IDs before route logic'
)

for (const forbiddenPattern of [
  'parseInt(resourceId',
  'Number(resourceId',
  'resourceId ? parseInt',
  'resourceId || null'
] as const) {
  assert.ok(
    !source.includes(forbiddenPattern),
    `operation verification routes must not use loose resource ID handling: ${forbiddenPattern}`
  )
}

assert.ok(
  source.includes('Resource ID is required for this operation') &&
    source.includes('Resource ID is not allowed for this operation'),
  'operation verification routes must distinguish resource and account operation ID contracts'
)

for (const { file, source: routeSource } of sensitiveOperationRouteSources) {
  assert.ok(
    routeSource.includes('claimOperationVerificationRequirement'),
    `${file} must atomically claim a verified operation record before sensitive side effects`
  )
  assert.ok(
    !routeSource.includes('consumeOperationVerification'),
    `${file} must not consume operation verification records only after sensitive side effects`
  )
}

const adminPushSource = readFileSync(resolve(__dirname, '../src/services/admin-instance-push.ts'), 'utf8')
const instanceRoutes = sensitiveOperationRouteSources.find(item => item.file.endsWith('/instances.ts'))!.source
assert.ok(instanceRoutes.includes("if (!isAdmin && !await requireVerifiedOperation(reply, user.id, 'delete_instance', instanceId)) return"),
  'direct administrator deletion skips only the administrator verification; customer deletion still claims verification')
assert.ok(instanceRoutes.includes('if (!isAdmin && isHostOwner && instance.user_id !== user.id)'),
  'direct administrator deletion must not refund the customer or debit the host owner')
assert.ok(adminPushSource.includes("claimOperationVerificationRequirement(actorId, 'transfer_instance', instanceId)") &&
  adminPushSource.indexOf('claimOperationVerificationRequirement(actorId') < adminPushSource.indexOf('await createTransferWithFee('),
  'admin PUSH must claim the administrator verification before creating a request or charging the original owner')

console.log('operation verification route guard tests passed')
