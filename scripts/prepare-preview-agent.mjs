import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const [input,output]=process.argv.slice(2)
assert.ok(input&&output)
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
const version=(await readFile('agent/VERSION','utf8')).trim()
const manifest={version,sourceCommit:source,generatedAt:new Date().toISOString(),files:{}}
await mkdir(output,{recursive:true})
for(const arch of ['amd64','arm64']){
 const name=`incudal-agent-linux-${arch}`,from=resolve(input,name),data=await readFile(from)
 assert.equal(data.subarray(0,4).toString('hex'),'7f454c46')
 assert.equal(data.readUInt16LE(18),arch==='amd64'?62:183)
 await copyFile(from,resolve(output,name))
 manifest.files[`linux-${arch}`]={name,sha256:createHash('sha256').update(data).digest('hex'),size:data.length,gzip:false}
}
await writeFile(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2))
console.log(`Prepared same-source preview Agent ${version} ${source}`)
