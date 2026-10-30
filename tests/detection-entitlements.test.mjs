import {enableFreeDetection} from './fixtures/detection-pricing.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {digest} from '../backend/auth.mjs';
import {createBillingService} from '../backend/billing-service.mjs';
import {createAigcDetectionService} from '../backend/aigc-detection-service.mjs';
import {createWebSimilarityService} from '../backend/web-similarity-service.mjs';
import {startWebSimilarityWorker} from '../backend/web-similarity-worker.mjs';
import {startWorker} from '../backend/worker.mjs';
import {detectionBillingReady} from '../backend/detection-billing-readiness.mjs';
import {includedDetectionHeld,detectionTrialUsage,detectionTrialSearchCount} from '../backend/detection-entitlements.mjs';
import {webSimilarityDay,webSimilarityLimits} from '../backend/web-similarity-model.mjs';

const paragraph='数字化研究需要保留可核对的原始材料，并通过清晰的文字记录研究过程，使分析结论建立在真实证据与可复现的方法之上。';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(t,{cloud,storage:storageOverrides={},paid=false,...overrides}={}){
 const db=database(':memory:'),objects=new Map(),calls=[];
 for(const id of ['alice','bob'])db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());
 const storage={provider:'aliyun_oss',bucket:'unit-private',prefix:'paperknow/',async putArtifact(id,user,kind,buffer){const key=`paperknow/users/${user}/exports/${id}.${kind}`;objects.set(key,Buffer.from(buffer));return key;},async readArtifact(row){if(!objects.has(row.storage_key))throw Error('missing object');return Buffer.from(objects.get(row.storage_key));},async removeArtifact(row){objects.delete(row.storage_key);},...storageOverrides};
 const config={storage,webSimilarityEnabled:true,aiURL:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',aiKey:'fixture-private-search-key',aigcDetectionEnabled:true,moderationAccessKeyId:'fixture-detector-id',moderationAccessKeySecret:'fixture-detector-secret',
  aigcDetectionClient:{ready:true,async detect(text){calls.push('aigc');return cloud?cloud(text):{label:'ugc',confidence:96};}},
  webSimilaritySearch:{async search(){calls.push('search');return{searched:true,sources:[{url:'https://public.example.org/source',title:'实际来源'}],usage:{inputTokens:5,outputTokens:1}};}},
  webSimilaritySourceReader:async()=>({url:'https://public.example.org/source',title:'实际来源',text:paragraph,contentHash:digest(paragraph),fetchedAt:new Date().toISOString()}),...overrides};
 config.billing=createBillingService(db,config);if(!paid)enableFreeDetection(db,config.billing);
 const billing=config.billing,user={id:'alice'},workers=[];
 function grant(key,quantity=2,owner=user){
  const id=randomUUID(),at=new Date().toISOString(),until=new Date(Date.now()+86400000).toISOString(),items=[{key,title:key==='detection-aigc'?'AI 文本鉴别':'PaperKnow 来源比对',quantity}];
  db.prepare('INSERT OR IGNORE INTO payment_config_versions(id,provider,sealed_settings,identity_hash,created_by,created_at) VALUES(?,?,?,?,?,?)').run('fixture-detection-config','wechat','{}','fixture',user.id,at);
  db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,owner.id,'bundle-rewrite','paid',at);
  db.prepare('INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,title,entitlement,idempotency_key,input_hash,user_id,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'wechat','fixture-'+id,'fixture-detection-config',9900,'合成检测权益',JSON.stringify({type:'bundle',durationDays:1,bundleItems:items}),id,id,owner.id,until,at);
  db.prepare('INSERT INTO payment_bundle_entitlements VALUES(?,?,?,?,?,?,?)').run(id,owner.id,'bundle-rewrite',new Date(Date.now()-1000).toISOString(),until,at,JSON.stringify(items));
  return id;
 }
 const used=id=>billing.entitlements(user.id).bundleUsage[id]?.[0];
 function aigc(){return createAigcDetectionService(db,config);}
 function web(){const service=createWebSimilarityService(db,config),worker=startWebSimilarityWorker(db,config);workers.push(worker);config.cancelWebSimilarity=id=>worker.cancel(id);return{service,worker};}
 t.after(async()=>{for(const w of workers)await w.stop();db.close();});
 const submitAigc=(service,extra={},owner=user)=>service.handle({path:'/api/aigc-detections',method:'POST',user:owner,readBody:async()=>({text:paragraph,consent:true,expectedUserId:owner.id,idempotencyKey:randomUUID(),...(paid?{pricingVersion:billing.toolRules().version,expectedCreditCost:500}:{}),...extra})});
 const submitWeb=(service,extra={},owner=user)=>service.handle({path:'/api/web-similarity',method:'POST',user:owner,readBody:async()=>({text:paragraph,title:'真实来源核对',consent:true,expectedUserId:owner.id,idempotencyKey:randomUUID(),...(paid?{pricingVersion:billing.toolRules().version,expectedCreditCost:500}:{}),...extra})});
 return{db,config,billing,user,calls,objects,grant,used,aigc,web,submitAigc,submitWeb};
}

