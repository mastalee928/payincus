import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/verification.ts'), 'utf8')
assert.equal(source.match(/await requireVerificationResourcePermission\(user, operationType, normalizedResource.resourceId, reply\)/g)?.length, 3,
  'request, verify and check must reject unauthorized resource targets before exemption, delivery or grant promotion')
const resourceAuthorization = readFileSync(resolve(__dirname, '../src/db/operation-verification-resource-authorization.ts'), 'utf8')
assert.ok(resourceAuthorization.includes('authorizeUserWrite(tx, actor.id, actor)') &&
  resourceAuthorization.includes("operationType === 'reinstall_instance' || operationType === 'recreate_instance'") &&
  resourceAuthorization.includes('return owner ?') && resourceAuthorization.includes('owner || admin || host.userId === actor.id') &&
  resourceAuthorization.includes('resourceId > 2147483647'),
  'resource verification permission must preserve owner-only reinstall/recreate, current administrator/host-owner scopes and database ID bounds')
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
  if (file === '../src/routes/users.ts') {
    const userDb = readFileSync(resolve(__dirname, '../src/db/users.ts'), 'utf8')
    const start = userDb.indexOf('export async function updateUserProfileIfCurrent(')
    const end = userDb.indexOf('export async function resetPasswordWithEmailVerification(', start)
    assert.ok(start >= 0 && end > start)
    const profile = userDb.slice(start, end)
    assert.ok(routeSource.includes('await db.updateUserProfileIfCurrent(profileState, updates, request.user, emailCode)') &&
      profile.includes('return prisma.$transaction(async tx => {') &&
      profile.includes('await tx.operationVerification.updateMany') &&
      profile.includes('data: { verifiedAt: null }') &&
      profile.includes('userId: actor.id, operationType, resourceId: null, verified: true') &&
      profile.includes('expiresAt: { gt: now }, verifiedAt: { gt: new Date(now.getTime() - 10 * 60000) }') &&
      profile.includes('if (!grant.count) throw new Error(`PROFILE_VERIFICATION_REQUIRED:${operationType}`)') &&
      profile.indexOf('await tx.operationVerification.updateMany') < profile.indexOf('await tx.user.updateMany'),
      'profile changes must consume a current verified account grant before the profile write in the same transaction')
  } else {
    assert.ok(routeSource.includes('claimOperationVerificationRequirement'),
      `${file} must atomically claim a verified operation record before sensitive side effects`)
  }
  assert.ok(
    !routeSource.includes('consumeOperationVerification'),
    `${file} must not consume operation verification records only after sensitive side effects`
  )
}

const adminPushSource = readFileSync(resolve(__dirname, '../src/services/admin-instance-push.ts'), 'utf8')
for (const { file, source: routeSource } of sensitiveOperationRouteSources.filter(item =>
  ['instances.ts', 'backups.ts', 'snapshots.ts', 'transfers.ts'].some(name => item.file.endsWith('/' + name)))) {
  assert.ok(/claimOperationVerificationRequirement\(userId, (?:operationType|'[^']+'), resourceId, actor\)/.test(routeSource),
    `${file} must pass the current authenticated actor when claiming a resource verification`)
}
const instanceRoutes = sensitiveOperationRouteSources.find(item => item.file.endsWith('/instances.ts'))!.source
assert.ok(instanceRoutes.includes('if (!isAdmin) {') && instanceRoutes.includes('claimDestroyEmailVerification(user, [instanceId], request.body?.emailCode)'),
  'direct administrator deletion skips only the administrator verification; customer deletion still claims verification')
assert.ok(instanceRoutes.includes('if (!isAdmin && isHostOwner && instance.user_id !== user.id)'),
  'direct administrator deletion must not refund the customer or debit the host owner')
assert.ok(adminPushSource.includes("claimOperationVerificationRequirement(actorId, 'transfer_instance', instanceId, session)") &&
  adminPushSource.indexOf('claimOperationVerificationRequirement(actorId') < adminPushSource.indexOf('await createTransferWithFee('),
  'admin PUSH must claim the administrator verification before creating a request or charging the original owner')

console.log('operation verification route guard tests passed')
