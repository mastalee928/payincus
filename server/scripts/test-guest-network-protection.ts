import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assertGuestNetworkProtection, normalizeGuestProtectionStatus, guestProtectionReady } from '../src/lib/guest-network-protection.js'
import { hardeningFailure, hardeningDiagnostic, hardeningUpdateBudget } from '../src/lib/security-hardening.js'
import { applyCustomerInstanceView } from '../src/lib/customer-instance-view.js'
let marker:unknown=`v1:${'a'.repeat(64)}:${Date.now()}`
const client={request:async()=>({config:{'user.payincus.guest-guard':marker}})} as any
await assertGuestNetworkProtection(client)
for(marker of [undefined, '', `v1:${'a'.repeat(64)}`,`v1:${'a'.repeat(64)}:${Date.now()-90001}`,`v1:${'a'.repeat(64)}:${Date.now()+60000}`,`v1:bad:${Date.now()}`]) {
  await assert.rejects(assertGuestNetworkProtection(client),/GUEST_NETWORK_PROTECTION_PENDING/)
}
assert.equal(normalizeGuestProtectionStatus({applied:true,checkedAt:'bad'}),null)
const agent={enabled:true,lastSeenAt:new Date(),capabilities:['guest-network-protection-v1'],lastReport:{guestProtectionStatus:{applied:true,checkedAt:new Date().toISOString()}}}
assert.ok(guestProtectionReady(agent))
assert.ok(guestProtectionReady({...agent,lastSeenAt:new Date(Date.now()-59000),lastReport:{guestProtectionStatus:{applied:true,checkedAt:new Date(Date.now()-95000).toISOString()}}}))
assert.equal(guestProtectionReady({...agent,lastReport:{guestProtectionStatus:{applied:true,checkedAt:new Date(Date.now()-180001).toISOString()}}}),false)
for(const change of [{enabled:false},{lastSeenAt:new Date(0)},{capabilities:[]},{lastReport:{}},{lastReport:{guestProtectionStatus:{applied:false,checkedAt:new Date().toISOString()}}}])assert.equal(guestProtectionReady({...agent,...change}),false)
assert.deepEqual(hardeningFailure(Error('GUEST_NETWORK_PROTECTION_PENDING')),{status:'retry',reason:'GUEST_NETWORK_PROTECTION_PENDING'})
assert.equal(hardeningDiagnostic('GUEST_NETWORK_PROTECTION_PENDING','customer-ssh').action,'wait')
assert.equal(hardeningUpdateBudget({error:'GUEST_NETWORK_PROTECTION_PENDING',updateAttempts:2}),2)
assert.deepEqual(normalizeGuestProtectionStatus({applied:false,checkedAt:'2026-11-10T00:00:00Z',error:'secret raw output',management:['192.0.2.1']}),
  {applied:false,checkedAt:'2026-11-10T00:00:00.000Z',error:'GUEST_NETWORK_PROTECTION_PENDING'})
const view:any={host:{name:'internal',managementIp:'192.0.2.1',url:'https://192.0.2.1',onboardingNode:{credentialsEncrypted:'private'},metadata:{tenantId:'private'},country_code:'KR',nat_public_ip:'192.0.2.10'}}
applyCustomerInstanceView(view,{},false)
assert.deepEqual(view.host,{name:'',ip_address:null,country_code:'KR',nat_public_ip:'192.0.2.10'})
for(const file of ['dedicated-delivery','alpine-ssh-maintenance','customer-boot-recovery','platform-recovery-delivery']) {
  const source=readFileSync(new URL(`../src/services/${file}.ts`,import.meta.url),'utf8')
  const calls=[...source.matchAll(/await (?:checkSshLogin|deps\.login|deps\.hold)\(/g)]
  assert.ok(calls.length)
  for(const call of calls)assert.match(source.slice(Math.max(0,call.index!-100),call.index),/await assertGuestNetworkProtection\(client\)/,`${file} cannot start public validation before protection`)
}
console.log('PASS guest network protection: expiry, failure redaction, customer API allowlist and all public SSH gates')
