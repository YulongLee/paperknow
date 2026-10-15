import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession} from '../backend/auth.mjs';
import {paymentBundleItems,paymentCatalog,savePaymentProduct} from '../backend/payment-settings.mjs';

// The adapters below replace both payment networks. No real merchant or order is used.
const rsa=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const credentials={
 wechat:{appId:'wx1234567890abcdef',merchantId:'1234567890',merchantSerial:'1234567890ABCDEF1234567890ABCDEF',privateKey:rsa.privateKey,apiV3Key:'b'.repeat(32),platformPublicKeyId:'PUB_KEY_ID_1234567890',platformPublicKey:rsa.publicKey},
 alipay:{appId:'2026101512345678',sellerId:'2088123456789012',privateKey:rsa.privateKey,alipayPublicKey:rsa.publicKey}
};
const items=()=>[{key:'similarity-check',title:'自备材料核对',quantity:2},{key:'revision-advice',title:'修改建议',quantity:3}];
const bundleInput=(extra={})=>({title:'套餐测试商品',description:'30 天内保留这份已购服务数量记录；当前不提供自动消费扣减。',priceCents:9900,durationDays:30,status:'active',entitlementType:'bundle',bundleItems:items(),...extra});
async function fixture(t,{path=':memory:',query:customQuery}={}){
 const db=database(path),remote=new Map(),created=[];
 const config={paymentConfigKey:randomBytes(32).toString('base64'),authCodeSecret:'bundle-api-unit-test-secret-not-for-real-accounts',getAI:()=>({enabled:false}),paymentAdapters:{
  async create(provider,settings,input){const entry={provider,settings,input,state:'pending'};remote.set(input.outTradeNo,entry);created.push(entry);return {qrContent:provider==='wechat'?'weixin://wxpay/bizpayurl?pr=bundle-test':'https://qr.alipay.com/bundle-test'};},
  async query(provider,settings,input){return customQuery?customQuery(provider,settings,input):result(remote.get(input.outTradeNo),{state:remote.get(input.outTradeNo).state});},
  async notify(provider,settings,request){if(request.headers['x-test-signature']!=='bundle-unit-valid')throw new Error('invalid mock signature');return JSON.parse(provider==='wechat'?request.rawBody:new URLSearchParams(request.rawBody.toString()).get('payload'));}
 }};
 const api=createAPI(db,{cancel(){}},config),server=http.createServer((req,res)=>void api(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
 function seed(id,role='user'){db.prepare('INSERT INTO users(id,email,name,role,created_at) VALUES(?,?,?,?,?)').run(id,id+'@example.invalid','套餐测试账户',role,new Date().toISOString());return {id,cookie:'pk_session='+createSession(db,id)};}
 const user=seed('bundle-user'),other=seed('bundle-other'),admin=seed('bundle-admin','admin');
 async function request(path,{data,cookie=user.cookie,method=data===undefined?'GET':'POST',origin=base}={}){const response=await fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})})},body:data===undefined?undefined:JSON.stringify(data)});const text=await response.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:response.status,value};}
 async function channel(provider='wechat'){const saved=await request('/api/admin/payments/'+provider,{cookie:admin.cookie,data:{enabled:true,...credentials[provider]}});assert.equal(saved.status,200);return saved;}
 async function publish(extra={},productId='bundle-rewrite'){return request('/api/admin/payments/products/'+productId,{cookie:admin.cookie,data:bundleInput(extra)});}
 async function create({provider='wechat',productId='bundle-rewrite',idempotencyKey='bundle-key-'+randomBytes(8).toString('hex'),cookie=user.cookie,...extra}={}){return request('/api/orders',{cookie,data:{provider,productId,idempotencyKey,...extra}});}
 function result(entry,extra={}){return {state:'paid',outTradeNo:entry.input.outTradeNo,amountCents:entry.input.amountCents,currency:'CNY',merchantId:entry.provider==='wechat'?entry.settings.merchantId:entry.settings.sellerId,appId:entry.settings.appId,providerTradeNo:'transaction-'+entry.input.outTradeNo,paidAt:new Date().toISOString(),...extra};}
 async function notify(order,{data=result(remote.get(order.outTradeNo)),signature='bundle-unit-valid'}={}){const response=await fetch(base+'/api/payments/notify/'+order.provider,{method:'POST',headers:{'Content-Type':order.provider==='wechat'?'application/json':'application/x-www-form-urlencoded','Wechatpay-Serial':credentials.wechat.platformPublicKeyId,'x-test-signature':signature},body:order.provider==='wechat'?JSON.stringify(data):new URLSearchParams({out_trade_no:data.outTradeNo,payload:JSON.stringify(data)}).toString()});return {status:response.status,text:await response.text()};}
 async function ready(provider='wechat'){await channel(provider);assert.equal((await publish()).status,200);}
 const count=table=>db.prepare('SELECT count(*) AS n FROM '+table).get().n;
 return {db,base,user,other,admin,remote,created,request,channel,publish,create,result,notify,ready,count};
}

