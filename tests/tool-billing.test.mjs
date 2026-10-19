import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes,toolBillingServiceTypes} from '../backend/billing-service.mjs';
import {productDelivery} from '../backend/commerce-readiness.mjs';

function fixture(t,{available=true,beforeBilling}={}){
 const db=database(':memory:');let time=Date.parse('2026-10-18T00:00:00Z');const user={id:'tool-owner'},other={id:'tool-other'},config={billingNow:()=>new Date(time),aiURL:available?'https://example.invalid/v1/chat':'',aiKey:available?'local-fixture-only':'',aiModel:'fixture-model',agentEnabled:true,storage:{provider:'aliyun_oss'},moderation:{ready:available},getResearchImageSettings:()=>available?{enabled:true,apiKey:'fixture-image-only',version:'image-version'}:{enabled:false},getAgentSettings:()=>available?{enabled:true,engine:'claude-agent-sdk',baseURL:'https://fixture.example.com/anthropic',model:'fixture-model',apiKey:'fixture-only-key',version:'fixture-version'}:{enabled:false}};
 for(const owner of [user,other])db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(owner.id,'合成计价测试','user',new Date(time).toISOString());
 const job=(owner=user,id=randomUUID())=>{const at=new Date(time).toISOString();db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,owner.id,'tool_run','queued','queued','{}',id,id,at,at);return id;};
 beforeBilling?.({db,user,other,job,at:new Date(time).toISOString()});const billing=createBillingService(db,config);
 function tx(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 function base(mode='paid',cost=10){return billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode,creditCost:mode==='paid'?cost:null}))});}
 function configure(patch={}){const current=billing.toolRules();return billing.saveToolRules({version:current.version,services:current.services.map(({key,mode,creditCost})=>({key,mode,creditCost,...patch[key]}))});}
 function order(source,{owner=user,items=[{key:'agent',title:'科研通用次数',quantity:2}],amount=200,expiresAt=new Date(time+86400000).toISOString()}={}){
  const id=randomUUID(),at=new Date(time).toISOString(),productId=source==='credits'?'credits-200':source==='membership'?'basic':'bundle-rewrite';db.prepare('INSERT OR IGNORE INTO payment_config_versions(id,provider,sealed_settings,identity_hash,created_by,created_at) VALUES(?,?,?,?,?,?)').run('tool-billing-config','wechat','{}','fixture',user.id,at);
  db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,owner.id,productId,'paid',at);const entitlement=source==='credits'?{type:source,creditAmount:amount}:{type:source,durationDays:1,[source==='membership'?'membershipItems':'bundleItems']:items};
  db.prepare('INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,title,entitlement,idempotency_key,input_hash,user_id,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'wechat','tool-'+id,'tool-billing-config',2000,'合成商品',JSON.stringify(entitlement),id,id,owner.id,expiresAt,at);
  if(source==='credits')db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(id,owner.id,productId,amount,'purchase',at);else if(source==='membership')db.prepare('INSERT INTO payment_entitlements VALUES(?,?,?,?,?,?,?)').run(id,owner.id,productId,'membership',new Date(time-1000).toISOString(),expiresAt,at);else db.prepare('INSERT INTO payment_bundle_entitlements VALUES(?,?,?,?,?,?,?)').run(id,owner.id,productId,new Date(time-1000).toISOString(),expiresAt,at,JSON.stringify(items));return id;
 }
 const quote=(serviceKey,owner=user)=>billing.quote(owner,{type:'agent',...(serviceKey===undefined?{}:{serviceKey})});const reserve=(id,q,serviceKey,owner=user,attempt=1)=>tx(()=>billing.reserve(owner,id,attempt,'agent',q?.token,serviceKey));
 t.after(()=>db.close());return {db,billing,config,user,other,job,base,configure,order,quote,reserve,tx,advance:n=>time+=n};
}

test('all fourteen tool prices inherit the existing agent rule without changing old services or amounts',t=>{
 const f=fixture(t);f.base('paid',10);f.order('credits');const rules=f.billing.toolRules();assert.equal(rules.version,1);assert.equal(rules.services.length,14);assert.ok(rules.services.every(s=>s.mode==='inherit'&&s.creditCost===null&&s.effectiveMode==='paid'&&s.effectiveCreditCost===10&&s.available));assert.deepEqual(f.billing.rules().services.map(s=>s.key),['polish','review','agent']);
 for(const {key}of toolBillingServiceTypes){const q=f.quote(key);assert.equal(q.type,'agent');assert.equal(q.serviceKey,key);assert.equal(q.creditCost,10);assert.equal(q.toolPolicyVersion,1);}assert.equal(f.billing.balance(f.user.id).held,0);
});