test('detection readiness is independent from the writing agent and requires the actual provider and storage',t=>{
 const f=fixture(t);assert.equal(detectionBillingReady('detection-aigc',f.config),true);assert.equal(detectionBillingReady('detection-similarity',f.config),true);
 assert.equal(detectionBillingReady('agent',f.config),false);assert.equal(detectionBillingReady('detection-aigc',{...f.config,aigcDetectionEnabled:false}),false);assert.equal(detectionBillingReady('detection-similarity',{...f.config,storage:{provider:'aliyun_oss'}}),false);
 assert.equal(f.billing.toolRules().services.find(s=>s.key==='detection-aigc').available,true);assert.equal(f.billing.rules().services.find(s=>s.key==='agent').available,false);
});

test('AIGC bundles hold and settle one use per new text; cached submissions and exhausted allowances never charge credits',async t=>{
 const started=deferred(),answer=deferred(),f=fixture(t,{cloud:async()=>{started.resolve();await answer.promise;return{label:'ugc',confidence:96};}}),order=f.grant('detection-aigc'),service=f.aigc(),key=randomUUID();
 const first=await f.submitAigc(service,{idempotencyKey:key});await started.promise;assert.equal(f.used(order).held,1);assert.equal(f.used(order).used,0);
 assert.equal((await f.submitAigc(service,{idempotencyKey:key})).value.id,first.value.id);assert.equal((await f.submitAigc(service)).value.id,first.value.id);assert.equal(f.used(order).held,1);
 answer.resolve();await service.waitForIdle();assert.equal(f.used(order).held,0);assert.equal(f.used(order).used,1);assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(first.value.id).status,'completed');
 await f.submitAigc(service,{text:paragraph+'第二份'});await service.waitForIdle();assert.equal(f.used(order).used,2);
 const free=await f.submitAigc(service,{text:paragraph+'第三份'});await service.waitForIdle();assert.equal(f.used(order).used,2);assert.equal(f.db.prepare('SELECT billing_job_id FROM aigc_detections WHERE id=?').get(free.value.id).billing_job_id,null);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,2);assert.deepEqual(f.billing.balance(f.user.id),{balance:0,held:0,available:0,ledger:[]});
});

test('failed and cancelled AIGC work releases its exact allowance and late upstream verdicts cannot settle it',async t=>{
 const f=fixture(t,{cloud:async()=>{throw Error('private upstream failure');}}),order=f.grant('detection-aigc'),service=f.aigc(),first=await f.submitAigc(service);await service.waitForIdle();assert.equal(f.used(order).used,0);assert.equal(f.used(order).held,0);assert.equal(f.db.prepare('SELECT status FROM billing_reservations WHERE job_id=?').get(first.value.id).status,'released');assert.equal((await f.submitAigc(service)).value.id,first.value.id);
 const started=deferred(),answer=deferred(),g=fixture(t,{cloud:async()=>{started.resolve();await answer.promise;return{label:'aigc',confidence:96};}}),grant=g.grant('detection-aigc'),pending=g.aigc(),created=await g.submitAigc(pending);await started.promise;
 await pending.handle({path:'/api/aigc-detections/'+created.value.id+'/cancel',method:'POST',user:g.user,readBody:async()=>({expectedUserId:g.user.id})});assert.equal(g.used(grant).held,0);assert.equal(g.db.prepare('SELECT status FROM jobs WHERE id=?').get(created.value.id).status,'cancelled');answer.resolve();await pending.waitForIdle();assert.equal(g.used(grant).used,0);assert.equal(g.db.prepare('SELECT status FROM aigc_detections WHERE id=?').get(created.value.id).status,'failed');
});

