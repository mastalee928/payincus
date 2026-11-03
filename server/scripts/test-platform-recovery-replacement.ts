import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-ignore bcryptjs follows the runtime auth import.
import bcrypt from 'bcryptjs'

const url=new URL(process.env.DATABASE_URL||'')
assert.ok(url.hostname==='127.0.0.1' && url.port!=='5432' && url.pathname.endsWith('_recovery_test'),'Dedicated disposable recovery database required')
process.env.NODE_ENV='test';process.env.JWT_SECRET='recovery-isolated-controller-key';process.env.ENCRYPTION_KEY='recovery-isolated-encryption-key'
const folder=await mkdtemp(join(tmpdir(),'incudal-recovery-instance-'));process.env.PLATFORM_BACKUP_STATE_DIR=folder
const {prisma,closePrismaDatabase}=await import('../src/db/prisma.js')
const core=await import('../src/services/platform-backup-core.js')
const operator=await import('../src/services/platform-recovery-operator.js')
const registration=await import('../src/services/platform-recovery-registration.js')
const password='isolated-recovery-operator',batchId=randomUUID()
try {
  await core.initBackupState()
  const original=await prisma.user.create({data:{username:'admin',role:'admin',passwordHash:await bcrypt.hash(password,4)}})
  await operator.captureRecoveryOperator(original.id,batchId)
  await prisma.user.update({where:{id:original.id},data:{passwordHash:await bcrypt.hash('obsolete-snapshot-password',4),status:'banned'}})
  const actorId=await operator.installRecoveryOperator(batchId,batchId,'restore')
  await core.writeJson(join(folder,'recovery-hold.json'),{taskId:batchId,batchId,mode:'restore',createdAt:new Date(Date.now()-1000).toISOString(),
    snapshot:{createdAt:new Date(Date.now()-86400000).toISOString(),version:'1.8.0'}})
  const account=await registration.registerRecoveryAccount({id:randomUUID(),reference:'original-account-proof',evidenceHash:'8'.repeat(64),
    observedAt:new Date().toISOString(),originalId:actorId,username:'restored-original-account',createdAt:new Date(Date.now()-10000).toISOString()},actorId,{password})
  assert.notEqual(account.userId,actorId)
  const {checkRecoveryReplacement}=await import('./fixtures/recovery-replacement.js')
  await checkRecoveryReplacement(batchId,actorId,password)
  console.log('PASS isolated recovery instance/order fixture complete')
} finally {
  await closePrismaDatabase()
  assert.ok(folder.startsWith(join(tmpdir(),'incudal-recovery-instance-')))
  await rm(folder,{recursive:true,force:true})
}
process.exit(0)
