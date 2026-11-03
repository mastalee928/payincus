// Executes the actual Vue SFC setup with Vue reactivity; no browser or copied payment logic.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(new URL('../client/package.json', import.meta.url))
const vue = require('vue'), ts = require('typescript'), { parse, compileScript } = require('vue/compiler-sfc')
const { defineStore, createPinia, setActivePinia } = require('pinia')
const memory = () => { const map = new Map(); return { getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),clear:()=>map.clear(),key:i=>[...map.keys()][i],get length(){return map.size} } }
const storage = memory(), local = memory(), requests = [], scope = vue.effectScope()
const user = vue.reactive({id:1}), auth = {user,token:'fixture',captureAuthentication:()=>{const id=user.id;return {aligned:true,current:()=>user.id===id}},fetchCurrentUser:async()=>{}}
const route = vue.reactive({path:'/checkout',fullPath:'/checkout',query:{}})
const router = {replace:async value=>{route.path=value.path;route.query=value.query;route.fullPath=value.path+'?'+JSON.stringify(value.query)}}
const cart = vue.reactive({items:[],remove(key){this.items=this.items.filter(x=>x.key!==key)},setQuantity(key,q){this.items.find(x=>x.key===key).quantity=q},setNamePrefix(key,name){this.items.find(x=>x.key===key).namePrefix=name}})
const ask=(kind,data)=>new Promise((resolve,reject)=>requests.push({kind,data,resolve,reject}))
const api={checkout:{create:data=>ask('checkout',data),balance:id=>ask('balance',id),payment:(id,providerId,method)=>ask('payment',{id,providerId,method}),get:id=>ask('get',id)},billing:{createRechargeOrder:(...a)=>ask('charge',a),getRechargeCreation:id=>ask('intent',id),getRechargeOrder:id=>ask('status',id),repayRechargeOrder:(...a)=>ask('repay',a),verifyRechargeOrder:id=>ask('verify',id)},instances:{poolOrder:x=>ask('buy',x),getPoolOrder:x=>ask('order',x)}}
const item=()=>({key:crypto.randomUUID(),poolPriceId:20,quantity:1,namePrefix:'server',image:'debian/12',customInitCommandIds:[],addedAt:new Date().toISOString(),snapshot:{regionId:10,regionName:'US',countryCode:'us',resourcePreset:'E2',diskGiB:30,cpu:200,memoryMiB:768,monthlyPrice:1000,setupFee:100,imageLabel:'Debian'}})
const regions=[{id:10,name:'US',countryCode:'us',products:[{id:20,idle:5,monthlyPrice:1000,setupFee:100}]}]
const timers=new Set()
const context=vm.createContext({console,crypto,Map,JSON,Number,Date,Math,Promise,localStorage:local,sessionStorage:storage,window:{addEventListener(){},removeEventListener(){},setTimeout,open(){},location:{assign(){}}},document:{getElementById(){return null}},atob,setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();timers.add(t);return t},clearTimeout})
function load(file,mocks){let code=readFileSync(new URL('../'+file,import.meta.url),'utf8');if(file.endsWith('.vue'))code=compileScript(parse(code).descriptor,{id:'test'}).content;const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};vm.runInContext('(function(require,exports){'+js+'\n})',context)(id=>{if(id in mocks)return mocks[id];if(id==='@/utils/paymentDisplay')return load('client/src/utils/paymentDisplay.ts',{});if(id==='vue')return vue;if(id==='pinia')return {defineStore};return new Proxy({},{get:()=>({})})},exports);return exports}
const cartModule=load('client/src/stores/cart.ts',{'@/stores/auth':{useAuthStore:()=>auth}})
setActivePinia(createPinia())
const direct=scope.run(()=>load('client/src/stores/directPurchase.ts',{'@/stores/auth':{useAuthStore:()=>auth},'./cart':cartModule}).useDirectPurchaseStore())
const component=load('client/src/views/CheckoutView.vue',{'vue':{...vue,onMounted(){},onActivated(){},onDeactivated(){},onUnmounted(){}},'vue-router':{useRoute:()=>route,useRouter:()=>router},'vue-i18n':{useI18n:()=>({t:(k,p)=>k+(p?JSON.stringify(p):''),locale:vue.ref('en')})},'@/api':{default:api},'@/stores/cart':{useCartStore:()=>cart},'@/stores/directPurchase':{useDirectPurchaseStore:()=>direct},'@/stores/auth':{useAuthStore:()=>auth},'@/stores/config':{useConfigStore:()=>({})},'@/stores/theme':{useThemeStore:()=>({})},'@/utils/validation':{validateName:()=>({valid:true})},'@/utils/errorHandler':{translateError:e=>e.message},'@/utils/poolCatalog':{buildPoolInstanceNames:(n,q)=>Array(q).fill(n),formatPublicPrice:c=>(c/100).toFixed(2)}}).default
const s=scope.run(()=>component.setup({}, {expose(){}}))
const tick=async()=>{await vue.nextTick();await Promise.resolve();await Promise.resolve()}
const last=kind=>requests.findLast(x=>x.kind===kind)
const receipt=(orderNo='PAY',method='alipay')=>({order:{orderNo,amount:11,actualAmount:11,payableAmount:11.11,paymentMethod:method,status:'pending'},provider:{id:5,name:'Epay'},payUrl:null,manualPayment:null})
try {
 function ready() { s.loading.value=false;s.catalogReady.value=true;s.regions.value=regions;s.authMode.value='password';s.paying.value=false;s.walletBalance.value=100 }
 s.active.value=true;await tick();ready();cart.items.push(item());s.payProviders.value=[{id:5,name:'Epay',type:'yipay',methods:['alipay','wxpay'],feeRate:0,feeFixed:0,methodFees:{alipay:{feeRate:.01},wxpay:{feeRate:.02}}},{id:6,name:'USDT',type:'upaypro',methods:['USDT-TRC20']}];await tick()
 assert.equal(s.paymentOptions.value.length,3)
 s.selectPayChoice(5,'alipay');assert.equal(s.gatewayQuote.value.payable,1111)
 const first=s.pay(),r=last('checkout');await s.pay();assert.equal(requests.filter(x=>x.kind==='checkout').length,1)
 assert.equal(r.data.source,'cart');assert.equal(r.data.items.length,1)
 const order={id:r.data.requestId,source:'cart',status:'pending',paidAt:null,payments:[]}
 s.selectPayChoice(5,'wxpay');assert.equal(s.payMethod.value,'alipay','payment selection is frozen while submitting');r.resolve(order);await tick()
 assert.equal(last('payment').data.method,'alipay','submitted selection remains bound to its request')
 last('payment').resolve(order);await first;await tick();assert.equal(route.query.checkout,order.id)
 assert.equal(requests.filter(x=>x.kind==='charge'||x.kind==='buy').length,0,'purchase uses no recharge or browser-side balance intermediary')
 route.path='/checkout';route.query={};route.fullPath='/checkout';await tick();ready()
 const original=cart.items[0];const oldId=s.checkoutRequestId({expectedTotal:1100},1);cart.items=[];cart.items.push(item());await tick()
 assert.notEqual(s.checkoutRequestId({expectedTotal:1100},1),oldId,'same-price new cart line gets a new order identity')
 s.selectPayChoice('balance');const wallet=s.pay(),wr=last('checkout');wr.resolve({id:wr.data.requestId,source:'cart',status:'pending',paidAt:null,payments:[]});await tick()
 assert.equal(last('balance').data,wr.data.requestId)
 last('balance').resolve({id:wr.data.requestId,source:'cart',status:'paid',paidAt:new Date().toISOString(),payments:[]});await wallet;await tick()
 assert.equal(cart.items.length,0,'balance acceptance clears purchased lines without a second confirmation')
 cart.items.push(original);const directId=direct.create(item());route.path='/order/confirm';route.query={draft:directId};route.fullPath='/order/confirm?draft='+directId;await tick();ready()
 const retained=JSON.stringify(cart.items),single=s.pay(),dr=last('checkout');assert.equal(dr.data.source,'direct')
 dr.resolve({id:dr.data.requestId,source:'direct',status:'pending',paidAt:null,payments:[]});await tick()
 last('balance').resolve({id:dr.data.requestId,source:'direct',status:'paid',paidAt:new Date().toISOString(),payments:[]});await single;await tick()
 assert.equal(JSON.stringify(cart.items),retained);assert.equal(direct.items.length,0)
 const second=direct.create(item());user.id=2;direct.load(second);assert.equal(direct.items.length,0)
 console.log('PASS actual Vue setup: unified purchase, chosen payment, double click, no recharge intermediary, same-price new cart, direct/cart separation, automatic paid acceptance and account isolation')
 context.setInterval=(fn,ms)=>{const timer=setInterval(fn,ms);timer.unref();timers.add(timer);return timer};context.clearInterval=clearInterval
 api.billing.getPaymentProviders=async()=>({providers:[{id:5,name:'Epay',type:'yipay',methods:['alipay','wxpay'],feeRate:0,feeFixed:0}]})
 api.billing.getUserBalance=async()=>({balance:{balance:100}})
 api.checkout.verify=id=>ask('panel-verify',id);api.checkout.cancel=id=>ask('panel-cancel',id)
 const panel=load('client/src/components/CheckoutPaymentPanel.vue',{'vue':{...vue,onMounted(){},onActivated(){},onDeactivated(){},onBeforeUnmount(){}},'vue-router':{useRoute:()=>route},'vue-i18n':{useI18n:()=>({t:k=>k,locale:vue.ref('en')})},'@/api':{default:api},'@/stores/auth':{useAuthStore:()=>auth},'@/utils/errorHandler':{translateError:e=>e.message},'@/utils/poolCatalog':{formatPublicPrice:c=>(c/100).toFixed(2)}}).default
 route.query={payment:'5:wxpay',paymentFailed:'1'};await tick()
 const props=vue.reactive({id:crypto.randomUUID()}),emitted=[]
 const p=scope.run(()=>panel.setup(props,{expose(){},emit:(event,value)=>emitted.push({event,value})}))
 p.activate();await tick();await tick()
 const pending={id:props.id,status:'pending',source:'direct',totalCents:1100,expiresAt:new Date(Date.now()+900000).toISOString(),paidAt:null,paymentId:null,payments:[{id:'wx',providerId:5,method:'wxpay',payableCents:1122,feeCents:22,status:'pending',payUrl:'https://example.com/pay'}],refunds:[],result:null}
 last('get').resolve(pending);await tick();await tick()
 assert.equal(p.choice.value,'5:wxpay');assert.equal(p.error.value,'checkout.paymentFailed','recovered failure remains visible after initial choice')
 assert.equal(p.quote.value.total,1122)
 p.choice.value='balance';await tick();assert.equal(p.payment.value,undefined);assert.equal(p.quote.value.total,1100)
 p.walletBalance.value=0;await p.pay();assert.equal(p.insufficient.value,true)
 p.walletBalance.value=100
 const stale=p.refresh();const staleRequest=last('get')
 const accepted=p.pay();const acceptRequest=last('balance')
 acceptRequest.resolve({...pending,status:'paid',paidAt:new Date().toISOString(),paymentId:'balance'});await accepted;await tick()
 staleRequest.resolve(pending);await stale;assert.equal(p.order.value.status,'paid','older pending response cannot overwrite accepted payment')
 assert.equal(emitted.filter(row=>row.event==='paid').length,1)
 last('get').resolve({...pending,status:'paid',paidAt:new Date().toISOString(),paymentId:'balance'});await tick()
 p.accept({...pending,expiresAt:new Date(0).toISOString()});assert.equal(p.displayStatus.value,'expired');assert.equal(p.open.value,false)
 p.accept(pending);p.choice.value='5:wxpay';await tick()
 const delayed=p.pay(),delayedRequest=last('payment'),emittedBefore=emitted.length
 user.id=3;await tick();delayedRequest.resolve({...pending,status:'paid',paidAt:new Date().toISOString()});await delayed
 assert.equal(emitted.length,emittedBefore,'late response from another login cannot expose or accept previous account order')
 console.log('PASS actual payment panel: failure recovery, choice fee, balance shortage, stale refresh, paid receipt, expiry and account-change race')
}finally{scope.stop();for(const timer of timers)clearTimeout(timer)}
