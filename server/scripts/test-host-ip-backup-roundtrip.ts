import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from 'pg'
import { encryptBackup, decryptBackup, hashFile } from '../src/services/platform-backup-archive.js'
const exec = promisify(execFile), url = new URL(process.env.DATABASE_URL || '')
assert.equal(url.hostname, '127.0.0.1');assert.equal(url.port, '55453');assert.ok(url.pathname.endsWith('_pool_test'))
const toolRoot = process.env.HOST_IP_PG_TOOLS;assert.ok(toolRoot, 'Supply the existing local PG tools directory')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const id = randomUUID(), prefix = 'ip-backup-' + id, database = 'ip_roundtrip_' + id.replaceAll('-', '')
const dir = resolve('..', 'logs', 'host-ip-fix-backup-roundtrip', id);await mkdir(dir,{recursive:true})
const adminUrl = new URL(url);adminUrl.pathname='/postgres';const admin = new Client({connectionString:adminUrl.href});await admin.connect()
const env = {...process.env, PGHOST:url.hostname, PGPORT:url.port, PGUSER:decodeURIComponent(url.username), PGCONNECT_TIMEOUT:'10'}
const actor = await prisma.user.create({data:{username:prefix,role:'admin',passwordHash:'fixture-only'}})
const batch = await prisma.hostOnboardingBatch.create({data:{id,createdById:actor.id,name:prefix,accountLabel:'isolated',defaults:{}}})
let target:Client|undefined, created=false
try {
 const host = await prisma.host.create({data:{userId:actor.id,name:prefix,url:'https://10.253.241.1:8443',natPublicIp:'4.2.2.8',natBindIp:'10.0.0.13', singleTenant:true,
  publicIpSync:{observedIp:'4.2.2.9',status:'pending',error:'IP_SSH_UNREACHABLE',retryAttempts:3,nextCheckAt:'2030-01-01T00:00:00Z'},publicIpSyncBlocked:true,
  onboardingNode:{create:{batchId:batch.id,name:prefix,publicIp:'4.2.2.7',status:'succeeded',deletedAt:new Date(),credentialsExpireAt:new Date(0)}}},include:{onboardingNode:true}})
 const task = await prisma.hostOnboardingNode.create({data:{batchId:batch.id,name:prefix+'-new',publicIp:'4.2.2.7',status:'queued',credentialsExpireAt:new Date(0)}})
 const hidden = await prisma.hostOnboardingNode.create({data:{batchId:batch.id,name:prefix+'-deleted',publicIp:'4.2.2.6',status:'failed',deletedAt:new Date(),credentialsExpireAt:new Date(0)}})
 const secondHost = await prisma.host.create({data:{userId:actor.id,name:prefix+'-second',url:'https://10.253.241.2:8443',natPublicIp:'4.2.2.4',singleTenant:true,
  onboardingNode:{create:{batchId:batch.id,name:prefix+'-second',publicIp:'4.2.2.5',status:'succeeded',credentialsExpireAt:new Date(0)}}}})
 const dump=join(dir,'database.dump'), runtime=join(dir,'runtime.env'), encrypted=join(dir,'fixture.picbkp'), metadata={format:1 as const,id,installationId:randomUUID(),version:'1.8.1',createdAt:new Date().toISOString(),migrationHash:'a'.repeat(64),postgresMajor:16,databaseBytes:10000000}
 await exec(join(toolRoot,'pg_dump.exe'),['--format=custom','--create','--large-objects','--file',dump,'--dbname',url.pathname.slice(1)],{env,maxBuffer:1000000})
 await writeFile(runtime,'FIXTURE_ISOLATED=true\n')
 await encryptBackup([{name:'database.dump',path:dump},{name:'runtime.env',path:runtime}],metadata,'isolated-fixture-password',encrypted)
 const decoded=await decryptBackup(encrypted,'isolated-fixture-password',join(dir,id))
 assert.equal(await hashFile(decoded.files.get('database.dump')!),await hashFile(dump))
 await admin.query('CREATE DATABASE "'+database+'" OWNER ip_review TEMPLATE template0');created=true
 await exec(join(toolRoot,'pg_restore.exe'),['--dbname',database,'--no-owner','--no-privileges','--exit-on-error','--single-transaction',decoded.files.get('database.dump')!],{env,maxBuffer:1000000})
 const targetUrl=new URL(url);targetUrl.pathname='/'+database;target=new Client({connectionString:targetUrl.href});await target.connect()
 const nodeRows=async()=> (await target!.query('SELECT id,public_ip,active_public_ip,host_id,status,deleted_at,identity_reset,peer_retirement FROM host_onboarding_nodes WHERE batch_id=$1 ORDER BY id',[batch.id])).rows
 const restored=await nodeRows()
 const restoredSync=(await target.query('SELECT public_ip_sync,public_ip_sync_blocked FROM hosts WHERE id=$1',[host.id])).rows[0]
 assert.deepEqual(restoredSync.public_ip_sync,{observedIp:'4.2.2.9',status:'pending',error:'IP_SSH_UNREACHABLE',retryAttempts:3,nextCheckAt:'2030-01-01T00:00:00Z'})
 assert.equal(restoredSync.public_ip_sync_blocked,true,'restore preserves retry deadline and unverified-address protection')
 assert.equal(restored.find(n=>n.id===host.onboardingNode!.id).active_public_ip,'4.2.2.8','hidden attached task still owns confirmed current address')
 assert.equal(restored.find(n=>n.id===task.id).active_public_ip,'4.2.2.7','historical input can be reused by new task')
 assert.equal(restored.find(n=>n.id===hidden.id).active_public_ip,null,'deleted unprovisioned task has no effective reservation')
 await target.query('UPDATE hosts SET nat_public_ip=$1 WHERE id=$2',['4.2.2.10',host.id])
 assert.equal((await nodeRows()).find(n=>n.id===host.onboardingNode!.id).active_public_ip,'4.2.2.10','restored trigger follows next IP change')
 await assert.rejects(target.query('UPDATE host_onboarding_nodes SET public_ip=$1 WHERE id=$2',['4.2.2.10',task.id]),(error:any)=>error.code==='23505')
 await target.query('UPDATE host_onboarding_nodes SET deleted_at=NOW() WHERE id=$1',[task.id])
 assert.equal((await nodeRows()).find(n=>n.id===task.id).active_public_ip,null)
 // Rebuild the 239-migration schema shape, then apply the trusted migration.
 await target.query('DELETE FROM host_onboarding_nodes WHERE id=$1',[task.id])
 await target.query('DROP TRIGGER host_current_public_ip ON hosts; DROP FUNCTION propagate_host_public_ip(); DROP TRIGGER onboarding_active_public_ip ON host_onboarding_nodes; DROP FUNCTION maintain_onboarding_active_public_ip(); ALTER TABLE host_onboarding_nodes DROP COLUMN active_public_ip; DROP INDEX host_onboarding_nodes_public_ip_updated_at_idx; CREATE UNIQUE INDEX host_onboarding_nodes_public_ip_key ON host_onboarding_nodes(public_ip)')
 const migration=await readFile(new URL('../prisma/migrations/202611040002_host_current_public_ip/migration.sql',import.meta.url),'utf8')
 await target.query('UPDATE hosts SET nat_public_ip=$1 WHERE id=$2',['4.2.2.10',secondHost.id])
 await assert.rejects(target.query(migration),(error:any)=>error.code==='23505','conflicting effective IP ownership must reject the whole migration')
 await target.query('ROLLBACK')
 assert.equal((await target.query("SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_name='host_onboarding_nodes' AND column_name='active_public_ip'")).rows[0].count,0,'failed migration leaves the old schema intact')
 assert.ok((await target.query("SELECT to_regclass('host_onboarding_nodes_public_ip_key') AS original_index")).rows[0].original_index,'failed migration preserves original unique index')
 assert.equal((await target.query('SELECT nat_public_ip FROM hosts WHERE id=$1',[host.id])).rows[0].nat_public_ip,'4.2.2.10','migration failure does not alter current host address')
 await target.query('UPDATE hosts SET nat_public_ip=$1 WHERE id=$2',['4.2.2.4',secondHost.id])
 await target.query(migration)
 assert.equal((await nodeRows()).find(n=>n.id===host.onboardingNode!.id).active_public_ip,'4.2.2.10','old backup backfill uses current Host, not original input')
 assert.equal((await nodeRows()).find(n=>n.id===hidden.id).active_public_ip,null)
 // Confirm ON DELETE SET NULL releases a hidden historical task atomically.
 await target.query('DELETE FROM hosts WHERE id=$1',[host.id])
 assert.equal((await nodeRows()).find(n=>n.id===host.onboardingNode!.id).active_public_ip,null)
 await writeFile(join(dir,'verified.json'),JSON.stringify({verifiedAt:new Date().toISOString(),encryptedDumpHash:await hashFile(encrypted),restoredCustomDump:true,oldMigrationBackfill:true,conflictingMigrationAtomicRollback:true,activeUnique:true,hiddenAttachedReserved:true,deletedReleased:true,productionAccess:false},null,2))
 console.log('PASS real pg_dump -> authenticated archive -> decrypt -> pg_restore: current/history effective index, hidden attached task, duplicate rejection, future update and deletion; old 239 schema migration backfill. Local isolated database; OSS transport not exercised.')
}finally{
 await target?.end();if(created)await admin.query('DROP DATABASE "'+database+'"');await admin.end()
 await prisma.host.deleteMany({where:{userId:actor.id}});await prisma.hostOnboardingBatch.delete({where:{id:batch.id}});await prisma.user.delete({where:{id:actor.id}});await closePrismaDatabase()
}
