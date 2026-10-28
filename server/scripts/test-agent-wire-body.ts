import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import Fastify from 'fastify'
import { captureAgentBodyHash, matchesAgentBodyHash } from '../src/lib/agent-request-body.js'
import { createAgentBodyHash, createAgentSignature, verifyAgentSignature } from '../src/lib/agent-auth.js'

const app = Fastify({ bodyLimit: 2048 })
app.decorateRequest('agentWireBodyHash', null)
const secret = 'ias_fixture_only_secret'
app.post('/heartbeat', { preParsing: captureAgentBodyHash }, async (request, reply) => {
  const bodyHash = String(request.headers['x-body-hash'])
  const signature = String(request.headers['x-signature'])
  const signed = { method: 'POST', path: '/heartbeat', timestamp: '1', nonce: 'fixture', bodyHash }
  if (!matchesAgentBodyHash(request, bodyHash) || !verifyAgentSignature(secret, signed, signature)) {
    return reply.code(401).send({ ok: false })
  }
  return { ok: true }
})
async function send(body: string, hash = createHash('sha256').update(body).digest('hex')) {
  return app.inject({ method: 'POST', url: '/heartbeat', payload: body, headers: {
    'content-type': 'application/json', 'x-body-hash': hash,
    'x-signature': createAgentSignature(secret, { method: 'POST', path: '/heartbeat', timestamp: '1', nonce: 'fixture', bodyHash: hash })
  } })
}
try {
  for (const body of [
    '{"load":1e-7,"bytes":9007199254740993}',
    '{"line":"\\u2028\\u2029","label":"<>&"}',
    '{"2":true,"10":false,"negativeZero":-0}',
    '{"emoji":"😀","unicode":"中文","nested":{"b":1,"a":2}}'
  ]) assert.equal((await send(body)).statusCode, 200, body)
  const legacy = { z: 1, a: { y: 2, x: 3 } }
  assert.equal((await send(JSON.stringify(legacy), createAgentBodyHash(legacy))).statusCode, 200)
  const original = '{"bytes":1}'
  const hash = createHash('sha256').update(original).digest('hex')
  assert.equal((await send('{"bytes":2}', hash)).statusCode, 401, 'modified report must fail')
  assert.equal((await send('{')).statusCode, 400, 'malformed JSON must not bypass parser')
  assert.equal((await send(JSON.stringify({ label: 'x'.repeat(2048) }))).statusCode, 413, 'bounded body')
  console.log('agent wire body authentication: 8 vectors passed')
} finally { await app.close() }
