import {enableFreeDetection} from './fixtures/detection-pricing.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID,randomBytes,generateKeyPairSync} from 'node:crypto';
import {createServer} from '../server.mjs';
import {createSession} from '../backend/auth.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {startWorker} from '../backend/worker.mjs';

// The only HTTP model is this loopback fixture. Payment gateways are test adapters.
const rsa=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const channel={appId:'wx1234567890abcdef',merchantId:'1234567890',merchantSerial:'1234567890ABCDEF1234567890ABCDEF',privateKey:rsa.privateKey,apiV3Key:'k'.repeat(32),platformPublicKeyId:'PUB_KEY_ID_1234567890',platformPublicKey:rsa.publicKey};
async function fixture(t){
 let mode='hold';const calls=[],remote=new Map();
 const send=(res,value=mode)=>{if(res.writableEnded||res.destroyed||value==='hold')return;res.setHeader('Content-Type','application/json');res.end(value==='fail'?'{invalid':JSON.stringify({choices:[{message:{content:'测试模型返回的修改建议'}}],usage:{prompt_tokens:25,completion_tokens:15}}));};
 const model=http.createServer(async(req,res)=>{for await(const _ of req){}calls.push({res});send(res);});await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 const config={aiURL:`http://127.0.0.1:${model.address().port}/chat`,aiKey:'loopback-fixture-only',aiModel:'billing-test-model',authCodeSecret:'billing-api-tests-only-no-external-delivery',paymentConfigKey:randomBytes(32).toString('base64'),paymentAdapters:{
  async create(provider,settings,input){remote.set(input.outTradeNo,{provider,settings,input});return {qrContent:'weixin://wxpay/bizpayurl?pr=billing-fixture'};},
  async query(provider,settings,input){const order=remote.get(input.outTradeNo);return {state:'paid',outTradeNo:input.outTradeNo,amountCents:order.input.amountCents,currency:'CNY',merchantId:settings.merchantId,appId:settings.appId,providerTradeNo:'test-trade-'+input.outTradeNo,paidAt:new Date().toISOString()};},
  async notify(){throw new Error('notification not used in billing fixture');}
 }};
 const app=createServer({dbPath:':memory:',config});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;
 const seed=(id,role='user')=>{app.db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(id,'计费接口测试账户',role,new Date().toISOString());return {id,cookie:'pk_session='+createSession(app.db,id)};};
 const user=seed('billing-http-owner'),other=seed('billing-http-other'),admin=seed('billing-http-admin','admin');
 async function request(path,{data,cookie=user.cookie,method=data===undefined?'GET':'POST'}={}){const res=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,...(data===undefined?{}:{'Content-Type':'application/json',Origin:base})},body:data===undefined?undefined:JSON.stringify(data)});return {status:res.status,value:await res.json()};}
 const rules=async()=> (await request('/billing/rules')).value;
 async function paid(cost=20){const current=await rules();const result=await request('/admin/billing',{cookie:admin.cookie,data:{version:current.version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:cost}))}});assert.equal(result.status,200);return result.value.billing;}
 function credit(amount=200,owner=user){const id=randomUUID(),now=new Date().toISOString();app.db.prepare('INSERT OR IGNORE INTO payment_config_versions(id,provider,sealed_settings,identity_hash,created_by,created_at) VALUES(?,?,?,?,?,?)').run('credit-fixture','wechat','{}','seed-identity',admin.id,now);app.db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,owner.id,'credits-200','paid',now);app.db.prepare('INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,title,entitlement,idempotency_key,input_hash,user_id,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'wechat','fixture-'+id,'credit-fixture',2000,'测试充值',JSON.stringify({type:'credits',creditAmount:amount}),id,id,owner.id,now,now);app.db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(id,owner.id,'credits-200',amount,'purchase',now);return id;}
 const quote=async(type='polish',owner=user)=>request('/billing/quote',{cookie:owner.cookie,data:{type}});
 const submit=async(q,{owner=user,type='polish',key=randomUUID(),text='这是实际提交给本地测试模型的原文。'}={})=>request('/jobs',{cookie:owner.cookie,data:{type,text,idempotencyKey:key,...(q?{billingQuote:q.token}:{} )}});
 async function waitStatus(id,statuses=['completed','failed','cancelled']){for(let i=0;i<150;i++){const job=(await request('/jobs')).value.items.find(item=>item.id===id);if(job&&statuses.includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('fixture job timed out');}
 async function waitCall(){for(let i=0;i<150&&!calls.length;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(calls.length);}
 const entitlements=async(owner=user)=>(await request('/payments/entitlements',{cookie:owner.cookie})).value;
 t.after(async()=>{await app.close();model.closeAllConnections();await new Promise(resolve=>model.close(resolve));});
 return {...app,config,user,other,admin,request,rules,paid,credit,quote,submit,waitStatus,waitCall,entitlements,calls,remote,respond(value){mode=value;for(const call of calls)send(call.res,value);},count:table=>app.db.prepare('SELECT count(*) n FROM '+table).get().n};
}

test('paid HTTP submission without a quote rolls back the task; confirmed duplicate key holds once and success settles once',async t=>{
 const f=await fixture(t);await f.paid(30);f.credit(200);const denied=await f.submit();assert.equal(denied.status,409);assert.equal(f.count('jobs'),0);assert.equal(f.count('billing_reservations'),0);
 const q=await f.quote();assert.equal(q.status,200);assert.equal(q.value.source,'credits');const key=randomUUID(),first=await f.submit(q.value,{key}),again=await f.submit(q.value,{key});assert.equal(first.status,201);assert.equal(again.status,200);assert.equal(first.value.id,again.value.id);
 let owned=await f.entitlements();assert.deepEqual([owned.credits.balance,owned.credits.held,owned.credits.available],[200,30,170]);assert.equal(owned.billing.reservations.length,1);
 await f.waitCall();f.respond('success');const job=await f.waitStatus(first.value.id);assert.equal(job.status,'completed');owned=await f.entitlements();assert.deepEqual([owned.credits.balance,owned.credits.held,owned.credits.available],[170,0,170]);assert.equal(owned.billing.reservations[0].status,'settled');assert.equal(f.count('results'),1);assert.equal(f.calls.length,1);
 const usage=(await f.request('/usage')).value;assert.equal(usage.billingEnabled,true);assert.equal(usage.items[0].billable,1);assert.equal(usage.items[0].input_tokens,25);assert.equal(owned.credits.ledger.filter(item=>item.kind==='settle').length,1);
});

test('failure releases credits; retries require a fresh quote and reserve the correct subsequent attempt',async t=>{
 const f=await fixture(t);await f.paid(40);f.credit(100);const first=await f.submit((await f.quote()).value);await f.waitCall();f.respond('fail');const failed=await f.waitStatus(first.value.id);assert.equal(failed.status,'failed');assert.equal(failed.attempt,1);assert.equal((await f.entitlements()).credits.available,100);assert.equal(f.count('usage'),0);assert.equal(f.count('results'),0);
 assert.equal((await f.request('/jobs/'+failed.id+'/retry',{data:{}})).status,409);assert.equal(f.count('billing_reservations'),1);
 const quote2=(await f.quote()).value;assert.equal((await f.request('/jobs/'+failed.id+'/retry',{data:{billingQuote:quote2.token}})).status,200);const failed2=await f.waitStatus(failed.id);assert.equal(failed2.attempt,2);assert.equal(failed2.status,'failed');assert.equal((await f.entitlements()).credits.available,100);
 f.respond('hold');const quote3=(await f.quote()).value;assert.equal((await f.request('/jobs/'+failed.id+'/retry',{data:{billingQuote:quote3.token}})).status,200);assert.equal((await f.request('/jobs/'+failed.id+'/retry',{data:{billingQuote:quote3.token}})).status,409);
 let owned=await f.entitlements();assert.deepEqual(owned.billing.reservations.map(row=>[row.attempt,row.status]).sort((a,b)=>a[0]-b[0]),[[1,'released'],[2,'released'],[3,'held']]);
 f.respond('success');const success=await f.waitStatus(failed.id);assert.equal(success.status,'completed');assert.equal(success.attempt,3);owned=await f.entitlements();assert.equal(owned.credits.balance,60);assert.equal(owned.credits.held,0);assert.equal(f.count('usage'),1);
});

test('a retry submission failure rolls back new reservation and quote use while keeping the failed attempt intact',async t=>{
 const f=await fixture(t);await f.paid();f.credit();f.respond('fail');const job=(await f.submit((await f.quote()).value)).value.id;await f.waitStatus(job);const q=(await f.quote()).value;
 f.db.exec("CREATE TRIGGER fixture_retry_failure BEFORE UPDATE ON jobs WHEN NEW.status='queued' BEGIN SELECT RAISE(ABORT,'fixture retry failure'); END;");assert.equal((await f.request('/jobs/'+job+'/retry',{data:{billingQuote:q.token}})).status,500);assert.equal(f.count('billing_reservations'),1);assert.equal(f.db.prepare('SELECT used FROM billing_quotes WHERE token=?').get(q.token).used,0);assert.equal((await f.entitlements()).credits.held,0);assert.equal(f.db.prepare('SELECT attempt,status FROM jobs WHERE id=?').get(job).attempt,1);
 f.db.exec('DROP TRIGGER fixture_retry_failure');f.respond('success');assert.equal((await f.request('/jobs/'+job+'/retry',{data:{billingQuote:q.token}})).status,200);assert.equal((await f.waitStatus(job)).attempt,2);assert.equal((await f.entitlements()).credits.balance,180);
});

test('user cancellation releases a running reservation; admin cancellation releases a queued one and is audited',async t=>{
 const f=await fixture(t);await f.paid(25);f.credit(100);const running=(await f.submit((await f.quote()).value)).value.id;await f.waitCall();assert.equal((await f.request('/jobs/'+running+'/cancel',{data:{}})).status,200);assert.equal((await f.entitlements()).credits.available,100);assert.equal((await f.waitStatus(running)).status,'cancelled');assert.equal(f.count('results'),0);
 const queued=(await f.submit((await f.quote()).value)).value.id;assert.equal((await f.request('/admin/jobs/'+queued+'/cancel',{cookie:f.other.cookie,data:{}})).status,403);assert.equal((await f.request('/admin/jobs/'+queued+'/cancel',{cookie:f.admin.cookie,data:{}})).status,200);assert.equal((await f.entitlements()).credits.held,0);assert.equal((await f.waitStatus(queued)).status,'cancelled');assert.equal(f.db.prepare("SELECT count(*) n FROM admin_audit WHERE action='job.cancel' AND target_id=?").get(queued).n,1);assert.equal(f.count('usage'),0);
});

test('a worker restart releases a persisted running reservation without re-executing or charging it',async t=>{
 const f=await fixture(t);await f.paid(60);f.credit(100);await f.worker.stop();const billing=createBillingService(f.db,{...f.config,getAI:()=>f.config}),jobId='persisted-running-job',now=new Date().toISOString(),q=(await f.quote()).value;
 f.db.exec('BEGIN IMMEDIATE');f.db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at,attempt) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(jobId,f.user.id,'polish','running','model_request','{}',jobId,jobId,now,now,1);billing.reserve(f.user,jobId,1,'polish',q.token);f.db.exec('COMMIT');assert.equal(billing.balance(f.user.id).held,60);
 const restarted=startWorker(f.db,{...f.config,getAI:()=>f.config});await restarted.stop();const job=f.db.prepare('SELECT status,stage FROM jobs WHERE id=?').get(jobId);assert.equal(job.status,'failed');assert.equal(job.stage,'interrupted');assert.deepEqual([billing.balance(f.user.id).balance,billing.balance(f.user.id).held],[100,0]);assert.equal(f.calls.length,0);assert.equal(f.count('results'),0);
});

test('balances, quotes, reservations and task results stay isolated between service accounts',async t=>{
 const f=await fixture(t);await f.paid(20);f.credit(100);assert.equal((await f.quote('polish',f.other)).status,402);const q=(await f.quote()).value;assert.equal((await f.submit(q,{owner:f.other})).status,409);assert.equal(f.count('jobs'),0);
 const job=(await f.submit(q)).value.id;assert.equal((await f.request('/jobs/'+job+'/cancel',{cookie:f.other.cookie,data:{}})).status,404);assert.deepEqual((await f.entitlements(f.other)).credits,{balance:0,held:0,available:0,ledger:[]});assert.deepEqual((await f.entitlements(f.other)).billing.reservations,[]);f.respond('success');const completed=await f.waitStatus(job);assert.equal((await f.request('/results/'+completed.result_id,{cookie:f.other.cookie})).status,404);
});

test('admin billing requires authentication, rejects stale edits and writes one audit record per committed change',async t=>{
 const f=await fixture(t),input={version:1,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:25}))};assert.equal((await f.request('/admin/billing',{cookie:'',data:input})).status,401);assert.equal((await f.request('/admin/billing',{cookie:f.user.cookie,data:input})).status,403);assert.equal((await f.request('/admin/billing',{cookie:f.admin.cookie,data:input})).status,200);assert.equal((await f.request('/admin/billing',{cookie:f.admin.cookie,data:input})).status,409);
 const audits=f.db.prepare("SELECT detail FROM admin_audit WHERE action='billing.rules.update'").all();assert.equal(audits.length,1);assert.equal(JSON.parse(audits[0].detail).version,2);assert.equal((await f.rules()).version,2);assert.equal((await f.request('/billing/quote',{data:{type:'polish',creditCost:0}})).status,400);
});

