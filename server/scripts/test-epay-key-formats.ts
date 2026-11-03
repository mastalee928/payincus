import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { EpayCoreV2, validateEpayRsaKeys, type EpayConfigV2 } from '../src/lib/epay.js'
const merchant=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),platform=crypto.generateKeyPairSync('rsa',{modulusLength:2048})
const content=(x:Record<string,string>)=>Object.keys(x).filter(k=>k!=='sign'&&k!=='sign_type'&&x[k]).sort().map(k=>`${k}=${x[k]}`).join('&')
const formats=(key:crypto.KeyObject,privateKey:boolean)=>{
 const types=privateKey?['pkcs8','pkcs1'] as const:['spki','pkcs1'] as const
 return types.flatMap(type=>{const pem=key.export({type,format:'pem'} as any).toString();const bare=pem.replace(/-----[^\n]+-----|\s/g,'');return [pem,pem.replaceAll('\n','\r\n'),pem.replaceAll('\n','\\n'),bare,bare.match(/.{1,60}/g)!.join('\n')]})
}
const config:EpayConfigV2={version:'v2',apiurl:'https://pay.example.test',pid:'123',merchant_private_key:'',platform_public_key:''}
const callback={pid:'123',trade_no:'GATEWAY',out_trade_no:'ORDER',type:'wxpay',money:'11.22',trade_status:'TRADE_SUCCESS',timestamp:String(Math.floor(Date.now()/1000))}
const signature=crypto.sign('sha256',Buffer.from(content(callback)),{key:platform.privateKey,padding:crypto.constants.RSA_PKCS1_PADDING}).toString('base64')
for(const privateKey of formats(merchant.privateKey,true))for(const publicKey of formats(platform.publicKey,false)){
 const c={...config,merchant_private_key:privateKey,platform_public_key:publicKey};assert.equal(validateEpayRsaKeys(c),undefined)
 const epay=new EpayCoreV2(c)
 const link=new URL(epay.getPayLink({type:'wxpay',out_trade_no:'ORDER',name:'Test',money:'11.22',notify_url:'https://panel.example.test/callback',return_url:'https://panel.example.test/return'}))
 const params=Object.fromEntries(link.searchParams);assert.equal(params.type,'wxpay')
 assert.equal(crypto.verify('sha256',Buffer.from(content(params)),{key:merchant.publicKey,padding:crypto.constants.RSA_PKCS1_PADDING},Buffer.from(params.sign,'base64')),true)
 assert.equal(epay.verifyWithStatus({...callback,sign:signature}).tradeSuccess,true)
 assert.equal(epay.verify({...callback,money:'1',sign:signature}),false)
 assert.equal(epay.verify({...callback,pid:'other',sign:signature}),false)
}
const validPrivate=merchant.privateKey.export({format:'pem',type:'pkcs8'}).toString(),validPublic=platform.publicKey.export({format:'pem',type:'spki'}).toString()
for(const bad of ['', 'not-an-rsa-key', validPublic, crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'pem',type:'pkcs8'}).toString()])assert.ok(validateEpayRsaKeys({...config,merchant_private_key:bad,platform_public_key:validPublic}))
assert.ok(validateEpayRsaKeys({...config,merchant_private_key:validPrivate,platform_public_key:validPrivate}))
const route=readFileSync(new URL('../src/routes/recharge.ts',import.meta.url),'utf8')
assert.ok(route.includes('const keyError = validateEpayRsaKeys(v2Config)'))
const create=route.slice(route.indexOf("app.post('/api/recharge/orders'"),route.indexOf('// 获取用户充值记录列表'))
assert.ok(create.indexOf('validateActiveRechargeProviderRuntime')<create.indexOf('await createRechargeOnce'))
console.log('PASS 100 RSA encoding pairs: PEM/CRLF/escaped-newline/bare/multiline PKCS1 and PKCS8/SPKI, signed WeChat amount, merchant binding, tamper rejection and pre-persistence validation')