test('tool pricing validates a complete matrix and independently versions paid/free/inherit/disabled changes',t=>{
 const f=fixture(t);f.base();f.order('credits');const input={version:1,services:toolBillingServiceTypes.map(({key})=>({key,mode:'inherit',creditCost:null}))};
 for(const change of [{services:[]},{services:[input.services[0],...input.services.slice(0,12)]},{version:0},{extra:true},{services:input.services.map((s,i)=>i?s:{...s,key:'unknown'})},{services:input.services.map((s,i)=>i?s:{...s,mode:'paid',creditCost:0})},{services:input.services.map((s,i)=>i?s:{...s,mode:'paid',creditCost:1.5})},{services:input.services.map((s,i)=>i?s:{...s,mode:'paid',creditCost:100001})},{services:input.services.map((s,i)=>i?s:{...s,mode:'free',creditCost:10})}])assert.throws(()=>f.billing.saveToolRules({...input,...change}),{status:400});
 const saved=f.configure({'presentation-ai':{mode:'paid',creditCost:25},'literature-read':{mode:'free',creditCost:null},'research-formula':{mode:'disabled',creditCost:null}});assert.equal(saved.version,2);assert.equal(f.billing.rules().version,2);assert.equal(f.quote('presentation-ai').creditCost,25);assert.equal(f.quote('literature-read').source,'free');assert.throws(()=>f.quote('research-formula'),{status:503});assert.equal(f.quote('presentation-thesis').creditCost,10);assert.throws(()=>f.billing.saveToolRules(input),{status:409});
 assert.throws(()=>f.billing.quote(f.user,{type:'polish',serviceKey:'literature-read'}),{status:400});assert.throws(()=>f.quote('unknown'),{status:400});assert.throws(()=>f.quote(''),{status:400});
});

test('owner, concrete service, base policy and tool policy all bind a short-lived single-use quote',t=>{
 const f=fixture(t);f.base();f.order('credits');f.order('credits',{owner:f.other});const q=f.quote('literature-read');assert.throws(()=>f.reserve(f.job(),q,'literature-answer'),{status:409});assert.throws(()=>f.reserve(f.job(),q),{status:409});assert.throws(()=>f.reserve(f.job(f.other),q,'literature-read',f.other),{status:409});assert.throws(()=>f.reserve(f.job(),q,'literature-read',f.other),{status:404});assert.equal(f.db.prepare('SELECT used FROM billing_quotes WHERE token=?').get(q.token).used,0);
 const generic=f.quote();assert.throws(()=>f.reserve(f.job(),generic,'literature-read'),{status:409});const genericJob=f.job();assert.equal(f.reserve(genericJob,generic).creditCost,10);
 f.configure({'literature-answer':{mode:'paid',creditCost:11}});assert.throws(()=>f.reserve(f.job(),q,'literature-read'),{status:409});const current=f.quote('literature-read');f.base('paid',12);assert.throws(()=>f.reserve(f.job(),current,'literature-read'),{status:409});
 const next=f.quote('literature-read'),id=f.job(),held=f.reserve(id,next,'literature-read');assert.equal(held.serviceKey,'literature-read');assert.equal(held.creditCost,12);assert.equal(f.reserve(id,next,'literature-read').id,held.id);assert.throws(()=>f.reserve(id,next),{status:409});assert.throws(()=>f.reserve(id,next,'literature-answer'),{status:409});assert.throws(()=>f.reserve(f.job(),next,'literature-read'),{status:409});
 const expired=f.quote('presentation-ai');f.advance(300000);assert.throws(()=>f.reserve(f.job(),expired,'presentation-ai'),{status:409});
});

test('independently free tools consume neither credits nor existing membership quotas and still require confirmation',t=>{
 const f=fixture(t);f.base();f.order('credits');const order=f.order('membership');f.configure({'literature-read':{mode:'free',creditCost:null}});const id=f.job();assert.throws(()=>f.reserve(id,null,'literature-read'),{status:409});const held=f.reserve(id,f.quote('literature-read'),'literature-read');assert.equal(held.source,'free');f.tx(()=>f.billing.settle(id));assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.billing.entitlements(f.user.id).membershipUsage[order][0].used,0);
});

