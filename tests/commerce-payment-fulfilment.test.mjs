import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createPaymentService} from '../backend/payment-service.mjs';
import {createProviderPayment} from '../backend/payment-providers.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {createThesisService} from '../backend/thesis-service.mjs';
import {createWritingService} from '../backend/writing-service.mjs';
import {savePaymentProduct} from '../backend/payment-settings.mjs';
import {commercialOffers,commercialMemberOffers} from '../dist/workspace/commercial-offers.mjs';
import {specialistBundleOffers} from '../dist/workspace/specialist-commercial-offers.mjs';
import {planCommercialOffers,applyCommercialOffers} from '../backend/commercial-offers.mjs';
import {planSpecialistOffers,applySpecialistOffers} from '../backend/specialist-commercial-offers.mjs';

// Synthetic merchant identities and trusted test adapters only. This verifies
// our order/fulfilment contract, not a real merchant charge or provider receipt.
const rsa=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const credentials={
 wechat:{appId:'wx1234567890abcdef',merchantId:'1234567890',merchantSerial:'1234567890ABCDEF1234567890ABCDEF',privateKey:rsa.privateKey,apiV3Key:'b'.repeat(32),platformPublicKeyId:'PUB_KEY_ID_1234567890',platformPublicKey:rsa.publicKey},
 alipay:{appId:'2026101512345678',sellerId:'2088123456789012',privateKey:rsa.privateKey,alipayPublicKey:rsa.publicKey}
};
function fixture(t){
 const db=database(':memory:'),created=[],remote=new Map();t.after(()=>db.close());
 const config={paymentConfigKey:randomBytes(32).toString('base64'),agentEnabled:true,
  getAI:()=>({aiURL:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',aiKey:'synthetic-no-network-ai-key',aiModel:'qwen3.8-flash'}),
  getAgentSettings:()=>({enabled:true,engine:'claude-agent-sdk',baseURL:'https://synthetic.example.invalid/anthropic',apiKey:'synthetic-agent-key',model:'synthetic-model',version:'synthetic-version'}),
  webSimilarityEnabled:true,webSimilarityModel:'qwen3.8-flash',aigcDetectionEnabled:true,moderationAccessKeyId:'synthetic-detection-id',moderationAccessKeySecret:'synthetic-detection-secret',
  storage:{provider:'aliyun_oss',bucket:'synthetic-private',prefix:'paperknow/',putArtifact(){assert.fail('no artifact upload in payment acceptance');},readArtifact(){assert.fail('no artifact download in payment acceptance');},removeArtifact(){assert.fail('no artifact deletion in payment acceptance');}},
  paymentAdapters:{
   async create(provider,settings,input){const entry={provider,settings,input,state:'pending'};created.push(entry);remote.set(input.outTradeNo,entry);
    // Alipay page-pay signing is local and must never fetch its gateway here.
    return provider==='alipay'?createProviderPayment(provider,settings,input,{fetch(){assert.fail('no payment network access in synthetic acceptance');}}):{qrContent:'weixin://wxpay/bizpayurl?pr=synthetic-commerce-'+input.outTradeNo};
   },
   async query(provider,settings,input){const entry=remote.get(input.outTradeNo);return result(entry,{state:entry.state});},
   async notify(provider,settings,request){if(request.headers['x-synthetic-signature']!=='trusted-test-adapter')throw new Error('rejected test signature');return JSON.parse(provider==='wechat'?request.rawBody:new URLSearchParams(String(request.rawBody)).get('payload'));}
  }
 };
 const billing=createBillingService(db,config);billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});
 const payments=createPaymentService(db,{...config,billing});
 function seed(id='commerce-'+randomUUID(),role='user'){db.prepare('INSERT INTO users(id,email,name,role,created_at) VALUES(?,?,?,?,?)').run(id,id+'@example.invalid','合成商业链路验收',role,new Date().toISOString());return {id};}
 const admin=seed('commerce-synthetic-admin','admin');for(const provider of ['wechat','alipay'])payments.settings.save(provider,{enabled:true,...credentials[provider]},admin.id);
 const commercial=planCommercialOffers(db,{publish:true});applyCommercialOffers(db,{publish:true,expected:commercial.expected});
 const specialist=planSpecialistOffers(db,{publish:true,durationDays:180});applySpecialistOffers(db,{publish:true,durationDays:180,expected:specialist.expected});
 function result(entry,extra={}){return {state:entry.state==='closed'?'closed':'paid',outTradeNo:entry.input.outTradeNo,amountCents:entry.input.amountCents,currency:'CNY',merchantId:entry.provider==='wechat'?entry.settings.merchantId:entry.settings.sellerId,appId:entry.settings.appId,providerTradeNo:'synthetic-trade-'+entry.input.outTradeNo,paidAt:new Date().toISOString(),...extra};}
 async function create(owner,productId,provider='wechat',idempotencyKey='commerce-'+randomUUID()){return (await payments.create(owner,{productId,provider,idempotencyKey})).item;}
 function notify(order,{data=result(remote.get(order.outTradeNo)),signature='trusted-test-adapter'}={}){return payments.notify(order.provider,{headers:{'wechatpay-serial':credentials.wechat.platformPublicKeyId,'x-synthetic-signature':signature},rawBody:order.provider==='wechat'?JSON.stringify(data):new URLSearchParams({out_trade_no:data.outTradeNo,payload:JSON.stringify(data)}).toString()});}
 const tx=operation=>{db.exec('BEGIN IMMEDIATE');try{const value=operation();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 function job(owner,type='tool_run'){const id=randomUUID(),at=new Date().toISOString();db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,owner.id,type,'queued','queued','{}',id,id,at,at);return id;}
 return {db,billing,payments,config,created,seed,create,notify,remote,result,tx,job};
}
const allOffers=[...commercialOffers,...specialistBundleOffers];

test('the complete 16-product catalogue offers both payment channels with executable mixed-free detection packages',async t=>{
 const f=fixture(t),options=f.payments.options();assert.equal(options.enabled,true);assert.deepEqual(options.channels.map(item=>[item.provider,item.ready]),[['wechat',true],['alipay',true]]);
 assert.deepEqual(options.products.map(item=>item.id).sort(),[...allOffers.map(item=>item.id),'credits-200','credits-500','credits-1000'].sort());
 for(const offer of allOffers){const actual=options.products.find(item=>item.id===offer.id);assert.equal(actual.purchasable,true,offer.id);assert.equal(actual.priceCents,offer.priceCents);assert.equal(actual.durationDays,offer.durationDays);assert.deepEqual(actual.entitlement[offer.entitlementType==='membership'?'membershipItems':'bundleItems'],offer.membershipItems||offer.bundleItems);}
 const detections=f.billing.toolRules().services.filter(item=>item.key.startsWith('detection-'));assert.equal(detections.length,2);assert.ok(detections.every(item=>item.effectiveMode==='free'&&item.available));
 const before=f.created.length;const key='unknown-actual-service';f.db.prepare('INSERT INTO products(id,title,status,rules) VALUES(?,?,?,?)').run('unknown-service-bundle','未知权益套餐','active',JSON.stringify({priceCents:100,durationDays:180,entitlementType:'bundle',description:'合成不可执行服务',bundleItems:[{key,title:'尚未接通服务',quantity:1}]}));
 assert.equal(f.payments.options().products.find(item=>item.id==='unknown-service-bundle').purchasable,false);await assert.rejects(f.create(f.seed(),'unknown-service-bundle'),{status:409});assert.equal(f.created.length,before);
});

test('basic membership and all seven specialist packages create in both channels, grant nothing before payment, and fulfil exactly once',async t=>{
 const f=fixture(t),offers=[commercialMemberOffers[0],...specialistBundleOffers];
 for(const provider of ['wechat','alipay'])for(const offer of offers){
  const owner=f.seed(),order=await f.create(owner,offer.id,provider,'stable-'+owner.id);assert.equal(order.status,'pending');assert.equal(order.amountCents,offer.priceCents);assert.equal(order.durationDays,offer.durationDays);assert.equal(order.entitlementType,offer.entitlementType);
  if(provider==='wechat')assert.match(order.qrContent,/^weixin:\/\/wxpay\/bizpayurl\?/);else{assert.match(order.paymentUrl,/^https:\/\/openapi\.alipay\.com\/gateway\.do\?/);assert.ok(order.paymentQrUrl);}
  const before=f.payments.entitlements(owner);assert.equal(before.items.length,0);assert.equal(before.bundles.length,0);assert.equal(before.credits.balance,0);
  assert.equal((await f.create(owner,offer.id,provider,'stable-'+owner.id)).id,order.id);
  await f.notify(order);await f.notify(order);await Promise.all([f.notify(order),f.notify(order)]);assert.equal(f.payments.getOrder(owner,order.id).item.status,'paid');
  const records=f.payments.entitlements(owner),membership=offer.entitlementType==='membership',grant=membership?records.items[0]:records.bundles[0];assert.equal(membership?records.items.length:records.bundles.length,1);assert.equal(membership?records.bundles.length:records.items.length,0);assert.equal(grant.product_id||grant.productId,offer.id);assert.equal(Date.parse(grant.expires_at||grant.expiresAt)-Date.parse(grant.starts_at||grant.startsAt),offer.durationDays*86400000);
  assert.deepEqual((membership?grant.usage:grant.items).map(({key,title,quantity,held,used,remaining})=>({key,title,quantity,held,used,remaining})),(offer.membershipItems||offer.bundleItems).map(item=>({...item,held:0,used:0,remaining:item.quantity})));assert.equal(records.credits.balance,0);
  const table=membership?'payment_entitlements':'payment_bundle_entitlements';assert.equal(f.db.prepare('SELECT count(*) n FROM '+table+' WHERE order_id=?').get(order.id).n,1);
 }
 assert.equal(f.created.length,16);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_credit_ledger').get().n,0);
});

test('a paid or disabled detector policy cannot sell an unusable specialist package through either payment channel',async t=>{
 const f=fixture(t),owner=f.seed();
 for(const key of ['detection-similarity','detection-aigc'])for(const mode of ['paid','disabled']){
  const rules=f.billing.toolRules();f.billing.saveToolRules({version:rules.version,services:rules.services.map(item=>({key:item.key,mode:item.key===key?mode:item.key.startsWith('detection-')?'free':item.mode,creditCost:item.key===key&&mode==='paid'?10:item.key.startsWith('detection-')?null:item.creditCost}))});
  for(const id of ['bundle-rewrite','bundle-reduce','bundle-dual']){
   assert.equal(f.payments.options().products.find(item=>item.id===id).purchasable,false);
   for(const provider of ['wechat','alipay'])await assert.rejects(f.create(owner,id,provider),{status:409});
  }
 }
 assert.equal(f.created.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_orders').get().n,0);assert.equal(f.payments.entitlements(owner).bundles.length,0);
});

test('legacy AI availability cannot sell degree-specific writing when the required versioned Agent is disabled',async t=>{
 const f=fixture(t),owner=f.seed();f.config.getAgentSettings=()=>({enabled:false});
 assert.equal(f.billing.rules().services.find(item=>item.key==='agent').available,true);
 const writing=f.billing.toolRules().services.filter(item=>item.group==='AI 写作');assert.equal(writing.length,16);assert.ok(writing.every(item=>!item.available));
 for(const item of writing)assert.throws(()=>f.billing.quote(owner,{type:'agent',serviceKey:item.key}),{status:503});
 for(const offer of specialistBundleOffers.filter(item=>item.group==='writing')){
  assert.equal(f.payments.options().products.find(item=>item.id===offer.id).purchasable,false);
  for(const provider of ['wechat','alipay'])await assert.rejects(f.create(owner,offer.id,provider),{status:409});
 }
 const snapshot={title:'合成研究资料的分析',profile:{level:'本科',language:'中文',targetWords:500},materials:[{id:'source',name:'合成资料',text:'用户确认的合成研究资料，仅用于验证配置关闭时不销售不可执行的写作功能。测试案例关注资料来源、写作权限与服务配置之间的关系，资料已经整理为研究背景、研究范围及任务限制三个部分。所有记录都属于隔离环境中的人工示例，不包含真实实验结果或用户隐私；任务应依据这些说明判断能否执行，并保留账户权限、报价绑定和权益结算边界。',confirmed:true}],references:[],outline:[{id:'chapter',title:'研究背景',targetWords:500}]},config={...f.config,billing:f.billing},theses=createThesisService(f.db,config),drafts=createWritingService(f.db,config);
 const created=await theses.handle({path:'/api/theses',method:'POST',user:owner,readBody:async()=>({snapshot,clientKey:randomUUID()})});
 await assert.rejects(theses.handle({path:'/api/theses/'+created.value.item.id+'/quote',method:'POST',user:owner,readBody:async()=>({version:created.value.item.version,action:'generate'})}),{status:503});
 await assert.rejects(drafts.handle({path:'/api/writing/quote',method:'POST',user:owner,readBody:async()=>({kind:'proposal',operation:'draft',snapshot})}),{status:503});
 assert.equal(f.created.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_orders').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);
});

test('payment snapshots preserve original amount, duration and quotas after the current product is edited or unpublished',async t=>{
 for(const provider of ['wechat','alipay'])for(const offer of [commercialMemberOffers[0],specialistBundleOffers.at(-1)]){
  const f=fixture(t),owner=f.seed(),order=await f.create(owner,offer.id,provider),type=offer.entitlementType,key=type==='membership'?'membershipItems':'bundleItems',oldItems=offer[key];
  savePaymentProduct(f.db,offer.id,{title:'管理员后来修改的商品',description:'新目录的不同价格与次数',status:'preview',entitlementType:type,priceCents:offer.priceCents+999,durationDays:1,[key]:[{key:'polish',title:'新目录修改次数',quantity:99}]});
  const frozen=f.payments.getOrder(owner,order.id).item;assert.equal(frozen.amountCents,offer.priceCents);assert.equal(frozen.durationDays,offer.durationDays);assert.deepEqual(type==='membership'?frozen.membershipItems:frozen.bundleItems,oldItems);
  await assert.rejects(f.notify(order,{data:f.result(f.remote.get(order.outTradeNo),{amountCents:offer.priceCents+999})}),{status:400});await f.notify(order);await f.notify(order);
  const value=f.payments.entitlements(owner),grant=type==='membership'?value.items[0]:value.bundles[0];assert.equal(grant.title,offer.title);assert.equal(grant.description,offer.description);assert.equal(Date.parse(grant.expires_at||grant.expiresAt)-Date.parse(grant.starts_at||grant.startsAt),offer.durationDays*86400000);assert.deepEqual((type==='membership'?grant.usage:grant.items).map(({key,title,quantity})=>({key,title,quantity})),oldItems);
  await assert.rejects(f.create(owner,offer.id,provider),{status:409});
 }
});

test('newly paid scoped quotas are selected by billing, released after failure, and settled once after success',async t=>{
 const f=fixture(t);
 for(const offer of [commercialMemberOffers[0],...specialistBundleOffers]){
  const owner=f.seed(),order=await f.create(owner,offer.id);await f.notify(order);const membership=offer.entitlementType==='membership',serviceKey=membership?'literature-read':offer.group==='detect'?offer.bundleItems.at(-1).key:offer.bundleItems[0].key;
  const quote=()=>f.billing.quote(owner,{type:'agent',serviceKey}),usage=()=>{const entries=f.payments.entitlements(owner);return (membership?entries.items[0].usage:entries.bundles[0].items).find(item=>item.key===serviceKey);};
  const quantity=usage().quantity,first=quote();assert.equal(first.source,membership?'membership':'bundle');assert.equal(first.sourceOrderId,order.id);assert.equal(first.serviceKey,serviceKey);assert.equal(first.entitlementKey,serviceKey);assert.equal(first.creditCost,0);
  const failed=f.job(owner),held=f.tx(()=>f.billing.reserve(owner,failed,1,'agent',first.token,serviceKey));assert.equal(held.sourceOrderId,order.id);assert.equal(usage().held,1);f.tx(()=>f.billing.release(failed));f.tx(()=>f.billing.release(failed));assert.deepEqual([usage().held,usage().used,usage().remaining],[0,0,quantity]);
  const next=quote(),success=f.job(owner);f.tx(()=>f.billing.reserve(owner,success,1,'agent',next.token,serviceKey));f.tx(()=>f.billing.settle(success));f.tx(()=>f.billing.settle(success));f.tx(()=>f.billing.release(success));assert.deepEqual([usage().held,usage().used,usage().remaining],[0,1,quantity-1]);
  const row=f.db.prepare('SELECT service_key,entitlement_key,source_order,status FROM billing_reservations WHERE job_id=?').get(success);assert.deepEqual({...row},{service_key:serviceKey,entitlement_key:serviceKey,source_order:order.id,status:'settled'});assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events e JOIN billing_reservations r ON r.id=e.reservation_id WHERE r.job_id=? AND e.kind='settle'").get(success).n,1);assert.equal(f.billing.balance(owner.id).balance,0);
 }
});

test('included self-operated detection is accounted against a paid package while independent use stays free',async t=>{
 const f=fixture(t),owner=f.seed(),order=await f.create(owner,'bundle-rewrite','alipay');await f.notify(order);
 for(const [serviceKey,type] of [['detection-similarity','web_similarity'],['detection-aigc','aigc_detection']]){
  for(let index=0;index<2;index++){const q=f.billing.quote(owner,{type:'agent',serviceKey});assert.equal(q.source,'bundle');assert.equal(q.sourceOrderId,order.id);assert.equal(q.creditCost,0);const job=f.job(owner,type);f.tx(()=>f.billing.reserve(owner,job,1,'agent',q.token,serviceKey));f.tx(()=>f.billing.settle(job));}
  const exhausted=f.billing.quote(owner,{type:'agent',serviceKey});assert.equal(exhausted.source,'free');assert.equal(exhausted.creditCost,0);assert.equal(exhausted.sourceOrderId,null);const quota=f.payments.entitlements(owner).bundles[0].items.find(item=>item.key===serviceKey);assert.deepEqual([quota.used,quota.held,quota.remaining],[2,0,0]);
 }
 const independent=f.seed();for(const serviceKey of ['detection-similarity','detection-aigc'])assert.equal(f.billing.quote(independent,{type:'agent',serviceKey}).source,'free');assert.equal(f.billing.balance(owner.id).balance,0);assert.equal(f.billing.balance(independent.id).balance,0);
});
