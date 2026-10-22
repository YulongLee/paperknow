import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {database} from '../backend/database.mjs';
import {createModelBudget,modelLimits} from '../backend/model-budget.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';

function fixture(t,{path=':memory:',userLimit=3,globalLimit=5}={}){
 const db=database(path);let time=Date.parse('2026-10-16T07:00:00.000Z');
 const config={aiUserDailyLimit:userLimit,aiGlobalDailyLimit:globalLimit,modelBudgetNow:()=>new Date(time)};
 const budget=createModelBudget(db,config);
 for(const id of ['alice','bob','carol'])db.prepare('INSERT OR IGNORE INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(id,'模型预算测试','user',new Date(time).toISOString());
 function transaction(fn,connection=db){connection.exec('BEGIN IMMEDIATE');try{const result=fn();connection.exec('COMMIT');return result;}catch(error){connection.exec('ROLLBACK');throw error;}}
 function job({id=randomUUID(),type='polish',owner='alice',status='queued',attempt=0,createdAt=new Date(time).toISOString()}={}){db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,attempt,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,type,status,status,'{}',attempt,id,id,createdAt,createdAt);return id;}
 function enqueue(options={}){const owner=options.owner||'alice';return transaction(()=>{budget.check(owner);return job(options);});}
 function start(id,connection=db,instance=budget){return transaction(()=>{connection.prepare("UPDATE jobs SET status='running',attempt=attempt+1 WHERE id=? AND status='queued'").run(id);const {attempt}=connection.prepare('SELECT attempt FROM jobs WHERE id=?').get(id);return instance.start(id,attempt);},connection);}
 function finish(id,status='completed'){db.prepare('UPDATE jobs SET status=? WHERE id=?').run(status,id);}
 t.after(()=>db.close());return {db,budget,config,transaction,job,enqueue,start,finish,setTime:value=>time=Date.parse(value)};
}

test('model limits accept only bounded integer settings and otherwise use conservative defaults',()=>{
 assert.deepEqual(modelLimits(),{userDailyLimit:30,globalDailyLimit:300});
 assert.deepEqual(modelLimits({aiUserDailyLimit:1,aiGlobalDailyLimit:10000}),{userDailyLimit:1,globalDailyLimit:10000});
 assert.deepEqual(modelLimits({aiUserDailyLimit:500,aiGlobalDailyLimit:1}),{userDailyLimit:500,globalDailyLimit:1});
 for(const bad of [undefined,null,0,-1,1.2,Infinity,NaN,'30',true,{},501])assert.equal(modelLimits({aiUserDailyLimit:bad}).userDailyLimit,30);
 for(const bad of [undefined,null,0,-1,1.2,Infinity,NaN,'300',false,[],10001])assert.equal(modelLimits({aiGlobalDailyLimit:bad}).globalDailyLimit,300);
});

test('queued AI work reserves daily space and starts transfer reservations into immutable attempts exactly once',t=>{
 const f=fixture(t,{userLimit:2}),one=f.enqueue(),two=f.enqueue({type:'review'});
 assert.deepEqual(f.budget.summary('alice'),{used:0,queued:2,limit:2,remaining:0});
 assert.throws(()=>f.enqueue(),{status:429});assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,2);
 const started=f.start(one);assert.deepEqual(f.budget.start(one,1),started);
 assert.deepEqual(f.budget.summary('alice'),{used:1,queued:1,limit:2,remaining:0});
 f.start(two);assert.deepEqual(f.budget.summary('alice'),{used:2,queued:0,limit:2,remaining:0});
 f.finish(one);assert.deepEqual(f.budget.start(one,1),started);
 assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts').get().n,2);
 assert.throws(()=>f.db.prepare('UPDATE model_attempts SET created_at=?').run('2000-01-01T00:00:00.000Z'),/不可修改/);
 assert.throws(()=>f.db.prepare('DELETE FROM model_attempts').run(),/不可删除/);
});

test('failed and cancelled calls keep provider budget while a cancelled queued task releases unused queue space',t=>{
 const f=fixture(t,{userLimit:2}),one=f.enqueue();f.start(one);f.finish(one,'failed');
 const two=f.enqueue({type:'agent'});f.start(two);f.finish(two,'cancelled');
 assert.deepEqual(f.budget.summary('alice'),{used:2,queued:0,limit:2,remaining:0});
 assert.throws(()=>f.enqueue(),{status:429});
 const g=fixture(t,{userLimit:1}),queued=g.enqueue();g.finish(queued,'cancelled');
 assert.deepEqual(g.budget.summary('alice'),{used:0,queued:0,limit:1,remaining:1});assert.ok(g.enqueue());
});

