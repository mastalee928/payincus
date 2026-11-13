import{readFile,writeFile,mkdir}from'node:fs/promises'
import{createHash}from'node:crypto'
import{execFileSync}from'node:child_process'
import{gzipSync}from'node:zlib'
import{resolve}from'node:path'
const input=process.argv[2]||'incus-compat-input',destination='agent/internal/provisioning/compat'
const runId=process.env.INCUS_COMPAT_BUILD_RUN||'43510197753'
if(!/^[1-9]\d+$/.test(runId))throw Error('INCUS_COMPAT_BUILD_RUN_INVALID')
await mkdir(destination,{recursive:true})
for(const arch of['amd64','arm64']){
 const dir=resolve(input,arch);await mkdir(dir,{recursive:true})
 execFileSync('gh',['run','download',runId,'--name','incudal-incusd-sysinfo-'+arch,'--dir',dir],{stdio:'pipe'})
 const m=JSON.parse(await readFile(resolve(dir,'incusd-manifest.json'),'utf8')),b=await readFile(resolve(dir,'incusd'))
 if(m.purpose!=='alpine-incus-sysinfo-compat'||m.incusVersion!=='7.0.1'||m.sourceSha256!=='5e415fa1684f0945d45ca780af6662f143b857681e18d29038725cde70c26ee6'||m.patchedSourceSha256!=='bad35c2986663bddeddb94e088969ba1671446dc08875da6a6727e996334f12a'||m.size!==b.length||createHash('sha256').update(b).digest('hex')!==m.sha256||b.readUInt16LE(18)!==(arch==='amd64'?62:183))throw Error('INCUS_COMPAT_FIXED_ARTIFACT_MISMATCH')
 await writeFile(destination+'/manifest-'+arch+'.json',JSON.stringify(m));await writeFile(destination+'/incusd-'+arch+'.gz',gzipSync(b,{level:9}))
 await writeFile('agent/internal/provisioning/compat_payload_'+arch+'.go',`//go:build linux && ${arch}\npackage provisioning\nimport "embed"\n//go:embed compat/incusd-${arch}.gz compat/manifest-${arch}.json\nvar compatibilityPayload${arch} embed.FS\nfunc init(){compatibilityFiles=compatibilityPayload${arch}}\n`)
}
console.log('Prepared pinned, native-validated Incus compatibility payloads')
