import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// The checks below call only pure calculators/parsers; never use an ambient DB.
process.env.DATABASE_URL = 'postgresql://fixture:fixture@127.0.0.1:1/renewal_price_guards'
process.env.NODE_ENV = 'test'
const originalInterval = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const timer = originalInterval(...args); timer.unref(); return timer }) as typeof setInterval
const { calculateRenewBilling } = await import('../src/db/billing-operations.js')
const { decideRenewalPrice } = await import('../src/lib/renewal-price.js')
const { parseRenewalPrice } = await import('../src/services/admin-instance-renewal-price.js')
globalThis.setInterval = originalInterval

for (const [input, amount] of [['0', 0], ['0.01', 0.01], ['12.34', 12.34], ['100000.00', 100000]] as const) assert.equal(parseRenewalPrice(input), amount)
for (const input of [null, true, 10, '', ' 10 ', '01', '1e2', '-0', '1.234', '100000.01', 'Infinity']) assert.throws(() => parseRenewalPrice(input), /RENEWAL_PRICE_INVALID/)
for (const [periodPrice, cycle, months, amount] of [[12.34, 1, 1, 12.34], [30, 3, 1, 10], [30, 3, 3, 30], [0, 1, 1, 0]]) {
  const quote = calculateRenewBilling({ billingPrice: 100, renewalPrice: periodPrice, billingCycle: cycle, expiresAt: null }, months)
  assert.equal(quote.amount, amount)
  assert.deepEqual(decideRenewalPrice({ basePrice: quote.amount, affDiscountRate: 0.9, vipDiscountPercent: 50 }, periodPrice), { finalPrice: amount, discountAmount: 0, source: 'base' })
}
assert.equal(decideRenewalPrice({ basePrice: 10, affDiscountRate: 0.5 }, null).finalPrice, 5, 'unset override preserves existing pricing')
const { assertRenewalReceipt } = await import(new URL('../../client/src/api/renewal-receipt.ts', import.meta.url).href)
const receipt = { amount: 0, months: 1, newExpiresAt: '2030-03-02T04:00:00.000Z' }
assert.doesNotThrow(() => assertRenewalReceipt('/instances/1/renew', { months: 1 }, receipt))
for (const bad of [null, {}, { ...receipt, amount: NaN }, { ...receipt, amount: -1 }, { ...receipt, amount: 0.001 },
  { ...receipt, months: 2 }, { ...receipt, newExpiresAt: 'invalid' }]) {
  assert.throws(() => assertRenewalReceipt('/instances/1/renew', { months: 1 }, bad), /续费结果暂无法确认/)
}
const batchReceipt = { successCount: 1, skippedCount: 0, failedCount: 1,
  results: [{ id: 1, name: 'first', success: true, amount: 0, newExpiresAt: receipt.newExpiresAt },
    { id: 2, name: 'second', success: false, reason: 'insufficient balance' }] }
assert.doesNotThrow(() => assertRenewalReceipt('/instances/batch/renew', { instanceIds: [1, 2] }, batchReceipt))
for (const bad of [{ ...batchReceipt, successCount: 2 }, { ...batchReceipt, results: [batchReceipt.results[0], batchReceipt.results[0]] },
  { ...batchReceipt, results: batchReceipt.results.slice(0, 1) }]) {
  assert.throws(() => assertRenewalReceipt('/instances/batch/renew', { instanceIds: [1, 2] }, bad), /续费结果暂无法确认/)
}
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const refunds = source('../src/routes/hosts.ts').split('const refundInfo = await db.calculateInstanceRefund({').slice(1)
assert.equal(refunds.length, 2)
for (const part of refunds) assert.ok(!part.slice(0, part.indexOf('})')).includes('renewalPrice'), 'future price cannot replace paid price in a refund request')
assert.ok(source('../src/routes/admin-billing.ts').includes('await app.register(adminInstanceRenewalPriceRoutes)'), 'production route must be connected')
const modal = source('../../client/src/components/instance/modals/AdminRenewalPriceModal.vue')
assert.ok(modal.includes('session.current()') && modal.includes('matchesTarget(result)'), 'late receipts must match the active session and instance binding')
assert.ok(source('../../client/src/views/InstanceDetailView.vue').includes('const AdminRenewalPriceModal = isAdminEntry'), 'customer bundle cannot import the administrator editor')
for (const path of ['../../client/src/components/host/HostInstancesTab.vue', '../../client/src/components/host/HostInstancesList.vue', '../../client/src/api/index.ts']) {
  assert.doesNotMatch(source(path), /open-price|openPriceModal|showPriceModal|updateInstanceRenewalPrice/, 'ordinary customer/host-owner frontend must contain no price editor/client')
}
console.log('Instance renewal price guards passed: strict decimals, final/zero/cycle pricing, validated single/batch receipts, paid-refund separation and admin/session/bundle boundaries')
await (await import('../src/db/prisma.js')).closePrismaDatabase()