test('agent membership quota covers different tools and is counted once under the actual agent entitlement',t=>{
 const f=fixture(t);f.base();f.order('credits');const order=f.order('membership',{items:[{key:'agent',title:'会员科研助手',quantity:2}]});
 for(const key of ['literature-read','presentation-thesis']){const q=f.quote(key);assert.equal(q.source,'membership');assert.equal(q.entitlementKey,'agent');const id=f.job(),r=f.reserve(id,q,key);assert.equal(r.entitlementKey,'agent');f.tx(()=>f.billing.settle(id));}
 const usage=f.billing.entitlements(f.user.id);assert.equal(usage.membershipUsage[order][0].used,2);assert.equal(usage.membershipUsage[order][0].remaining,0);assert.equal(f.quote('research-chart').source,'credits');assert.equal(f.billing.balance(f.user.id).balance,200);
});

test('dedicated tool entitlements are preferred within each source and never share another tool quota',t=>{
 const f=fixture(t);f.base();f.order('credits');const general=f.order('membership',{items:[{key:'agent',title:'通用会员',quantity:1}]}),dedicated=f.order('membership',{items:[{key:'literature-read',title:'研读会员专属',quantity:1}]}),bundle=f.order('bundle',{items:[{key:'presentation-thesis',title:'答辩演示专属',quantity:1},{key:'unsupported-service',title:'未接通',quantity:99}]});
 let q=f.quote('literature-read');assert.equal(q.sourceOrderId,dedicated);assert.equal(q.entitlementKey,'literature-read');let id=f.job();f.reserve(id,q,'literature-read');f.tx(()=>f.billing.settle(id));q=f.quote('presentation-ai');assert.equal(q.sourceOrderId,general);id=f.job();f.reserve(id,q,'presentation-ai');f.tx(()=>f.billing.settle(id));
 q=f.quote('presentation-thesis');assert.equal(q.source,'bundle');assert.equal(q.sourceOrderId,bundle);assert.equal(q.entitlementKey,'presentation-thesis');id=f.job();f.reserve(id,q,'presentation-thesis');assert.equal(f.quote('presentation-ai').source,'credits');assert.throws(()=>f.reserve(f.job(),q,'presentation-ai'),{status:409});f.tx(()=>f.billing.release(id));assert.equal(f.billing.entitlements(f.user.id).bundleUsage[bundle][0].remaining,1);assert.equal(f.billing.entitlements(f.user.id).bundleUsage[bundle].length,1);
});

test('quota expiry and concurrent holds are checked again without silently switching billing source',t=>{
 const f=fixture(t);f.base();f.order('credits');const order=f.order('bundle',{items:[{key:'research-chart',title:'图表',quantity:1}],expiresAt:new Date(Date.parse('2026-10-18T00:00:00Z')+60000).toISOString()}),q1=f.quote('research-chart'),q2=f.quote('research-chart'),id=f.job();f.reserve(id,q1,'research-chart');assert.throws(()=>f.reserve(f.job(),q2,'research-chart'),{status:409});assert.equal(f.billing.balance(f.user.id).held,0);f.tx(()=>f.billing.release(id));const fresh=f.quote('research-chart');f.advance(60000);assert.throws(()=>f.reserve(f.job(),fresh,'research-chart'),{status:409});assert.equal(f.billing.entitlements(f.user.id).bundleUsage[order][0].used,0);
});

test('SKU reservations retain agreed amounts through price changes, settle/release once and show precise ledger titles',t=>{
 const f=fixture(t);f.base();f.order('credits');f.configure({'presentation-ai':{mode:'paid',creditCost:25}});const id=f.job(),q=f.quote('presentation-ai');f.reserve(id,q,'presentation-ai');f.configure({'presentation-ai':{mode:'paid',creditCost:90}});f.tx(()=>f.billing.settle(id));f.tx(()=>f.billing.settle(id));f.tx(()=>f.billing.release(id));assert.equal(f.billing.balance(f.user.id).balance,175);const event=f.billing.balance(f.user.id).ledger.find(e=>e.kind==='settle');assert.equal(event.title,'AI PPT');assert.equal(event.serviceKey,'presentation-ai');assert.equal(event.amount,-25);
 const cancelled=f.job();f.reserve(cancelled,f.quote('literature-answer'),'literature-answer');f.tx(()=>f.billing.release(cancelled));f.tx(()=>f.billing.release(cancelled));assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='release'").get().n,1);
});

