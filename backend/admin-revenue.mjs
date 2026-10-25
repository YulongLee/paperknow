const DAY=86400000,ZONE='Asia/Shanghai',MAX_DAYS=366,EXPORT_LIMIT=10000;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const kinds=['membership','bundle','credits','other'];
const providers=['wechat','alipay'];
const kindSQL=`CASE WHEN json_valid(p.entitlement) THEN CASE json_extract(p.entitlement,'$.type') WHEN 'membership' THEN 'membership' WHEN 'bundle' THEN 'bundle' WHEN 'credits' THEN 'credits' ELSE 'other' END ELSE 'other' END`;
const validSQL=`p.user_id=o.user_id AND p.currency='CNY' AND typeof(p.amount_cents)='integer' AND p.amount_cents>0
 AND p.provider IN ('wechat','alipay') AND length(trim(COALESCE(p.provider_trade_no,'')))>0
 AND unixepoch(p.paid_at) IS NOT NULL AND unixepoch(p.paid_at)<=?`;
const baseSQL='FROM payment_orders p JOIN orders o ON o.id=p.order_id';
const dayValue=value=>new Date(value+8*3600000).toISOString().slice(0,10);
const shift=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
const epoch=date=>Date.parse(date+'T00:00:00+08:00')/1000;
function dateValue(raw){
 if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(raw)||!Number.isFinite(Date.parse(raw+'T00:00:00Z'))||new Date(raw+'T00:00:00Z').toISOString().slice(0,10)!==raw||raw<'2000-01-01')fail(400,'请选择有效日期');
 return raw;
}
const integer=(value,label='统计金额')=>{if(!Number.isSafeInteger(value)||value<0)fail(503,label+'超出安全统计范围，请联系管理员核对');return value;};
const summaryRow=row=>({amountCents:integer(row.amountCents),orders:integer(row.orders,'订单数量'),buyers:integer(row.buyers,'付费人数'),averageCents:row.orders?Number((BigInt(row.amountCents)*2n+BigInt(row.orders))/(BigInt(row.orders)*2n)):0});
export function revenuePeriod(query=new URLSearchParams(),now=new Date()){
 const allowed=['range','startDate','endDate','provider','kind','page','pageSize'];
 for(const key of query.keys())if(!allowed.includes(key)||query.getAll(key).length!==1)fail(400,'收益筛选参数不正确');
 const today=dayValue(now.getTime()),range=query.get('range')||'30d',provider=query.get('provider')||'',kind=query.get('kind')||'';
 if(provider&&!providers.includes(provider)||kind&&!kinds.includes(kind))fail(400,'请选择有效的支付渠道或商品类型');
 let startDate,endDate=today;
 if(range==='today')startDate=today;
 else if(['7d','30d','90d'].includes(range))startDate=shift(today,1-Number(range.slice(0,-1)));
 else if(range==='month')startDate=today.slice(0,8)+'01';
 else if(range==='lastMonth'){endDate=shift(today.slice(0,8)+'01',-1);startDate=endDate.slice(0,8)+'01';}
 else if(range==='custom'){startDate=dateValue(query.get('startDate'));endDate=dateValue(query.get('endDate'));}
 else fail(400,'请选择有效的统计期间');
 if(range!=='custom'&&(query.has('startDate')||query.has('endDate')))fail(400,'自定义日期请选择自定义期间');
 const days=Math.round((Date.parse(endDate+'T00:00:00Z')-Date.parse(startDate+'T00:00:00Z'))/DAY)+1;
 if(days<1||days>MAX_DAYS)fail(400,'统计期间须为 1–366 天，开始日期不能晚于结束日期');
 if(endDate>today)fail(400,'结束日期不能晚于今天');
 const positive=(key,fallback,max)=>{const raw=query.get(key);if(raw===null)return fallback;if(!/^[1-9]\d{0,5}$/.test(raw)||Number(raw)>max)fail(400,'收益分页参数不正确');return Number(raw);};
 return {range,startDate,endDate,days,today,provider,kind,page:positive('page',1,999999),pageSize:positive('pageSize',20,50),timezone:ZONE};
}
const currency=cents=>`${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;
function csvCell(value){let text=String(value??'');if(/^[\s\uFEFF]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text)||/^\d{16,}$/.test(text)||/^0\d+$/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}

export function createAdminRevenue(db,{now=()=>new Date()}={}){
 const snapshot=work=>{
  // All aggregates and the matching page describe the same database snapshot.
  if(db.isTransaction)return work();
  db.exec('BEGIN DEFERRED');try{const result=work();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
 };
 function where(filters,at,{start,end}={}){
  const sql=["o.status='paid'",validSQL],values=[Math.floor(at.getTime()/1000)+300];
  if(start){sql.push('unixepoch(p.paid_at)>=?');values.push(epoch(start));}
  if(end){sql.push('unixepoch(p.paid_at)<?');values.push(epoch(shift(end,1)));}
  if(filters.provider){sql.push('p.provider=?');values.push(filters.provider);}
  if(filters.kind){sql.push(kindSQL+'=?');values.push(filters.kind);}
  return {sql:' WHERE '+sql.map(value=>'('+value+')').join(' AND '),values};
 }
 function aggregate(filter){return summaryRow(db.prepare(`SELECT COALESCE(sum(p.amount_cents),0) amountCents,count(*) orders,count(DISTINCT o.user_id) buyers ${baseSQL}${filter.sql}`).get(...filter.values));}
 function totals(filters,at){const today=dayValue(at.getTime());return {today:aggregate(where(filters,at,{start:today,end:today})),month:aggregate(where(filters,at,{start:today.slice(0,8)+'01',end:today})),allTime:aggregate(where(filters,at))};}
 function quality(at){
  const row=db.prepare(`SELECT count(*) orders FROM orders o LEFT JOIN payment_orders p ON p.order_id=o.id WHERE o.status='paid' AND CASE WHEN ${validSQL} THEN 0 ELSE 1 END=1`).get(Math.floor(at.getTime()/1000)+300);
  return {excludedPaidOrders:integer(row.orders,'待核对订单数量'),markedRefundedOrders:db.prepare("SELECT count(*) n FROM orders WHERE status='refunded'").get().n};
 }
 function overview(){return snapshot(()=>{const at=now();return {asOf:at.toISOString(),timezone:ZONE,totals:totals({},at),dataQuality:quality(at),basis:'paid_orders'};});}
 function rows(filter,limit,offset=0){return db.prepare(`SELECT o.id,o.user_id AS userId,u.name AS userName,o.product_id AS productId,p.title AS productTitle,p.amount_cents AS amountCents,p.provider,p.out_trade_no AS outTradeNo,p.provider_trade_no AS providerTradeNo,p.paid_at AS paidAt,${kindSQL} AS kind ${baseSQL} JOIN users u ON u.id=o.user_id ${filter.sql} ORDER BY unixepoch(p.paid_at) DESC,o.id DESC LIMIT ? OFFSET ?`).all(...filter.values,limit,offset);}
 function report(query=new URLSearchParams()){
  return snapshot(()=>{
   const at=now(),filters=revenuePeriod(query,at),selected=where(filters,at,{start:filters.startDate,end:filters.endDate}),summary=aggregate(selected);
   let previousStart=shift(filters.startDate,-filters.days),previousEnd=shift(filters.startDate,-1);
   if(filters.range==='month'||filters.range==='lastMonth'){
    const priorMonthEnd=shift(filters.startDate,-1);previousStart=priorMonthEnd.slice(0,8)+'01';
    previousEnd=filters.range==='lastMonth'?priorMonthEnd:[priorMonthEnd,shift(previousStart,Number(filters.endDate.slice(8))-1)].sort()[0];
   }
   const previous=aggregate(where(filters,at,{start:previousStart,end:previousEnd}));
   const daily=Array.from({length:filters.days},(_,i)=>({date:shift(filters.startDate,i),amountCents:0,orders:0}));
   const dailyRows=db.prepare(`SELECT date(p.paid_at,'+8 hours') date,sum(p.amount_cents) amountCents,count(*) orders ${baseSQL}${selected.sql} GROUP BY date(p.paid_at,'+8 hours')`).all(...selected.values);
   const byDate=new Map(daily.map(row=>[row.date,row]));for(const row of dailyRows)if(byDate.has(row.date))Object.assign(byDate.get(row.date),{amountCents:integer(row.amountCents),orders:integer(row.orders,'订单数量')});
   const groupBy=column=>db.prepare(`SELECT ${column} key,sum(p.amount_cents) amountCents,count(*) orders ${baseSQL}${selected.sql} GROUP BY ${column}`).all(...selected.values).map(row=>({...row,amountCents:integer(row.amountCents)}));
   const groups=(keys,column)=>{const data=groupBy(column);return keys.map(key=>data.find(row=>row.key===key)||{key,amountCents:0,orders:0});};
   const products=db.prepare(`SELECT o.product_id AS productId,p.title,${kindSQL} kind,sum(p.amount_cents) amountCents,count(*) orders ${baseSQL}${selected.sql} GROUP BY o.product_id,p.title,${kindSQL} ORDER BY amountCents DESC,o.product_id,p.title LIMIT 10`).all(...selected.values).map(row=>({...row,amountCents:integer(row.amountCents)}));
   const page=Math.min(filters.page,Math.max(1,Math.ceil(summary.orders/filters.pageSize)));filters.page=page;
   return {asOf:at.toISOString(),currency:'CNY',basis:'paid_orders',filters,summary,previous:{startDate:previousStart,endDate:previousEnd,...previous},totals:totals(filters,at),daily,byProvider:groups(providers,'p.provider'),byKind:groups(kinds,kindSQL),products,dataQuality:quality(at),items:rows(selected,filters.pageSize,(page-1)*filters.pageSize),total:summary.orders,page,pageSize:filters.pageSize,exportLimit:EXPORT_LIMIT};
  });
 }
 function exportCSV(query=new URLSearchParams()){
  return snapshot(()=>{
   const at=now(),filters=revenuePeriod(query,at),selected=where(filters,at,{start:filters.startDate,end:filters.endDate}),summary=aggregate(selected);
   if(summary.orders>EXPORT_LIMIT)fail(400,'本次明细超过 10,000 笔，请缩小日期范围或筛选渠道后导出');
   const items=rows(selected,EXPORT_LIMIT),providerNames={wechat:'微信支付',alipay:'支付宝'},kindNames={membership:'会员订阅',bundle:'专项套餐',credits:'积分充值',other:'其他商品'};
   const lines=[['订单ID','商户订单号','支付平台交易号','商品（订单快照）','商品类型','支付渠道','实收金额（元）','支付时间（北京时间）','用户ID','用户昵称']];
   for(const row of items){const date=new Date(Date.parse(row.paidAt)+8*3600000).toISOString().slice(0,19).replace('T',' ');lines.push([row.id,row.outTradeNo,row.providerTradeNo,row.productTitle,kindNames[row.kind],providerNames[row.provider],currency(row.amountCents),date,row.userId,row.userName]);}
   return {filename:`PaperKnow_收益明细_${filters.startDate}_${filters.endDate}.csv`,csv:'\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n',rows:items.length,amountCents:summary.amountCents,filters,asOf:at.toISOString()};
  });
 }
 return {overview,report,exportCSV};
}
