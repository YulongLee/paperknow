import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {database} from '../backend/database.mjs';
import {createPaymentService} from '../backend/payment-service.mjs';
import {paymentCatalog,savePaymentProduct} from '../backend/payment-settings.mjs';

// All provider operations are test adapters; these tests never contact a payment gateway.
const rsa=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const providerSettings={
 wechat:{appId:'wx1234567890abcdef',merchantId:'1234567890',merchantSerial:'1234567890ABCDEF1234567890ABCDEF',privateKey:rsa.privateKey,apiV3Key:'c'.repeat(32),platformPublicKeyId:'PUB_KEY_ID_1234567890',platformPublicKey:rsa.publicKey},
 alipay:{appId:'2026101512345678',sellerId:'2088123456789012',privateKey:rsa.privateKey,alipayPublicKey:rsa.publicKey}
};
const productInput=(amount=200,extra={})=>({title:`${amount} 积分`,description:`当前账户充值 ${amount} 积分，消费服务尚未开放。`,priceCents:amount*10,durationDays:null,entitlementType:'credits',creditAmount:amount,status:'active',...extra});
function fixture(t,{path=':memory:',query:customQuery}={}){
 let db=database(path);const remote=new Map(),created=[];
 const config={paymentConfigKey:randomBytes(32).toString('base64'),paymentAdapters:{
  async create(provider,settings,input){const entry={provider,settings,input,state:'pending'};remote.set(input.outTradeNo,entry);created.push(entry);return {qrContent:provider==='wechat'?'weixin://wxpay/bizpayurl?pr=credits-test':'https://qr.alipay.com/credits-test'};},
  async query(provider,settings,input){return customQuery?customQuery(provider,settings,input):result(remote.get(input.outTradeNo),{state:remote.get(input.outTradeNo).state});},
  async notify(provider,settings,request){if(request.headers['x-test-signature']!=='valid-test-signature')throw new Error('invalid signature');return JSON.parse(provider==='wechat'?request.rawBody:new URLSearchParams(request.rawBody).get('payload'));}
 }};
 let service=createPaymentService(db,config);
 function seed(id){db.prepare('INSERT INTO users(id,email,name,role,created_at) VALUES(?,?,?,?,?)').run(id,id+'@example.invalid','测试账户','user',new Date().toISOString());return {id};}
 const user=seed('credits-user'),other=seed('credits-other'),admin=seed('credits-admin');
 function channel(provider){return service.settings.save(provider,{enabled:true,...providerSettings[provider]},admin.id);}
 async function create({provider='wechat',productId='credits-200',idempotencyKey='credits-key-'+randomBytes(8).toString('hex'),owner=user,...extra}={}){return (await service.create(owner,{provider,productId,idempotencyKey,...extra})).item;}
 function result(entry,extra={}){return {state:'paid',outTradeNo:entry.input.outTradeNo,amountCents:entry.input.amountCents,currency:'CNY',merchantId:entry.provider==='wechat'?entry.settings.merchantId:entry.settings.sellerId,appId:entry.settings.appId,providerTradeNo:'trade-'+entry.input.outTradeNo,paidAt:new Date().toISOString(),...extra};}
 function notify(item,{data=result(remote.get(item.outTradeNo)),signature='valid-test-signature'}={}){return service.notify(item.provider,{headers:{'wechatpay-serial':providerSettings.wechat.platformPublicKeyId,'x-test-signature':signature},rawBody:item.provider==='wechat'?JSON.stringify(data):new URLSearchParams({out_trade_no:data.outTradeNo,payload:JSON.stringify(data)}).toString()});}
 function restart(){db.close();db=database(path);service=createPaymentService(db,config);}
 t.after(()=>db.close());
 return {get db(){return db;},get service(){return service;},user,other,admin,created,remote,channel,create,result,notify,restart};
}