test('seven bundle references are seeded unpublished without enabling either payment channel',async t=>{
 const f=await fixture(t),catalog=paymentCatalog(f.db,{all:true}),bundles=catalog.filter(p=>p.entitlementType==='bundle');
 assert.equal(bundles.length,7);assert.deepEqual(Object.fromEntries(bundles.map(p=>[p.id,p.priceCents])),{'bundle-bachelor':23900,'bundle-doctor':48900,'bundle-dual':15900,'bundle-junior':15900,'bundle-master':36900,'bundle-reduce':12900,'bundle-rewrite':9900});
 assert.ok(bundles.every(p=>p.status==='preview'&&p.durationDays===null&&paymentBundleItems(p.bundleItems)));
 assert.equal(f.count('payment_channels'),0);assert.equal(f.count('payment_config_versions'),0);assert.equal(f.count('payment_bundle_entitlements'),0);
 const options=(await f.request('/api/payments/options',{cookie:''})).value;assert.equal(options.enabled,false);assert.equal(options.products.some(p=>p.entitlementType==='bundle'),false);
 await f.channel();assert.equal((await f.create()).status,409);assert.equal(f.count('orders'),0);
});

test('both payment channels grant a separate bundle record using exact amount, duration and service counts',async t=>{
 const f=await fixture(t);await f.ready();await f.channel('alipay');
 for(const provider of ['wechat','alipay']){
  const created=await f.create({provider});assert.equal(created.status,201);const item=created.value.item;
  assert.equal(item.amountCents,9900);assert.equal(item.entitlementType,'bundle');assert.equal(item.durationDays,30);assert.deepEqual(item.bundleItems,items());
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM payment_bundle_entitlements WHERE order_id=?').get(item.id).n,0);
  const acknowledgement=await f.notify(item);assert.equal(acknowledgement.status,provider==='wechat'?204:200);if(provider==='alipay')assert.equal(acknowledgement.text,'success');
  const owned=(await f.request('/api/payments/entitlements')).value,bundle=owned.bundles.find(b=>b.orderId===item.id);
  assert.ok(bundle);assert.equal(bundle.productId,'bundle-rewrite');assert.equal(bundle.title,'套餐测试商品');assert.equal(bundle.description,bundleInput().description);assert.deepEqual(bundle.items,items());assert.equal(Date.parse(bundle.expiresAt)-Date.parse(bundle.startsAt),30*86400000);
 }
 const owned=(await f.request('/api/payments/entitlements')).value;assert.equal(owned.bundles.length,2);assert.deepEqual(owned.items,[]);assert.deepEqual(owned.credits,{balance:0,ledger:[]});assert.equal(f.count('payment_entitlements'),0);assert.equal(f.count('payment_credit_ledger'),0);
});

