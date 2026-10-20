import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,generateKeyPairSync,createHash,verify} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession} from '../backend/auth.mjs';
import {validateProvider,createProviderPayment,validateAlipayPaymentURL,validateAlipayQRPaymentURL} from '../backend/payment-providers.mjs';
import {createBillingService,billingServiceTypes,toolBillingServiceTypes} from '../backend/billing-service.mjs';

const rsa=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const wechat={appId:'wx1234567890abcdef',merchantId:'1234567890',merchantSerial:'1234567890ABCDEF1234567890ABCDEF',privateKey:rsa.privateKey,apiV3Key:'a'.repeat(32),platformPublicKeyId:'PUB_KEY_ID_1234567890',platformPublicKey:rsa.publicKey};
const alipay={appId:'2026101512345678',sellerId:'2088123456789012',privateKey:rsa.privateKey,alipayPublicKey:rsa.publicKey};
assert.deepEqual(validateProvider('wechat',wechat),[]);
assert.deepEqual(validateProvider('alipay',alipay),[]);
const product={title:'账户会员测试商品',description:'提供 7 天账户会员记录，以当前已开放服务为准。',priceCents:321,durationDays:7,status:'active',membershipItems:[{key:'polish',title:'测试学术润色',quantity:2},{key:'review',title:'测试导师意见修改',quantity:2}]};
const signature=(provider,settings)=>provider==='wechat'?settings.apiV3Key:createHash('sha256').update(settings.alipayPublicKey.trim()).digest('hex');

async function fixture(t,{config:overrides={},adapters={}}={}){
 const db=database(':memory:'),created=[],queried=[],verified=[],remote=new Map();
 const config={authCodeSecret:'payment-test-auth-secret-2026-do-not-use-in-production',paymentConfigKey:randomBytes(32).toString('base64'),ownerEmail:'owner-payment@example.invalid',getAI:()=>({aiURL:'https://billing-fixture.example.invalid/v1/chat',aiKey:'payment-fixture-only-no-network',aiModel:'test-model'}),...overrides};
 const paymentAdapters={
  async create(provider,settings,input){created.push({provider,settings:{...settings},input:{...input}});remote.set(input.outTradeNo,{provider,settings:{...settings},input:{...input},state:'pending'});if(adapters.create)return adapters.create(provider,settings,input);return provider==='alipay'?createProviderPayment(provider,settings,input):{qrContent:'weixin://wxpay/bizpayurl?pr=payment-test-order'};},
  async query(provider,settings,input,options){queried.push({provider,settings:{...settings},input:{...input},options});if(adapters.query)return adapters.query(provider,settings,input,options);const entry=remote.get(input.outTradeNo);return paidResult(entry,{state:entry?.state||'pending'});},
  async notify(provider,settings,request){verified.push({provider,settings:{...settings}});if(adapters.notify)return adapters.notify(provider,settings,request);if(request.headers['x-test-sign']!==signature(provider,settings))throw new Error('test invalid provider signature');const raw=request.rawBody.toString();return JSON.parse(provider==='wechat'?raw:new URLSearchParams(raw).get('payload'));}
 };
 config.paymentAdapters=paymentAdapters;
 const billing=createBillingService(db,config);billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:key==='agent'?'disabled':'paid',creditCost:key==='agent'?null:10}))});
 const api=createAPI(db,{cancel(){}},config),server=http.createServer((req,res)=>void api(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
 function seed(id,role='user'){db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid','支付测试账户',null,role,new Date().toISOString());return {id,cookie:'pk_session='+createSession(db,id)};}
 const admin=seed('test-admin','admin'),user=seed('test-user'),other=seed('other-user');
 async function request(path,{data,cookie=user.cookie,method=data===undefined?'GET':'POST',origin=base,headers={}}={}){const result=await fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(method==='POST'?{'Content-Type':'application/json',...(origin?{Origin:origin}:{})}:{}),...headers},body:data===undefined?undefined:JSON.stringify(data)});const text=await result.text();let value;try{value=text?JSON.parse(text):null;}catch{value=text;}return {status:result.status,value,text,headers:result.headers};}
 async function channel(provider='wechat',fields={}){return request('/api/admin/payments/'+provider,{cookie:admin.cookie,data:{enabled:true,...(provider==='wechat'?wechat:alipay),...fields}});}
 async function publish(id='basic',fields={}){return request('/api/admin/payments/products/'+id,{cookie:admin.cookie,data:{...product,...fields}});}
 async function ready(provider='wechat'){assert.equal((await channel(provider)).status,200);assert.equal((await publish()).status,200);}
 async function create({provider='wechat',productId='basic',idempotencyKey='test-order-'+randomBytes(6).toString('hex'),cookie=user.cookie,...rest}={}){return request('/api/orders',{cookie,data:{provider,productId,idempotencyKey,...rest}});}
 function orderEntry(item){return remote.get(item.outTradeNo);}
 function paidResult(entry,fields={}){if(!entry)throw new Error('Missing mocked payment order');return {state:'paid',outTradeNo:entry.input.outTradeNo,amountCents:entry.input.amountCents,currency:'CNY',merchantId:entry.provider==='wechat'?entry.settings.merchantId:entry.settings.sellerId,appId:entry.settings.appId,providerTradeNo:'provider-'+entry.input.outTradeNo,paidAt:new Date().toISOString(),...fields};}
 async function notify(item,{provider=item.provider,settings=provider==='wechat'?wechat:alipay,result=paidResult(orderEntry(item)),sign=signature(provider,settings),contentType=provider==='wechat'?'application/json':'application/x-www-form-urlencoded',origin}={}){const payload=JSON.stringify(result),response=await fetch(base+'/api/payments/notify/'+provider,{method:'POST',headers:{'Content-Type':contentType,'x-test-sign':sign,...(provider==='wechat'?{'Wechatpay-Serial':settings.platformPublicKeyId}:{}),...(origin?{Origin:origin}:{})},body:provider==='wechat'?payload:new URLSearchParams({payload,out_trade_no:result.outTradeNo}).toString()});return {status:response.status,text:await response.text(),headers:response.headers};}
 const count=table=>db.prepare('SELECT count(*) AS n FROM '+table).get().n;
 return {base,db,config,request,channel,publish,ready,create,notify,paidResult,orderEntry,created,queried,verified,remote,user,other,admin,count};
}

test('closed payment channels and unpublished membership products reject creation without creating an order',async t=>{
 const f=await fixture(t);assert.equal((await f.request('/api/payments/options',{cookie:''})).value.enabled,false);assert.equal((await f.create()).status,503);assert.equal(f.count('orders'),0);assert.equal((await f.channel()).status,200);assert.equal((await f.create()).status,409);assert.equal(f.count('orders'),0);assert.equal((await f.publish()).status,200);assert.equal((await f.channel('wechat',{enabled:false})).status,200);assert.equal((await f.create()).status,503);assert.equal(f.count('orders'),0);assert.equal(f.created.length,0);
});

