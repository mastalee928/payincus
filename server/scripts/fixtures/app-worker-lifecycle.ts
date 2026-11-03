import assert from 'node:assert/strict'
import Fastify from 'fastify'
import ts from 'typescript'

export async function verifyAppWorkerLifecycle(source: string) {
  const file = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const hooks: ts.CallExpression[] = []
  const listens: ts.CallExpression[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (node.expression.getText(file) === 'fastify.addHook') hooks.push(node)
      if (node.expression.getText(file) === 'fastify.listen') listens.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(hooks.length && listens.length)
  for (const hook of hooks) {
    assert.ok(hook.getStart(file) < Math.min(...listens.map(call => call.getStart(file))), 'Register every hook before either protected or ordinary listen')
  }
  const workerHooks = hooks.filter(hook => /stopCheckoutWorker|stopRecoveryReviewWorker/.test(hook.getText(file)))
  assert.equal(workerHooks.length, 2)
  for (const protectedStartup of [false, true]) {
    const fastify = Fastify()
    let checkoutStopped = false, recoveryStopped = false
    const register = new Function('fastify', 'stopCheckoutWorker', 'stopRecoveryReviewWorker', workerHooks.map(hook => hook.getText(file)).join(';'))
    register(fastify, async () => { await new Promise(resolve => setTimeout(resolve, 10)); checkoutStopped = true }, () => { recoveryStopped = true })
    try {
      if (protectedStartup) await fastify.listen({ host: '127.0.0.1', port: 0 })
      if (!fastify.server.listening) await fastify.listen({ host: '127.0.0.1', port: 0 })
      assert.equal((await fastify.inject({ url: '/' })).statusCode, 404)
    } finally { await fastify.close() }
    assert.ok(checkoutStopped && recoveryStopped, 'Real Fastify close waits for the shipped worker shutdown callbacks')
  }
  console.log('PASS app worker lifecycle: hooks registered before ordinary/protected listen; real Fastify close awaits checkout and recovery cleanup')
}
