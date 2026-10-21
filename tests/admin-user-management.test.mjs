import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createAdminAPI} from '../backend/admin-api.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {createPaymentService} from '../backend/payment-service.mjs';
import {createSession} from '../backend/auth.mjs';

function fixture(t){
 const db=database(':memory:'),config={aiURL:'https://test.example.invalid/chat',aiKey:'synthetic-no-network',aiModel:'test-model',agentEnabled:true},billing=createBillingService(db,config);config.billing=billing;
 const at=new Date().toISOString(),seed=(id,role='user')=>{db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(id,'合成管理验收',role,at);return {id,role};};
 const admin=seed('management-admin','admin'),user=seed('management-user'),other=seed('management-other');
 db.prepare('UPDATE products SET rules=? WHERE id=?').run(JSON.stringify({priceCents:2900,durationDays:30,membershipItems:[{key:'polish',title:'润色',quantity:2}],description:'测试会员',entitlementType:'membership',paymentEnabled:false}),'basic');
 const api=createAdminAPI(db,{cancel(){}},config,{options:()=>({})}),payments=createPaymentService(db,config);
 const call=(suffix='',input,actor=admin,id=user.id)=>api({path:'/api/admin/users/'+id+'/'+(suffix||'manage'),method:input===undefined?'GET':'POST',readBody:async()=>input,user:actor});
 const details=()=>call(),command=async(action,extra={},version)=>call(action,{commandId:randomUUID(),version:version??(await details()).user.version,reason:'合成测试：客服人工调整',...extra});
 function transaction(work){db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 function paid(){billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});}
 function job(owner=user){const id=randomUUID();db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,owner.id,'polish','queued','queued','{}',id,id,at,at);return id;}
 function reserve(quote,owner=user){const id=job(owner);const reservation=transaction(()=>billing.reserve(owner,id,1,'polish',quote.token));return {id,reservation};}
 function paidMembership(){const id=randomUUID(),expiresAt=new Date(Date.now()+30*86400000).toISOString();db.prepare('INSERT OR IGNORE INTO payment_config_versions(id,provider,sealed_settings,identity_hash,created_by,created_at) VALUES(?,?,?,?,?,?)').run('synthetic-payment-config','wechat','{}','synthetic',admin.id,at);db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,user.id,'basic','paid',at);db.prepare('INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,title,entitlement,idempotency_key,input_hash,user_id,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'wechat','synthetic-'+id,'synthetic-payment-config',2900,'已购会员',JSON.stringify({type:'membership',durationDays:30,membershipItems:[{key:'polish',title:'润色',quantity:2}]}),id,id,user.id,expiresAt,at);db.prepare('INSERT INTO payment_entitlements VALUES(?,?,?,?,?,?,?)').run(id,user.id,'basic','membership',at,expiresAt,at);return id;}
 t.after(()=>db.close());return {db,config,billing,payments,api,admin,user,other,call,command,details,paid,reserve,job,transaction,paidMembership};
}

test('admin user reads and mutations independently reject missing, ordinary and banned actors',async t=>{
 const f=fixture(t);
 for(const actor of [null,f.user])await assert.rejects(f.call('manage',undefined,actor),{status:actor?403:401});
 await assert.rejects(f.call('credits',{commandId:randomUUID(),version:1,delta:100,reason:'非法角色提升',role:'admin'},f.user),{status:403});
 f.db.prepare('INSERT INTO user_management VALUES(?,?,?,?,?,?)').run(f.admin.id,'banned',1,'测试封禁',f.admin.id,new Date().toISOString());
 await assert.rejects(f.call(),{status:403});assert.equal(f.db.prepare('SELECT count(*) n FROM admin_credit_adjustments').get().n,0);
});

