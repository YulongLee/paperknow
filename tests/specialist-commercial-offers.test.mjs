import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {database} from '../backend/database.mjs';
import {paymentCatalog} from '../backend/payment-settings.mjs';
import {specialistBundleOffers,specialistRevisionOffers,specialistWritingOffers,specialistOffersForDuration} from '../dist/workspace/specialist-commercial-offers.mjs';
import {planSpecialistOffers,applySpecialistOffers} from '../backend/specialist-commercial-offers.mjs';
import {parseSpecialistArguments,configureSpecialistOffers} from '../scripts/configure-specialist-offers.mjs';
import {productDelivery} from '../backend/commerce-readiness.mjs';

function fixture(t){const dir=mkdtempSync(join(tmpdir(),'paperknow-specialist-')),path=join(dir,'catalog.sqlite'),db=database(path);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});return {db,path,dir};}
const rows=db=>db.prepare('SELECT id,title,status,rules FROM products ORDER BY id').all();
const row=(db,id)=>db.prepare('SELECT id,title,status,rules FROM products WHERE id=?').get(id);

test('seven approved prices and per-degree allowances become executable 180-day package definitions',()=>{
 assert.deepEqual(specialistRevisionOffers.map(offer=>[offer.id,offer.priceCents,offer.totalUses]),[['bundle-rewrite',9900,8],['bundle-reduce',12900,8],['bundle-dual',15900,8]]);
 assert.deepEqual(specialistWritingOffers.map(offer=>[offer.id,offer.priceCents,offer.totalUses]),[['bundle-junior',15900,11],['bundle-bachelor',23900,13],['bundle-master',36900,16],['bundle-doctor',48900,21]]);
 for(const [index,degree] of ['junior','bachelor','master','doctor'].entries()){
  const offer=specialistWritingOffers[index];assert.deepEqual(offer.bundleItems.map(item=>[item.key,item.quantity]),[['thesis-'+degree,1],['presentation-proposal',1],['polish',[5,7,10,15][index]],['taskbook-'+degree,1],['proposal-'+degree,1],['literature-review-'+degree,1],['presentation-thesis',1]]);
 }
 for(const [index,mode] of ['reduce','aigc','dual'].entries())assert.deepEqual(specialistRevisionOffers[index].bundleItems.map(item=>[item.key,item.quantity]),[['detection-similarity',2],['detection-aigc',2],['polish',2],['revision-'+mode,2]]);
 assert.equal(new Set(specialistBundleOffers.map(offer=>offer.id)).size,7);
 for(const offer of specialistBundleOffers){assert.equal(offer.durationDays,180);assert.equal(offer.entitlementType,'bundle');assert.equal(offer.status,'preview');assert.equal(new Set(offer.bundleItems.map(item=>item.key)).size,offer.bundleItems.length);assert.match(offer.description,/不自动续费/);assert.doesNotMatch(offer.title,/旗舰/);}
 assert.match(specialistRevisionOffers[0].description,/不包含知网、维普或万方/);
 assert.throws(()=>specialistBundleOffers[0].bundleItems[0].quantity=100,TypeError);
 assert.equal(specialistOffersForDuration(90)[0].durationDays,90);assert.equal(specialistBundleOffers[0].durationDays,180);
 for(const value of [null,0,367,'180',180.5,NaN])assert.throws(()=>specialistOffersForDuration(value));
});

test('read-only specialist preview neither publishes nor modifies existing products',t=>{
 const {db}=fixture(t),before=rows(db),plan=planSpecialistOffers(db);
 assert.equal(plan.publish,false);assert.equal(plan.durationDays,180);assert.equal(plan.products.length,7);assert.match(plan.expected,/^[a-f0-9]{64}$/);assert.deepEqual(rows(db),before);
 assert.ok(plan.products.every(item=>JSON.parse(item.after.rules).durationDays===180&&item.after.status==='preview'));
 assert.throws(()=>planSpecialistOffers(db,{durationDays:1000}),{status:400});assert.throws(()=>planSpecialistOffers(db,{publish:'yes'}),{status:400});
});

