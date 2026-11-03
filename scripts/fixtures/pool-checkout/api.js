import { reactive } from 'vue'
export const requests = reactive([])
let handler
export const setHandler = value => { handler = value }
const ask = (kind, data) => new Promise((resolve, reject) => { const request = { kind, data, resolve, reject }; requests.push(request); handler?.(request) })
export default {
  orders: { list: async()=>({orders:[],total:0,page:1,pageSize:20,totalPages:0}) },
  checkout: { catalog: source=>ask('catalog',source),create: data=>ask('checkout-create',data),get:id=>ask('checkout-get',id),balance:id=>ask('checkout-balance',id),payment:(id,providerId,method)=>ask('checkout-payment',{id,providerId,method}),cancel:id=>ask('checkout-cancel',id),verify:id=>ask('checkout-verify',id),list:()=>ask('checkout-list'),refunds:()=>ask('checkout-refunds'),completeRefund:(id,receipt)=>ask('checkout-refund-complete',{id,receipt}) },
  packages: { getPublicCatalog: () => ask('catalog') }, sshKeys: { list: () => ask('keys') },
  images: { getSystemImages: (...data) => ask('images', data) },
  config: { getPublic: async () => ({}) },
  auth: { me: async () => ({ user: { id: 1, username: 'seoul', role: 'user' } }) },
  instances: { poolOrder: data => ask('buy', data), getPoolOrder: id => ask('order', id) },
  billing: { getUserBalance:()=>ask('balance'),getPaymentProviders: () => ask('providers'), createRechargeOrder: (...data) => ask('charge', data),
    getRechargeCreation: id => ask('charge-intent', id),
    getRechargeOrder: id => ask('charge-status', id), verifyRechargeOrder: id => ask('verify', id), repayRechargeOrder: (...data) => ask('repay', data) }
}
