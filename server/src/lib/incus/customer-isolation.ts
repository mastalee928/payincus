import type { IncusClient } from './incus-client.js'

type InstanceConfig = {
  type?: unknown
  ephemeral?: unknown
  config?: Record<string, unknown>
  devices?: Record<string, Record<string, unknown>>
  expanded_config?: Record<string, unknown>
  expanded_devices?: Record<string, Record<string, unknown>>
  profiles?: unknown
}

export function rejectCustomerPrivilege(value: unknown): void {
  if (value !== undefined && value !== null && value !== false && value !== 0 && value !== '' && value !== 'false' && value !== '0') {
    throw Object.assign(new Error('客户实例禁止特权模式，请使用非特权容器或 KVM'), { code: 'CUSTOMER_PRIVILEGE_FORBIDDEN' })
  }
}

function forbidden(reason: string): never {
  // Never include raw configuration, paths or guest secrets in errors.
  throw Object.assign(new Error(`客户实例隔离检查未通过：${reason}，请管理员检查宿主配置`), { code: 'CUSTOMER_ISOLATION_UNSAFE' })
}

/** Validate effective configuration, including host profile inheritance. No guest mutation. */
export function assertCustomerIsolation(instance: InstanceConfig): void {
  const config = { ...instance.config, ...instance.expanded_config }
  const devices = { ...instance.devices, ...instance.expanded_devices }
  rejectCustomerPrivilege(config['security.privileged'])
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === null || value === '') continue
    if (key.startsWith('raw.')) forbidden('存在原始宿主配置覆盖')
    if (key === 'security.idmap.base' && (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))) {
      forbidden('UID/GID 映射基址包含宿主 root 或无效范围')
    }
    if (['security.syscalls.intercept.mount', 'security.syscalls.intercept.bpf'].includes(key) &&
      value !== false && value !== 'false' && value !== '0') forbidden('存在额外宿主内核操作授权')
    if (key === 'security.syscalls.allow' || key === 'security.syscalls.deny' || key === 'security.syscalls.blacklist' ||
      key === 'security.syscalls.whitelist') forbidden('存在自定义系统调用策略')
    if (['security.syscalls.deny_default', 'security.syscalls.deny_compat', 'security.syscalls.blacklist_default',
      'security.syscalls.blacklist_compat'].includes(key) && (value === false || value === 'false' || value === '0')) {
      forbidden('系统调用默认保护被关闭')
    }
    if (key.startsWith('security.devlxd') && key !== 'security.devlxd' && value !== false && value !== 'false' && value !== '0') {
      forbidden('额外宿主 API 暴露')
    }
    if (key === 'volatile.idmap.current' || key === 'volatile.idmap.next' || key === 'volatile.last_state.idmap') {
      let maps: unknown
      try { maps = JSON.parse(String(value)) } catch { forbidden('UID/GID 映射无法核验') }
      if (!Array.isArray(maps)) forbidden('UID/GID 映射无法核验')
      for (const map of maps) {
        if (!map || !Number.isSafeInteger(map.Hostid) || map.Hostid <= 0 || !Number.isSafeInteger(map.Maprange) || map.Maprange <= 0) {
          forbidden('UID/GID 映射包含宿主 root 或无效范围')
        }
      }
    }
  }
  for (const device of Object.values(devices)) {
    if (device.type === 'none') continue
    if (device.type === 'disk') {
      if (instance.type === 'virtual-machine' && device.source === 'agent:config') continue
      if (device.path !== '/' || !device.pool || device.source) forbidden('存在宿主目录或额外磁盘挂载')
    } else if (device.type === 'proxy') {
      if (device.bind && device.bind !== 'host') forbidden('存在客机至宿主服务转发')
      if (!/^(tcp|udp):/.test(String(device.listen)) || !/^(tcp|udp):/.test(String(device.connect))) {
        forbidden('存在宿主 Unix socket 转发')
      }
    } else if (device.type === 'nic') {
      if (device.nictype && !['bridged', 'routed', 'p2p', 'macvlan', 'ipvlan'].includes(String(device.nictype))) {
        forbidden('存在宿主物理设备直通')
      }
    } else forbidden('存在宿主设备直通')
  }
}

export async function readCustomerIsolation(client: IncusClient, name: string): Promise<InstanceConfig> {
  const current = await client.request<InstanceConfig>('GET', `/1.0/instances/${encodeURIComponent(name)}`)
  if (!current || !['container', 'virtual-machine'].includes(String(current.type)) || !current.config || !current.devices) {
    forbidden('实例有效配置不完整')
  }
  await assertCustomerProfiles(client, current)
  return current
}

/** Snapshots and requested updates may lack expanded data, so resolve their exact profiles. */
export async function assertCustomerProfiles(client: IncusClient, instance: InstanceConfig): Promise<void> {
  const config: Record<string, unknown> = {}, devices: Record<string, Record<string, unknown>> = {}
  if (instance.profiles !== undefined && !Array.isArray(instance.profiles)) forbidden('profile 列表无效')
  for (const name of (instance.profiles ?? []) as unknown[]) {
    if (typeof name !== 'string' || !name || /[/\\\r\n]/.test(name)) forbidden('profile 名称无效')
    const profile = await client.request<InstanceConfig>('GET', `/1.0/profiles/${encodeURIComponent(name)}`)
    if (!profile || !profile.config || !profile.devices) forbidden('profile 有效配置不完整')
    Object.assign(config, profile.config)
    Object.assign(devices, profile.devices)
  }
  // null/empty deletes an instance override in Incus and reveals its profile
  // value again; it must never mask an inherited privileged/raw setting here.
  for (const [key, value] of Object.entries(instance.config ?? {})) {
    if (value !== undefined && value !== null && value !== '') config[key] = value
  }
  Object.assign(devices, instance.devices)
  assertCustomerIsolation({ ...instance, expanded_config: { ...config, ...instance.expanded_config },
    expanded_devices: { ...devices, ...instance.expanded_devices } })
}
