import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { createServer } from 'node:https'
import { resolve } from 'node:path'
import { IncusClient } from '../src/lib/incus/incus-client.js'
import { assertGuestNetworkProtection } from '../src/lib/guest-network-protection.js'
const root=resolve('logs');await mkdir(root,{recursive:true})
const folder=await mkdtemp(resolve(root,'clock-transport-'))
const certPath=resolve(folder,'cert.pem'),keyPath=resolve(folder,'key.pem')
execFileSync(process.env.REVIEW_OPENSSL || (process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl'),
  ['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=clock-fixture','-addext','subjectAltName=IP:127.0.0.1','-keyout',keyPath,'-out',certPath],{stdio:'pipe',windowsHide:true})
const cert=await readFile(certPath,'utf8'), key=await readFile(keyPath)
let offset=14000,age=10000,date=true
const remote=createServer({cert,key,ca:cert,requestCert:true,rejectUnauthorized:true},(request,response)=>{
  assert.ok((request.socket as import('node:tls').TLSSocket).authorized)
  assert.equal(request.method,'GET')
  const time=Date.now()+offset
  response.sendDate=date
  if(date)response.setHeader('date',new Date(time).toUTCString())
  response.end(JSON.stringify({type:'sync',metadata:request.url==='/1.0'?{api_version:'1.0'}:{config:{'user.payincus.guest-guard':`v1:${'a'.repeat(64)}:${time-age}`}}}))
})
await new Promise<void>(resolve=>remote.listen(0,'127.0.0.1',resolve))
const url=`https://127.0.0.1:${(remote.address() as import('node:net').AddressInfo).port}`
const pinned=new IncusClient({url,certPath,keyPath,serverCertificate:cert,serverFingerprint:new X509Certificate(cert).fingerprint256})
const legacy=new IncusClient({url,certPath,keyPath})
try {
  await pinned.connect();await legacy.connect()
  for(offset of [-14000,14000]) {age=10000;await assertGuestNetworkProtection(pinned);age=92000;await assert.rejects(assertGuestNetworkProtection(pinned),/GUEST_NETWORK_PROTECTION_PENDING/)}
  offset=14000;age=0
  await assert.rejects(assertGuestNetworkProtection(legacy),/GUEST_NETWORK_PROTECTION_PENDING/,'unverified peer Date cannot grant clock tolerance')
  date=false;await assert.rejects(assertGuestNetworkProtection(pinned),/GUEST_NETWORK_PROTECTION_PENDING/)
  date=true;offset=65000;await assert.rejects(assertGuestNetworkProtection(pinned),/GUEST_NETWORK_PROTECTION_PENDING/)
  offset=0;age=1000;await assertGuestNetworkProtection(pinned)
  console.log('PASS real mTLS Incus Date: both clock directions, stale/missing/unpinned/excess-skew refusal, current receipt')
} finally {await pinned.close();await legacy.close();await new Promise<void>(resolve=>remote.close(()=>resolve()));await rm(folder,{recursive:true,force:true})}
