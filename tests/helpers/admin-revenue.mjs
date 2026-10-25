import {database} from '../../backend/database.mjs';
import {createAdminRevenue} from '../../backend/admin-revenue.mjs';
export const revenueNow=new Date('2026-10-26T02:00:00.000Z');
export function revenueFixture(t){
 const db=database(':memory:');t.after(()=>db.close());
 for(const id of ['admin','u1','u2','u3'])db.prepare('INSERT INTO users(id,email,name,role,created_at) VALUES(?,?,?,?,?)').run(id,id+'@example.invalid',id==='u2'?'=SUM(1,2)':id,id==='admin'?'admin':'user',revenueNow.toISOString());
 for(const provider of ['wechat','alipay'])db.prepare('INSERT INTO payment_config_versions VALUES(?,?,?,?,?,?,?)').run(provider,provider,'not-a-credential','fixture-merchant',null,'admin',revenueNow.toISOString());
 const report=createAdminRevenue(db,{now:()=>new Date(revenueNow)});
 let seq=0;
 function order({id='order-'+(++seq),userId='u1',paymentUser=userId,status='paid',provider='wechat',amount=101,kind='membership',title='原商品快照',productId='basic',paidAt='2026-10-25T01:00:00.000Z',tradeNo='trade-'+id,currency='CNY',entitlement=JSON.stringify({type:kind}),noPayment=false,createdAt='2026-10-01T00:00:00.000Z',outTradeNo='PK'+id}={}){
  db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,userId,productId,status,createdAt);
  if(!noPayment)db.prepare(`INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,currency,title,entitlement,idempotency_key,input_hash,user_id,provider_trade_no,expires_at,paid_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,provider,outTradeNo,provider,amount,currency,title,entitlement,id,'fixture-only-hash',paymentUser,tradeNo,'2026-10-27T01:00:00.000Z',paidAt,revenueNow.toISOString());
  return id;
 }
 return {db,report,order,query:value=>new URLSearchParams(value),selected:'range=custom&startDate=2026-10-25&endDate=2026-10-25'};
}
