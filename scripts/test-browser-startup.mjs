import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { waitForChromeEndpoint } from '../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const logs = fileURLToPath(new URL('../logs/', import.meta.url)); mkdirSync(logs, { recursive: true })
const options = { timeoutMs: 80, pollMs: 5 }
function fixture() {
  const proc = new EventEmitter(); proc.stderr = new EventEmitter(); proc.exitCode = null
  return { proc, dir: mkdtempSync(join(logs, 'browser-startup-')) }
}
function clean(proc) { assert.equal(proc.listenerCount('error'), 0); assert.equal(proc.listenerCount('exit'), 0); assert.equal(proc.stderr.listenerCount('data'), 0) }
{
  const { proc, dir } = fixture(), ready = waitForChromeEndpoint(proc, dir, options)
  proc.stderr.emit('data', 'DevTools listening on ws://127.0.0.1:1234/devtools/'); proc.stderr.emit('data', 'browser/fixture-id\n')
  assert.equal(await ready, 'ws://127.0.0.1:1234/devtools/browser/fixture-id'); clean(proc)
}
{
  const { proc, dir } = fixture(), ready = waitForChromeEndpoint(proc, dir, options)
  writeFileSync(join(dir, 'DevToolsActivePort'), '1235\n/devtools/browser/file-id\n')
  assert.equal(await ready, 'ws://127.0.0.1:1235/devtools/browser/file-id'); clean(proc)
}
for (const event of ['error', 'exit']) {
  const { proc, dir } = fixture(), ready = waitForChromeEndpoint(proc, dir, options)
  proc.stderr.emit('data', 'isolated startup diagnostic')
  if (event === 'error') proc.emit(event, new Error('ENOENT'))
  else proc.emit(event, 3, null)
  await assert.rejects(ready, /Chrome (spawn failed|exited before).*\nChrome stderr: isolated startup diagnostic/); clean(proc)
}
{
  const { proc, dir } = fixture()
  writeFileSync(join(dir, 'DevToolsActivePort'), '99999\n/devtools/browser/bad\n')
  await assert.rejects(waitForChromeEndpoint(proc, dir, options), /did not become ready.*\nChrome emitted no startup diagnostics/); clean(proc)
}
{
  const { proc, dir } = fixture(), ready = waitForChromeEndpoint(proc, dir, options)
  proc.stderr.emit('data', 'x'.repeat(10000) + 'last diagnostic')
  await assert.rejects(ready, error => error.message.length < 2200 && error.message.endsWith('last diagnostic')); clean(proc)
}
console.log('Browser startup passed: split stderr, port file fallback, spawn/exit/timeout diagnostics, bounds and listener cleanup.')
