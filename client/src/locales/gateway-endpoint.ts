export const zhCN = {
  title: '固定网关域名', description: '主控兼任网关时，换机恢复后把这个域名解析到新主控公网 IP。宿主需要预先安装域名重解析服务。',
  hostname: '网关域名', port: 'UDP 端口', save: '保存域名', saving: '正在核对并保存…', current: '当前接入地址',
  hint: '只填域名，关闭 Cloudflare 代理。首次保存时域名需指向当前网关，端口需与现有网关一致。',
  saved: '域名已保存，新接入使用此地址。已有宿主仍需逐台补装并验收，保存设置不会自动迁移旧连接。',
  pending: '已有宿主的域名重解析补装仍需核验。', loadFailed: '无法读取网关域名设置。', saveFailed: '保存失败，请核对 DNS 指向、UDP 端口及网关连接。',
  reload: '重新读取', hosts: '宿主域名重解析', install: '补装并核验', installed: '补装已确认', notInstalled: '尚未补装',
  unavailable: '缺少已核实的管理通道，无法自动补装', installing: '正在补装…', noHosts: '暂无已接入宿主', hostFailed: '宿主补装未完成，请核对管理通道后重试。'
}
export const zhTW = {
  title: '固定網關網域', description: '主控兼任網關時，換機恢復後將此網域解析至新主控公網 IP。宿主需預先安裝網域重新解析服務。',
  hostname: '網關網域', port: 'UDP 連接埠', save: '儲存網域', saving: '正在核對並儲存…', current: '目前接入位址',
  hint: '只填網域，關閉 Cloudflare 代理。首次儲存時網域需指向目前網關，連接埠需與現有網關一致。',
  saved: '網域已儲存，新接入使用此位址。既有宿主仍需逐台補裝並驗收，儲存設定不會自動遷移舊連線。',
  pending: '既有宿主的網域重新解析補裝仍需核驗。', loadFailed: '無法讀取網關網域設定。', saveFailed: '儲存失敗，請核對 DNS 指向、UDP 連接埠及網關連線。', reload: '重新讀取',
  hosts: '宿主網域重新解析', install: '補裝並核驗', installed: '補裝已確認', notInstalled: '尚未補裝', unavailable: '缺少已核實的管理通道，無法自動補裝', installing: '正在補裝…', noHosts: '暫無已接入宿主', hostFailed: '宿主補裝未完成，請核對管理通道後重試。'
}
export const en = {
  title: 'Permanent gateway domain', description: 'For a controller that also hosts the gateway, point this domain to the replacement public IP after recovery. Hosts require the DNS refresh service in advance.',
  hostname: 'Gateway domain', port: 'UDP port', save: 'Save domain', saving: 'Checking and saving…', current: 'Current onboarding endpoint',
  hint: 'Enter a domain without a URL scheme. Disable the Cloudflare proxy. Initially it must resolve to the current gateway and use its existing UDP port.',
  saved: 'Domain saved for new hosts. Existing hosts still require installation and verification; saving does not migrate their connections.',
  pending: 'DNS refresh installation on existing hosts still requires verification.', loadFailed: 'Could not load gateway domain settings.', saveFailed: 'Could not save. Check the DNS target, UDP port and gateway connection.', reload: 'Reload',
  hosts: 'Host DNS refresh', install: 'Install and verify', installed: 'Installation confirmed', notInstalled: 'Not installed', unavailable: 'No verified management channel for automatic installation', installing: 'Installing…', noHosts: 'No enrolled hosts', hostFailed: 'Host installation did not complete. Check the management channel and retry.'
}