test('credit adjustments are immutable, idempotent, version checked and usable by real billing',async t=>{
 const f=fixture(t);f.paid();const input={commandId:randomUUID(),version:1,delta:100,reason:'合成充值补偿'};
 const first=await f.call('credits',input);assert.equal(first.credits.available,100);assert.equal(first.user.version,2);assert.equal(first.history[0].action,'user.credits.adjust');
 const retried=await f.call('credits',input);assert.equal(retried.credits.balance,100);assert.equal(retried.history.length,1);assert.equal(f.db.prepare('SELECT count(*) n FROM orders').get().n,0);
 await assert.rejects(f.call('credits',{...input,delta:200}),{status:409});
 await assert.rejects(f.command('credits',{delta:1},1),{status:409});
 const quote=f.billing.quote(f.user,{type:'polish'}),task=f.reserve(quote);assert.deepEqual({...f.billing.balance(f.user.id),ledger:[]},{balance:100,held:10,available:90,ledger:[]});
 await assert.rejects(f.command('credits',{delta:-91}),{status:409});
 await f.command('credits',{delta:-90});assert.equal(f.billing.balance(f.user.id).available,0);
 f.transaction(()=>f.billing.settle(task.id));f.transaction(()=>f.billing.settle(task.id));assert.equal(f.billing.balance(f.user.id).balance,0);assert.equal(f.billing.balance(f.other.id).balance,0);
 assert.equal(f.payments.entitlements(f.user).credits.balance,0);assert.equal(f.payments.entitlements(f.user).credits.ledger.filter(row=>row.kind==='admin_adjustment').length,2);
 assert.throws(()=>f.db.prepare('UPDATE admin_credit_adjustments SET amount=1').run(),/不可修改/);assert.throws(()=>f.db.exec('DELETE FROM admin_credit_adjustments'),/不可删除/);
});

test('credit validation rejects invalid numbers, unknown fields and negative balances without audit side effects',async t=>{
 const f=fixture(t);
 for(const delta of [0,1.5,'10',1000001,-1])await assert.rejects(f.command('credits',{delta}),error=>[400,409].includes(error.status));
 await assert.rejects(f.command('credits',{delta:10,unexpected:true}),{status:400});
 await assert.rejects(f.command('credits',{delta:10,reason:' '}),{status:400});
 assert.equal((await f.details()).user.version,1);assert.equal(f.db.prepare('SELECT count(*) n FROM admin_audit').get().n,0);
});

test('a quoted credit task cannot reserve credits removed by a later administrator adjustment',async t=>{
 const f=fixture(t);f.paid();await f.command('credits',{delta:50});const quote=f.billing.quote(f.user,{type:'polish'});
 await f.command('credits',{delta:-45});assert.throws(()=>f.reserve(quote),{status:402});
 assert.equal(f.billing.balance(f.user.id).available,5);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);
 assert.equal(f.db.prepare('SELECT used FROM billing_quotes WHERE token=?').get(quote.token).used,0);
});

test('granted memberships consume and release actual quota without inventing payment orders',async t=>{
 const f=fixture(t);f.paid();const grant=await f.command('membership',{action:'grant',productId:'basic'}),membership=grant.memberships[0];
 assert.equal(membership.origin,'admin');assert.equal(grant.history[0].action,'user.membership.grant');assert.equal(f.payments.entitlements(f.user).items[0].origin,'admin');assert.equal(f.db.prepare('SELECT count(*) n FROM orders').get().n,0);
 const quote=f.billing.quote(f.user,{type:'polish'});assert.equal(quote.source,'membership');assert.equal(quote.sourceOrderId,membership.id);
 const first=f.reserve(quote);assert.equal(first.reservation.sourceOrderId,membership.id);const raw=f.db.prepare('SELECT * FROM billing_reservations WHERE job_id=?').get(first.id);assert.equal(raw.source_order,null);assert.equal('admin:'+raw.source_grant_id,membership.id);
 await assert.rejects(f.command('membership',{action:'revoke',grantId:membership.id}),{status:409});
 f.transaction(()=>f.billing.release(first.id));const second=f.reserve(f.billing.quote(f.user,{type:'polish'}));f.transaction(()=>f.billing.settle(second.id));f.transaction(()=>f.billing.settle(second.id));
 const usage=f.billing.entitlements(f.user.id).membershipUsage[membership.id][0];assert.equal(usage.used,1);assert.equal(usage.remaining,1);assert.equal(usage.held,0);
 const stale=f.billing.quote(f.user,{type:'polish'});await f.command('membership',{action:'revoke',grantId:membership.id});
 assert.throws(()=>f.reserve(stale),{status:409});assert.equal(f.payments.entitlements(f.user).items.length,0);assert.equal((await f.details()).memberships[0].status,'revoked');assert.equal((await f.details()).memberships[0].items[0].used,1);assert.equal((await f.details()).history[0].action,'user.membership.revoke');
});