test('new pricing identity fields are immutable while used flags and lawful settlement remain usable',t=>{
 const f=fixture(t);f.base();f.order('credits');const q=f.quote('presentation-ai');for(const sql of ["UPDATE billing_quotes SET service_key='literature-read'","UPDATE billing_quotes SET entitlement_key='agent'",'UPDATE billing_quotes SET tool_policy_version=99'])assert.throws(()=>f.db.exec(sql),/不可修改/);
 const id=f.job();f.reserve(id,q,'presentation-ai');for(const sql of ["UPDATE billing_reservations SET service_key='literature-read'","UPDATE billing_reservations SET entitlement_key='agent'"])assert.throws(()=>f.db.exec(sql),/不可修改/);assert.equal(f.db.prepare('SELECT used FROM billing_quotes WHERE token=?').get(q.token).used,1);f.tx(()=>f.billing.settle(id));assert.equal(f.billing.entitlements(f.user.id).reservations[0].status,'settled');
});

test('a rejected transaction rolls back SKU quote use, identity, credit hold and policy changes together',t=>{
 const f=fixture(t);f.base();f.order('credits');const q=f.quote('presentation-ai'),id=f.job();assert.throws(()=>f.tx(()=>{f.billing.reserve(f.user,id,1,'agent',q.token,'presentation-ai');throw Error('simulated failure');}),/simulated/);assert.equal(f.db.prepare('SELECT used FROM billing_quotes WHERE token=?').get(q.token).used,0);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);
 const version=f.billing.toolRules().version;assert.throws(()=>f.tx(()=>{f.configure({'presentation-ai':{mode:'paid',creditCost:30}});throw Error('audit failed');}),/audit failed/);assert.equal(f.billing.toolRules().version,version);assert.equal(f.quote('presentation-ai').creditCost,10);
});

test('SKU-only paid services make credits and dedicated bundles saleable without enabling unrelated services',t=>{
 const f=fixture(t);f.configure({'presentation-ai':{mode:'paid',creditCost:15}});assert.equal(f.billing.rules().services.find(s=>s.key==='agent').mode,'free');assert.equal(productDelivery({entitlementType:'credits'},f.billing).purchasable,true);assert.equal(productDelivery({entitlementType:'bundle',bundleItems:[{key:'presentation-ai',quantity:1}]},f.billing).purchasable,true);assert.equal(productDelivery({entitlementType:'membership',membershipItems:[{key:'literature-read',quantity:1}]},f.billing).purchasable,false);
 const g=fixture(t,{available:false});g.configure({'presentation-ai':{mode:'paid',creditCost:15}});assert.equal(productDelivery({entitlementType:'credits'},g.billing).purchasable,false);assert.throws(()=>g.quote('presentation-ai'),{status:503});
});

test('old three-type tables migrate in place without rewriting legacy rules, quotes or existing reservations',t=>{
 let before;const f=fixture(t,{beforeBilling:({db,user,job,at})=>{
  db.exec(`CREATE TABLE billing_policy(id INTEGER PRIMARY KEY CHECK(id=1),rules TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE billing_quotes(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('polish','review','agent')),source TEXT NOT NULL,source_order TEXT,credits INTEGER NOT NULL,policy_version INTEGER NOT NULL,expires_at TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0);CREATE TABLE billing_reservations(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,attempt INTEGER NOT NULL,user_id TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('polish','review','agent')),source TEXT NOT NULL,source_order TEXT,credits INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(job_id,attempt));`);
  db.prepare('INSERT INTO billing_policy VALUES(1,?,7,?)').run(JSON.stringify(billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))),at);job(user,'historic-held');db.prepare('INSERT INTO billing_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('historic-reservation','historic-held',1,user.id,'agent','credits',null,10,'held',at,at);db.prepare('INSERT INTO billing_quotes VALUES(?,?,?,?,?,?,?,?,?)').run('historic-quote',user.id,'agent','credits',null,10,7,new Date(Date.parse(at)+300000).toISOString(),0);before={policy:{...db.prepare('SELECT * FROM billing_policy').get()},reservation:{...db.prepare('SELECT * FROM billing_reservations').get()},quote:{...db.prepare('SELECT * FROM billing_quotes').get()}};
 }});
 f.order('credits');assert.deepEqual({...f.db.prepare('SELECT * FROM billing_policy').get()},before.policy);for(const [table,old]of [['billing_quotes',before.quote],['billing_reservations',before.reservation]]){const row={...f.db.prepare('SELECT * FROM '+table).get()};assert.equal(row.service_key,null);assert.equal(row.entitlement_key,null);for(const key of Object.keys(old))assert.deepEqual(row[key],old[key]);}
 assert.equal(f.billing.rules().version,7);assert.equal(f.billing.toolRules().version,1);assert.equal(f.billing.balance(f.user.id).held,10);const legacy=f.reserve(f.job(),{token:'historic-quote'});assert.equal(legacy.creditCost,10);f.tx(()=>f.billing.release('historic-held'));assert.equal(f.billing.balance(f.user.id).held,10);f.tx(()=>f.billing.settle(legacy.jobId));assert.equal(f.billing.balance(f.user.id).balance,190);
 createBillingService(f.db,f.config);assert.equal(f.billing.toolRules().version,1);assert.equal(f.db.prepare("SELECT sql FROM sqlite_master WHERE name='billing_reservations'").get().sql.includes("'polish','review','agent'"),true);
});