test('a configured channel with only free services reports missing credit pricing and never creates a payment',async t=>{
 const f=await fixture(t);await f.channel();
 const state=(await f.request('/api/admin/payments',{cookie:f.admin.cookie})).value;
 assert.equal((await f.request('/api/admin/billing',{cookie:f.admin.cookie,data:{version:state.billing.version,services:billingServiceTypes.map(({key})=>({key,mode:'free',creditCost:null}))}})).status,200);
 const options=(await f.request('/api/payments/options',{cookie:''})).value;
 assert.equal(options.channels.find(channel=>channel.provider==='wechat').ready,true);assert.equal(options.enabled,false);
 assert.equal(options.products.length,3);assert.ok(options.products.every(product=>product.purchasable===false&&product.unavailableCode==='credit_pricing_missing'));
 const result=await f.create({productId:'credits-200'});assert.equal(result.status,409);assert.match(result.value.error,/尚未配置按积分计费/);
 assert.equal((await f.create({productId:'credits-200',priceCents:1})).status,400);
 const disabled=await f.create({productId:'credits-200',provider:'alipay'});assert.equal(disabled.status,503);assert.equal(disabled.value.error,'所选支付渠道尚未开通');
 assert.equal((await f.create({productId:'not-a-published-product'})).status,409);
 await f.channel('wechat',{enabled:false});assert.equal((await f.create({productId:'credits-200'})).status,503);
 assert.equal(f.count('orders'),0);assert.equal(f.count('payment_orders'),0);assert.equal(f.created.length,0);
});

test('priced services that lose their model connection block credit sales distinctly and recover without changing prices',async t=>{
 let online=false;
 const f=await fixture(t,{config:{getAI:()=>online?{aiURL:'https://model.example.invalid/v1/chat',aiKey:'test-only',aiModel:'test-model'}:{}}});
 await f.channel();
 const blocked=(await f.request('/api/payments/options',{cookie:''})).value;
 assert.equal(blocked.enabled,false);assert.ok(blocked.products.every(product=>product.purchasable===false&&product.unavailableCode==='credit_services_unavailable'));
 const denied=await f.create({productId:'credits-500'});assert.equal(denied.status,409);assert.match(denied.value.error,/已配置的积分消费服务当前不可用/);assert.equal(f.count('orders'),0);assert.equal(f.created.length,0);
 online=true;
 const restored=(await f.request('/api/payments/options',{cookie:''})).value;assert.equal(restored.enabled,true);assert.ok(restored.products.every(product=>product.purchasable===true&&!Object.hasOwn(product,'unavailableCode')));
 assert.deepEqual(restored.products.map(({id,priceCents,creditAmount})=>({id,priceCents,creditAmount})),blocked.products.map(({id,priceCents,creditAmount})=>({id,priceCents,creditAmount})));
 const order=await f.create({productId:'credits-500'});assert.equal(order.status,201);assert.equal(order.value.item.amountCents,5000);assert.equal(order.value.item.creditAmount,500);assert.equal(f.created.length,1);
});

test('delivery shutdown rejects new sales but preserves the exact existing idempotent order and its verified settlement',async t=>{
 const f=await fixture(t);await f.ready();
 const key='credit-order-before-free-policy',first=await f.create({productId:'credits-200',idempotencyKey:key});assert.equal(first.status,201);
 const state=(await f.request('/api/admin/payments',{cookie:f.admin.cookie})).value;
 await f.request('/api/admin/billing',{cookie:f.admin.cookie,data:{version:state.billing.version,services:billingServiceTypes.map(({key})=>({key,mode:'free',creditCost:null}))}});
 assert.equal((await f.create({productId:'credits-200'})).status,409);
 const retry=await f.create({productId:'credits-200',idempotencyKey:key});assert.equal(retry.status,201);assert.equal(retry.value.item.id,first.value.item.id);
 assert.equal((await f.create({productId:'credits-500',idempotencyKey:key})).status,409);assert.equal(f.created.length,1);assert.equal(f.count('orders'),1);
 const member=(await f.request('/api/admin/payments',{cookie:f.admin.cookie})).value.catalog.find(product=>product.id==='basic');assert.equal(member.purchasable,false);assert.equal(member.unavailableCode,'entitlement_services_unavailable');
 assert.equal((await f.notify(first.value.item)).status,204);
 const account=(await f.request('/api/payments/entitlements')).value;assert.equal(account.credits.balance,200);assert.equal(account.credits.ledger.length,1);
});

test('admin payment configuration requires persisted administrator role and same-origin POST',async t=>{
 const f=await fixture(t);for(const path of ['/api/admin/payments','/api/admin/payments/wechat/check']){assert.equal((await f.request(path,{cookie:''})).status,401);assert.equal((await f.request(path,{cookie:f.user.cookie})).status,403);}const data={enabled:false};for(const origin of ['', 'https://attacker.example.invalid'])assert.equal((await f.request('/api/admin/payments/wechat',{cookie:f.admin.cookie,origin,data})).status,403);assert.equal((await f.request('/api/admin/payments/products/basic',{cookie:f.admin.cookie,data:product,origin:''})).status,403);assert.equal(f.count('payment_config_versions'),0);assert.equal(f.count('admin_audit'),0);assert.equal((await f.request('/api/admin/payments',{cookie:f.admin.cookie})).status,200);
});

test('server encryption key is mandatory before retaining merchant credentials',async t=>{
 const f=await fixture(t,{config:{paymentConfigKey:''}});const result=await f.channel();assert.equal(result.status,503);assert.equal(f.count('payment_config_versions'),0);const state=await f.request('/api/admin/payments',{cookie:f.admin.cookie});assert.equal(state.value.encryptionReady,false);assert.equal(state.value.channels.some(item=>item.ready),false);
});

test('merchant secrets are encrypted, never echoed or audited, and blank updates preserve them',async t=>{
 const f=await fixture(t);const saved=await f.channel();assert.equal(saved.status,200);assert.equal(saved.value.ready,true);assert.equal(saved.value.secretFields.privateKey,true);assert.equal(saved.value.secretFields.apiV3Key,true);for(const value of [rsa.privateKey,wechat.apiV3Key,rsa.publicKey])assert.equal(saved.text.includes(value),false);const row=f.db.prepare('SELECT sealed_settings FROM payment_config_versions').get();for(const value of [rsa.privateKey,wechat.apiV3Key,rsa.publicKey])assert.equal(row.sealed_settings.includes(value),false);const audit=JSON.stringify(f.db.prepare('SELECT * FROM admin_audit').all());assert.equal(audit.includes(wechat.apiV3Key),false);assert.equal(audit.includes('BEGIN PRIVATE KEY'),false);
 assert.equal((await f.request('/api/admin/payments/wechat',{cookie:f.admin.cookie,data:{enabled:true,privateKey:'',apiV3Key:'',platformPublicKey:''}})).value.ready,true);await f.publish();const order=await f.create();assert.equal(order.status,201);assert.equal(f.created[0].settings.apiV3Key,wechat.apiV3Key);assert.equal(f.created[0].settings.privateKey,rsa.privateKey.trim());const summary=await f.request('/api/admin/payments',{cookie:f.admin.cookie});assert.equal(summary.text.includes(wechat.apiV3Key),false);assert.equal(summary.text.includes('BEGIN PRIVATE KEY'),false);
});

