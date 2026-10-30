import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import {validateProvider} from './payment-providers.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export const paymentProviders=['wechat','alipay'];
const fields={wechat:['appId','merchantId','merchantSerial','platformPublicKeyId'],alipay:['appId','sellerId']};
const secrets={wechat:['privateKey','apiV3Key','platformPublicKey'],alipay:['privateKey','alipayPublicKey']};
export const paymentNotifyURL=provider=>`https://paperknow.cn/api/payments/notify/${provider}`;
export function createPaymentSettings(db,config={}){
 let key;
 try{if(typeof config.paymentConfigKey==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(config.paymentConfigKey)){const decoded=Buffer.from(config.paymentConfigKey,'base64');if(decoded.length===32&&decoded.toString('base64')===config.paymentConfigKey)key=decoded;}}catch{}
 function seal(value,provider,id){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(provider+':'+id));const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});}
 function open(row){if(!key)fail(503,'支付配置加密密钥尚未配置');try{const data=JSON.parse(row.sealed_settings);if(data.v!==1)throw 0;const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(data.iv,'base64'));cipher.setAAD(Buffer.from(row.provider+':'+row.id));cipher.setAuthTag(Buffer.from(data.tag,'base64'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data.data,'base64')),cipher.final()]).toString());}catch{fail(503,'支付配置暂时无法读取，请联系管理员');}}
 function version(id){const row=db.prepare('SELECT * FROM payment_config_versions WHERE id=?').get(id);if(!row)fail(503,'支付渠道配置不存在');return {id:row.id,provider:row.provider,settings:open(row)};}
 function current(provider){if(!paymentProviders.includes(provider))fail(400,'不支持的支付渠道');const channel=db.prepare('SELECT * FROM payment_channels WHERE provider=?').get(provider);if(!channel)return {provider,enabled:false,settings:{}};return {...version(channel.version_id),enabled:channel.enabled===1};}
 function summary(provider){let item;try{item=current(provider);}catch{return {provider,enabled:false,ready:false,configured:false,fields:{},secretFields:{},validation:[{field:'configuration',message:'支付配置暂时无法读取'}],notifyUrl:paymentNotifyURL(provider)};}
 const validation=validateProvider(provider,item.settings);if(!key)validation.unshift({field:'encryption',message:'服务器支付配置加密密钥未就绪'});
 return {provider,enabled:item.enabled,ready:item.enabled&&validation.length===0,configured:validation.length===0,fields:Object.fromEntries(fields[provider].map(name=>[name,item.settings[name]||''])),secretFields:Object.fromEntries(secrets[provider].map(name=>[name,Boolean(item.settings[name])])),validation,notifyUrl:paymentNotifyURL(provider)};}
 function save(provider,input,actor){
 if(!paymentProviders.includes(provider))fail(400,'不支持的支付渠道');if(!key)fail(503,'服务器支付配置加密密钥未就绪，暂不能保存商户密钥');
 const allowed=new Set(['enabled','clearSecrets',...fields[provider],...secrets[provider]]);
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.has(k))||typeof input.enabled!=='boolean')fail(400,'支付配置字段不正确');
 if(input.clearSecrets!==undefined&&(!Array.isArray(input.clearSecrets)||input.clearSecrets.some(k=>!secrets[provider].includes(k))))fail(400,'清除密钥字段不正确');
 const previous=current(provider),value={...previous.settings};
 for(const name of [...fields[provider],...secrets[provider]]){if(!Object.hasOwn(input,name))continue;if(typeof input[name]!=='string'||input[name].length>(secrets[provider].includes(name)?16384:200)||input[name].includes('\0'))fail(400,'支付配置内容格式不正确');const entered=input[name].replace(/\r\n/g,'\n').trim();if(fields[provider].includes(name)||entered)value[name]=entered;}
 for(const name of input.clearSecrets||[])delete value[name];
 const validation=validateProvider(provider,value);if(input.enabled&&validation.length)fail(400,'请补齐并检查商户参数后再启用渠道');
 const id=randomUUID(),at=new Date().toISOString(),identityHash=createHash('sha256').update(JSON.stringify([provider,value.appId||'',value.merchantId||value.sellerId||''])).digest('hex');db.prepare('INSERT INTO payment_config_versions(id,provider,sealed_settings,identity_hash,verification_id,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(id,provider,seal(value,provider,id),identityHash,provider==='wechat'?value.platformPublicKeyId||'':null,actor,at);
 db.prepare('INSERT INTO payment_channels(provider,version_id,enabled,updated_at) VALUES(?,?,?,?) ON CONFLICT(provider) DO UPDATE SET version_id=excluded.version_id,enabled=excluded.enabled,updated_at=excluded.updated_at').run(provider,id,input.enabled?1:0,at);
 return summary(provider);
 }
 function versions(provider,{verificationId,identityConfigId,limit}={}){
 if(!paymentProviders.includes(provider)||!key)return [];
 const values=[provider],extra=[];
 if(verificationId!==undefined){extra.push('v.verification_id=?');values.push(verificationId);}
 if(identityConfigId){extra.push('v.identity_hash=(SELECT identity_hash FROM payment_config_versions WHERE id=?)');values.push(identityConfigId);}
 // A credential rotation may never create a new order before the administrator
 // switches merchants. Keep all complete credentials for identities with orders,
 // rather than only versions that an order references directly.
 const rows=db.prepare(`SELECT v.* FROM payment_config_versions v WHERE v.provider=? AND (
 v.id=(SELECT version_id FROM payment_channels WHERE provider=v.provider)
 OR EXISTS(SELECT 1 FROM payment_orders o JOIN payment_config_versions original ON original.id=o.config_id WHERE original.provider=v.provider AND original.identity_hash=v.identity_hash)
 )${extra.length?' AND '+extra.join(' AND '):''} ORDER BY v.created_at DESC,v.rowid DESC`).iterate(...values);
 const result=[],maximum=Number.isSafeInteger(limit)&&limit>0?limit:Infinity;
 for(const row of rows){
  try{const value=open(row);if(validateProvider(provider,value).length)continue;result.push({id:row.id,provider,settings:value});}
  catch{continue;}
  if(result.length>=maximum)break;
 }
 return result;
 }
 return {encryptionReady:Boolean(key),current,version,summary,save,versions};
}
export function paymentBundleItems(value,{allowEmpty=false}={}){
 if(!Array.isArray(value)||value.length>(20)||!allowEmpty&&!value.length)return null;
 const keys=new Set(),items=[];
 for(const item of value){
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['key','title','quantity'].includes(key))||typeof item.key!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(item.key)||keys.has(item.key)||typeof item.title!=='string'||!item.title.trim()||item.title.length>80||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>100000)return null;
  keys.add(item.key);items.push({key:item.key,title:item.title.trim(),quantity:item.quantity});
 }
 return items;
}
export function paymentCatalog(db,{all=false}={}){
 return db.prepare('SELECT * FROM products ORDER BY id').all().flatMap(p=>{
  let rules;try{rules=JSON.parse(p.rules);}catch{}if(!rules||typeof rules!=='object'||Array.isArray(rules))rules={};
  const priceCents=Number.isSafeInteger(rules.priceCents)&&rules.priceCents>0&&rules.priceCents<=10000000?rules.priceCents:null;
  const entitlementType=rules.entitlementType||'membership',durationDays=['membership','bundle'].includes(entitlementType)&&Number.isSafeInteger(rules.durationDays)?rules.durationDays:null;
  const creditAmount=entitlementType==='credits'&&Number.isSafeInteger(rules.creditAmount)&&rules.creditAmount>0&&rules.creditAmount<=1000000?rules.creditAmount:null;
  const bundleItems=entitlementType==='bundle'?paymentBundleItems(rules.bundleItems,{allowEmpty:true}):[];
  const membershipItems=entitlementType==='membership'?paymentBundleItems(rules.membershipItems||[],{allowEmpty:true}):[];
  const validDuration=durationDays>=1&&durationDays<=366,validEntitlement=entitlementType==='membership'?validDuration:entitlementType==='credits'?creditAmount!==null:entitlementType==='bundle'&&validDuration&&Boolean(bundleItems?.length);
  const description=typeof rules.description==='string'?rules.description:'';
  const active=p.status==='active'&&priceCents!==null&&validEntitlement&&Boolean(description.trim());
  if(!all&&!active)return [];
  const scope=rules.scope&&typeof rules.scope==='object'&&!Array.isArray(rules.scope)?rules.scope:null;
  const entitlementBase=entitlementType==='credits'?{type:'credits',creditAmount}:entitlementType==='bundle'?{type:'bundle',durationDays,bundleItems:bundleItems||[]}:{type:'membership',durationDays,membershipItems:membershipItems||[]};
  const entitlement={...entitlementBase,...(scope?{scope}:{})};
  return [{id:p.id,title:p.title,status:active?'active':'preview',priceCents,currency:'CNY',description,durationDays,creditAmount,bundleItems:bundleItems||[],membershipItems:membershipItems||[],entitlementType,entitlement,...(scope?{scope}:{})}];
 }).sort((a,b)=>{
  const group={membership:0,credits:1,bundle:2};
  if(a.entitlementType!==b.entitlementType)return (group[a.entitlementType]??3)-(group[b.entitlementType]??3);
  return a.entitlementType==='credits'?(a.creditAmount??Infinity)-(b.creditAmount??Infinity)||a.id.localeCompare(b.id):a.id.localeCompare(b.id);
 });
}
export function savePaymentProduct(db,id,input){
 const current=db.prepare('SELECT rules FROM products WHERE id=?').get(id);if(!current)fail(404,'商品不存在');
 const allowed=['title','description','priceCents','durationDays','status','entitlementType','creditAmount','bundleItems','membershipItems'];if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k))||typeof input.title!=='string'||!input.title.trim()||input.title.length>80||typeof input.description!=='string'||input.description.length>1000||!['preview','active'].includes(input.status))fail(400,'商品信息不正确');
 let previous;try{previous=JSON.parse(current.rules);}catch{}const previousType=previous?.entitlementType||'membership',type=input.entitlementType??previousType;
 if(!['membership','credits','bundle'].includes(type)||type!==previousType)fail(400,'商品权益类型不能变更');
 const price=input.priceCents,days=input.durationDays,creditAmount=type==='credits'?input.creditAmount:null;
 const bundleItems=type==='bundle'?paymentBundleItems(input.bundleItems,{allowEmpty:input.status==='preview'}):[];
 const membershipItems=type==='membership'?paymentBundleItems(input.membershipItems??previous?.membershipItems??[],{allowEmpty:true}):[];
 if(!membershipItems)fail(400,'会员服务额度格式不正确');
 if(type!=='membership'&&input.membershipItems!==undefined&&(!Array.isArray(input.membershipItems)||input.membershipItems.length))fail(400,'只有会员商品可以配置会员服务额度');
 if(price!==null&&(!Number.isSafeInteger(price)||price<1||price>10000000))fail(400,'请输入有效的商品价格，单位为分');
 if(type!=='bundle'&&input.bundleItems!==undefined&&(!Array.isArray(input.bundleItems)||input.bundleItems.length))fail(400,'只有套餐商品可以配置服务清单');
 if(type==='membership'||type==='bundle'){
  if(days!==null&&(!Number.isSafeInteger(days)||days<1||days>366))fail(400,type==='bundle'?'套餐有效期应为 1～366 天':'会员有效期应为 1～366 天');
  if(input.creditAmount!==undefined&&input.creditAmount!==null)fail(400,'会员和套餐商品不能配置充值积分');
  if(type==='bundle'&&!bundleItems)fail(400,'套餐需配置 1～20 项服务，服务标识唯一，数量为 1～100000 的整数');
 }else{
  if(days!==null)fail(400,'积分商品不配置会员有效期');
  if(creditAmount!==null&&(!Number.isSafeInteger(creditAmount)||creditAmount<1||creditAmount>1000000))fail(400,'充值积分应为 1～1000000 的整数');
 }
 if(input.status==='active'&&(!price||!(type==='credits'?creditAmount:days)||!input.description.trim()))fail(400,'上架前请明确价格、可交付权益及数量或有效期');
 db.prepare('UPDATE products SET title=?,status=?,rules=? WHERE id=?').run(input.title.trim(),input.status,JSON.stringify({...((previous?.scope&&typeof previous.scope==='object')?{scope:previous.scope}:{}),priceCents:price,durationDays:type==='credits'?null:days,...(type==='credits'?{creditAmount}:type==='bundle'?{bundleItems}:{membershipItems}),description:input.description.trim(),entitlementType:type,paymentEnabled:input.status==='active'}),id);
 return paymentCatalog(db,{all:true}).find(p=>p.id===id);
}
