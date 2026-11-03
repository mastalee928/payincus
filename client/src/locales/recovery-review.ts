import { zhCN as gateCN, en as gateEN, zhTW as gateTW } from './recovery-gate'
import { zhCN as autoCN, en as autoEN, zhTW as autoTW } from './recovery-automation'
import { zhCN as correctionCN, en as correctionEN, zhTW as correctionTW } from './recovery-reconciliation'
export const zhCN = {
  gate: gateCN,
  reconciliation: correctionCN,
  ...autoCN,
  title: '恢复核对', boundary: '正在按所选备份恢复，数据和原机器连接由系统自动检查，通过后自动恢复运营。',
  loading: '正在读取恢复数据…', failed: '暂时无法读取恢复进度（{code}），系统会自动重新连接。', snapshot: '备份截止时间', balanceTotal: '账户余额合计（平台金额）', instanceTotal: '保留实例',
  snapshotData: '当前为恢复的数据库记录，不能代表快照之后的交易', rollbackData: '当前为回退后的数据库记录', readAt: '读取于',
  hosts: '宿主管理连接', hostBoundary: '核对已登记的管理 SSH 身份和 Incus 证书，比较现存实例。连接通过不等于库存已解除隔离；不使用客户公网 SSH。',
  recordedStatus: '记录状态', quarantined: '库存仍隔离', managementVerified: '管理身份核对通过', managementFailed: '管理连接未通过',
  inventory: '缺少 {missing} 台 · 未登记 {unexpected} 台', probe: '检查 SSH / Incus', noHosts: '当前数据库没有宿主记录。', hostLimit: '系统会自动检查全部宿主。',
  datasets: '恢复数据分类', sections: { balances: '账户余额', instances: '实例到期', recharges: '充值订单', balanceLogs: '余额日志', poolOrders: '机器池订单意向', checkoutOrders: '购买订单', checkoutReceipts: '购买收款', checkoutRefunds: '原路退款' },
  userId: '用户编号', instanceId: '实例编号', expiry: '到期', price: '计费金额', autoRenewOn: '自动续费开启', autoRenewOff: '自动续费关闭',
  cleanupPending: '删除结果待核对，仍占用库存', empty: '当前分类没有记录。', page: '第 {page} / {pages} 页 · 共 {total} 条', previous: '上一页', next: '下一页'
}
export const en = {
  gate: gateEN,
  reconciliation: correctionEN,
  ...autoEN,
  title: 'Recovery review', boundary: 'Restoring the selected backup. Data and original host connections are checked automatically before operations resume.',
  loading: 'Reading restored data…', failed: 'Recovery progress is temporarily unavailable ({code}). Reconnecting automatically.', snapshot: 'Snapshot cutoff', balanceTotal: 'Total account balance (platform units)', instanceTotal: 'Retained instances',
  snapshotData: 'Restored database records do not include transactions after the snapshot', rollbackData: 'Database records after rollback', readAt: 'Read at',
  hosts: 'Host management connections', hostBoundary: 'Verify enrolled management SSH identities and Incus certificates, then compare existing instances. A verified connection does not release inventory quarantine. Customer public SSH is not used.',
  recordedStatus: 'Recorded status', quarantined: 'Inventory remains quarantined', managementVerified: 'Management identity verified', managementFailed: 'Management connection failed',
  inventory: '{missing} missing · {unexpected} unregistered', probe: 'Check SSH / Incus', noHosts: 'No hosts in this database.', hostLimit: 'All hosts are checked automatically.',
  datasets: 'Recovery datasets', sections: { balances: 'Account balances', instances: 'Instance expiry', recharges: 'Recharge orders', balanceLogs: 'Balance ledger', poolOrders: 'Machine checkout intents', checkoutOrders: 'Purchase orders', checkoutReceipts: 'Purchase receipts', checkoutRefunds: 'Payment refunds' },
  userId: 'User ID', instanceId: 'Instance ID', expiry: 'Expires', price: 'Billing amount', autoRenewOn: 'Auto-renew on', autoRenewOff: 'Auto-renew off',
  cleanupPending: 'Deletion awaits verification and still occupies inventory', empty: 'No records in this dataset.', page: 'Page {page} / {pages} · {total} records', previous: 'Previous', next: 'Next'
}
export const zhTW = {
  gate: gateTW,
  reconciliation: correctionTW,
  ...autoTW,
  title: '恢復核對', boundary: '正在依所選備份恢復，資料與原機器連線由系統自動檢查，通過後自動恢復營運。',
  loading: '正在讀取恢復資料…', failed: '暫時無法讀取恢復進度（{code}），系統會自動重新連線。', snapshot: '備份截止時間', balanceTotal: '帳戶餘額合計（平台金額）', instanceTotal: '保留實例',
  snapshotData: '目前為恢復的資料庫記錄，不能代表快照之後的交易', rollbackData: '目前為回退後的資料庫記錄', readAt: '讀取於',
  hosts: '宿主管理連線', hostBoundary: '核對已登記的管理 SSH 身分和 Incus 憑證，比較現存實例。連線通過不等於庫存已解除隔離；不使用客戶公開 SSH。',
  recordedStatus: '記錄狀態', quarantined: '庫存仍隔離', managementVerified: '管理身分核對通過', managementFailed: '管理連線未通過',
  inventory: '缺少 {missing} 台 · 未登記 {unexpected} 台', probe: '檢查 SSH / Incus', noHosts: '目前資料庫沒有宿主記錄。', hostLimit: '系統會自動檢查全部宿主。',
  datasets: '恢復資料分類', sections: { balances: '帳戶餘額', instances: '實例到期', recharges: '儲值訂單', balanceLogs: '餘額日誌', poolOrders: '機器池訂單意向', checkoutOrders: '購買訂單', checkoutReceipts: '購買收款', checkoutRefunds: '原路退款' },
  userId: '使用者編號', instanceId: '實例編號', expiry: '到期', price: '計費金額', autoRenewOn: '自動續費開啟', autoRenewOff: '自動續費關閉',
  cleanupPending: '刪除結果待核對，仍占用庫存', empty: '目前分類沒有記錄。', page: '第 {page} / {pages} 頁 · 共 {total} 筆', previous: '上一頁', next: '下一頁'
}
