import assert from 'node:assert/strict'
import { missingDeliveryForwards, restoreMissingDeliveryForwards } from '../../src/services/platform-recovery-delivery-network.js'
import { dedicatedIpv6Address } from '../../src/lib/host-public-ipv6.js'
import type { RecoveryForward } from '../../src/services/platform-recovery-network.js'

export async function verifyRecoveryDeliveryNetwork() {
  const input={hostId:2,instanceId:7,name:'original',ipv4:'10.10.0.4',natBindIp:'192.0.2.7',publicIpv6:['2603:c020:802a:cc00::1']}
  const gateway='fd42:1:2:3::1',address=input.publicIpv6[0]
  const primary=dedicatedIpv6Address(gateway,input.instanceId,address),fallback=dedicatedIpv6Address(gateway,input.instanceId,`${address}:other-protocols`)
  const bridge={'ipv6.address':gateway+'/64','ipv6.nat':'true'},assigned=[input.natBindIp,address]
  const original={gateway,addresses:[primary,fallback]}
  const rules=missingDeliveryForwards(input,[],bridge,assigned,original)
  assert.equal(rules.length,2)
  assert.equal(rules[1].config.target_address,fallback)
  assert.deepEqual(rules[1].ports?.map(port=>port.protocol),['tcp','udp'])
  assert.equal(missingDeliveryForwards(input,rules,bridge,assigned,original).length,0)
  assert.deepEqual(missingDeliveryForwards(input,[rules[0]],bridge,assigned,original),[rules[1]])
  const legacy=missingDeliveryForwards(input,[],bridge,assigned,{gateway,addresses:[primary]})
  assert.equal(legacy[1].config.target_address,primary);assert.equal(legacy[1].ports?.length,0)
  for(const broken of [
    [rules[0],{...rules[1],description:'other'}],
    [rules[0],{...rules[1],config:{target_address:primary}}],
    [rules[0],{...rules[1],ports:rules[1].ports!.slice(0,1)}],
    [rules[0],{...rules[1],ports:rules[1].ports!.map(port=>({...port,snat:false}))}],
    [...rules,rules[0]],
    [...rules,{...rules[0],listen_address:'192.0.2.8'}]
  ])assert.throws(()=>missingDeliveryForwards(input,broken,bridge,assigned,original),/FORWARD_MISMATCH/)
  assert.throws(()=>missingDeliveryForwards(input,[],bridge,assigned.slice(0,1),original),/FORWARD_MISMATCH/)
  assert.throws(()=>missingDeliveryForwards(input,[],bridge,assigned),/CONFIG_MISSING/)
  assert.throws(()=>missingDeliveryForwards(input,[],bridge,assigned,{gateway,addresses:[primary,'fd42::999']}),/CONFIG_MISMATCH/)

  let forwards:RecoveryForward[]=[],writes=0,guards=0,drop=true,conflict=false
  const receipts:string[]=[],calls:string[]=[]
  const client={
    async request<T>(method:string,path:string,body?:unknown):Promise<T> {
      calls.push(`${method} ${path}`)
      if(method==='POST') {
        assert.equal(path,'/1.0/networks/incusbr0/forwards')
        const rule=body as RecoveryForward
        assert.ok(!forwards.some(item=>item.listen_address===rule.listen_address));forwards.push(rule);writes++
        if(drop){drop=false;throw Object.assign(Error('lost response'),{code:'ECONNRESET'})}
        return {} as T
      }
      assert.equal(method,'GET','no modification of existing rules, network, guests or disks')
      if(path==='/1.0/networks?recursion=1')return [{name:'eth0',type:'physical',managed:false}] as T
      if(path==='/1.0/networks/eth0/state')return {state:'up',addresses:assigned.map(address=>({address}))} as T
      if(path==='/1.0/networks/incusbr0')return {config:bridge} as T
      if(path==='/1.0/networks/incusbr0/forwards?recursion=1')return structuredClone(forwards) as T
      throw Error('unexpected path')
    },
    async readFile(path:string) {return {statusCode:200,content:decodeURIComponent(path).includes('/gateway')?gateway:original.addresses.join('\n')}}
  }
  const guard=async()=>{guards++;if(conflict)forwards=[{...rules[0],description:'other'}]}
  const record=async(address:string,phase:string)=>{receipts.push(`${phase}:${address}`)}
  await assert.rejects(restoreMissingDeliveryForwards(client as any,input,guard,record),/lost response/)
  assert.equal(writes,1);assert.equal(receipts.length,1)
  await restoreMissingDeliveryForwards(client as any,input,guard,record)
  assert.equal(writes,2,'a lost POST response is reconciled from the actual rule without another POST')
  const baseline=JSON.stringify({writes,guards,receipts})
  await restoreMissingDeliveryForwards(client as any,input,guard,record)
  assert.equal(JSON.stringify({writes,guards,receipts}),baseline,'complete topology has no side effects')
  assert.deepEqual(forwards,rules)
  forwards=[];conflict=true
  await assert.rejects(restoreMissingDeliveryForwards(client as any,input,guard,record),/FORWARD_MISMATCH/)
  assert.equal(writes,2,'a concurrent conflicting assignment prevents the next write')
  assert.ok(!calls.some(value=>/^(PUT|PATCH|DELETE) /.test(value)))
  console.log('PASS recovery delivery network: original files, physical addresses, missing-only forwards, conflicts, lost response and zero guest/disk writes')
}