test('product publication requires executable paid services and membership quota comes from its immutable paid order snapshot',async t=>{
 const f=await fixture(t);const product={title:'测试月度会员',description:'30 天内包含一次学术润色，仅本地测试，不用于真实销售。',priceCents:1000,durationDays:30,entitlementType:'membership',status:'active',membershipItems:[{key:'polish',title:'学术润色',quantity:1}]};
 assert.equal((await f.request('/admin/payments/products/basic',{cookie:f.admin.cookie,data:product})).status,409);assert.equal(f.db.prepare('SELECT status FROM products WHERE id=?').get('basic').status,'preview');assert.equal((await f.request('/payments/options',{cookie:''})).value.products.find(p=>p.id==='credits-200').purchasable,false);
 await f.paid(10);const bad={...product,membershipItems:[{key:'future-service',title:'未接入服务',quantity:1}]};assert.equal((await f.request('/admin/payments/products/basic',{cookie:f.admin.cookie,data:bad})).status,409);assert.equal((await f.request('/admin/payments/products/basic',{cookie:f.admin.cookie,data:product})).status,200);
 assert.equal((await f.request('/admin/payments/wechat',{cookie:f.admin.cookie,data:{enabled:true,...channel}})).status,200);const created=await f.request('/orders',{data:{provider:'wechat',productId:'basic',idempotencyKey:randomUUID()}});assert.equal(created.status,201);
 assert.equal((await f.request('/admin/payments/products/basic',{cookie:f.admin.cookie,data:{...product,membershipItems:[{key:'polish',title:'改过的数量',quantity:99}]}})).status,200);const paid=await f.request('/orders/'+created.value.item.id+'/query',{data:{}});assert.equal(paid.status,200);assert.equal(paid.value.item.status,'paid');
 let owned=await f.entitlements();assert.deepEqual(owned.items[0].membershipItems,product.membershipItems);const q=(await f.quote()).value;assert.equal(q.source,'membership');assert.equal(q.creditCost,0);f.respond('success');const job=(await f.submit(q)).value.id;assert.equal((await f.waitStatus(job)).status,'completed');owned=await f.entitlements();assert.equal(owned.billing.membershipUsage[created.value.item.id][0].remaining,0);assert.equal(owned.billing.membershipUsage[created.value.item.id][0].used,1);assert.equal(owned.credits.balance,0);assert.equal((await f.quote()).status,402);assert.equal(f.db.prepare('SELECT billable FROM usage').get().billable,1);
});

