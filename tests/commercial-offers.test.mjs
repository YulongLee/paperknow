import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {database} from '../backend/database.mjs';
import {paymentCatalog,savePaymentProduct} from '../backend/payment-settings.mjs';
import {createBillingService} from '../backend/billing-service.mjs';
import {commercialOffers,commercialMemberOffers,commercialBundleOffers,commercialToolPricingPresets} from '../dist/workspace/commercial-offers.mjs';
import {commercialProductRules,seedCommercialOffers,planCommercialOffers,applyCommercialOffers} from '../backend/commercial-offers.mjs';
import {configureCommercialOffers,parseCommercialArguments} from '../scripts/configure-commercial-offers.mjs';

function fixture(t){const dir=mkdtempSync(join(tmpdir(),'paperknow-commercial-')),path=join(dir,'catalog.sqlite'),db=database(path);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});return {db,path,dir};}
const row=(db,id)=>db.prepare('SELECT id,title,status,rules FROM products WHERE id=?').get(id);
const catalogue=db=>db.prepare('SELECT id,title,status,rules FROM products ORDER BY id').all();

test('launch membership prices, periods and exact scoped quotas match the approved six offers',()=>{
 assert.deepEqual(commercialMemberOffers.map(({id,title,priceCents,durationDays,totalUses})=>({id,title,priceCents,durationDays,totalUses})),[
  {id:'basic',title:'轻享会员',priceCents:1990,durationDays:30,totalUses:30},
  {id:'advanced',title:'进阶会员',priceCents:3990,durationDays:30,totalUses:65},
  {id:'premium',title:'专业会员',priceCents:6990,durationDays:30,totalUses:120}
 ]);
 assert.deepEqual(commercialBundleOffers.map(item=>[item.id,item.priceCents,item.durationDays,item.totalUses]),[['bundle-reading',990,90,12],['bundle-polishing',1990,90,25],['bundle-presentation',2990,90,28]]);
 assert.equal(new Set(commercialOffers.map(item=>item.id)).size,6);
 for(const offer of commercialOffers){const items=offer.membershipItems||offer.bundleItems;assert.equal(offer.status,'preview');assert.equal(offer.totalUses,items.reduce((sum,item)=>sum+item.quantity,0));assert.equal(items.length,new Set(items.map(item=>item.key)).size);assert.ok(items.every(item=>Number.isSafeInteger(item.quantity)&&item.quantity>0));assert.ok(items.every(item=>!['agent','similarity-check','aigc-check'].includes(item.key)&&!item.key.startsWith('thesis-')));assert.match(offer.description,/不自动续费/);assert.match(offer.description,/整篇论文生成/);}
 assert.deepEqual(commercialToolPricingPresets.map(item=>[item.key,item.creditCost]),[['presentation-ai',50],['presentation-proposal',50],['presentation-thesis',50]]);
 assert.throws(()=>commercialMemberOffers[0].membershipItems[0].quantity=999,TypeError);
 assert.throws(()=>commercialOffers.push({}),TypeError);
});

test('database seeds the six complete offers as preview without changing payment channels or prices of credits',t=>{
 const {db}=fixture(t),catalog=paymentCatalog(db,{all:true});
 for(const offer of commercialOffers){const actual=catalog.find(item=>item.id===offer.id);assert.equal(actual.status,'preview');assert.equal(actual.title,offer.title);assert.equal(actual.priceCents,offer.priceCents);assert.equal(actual.durationDays,offer.durationDays);assert.deepEqual(actual.membershipItems||[],offer.membershipItems||[]);assert.deepEqual(actual.bundleItems||[],offer.bundleItems||[]);assert.equal(JSON.parse(row(db,offer.id).rules).paymentEnabled,false);}
 assert.ok(paymentCatalog(db).every(item=>item.entitlementType==='credits'));
 assert.deepEqual(paymentCatalog(db).map(item=>[item.id,item.priceCents,item.creditAmount]),[['credits-200',2000,200],['credits-500',5000,500],['credits-1000',10000,1000]]);
 assert.equal(db.prepare('SELECT count(*) n FROM payment_channels').get().n,0);
 assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,0);
});

test('only an exact untouched legacy member seed is upgraded, preserving merchant changes and historical data',t=>{
 const {db}=fixture(t),oldRules=JSON.stringify({unit:null,quota:null,duration:null,paymentEnabled:false});
 db.prepare('UPDATE products SET title=?,status=?,rules=? WHERE id=?').run('基础会员','preview',oldRules,'basic');
 db.prepare('UPDATE products SET title=?,status=?,rules=? WHERE id=?').run('进阶会员','preview',JSON.stringify({unit:null,quota:null,duration:null,paymentEnabled:false,merchantNote:'保留'}),'advanced');
 savePaymentProduct(db,'premium',{title:'管理员定价',description:'管理员明确配置的实际权益',priceCents:8888,durationDays:14,status:'active',membershipItems:[{key:'polish',title:'已售润色',quantity:3}]});
 const custom=[row(db,'advanced'),row(db,'premium')],beforeCredits=row(db,'credits-200');
 seedCommercialOffers(db);seedCommercialOffers(db);
 assert.equal(row(db,'basic').title,'轻享会员');assert.equal(row(db,'basic').status,'preview');
 assert.deepEqual([row(db,'advanced'),row(db,'premium')],custom);assert.deepEqual(row(db,'credits-200'),beforeCredits);
});