test('AIGC restart releases metered work without replay, and the generic worker cannot claim its mirror',async t=>{
 const started=deferred(),answer=deferred(),f=fixture(t,{cloud:async()=>{started.resolve();await answer.promise;return{label:'ugc',confidence:95};}}),order=f.grant('detection-aigc'),service=f.aigc(),first=await f.submitAigc(service);await started.promise;
 const legacy=startWorker(f.db,f.config);await legacy.tick();await legacy.stop();assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(first.value.id).status,'running');assert.equal(f.used(order).held,1);
 const restored=f.aigc();assert.equal(f.used(order).held,0);assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(first.value.id).status,'failed');assert.equal((await f.submitAigc(restored)).value.id,first.value.id);answer.resolve();await service.waitForIdle();assert.equal(f.used(order).used,0);assert.equal(f.calls.length,1);
});

test('web source comparison settles only after a complete private report and remains idempotent',async t=>{
 const f=fixture(t),order=f.grant('detection-similarity'),{service,worker}=f.web(),key=randomUUID(),created=await f.submitWeb(service,{idempotencyKey:key}),id=created.value.item.id;
 assert.equal(f.used(order).held,1);assert.equal(f.db.prepare('SELECT status FROM billing_reservations WHERE job_id=?').get(id).status,'held');assert.equal((await f.submitWeb(service,{idempotencyKey:key})).value.item.id,id);assert.equal((await f.submitWeb(service)).value.item.id,id);assert.equal(f.used(order).held,1);
 await worker.tick();assert.equal(f.used(order).held,0);assert.equal(f.used(order).used,1);assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'completed');assert.equal(f.db.prepare('SELECT count(*) n FROM billing_events WHERE reservation_id=(SELECT id FROM billing_reservations WHERE job_id=?) AND kind=?').get(id,'settle').n,1);assert.equal(f.billing.balance(f.user.id).balance,0);
});

test('web source failure, queued cancellation, failed input storage and restart release package holds',async t=>{
 for(const outcome of ['source','cancel','storage','restart']){
  const f=fixture(t,outcome==='source'?{webSimilaritySourceReader:async()=>{throw Error('blocked');}}:outcome==='storage'?{storage:{async putArtifact(){throw Error('unconfirmed');}}}:{}),order=f.grant('detection-similarity'),{service,worker}=f.web(),created=await f.submitWeb(service),id=created.value.item.id;
  if(outcome==='source')await worker.tick();
  if(outcome==='cancel')await service.handle({path:'/api/web-similarity/'+id+'/cancel',method:'POST',user:f.user,readBody:async()=>({expectedUserId:f.user.id})});
  if(outcome==='restart'){await worker.stop();f.db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(id);const restored=startWebSimilarityWorker(f.db,f.config);await restored.stop();}
  assert.equal(f.used(order).held,0,outcome);assert.equal(f.used(order).used,0,outcome);assert.equal(f.db.prepare('SELECT status FROM billing_reservations WHERE job_id=?').get(id).status,'released',outcome);
 }
});

test('a stale free page cannot confirm a newly paid detector tariff',async t=>{
 const f=fixture(t);const current=f.billing.toolRules();f.billing.saveToolRules({version:current.version,services:current.services.map(({key,mode,creditCost})=>({key,mode:key.startsWith('detection-')?'paid':mode,creditCost:key.startsWith('detection-')?10:creditCost}))});
 const service=f.aigc(),{service:web}=f.web();assert.equal(service.capabilities().ready,true);assert.equal(web.capabilities().ready,true);
 await assert.rejects(f.submitAigc(service),{status:409});await assert.rejects(f.submitWeb(web),{status:409});assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM aigc_detections').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM web_similarity_runs').get().n,0);
});

