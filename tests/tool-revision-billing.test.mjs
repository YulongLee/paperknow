import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {createModelBudget} from '../backend/model-budget.mjs';
import {createToolRunService} from '../backend/tool-run-service.mjs';
import {startToolRunWorker} from '../backend/tool-run-worker.mjs';

const runtime={enabled:true,engine:'claude-agent-sdk',baseURL:'https://revision-billing.invalid',model:'synthetic-model',apiKey:'synthetic-only-key',version:'revision-billing-test',maxTurns:12,maxOutputTokens:4096,maxCostUsd:.1,timeoutMs:30000};
const costs={polish:7,review:13,agent:31};
const request=(mode='polish',plan='strong')=>({kind:'revision',operation:'rewrite',snapshot:{title:'合成计费验收',text:'This synthetic record preserves 20 participants and citation [1].',...(mode===undefined?{}:{mode}),context:{plan}}});
const output=task=>({text:JSON.stringify({complete:true,sourceIds:[],paragraphs:task.context.unit.paragraphs.map(row=>({...row,revised:row.original+' Wording improved.',action:'revise',reason:'Improve clarity.'}))}),trace:[],usage:{input:10,output:5},costUsd:.001});

function fixture(t,{runner,free=false,...overrides}={}){
 const db=database(':memory:'),user={id:'revision-billing-owner'},at=new Date().toISOString(),calls=[];
 for(const id of [user.id,'another-owner'])db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(id,'Synthetic owner','user',at);
 const config={getAgentSettings:()=>({...runtime}),toolPollMs:60000,...overrides,agentTaskRunner:async args=>{calls.push(args.task.context.mode);return runner?runner(args):output(args.task);}};
 const billing=createBillingService(db,config);config.billing=billing;
 const rules=(isFree=false)=>billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:isFree?'free':'paid',creditCost:isFree?null:costs[key]}))});rules(free);
 const credit=randomUUID();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(credit,user.id,'credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(credit,user.id,'credits-200',200,'purchase',at);
 const budget=createModelBudget(db,config);config.modelBudget=budget;
 const service=createToolRunService(db,config),worker=startToolRunWorker(db,config),call=(path,data,owner=user)=>service.handle({path:'/api/tool-runs'+path,method:data===undefined?'GET':'POST',user:owner,readBody:async()=>data});
 const submit=async(value=request(),extra={})=>{const quote=(await call('/quote',value)).value;return{quote,...await call('/jobs',{...value,clientKey:randomUUID(),consent:true,billingToken:quote.token,...extra})};};
 function grant(items,origin='bundle'){
  const id=randomUUID(),until=new Date(Date.now()+86400000).toISOString(),entitlement=origin==='bundle'?{type:'bundle',durationDays:1,bundleItems:items}:{type:'membership',durationDays:1,membershipItems:items};
  db.prepare('INSERT OR IGNORE INTO payment_config_versions(id,provider,sealed_settings,identity_hash,created_by,created_at) VALUES(?,?,?,?,?,?)').run('synthetic-billing-config','wechat','{}','synthetic',user.id,at);
  db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,user.id,origin==='bundle'?'bundle-rewrite':'basic','paid',at);
  db.prepare('INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,title,entitlement,idempotency_key,input_hash,user_id,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'wechat','synthetic-'+id,'synthetic-billing-config',100,'合成权益',JSON.stringify(entitlement),id,id,user.id,until,at);
  if(origin==='bundle')db.prepare('INSERT INTO payment_bundle_entitlements VALUES(?,?,?,?,?,?,?)').run(id,user.id,'bundle-rewrite',at,until,at,JSON.stringify(items));
  else db.prepare('INSERT INTO payment_entitlements VALUES(?,?,?,?,?,?,?)').run(id,user.id,'basic','membership',at,until,at);
  return id;
 }
 const allowance=(id,origin='bundle')=>billing.entitlements(user.id)[origin==='bundle'?'bundleUsage':'membershipUsage'][id];
 function freeAudit(){const id=randomUUID();db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,attempt,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,user.id,'agent','completed','completed','{}',id,id,1,at,at);db.prepare('INSERT INTO model_attempts VALUES(?,?,?,?)').run(id,1,user.id,at);return id;}
 const reservation=id=>db.prepare('SELECT type,service_key,source,source_order,credits,status FROM billing_reservations WHERE job_id=?').get(id);
 t.after(async()=>{await worker.stop();db.close();});return{db,user,config,billing,budget,worker,service,call,submit,grant,allowance,freeAudit,reservation,calls,rules,get:id=>service.get(id,user)};
}

