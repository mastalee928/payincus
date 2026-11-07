/** One backend is an architecture invariant. Keep a nonblocking per-host lane
 * around the whole HTTP/async-operation lifetime, so maintenance registration
 * cannot race a mutation that has just passed its database fence. Durable
 * tasks and the remote Incus operation list cover backend restarts separately. */
import { HostMaintenanceError } from './host-maintenance-gate.js'
const lanes=new Map<number,{readers:number;maintenance:boolean}>()
const busy=()=>{throw new Error('HARDENING_BUSY')}
export function beginHostMutation(hostId:number):()=>void {
  const lane=lanes.get(hostId)||{readers:0,maintenance:false}
  if(lane.maintenance)throw new HostMaintenanceError()
  lane.readers++;lanes.set(hostId,lane)
  let released=false
  return ()=>{if(released)return;released=true;lane.readers--;if(!lane.readers&&!lane.maintenance)lanes.delete(hostId)}
}
export async function withHostMaintenanceLane<T>(hostId:number,action:()=>Promise<T>):Promise<T> {
  const lane=lanes.get(hostId)||{readers:0,maintenance:false}
  if(lane.readers||lane.maintenance)busy()
  lane.maintenance=true;lanes.set(hostId,lane)
  try{return await action()}finally{lane.maintenance=false;if(!lane.readers)lanes.delete(hostId)}
}
