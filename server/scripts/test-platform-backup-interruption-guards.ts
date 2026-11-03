// Run the actual worker sections with isolated filesystem/OS/DB boundaries.
// These are failure-ordering checks, not a live database or systemd drill.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import { ensure, statePath } from '../src/services/platform-backup-core.js'
import { validateRestoreJournal, rollbackDatabasePlan } from '../src/services/platform-recovery-restore-journal.js'
import { verifyRecoveryOneshotExit } from './fixtures/recovery-oneshot.js'

await verifyRecoveryOneshotExit()

const source = await readFile(new URL('../src/services/platform-backup-worker.ts', import.meta.url), 'utf8')
const gatewaySource = await readFile(new URL('../src/services/platform-backup-gateway.ts', import.meta.url), 'utf8')
function section(startText: string, endText: string) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `worker section must exist: ${startText}`)
  return source.slice(start, end)
}
function load<T>(code: string, bindings: Record<string, unknown>): T {
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  return new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) as T
}

// Root proof of an empty-target rollback must survive a lost DB/write/unlink
// response. It never clears another hold or accepts a missing rollback batch.
for(const point of ['database','receipt','unlink','missing-batch','occupied','wrong-hold','none']) {
  const id=randomUUID(),batch=randomUUID(),directory=statePath('private',id),holdFile='fixture-hold',resultFile=statePath('results',id+'.json')
  const journal={taskId:id,snapshotAt:'2026-11-03T00:00:00Z',emptyTarget:true,stage:'rolled_back_review',rollbackBatchId:batch}
  const disk=new Map<string,any>([[join(directory,'journal.json'),journal],[holdFile,{taskId:point==='wrong-hold'?randomUUID():id,batchId:batch,mode:'rollback'}],
    [resultFile,{id,kind:'restore',status:'failed',error:'OSS_DATABASE_UNAVAILABLE'}]])
  let fail=true,dbComplete=false,proofChecks=0
  const finish=load<(directory:string)=>Promise<void>>(section('export async function finishEmptyRecoveryRollback(', 'export async function readWorkerRequest(').replace('export ','')+'\nreturn finishEmptyRecoveryRollback',{
    join,statePath,ensure,readJson:async(path:string)=>structuredClone(disk.get(path)),holdPath:()=>holdFile,
    validateRestoreJournal:()=>{},assertRestoreStartIdentity:async()=>{proofChecks++},emptyRecoveryTarget:async()=>point!=='occupied',protectedHealth:async()=>{},
    pgQuery:async(_sql:string,args:string[])=>{assert.deepEqual(args,[batch,id]);dbComplete=true;if(fail&&point==='database')throw Error('injected');return point==='missing-batch'?[]:[{id:batch}]},
    writeJson:async(path:string,value:unknown)=>{disk.set(path,value);if(fail&&point==='receipt')throw Error('injected')},
    durableUnlink:async(path:string)=>{disk.delete(path);if(fail&&point==='unlink')throw Error('injected')}
  })
  if(point==='none')await finish(directory)
  else await assert.rejects(finish(directory))
  if(['missing-batch','occupied','wrong-hold'].includes(point)) {
    assert.ok(disk.has(holdFile));assert.equal(disk.get(resultFile).rollbackVerified,undefined)
    if(point!=='missing-batch')assert.equal(dbComplete,false)
  }else {
    if(disk.has(holdFile)){fail=false;await finish(directory)}
    assert.equal(disk.has(holdFile),false)
    assert.equal(disk.get(resultFile).rollbackVerified,true);assert.ok(dbComplete);assert.ok(proofChecks>0)
    // If unlink succeeded but its reply was lost, the durable proof still
    // exists for the normal dispatcher; no import or refund is repeated.
    assert.equal(disk.get(resultFile).error,'OSS_DATABASE_UNAVAILABLE')
  }
}
console.log('PASS empty-target rollback root proof, lost responses, missing batch and protected hold identity')

// Root acceptance precedes request consumption. Only this receipt proves that
// the business worker has not crossed its first write boundary.
for(const point of ['receipt-before','receipt-after','consume','none']) {
  const id=randomUUID(),request={id,kind:'restore',createdBy:1,createdAt:new Date().toISOString()}
  const inbox=statePath('inbox',`${id}.json`),resultPath=statePath('results',`${id}.json`)
  const disk=new Map<string,any>([[inbox,request]])
  const accept=load<(id:string)=>Promise<unknown>>(source.slice(source.indexOf('export async function readWorkerRequest(')).replace('export ','')+'\nreturn readWorkerRequest',{
    statePath,validateId:(value:string)=>value,ensure,existsSync:(path:string)=>disk.has(path),
    readJson:async(path:string)=>disk.get(path),
    writeJson:async(path:string,value:unknown)=>{if(point==='receipt-before')throw new Error('injected');disk.set(path,value);if(point==='receipt-after')throw new Error('injected')},
    unlink:async(path:string)=>{if(point==='consume')throw new Error('injected');disk.delete(path)}
  })
  if(point==='none')assert.deepEqual(await accept(id),request);else await assert.rejects(accept(id),/injected/)
  assert.ok(disk.has(inbox) || disk.get(resultPath)?.restoreNotStarted===true)
  if(disk.has(resultPath)) {
    assert.equal(disk.get(resultPath).stage,'accepted')
    await assert.rejects(accept(id),/TASK_(ID_CONFLICT|INVALID)/,'an accepted task is not executed twice')
  }
}
console.log('PASS root acceptance/consumption interruptions preserve non-start proof and reject duplicate execution')