for(const origin of ['bundle','membership'])for(const mode of ['polish','review'])test(origin+' '+mode+' consumes its exact purchased allowance once without charging credits',async t=>{
 const f=fixture(t),order=f.grant([{key:'polish',title:'学术润色',quantity:2},{key:'review',title:'导师意见修改',quantity:2}],origin),value=request(mode),key=randomUUID(),created=await f.submit(value,{clientKey:key}),id=created.value.item.id;
 assert.equal(created.quote.type,mode);assert.equal(created.quote.source,origin);assert.equal(created.quote.creditCost,0);assert.equal(created.value.item.billingService,mode);
 assert.equal(f.reservation(id).type,mode);assert.equal(f.reservation(id).service_key,null);assert.equal(f.reservation(id).source_order,order);
 assert.equal((await f.call('/jobs',{...value,clientKey:key,consent:true,billingToken:'expired'})).value.item.id,id);
 await f.worker.tick();await f.worker.tick();assert.equal(f.get(id).status,'completed');assert.equal(f.get(id).billingService,mode);assert.equal(f.calls.length,1);
 assert.deepEqual(f.allowance(order,origin).map(row=>[row.key,row.used,row.held]),[['polish',mode==='polish'?1:0,0],['review',mode==='review'?1:0,0]]);
 assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);
});

for(const mode of ['polish','review'])test(mode+' failure releases its package hold without consuming credits or usage',async t=>{
 const f=fixture(t,{runner:async()=>{throw Object.assign(Error('synthetic interruption'),{usage:{input:1,output:1},costUsd:.001});}}),order=f.grant([{key:mode,title:'合成权益',quantity:1}]),created=await f.submit(request(mode)),id=created.value.item.id;
 await f.worker.tick();assert.equal(f.get(id).status,'failed');assert.equal(f.reservation(id).status,'released');assert.deepEqual(f.allowance(order).map(row=>[row.used,row.held,row.remaining]),[[0,0,1]]);assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);
});

for(const mode of ['polish','review'])test(mode+' without an allowance uses its configured base credit cost',async t=>{
 const f=fixture(t),created=await f.submit(request(mode)),id=created.value.item.id;assert.equal(created.quote.type,mode);assert.equal(created.quote.source,'credits');assert.equal(created.quote.creditCost,costs[mode]);assert.equal(f.billing.balance(f.user.id).held,costs[mode]);
 await f.worker.tick();assert.equal(f.get(id).status,'completed');assert.deepEqual({...f.reservation(id)},{type:mode,service_key:null,source:'credits',source_order:null,credits:costs[mode],status:'settled'});assert.equal(f.billing.balance(f.user.id).balance,200-costs[mode]);
});

test('paid polish and review dispatch beyond exhausted free daily caps but still settle only their quoted cost',async t=>{
 const f=fixture(t,{aiUserDailyLimit:1,aiGlobalDailyLimit:1});f.freeAudit();assert.equal(f.budget.summary(f.user.id).remaining,0);
 for(const mode of ['polish','review','polish','review']){const created=await f.submit(request(mode));await f.worker.tick();assert.equal(f.get(created.value.item.id).status,'completed');}
 assert.equal(f.calls.length,4);assert.equal(f.billing.balance(f.user.id).balance,160);assert.equal(f.budget.summary(f.user.id).used,1);assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts').get().n,5);
});

test('dual plans preserve revision-dual identity and never spend a polish allowance',async t=>{
 const f=fixture(t),order=f.grant([{key:'polish',title:'学术润色',quantity:1},{key:'revision-dual',title:'双重优化',quantity:1}]),created=await f.submit(request('polish','dual')),id=created.value.item.id;
 assert.equal(created.quote.type,'agent');assert.equal(created.quote.serviceKey,'revision-dual');assert.equal(f.reservation(id).type,'agent');assert.equal(f.reservation(id).service_key,'revision-dual');await f.worker.tick();assert.equal(f.get(id).status,'completed');assert.deepEqual(f.allowance(order).map(row=>[row.key,row.used]),[['polish',0],['revision-dual',1]]);assert.equal(f.billing.balance(f.user.id).balance,200);
});