test('read-only plan does not change any row and detects custom targets without applying recommendations',t=>{
 const {db}=fixture(t);db.prepare("UPDATE products SET title='自定义会员' WHERE id='basic'").run();
 const before=catalogue(db),plan=planCommercialOffers(db);
 assert.equal(plan.publish,false);assert.match(plan.expected,/^[a-f0-9]{64}$/);assert.equal(plan.products.length,6);assert.equal(plan.products.find(item=>item.id==='basic').customized,true);assert.equal(plan.products.find(item=>item.id==='advanced').customized,false);assert.deepEqual(catalogue(db),before);
 assert.deepEqual(plan.toolPricingPresets,commercialToolPricingPresets);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='tool_pricing_policy'").get().n,0);
});

test('explicit publish is bound to the exact reviewed target and current catalogue state',t=>{
 const {db}=fixture(t),preview=planCommercialOffers(db),published=planCommercialOffers(db,{publish:true});
 assert.notEqual(preview.expected,published.expected);
 assert.throws(()=>applyCommercialOffers(db,{publish:true,expected:preview.expected}),{status:409});
 assert.throws(()=>applyCommercialOffers(db,{publish:true}),{status:400});
 const applied=applyCommercialOffers(db,{publish:true,expected:published.expected});assert.equal(applied.applied,true);assert.deepEqual(applied.changedProducts,commercialOffers.map(item=>item.id));
 assert.ok(commercialOffers.every(item=>row(db,item.id).status==='active'));
 assert.throws(()=>applyCommercialOffers(db,{publish:true,expected:published.expected}),{status:409});
 const repeat=planCommercialOffers(db,{publish:true});assert.deepEqual(applyCommercialOffers(db,{publish:true,expected:repeat.expected}).changedProducts,[]);
});

test('concurrent administrator edits invalidate the whole manifest rather than partially overwriting prices',t=>{
 const {db,path}=fixture(t),plan=planCommercialOffers(db,{publish:true});
 const other=new DatabaseSync(path);other.prepare("UPDATE products SET title='管理员的新编辑' WHERE id='advanced'").run();other.close();
 const before=catalogue(db);assert.throws(()=>applyCommercialOffers(db,{expected:plan.expected,publish:true}),{status:409});assert.deepEqual(catalogue(db),before);
 const refreshed=planCommercialOffers(db,{publish:true});assert.equal(refreshed.products.find(item=>item.id==='advanced').customized,true);applyCommercialOffers(db,{expected:refreshed.expected,publish:true});assert.equal(row(db,'advanced').title,'进阶会员');
});

test('write error rolls back all six catalogue changes and leaves unrelated products intact',t=>{
 const {db}=fixture(t),before=catalogue(db),plan=planCommercialOffers(db,{publish:true});
 db.exec("CREATE TRIGGER reject_offer BEFORE UPDATE ON products WHEN NEW.id='bundle-polishing' BEGIN SELECT RAISE(ABORT,'test write failure'); END");
 assert.throws(()=>applyCommercialOffers(db,{expected:plan.expected,publish:true}),/test write failure/);assert.deepEqual(catalogue(db),before);assert.equal(db.isTransaction,false);
});