test('approved tiers have exact integral prices and no channel is enabled by seeding',async t=>{
 const f=fixture(t),options=f.service.options();
 assert.equal(options.enabled,false);assert.deepEqual(options.channels.map(c=>[c.provider,c.ready]),[['wechat',false],['alipay',false]]);
 assert.deepEqual(options.products.map(p=>[p.id,p.priceCents,p.creditAmount]).sort((a,b)=>a[2]-b[2]),[['credits-200',2000,200],['credits-500',5000,500],['credits-1000',10000,1000]]);
 assert.ok(options.products.every(p=>p.entitlementType==='credits'&&p.durationDays===null&&p.entitlement.type==='credits'));
 assert.deepEqual(f.service.entitlements(f.user),{items:[],credits:{balance:0,ledger:[]},bundles:[]});
 await assert.rejects(f.create(),{status:503});assert.equal(f.created.length,0);
});

test('each exact credit tier settles through both WeChat and Alipay and isolates account balances',async t=>{
 const f=fixture(t);f.channel('wechat');f.channel('alipay');
 for(const provider of ['wechat','alipay'])for(const amount of [200,500,1000]){
  const item=await f.create({provider,productId:`credits-${amount}`});
  assert.equal(item.amountCents,amount*10);assert.equal(item.creditAmount,amount);assert.equal(item.entitlementType,'credits');
  assert.equal(f.service.entitlements(f.user).credits.ledger.some(entry=>entry.orderId===item.id),false);
  await f.notify(item);assert.equal(f.service.getOrder(f.user,item.id).item.status,'paid');
 }
 const entitlements=f.service.entitlements(f.user);assert.equal(entitlements.credits.balance,3400);assert.equal(entitlements.credits.ledger.length,6);assert.equal(entitlements.items.length,0);
 assert.deepEqual(f.service.entitlements(f.other),{items:[],credits:{balance:0,ledger:[]},bundles:[]});
 const item=f.service.list(f.user).items[0];assert.throws(()=>f.service.getOrder(f.other,item.id),{status:404});
 assert.ok(entitlements.credits.ledger.every(item=>item.kind==='purchase'&&item.title&&item.productId&&item.createdAt));
 assert.equal(JSON.stringify(entitlements).includes('privateKey'),false);
});

test('idempotent creation, repeated callbacks and an in-flight query credit only once',async t=>{
 let reply;const f=fixture(t,{query:()=>new Promise(resolve=>reply=resolve)});f.channel('wechat');
 const first=await f.create({idempotencyKey:'credits-stable-request'}),again=await f.create({idempotencyKey:'credits-stable-request'});assert.equal(first.id,again.id);assert.equal(f.created.length,1);
 await assert.rejects(f.create({idempotencyKey:'credits-stable-request',productId:'credits-500'}),{status:409});
 const pending=f.service.query(f.user,first.id);await Promise.resolve();assert.equal(typeof reply,'function');
 await Promise.all(Array.from({length:8},()=>f.notify(first)));reply(f.result(f.remote.get(first.outTradeNo)));await pending;
 assert.equal(f.service.entitlements(f.user).credits.balance,200);assert.equal(f.service.entitlements(f.user).credits.ledger.length,1);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM payment_credit_ledger').get().n,1);
});

test('orders preserve credit quantity, price and title after a product is edited or unpublished',async t=>{
 const f=fixture(t);f.channel('wechat');const item=await f.create();
 savePaymentProduct(f.db,'credits-200',productInput(800,{priceCents:9999,title:'编辑后的积分包',status:'preview'}));
 assert.equal(f.service.getOrder(f.user,item.id).item.creditAmount,200);assert.equal(f.service.getOrder(f.user,item.id).item.amountCents,2000);
 await assert.rejects(f.notify(item,{data:f.result(f.remote.get(item.outTradeNo),{amountCents:9999})}),{status:400});
 await f.notify(item);assert.equal(f.service.entitlements(f.user).credits.balance,200);assert.equal(f.service.entitlements(f.user).credits.ledger[0].title,'200 科研积分');
 await assert.rejects(f.create(),{status:409});
});

