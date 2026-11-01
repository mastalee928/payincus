// Run the actual worker sections with isolated filesystem/OS/DB boundaries.
// These are failure-ordering checks, not a live database or systemd drill.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import { ensure } from '../src/services/platform-backup-core.js'

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

const armCode = section('      // Persistent across application', "      await update('stopping')")
for (const failure of process.argv.includes('--rollback-only') ? [] : ['journal-before', 'journal-after', 'hold-before', 'hold-after', 'none']) {
  const disk = new Map<string, unknown>()
  const arm = load<() => Promise<void>>(`return async () => { let preserve = false; ${armCode} }`, {
    directory: 'fixture-task', id: 'fixture-task', join,
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
}
if (!process.argv.includes('--rollback-only')) console.log('PASS hold/journal failures before and after rename retain a usable recovery journal')

const rollbackSource = section('async function rollbackJournal(', 'export async function runPlatformBackupTask(')
const directory = 'fixture-task', journalPath = join(directory, 'journal.json')
const gateway = '/etc/wireguard/incudal-mgmt.conf'
for (const interruption of ['files', 'gateway', 'health', 'legacy-interrupted']) {
  const disk = new Map<string, any>([[journalPath, {
    taskId: 'fixture', database: 'fixture_db', rollback: 'fixture_before', stage: 'files_switched', config: {},
    files: [{ target: gateway, saved: 'saved-gateway', mode: 0o600 }]
  }], ['hold', { taskId: 'fixture' }]])
  let file = interruption === 'legacy-interrupted' ? 'original-identity' : 'restored-identity'
  let live = 'restored-identity', liveNetwork = 'restored-network', fired = false, lastStage = ''
  const calls: string[] = []
  const refreshGateway = load<(previous: string, reconcileNetwork?: boolean) => Promise<void>>(
    gatewaySource.slice(gatewaySource.indexOf('const configPath =')).replace(/^export /gm, '') + '\nreturn refreshRestoredGateway', {
      join, ensure, isIP: () => 0, readFile: async () => file,
      mkdtemp: async () => 'fixture-gateway', writeFile: async () => {}, rm: async () => {},
      exec: async (_program: string, args: string[]) => {
        if (args[0] === 'restart') liveNetwork = 'original-network'
        if (args[0] === 'syncconf') {
          if (interruption === 'gateway' && !fired) { fired = true; throw new Error('injected gateway sync failure') }
          live = file
        }
        return { stdout: args[0] === 'is-active' ? 'active' : '' }
      }
    })
  const rollback = load<(directory: string) => Promise<boolean>>(rollbackSource + '\nreturn rollbackJournal', {
    join, readJson: async (path: string) => structuredClone(disk.get(path) ?? null),
    writeJson: async (path: string, value: any) => { disk.set(path, structuredClone(value)); if (path === journalPath) lastStage = value.stage },
    service: async (action: string) => { calls.push(action) }, quoteIdentifier: (name: string) => name,
    localDatabaseAdmin: async () => 'fixture_db', exec: async () => ({ stdout: '1000' }),
    readFile: async (path: string) => path === gateway ? file : 'ENCRYPTION_KEY=original',
    atomicFileCopy: async () => {
      file = 'original-identity'
      if (interruption === 'files' && !fired) { fired = true; throw new Error('injected file-directory-sync failure') }
    }, chmod: async () => {}, chown: async () => {}, unlink: async () => {},
    refreshRestoredGateway: refreshGateway, verifyControllerEnrollment: async () => {}, CONTROLLER_ROOT: '/controller',
    writeBackupConfig: async () => {}, statePath: (...parts: string[]) => join(...parts),
    process: { env: {} }, parseEnv: () => ({ ENCRYPTION_KEY: 'original' }), INSTALL: '/opt/incudal', holdPath: () => 'hold',
    protectedHealth: async () => {
      if (interruption === 'health' && !fired) { fired = true; throw new Error('injected protected start failure') }
    }
  })
  if (interruption !== 'legacy-interrupted') {
    await assert.rejects(rollback(directory), /injected/)
    assert.ok(fired && disk.has('hold'))
  }
  assert.equal(await rollback(directory), true)
  assert.equal(file, 'original-identity')
  assert.equal(live, 'original-identity', `${interruption}: retry must reconcile kernel state even when the old file was already restored`)
  assert.equal(liveNetwork, 'original-network', `${interruption}: address/MTU must be reconciled as well as WireGuard peers`)
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
      join, ensure, isIP: () => 0, readFile: async () => conf,
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
        return { stdout: args[0] === 'is-active' ? 'active' : args[0] === 'strip' ? '[Interface]\nPrivateKey = fixture\n' : '' }
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