test('catalogue publication preserves every historical payment, entitlement, balance and configured tool price',t=>{
 const {db}=fixture(t),now='2026-10-18T00:00:00.000Z',end='2026-12-18T00:00:00.000Z',user='commercial-owner';
 db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user,'商业化测试账户','user',now);
 db.prepare('INSERT INTO payment_config_versions(id,provider,sealed_settings,identity_hash,created_by,created_at) VALUES(?,?,?,?,?,?)').run('history-config','wechat','test-sealed-placeholder','history-identity',user,now);
 db.prepare('INSERT INTO payment_channels VALUES(?,?,?,?)').run('wechat','history-config',0,now);
 for(const [id,productId,type] of [['history-member','basic','membership'],['history-bundle','bundle-reading','bundle'],['history-credit','credits-200','credits']]){
  const items=[{key:'polish',title:'购买当时的润色服务',quantity:3}],entitlement=type==='credits'?{type,creditAmount:200}:{type,durationDays:61,[type==='membership'?'membershipItems':'bundleItems']:items};
  db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,user,productId,'paid',now);
  db.prepare('INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,title,entitlement,idempotency_key,input_hash,user_id,expires_at,paid_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'wechat',id,'history-config',8800,'购买当时的商品标题',JSON.stringify(entitlement),id,id,user,end,now,now);
  if(type==='credits')db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(id,user,productId,200,'purchase',now);
  else if(type==='membership')db.prepare('INSERT INTO payment_entitlements VALUES(?,?,?,?,?,?,?)').run(id,user,productId,type,now,end,now);
  else db.prepare('INSERT INTO payment_bundle_entitlements VALUES(?,?,?,?,?,?,?)').run(id,user,productId,now,end,now,JSON.stringify(items));
 }
 const billing=createBillingService(db),rules=billing.toolRules();billing.saveToolRules({version:rules.version,services:rules.services.map(item=>({key:item.key,mode:item.key==='presentation-ai'?'paid':'inherit',creditCost:item.key==='presentation-ai'?17:null}))});
 const tables=['orders','payment_orders','payment_entitlements','payment_bundle_entitlements','payment_credit_ledger','payment_channels','payment_config_versions','billing_policy','tool_pricing_policy'];
 const snapshot=()=>Object.fromEntries(tables.map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));
 const before=snapshot(),plan=planCommercialOffers(db,{publish:true});applyCommercialOffers(db,{expected:plan.expected,publish:true});seedCommercialOffers(db);assert.deepEqual(snapshot(),before);
});

test('manifest inserts only a reviewed missing launch SKU and seeding cannot replace a malformed merchant row',t=>{
 const {db}=fixture(t);db.prepare("DELETE FROM products WHERE id='bundle-reading'").run();db.prepare("UPDATE products SET rules='merchant malformed rules' WHERE id='basic'").run();
 seedCommercialOffers(db);assert.equal(row(db,'basic').rules,'merchant malformed rules');
 db.prepare("DELETE FROM products WHERE id='bundle-reading'").run();const plan=planCommercialOffers(db,{publish:true});assert.equal(plan.products.find(item=>item.id==='bundle-reading').before,null);assert.equal(plan.products.find(item=>item.id==='basic').customized,true);
 applyCommercialOffers(db,{expected:plan.expected,publish:true});assert.equal(row(db,'bundle-reading').status,'active');assert.equal(JSON.parse(row(db,'basic').rules).priceCents,1990);
});

test('initialization remains repeatable after explicit publishing and never resets merchant-edited pricing',t=>{
 const {db,path}=fixture(t),plan=planCommercialOffers(db,{publish:true});applyCommercialOffers(db,{expected:plan.expected,publish:true});
 db.prepare("UPDATE products SET rules=? WHERE id='bundle-reading'").run(JSON.stringify({...commercialProductRules(commercialBundleOffers[0],{publish:true}),priceCents:1234}));
 const before=catalogue(db),second=database(path);assert.deepEqual(catalogue(second),before);second.close();
});

test('CLI validates absolute existing databases and separates dry-run, apply, and publish',()=>{
 assert.equal(parseCommercialArguments(['--database','/tmp/catalog.sqlite']).apply,false);
 assert.equal(parseCommercialArguments(['--database','/tmp/catalog.sqlite','--publish']).publish,true);
 for(const args of [[],['--database',':memory:'],['--database','relative.sqlite'],['--database','/tmp/catalog.sqlite','--apply'],['--database','/tmp/catalog.sqlite','--expected','bad'],['--database','/tmp/catalog.sqlite','--apply','--expected','a'.repeat(64),'--publish','--publish'],['--database','/tmp/catalog.sqlite','--backup','/tmp/backup.sqlite']])assert.throws(()=>parseCommercialArguments(args));
});

test('CLI dry-run leaves the database unchanged; explicit apply creates a private full backup including WAL data',t=>{
 const {db,path,dir}=fixture(t);db.prepare("UPDATE products SET title='审核前的管理员标题' WHERE id='basic'").run();
 const before=catalogue(db),plan=configureCommercialOffers(['--database',path,'--publish']);assert.equal(plan.applied,false);assert.deepEqual(catalogue(db),before);
 const backup=join(dir,'before.sqlite'),applied=configureCommercialOffers(['--database',path,'--publish','--apply','--expected',plan.expected,'--backup',backup]);assert.equal(applied.backup,backup);assert.equal(statSync(backup).mode&0o777,0o600);
 const snapshot=new DatabaseSync(backup,{readOnly:true});assert.deepEqual(catalogue(snapshot),before);snapshot.close();
 assert.equal(row(db,'basic').status,'active');assert.equal(row(db,'basic').title,'轻享会员');
 assert.throws(()=>configureCommercialOffers(['--database',path,'--apply','--expected',plan.expected,'--backup',backup]),/已变化/);
});
