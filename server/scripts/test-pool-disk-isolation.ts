import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isolatedPoolConfiguration, isolatedPoolCreate, isolatedSystemPoolWhere } from '../src/lib/pool-disk-isolation.js'
import { ensureIsolatedPool, pruneIsolatedPoolImageVolumes } from '../src/lib/pool-disk-isolation-remote.js'
import { IncusApiError } from '../src/lib/incus/incus-client.js'

assert.equal(isolatedPoolConfiguration({driver:'btrfs',config:{size:'34GiB'}}),false)
assert.equal(isolatedPoolConfiguration({driver:'lvm',config:{'volume.block.filesystem':'ext4'}}),false)
assert.equal(isolatedPoolConfiguration({driver:'lvm',config:{'volume.block.filesystem':'btrfs'}}),true)
assert.equal(isolatedPoolConfiguration({driver:'lvm',config:{'volume.block.filesystem':'btrfs','lvm.use_thinpool':'false'}}),false)
assert.deepEqual(isolatedPoolCreate(34).config,{size:'34GiB','volume.block.filesystem':'btrfs','lvm.use_thinpool':'true','user.payincus.disk-isolation':'lvm-btrfs-v1'})
for(const value of [0,-1,1.5,NaN,10001])assert.throws(()=>isolatedPoolCreate(value))
assert.equal(isolatedSystemPoolWhere.driver,'lvm')

const path='/1.0/storage-pools/payincus-pool'
for(const scenario of ['new','legacy','existing','incomplete','occupied','malformed-guests','busy','custom-volume','profile-used','unregistered','other-device','delete-lost','create-lost','held']){
 let pool:any=scenario==='new'?null:scenario==='existing'?{driver:'lvm',status:'Created',config:{'volume.block.filesystem':'btrfs'}}:
  {driver:'btrfs',status:'Created',config:{source:scenario==='other-device'?'/dev/sda':'/var/lib/incus/disks/payincus-pool.img'},used_by:scenario==='profile-used'?['/1.0/profiles/custom']:[]}
 if(scenario==='incomplete')pool={...isolatedPoolCreate(34),status:'Errored',used_by:[]}
 const writes:string[]=[];let failed=false
 const client:any={request:async(method:string,url:string,body:any)=>{
  if(method==='GET'&&url===path){if(!pool)throw new IncusApiError('missing',404,path);return structuredClone(pool)}
  if(url.startsWith('/1.0/instances?'))return scenario==='occupied'?[{name:'customer'}]:scenario==='malformed-guests'?null:[]
  if(url.startsWith('/1.0/operations?'))return scenario==='busy'?{running:[{status:'Running'}]}:{}
  if(url.startsWith(path+'/volumes?'))return scenario==='custom-volume'?[{type:'custom'}]:[{type:'image'}]
  writes.push(method)
  if(method==='DELETE'){pool=null;if(scenario==='delete-lost'&&!failed){failed=true;throw Error('connection lost')}return}
  if(method==='POST'){assert.deepEqual(body,isolatedPoolCreate(34));pool={...body,status:'Created'};if(scenario==='create-lost'&&!failed){failed=true;throw Error('connection lost')}return}
  throw Error('unexpected request')
 }}
 const run=()=>ensureIsolatedPool(client,34,scenario!=='unregistered',async()=>{if(scenario==='held')throw Error('held')})
 if(['new','legacy','existing','incomplete'].includes(scenario)){
  assert.equal(isolatedPoolConfiguration(await run()),true)
  const count=writes.length;await run();assert.equal(writes.length,count,'repeat must not rebuild a completed pool')
 }else if(scenario.endsWith('-lost')){
  await assert.rejects(run());assert.equal(isolatedPoolConfiguration(await run()),true)
  assert.equal(writes.filter(w=>w==='DELETE').length,1)
  assert.equal(writes.filter(w=>w==='POST').length,1)
 }else{await assert.rejects(run());assert.equal(writes.length,0,scenario+' must preserve unconfirmed data')}
}
const worker=readFileSync(new URL('../src/services/pool-disk-preparation.ts',import.meta.url),'utf8')
assert.ok(worker.includes('HOST_OCCUPIED_INSTANCE_WHERE')&&worker.includes('checkoutReservation.count')&&worker.includes('FOR UPDATE'))
assert.ok(!/request\('DELETE',.*instances/.test(worker),'pool preparation never deletes a customer instance')
console.log('PASS independent disk layout: new/legacy/idempotency, lost responses, live guests, custom volumes and held operation guards')

for (const scenario of ['ready', 'busy', 'other-pool', 'legacy', 'changed', 'malformed', 'held', 'many']) {
  const fingerprint = 'a'.repeat(64), deletes: string[] = []
  const config = { ...isolatedPoolCreate(34).config, source: '/var/lib/incus/disks/payincus-pool.img' }
  let reads = 0
  const client: any = { request: async (method: string, url: string) => {
    if (url === path) return { driver: scenario === 'legacy' ? 'btrfs' : 'lvm', status: 'Created',
      config: scenario === 'changed' && reads++ ? { ...config, source: '/dev/other' } : config }
    if (url.includes('/operations?')) return scenario === 'busy' ? { running: [{ status: 'Running' }] } : {}
    if (url.includes('/volumes?')) return scenario === 'many' ? Array.from({length:8},(_,i)=>({name:String(i).repeat(64),type:'image'})) : [{ name: 'customer', type: 'container' }, { name: 'customer/saved', type: 'container' },
      { name: 'customer-data', type: 'custom' }, { name: scenario === 'malformed' ? 'unknown' : fingerprint, type: 'image' }]
    if (method === 'DELETE') { deletes.push(url); return {} }
    throw Error('unexpected cache request')
  } }
  const run = () => pruneIsolatedPoolImageVolumes(client, scenario === 'other-pool' ? 'unmanaged' : 'payincus-pool', async () => { if (scenario === 'held') throw Error('held') })
  if (['changed', 'malformed', 'held'].includes(scenario)) await assert.rejects(run())
  else await run()
  assert.deepEqual(deletes, scenario === 'ready' ? [`${path}/volumes/image/${fingerprint}`] : scenario === 'many' ?
    Array.from({length:4},(_,i)=>`${path}/volumes/image/${String(i).repeat(64)}`) : [])
}
console.log('PASS optimized image cleanup: only exact image cache volumes, no customer disks/snapshots/custom volumes; busy/identity/hold gates retained')