test('another account uses its free detector access without consuming the first account package',async t=>{
 const f=fixture(t),order=f.grant('detection-aigc'),service=f.aigc(),created=await f.submitAigc(service,{}, {id:'bob'});await service.waitForIdle();assert.equal(created.status,202);assert.equal(f.used(order).used,0);assert.equal(f.used(order).held,0);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);
});

test('failed admission rolls back the task, its package hold and reservation events together',async t=>{
 for(const key of ['detection-aigc','detection-similarity']){
  const f=fixture(t),order=f.grant(key),original=f.billing.reserve;f.config.billing={...f.billing,reserve(...args){original(...args);throw Error('synthetic failed task admission');}};
  const service=key==='detection-aigc'?f.aigc():f.web().service;
  await assert.rejects(key==='detection-aigc'?f.submitAigc(service):f.submitWeb(service),/synthetic failed task admission/);
  assert.equal(f.used(order).held,0);for(const table of ['jobs','billing_reservations','billing_events',key==='detection-aigc'?'aigc_detections':'web_similarity_runs'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0,table);assert.equal(f.calls.length,0);
 }
});

test('a failed settlement cannot leave a completed result or spent package use',async t=>{
 for(const key of ['detection-aigc','detection-similarity']){
  const f=fixture(t),order=f.grant(key),original=f.billing.settle;f.config.billing={...f.billing,settle(...args){original(...args);throw Error('synthetic failed settlement');}};
  let id;if(key==='detection-aigc'){const service=f.aigc(),created=await f.submitAigc(service);id=created.value.id;await service.waitForIdle();assert.equal(f.db.prepare('SELECT status FROM aigc_detections WHERE id=?').get(id).status,'failed');}
  else{const{service,worker}=f.web(),created=await f.submitWeb(service);id=created.value.item.id;await worker.tick();assert.equal(f.db.prepare('SELECT count(*) n FROM results WHERE job_id=?').get(id).n,0);}
  assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'failed');assert.equal(f.used(order).used,0);assert.equal(f.used(order).held,0);assert.equal(f.db.prepare('SELECT status FROM billing_reservations WHERE job_id=?').get(id).status,'released');assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,0);
 }
});

test('AIGC funded allowance bypasses exhausted trial task, character, call and billing-unit limits',async t=>{
 const f=fixture(t,{aigcDetectionUserDailyLimit:1,aigcDetectionUserDailyCharacters:100,aigcDetectionGlobalDailyCalls:1,aigcDetectionGlobalDailyBillingUnits:1}),service=f.aigc();
 await f.submitAigc(service);await service.waitForIdle();
 const counts=()=>Object.fromEntries(['aigc_detections','aigc_detection_requests','jobs','billing_quotes','billing_reservations','billing_events'].map(table=>[table,f.db.prepare('SELECT count(*) n FROM '+table).get().n]));
 const before=counts();await assert.rejects(f.submitAigc(service,{text:paragraph+'免费超过额度'}),{status:429});assert.deepEqual(counts(),before);
 const order=f.grant('detection-aigc',2),paid=await f.submitAigc(service,{text:paragraph+'套餐正常使用'});assert.equal(paid.status,202);await service.waitForIdle();assert.equal(f.used(order).used,1);
 assert.equal(f.db.prepare('SELECT status FROM aigc_detections WHERE id=?').get(paid.value.id).status,'completed');assert.equal(f.calls.length,2);
 const day=webSimilarityDay();assert.equal(detectionTrialUsage(f.db,'detection-aigc',{since:day.start,until:day.end,userId:f.user.id}).n,1);
});

test('AIGC paid settled and released history never consumes later free trial allowance',async t=>{
 for(const failed of [false,true]){
  let failNext=failed;const f=fixture(t,{aigcDetectionUserDailyLimit:1,cloud:async()=>{if(failNext)throw Error('synthetic provider failure');return{label:'ugc',confidence:96};}}),order=f.grant('detection-aigc',1),service=f.aigc();
  const paid=await f.submitAigc(service);await service.waitForIdle();assert.equal(f.db.prepare('SELECT status FROM billing_reservations WHERE job_id=?').get(paid.value.id).status,failed?'released':'settled');
  failNext=false;if(failed)f.config.billingNow=()=>new Date(Date.now()+2*86400000);
  const free=await f.submitAigc(service,{text:paragraph+'回到免费试用'});await service.waitForIdle();assert.equal(free.status,202);assert.equal(f.db.prepare('SELECT billing_job_id FROM aigc_detections WHERE id=?').get(free.value.id).billing_job_id,null);
  await assert.rejects(f.submitAigc(service,{text:paragraph+'超过免费次数'}),{status:429});assert.equal(f.used(order)?.used||0,failed?0:1);
 }
});

