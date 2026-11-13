import type { Prisma } from '@prisma/client'
export const HOST_PROVISIONING_CAPABILITY='host-provisioning-tools-v1'
export const HOST_PROVISIONING_MAX_AGE_MS=180000
export function acceptHostProvisioningStatus(v:unknown,signedAt:number,receivedAt:number){
 if(!v||typeof v!=='object'||Array.isArray(v)||!Number.isSafeInteger(signedAt)||!Number.isSafeInteger(receivedAt))return null
 const r=v as Record<string,unknown>,at=typeof r.checkedAt==='string'?Date.parse(r.checkedAt):NaN
 if(r.version!==1||typeof r.ready!=='boolean'||!Number.isFinite(at))return null
 const age=signedAt-at,valid=Number.isSafeInteger(signedAt)&&Math.abs(receivedAt-signedAt)<=60000&&age>=-5000&&age<HOST_PROVISIONING_MAX_AGE_MS
 return {version:1,ready:r.ready&&valid,checkedAt:new Date(receivedAt-Math.max(0,Number.isFinite(age)?age:0)).toISOString(),
  ...(valid&&['needed','pending','verified'].includes(String(r.incusCompat))&&typeof r.compatHash==='string'&&/^[a-f0-9]{64}$/.test(r.compatHash)?{incusCompat:r.incusCompat,compatHash:r.compatHash,...(typeof r.compatRequest==='string'&&/^[a-f0-9-]{36}$/.test(r.compatRequest)?{compatRequest:r.compatRequest}:{})}:{}),
  ...(!r.ready||!valid?{error:valid?'HOST_PROVISIONING_TOOLS_PENDING':'HOST_PROVISIONING_CLOCK_INVALID'}:{})}
}
export function hostProvisioningToolsReadyWhere(now=new Date()):Prisma.HostAgentWhereInput {
 return {enabled:true,lastSeenAt:{gt:new Date(now.getTime()-180000),lte:new Date(now.getTime()+5000)},capabilities:{array_contains:[HOST_PROVISIONING_CAPABILITY]},AND:[
  {lastReport:{path:['hostProvisioningStatus','version'],equals:1}},
  {lastReport:{path:['hostProvisioningStatus','ready'],equals:true}},
  {lastReport:{path:['hostProvisioningStatus','checkedAt'],gt:new Date(now.getTime()-180000).toISOString()}},
  {lastReport:{path:['hostProvisioningStatus','checkedAt'],lte:new Date(now.getTime()+5000).toISOString()}}
 ]}
}
export function hostProvisioningToolsReady(agent:{enabled:boolean;lastSeenAt:Date|null;capabilities:unknown;lastReport:unknown}|null|undefined,now=Date.now()):boolean{
 const v=(agent?.lastReport as {hostProvisioningStatus?:unknown}|null)?.hostProvisioningStatus
 const r=v as {version?:number;ready?:boolean;checkedAt?:string}|null,at=Date.parse(r?.checkedAt||'')
 return !!(agent?.enabled&&agent.lastSeenAt&&now-agent.lastSeenAt.getTime()<180000&&agent.lastSeenAt.getTime()<=now+5000&&
  Array.isArray(agent.capabilities)&&agent.capabilities.includes(HOST_PROVISIONING_CAPABILITY)&&r?.version===1&&r.ready===true&&at<=now+5000&&now-at<180000)
}
