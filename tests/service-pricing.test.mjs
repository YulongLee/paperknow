import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {buildServicePriceCatalogue,servicePriceCSV,mountServicePricing,disposeServicePricing} from '../dist/workspace/service-pricing.mjs';
import {toolBillingServiceTypes} from '../dist/workspace/tool-pricing-catalog.mjs';
import {v1PriceFor} from '../dist/workspace/v1-pricing.mjs';
const fixture=()=>({billing:{services:[{key:'polish',title:'学术润色',mode:'paid',creditCost:10,available:true},{key:'review',title:'导师意见修改',mode:'paid',creditCost:10,available:true},{key:'agent',mode:'paid',creditCost:10,available:true}]},toolBilling:{version:7,services:toolBillingServiceTypes.map(item=>({...item,effectiveMode:v1PriceFor(item.key)===0?'free':'paid',effectiveCreditCost:v1PriceFor(item.key)===0?null:v1PriceFor(item.key),available:true}))}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function view(t,fetchImpl,other={}){const dom=new JSDOM('<main id="app"><div class="dashboard"></div></main>',{url:'https://paperknow.cn/workspace.html#membership/pricing'}),calls=[],downloads=[];
 const page=mountServicePricing({container:dom.window.document.querySelector('.dashboard'),fetchImpl:async(...args)=>{calls.push(args);return fetchImpl(...args);},downloadFile:(name,body)=>downloads.push({name,body}),...other});
 t.after(()=>{page.dispose();disposeServicePricing();dom.window.close();});return {dom,page,calls,downloads,doc:dom.window.document};}
const ok=data=>({ok:true,json:async()=>data});
test('the customer catalogue uses exact published tariffs, groups equal degree prices and covers executable services',()=>{
 const data=fixture(),before=JSON.stringify(data),c=buildServicePriceCatalogue(data);
 assert.equal(c.rows.find(row=>row.title==='毕业论文').cost,1000);assert.equal(c.rows.find(row=>row.title==='PPT 创作').cost,199);
 assert.equal(c.rows.find(row=>row.keys.includes('detection-combined')).cost,149);assert.equal(c.rows.find(row=>row.keys.includes('writing-planning')).mode,'free');
 const keys=new Set(c.rows.flatMap(row=>row.keys));for(const {key}of toolBillingServiceTypes.filter(row=>row.key!=='writing-analysis'))assert.ok(keys.has(key),key);
 assert.ok(!keys.has('agent'));assert.ok(!keys.has('writing-analysis'));assert.equal(JSON.stringify(data),before);
});
test('custom degree prices stay distinct and malformed or paused prices never become a free paid service',()=>{
 const data=fixture(),master=data.toolBilling.services.find(s=>s.key==='thesis-master');master.effectiveCreditCost=1577;
 const ppt=data.toolBilling.services.find(s=>s.key==='presentation-ai');ppt.effectiveCreditCost=NaN;
 data.toolBilling.services.find(s=>s.key==='detection-aigc').available=false;
 const rows=buildServicePriceCatalogue(data).rows;
 assert.equal(rows.find(r=>r.keys.includes('thesis-master')).cost,1577);assert.equal(rows.find(r=>r.keys.includes('thesis-bachelor')).cost,1000);
 const malformed=rows.find(r=>r.keys.includes('presentation-ai'));assert.equal(malformed.mode,'unknown');assert.equal(malformed.available,false);assert.equal(malformed.cost,null);
 const paused=rows.find(r=>r.keys.includes('detection-aigc'));assert.equal(paused.cost,99);assert.equal(paused.available,false);
 assert.throws(()=>buildServicePriceCatalogue({billing:{services:[]}}));
});
test('CSV contains exact published amounts and escapes commas, line breaks, quotes and spreadsheet formulas',()=>{
 const catalogue=buildServicePriceCatalogue(fixture());catalogue.rows[0].title=' =HYPERLINK("bad", "x")';catalogue.rows[0].range='a,b\n"c"';
 const csv=servicePriceCSV(catalogue);assert.match(csv,/"分类","功能","积分费用"/);assert.match(csv,/"' =HYPERLINK/);assert.match(csv,/"a,b\n""c"""/);assert.match(csv,/149 积分 \/ 次/);assert.match(csv,/¥14\.90/);
});
test('filtering, search, navigation and download stay read-only and download the complete current catalogue',async t=>{
 const f=view(t,async()=>ok(fixture()));await f.page.ready;
 assert.match(f.doc.querySelector('[data-price-rows]').textContent,/1,000 积分 \/ 次/);assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].body,undefined);
 f.doc.querySelector('[data-price-group="detection"]').click();assert.equal(f.doc.querySelectorAll('[data-price-rows] tr').length,3);
 const input=f.doc.querySelector('[data-price-search]');input.value='联合';input.dispatchEvent(new f.dom.window.Event('input'));assert.equal(f.doc.querySelectorAll('[data-price-rows] tr').length,1);assert.equal(f.doc.querySelector('.service-price-open').getAttribute('href'),'#category/detection?view=combined');
 f.doc.querySelector('[data-price-download]').click();assert.equal(f.downloads.length,1);assert.match(f.downloads[0].name,/PaperKnow_服务价目表_/);assert.match(f.downloads[0].body,/PPT 创作/);assert.match(f.downloads[0].body,/149 积分/);assert.equal(f.calls.length,1);assert.equal(f.dom.window.localStorage.length,0);assert.equal(f.doc.querySelector('[data-price-admin]').hidden,true);
});
test('refresh applies changed prices while preserving search focus and a failed refresh cannot export stale prices',async t=>{
 let n=0;const data=fixture();const f=view(t,async()=>{if(++n===3)throw Error('network');return ok(data);});await f.page.ready;
 const input=f.doc.querySelector('[data-price-search]');input.value='论文重复率';input.dispatchEvent(new f.dom.window.Event('input'));input.focus();
 data.toolBilling.services.find(s=>s.key==='detection-similarity').effectiveCreditCost=123;f.doc.querySelector('[data-price-refresh]').click();for(let i=0;i<5;i++)await tick();
 assert.match(f.doc.querySelector('[data-price-rows]').textContent,/123 积分/);assert.equal(f.doc.activeElement,input);assert.equal(input.value,'论文重复率');
 f.doc.querySelector('[data-price-refresh]').click();for(let i=0;i<5;i++)await tick();assert.equal(f.doc.querySelector('[data-price-download]').disabled,true);assert.match(f.doc.querySelector('[data-price-status]').textContent,/上次读取/);assert.match(f.doc.querySelector('[data-price-rows]').textContent,/123 积分/);assert.equal(f.calls.every(([,options])=>!options.body),true);
});
test('unavailable services have no usage link, untrusted titles render as text, and administrators alone see the managed pricing entry',async t=>{
 const data=fixture();data.toolBilling.services.find(s=>s.key==='thesis-master').effectiveCreditCost=1510;data.toolBilling.services.find(s=>s.key==='thesis-master').title='<img src=x onerror=bad()>';
 data.toolBilling.services.find(s=>s.key==='detection-combined').available=false;
 const f=view(t,async()=>ok(data),{session:async()=>({user:{role:'admin'}})});await f.page.ready;await tick();
 assert.equal(f.doc.querySelector('img[src="x"]'),null);assert.match(f.doc.querySelector('[data-price-rows]').textContent,/<img src=x/);
 const blocked=[...f.doc.querySelectorAll('[data-price-rows] tr')].find(r=>r.textContent.includes('联合检测'));assert.equal(blocked.querySelector('a'),null);assert.match(blocked.textContent,/暂未开放/);assert.equal(f.doc.querySelector('[data-price-admin]').hidden,false);assert.equal(f.doc.querySelector('[data-price-admin]').getAttribute('href'),'/admin.html#payments');
});
test('an unverified or failed catalogue never fabricates prices and a late response cannot replace another page',async t=>{
 const failed=view(t,async()=>({ok:false}));await failed.page.ready;assert.equal(failed.doc.querySelector('[data-price-download]').disabled,true);assert.equal(failed.doc.querySelector('[data-price-layout]').hidden,true);
 let done;const pending=view(t,async()=>new Promise(resolve=>{done=resolve;}));pending.page.dispose();pending.doc.querySelector('.dashboard').innerHTML='<input value="正在编辑的新页面">';done(ok(fixture()));await pending.page.ready;
 assert.equal(pending.doc.querySelector('[data-service-pricing-page]'),null);assert.equal(pending.doc.querySelector('input').value,'正在编辑的新页面');
});
