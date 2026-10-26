import {toolBillingServiceTypes} from '../dist/workspace/tool-pricing-catalog.mjs';
export {toolBillingServiceTypes};
import {randomBytes,randomUUID} from 'node:crypto';
import {aiReady} from './config.mjs';
import {agentSettingsReady} from './agent-settings.mjs';
import {detectionBillingReady} from './detection-billing-readiness.mjs';
import {managedMemberships,adminCreditTotal,adminCreditLedger} from './admin-user-entitlements.mjs';
import {jobBillingType} from './job-billing-identity.mjs';
import {presentationGenerationStatus} from './presentation-readiness.mjs';

export const billingServiceTypes=Object.freeze([
 Object.freeze({key:'polish',title:'学术润色'}),
 Object.freeze({key:'review',title:'导师意见修改'}),
 Object.freeze({key:'agent',title:'科研智能助手'})
]);
const keys=new Set(billingServiceTypes.map(item=>item.key)),toolKeys=new Set(toolBillingServiceTypes.map(item=>item.key)),entitlementKeys=new Set([...keys,...toolKeys]);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const isObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const detectionKeys=new Set(['detection-similarity','detection-aigc']);
const defaultToolRule=key=>({key,mode:detectionKeys.has(key)?'free':'inherit',creditCost:null});
const validItems=value=>{
 if(!Array.isArray(value)||value.length>20)return [];
 const seen=new Set();
 for(const item of value){
  if(!isObject(item)||typeof item.key!=='string'||seen.has(item.key)||typeof item.title!=='string'||!item.title.trim()||item.title.length>80||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>100000)return [];
  seen.add(item.key);
 }
 return value.filter(item=>entitlementKeys.has(item.key)).map(({key,title,quantity})=>({key,title,quantity}));
};

