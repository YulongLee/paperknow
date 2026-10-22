import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {createPaymentService} from '../backend/payment-service.mjs';
import {savePaymentProduct} from '../backend/payment-settings.mjs';
import {createAdminUserManagement} from '../backend/admin-user-management.mjs';
import {managedMemberships} from '../backend/admin-user-entitlements.mjs';

const day=86400000,rsa=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const credentials={appId:'wx1234567890abcdef',merchantId:'1234567890',merchantSerial:'1234567890ABCDEF1234567890ABCDEF',privateKey:rsa.privateKey,apiV3Key:'b'.repeat(32),platformPublicKeyId:'PUB_KEY_ID_1234567890',platformPublicKey:rsa.publicKey};

function fixture(t){
 const db=database(':memory:'),user={id:'renewal-owner'},admin={id:'renewal-admin'},remote=new Map();t.after(()=>db.close());
 for(const who of [user,admin])db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(who.id,who.id,who===admin?'admin':'user',new Date().toISOString());
 const config={paymentConfigKey:randomBytes(32).toString('base64'),aiURL:'https://example.invalid/v1/chat/completions',aiKey:'synthetic-only',aiModel:'fixture',paymentAdapters:{
  async create(provider,settings,input){remote.set(input.outTradeNo,{provider,settings,input});return {qrContent:'weixin://wxpay/bizpayurl?pr=synthetic-renewal'};},
  async notify(_provider,_settings,request){assert.equal(request.headers['x-synthetic-signature'],'trusted-renewal-adapter');return JSON.parse(request.rawBody);}
 }};
 const billing=createBillingService(db,config);billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:key==='agent'?'disabled':'paid',creditCost:key==='agent'?null:10}))});config.billing=billing;
 for(const id of ['basic','advanced'])savePaymentProduct(db,id,{title:'合成30天会员',description:'隔离的会员续购与管理边界测试',status:'active',priceCents:100,durationDays:30,membershipItems:[{key:'polish',title:'学术润色',quantity:2}]});
 const payments=createPaymentService(db,config);payments.settings.save('wechat',{enabled:true,...credentials},admin.id);
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 const management=createAdminUserManagement(db,{billing,transaction,audit(){}});
 const pending=async(productId='basic')=>(await payments.create(user,{productId,provider:'wechat',idempotencyKey:'renewal-'+randomUUID()})).item;
 async function notify(order){const {input}=remote.get(order.outTradeNo);return payments.notify('wechat',{headers:{'wechatpay-serial':credentials.platformPublicKeyId,'x-synthetic-signature':'trusted-renewal-adapter'},rawBody:JSON.stringify({state:'paid',outTradeNo:order.outTradeNo,amountCents:input.amountCents,currency:'CNY',merchantId:credentials.merchantId,appId:credentials.appId,providerTradeNo:'synthetic-'+order.id,paidAt:new Date().toISOString()})});}
 async function paid(productId='basic'){const order=await pending(productId);await notify(order);return order;}
 const grant=id=>({...db.prepare('SELECT * FROM payment_entitlements WHERE order_id=?').get(id)});
 const order=id=>({...db.prepare('SELECT * FROM payment_orders WHERE order_id=?').get(id)});
 const control=(id,action,expiresAt)=>management.mutate(admin,user.id,'membership',{commandId:randomUUID(),version:management.detail(user.id).user.version,action,grantId:'payment:'+id,...(expiresAt?{expiresAt}:{}),reason:'合成会员期限管理'});
 const immediate=(record,before,after)=>{assert.ok(Date.parse(record.starts_at)>=before&&Date.parse(record.starts_at)<=after);assert.equal(Date.parse(record.expires_at)-Date.parse(record.starts_at),30*day);};
 return {db,user,admin,billing,payments,pending,paid,notify,grant,order,control,immediate};
}

test('repurchasing a revoked paid membership starts immediately and replayed payment cannot grant or charge twice',async t=>{
 const f=fixture(t),first=await f.paid(),original=f.grant(first.id),merchant=f.order(first.id);f.control(first.id,'revoke');
 const before=Date.now(),second=await f.paid(),renewal=f.grant(second.id);f.immediate(renewal,before,Date.now());
 assert.equal(f.billing.quote(f.user,{type:'polish'}).sourceOrderId,second.id);assert.equal(managedMemberships(f.db,f.user.id).find(item=>item.orderId===first.id).status,'revoked');
 await f.notify(second);await Promise.all([f.notify(second),f.notify(second)]);assert.deepEqual(f.grant(second.id),renewal);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_entitlements').get().n,2);
 assert.deepEqual(f.grant(first.id),original);assert.deepEqual(f.order(first.id),merchant);assert.equal(f.billing.balance(f.user.id).balance,0);
});

