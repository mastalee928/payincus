// The private backend is single-instance. Serialize renewal commits with expiry
// resource actions, including the network wait, without holding a DB transaction.
const lanes = new Map<number, Promise<unknown>>()
export async function withInstanceBillingMutation<T>(instanceId: number, action: () => Promise<T>, options?: { onBusy: () => never }): Promise<T> {
  if (!Number.isSafeInteger(instanceId) || instanceId < 1) throw new Error('INSTANCE_BILLING_ID_INVALID')
  // Interactive edits must not queue behind long remote work and run after the
  // browser has timed out. Check and claim synchronously in the same JS turn.
  if (lanes.has(instanceId) && options) return options.onBusy()
  const previous = lanes.get(instanceId) || Promise.resolve()
  const operation = previous.catch(() => {}).then(action)
  lanes.set(instanceId, operation)
  try { return await operation } finally { if (lanes.get(instanceId) === operation) lanes.delete(instanceId) }
}