test('historical NULL entitlement identities count toward the same legacy agent quota as new tool reservations',t=>{
 const f=fixture(t);f.base();f.order('credits');const order=f.order('membership',{items:[{key:'agent',title:'历史会员通用额度',quantity:2}]}),legacy=f.job();
 // A pre-migration record has NULL new identity columns. Insert a settled
 // historical row directly; its purchased entitlement snapshot stays unchanged.
 const at='2026-10-18T00:00:00.000Z';f.db.prepare("INSERT INTO billing_reservations(id,job_id,attempt,user_id,type,source,source_order,credits,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'settled',?,?)").run('legacy-null-key',legacy,1,f.user.id,'agent','membership',order,0,at,at);
 assert.equal(f.billing.entitlements(f.user.id).membershipUsage[order][0].used,1);const q=f.quote('presentation-ai');assert.equal(q.entitlementKey,'agent');const id=f.job();f.reserve(id,q,'presentation-ai');assert.equal(f.billing.entitlements(f.user.id).membershipUsage[order][0].held,1);assert.equal(f.quote('literature-read').source,'credits');f.tx(()=>f.billing.settle(id));assert.equal(f.billing.entitlements(f.user.id).membershipUsage[order][0].used,2);
});

test('changing tool-only pricing leaves an unconsumed legacy agent quote valid while invalidating concrete tool quotes',t=>{
 const f=fixture(t);f.base();f.order('credits');const legacy=f.quote(),specific=f.quote('literature-read');f.configure({'presentation-ai':{mode:'paid',creditCost:30}});assert.equal(f.reserve(f.job(),legacy).creditCost,10);assert.throws(()=>f.reserve(f.job(),specific,'literature-read'),{status:409});assert.equal(f.billing.balance(f.user.id).held,10);
});


test('dedicated tool sales and quotes require a saved live Agent runtime even while legacy HTTP AI remains available',t=>{
 const f=fixture(t);f.base();f.order('credits');f.configure({'presentation-ai':{mode:'paid',creditCost:15}});const valid=f.config.getAgentSettings();
 for(const runtime of [{...valid,enabled:false},{...valid,version:null},{...valid,version:''},null]){f.config.getAgentSettings=()=>runtime;assert.equal(f.billing.rules().services.find(s=>s.key==='agent').available,true);assert.ok(f.billing.toolRules().services.filter(s=>s.key!=='research-image').every(s=>s.available===false));assert.equal(f.billing.toolRules().services.find(s=>s.key==='research-image').available,true);assert.equal(productDelivery({entitlementType:'bundle',bundleItems:[{key:'presentation-ai',quantity:1}]},f.billing).purchasable,false);assert.throws(()=>f.quote('presentation-ai'),{status:503});assert.equal(f.quote().creditCost,10);}
 f.config.getAgentSettings=()=>valid;assert.equal(f.billing.toolRules().services.find(s=>s.key==='presentation-ai').available,true);assert.equal(productDelivery({entitlementType:'bundle',bundleItems:[{key:'presentation-ai',quantity:1}]},f.billing).purchasable,true);assert.equal(f.quote('presentation-ai').creditCost,15);
});