function seedWebTrials(f,{tasks=1,queries=3,owner='alice'}={}){
 const at=new Date().toISOString();
 for(let i=0;i<tasks;i++){
  const id=randomUUID();f.db.prepare("INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,'web_similarity','failed','failed','{}',?,?,?,?)").run(id,owner,id,id,at,at);
  f.db.prepare('INSERT INTO web_similarity_runs(id,user_id,title,characters,queries_reserved,queries_attempted,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,owner,'合成历史试用',paragraph.length,queries,queries,at,at);
  for(let q=0;q<queries;q++)f.db.prepare('INSERT INTO web_similarity_attempts VALUES(?,?,?,?)').run(id,q,owner,at);
 }
}

test('web bundle bypasses exhausted free admission and worker search caps while free work stays limited',async t=>{
 const f=fixture(t),{service,worker}=f.web();seedWebTrials(f,{tasks:webSimilarityLimits.globalDailyLimit,queries:webSimilarityLimits.maxQueries});
 const quotes=f.db.prepare('SELECT count(*) n FROM billing_quotes').get().n;
 await assert.rejects(f.submitWeb(service),{status:429});assert.equal(f.db.prepare('SELECT count(*) n FROM billing_quotes').get().n,quotes);assert.equal(f.calls.length,0);
 const order=f.grant('detection-similarity',1),paid=await f.submitWeb(service);assert.equal(paid.status,202);assert.equal(includedDetectionHeld(f.db,f.user.id,paid.value.item.id,'detection-similarity'),true);
 await worker.tick();assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(paid.value.item.id).status,'completed');assert.equal(f.used(order).used,1);assert.ok(f.calls.includes('search'));
});

test('web worker still applies trial search caps after admission and does not accept a released allowance as paid',async t=>{
 for(const released of [false,true]){
  const f=fixture(t),order=released?f.grant('detection-similarity',1):null,{service,worker}=f.web(),created=await f.submitWeb(service);
  if(released){f.billing.release(created.value.item.id);assert.equal(includedDetectionHeld(f.db,f.user.id,created.value.item.id,'detection-similarity'),false);}
  seedWebTrials(f,{tasks:webSimilarityLimits.globalDailyLimit,queries:webSimilarityLimits.maxQueries,owner:'bob'});
  await worker.tick();assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(created.value.item.id).status,'failed');assert.equal(f.calls.length,0);if(order)assert.equal(f.used(order).used,0);
 }
});

test('completed web bundle attempts do not consume free daily tasks or searches after package exhaustion',async t=>{
 const f=fixture(t),order=f.grant('detection-similarity',4),{service,worker}=f.web();
 for(let i=0;i<4;i++){const created=await f.submitWeb(service,{text:paragraph+'套餐正文'+i});await worker.tick();assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(created.value.item.id).status,'completed');}
 assert.equal(f.used(order).used,4);const day=webSimilarityDay(),window={since:day.start,until:day.end,userId:f.user.id};assert.equal(detectionTrialUsage(f.db,'detection-similarity',window).n,0);assert.equal(detectionTrialSearchCount(f.db,window),0);
 const free=await f.submitWeb(service,{text:paragraph+'本次免费正文'});await worker.tick();assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(free.value.item.id).status,'completed');assert.equal(detectionTrialUsage(f.db,'detection-similarity',window).n,1);assert.equal(f.used(order).used,4);
});

