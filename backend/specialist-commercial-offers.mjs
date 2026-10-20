import {createHash} from 'node:crypto';
import {specialistOffersForDuration,specialistBundleDurationDays,specialistLaunchVersion} from '../dist/workspace/specialist-commercial-offers.mjs';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const select=(db,id)=>db.prepare('SELECT id,title,status,rules FROM products WHERE id=?').get(id)||null;
export function specialistProductRules(offer,{publish=false}={}){
 return {priceCents:offer.priceCents,durationDays:offer.durationDays,bundleItems:offer.bundleItems.map(item=>({...item})),description:offer.description,entitlementType:'bundle',paymentEnabled:publish};
}
function targetRows(durationDays,publish){return specialistOffersForDuration(durationDays).map(offer=>({id:offer.id,title:offer.title,status:publish?'active':'preview',rules:JSON.stringify(specialistProductRules(offer,{publish}))}));}
export function planSpecialistOffers(db,{publish=false,durationDays=specialistBundleDurationDays}={}){
 if(typeof publish!=='boolean')fail(400,'上架标记必须为布尔值');
 let targets;try{targets=targetRows(durationDays,publish);}catch{fail(400,'套餐有效期应为 1～366 天的整数');}
 const products=targets.map(after=>{
  const before=select(db,after.id);
  return {id:after.id,before,after,changed:!before||before.title!==after.title||before.status!==after.status||before.rules!==after.rules};
 });
 const expected=hash({launchVersion:specialistLaunchVersion,publish,durationDays,products:products.map(({before,after})=>({before,after}))});
 return {launchVersion:specialistLaunchVersion,publish,durationDays,expected,products,notes:['仅修改列出的七个专项套餐；会员、科研辅助套餐、历史订单、已购权益、积分和支付渠道不变。','发布的服务清单使用真实计费标识；上架后仍由服务端核对服务可用性和付款渠道。','两项检测权益使用 PaperKnow 自有来源比对与文本鉴别，不冒充第三方数据库报告。']};
}
export function applySpecialistOffers(db,{expected,publish=false,durationDays=specialistBundleDurationDays}={}){
 if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))fail(400,'请先预览并传入完整的 --expected 确认哈希');
 if(db.isTransaction)fail(409,'商品发布需要独立事务');
 db.exec('BEGIN IMMEDIATE');
 try{
  const plan=planSpecialistOffers(db,{publish,durationDays});
  if(plan.expected!==expected)fail(409,'商品目录或目标方案已变化，请重新预览并确认');
  for(const {before,after,changed} of plan.products){
   if(!changed)continue;
   if(!before){db.prepare('INSERT INTO products(id,title,status,rules) VALUES(?,?,?,?)').run(after.id,after.title,after.status,after.rules);continue;}
   const result=db.prepare('UPDATE products SET title=?,status=?,rules=? WHERE id=? AND title=? AND status=? AND rules=?').run(after.title,after.status,after.rules,before.id,before.title,before.status,before.rules);
   if(result.changes!==1)fail(409,'商品目录已变化，全部修改已回滚');
  }
  db.exec('COMMIT');return {...plan,applied:true,changedProducts:plan.products.filter(item=>item.changed).map(item=>item.id)};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
