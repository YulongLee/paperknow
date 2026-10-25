import test from 'node:test';
import assert from 'node:assert/strict';
import {revenuePeriod} from '../backend/admin-revenue.mjs';
import {revenueFixture,revenueNow} from './helpers/admin-revenue.mjs';

test('periods use Beijing calendar dates, real leap days and bounded inclusive custom ranges',()=>{
 const fixed=new Date('2026-10-25T16:10:00Z');
 assert.equal(revenuePeriod(new URLSearchParams('range=today'),fixed).today,'2026-10-26');
 assert.equal(revenuePeriod(new URLSearchParams('range=7d'),fixed).startDate,'2026-10-20');
 const last=revenuePeriod(new URLSearchParams('range=lastMonth'),fixed);assert.equal(last.startDate,'2026-09-01');assert.equal(last.endDate,'2026-09-30');
 assert.equal(revenuePeriod(new URLSearchParams('range=custom&startDate=2024-02-29&endDate=2024-02-29'),fixed).days,1);
 assert.equal(revenuePeriod(new URLSearchParams('range=custom&startDate=2025-10-26&endDate=2026-10-26'),fixed).days,366);
 for(const text of ['range=all','provider=bad','provider=wechat&provider=alipay','kind=bad','role=admin','range=custom&startDate=2026-02-29&endDate=2026-03-01','range=custom&startDate=2026-10-26&endDate=2026-10-25','range=custom&startDate=2026-10-25&endDate=2026-10-27','range=custom&startDate=2025-10-25&endDate=2026-10-26','page=0','pageSize=1000','range=today&startDate=2026-10-25'])assert.throws(()=>revenuePeriod(new URLSearchParams(text),fixed),error=>error.status===400,text);
});

test('empty reports have genuine zeroes, zero-filled days and no invented payment or profit data',t=>{
 const f=revenueFixture(t),r=f.report.report();assert.deepEqual(r.summary,{amountCents:0,orders:0,buyers:0,averageCents:0});assert.equal(r.daily.length,30);assert.ok(r.daily.every(row=>row.amountCents===0&&row.orders===0));assert.equal(r.items.length,0);assert.equal(r.page,1);assert.equal(r.dataQuality.excludedPaidOrders,0);assert.equal('profit' in r,false);assert.equal('refundAmountCents' in r,false);assert.equal(f.report.overview().totals.allTime.amountCents,0);
});

test('income belongs to the payment day, respects both midnight boundaries and uses the immutable price and title',t=>{
 const f=revenueFixture(t);
 f.order({id:'before',paidAt:'2026-10-24T15:59:59.999Z',amount:999});
 f.order({id:'start',paidAt:'2026-10-24T16:00:00.000Z',amount:101});
 f.order({id:'offset',paidAt:'2026-10-25T08:30:00+08:00',amount:202,provider:'alipay',kind:'credits',productId:'credits-200'});
 f.order({id:'end',paidAt:'2026-10-25T15:59:59.999Z',amount:303,kind:'bundle',productId:'bundle-bachelor',userId:'u2'});
 f.order({id:'next',paidAt:'2026-10-25T16:00:00.000Z',amount:404,provider:'alipay',userId:'u3'});
 f.order({id:'unknown-kind',amount:37,entitlement:'{',userId:'u2'});
 for(const status of ['pending','failed','closed','cancelled','expired','refunded'])f.order({id:status,status,amount:9999});
 f.db.prepare('UPDATE products SET title=?,rules=? WHERE id=?').run('后来改名并涨价的商品',JSON.stringify({priceCents:999999}),'basic');
 const r=f.report.report(f.query(f.selected));
 assert.deepEqual(r.summary,{amountCents:643,orders:4,buyers:2,averageCents:161});assert.equal(r.daily[0].amountCents,643);assert.equal(r.previous.amountCents,999);
 assert.equal(r.totals.today.amountCents,404);assert.equal(r.totals.month.amountCents,2046);assert.equal(r.totals.allTime.amountCents,2046);
 assert.equal(r.byProvider.reduce((n,row)=>n+row.amountCents,0),643);assert.equal(r.byKind.reduce((n,row)=>n+row.amountCents,0),643);assert.equal(r.byKind.find(row=>row.key==='other').amountCents,37);
 assert.equal(r.items[0].id,'end');assert.equal(r.items.at(-1).id,'start');assert.ok(r.products.every(row=>row.title==='原商品快照'));assert.equal(r.dataQuality.markedRefundedOrders,1);
 const filtered=f.report.report(f.query(f.selected+'&provider=wechat&kind=membership'));assert.equal(filtered.summary.amountCents,101);assert.equal(filtered.items.length,1);assert.equal(filtered.totals.allTime.amountCents,1100);
 const text=JSON.stringify(r);for(const secret of ['sealed_settings','not-a-credential','entitlement','input_hash','example.invalid','qr_content'])assert.equal(text.includes(secret),false,secret);
});