test('credits reject client amount, quantity, balance and entitlement overrides',async t=>{
 const f=fixture(t);f.channel('wechat');
 for(const extra of [{amountCents:1},{priceCents:1},{creditAmount:999999},{balance:99999},{entitlementType:'membership'},{entitlement:{type:'credits',creditAmount:999999}},{quantity:99},{currency:'USD'}])await assert.rejects(f.create(extra),{status:400});
 assert.equal(f.created.length,0);assert.equal(f.db.prepare('SELECT count(*) AS n FROM orders').get().n,0);
});

test('unverified or mismatched provider results never grant points and closed orders remain uncredited',async t=>{
 const f=fixture(t);f.channel('alipay');const item=await f.create({provider:'alipay'}),good=f.result(f.remote.get(item.outTradeNo));
 await assert.rejects(f.notify(item,{signature:'forged'}),{status:400});
 for(const mutation of [{amountCents:2001},{amountCents:20.00},{merchantId:'2088000000000000'},{appId:'2026101500000000'},{currency:'USD'},{providerTradeNo:''}])await assert.rejects(f.notify(item,{data:{...good,...mutation}}),{status:400});
 await f.notify(item,{data:{...good,state:'pending'}});assert.equal(f.service.entitlements(f.user).credits.balance,0);
 await f.notify(item,{data:{...good,state:'closed'}});await assert.rejects(f.notify(item),{status:409});assert.equal(f.service.entitlements(f.user).credits.balance,0);
});

test('expired credit QR remains hidden but a later verified settlement grants the original amount once',async t=>{
 const f=fixture(t);f.channel('wechat');const item=await f.create();f.db.prepare('UPDATE payment_orders SET expires_at=? WHERE order_id=?').run('2020-01-01T00:00:00.000Z',item.id);
 assert.equal(f.service.getOrder(f.user,item.id).item.status,'expired');assert.equal(f.service.getOrder(f.user,item.id).item.qrContent,null);
 await f.notify(item);await f.notify(item);assert.equal(f.service.entitlements(f.user).credits.balance,200);
});

test('a reused provider transaction ID rolls back both payment state and inserted credit ledger',async t=>{
 const f=fixture(t);f.channel('wechat');const first=await f.create(),second=await f.create({productId:'credits-500'});await f.notify(first);
 const duplicate=f.result(f.remote.get(second.outTradeNo),{providerTradeNo:'trade-'+first.outTradeNo});
 await assert.rejects(f.notify(second,{data:duplicate}));assert.equal(f.service.getOrder(f.user,second.id).item.status,'pending');assert.equal(f.service.entitlements(f.user).credits.balance,200);assert.equal(f.service.entitlements(f.user).credits.ledger.length,1);
 await f.notify(second);assert.equal(f.service.entitlements(f.user).credits.balance,700);
});

test('credit records are append-only and malformed order snapshots cannot partially mark payment',async t=>{
 const f=fixture(t);f.channel('wechat');const good=await f.create();await f.notify(good);
 assert.throws(()=>f.db.prepare('UPDATE payment_credit_ledger SET amount=1000 WHERE order_id=?').run(good.id),/积分记录不可修改/);
 assert.throws(()=>f.db.prepare('DELETE FROM payment_credit_ledger WHERE order_id=?').run(good.id),/积分记录不可删除/);
 for(const snapshot of ['null','{}','{"type":"credits","creditAmount":0}','{"type":"credits","creditAmount":1.5}','{"type":"credits","creditAmount":1000001}']){
  const item=await f.create();f.db.prepare('UPDATE payment_orders SET entitlement=? WHERE order_id=?').run(snapshot,item.id);
  await assert.rejects(f.notify(item),{status:500});assert.equal(f.service.getOrder(f.user,item.id).item.status,'pending');
 }
 assert.equal(f.service.entitlements(f.user).credits.balance,200);
});

