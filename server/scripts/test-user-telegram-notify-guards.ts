import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function readServerFile(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8')
}

function readRepoFile(rel: string): string {
  return readFileSync(resolve(__dirname, '../..', rel), 'utf8')
}

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

// ---------- notifier：白名单 + 站点 Bot 投递 ----------
const notifierSource = readServerFile('src/lib/notifier.ts')

assert.ok(
  notifierSource.includes("| 'recharge_success'") &&
    notifierSource.includes("| 'recharge_failed'") &&
    notifierSource.includes("| 'instance_expired'"),
  'notifier EventType must include recharge_success, recharge_failed, and instance_expired'
)
assert.ok(
  notifierSource.includes('  recharge_success: {') &&
    notifierSource.includes('  recharge_failed: {') &&
    notifierSource.includes('  instance_expired: {') &&
    notifierSource.includes('deleteAfterDays'),
  'notifier templates must define recharge_success, recharge_failed, and instance_expired'
)
assert.ok(
  notifierSource.includes('const SITE_BOT_NOTIFY_EVENT_TYPES'),
  'notifier must define the site bot notification whitelist'
)
const whitelistSection = sectionBetween(notifierSource, 'const SITE_BOT_NOTIFY_EVENT_TYPES', '])')
for (const eventType of [
  "'instance_created'",
  "'instance_create_failed'",
  "'instance_create_timeout'",
  "'instance_renewed'",
  "'auto_renew_failed'",
  "'recharge_success'",
  "'recharge_failed'",
  "'instance_expiring'",
  "'instance_expired'"
]) {
  assert.ok(whitelistSection.includes(eventType), `site bot whitelist must include ${eventType}`)
}
assert.ok(
  !whitelistSection.includes("'ticket_") && !whitelistSection.includes("'friend_") && !whitelistSection.includes("'login_"),
  'site bot whitelist must stay limited to core billing and lifecycle events'
)
const siteBotSection = sectionBetween(notifierSource, 'async function deliverSiteBotNotification(', '\n}\n')
assert.ok(
  siteBotSection.includes('if (!SITE_BOT_NOTIFY_EVENT_TYPES.has(eventType)) return') &&
    siteBotSection.includes('binding.notifyEnabled'),
  'site bot delivery must respect the whitelist and the per-user notify switch'
)
assert.ok(
  siteBotSection.includes("getSystemConfigBoolean('telegram_bot_enabled'") &&
    siteBotSection.includes("getSystemConfig('telegram_bot_token')") &&
    siteBotSection.includes('sendWithRetry('),
  'site bot delivery must use the enabled site bot token with retry'
)
assert.ok(
  siteBotSection.includes('notifyLastError') &&
    siteBotSection.includes('sanitizeTokensInString') &&
    !siteBotSection.includes('createNotificationLog'),
  'site bot failures must be recorded on the binding row without inventing channel log rows'
)
const sendNotificationSection = sectionBetween(
  notifierSource,
  'export async function sendNotification(',
  'type HostManagedInstanceEventType'
)
assert.ok(
  sendNotificationSection.indexOf('await deliverSiteBotNotification(userId, eventType, title, message)') !== -1 &&
    sendNotificationSection.indexOf('await deliverSiteBotNotification(userId, eventType, title, message)') <
      sendNotificationSection.indexOf('getEnabledChannelsByUserId'),
  'sendNotification must attempt the site bot delivery before the personal-channel early return'
)

// ---------- notifier：聚合模板 ----------
assert.equal(
  (notifierSource.match(/Array\.isArray\(data\.instanceNames\)/g) ?? []).length,
  4,
  'expiring/expired/auto-renew templates must branch on aggregated instanceNames'
)
assert.ok(
  notifierSource.includes('function formatNotifyTime(') &&
    notifierSource.includes('formatNotifyTime(data.expiredAt)') &&
    notifierSource.includes('formatNotifyTime(data.newExpiresAt)'),
  'lifecycle templates must render readable Asia/Shanghai timestamps'
)
assert.ok(
  notifierSource.includes('instanceNames?: string[]'),
  'EventData must accept aggregated instance name lists'
)

// ---------- 到期档位、已到期事件与按用户聚合 ----------
const schedulerSource = readServerFile('src/services/billing-scheduler.ts')
assert.ok(
  schedulerSource.includes('const EXPIRY_NOTIFY_DAYS = [3, 2, 1]'),
  'expiry reminders must fire at T-3, T-2 and T-1'
)
const expirySuspendSection = sectionBetween(
  schedulerSource,
  'async function executeExpirySuspend(): Promise<void> {',
  '// ==================== 到期删除任务 ===================='
)
assert.ok(
  expirySuspendSection.includes("'instance_expired'") &&
    !expirySuspendSection.includes("'instance_suspended'"),
  'expiry suspension must notify users with the dedicated instance_expired event'
)
assert.ok(
  expirySuspendSection.includes('deleteAfterDays: SUSPEND_AFTER_DELETE_DAYS') &&
    expirySuspendSection.includes('instanceNames:'),
  'expiry suspension notifications must carry the deletion countdown and support per-user aggregation'
)
assert.ok(
  schedulerSource.includes('claimedExpiryNotifications.push({') &&
    schedulerSource.includes('const claimedByUser = new Map') &&
    schedulerSource.includes('autoRenewUserFailures.push({') &&
    schedulerSource.includes('autoRenewUserSuccesses.push({') &&
    schedulerSource.includes('flushAutoRenewUserNotifications'),
  'scheduled lifecycle notifications must aggregate per user per run'
)
for (const perInstanceSend of [
  "await sendNotification(instance.userId, 'instance_expiring'",
  "await sendNotification(instance.userId, 'instance_expired'",
  "await sendNotification(suspendedInstance.userId, 'instance_expired'",
  "await sendNotification(instance.userId, 'auto_renew_failed'",
  "await sendNotification(instance.userId, 'instance_renewed'"
]) {
  assert.ok(
    !schedulerSource.includes(perInstanceSend),
    `billing scheduler must not send per-instance notifications for aggregated events: ${perInstanceSend}`
  )
}