test('publication hashes bind the exact seven prior rows, duration and explicit published state',t=>{
 const {db}=fixture(t),preview=planSpecialistOffers(db),published=planSpecialistOffers(db,{publish:true});
 assert.notEqual(preview.expected,published.expected);assert.notEqual(planSpecialistOffers(db,{publish:true,durationDays:90}).expected,published.expected);
 assert.throws(()=>applySpecialistOffers(db,{publish:true,expected:preview.expected}),{status:409});assert.throws(()=>applySpecialistOffers(db,{publish:true}),{status:400});
 const applied=applySpecialistOffers(db,{publish:true,expected:published.expected});assert.deepEqual(applied.changedProducts,specialistBundleOffers.map(offer=>offer.id));
 const catalog=paymentCatalog(db);for(const offer of specialistBundleOffers){const actual=catalog.find(item=>item.id===offer.id);assert.equal(actual.status,'active');assert.equal(actual.priceCents,offer.priceCents);assert.equal(actual.durationDays,180);assert.deepEqual(actual.bundleItems,offer.bundleItems);}
 assert.throws(()=>applySpecialistOffers(db,{publish:true,expected:published.expected}),{status:409});
 const current=planSpecialistOffers(db,{publish:true});assert.deepEqual(applySpecialistOffers(db,{publish:true,expected:current.expected}).changedProducts,[]);
});

test('concurrent catalogue edits or a write error roll back the complete package publication',t=>{
 const {db,path}=fixture(t),plan=planSpecialistOffers(db,{publish:true}),other=new DatabaseSync(path);
 other.prepare("UPDATE products SET title='并发管理员编辑' WHERE id='bundle-master'").run();other.close();const edited=rows(db);
 assert.throws(()=>applySpecialistOffers(db,{publish:true,expected:plan.expected}),{status:409});assert.deepEqual(rows(db),edited);
 const next=planSpecialistOffers(db,{publish:true});db.exec("CREATE TRIGGER reject_specialist BEFORE UPDATE ON products WHEN NEW.id='bundle-bachelor' BEGIN SELECT RAISE(ABORT,'test publication failure'); END");
 assert.throws(()=>applySpecialistOffers(db,{publish:true,expected:next.expected}),/test publication failure/);assert.deepEqual(rows(db),edited);assert.equal(db.isTransaction,false);
});

test('only the seven reviewed packages change; orders, grants, credit ledgers, merchant settings and other products remain exact',t=>{
 const {db}=fixture(t),at='2026-10-20T00:00:00.000Z',until='2027-04-18T00:00:00.000Z',user='specialist-owner';
 db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user,'套餐验收账户','user',at);
 db.prepare('INSERT INTO payment_config_versions(id,provider,sealed_settings,identity_hash,created_by,created_at) VALUES(?,?,?,?,?,?)').run('old-config','wechat','opaque-settings','merchant',user,at);db.prepare('INSERT INTO payment_channels VALUES(?,?,?,?)').run('wechat','old-config',0,at);
 const entitlement={type:'bundle',durationDays:12,bundleItems:[{key:'polish',title:'历史内容',quantity:2}]};
 db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run('old-order',user,'bundle-rewrite','paid',at);
 db.prepare('INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,title,entitlement,idempotency_key,input_hash,user_id,expires_at,paid_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('old-order','wechat','old-order','old-config',8800,'付款时标题',JSON.stringify(entitlement),'old-order','old-order',user,until,at,at);
 db.prepare('INSERT INTO payment_bundle_entitlements VALUES(?,?,?,?,?,?,?)').run('old-order',user,'bundle-rewrite',at,until,at,JSON.stringify(entitlement.bundleItems));
 const tables=['orders','payment_orders','payment_entitlements','payment_bundle_entitlements','payment_credit_ledger','payment_channels','payment_config_versions'];
 const snapshot=()=>Object.fromEntries(tables.map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));const before=snapshot(),untouched=rows(db).filter(item=>!specialistBundleOffers.some(offer=>offer.id===item.id));
 const plan=planSpecialistOffers(db,{publish:true});applySpecialistOffers(db,{publish:true,expected:plan.expected});assert.deepEqual(snapshot(),before);assert.deepEqual(rows(db).filter(item=>!specialistBundleOffers.some(offer=>offer.id===item.id)),untouched);
});

