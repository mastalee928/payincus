import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function readRepoFile(path) {
  return readFileSync(resolve(__dirname, '../..', path), 'utf8')
}

function readServerFile(path) {
  return readFileSync(resolve(__dirname, '..', path), 'utf8')
}

const adminAlertsSource = readServerFile('src/lib/admin-alerts.ts')
assert.ok(
  adminAlertsSource.includes("export const ADMIN_ALERT_CATEGORIES = ['ticket', 'host', 'payment', 'instance'] as const") &&
    adminAlertsSource.includes('export async function sendAdminAlert(') &&
    adminAlertsSource.includes('alertCategory: category') &&
    adminAlertsSource.includes('enabled: true'),
  'admin alerts core must define the four categories and query enabled channels per category'
)
assert.ok(
  adminAlertsSource.includes("parse_mode: 'HTML'") &&
    adminAlertsSource.includes("redirect: 'manual'") &&
    adminAlertsSource.includes('AbortSignal.timeout(ADMIN_ALERT_FETCH_TIMEOUT_MS)') &&
    adminAlertsSource.includes('const ADMIN_ALERT_FETCH_TIMEOUT_MS = 15_000') &&
    adminAlertsSource.includes('sanitizeTokensInString'),
  'admin alert Telegram fetches must use a bounded timeout, manual redirects and token sanitization'
)
for (const helper of [
  'notifyAdminTicketCreated',
  'notifyAdminTicketReplied',
  'notifyAdminTicketClosed',
  'notifyAdminRecharge',
  'notifyAdminInstancePurchase',
  'notifyAdminPoolOrderPurchase',
  'notifyAdminRenew',
  'notifyAdminRenewBatch',
  'notifyAdminAutoRenewSummary',
  'notifyAdminHostOffline',
  'notifyAdminHostRecovered',
  'notifyAdminInstanceCreated',
  'notifyAdminInstanceCreateFailed'
] as const) {
  assert.ok(
    adminAlertsSource.includes(`export async function ${helper}(`),
    `admin alerts lib must export ${helper}`
  )
}

const channelRouteSource = readServerFile('src/routes/admin-notification-channels.ts')
assert.ok(
  channelRouteSource.includes('enum: [...ADMIN_ALERT_CATEGORIES]') &&
    channelRouteSource.includes("request.query.scope === 'alert'") &&
    channelRouteSource.includes('isGlobal: rawAlertCategory ? false : true') &&
    channelRouteSource.includes('alertCategory: rawAlertCategory') &&
    channelRouteSource.includes('Alert channel for this category already exists'),
  'admin notification channel routes must support alertCategory scoped creation and listing'
)
assert.equal(
  channelRouteSource.match(/OR: \[\{ isGlobal: true \}, \{ alertCategory: \{ not: null \} \}\]/g)?.length ?? 0,
  4,
  'detail, update, delete and test routes must accept both global and alert channels through one scope guard'
)
assert.ok(
  channelRouteSource.includes('const normalized = normalizeGlobalTelegramChannelInput(request.body)') &&
    channelRouteSource.includes('const { name, botToken, chatId } = normalized.value') &&
    channelRouteSource.includes('botToken: botToken || existingConfig.botToken'),
  'existing global channel validation and merge behavior must be preserved'
)

const notificationsDbSource = readServerFile('src/db/notifications.ts')
assert.equal(
  notificationsDbSource.match(/alertCategory: null/g)?.length ?? 0,
  2,
  'personal channel list and personal delivery queries must both exclude alert channels'
)

