import assert from 'node:assert/strict'
import { incusResourceSize } from '../src/lib/resource-size.js'
import { buildInstanceConfig, patchInstanceResources } from '../src/lib/incus/incus-instances.js'
import { assertRecoveryGuestResources } from '../src/services/platform-recovery-inventory.js'
import { closePrismaDatabase } from '../src/db/prisma.js'
import { readFileSync } from 'node:fs'
for (const memory of [768,4096]) {
  const config = buildInstanceConfig({ name: 'resource-size', cpu: memory===768?200:100, memory, disk: 30720, image: 'fixture/debian' } as any)
  assert.equal(config.config?.['limits.memory'], `${memory}MiB`)
  assert.equal(config.devices?.root.size, '30720MiB')
  let patch: any
  await patchInstanceResources({ request: async (method: string, _path: string, body: unknown) => {
    if(method==='GET')return {devices:{root:{type:'disk',pool:'original',path:'/',size:'30720MB'}}}
    patch=body;return {}
  } } as any,'resource-size',{memory,disk:30720})
  assert.equal(patch.config['limits.memory'], `${memory}MiB`)
  assert.equal(patch.devices.root.size, '30720MiB');assert.equal(patch.devices.root.pool,'original')
}
for(const value of [0,-1,1.1,NaN,Infinity])assert.throws(()=>incusResourceSize(value),/INVALID/)
const expected={cpu:100,memory:4096,disk:30720,instanceType:'container'}
const live=(unit:string)=>({type:'container',config:{'limits.cpu':'1','limits.cpu.allowance':'100%','limits.memory':'4096'+unit},devices:{root:{type:'disk',path:'/',size:'30720'+unit}}})
assertRecoveryGuestResources(expected,live('MiB'))
assertRecoveryGuestResources(expected,live('MB'))
assert.throws(()=>assertRecoveryGuestResources(expected,{...live('MB'),devices:live('MiB').devices}),/MISMATCH/)
const rebuild=readFileSync('src/workers/instanceTaskWorker.ts','utf8')
assert.ok(rebuild.includes("rebuildConfig['limits.memory'] = incusResourceSize(recordedResources.memory)")&&rebuild.includes('size: incusResourceSize(recordedResources.disk)'))
console.log('PASS exact MiB resources: E2/ARM1C create and patch, original root pool, invalid sizes and paired legacy/current backup compatibility')
await closePrismaDatabase();process.exit(0)