const armCode = section('      // Persistent across application', "      await update('stopping')")
for (const failure of process.argv.includes('--rollback-only') ? [] : ['journal-before', 'journal-after', 'hold-before', 'hold-after', 'none']) {
  const disk = new Map<string, unknown>()
  const arm = load<() => Promise<void>>(`return async () => { let preserve = false; ${armCode} }`, {
    directory: 'fixture-task', id: 'fixture-task', join, files:new Map(), request:{restorePolicy:'snapshot-v1'}, backupGatewayBaseline:async()=>null,
    journal: { stage: 'prepared', files: [] }, plan: { manifest: { createdAt: '2026-10-01', version: '1.7.1' } },
    holdPath: () => 'hold', writeJson: async (path: string, value: unknown) => {
      const kind = path === 'hold' ? 'hold' : 'journal'
      if (failure === kind + '-before') throw new Error('injected write failure')
      disk.set(path, structuredClone(value))
      if (failure === kind + '-after') throw new Error('injected directory sync failure after rename')
    }
  })
  if (failure === 'none') await arm(); else await assert.rejects(arm(), /injected/)
  assert.ok(!disk.has('hold') || disk.has(join('fixture-task', 'journal.json')),
    `${failure}: a durable recovery hold must always have a durable rollback journal`)
  if(disk.has('hold'))assert.equal((disk.get('hold') as any).restorePolicy,'snapshot-v1')
}
if (!process.argv.includes('--rollback-only')) console.log('PASS hold/journal failures before and after rename retain a usable recovery journal')

const rollbackSource = section('async function rollbackJournal(', 'export async function runPlatformBackupTask(')
const restoreId = randomUUID(), rollbackBatchId = randomUUID()
const directory = statePath('private', restoreId), journalPath = join(directory, 'journal.json')
const gateway = '/etc/wireguard/incudal-mgmt.conf'
for (const interruption of ['files', 'gateway', 'health', 'legacy-interrupted', 'fresh-b']) {
  const disk = new Map<string, any>([[journalPath, {
    version:2, workerPid:123, rollbackBatchId, originalOid:10, restoredOid:20,
    taskId: restoreId, database: 'fixture_db', staging:`incudal_restore_${restoreId.replace(/-/g,'')}`,
    rollback: `incudal_before_${restoreId.replace(/-/g,'')}`, stage: 'files_switched', config: {},
    files: [{ target: gateway, saved: interruption==='fresh-b'?null:join(directory,'before-0'), mode: 0o600 }]
  }], ['hold', { taskId: restoreId, batchId:restoreId }]])
  let file = interruption === 'legacy-interrupted' ? '[Interface]\nAddress = 10.253.240.1/20\nPrivateKey = original-identity' : '[Interface]\nAddress = 10.253.240.1/20\nPrivateKey = restored-identity'
  let live = 'restored-identity', liveNetwork = 'restored-network', fired = false, lastStage = ''
  const calls: string[] = []
  const refreshGateway = load<(previous: string, reconcileNetwork?: boolean) => Promise<void>>(
    gatewaySource.slice(gatewaySource.indexOf('const configPath =')).replace(/^export /gm, '') + '\nreturn refreshRestoredGateway', {
      join, ensure, isIP, readFile: async () => file,
      mkdtemp: async () => 'fixture-gateway', writeFile: async () => {}, rm: async () => {},
      exec: async (_program: string, args: string[]) => {
        if (args[0] === 'restart') liveNetwork = 'original-network'
        if (args[0] === 'syncconf') {
          if (interruption === 'gateway' && !fired) { fired = true; throw new Error('injected gateway sync failure') }
          live = file
        }
        return { stdout: args[0] === '-j' ? '[]' : args[0] === 'is-active' ? 'active' : '' }
      }
    })
  const rollback = load<(directory: string) => Promise<boolean>>(rollbackSource + '\nreturn rollbackJournal', {
    randomUUID, validateRestoreJournal, rollbackDatabasePlan, ensure, existsSync:()=>true, hashFile:async()=>'a'.repeat(64),
    lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>false}),
    installRecoveryOperator: async () => {}, backupRoot: () => 'fixture-root',
    join, readJson: async (path: string) => structuredClone(disk.get(path) ?? null),
    writeJson: async (path: string, value: any) => { disk.set(path, structuredClone(value)); if (path === journalPath) lastStage = value.stage },
    service: async (action: string) => { calls.push(action) }, quoteIdentifier: (name: string) => name,
    localDatabaseAdmin: async () => JSON.stringify([{name:'fixture_db',oid:10}]), exec: async (_program:string,args:string[]) => {
      if(args[0]==='stop'){calls.push('stop-created-gateway');live='';liveNetwork=''}
      return {stdout:args[0]==='-j'?'[]':'1000'}
    },
    readFile: async (path: string) => path === gateway ? file : 'ENCRYPTION_KEY=original',
    atomicFileCopy: async () => {
      file = '[Interface]\nAddress = 10.253.240.1/20\nPrivateKey = original-identity'
      if (interruption === 'files' && !fired) { fired = true; throw new Error('injected file-directory-sync failure') }
    }, chmod: async () => {}, chown: async () => {}, unlink: async (path:string) => {if(path===gateway){assert.ok(calls.includes('stop-created-gateway'));file=''}},
    refreshRestoredGateway: refreshGateway, verifyControllerEnrollment: async () => {}, CONTROLLER_ROOT: '/controller',
    writeBackupConfig: async () => {}, statePath: (...parts: string[]) => join(...parts),
    process: { env: {} }, parseEnv: () => ({ ENCRYPTION_KEY: 'original' }), INSTALL: '/opt/incudal', holdPath: () => 'hold',
    protectedHealth: async () => {
      if (interruption === 'health' && !fired) { fired = true; throw new Error('injected protected start failure') }
    }
  })
  if (!['legacy-interrupted','fresh-b'].includes(interruption)) {
    await assert.rejects(rollback(directory), /injected/)
    assert.ok(fired && disk.has('hold'))
  }
  assert.equal(await rollback(directory), true)
  if(interruption==='fresh-b'){
    assert.equal(file,'');assert.equal(live,'');assert.equal(liveNetwork,'')
    assert.equal(await rollback(directory),true,'replaying fresh-B rollback must not recreate a gateway')
  } else {
  assert.ok(file.endsWith('original-identity'))
  assert.equal(live, file, `${interruption}: retry must reconcile kernel state even when the old file was already restored`)
  assert.equal(liveNetwork, 'original-network', `${interruption}: address/MTU must be reconciled as well as WireGuard peers`)
  }
  assert.equal(lastStage, 'rolled_back_review')
  assert.ok(calls.includes('start') && disk.has('hold'), 'rollback restarts protected, never resumes business')
}
console.log('PASS interrupted file/gateway/health rollback retries converge the original identity and retain the recovery hold')