test('replayed notifications and an in-flight query cannot grant a bundle twice',async t=>{
 let resolveQuery;const f=await fixture(t,{query:()=>new Promise(resolve=>resolveQuery=resolve)});await f.ready();const item=(await f.create({idempotencyKey:'bundle-idempotent-order'})).value.item;
 const again=await f.create({idempotencyKey:'bundle-idempotent-order'});assert.equal(again.value.item.id,item.id);assert.equal(f.created.length,1);
 const pending=f.request('/api/orders/'+item.id+'/query',{data:{}});for(let i=0;i<100&&!resolveQuery;i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(typeof resolveQuery,'function');
 const replies=await Promise.all(Array.from({length:6},()=>f.notify(item)));assert.ok(replies.every(r=>r.status===204));resolveQuery(f.result(f.remote.get(item.outTradeNo)));assert.equal((await pending).value.item.status,'paid');
 assert.equal(f.count('payment_bundle_entitlements'),1);assert.equal((await f.request('/api/payments/entitlements')).value.bundles.length,1);
 assert.equal((await f.notify(item,{data:f.result(f.remote.get(item.outTradeNo),{providerTradeNo:'different-provider-transaction'})})).status,400);
});

test('editing or unpublishing a bundle cannot change an existing order snapshot or its delivered services',async t=>{
 const f=await fixture(t);await f.ready();const item=(await f.create()).value.item;
 assert.equal((await f.publish({title:'已修改商品',description:'新的套餐说明',priceCents:25000,durationDays:90,bundleItems:[{key:'different-service',title:'新服务',quantity:99}],status:'preview'})).status,200);
 const before=(await f.request('/api/orders/'+item.id)).value.item;assert.equal(before.amountCents,9900);assert.equal(before.title,'套餐测试商品');assert.equal(before.durationDays,30);assert.deepEqual(before.bundleItems,items());
 assert.equal((await f.notify(item,{data:f.result(f.remote.get(item.outTradeNo),{amountCents:25000})})).status,400);assert.equal((await f.notify(item)).status,204);
 const granted=(await f.request('/api/payments/entitlements')).value.bundles[0];assert.equal(granted.title,'套餐测试商品');assert.equal(granted.description,bundleInput().description);assert.equal(Date.parse(granted.expiresAt)-Date.parse(granted.startsAt),30*86400000);assert.deepEqual(granted.items,items());
 assert.equal((await f.create()).status,409);
});

test('account isolation protects bundle orders and entitlement records without exposing payment credentials',async t=>{
 const f=await fixture(t);await f.ready();const item=(await f.create()).value.item;await f.notify(item);
 assert.equal((await f.request('/api/payments/entitlements',{cookie:''})).status,401);assert.equal((await f.request('/api/orders/'+item.id,{cookie:f.other.cookie})).status,404);assert.equal((await f.request('/api/orders/'+item.id+'/query',{cookie:f.other.cookie,data:{}})).status,404);
 const other=(await f.request('/api/payments/entitlements',{cookie:f.other.cookie})).value;assert.deepEqual(other.bundles,[]);assert.deepEqual(other.items,[]);assert.equal(other.credits.balance,0);
 const owned=(await f.request('/api/payments/entitlements')).value;for(const secret of ['privateKey','apiV3Key','sealed_settings','entitlement','config_id'])assert.equal(Object.hasOwn(owned.bundles[0],secret),false);
 assert.deepEqual(Object.keys(owned.bundles[0].items[0]).sort(),['key','quantity','title']);
});

test('unverified callbacks and mismatched amount, currency, application or merchant never grant bundles',async t=>{
 const f=await fixture(t);await f.ready('alipay');const item=(await f.create({provider:'alipay'})).value.item,good=f.result(f.remote.get(item.outTradeNo));
 assert.equal((await f.notify(item,{signature:'invalid'})).status,400);
 for(const mutation of [{amountCents:9899},{amountCents:99},{currency:'USD'},{appId:'2026101500000000'},{merchantId:'2088000000000000'},{providerTradeNo:''},{paidAt:new Date(Date.now()+86400000).toISOString()}])assert.ok((await f.notify(item,{data:{...good,...mutation}})).status>=400);
 assert.equal(f.count('payment_bundle_entitlements'),0);assert.equal((await f.request('/api/orders/'+item.id)).value.item.status,'pending');assert.equal((await f.notify(item)).status,200);assert.equal(f.count('payment_bundle_entitlements'),1);
});

test('client price, service counts, validity and entitlement overrides are rejected before provider order creation',async t=>{
 const f=await fixture(t);await f.ready();
 for(const extra of [{priceCents:1},{amountCents:1},{bundleItems:[{key:'unlimited',title:'无限服务',quantity:100000}]},{durationDays:366},{quantity:2},{entitlementType:'membership'},{entitlement:{type:'bundle',durationDays:366,bundleItems:items()}}])assert.equal((await f.create(extra)).status,400);
 assert.equal(f.created.length,0);assert.equal(f.count('orders'),0);
});

test('bundle settings validate service identity, count, title and validity before publishing',async t=>{
 const f=await fixture(t);const invalidItems=[[],null,{},Array.from({length:21},(_,i)=>({key:'item-'+i,title:'服务',quantity:1})),[{key:'same',title:'服务',quantity:1},{key:'same',title:'重复',quantity:2}],...['Bad','bad_key','1bad','', 'a'.repeat(65)].map(key=>[{key,title:'服务',quantity:1}]),...[0,-1,1.5,'2',100001].map(quantity=>[{key:'valid',title:'服务',quantity}]),...['',' '.repeat(3),'a'.repeat(81)].map(title=>[{key:'valid',title,quantity:1}]),[{key:'valid',title:'服务',quantity:1,unexpected:true}]];
 for(const bundleItems of invalidItems)assert.equal((await f.publish({bundleItems})).status,400);
 for(const durationDays of [null,0,-1,1.5,'30',367])assert.equal((await f.publish({durationDays})).status,400);
 for(const extra of [{priceCents:99.9},{description:''},{creditAmount:500},{entitlementType:'membership'},{entitlementType:'credits'}])assert.equal((await f.publish(extra)).status,400);
 assert.equal((await f.publish({status:'preview',durationDays:null,bundleItems:[],priceCents:null})).status,200);assert.equal(paymentCatalog(f.db).some(p=>p.id==='bundle-rewrite'),false);
 assert.equal((await f.publish()).status,200);assert.equal(paymentCatalog(f.db).find(p=>p.id==='bundle-rewrite').bundleItems.length,2);
 const membership={title:'会员',description:'7 天记录',priceCents:100,status:'active',durationDays:7};assert.throws(()=>savePaymentProduct(f.db,'basic',{...membership,bundleItems:items()}),{status:400});
});

test('administrator-only publishing is origin protected, audited and rolled back when audit persistence fails',async t=>{
 const f=await fixture(t),path='/api/admin/payments/products/bundle-rewrite';
 assert.equal((await f.request(path,{cookie:f.user.cookie,data:bundleInput()})).status,403);assert.equal((await f.request(path,{cookie:f.admin.cookie,data:bundleInput(),origin:''})).status,403);assert.equal((await f.publish()).status,200);
 const audit=f.db.prepare("SELECT detail FROM admin_audit WHERE action='payment.product.update' ORDER BY rowid DESC LIMIT 1").get(),detail=JSON.parse(audit.detail);assert.equal(detail.entitlementType,'bundle');assert.equal(detail.durationDays,30);assert.deepEqual(detail.bundleItems,items());
 f.db.exec("CREATE TRIGGER reject_bundle_audit BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");assert.equal((await f.publish({priceCents:12300,bundleItems:[{key:'changed',title:'不同服务',quantity:8}]})).status,500);assert.equal(paymentCatalog(f.db).find(p=>p.id==='bundle-rewrite').priceCents,9900);assert.deepEqual(paymentCatalog(f.db).find(p=>p.id==='bundle-rewrite').bundleItems,items());
});

test('bundle grant failure or duplicate provider transaction rolls back the complete payment transaction',async t=>{
 const f=await fixture(t);await f.ready();const item=(await f.create()).value.item;
 f.db.exec("CREATE TRIGGER reject_bundle_grant BEFORE INSERT ON payment_bundle_entitlements BEGIN SELECT RAISE(ABORT,'grant unavailable'); END;");assert.equal((await f.notify(item)).status,400);assert.equal(f.count('payment_bundle_entitlements'),0);assert.equal((await f.request('/api/orders/'+item.id)).value.item.status,'pending');assert.equal(f.db.prepare('SELECT paid_at FROM payment_orders WHERE order_id=?').get(item.id).paid_at,null);
 f.db.exec('DROP TRIGGER reject_bundle_grant');assert.equal((await f.notify(item)).status,204);
 const second=(await f.create()).value.item;assert.equal((await f.notify(second,{data:f.result(f.remote.get(second.outTradeNo),{providerTradeNo:'transaction-'+item.outTradeNo})})).status,400);assert.equal(f.count('payment_bundle_entitlements'),1);assert.equal((await f.request('/api/orders/'+second.id)).value.item.status,'pending');assert.equal((await f.notify(second)).status,204);assert.equal(f.count('payment_bundle_entitlements'),2);
});

test('invalid bundle snapshots and closed payments never mark an order paid or grant service records',async t=>{
 const f=await fixture(t);await f.ready();
 for(const entitlement of [{type:'bundle',durationDays:0,bundleItems:items()},{type:'bundle',durationDays:30,bundleItems:[]},{type:'bundle',durationDays:30,bundleItems:[{key:'invalid',title:'服务',quantity:0}]}]){
  const item=(await f.create()).value.item;f.db.prepare('UPDATE payment_orders SET entitlement=? WHERE order_id=?').run(JSON.stringify(entitlement),item.id);assert.equal((await f.notify(item)).status,500);assert.equal((await f.request('/api/orders/'+item.id)).value.item.status,'pending');
 }
 const closed=(await f.create()).value.item;assert.equal((await f.notify(closed,{data:f.result(f.remote.get(closed.outTradeNo),{state:'closed'})})).status,204);assert.equal((await f.notify(closed)).status,409);assert.equal(f.count('payment_bundle_entitlements'),0);
});

test('expired bundle QR and temporarily disabled channels preserve the original verified settlement',async t=>{
 const f=await fixture(t);await f.ready();const item=(await f.create()).value.item;f.db.prepare('UPDATE payment_orders SET expires_at=? WHERE order_id=?').run('2020-01-01T00:00:00.000Z',item.id);
 const expired=(await f.request('/api/orders/'+item.id)).value.item;assert.equal(expired.status,'expired');assert.equal(expired.qrContent,null);
 assert.equal((await f.request('/api/admin/payments/wechat',{cookie:f.admin.cookie,data:{enabled:false}})).status,200);assert.equal((await f.create()).status,503);assert.equal((await f.notify(item)).status,204);assert.equal(f.count('payment_bundle_entitlements'),1);assert.equal(f.count('payment_entitlements'),0);
});

test('bundle seed migration is repeatable and preserves edited catalogue rules and issued quantities',t=>{
 const directory=mkdtempSync(join(tmpdir(),'paperknow-bundle-startup-')),path=join(directory,'account.sqlite');t.after(()=>rmSync(directory,{recursive:true,force:true}));
 let db=database(path);savePaymentProduct(db,'bundle-master',bundleInput({title:'已配置的套餐',priceCents:8800,durationDays:14,bundleItems:[{key:'saved-service',title:'实际服务',quantity:9}]}));
 const createdAt=new Date().toISOString();db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run('persisted-bundle-user','测试账户','user',createdAt);db.prepare('INSERT INTO orders(id,user_id,product_id,status,created_at) VALUES(?,?,?,?,?)').run('persisted-bundle-order','persisted-bundle-user','bundle-master','paid',createdAt);db.prepare('INSERT INTO payment_bundle_entitlements(order_id,user_id,product_id,starts_at,expires_at,granted_at,items) VALUES(?,?,?,?,?,?,?)').run('persisted-bundle-order','persisted-bundle-user','bundle-master',createdAt,'2099-01-01T00:00:00.000Z',createdAt,JSON.stringify(items()));db.close();
 for(let i=0;i<3;i++){db=database(path);const product=paymentCatalog(db).find(p=>p.id==='bundle-master');assert.equal(product.title,'已配置的套餐');assert.equal(product.priceCents,8800);assert.equal(product.durationDays,14);assert.equal(product.bundleItems[0].quantity,9);assert.equal(db.prepare('SELECT count(*) AS n FROM products').get().n,13);assert.equal(db.prepare('SELECT count(*) AS n FROM payment_channels').get().n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM payment_bundle_entitlements').get().n,1);assert.deepEqual(JSON.parse(db.prepare('SELECT items FROM payment_bundle_entitlements').get().items),items());db.close();}
});
