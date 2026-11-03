import { isIP } from 'node:net'
import { ensure } from './platform-backup-core.js'
import type { RecoveryForward } from './platform-recovery-network.js'
import type { IncusClient } from '../lib/incus/incus-client.js'
import { dedicatedIpv6Address, normalizeIpv6, privateIpv6, publicIpv6 } from '../lib/host-public-ipv6.js'

type OriginalNetwork = { addresses:string[]; gateway:string }
type Input = { hostId:number; instanceId:number; name:string; ipv4:string; natBindIp:string; publicIpv6:string[] }
const endpoint='/1.0/networks/incusbr0/forwards'
const code='OSS_REVIEW_FORWARD_MISMATCH'

// The caller has authenticated the original host and exact creation attempt/UUID.
// Only absent forwards may be added. Existing rules and guest files are never
// rewritten, even when a same-name rule has a different target or protocol.
export function missingDeliveryForwards(input:Input,forwards:RecoveryForward[],bridge:Record<string,string>,
  assigned:string[],original?:OriginalNetwork):RecoveryForward[] {
  ensure(isIP(input.ipv4)===4 && isIP(input.natBindIp)===4 && input.ipv4!==input.natBindIp &&
    assigned.includes(input.natBindIp) && Array.isArray(forwards) && forwards.length<=257,code,409)
  const addresses=input.publicIpv6.map(publicIpv6)
  ensure(addresses.length<=256 && addresses.every(Boolean) && new Set(addresses).size===addresses.length &&
    addresses.every(ip=>assigned.some(value=>normalizeIpv6(value)===ip)),code,409)
  const owner=`payincus-dedicated:${input.name}`
  const expected:RecoveryForward[]=[{listen_address:input.natBindIp,description:owner,config:{target_address:input.ipv4},ports:[]}]
  if(addresses.length) {
    const gateway=privateIpv6(original?.gateway)
    ensure(gateway && bridge['ipv6.address']?.split('/')[1]==='64' &&
      normalizeIpv6(bridge['ipv6.address'].split('/')[0])===gateway && bridge['ipv6.nat']==='true' &&
      bridge['ipv6.routing']!=='false' && original,'OSS_RECOVERY_GUEST_NETWORK_CONFIG_MISSING',409)
    const configured=original.addresses.map(normalizeIpv6)
    const targets:string[]=[]
    for(const address of addresses as string[]) {
      const primary=dedicatedIpv6Address(gateway,input.instanceId,address)
      const fallback=dedicatedIpv6Address(gateway,input.instanceId,`${address}:other-protocols`)
      // Old single-target rules are retained only when the original guest file
      // proves that format. Do not upgrade its network during controller restore.
      const paired=configured.includes(fallback)
      targets.push(primary,...(paired?[fallback]:[]))
      expected.push({listen_address:address,description:owner,config:{target_address:paired?fallback:primary},
        ports:paired?['tcp','udp'].map(protocol=>({protocol,listen_port:'1-65535',target_address:primary,snat:true})):[]})
    }
    ensure(configured.length===targets.length && new Set(configured).size===configured.length &&
      targets.every(target=>configured.includes(target)),'OSS_RECOVERY_GUEST_NETWORK_CONFIG_MISMATCH',409)
  }
  const key=(value:string)=>isIP(value)===6?normalizeIpv6(value):value
  ensure(new Set(forwards.map(item=>key(item.listen_address))).size===forwards.length,code,409)
  for(const actual of forwards) {
    const wanted=expected.find(item=>key(item.listen_address)===key(actual.listen_address))
    ensure(wanted && actual.description===owner && key(actual.config?.target_address)===key(wanted.config.target_address) &&
      (actual.ports?.length||0)===(wanted.ports?.length||0) && (wanted.ports||[]).every(port=>
        actual.ports?.some(value=>value.protocol===port.protocol && value.listen_port===port.listen_port &&
          key(value.target_address||'')===key(port.target_address||'') && !value.target_port && value.snat===true)),code,409)
  }
  return expected.filter(item=>!forwards.some(actual=>key(actual.listen_address)===key(item.listen_address)))
}

export async function restoreMissingDeliveryForwards(client:Pick<IncusClient,'request'|'readFile'>,input:Input,
  guard:()=>Promise<void>,record:(address:string,phase:'planned'|'verified')=>Promise<void>) {
  const inspect=async()=>{
    const networks=await client.request<Array<{name:string;type:string;managed:boolean}>>('GET','/1.0/networks?recursion=1',null,12000)
    const physical=networks.filter(item=>!item.managed && item.type==='physical')
    ensure(physical.length>0 && physical.length<=32,code,409)
    const assigned:string[]=[]
    for(const device of physical) {
      const state=await client.request<{state:string;addresses?:Array<{address:string}>}>('GET',`/1.0/networks/${encodeURIComponent(device.name)}/state`,null,12000)
      if(state.state==='up')assigned.push(...(state.addresses||[]).map(item=>item.address))
    }
    const bridge=await client.request<{config:Record<string,string>}>('GET','/1.0/networks/incusbr0',null,12000)
    let original:OriginalNetwork|undefined
    if(input.publicIpv6.length) {
      const read=async(name:string)=>{
        const file=await client.readFile(`/1.0/instances/${encodeURIComponent(input.name)}/files?path=${encodeURIComponent('/etc/payincus/ipv6/'+name)}&project=default`,AbortSignal.timeout(12000),32768)
        ensure(file.statusCode===200,'OSS_RECOVERY_GUEST_NETWORK_CONFIG_MISSING',409)
        return file.content.trim().split(/\r?\n/)
      }
      const addresses=await read('addresses'),gateway=await read('gateway')
      ensure(gateway.length===1,'OSS_RECOVERY_GUEST_NETWORK_CONFIG_MISMATCH',409)
      original={addresses,gateway:gateway[0]}
    }
    const forwards=await client.request<RecoveryForward[]>('GET',`${endpoint}?recursion=1`,null,12000)
    return missingDeliveryForwards(input,forwards,bridge.config,assigned,original)
  }
  const missing=await inspect()
  for(const forward of missing) {
    await guard()
    // Reinspect every rule before writing. POST atomically refuses an address
    // claimed concurrently; a lost receipt is recovered by the next read.
    const current=await inspect()
    if(!current.some(item=>item.listen_address===forward.listen_address))continue
    await record(forward.listen_address,'planned')
    await guard()
    const final=await inspect()
    const latest=final.find(item=>item.listen_address===forward.listen_address)
    if(!latest)continue
    ensure(JSON.stringify(latest)===JSON.stringify(forward),'OSS_RECOVERY_EVIDENCE_STALE',409)
    await client.request('POST',endpoint,forward,12000)
    ensure(!(await inspect()).some(item=>item.listen_address===forward.listen_address),code,409)
    await record(forward.listen_address,'verified')
  }
}