// Ubuntu confines both wg-quick and wg config reads to /etc/wireguard.
// Exercise the actual helper through that filesystem boundary, including a
// parser failure before the live interface may be restarted.
for (const parseFailure of [false, true]) {
  const events: string[] = []
  const files = new Map<string, string>()
  const conf = '[Interface]\nPrivateKey = fixture\nAddress = 10.253.240.1/20\nListenPort = 51820\n'
  const refresh = load<(previous: string, reconcileNetwork: boolean) => Promise<void>>(
    gatewaySource.slice(gatewaySource.indexOf('const configPath =')).replace(/^export /gm, '') + '\nreturn refreshRestoredGateway', {
      join, ensure, isIP, readFile: async () => conf,
      mkdtemp: async (prefix: string) => prefix + 'fixture',
      writeFile: async (path: string, content: string, options: { mode: number }) => {
        assert.equal(options.mode, 0o600, 'temporary identities must remain private')
        files.set(path, content)
      },
      rm: async () => { events.push('cleanup') },
      exec: async (program: string, args: string[]) => {
        events.push(args[0])
        if (args[0] === 'strip' || args[0] === 'syncconf') {
          const path = args[args.length - 1]
          assert.ok(path.replaceAll('\\', '/').startsWith('/etc/wireguard/.incudal-restore-'), `${program}: configuration must stay inside the confined WireGuard directory`)
          assert.ok(files.has(path))
          if (args[0] === 'strip' && parseFailure) throw new Error('injected parser refusal')
        }
        return { stdout: args[0] === '-j' ? '[]' : args[0] === 'is-active' ? 'active' : args[0] === 'strip' ? '[Interface]\nPrivateKey = fixture\n' : '' }
      }
    })
  if (parseFailure) {
    await assert.rejects(refresh(conf, true), /injected parser refusal/)
    assert.ok(!events.includes('restart') && !events.includes('syncconf'), 'a parser refusal must precede any live network changes')
  } else {
    await refresh(conf, true)
    assert.ok(events.indexOf('strip') < events.indexOf('restart') && events.includes('syncconf'))
  }
  assert.equal(events.at(-1), 'cleanup')
}
console.log('PASS confined private gateway files, parser-before-restart ordering and cleanup')