// The caller owns the transaction that pairs a job transition with its charge.
// Recharging remains in the existing immutable payment ledger; this service never edits it.
export function createBillingService(db,config={}){
 const clock=()=>{const value=config.billingNow?.()??new Date();const date=value instanceof Date?value:new Date(value);if(!Number.isFinite(date.getTime()))throw new Error('Invalid billing clock');return date.toISOString();};
 db.exec(`CREATE TABLE IF NOT EXISTS billing_policy(
 id INTEGER PRIMARY KEY CHECK(id=1),rules TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS billing_quotes(
 token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),type TEXT NOT NULL CHECK(type IN ('polish','review','agent')),
 source TEXT NOT NULL CHECK(source IN ('free','membership','bundle','credits')),source_order TEXT REFERENCES orders(id),
 credits INTEGER NOT NULL CHECK(credits>=0),policy_version INTEGER NOT NULL,expires_at TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0 CHECK(used IN (0,1))
 );
 CREATE INDEX IF NOT EXISTS billing_quotes_owner ON billing_quotes(user_id,expires_at);
 CREATE INDEX IF NOT EXISTS billing_quotes_expiry ON billing_quotes(expires_at);
 CREATE TABLE IF NOT EXISTS billing_reservations(
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),attempt INTEGER NOT NULL CHECK(attempt>=1),user_id TEXT NOT NULL REFERENCES users(id),
 type TEXT NOT NULL CHECK(type IN ('polish','review','agent')),source TEXT NOT NULL CHECK(source IN ('free','membership','bundle','credits')),
 source_order TEXT REFERENCES orders(id),credits INTEGER NOT NULL CHECK(credits>=0),status TEXT NOT NULL CHECK(status IN ('held','settled','released')),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(job_id,attempt)
 );
 CREATE INDEX IF NOT EXISTS billing_reservations_owner ON billing_reservations(user_id,status);
 CREATE INDEX IF NOT EXISTS billing_reservations_entitlement ON billing_reservations(source_order,type,status);
 CREATE TRIGGER IF NOT EXISTS billing_reservations_protect BEFORE UPDATE ON billing_reservations
 WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.attempt IS NOT OLD.attempt OR NEW.user_id IS NOT OLD.user_id
 OR NEW.type IS NOT OLD.type OR NEW.source IS NOT OLD.source OR NEW.source_order IS NOT OLD.source_order OR NEW.credits IS NOT OLD.credits
 OR NEW.created_at IS NOT OLD.created_at OR OLD.status!='held' OR NEW.status NOT IN ('settled','released')
 BEGIN SELECT RAISE(ABORT,'消费预占信息不可修改'); END;
 CREATE TRIGGER IF NOT EXISTS billing_reservations_no_delete BEFORE DELETE ON billing_reservations BEGIN SELECT RAISE(ABORT,'消费预占信息不可删除'); END;
 CREATE TABLE IF NOT EXISTS billing_events(
 id TEXT PRIMARY KEY,reservation_id TEXT NOT NULL REFERENCES billing_reservations(id),kind TEXT NOT NULL CHECK(kind IN ('reserve','settle','release')),
 created_at TEXT NOT NULL,UNIQUE(reservation_id,kind)
 );
 CREATE TRIGGER IF NOT EXISTS billing_events_no_update BEFORE UPDATE ON billing_events BEGIN SELECT RAISE(ABORT,'消费事件不可修改'); END;
 CREATE TRIGGER IF NOT EXISTS billing_events_no_delete BEFORE DELETE ON billing_events BEGIN SELECT RAISE(ABORT,'消费事件不可删除'); END;`);
 // Extend old ledgers in place. NULL identifies historical or legacy service
 // records; no existing purchase, charge, entitlement or policy is rewritten.
 for(const table of ['billing_quotes','billing_reservations']){
  const present=new Set(db.prepare('PRAGMA table_info('+table+')').all().map(row=>row.name));
  for(const [name,type]of [['service_key','TEXT'],['entitlement_key','TEXT'],['source_grant_id','TEXT REFERENCES admin_membership_grants(id)'],...(table==='billing_quotes'?[['tool_policy_version','INTEGER']]:[])])if(!present.has(name))db.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+type);
 }
 db.exec(`CREATE TABLE IF NOT EXISTS tool_pricing_policy(id INTEGER PRIMARY KEY CHECK(id=1),rules TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS billing_reservations_entitlement_v2 ON billing_reservations(source_order,entitlement_key,type,status);
 CREATE TRIGGER IF NOT EXISTS billing_quotes_tool_identity_protect BEFORE UPDATE ON billing_quotes
 WHEN NEW.service_key IS NOT OLD.service_key OR NEW.entitlement_key IS NOT OLD.entitlement_key OR NEW.tool_policy_version IS NOT OLD.tool_policy_version
 BEGIN SELECT RAISE(ABORT,'科研工具报价身份不可修改'); END;
 CREATE TRIGGER IF NOT EXISTS billing_reservations_tool_identity_protect BEFORE UPDATE ON billing_reservations
 WHEN NEW.service_key IS NOT OLD.service_key OR NEW.entitlement_key IS NOT OLD.entitlement_key
 BEGIN SELECT RAISE(ABORT,'科研工具预占身份不可修改'); END;`);
 db.exec(`CREATE INDEX IF NOT EXISTS billing_reservations_admin_grant ON billing_reservations(source_grant_id,entitlement_key,type,status);
 CREATE TRIGGER IF NOT EXISTS billing_quotes_admin_identity_protect BEFORE UPDATE ON billing_quotes WHEN NEW.source_grant_id IS NOT OLD.source_grant_id BEGIN SELECT RAISE(ABORT,'管理会员报价身份不可修改'); END;
 CREATE TRIGGER IF NOT EXISTS billing_reservations_admin_identity_protect BEFORE UPDATE ON billing_reservations WHEN NEW.source_grant_id IS NOT OLD.source_grant_id BEGIN SELECT RAISE(ABORT,'管理会员预占身份不可修改'); END;`);
 db.prepare('INSERT OR IGNORE INTO tool_pricing_policy(id,rules,version,updated_at) VALUES(1,?,1,?)').run(JSON.stringify(toolBillingServiceTypes.map(({key})=>defaultToolRule(key))),clock());
 // Only exact, validated historic catalogues are extended. Unknown keys,
 // duplicate/missing old entries and malformed modes remain closed for inspection.
 const previousToolPolicy=db.prepare('SELECT rules,version FROM tool_pricing_policy WHERE id=1').get();
 try{
  const old=JSON.parse(previousToolPolicy.rules),base=toolBillingServiceTypes.filter(item=>!['AI 写作','免费检测'].includes(item.group)).map(item=>item.key),known=[base,base.filter(key=>key!=='research-image'),toolBillingServiceTypes.filter(item=>item.key!=='thesis-researcher').map(item=>item.key)];
  const shape=Array.isArray(old)&&old.every(item=>isObject(item)&&Object.keys(item).length===3&&Object.keys(item).every(key=>['key','mode','creditCost'].includes(key))&&['inherit','free','paid','disabled'].includes(item.mode)&&(item.mode==='paid'?Number.isSafeInteger(item.creditCost)&&item.creditCost>=1&&item.creditCost<=100000:item.creditCost===null));
  const legacy=shape&&known.some(version=>old.length===version.length&&new Set(old.map(item=>item.key)).size===version.length&&old.every(item=>version.includes(item.key)));
  if(legacy){const present=new Set(old.map(item=>item.key)),added=toolBillingServiceTypes.filter(item=>!present.has(item.key)).map(({key})=>defaultToolRule(key));
   if(added.length)db.prepare('UPDATE tool_pricing_policy SET rules=?,version=version+1,updated_at=? WHERE id=1 AND version=?').run(JSON.stringify([...old,...added]),clock(),previousToolPolicy.version);
  }
 }catch{/* Corrupt/unknown policy remains closed instead of silently resetting prices. */}
 db.prepare('INSERT OR IGNORE INTO billing_policy(id,rules,version,updated_at) VALUES(1,?,1,?)').run(JSON.stringify(billingServiceTypes.map(({key})=>({key,mode:'free',creditCost:null}))),clock());
 const available=key=>{if(config.getAgentSettings){try{if(agentSettingsReady(config.getAgentSettings()))return true;}catch{/* A failed new runtime configuration never enables paid work. */}}return Boolean(aiReady(config.getAI?.()||config)&&(key!=='agent'||config.agentEnabled));};
 function rules(){
  const row=db.prepare('SELECT rules,version FROM billing_policy WHERE id=1').get();let stored;
  try{stored=JSON.parse(row.rules);}catch{fail(503,'服务计费规则暂时无法读取');}
  if(!Array.isArray(stored)||stored.length!==billingServiceTypes.length)fail(503,'服务计费规则暂时无法读取');
  const services=billingServiceTypes.map(({key,title})=>{
   const values=stored.filter(value=>value?.key===key),item=values[0];
   if(values.length!==1||!['free','paid','disabled'].includes(item.mode)||(item.mode==='paid'?(!Number.isSafeInteger(item.creditCost)||item.creditCost<1||item.creditCost>100000):item.creditCost!==null))fail(503,'服务计费规则暂时无法读取');
   return {key,title,mode:item.mode,creditCost:item.creditCost,available:available(key)};
  });
  return {version:row.version,services};
 }
 function saveRules(input){
  if(!isObject(input)||Object.keys(input).some(key=>!['version','services'].includes(key))||!Number.isSafeInteger(input.version)||input.version<1||!Array.isArray(input.services)||input.services.length!==billingServiceTypes.length)fail(400,'请提交完整的三项服务计费规则');
  const seen=new Set(),services=[];
  for(const item of input.services){
   if(!isObject(item)||Object.keys(item).some(key=>!['key','mode','creditCost'].includes(key))||!keys.has(item.key)||seen.has(item.key)||!['free','paid','disabled'].includes(item.mode)||(item.mode==='paid'?(!Number.isSafeInteger(item.creditCost)||item.creditCost<1||item.creditCost>100000):item.creditCost!==null))fail(400,'收费积分应为 1～100000 的整数，免费或停用服务不配置积分');
   seen.add(item.key);services.push({key:item.key,mode:item.mode,creditCost:item.creditCost});
  }
  const result=db.prepare('UPDATE billing_policy SET rules=?,version=version+1,updated_at=? WHERE id=1 AND version=?').run(JSON.stringify(services),clock(),input.version);
  if(!result.changes)fail(409,'计费规则已变化，请刷新后重新保存');
  return rules();
 }
 const imageAvailable=()=>{try{const value=config.getResearchImageSettings?.();return Boolean(value?.enabled&&value.apiKey&&typeof value.version==='string'&&value.version&&config.storage?.provider==='aliyun_oss'&&config.moderation?.ready);}catch{return false;}};
 const toolAvailable=()=>{try{const runtime=config.getAgentSettings?.();return agentSettingsReady(runtime)&&typeof runtime.version==='string'&&runtime.version.length>0;}catch{return false;}};
 function toolRules(){
  const row=db.prepare('SELECT rules,version FROM tool_pricing_policy WHERE id=1').get();let stored;try{stored=JSON.parse(row.rules);}catch{fail(503,'科研工具计价规则暂时无法读取');}
  if(!Array.isArray(stored)||stored.length!==toolBillingServiceTypes.length)fail(503,'科研工具计价规则暂时无法读取');
  const parent=rules().services.find(item=>item.key==='agent'),ready=toolAvailable();
  const services=toolBillingServiceTypes.map(({key,title,group})=>{const values=stored.filter(item=>item?.key===key),item=values[0];
   if(values.length!==1||!['inherit','free','paid','disabled'].includes(item?.mode)||(item.mode==='paid'?(!Number.isSafeInteger(item.creditCost)||item.creditCost<1||item.creditCost>100000):item.creditCost!==null))fail(503,'科研工具计价规则暂时无法读取');
   const effectiveMode=item.mode==='inherit'?parent.mode:item.mode,effectiveCreditCost=effectiveMode==='paid'?(item.mode==='inherit'?parent.creditCost:item.creditCost):null;
   return {key,title,group,mode:item.mode,creditCost:item.creditCost,effectiveMode,effectiveCreditCost,available:key==='research-image'?imageAvailable():key.startsWith('presentation-')?ready&&presentationGenerationStatus(config).ready:detectionKeys.has(key)?detectionBillingReady(key,config):ready};
  });return {version:row.version,services};
 }
 function saveToolRules(input){
  if(!isObject(input)||Object.keys(input).some(key=>!['version','services'].includes(key))||!Number.isSafeInteger(input.version)||input.version<1||!Array.isArray(input.services)||input.services.length!==toolBillingServiceTypes.length)fail(400,'请提交完整的科研工具计价规则');
  const seen=new Set(),services=[];for(const item of input.services){
   if(!isObject(item)||Object.keys(item).some(key=>!['key','mode','creditCost'].includes(key))||!toolKeys.has(item.key)||seen.has(item.key)||!['inherit','free','paid','disabled'].includes(item.mode)||(item.mode==='paid'?(!Number.isSafeInteger(item.creditCost)||item.creditCost<1||item.creditCost>100000):item.creditCost!==null))fail(400,'科研工具可选择继承、免费、暂停或设置 1～100000 的整数积分');
   seen.add(item.key);services.push({key:item.key,mode:item.mode,creditCost:item.creditCost});
  }
  const changed=db.prepare('UPDATE tool_pricing_policy SET rules=?,version=version+1,updated_at=? WHERE id=1 AND version=?').run(JSON.stringify(services),clock(),input.version);
  if(!changed.changes)fail(409,'科研工具计价已变化，请刷新后重新保存');return toolRules();
 }
 function subservice(type,serviceKey){if(serviceKey===undefined||serviceKey===null)return null;if(type!=='agent'||typeof serviceKey!=='string'||!toolKeys.has(serviceKey))fail(400,'不支持的科研工具计价项');return serviceKey;}
 function service(type,serviceKey){
  if(!keys.has(type))fail(400,'不支持的计费服务');serviceKey=subservice(type,serviceKey);const policy=rules(),parent=policy.services.find(value=>value.key===type),tools=serviceKey?toolRules():null,child=tools?.services.find(value=>value.key===serviceKey),item=child?{...parent,title:child.title,mode:child.effectiveMode,creditCost:child.effectiveCreditCost,available:child.available}:parent;
  if(!item.available)fail(503,'当前服务尚未启用');if(item.mode==='disabled')fail(503,'当前服务已暂停');return {...item,version:policy.version,serviceKey,toolVersion:tools?.version??null};
 }
 function counts(orderId,key){const admin=typeof orderId==='string'&&orderId.startsWith('admin:');return db.prepare(`SELECT COALESCE(sum(CASE WHEN status='held' THEN 1 ELSE 0 END),0) held,COALESCE(sum(CASE WHEN status='settled' THEN 1 ELSE 0 END),0) used FROM billing_reservations WHERE ${admin?'source_grant_id':'source_order'}=? AND COALESCE(entitlement_key,type)=? AND status IN ('held','settled')`).get(admin?orderId.slice(6):orderId,key);}
 function grants(userId,source){
  const membership=source==='membership';if(membership)return managedMemberships(db,userId,clock()).filter(row=>row.status!=='revoked').map(row=>({orderId:row.origin==='admin'?row.id:row.orderId,startsAt:row.startsAt,expiresAt:row.expiresAt,items:validItems(row.items)})).sort((a,b)=>a.expiresAt.localeCompare(b.expiresAt)||a.orderId.localeCompare(b.orderId));const table='payment_bundle_entitlements';
  return db.prepare(`SELECT e.order_id AS orderId,e.starts_at AS startsAt,e.expires_at AS expiresAt,d.entitlement FROM ${table} e JOIN payment_orders d ON d.order_id=e.order_id JOIN orders o ON o.id=e.order_id WHERE e.user_id=? AND o.user_id=? AND o.status='paid' ORDER BY e.expires_at,e.starts_at,e.order_id`).all(userId,userId).flatMap(row=>{
   let snapshot;try{snapshot=JSON.parse(row.entitlement);}catch{return [];}
   if(snapshot?.type!==source)return [];
   return [{orderId:row.orderId,startsAt:row.startsAt,expiresAt:row.expiresAt,items:validItems(snapshot[membership?'membershipItems':'bundleItems'])}];
  });
 }
 function grantQuota(grant,type,now){
  if(!grant||grant.startsAt>now||grant.expiresAt<=now)return null;
  const item=grant.items.find(item=>item.key===type);if(!item)return null;
  const usage=counts(grant.orderId,type);return {...item,...usage,remaining:Math.max(0,item.quantity-usage.held-usage.used),expiresAt:grant.expiresAt};
 }
 function quota(userId,source,orderId,type,now){return grantQuota(grants(userId,source).find(item=>item.orderId===orderId),type,now);}

 function totals(userId){
  const purchased=db.prepare('SELECT COALESCE(sum(amount),0) n FROM payment_credit_ledger WHERE user_id=?').get(userId).n;
  const usage=db.prepare("SELECT COALESCE(sum(CASE WHEN status='settled' THEN credits ELSE 0 END),0) spent,COALESCE(sum(CASE WHEN status='held' THEN credits ELSE 0 END),0) held FROM billing_reservations WHERE user_id=? AND source='credits'").get(userId);
  const balance=purchased+adminCreditTotal(db,userId)-usage.spent,held=usage.held;
  if(!Number.isSafeInteger(balance)||!Number.isSafeInteger(held)||balance<0||held<0||balance-held<0)fail(503,'账户积分记录异常，请联系支持');
  return {balance,held,available:balance-held};
 }
 function quote(user,input){
  if(!isObject(input)||Object.keys(input).some(key=>!['type','serviceKey'].includes(key)))fail(400,'请选择有效的服务');
  const item=service(input.type,input.serviceKey),now=clock();let source='free',sourceOrderId=null,creditCost=0,entitlementKey=null;
  if(item.mode==='paid'||detectionKeys.has(item.serviceKey)&&item.mode==='free'){
   if(item.mode==='paid'){source='credits';creditCost=item.creditCost;}
   for(const candidate of ['membership','bundle']){
    const availableGrants=grants(user.id,candidate),options=item.serviceKey?(item.mode==='free'?[item.serviceKey]:[item.serviceKey,item.key]):[item.key];let chosen;for(const key of options){const grant=availableGrants.find(grant=>grantQuota(grant,key,now)?.remaining>0);if(grant){chosen={grant,key};break;}}
    if(chosen){source=candidate;sourceOrderId=chosen.grant.orderId;entitlementKey=chosen.key;creditCost=0;break;}
   }
   if(source==='credits'&&totals(user.id).available<creditCost)fail(402,'可用积分不足，请充值或选择有效权益');
  }
  // Quotes are short-lived confirmation credentials, never financial history.
  // Bound cleanup work and keep a full day after expiry for recent request retries.
  db.prepare('DELETE FROM billing_quotes WHERE token IN (SELECT token FROM billing_quotes WHERE expires_at<? ORDER BY expires_at,token LIMIT 500)').run(new Date(Date.parse(now)-86400000).toISOString());
  const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.parse(now)+5*60000).toISOString();
  const adminGrantId=source==='membership'&&sourceOrderId?.startsWith('admin:')?sourceOrderId.slice(6):null;
  db.prepare('INSERT INTO billing_quotes(token,user_id,type,source,source_order,source_grant_id,credits,policy_version,expires_at,used,service_key,entitlement_key,tool_policy_version) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?)').run(token,user.id,item.key,source,adminGrantId?null:sourceOrderId,adminGrantId,creditCost,item.version,expiresAt,item.serviceKey,entitlementKey,item.toolVersion);
  return {token,type:item.key,title:item.title,source,sourceOrderId,creditCost,expiresAt,policyVersion:item.version,...(item.serviceKey?{serviceKey:item.serviceKey,toolPolicyVersion:item.toolVersion}:{}),...(entitlementKey?{entitlementKey}:{})};
 }
 function reservation(row){return {id:row.id,jobId:row.job_id,attempt:row.attempt,userId:row.user_id,type:row.type,source:row.source,sourceOrderId:row.source_grant_id?'admin:'+row.source_grant_id:row.source_order,...(row.source_grant_id?{sourceGrantId:row.source_grant_id}:{}),creditCost:row.credits,status:row.status,...(row.service_key?{serviceKey:row.service_key}:{}),...(row.entitlement_key?{entitlementKey:row.entitlement_key}:{}),createdAt:row.created_at,updatedAt:row.updated_at};}
 function event(id,kind,now){db.prepare('INSERT INTO billing_events(id,reservation_id,kind,created_at) VALUES(?,?,?,?)').run(randomUUID(),id,kind,now);}
 function reserve(user,jobId,attempt,type,token,serviceKey){
  serviceKey=subservice(type,serviceKey);
  if(!Number.isSafeInteger(attempt)||attempt<1||typeof jobId!=='string')fail(400,'任务执行次数无效');
  const job=db.prepare('SELECT id,user_id,type,input FROM jobs WHERE id=? AND user_id=?').get(jobId,user.id);if(!job)fail(404,'任务不存在');const detectionJob=({'web_similarity':'detection-similarity','aigc_detection':'detection-aigc'})[job.type];if(detectionJob?(type!=='agent'||serviceKey!==detectionJob):detectionKeys.has(serviceKey)||job.type!==type&&!(['thesis','thesis_outline','thesis_method','writing','tool_run'].includes(job.type)&&type===jobBillingType(job)))fail(409,'任务类型与计费服务不一致');
  const existing=db.prepare('SELECT * FROM billing_reservations WHERE job_id=? AND attempt=?').get(jobId,attempt);
  if(existing){if(existing.user_id!==user.id||existing.type!==type||(existing.service_key??null)!==serviceKey)fail(409,'任务预占信息不一致');return reservation(existing);}
  if(db.prepare("SELECT 1 FROM billing_reservations WHERE job_id=? AND status='held'").get(jobId))fail(409,'任务已有未结算预占');
  const item=service(type,serviceKey),now=clock();let source='free',sourceOrderId=null,creditCost=0,entitlementKey=null,quoted;
  if(token!==undefined&&token!==null&&token!==''){
   if(typeof token!=='string'||token.length>200)fail(400,'计费确认无效');
   quoted=db.prepare('SELECT * FROM billing_quotes WHERE token=? AND user_id=?').get(token,user.id);
   if(!quoted||quoted.type!==type||quoted.used||quoted.expires_at<=now||quoted.policy_version!==item.version||(quoted.service_key??null)!==serviceKey||(quoted.tool_policy_version??null)!==item.toolVersion)fail(409,'计费确认已失效，请重新确认后提交');
   ({source,source_order:sourceOrderId,credits:creditCost,entitlement_key:entitlementKey}=quoted);if(quoted.source_grant_id)sourceOrderId='admin:'+quoted.source_grant_id;
   if(item.mode==='free'&&source!=='free'&&!(detectionKeys.has(serviceKey)&&['membership','bundle'].includes(source))||item.mode==='paid'&&source==='free')fail(409,'计费方式已变化，请重新确认');
  }else if(item.mode==='paid'||serviceKey)fail(409,'请先确认本次使用的权益或积分');
  if(source==='credits'){
   if(creditCost!==item.creditCost||totals(user.id).available<creditCost)fail(402,'可用积分不足，请重新确认');
  }else if(source==='membership'||source==='bundle'){
   if(!quota(user.id,source,sourceOrderId,entitlementKey||type,now)?.remaining)fail(409,'本次选定权益已用完或到期，请重新确认');
  }
  if(quoted&&!db.prepare('UPDATE billing_quotes SET used=1 WHERE token=? AND used=0').run(quoted.token).changes)fail(409,'本次计费确认已使用');
  const id=randomUUID();
  const adminGrantId=source==='membership'&&sourceOrderId?.startsWith('admin:')?sourceOrderId.slice(6):null;
  db.prepare("INSERT INTO billing_reservations(id,job_id,attempt,user_id,type,source,source_order,source_grant_id,credits,status,created_at,updated_at,service_key,entitlement_key) VALUES(?,?,?,?,?,?,?,?,?,'held',?,?,?,?)").run(id,jobId,attempt,user.id,type,source,adminGrantId?null:sourceOrderId,adminGrantId,creditCost,now,now,serviceKey,entitlementKey);
  event(id,'reserve',now);return reservation(db.prepare('SELECT * FROM billing_reservations WHERE id=?').get(id));
 }
 function finish(jobId,status,kind){
  const held=db.prepare("SELECT * FROM billing_reservations WHERE job_id=? AND status='held'").all(jobId),now=clock();
  for(const row of held){if(db.prepare("UPDATE billing_reservations SET status=?,updated_at=? WHERE id=? AND status='held'").run(status,now,row.id).changes)event(row.id,kind,now);}
  return {changed:held.length};
 }
 function settle(jobId){return finish(jobId,'settled','settle');}
 function release(jobId){return finish(jobId,'released','release');}
 function isBillable(jobId){return Boolean(db.prepare("SELECT 1 FROM billing_reservations WHERE job_id=? AND source!='free' AND status IN ('held','settled')").get(jobId));}
 function balance(userId){
  const purchased=db.prepare('SELECT p.order_id AS orderId,p.product_id AS productId,d.title,p.amount,p.kind,p.created_at AS createdAt FROM payment_credit_ledger p JOIN payment_orders d ON d.order_id=p.order_id WHERE p.user_id=? ORDER BY p.created_at DESC,p.order_id DESC LIMIT 100').all(userId).map(row=>({...row,id:'purchase:'+row.orderId,source:'credits',jobId:null,heldDelta:0}));
  const events=db.prepare(`SELECT e.id,e.kind,e.created_at AS createdAt,r.id AS reservationId,r.job_id AS jobId,r.attempt,r.type,r.service_key AS serviceKey,r.entitlement_key AS entitlementKey,r.source,r.source_order AS sourceOrderId,r.credits FROM billing_events e JOIN billing_reservations r ON r.id=e.reservation_id WHERE r.user_id=? AND r.source='credits' ORDER BY e.created_at DESC,e.rowid DESC LIMIT 100`).all(userId).map(({credits,...row})=>({...row,title:toolBillingServiceTypes.find(item=>item.key===row.serviceKey)?.title||billingServiceTypes.find(item=>item.key===row.type)?.title||row.type,amount:row.source==='credits'&&row.kind==='settle'?-credits:0,heldDelta:row.source==='credits'?(row.kind==='reserve'?credits:row.kind==='settle'||row.kind==='release'?-credits:0):0}));
  const ledger=[...purchased,...adminCreditLedger(db,userId),...events].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,100);
  return {...totals(userId),ledger};
 }
 function entitlements(userId){
  const usage=source=>Object.fromEntries(grants(userId,source).map(grant=>[grant.orderId,grant.items.map(item=>{const {held,used}=counts(grant.orderId,item.key);return {...item,held,used,remaining:Math.max(0,item.quantity-held-used)};})]));
  return {reservations:db.prepare('SELECT * FROM billing_reservations WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(userId).map(reservation),membershipUsage:usage('membership'),bundleUsage:usage('bundle')};
 }
 return {rules,saveRules,toolRules,saveToolRules,quote,reserve,settle,release,balance,entitlements,isBillable};
}
