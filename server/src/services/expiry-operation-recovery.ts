import type { IncusClient } from '../lib/incus/incus-client.js'

/** After a stop/delete was refused, settle exact operations touching this
 * expired target. Unknown unrelated operations never authorize cancellation. */
export async function settleExpiredGuestOperations(client:IncusClient,name:string,signal:AbortSignal):Promise<void>{
  let groups:unknown
  try{groups=await client.request('GET','/1.0/operations?recursion=1',null,5000,signal)}catch{return}
  const rows:Record<string,any>[]=[]
  const collect=(v:unknown)=>{
    if(Array.isArray(v)){v.forEach(collect);return}
    if(!v||typeof v!=='object')return
    const r=v as Record<string,any>
    if(typeof r.id==='string'){rows.push(r);return}
    Object.values(r).forEach(collect)
  }
  collect(groups)
  const target=`/1.0/instances/${encodeURIComponent(name)}`
  const touches=(v:unknown):boolean=>{
    if(typeof v==='string'){try{const path=new URL(v,'https://incus.invalid').pathname;return path===target||path.startsWith(target+'/')}catch{return false}}
    return Array.isArray(v)?v.some(touches):!!v&&typeof v==='object'&&Object.values(v).some(touches)
  }
  for(const op of rows){
    if(['Success','Failure','Cancelled','Canceled'].includes(op.status)||!touches(op.resources))continue
    const path=op.id.startsWith('/1.0/operations/')?op.id:`/1.0/operations/${op.id}`
    if(!/^\/1\.0\/operations\/[a-zA-Z0-9_-]+$/.test(path))continue
    if(op.may_cancel===true){
      try{await client.withExpiryOperationCancellation(path).request('DELETE',path,null,5000,signal)}catch{/* retry state first */}
    }else{
      try{await client.request('GET',path+'/wait?timeout=1',null,2000,signal)}catch{/* next stop still attempts */}
    }
  }
}
