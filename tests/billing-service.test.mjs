import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';

function fixture(t,{path=':memory:',available=true,agentEnabled=true}={}){
 let db=database(path),time=Date.parse('2026-10-16T00:00:00.000Z');
 const config={billingNow:()=>new Date(time),aiURL:available?'https://example.invalid/v1/chat/completions':'',aiKey:available?'test-no-network-key':'',aiModel:'test-model',agentEnabled};
 let billing=createBillingService(db,config);
 const user={id:'billing-owner'},other={id:'billing-other'};
 for(const item of [user,other])db.prepare('INSERT OR IGNORE INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(item.id,'计费测试账户','user',new Date(time).toISOString());
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}
 function job(type='polish',owner=user,id=randomUUID()){const now=new Date(time).toISOString();db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,owner.id,type,'queued','queued','{}',id,id,now,now);return id;}
 function paid(cost=10){return transaction(()=>billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:cost}))}));}
 function order(source,{owner=user,items=[{key:'polish',title:'润色次数',quantity:2}],startsAt=new Date(time-1000).toISOString(),expiresAt=new Date(time+86400000).toISOString(),amount=200,id=randomUUID()}={}){
  const productId=source==='credits'?'credits-200':source==='membership'?'basic':'bundle-rewrite',now=new Date(time).toISOString();
  db.prepare('INSERT OR IGNORE INTO payment_config_versions(id,provider,sealed_settings,identity_hash,created_by,created_at) VALUES(?,?,?,?,?,?)').run('billing-test-config','wechat','{}','test-identity',user.id,now);
  db.prepare('INSERT INTO orders(id,user_id,product_id,status,created_at) VALUES(?,?,?,?,?)').run(id,owner.id,productId,'paid',now);
  const entitlement=source==='credits'?{type:source,creditAmount:amount}:{type:source,durationDays:1,[source==='membership'?'membershipItems':'bundleItems']:items};
  db.prepare('INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,title,entitlement,idempotency_key,input_hash,user_id,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'wechat','test-'+id,'billing-test-config',2000,'测试商品',JSON.stringify(entitlement),id,id,owner.id,expiresAt,now);
  if(source==='credits')db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(id,owner.id,productId,amount,'purchase',now);
  else if(source==='membership')db.prepare('INSERT INTO payment_entitlements VALUES(?,?,?,?,?,?,?)').run(id,owner.id,productId,'membership',startsAt,expiresAt,now);
  else db.prepare('INSERT INTO payment_bundle_entitlements VALUES(?,?,?,?,?,?,?)').run(id,owner.id,productId,startsAt,expiresAt,now,JSON.stringify(items));
  return id;
 }
 function reserve(jobId,quote,owner=user,attempt=1,type='polish'){return transaction(()=>billing.reserve(owner,jobId,attempt,type,quote?.token));}
 function restart(){db.close();db=database(path);billing=createBillingService(db,config);}
 t.after(()=>db.close());return {get db(){return db;},get billing(){return billing;},config,user,other,transaction,job,paid,order,reserve,restart,advance:ms=>time+=ms};
}

test('new policy defaults to free without spending paid credits or creating simulated entitlements',t=>{
 const f=fixture(t),rules=f.billing.rules();assert.equal(rules.version,1);assert.deepEqual(rules.services.map(({key,mode,creditCost,available})=>({key,mode,creditCost,available})),billingServiceTypes.map(({key})=>({key,mode:'free',creditCost:null,available:true})));
 const job=f.job(),reservation=f.reserve(job);assert.equal(reservation.source,'free');assert.equal(reservation.creditCost,0);assert.equal(f.billing.isBillable(job),false);
 f.transaction(()=>f.billing.settle(job));assert.equal(f.billing.entitlements(f.user.id).reservations[0].status,'settled');const freeBalance=f.billing.balance(f.user.id);assert.deepEqual([freeBalance.balance,freeBalance.held,freeBalance.available],[0,0,0]);assert.deepEqual(freeBalance.ledger,[]);assert.equal(f.billing.entitlements(f.user.id).reservations.length,1);
 assert.deepEqual(f.billing.entitlements(f.user.id).membershipUsage,{});assert.deepEqual(f.billing.entitlements(f.user.id).bundleUsage,{});
});

