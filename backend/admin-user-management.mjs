import {resourceEntitlementKeys} from '../dist/workspace/v1-pricing.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {paymentCatalog} from './payment-settings.mjs';
import {managedMemberships} from './admin-user-entitlements.mjs';
import {toolBillingServiceTypes} from '../dist/workspace/tool-pricing-catalog.mjs';
const membershipKeys=new Set([...resourceEntitlementKeys,'polish','review','agent',...toolBillingServiceTypes.map(row=>row.key)]);

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const stamp=()=>new Date().toISOString();
export function createAdminUserManagement(db,{billing,audit,transaction}){
 function owner(id){const user=db.prepare(`SELECT u.id,u.name,COALESCE(e.address,u.email) email,p.address phone,u.role,u.created_at,COALESCE(m.status,'active') status,COALESCE(m.version,1) version,COALESCE(m.reason,'') statusReason,m.updated_at AS updatedAt FROM users u LEFT JOIN auth_identities e ON e.user_id=u.id AND e.channel='email' LEFT JOIN auth_identities p ON p.user_id=u.id AND p.channel='phone' LEFT JOIN user_management m ON m.user_id=u.id WHERE u.id=?`).get(id);if(!user)fail(404,'用户不存在');return user;}
 function products(){return paymentCatalog(db,{all:true}).filter(row=>row.entitlementType==='membership'&&row.durationDays>=1&&row.durationDays<=366&&row.membershipItems.length>0&&row.membershipItems.every(item=>membershipKeys.has(item.key))).map(({id,title,durationDays,membershipItems})=>({id,title,durationDays,membershipItems}));}
 function detail(id){
  const user=owner(id),credits=billing.balance(id),usage=billing.entitlements(id).membershipUsage;
  const memberships=managedMemberships(db,id).map(row=>({...row,items:usage[row.origin==='admin'?row.id:row.orderId]||row.items.map(item=>{const counts=db.prepare(`SELECT COALESCE(sum(CASE WHEN status='held' THEN 1 ELSE 0 END),0) held,COALESCE(sum(CASE WHEN status='settled' THEN 1 ELSE 0 END),0) used FROM billing_reservations WHERE ${row.origin==='admin'?'source_grant_id':'source_order'}=? AND COALESCE(entitlement_key,type)=? AND status IN ('held','settled')`).get(row.origin==='admin'?row.grantId:row.orderId,item.key);return {...item,...counts,remaining:Math.max(0,item.quantity-counts.held-counts.used)};})}));
  const history=db.prepare("SELECT id,actor_id AS actorId,action,detail,created_at AS createdAt FROM admin_audit WHERE target_type='user' AND target_id=? AND action LIKE 'user.%' ORDER BY created_at DESC,rowid DESC LIMIT 50").all(id).map(row=>({...row,detail:JSON.parse(row.detail)}));
  return {user,credits,memberships,membershipProducts:products(),history};
 }
 function expires(value,{start,grant=false,at}){
  if(typeof value!=='string'||value.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))fail(400,'请填写有效的会员到期时间');
  const normalized=new Date(value).toISOString();
  if(normalized<=start||grant&&normalized<=at||Date.parse(normalized)>Date.parse(at)+3660*86400000)fail(400,'会员到期时间须晚于开始时间，且不能超过未来 10 年');
  return normalized;
 }
 function held(grant){return db.prepare(`SELECT count(*) n FROM billing_reservations WHERE ${grant.origin==='admin'?'source_grant_id':'source_order'}=? AND status='held'`).get(grant.origin==='admin'?grant.grantId:grant.orderId).n;}
 function mutate(actor,id,action,input){
  const allowed={credits:['commandId','version','delta','reason'],membership:['commandId','version','action','productId','grantId','expiresAt','reason'],status:['commandId','version','status','reason']}[action];
  if(!object(input)||Object.keys(input).some(key=>!allowed.includes(key))||typeof input.commandId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(input.commandId)||!Number.isSafeInteger(input.version)||input.version<1||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500)fail(400,'请填写有效的操作信息与原因（最多 500 字）');
  const reason=input.reason.trim(),hash=createHash('sha256').update(JSON.stringify({id,action,...Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)))})).digest('hex');
  transaction(()=>{
   const live=owner(actor.id);if(live.role!=='admin'||live.status!=='active')fail(403,'需要有效的管理员权限');
   const user=owner(id),previous=db.prepare('SELECT * FROM admin_user_commands WHERE actor_id=? AND command_id=?').get(actor.id,input.commandId);
   if(previous){if(previous.input_hash!==hash||previous.user_id!==id||previous.action!==action)fail(409,'操作标识已用于其他内容，请重新操作');return;}
   if(user.version!==input.version)fail(409,'用户信息已变化，请刷新后重新操作');
   const at=stamp();let detail;
   if(action==='credits'){
    if(!Number.isSafeInteger(input.delta)||input.delta===0||Math.abs(input.delta)>1000000)fail(400,'积分调整须为非零整数，单次最多 1,000,000 积分');
    const before=billing.balance(id);if(!Number.isSafeInteger(before.balance+input.delta)||before.available+input.delta<0)fail(409,'扣减积分不能超过可用积分，执行中的预占积分不能扣减');
    db.prepare('INSERT INTO admin_credit_adjustments(id,user_id,actor_id,amount,reason,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,actor.id,input.delta,reason,at);
    detail={delta:input.delta,before:before.balance,after:before.balance+input.delta,held:before.held,reason};
   }else if(action==='status'){
    if(!['active','banned'].includes(input.status))fail(400,'账号状态无效');
    if(input.status===user.status)fail(409,'账号已处于所选状态，请刷新后查看');
    if(input.status==='banned'&&(id===actor.id||user.role==='admin'))fail(409,'不能封禁当前管理员或其他管理员账号');
    if(input.status==='banned')db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    detail={from:user.status,to:input.status,reason};
   }else{
    if(!['grant','update','revoke'].includes(input.action))fail(400,'会员操作无效');
    if(input.action==='grant'){
     if(input.grantId!==undefined||typeof input.productId!=='string')fail(400,'请选择要授予的会员');
     const product=products().find(row=>row.id===input.productId);if(!product)fail(400,'所选会员未配置有效权益');
     const end=expires(input.expiresAt||new Date(Date.parse(at)+product.durationDays*86400000).toISOString(),{start:at,grant:true,at}),grantId=randomUUID();
     db.prepare('INSERT INTO admin_membership_grants(id,user_id,product_id,title,items,starts_at,expires_at,granted_by,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(grantId,id,product.id,product.title,JSON.stringify(product.membershipItems),at,end,actor.id,reason,at);
     detail={action:'grant',grantId:'admin:'+grantId,productId:product.id,title:product.title,startsAt:at,expiresAt:end,reason};
    }else{
     if(input.productId!==undefined||typeof input.grantId!=='string'||input.grantId.length>150||input.action==='revoke'&&input.expiresAt!==undefined)fail(400,'请指定有效的会员记录');
     const grant=managedMemberships(db,id,at).find(row=>row.id===input.grantId);if(!grant)fail(404,'会员记录不存在');
     if(grant.status==='revoked')fail(409,'该会员已撤销，请重新授予会员');
     const end=input.action==='revoke'?grant.expiresAt:expires(input.expiresAt,{start:grant.startsAt,at});
     if((input.action==='revoke'||end<grant.expiresAt)&&held(grant))fail(409,'该会员仍有执行中的预占任务，请等待任务结束后再缩短或撤销');
     if(input.action==='update'&&end===grant.expiresAt)fail(409,'会员到期时间没有变化');
     const status=input.action==='revoke'?'revoked':'active';
     db.prepare('INSERT INTO admin_membership_overrides(grant_key,user_id,expires_at,status,reason,updated_by,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(grant_key) DO UPDATE SET expires_at=excluded.expires_at,status=excluded.status,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(grant.id,id,end,status,reason,actor.id,at);
     detail={action:input.action,grantId:grant.id,origin:grant.origin,previousExpiresAt:grant.expiresAt,expiresAt:end,status,reason};
    }
   }
   const status=action==='status'?input.status:user.status,statusReason=action==='status'?reason:user.statusReason;
   db.prepare('INSERT OR IGNORE INTO user_management(user_id,status,version,reason,updated_by,updated_at) VALUES(?,?,1,?,?,?)').run(id,user.status,user.statusReason,actor.id,at);
   if(!db.prepare('UPDATE user_management SET status=?,version=version+1,reason=?,updated_by=?,updated_at=? WHERE user_id=? AND version=?').run(status,statusReason,actor.id,at,id,input.version).changes)fail(409,'用户信息已变化，请刷新后重新操作');
   const event=action==='membership'?'user.membership.'+input.action:action==='credits'?'user.credits.adjust':'user.status.update';
   audit(actor,event,'user',id,detail);
   db.prepare('INSERT INTO admin_user_commands(actor_id,command_id,user_id,action,input_hash,created_at) VALUES(?,?,?,?,?,?)').run(actor.id,input.commandId,id,action,hash,at);
  });
  return detail(id);
 }
 return {detail,mutate};
}
