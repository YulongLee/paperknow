import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createAdminPage} from '../dist/admin.mjs';
import {revenueMoney} from '../dist/admin-revenue.mjs';
import {revenueFixture} from './helpers/admin-revenue.mjs';
const html=await readFile(new URL('../dist/admin.html',import.meta.url),'utf8');
const until=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,3));}assert.fail('revenue UI did not settle');};
async function page(t,{hash='#revenue',role='admin',handle,empty=false}={}){
 const f=revenueFixture(t);if(!empty){for(let i=0;i<31;i++)f.order({id:'sale-'+String(i).padStart(3,'0'),amount:(i+1)*100,kind:i%2?'credits':'membership',provider:i%3?'wechat':'alipay',title:i===0?'<img src=x onerror=alert(1)>':i%2?'200 积分':'本科会员'});f.order({id:'bundle',kind:'bundle',productId:'bundle-bachelor',amount:23900,title:'本科写作套餐'});}
 const dom=new JSDOM(html,{url:'https://paperknow.test/admin.html'+hash,pretendToBeVisual:true}),win=dom.window,calls=[],downloads=[],blobs=[],navigations=[];
 win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};win.HTMLDialogElement.prototype.close=function(){this.open=false;};
 win.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:synthetic-revenue';};win.URL.revokeObjectURL=()=>{};
 const clickAnchor=win.HTMLAnchorElement.prototype.click;win.HTMLAnchorElement.prototype.click=function(){if(this.hasAttribute('download'))downloads.push({name:this.download,url:this.href});else clickAnchor.call(this);};
 const route=url=>{
  const parsed=new URL(url,'https://paperknow.test');
  if(parsed.pathname==='/api/auth/me')return {user:{id:'admin',role,name:'管理员测试'}};
  if(parsed.pathname==='/api/admin/revenue')return f.report.report(parsed.searchParams);
  if(parsed.pathname==='/api/admin/revenue/export')return f.report.exportCSV(parsed.searchParams);
  if(parsed.pathname==='/api/admin/overview')return {metrics:{},daily:[],recentJobs:[],services:{},revenue:f.report.overview()};
  return {items:[],total:0,page:1,pageSize:20};
 };
 win.fetch=async(url,options)=>{calls.push({url,options});const override=await handle?.(url,options);return override||{ok:true,status:200,json:async()=>route(url)};};
 const app=createAdminPage(win.document,{navigate:url=>navigations.push(url),pollIntervalMs:60000});t.after(()=>{app.destroy();win.close();});await app.ready;
 const q=selector=>win.document.querySelector(selector),select=(name,value)=>{const node=q('#revenue-filter [name='+name+']');node.value=value;node.dispatchEvent(new win.Event('change',{bubbles:true}));},submit=()=>q('#revenue-filter').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
 return {...f,win,app,q,select,submit,calls,downloads,blobs,navigations};
}

test('revenue is an authenticated admin page, presents real paid totals and links from the overview',async t=>{
 const f=await page(t,{hash:'#overview'});assert.ok(f.q('[data-revenue-overview]'));assert.match(f.q('[data-revenue-overview]').textContent,/收益概览/);
 f.q('[data-revenue-overview] [data-view=revenue]').click();await until(()=>f.q('[data-revenue-page]'));
 assert.equal(f.win.location.hash,'#revenue');assert.match(f.q('#breadcrumb').textContent,/收益统计/);assert.equal(f.win.document.querySelectorAll('.revenue-metric').length,4);
 assert.equal(f.q('.revenue-metric.primary strong').textContent,revenueMoney(f.report.report().summary.amountCents));assert.match(f.q('#admin-content').textContent,/北京时间|积分充值|微信支付|支付宝/);
 assert.equal(f.q('#admin-content img'),null);assert.equal(f.calls[0].url,'/api/auth/me');
});

test('ordinary accounts cannot request or display any revenue data',async t=>{
 const f=await page(t,{role:'user'});assert.equal(f.calls.length,1);assert.equal(f.q('#admin-content').textContent,'');assert.equal(f.q('#admin-app').hidden,true);assert.equal(f.downloads.length,0);
});

test('period, channel and product filters are applied consistently and retained across refresh',async t=>{
 const f=await page(t);f.select('range','7d');f.select('provider','alipay');f.select('kind','credits');f.submit();
 await until(()=>f.calls.some(row=>row.url.includes('range=7d')&&row.url.includes('kind=credits'))&&f.q('#revenue-filter'));
 assert.equal(f.q('[name=provider]').value,'alipay');assert.equal(f.q('[name=kind]').value,'credits');assert.equal(f.q('[name=range]').value,'7d');
 const expected=f.report.report(new URLSearchParams('range=7d&provider=alipay&kind=credits'));assert.equal(f.q('.revenue-metric.primary strong').textContent,revenueMoney(expected.summary.amountCents));
 const before=f.calls.length;f.q('#refresh-view').click();await until(()=>f.calls.length>before&&f.q('#revenue-filter'));assert.equal(f.q('[name=kind]').value,'credits');
 f.q('[data-revenue-reset]').click();await until(()=>f.q('[name=range]')?.value==='30d');assert.equal(f.q('[name=provider]').value,'');assert.equal(f.q('[name=kind]').value,'');assert.equal(f.q('[name=startDate]').disabled,true);
});