test('admin credit validation preserves existing membership payloads and prevents type conversion',t=>{
 const f=fixture(t);const member=savePaymentProduct(f.db,'basic',{title:'基础会员',description:'7 天账户会员记录。',priceCents:100,durationDays:7,status:'active'});assert.equal(member.entitlementType,'membership');
 for(const extra of [{creditAmount:0},{creditAmount:-1},{creditAmount:1.2},{creditAmount:'200'},{creditAmount:1000001},{priceCents:20.1},{durationDays:7},{description:''},{entitlementType:'membership',durationDays:7},{entitlementType:'bundle'}])assert.throws(()=>savePaymentProduct(f.db,'credits-200',productInput(200,extra)),{status:400});
 assert.throws(()=>savePaymentProduct(f.db,'basic',productInput()),{status:400});
 assert.throws(()=>savePaymentProduct(f.db,'credits-200',{...productInput(),unknown:true}),{status:400});
 const unpublished=savePaymentProduct(f.db,'credits-200',productInput(200,{status:'preview',priceCents:null,creditAmount:null}));assert.equal(unpublished.status,'preview');assert.equal(paymentCatalog(f.db).some(p=>p.id==='credits-200'),false);
 f.db.prepare('UPDATE products SET rules=? WHERE id=?').run('null','credits-500');assert.doesNotThrow(()=>paymentCatalog(f.db));assert.equal(paymentCatalog(f.db).some(p=>p.id==='credits-500'),false);
});

test('repeated database startup preserves edited prices and never reissues existing paid credits',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'paperknow-credit-migration-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const f=fixture(t,{path:join(directory,'account.sqlite')});f.channel('wechat');const item=await f.create();await f.notify(item);
 savePaymentProduct(f.db,'credits-200',productInput(250,{priceCents:2500,title:'已调整商品'}));
 for(let i=0;i<3;i++){f.restart();const product=paymentCatalog(f.db).find(p=>p.id==='credits-200');assert.equal(product.priceCents,2500);assert.equal(product.creditAmount,250);assert.equal(product.title,'已调整商品');await f.notify(item);assert.equal(f.service.entitlements(f.user).credits.balance,200);}
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM payment_credit_ledger').get().n,1);assert.equal(f.db.prepare('SELECT count(*) AS n FROM products').get().n,16);
});

test('balance sums the full credit ledger even when only the most recent 100 records are returned',async t=>{
 const f=fixture(t);f.channel('wechat');
 for(let i=0;i<102;i++){const item=await f.create();await f.notify(item);}
 const entitlements=f.service.entitlements(f.user);assert.equal(entitlements.credits.balance,20400);assert.equal(entitlements.credits.ledger.length,100);assert.equal(entitlements.items.length,0);
});


test('obsolete seed descriptions migrate without changing prices, custom copy or paid snapshots',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'paperknow-credit-copy-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const f=fixture(t,{path:join(directory,'account.sqlite')});
 const old='支付成功后向当前账户充值 200 科研积分。积分消费服务尚未开放，当前不会自动扣除积分。';
 const seed=JSON.parse(f.db.prepare('SELECT rules FROM products WHERE id=?').get('credits-200').rules);seed.description=old;seed.priceCents=2300;f.db.prepare('UPDATE products SET rules=? WHERE id=?').run(JSON.stringify(seed),'credits-200');
 savePaymentProduct(f.db,'credits-500',productInput(500,{description:'运营自定义积分规则，必须保留。'}));
 f.channel('wechat');const item=await f.create();await f.notify(item);f.restart();
 const after=paymentCatalog(f.db).find(p=>p.id==='credits-200');assert.equal(after.priceCents,2300);assert.equal(after.creditAmount,200);assert.match(after.description,/成功扣减/);assert.equal(paymentCatalog(f.db).find(p=>p.id==='credits-500').description,'运营自定义积分规则，必须保留。');
 assert.equal(JSON.parse(f.db.prepare('SELECT entitlement FROM payment_orders WHERE order_id=?').get(item.id).entitlement).description,old);assert.equal(f.service.entitlements(f.user).credits.balance,200);
});