test('unrelated service or foreign-owner allowances never grant a detection trial-cap exemption',async t=>{
 for(const foreign of [false,true]){
  const f=fixture(t,{aigcDetectionUserDailyLimit:1}),service=f.aigc();await f.submitAigc(service);await service.waitForIdle();
  f.grant(foreign?'detection-aigc':'detection-similarity',2,foreign?{id:'bob'}:f.user);
  await assert.rejects(f.submitAigc(service,{text:paragraph+'没有匹配权益'}),{status:429});assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);
  await assert.rejects(f.submitAigc(service,{text:paragraph+'伪造付费字段',paid:true}),{status:400});assert.equal(f.calls.length,1);
 }
});

test('nonempty undetermined AIGC segments keep diagnostics and release the package instead of settling',async t=>{
 const f=fixture(t,{cloud:async text=>text[0]==='A'?{label:'ugc',confidence:96}:{label:'undetermined',confidence:null}}),order=f.grant('detection-aigc',1),service=f.aigc();
 const created=await f.submitAigc(service,{text:'A'.repeat(5000)+'B'.repeat(100)});await service.waitForIdle();
 const item=(await service.handle({path:'/api/aigc-detections/'+created.value.id,method:'GET',user:f.user})).value;
 assert.equal(item.status,'failed');assert.equal(item.completedParts,2);assert.deepEqual(item.parts.map(part=>part.label),['ugc','undetermined']);assert.equal(item.parts[0].confidence,96);assert.equal(item.conclusive,false);assert.match(item.error,/未结算/);
 assert.equal(f.used(order).held,0);assert.equal(f.used(order).used,0);assert.equal(f.db.prepare('SELECT status FROM billing_reservations WHERE job_id=?').get(item.id).status,'released');assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,0);
});

test('whitespace-only AIGC segments do not create an extra provider call or block valid paid delivery',async t=>{
 const f=fixture(t),order=f.grant('detection-aigc',1),service=f.aigc(),created=await f.submitAigc(service,{text:' '.repeat(5000)+'B'.repeat(100)});await service.waitForIdle();
 const item=(await service.handle({path:'/api/aigc-detections/'+created.value.id,method:'GET',user:f.user})).value;
 assert.equal(item.status,'completed');assert.equal(item.completedParts,2);assert.equal(f.calls.length,1);assert.equal(f.used(order).used,1);assert.equal(f.used(order).held,0);
 assert.equal(item.conclusive,true);assert.equal(item.verdict,'ugc');assert.deepEqual(item.counts,{aigc:0,ugc:1,undetermined:0});assert.equal(item.parts[0].skipped,true);assert.equal(item.parts[0].label,'undetermined');assert.equal(item.parts[0].confidence,null);assert.deepEqual(item.parts.map(({start,end})=>[start,end]),[[0,5000],[5000,5100]]);
});

function credit(f,amount=2000,owner=f.user){const id=randomUUID(),at=new Date().toISOString();f.db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,owner.id,'credits-1000','paid',at);f.db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(id,owner.id,'credits-1000',amount,'purchase',at);}

