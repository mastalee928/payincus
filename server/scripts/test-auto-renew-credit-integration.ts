import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from 'pg'
import { mock } from 'node:test'
import nodemailer from 'nodemailer'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const root = await mkdtemp(join(tmpdir(), 'renew-credit-'))
process.env.PLATFORM_BACKUP_STATE_DIR = root
const interval = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const timer = interval(...args); timer.unref(); return timer }) as typeof setInterval
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { executeAutoRenew, processAutoRenew, startBillingScheduler, stopExpiryEnforcement, getExpiryEnforcementStatus } = await import('../src/services/billing-scheduler.js')
const { performRenewal, updateAutoRenew, getInstanceBillingInfo } = await import('../src/db/billing-operations.js')
const { completeRecharge } = await import('../src/db/recharge-records.js')
const { registerRechargeRenewalConsumer } = await import('../src/lib/recharge-renewal.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const { withInstanceBillingMutation } = await import('../src/lib/instance-billing-mutation.js')
const { getAutoRenewInstances } = await import('../src/db/instance-suspend.js')
const { USER_BALANCE_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
const { invalidateAllConfigCache } = await import('../src/lib/config-cache.js')
const { clearTransporterCache } = await import('../src/lib/mailer.js')
globalThis.setInterval = interval
const tag = 'renew-credit-' + randomUUID(), users: number[] = [], wakeups: Promise<void>[] = []
const holder = new Client({ connectionString: database.href }), observer = new Client({ connectionString: database.href })
let hostId: number | undefined, packageId: number | undefined, providerId: number | undefined
const capture = <T>(p: Promise<T>) => p.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }))
const mails: Array<{ text: string; html: string }> = []
const mailStub = mock.method(nodemailer, 'createTransport', () => ({ sendMail: async (data: { text: string; html: string }) => {
  mails.push(data); return { accepted: ['isolated-fixture'] }
} }))
const smtp = { smtp_enabled: 'true', smtp_host: '127.0.0.1', smtp_username: 'fixture', smtp_password: 'fixture', smtp_from_email: 'fixture@example.invalid' }
const savedSmtp = await prisma.systemConfig.findMany({ where: { key: { in: Object.keys(smtp) } } })
const wait = async (check: () => Promise<boolean> | boolean, label: string) => {
  const deadline = Date.now() + 10000
  while (!await check()) { if (Date.now() > deadline) throw Error('Timed out: ' + label); await delay(10) }
}
registerRechargeRenewalConsumer(userId => { const p = executeAutoRenew(userId); wakeups.push(p); return p })
const flush = async () => { while (wakeups.length) await Promise.all(wakeups.splice(0)) }
try {
  await holder.connect(); await observer.connect()
  for (const [key, value] of Object.entries(smtp)) await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
  invalidateAllConfigCache(); clearTransporterCache()
  const owner = await prisma.user.create({ data: { username: tag + '-owner', passwordHash: 'unusable', role: 'admin' } }); users.push(owner.id)
  const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: 'https://127.0.0.1:1' } }); hostId = host.id
  const pkg = await prisma.package.create({ data: { userId: owner.id, name: tag, cpuMax: 100, memoryMax: 128, diskMax: 1024 } }); packageId = pkg.id
  const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: tag, cpu: 100, memory: 128, disk: 1024,
    portLimit: 1, snapshotLimit: 0, backupLimit: 0, siteLimit: 0, trafficLimit: 0n, price: 3000 } })
  const provider = await prisma.paymentProvider.create({ data: { name: tag, type: 'yipay', status: 'disabled', config: {} } }); providerId = provider.id
  // Exercise the actual application startup registration, without waiting for
  // a cron tick or manually scanning to rescue a missing recharge hook.
  startBillingScheduler()
  const cron = await import('node-cron')
  await delay(20)
  await stopExpiryEnforcement()
  await wait(async()=>!(await getExpiryEnforcementStatus()).running,'startup expiry catchup settled')
  for (const task of cron.getTasks().values()) await task.destroy()
  const buyer = async (balance = 0) => {
    const user = await prisma.user.create({ data: { username: tag + '-' + users.length, passwordHash: 'unusable', balance } }); users.push(user.id); return user
  }
  const expiry = new Date(Math.floor((Date.now() + 3600000) / 1000) * 1000)
  const make = async (userId: number, price = 30, changes: Record<string, unknown> = {}) => prisma.instance.create({ data: {
    userId, hostId: host.id, packageId: pkg.id, packagePlanId: plan.id, name: tag + randomUUID(), incusId: tag + randomUUID(),
    image: 'fixture', cpu: 100, memory: 128, disk: 1024, billingPrice: price, billingCycle: 1, autoRenew: true,
    status: 'running', expiresAt: expiry, ...changes
  } })
  const billCount = (id: number) => prisma.instanceBillingRecord.count({ where: { instanceId: id, type: 'renew' } })
  const balance = async (id: number) => Number((await prisma.user.findUniqueOrThrow({ where: { id } })).balance)
  const recharge = (userId: number, amount: number) => prisma.rechargeRecord.create({ data: {
    userId, providerId: provider.id, orderNo: tag + randomUUID(), amount, actualAmount: amount, status: 'pending'
  } })
  const singleBuyer = await buyer(), single = await make(singleBuyer.id, 30, { status: 'suspended', suspendReason: 'expired',
    suspendedAt: new Date(Date.now() - 86400000), expiresAt: new Date(Date.now() - 86400000), autoRenewAttempts: 7,
    lastAutoRenewAttemptAt: new Date() })
  await executeAutoRenew(singleBuyer.id)
  assert.equal(await billCount(single.id), 0)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: single.id } })).autoRenew, true)
  const order = await recharge(singleBuyer.id, 30)
  const completed = await Promise.all(Array.from({ length: 8 }, () => completeRecharge(order.orderNo, { tradeNo: order.orderNo })))
  assert.equal(completed.filter(row => row.completedNow).length, 1)
  await wait(async () => await billCount(single.id) === 1, 'real scheduler registration receives credit wakeup')
  await executeAutoRenew(singleBuyer.id)
  registerRechargeRenewalConsumer(userId => { const p = executeAutoRenew(userId); wakeups.push(p); return p })
  assert.equal(await billCount(single.id), 1); assert.equal(await balance(singleBuyer.id), 0)
  assert.equal(await prisma.balanceLog.count({ where: { userId: singleBuyer.id, type: 'recharge' } }), 1)
  assert.equal(await prisma.balanceLog.count({ where: { userId: singleBuyer.id, type: 'consume' } }), 1)
  assert.equal(await prisma.instanceTask.count({ where: { instanceId: single.id, operationEntry: 'auto-renew-resume-v1' } }), 1)
  const renewed = await prisma.instance.findUniqueOrThrow({ where: { id: single.id } })
  assert.equal(renewed.suspendReason, null); assert.ok(renewed.expiresAt! > new Date()); assert.equal(renewed.autoRenew, true)
  console.log('PASS single suspended recharge after seven failures, eight duplicate settlements: one credit, one debit, one bill, expiry extended')

  const multi = await buyer(70), machines = []
  await prisma.user.update({ where: { id: multi.id }, data: { email: 'renew-fixture@example.invalid' } })
  for (let n = 0; n < 3; n++) machines.push(await make(multi.id))
  const selected = await getAutoRenewInstances(24, [multi.id])
  assert.deepEqual(selected.map(item => item.id), machines.map(item => item.id))
  await Promise.all([executeAutoRenew(), executeAutoRenew(multi.id), executeAutoRenew(multi.id)])
  assert.deepEqual(await Promise.all(machines.map(row => billCount(row.id))), [1, 1, 0]); assert.equal(await balance(multi.id), 10)
  const topup = await recharge(multi.id, 20)
  await completeRecharge(topup.orderNo, {}); await flush()
  assert.deepEqual(await Promise.all(machines.map(row => billCount(row.id))), [1, 1, 1]); assert.equal(await balance(multi.id), 0)
  const messages = await prisma.inboxMessage.findMany({ where: { userId: multi.id, eventType: 'instance_renewed' } })
  assert.ok(messages.length >= 2)
  const mailText = mails.map(item => item.text).join('\n')
  for (const machine of machines) assert.ok(mailText.includes(`#${machine.id}`))
  assert.ok(mailText.includes('需 ¥30.00')); assert.ok(mailText.includes('每五分钟'))
  assert.ok(!mailText.includes('自动续费已关闭') && !mailText.includes('剩余尝试次数'))
  console.log('PASS three same-second 30-yuan instances with 70 yuan: ID order, two exact renewals; later 20-yuan credit renews only remaining instance')

  const mixed = await buyer(30), expensive = await make(mixed.id, 40), cheap = await make(mixed.id, 20)
  await executeAutoRenew(mixed.id)
  assert.equal(await billCount(expensive.id), 0); assert.equal(await billCount(cheap.id), 1); assert.equal(await balance(mixed.id), 10)
  const older = await make(mixed.id, 10, { expiresAt: new Date(expiry.getTime() - 60000) })
  assert.equal((await getAutoRenewInstances(24, [mixed.id]))[0].id, older.id)
  await executeAutoRenew(mixed.id); assert.equal(await billCount(older.id), 1)
  console.log('PASS unaffordable instance is skipped without partial debit; later affordable instance renews and expiry takes priority over ID')

  const excludedUser = await buyer(300)
  const excluded = []
  for (const changes of [
    { status: 'suspended', suspendReason: 'expired', suspendedAt: new Date(Date.now() - 3 * 86400000), expiresAt: new Date(Date.now() - 3 * 86400000) },
    { status: 'deleted', deletionBillingPending: true }, { status: 'deleted' },
    { autoRenew: false }, { status: 'suspended', suspendReason: 'manual', suspendedBy: owner.id },
    { deletionIntent: { status: 'pending' } }, { provisioningCleanupPending: true }, { status: 'creating' },
    { status: 'suspended', suspendReason: 'expired', suspendedBy: owner.id, suspendedAt: new Date(), expiresAt: new Date(Date.now() - 1000) }
  ]) excluded.push(await make(excludedUser.id, 30, changes))
  const before = await prisma.instance.findMany({ where: { userId: excludedUser.id }, orderBy: { id: 'asc' } })
  await executeAutoRenew(excludedUser.id)
  assert.equal(await balance(excludedUser.id), 300)
  assert.deepEqual(await prisma.instance.findMany({ where: { userId: excludedUser.id }, orderBy: { id: 'asc' } }), before)
  await assert.rejects(performRenewal(excludedUser.id, excluded[0], 1), /保留期已结束/)
  await assert.rejects(updateAutoRenew(excluded[0].id, true, excludedUser.id, { sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }), /保留期已结束/)
  for (const item of excluded.slice(0, 3)) await assert.rejects(performRenewal(excludedUser.id, item, 1, { expiryThreshold: expiry }))
  await assert.rejects(performRenewal(excludedUser.id, excluded.at(-1)!, 1), /手动封停/)
  for (const item of excluded.filter(item => !['running', 'creating'].includes(item.status) || item.deletionIntent || item.provisioningCleanupPending)) {
    assert.deepEqual((await getInstanceBillingInfo(item.id))?.renewPreview, [], 'closed lifecycle cannot offer a renewal quote')
  }
  const excludedTopup = await recharge(excludedUser.id, 20)
  await completeRecharge(excludedTopup.orderNo, {}); await flush()
  assert.equal(await balance(excludedUser.id), 320)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { userId: excludedUser.id } }), 0)
  console.log('PASS retention boundary, deleting/deleted, disabled, manual suspension, pending cleanup and provisioning: zero debit and unchanged records')

  const held = await buyer(), heldInstance = await make(held.id, 10)
  const holdFile = join(root, 'recovery-hold.json'); await writeFile(holdFile, '{}')
  const heldOrder = await recharge(held.id, 10); await completeRecharge(heldOrder.orderNo, {}); await flush()
  assert.equal(await balance(held.id), 10); assert.equal(await billCount(heldInstance.id), 0)
  await unlink(holdFile); await executeAutoRenew(); assert.equal(await billCount(heldInstance.id), 1)
  console.log('PASS recovery protection holds post-credit debit; patrol catches up after hold is released')

  registerRechargeRenewalConsumer(async () => {})
  const restartBuyer = await buyer(), restartTarget = await make(restartBuyer.id, 10)
  const restartOrder = await recharge(restartBuyer.id, 10); await completeRecharge(restartOrder.orderNo, {})
  assert.equal(await billCount(restartTarget.id), 0)
  registerRechargeRenewalConsumer(userId => { const p = executeAutoRenew(userId); wakeups.push(p); return p })
  await executeAutoRenew(); assert.equal(await billCount(restartTarget.id), 1)
  console.log('PASS missed process-local wakeup is recovered by database patrol without resetting consent or retry times')

  const banned = await buyer(), bannedInstance = await make(banned.id, 10)
  await prisma.user.update({ where: { id: banned.id }, data: { status: 'banned' } })
  const bannedOrder = await recharge(banned.id, 10); await completeRecharge(bannedOrder.orderNo, {}); await flush()
  assert.equal(await balance(banned.id), 10); assert.equal(await billCount(bannedInstance.id), 0)
  console.log('PASS banned account can receive verified credit but cannot be automatically charged')

  const raceUser = await buyer(30), race = await make(raceUser.id, 30)
  const results = await Promise.allSettled([executeAutoRenew(raceUser.id), performRenewal(raceUser.id, race, 1)])
  await flush(); assert.ok(results.some(item => item.status === 'fulfilled'))
  assert.equal(await billCount(race.id), 1); assert.equal(await balance(raceUser.id), 0)
  console.log('PASS manual and automatic renewal race: one debit and one period')

  const busyUser = await buyer(30), priority = await make(busyUser.id), later = await make(busyUser.id)
  await holder.query('SELECT pg_advisory_lock($1::int, $2::int)', [USER_BALANCE_LOCK_NAMESPACE, busyUser.id])
  try {
    await executeAutoRenew(busyUser.id)
    assert.equal(await billCount(priority.id), 0); assert.equal(await billCount(later.id), 0)
    assert.equal(await prisma.inboxMessage.count({ where: { userId: busyUser.id, eventType: 'auto_renew_failed' } }), 0)
  } finally { await holder.query('SELECT pg_advisory_unlock($1::int, $2::int)', [USER_BALANCE_LOCK_NAMESPACE, busyUser.id]) }
  await executeAutoRenew(busyUser.id)
  assert.equal(await billCount(priority.id), 1); assert.equal(await billCount(later.id), 0); assert.equal(await balance(busyUser.id), 0)
  console.log('PASS persistent balance lock defers buyer without failed notices; next patrol preserves priority and charges one full instance')

  const periodsUser = await buyer(40), oneMonth = await make(periodsUser.id, 10), threeMonths = await make(periodsUser.id, 30, { billingCycle: 3 })
  await prisma.user.update({ where: { id: periodsUser.id }, data: { email: 'period-fixture@example.invalid' } })
  mails.length = 0
  await executeAutoRenew(periodsUser.id)
  const periodsMessage = await prisma.inboxMessage.findFirstOrThrow({ where: { userId: periodsUser.id, eventType: 'instance_renewed' } })
  for (const target of [oneMonth, threeMonths]) {
    const current = await prisma.instance.findUniqueOrThrow({ where: { id: target.id } })
    assert.ok(JSON.stringify(periodsMessage).includes(`#${target.id}`))
    assert.ok(JSON.stringify(periodsMessage).includes(current.expiresAt!.toISOString()))
    assert.ok(mails[0].text.includes(current.expiresAt!.toISOString()))
  }
  assert.ok(mails[0].text.includes('1个月') && mails[0].text.includes('3个月'))
  assert.equal(await balance(periodsUser.id), 0)
  console.log('PASS per-instance notification and locally captured email retain different periods, amounts and expiry dates')

  const noticeUser = await buyer()
  for (let n = 0; n < 20; n++) await make(noticeUser.id, 10, { name: 'x'.repeat(200) })
  await executeAutoRenew(noticeUser.id)
  const boundedNotice = await prisma.inboxMessage.findFirstOrThrow({ where: { userId: noticeUser.id, eventType: 'auto_renew_failed' } })
  assert.ok(boundedNotice.content.length < 4096, 'Telegram message body stays below the parsed-text limit')
  assert.ok(boundedNotice.content.includes('其余实例请在控制面板查看'))
  assert.ok(boundedNotice.content.includes('200.00'))
  console.log('PASS twenty long-name instances retain total amount and bounded notification details')

  const failedScanUser = await buyer(10), failedScan = await make(failedScanUser.id, 10)
  const slowScanUser = await buyer(10), slowScan = await make(slowScanUser.id, 10)
  let unlockScan!: () => void, scanEntered = false, scanSettled = false
  const scanGate = new Promise<void>(resolve => { unlockScan = resolve })
  const originalFind = prisma.instance.findUnique
  prisma.instance.findUnique = (async (args: any) => {
    if (args.where.id === failedScan.id) throw Error('isolated buyer read failure')
    if (args.where.id === slowScan.id) { scanEntered = true; await scanGate }
    return originalFind(args)
  }) as typeof prisma.instance.findUnique
  const rejectedScan = capture(executeAutoRenew()).then(value => { scanSettled = true; return value })
  try {
    await wait(() => scanEntered, 'second buyer entered despite first buyer read failure')
    await delay(20); assert.equal(scanSettled, false, 'failed buyer cannot release a still-running scan')
  } finally { unlockScan(); await rejectedScan; prisma.instance.findUnique = originalFind }
  assert.equal((await rejectedScan).ok, false)
  assert.equal(await billCount(slowScan.id), 1); assert.equal(await billCount(failedScan.id), 0)
  await executeAutoRenew(failedScanUser.id); assert.equal(await billCount(failedScan.id), 1)
  console.log('PASS buyer read failure waits for remaining lanes, reports failure and allows clean next-patrol recovery')

  const lateUser = await buyer(), late = await make(lateUser.id, 30)
  let release!: () => void, entered!: () => void
  const inside = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  const lane = withInstanceBillingMutation(late.id, async () => { entered(); await gate })
  await inside
  await prisma.user.update({ where: { id: lateUser.id }, data: { balance: 30 } })
  const first = executeAutoRenew(lateUser.id)
  try {
    await delay(30)
    const lateOrder = await recharge(lateUser.id, 1); await completeRecharge(lateOrder.orderNo, {})
  } finally { release() }
  await lane; await first; await flush()
  assert.equal(await billCount(late.id), 1); assert.equal(await balance(lateUser.id), 1)
  console.log('PASS credit during an active renewal scan queues a fresh follow-up without duplicate debit')

  const cutoffUser = await buyer(30), cutoff = await make(cutoffUser.id, 30, { status: 'suspended', suspendReason: 'expired',
    expiresAt: new Date(Date.now() - 3 * 86400000 + 1200), suspendedAt: new Date(Date.now() - 86400000) })
  await holder.query('BEGIN'); await holder.query('SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE', [cutoffUser.id])
  const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
  const pending = capture(performRenewal(cutoffUser.id, cutoff, 1, { expiryThreshold: expiry }))
  try {
    await wait(async () => (await observer.query('SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid])).rowCount! > 0, 'renewal blocked on actual account row')
    await delay(1300)
  } finally { await holder.query('COMMIT') }
  assert.equal((await pending).ok, false); assert.equal(await billCount(cutoff.id), 0); assert.equal(await balance(cutoffUser.id), 30)
  assert.equal(await prisma.instanceTask.count({ where: { instanceId: cutoff.id } }), 0)
  console.log('PASS retention elapses while transaction waits for balance: debit, bill and expiry all roll back')

  const changedOwner = await buyer(30), oldOwner = await buyer(30), old = await make(oldOwner.id, 30)
  await prisma.instance.update({ where: { id: old.id }, data: { userId: changedOwner.id } })
  await processAutoRenew(old)
  assert.equal(await billCount(old.id), 0); assert.equal(await balance(oldOwner.id), 30); assert.equal(await balance(changedOwner.id), 30)
  await updateAutoRenew(old.id, false, changedOwner.id, { sid: tag, iat: Math.floor(Date.now() / 1000) + 1 })
  console.log('PASS a stale selection cannot charge a different owner after transfer')
} finally {
  await holder.query('ROLLBACK').catch(() => {}); await Promise.allSettled(wakeups)
  registerRechargeRenewalConsumer(async () => {})
  await prisma.systemConfig.deleteMany({ where: { key: { in: Object.keys(smtp) } } })
  for (const config of savedSmtp) await prisma.systemConfig.create({ data: config })
  invalidateAllConfigCache(); clearTransporterCache(); mailStub.mock.restore()
  mock.restoreAll()
  await prisma.balanceLog.deleteMany({ where: { userId: { in: users } } })
  await prisma.log.deleteMany({ where: { userId: { in: users } } })
  if (hostId) await prisma.instance.deleteMany({ where: { hostId } })
  await prisma.rechargeRecord.deleteMany({ where: { userId: { in: users } } })
  if (providerId) await prisma.paymentProvider.delete({ where: { id: providerId } })
  if (packageId) await prisma.package.delete({ where: { id: packageId } })
  if (hostId) await prisma.host.delete({ where: { id: hostId } })
  await prisma.user.deleteMany({ where: { id: { in: users } } })
  await holder.end(); await observer.end(); closeAllClients(); await closePrismaDatabase()
}
