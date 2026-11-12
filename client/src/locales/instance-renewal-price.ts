export const zhCN = {
  label: '续费价格', edit: '修改续费价格', title: '修改续费价格', current: '当前每期价格', next: '新的每期续费价（元）',
  cycle: '每 {months} 个月', description: '仅修改这台实例。保存后，下一次手动或自动续费按新价格结算。',
  effect: '这是用户最终应付价格，不叠加优惠。已付账单、当前到期时间及余额不变，不补扣、不退款。',
  base: '当前为基础价；保存后将作为最终续费价。', zero: '设为 ¥0.00 后，后续续费不扣款。',
  loading: '正在读取价格…', retry: '重新读取价格', cancel: '取消', save: '保存续费价格', saving: '保存中…', success: '续费价格已更新，下次续费生效',
  errors: { RENEWAL_PRICE_INVALID: '请输入 0–100000 元的金额，最多两位小数。', RENEWAL_PRICE_CHANGED: '实例或价格已变化，请重新读取后确认。',
    RENEWAL_PRICE_BUSY: '实例正在处理续费或其它任务，请稍后重试。', RENEWAL_PRICE_ADMIN_REQUIRED: '管理员身份已失效，请重新登录。',
    RENEWAL_PRICE_NOT_FOUND: '实例不存在。', RENEWAL_PRICE_NOT_PAID: '这台实例没有可修改的付费账期。',
    RENEWAL_PRICE_DELETING: '实例已进入删除流程或保留期已结束，不能修改续费价。', RENEWAL_PRICE_RECOVERY_HELD: '平台处于恢复保护中，暂不能修改价格。',
    RENEWAL_PRICE_SAVE_FAILED: '无法确认价格，请重新读取后再试。', RENEWAL_PRICE_INVALID_REQUEST: '请求无效，请重新打开窗口。' }
}
export const zhTW = {
  label: '續費價格', edit: '修改續費價格', title: '修改續費價格', current: '目前每期價格', next: '新的每期續費價（元）',
  cycle: '每 {months} 個月', description: '僅修改這台實例。儲存後，下一次手動或自動續費按新價格結算。',
  effect: '這是用戶最終應付價格，不疊加優惠。已付帳單、目前到期時間及餘額不變，不補扣、不退款。',
  base: '目前為基礎價；儲存後將作為最終續費價。', zero: '設為 ¥0.00 後，後續續費不扣款。',
  loading: '正在讀取價格…', retry: '重新讀取價格', cancel: '取消', save: '儲存續費價格', saving: '儲存中…', success: '續費價格已更新，下次續費生效',
  errors: { RENEWAL_PRICE_INVALID: '請輸入 0–100000 元的金額，最多兩位小數。', RENEWAL_PRICE_CHANGED: '實例或價格已變更，請重新讀取後確認。',
    RENEWAL_PRICE_BUSY: '實例正在處理續費或其他任務，請稍後重試。', RENEWAL_PRICE_ADMIN_REQUIRED: '管理員身分已失效，請重新登入。',
    RENEWAL_PRICE_NOT_FOUND: '實例不存在。', RENEWAL_PRICE_NOT_PAID: '這台實例沒有可修改的付費帳期。',
    RENEWAL_PRICE_DELETING: '實例已進入刪除流程或保留期已結束，不能修改續費價。', RENEWAL_PRICE_RECOVERY_HELD: '平台處於恢復保護中，暫不能修改價格。',
    RENEWAL_PRICE_SAVE_FAILED: '無法確認價格，請重新讀取後再試。', RENEWAL_PRICE_INVALID_REQUEST: '請求無效，請重新開啟視窗。' }
}
export const en = {
  label: 'Renewal price', edit: 'Edit renewal price', title: 'Edit renewal price', current: 'Current price per period', next: 'New renewal price per period (CNY)',
  cycle: 'Every {months} month(s)', description: 'Applies to this instance only. The next manual or automatic renewal uses the saved price.',
  effect: 'This is the final payable price, without additional discounts. Paid bills, the current expiry and balance stay unchanged. No adjustment is charged or refunded.',
  base: 'Currently a base price; saving sets a final renewal price.', zero: 'At ¥0.00, future renewals are free of charge.',
  loading: 'Loading price…', retry: 'Reload price', cancel: 'Cancel', save: 'Save renewal price', saving: 'Saving…', success: 'Price saved for the next renewal',
  errors: { RENEWAL_PRICE_INVALID: 'Enter CNY 0–100000, with at most two decimal places.', RENEWAL_PRICE_CHANGED: 'The instance or price changed. Reload and review it.',
    RENEWAL_PRICE_BUSY: 'A renewal or another operation is in progress. Try again shortly.', RENEWAL_PRICE_ADMIN_REQUIRED: 'Your administrator session is no longer valid. Sign in again.',
    RENEWAL_PRICE_NOT_FOUND: 'Instance not found.', RENEWAL_PRICE_NOT_PAID: 'This instance has no paid billing period to edit.',
    RENEWAL_PRICE_DELETING: 'Deletion has started or retention has ended. Its renewal price cannot be changed.', RENEWAL_PRICE_RECOVERY_HELD: 'Price changes are unavailable during recovery protection.',
    RENEWAL_PRICE_SAVE_FAILED: 'Could not confirm the price. Reload it before trying again.', RENEWAL_PRICE_INVALID_REQUEST: 'Invalid request. Reopen this window.' }
}