test('free service success does not consume a previously bought membership allowance',async t=>{
 const f=await fixture(t);await f.paid(20);const product={title:'本地测试会员',description:'一项已接通能力，测试专用。',priceCents:1000,durationDays:30,entitlementType:'membership',status:'active',membershipItems:[{key:'polish',title:'学术润色',quantity:2}]};assert.equal((await f.request('/admin/payments/products/basic',{cookie:f.admin.cookie,data:product})).status,200);await f.request('/admin/payments/wechat',{cookie:f.admin.cookie,data:{enabled:true,...channel}});const order=(await f.request('/orders',{data:{provider:'wechat',productId:'basic',idempotencyKey:randomUUID()}})).value.item;await f.request('/orders/'+order.id+'/query',{data:{}});
 const rule=await f.rules();assert.equal((await f.request('/admin/billing',{cookie:f.admin.cookie,data:{version:rule.version,services:rule.services.map(({key})=>({key,mode:'free',creditCost:null}))}})).status,200);f.respond('success');const q=(await f.quote()).value;assert.equal(q.source,'free');const id=(await f.submit(q)).value.id;assert.equal((await f.waitStatus(id)).status,'completed');const owned=await f.entitlements();assert.deepEqual(owned.billing.membershipUsage[order.id][0],{key:'polish',title:'学术润色',quantity:2,held:0,used:0,remaining:2});assert.equal(f.db.prepare('SELECT billable FROM usage').get().billable,0);assert.deepEqual(owned.credits.ledger,[]);
});

test('saving service pricing returns product availability from the same committed policy',async t=>{
 const f=await fixture(t);enableFreeDetection(f.db);
 const before=(await f.request('/admin/payments',{cookie:f.admin.cookie})).value;
 assert.equal(before.catalog.find(item=>item.id==='credits-200').purchasable,false);
 const save=await f.request('/admin/billing',{cookie:f.admin.cookie,data:{version:before.billing.version,services:before.billing.services.map(({key})=>({key,mode:'paid',creditCost:10}))}});
 assert.equal(save.status,200);
 assert.equal(save.value.billing.services.find(item=>item.key==='polish').creditCost,10);
 assert.equal(save.value.catalog.find(item=>item.id==='credits-200').purchasable,true);
 const paused=await f.request('/admin/billing',{cookie:f.admin.cookie,data:{version:save.value.billing.version,services:save.value.billing.services.map(({key})=>({key,mode:'free',creditCost:null}))}});
 assert.equal(paused.status,200);
 assert.equal(paused.value.catalog.find(item=>item.id==='credits-200').purchasable,false);
 assert.equal(paused.value.catalog.find(item=>item.id==='credits-200').unavailableCode,'credit_pricing_missing');
});