test('CLI requires explicit apply and creates a private consistent backup containing WAL writes',t=>{
 const {db,path,dir}=fixture(t);db.prepare("UPDATE products SET title='备份中的旧标题' WHERE id='bundle-rewrite'").run();const before=rows(db),plan=configureSpecialistOffers(['--database',path,'--publish']);
 assert.equal(plan.applied,false);assert.deepEqual(rows(db),before);const backup=join(dir,'before.sqlite');
 const applied=configureSpecialistOffers(['--database',path,'--duration-days','180','--publish','--apply','--expected',plan.expected,'--backup',backup]);assert.equal(applied.backup,backup);assert.equal(statSync(backup).mode&0o777,0o600);
 const copy=new DatabaseSync(backup,{readOnly:true});assert.deepEqual(rows(copy),before);copy.close();assert.equal(row(db,'bundle-rewrite').status,'active');
 assert.throws(()=>configureSpecialistOffers(['--database',path,'--duration-days','180','--publish','--apply','--expected',plan.expected]),/已变化/);
});

test('CLI rejects invalid durations, repeated flags, missing hashes, and relative database or backup paths',()=>{
 assert.equal(parseSpecialistArguments(['--database','/tmp/catalog.sqlite']).durationDays,180);assert.equal(parseSpecialistArguments(['--database','/tmp/catalog.sqlite','--duration-days','90']).durationDays,90);
 for(const args of [[],['--database','relative.sqlite'],['--database',':memory:'],['--database','/tmp/catalog.sqlite','--apply'],['--database','/tmp/catalog.sqlite','--publish','--publish'],['--database','/tmp/catalog.sqlite','--duration-days','90','--duration-days','180'],...['0','367','180.5','-1','0180','NaN'].map(value=>['--database','/tmp/catalog.sqlite','--duration-days',value]),['--database','/tmp/catalog.sqlite','--backup','/tmp/backup.sqlite']])assert.throws(()=>parseSpecialistArguments(args));
});

test('only the two available self-operated free checks may accompany executable paid package services',()=>{
 const services=specialistBundleOffers.flatMap(offer=>offer.bundleItems).filter((item,index,all)=>all.findIndex(other=>other.key===item.key)===index).map(item=>({key:item.key,effectiveMode:item.key.startsWith('detection-')?'free':'paid',available:true,effectiveCreditCost:item.key.startsWith('detection-')?null:10}));
 const billing={rules:()=>({services:[]}),toolRules:()=>({services})};
 for(const offer of specialistBundleOffers)assert.equal(productDelivery(offer,billing).purchasable,true);
 const unknown={...specialistBundleOffers[0],bundleItems:[{key:'unknown-free',title:'无计费身份',quantity:2}]};services.push({key:'unknown-free',effectiveMode:'free',available:true});assert.equal(productDelivery(unknown,billing).purchasable,false);
 for(const mode of ['free','disabled']){const copy=services.map(item=>item.key==='revision-reduce'?{...item,effectiveMode:mode}:item);assert.equal(productDelivery(specialistBundleOffers[0],{...billing,toolRules:()=>({services:copy})}).purchasable,false);}
 for(const key of ['detection-similarity','detection-aigc']){const copy=services.map(item=>item.key===key?{...item,available:false}:item);assert.equal(productDelivery(specialistBundleOffers[0],{...billing,toolRules:()=>({services:copy})}).purchasable,false);}
 for(const key of ['detection-similarity','detection-aigc'])for(const mode of ['paid','disabled']){const copy=services.map(item=>item.key===key?{...item,effectiveMode:mode,effectiveCreditCost:mode==='paid'?500:null}:item);assert.equal(productDelivery(specialistBundleOffers[0],{...billing,toolRules:()=>({services:copy})}).purchasable,mode==='paid');}
 assert.equal(productDelivery({...specialistBundleOffers[0],bundleItems:[]},billing).purchasable,false);
 assert.equal(productDelivery({...specialistBundleOffers[0],bundleItems:specialistBundleOffers[0].bundleItems.filter(item=>item.key.startsWith('detection-'))},billing).purchasable,false);
 assert.equal(productDelivery({entitlementType:'credits'},billing).purchasable,true);
 assert.equal(productDelivery({entitlementType:'credits'},{rules:()=>({services:[]}),toolRules:()=>({services:services.filter(item=>item.key.startsWith('detection-'))})}).purchasable,false);
 assert.equal(productDelivery({entitlementType:'credits'},{rules:()=>({services:[]}),toolRules:()=>({services:services.filter(item=>item.key.startsWith('detection-')).map(item=>({...item,effectiveMode:'paid',effectiveCreditCost:500}))})}).purchasable,true);
});
