import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createPaymentSettings,paymentBundleItems,paymentCatalog,paymentNotifyURL} from './payment-settings.mjs';
import {createProviderPayment,queryProviderPayment,parseProviderNotification,validateProvider,validateAlipayPaymentURL,deriveAlipayQRPaymentURL} from './payment-providers.mjs';
import {managedMemberships,adminCreditTotal,adminCreditLedger} from './admin-user-entitlements.mjs';
import {productDelivery} from './commerce-readiness.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const at=()=>new Date().toISOString();
const hash=value=>createHash('sha256').update(value).digest('hex');
const orderSelect=`SELECT o.*,d.provider,d.out_trade_no,d.config_id,d.amount_cents,d.currency,COALESCE(d.title,p.title) AS title,d.entitlement,d.idempotency_key,d.input_hash,d.qr_content,d.payment_url,d.provider_trade_no,d.expires_at,d.paid_at,d.updated_at,d.last_queried_at FROM orders o JOIN products p ON p.id=o.product_id LEFT JOIN payment_orders d ON d.order_id=o.id`;
const alipayReturnURL=id=>'https://paperknow.cn/api/payments/return/alipay?order='+encodeURIComponent(id);
function providerTitle(title){let value='';for(const char of title){if(Buffer.byteLength(value+char)>120)break;value+=char;}return value;}
export function createPaymentService(db,config={}){
 const settings=createPaymentSettings(db,config),queries=new Map();
 const adapters=config.paymentAdapters||{create:createProviderPayment,query:queryProviderPayment,notify:parseProviderNotification};
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 const get=id=>db.prepare(orderSelect+' WHERE o.id=?').get(id);
 const own=(id,user)=>{const order=get(id);if(!order||order.user_id!==user.id)fail(404,'订单不存在');return order;};
 const expire=userId=>db.prepare("UPDATE orders SET status='expired' WHERE user_id=? AND status='pending' AND id IN (SELECT order_id FROM payment_orders WHERE expires_at<=?)").run(userId,at());
 function providerOrder(order,channel){return {outTradeNo:order.out_trade_no,amountCents:order.amount_cents,title:providerTitle(order.title),notifyUrl:paymentNotifyURL(order.provider),expiresAt:order.expires_at,...(order.provider==='alipay'?{appId:channel.appId,sellerId:channel.sellerId,returnUrl:alipayReturnURL(order.id)}:{})};}
 function paymentURL(order){
  if(order.provider!=='alipay'||order.status!=='pending'||Date.parse(order.expires_at)<=Date.now())return null;
  try{const channel=settings.version(order.config_id);return validateAlipayPaymentURL(order.payment_url,providerOrder(order,channel.settings))?order.payment_url:null;}catch{return null;}
 }
 function paymentQRURL(order,url){
  if(!url)return null;
  try{const channel=settings.version(order.config_id);return deriveAlipayQRPaymentURL(url,channel.settings,providerOrder(order,channel.settings));}catch{return null;}
 }
 function publicOrder(order){const url=paymentURL(order);let snapshot;try{snapshot=JSON.parse(order.entitlement);}catch{}return {id:order.id,productId:order.product_id,outTradeNo:order.out_trade_no||order.id,status:order.status,amountCents:order.amount_cents??null,currency:order.currency||'CNY',title:order.title,provider:order.provider||null,entitlementType:snapshot?.type||null,creditAmount:snapshot?.type==='credits'?snapshot.creditAmount:null,durationDays:['membership','bundle'].includes(snapshot?.type)?snapshot.durationDays:null,bundleItems:snapshot?.type==='bundle'?paymentBundleItems(snapshot.bundleItems)||[]:[],...(snapshot?.type==='membership'?{membershipItems:paymentBundleItems(snapshot.membershipItems||[],{allowEmpty:true})||[]}:{}),qrContent:order.status==='pending'?order.qr_content||null:null,paymentUrl:url,paymentQrUrl:paymentQRURL(order,url),expiresAt:order.expires_at||null,createdAt:order.created_at,paidAt:order.paid_at||null};}
 function options(){const channels=['wechat','alipay'].map(provider=>({provider,label:provider==='wechat'?'微信支付':'支付宝',ready:settings.summary(provider).ready})),products=paymentCatalog(db).map(product=>({...product,...productDelivery(product,config.billing)}));return {enabled:channels.some(c=>c.ready)&&products.some(product=>product.purchasable!==false),channels,products,...(config.billing?{billing:config.billing.rules(),...(config.billing.toolRules?{toolBilling:config.billing.toolRules()}: {})}:{} )};}
 function identity(order,result,channel){
 const merchant=order.provider==='wechat'?channel.merchantId:channel.sellerId;
 if(!result||result.outTradeNo!==order.out_trade_no||!Number.isSafeInteger(result.amountCents)||result.amountCents!==order.amount_cents||result.currency!=='CNY'||result.merchantId!==merchant||result.appId!==channel.appId)fail(400,'支付通知与订单信息不匹配');
 if(!['paid','pending','closed','failed'].includes(result.state))fail(400,'支付状态不正确');
 if(result.state==='paid'&&(typeof result.providerTradeNo!=='string'||!result.providerTradeNo||result.providerTradeNo.length>128))fail(400,'支付交易号不正确');
 if(order.provider_trade_no&&result.providerTradeNo&&order.provider_trade_no!==result.providerTradeNo)fail(400,'支付交易号与原订单不匹配');
 if(result.paidAt&&(!Number.isFinite(Date.parse(result.paidAt))||Date.parse(result.paidAt)>Date.now()+300000))fail(400,'支付时间不正确');
 }
 function applyResult(order,result,channel){
 identity(order,result,channel);
 return transaction(()=>{
 const fresh=get(order.id);identity(fresh,result,channel);
 if(result.state==='paid'){
  if(fresh.status==='paid')return fresh;
  if(!['pending','expired'].includes(fresh.status))fail(409,'当前订单状态不能确认支付，请联系客服核对');
  let entitlement;try{entitlement=JSON.parse(fresh.entitlement);}catch{fail(500,'订单权益信息异常，请联系客服');}
  const validMembership=entitlement?.type==='membership'&&Number.isSafeInteger(entitlement.durationDays)&&entitlement.durationDays>=1&&entitlement.durationDays<=366;
  const validCredits=entitlement?.type==='credits'&&Number.isSafeInteger(entitlement.creditAmount)&&entitlement.creditAmount>=1&&entitlement.creditAmount<=1000000;
  const bundleItems=entitlement?.type==='bundle'?paymentBundleItems(entitlement.bundleItems):null;
  const validBundle=entitlement?.type==='bundle'&&Number.isSafeInteger(entitlement.durationDays)&&entitlement.durationDays>=1&&entitlement.durationDays<=366&&Boolean(bundleItems);
  if(!validMembership&&!validCredits&&!validBundle)fail(500,'订单权益信息异常，请联系客服');
  const now=at(),paidAt=result.paidAt?new Date(result.paidAt).toISOString():now;
  // The immutable order snapshot, never the current product price, drives fulfilment.
  if(validCredits){
   const balance=db.prepare('SELECT COALESCE(sum(amount),0) AS balance FROM payment_credit_ledger WHERE user_id=?').get(fresh.user_id).balance;
   const currentBalance=config.billing?config.billing.balance(fresh.user_id).balance:balance+adminCreditTotal(db,fresh.user_id);
   if(!Number.isSafeInteger(balance+entitlement.creditAmount)||!Number.isSafeInteger(currentBalance+entitlement.creditAmount))fail(500,'积分余额异常，请联系客服');
   db.prepare('INSERT INTO payment_credit_ledger(order_id,user_id,product_id,amount,kind,created_at) VALUES(?,?,?,?,?,?)').run(fresh.id,fresh.user_id,fresh.product_id,entitlement.creditAmount,'purchase',now);
  }else if(validBundle){
   const expiresAt=new Date(Date.parse(now)+entitlement.durationDays*86400000).toISOString();
   db.prepare('INSERT INTO payment_bundle_entitlements(order_id,user_id,product_id,starts_at,expires_at,granted_at,items) VALUES(?,?,?,?,?,?,?)').run(fresh.id,fresh.user_id,fresh.product_id,now,expiresAt,now,JSON.stringify(bundleItems));
  }else{
   // Renew after the effective paid term, including scheduled renewals. Account
   // overrides never rewrite issued grants, so their original dates cannot be
   // used here after a paid membership is shortened, extended or revoked.
   const previous=managedMemberships(db,fresh.user_id,now).filter(row=>row.origin==='payment'&&row.productId===fresh.product_id&&['active','scheduled'].includes(row.status)).reduce((until,row)=>row.expiresAt>until?row.expiresAt:until,now);
   const startsAt=previous&&previous>now?previous:now,expiresAt=new Date(Date.parse(startsAt)+entitlement.durationDays*86400000).toISOString();
   db.prepare('INSERT INTO payment_entitlements(order_id,user_id,product_id,type,starts_at,expires_at,granted_at) VALUES(?,?,?,?,?,?,?)').run(fresh.id,fresh.user_id,fresh.product_id,'membership',startsAt,expiresAt,now);
  }
  db.prepare('UPDATE payment_orders SET provider_trade_no=?,paid_at=?,updated_at=?,error_code=NULL WHERE order_id=?').run(result.providerTradeNo,paidAt,now,fresh.id);
  db.prepare("UPDATE orders SET status='paid' WHERE id=?").run(fresh.id);
 }else if(['closed','failed'].includes(result.state)&&fresh.status==='pending'){
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(result.state,fresh.id);
  db.prepare('UPDATE payment_orders SET updated_at=? WHERE order_id=?').run(at(),fresh.id);
 }
 return get(order.id);
 });
 }
 async function create(user,input){
 if(!options().enabled&&(!input?.provider||!input?.idempotencyKey))fail(503,'支付渠道或可售商品尚未开通，暂不能创建付款订单');
 if(!input||Object.keys(input).some(k=>!['productId','provider','idempotencyKey'].includes(k))||typeof input.productId!=='string'||!['wechat','alipay'].includes(input.provider)||typeof input.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(input.idempotencyKey))fail(400,'请选择有效商品与支付方式');
 const inputHash=hash(JSON.stringify({productId:input.productId,provider:input.provider}));
 expire(user.id);
 const existing=db.prepare(orderSelect+' WHERE d.user_id=? AND d.idempotency_key=?').get(user.id,input.idempotencyKey);
 if(existing){if(existing.input_hash!==inputHash)fail(409,'重复请求标识已经用于其他商品或支付渠道');return {item:publicOrder(existing)};}
 const availability=options();if(!availability.channels.some(channel=>channel.ready))fail(503,'支付渠道或可售商品尚未开通，暂不能创建付款订单');
 const product=availability.products.find(p=>p.id===input.productId);if(!product)fail(409,'商品尚未上架或已停止销售');
 const channel=settings.current(input.provider);if(!channel.enabled||validateProvider(input.provider,channel.settings).length)fail(503,'所选支付渠道尚未开通');
 if(product.purchasable===false)fail(409,product.unavailableReason);
 expire(user.id);if(db.prepare("SELECT count(*) AS n FROM orders o JOIN payment_orders d ON d.order_id=o.id WHERE o.user_id=? AND o.status='pending'").get(user.id).n>=5)fail(429,'待支付订单较多，请先查看已有订单或等待过期');
 const id=randomUUID(),created=at(),expiresAt=new Date(Date.now()+15*60000).toISOString(),outTradeNo='PK'+Date.now().toString()+randomBytes(7).toString('hex');
 transaction(()=>{
 db.prepare('INSERT INTO orders(id,user_id,product_id,status,created_at) VALUES(?,?,?,?,?)').run(id,user.id,product.id,'pending',created);
 db.prepare('INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,currency,title,entitlement,idempotency_key,input_hash,user_id,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.provider,outTradeNo,channel.id,product.priceCents,'CNY',product.title,JSON.stringify({...product.entitlement,description:product.description}),input.idempotencyKey,inputHash,user.id,expiresAt,created);
 });
 const order=get(id);
 try{
  const expected=providerOrder(order,channel.settings),result=await adapters.create(input.provider,channel.settings,expected);
  if(input.provider==='alipay'){
   if(!validateAlipayPaymentURL(result.paymentUrl,expected))throw new Error('invalid payment URL');
   db.prepare('UPDATE payment_orders SET payment_url=?,updated_at=?,error_code=NULL WHERE order_id=?').run(result.paymentUrl,at(),id);
  }else{
   if(typeof result.qrContent!=='string'||result.qrContent.length>4096||!/^weixin:\/\/wxpay\/bizpayurl\?\S+$/.test(result.qrContent))throw new Error('invalid qr');
   db.prepare('UPDATE payment_orders SET qr_content=?,updated_at=?,error_code=NULL WHERE order_id=?').run(result.qrContent,at(),id);
  }
 }catch{
  // A timeout may happen after the channel accepted the order. Keep it queryable.
  db.prepare("UPDATE payment_orders SET error_code='provider_request_unconfirmed',updated_at=? WHERE order_id=? AND order_id IN (SELECT id FROM orders WHERE status!='paid')").run(at(),id);
 }
 return {item:publicOrder(get(id))};
 }
 async function query(user,id){
 expire(user.id);const order=own(id,user);if(!order.provider||order.status==='paid'||['closed','failed','refunded','cancelled'].includes(order.status))return {item:publicOrder(order)};
 if(queries.has(id))return queries.get(id);
 if(Date.now()-(order.last_queried_at||0)<3000)return {item:publicOrder(order)};
 db.prepare('UPDATE payment_orders SET last_queried_at=? WHERE order_id=?').run(Date.now(),id);
 const operation=(async()=>{await Promise.resolve();try{
 const original=settings.version(order.config_id),recent=settings.versions(order.provider,{identityConfigId:original.id,limit:2});
 // Freeze merchant identity in the order; use its latest trusted credentials
 // even after another merchant becomes current. Bound network work to 3 x 6s.
 const seen=new Set(),candidates=[...recent,original].filter(channel=>{
  if(seen.has(channel.id)||validateProvider(order.provider,channel.settings).length)return false;
  seen.add(channel.id);return true;
 });
 let result,lastError;for(const channel of candidates){try{result=await adapters.query(order.provider,channel.settings,{outTradeNo:order.out_trade_no,amountCents:order.amount_cents},{timeoutMs:6000});break;}catch(error){if(error.code==='payment_trade_not_exist'&&paymentURL(order))throw error;lastError=error;}}
 if(!result)throw lastError||new Error('query unavailable');return {item:publicOrder(applyResult(order,result,original.settings))};
 }catch(error){
  // A signed page link does not create a gateway trade until the buyer opens it.
  // An authenticated TRADE_NOT_EXIST is therefore still pending, never paid.
  if(error.code==='payment_trade_not_exist'&&paymentURL(order))return {item:publicOrder(get(id))};
  if(error.status)throw error;fail(502,'支付渠道暂时无法查询，请稍后重试');
 }finally{queries.delete(id);}})();queries.set(id,operation);return operation;
 }
 async function notify(provider,request){
 if(!['wechat','alipay'].includes(provider))fail(404,'支付回调不存在');
 let filters={};
 if(provider==='wechat'){
  const serial=request.headers?.['wechatpay-serial'];if(typeof serial!=='string'||!/^PUB_KEY_ID_\d{5,80}$/.test(serial))fail(400,'支付回调验签参数无效');filters={verificationId:serial};
 }else{
  const form=new URLSearchParams(String(request.rawBody));if(form.getAll('out_trade_no').length!==1)fail(400,'支付订单号无效');const candidate=db.prepare('SELECT config_id FROM payment_orders WHERE provider=? AND out_trade_no=?').get(provider,form.get('out_trade_no'));if(!candidate)fail(404,'订单不存在');filters={identityConfigId:candidate.config_id};
 }
 const versions=settings.versions(provider,filters);if(!versions.length)fail(503,'支付渠道尚未配置');
 let verified;
 for(const version of versions){try{const result=await adapters.notify(provider,version.settings,request);verified=result;break;}catch{}}
 if(!verified)fail(400,'支付回调验签失败');
 const order=db.prepare(orderSelect+' WHERE d.out_trade_no=? AND d.provider=?').get(verified.outTradeNo,provider);if(!order)fail(404,'订单不存在');
 // Credential rotation is allowed only for the merchant identity frozen in the order.
 const channel=settings.version(order.config_id);applyResult(order,verified,channel.settings);
 return {ok:true};
 }
 function getOrder(user,id){expire(user.id);return {item:publicOrder(own(id,user))};}
 function list(user){expire(user.id);return {items:db.prepare(orderSelect+' WHERE o.user_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT 100').all(user.id).map(publicOrder)};}
 function entitlements(user){
 const managed=managedMemberships(db,user.id),byOrder=new Map(managed.filter(row=>row.origin==='payment').map(row=>[row.orderId,row]));
 const items=db.prepare('SELECT e.order_id,e.product_id,e.type,e.starts_at,e.expires_at,d.title,d.entitlement FROM payment_entitlements e JOIN payment_orders d ON d.order_id=e.order_id WHERE e.user_id=? ORDER BY e.expires_at DESC LIMIT 100').all(user.id).flatMap(({entitlement,...item})=>{
  const effective=byOrder.get(item.order_id);if(!effective||effective.status==='revoked')return [];item.expires_at=effective.expiresAt;
  let snapshot;try{snapshot=JSON.parse(entitlement);}catch{snapshot=null;}
  return {...item,description:typeof snapshot?.description==='string'?snapshot.description:'',...(config.billing?{membershipItems:paymentBundleItems(snapshot?.membershipItems||[],{allowEmpty:true})||[]}:{} )};
 });
 items.push(...managed.filter(row=>row.origin==='admin'&&row.status!=='revoked').map(row=>({order_id:row.id,product_id:row.productId,type:'membership',starts_at:row.startsAt,expires_at:row.expiresAt,title:row.title,description:row.description,membershipItems:row.items,origin:'admin'})));
 const balance=db.prepare('SELECT COALESCE(sum(amount),0) AS balance FROM payment_credit_ledger WHERE user_id=?').get(user.id).balance+adminCreditTotal(db,user.id);
 const ledger=db.prepare('SELECT e.order_id AS orderId,e.product_id AS productId,d.title,e.amount,e.kind,e.created_at AS createdAt FROM payment_credit_ledger e JOIN payment_orders d ON d.order_id=e.order_id WHERE e.user_id=? ORDER BY e.created_at DESC,e.order_id DESC LIMIT 100').all(user.id);
 const bundles=db.prepare('SELECT e.order_id AS orderId,e.product_id AS productId,d.title,d.entitlement,e.starts_at AS startsAt,e.expires_at AS expiresAt,e.items FROM payment_bundle_entitlements e JOIN payment_orders d ON d.order_id=e.order_id WHERE e.user_id=? ORDER BY e.granted_at DESC,e.order_id DESC LIMIT 100').all(user.id).map(({entitlement,items,...item})=>{
  let snapshot,parsed;try{snapshot=JSON.parse(entitlement);}catch{}try{parsed=paymentBundleItems(JSON.parse(items));}catch{}
  return {...item,description:typeof snapshot?.description==='string'?snapshot.description:'',items:parsed||[]};
 });
 if(config.billing){const billing=config.billing.entitlements(user.id);return {items:items.map(item=>({...item,usage:billing.membershipUsage[item.order_id]||[]})),credits:config.billing.balance(user.id),bundles:bundles.map(item=>({...item,items:billing.bundleUsage[item.orderId]||item.items})),billing};}
 return {items,credits:{balance,ledger:[...ledger,...adminCreditLedger(db,user.id)].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100)},bundles};
 }
 return {settings,options,create,query,notify,getOrder,list,entitlements};
}
