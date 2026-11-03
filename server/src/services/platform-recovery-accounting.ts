import { ensure } from './platform-backup-core.js'

export function recoveryMoneyCents(value: {toString():string} | string | number): number {
  const text = value.toString()
  ensure(/^-?\d+(\.\d{1,2})?$/.test(text), 'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH', 409)
  const [whole, fraction = ''] = text.replace('-','').split('.')
  const amount = Number(whole)*100 + Number(fraction.padEnd(2,'0'))
  ensure(Number.isSafeInteger(amount), 'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH', 409)
  return text.startsWith('-') ? -amount : amount
}

export function recoveredRegistrationPrincipal(totalCents: number, quantity: number, instances: Array<{id:number}>,
  bills: Array<{instanceId:number;type:string;amount:{toString():string} | string | number}>, principalCents?: number): number {
  ensure(Number.isSafeInteger(quantity) && quantity>0 && quantity<=100 && instances.length<quantity &&
    new Set(instances.map(row=>row.id)).size===instances.length, 'OSS_RECOVERY_ORDER_QUANTITY_MISMATCH',409)
  const purchases=bills.filter(row=>row.type==='newPurchase')
  ensure(purchases.length===instances.length && instances.every(instance=>purchases.filter(row=>row.instanceId===instance.id).length===1),
    'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
  const amounts=purchases.map(row=>recoveryMoneyCents(row.amount))
  const paid=amounts.reduce((sum,value)=>sum+value,0)
  const next=principalCents ?? (quantity===1 ? totalCents : undefined)
  ensure(typeof next==='number' && Number.isSafeInteger(next) && next>0, 'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
  ensure(amounts.every(value=>value>0) && next<=totalCents && paid+next<=totalCents &&
    (instances.length+1===quantity ? paid+next===totalCents : paid+next<totalCents), 'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
  return next!
}

export function recoveryOrderQuantity(display: unknown): number {
  ensure(Array.isArray(display) && display.length > 0 && display.length <= 100, 'OSS_RECOVERY_ORDER_QUANTITY_REQUIRED', 409)
  let total = 0
  for (const row of display) {
    ensure(row && Number.isSafeInteger(row.quantity) && row.quantity > 0 && row.quantity <= 100, 'OSS_RECOVERY_ORDER_QUANTITY_REQUIRED', 409)
    total += row.quantity
  }
  ensure(total <= 100, 'OSS_RECOVERY_ORDER_QUANTITY_REQUIRED', 409)
  return total
}
export function assertRecoveredOrderPrincipal(totalCents: number, quantity: number, instances: Array<{id:number;recoverySettlementCents?:number}>,
  bills: Array<{instanceId:number;type:string;amount: {toString():string} | string | number}>) {
  ensure(instances.length === quantity && new Set(instances.map(row=>row.id)).size === quantity, 'OSS_RECOVERY_ORDER_QUANTITY_MISMATCH', 409)
  let principal = 0
  for (const instance of instances) {
    const purchases = bills.filter(row=>row.instanceId===instance.id && row.type==='newPurchase')
    ensure(purchases.length===1, 'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH', 409)
    const paid = recoveryMoneyCents(purchases[0].amount)
    const later=bills.filter(row=>row.instanceId===instance.id && ['renew','upgrade'].includes(row.type)).map(row=>recoveryMoneyCents(row.amount))
    const refunds = bills.filter(row=>row.instanceId===instance.id && row.type==='refund').map(row=>instance.recoverySettlementCents===undefined?recoveryMoneyCents(row.amount):-Math.abs(recoveryMoneyCents(row.amount)))
    ensure(paid>0 && later.every(value=>value>=0) && refunds.every(value=>value<=0) && paid+later.reduce((sum,value)=>sum+value,0)+refunds.reduce((sum,value)=>sum+value,0)>=0,
      'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH', 409)
    principal += paid
  }
  ensure(principal===totalCents && bills.filter(row=>row.type==='newPurchase').length===quantity,
    'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH', 409)
}

// A partial order is terminal: missing lines must be accounted for as refunds,
// never returned to the provisioning queue. Original per-guest prices are used;
// evenly splitting the invoice would silently change customer principal.
export function recoveredPartialPrincipal(totalCents:number,quantity:number,
  instances:Array<{id:number;status:string;recoverySettlementCents?:number}>,bills:Array<{instanceId:number;type:string;amount:{toString():string}|string|number}>) {
  ensure(instances.length>0 && instances.length<=quantity && new Set(instances.map(row=>row.id)).size===instances.length,
    'OSS_RECOVERY_ORDER_QUANTITY_MISMATCH',409)
  ensure(instances.some(row=>['running','stopped','suspended'].includes(row.status)) &&
    instances.every(row=>['running','stopped','suspended','deleted'].includes(row.status)) &&
    (instances.length<quantity || instances.some(row=>row.status==='deleted')),'OSS_RECOVERY_PARTIAL_REQUIRED',409)
  const purchases=bills.filter(row=>row.type==='newPurchase')
  ensure(purchases.length===instances.length && bills.every(row=>instances.some(instance=>instance.id===row.instanceId)),
    'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
  const allocation=instances.map(instance=>{
    const rows=purchases.filter(row=>row.instanceId===instance.id)
    ensure(rows.length===1,'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
    const principalCents=recoveryMoneyCents(rows[0].amount)
    const later=bills.filter(row=>row.instanceId===instance.id && ['renew','upgrade'].includes(row.type)).map(row=>recoveryMoneyCents(row.amount))
    const refunds=bills.filter(row=>row.type==='refund'&&row.instanceId===instance.id).map(row=>instance.recoverySettlementCents===undefined?recoveryMoneyCents(row.amount):-Math.abs(recoveryMoneyCents(row.amount)))
    ensure(principalCents>0 && later.every(value=>value>=0) && refunds.every(amount=>amount<=0) && principalCents+later.reduce((n,v)=>n+v,0)+refunds.reduce((n,v)=>n+v,0)>=0,
      'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
    return {...instance,principalCents,refundedCents:-refunds.reduce((n,v)=>n+v,0)}
  })
  const missingCents=totalCents-allocation.reduce((sum,row)=>sum+row.principalCents,0)
  ensure(Number.isSafeInteger(totalCents) && totalCents>0 && (instances.length<quantity?missingCents>0:missingCents===0),
    'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH',409)
  return {allocation,missingCents}
}