test('explicit clearing disables a channel until the missing secret is supplied again',async t=>{
 const f=await fixture(t);await f.ready();const cleared=await f.request('/api/admin/payments/wechat',{cookie:f.admin.cookie,data:{enabled:false,clearSecrets:['apiV3Key']}});assert.equal(cleared.status,200);assert.equal(cleared.value.secretFields.apiV3Key,false);assert.equal(cleared.value.ready,false);assert.equal((await f.request('/api/admin/payments/wechat',{cookie:f.admin.cookie,data:{enabled:true}})).status,400);assert.equal((await f.create()).status,503);assert.equal(f.count('orders'),0);assert.equal((await f.channel()).value.ready,true);
});

test('public catalogue contains approved credit tiers and only fully priced published memberships',async t=>{
 const f=await fixture(t);await f.channel();const initial=await f.request('/api/payments/options',{cookie:''});assert.equal(initial.value.products.length,3);assert.ok(initial.value.products.every(item=>item.entitlementType==='credits'));assert.equal(initial.value.enabled,true);for(const fields of [{priceCents:3.21},{priceCents:'321'},{priceCents:0},{priceCents:-1},{durationDays:0},{description:''}])assert.equal((await f.publish('basic',fields)).status,400);assert.equal(f.count('orders'),0);assert.equal((await f.publish()).status,200);const options=(await f.request('/api/payments/options',{cookie:''})).value;assert.equal(options.enabled,true);assert.equal(options.products.length,4);const membership=options.products.find(item=>item.id==='basic');assert.equal(membership.priceCents,321);assert.equal(membership.entitlement.durationDays,7);assert.equal(JSON.stringify(options).includes(wechat.apiV3Key),false);assert.equal((await f.publish('no-such-product')).status,404);
});

test('public payment options expose scoped service prices without runtime or merchant settings',async t=>{
 const f=await fixture(t);await f.channel();
 const response=await f.request('/api/payments/options',{cookie:''});
 assert.equal(response.status,200);assert.equal(response.value.toolBilling.services.length,32);assert.deepEqual(response.value.toolBilling.services.map(service=>service.key),toolBillingServiceTypes.map(service=>service.key));assert.equal(new Set(response.value.toolBilling.services.map(service=>service.key)).size,32);
 for(const service of response.value.toolBilling.services){
  assert.deepEqual(Object.keys(service).sort(),['available','creditCost','effectiveCreditCost','effectiveMode','group','key','mode','title']);
 }
 for(const secret of [rsa.privateKey,wechat.apiV3Key,'payment-fixture-only-no-network','test-model','billing-fixture.example.invalid'])assert.equal(response.text.includes(secret),false);
 assert.equal(f.count('orders'),0);
});

test('server fixes the exact cents and rejects client price, currency, quantity or entitlement overrides',async t=>{
 const f=await fixture(t);await f.ready();for(const extra of [{amountCents:1},{priceCents:1},{amount:0.01},{currency:'USD'},{quantity:3},{entitlement:{durationDays:999}}])assert.equal((await f.create(extra)).status,400);assert.equal(f.count('orders'),0);const response=await f.create();assert.equal(response.status,201);assert.equal(response.value.item.amountCents,321);assert.equal(response.value.item.currency,'CNY');assert.equal(f.created[0].input.amountCents,321);assert.equal(f.created[0].input.notifyUrl,'https://paperknow.cn/api/payments/notify/wechat');assert.equal(f.db.prepare('SELECT amount_cents FROM payment_orders').get().amount_cents,321);
});

test('order creation is idempotent and reusing a key for another provider or product conflicts',async t=>{
 const f=await fixture(t);await f.ready();await f.channel('alipay');await f.publish('advanced');const input={idempotencyKey:'same-order-key-2026'};const [first,second]=await Promise.all([f.create(input),f.create(input)]);assert.equal(first.status,201);assert.equal(second.status,201);assert.equal(first.value.item.id,second.value.item.id);assert.equal(f.count('orders'),1);assert.equal(f.created.length,1);assert.equal((await f.create({...input,provider:'alipay'})).status,409);assert.equal((await f.create({...input,productId:'advanced'})).status,409);assert.equal(f.count('orders'),1);assert.equal((await f.create({...input,cookie:f.other.cookie})).status,201);assert.equal(f.count('orders'),2);
});

test('an existing idempotent order remains retrievable when a channel is temporarily disabled',async t=>{
 const f=await fixture(t);await f.ready();const key='order-before-disabled-channel',first=await f.create({idempotencyKey:key});assert.equal(first.status,201);assert.equal((await f.channel('wechat',{enabled:false})).status,200);assert.equal((await f.create({idempotencyKey:key})).value.item.id,first.value.item.id);assert.equal((await f.create()).status,503);assert.equal(f.count('orders'),1);assert.equal(f.created.length,1);
});

test('an unconfirmed create timeout retains a queryable pending order and never assumes failure or payment',async t=>{
 const f=await fixture(t,{adapters:{create:async()=>{throw new Error('provider timed out after accepting the request');}}});await f.ready();const first=await f.create({idempotencyKey:'unconfirmed-channel-create'});assert.equal(first.status,201);assert.equal(first.value.item.status,'pending');assert.equal(first.value.item.qrContent,null);assert.equal(f.count('payment_entitlements'),0);const retry=await f.create({idempotencyKey:'unconfirmed-channel-create'});assert.equal(retry.value.item.id,first.value.item.id);assert.equal(f.created.length,1);const entry=f.orderEntry(first.value.item);entry.state='paid';const checked=await f.request('/api/orders/'+first.value.item.id+'/query',{data:{}});assert.equal(checked.status,200);assert.equal(checked.value.item.status,'paid');assert.equal(f.count('payment_entitlements'),1);
});