test('policy validates complete service matrix, integer prices and optimistic concurrency',t=>{
 const f=fixture(t),input={version:1,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))};
 for(const change of [{services:[]},{services:[input.services[0],input.services[0],input.services[2]]},{services:input.services.map((s,i)=>i? s:{...s,creditCost:1.2})},{services:input.services.map((s,i)=>i? s:{...s,creditCost:0})},{services:input.services.map((s,i)=>i? s:{...s,creditCost:100001})},{services:input.services.map((s,i)=>i? s:{...s,mode:'free'})},{services:input.services.map((s,i)=>i? s:{...s,key:'unknown'})},{version:0},{extra:true}])assert.throws(()=>f.billing.saveRules({...input,...change}),{status:400});
 assert.equal(f.billing.saveRules(input).version,2);assert.throws(()=>f.billing.saveRules(input),{status:409});assert.equal(f.billing.rules().version,2);
 assert.throws(()=>f.billing.quote(f.user,{type:'parse'}),{status:400});assert.throws(()=>f.billing.quote(f.user,{type:'polish',creditCost:0}),{status:400});
});

test('unavailable AI or disabled service cannot be quoted or reserved even with credits',t=>{
 const f=fixture(t,{available:false});f.order('credits');assert.ok(f.billing.rules().services.every(item=>!item.available));assert.throws(()=>f.billing.quote(f.user,{type:'polish'}),{status:503});assert.throws(()=>f.reserve(f.job()),{status:503});
 const g=fixture(t,{agentEnabled:false});assert.equal(g.billing.rules().services.find(s=>s.key==='agent').available,false);assert.throws(()=>g.billing.quote(g.user,{type:'agent'}),{status:503});
 const h=fixture(t);h.billing.saveRules({version:1,services:billingServiceTypes.map(({key})=>({key,mode:'disabled',creditCost:null}))});assert.throws(()=>h.billing.quote(h.user,{type:'review'}),{status:503});assert.throws(()=>h.reserve(h.job()),{status:503});
});

test('credits are held on submit and debited exactly once on successful settlement',t=>{
 const f=fixture(t);f.paid(30);f.order('credits',{amount:200});const job=f.job(),q=f.billing.quote(f.user,{type:'polish'}),r=f.reserve(job,q);
 assert.equal(q.source,'credits');assert.equal(q.creditCost,30);assert.equal(q.policyVersion,2);assert.equal(r.status,'held');assert.equal(f.billing.isBillable(job),true);
 let balance=f.billing.balance(f.user.id);assert.deepEqual([balance.balance,balance.held,balance.available],[200,30,170]);assert.equal(balance.ledger.find(e=>e.kind==='reserve').amount,0);assert.equal(balance.ledger.find(e=>e.kind==='reserve').heldDelta,30);
 assert.equal(f.reserve(job,q).id,r.id);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_events').get().n,1);
 f.transaction(()=>f.billing.settle(job));f.transaction(()=>f.billing.settle(job));f.transaction(()=>f.billing.release(job));
 balance=f.billing.balance(f.user.id);assert.deepEqual([balance.balance,balance.held,balance.available],[170,0,170]);assert.equal(balance.ledger.find(e=>e.kind==='settle').amount,-30);assert.equal(balance.ledger.find(e=>e.kind==='settle').heldDelta,-30);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_events').get().n,2);
 assert.deepEqual(f.billing.balance(f.other.id),{balance:0,held:0,available:0,ledger:[]});
});

test('failed, cancelled or interrupted task releases its reservation without minting credits; retry needs a fresh quote',t=>{
 const f=fixture(t);f.paid(40);f.order('credits',{amount:50});const job=f.job(),q=f.billing.quote(f.user,{type:'polish'});f.reserve(job,q);
 f.transaction(()=>f.billing.release(job));f.transaction(()=>f.billing.release(job));f.transaction(()=>f.billing.settle(job));
 assert.equal(f.billing.isBillable(job),false);let balance=f.billing.balance(f.user.id);assert.deepEqual([balance.balance,balance.held,balance.available],[50,0,50]);assert.equal(balance.ledger.find(e=>e.kind==='release').amount,0);assert.equal(balance.ledger.find(e=>e.kind==='release').heldDelta,-40);
 assert.throws(()=>f.reserve(job,q,f.user,2),{status:409});const retried=f.reserve(job,f.billing.quote(f.user,{type:'polish'}),f.user,2);assert.equal(retried.attempt,2);f.transaction(()=>f.billing.settle(job));assert.equal(f.billing.balance(f.user.id).balance,10);
});