test('retries consume another attempt and may exclude only their own existing queue reservation',t=>{
 const f=fixture(t,{userLimit:2}),id=f.enqueue();f.start(id);f.finish(id,'failed');
 f.transaction(()=>{f.budget.check('alice',{excludeJobId:id});f.db.prepare("UPDATE jobs SET status='queued' WHERE id=?").run(id);});
 assert.deepEqual(f.budget.summary('alice'),{used:1,queued:1,limit:2,remaining:0});
 assert.throws(()=>f.budget.check('alice'),{status:429});assert.equal(f.budget.check('alice',{excludeJobId:id}).remaining,1);
 f.start(id);f.finish(id,'failed');assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts WHERE job_id=?').get(id).n,2);
 assert.throws(()=>f.budget.check('alice',{excludeJobId:id}),{status:429});
});

test('Beijing midnight restores used budget, carries queued work forward and does not duplicate an old attempt',t=>{
 const f=fixture(t,{userLimit:2});f.setTime('2026-10-16T15:59:59.999Z');const one=f.enqueue();f.start(one);f.finish(one,'failed');const two=f.enqueue();
 assert.deepEqual(f.budget.summary('alice'),{used:1,queued:1,limit:2,remaining:0});
 f.setTime('2026-10-16T16:00:00.000Z');assert.deepEqual(f.budget.summary('alice'),{used:0,queued:1,limit:2,remaining:1});
 f.budget.start(one,1);assert.equal(f.budget.summary('alice').used,0);
 f.start(two);assert.deepEqual(f.budget.summary('alice'),{used:1,queued:0,limit:2,remaining:1});
 f.enqueue();assert.throws(()=>f.enqueue(),{status:429});
});

test('global budget includes other owners without exposing their usage in summaries or rejection messages',t=>{
 const f=fixture(t,{userLimit:3,globalLimit:2}),a=f.enqueue(),b=f.enqueue({owner:'bob',type:'review'});
 assert.deepEqual(f.budget.summary('alice'),{used:0,queued:1,limit:3,remaining:2});
 assert.deepEqual(f.budget.summary('carol'),{used:0,queued:0,limit:3,remaining:3});
 assert.throws(()=>f.enqueue({owner:'carol'}),error=>error.status===429&&error.message==='模型服务当前繁忙，请稍后再试');
 f.start(a);f.start(b);f.finish(a);f.finish(b,'failed');assert.throws(()=>f.budget.check('carol',{includeQueued:false}),{status:429});
 assert.deepEqual(f.budget.summary('alice'),{used:1,queued:0,limit:3,remaining:2});
});

test('parse/compare jobs never reserve model budget and invalid execution states cannot create attempts',t=>{
 const f=fixture(t);f.job({type:'parse'});f.job({type:'compare'});assert.equal(f.budget.summary('alice').queued,0);
 for(const type of ['parse','compare']){const id=f.job({type,status:'running',attempt:1});assert.throws(()=>f.budget.start(id,1),{status:400});}
 const queued=f.job();assert.throws(()=>f.budget.start(queued,1),{status:409});
 const running=f.job({status:'running',attempt:1});assert.throws(()=>f.budget.start(running,2),{status:409});
 for(const invalid of [0,-1,1.5,'1',null])assert.throws(()=>f.budget.start(running,invalid),{status:400});
 assert.throws(()=>f.budget.start('absent',1),{status:404});assert.throws(()=>f.budget.summary(''),{status:400});
 assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts').get().n,0);
});

test('dispatch rechecks budgets even if old queued records bypassed admission and rolls back its job claim',t=>{
 const f=fixture(t,{userLimit:1}),first=f.enqueue();f.start(first);f.finish(first,'completed');const late=f.job({createdAt:'2026-10-01T00:00:00.000Z'});
 assert.throws(()=>f.start(late),{status:429});assert.deepEqual({...f.db.prepare('SELECT status,attempt FROM jobs WHERE id=?').get(late)},{status:'queued',attempt:0});
 assert.deepEqual(f.budget.summary('alice'),{used:1,queued:1,limit:1,remaining:0});assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts').get().n,1);
});

