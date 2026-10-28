import { createHash } from 'node:crypto'
import { IncusApiError, type IncusClient } from './incus-client.js'
import type { IncusInstance } from '../../types/incus.js'

export type RestoreInstanceIdentity = { uuid: string; type: string; pool: string; configurationHash: string }
const safeName = (name: string) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)
export function restoreInstancePath(name: string) {
  if (!safeName(name)) throw new Error('恢复实例名称无效')
  return `/1.0/instances/${encodeURIComponent(name)}`
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => [k, canonical(v)]))
  return value
}

/** Hash device and runtime network/resource identity without persisting guest configuration or secrets. */
export async function readRestoreIdentity(client: IncusClient, name: string, expected?: RestoreInstanceIdentity, stopped = false) {
  const remote = await client.request<IncusInstance>('GET', restoreInstancePath(name), null, 30000)
  const config = remote.expanded_config ?? remote.config ?? {}
  const uuid = config['volatile.uuid'] ?? remote.config?.['volatile.uuid']
  const devices = remote.expanded_devices ?? remote.devices
  const roots = Object.values(devices ?? {}).filter(device => device.type === 'disk' && device.path === '/')
  if (remote.name !== name || !['container', 'virtual-machine'].includes(remote.type) ||
    !uuid || !/^[a-f0-9-]{36}$/i.test(uuid) || !devices || roots.length !== 1 ||
    typeof roots[0].pool !== 'string' || !safeName(roots[0].pool) || stopped && remote.status !== 'Stopped') {
    throw new Error('恢复实例UUID、设备、存储池或停止状态未确认')
  }
  // UUID and generated start-time metadata change after import. Network addresses,
  // MACs, idmaps, explicit devices, resource limits and security settings may not.
  const protectedConfig = Object.fromEntries(Object.entries(config).filter(([key]) =>
    /^(limits\.|security\.|boot\.|environment\.|raw\.|linux\.|nvidia\.)/.test(key) ||
    /^volatile\..+\.(hwaddr|last_state\.(ip_addresses|hwaddr))$/.test(key) || /^volatile\.(idmap|last_state\.idmap)/.test(key)))
  const identity = { uuid, type: remote.type, pool: roots[0].pool,
    configurationHash: createHash('sha256').update(JSON.stringify(canonical([devices, protectedConfig]))).digest('hex') }
  if (expected && (identity.uuid !== expected.uuid || identity.type !== expected.type || identity.pool !== expected.pool ||
    identity.configurationHash !== expected.configurationHash)) throw new Error('恢复实例身份或网络/磁盘配置已变化，已停止后续操作')
  return identity
}

export async function requireRestoreTargetAbsent(client: IncusClient, name: string) {
  const path = restoreInstancePath(name)
  try { await client.request('GET', path, null, 30000) }
  catch (error) {
    if (error instanceof IncusApiError && error.statusCode === 404 && error.path === path) return
    throw error
  }
  throw new Error('恢复目标名称已被占用，保留现有实例')
}

export async function verifyRestoredCopy(client: IncusClient, name: string, source: RestoreInstanceIdentity) {
  const target = await readRestoreIdentity(client, name, undefined, true)
  if (target.type !== source.type || target.pool !== source.pool || target.configurationHash !== source.configurationHash) {
    throw new Error('恢复副本的磁盘、设备或网络配置与原实例不一致，原实例已保留')
  }
  return target
}

/** Replacement keeps the original instance name and its IPv4/IPv6 forwards.
 * Ordinary deletion also removes those forwards and must never be used here. */
export async function deleteOriginalForRestore(client: IncusClient, originalName: string, original: RestoreInstanceIdentity,
  tempName: string, restored: RestoreInstanceIdentity) {
  await readRestoreIdentity(client, tempName, restored, true)
  await readRestoreIdentity(client, originalName, original, true)
  const path = restoreInstancePath(originalName)
  await client.request('DELETE', path, null, 120000)
  await requireRestoreTargetAbsent(client, originalName)
  await readRestoreIdentity(client, tempName, restored, true)
}