test('multiple outstanding quotes never overspend the available credit balance',t=>{
 const f=fixture(t);f.paid(60);f.order('credits',{amount:100});const q1=f.billing.quote(f.user,{type:'polish'}),q2=f.billing.quote(f.user,{type:'polish'});f.reserve(f.job(),q1);
 assert.throws(()=>f.reserve(f.job(),q2),{status:402});assert.throws(()=>f.billing.quote(f.user,{type:'polish'}),{status:402});assert.equal(f.billing.balance(f.user.id).available,40);assert.equal(f.db.prepare('SELECT used FROM billing_quotes WHERE token=?').get(q2.token).used,0);
});

test('paid submit requires an unexpired owner/type-bound quote with unchanged policy',t=>{
 const f=fixture(t);f.paid();f.order('credits');f.order('credits',{owner:f.other});const q=f.billing.quote(f.user,{type:'polish'});
 assert.throws(()=>f.reserve(f.job(),null),{status:409});assert.throws(()=>f.reserve(f.job('polish',f.other),q,f.other),{status:409});assert.throws(()=>f.reserve(f.job('review'),q,f.user,1,'review'),{status:409});assert.throws(()=>f.reserve(f.job(),q,f.other),{status:404});
 f.advance(5*60000);assert.throws(()=>f.reserve(f.job(),q),{status:409});
 const fresh=f.billing.quote(f.user,{type:'polish'});f.paid(12);assert.throws(()=>f.reserve(f.job(),fresh),{status:409});
 const newQuote=f.billing.quote(f.user,{type:'polish'});f.reserve(f.job(),newQuote);assert.throws(()=>f.reserve(f.job(),newQuote),{status:409});
 assert.equal(f.billing.balance(f.user.id).held,12);assert.equal(f.billing.balance(f.other.id).held,0);
});

test('membership quota is used before bundles then credits, selecting earliest expiry within a source',t=>{
 const f=fixture(t);f.paid(10);f.order('credits');const late=f.order('membership',{items:[{key:'polish',title:'会员润色',quantity:1}],expiresAt:'2026-11-01T00:00:00.000Z'}),early=f.order('membership',{items:[{key:'polish',title:'会员润色',quantity:1}],expiresAt:'2026-10-17T00:00:00.000Z'}),bundle=f.order('bundle',{items:[{key:'polish',title:'套餐润色',quantity:1}]});
 const selected=[];
 for(let i=0;i<4;i++){const q=f.billing.quote(f.user,{type:'polish'});selected.push([q.source,q.sourceOrderId]);const job=f.job();f.reserve(job,q);f.transaction(()=>f.billing.settle(job));}
 assert.deepEqual(selected,[['membership',early],['membership',late],['bundle',bundle],['credits',null]]);
 const usage=f.billing.entitlements(f.user.id);assert.deepEqual(usage.membershipUsage[early],[{key:'polish',title:'会员润色',quantity:1,held:0,used:1,remaining:0}]);assert.equal(usage.bundleUsage[bundle][0].used,1);assert.equal(f.billing.balance(f.user.id).balance,190);
});

test('quota preflight is rechecked at reservation without silently changing payment source',t=>{
 const f=fixture(t);f.paid();f.order('credits');const order=f.order('bundle',{items:[{key:'polish',title:'润色',quantity:1}]});
 const q1=f.billing.quote(f.user,{type:'polish'}),q2=f.billing.quote(f.user,{type:'polish'});const job=f.job();f.reserve(job,q1);
 assert.throws(()=>f.reserve(f.job(),q2),{status:409});assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.billing.entitlements(f.user.id).bundleUsage[order][0].held,1);
 f.transaction(()=>f.billing.release(job));assert.equal(f.billing.entitlements(f.user.id).bundleUsage[order][0].remaining,1);assert.equal(f.billing.quote(f.user,{type:'polish'}).source,'bundle');
});

test('future, expired, refunded and foreign grants cannot fund a job; valid grant expiry is rechecked',t=>{
 const f=fixture(t);f.paid();f.order('membership',{startsAt:'2026-10-17T00:00:00.000Z'});f.order('bundle',{expiresAt:'2026-10-16T00:00:00.000Z'});f.order('membership',{owner:f.other});const refunded=f.order('membership');f.db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(refunded);
 assert.throws(()=>f.billing.quote(f.user,{type:'polish'}),{status:402});const valid=f.order('bundle',{expiresAt:'2026-10-16T00:01:00.000Z'}),q=f.billing.quote(f.user,{type:'polish'});assert.equal(q.sourceOrderId,valid);f.advance(60000);assert.throws(()=>f.reserve(f.job(),q),{status:409});
});

