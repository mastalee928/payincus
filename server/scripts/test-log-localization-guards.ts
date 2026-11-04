import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizeLogContentForStorage } from '../src/lib/log-localization.js'
import assert from 'node:assert/strict'
import { expiryLogDisplay } from '../../client/src/utils/expiry-log-display.js'
import { formatLogContent } from '../../client/src/utils/log-format.js'
import { automaticOperationAudit } from '../src/lib/automatic-operation-audit.js'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function assertIncludes(file: string, needle: string, message: string): void {
  const content = read(file)
  if (!content.includes(needle)) {
    throw new Error(`${message}: ${file} 缺少 ${needle}`)
  }
}

function assertEqual(actual: string, expected: string, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected=${expected} actual=${actual}`)
  }
}

assertIncludes(
  'client/src/views/LogsView.vue',
  "formatLogModule(module, tm('logModules') as Record<string, unknown>)",
  '日志模块必须使用翻译表展示'
)
assertIncludes(
  'client/src/views/LogsView.vue',
  "formatLogAction(action, tm('logActions') as Record<string, unknown>)",
  '日志操作必须使用翻译表展示'
)
assertIncludes(
  'client/src/views/LogsView.vue',
  'formatLogContent(log.content, log.action, locale.value)',
  '日志内容必须使用中文化格式化器展示'
)
assertIncludes(
  'server/src/db/logs.ts',
  'const normalizedContent = normalizeLogContentForStorage(content)',
  '新日志入库前必须中文化常见英文模板'
)

for (const localeFile of ['client/src/locales/zh-CN.ts', 'client/src/locales/en.ts', 'client/src/locales/zh-TW.ts']) {
  for (const key of [
    'instance.batch_delete',
    'host.image_policy',
    'system.update.start',
    'plan.create',
    'host.verify'
  ]) {
    assertIncludes(localeFile, `'${key}'`, `日志操作翻译缺失 ${key}`)
  }
}

assertEqual(
  normalizeLogContentForStorage('Batch deleted instance "123" on host "JPIIJ-01"'),
  '批量删除节点 "JPIIJ-01" 上的实例 "123"',
  '批量删除日志内容应中文化'
)
assertEqual(
  normalizeLogContentForStorage('Updated image policy for host "JPIIJ-01" with 4 image(s)'),
  '更新节点 "JPIIJ-01" 的镜像策略，共 4 个镜像',
  '镜像策略日志内容应中文化'
)
assertEqual(
  normalizeLogContentForStorage('Started system update from v0.1.2 to v0.1.3'),
  '开始系统更新：v0.1.2 -> v0.1.3',
  '系统更新日志内容应中文化'
)
assertEqual(
  normalizeLogContentForStorage('Failed to create instance "123": Failed creating instance record: Instance type "virtual-machine" is not supported on this server: KVM support is missing (no /dev/kvm)'),
  '创建实例 "123" 失败：创建实例记录失败：当前服务器不支持虚拟机实例类型：缺少 KVM 支持（没有 /dev/kvm）',
  '实例创建失败日志内容应中文化'
)

const run = { schemaVersion: 1, runId: '943be41c-5c73-4be3-8aea-91b96e528245', startedAt: '2026-11-01T16:35:00.012Z',
  finishedAt: '2026-11-01T16:35:00.039Z', failureCount: 0, lastError: null }
const action = 'system.expiry_enforcement'
assert.equal(expiryLogDisplay(action, JSON.stringify(run))?.result, 'success')
assert.match(formatLogContent(JSON.stringify(run), action), /到期巡检已完成，未发现处理失败/)
assert.ok(!formatLogContent(JSON.stringify(run), action).includes('schemaVersion'))
assert.equal(expiryLogDisplay(action + '_started', JSON.stringify({ ...run, finishedAt: null }))?.result, 'started', 'old warning start records display as started without changing the historical row')
assert.match(expiryLogDisplay(action, JSON.stringify({ ...run, failureCount: 2, lastError: 'EXPIRY_REMOTE_DELETE_PENDING' }))!.content, /2 项.*删除回执/)
assert.equal(expiryLogDisplay(action, JSON.stringify({ ...run, failureCount: 0, lastError: 'EXPIRY_REMOTE_DELETE_PENDING' }))?.result, 'failed', 'an error is never disguised by a zero counter')
assert.ok(!expiryLogDisplay(action, JSON.stringify({ ...run, failureCount: 0, lastError: 'EXPIRY_REMOTE_DELETE_PENDING' }))?.content.includes('0 项'))
assert.equal(expiryLogDisplay(action + '_started', JSON.stringify({ ...run, finishedAt: null, failureCount: 1 }))?.result, 'warning')
for (const record of [{ ...run, failureCount: -1 }, { ...run, finishedAt: null }, { ...run, startedAt: 'invalid' },
  { ...run, finishedAt: '2020-01-01' }, { ...run, lastError: '<script>private-value</script>' }]) {
  const formatted = expiryLogDisplay(action, JSON.stringify(record))!
  assert.equal(formatted.result, 'warning'); assert.ok(!formatted.content.includes('private-value'))
}
for (const locale of ['zh-CN', 'zh-TW', 'en']) {
  assert.ok(expiryLogDisplay(action, JSON.stringify(run), locale)?.content)
  assert.ok(!expiryLogDisplay(action, '{broken', locale)?.content.includes('{broken'))
}
assert.equal(expiryLogDisplay('instance.create', JSON.stringify(run)), null, 'only known structured events receive this renderer')
const audit = automaticOperationAudit({ hostId: 32, hostName: '本地样例', stage: '核验磁盘释放', attempt: 2,
  result: '已安排重试', error: 'INCUS_STORAGE_STATE_UNKNOWN', nextAttemptAt: '2026-11-02T01:00:00.000Z' })
assert.match(audit, /宿主未返回有效的存储清单/)
assert.ok(!audit.includes('INCUS_STORAGE_STATE_UNKNOWN'))
assert.ok(!formatLogContent(audit, 'host.pool.cleanup_retry').includes('T01:00:00.000Z'))
for (const locale of ['zh-CN', 'zh-TW', 'en']) {
  const confirmed = formatLogContent('Host #32 public IPv4 verified and updated: 1.1.1.1 -> 1.1.1.2; management address and customer instance retained', 'host.public_ip.synced', locale)
  assert.ok(confirmed.includes('1.1.1.1 -> 1.1.1.2'))
  assert.ok(!confirmed.includes('management address'))
  const observed = formatLogContent('Host #32: observed IPv4 1.1.1.2; ingress pending; reason IP_SSH_UNREACHABLE; next check 2026-11-04T13:30:00.000Z; instance and management identity retained', 'host.public_ip.observed', locale)
  assert.ok(observed.includes('1.1.1.2'))
  assert.ok(!observed.includes('IP_SSH_UNREACHABLE') && !observed.includes('T13:30:00.000Z'))
}
assert.match(automaticOperationAudit({ hostId: 32, hostName: '本地样例', stage: '核验', attempt: 1, result: '重试', error: 'unknown-instance,volumes' }), /无法确认为原任务目标的实例.*存储卷/)
console.log('Log localization guards passed, including historical patrol JSON, start/result semantics and malformed records')
