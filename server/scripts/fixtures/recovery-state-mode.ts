import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import { writeJson } from '../../src/services/platform-backup-core.js'

export async function verifyRecoveryStateMode(workspace: string) {
  const source = await readFile(new URL('../../src/services/platform-backup-core.ts', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('export async function writeJson('), source.indexOf('export async function initBackupState('))
  assert.ok(body.includes('async function writeJson('))
  const compiled = ts.transpileModule(body.replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  for (const mask of [0o027, 0o077, 0o777]) for (const mode of [0o600, 0o640]) {
    let actual = mode & ~mask, group = -1, content = '', durable = false
    const file = { chown: async (_uid: number, gid: number) => { group = gid }, writeFile: async (value: string) => { content = value },
      chmod: async (value: number) => { actual = value }, sync: async () => { durable = true }, close: async () => {} }
    const run = new Function('open', 'process', 'stat', 'dirname', 'randomUUID', 'rename', 'unlink', compiled + ';return writeJson;')(
      async () => file, { platform: 'linux', getuid: () => 0 }, async () => ({ gid: 123 }), () => 'state', () => 'id',
      async () => { assert.ok(durable); assert.equal(actual, mode); assert.equal(content, '{"fixture":true}') }, async () => {})
    await run('state/result.json', { fixture: true }, mode)
    assert.equal(group, mode === 0o640 ? 123 : -1)
  }
  if (process.platform !== 'win32') {
    const mask = process.umask(0o077)
    try {
      for (const mode of [0o600, 0o640]) {
        const path = join(workspace, `mode-${mode}.json`)
        await writeJson(path, { fixture: true }, mode)
        assert.equal((await stat(path)).mode & 0o777, mode)
        assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { fixture: true })
      }
      console.log('PASS native recovery state modes: umask077 preserves exact 0600 private and 0640 service-readable atomic files')
    } finally { process.umask(mask) }
  }
  console.log('PASS recovery state publication: final permissions and group established before durable rename under restrictive umasks')
}