test('paid membership adjustments use separate overrides, preserve merchant snapshots and invalidate revoked quotes',async t=>{
 const f=fixture(t);f.paid();const orderId=f.paidMembership(),before=f.db.prepare('SELECT * FROM payment_entitlements WHERE order_id=?').get(orderId),order=f.db.prepare('SELECT * FROM payment_orders WHERE order_id=?').get(orderId);
 const later=new Date(Date.parse(before.expires_at)+86400000).toISOString();await f.command('membership',{action:'update',grantId:'payment:'+orderId,expiresAt:later});
 assert.equal(f.payments.entitlements(f.user).items[0].expires_at,later);assert.deepEqual(f.db.prepare('SELECT * FROM payment_entitlements WHERE order_id=?').get(orderId),before);assert.deepEqual(f.db.prepare('SELECT * FROM payment_orders WHERE order_id=?').get(orderId),order);
 const held=f.reserve(f.billing.quote(f.user,{type:'polish'}));await assert.rejects(f.command('membership',{action:'update',grantId:'payment:'+orderId,expiresAt:before.expires_at}),{status:409});f.transaction(()=>f.billing.release(held.id));
 const quote=f.billing.quote(f.user,{type:'polish'});await f.command('membership',{action:'revoke',grantId:'payment:'+orderId});assert.throws(()=>f.reserve(quote),{status:409});
 assert.equal(f.payments.entitlements(f.user).items.length,0);assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(orderId).status,'paid');
});

test('membership expiry and ownership are rechecked after a quote and held usage prevents shortening',async t=>{
 const f=fixture(t);f.paid();const grant=(await f.command('membership',{action:'grant',productId:'basic'})).memberships[0],quote=f.billing.quote(f.user,{type:'polish'}),task=f.reserve(quote);
 await assert.rejects(f.command('membership',{action:'update',grantId:grant.id,expiresAt:new Date(Date.now()+86400000).toISOString()}),{status:409});
 f.transaction(()=>f.billing.release(task.id));const stale=f.billing.quote(f.user,{type:'polish'});f.db.prepare('INSERT INTO admin_membership_overrides VALUES(?,?,?,?,?,?,?)').run(grant.id,f.user.id,new Date(Date.now()-1000).toISOString(),'active','合成过期',f.admin.id,new Date().toISOString());assert.throws(()=>f.reserve(stale),{status:409});
 const otherJob=f.job(f.other);assert.throws(()=>f.transaction(()=>f.billing.reserve(f.other,otherJob,1,'polish',stale.token)),{status:409});
});

test('ban and unban revoke sessions without changing credits, membership or historical purchases',async t=>{
 const f=fixture(t);await f.command('credits',{delta:100});await f.command('membership',{action:'grant',productId:'basic'});createSession(f.db,f.user.id);
 const ban=await f.command('status',{status:'banned'});assert.equal(ban.user.status,'banned');assert.equal(ban.history[0].action,'user.status.update');assert.equal(ban.credits.balance,100);assert.equal(ban.memberships.length,1);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(f.user.id).n,0);
 const unban=await f.command('status',{status:'active'});assert.equal(unban.user.status,'active');assert.equal(unban.credits.balance,100);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(f.user.id).n,0);
 const identity=await f.api({path:'/api/admin/users',method:'GET',query:new URLSearchParams('accountStatus=active'),user:f.admin});assert.equal(identity.total,3);
 await assert.rejects(f.call('status',{commandId:randomUUID(),version:1,status:'banned',reason:'保护当前管理员'},f.admin,f.admin.id),{status:409});
});
