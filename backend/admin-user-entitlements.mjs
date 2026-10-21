import {paymentBundleItems} from './payment-settings.mjs';

// Overrides never rewrite the merchant order or its original entitlement snapshot.
export function managedMemberships(db,userId,at=new Date().toISOString()){
 const paid=db.prepare(`SELECT e.order_id AS orderId,e.product_id AS productId,e.starts_at AS startsAt,e.expires_at AS originalExpiresAt,d.title,d.entitlement FROM payment_entitlements e JOIN payment_orders d ON d.order_id=e.order_id JOIN orders o ON o.id=e.order_id WHERE e.user_id=? AND o.user_id=? AND o.status='paid'`).all(userId,userId).flatMap(({entitlement,...row})=>{
  let snapshot;try{snapshot=JSON.parse(entitlement);}catch{return [];}
  if(snapshot?.type!=='membership')return [];
  return [{...row,id:'payment:'+row.orderId,origin:'payment',items:paymentBundleItems(snapshot.membershipItems||[],{allowEmpty:true})||[],description:snapshot.description||''}];
 });
 const admin=db.prepare('SELECT id,product_id AS productId,title,items,starts_at AS startsAt,expires_at AS originalExpiresAt,reason,created_at AS grantedAt FROM admin_membership_grants WHERE user_id=?').all(userId).map(row=>({...row,id:'admin:'+row.id,grantId:row.id,orderId:null,origin:'admin',description:'管理员授予会员',items:paymentBundleItems(JSON.parse(row.items),{allowEmpty:true})||[]}));
 const overrides=new Map(db.prepare('SELECT * FROM admin_membership_overrides WHERE user_id=?').all(userId).map(row=>[row.grant_key,row]));
 return [...paid,...admin].map(row=>{const override=overrides.get(row.id),expiresAt=override?.expires_at||row.originalExpiresAt,status=override?.status==='revoked'?'revoked':expiresAt<=at?'expired':row.startsAt>at?'scheduled':'active';return {...row,expiresAt,status,...(override?{managementReason:override.reason,managedAt:override.updated_at}:{})};}).sort((a,b)=>b.expiresAt.localeCompare(a.expiresAt)||a.id.localeCompare(b.id));
}

export function adminCreditTotal(db,userId){return db.prepare('SELECT COALESCE(sum(amount),0) n FROM admin_credit_adjustments WHERE user_id=?').get(userId).n;}
export function adminCreditLedger(db,userId){return db.prepare("SELECT id,amount,reason,created_at AS createdAt FROM admin_credit_adjustments WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100").all(userId).map(row=>({...row,id:'admin:'+row.id,kind:'admin_adjustment',source:'credits',origin:'admin',title:row.amount>0?'管理员增加积分':'管理员扣减积分',orderId:null,jobId:null,heldDelta:0}));}
