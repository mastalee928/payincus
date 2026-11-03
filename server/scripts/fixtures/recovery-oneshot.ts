import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'

// Execute the real CLI body in a child that deliberately owns a referenced
// timer. Only OS/DB work is replaced; completion and cleanup must be awaited.
export async function verifyRecoveryOneshotExit() {
  for (const name of ['run-platform-backup-task', 'run-platform-recovery-startup', 'run-platform-recovery-supervisor', 'platform-backup-cli']) {
    const source = await readFile(new URL(`../../src/scripts/${name}.ts`, import.meta.url), 'utf8')
    const body = ts.transpileModule(source.replace(/^import .*$/gm, ''), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
    }).outputText
    for (const mode of ['success', 'failure', 'cleanup-failure']) {
      const harness = `
        setInterval(()=>{},1000);
        Object.defineProperty(process,'platform',{value:'linux'});process.getuid=()=>0;process.env.NODE_ENV='production';process.argv[2]='status';
        const work=async()=>{await new Promise(r=>setTimeout(r,10));process.stdout.write('work\\n');if(${JSON.stringify(mode)}==='failure')throw new Error('fixture');};
        const ensure=value=>{if(!value)throw new Error('fixture precondition');},taskResults=async()=>{await work();return [];};
        const readWorkerRequest=async()=>({});
        const runPlatformBackupTask=work,superviseRecovery=work,recoverInterruptedMapping=work;
        const recoverInterruptedActivation=async()=>{},assertRestoreStartupSafe=async()=>{};
        const closePrismaDatabase=async()=>{await new Promise(r=>setTimeout(r,10));process.stdout.write('closed\\n');if(${JSON.stringify(mode)}==='cleanup-failure')throw new Error('cleanup');};
      `
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', harness + body], { encoding: 'utf8', timeout: 5000, windowsHide: true })
      assert.ifError(result.error)
      assert.equal(result.signal, null, `${name} ${mode}: must exit without timeout`)
      assert.equal(result.status, mode === 'success' ? 0 : 1, `${name} ${mode}`)
      const statusOutput = name === 'platform-backup-cli' && mode !== 'failure' ? '[]\n' : ''
      assert.equal(result.stdout, `work\n${statusOutput}closed\n`, `${name}: finish work and cleanup before exit`)
    }
  }
  console.log('PASS recovery oneshots: task/startup/supervisor/CLI exit after awaited work and DB cleanup; failure exits nonzero despite referenced imported timers')
}