test('renewal uses the effective shortened or extended paid expiry without rewriting the original term or purchased snapshot',async t=>{
 for(const days of [1,60]){
  const f=fixture(t),first=await f.paid(),original=f.grant(first.id),merchant=f.order(first.id),effective=new Date(Date.parse(original.starts_at)+days*day).toISOString();f.control(first.id,'update',effective);
  const second=await f.paid(),renewal=f.grant(second.id);assert.equal(renewal.starts_at,effective);assert.equal(Date.parse(renewal.expires_at)-Date.parse(renewal.starts_at),30*day);
  assert.deepEqual(f.grant(first.id),original);assert.deepEqual(f.order(first.id),merchant);assert.equal(f.payments.getOrder(f.user,second.id).item.amountCents,100);assert.deepEqual(f.payments.getOrder(f.user,second.id).item.membershipItems,[{key:'polish',title:'学术润色',quantity:2}]);
 }
});

test('multiple scheduled renewals retain their sequence and a changed effective term determines the next renewal boundary',async t=>{
 const f=fixture(t),first=await f.paid(),second=await f.paid(),a=f.grant(first.id),b=f.grant(second.id);assert.equal(b.starts_at,a.expires_at);
 const effective=new Date(Date.parse(b.expires_at)+10*day).toISOString();f.control(second.id,'update',effective);
 const third=await f.paid(),c=f.grant(third.id);assert.equal(c.starts_at,effective);assert.equal(Date.parse(c.expires_at)-Date.parse(c.starts_at),30*day);
 await f.notify(third);assert.deepEqual(f.grant(first.id),a);assert.deepEqual(f.grant(second.id),b);assert.deepEqual(f.grant(third.id),c);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_entitlements').get().n,3);
});

test('expired original or managed paid terms do not delay a newly purchased membership',async t=>{
 for(const override of [false,true]){
  const f=fixture(t),first=await f.paid(),pastStart=new Date(Date.now()-60*day).toISOString(),pastEnd=new Date(Date.now()-day).toISOString();
  // Isolated historical fixture; production renewal must preserve this record.
  f.db.prepare('UPDATE payment_entitlements SET starts_at=?,expires_at=? WHERE order_id=?').run(pastStart,override?new Date(Date.now()+30*day).toISOString():pastEnd,first.id);if(override)f.control(first.id,'update',pastEnd);
  const original=f.grant(first.id),before=Date.now(),second=await f.paid();f.immediate(f.grant(second.id),before,Date.now());assert.deepEqual(f.grant(first.id),original);
 }
});

test('unpaid, refunded or failed order records cannot postpone paid renewal even if a stale grant exists',async t=>{
 for(const status of ['pending','refunded','failed']){
  const f=fixture(t),stale=await f.pending(),now=new Date().toISOString(),future=new Date(Date.now()+300*day).toISOString();f.db.prepare('UPDATE orders SET status=? WHERE id=?').run(status,stale.id);
  f.db.prepare('INSERT INTO payment_entitlements VALUES(?,?,?,?,?,?,?)').run(stale.id,f.user.id,'basic','membership',now,future,now);const original=f.grant(stale.id),merchant=f.order(stale.id);
  const before=Date.now(),second=await f.paid();f.immediate(f.grant(second.id),before,Date.now());assert.deepEqual(f.grant(stale.id),original);assert.deepEqual(f.order(stale.id),merchant);assert.equal(f.billing.quote(f.user,{type:'polish'}).sourceOrderId,second.id);
 }
});

test('another product or independent administrator grant cannot defer a paid membership of this product',async t=>{
 const f=fixture(t),different=await f.paid('advanced'),beforeDifferent=f.grant(different.id),now=new Date().toISOString();
 f.db.prepare('INSERT INTO admin_membership_grants VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),f.user.id,'basic','合成独立授予',JSON.stringify([{key:'polish',title:'学术润色',quantity:2}]),now,new Date(Date.now()+90*day).toISOString(),f.admin.id,'合成授予',now);
 const before=Date.now(),second=await f.paid();f.immediate(f.grant(second.id),before,Date.now());assert.deepEqual(f.grant(different.id),beforeDifferent);
});