test('orders and entitlements remain private to their owning account',async t=>{
 const f=await fixture(t);await f.ready();const item=(await f.create()).value.item;assert.equal((await f.request('/api/orders/'+item.id,{cookie:''})).status,401);assert.equal((await f.request('/api/orders/'+item.id,{cookie:f.other.cookie})).status,404);assert.equal((await f.request('/api/orders/'+item.id+'/query',{cookie:f.other.cookie,data:{}})).status,404);assert.equal((await f.request('/api/orders',{cookie:f.other.cookie})).value.items.length,0);assert.equal((await f.request('/api/orders')).value.items[0].id,item.id);assert.equal((await f.notify(item)).status,204);assert.deepEqual((await f.request('/api/payments/entitlements',{cookie:f.other.cookie})).value,{items:[],credits:{balance:0,held:0,available:0,ledger:[]},bundles:[],billing:{reservations:[],membershipUsage:{},bundleUsage:{}}});assert.equal((await f.request('/api/payments/entitlements')).value.items.length,1);assert.equal(f.queried.length,0);
});

test('verified server notifications need no session or Origin and return the provider acknowledgement format',async t=>{
 const f=await fixture(t);await f.ready();await f.channel('alipay');const wx=(await f.create()).value.item,ali=(await f.create({provider:'alipay'})).value.item;assert.equal((await f.notify(wx,{sign:'not-the-provider-signature'})).status,400);assert.equal(f.count('payment_entitlements'),0);const wxAck=await f.notify(wx);assert.equal(wxAck.status,204);assert.equal(wxAck.text,'');const aliAck=await f.notify(ali);assert.equal(aliAck.status,200);assert.equal(aliAck.text,'success');assert.equal(f.count('payment_entitlements'),2);assert.equal((await f.request('/api/orders/'+wx.id)).value.item.status,'paid');assert.equal((await f.request('/api/orders/'+ali.id)).value.item.status,'paid');
});

test('wrong amount, currency, application, merchant or transaction ID cannot grant paid access',async t=>{
 const f=await fixture(t);await f.ready();const item=(await f.create()).value.item,good=f.paidResult(f.orderEntry(item));for(const mutation of [{amountCents:320},{amountCents:3.21},{currency:'USD'},{appId:'wxnot-the-order-app'},{merchantId:'9999999999'},{providerTradeNo:''},{outTradeNo:'not-an-existing-order'},{paidAt:new Date(Date.now()+86400000).toISOString()}]){const response=await f.notify(item,{result:{...good,...mutation}});assert.ok(response.status>=400);assert.equal(f.count('payment_entitlements'),0);assert.equal((await f.request('/api/orders/'+item.id)).value.item.status,'pending');}assert.equal((await f.notify(item,{result:good})).status,204);assert.equal(f.count('payment_entitlements'),1);
});

test('duplicate callbacks and an in-flight provider query grant an order exactly once',async t=>{
 let resolveQuery;const f=await fixture(t,{adapters:{query:async()=>new Promise(resolve=>resolveQuery=resolve)}});await f.ready();const item=(await f.create()).value.item,good=f.paidResult(f.orderEntry(item));const queryPromise=f.request('/api/orders/'+item.id+'/query',{data:{}});for(let i=0;i<100&&!resolveQuery;i++)await new Promise(resolve=>setTimeout(resolve,2));assert.ok(resolveQuery);const results=await Promise.all(Array.from({length:5},()=>f.notify(item,{result:good})));assert.ok(results.every(result=>result.status===204));resolveQuery(good);assert.equal((await queryPromise).value.item.status,'paid');assert.equal(f.count('payment_entitlements'),1);assert.equal(f.db.prepare('SELECT count(*) AS n FROM orders WHERE status=?').get('paid').n,1);assert.equal((await f.notify(item,{result:{...good,providerTradeNo:'a-different-transaction'}})).status,400);assert.equal(f.count('payment_entitlements'),1);
});

test('editing a product never changes an existing order amount, title or fulfilled duration snapshot',async t=>{
 const f=await fixture(t);await f.ready();const item=(await f.create()).value.item;assert.equal((await f.publish('basic',{priceCents:999,title:'修改后的商品',durationDays:30,description:'新商品的 30 天权益。'})).status,200);const stored=(await f.request('/api/orders/'+item.id)).value.item;assert.equal(stored.amountCents,321);assert.equal(stored.title,product.title);assert.equal((await f.notify(item,{result:f.paidResult(f.orderEntry(item),{amountCents:999})})).status,400);assert.equal((await f.notify(item)).status,204);const entitlement=f.db.prepare('SELECT * FROM payment_entitlements WHERE order_id=?').get(item.id);assert.equal(Date.parse(entitlement.expires_at)-Date.parse(entitlement.starts_at),7*86400000);const publicEntitlement=(await f.request('/api/payments/entitlements')).value.items[0];assert.equal(publicEntitlement.title,product.title);assert.equal(publicEntitlement.description,product.description);assert.equal(publicEntitlement.order_id,item.id);assert.deepEqual(publicEntitlement.membershipItems,product.membershipItems);assert.deepEqual(publicEntitlement.usage,product.membershipItems.map(service=>({...service,held:0,used:0,remaining:service.quantity})));for(const field of ['entitlement','config','config_id','sealed_settings','privateKey','apiV3Key'])assert.equal(field in publicEntitlement,false);const newItem=(await f.create()).value.item;assert.equal(newItem.amountCents,999);assert.equal(newItem.title,'修改后的商品');
});

test('same-merchant credential rotation keeps old orders payable with current verified credentials',async t=>{
 const f=await fixture(t);await f.ready();const item=(await f.create()).value.item,oldVersion=f.db.prepare('SELECT config_id FROM payment_orders WHERE order_id=?').get(item.id).config_id;const rotated={...wechat,apiV3Key:'b'.repeat(32),merchantSerial:'ABCDEF1234567890ABCDEF1234567890'};assert.equal((await f.channel('wechat',rotated)).status,200);assert.notEqual(f.db.prepare('SELECT version_id FROM payment_channels WHERE provider=?').get('wechat').version_id,oldVersion);assert.equal((await f.notify(item,{settings:rotated})).status,204);assert.equal((await f.request('/api/orders/'+item.id)).value.item.status,'paid');assert.equal(f.count('payment_entitlements'),1);assert.equal(f.db.prepare('SELECT config_id FROM payment_orders WHERE order_id=?').get(item.id).config_id,oldVersion);
});

test('queries prefer current credentials after a same-merchant key rotation while retaining the old snapshot',async t=>{
 let activeKey=wechat.apiV3Key,reply;const f=await fixture(t,{adapters:{query:async(provider,settings)=>{if(settings.apiV3Key!==activeKey)throw new Error('old merchant key was revoked');return reply;}}});await f.ready();const item=(await f.create()).value.item;activeKey='d'.repeat(32);assert.equal((await f.channel('wechat',{apiV3Key:activeKey})).status,200);reply=f.paidResult(f.orderEntry(item));const result=await f.request('/api/orders/'+item.id+'/query',{data:{}});assert.equal(result.status,200);assert.equal(result.value.item.status,'paid');assert.equal(f.queried[0].settings.apiV3Key,activeKey);assert.equal(f.count('payment_entitlements'),1);
});

