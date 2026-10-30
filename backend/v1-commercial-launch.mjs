import {createHash} from 'node:crypto';
import {v1MemberOffers,v1CommercialVersion,v1PriceFor} from '../dist/workspace/v1-pricing.mjs';
import {specialistBundleOffers} from '../dist/workspace/specialist-commercial-offers.mjs';
import {createBillingService} from './billing-service.mjs';
export function planV1Commerce(db){
 const billing=createBillingService(db,{}),current= db.prepare('SELECT id,title,status,rules FROM products ORDER BY id').all().map(r=>({...r}));
 const target=new Map(current.map(r=>[r.id,{...r}]));
 for(const id of ['basic','advanced','premium','bundle-reading','bundle-polishing','bundle-presentation']){const old=target.get(id);if(old)target.set(id,{...old,status:'preview',rules:JSON.stringify({...JSON.parse(old.rules),paymentEnabled:false})});}
 for(const offer of [...v1MemberOffers,...specialistBundleOffers]){
  const member=offer.entitlementType==='membership',writing=offer.group==='writing',conditional=['bundle-master','bundle-doctor'].includes(offer.id),maxWords=({'bundle-junior':8000,'bundle-bachelor':12000,'bundle-master':30000,'bundle-doctor':50000})[offer.id];
  const scope=member?{version:v1CommercialVersion,maxLocalChars:3000}:writing?{version:v1CommercialVersion,maxTargetWords:maxWords,maxLocalChars:3000,maxSlides:20}:{version:v1CommercialVersion,maxRevisionChars:10000,maxLocalChars:3000};
  const description=member?offer.description:offer.description+(writing?`论文目标最多 ${maxWords.toLocaleString('zh-CN')} 字；局部修改每次最多 3,000 字符；两份 PPT 分别最多 20 页。`:'单项检测最多 20,000 字符；整篇优化最多 10,000 字符；局部修改每次最多 3,000 字符。');
  target.set(offer.id,{id:offer.id,title:offer.title,status:conditional?'preview':'active',rules:JSON.stringify({priceCents:offer.priceCents,durationDays:offer.durationDays,entitlementType:offer.entitlementType,description,scope,[member?'membershipItems':'bundleItems']:offer[member?'membershipItems':'bundleItems'],paymentEnabled:!conditional})});
 }
 const policy=billing.toolRules(),next=policy.services.map(({key,mode,creditCost})=>{const cost=v1PriceFor(key);return cost===undefined?{key,mode,creditCost}:{key,mode:cost===0?'free':'paid',creditCost:cost===0?null:cost};});
 const base=billing.rules(),baseNext=base.services.map(({key})=>({key,mode:'paid',creditCost:10}));
 const products=[...target.values()].filter(row=>JSON.stringify(row)!==JSON.stringify(current.find(c=>c.id===row.id)));
 const payload={version:v1CommercialVersion,products,toolPolicy:{version:policy.version,services:next},basePolicy:{version:base.version,services:baseNext}};
 const expected=createHash('sha256').update(JSON.stringify({current,oldTools:policy,oldBase:base,payload})).digest('hex');
 return {...payload,expected};
}
export function applyV1Commerce(db,expected){
 db.exec('BEGIN IMMEDIATE');try{const plan=planV1Commerce(db);if(plan.expected!==expected)throw Error('商品或价格已变化，请重新预览');
 for(const row of plan.products)db.prepare('INSERT INTO products(id,title,status,rules) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,status=excluded.status,rules=excluded.rules').run(row.id,row.title,row.status,row.rules);
 const billing=createBillingService(db,{});billing.saveRules(plan.basePolicy);billing.saveToolRules(plan.toolPolicy);
 db.exec('CREATE TABLE IF NOT EXISTS commercial_launches(version TEXT PRIMARY KEY,launched_at TEXT NOT NULL)');db.prepare('INSERT OR IGNORE INTO commercial_launches VALUES(?,?)').run(v1CommercialVersion,new Date().toISOString());
 db.exec('COMMIT');return plan;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
