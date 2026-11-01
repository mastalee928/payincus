import { zhCN, zhTW, en } from '../locales/expiry-enforcement'

const dictionaries = {
  'zh-CN': { events: zhCN, started: '已开始核对自动续费、到期状态及宿主实际状态。', good: '到期巡检已完成，未发现处理失败。',
    failed: (count: number) => `到期巡检已结束，${count > 0 ? `有 ${count} 项处理未完成` : '有处理步骤未完成'}，后台将在后续巡检中继续核验。`,
    duration: (seconds: string) => `耗时 ${seconds} 秒。`, unavailable: '这条巡检记录不完整，无法确认本轮结果。',
    unknown: '某个处理步骤未完成，后台保留失败记录。' },
  'zh-TW': { events: zhTW, started: '已開始核對自動續費、到期狀態及宿主實際狀態。', good: '到期巡檢已完成，未發現處理失敗。',
    failed: (count: number) => `到期巡檢已結束，${count > 0 ? `有 ${count} 項處理未完成` : '有處理步驟未完成'}，背景將在後續巡檢中繼續核驗。`,
    duration: (seconds: string) => `耗時 ${seconds} 秒。`, unavailable: '這條巡檢記錄不完整，無法確認本輪結果。',
    unknown: '某個處理步驟未完成，背景保留失敗記錄。' },
  en: { events: en, started: 'Started checking automatic renewals, expiry dates and actual host state.', good: 'Expiry inspection completed with no processing failures.',
    failed: (count: number) => `Expiry inspection finished with ${count > 0 ? `${count} incomplete operations` : 'an incomplete processing step'}. Later inspections will continue verification.`,
    duration: (seconds: string) => `Duration: ${seconds} seconds.`, unavailable: 'This inspection record is incomplete; its result cannot be confirmed.',
    unknown: 'A processing step did not finish. The failure record is retained.' }
}
export function expiryLogDisplay(action: string, content: string, locale = 'zh-CN') {
  if (!['system.expiry_enforcement', 'system.expiry_enforcement_started'].includes(action)) return null
  const dict = dictionaries[locale as keyof typeof dictionaries] || dictionaries.en
  try {
    if (content.length > 8192) throw Error('oversized')
    const run = JSON.parse(content)
    if (!run || run.schemaVersion !== 1 || typeof run.runId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(run.runId) ||
        typeof run.startedAt !== 'string' || !Number.isFinite(Date.parse(run.startedAt)) || !Number.isSafeInteger(run.failureCount) || run.failureCount < 0 || run.failureCount > 1000000 ||
        (run.lastError !== null && (typeof run.lastError !== 'string' || !/^EXPIRY_[A-Z_]{1,80}$/.test(run.lastError)))) throw Error('invalid')
    if (action.endsWith('_started')) {
      if (run.finishedAt !== null || run.failureCount !== 0 || run.lastError !== null) throw Error('invalid start')
      return { content: dict.started, result: 'started' }
    }
    const ended = Date.parse(run.finishedAt)
    if (typeof run.finishedAt !== 'string' || !Number.isFinite(ended) || ended < Date.parse(run.startedAt)) throw Error('invalid finish')
    const error = run.lastError ? (dict.events.errorCodes as Record<string, string>)[run.lastError] || dict.unknown : ''
    const failed = run.failureCount > 0 || !!run.lastError
    const summary = failed ? dict.failed(run.failureCount) : dict.good
    return { content: [summary, dict.duration(((ended - Date.parse(run.startedAt)) / 1000).toFixed(2)), error].filter(Boolean).join(' '),
      result: failed ? 'failed' : 'success' }
  } catch { return { content: dict.unavailable, result: 'warning' } }
}