test('merchant A orders accept an unused A v2 credential after the active configuration switches to merchant B',async t=>{
 const f=await fixture(t);await f.ready();const item=(await f.create()).value.item;
 const originalVersion=f.db.prepare('SELECT config_id FROM payment_orders WHERE order_id=?').get(item.id).config_id;
 const aV2={...wechat,apiV3Key:'e'.repeat(32),merchantSerial:'11112222333344445555666677778888',platformPublicKeyId:'PUB_KEY_ID_2222222222'};
 assert.equal((await f.channel('wechat',aV2)).status,200);
 const intermediateVersion=f.db.prepare('SELECT version_id FROM payment_channels WHERE provider=?').get('wechat').version_id;
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM payment_orders WHERE config_id=?').get(intermediateVersion).n,0,'A v2 must remain unused by any newly created order');
 const bV3={...wechat,appId:'wxabcdef1234567890',merchantId:'9988776655',apiV3Key:'f'.repeat(32),merchantSerial:'99998888777766665555444433332222',platformPublicKeyId:'PUB_KEY_ID_3333333333'};
 assert.equal((await f.channel('wechat',bV3)).status,200);
 const activeVersion=f.db.prepare('SELECT version_id FROM payment_channels WHERE provider=?').get('wechat').version_id;
 assert.notEqual(activeVersion,originalVersion);assert.notEqual(activeVersion,intermediateVersion);assert.equal(f.count('orders'),1);
 const ack=await f.notify(item,{settings:aV2});assert.equal(ack.status,204);assert.equal((await f.request('/api/orders/'+item.id)).value.item.status,'paid');
 assert.ok(f.verified.some(call=>call.settings.apiV3Key===aV2.apiV3Key));assert.equal(f.count('payment_entitlements'),1);assert.equal(f.db.prepare('SELECT config_id FROM payment_orders WHERE order_id=?').get(item.id).config_id,originalVersion);
});

test('merchant A queries use its unused A v2 credential after merchant B becomes active and A v1 is revoked',async t=>{
 let reply;const aV2Key='g'.repeat(32);
 const f=await fixture(t,{adapters:{query:async(provider,settings)=>{if(settings.apiV3Key!==aV2Key)throw new Error('A v1 was revoked and merchant B cannot query merchant A');return reply;}}});
 await f.ready();const item=(await f.create()).value.item,originalVersion=f.db.prepare('SELECT config_id FROM payment_orders WHERE order_id=?').get(item.id).config_id;
 assert.equal((await f.channel('wechat',{apiV3Key:aV2Key,merchantSerial:'22223333444455556666777788889999'})).status,200);
 const intermediateVersion=f.db.prepare('SELECT version_id FROM payment_channels WHERE provider=?').get('wechat').version_id;
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM payment_orders WHERE config_id=?').get(intermediateVersion).n,0);
 assert.equal((await f.channel('wechat',{...wechat,appId:'wxabcdef1234567890',merchantId:'9988776655',apiV3Key:'h'.repeat(32),platformPublicKeyId:'PUB_KEY_ID_4444444444'})).status,200);
 reply=f.paidResult(f.orderEntry(item));const checked=await f.request('/api/orders/'+item.id+'/query',{data:{}});
 assert.equal(checked.status,200);assert.equal(checked.value.item.status,'paid');assert.equal(f.queried[0].settings.apiV3Key,aV2Key);assert.equal(f.queried[0].settings.merchantId,wechat.merchantId);assert.equal(f.count('orders'),1);assert.equal(f.count('payment_entitlements'),1);assert.equal(f.db.prepare('SELECT config_id FROM payment_orders WHERE order_id=?').get(item.id).config_id,originalVersion);
});

test('an incomplete latest draft does not hide the previous complete same-merchant credentials',async t=>{
 let reply;const v2Key='i'.repeat(32);const f=await fixture(t,{adapters:{query:async(provider,settings)=>{if(settings.apiV3Key!==v2Key)throw new Error('revoked original key');return reply;}}});
 await f.ready();const item=(await f.create()).value.item;assert.equal((await f.channel('wechat',{apiV3Key:v2Key})).status,200);
 const draft=await f.request('/api/admin/payments/wechat',{cookie:f.admin.cookie,data:{enabled:false,clearSecrets:['privateKey']}});assert.equal(draft.status,200);assert.equal(draft.value.configured,false);assert.equal(draft.value.secretFields.privateKey,false);
 reply=f.paidResult(f.orderEntry(item));const checked=await f.request('/api/orders/'+item.id+'/query',{data:{}});assert.equal(checked.status,200);assert.equal(checked.value.item.status,'paid');assert.equal(f.queried[0].settings.apiV3Key,v2Key);assert.equal(f.queried[0].options.timeoutMs,6000);assert.equal(f.count('payment_entitlements'),1);
});

test('historical credential fallback is bounded and never sends an order to another merchant identity',async t=>{
 const f=await fixture(t,{adapters:{query:async()=>{throw new Error('temporary provider query failure');}}});await f.ready();const item=(await f.create()).value.item;
 for(const value of ['j','k','l'])assert.equal((await f.channel('wechat',{apiV3Key:value.repeat(32)})).status,200);
 assert.equal((await f.channel('wechat',{...wechat,merchantId:'9988776655',appId:'wxabcdef1234567890',apiV3Key:'m'.repeat(32)})).status,200);
 const checked=await f.request('/api/orders/'+item.id+'/query',{data:{}});assert.equal(checked.status,502);assert.equal(f.queried.length,3);assert.deepEqual(f.queried.map(call=>call.settings.apiV3Key),['l'.repeat(32),'k'.repeat(32),wechat.apiV3Key]);assert.ok(f.queried.every(call=>call.settings.merchantId===wechat.merchantId&&call.settings.appId===wechat.appId&&call.options.timeoutMs===6000));assert.equal(f.count('payment_entitlements'),0);assert.equal((await f.request('/api/orders/'+item.id)).value.item.status,'pending');
});

test('an expiry removes the QR but a subsequently verified payment can still settle the original order once',async t=>{
 const f=await fixture(t);await f.ready();const item=(await f.create()).value.item;f.db.prepare('UPDATE payment_orders SET expires_at=? WHERE order_id=?').run(new Date(Date.now()-60000).toISOString(),item.id);const expired=await f.request('/api/orders/'+item.id);assert.equal(expired.value.item.status,'expired');assert.equal(expired.value.item.qrContent,null);assert.equal(f.count('payment_entitlements'),0);assert.equal((await f.notify(item)).status,204);assert.equal((await f.request('/api/orders/'+item.id)).value.item.status,'paid');assert.equal(f.count('payment_entitlements'),1);
});