test('both detectors default to 500 credits and insufficient funds create no task or upstream call',async t=>{
 for(const key of ['detection-aigc','detection-similarity']){const f=fixture(t,{paid:true}),service=key==='detection-aigc'?f.aigc():f.web().service,cap=service.capabilities();assert.equal(cap.ready,true);assert.equal(cap.pointsCharged,true);assert.equal(cap.creditCost,500);assert.equal(cap.consentRequired,false);await assert.rejects(key==='detection-aigc'?f.submitAigc(service):f.submitWeb(service),{status:402});for(const table of ['jobs','billing_reservations','billing_quotes',key==='detection-aigc'?'aigc_detections':'web_similarity_runs'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0);assert.equal(f.calls.length,0);}
});

test('AIGC credit-funded submissions settle exactly 500 once and bypass every trial allowance',async t=>{
 const f=fixture(t,{paid:true,aigcDetectionUserDailyLimit:1,aigcDetectionUserDailyCharacters:100,aigcDetectionGlobalDailyCalls:1,aigcDetectionGlobalDailyBillingUnits:1});credit(f,2000);const service=f.aigc(),key=randomUUID(),first=await f.submitAigc(service,{idempotencyKey:key});await service.waitForIdle();assert.equal(f.billing.balance(f.user.id).available,1500);assert.equal(f.db.prepare('SELECT credits FROM billing_reservations WHERE job_id=?').get(first.value.id).credits,500);assert.equal((await f.submitAigc(service,{idempotencyKey:key})).value.id,first.value.id);assert.equal((await f.submitAigc(service)).value.id,first.value.id);assert.equal(f.billing.balance(f.user.id).available,1500);
 for(let i=0;i<3;i++){const item=await f.submitAigc(service,{text:paragraph+'新增正文'+i});await service.waitForIdle();assert.equal((await service.handle({path:'/api/aigc-detections/'+item.value.id,method:'GET',user:f.user})).value.status,'completed');}
 assert.equal(f.billing.balance(f.user.id).available,0);assert.equal(f.calls.length,4);await assert.rejects(f.submitAigc(service,{text:paragraph+'余额不足'}),{status:402});const day=webSimilarityDay();assert.equal(detectionTrialUsage(f.db,'detection-aigc',{since:day.start,until:day.end,userId:f.user.id}).n,0);
});

test('web credit-funded submissions exceed the old daily count and settle once per new paper',async t=>{
 const f=fixture(t,{paid:true});credit(f,2500);const {service,worker}=f.web();let first;
 for(let i=0;i<4;i++){const item=await f.submitWeb(service,{text:paragraph+'独立论文'+i});first??=item;assert.equal(includedDetectionHeld(f.db,f.user.id,item.value.item.id,'detection-similarity'),true);await worker.tick();assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(item.value.item.id).status,'completed');}
 assert.equal(f.billing.balance(f.user.id).available,500);const calls=f.calls.length;assert.equal((await f.submitWeb(service,{text:paragraph+'独立论文0'})).value.item.id,first.value.item.id);assert.equal(f.calls.length,calls);assert.equal(f.billing.balance(f.user.id).available,500);const day=webSimilarityDay();assert.equal(detectionTrialUsage(f.db,'detection-similarity',{since:day.start,until:day.end,userId:f.user.id}).n,0);
});

test('an exact detection package wins first; exhausted or unrelated allowances fall back to 500 credits',async t=>{
 for(const key of ['detection-aigc','detection-similarity']){const f=fixture(t,{paid:true});credit(f,1000);const own=f.grant(key,1),other=f.grant(key==='detection-aigc'?'detection-similarity':'detection-aigc',4),generic=f.grant('agent',4),pair=key==='detection-aigc'?null:f.web(),service=pair?.service||f.aigc();const run=async extra=>{const created=key==='detection-aigc'?await f.submitAigc(service,extra):await f.submitWeb(service,extra);if(pair)await pair.worker.tick();else await service.waitForIdle();return key==='detection-aigc'?created.value.id:created.value.item.id;};
 const one=await run({});assert.equal(f.used(own).used,1);assert.equal(f.billing.balance(f.user.id).available,1000);assert.equal(f.db.prepare('SELECT source FROM billing_reservations WHERE job_id=?').get(one).source,'bundle');const two=await run({text:paragraph+'第二篇论文'});assert.equal(f.billing.balance(f.user.id).available,500);assert.equal(f.db.prepare('SELECT credits FROM billing_reservations WHERE job_id=?').get(two).credits,500);assert.equal(f.used(other).used,0);assert.equal(f.used(generic).used,0);}
});

test('failed AIGC and cancelled web checks release their 500-credit holds',async t=>{
 const f=fixture(t,{paid:true,cloud:async()=>{throw Error('synthetic failed provider');}});credit(f,1000);const ai=f.aigc(),created=await f.submitAigc(ai);await ai.waitForIdle();assert.equal(f.billing.balance(f.user.id).available,1000);assert.equal(f.db.prepare('SELECT status FROM billing_reservations WHERE job_id=?').get(created.value.id).status,'released');const {service}=f.web(),web=await f.submitWeb(service);assert.equal(f.billing.balance(f.user.id).held,500);await service.handle({path:'/api/web-similarity/'+web.value.item.id+'/cancel',method:'POST',user:f.user,readBody:async()=>({expectedUserId:f.user.id})});assert.equal(f.billing.balance(f.user.id).available,1000);assert.equal(f.billing.balance(f.user.id).held,0);
});

