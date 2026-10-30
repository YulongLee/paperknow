import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createBillingService} from '../backend/billing-service.mjs';
import {planV1Commerce,applyV1Commerce} from '../backend/v1-commercial-launch.mjs';
import {paymentCatalog,savePaymentProduct} from '../backend/payment-settings.mjs';
import {commercialToolIdentity,commercialWritingKey} from '../backend/v1-commercial-policy.mjs';
import {cloudCapacity,assertCloudCapacity,reserveParsePages} from '../backend/commercial-resources.mjs';
import {v1PriceFor,entitlementLabel} from '../dist/workspace/v1-pricing.mjs';
function fixture(t){
 const db=database(':memory:'),at=new Date().toISOString(),until=new Date(Date.now()+86400000).toISOString(),user={id:'v1-owner'};
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(user.id,'v1@example.invalid','Synthetic fixture',null,'user',at);
 const config={pptMasterEnabled:true,pptMasterRenderer(){assert.fail('no rendering in quota tests');},aiURL:'https://example.invalid',aiKey:'fixture',aiModel:'fixture',agentEnabled:true,getAgentSettings:()=>({enabled:true,engine:'claude-agent-sdk',baseURL:'https://example.invalid',apiKey:'fixture',model:'fixture',version:'fixture'}),documentTranslationEnabled:true,documentTranslationAccessKeyId:'fixture-test',documentTranslationAccessKeySecret:'fixture-test',storage:{provider:'aliyun_oss',bucket:'fixture-private',prefix:'fixture/',read(){},putArtifact(){},readArtifact(){},removeArtifact(){},signedOriginalURL(){}}};
 const billing=createBillingService(db,config);applyV1Commerce(db,planV1Commerce(db).expected);
 db.prepare('INSERT INTO payment_config_versions(id,provider,sealed_settings,identity_hash,created_by,created_at) VALUES(?,?,?,?,?,?)').run('v1-fixture','wechat','{}','fixture',user.id,at);
 function grant(items,scope=null,product='reading-v1',type='membership'){
  const id=randomUUID();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,user.id,product,'paid',at);
  const snapshot={type,durationDays:30,[type==='membership'?'membershipItems':'bundleItems']:items,...(scope?{scope}:{})};
  db.prepare('INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,title,entitlement,idempotency_key,input_hash,user_id,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'wechat',id,'v1-fixture',2990,'Synthetic fixture',JSON.stringify(snapshot),id,id,user.id,until,at);
  if(type==='membership')db.prepare('INSERT INTO payment_entitlements VALUES(?,?,?,?,?,?,?)').run(id,user.id,product,type,at,until,at);else db.prepare('INSERT INTO payment_bundle_entitlements VALUES(?,?,?,?,?,?,?)').run(id,user.id,product,at,until,at,JSON.stringify(items));return id;
 }
 function job(type='agent',input={}){const id=randomUUID();db.prepare("INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,'queued','queued',?,?,?,?,?)").run(id,user.id,type,JSON.stringify(input),id,id,at,at);return id;}
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const val=fn();db.exec('COMMIT');return val;}catch(e){db.exec('ROLLBACK');throw e;}};
 db.prepare('INSERT INTO admin_credit_adjustments(id,user_id,amount,reason,actor_id,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),user.id,100000,'Synthetic fixture',user.id,at);
 t.after(()=>db.close());return{db,billing,user,grant,job,tx,quote:(key,context={})=>billing.quote(user,{type:'agent',serviceKey:key,context}),reserve:(id,q)=>tx(()=>billing.reserve(user,id,1,'agent',q.token,q.serviceKey))};
}
test('V1 publishes executable entry tiers, withdraws old sales and snapshots scope without changing paid history',t=>{
 const f=fixture(t),catalog=paymentCatalog(f.db),get=id=>catalog.find(p=>p.id===id);
 assert.equal(get('reading-v1').priceCents,2990);assert.equal(get('professional-v1').priceCents,6990);assert.equal(get('bundle-bachelor').priceCents,16900);assert.equal(get('bundle-rewrite').priceCents,5900);
 assert.equal(get('bundle-master'),undefined);assert.equal(get('bundle-doctor'),undefined);assert.equal(get('basic'),undefined);assert.equal(get('bundle-reading'),undefined);
 const member=get('reading-v1');assert.deepEqual(member.membershipItems.map(i=>i.quantity),[60,20,100,2048]);
 const old=f.grant([{key:'literature-read',title:'Old paid allowance',quantity:7}],null,'basic');const before=f.db.prepare('SELECT entitlement FROM payment_orders WHERE order_id=?').get(old).entitlement;
 const next=planV1Commerce(f.db);applyV1Commerce(f.db,next.expected);assert.equal(f.db.prepare('SELECT entitlement FROM payment_orders WHERE order_id=?').get(old).entitlement,before);
 const edited=savePaymentProduct(f.db,member.id,{...Object.fromEntries(['title','description','priceCents','durationDays','status','entitlementType','membershipItems'].map(k=>[k,member[k]])),priceCents:3090});assert.deepEqual(edited.scope,member.scope);
});
test('prices cover each operation and server identity selects paragraph, targeted, enhanced and long tiers',t=>{
 const f=fixture(t);for(const [key,cost]of [['thesis-bachelor',1000],['thesis-long',1990],['detection-aigc',99],['revision-paragraph',19],['revision-targeted',299],['presentation-ai',199],['literature-document',99],['literature-document-long',249]])assert.equal(v1PriceFor(key),cost);
 assert.equal(commercialToolIdentity(f.db,{kind:'revision',operation:'rewrite',snapshot:{mode:'reduce',text:'a',context:{plan:'strong',revisionProduct:{mode:'paragraph'}}}}).serviceKey,'revision-paragraph');
 assert.throws(()=>commercialToolIdentity(f.db,{kind:'revision',operation:'rewrite',snapshot:{mode:'reduce',text:'a'.repeat(1001),context:{plan:'strong',revisionProduct:{mode:'paragraph'}}}}),{status:400});
 assert.equal(commercialWritingKey(f.db,'article','draft',{profile:{targetWords:5000}}),'writing-article');assert.equal(commercialWritingKey(f.db,'thesis','draft',{profile:{level:'硕士',targetWords:20000}}),'thesis-long');
 assert.equal(commercialWritingKey(f.db,'proposal','outline',{}),'writing-planning');
});
test('new membership shares light actions, excludes heavy services and falls back after held units are exhausted',t=>{
 const f=fixture(t),order=f.grant([{key:'light-ai',title:'Light AI',quantity:2}]);
 const q1=f.quote('literature-read',{characters:2000}),q2=f.quote('literature-answer',{characters:2000});assert.equal(q1.entitlementKey,'light-ai');
 const id=f.job();f.reserve(id,q1);f.tx(()=>f.billing.settle(id));f.reserve(f.job(),q2);
 assert.equal(f.quote('literature-read',{characters:2000}).source,'credits');assert.equal(f.quote('thesis-bachelor',{kind:'thesis',targetWords:8000}).source,'credits');assert.equal(f.quote('literature-read',{characters:3001}).source,'credits');
 const row=f.billing.entitlements(f.user.id).membershipUsage[order][0];assert.deepEqual([row.used,row.held,row.remaining],[1,1,0]);
});
test('translation reserves actual pages once, checks concurrent holds, releases failures and never consumes light actions',t=>{
 const f=fixture(t),order=f.grant([{key:'light-ai',title:'Light',quantity:60},{key:'translation-pages',title:'Pages',quantity:20}]);
 const q1=f.quote('literature-document',{pages:12}),q2=f.quote('literature-document',{pages:12}),id=f.job('document_translation');
 assert.equal(q1.entitlementKey,'translation-pages');assert.equal(q1.entitlementUnits,12);f.reserve(id,q1);assert.throws(()=>f.reserve(f.job('document_translation'),q2),{status:409});
 assert.equal(f.quote('literature-document',{pages:12}).creditCost,99);f.tx(()=>f.billing.release(id));const q=f.quote('literature-document',{pages:20});const next=f.job('document_translation');f.reserve(next,q);f.tx(()=>f.billing.settle(next));f.tx(()=>f.billing.settle(next));
 const rows=f.billing.entitlements(f.user.id).membershipUsage[order];assert.equal(rows.find(i=>i.key==='light-ai').used,0);assert.equal(rows.find(i=>i.key==='translation-pages').used,20);assert.equal(f.billing.balance(f.user.id).balance,100000);
 assert.throws(()=>f.db.prepare('UPDATE billing_reservations SET entitlement_units=1 WHERE job_id=?').run(next));
});
test('new scoped packages reject oversized work but historical purchased allowances keep their scope',t=>{
 const f=fixture(t),item={key:'thesis-bachelor',title:'Thesis',quantity:1};f.grant([item],{version:'2026-10-31-v1',maxTargetWords:12000},'bundle-bachelor','bundle');
 assert.equal(f.quote('thesis-bachelor',{kind:'thesis',targetWords:12000}).source,'bundle');assert.equal(f.quote('thesis-bachelor',{kind:'thesis',targetWords:14000}).source,'credits');
 assert.throws(()=>f.quote('thesis-bachelor',{kind:'thesis',targetWords:50000}),{status:400});f.grant([item],null,'bundle-bachelor','bundle');assert.equal(f.quote('thesis-bachelor',{kind:'thesis',targetWords:50000}).source,'bundle');
});
test('cloud storage and PDF parse allowances enforce real resources while retaining files on expiry',t=>{
 const f=fixture(t);assert.equal(cloudCapacity(f.db,f.user.id),500*1024*1024);const grant=f.grant([{key:'cloud-mb',title:'Storage',quantity:2048},{key:'parse-pages',title:'Parse',quantity:100}]);assert.equal(cloudCapacity(f.db,f.user.id),2*1024**3);
 assert.throws(()=>assertCloudCapacity(f.db,f.user.id,3*1024**3),{status:409});
 const id=f.job('document_parse');f.tx(()=>reserveParsePages(f.db,f.user.id,id,100));assert.equal(f.billing.entitlements(f.user.id).membershipUsage[grant].find(i=>i.key==='parse-pages').held,100);assert.throws(()=>f.tx(()=>reserveParsePages(f.db,f.user.id,f.job('document_parse'),21)),{status:402});
 f.db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(id);f.tx(()=>reserveParsePages(f.db,f.user.id,f.job('document_parse'),100));
 assert.equal(entitlementLabel({key:'translation-pages',title:'Full translation',quantity:20}),'Full translation × 20 页');
});

test('enhanced presentations honour the matching historical allowance while new packages retain their 20-slide scope',t=>{
 const f=fixture(t),context={kind:'presentation',pages:25,legacyPresentationKey:'presentation-ai'};
 f.grant([{key:'presentation-ai',title:'Historical AI PPT',quantity:1}],null,'premium','membership');
 f.grant([{key:'presentation-thesis',title:'Historical defence PPT',quantity:1}],null,'bundle-presentation','bundle');
 assert.equal(f.quote('presentation-enhanced',context).entitlementKey,'presentation-ai');
 const current=f.quote('presentation-enhanced',{...context,legacyPresentationKey:'presentation-proposal'});assert.equal(current.source,'credits');assert.equal(current.creditCost,299);
 const g=fixture(t);g.grant([{key:'presentation-thesis',title:'Scoped defence PPT',quantity:1}],{version:'2026-10-31-v1',maxSlides:20},'bundle-bachelor','bundle');
 assert.equal(g.quote('presentation-enhanced',{...context,legacyPresentationKey:'presentation-thesis'}).source,'credits');
});
