export const zhCN = {
  title: '到期实例巡检', description: '每 5 分钟核对最新到期日期、封停状态及宿主实际状态。到期补停机，封停满 3 天仍未续费时补删除；连接失败保留占用并重试。',
  enabled: '自动巡检已启用', disabled: '自动巡检已停止', running: '正在巡检', held: '恢复保护中，巡检暂不执行',
  started: '最近开始', finished: '最近结束', next: '下次巡检', failures: '本轮待重试或失败', never: '尚未执行',
  refresh: '刷新状态', start: '启动自动巡检', run: '立即巡检', pending: '正在提交…', loadFailed: '无法读取巡检状态，请刷新重试。',
  actionFailed: '操作未完成，请刷新状态并检查管理员会话。',
  noBackend: '此巡检由主控后端执行。若整个后端停止，请通过服务器管理入口恢复唯一后端；网页无法启动已离线的后端。',
  errorCodes: {
    EXPIRY_REMOTE_STOP_PENDING: '宿主停机尚未完成，后续巡检会重试。', EXPIRY_REMOTE_DELETE_PENDING: '删除回执未确认，保留资源占用等待核验。',
    EXPIRY_HOST_UNAVAILABLE: '宿主暂不可达，保留原实例与库存占用。', EXPIRY_SUSPEND_SCAN_FAILED: '到期状态扫描失败。',
    EXPIRY_DELETE_SCAN_FAILED: '过期删除扫描失败。', EXPIRY_DELETE_RECONCILIATION_PENDING: '删除后的资源核验待完成，库存保持占用。'
  }
}
export const zhTW = {
  title: '到期實例巡檢', description: '每 5 分鐘核對最新到期日期、封停狀態與宿主實際狀態。到期補停機，封停滿 3 天仍未續費時補刪除；連線失敗保留占用並重試。',
  enabled: '自動巡檢已啟用', disabled: '自動巡檢已停止', running: '正在巡檢', held: '復原保護中，巡檢暫不執行',
  started: '最近開始', finished: '最近結束', next: '下次巡檢', failures: '本輪待重試或失敗', never: '尚未執行',
  refresh: '重新整理狀態', start: '啟動自動巡檢', run: '立即巡檢', pending: '正在提交…', loadFailed: '無法讀取巡檢狀態，請重新整理。',
  actionFailed: '操作未完成，請重新整理狀態並檢查管理員工作階段。',
  noBackend: '此巡檢由主控後端執行。若整個後端停止，請透過伺服器管理入口復原唯一後端；網頁無法啟動已離線的後端。',
  errorCodes: {
    EXPIRY_REMOTE_STOP_PENDING: '宿主停機尚未完成，後續巡檢會重試。', EXPIRY_REMOTE_DELETE_PENDING: '刪除回執未確認，保留資源占用等待核驗。',
    EXPIRY_HOST_UNAVAILABLE: '宿主暫不可達，保留原實例與庫存占用。', EXPIRY_SUSPEND_SCAN_FAILED: '到期狀態掃描失敗。',
    EXPIRY_DELETE_SCAN_FAILED: '過期刪除掃描失敗。', EXPIRY_DELETE_RECONCILIATION_PENDING: '刪除後的資源核驗待完成，庫存保持占用。'
  }
}
export const en = {
  title: 'Instance expiry enforcement', description: 'Every 5 minutes, compare current expiry dates, billing suspension and actual host state. Stop expired instances and delete after the existing 3-day suspension period. Failed connections retain allocations for retry.',
  enabled: 'Automatic checks enabled', disabled: 'Automatic checks stopped', running: 'Checking instances', held: 'Checks paused by recovery protection',
  started: 'Last started', finished: 'Last finished', next: 'Next check', failures: 'Pending retries or failures this run', never: 'Not run yet',
  refresh: 'Refresh status', start: 'Start automatic checks', run: 'Check now', pending: 'Submitting…', loadFailed: 'Could not load enforcement status. Refresh to retry.',
  actionFailed: 'Action failed. Refresh status and check your admin session.',
  noBackend: 'Checks run inside the controller backend. If the entire backend stops, restore its single process using server management; an offline backend cannot be started from this page.',
  errorCodes: {
    EXPIRY_REMOTE_STOP_PENDING: 'Host stop is incomplete. Later checks will retry.', EXPIRY_REMOTE_DELETE_PENDING: 'Deletion receipt is unconfirmed. Resource allocations remain reserved.',
    EXPIRY_HOST_UNAVAILABLE: 'Host is unavailable. Instance records and allocations are retained.', EXPIRY_SUSPEND_SCAN_FAILED: 'Expiry state scan failed.',
    EXPIRY_DELETE_SCAN_FAILED: 'Expired deletion scan failed.', EXPIRY_DELETE_RECONCILIATION_PENDING: 'Deletion resource verification is incomplete. Inventory remains reserved.'
  }
}