test('stale tariff and another owner never reserve credits; cached results remain readable after a price change',async t=>{
 const f=fixture(t,{paid:true});credit(f,1000);const ai=f.aigc();for(const extra of [{pricingVersion:undefined,expectedCreditCost:undefined},{pricingVersion:1,expectedCreditCost:0},{pricingVersion:999,expectedCreditCost:500}])await assert.rejects(f.submitAigc(ai,extra),{status:409});assert.equal(f.calls.length,0);assert.equal(f.billing.balance(f.user.id).held,0);const item=await f.submitAigc(ai);await ai.waitForIdle();const policy=f.billing.toolRules();f.billing.saveToolRules({version:policy.version,services:policy.services.map(({key,mode,creditCost})=>({key,mode,creditCost:key==='detection-aigc'?600:creditCost}))});assert.equal((await f.submitAigc(ai,{expectedCreditCost:0})).value.id,item.value.id);assert.equal(f.billing.balance(f.user.id).available,500);
});

// V1 joint detection uses one immutable parent hold; children cannot authorize
// free dispatch with a browser-supplied flag.
import {planV1Commerce,applyV1Commerce} from '../backend/v1-commercial-launch.mjs';
import {createCombinedDetectionService} from '../backend/combined-detection-service.mjs';
import {attachCombinedChild} from '../backend/combined-detection-ledger.mjs';
function combinedFixture(t,options={}){
 const f=fixture(t,{paid:true,...options});applyV1Commerce(f.db,planV1Commerce(f.db).expected);
 f.db.prepare('INSERT INTO admin_credit_adjustments(id,user_id,amount,reason,actor_id,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),f.user.id,1000,'Synthetic joint test',f.user.id,new Date().toISOString());
 const aigc=f.aigc(),{service:similarity,worker}=f.web(),joint=createCombinedDetectionService(f.db,f.config,{aigc,similarity});
 const submit=(extra={})=>joint.handle({path:'/api/combined-detections',method:'POST',user:f.user,readBody:async()=>({text:paragraph,title:'联合检测合成测试',expectedUserId:f.user.id,idempotencyKey:randomUUID(),pricingVersion:f.billing.toolRules().version,expectedCreditCost:149,...extra})});
 return{...f,aigc,similarity,worker,joint,submit};
}
test('V1 joint detection settles only one 149-credit hold after both reports and reuses same text without charge',async t=>{
 const f=combinedFixture(t),first=(await f.submit()).value;assert.equal(first.status,'running');assert.equal(f.billing.balance(f.user.id).held,149);
 await f.aigc.waitForIdle();await f.worker.tick();const parent=f.db.prepare('SELECT status FROM jobs WHERE id=?').get(first.id);assert.equal(parent.status,'completed');assert.equal(f.billing.balance(f.user.id).balance,851);assert.equal(f.billing.balance(f.user.id).held,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM combined_detection_children').get().n,2);const again=await f.submit();assert.equal(again.value.id,first.id);assert.equal(f.billing.balance(f.user.id).balance,851);
 for(const c of again.value.children)assert.equal(c.status,'completed');
});
test('V1 joint detection releases full price on partial failure and cannot be forged from the public child input',async t=>{
 const f=combinedFixture(t,{cloud:async()=>{throw Error('synthetic detector failure');}}),first=(await f.submit()).value;await f.aigc.waitForIdle();await f.worker.tick();assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(first.id).status,'failed');assert.equal(f.billing.balance(f.user.id).balance,1000);assert.equal(f.billing.balance(f.user.id).held,0);
 await assert.rejects(f.similarity.handle({path:'/api/web-similarity',method:'POST',user:f.user,readBody:async()=>({text:paragraph,title:'Forged',consent:true,expectedUserId:f.user.id,idempotencyKey:randomUUID(),fundingParent:first.id})}),{status:400});
 assert.throws(()=>attachCombinedChild(f.db,{parentId:first.id,userId:'bob',childId:first.children[0].id,key:'detection-similarity',text:paragraph}),{status:409});
});
test('V1 joint detection rejects stale prices and invalid text before any hold or provider call',async t=>{
 const f=combinedFixture(t);await assert.rejects(f.submit({expectedCreditCost:99}),{status:409});await assert.rejects(f.submit({text:'too short'}),{status:400});assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);assert.equal(f.calls.length,0);
});