test('purchased snapshot, rather than product edits or unrelated service labels, determines quotas',t=>{
 const f=fixture(t);f.paid();const order=f.order('bundle',{items:[{key:'polish',title:'已购买润色',quantity:1},{key:'unsupported-service',title:'未接入能力',quantity:99}]});f.db.prepare('UPDATE products SET rules=? WHERE id=?').run(JSON.stringify({bundleItems:[{key:'polish',title:'改过的数量',quantity:99}]}),'bundle-rewrite');
 const q=f.billing.quote(f.user,{type:'polish'});assert.equal(q.sourceOrderId,order);const job=f.job();f.reserve(job,q);f.transaction(()=>f.billing.settle(job));assert.throws(()=>f.billing.quote(f.user,{type:'polish'}),{status:402});assert.throws(()=>f.billing.quote(f.user,{type:'review'}),{status:402});assert.equal(f.billing.entitlements(f.user.id).bundleUsage[order].length,1);
});

test('job/reservation/quote mutation rolls back together on submission failure',t=>{
 const f=fixture(t);f.paid();f.order('credits');const q=f.billing.quote(f.user,{type:'polish'}),job='rolled-back-job';
 assert.throws(()=>f.transaction(()=>{f.job('polish',f.user,job);f.billing.reserve(f.user,job,1,'polish',q.token);throw new Error('simulated durable submission failure');}),/simulated/);
 assert.equal(f.db.prepare('SELECT count(*) n FROM jobs WHERE id=?').get(job).n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_events').get().n,0);assert.equal(f.db.prepare('SELECT used FROM billing_quotes WHERE token=?').get(q.token).used,0);assert.equal(f.billing.balance(f.user.id).held,0);
});

test('settlement and release can roll back with failed result/status persistence',t=>{
 const f=fixture(t);f.paid(20);f.order('credits');const job=f.job();f.reserve(job,f.billing.quote(f.user,{type:'polish'}));
 for(const action of ['settle','release']){
  assert.throws(()=>f.transaction(()=>{f.billing[action](job);throw new Error('simulated transition failure');}),/simulated/);assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.billing.balance(f.user.id).held,20);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_events').get().n,1);
 }
 f.transaction(()=>f.billing.release(job));assert.equal(f.billing.balance(f.user.id).available,200);
});

test('consumption event history and purchase ledger reject editing and deletion',t=>{
 const f=fixture(t);f.paid();f.order('credits');const job=f.job();f.reserve(job,f.billing.quote(f.user,{type:'polish'}));f.transaction(()=>f.billing.settle(job));
 for(const table of ['billing_events','payment_credit_ledger']){assert.throws(()=>f.db.exec('UPDATE '+table+" SET created_at='changed'"),/不可修改/);assert.throws(()=>f.db.exec('DELETE FROM '+table),/不可删除/);}
 assert.throws(()=>f.db.exec("UPDATE billing_reservations SET credits=0"),/不可修改/);assert.throws(()=>f.db.exec("UPDATE billing_reservations SET status='held'"),/不可修改/);assert.throws(()=>f.db.exec('DELETE FROM billing_reservations'),/不可删除/);
 assert.equal(f.billing.balance(f.user.id).balance,190);
});

