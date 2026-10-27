import { isAbsolute, join,dirname,resolve } from 'node:path'
import { readDiscoveryPrivateFile, acquireDiscoveryProcessLock,acquireDiscoveryMutationLock,validateDiscoveryPrivateDirectory } from '../services/controller-discovery.js'
import { collectGatewaySnapshot, gatewayBackupJob, restoreGatewaySnapshot, readGatewaySnapshotSource } from '../services/gateway-backup.js'
import { createGatewayOssStore } from '../services/gateway-backup-oss.js'
import { verifyGatewayTransport } from '../lib/gateway-transport.js'
import { createHash } from 'node:crypto'
import { mkdir, open } from 'node:fs/promises'
import { constants } from 'node:fs'

interface Configuration {
  schemaVersion: 1; platformId: string; gatewayId: string; stateDirectory: string; componentVersion: string
  intervalSeconds: number; passwordPath: string; sources: Record<string,string>; trustedKeys: Record<string,string>
  retention:number;protectedIds:string[]
  oss: { region:string;bucket:string;accessKeyId:string;accessKeySecret:string;prefix:string }
}
// Standalone scheduler and portable recovery tool, no business DB or .env.
async function main(){
  const mode=process.argv[2],path=process.argv[3]
  if(!['--once','--serve','--recover'].includes(mode)||!path||!isAbsolute(path)||(mode==='--recover'?process.argv.length!==6:process.argv.length!==4))throw Error('usage')
  const raw=await readDiscoveryPrivateFile(path,32768),config=JSON.parse(raw) as Configuration
  const fields=['schemaVersion','platformId','gatewayId','stateDirectory','componentVersion','intervalSeconds','passwordPath','sources','trustedKeys','retention','protectedIds','oss']
  if(raw!==JSON.stringify(config)||config.schemaVersion!==1||Object.keys(config).length!==fields.length||!fields.every(field=>Object.hasOwn(config,field))||!isAbsolute(config.stateDirectory)||!isAbsolute(config.passwordPath)||
    !Number.isInteger(config.intervalSeconds)||config.intervalSeconds<60||config.intervalSeconds>86400||!config.sources||!config.oss||!config.trustedKeys)throw Error('config')
  if(!Number.isInteger(config.retention)||config.retention<3||config.retention>30||!Array.isArray(config.protectedIds)||config.protectedIds.length>30||config.protectedIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)))throw Error('retention')
  const password=await readDiscoveryPrivateFile(config.passwordPath,256)
  const store=createGatewayOssStore({...config.oss,platformId:config.platformId,gatewayId:config.gatewayId})
  try{
    if(mode==='--recover'){
      const release=await acquireDiscoveryMutationLock(config.stateDirectory)
      try{
      const id=process.argv[4],directory=process.argv[5];if(!isAbsolute(directory)||resolve(directory)!==directory)throw Error('directory')
      const snapshot=await restoreGatewaySnapshot(store,config.oss.prefix,config,id,password)
      await validateDiscoveryPrivateDirectory(dirname(directory))
      await mkdir(directory,{mode:0o700})
      for(const file of snapshot.files){
        const target=join(directory,file.name),handle=await open(target,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600)
        try{await handle.writeFile(Buffer.from(file.base64,'base64'));await handle.sync()}finally{await handle.close()}
      }
      const handle=await open(directory,constants.O_RDONLY|constants.O_NOFOLLOW);try{await handle.sync()}finally{await handle.close()}
      process.stdout.write(JSON.stringify({recovered:true,id,epoch:snapshot.epoch,sequence:snapshot.sequence,files:snapshot.files.length,activationRequired:true})+'\n');return
      }finally{await release()}
    }
    const once=async()=>{
      const encoded=await readGatewaySnapshotSource('gateway-transport.json',config.sources['gateway-transport.json'])
      const issuedAt=JSON.parse(Buffer.from(JSON.parse(encoded).payload,'base64').toString()).issuedAt as number
      const {config:transport}=verifyGatewayTransport(encoded,{platformId:config.platformId,gatewayId:config.gatewayId,now:issuedAt,trustedKeys:config.trustedKeys})
      const snapshot=await collectGatewaySnapshot({platformId:config.platformId,gatewayId:config.gatewayId,epoch:transport.epoch,sequence:transport.sequence,componentVersion:config.componentVersion,sources:config.sources})
      if(snapshot.files.find(file=>file.name==='gateway-transport.json')?.sha256!==createHash('sha256').update(encoded).digest('hex'))throw Error('gateway configuration changed during capture')
      const complete=await gatewayBackupJob(config.stateDirectory,store,config.oss.prefix,snapshot,password,{count:config.retention,protectedIds:config.protectedIds})
      process.stdout.write(JSON.stringify({backupComplete:true,id:complete.id,epoch:complete.epoch,sequence:complete.sequence})+'\n')
    }
    if(mode==='--once'){await once();return}
    const release=await acquireDiscoveryProcessLock(config.stateDirectory)
    let stopped=false;const stop=()=>{stopped=true};process.once('SIGTERM',stop);process.once('SIGINT',stop)
    let lastRun=0,lastDigest=''
    try{while(!stopped){
      try{
        const hasher=createHash('sha256')
        for(const [name,path]of Object.entries(config.sources).sort(([a],[b])=>a.localeCompare(b))){
          hasher.update(name+'\n');hasher.update(await readGatewaySnapshotSource(name,path));hasher.update('\n')
        }
        const digest=hasher.digest('hex')
        if(Date.now()-lastRun>=config.intervalSeconds*1000||digest!==lastDigest){await once();lastRun=Date.now();lastDigest=digest}
      }catch{process.stderr.write('Gateway backup is incomplete; retry is scheduled and prior archives remain.\n')}
      await new Promise(resolve=>setTimeout(resolve,Math.min(config.intervalSeconds*1000,10000)))
    }}finally{await release()}
  }finally{store.close()}
}
main().catch(()=>{process.stderr.write('Gateway backup refused; verify protected sources, independent password, OSS prefix and permissions.\n');process.exitCode=1})