test('a different merchant configuration cannot authorize an old merchant order',async t=>{
 const f=await fixture(t);await f.ready();const item=(await f.create()).value.item;const replacement={...wechat,merchantId:'9988776655',appId:'wxabcdef1234567890',apiV3Key:'c'.repeat(32)};assert.equal((await f.channel('wechat',replacement)).status,200);const forged=f.paidResult(f.orderEntry(item),{merchantId:replacement.merchantId,appId:replacement.appId});assert.ok((await f.notify(item,{settings:replacement,result:forged})).status>=400);assert.equal(f.count('payment_entitlements'),0);assert.equal((await f.notify(item,{settings:wechat})).status,204);assert.equal(f.count('payment_entitlements'),1);
});

test('five-column historical orders remain readable without inventing price, QR or payment records',async t=>{
 const f=await fixture(t);const createdAt=new Date().toISOString();assert.equal(f.db.prepare('PRAGMA table_info(orders)').all().length,5);f.db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run('historical-order',f.user.id,'basic','pending',createdAt);const list=await f.request('/api/orders');assert.equal(list.status,200);assert.equal(list.value.items.length,1);assert.equal(list.value.items[0].amountCents,null);assert.equal(list.value.items[0].qrContent,null);assert.equal(list.value.items[0].provider,null);const query=await f.request('/api/orders/historical-order/query',{data:{}});assert.equal(query.status,200);assert.equal(query.value.item.id,'historical-order');assert.equal(f.queried.length,0);assert.equal(f.count('payment_orders'),0);assert.equal(f.count('payment_entitlements'),0);const admin=await f.request('/api/admin/orders',{cookie:f.admin.cookie});assert.equal(admin.status,200);assert.equal(admin.value.items[0].amount_cents,null);
});

test('notification content types and body limits are enforced before channel processing',async t=>{
 const f=await fixture(t);await f.ready();await f.channel('alipay');const item=(await f.create()).value.item;assert.equal((await f.notify(item,{contentType:'text/plain'})).status,415);const tooLarge=await fetch(f.base+'/api/payments/notify/wechat',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(262145)});assert.equal(tooLarge.status,413);const wrongAli=await fetch(f.base+'/api/payments/notify/alipay',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(wrongAli.status,415);assert.equal(f.verified.length,0);assert.equal(f.count('payment_entitlements'),0);
});

test('administrator credit edits persist explicit units and auditable quantity without creating a charge',async t=>{
 const f=await fixture(t);
 const saved=await f.request('/api/admin/payments/products/credits-200',{cookie:f.admin.cookie,data:{title:'250 科研积分',description:'250 积分充值；消费待开放。',priceCents:2500,durationDays:null,entitlementType:'credits',creditAmount:250,status:'active'}});
 assert.equal(saved.status,200);assert.equal(saved.value.item.entitlementType,'credits');assert.equal(saved.value.item.creditAmount,250);assert.equal(saved.value.item.durationDays,null);
 const catalogue=(await f.request('/api/payments/options',{cookie:''})).value;
 assert.equal(catalogue.products.find(p=>p.id==='credits-200').priceCents,2500);
 const row=f.db.prepare("SELECT detail FROM admin_audit WHERE action='payment.product.update' AND target_id='credits-200'").get();
 const detail=JSON.parse(row.detail);assert.equal(detail.entitlementType,'credits');assert.equal(detail.creditAmount,250);assert.equal(detail.priceCents,2500);
 assert.equal(f.count('orders'),0);assert.equal(f.count('payment_credit_ledger'),0);
});

test('free service policy pauses selling credits and membership rather than collecting payment without a consumable service',async t=>{
 const f=await fixture(t);await f.channel();const current=(await f.request('/api/billing/rules')).value;
 assert.equal((await f.request('/api/admin/billing',{cookie:f.admin.cookie,data:{version:current.version,services:billingServiceTypes.map(({key})=>({key,mode:'free',creditCost:null}))}})).status,200);
 assert.equal((await f.publish()).status,409);const options=(await f.request('/api/payments/options',{cookie:''})).value;assert.ok(options.products.every(item=>item.purchasable===false));assert.equal((await f.create({productId:'credits-200'})).status,409);assert.equal(f.count('orders'),0);assert.equal(f.created.length,0);
});

test('unconfigured AI rejects new membership publication and credit payments even when merchant settings are valid',async t=>{
 const f=await fixture(t,{config:{getAI:()=>({aiEnabled:false})}});assert.equal((await f.channel()).status,200);assert.equal((await f.publish()).status,409);assert.equal((await f.create({productId:'credits-200'})).status,409);assert.ok((await f.request('/api/payments/options',{cookie:''})).value.products.every(item=>item.purchasable===false));assert.equal(f.count('orders'),0);assert.equal(f.created.length,0);
});

test('Alipay page orders persist one fixed handoff, retain idempotency and keep the signed link private to the owner',async t=>{
 const f=await fixture(t);await f.ready('alipay');
 for(const field of ['paymentUrl','returnUrl','notifyUrl','appId','sellerId'])assert.equal((await f.create({provider:'alipay',[field]:'https://evil.example.invalid'})).status,400);
 const key='alipay-page-stable-idempotency',created=await f.create({provider:'alipay',productId:'credits-200',idempotencyKey:key});assert.equal(created.status,201);
 const item=created.value.item,entry=f.created[0];assert.equal(item.qrContent,null);assert.equal(item.status,'pending');assert.equal(item.creditAmount,200);assert.equal(item.amountCents,2000);
 assert.equal(entry.input.returnUrl,'https://paperknow.cn/api/payments/return/alipay?order='+item.id);assert.equal(entry.input.notifyUrl,'https://paperknow.cn/api/payments/notify/alipay');
 assert.ok(validateAlipayPaymentURL(item.paymentUrl,{...entry.input,appId:alipay.appId,sellerId:alipay.sellerId}));
 assert.equal(f.db.prepare('SELECT payment_url FROM payment_orders WHERE order_id=?').get(item.id).payment_url,item.paymentUrl);
 const retried=await f.create({provider:'alipay',productId:'credits-200',idempotencyKey:key});assert.deepEqual(retried.value.item,item);assert.equal(f.created.length,1);assert.equal(f.count('orders'),1);
 assert.equal((await f.request('/api/orders/'+item.id,{cookie:f.other.cookie})).status,404);assert.equal((await f.request('/api/orders/'+item.id,{cookie:''})).status,401);
 assert.equal((await f.request('/api/orders/'+item.id+'/query',{cookie:f.other.cookie,data:{}})).status,404);assert.equal((await f.request('/api/orders',{cookie:f.other.cookie})).value.items.length,0);
 assert.equal(f.count('payment_credit_ledger'),0);
 await f.channel('alipay',{enabled:false});const disabledRetry=await f.create({provider:'alipay',productId:'credits-200',idempotencyKey:key});assert.equal(disabledRetry.value.item.paymentUrl,item.paymentUrl);assert.equal((await f.create({provider:'alipay',productId:'credits-200'})).status,503);
 assert.equal((await f.notify(item)).status,200);assert.equal((await f.notify(item)).status,200);
 const paid=(await f.request('/api/orders/'+item.id)).value.item;assert.equal(paid.status,'paid');assert.equal(paid.paymentUrl,null);assert.equal(paid.qrContent,null);assert.equal((await f.request('/api/payments/entitlements')).value.credits.balance,200);assert.equal(f.count('payment_credit_ledger'),1);
});