const instancesSource = readServerFile('src/routes/instances.ts')
assert.ok(
  instancesSource.includes("import { notifyAdminInstanceCreateFailed, notifyAdminInstanceCreated, notifyAdminInstancePurchase } from '../lib/admin-alerts.js'") &&
    instancesSource.includes('void notifyAdminInstancePurchase({') &&
    instancesSource.includes('void notifyAdminInstanceCreated({') &&
    (instancesSource.match(/void notifyAdminInstanceCreateFailed\(\{/g)?.length ?? 0) === 2,
  'instance create flow must hook purchase, success and both failure alert paths'
)

const billingRouteSource = readServerFile('src/routes/instance-billing.ts')
assert.ok(
  billingRouteSource.includes('void notifyAdminRenew({') &&
    billingRouteSource.includes('void notifyAdminRenewBatch({') &&
    billingRouteSource.includes('const renewedItems = results'),
  'manual and batch renewals must push admin payment alerts (batch aggregated)'
)

const schedulerSource = readServerFile('src/services/billing-scheduler.ts')
assert.ok(
  schedulerSource.includes('const autoRenewAlertSummary:') &&
    schedulerSource.includes('autoRenewAlertSummary.successes.length = 0') &&
    schedulerSource.includes('void notifyAdminAutoRenewSummary({') &&
    (schedulerSource.match(/autoRenewAlertSummary\.(successes|failures)\.push\(\{/g)?.length ?? 0) === 3,
  'auto-renew must aggregate outcomes per tick and push one summary alert'
)

const poolOrderSource = readServerFile('src/services/pool-orders.ts')
assert.ok(
  poolOrderSource.includes('void notifyAdminPoolOrderPurchase({') &&
    poolOrderSource.includes('totalCount,') &&
    poolOrderSource.includes('totalYuan,'),
  'pool order checkout must push one aggregated deduction alert'
)

const rechargeSource = readServerFile('src/routes/recharge.ts')
assert.equal(
  rechargeSource.match(/void notifyAdminRecharge\(\{/g)?.length ?? 0,
  2,
  'both online recharge crediting paths must push admin payment alerts'
)

const ticketsSource = readServerFile('src/routes/tickets.ts')
assert.ok(
  ticketsSource.includes('void notifyAdminTicketCreated({') &&
    ticketsSource.includes('void notifyAdminTicketReplied({') &&
    ticketsSource.includes('void notifyAdminTicketClosed({') &&
    ticketsSource.includes('excerpt: content,') &&
    ticketsSource.includes('attachmentCount: uploadedAttachments.length,'),
  'user ticket create, reply and close must push admin ticket alerts with reply excerpt and attachment count'
)
assert.ok(
  adminAlertsSource.includes('内容：') &&
    adminAlertsSource.includes('分类：') &&
    adminAlertsSource.includes('input.content'),
  'admin ticket creation alerts must include category, content excerpt and attachment count'
)

const publicApiSource = readServerFile('src/routes/public-api.ts')
assert.ok(
  publicApiSource.includes('void notifyAdminTicketCreated({') &&
    publicApiSource.includes('void notifyAdminTicketReplied({') &&
    publicApiSource.includes('attachmentCount: uploadedAttachments.length,'),
  'public API ticket create and reply must push admin ticket alerts with attachment count'
)

const workerSource = readServerFile('src/workers/hostOfflineAlertWorker.ts')
assert.ok(
  workerSource.includes('const HOST_OFFLINE_ALERT_AFTER_MS = 3 * 60 * 1000') &&
    workerSource.includes('adminOfflineAlertedAt: now') &&
    workerSource.includes('adminOfflineAlertedAt: { not: null }') &&
    (workerSource.match(/if \(claimed\.count !== 1\) continue/g)?.length ?? 0) === 2 &&
    workerSource.includes('export function startHostOfflineAlertWorker()') &&
    workerSource.includes('export function stopHostOfflineAlertWorker()'),
  'host offline worker must alert once per offline transition, clear on recovery and be start/stoppable'
)

const appSource = readServerFile('src/app.ts')
assert.ok(
  appSource.includes("import { startHostOfflineAlertWorker, stopHostOfflineAlertWorker } from './workers/hostOfflineAlertWorker.js'") &&
    appSource.includes('startHostOfflineAlertWorker()') &&
    appSource.includes('stopHostOfflineAlertWorker()') &&
    (appSource.match(/void notifyAdminInstanceCreateFailed\(\{/g)?.length ?? 0) === 2,
  'app must register the offline worker and alert on create-timeout refusals'
)

const schemaSource = readServerFile('prisma/schema.prisma')
assert.ok(
  schemaSource.includes('alertCategory String? @map("alert_category")') &&
    schemaSource.includes('adminOfflineAlertedAt DateTime? @map("admin_offline_alerted_at")'),
  'schema must store alert category and offline alert marker'
)

const migrationPath = resolve(__dirname, '../prisma/migrations/202610180001_admin_alert_bots/migration.sql')
assert.ok(existsSync(migrationPath), 'admin alert migration file must exist')
const migrationSource = readFileSync(migrationPath, 'utf8')
assert.ok(
  migrationSource.includes('ALTER TABLE "notification_channels" ADD COLUMN "alert_category" TEXT;') &&
    migrationSource.includes('ALTER TABLE "host_agents" ADD COLUMN "admin_offline_alerted_at" TIMESTAMP(3);'),
  'migration must add nullable alert columns only'
)

const viewSource = readRepoFile('client/src/views/admin/AdminAlertsView.vue')
assert.ok(
  viewSource.includes("api.adminNotificationChannels.list('alert')") &&
    viewSource.includes('alertCategory: form.value.category') &&
    viewSource.includes('adminAlerts.'),
  'admin alert settings page must manage the four alert channels through scoped channel APIs'
)

for (const locale of ['zh-CN', 'en', 'zh-TW'] as const) {
  const localeSource = readRepoFile(`client/src/locales/${locale}.ts`)
  assert.ok(localeSource.includes('adminAlerts:'), `${locale} locale must define adminAlerts messages`)
  assert.ok(!localeSource.includes("'admin-alerts'"), `${locale} locale must not contain stray literals`)
}

console.log('admin alert bots guard tests passed')
