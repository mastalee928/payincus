export const zhCN = {
  managedSetting: '此节点自动同步宿主的 IPv6。请在宿主添加或更换地址；全部地址可在网络信息中查看。',
  title: '公网 IPv6', primary: '主地址', copyAddress: '复制 IPv6 地址 {address}', sync: '立即同步 IPv6', checking: '正在同步 IPv6…',
  checked: '最近检测', empty: '未分配 IPv6', customerPending: 'IPv6 正在配置，确认后会自动显示。', customerFailed: '部分 IPv6 尚未就绪，系统会自动重试。',
  adminHint: '自动同步宿主网卡上实际配置的所有公网 IPv6。新增、更换或移除地址后，无需重新接入；确认云厂商 IPv6 安全组允许所需协议和端口。',
  status: { idle: '等待首次检测', synced: 'IPv6 已同步', pending: 'IPv6 等待重试', failed: 'IPv6 同步未完成', ready: 'IPv6 可用', none: '未分配 IPv6' },
  errors: {
    IPV6_CONTROLLER_NO_ROUTE: '主控仅使用 IPv4，系统会经宿主核验客户 IPv6；配置已保留，系统会自动重试。',
    IPV6_GUEST_PROBE_UNAVAILABLE: '实例缺少 IPv6 核验工具，请检查镜像初始化结果；配置已保留，系统会自动重试。',
    IPV6_GUEST_SSH_FAILED: '实例 IPv6 上的 SSH 握手未通过，请检查实例 SSH 服务；系统会自动重试。',
    IPV6_GUEST_EGRESS_FAILED: '客户实例无法通过 IPv6 访问公网，请检查宿主 IPv6 默认路由及云安全组；系统会自动重试。',
    IPV6_SOURCE_MISMATCH: '客户 IPv6 出口地址与分配地址不一致，请检查宿主转发规则；该地址暂不发布，系统会自动重试。',
    IPV6_IDENTITY_MISMATCH: '公网 IPv6 返回的 SSH 身份与此实例不一致，已停止发布该地址，请核对转发目标。',
    IPV6_AGENT_UPGRADE_REQUIRED: '请更新宿主 Agent，以支持多 IPv6 和重启恢复。', IPV6_NETWORK_PENDING: '等待宿主应用 IPv6 出口与邻居发现规则。', IPV6_SYNC_DEADLINE: '本轮同步超时，系统会分批自动重试。',
    IPV6_MANAGEMENT_UNAVAILABLE: '管理通道暂不可达，恢复后自动重试。', IPV6_INTERFACES_UNAVAILABLE: '无法读取宿主物理网卡，请检查网络。',
    IPV6_INCUS_UPGRADE_REQUIRED: '需要支持 IPv6 转发 SNAT 的 Incus 版本及 nftables。', IPV6_BRIDGE_CONFLICT: '现有 IPv6 网桥配置不兼容，请检查节点网络设置。',
    IPV6_INSTANCE_BUSY: '实例正在执行其他任务，完成后自动同步。', IPV6_INSTANCE_STOPPED: '实例已停止，启动后自动应用地址变更。',
    IPV6_INSTANCE_NOT_READY: '等待实例完成交付。', IPV6_HOST_QUARANTINED: '机器处于故障隔离，请先完成恢复检查。',
    IPV6_PROTOCOL_PENDING: '等待宿主应用 TCP／UDP 策略。', IPV6_GUEST_INITIALIZING: '等待系统初始化完成。',
    IPV6_GUEST_CONFIG_FAILED: '实例内 IPv6 配置失败，请检查系统网络服务。', IPV6_IDENTITY_UNAVAILABLE: '无法读取实例 SSH 身份，请检查 SSH 服务。',
    IPV6_DELIVERY_FAILED: '公网 IPv6 验证未通过。请检查云安全组、IPv6 路由及实例 SSH 端口；系统会自动重试。',
    IPV6_REMOTE_INSTANCE_CONFLICT: '宿主上的实例与平台记录不一致，请先检查。', IPV6_ALREADY_ASSIGNED: '该 IPv6 已被其他机器登记，请检查地址配置。',
    IPV6_TOO_MANY_ADDRESSES: '检测到超过 256 个地址，请检查网卡配置。', IPV6_SYNC_UNSUPPORTED: '该节点使用手动网络配置，不能自动同步。'
  }
}
export const zhTW = {
  managedSetting: '此節點自動同步宿主的 IPv6。請在宿主新增或更換位址；全部位址可在網路資訊中查看。',
  title: '公網 IPv6', primary: '主位址', copyAddress: '複製 IPv6 位址 {address}', sync: '立即同步 IPv6', checking: '正在同步 IPv6…',
  checked: '最近偵測', empty: '未分配 IPv6', customerPending: 'IPv6 正在設定，確認後會自動顯示。', customerFailed: '部分 IPv6 尚未就緒，系統會自動重試。',
  adminHint: '自動同步宿主網卡上實際設定的所有公網 IPv6。新增、更換或移除位址後，無需重新接入；確認雲端 IPv6 安全群組允許所需協定和連接埠。',
  status: { idle: '等待首次偵測', synced: 'IPv6 已同步', pending: 'IPv6 等待重試', failed: 'IPv6 同步未完成', ready: 'IPv6 可用', none: '未分配 IPv6' },
  errors: {
    IPV6_CONTROLLER_NO_ROUTE: '主控僅使用 IPv4，系統會經宿主核驗客戶 IPv6；設定已保留，系統會自動重試。',
    IPV6_GUEST_PROBE_UNAVAILABLE: '實例缺少 IPv6 核驗工具，請檢查映像初始化結果；設定已保留，系統會自動重試。',
    IPV6_GUEST_SSH_FAILED: '實例 IPv6 上的 SSH 握手未通過，請檢查實例 SSH 服務；系統會自動重試。',
    IPV6_GUEST_EGRESS_FAILED: '客戶實例無法透過 IPv6 存取公網，請檢查宿主 IPv6 預設路由及雲安全組；系統會自動重試。',
    IPV6_SOURCE_MISMATCH: '客戶 IPv6 出口位址與分配位址不一致，請檢查宿主轉發規則；該位址暫不發布，系統會自動重試。',
    IPV6_IDENTITY_MISMATCH: '公網 IPv6 回傳的 SSH 身分與此執行個體不一致，已停止發布該位址，請核對轉發目標。',
    IPV6_AGENT_UPGRADE_REQUIRED: '請更新宿主 Agent，以支援多 IPv6 和重新啟動恢復。', IPV6_NETWORK_PENDING: '等待宿主套用 IPv6 出口與鄰居探索規則。', IPV6_SYNC_DEADLINE: '本輪同步逾時，系統會分批自動重試。',
    IPV6_MANAGEMENT_UNAVAILABLE: '管理通道暫不可達，恢復後自動重試。', IPV6_INTERFACES_UNAVAILABLE: '無法讀取宿主實體網卡，請檢查網路。',
    IPV6_INCUS_UPGRADE_REQUIRED: '需要支援 IPv6 轉發 SNAT 的 Incus 版本及 nftables。', IPV6_BRIDGE_CONFLICT: '現有 IPv6 網橋設定不相容，請檢查節點網路設定。',
    IPV6_INSTANCE_BUSY: '執行個體正在執行其他工作，完成後自動同步。', IPV6_INSTANCE_STOPPED: '執行個體已停止，啟動後自動套用位址變更。',
    IPV6_INSTANCE_NOT_READY: '等待執行個體完成交付。', IPV6_HOST_QUARANTINED: '機器處於故障隔離，請先完成恢復檢查。',
    IPV6_PROTOCOL_PENDING: '等待宿主套用 TCP／UDP 規則。', IPV6_GUEST_INITIALIZING: '等待系統初始化完成。',
    IPV6_GUEST_CONFIG_FAILED: '執行個體內 IPv6 設定失敗，請檢查系統網路服務。', IPV6_IDENTITY_UNAVAILABLE: '無法讀取執行個體 SSH 身分，請檢查 SSH 服務。',
    IPV6_DELIVERY_FAILED: '公網 IPv6 驗證未通過。請檢查雲安全群組、IPv6 路由及執行個體 SSH 連接埠；系統會自動重試。',
    IPV6_REMOTE_INSTANCE_CONFLICT: '宿主上的執行個體與平台記錄不一致，請先檢查。', IPV6_ALREADY_ASSIGNED: '該 IPv6 已被其他機器登記，請檢查位址設定。',
    IPV6_TOO_MANY_ADDRESSES: '偵測到超過 256 個位址，請檢查網卡設定。', IPV6_SYNC_UNSUPPORTED: '該節點使用手動網路設定，不能自動同步。'
  }
}
export const en = {
  managedSetting: 'IPv6 is synchronized from this host automatically. Add or change addresses on the host; all addresses are listed in network information.',
  title: 'Public IPv6', primary: 'Primary', copyAddress: 'Copy IPv6 address {address}', sync: 'Sync IPv6 now', checking: 'Syncing IPv6…',
  checked: 'Last checked', empty: 'No IPv6 assigned', customerPending: 'IPv6 is being configured. Verified addresses will appear automatically.', customerFailed: 'Some IPv6 addresses are not ready yet. The system will retry automatically.',
  adminHint: 'All public IPv6 addresses configured on the host interface are synchronized automatically. Adding, changing or removing addresses does not require onboarding again. Allow the required IPv6 protocols and ports in the cloud security group.',
  status: { idle: 'Awaiting first check', synced: 'IPv6 synchronized', pending: 'IPv6 waiting to retry', failed: 'IPv6 sync incomplete', ready: 'IPv6 ready', none: 'No IPv6 assigned' },
  errors: {
    IPV6_CONTROLLER_NO_ROUTE: 'The controller uses IPv4. Customer IPv6 is verified through the host. Configuration is retained and checks retry automatically.',
    IPV6_GUEST_PROBE_UNAVAILABLE: 'The instance is missing IPv6 verification tools. Check image initialization; configuration is retained and checks retry automatically.',
    IPV6_GUEST_SSH_FAILED: 'The instance IPv6 SSH handshake failed. Check its SSH service; checks retry automatically.',
    IPV6_GUEST_EGRESS_FAILED: 'The customer instance cannot reach the internet over IPv6. Check the host default route and cloud firewall; checks retry automatically.',
    IPV6_SOURCE_MISMATCH: 'The customer IPv6 source differs from its assigned address. Check host forwarding rules; this address is withheld and checks retry automatically.',
    IPV6_IDENTITY_MISMATCH: 'The public IPv6 SSH identity differs from this instance. The address is withheld; check its forwarding target.',
    IPV6_AGENT_UPGRADE_REQUIRED: 'Update the host Agent to support multiple IPv6 addresses and boot recovery.', IPV6_NETWORK_PENDING: 'Waiting for host IPv6 source mappings and neighbor discovery rules.', IPV6_SYNC_DEADLINE: 'This sync reached its time limit. Remaining addresses will be retried automatically.',
    IPV6_MANAGEMENT_UNAVAILABLE: 'Management is unreachable. Sync will retry when it recovers.', IPV6_INTERFACES_UNAVAILABLE: 'Cannot read the physical network interfaces. Check the host network.',
    IPV6_INCUS_UPGRADE_REQUIRED: 'Incus with IPv6 forward SNAT support and nftables is required.', IPV6_BRIDGE_CONFLICT: 'The existing IPv6 bridge configuration is incompatible. Check the node network settings.',
    IPV6_INSTANCE_BUSY: 'Another instance task is running. Sync will resume afterward.', IPV6_INSTANCE_STOPPED: 'The instance is stopped. Address changes will be applied after it starts.',
    IPV6_INSTANCE_NOT_READY: 'Waiting for instance delivery.', IPV6_HOST_QUARANTINED: 'The host is quarantined. Complete the recovery checks first.',
    IPV6_PROTOCOL_PENDING: 'Waiting for the host to apply the TCP/UDP policy.', IPV6_GUEST_INITIALIZING: 'Waiting for system initialization.',
    IPV6_GUEST_CONFIG_FAILED: 'Guest IPv6 configuration failed. Check its network services.', IPV6_IDENTITY_UNAVAILABLE: 'Cannot read the instance SSH identity. Check its SSH service.',
    IPV6_DELIVERY_FAILED: 'Public IPv6 verification failed. Check the cloud security group, IPv6 route and instance SSH port. Sync will retry automatically.',
    IPV6_REMOTE_INSTANCE_CONFLICT: 'Host instances differ from platform records. Check the host first.', IPV6_ALREADY_ASSIGNED: 'Another host has registered this IPv6 address. Check the address configuration.',
    IPV6_TOO_MANY_ADDRESSES: 'More than 256 addresses were detected. Check the interface configuration.', IPV6_SYNC_UNSUPPORTED: 'This node uses manual network configuration and cannot be synchronized automatically.'
  }
}