test('cross-type or foreign quotes cannot be swapped and rejected requests leave quotes unused',async t=>{
 const f=fixture(t),polish=request('polish'),review=request('review'),quote=(await f.call('/quote',polish)).value,credit=randomUUID(),at=new Date().toISOString();
 f.db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(credit,'another-owner','credits-200','paid',at);f.db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(credit,'another-owner','credits-200',200,'purchase',at);
 const otherQuote=(await f.call('/quote',review,{id:'another-owner'})).value;
 await assert.rejects(f.call('/jobs',{...review,clientKey:randomUUID(),consent:true,billingToken:quote.token}),{status:409});
 await assert.rejects(f.call('/jobs',{...review,clientKey:randomUUID(),consent:true,billingToken:otherQuote.token}),{status:409});assert.equal(f.db.prepare('SELECT used FROM billing_quotes WHERE token=?').get(otherQuote.token).used,0);assert.equal(f.db.prepare('SELECT used FROM billing_quotes WHERE token=?').get(quote.token).used,0);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);
 // Isolate the central type guard even if a future server bug bound a real
 // polish token to a review input hash. It must still reject before holding.
 const ownReview=(await f.call('/quote',review)).value;f.db.prepare('UPDATE tool_quotes SET input_hash=? WHERE token=?').run(ownReview.inputHash,quote.token);
 await assert.rejects(f.call('/jobs',{...review,clientKey:randomUUID(),consent:true,billingToken:quote.token}),{status:409});assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);assert.equal(f.db.prepare('SELECT used FROM billing_quotes WHERE token=?').get(quote.token).used,0);
});

test('client-supplied billing flags cannot change the server-authored job or authorize worker funding',async t=>{
 const f=fixture(t),value=request('rewrite');await assert.rejects(f.call('/quote',{...value,billingType:'polish'}),{status:400});await assert.rejects(f.call('/quote',{...value,snapshot:{...value.snapshot,billingType:'polish'}}),{status:400});
 const order=f.grant([{key:'polish',title:'学术润色',quantity:1}]),created=await f.submit({...value,snapshot:{...value.snapshot,context:{...value.snapshot.context,billingType:'polish',paid:true}}}),id=created.value.item.id;
 assert.equal(JSON.parse(f.db.prepare('SELECT input FROM jobs WHERE id=?').get(id).input).billingType,'agent');assert.equal(f.reservation(id).type,'agent');assert.equal(f.reservation(id).source,'credits');await f.worker.tick();assert.equal(f.allowance(order)[0].used,0);assert.equal(f.billing.balance(f.user.id).balance,169);
 const g=fixture(t,{free:true,aiUserDailyLimit:1,aiGlobalDailyLimit:1}),free=await g.submit(request('polish')),freeId=free.value.item.id;g.freeAudit();await g.worker.tick();assert.equal(g.get(freeId).status,'failed');assert.equal(g.reservation(freeId).status,'released');assert.equal(g.calls.length,0);assert.equal(g.billing.balance(g.user.id).balance,200);
});

test('legacy tool records without billing metadata retain paid agent identity in dispatch, serializer and free audit',async t=>{
 const f=fixture(t,{aiUserDailyLimit:1,aiGlobalDailyLimit:1}),legacy=request();delete legacy.snapshot.mode;const created=await f.submit(legacy),id=created.value.item.id;assert.equal(f.reservation(id).type,'agent');
 const job=JSON.parse(f.db.prepare('SELECT input FROM jobs WHERE id=?').get(id).input);delete job.billingType;f.db.prepare('UPDATE jobs SET input=? WHERE id=?').run(JSON.stringify(job),id);
 // Pre-upgrade explicit polish records also had agent reservations. Their
 // historical frozen snapshot must not reclassify that reservation as free.
 const saved=JSON.parse(f.db.prepare('SELECT snapshot FROM tool_runs WHERE id=?').get(id).snapshot);saved.mode='polish';f.db.prepare('UPDATE tool_runs SET snapshot=? WHERE id=?').run(JSON.stringify(saved),id);f.freeAudit();
 await f.worker.tick();assert.equal(f.get(id).status,'completed');assert.equal(f.get(id).billingService,'agent');assert.equal(f.billing.balance(f.user.id).balance,169);assert.equal(f.budget.summary(f.user.id).used,1);assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts').get().n,2);
});

test('worker requires the exact held billing type rather than trusting the job identity flag alone',async t=>{
 const f=fixture(t,{aiUserDailyLimit:1,aiGlobalDailyLimit:1}),created=await f.submit(request('rewrite')),id=created.value.item.id;assert.equal(f.reservation(id).type,'agent');
 const input=JSON.parse(f.db.prepare('SELECT input FROM jobs WHERE id=?').get(id).input);input.billingType='polish';f.db.prepare('UPDATE jobs SET input=? WHERE id=?').run(JSON.stringify(input),id);f.freeAudit();
 await f.worker.tick();assert.equal(f.get(id).status,'failed');assert.equal(f.calls.length,0);assert.equal(f.reservation(id).status,'released');assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts').get().n,1);
});
