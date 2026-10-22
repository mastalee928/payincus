// Local browser verification harness. Uses real auth/HTTPS console behind a
// loopback-only HTTP test proxy so self-signed browser warnings are not bypassed.
import { createServer as createProxy } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { resolve, join } from 'node:path'
import { promisify } from 'node:util'
import { createGatewayAuth, initializeGatewayAuth } from '../server/dist/services/gateway-auth.js'
import { createGatewayConsoleServer } from '../server/dist/services/gateway-console.js'

if (process.argv.length !== 3) throw new Error('test directory required')
const directory = resolve(process.argv[2])
await mkdir(directory, { recursive: true }); await chmod(directory, 0o700)
const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl'
await promisify(execFile)(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory,'tls.key'), '-out', join(directory,'tls.crt'),
  '-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'])
const password = 'fixture-only-browser-password-1234', recoveryCodes = ['fixture-only-browser-recovery-00001', ...Array.from({length:7},()=>randomBytes(24).toString('base64url'))]
try { await initializeGatewayAuth(directory,{username:'gateway-test',password,role:'operator',totpSeed:randomBytes(20).toString('base64'),recoveryCodes}) }
catch (error) { if (error.code !== 'EEXIST') throw error; throw new Error('Use a fresh test directory') }
await writeFile(join(directory,'browser-credentials.json'),JSON.stringify({username:'gateway-test',password,recoveryCode:recoveryCodes[0]}),{mode:0o600})
const auth = await createGatewayAuth(directory), cert = await readFile(join(directory,'tls.crt')), key = await readFile(join(directory,'tls.key'))
const origin = 'https://localhost:19444'
const server = await createGatewayConsoleServer({cert,key},{origin,auth,assetDirectory:resolve('server/src/gateway-ui'),status:async()=>({
  gatewayId:'22222222-2222-4222-8222-222222222222',slot:'b',address:'10.250.2.1',componentVersion:'development',configurationEpoch:'3',configurationSequence:'2',transportReady:true,
  canWrite:false,blockers:['host-write-service-not-ready','backup-not-configured'],peers:[{nodeId:'33333333-3333-4333-8333-333333333333',address:'10.250.2.2',enabled:true,lastHandshakeAt:Math.floor(Date.now()/1000)}],
  backup:{ready:false,lastCompletedAt:null}})})
await new Promise(resolve=>server.listen(19444,'127.0.0.1',resolve))
const proxy=createProxy((req,res)=>{
  const headers={...req.headers,host:'localhost:19444'}
  if(headers.origin==='http://localhost:19445')headers.origin=origin
  const upstream=httpsRequest({hostname:'127.0.0.1',port:19444,path:req.url,method:req.method,headers,ca:cert,servername:'localhost',agent:false},response=>{
    res.writeHead(response.statusCode,response.headers);response.pipe(res)
  });upstream.once('error',()=>{res.writeHead(502);res.end()});req.pipe(upstream)
})
await new Promise(resolve=>proxy.listen(19445,'127.0.0.1',resolve))
console.log('Gateway browser test ready at http://localhost:19445; status rows are explicit fixtures, authentication is real.')
const stop=()=>{proxy.closeAllConnections();server.closeAllConnections();proxy.close(()=>server.close(()=>process.exit(0)))}
process.once('SIGTERM',stop);process.once('SIGINT',stop)
