import type { Instance } from '@prisma/client'

/** A finite paid term remains enforceable even if its plan or status changed. */
export function instanceTermExpired(instance: { expiresAt: Date | string | null }, now = Date.now()): boolean {
  return instance.expiresAt !== null && new Date(instance.expiresAt).getTime() <= now
}

export class InstanceExpiredError extends Error {
  readonly code = 'INSTANCE_EXPIRED'
  constructor() { super('实例已到期，请完成续费后再操作') }
}

export function assertInstanceMayBoot(instance: Pick<Instance, 'expiresAt' | 'status' | 'deletionBillingPending' | 'provisioningCleanupPending' | 'deletionIntent'>): void {
  if (instanceTermExpired(instance)) throw new InstanceExpiredError()
  if (instance.status === 'suspended' || instance.status === 'deleted' || instance.deletionBillingPending ||
      instance.provisioningCleanupPending || instance.deletionIntent) throw new Error('INSTANCE_BOOT_BLOCKED')
}

type Wake = () => void
let wake: Wake | undefined
export function registerExpiryDeadlineWake(callback: Wake): void { wake = callback }
/** Call only after a committed term change. The deadline reader reloads the DB. */
export function wakeExpiryDeadlines(): void { wake?.() }
