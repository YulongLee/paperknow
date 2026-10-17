import {createHash} from 'node:crypto';
import {commercialOffers,commercialLaunchVersion,commercialToolPricingPresets} from '../dist/workspace/commercial-offers.mjs';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const legacyMemberTitles={basic:'基础会员',advanced:'进阶会员',premium:'尊享会员'};
const legacyRules={unit:null,quota:null,duration:null,paymentEnabled:false};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const sameLegacyRules=value=>{const parsed=parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&Object.keys(parsed).length===4&&Object.entries(legacyRules).every(([key,value])=>Object.hasOwn(parsed,key)&&parsed[key]===value);};

export function commercialProductRules(offer,{publish=false}={}){
 const type=offer.entitlementType,key=type==='membership'?'membershipItems':'bundleItems';
 return {priceCents:offer.priceCents,durationDays:offer.durationDays,[key]:offer[key].map(item=>({...item})),description:offer.description,entitlementType:type,paymentEnabled:publish};
}
const targetRows=publish=>commercialOffers.map(offer=>({id:offer.id,title:offer.title,status:publish?'active':'preview',rules:JSON.stringify(commercialProductRules(offer,{publish}))}));
const select=(db,id)=>db.prepare('SELECT id,title,status,rules FROM products WHERE id=?').get(id)||null;
const untouchedLegacy=row=>Boolean(row&&row.status==='preview'&&row.title===legacyMemberTitles[row.id]&&sameLegacyRules(row.rules));

// Startup only fills new preview SKUs or the exact untouched historical seed.
// It never publishes products or rewrites a merchant-edited row or payment data.
export function seedCommercialOffers(db){
 const insert=db.prepare('INSERT OR IGNORE INTO products(id,title,status,rules) VALUES(?,?,?,?)');
 const update=db.prepare('UPDATE products SET title=?,status=?,rules=? WHERE id=? AND title=? AND status=? AND rules=?');
 for(const next of targetRows(false)){
  const previous=select(db,next.id);
  if(!previous){insert.run(next.id,next.title,next.status,next.rules);continue;}
  if(untouchedLegacy(previous))update.run(next.title,next.status,next.rules,next.id,previous.title,previous.status,previous.rules);
 }
}

export function planCommercialOffers(db,{publish=false}={}){
 if(typeof publish!=='boolean')fail(400,'上架标记必须为布尔值');
 const products=targetRows(publish).map(after=>{
  const before=select(db,after.id),preview=targetRows(false).find(item=>item.id===after.id);
  const isSeed=!before||untouchedLegacy(before)||before.title===preview.title&&before.status===preview.status&&before.rules===preview.rules;
  return {id:after.id,before,after,customized:!isSeed,changed:!before||before.title!==after.title||before.status!==after.status||before.rules!==after.rules};
 });
 // Bind confirmation to both the six current rows and their exact target state.
 // Unrelated products, credentials, balances and history are outside this scope.
 const expected=hash({launchVersion:commercialLaunchVersion,publish,products:products.map(({before,after})=>({before,after}))});
 return {launchVersion:commercialLaunchVersion,publish,expected,products,toolPricingPresets:commercialToolPricingPresets.map(item=>({...item})),notes:['仅修改列出的六个商品；历史订单、会员、套餐、积分、支付渠道不变。','工具价格仅为独立建议，此操作不修改计费策略。','上架后仍由服务端核对渠道、服务可用性与交付规则。']};
}

export function applyCommercialOffers(db,{expected,publish=false}={}){
 if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))fail(400,'请先预览并传入完整的 --expected 确认哈希');
 if(db.isTransaction)fail(409,'商品发布需要独立事务');
 db.exec('BEGIN IMMEDIATE');
 try{
  const plan=planCommercialOffers(db,{publish});
  if(plan.expected!==expected)fail(409,'商品目录或目标方案已变化，请重新预览并确认');
  for(const {before,after,changed} of plan.products){
   if(!changed)continue;
   if(!before){db.prepare('INSERT INTO products(id,title,status,rules) VALUES(?,?,?,?)').run(after.id,after.title,after.status,after.rules);continue;}
   const result=db.prepare('UPDATE products SET title=?,status=?,rules=? WHERE id=? AND title=? AND status=? AND rules=?').run(after.title,after.status,after.rules,before.id,before.title,before.status,before.rules);
   if(result.changes!==1)fail(409,'商品目录已变化，全部修改已回滚');
  }
  db.exec('COMMIT');
  return {...plan,applied:true,changedProducts:plan.products.filter(item=>item.changed).map(item=>item.id)};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
