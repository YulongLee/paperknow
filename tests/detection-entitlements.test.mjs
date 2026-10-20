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

const paragraph='数字化研究需要保留可核对的原始材料，并通过清晰的文字记录研究过程，使分析结论建立在真实证据与可复现的方法之上。';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(t,{cloud,storage:storageOverrides={},...overrides}={}){
 const db=database(':memory:'),objects=new Map(),calls=[];
 for(const id of ['alice','bob'])db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());
 const storage={provider:'aliyun_oss',bucket:'unit-private',prefix:'paperknow/',async putArtifact(id,user,kind,buffer){const key=`paperknow/users/${user}/exports/${id}.${kind}`;objects.set(key,Buffer.from(buffer));return key;},async readArtifact(row){if(!objects.has(row.storage_key))throw Error('missing object');return Buffer.from(objects.get(row.storage_key));},async removeArtifact(row){objects.delete(row.storage_key);},...storageOverrides};
 const config={storage,webSimilarityEnabled:true,aiURL:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',aiKey:'fixture-private-search-key',aigcDetectionEnabled:true,moderationAccessKeyId:'fixture-detector-id',moderationAccessKeySecret:'fixture-detector-secret',
  aigcDetectionClient:{ready:true,async detect(text){calls.push('aigc');return cloud?cloud(text):{label:'ugc',confidence:96};}},
  webSimilaritySearch:{async search(){calls.push('search');return{searched:true,sources:[{url:'https://public.example.org/source',title:'实际来源'}],usage:{inputTokens:5,outputTokens:1}};}},
  webSimilaritySourceReader:async()=>({url:'https://public.example.org/source',title:'实际来源',text:paragraph,contentHash:digest(paragraph),fetchedAt:new Date().toISOString()}),...overrides};
 config.billing=createBillingService(db,config);
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
 const submitAigc=(service,extra={},owner=user)=>service.handle({path:'/api/aigc-detections',method:'POST',user:owner,readBody:async()=>({text:paragraph,consent:true,expectedUserId:owner.id,idempotencyKey:randomUUID(),...extra})});
 const submitWeb=(service,extra={},owner=user)=>service.handle({path:'/api/web-similarity',method:'POST',user:owner,readBody:async()=>({text:paragraph,title:'真实来源核对',consent:true,expectedUserId:owner.id,idempotencyKey:randomUUID(),...extra})});
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

test('detector billing policy cannot turn the existing free entry into an automatic credit charge',async t=>{
 const f=fixture(t);const current=f.billing.toolRules();f.billing.saveToolRules({version:current.version,services:current.services.map(({key,mode,creditCost})=>({key,mode:key.startsWith('detection-')?'paid':mode,creditCost:key.startsWith('detection-')?10:creditCost}))});
 const service=f.aigc(),{service:web}=f.web();assert.equal(service.capabilities().ready,false);assert.equal(web.capabilities().ready,false);
 await assert.rejects(f.submitAigc(service),{status:503});await assert.rejects(f.submitWeb(web),{status:503});assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM aigc_detections').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM web_similarity_runs').get().n,0);
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