test('policy, consumed quote and held reservation survive restart without duplicate charging',t=>{
 const dir=mkdtempSync(join(tmpdir(),'paperknow-billing-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const f=fixture(t,{path:join(dir,'billing.sqlite')});f.paid(25);f.order('credits');const job=f.job(),q=f.billing.quote(f.user,{type:'polish'});const r=f.reserve(job,q);f.restart();
 assert.equal(f.billing.rules().version,2);assert.equal(f.billing.balance(f.user.id).held,25);assert.equal(f.reserve(job,q).id,r.id);f.transaction(()=>f.billing.release(job));assert.equal(f.billing.balance(f.user.id).available,200);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='release'").get().n,1);
});

test('a separate connection observes held balances and cannot consume a second quote past the account limit',t=>{
 const dir=mkdtempSync(join(tmpdir(),'paperknow-billing-connections-')),path=join(dir,'billing.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));const f=fixture(t,{path});f.paid(60);f.order('credits',{amount:100});
 const secondDB=database(path),second=createBillingService(secondDB,f.config);t.after(()=>secondDB.close());
 const firstQuote=f.billing.quote(f.user,{type:'polish'}),secondQuote=second.quote(f.user,{type:'polish'});f.reserve(f.job(),firstQuote);const secondJob=f.job();
 secondDB.exec('BEGIN IMMEDIATE');try{assert.throws(()=>second.reserve(f.user,secondJob,1,'polish',secondQuote.token),{status:402});}finally{secondDB.exec('ROLLBACK');}
 assert.equal(second.balance(f.user.id).available,40);assert.equal(f.billing.balance(f.user.id).held,60);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);
});

test('malformed snapshots do not manufacture quota or permit unsupported paid tools',t=>{
 const f=fixture(t);f.paid();
 for(const items of [[{key:'polish',title:'重复项',quantity:1},{key:'polish',title:'重复项',quantity:100}],[{key:'polish',title:'不合法次数',quantity:0}],[{key:'polish',title:'不合法次数',quantity:1.5}],[{key:'polish',title:'',quantity:1}],[{key:'polish',title:'大于限额',quantity:100001}]])f.order('membership',{items});
 assert.throws(()=>f.billing.quote(f.user,{type:'polish'}),{status:402});assert.throws(()=>f.billing.quote(f.user,{type:'reduce-aigc'}),{status:400});
 assert.ok(Object.values(f.billing.entitlements(f.user.id).membershipUsage).every(items=>items.length===0));
});

test('changing a paid policy to free invalidates an earlier charge confirmation and never silently charges',t=>{
 const f=fixture(t);f.paid(30);f.order('credits');const quote=f.billing.quote(f.user,{type:'polish'});
 f.billing.saveRules({version:2,services:billingServiceTypes.map(({key})=>({key,mode:'free',creditCost:null}))});const job=f.job();assert.throws(()=>f.reserve(job,quote),{status:409});assert.equal(f.billing.balance(f.user.id).held,0);
 const reserved=f.reserve(job);assert.equal(reserved.source,'free');f.transaction(()=>f.billing.settle(job));assert.equal(f.billing.balance(f.user.id).balance,200);
});

test('quote cleanup is bounded to 500 credentials expired more than a day while preserving recent confirmations and financial history',t=>{
 const f=fixture(t);f.paid(10);f.order('credits');const used=f.billing.quote(f.user,{type:'polish'}),job=f.job();f.reserve(job,used);f.transaction(()=>f.billing.settle(job));
 const insert=f.db.prepare('INSERT INTO billing_quotes(token,user_id,type,source,source_order,credits,policy_version,expires_at,used) VALUES(?,?,?,?,?,?,?,?,?)');
 for(let i=0;i<501;i++)insert.run('old-quote-'+String(i).padStart(4,'0'),i%2?f.other.id:f.user.id,'polish','credits',null,10,2,used.expiresAt,0);
 f.advance(2*86400000);const now=Date.parse(used.expiresAt)-300000+2*86400000;
 insert.run('recent-used-quote',f.user.id,'polish','credits',null,10,2,new Date(now-1).toISOString(),1);insert.run('recent-other-quote',f.other.id,'polish','credits',null,10,2,new Date(now+300000).toISOString(),0);
 const count=()=>f.db.prepare('SELECT count(*) n FROM billing_quotes').get().n;assert.equal(count(),504);f.billing.quote(f.user,{type:'polish'});assert.equal(count(),5);assert.equal(f.db.prepare('SELECT used FROM billing_quotes WHERE token=?').get('recent-used-quote').used,1);assert.equal(f.db.prepare('SELECT user_id FROM billing_quotes WHERE token=?').get('recent-other-quote').user_id,f.other.id);
 assert.equal(f.db.prepare("SELECT count(*) n FROM billing_quotes WHERE expires_at<?").get(new Date(now-86400000).toISOString()).n,2);assert.ok(f.db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='billing_quotes_expiry'").get());
 f.billing.quote(f.user,{type:'polish'});assert.equal(count(),4);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_events').get().n,2);assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.billing.entitlements(f.user.id).reservations[0].status,'settled');
});
