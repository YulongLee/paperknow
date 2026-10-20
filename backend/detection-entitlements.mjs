const fail=()=>{throw Object.assign(new Error('当前检测入口尚未开放本次计价，请稍后核对服务说明；不会自动扣除积分。'),{status:503});};

// Existing standalone detection remains free. Only an already purchased,
// matching service allowance is recorded; no credit quote is auto-confirmed.
export function detectionFreeEntryReady(billing,key){
 if(!billing)return true;
 try{return billing.toolRules().services.find(item=>item.key===key)?.effectiveMode==='free';}catch{return false;}
}
export function reserveIncludedDetection(billing,user,jobId,key,{createJob}={}){
 if(!billing)return false;
 if(!detectionFreeEntryReady(billing,key))fail();
 const quote=billing.quote(user,{type:'agent',serviceKey:key});
 if(quote.source==='free')return false;
 if(!['bundle','membership'].includes(quote.source)||quote.creditCost!==0)fail();
 createJob?.();
 billing.reserve(user,jobId,1,'agent',quote.token,key);
 return true;
}
