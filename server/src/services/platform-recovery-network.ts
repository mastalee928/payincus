import { ensure } from './platform-backup-core.js'
import { normalizeIpv6, publicIpv6, privateIpv6, dedicatedIpv6Address, dedicatedIpv6State, type DedicatedIpv6State } from '../lib/host-public-ipv6.js'
import { createHash } from 'node:crypto'
import type { IncusClient } from '../lib/incus/incus-client.js'

export interface RecoveryForward {
  listen_address:string;description:string;config:Record<string,string>
  ports?:Array<{protocol:string;listen_port:string;target_address?:string;target_port?:string;snat?:boolean}>
}
export function recoveryNetworkTopology(value:unknown) {
  const state=dedicatedIpv6State(value)
  return state ? {hostId:state.hostId,instanceName:state.instanceName,primary:state.primary,
    mappings:state.mappings.map(({publicIp,privateIp,fallbackIp})=>({publicIp,privateIp,fallbackIp}))} : null
}
export const recoveryNetworkHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(recoveryNetworkTopology(value))).digest('hex')
// Recover existing mappings from authenticated read-only replies. Do not invoke
// reconciliation: that would rewrite guest addresses based on incomplete DB data.
export function recoverDedicatedNetwork(input:{hostId:number;originalId:number;name:string;ipv4:string;natBindIp:string|null},
  forwards:RecoveryForward[],bridge:Record<string,string>|null,guestAddresses:string[],saved?:{addresses:string[];gateway:string;running:boolean}):DedicatedIpv6State {
  ensure(Array.isArray(forwards) && forwards.length<=257,'OSS_REVIEW_FORWARD_MISMATCH',409)
  const own=`payincus-dedicated:${input.name}`
  const ipv4=forwards.filter(row=>row.listen_address===input.natBindIp)
  ensure(ipv4.length===1 && ipv4[0].description===own && ipv4[0].config.target_address===input.ipv4 && !ipv4[0].ports?.length,
    'OSS_REVIEW_FORWARD_MISMATCH',409)
  const records=forwards.filter(row=>row!==ipv4[0])
  ensure(records.every(row=>row.description===own && publicIpv6(row.listen_address)) &&
    new Set(records.map(row=>normalizeIpv6(row.listen_address))).size===records.length,'OSS_REVIEW_FORWARD_MISMATCH',409)
  const state:DedicatedIpv6State={version:1,hostId:input.hostId,instanceName:input.name,mappings:[],primary:null,status:'none',checkedAt:new Date().toISOString(),error:null}
  if(!records.length)return state
  const address=bridge?.['ipv6.address']?.split('/')
  const gateway=normalizeIpv6(address?.[0])
  ensure(gateway && privateIpv6(gateway) && address?.[1]==='64' && bridge?.['ipv6.routing']!=='false' && bridge?.['ipv6.nat']==='true','OSS_REVIEW_FORWARD_MISMATCH',409)
  ensure(saved && normalizeIpv6(saved.gateway)===gateway && saved.addresses.length>0,'OSS_RECOVERY_GUEST_NETWORK_CONFIG_MISSING',409)
  const present=new Set(guestAddresses.map(normalizeIpv6).filter(Boolean))
  state.mappings=records.map(row=>{
    const publicIp=publicIpv6(row.listen_address)!,privateIp=dedicatedIpv6Address(gateway,input.originalId,publicIp)
    const expectedFallback=dedicatedIpv6Address(gateway,input.originalId,`${publicIp}:other-protocols`)
    const target=normalizeIpv6(row.config.target_address)
    const fallbackIp=row.ports?.length ? expectedFallback : undefined
    ensure(fallbackIp ? target===fallbackIp && row.ports?.length===2 && ['tcp','udp'].every(protocol=>row.ports!.some(port=>
      port.protocol===protocol && port.listen_port==='1-65535' && normalizeIpv6(port.target_address)===privateIp && !port.target_port && port.snat===true)) :
      target===privateIp,'OSS_REVIEW_FORWARD_MISMATCH',409)
    if(saved.running)ensure(present.has(privateIp) && (!fallbackIp || present.has(fallbackIp)),'OSS_RECOVERY_GUEST_ADDRESSES_MISSING',409)
    // Forwarding configuration is evidence of topology, not of public egress.
    return {publicIp,privateIp,...(fallbackIp?{fallbackIp}:{}),ready:false,checkedAt:state.checkedAt}
  })
  const configured=saved.addresses.map(normalizeIpv6)
  const expected=state.mappings.flatMap(mapping=>[mapping.privateIp,...(mapping.fallbackIp?[mapping.fallbackIp]:[])])
  ensure(configured.every(Boolean) && new Set(configured).size===configured.length && configured.length===expected.length &&
    expected.every(ip=>configured.includes(ip)),'OSS_RECOVERY_GUEST_NETWORK_CONFIG_MISMATCH',409)
  const primary=state.mappings.find(mapping=>mapping.privateIp===configured[0])
  ensure(primary,'OSS_RECOVERY_GUEST_NETWORK_CONFIG_MISMATCH',409)
  state.mappings.sort((a,b)=>configured.indexOf(a.privateIp)-configured.indexOf(b.privateIp))
  const digest=createHash('sha256').update(state.mappings.flatMap(mapping=>[mapping.privateIp,mapping.fallbackIp].filter(Boolean)
    .map(target=>`${mapping.publicIp}=${target}`)).sort().join('\n')).digest('hex')
  ensure(bridge!['user.payincus.ipv6.ready']===digest,'OSS_RECOVERY_IPV6_NETWORK_PENDING',409)
  state.configured=true;state.status='pending';state.primary=primary.publicIp;state.error='IPV6_RECOVERY_VERIFICATION_PENDING'
  return state
}

/** Read the existing guest files even when it is stopped. Never start the guest
 * or rewrite its networking to discover an original primary address. */
export async function readOriginalDedicatedNetwork(client:Pick<IncusClient,'request'|'readFile'>,
  input:{hostId:number;originalId:number;name:string;ipv4:string;natBindIp:string|null},running:boolean) {
  const forwards=await client.request<RecoveryForward[]>('GET','/1.0/networks/incusbr0/forwards?recursion=1',null,12000)
  if(!forwards.some(row=>row.listen_address!==input.natBindIp))return recoverDedicatedNetwork(input,forwards,null,[])
  const bridge=await client.request<{config:Record<string,string>}>('GET','/1.0/networks/incusbr0',null,12000)
  const file=async(name:'addresses'|'gateway')=>{
    const result=await client.readFile(`/1.0/instances/${encodeURIComponent(input.name)}/files?path=${encodeURIComponent('/etc/payincus/ipv6/'+name)}&project=default`,AbortSignal.timeout(12000),32768)
    ensure(result.statusCode===200 && result.content.length<=32768,'OSS_RECOVERY_GUEST_NETWORK_CONFIG_MISSING',409)
    return result.content.trim().split(/\r?\n/)
  }
  const addresses=await file('addresses'),gateway=await file('gateway')
  ensure(gateway.length===1,'OSS_RECOVERY_GUEST_NETWORK_CONFIG_MISMATCH',409)
  const state=running?await client.request<{network?:Record<string,{addresses?:Array<{address:string}>}>}>('GET',
    `/1.0/instances/${encodeURIComponent(input.name)}/state?project=default`,null,12000):null
  return recoverDedicatedNetwork(input,forwards,bridge.config,
    Object.values(state?.network||{}).flatMap(device=>device.addresses?.map(address=>address.address)||[]),{addresses,gateway:gateway[0],running})
}
