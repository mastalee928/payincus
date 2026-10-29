export const pending=[]
const defer=(kind,data)=>new Promise((resolve,reject)=>pending.push({kind,data,resolve,reject}))
export default {systemConfig:{list:()=>defer('list',{}),update:configs=>defer('update',{configs}),getPublic:async()=>({registrationEnabled:true,requireInviteCode:true})},packages:{list:async()=>({packages:[]})}}
