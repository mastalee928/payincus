export const zhCN = {
  title: '更换网关域名', open: '更换域名', current: '当前域名', next: '新域名', apply: '检查并更换', working: '正在处理…',
  hint: '先将新域名直接解析到这台网关的当前公网 IPv4。所有核验通过前请保留旧域名。',
  consoleScope: '更换这台网关的独立管理页面域名。网关角色和宿主管理绑定保持原配置。',
  credentials: '此网关需要补齐自动维护通道。仅本次填写 root 密码，后续更换无需再填。', password: '此网关的 root 密码',
  retry: '继续处理', refresh: '刷新结果', saved: '更换请求已保存，系统将自动应用和核验。',
  failures: '临时故障会自动退避重试；身份或域名指向不符时保留原配置，请按提示处理。',
  attempts: '已尝试 {count} 次', nextRetry: '下次自动重试：{time}', loadFailed: '暂时无法读取域名状态，请刷新重试。',
  error: '未完成更换，请刷新结果并查看具体原因。', details: '连接明细', showAll: '显示全部', attention: '仅显示未完成', noMatches: '没有符合搜索条件的宿主。', none: '全部宿主已完成同步。',
  states: { idle: '尚未变更', queued: '等待处理', running: '正在检查和应用', retrying: '等待自动重试', succeeded: '已核验生效', failed: '需要处理' },
  errors: {
    GATEWAY_TASK_APPROVAL_EXPIRED: '此任务的管理员授权已过期。请重新登录后点击继续处理，以原任务恢复操作。',
    GATEWAY_DNS_HELPER_UPGRADE_REQUIRED: '请填写此网关的 root 密码，系统会补齐维护通道并继续更换。',
    GATEWAY_DNS_LOCAL_HELPER_OUTDATED: '本机网关组件尚未更新完整。请完成面板更新后重试，无需填写本机 SSH。',
    SSH_CONNECT_FAILED: '暂时无法连接这台网关。系统将自动重试，请检查它的网络和 SSH 服务。',
    SSH_AUTH_FAILED: '网关没有接受此密码或管理密钥。请核对这台机器的 root 密码后重试。',
    SSH_HOST_KEY_CHANGED: '网关 SSH 身份与登记记录不同。请核对机器，原身份不会被自动替换。',
    GATEWAY_DOMAIN_VERIFY_FAILED: '新的管理页面尚未通过 HTTPS 核验。系统会自动重试，请检查网关防火墙和服务状态。',
    GATEWAY_DOMAIN_CREDENTIALS_EXPIRED: '一次性密码已过期。请重新填写这台网关的 root 密码继续。',
    GATEWAY_TASK_ADMIN_REQUIRED: '当前账户已不能执行此操作，请用有效管理员账户重新提交。',
    GATEWAY_TASK_JOURNAL_BUSY: '这台网关正在处理另一个任务。请等待其完成后重试。',
    GATEWAY_DOMAIN_CHANNEL_CONFLICT: '已有管理通道与登记信息冲突，请检查原网关配置。系统不会覆盖其他通道。',
    GATEWAY_DNS_CONFIG_CONFLICT: '域名已在其他窗口更改，请刷新后核对。', GATEWAY_DNS_TARGET_MISMATCH: '新域名没有指向当前网关，请修正 DNS 后重试。',
    GATEWAY_DOMAIN_MANAGEMENT_KEY_MISSING: '主控缺少已登记的管理密钥，请先恢复原管理身份。',
    GATEWAY_DOMAIN_DNS_MISMATCH: '新域名没有指向这台网关，请修正 DNS 后重试。',
    GATEWAY_DOMAIN_CONFLICT: '网关配置已有变化，请刷新后核对新旧域名。',
    GATEWAY_DOMAIN_CREDENTIALS_REQUIRED: '需要此网关的 root 密码补齐自动维护通道。',
    GATEWAY_DOMAIN_IDENTITY_MISMATCH: '网关身份与登记记录不同。请核对机器，系统不会自动接受新身份。'
  }
}
export const zhTW = {
  title: '更換網關網域', open: '更換網域', current: '目前網域', next: '新網域', apply: '檢查並更換', working: '正在處理…',
  hint: '先將新網域直接解析至這台網關目前的公網 IPv4。所有核驗通過前請保留舊網域。',
  consoleScope: '更換這台網關獨立管理頁面的網域。網關角色及宿主管理綁定保持原設定。',
  credentials: '此網關需要補齊自動維護通道。僅本次填寫 root 密碼，後續更換無需再填。', password: '此網關的 root 密碼',
  retry: '繼續處理', refresh: '重新整理結果', saved: '更換請求已儲存，系統將自動套用與核驗。',
  failures: '暫時故障會自動退避重試；身分或網域指向不符時保留原設定，請依提示處理。',
  attempts: '已嘗試 {count} 次', nextRetry: '下次自動重試：{time}', loadFailed: '暫時無法讀取網域狀態，請重新整理後重試。',
  error: '未完成更換，請重新整理結果並查看原因。', details: '連線明細', showAll: '顯示全部', attention: '僅顯示未完成', noMatches: '沒有符合搜尋條件的宿主。', none: '全部宿主已完成同步。',
  states: { idle: '尚未變更', queued: '等待處理', running: '正在檢查與套用', retrying: '等待自動重試', succeeded: '已核驗生效', failed: '需要處理' },
  errors: {
    GATEWAY_TASK_APPROVAL_EXPIRED: '此任務的管理員授權已過期。請重新登入後點擊繼續處理，以原任務恢復操作。',
    GATEWAY_DNS_HELPER_UPGRADE_REQUIRED: '請填寫此網關的 root 密碼，系統會補齊維護通道並繼續更換。',
    GATEWAY_DNS_LOCAL_HELPER_OUTDATED: '本機網關元件尚未更新完整。請完成面板更新後重試，無需填寫本機 SSH。',
    SSH_CONNECT_FAILED: '暫時無法連線至這台網關。系統將自動重試，請檢查網路與 SSH 服務。',
    SSH_AUTH_FAILED: '網關未接受此密碼或管理金鑰。請核對這台機器的 root 密碼後重試。',
    SSH_HOST_KEY_CHANGED: '網關 SSH 身分與登記記錄不同。請核對機器，原身分不會自動替換。',
    GATEWAY_DOMAIN_VERIFY_FAILED: '新的管理頁面尚未通過 HTTPS 核驗。系統會自動重試，請檢查防火牆與服務狀態。',
    GATEWAY_DOMAIN_CREDENTIALS_EXPIRED: '一次性密碼已過期。請重新填寫這台網關的 root 密碼繼續。',
    GATEWAY_TASK_ADMIN_REQUIRED: '目前帳戶已無法執行此操作，請以有效管理員帳戶重新提交。',
    GATEWAY_TASK_JOURNAL_BUSY: '這台網關正在處理另一個任務。請等候完成後重試。',
    GATEWAY_DOMAIN_CHANNEL_CONFLICT: '既有管理通道與登記資訊衝突，請檢查原網關設定。系統不會覆蓋其他通道。',
    GATEWAY_DNS_CONFIG_CONFLICT: '網域已在其他視窗更改，請重新整理並核對。', GATEWAY_DNS_TARGET_MISMATCH: '新網域沒有指向目前網關，請修正 DNS 後重試。',
    GATEWAY_DOMAIN_MANAGEMENT_KEY_MISSING: '主控缺少已登記的管理金鑰，請先恢復原管理身分。',
    GATEWAY_DOMAIN_DNS_MISMATCH: '新網域沒有指向這台網關，請修正 DNS 後重試。',
    GATEWAY_DOMAIN_CONFLICT: '網關設定已有變化，請重新整理並核對新舊網域。',
    GATEWAY_DOMAIN_CREDENTIALS_REQUIRED: '需要此網關的 root 密碼補齊自動維護通道。',
    GATEWAY_DOMAIN_IDENTITY_MISMATCH: '網關身分與登記記錄不同。請核對機器，系統不會自動接受新身分。'
  }
}
export const en = {
  title: 'Change gateway domain', open: 'Change domain', current: 'Current domain', next: 'New domain', apply: 'Check and change', working: 'Working…',
  hint: 'Point the new domain directly to this gateway’s current public IPv4 first. Keep the old domain until every verification passes.',
  consoleScope: 'Changes this gateway’s separate management page domain. Its role and host management bindings are preserved.',
  credentials: 'This gateway needs its automatic maintenance channel installed. Enter its root password once; future changes will not need it.', password: 'This gateway’s root password',
  retry: 'Continue', refresh: 'Refresh results', saved: 'Change requested. The system will apply and verify it automatically.',
  failures: 'Temporary faults retry with backoff. Identity or DNS conflicts preserve the old settings and need your attention.',
  attempts: '{count} attempts', nextRetry: 'Next automatic retry: {time}', loadFailed: 'Could not read domain status. Refresh to retry.',
  error: 'The change did not complete. Refresh results and review the cause.', details: 'Connection details', showAll: 'Show all', attention: 'Incomplete only', noMatches: 'No hosts match this search.', none: 'All hosts are synchronized.',
  states: { idle: 'No change requested', queued: 'Queued', running: 'Checking and applying', retrying: 'Automatic retry scheduled', succeeded: 'Verified and applied', failed: 'Needs attention' },
  errors: {
    GATEWAY_TASK_APPROVAL_EXPIRED: 'Administrator approval has expired. Sign in again and continue the original task.',
    GATEWAY_DNS_HELPER_UPGRADE_REQUIRED: 'Enter this gateway’s root password to install its maintenance channel and continue.',
    GATEWAY_DNS_LOCAL_HELPER_OUTDATED: 'The local gateway helpers are outdated. Complete the panel update and retry; local SSH credentials are not needed.',
    SSH_CONNECT_FAILED: 'Cannot connect to this gateway yet. Retrying automatically; check its network and SSH service.',
    SSH_AUTH_FAILED: 'The gateway rejected the password or management key. Check this machine’s root password and retry.',
    SSH_HOST_KEY_CHANGED: 'The gateway SSH identity differs from its registered record. Review the machine; the existing identity will be preserved.',
    GATEWAY_DOMAIN_VERIFY_FAILED: 'The new management page has not passed HTTPS verification. Retrying automatically; check the gateway firewall and services.',
    GATEWAY_DOMAIN_CREDENTIALS_EXPIRED: 'The one-time password expired. Enter this gateway’s root password again to continue.',
    GATEWAY_TASK_ADMIN_REQUIRED: 'This account can no longer perform the operation. Submit it again from an authorized administrator session.',
    GATEWAY_TASK_JOURNAL_BUSY: 'Another task is running on this gateway. Wait for it to finish and retry.',
    GATEWAY_DOMAIN_CHANNEL_CONFLICT: 'The existing maintenance channel conflicts with the registered configuration. Review the original gateway; other channels will not be overwritten.',
    GATEWAY_DNS_CONFIG_CONFLICT: 'The domain changed in another window. Refresh and review it.', GATEWAY_DNS_TARGET_MISMATCH: 'The new domain does not point to the current gateway. Correct DNS and retry.',
    GATEWAY_DOMAIN_MANAGEMENT_KEY_MISSING: 'The controller lacks its registered management key. Restore the original identity first.',
    GATEWAY_DOMAIN_DNS_MISMATCH: 'The new domain does not point to this gateway. Correct DNS and retry.',
    GATEWAY_DOMAIN_CONFLICT: 'Gateway settings changed. Refresh and review the old and new domains.',
    GATEWAY_DOMAIN_CREDENTIALS_REQUIRED: 'Enter this gateway’s root password to install its maintenance channel.',
    GATEWAY_DOMAIN_IDENTITY_MISMATCH: 'Gateway identity differs from the registered record. Review the machine; the new identity will not be trusted automatically.'
  }
}
const errorAliases = {
  GATEWAY_WEB_SESSION_REQUIRED: 'GATEWAY_TASK_ADMIN_REQUIRED', GATEWAY_TASK_CREDENTIALS_CHANGED: 'GATEWAY_TASK_ADMIN_REQUIRED',
  SSH_DISCONNECTED: 'SSH_CONNECT_FAILED', SSH_COMMAND_TIMEOUT: 'SSH_CONNECT_FAILED', SSH_KEYSCAN_FAILED: 'SSH_CONNECT_FAILED',
  SSH_FINGERPRINT_MISMATCH: 'SSH_HOST_KEY_CHANGED', GATEWAY_DOMAIN_IDENTITY_CHANGED: 'GATEWAY_DOMAIN_IDENTITY_MISMATCH',
  GATEWAY_DNS_HOST_IDENTITY_CHANGED: 'GATEWAY_DOMAIN_IDENTITY_MISMATCH', GATEWAY_DNS_LOOKUP_FAILED: 'GATEWAY_DOMAIN_DNS_MISMATCH',
  GATEWAY_DOMAIN_WORKER_INTERRUPTED: 'SSH_CONNECT_FAILED', GATEWAY_DOMAIN_TIMEOUT: 'SSH_CONNECT_FAILED',
  GATEWAY_DOMAIN_COMMAND_FAILED: 'GATEWAY_DOMAIN_VERIFY_FAILED', GATEWAY_DOMAIN_IO_FAILED: 'GATEWAY_DOMAIN_VERIFY_FAILED',
  GATEWAY_DOMAIN_COMMIT_UNCERTAIN: 'GATEWAY_DOMAIN_VERIFY_FAILED', GATEWAY_DOMAIN_ROLLBACK_FAILED: 'GATEWAY_DOMAIN_VERIFY_FAILED',
  GATEWAY_DOMAIN_BUSY: 'GATEWAY_TASK_JOURNAL_BUSY'
} as const
for (const messages of [zhCN, zhTW, en]) {
  const errors = messages.errors as Record<string, string>
  for (const [code, source] of Object.entries(errorAliases)) errors[code] = errors[source]
}