test('unsafe or mismatched Alipay handoffs are never stored, even when the hostname alone looks official',async t=>{
 const mutations=[
  value=>'https://evil.example.invalid/?url='+encodeURIComponent(value),
  value=>value.replace('https://openapi.alipay.com/','https://openapi.alipay.com.evil.example.invalid/'),
  value=>value.replace('https://openapi.alipay.com/','https://evil.example.invalid@openapi.alipay.com/'),
  value=>{const url=new URL(value);url.searchParams.set('return_url','https://evil.example.invalid/');return url.href;},
  value=>{const url=new URL(value);url.searchParams.set('notify_url','https://evil.example.invalid/');return url.href;},
  value=>{const url=new URL(value),biz=JSON.parse(url.searchParams.get('biz_content'));biz.total_amount='0.01';url.searchParams.set('biz_content',JSON.stringify(biz));return url.href;},
  value=>{const url=new URL(value),biz=JSON.parse(url.searchParams.get('biz_content'));biz.out_trade_no='different-order';url.searchParams.set('biz_content',JSON.stringify(biz));return url.href;},
  value=>{const url=new URL(value);url.searchParams.set('app_id','2026999912345678');return url.href;},
  value=>{const url=new URL(value),biz=JSON.parse(url.searchParams.get('biz_content'));biz.seller_id='2088999912345678';url.searchParams.set('biz_content',JSON.stringify(biz));return url.href;},
  value=>{const url=new URL(value),biz=JSON.parse(url.searchParams.get('biz_content'));biz.subject='different title';url.searchParams.set('biz_content',JSON.stringify(biz));return url.href;},
  value=>{const url=new URL(value),biz=JSON.parse(url.searchParams.get('biz_content'));biz.time_expire='2030-01-01 00:00:00';url.searchParams.set('biz_content',JSON.stringify(biz));return url.href;},
  value=>value+'&method=alipay.trade.page.pay'
 ];
 const f=await fixture(t,{adapters:{create:async(provider,settings,input)=>{
  const result=await createProviderPayment(provider,settings,input);return {...result,paymentUrl:mutations[index](result.paymentUrl)};
 }}});let index=0;await f.ready('alipay');
 for(index=0;index<mutations.length;index++){
  const result=await f.create({provider:'alipay'});assert.equal(result.status,201);assert.equal(result.value.item.status,'pending');assert.equal(result.value.item.paymentUrl,null);assert.equal(result.value.item.qrContent,null);
  assert.equal(f.db.prepare('SELECT payment_url,error_code FROM payment_orders WHERE order_id=?').get(result.value.item.id).payment_url,null);
  assert.equal(f.count('payment_entitlements'),0);assert.equal(f.count('payment_credit_ledger'),0);
  f.db.prepare("UPDATE orders SET status='expired' WHERE id=?").run(result.value.item.id);
 }
});

