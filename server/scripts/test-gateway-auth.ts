import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGatewayAuth, gatewayTotp, initializeGatewayAuth } from '../src/services/gateway-auth.js'

const directory=await mkdtemp(join(tmpdir(),'payincus-gateway-auth-'))
const seed=randomBytes(20).toString('base64'),password='fixture-only-password-1234',username='gateway-owner'
const recoveryCodes=Array.from({length:8},()=>randomBytes(24).toString('base64url'))
const path=join(directory,'gateway-auth.json')
let checks=0
try {
  await chmod(directory,0o700)
  await assert.rejects(createGatewayAuth(directory));checks++
  await initializeGatewayAuth(directory,{username,password,role:'operator',totpSeed:seed,recoveryCodes})
  await assert.rejects(initializeGatewayAuth(directory,{username,password,role:'operator',totpSeed:seed,recoveryCodes}));checks++
  const auth=await createGatewayAuth(directory)
  const step=Math.floor(Date.now()/30000),totp=gatewayTotp(seed,step)
  const result=await auth.login({username,password,totp})
  assert.equal(result.role,'operator');assert.ok(result.csrf);checks++
  await assert.rejects(auth.login({username,password,totp}));checks++
  assert.equal((await auth.session(result.token,result.csrf,true)).username,username);checks++
  await assert.rejects(auth.session(result.token,'wrong',true));checks++
  await assert.rejects(auth.session(result.token,result.csrf,true,true));checks++
  await auth.reauthenticate(result.token,result.csrf,{password,recoveryCode:recoveryCodes[0]})
  assert.equal((await auth.session(result.token,result.csrf,true,true)).role,'operator');checks++
  await assert.rejects(auth.login({username,password,recoveryCode:recoveryCodes[0]}));checks++
  const raced=await Promise.allSettled([auth.login({username,password,recoveryCode:recoveryCodes[1]}),auth.login({username,password,recoveryCode:recoveryCodes[1]})])
  assert.equal(raced.filter(item=>item.status==='fulfilled').length,1);checks++
  const restarted=await createGatewayAuth(directory)
  await assert.rejects(restarted.session(result.token));checks++
  await assert.rejects(restarted.login({username,password,recoveryCode:recoveryCodes[1]}));checks++
  // Failures accumulated above reach the same persisted account lock; restart
  // cannot reset it. Use a pristine saved fixture to check revocation separately.
  let state=JSON.parse(await readFile(path,'utf8'))
  state.users[0].failures=0;state.users[0].lockedUntil=0
  await writeFile(path,JSON.stringify(state),{mode:0o600})
  const locked=await createGatewayAuth(directory)
  for(let i=0;i<5;i++)await assert.rejects(locked.login({username,password:'wrong-password-1234',recoveryCode:recoveryCodes[2]}))
  await assert.rejects((await createGatewayAuth(directory)).login({username,password,recoveryCode:recoveryCodes[2]}));checks++
  state=JSON.parse(await readFile(path,'utf8'));state.users[0].lockedUntil=0;state.users[0].failures=0
  await writeFile(path,JSON.stringify(state),{mode:0o600})
  const valid=await auth.login({username,password,recoveryCode:recoveryCodes[2]})
  await auth.revokeUser(username)
  await assert.rejects(auth.session(valid.token));checks++
  const fresh=await auth.login({username,password,recoveryCode:recoveryCodes[3]})
  auth.logout(fresh.token);await assert.rejects(auth.session(fresh.token));checks++
  const disk=await readFile(path,'utf8')
  assert.ok(!disk.includes(password)&&!recoveryCodes.some(code=>disk.includes(code))&&!disk.includes(fresh.token));checks++
  assert.equal(gatewayTotp(Buffer.from('12345678901234567890').toString('base64'),1),'287082');checks++
  await writeFile(path,'{corrupt',{mode:0o600});await assert.rejects(createGatewayAuth(directory));checks++
  console.log(`Gateway independent auth passed: ${checks} password/MFA/replay/recovery/lock/session/revocation checks; no business database`)
} finally {await rm(directory,{recursive:true,force:true})}
