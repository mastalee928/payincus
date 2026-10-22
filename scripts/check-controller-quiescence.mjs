// Adapter for the opt-in real Incus test; consumes only bounded API metadata.
import assert from 'node:assert/strict'
import { inspectControllerQuiescence } from '../server/dist/lib/controller-quiescence.js'

let input = ''
for await (const chunk of process.stdin) {
  input += chunk
  if (Buffer.byteLength(input) > 1048576) throw new Error('Incus test metadata exceeds limit')
}
const data = JSON.parse(input)
assert.equal(inspectControllerQuiescence(data.operations, {
  oldConnectionsBlocked: true, legacyCredentialsBlocked: true,
  outstandingSshProcesses: 0, outstandingLocalJobs: 0
}).canActivate, data.expected)
