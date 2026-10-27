const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function detectionPricing(billing,key){
 if(!billing)return{pricingMode:'free',pointsCharged:false,creditCost:0,pricingVersion:null};
 try{const rules=billing.toolRules(),item=rules.services.find(item=>item.key===key);if(!item||!['free','paid'].includes(item.effectiveMode))return{pricingMode:'unavailable',pointsCharged:false,creditCost:0,pricingVersion:rules.version};return{pricingMode:item.effectiveMode,pointsCharged:item.effectiveMode==='paid',creditCost:item.effectiveMode==='paid'?item.effectiveCreditCost:0,pricingVersion:rules.version};}catch{return{pricingMode:'unavailable',pointsCharged:false,creditCost:0,pricingVersion:null};}
}
export function detectionEntryReady(billing,key){return detectionPricing(billing,key).pricingMode!=='unavailable';}
// The click confirms the displayed tariff. A stale free page cannot silently
// become a 500-credit purchase after a policy update. Replays need no new hold.
export function assertDetectionPrice(input,billing,key){
 const price=detectionPricing(billing,key);if(price.pricingMode==='unavailable')fail(503,'当前检测服务已暂停，本次未扣费。');
 if((price.pointsCharged||input.pricingVersion!==undefined)&&(input.pricingVersion!==price.pricingVersion||input.expectedCreditCost!==price.creditCost))fail(409,'检测费用已更新，请刷新页面后重新提交；尚未扣费。');
}
export function reserveDetection(billing,user,jobId,key,{createJob}={}){
 if(!billing)return false;
 const quote=billing.quote(user,{type:'agent',serviceKey:key});
 if(quote.source==='free')return false;
 if(!['bundle','membership','credits'].includes(quote.source)||quote.source==='credits'&&quote.creditCost<=0||quote.source!=='credits'&&(quote.creditCost!==0||quote.entitlementKey!==key))fail(409,'本次检测扣费来源无法确认，未提交检测。');
 createJob?.();billing.reserve(user,jobId,1,'agent',quote.token,key);return true;
}
// Compatibility names for the former trial-only workflow.
export const detectionFreeEntryReady=detectionEntryReady;
export const reserveIncludedDetection=reserveDetection;

const detectionTypes=Object.freeze({'detection-aigc':'aigc_detection','detection-similarity':'web_similarity'});
const hasReservations=db=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='billing_reservations'").get());
const includedSource="((r.source IN ('membership','bundle') AND r.credits=0) OR (r.source='credits' AND r.credits>0))";
function reservationMatch(key,owner,job,statuses){
 if(!Object.hasOwn(detectionTypes,key))throw new Error('Unsupported detection entitlement');
 return `SELECT 1 FROM billing_reservations r JOIN jobs funded ON funded.id=r.job_id AND funded.user_id=r.user_id AND funded.type='${detectionTypes[key]}' WHERE r.job_id=${job} AND r.user_id=${owner} AND r.type='agent' AND r.service_key='${key}' AND r.attempt=1 AND r.status IN (${statuses}) AND ${includedSource}`;
}
// Admission and provider dispatch may bypass trial caps only after a genuine
// matching package use or credit amount was held in the same database transaction. Client flags,
// a purchased but unrelated package, and a released hold never authorize work.
export function includedDetectionHeld(db,userId,jobId,key){
 return hasReservations(db)&&Boolean(db.prepare(`SELECT 1 WHERE EXISTS(${reservationMatch(key,'?','?',"'held'")})`).get(jobId,userId));
}
export function detectionWasFunded(db,userId,jobId,key){return hasReservations(db)&&Boolean(db.prepare(`SELECT 1 WHERE EXISTS(${reservationMatch(key,'?','?',"'held','settled','released'")})`).get(jobId,userId));}
// A paid attempt never uses trial allowance, even if it later fails or is
// cancelled and its hold is released. Those immutable funding records remain
// authoritative when an account subsequently returns to the free entry.
export function detectionTrialUsage(db,key,{since,until,userId=null,excludeId=null}){
 const aigc=key==='detection-aigc';if(!Object.hasOwn(detectionTypes,key))throw new Error('Unsupported detection entitlement');
 const source=aigc?'aigc_detections d':"web_similarity_runs d JOIN jobs j ON j.id=d.id AND j.user_id=d.user_id AND j.stage!='input_failed'";
 const funded=hasReservations(db)?` AND NOT EXISTS(${reservationMatch(key,'d.user_id','d.id',"'held','settled','released'")})`:'';
 const totals=aigc?',COALESCE(sum(d.reserved_calls),0) calls,COALESCE(sum(d.reserved_billing_units),0) billingUnits':',0 calls,0 billingUnits';
 return db.prepare(`SELECT count(*) n,COALESCE(sum(d.characters),0) characters${totals} FROM ${source} WHERE d.created_at>=? AND d.created_at<? AND (? IS NULL OR d.user_id=?) AND (? IS NULL OR d.id!=?)${funded}`).get(since,until,userId,userId,excludeId,excludeId);
}
export function detectionTrialSearchCount(db,{since,until,userId=null}){
 const funded=hasReservations(db)?` AND NOT EXISTS(${reservationMatch('detection-similarity','a.user_id','a.job_id',"'held','settled','released'")})`:'';
 return db.prepare(`SELECT count(*) n FROM web_similarity_attempts a WHERE a.created_at>=? AND a.created_at<? AND (? IS NULL OR a.user_id=?)${funded}`).get(since,until,userId,userId).n;
}