// ---------- 邮件聚合 ----------
const mailerSource = readServerFile('src/lib/mailer.ts')
assert.equal(
  (mailerSource.match(/aggregateNames\?: string\[\]/g) ?? []).length,
  3,
  'the three lifecycle emails must accept aggregated instance lists'
)
assert.ok(
  mailerSource.includes('aggregateListText'),
  'lifecycle emails must render the aggregated instance list'
)

// ---------- 充值失败/成功通知挂钩 ----------
const rechargeRecordsSource = readServerFile('src/db/recharge-records.ts')
const failRechargeSection = sectionBetween(
  rechargeRecordsSource,
  'export async function failRecharge(',
  '/**\n * 取消充值订单'
)
assert.ok(
  failRechargeSection.includes('updateResult.count > 0') &&
    failRechargeSection.includes("await import('../lib/notifier.js')") &&
    failRechargeSection.includes("'recharge_failed'"),
  'failRecharge must fire the recharge_failed user notification only on a real transition'
)

const rechargeRouteSource = readServerFile('src/routes/recharge.ts')
assert.equal(
  (rechargeRouteSource.match(/sendNotification\(record\.userId, 'recharge_success'/g) ?? []).length,
  2,
  'both online recharge crediting paths must notify the user with recharge_success'
)
assert.ok(
  !rechargeRouteSource.includes('createInboxMessage'),
  'recharge routes must go through the notifier instead of raw inbox creation'
)

// ---------- telegram 路由：开关接口 + /notify 命令 ----------
const telegramSource = readServerFile('src/routes/telegram.ts')
assert.ok(
  telegramSource.includes("fastify.put<{ Body: { enabled?: unknown } }>('/notification'"),
  'telegram routes must expose the notification toggle endpoint'
)
const notificationRouteSection = sectionBetween(
  telegramSource,
  "fastify.put<{ Body: { enabled?: unknown } }>('/notification'",
  "fastify.post<{ Body: TelegramWebhookUpdate }>('/webhook'"
)
assert.ok(
  notificationRouteSection.includes("typeof enabled !== 'boolean'") &&
    notificationRouteSection.includes('reply.code(404)') &&
    notificationRouteSection.includes('notifyEnabled: enabled'),
  'notification toggle must validate the payload, require a binding, and echo the new state'
)
assert.ok(
  telegramSource.includes('notifyEnabled: binding.notifyEnabled !== false') &&
    telegramSource.includes('notifyLastError: binding.notifyLastError || null'),
  'binding status must expose the notification switch and last delivery error'
)
assert.ok(
  telegramSource.includes('notifyCommandMatch') &&
    telegramSource.includes("const notifyAction = typeof notifyCommandMatch[1] === 'string'") &&
    telegramSource.includes('/notify off 可关闭') &&
    telegramSource.includes('通知开关：/notify on 开启，/notify off 关闭。'),
  'telegram bot must support the /notify on|off command and list it in the help text'
)

// ---------- schema + 迁移 ----------
const schemaSource = readRepoFile('server/prisma/schema.prisma')
assert.ok(
  schemaSource.includes('notifyEnabled') &&
    schemaSource.includes('@map("notify_enabled")') &&
    schemaSource.includes('@map("notify_last_error")') &&
    schemaSource.includes('@map("notify_last_error_at")'),
  'UserTelegramBinding must persist the notify switch and last error fields'
)
const migrationPath = resolve(__dirname, '../prisma/migrations/202610180002_user_telegram_notify/migration.sql')
assert.ok(existsSync(migrationPath), 'user telegram notify migration must exist')
const migrationSource = readFileSync(migrationPath, 'utf8')
assert.ok(
  migrationSource.includes('ADD COLUMN "notify_enabled" BOOLEAN NOT NULL DEFAULT true'),
  'migration must add notify_enabled with a default of true so existing bindings opt in'
)

// ---------- 客户端 ----------
const cardSource = readRepoFile('client/src/components/profile/TelegramBindingSection.vue')
assert.ok(
  cardSource.includes('api.telegram.setNotification(') &&
    cardSource.includes('binding.notifyEnabled') &&
    cardSource.includes("t('profile.telegramBinding.notifyErrorHint'"),
  'binding card must toggle the notify switch and surface the last delivery error'
)
assert.ok(
  readRepoFile('client/src/api/index.ts').includes("'/telegram/notification'") &&
    readRepoFile('client/src/api/admin.ts').includes("'/telegram/notification'"),
  'both API clients must expose the notification toggle'
)
assert.ok(
  readRepoFile('client/src/types/api.ts').includes('notifyEnabled: boolean'),
  'TelegramBindingStatus must include the notify switch state'
)
for (const locale of ['zh-CN', 'zh-TW', 'en']) {
  const localeSource = readRepoFile(`client/src/locales/${locale}.ts`)
  assert.ok(
    localeSource.includes('notifyLabel:') &&
      localeSource.includes('notifyHint:') &&
      localeSource.includes('notifyErrorHint:'),
    `${locale} locales must include the telegram notify keys`
  )
}

console.log('user telegram notify guard tests passed')
