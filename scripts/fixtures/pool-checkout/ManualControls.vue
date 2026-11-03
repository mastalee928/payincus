<script setup>
import { computed, ref } from 'vue'
import { setHandler, requests } from './api'
const { controls: h } = defineProps(['controls'])
const product = { id: 20, resourcePreset: 'E2', diskGiB: 30, cpu: 200, memoryMiB: 768, monthlyPrice: 1000, setupFee: 100, idle: 5, total: 5 }
const catalog = { regions: [{ id: 10, name: '美国 · 圣何塞', countryCode: 'us', products: [product] }], maxInstances: 100 }
const item = { poolPriceId: 20, quantity: 1, namePrefix: 'my-server', image: 'debian/12', customInitCommandIds: [], snapshot: { regionId: 10, regionName: '美国 · 圣何塞', countryCode: 'us', resourcePreset: 'E2', diskGiB: 30, cpu: 200, memoryMiB: 768, monthlyPrice: 1000, setupFee: 100, imageLabel: 'Debian 12' } }
const providers = [{ id: 5, name: '易支付', type: 'yipay', methods: ['alipay','wxpay'], feeRate: 0, feeFixed: 0, minAmount: 1, methodFees: { alipay: {feeRate:0.01},wxpay:{feeRate:0.02} } },{id:6,name:'USDT',type:'upaypro',methods:['USDT-TRC20'],feeRate:0,feeFixed:0,minAmount:1}]
const records = new Map(JSON.parse(sessionStorage.getItem('fixture.orders') || '[]'))
const purchases = new Map(JSON.parse(sessionStorage.getItem('fixture.purchases') || '[]'))
const checkoutOrders = new Map(JSON.parse(sessionStorage.getItem('fixture.checkout') || '[]'))
const wallet = ref(100)
const stockLimit = ref(Number(sessionStorage.getItem('fixture.stock') || 5))
function stockFor(source) {
  let taken=0
  for(const order of checkoutOrders.values()) {
    if(['cancelled','expired','refunded'].includes(order.status))continue
    if(order.status==='pending' && order.expiresAt < new Date().toISOString())continue
    if(order.status==='pending' && order.userId===h.auth.user?.id && order.source===source)continue
    taken+=order.items.reduce((sum,item)=>sum+item.quantity,0)
  }
  return Math.max(0,stockLimit.value-taken)
}
const refunds = ref([{id:'fixture-refund',amountCents:1122,orderId:'00000000-0000-4000-8000-000000000001',order:{userId:1},payment:{providerName:'易支付',method:'wxpay'},receipt:{tradeNo:'TEST-ONLY-20261102-REFUND',amountCents:1122,currency:'CNY'}}])
function persistCheckouts() { sessionStorage.setItem('fixture.checkout',JSON.stringify([...checkoutOrders])) }
function deliver(order) {
  order.status='completed';order.paidAt=new Date().toISOString()
  order.result={batchId:order.id,total:order.totalCents,instances:order.items.flatMap((item,index)=>Array.from({length:item.quantity},(_,i)=>({id:70+index*100+i,name:item.quantity===1?item.namePrefix:`${item.namePrefix}-${i+1}`,incusId:`fixture-${i}`,status:'running',refunded:false,refundPending:false,publicIpUpdating:false,host:'192.0.2.10',sshPort:22,rootPassword:null})))}
  persistCheckouts()
}
const held = ref(false), failure = ref(false), paid = ref(false)
const pending = computed(() => requests.filter(r => !r.done && r.kind === 'charge'))
const persist = () => sessionStorage.setItem('fixture.orders', JSON.stringify([...records]))
function complete(r) {
  r.done = true
  if (failure.value) { failure.value = false; r.reject({httpStatus:400,message:'渠道暂不可用'}); return }
  const [providerId,amount,paymentMethod,,requestId] = r.data
  let receipt = records.get(requestId)
  const recovered = !!receipt
  if (!receipt) {
    const fee = providerId === 5 ? Number((amount * (paymentMethod === 'wxpay' ? 0.02 : 0.01)).toFixed(2)) : 0
    receipt = {order:{orderNo:'LOCAL-'+requestId,amount,actualAmount:amount,payableAmount:amount+fee,paymentMethod,status:'pending',provider:providers.find(p=>p.id===providerId)},provider:providers.find(p=>p.id===providerId),payUrl:null,manualPayment:null}
    records.set(requestId,receipt); persist()
  }
  r.resolve({...receipt,recovered})
}
setHandler(r => {
  const resolve = value => {r.done=true;r.resolve(value)}
  if(r.kind==='checkout-refunds')return resolve({refunds:refunds.value})
  if(r.kind==='checkout-refund-complete'){refunds.value=refunds.value.filter(row=>row.id!==r.data.id);return resolve({success:true})}
  if(r.kind==='balance')return resolve({balance:{balance:wallet.value}})
  if(r.kind==='checkout-create'){
    const d=r.data;let o=checkoutOrders.get(d.requestId)
    if(!o){
      if(d.items.reduce((sum,item)=>sum+item.quantity,0)>stockFor(d.source)){r.done=true;r.reject({message:'库存不足'});return}
      for(const old of checkoutOrders.values())if(old.userId===h.auth.user?.id && old.source===d.source && old.status==='pending')old.status='cancelled'
      o={id:d.requestId,userId:h.auth.user?.id,source:d.source,status:'pending',totalCents:d.expectedTotal,expiresAt:new Date(Date.now()+900000).toISOString(),createdAt:new Date().toISOString(),paidAt:null,paymentId:null,error:null,payments:[],refunds:[],result:null,items:d.items.map(i=>({...i,resourcePreset:'E2',memoryMiB:768,diskGiB:30,monthlyPrice:1000,setupFee:100}))};checkoutOrders.set(o.id,o);persistCheckouts()
    }
    return resolve(JSON.parse(JSON.stringify(o)))
  }
  if(r.kind==='checkout-payment'){
    const {id,providerId,method}=r.data,o=checkoutOrders.get(id)
    if(failure.value){failure.value=false;r.done=true;r.reject({message:'支付方式暂不可用'});return}
    let a=o.payments.find(p=>p.providerId===providerId && p.method===(method||'USDT-TRC20'))
    if(!a){const fee=providerId===5?Math.round(o.totalCents*(method==='wxpay'?.02:.01)):0;a={id:crypto.randomUUID(),providerId,providerName:providerId===5?'易支付':'USDT',method:method||'USDT-TRC20',payableCents:o.totalCents+fee,feeCents:fee,status:'pending',payUrl:`/order/confirm?checkout=${id}&payment=${providerId}:${method||''}&manual=1`};o.payments.push(a);persistCheckouts()}
    const done=()=>resolve(JSON.parse(JSON.stringify(o)))
    if(held.value){r.release=done;return}done();return
  }
  if(r.kind==='checkout-get'||r.kind==='checkout-verify'||r.kind==='checkout-balance'||r.kind==='checkout-cancel'){
    const o=checkoutOrders.get(r.data);if(!o){r.done=true;r.reject({message:'订单不存在'});return}
    if(r.kind==='checkout-cancel' && o.status==='pending'){o.status='cancelled';persistCheckouts()}
    if(r.kind==='checkout-balance' && o.status==='pending'){if(wallet.value<o.totalCents/100){r.done=true;r.reject({message:'余额不足'});return}wallet.value-=o.totalCents/100;o.paymentId='balance';deliver(o)}
    if(paid.value && o.status==='pending'){o.paymentId=o.payments[0]?.id;deliver(o)}
    return resolve(JSON.parse(JSON.stringify(o)))
  }
  if(r.kind==='checkout-list')return resolve({orders:[...checkoutOrders.values()].map(o=>({...o,display:o.items})),next:null})
  if (r.kind === 'catalog') {const result=JSON.parse(JSON.stringify(catalog));result.regions[0].products[0].idle=stockFor(r.data);return resolve(result)}
  if (r.kind === 'keys') return resolve({keys:[]})
  if (r.kind === 'providers') return resolve({providers})
  if (r.kind === 'images') return resolve({images:[{remoteAlias:'debian/12',name:'Debian 12',architecture:'x86_64'}]})
  if (r.kind === 'charge') { if (!held.value) complete(r); return }
  if (r.kind === 'charge-intent') return resolve(records.get(r.data) ?? {order:null})
  if (r.kind === 'charge-status') {const receipt=[...records.values()].find(v=>v.order.orderNo===r.data);return resolve({order:{...receipt?.order,orderNo:r.data,status:paid.value?'completed':'pending'}})}
  if (r.kind === 'verify') return resolve({success:true})
  if (r.kind === 'repay') {const receipt=[...records.values()].find(v=>v.order.orderNo===r.data[0]);return resolve({...receipt,manualPayment:{instructions:'本地测试付款信息'}})}
  if (r.kind === 'buy') {
    const result={batchId:r.data.requestId,total:r.data.expectedTotal,instances:r.data.items.flatMap((item,index)=>Array.from({length:item.quantity},(_,i)=>({id:70+index*100+i,name:item.quantity===1?item.namePrefix:`${item.namePrefix}-${i+1}`,status:'running',refunded:false,refundPending:false,host:'192.0.2.10',sshPort:22000+index*100+i,rootPassword:null})))}
    purchases.set(r.data.requestId,result);sessionStorage.setItem('fixture.purchases',JSON.stringify([...purchases]));return resolve(result)
  }
  if (r.kind === 'order') { const result=purchases.get(r.data);if(result)return resolve(result);r.done=true;r.reject({httpStatus:404,message:'本地订单不存在'});return }
})
function reset() { sessionStorage.clear(); h.cart.clear(); records.clear(); checkoutOrders.clear(); requests.splice(0); h.account(1); location.assign('/checkout?manual=1') }
</script>
<template>
  <details style="margin-bottom:16px;font-size:12px" open>
    <summary>本地测试控制台（无真实付款）</summary>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin:12px 0">
      <button @click="reset">重置场景</button><button @click="h.cart.add(item)">加入测试商品</button>
      <button @click="h.router.push('/purchase?manual=1')">选择商品</button><button @click="h.router.push('/checkout?manual=1')">购物车</button>
      <button @click="h.router.push('/refund-preview?manual=1')">退款预览</button>
      <button @click="h.router.push('/payment-icons-preview?manual=1')">支付图标预览</button>
      <button @click="h.account(2)">切换测试账户</button><button @click="h.theme.setTheme(h.theme.isDark?'light':'dark')">切换主题</button>
      <button @click="wallet=0">余额设为零</button><button @click="wallet=100">余额设为100</button>
      <button @click="stockLimit=1;sessionStorage.setItem('fixture.stock','1')">仅一台库存</button>
      <button @click="h.setLocale('en')">English</button><button @click="h.setLocale('zh-TW')">繁體</button><button @click="h.setLocale('zh-CN')">简体</button>
      <label><input v-model="held" type="checkbox" />延迟支付响应</label><label><input v-model="failure" type="checkbox" />下次400拒绝</label><label><input v-model="paid" type="checkbox" />模拟到账</label>
      <button v-for="(r,i) in pending" :key="r.data[4]" @click="complete(r)">返回 {{r.data[2] || 'USDT'}} 响应 {{i+1}}</button>
      <button v-for="r in requests.filter(r=>r.release && !r.done)" :key="r.data.id+r.data.method" @click="r.release()">返回付款响应 {{r.data.method || 'USDT'}}</button>
    </div>
    <output>购物车 {{h.cart.totalQuantity}} 台 · 当前路径 {{h.router.currentRoute.value.path}}</output>
    <details><summary>请求记录</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">{{ requests.map(r=>({kind:r.kind,data:r.data,done:!!r.done})) }}</pre></details>
  </details>
</template>