test('independent SQLite connections cannot use a stale preflight to overbook the final slot',t=>{
 const dir=mkdtempSync(join(tmpdir(),'paperknow-model-budget-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'budget.sqlite'),f=fixture(t,{path,userLimit:2,globalLimit:2}),otherDB=database(path),other=createModelBudget(otherDB,f.config);t.after(()=>otherDB.close());
 assert.equal(f.budget.check('alice').remaining,2);assert.equal(other.check('bob').remaining,2);
 const a=f.enqueue(),b=f.transaction(()=>{other.check('bob');const now='2026-10-16T07:00:00.000Z',id=randomUUID();otherDB.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,attempt,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'bob','agent','queued','queued','{}',0,id,id,now,now);return id;},otherDB);
 assert.throws(()=>f.transaction(()=>other.check('carol'),otherDB),{status:429});
 f.start(a);f.start(b,otherDB,other);assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts').get().n,2);
 assert.throws(()=>f.transaction(()=>other.check('carol'),otherDB),{status:429});
});

test('caller transaction rollback removes an uncommitted attempt and restart retains committed daily cost',t=>{
 const f=fixture(t),id=f.enqueue();assert.throws(()=>f.transaction(()=>{f.db.prepare("UPDATE jobs SET status='running',attempt=1 WHERE id=?").run(id);f.budget.start(id,1);throw new Error('fixture rollback');}),/fixture rollback/);
 assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts').get().n,0);assert.equal(f.budget.summary('alice').queued,1);
 f.start(id);f.finish(id,'failed');const restored=createModelBudget(f.db,f.config);assert.deepEqual(restored.summary('alice'),{used:1,queued:0,limit:3,remaining:2});
});


function billingFixture(f){
 const config={...f.config,billingNow:f.config.modelBudgetNow,aiURL:'https://example.invalid/v1/chat/completions',aiKey:'synthetic-not-networked',aiModel:'fixture',agentEnabled:true,getAgentSettings:()=>({enabled:true,engine:'claude-agent-sdk',baseURL:'https://example.invalid/anthropic',model:'fixture',apiKey:'synthetic-only',version:'fixture-version'})};
 const billing=createBillingService(f.db,config);billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});
 function fund(source='credits',owner='alice'){
  const id=randomUUID(),at=f.config.modelBudgetNow().toISOString(),expiresAt=new Date(Date.parse(at)+86400000).toISOString(),productId=source==='credits'?'credits-200':source==='membership'?'basic':'bundle-rewrite';
  f.db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,owner,productId,'paid',at);
  if(source==='credits'){f.db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(id,owner,productId,200,'purchase',at);return id;}
  f.db.prepare('INSERT OR IGNORE INTO payment_config_versions(id,provider,sealed_settings,identity_hash,created_by,created_at) VALUES(?,?,?,?,?,?)').run('model-budget-billing-fixture','wechat','{}','fixture',owner,at);
  const items=[{key:'polish',title:'合成润色权益',quantity:1}],entitlement={type:source,durationDays:1,[source==='membership'?'membershipItems':'bundleItems']:items};
  f.db.prepare('INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,title,entitlement,idempotency_key,input_hash,user_id,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'wechat',id,'model-budget-billing-fixture',100,'合成商品',JSON.stringify(entitlement),id,id,owner,expiresAt,at);
  if(source==='membership')f.db.prepare('INSERT INTO payment_entitlements VALUES(?,?,?,?,?,?,?)').run(id,owner,productId,'membership',at,expiresAt,at);else f.db.prepare('INSERT INTO payment_bundle_entitlements VALUES(?,?,?,?,?,?,?)').run(id,owner,productId,at,expiresAt,at,JSON.stringify(items));return id;
 }
 const quote=(owner='alice',type='polish',serviceKey)=>billing.quote({id:owner},{type,...(serviceKey?{serviceKey}:{})});
 const reserve=(id,q,owner='alice',attempt=1,type='polish',serviceKey)=>f.transaction(()=>billing.reserve({id:owner},id,attempt,type,q.token,serviceKey));
 return {billing,fund,quote,reserve};
}

const useFreeAllowance=f=>{const id=f.enqueue();f.start(id);f.finish(id);return id;};