test('unverified legacy paid rows, invalid amounts, currencies, timestamps and owner mismatches are excluded visibly',t=>{
 const f=revenueFixture(t);f.order({id:'good',amount:1});
 for(const [id,fields] of [['no-detail',{noPayment:true}],['no-trade',{tradeNo:null}],['empty-trade',{tradeNo:' '}],['bad-time',{paidAt:'not-a-timestamp'}],['missing-time',{paidAt:null}],['wrong-currency',{currency:'USD'}],['fraction',{amount:1.5}],['owner',{paymentUser:'u2'}],['future',{paidAt:new Date(revenueNow.getTime()+301000).toISOString()}]])f.order({id,...fields});
 const r=f.report.report();assert.equal(r.summary.amountCents,1);assert.equal(r.summary.orders,1);assert.equal(r.dataQuality.excludedPaidOrders,9);assert.equal(r.totals.allTime.amountCents,1);
});

test('repeated reads do not change paid orders or balances and remain safe inside an existing read transaction',t=>{
 const f=revenueFixture(t);f.order();const before=f.db.prepare('SELECT * FROM payment_orders').all();
 f.db.exec('BEGIN');assert.equal(f.report.report().summary.orders,1);assert.equal(f.db.isTransaction,true);f.db.exec('COMMIT');
 for(let i=0;i<3;i++)f.report.overview();assert.deepEqual(f.db.prepare('SELECT * FROM payment_orders').all(),before);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_credit_ledger').get().n,0);
});

test('pagination is stable and clamps out-of-range pages while totals and CSV cover the entire filtered period',t=>{
 const f=revenueFixture(t);for(let i=0;i<45;i++)f.order({id:'p-'+String(i).padStart(3,'0'),amount:i+1});
 const r=f.report.report(f.query(f.selected+'&page=999&pageSize=20'));assert.equal(r.page,3);assert.equal(r.items.length,5);assert.equal(r.items[0].id,'p-004');assert.equal(r.total,45);assert.equal(r.summary.amountCents,1035);
 const exported=f.report.exportCSV(f.query(f.selected+'&page=3&pageSize=1'));assert.equal(exported.rows,45);assert.equal(exported.amountCents,1035);assert.equal(exported.csv.split('\r\n').length,47);
});

test('CSV preserves exact cents, escapes formulas and quotes without including credentials or customer contact details',t=>{
 const f=revenueFixture(t);f.order({id:'csv',userId:'u2',outTradeNo:'000202610250000000000001',tradeNo:'2026102512345678901234567890',title:'=HYPERLINK("https://example.invalid", "x")\n第二行',amount:12999});
 const csv=f.report.exportCSV(f.query(f.selected));assert.ok(csv.csv.startsWith('\uFEFF'));assert.match(csv.csv,/"129\.99"/);assert.match(csv.csv,/"'000202610250000000000001"/);assert.match(csv.csv,/"'2026102512345678901234567890"/);assert.match(csv.csv,/"'=HYPERLINK/);assert.match(csv.csv,/"'=SUM\(1,2\)"/);assert.match(csv.csv,/""https:\/\/example.invalid""/);assert.match(csv.csv,/2026-10-25 09:00:00/);assert.doesNotMatch(csv.csv,/sealed_settings|not-a-credential|@example.invalid/);
});

test('oversized exports fail explicitly rather than silently returning a truncated financial report',t=>{
 const f=revenueFixture(t);f.order({id:'seed'});
 f.db.exec(`BEGIN;
 WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<10000) INSERT INTO orders(id,user_id,product_id,status,created_at) SELECT 'bulk-'||n,'u1','basic','paid','2026-10-25T00:00:00.000Z' FROM seq;
 INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,currency,title,entitlement,idempotency_key,input_hash,user_id,provider_trade_no,expires_at,paid_at,updated_at) SELECT id,'wechat','PK'||id,'wechat',1,'CNY','批量测试','{"type":"membership"}',id,'fixture','u1','trade-'||id,'2026-10-27T00:00:00.000Z','2026-10-25T00:00:00.000Z','2026-10-25T00:00:00.000Z' FROM orders WHERE id LIKE 'bulk-%';COMMIT;`);
 assert.equal(f.report.report(f.query(f.selected)).total,10001);assert.throws(()=>f.report.exportCSV(f.query(f.selected)),error=>error.status===400&&/10,000/.test(error.message));assert.equal(f.db.isTransaction,false);
});

test('financial aggregates outside the exact integer range fail closed instead of rounding the income',t=>{
 const f=revenueFixture(t);f.order({id:'huge-1',amount:Number.MAX_SAFE_INTEGER});f.order({id:'huge-2',amount:100});assert.throws(()=>f.report.report(),/安全统计范围|too large/);assert.equal(f.db.isTransaction,false);
});


test('calendar month comparisons use the previous month rather than a rolling tail of unrelated dates',t=>{
 const f=revenueFixture(t),month=f.report.report(f.query('range=month')),last=f.report.report(f.query('range=lastMonth'));
 assert.equal(month.previous.startDate,'2026-09-01');assert.equal(month.previous.endDate,'2026-09-26');assert.equal(last.previous.startDate,'2026-08-01');assert.equal(last.previous.endDate,'2026-08-31');
});
