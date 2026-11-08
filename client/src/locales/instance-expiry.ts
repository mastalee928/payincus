export const zhCN = {
  edit: '修改', title: '修改到期时间', current: '当前到期时间', next: '新的到期时间',
  timezone: '按当前设备时区填写：{zone}', description: '不扣费、不退款，自动续费开关保持不变。',
  effect: '系统到期暂停的实例改到未来后解除暂停，保持关机；手动封停不受影响。',
  past: '这个时间已过去。保存后实例将按现有到期规则自动续费或暂停、到期回收。',
  save: '保存修改', saving: '正在保存…', loading: '正在读取当前到期时间…', retry: '重新读取', cancel: '取消', success: '到期时间已更新',
  errors: {
    EXPIRY_INVALID_DATE: '请填写有效且唯一的日期时间；夏令时跳过或重复的时刻不可使用。', EXPIRY_INVALID_REQUEST: '提交内容无效，请重新打开后填写。',
    EXPIRY_TIMEZONE_CHANGED: '设备时区已变化，请重新读取后填写。',
    EXPIRY_ADMIN_REQUIRED: '管理员权限或登录会话已变化，请重新登录。', EXPIRY_RECOVERY_HELD: '平台正在恢复保护中，完成恢复后再修改。',
    EXPIRY_NOT_FOUND: '实例已不存在，请刷新实例列表。', EXPIRY_NO_DEADLINE: '此实例没有到期时间，无需改期。',
    EXPIRY_DELETING: '实例已删除或正在清理，无法修改到期时间。', EXPIRY_BUSY: '实例正在执行任务、转移或宿主维护，完成后请重新读取。',
    EXPIRY_CHANGED: '实例或到期时间已变化。请重新读取最新时间，再修改。', EXPIRY_SAVE_FAILED: '未能确认保存结果，请重新读取当前到期时间。'
  }
}
export const zhTW = {
  edit: '修改', title: '修改到期時間', current: '目前到期時間', next: '新的到期時間',
  timezone: '按目前裝置時區填寫：{zone}', description: '不扣款、不退款，自動續費開關保持不變。',
  effect: '系統到期暫停的實例改到未來後解除暫停，保持關機；手動停用不受影響。',
  past: '這個時間已過去。儲存後實例將按既有到期規則自動續費或暫停、到期回收。',
  save: '儲存修改', saving: '正在儲存…', loading: '正在讀取目前到期時間…', retry: '重新讀取', cancel: '取消', success: '到期時間已更新',
  errors: {
    EXPIRY_INVALID_DATE: '請填寫有效且唯一的日期時間；夏令時間跳過或重複的時刻不可使用。', EXPIRY_INVALID_REQUEST: '提交內容無效，請重新開啟後填寫。',
    EXPIRY_TIMEZONE_CHANGED: '裝置時區已變更，請重新讀取後填寫。',
    EXPIRY_ADMIN_REQUIRED: '管理員權限或登入工作階段已變更，請重新登入。', EXPIRY_RECOVERY_HELD: '平台正在還原保護中，完成還原後再修改。',
    EXPIRY_NOT_FOUND: '實例已不存在，請重新整理實例清單。', EXPIRY_NO_DEADLINE: '此實例沒有到期時間，無需改期。',
    EXPIRY_DELETING: '實例已刪除或正在清理，無法修改到期時間。', EXPIRY_BUSY: '實例正在執行任務、移轉或宿主維護，完成後請重新讀取。',
    EXPIRY_CHANGED: '實例或到期時間已變更。請重新讀取最新時間，再修改。', EXPIRY_SAVE_FAILED: '未能確認儲存結果，請重新讀取目前到期時間。'
  }
}
export const en = {
  edit: 'Edit', title: 'Change expiry time', current: 'Current expiry', next: 'New expiry',
  timezone: 'Enter the time in your device timezone: {zone}', description: 'No charge or refund. Auto-renew stays unchanged.',
  effect: 'A future expiry clears a system expiry suspension and leaves the instance stopped. Manual suspensions stay in place.',
  past: 'This time is in the past. After saving, normal auto-renewal, suspension and expiry cleanup rules apply.',
  save: 'Save changes', saving: 'Saving…', loading: 'Reading the current expiry…', retry: 'Reload expiry', cancel: 'Cancel', success: 'Expiry time updated',
  errors: {
    EXPIRY_INVALID_DATE: 'Enter a valid, unambiguous date and time. Times skipped or repeated by daylight saving cannot be used.', EXPIRY_INVALID_REQUEST: 'Invalid request. Close and reopen this dialog.',
    EXPIRY_TIMEZONE_CHANGED: 'Your device timezone changed. Reload the expiry before editing.',
    EXPIRY_ADMIN_REQUIRED: 'Your administrator access or session changed. Sign in again.', EXPIRY_RECOVERY_HELD: 'The platform is in recovery protection. Try again after recovery.',
    EXPIRY_NOT_FOUND: 'This instance no longer exists. Refresh the instance list.', EXPIRY_NO_DEADLINE: 'This instance has no expiry to change.',
    EXPIRY_DELETING: 'This instance is deleted or being cleaned up. Its expiry cannot be changed.', EXPIRY_BUSY: 'An instance task, transfer or host maintenance is in progress. Reload after it finishes.',
    EXPIRY_CHANGED: 'The instance or expiry changed. Reload the current expiry before editing.', EXPIRY_SAVE_FAILED: 'The save result could not be confirmed. Reload the current expiry.'
  }
}