test('Alipay saved handoffs are checked against the frozen identity, amount and expiry whenever read',async t=>{
 const f=await fixture(t);await f.ready('alipay');const key='alipay-expired-idempotent-order',item=(await f.create({provider:'alipay',idempotencyKey:key})).value.item;
 await f.channel('alipay',{appId:'2026999912345678',sellerId:'2088999912345678'});
 assert.equal((await f.request('/api/orders/'+item.id)).value.item.paymentUrl,item.paymentUrl,'switching current merchant must not replace the old merchant identity');
 for(const mutate of [
  url=>url.searchParams.set('app_id','2026999912345678'),
  url=>{const biz=JSON.parse(url.searchParams.get('biz_content'));biz.total_amount='9.99';url.searchParams.set('biz_content',JSON.stringify(biz));},
  url=>url.searchParams.set('return_url','https://paperknow.cn/api/payments/return/alipay?order=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  url=>{const biz=JSON.parse(url.searchParams.get('biz_content'));biz.time_expire='2030-01-01 00:00:00';url.searchParams.set('biz_content',JSON.stringify(biz));}
 ]){
  const url=new URL(item.paymentUrl);mutate(url);f.db.prepare('UPDATE payment_orders SET payment_url=? WHERE order_id=?').run(url.href,item.id);
  assert.equal((await f.request('/api/orders/'+item.id)).value.item.paymentUrl,null);assert.equal((await f.request('/api/orders')).value.items[0].paymentUrl,null);
 }
 f.db.prepare('UPDATE payment_orders SET payment_url=? WHERE order_id=?').run(item.paymentUrl,item.id);
 f.db.prepare('UPDATE payment_orders SET expires_at=? WHERE order_id=?').run(new Date(Date.now()-1000).toISOString(),item.id);
 const retry=(await f.create({provider:'alipay',idempotencyKey:key})).value.item;
 assert.equal(retry.id,item.id);assert.equal(retry.status,'expired');assert.equal(retry.paymentUrl,null);assert.equal(f.created.length,1);assert.equal(f.count('payment_entitlements'),0);
});

test('a verified missing page-pay trade stays pending until opening the cashier, while legacy QR query failures stay visible',async t=>{
 let failure=true;
 const f=await fixture(t,{adapters:{query:async(provider,settings,input)=>{
  if(failure)throw Object.assign(new Error('verified provider business response'),{code:'payment_trade_not_exist'});
  return f.paidResult(f.remote.get(input.outTradeNo));
 }}});await f.ready('alipay');
 const page=(await f.create({provider:'alipay',productId:'credits-200'})).value.item;
 const checked=await f.request('/api/orders/'+page.id+'/query',{data:{}});assert.equal(checked.status,200);assert.equal(checked.value.item.status,'pending');assert.equal(checked.value.item.paymentUrl,page.paymentUrl);assert.equal(f.count('payment_credit_ledger'),0);
 f.db.prepare('UPDATE payment_orders SET payment_url=NULL,qr_content=?,last_queried_at=0 WHERE order_id=?').run('https://qr.alipay.com/historical-order',page.id);
 const historical=(await f.request('/api/orders/'+page.id)).value.item;assert.equal(historical.paymentUrl,null);assert.equal(historical.qrContent,'https://qr.alipay.com/historical-order');
 assert.equal((await f.request('/api/orders/'+page.id+'/query',{data:{}})).status,502);assert.equal(f.count('payment_credit_ledger'),0);
 failure=false;f.db.prepare('UPDATE payment_orders SET last_queried_at=0 WHERE order_id=?').run(page.id);
 const settled=await f.request('/api/orders/'+page.id+'/query',{data:{}});assert.equal(settled.status,200);assert.equal(settled.value.item.status,'paid');assert.equal(settled.value.item.paymentUrl,null);assert.equal(settled.value.item.qrContent,null);assert.equal((await f.request('/api/payments/entitlements')).value.credits.balance,200);assert.equal(f.count('payment_credit_ledger'),1);
});

test('Alipay exposes a stable official QR page for its owner without treating display or polling as payment',async t=>{
 const f=await fixture(t);await f.ready('alipay');const item=(await f.create({provider:'alipay',productId:'credits-200'})).value.item;
 const expected={...f.created[0].input,appId:alipay.appId,sellerId:alipay.sellerId};
 assert.equal(validateAlipayPaymentURL(item.paymentUrl,expected),true);assert.equal(validateAlipayQRPaymentURL(item.paymentQrUrl,expected),true);assert.equal(item.qrContent,null);
 const page=new URL(item.paymentUrl),qr=new URL(item.paymentQrUrl),params=Object.fromEntries(qr.searchParams);
 for(const [key,value]of page.searchParams)if(!['biz_content','sign'].includes(key))assert.equal(qr.searchParams.get(key),value);
 assert.deepEqual(JSON.parse(params.biz_content),{...JSON.parse(page.searchParams.get('biz_content')),qr_pay_mode:'4',qrcode_width:'244'});
 const signed=Object.keys(params).filter(key=>key!=='sign').sort().map(key=>`${key}=${params[key]}`).join('&');
 assert.equal(verify('RSA-SHA256',Buffer.from(signed),rsa.publicKey,Buffer.from(params.sign,'base64')),true);
 for(const result of [await f.request('/api/orders/'+item.id),await f.request('/api/orders/'+item.id+'/query',{data:{}}),await f.request('/api/orders')]){
  const current=result.value.item||result.value.items[0];assert.equal(current.paymentQrUrl,item.paymentQrUrl);assert.equal(current.status,'pending');assert.ok(!result.text.includes('PRIVATE KEY'));assert.ok(!result.text.includes('sealed_settings'));
 }
 assert.equal((await f.request('/api/orders/'+item.id,{cookie:f.other.cookie})).status,404);assert.equal((await f.request('/api/orders/'+item.id,{cookie:''})).status,401);
 assert.equal((await f.request('/api/payments/entitlements')).value.credits.balance,0);assert.equal(f.count('payment_credit_ledger'),0);assert.equal(f.count('payment_entitlements'),0);
});

test('Alipay QR signs with its frozen configuration despite active merchant changes and hides when frozen credentials cannot be read',async t=>{
 const f=await fixture(t);await f.ready('alipay');const item=(await f.create({provider:'alipay',productId:'credits-200'})).value.item;
 const frozen=f.db.prepare('SELECT config_id FROM payment_orders WHERE order_id=?').get(item.id).config_id;
 const other=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 assert.equal((await f.channel('alipay',{appId:'2026999999999999',sellerId:'2088999999999999',privateKey:other.privateKey,alipayPublicKey:other.publicKey})).status,200);
 const current=(await f.request('/api/orders/'+item.id)).value.item;assert.equal(current.paymentUrl,item.paymentUrl);assert.equal(current.paymentQrUrl,item.paymentQrUrl);
 assert.equal(new URL(current.paymentQrUrl).searchParams.get('app_id'),alipay.appId);assert.equal(JSON.parse(new URL(current.paymentQrUrl).searchParams.get('biz_content')).seller_id,alipay.sellerId);
 f.db.prepare('UPDATE payment_config_versions SET sealed_settings=? WHERE id=?').run('unreadable-frozen-settings',frozen);
 const unavailable=(await f.request('/api/orders/'+item.id)).value.item;assert.equal(unavailable.paymentUrl,null);assert.equal(unavailable.paymentQrUrl,null);assert.equal(unavailable.status,'pending');assert.equal(f.count('payment_credit_ledger'),0);
});

test('Alipay QR disappears for paid, expired, closed, legacy and malformed orders while verified settlement stays exactly once',async t=>{
 const f=await fixture(t);await f.ready('alipay');const paid=(await f.create({provider:'alipay',productId:'credits-200'})).value.item;assert.ok(paid.paymentQrUrl);
 assert.equal((await f.notify(paid)).status,200);assert.equal((await f.notify(paid)).status,200);const settled=(await f.request('/api/orders/'+paid.id)).value.item;
 assert.equal(settled.status,'paid');assert.equal(settled.paymentUrl,null);assert.equal(settled.paymentQrUrl,null);assert.equal(f.count('payment_credit_ledger'),1);assert.equal((await f.request('/api/payments/entitlements')).value.credits.balance,200);
 const expired=(await f.create({provider:'alipay'})).value.item;f.db.prepare('UPDATE payment_orders SET expires_at=? WHERE order_id=?').run(new Date(Date.now()-1000).toISOString(),expired.id);
 const stale=(await f.request('/api/orders/'+expired.id)).value.item;assert.equal(stale.status,'expired');assert.equal(stale.paymentQrUrl,null);
 const closed=(await f.create({provider:'alipay'})).value.item;f.orderEntry(closed).state='closed';const ended=(await f.request('/api/orders/'+closed.id+'/query',{data:{}})).value.item;assert.equal(ended.status,'closed');assert.equal(ended.paymentQrUrl,null);
 const legacy=(await f.create({provider:'alipay'})).value.item;f.db.prepare('UPDATE payment_orders SET payment_url=NULL,qr_content=? WHERE order_id=?').run('https://qr.alipay.com/legacy-order',legacy.id);
 const historical=(await f.request('/api/orders/'+legacy.id)).value.item;assert.equal(historical.qrContent,'https://qr.alipay.com/legacy-order');assert.equal(historical.paymentQrUrl,null);
 const corrupt=(await f.create({provider:'alipay'})).value.item;const changed=new URL(corrupt.paymentUrl);changed.searchParams.set('sign',Buffer.alloc(256,1).toString('base64'));f.db.prepare('UPDATE payment_orders SET payment_url=? WHERE order_id=?').run(changed.href,corrupt.id);
 assert.equal((await f.request('/api/orders/'+corrupt.id)).value.item.paymentQrUrl,null);
 f.db.prepare('UPDATE payment_orders SET payment_url=? WHERE order_id=?').run(corrupt.paymentUrl.replace('openapi.alipay.com','evil.example'),corrupt.id);
 const invalid=(await f.request('/api/orders/'+corrupt.id)).value.item;assert.equal(invalid.paymentUrl,null);assert.equal(invalid.paymentQrUrl,null);
 await f.channel('wechat');const wechatOrder=(await f.create()).value.item;assert.match(wechatOrder.qrContent,/^weixin:/);assert.equal(wechatOrder.paymentQrUrl,null);
 assert.equal(f.count('payment_credit_ledger'),1);assert.equal(f.count('payment_entitlements'),0);
});