test('only an authentic owner/type/service-bound unused paid quote bypasses exhausted free daily counts',t=>{
 const f=fixture(t,{userLimit:1,globalLimit:1});useFreeAllowance(f);
 for(const options of [{paid:true},{source:'credits',balance:100000},{billingToken:'invented',billingType:'polish'}])assert.throws(()=>f.budget.check('alice',options),{status:429});
 const b=billingFixture(f);b.fund();const q=b.quote();
 assert.deepEqual(f.budget.check('alice',{billingToken:q.token,billingType:'polish'}),{used:1,queued:0,limit:null,remaining:null,paid:true});
 for(const [owner,options]of [['bob',{billingToken:q.token,billingType:'polish'}],['alice',{billingToken:q.token,billingType:'review'}],['alice',{billingToken:q.token,billingType:'polish',serviceKey:'revision-reduce'}],['alice',{billingToken:q.token}]])assert.throws(()=>f.budget.check(owner,options),{status:429});
 const scoped=b.quote('alice','agent','revision-reduce');assert.equal(f.budget.check('alice',{billingToken:scoped.token,billingType:'agent',serviceKey:'revision-reduce'}).paid,true);
 for(const serviceKey of [undefined,'revision-aigc'])assert.throws(()=>f.budget.check('alice',{billingToken:scoped.token,billingType:'agent',serviceKey}),{status:429});
 const id=f.job();b.reserve(id,q);assert.throws(()=>f.budget.check('alice',{billingToken:q.token,billingType:'polish'}),{status:429});f.finish(id,'cancelled');b.billing.release(id);
 f.setTime('2026-10-16T07:05:00.000Z');assert.throws(()=>f.budget.check('alice',{billingToken:scoped.token,billingType:'agent',serviceKey:'revision-reduce'}),{status:429});
});

test('held paid execution and paid failed retries never consume free daily usage or rewrite audit records',t=>{
 const f=fixture(t,{userLimit:1,globalLimit:1});useFreeAllowance(f);const b=billingFixture(f);b.fund();
 const id=f.job(),q=b.quote();b.reserve(id,q);assert.deepEqual(f.budget.summary('alice'),{used:1,queued:0,limit:1,remaining:0});
 f.start(id);f.finish(id,'failed');b.billing.release(id);assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts').get().n,2);assert.deepEqual(f.budget.summary('alice'),{used:1,queued:0,limit:1,remaining:0});assert.equal(b.billing.balance('alice').balance,200);
 f.db.prepare("UPDATE jobs SET status='queued' WHERE id=?").run(id);assert.equal(f.budget.summary('alice').queued,1,'released old attempt cannot fund a new queued retry');
 const retry=b.quote();b.reserve(id,retry,'alice',2);assert.equal(f.budget.summary('alice').queued,0);f.start(id);f.finish(id);b.billing.settle(id);
 assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts').get().n,3);assert.deepEqual(f.budget.summary('alice'),{used:1,queued:0,limit:1,remaining:0});assert.equal(b.billing.balance('alice').balance,190);assert.throws(()=>f.enqueue(),{status:429});
 assert.throws(()=>f.db.prepare('DELETE FROM model_attempts').run(),/不可删除/);
});

test('continuous thesis recovery reuses only its audited paid attempt without reserving free queue space',t=>{
 const f=fixture(t,{userLimit:1,globalLimit:1}),b=billingFixture(f);b.fund();const id=f.job({type:'thesis'}),q=b.quote('alice','agent');b.reserve(id,q,'alice',1,'agent');f.start(id);
 const original={...f.db.prepare('SELECT * FROM model_attempts WHERE job_id=?').get(id)};f.db.prepare("UPDATE jobs SET status='queued',stage='auto_recovering' WHERE id=?").run(id);
 assert.deepEqual(f.budget.summary('alice'),{used:0,queued:0,limit:1,remaining:1});assert.equal(f.budget.check('bob').remaining,1,'paid recovery must not consume the global free queue');
 f.setTime('2026-10-17T07:00:00.000Z');assert.equal(f.budget.summary('alice').queued,0,'a recovery can reuse an audit from the prior day');
 const restarted=createModelBudget(f.db,f.config);f.transaction(()=>{f.db.prepare("UPDATE jobs SET status='running',stage='preparing' WHERE id=? AND status='queued'").run(id);restarted.start(id,1);});
 assert.deepEqual({...f.db.prepare('SELECT * FROM model_attempts WHERE job_id=?').get(id)},original);f.finish(id);b.billing.settle(id);assert.equal(restarted.summary('alice').used,0);assert.equal(b.billing.balance('alice').balance,190);
});