test('invalid custom dates remain editable without sending an erroneous report request',async t=>{
 const f=await page(t);f.select('range','custom');assert.equal(f.q('[data-revenue-custom]').hidden,false);assert.equal(f.q('[name=startDate]').disabled,false);
 f.q('[name=startDate]').value='2025-01-01';f.q('[name=endDate]').value='2026-10-25';const before=f.calls.length;f.submit();assert.equal(f.calls.length,before);assert.equal(f.q('[data-revenue-filter-error]').hidden,false);
 f.select('range','30d');assert.equal(f.q('[name=startDate]').disabled,true);assert.equal(f.q('#revenue-filter').checkValidity(),true);f.select('range','custom');f.q('[name=startDate]').value='2026-10-25';f.q('[name=endDate]').value='2026-10-25';f.submit();await until(()=>f.q('[name=range]')?.value==='custom'&&f.q('[data-revenue-filter-error]')?.hidden);
 assert.match(f.calls.at(-1).url,/startDate=2026-10-25&endDate=2026-10-25/);
});

test('trend bars support keyboard drilling into a single Beijing date',async t=>{
 const f=await page(t);const bar=f.q('[data-revenue-day="2026-10-25"]');assert.ok(bar);bar.dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await until(()=>f.q('[name=range]')?.value==='custom');assert.equal(f.q('[name=startDate]').value,'2026-10-25');assert.equal(f.q('[name=endDate]').value,'2026-10-25');
});

test('income detail pages preserve the full total, export all filtered rows and link to the actual order',async t=>{
 const f=await page(t);assert.equal(f.win.document.querySelectorAll('.revenue-orders tbody tr').length,20);f.q('button[data-revenue-page=next]').click();await until(()=>f.q('button[data-revenue-page=next]')?.disabled);assert.equal(f.win.document.querySelectorAll('.revenue-orders tbody tr').length,12);
 f.q('[data-revenue-export]').click();assert.equal(f.q('[data-revenue-export]').disabled,true);await until(()=>f.downloads.length===1);assert.match(f.downloads[0].name,/PaperKnow_收益明细_.*\.csv/);assert.ok(f.blobs[0].size>1000);assert.ok(f.calls.some(row=>row.url.startsWith('/api/admin/revenue/export?')&&!row.url.includes('page=')));
 const button=f.q('[data-revenue-order]'),id=button.dataset.revenueOrder;button.click();await until(()=>f.win.location.hash==='#orders'&&f.q('#admin-search'));assert.equal(f.q('#admin-search').value,id);
});

test('a revoked administrator loses all financial data and a delayed export cannot download it afterward',async t=>{
 let finishExport,revoked=false;const f=await page(t,{handle:url=>{
  if(url.startsWith('/api/admin/revenue/export'))return new Promise(resolve=>{finishExport=resolve;});
  if(url.startsWith('/api/admin/revenue')&&revoked)return {ok:false,status:403,json:async()=>({error:'权限已撤销'})};
 }});
 f.q('[data-revenue-export]').click();await until(()=>finishExport);revoked=true;f.q('#refresh-view').click();await until(()=>f.q('#admin-app').hidden);
 const data=f.report.exportCSV();finishExport({ok:true,status:200,json:async()=>data});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.downloads.length,0);assert.equal(f.q('#admin-content').textContent,'');assert.equal(f.blobs.length,0);
});

test('a stale revenue response cannot overwrite a later orders view or expose stale figures',async t=>{
 let finish,block=false;const f=await page(t,{handle:url=>url.startsWith('/api/admin/revenue')&&block?new Promise(resolve=>{finish=resolve;}):undefined});block=true;f.q('#refresh-view').click();await until(()=>finish);f.q('[data-view=orders]').click();await until(()=>f.q('#breadcrumb').textContent==='订单记录'&&f.q('#search-form'));finish({ok:true,status:200,json:async()=>f.report.report()});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.q('.revenue-metrics'),null);assert.equal(f.q('#breadcrumb').textContent,'订单记录');
});

test('server failures and malformed financial data do not turn into invented zero income',async t=>{
 let broken=true;const f=await page(t,{handle:url=>url.startsWith('/api/admin/revenue')&&broken?{ok:true,status:200,json:async()=>({items:[],summary:{amountCents:0}})}:undefined});assert.equal(f.q('.revenue-metric'),null);assert.match(f.q('#admin-content').textContent,/收益数据格式不完整/);broken=false;f.q('#retry-view').click();await until(()=>f.q('.revenue-metric'));assert.match(f.q('.revenue-metric.primary strong').textContent,/¥/);
});

test('an empty business has honest zero income and disables export without presenting mock sales',async t=>{
 const f=await page(t,{empty:true});assert.equal(f.q('.revenue-metric.primary strong').textContent,'¥0.00');assert.equal(f.q('[data-revenue-export]').disabled,true);assert.match(f.q('.revenue-orders').textContent,/没有支付成功/);assert.equal(f.q('.revenue-chart'),null);assert.match(f.q('.revenue-basis').textContent,/不是.*净利润/);
 assert.equal(revenueMoney(1),'¥0.01');assert.equal(revenueMoney(1234567),'¥12,345.67');assert.equal(revenueMoney(null),'—');assert.equal(revenueMoney(-1),'—');
});

test('the revenue design keeps its own scope and responsive chart, filters and tables',async()=>{
 const css=await readFile(new URL('../dist/admin-revenue.css',import.meta.url),'utf8');assert.match(html,/admin-revenue.css/);assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);assert.match(css,/\.revenue-custom\[hidden\]/);assert.doesNotMatch(css,/(?:^|\})\s*(?:body|input|button)\s*\{/);
});
