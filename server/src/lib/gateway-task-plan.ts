import { createHash } from 'node:crypto'
import { isIPv4 } from 'node:net'

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const HASH = /^[a-f0-9]{64}$/
const MAX_REVISION = 9223372036854775807n
export class GatewayTaskError extends Error {
  constructor(public readonly code: string) { super(code) }
}
function check(condition: unknown, code = 'GATEWAY_TASK_PLAN_INVALID'): asserts condition {
  if (!condition) throw new GatewayTaskError(code)
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value))
  const row = value as Record<string, unknown>
  check(Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)))
  return row
}
export interface GatewayTaskTarget {
  mode: 'local' | 'remote' | 'existing'
  machineId: string
  ssh: null | { address: string; port: number; username: 'root'; fingerprint: string }
}
export const GATEWAY_TASK_STEPS = {
  inspect: ['verify-target', 'inspect-environment'],
  install: ['verify-target', 'inspect-environment', 'save-rollback', 'install-components', 'verify-installation'],
  attach: ['verify-target', 'inspect-environment', 'verify-installation'],
  update: ['verify-target', 'inspect-environment', 'save-rollback', 'update-components', 'verify-installation']
} as const
export type GatewayTaskKind = keyof typeof GATEWAY_TASK_STEPS
export interface GatewayTaskPlan {
  schemaVersion: 1
  taskId: string
  platformId: string
  gatewayId: string
  kind: GatewayTaskKind
  basedOnRevision: string
  target: GatewayTaskTarget
  configurationHash: string
  componentHash: string
  observedStateHash: string
}
export function gatewayTaskHash(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return '[' + item.map(canonical).join(',') + ']'
    if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>
      return '{' + Object.keys(row).sort().map(key => JSON.stringify(key) + ':' + canonical(row[key])).join(',') + '}'
    }
    check(item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isSafeInteger(item)))
    return JSON.stringify(item)
  }
  return createHash('sha256').update('payincus/gateway-task/v1\n' + canonical(value)).digest('hex')
}
export function validateGatewayTaskTarget(value: unknown): GatewayTaskTarget {
  const row = object(value, ['mode', 'machineId', 'ssh'])
  check(row.mode === 'local' || row.mode === 'remote' || row.mode === 'existing')
  check(typeof row.machineId === 'string' && /^[a-f0-9]{32}$/.test(row.machineId) && !/^0+$/.test(row.machineId))
  let ssh: GatewayTaskTarget['ssh'] = null
  if (row.mode === 'local') check(row.ssh === null)
  else {
    const connection = object(row.ssh, ['address', 'port', 'username', 'fingerprint'])
    // The preflight resolver must pin one literal target, avoiding DNS changes
    // between confirmation and execution. Private management targets are valid.
    check(typeof connection.address === 'string' && isIPv4(connection.address))
    const first = Number(connection.address.split('.')[0])
    check(first > 0 && first !== 127 && first < 224 && connection.address !== '169.254.169.254')
    check(Number.isInteger(connection.port) && Number(connection.port) > 0 && Number(connection.port) <= 65535)
    check(connection.username === 'root')
    check(typeof connection.fingerprint === 'string' && /^SHA256:[A-Za-z0-9+/]{43}$/.test(connection.fingerprint) &&
      Buffer.from(connection.fingerprint.slice(7), 'base64').toString('base64').replace(/=+$/, '') === connection.fingerprint.slice(7))
    ssh = { address: connection.address, port: Number(connection.port), username: 'root', fingerprint: connection.fingerprint }
  }
  return { mode: row.mode, machineId: row.machineId, ssh }
}
export function validateGatewayTaskPlan(value: unknown): GatewayTaskPlan {
  const row = object(value, ['schemaVersion', 'taskId', 'platformId', 'gatewayId', 'kind', 'basedOnRevision', 'target', 'configurationHash', 'componentHash', 'observedStateHash'])
  check(row.schemaVersion === 1)
  for (const key of ['taskId', 'platformId', 'gatewayId']) check(typeof row[key] === 'string' && UUID.test(row[key]))
  check(typeof row.kind === 'string' && Object.hasOwn(GATEWAY_TASK_STEPS, row.kind))
  check(typeof row.basedOnRevision === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(row.basedOnRevision) && BigInt(row.basedOnRevision) < MAX_REVISION)
  for (const key of ['configurationHash', 'componentHash', 'observedStateHash']) check(typeof row[key] === 'string' && HASH.test(row[key]))
  return { schemaVersion: 1, taskId: row.taskId as string, platformId: row.platformId as string,
    gatewayId: row.gatewayId as string, kind: row.kind as GatewayTaskKind, basedOnRevision: row.basedOnRevision,
    target: validateGatewayTaskTarget(row.target), configurationHash: row.configurationHash as string,
    componentHash: row.componentHash as string, observedStateHash: row.observedStateHash as string }
}

export interface GatewayStepReceipt {
  schemaVersion: 1
  taskId: string
  operationId: string
  step: string
  planHash: string
  targetHash: string
  evidenceHash: string
  configurationHash: string | null
  issuedAt: number
  outcome: 'verified'
}
export function validateGatewayStepReceipt(value: unknown, plan: GatewayTaskPlan, step: string, operationId: string): GatewayStepReceipt {
  const row = object(value, ['schemaVersion', 'taskId', 'operationId', 'step', 'planHash', 'targetHash', 'evidenceHash', 'configurationHash', 'issuedAt', 'outcome'])
  check(row.schemaVersion === 1 && row.taskId === plan.taskId && row.operationId === operationId && row.step === step && row.outcome === 'verified', 'GATEWAY_TASK_RECEIPT_INVALID')
  check(row.planHash === gatewayTaskHash(plan) && row.targetHash === gatewayTaskHash(plan.target), 'GATEWAY_TASK_RECEIPT_INVALID')
  check(typeof row.evidenceHash === 'string' && HASH.test(row.evidenceHash), 'GATEWAY_TASK_RECEIPT_INVALID')
  check(Number.isSafeInteger(row.issuedAt) && Number(row.issuedAt) > 0 && Number(row.issuedAt) <= Date.now() + 30000, 'GATEWAY_TASK_RECEIPT_INVALID')
  check(row.configurationHash === null || (typeof row.configurationHash === 'string' && HASH.test(row.configurationHash)), 'GATEWAY_TASK_RECEIPT_INVALID')
  if (step === 'verify-installation') check(row.configurationHash === plan.configurationHash, 'GATEWAY_TASK_RECEIPT_INVALID')
  return row as unknown as GatewayStepReceipt
}
