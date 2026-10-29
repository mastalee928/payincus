export const pending=[]
const defer=(kind,data)=>new Promise((resolve,reject)=>pending.push({kind,data,resolve,reject}))
export const controls={deferPackages:false,publicReads:0}
export default {systemConfig:{list:()=>defer('list',{}),update:configs=>defer('update',{configs}),testSmtp:()=>defer('smtp-test',{}),sendTestEmail:to=>defer('smtp-send',{to}),getPublic:async()=>{controls.publicReads++;return{registrationEnabled:true,requireInviteCode:true}}},packages:{list:params=>controls.deferPackages?defer('packages',params):Promise.resolve({packages:[]})}}
