import { zhCN as correctionCN, en as correctionEN, zhTW as correctionTW } from './recovery-reconciliation'
export const zhCN = {
  reconciliation: correctionCN,
  probeHints: { OSS_REVIEW_MANAGEMENT_REQUIRED: '缺少受信管理身份，请先核对机器池接入登记。', OSS_REVIEW_HOST_UNREACHABLE: '管理通道尚未连通；核对网关 DNS 和端口后重试。', OSS_REVIEW_INVENTORY_MISMATCH: '宿主实例与恢复记录不一致，请核对备份之后的实例和交易。' },
  title: '恢复核对', boundary: '保护仍然启用。先核对备份之后的支付、续费和库存；账户修订须提供外部凭证，检查连接不会启停实例。',
  loading: '正在读取恢复数据…', failed: '恢复核对未完成（{code}），请重试。', snapshot: '备份截止时间', balanceTotal: '账户余额合计（平台金额）', instanceTotal: '保留实例',
  snapshotData: '当前为恢复的数据库记录，不能代表快照之后的交易', rollbackData: '当前为回退后的数据库记录', readAt: '读取于',
  hosts: '宿主管理连接', hostBoundary: '核对已登记的管理 SSH 身份和 Incus 证书，比较现存实例。连接通过不等于库存已解除隔离；不使用客户公网 SSH。',
  recordedStatus: '记录状态', quarantined: '库存仍隔离', managementVerified: '管理身份核对通过', managementFailed: '管理连接未通过',
  inventory: '缺少 {missing} 台 · 未登记 {unexpected} 台', probe: '检查 SSH / Incus', noHosts: '当前数据库没有宿主记录。', hostLimit: '已显示前 200 台宿主；其余宿主仍需另行核对。',
  datasets: '恢复数据分类', sections: { balances: '账户余额', instances: '实例到期', recharges: '充值订单', balanceLogs: '余额日志', poolOrders: '机器池订单意向' },
  userId: '用户编号', instanceId: '实例编号', expiry: '到期', price: '计费金额', autoRenewOn: '自动续费开启', autoRenewOff: '自动续费关闭',
  cleanupPending: '删除结果待核对，仍占用库存', empty: '当前分类没有记录。', page: '第 {page} / {pages} 页 · 共 {total} 条', previous: '上一页', next: '下一页'
}
export const en = {
  reconciliation: correctionEN,
  probeHints: { OSS_REVIEW_MANAGEMENT_REQUIRED: 'Trusted management identity is missing. Review machine enrollment.', OSS_REVIEW_HOST_UNREACHABLE: 'Management is unreachable. Check gateway DNS and ports, then retry.', OSS_REVIEW_INVENTORY_MISMATCH: 'Host instances differ from restored records. Reconcile instances and transactions after the snapshot.' },
  title: 'Recovery review', boundary: 'Protection remains active. Review payments, renewals and inventory after the snapshot. Account corrections require independent evidence; connection checks do not start or stop instances.',
  loading: 'Reading restored data…', failed: 'Recovery review did not complete ({code}). Retry.', snapshot: 'Snapshot cutoff', balanceTotal: 'Total account balance (platform units)', instanceTotal: 'Retained instances',
  snapshotData: 'Restored database records do not include transactions after the snapshot', rollbackData: 'Database records after rollback', readAt: 'Read at',
  hosts: 'Host management connections', hostBoundary: 'Verify enrolled management SSH identities and Incus certificates, then compare existing instances. A verified connection does not release inventory quarantine. Customer public SSH is not used.',
  recordedStatus: 'Recorded status', quarantined: 'Inventory remains quarantined', managementVerified: 'Management identity verified', managementFailed: 'Management connection failed',
  inventory: '{missing} missing · {unexpected} unregistered', probe: 'Check SSH / Incus', noHosts: 'No hosts in this database.', hostLimit: 'The first 200 hosts are shown. Remaining hosts still require review.',
  datasets: 'Recovery datasets', sections: { balances: 'Account balances', instances: 'Instance expiry', recharges: 'Recharge orders', balanceLogs: 'Balance ledger', poolOrders: 'Machine checkout intents' },
  userId: 'User ID', instanceId: 'Instance ID', expiry: 'Expires', price: 'Billing amount', autoRenewOn: 'Auto-renew on', autoRenewOff: 'Auto-renew off',
  cleanupPending: 'Deletion awaits verification and still occupies inventory', empty: 'No records in this dataset.', page: 'Page {page} / {pages} · {total} records', previous: 'Previous', next: 'Next'
}
export const zhTW = {
  reconciliation: correctionTW,
  probeHints: { OSS_REVIEW_MANAGEMENT_REQUIRED: '缺少受信管理身分，請先核對機器池接入登記。', OSS_REVIEW_HOST_UNREACHABLE: '管理通道尚未連通；核對網關 DNS 和連接埠後重試。', OSS_REVIEW_INVENTORY_MISMATCH: '宿主實例與恢復記錄不一致，請核對備份之後的實例和交易。' },
  title: '恢復核對', boundary: '保護仍然啟用。先核對備份之後的支付、續費和庫存；帳戶修訂須提供外部憑證，檢查連線不會啟停實例。',
  loading: '正在讀取恢復資料…', failed: '恢復核對未完成（{code}），請重試。', snapshot: '備份截止時間', balanceTotal: '帳戶餘額合計（平台金額）', instanceTotal: '保留實例',
  snapshotData: '目前為恢復的資料庫記錄，不能代表快照之後的交易', rollbackData: '目前為回退後的資料庫記錄', readAt: '讀取於',
  hosts: '宿主管理連線', hostBoundary: '核對已登記的管理 SSH 身分和 Incus 憑證，比較現存實例。連線通過不等於庫存已解除隔離；不使用客戶公開 SSH。',
  recordedStatus: '記錄狀態', quarantined: '庫存仍隔離', managementVerified: '管理身分核對通過', managementFailed: '管理連線未通過',
  inventory: '缺少 {missing} 台 · 未登記 {unexpected} 台', probe: '檢查 SSH / Incus', noHosts: '目前資料庫沒有宿主記錄。', hostLimit: '已顯示前 200 台宿主；其餘宿主仍須另行核對。',
  datasets: '恢復資料分類', sections: { balances: '帳戶餘額', instances: '實例到期', recharges: '儲值訂單', balanceLogs: '餘額日誌', poolOrders: '機器池訂單意向' },
  userId: '使用者編號', instanceId: '實例編號', expiry: '到期', price: '計費金額', autoRenewOn: '自動續費開啟', autoRenewOff: '自動續費關閉',
  cleanupPending: '刪除結果待核對，仍占用庫存', empty: '目前分類沒有記錄。', page: '第 {page} / {pages} 頁 · 共 {total} 筆', previous: '上一頁', next: '下一頁'
}