test('ordinary retry queues and stale unaudited funding cannot impersonate continuous thesis recovery',t=>{
 for(const amendment of [{audit:false},{auditOwner:'bob'},{auditAttempt:2},{stage:'queued'},{type:'polish'},{status:'released'},{status:'settled'},{jobAttempt:2}]){
  const f=fixture(t,{userLimit:1,globalLimit:1}),b=billingFixture(f);b.fund();const row={type:'thesis',stage:'auto_recovering',jobAttempt:1,audit:true,auditOwner:'alice',auditAttempt:1,status:'held',...amendment},id=f.job({type:row.type,attempt:row.jobAttempt}),type=row.type==='thesis'?'agent':'polish',q=b.quote('alice',type);b.reserve(id,q,'alice',1,type);
  f.db.prepare('UPDATE jobs SET stage=? WHERE id=?').run(row.stage,id);if(row.audit)f.db.prepare('INSERT INTO model_attempts(job_id,attempt,user_id,created_at) VALUES(?,?,?,?)').run(id,row.auditAttempt,row.auditOwner,f.config.modelBudgetNow().toISOString());
  if(row.status==='released')b.billing.release(id);if(row.status==='settled')b.billing.settle(id);
  assert.equal(f.budget.summary('alice').queued,1,JSON.stringify(amendment));assert.throws(()=>f.budget.check('carol'),{status:429});
 }
});

for(const source of ['membership','bundle'])test(source+' paid entitlement bypasses trial limits only until its actual quota is consumed',t=>{
 const f=fixture(t,{userLimit:1,globalLimit:1});useFreeAllowance(f);const b=billingFixture(f);b.fund(source);
 const q=b.quote();assert.equal(q.source,source);assert.equal(f.budget.check('alice',{billingToken:q.token,billingType:'polish'}).paid,true);
 const id=f.job();b.reserve(id,q);f.start(id);f.finish(id);b.billing.settle(id);assert.equal(f.budget.summary('alice').used,1);assert.equal(f.budget.summary('alice').queued,0);
 assert.throws(()=>b.quote(),{status:402});assert.throws(()=>f.budget.check('alice',{billingToken:q.token,billingType:'polish'}),{status:429});
});

test('worker refuses stale, foreign-owner, wrong-type or wrong-attempt paid reservations at an exhausted trial ceiling',t=>{
 for(const amendment of [{status:'released'},{owner:'bob'},{type:'review'},{attempt:2},{source:'free',credits:0},{source:'credits',credits:0}]){
  const f=fixture(t,{userLimit:1,globalLimit:1});useFreeAllowance(f);billingFixture(f);const id=f.job(),at=f.config.modelBudgetNow().toISOString(),row={status:'held',owner:'alice',type:'polish',attempt:1,source:'credits',credits:10,...amendment};
  f.db.prepare('INSERT INTO billing_reservations(id,job_id,attempt,user_id,type,source,credits,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,row.attempt,row.owner,row.type,row.source,row.credits,row.status,at,at);
  assert.throws(()=>f.start(id),{status:429});assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts').get().n,1);assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'queued');
 }
});

test('paid traffic does not consume the separate global trial pool, while free funded jobs still count',t=>{
 const f=fixture(t,{userLimit:1,globalLimit:1}),b=billingFixture(f);b.fund('credits','bob');
 for(let i=0;i<3;i++){const id=f.job({owner:'bob'}),q=b.quote('bob');b.reserve(id,q,'bob');f.start(id);f.finish(id);b.billing.settle(id);}
 assert.deepEqual(f.budget.summary('bob'),{used:0,queued:0,limit:1,remaining:1});assert.ok(f.budget.check('alice'));const free=f.enqueue();f.start(free);f.finish(free);assert.throws(()=>f.budget.check('carol'),{status:429});
 b.billing.saveRules({version:b.billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'free',creditCost:null}))});const freeQuote=b.quote();assert.equal(freeQuote.source,'free');assert.throws(()=>f.budget.check('alice',{billingToken:freeQuote.token,billingType:'polish'}),{status:429});
});
