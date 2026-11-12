export interface InstanceRenewalPriceSnapshot {
  instanceId: number
  ownerId: number
  hostId: number
  incusId: string
  price: string
  final: boolean
  billingCycle: number
  revision: string
}
