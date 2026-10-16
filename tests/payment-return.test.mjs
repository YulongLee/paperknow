import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../server.mjs';
import {database} from '../backend/database.mjs';

const orderId='f344bda6-211e-4c29-8d35-776047d1ac1a';
function seedOrder(db){
 const now=new Date().toISOString();
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('payment-return-user','return@example.invalid','回跳测试账户',null,'user',now);
 db.prepare('INSERT INTO payment_config_versions(id,provider,sealed_settings,identity_hash,created_by,created_at) VALUES(?,?,?,?,?,?)').run('old-payment-config','alipay','{}','migration-only','payment-return-user',now);
 db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(orderId,'payment-return-user','credits-200','pending',now);
 db.prepare('INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,title,entitlement,idempotency_key,input_hash,user_id,qr_content,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(orderId,'alipay','PKhistorical123','old-payment-config',2000,'历史200积分订单',JSON.stringify({type:'credits',creditAmount:200}),'old-idempotency-key','old-input-hash','payment-return-user','https://qr.alipay.com/old-qr',new Date(Date.now()+600000).toISOString(),now);
}
async function fixture(t){
 const app=createServer({dbPath:':memory:',config:{ownerEmail:'owner@example.invalid'}});seedOrder(app.db);
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
 const base='http://127.0.0.1:'+app.server.address().port;
 return {...app,get:(path,options={})=>fetch(base+path,{redirect:'manual',...options})};
}

test('Alipay browser return only navigates to a fixed order page and cannot confirm payment or grant credit',async t=>{
 const f=await fixture(t),before=f.db.prepare('SELECT * FROM payment_orders').get();
 const response=await f.get('/api/payments/return/alipay?order='+orderId+'&trade_status=TRADE_SUCCESS&total_amount=0.01&trade_no=forged-transaction&sign=forged&return_url=https://evil.example.invalid&next=//evil.example.invalid');
 assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/workspace.html#membership/pay?order='+orderId);
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('x-robots-tag'),'noindex');assert.equal(await response.text(),'');
 assert.deepEqual(f.db.prepare('SELECT * FROM payment_orders').get(),before);assert.equal(f.db.prepare('SELECT status FROM orders').get().status,'pending');assert.equal(f.db.prepare('SELECT count(*) AS n FROM payment_credit_ledger').get().n,0);assert.equal(f.db.prepare('SELECT count(*) AS n FROM payment_entitlements').get().n,0);
 assert.equal((await f.get('/api/orders/'+orderId)).status,401,'the return target does not grant an order session');
 const nonexistent='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',unknown=await f.get('/api/payments/return/alipay?order='+nonexistent);assert.equal(unknown.status,303);assert.equal(unknown.headers.get('location'),'/workspace.html#membership/pay?order='+nonexistent);assert.equal(f.db.prepare('SELECT count(*) AS n FROM orders').get().n,1);
});

test('Alipay return rejects invalid or duplicate order IDs and every mutation method',async t=>{
 const f=await fixture(t);
 for(const query of ['', '?order=', '?order=not-an-order', '?order=https%3A%2F%2Fevil.example.invalid', '?order=%2F%2Fevil.example.invalid', '?order='+orderId+'&order='+orderId, '?order='+orderId+'%0d%0aLocation%3Ahttps%3A%2F%2Fevil.example.invalid']){
  const response=await f.get('/api/payments/return/alipay'+query);assert.equal(response.status,400);assert.equal(response.headers.get('location'),null);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 }
 for(const method of ['POST','HEAD','PUT','DELETE']){
  const response=await f.get('/api/payments/return/alipay?order='+orderId,{method});assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET');assert.equal(response.headers.get('location'),null);
 }
 assert.equal(f.db.prepare('SELECT status FROM orders').get().status,'pending');assert.equal(f.db.prepare('SELECT count(*) AS n FROM payment_credit_ledger').get().n,0);
});

test('nullable page-pay migration preserves old QR orders, paid credit records, configuration versions and idempotency',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'paperknow-payment-url-migration-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'payments.sqlite');
 let db=database(path);seedOrder(db);db.exec('ALTER TABLE payment_orders DROP COLUMN payment_url');
 db.prepare("UPDATE orders SET status='paid' WHERE id=?").run(orderId);
 db.prepare('UPDATE payment_orders SET provider_trade_no=?,paid_at=? WHERE order_id=?').run('existing-paid-transaction',new Date().toISOString(),orderId);
 db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(orderId,'payment-return-user','credits-200',200,'purchase',new Date().toISOString());
 const oldOrder={...db.prepare('SELECT * FROM payment_orders').get()},oldLedger=db.prepare('SELECT * FROM payment_credit_ledger').get(),oldVersion=db.prepare('SELECT * FROM payment_config_versions').get();db.close();
 for(let i=0;i<3;i++){
  db=database(path);const {payment_url,...migrated}=db.prepare('SELECT * FROM payment_orders').get();assert.equal(payment_url,null);assert.deepEqual(migrated,oldOrder);assert.deepEqual(db.prepare('SELECT * FROM payment_credit_ledger').get(),oldLedger);assert.deepEqual(db.prepare('SELECT * FROM payment_config_versions').get(),oldVersion);assert.equal(db.prepare('SELECT status FROM orders').get().status,'paid');assert.equal(db.prepare('SELECT sum(amount) AS n FROM payment_credit_ledger').get().n,200);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(db.prepare('PRAGMA table_info(payment_orders)').all().filter(column=>column.name==='payment_url').length,1);assert.throws(()=>db.prepare('UPDATE payment_credit_ledger SET amount=999 WHERE order_id=?').run(orderId),/积分记录不可修改/);db.close();
 }
});
