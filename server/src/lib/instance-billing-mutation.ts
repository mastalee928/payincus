// The private backend is single-instance. Serialize renewal commits with expiry
// resource actions, including the network wait, without holding a DB transaction.
const lanes = new Map<number, Promise<unknown>>()
export async function withInstanceBillingMutation<T>(instanceId: number, action: () => Promise<T>): Promise<T> {
  if (!Number.isSafeInteger(instanceId) || instanceId < 1) throw new Error('INSTANCE_BILLING_ID_INVALID')
  const previous = lanes.get(instanceId) || Promise.resolve()
  const operation = previous.catch(() => {}).then(action)
  lanes.set(instanceId, operation)
  try { return await operation } finally { if (lanes.get(instanceId) === operation) lanes.delete(instanceId) }
}
