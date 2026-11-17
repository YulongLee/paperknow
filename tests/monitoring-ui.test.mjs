import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {monitoringDefaults} from '../backend/monitoring.mjs';
import {monitoringPage} from '../dist/admin-monitoring.mjs';
import {createAdminPage} from '../dist/admin.mjs';
const html=await readFile(new URL('../dist/admin.html',import.meta.url),'utf8');
const data={settings:{...monitoringDefaults,version:1},sampler:{enabled:true,running:true,stale:false,lastErrorAt:null},latest:{sampledAt:'2026-10-18T10:00:00Z',alerts:[{key:'disk',severity:'critical',title:'磁盘空间不足',value:98,threshold:90,unit:'%'}],metrics:{disk:{usedPercent:98,availableBytes:1024**3,totalBytes:60*1024**3},database:{bytes:1024,walBytes:0},process:{rssBytes:100*1024**2},host:{memoryUsedPercent:30,loadPerCore:.2},jobs:{queued:2,running:1,stale:0,failurePercent:null},http:{count:0,errorPercent:null,p95Ms:null},payments:{pending:2,expiredPending:0},reservations:{held:1,stale:0,credits:10},storage:{ok:true,checkedAt:'2026-10-18T10:00:00Z',lastSuccessAt:'2026-10-18T10:00:00Z'},directories:{releases:{bytes:1024,partial:true}},artifacts:[]}},history:[{at:'2026-10-18T10:00:00Z',diskPercent:98}],events:[{at:'2026-10-18T10:00:00Z',metric:'disk',severity:'critical',status:'active'}],retention:{maximumSamples:1440}};
async function fixture(t,{role='admin',handle}={}){
 const dom=new JSDOM(html,{url:'https://paperknow.cn/admin.html#monitoring',pretendToBeVisual:true}),win=dom.window,calls=[];
 win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};win.HTMLDialogElement.prototype.close=function(){this.open=false;};
 win.fetch=async(url,init={})=>{const body=init.body?JSON.parse(init.body):undefined;calls.push({url,body});const response=await handle?.(url,body)||{body:url==='/api/auth/me'?{user:{id:'admin',name:'管理员',role}}:structuredClone(data)};return {status:response.status||200,ok:!response.status||response.status===200,json:async()=>response.body};};
 const app=createAdminPage(win.document,{navigate(){},pollIntervalMs:60000});t.after(()=>{app.destroy();win.close();});await app.ready;
 return {win,doc:win.document,calls,app};
}
async function settle(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('UI not settled');}
test('monitor UI distinguishes shared host scope, live storage checks and missing samples',()=>{
 const rendered=monitoringPage(data);assert.match(rendered,/整台共享服务器/);assert.match(rendered,/仅属于 PaperKnow/);assert.match(rendered,/磁盘空间不足/);assert.match(rendered,/至少/);assert.match(rendered,/读写探测通过/);assert.doesNotMatch(rendered,/NaN|undefined|Infinity/);
 const pending=monitoringPage({...data,latest:null,history:[],events:[],sampler:{...data.sampler,stale:true}});assert.match(pending,/等待首轮采样/);assert.match(pending,/采样记录待更新/);
 const unsafe=monitoringPage({...data,latest:{...data.latest,alerts:[{title:'<img src=x onerror=alert(1)>',severity:'critical'}]}});assert.doesNotMatch(unsafe,/<img src=x/);assert.match(unsafe,/&lt;img/);
});
test('ordinary accounts cannot load or view operational metrics',async t=>{
 const f=await fixture(t,{role:'user'});assert.equal(f.calls.length,1);assert.equal(f.doc.querySelector('#admin-content').textContent,'');
});
test('admin can save only defined numeric thresholds and immediately request a bounded sample',async t=>{
 let saved;
 const f=await fixture(t,{handle(url,body){if(url==='/api/admin/monitoring/settings'){saved=body;return {body:{settings:{...data.settings,version:2}}};}}});
 assert.match(f.doc.querySelector('#admin-content h1').textContent,/运行监控/);assert.equal(f.doc.querySelectorAll('.monitor-card').length,12);
 const input=f.doc.querySelector('[name="sampleIntervalSeconds"]');input.value='120';input.dispatchEvent(new f.win.Event('input',{bubbles:true}));assert.equal(f.doc.querySelector('[data-monitor-dirty]').hidden,false);
 f.doc.querySelector('#monitoring-form').dispatchEvent(new f.win.Event('submit',{cancelable:true,bubbles:true}));await settle(()=>saved&&f.doc.querySelector('#monitoring-form')?.dataset.saving!=='true');
 assert.equal(saved.version,1);assert.equal(saved.sampleIntervalSeconds,120);assert.equal(saved.enabled,true);assert.equal('path'in saved,false);assert.equal('url'in saved,false);
 f.doc.querySelector('#monitor-sample').click();await settle(()=>f.calls.some(row=>row.url==='/api/admin/monitoring/sample'));assert.deepEqual(f.calls.find(row=>row.url==='/api/admin/monitoring/sample').body,{});
});
test('failed threshold save preserves input and explains failure without reporting success',async t=>{
 const f=await fixture(t,{handle(url){if(url==='/api/admin/monitoring/settings')return {status:409,body:{error:'监控设置已更新，请刷新后重试'}};}});
 const form=f.doc.querySelector('#monitoring-form');form.elements.sampleIntervalSeconds.value='180';form.dispatchEvent(new f.win.Event('submit',{cancelable:true,bubbles:true}));await settle(()=>!form.querySelector('.form-error').hidden);
 assert.equal(form.elements.sampleIntervalSeconds.value,'180');assert.match(form.querySelector('.form-error').textContent,/已更新/);assert.equal(form.querySelector('[type="submit"]').disabled,false);
});

test('history ranges reload bounded history and preserve the selected range across refresh',async t=>{
 const f=await fixture(t);f.doc.querySelector('[data-monitor-range="6h"]').click();
 await settle(()=>f.doc.querySelector('[data-monitor-range="6h"]')?.getAttribute('aria-pressed')==='true');
 assert.ok(f.calls.some(x=>x.url==='/api/admin/monitoring?range=6h'));
 f.doc.querySelector('#refresh-view').click();await settle(()=>f.calls.filter(x=>x.url==='/api/admin/monitoring?range=6h').length===2&&f.doc.querySelector('[data-monitor-range="6h"]')?.getAttribute('aria-pressed')==='true');
 assert.equal(f.doc.querySelector('[data-monitor-range="6h"]').getAttribute('aria-pressed'),'true');assert.equal(f.doc.querySelectorAll('[data-monitor-chart]').length,8);
});
test('unsaved monitoring thresholds survive range changes, sampling, navigation and browser unload until explicitly discarded',async t=>{
 const f=await fixture(t);const input=f.doc.querySelector('[name="sampleIntervalSeconds"]');input.value='180';input.dispatchEvent(new f.win.Event('input',{bubbles:true}));
 f.doc.querySelector('[data-monitor-range="24h"]').click();assert.match(f.doc.querySelector('#admin-dialog').textContent,/监控配置尚未保存/);assert.ok(!f.calls.some(x=>x.url.includes('range=24h')));
 f.doc.querySelector('[data-dialog-close]').click();assert.equal(input.value,'180');
 f.doc.querySelector('#monitor-sample').click();assert.ok(!f.calls.some(x=>x.url==='/api/admin/monitoring/sample'));f.doc.querySelector('[data-dialog-close]').click();
 const unload=new f.win.Event('beforeunload',{cancelable:true});f.win.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);
 f.doc.querySelector('[data-view="users"]').click();assert.equal(f.win.location.hash,'#monitoring');assert.match(f.doc.querySelector('#admin-dialog').textContent,/监控配置尚未保存/);f.doc.querySelector('[data-dialog-close]').click();
 f.doc.querySelector('[data-monitor-range="24h"]').click();f.doc.querySelector('#discard-monitor-changes').click();await settle(()=>f.doc.querySelector('[data-monitor-range="24h"]')?.getAttribute('aria-pressed')==='true');assert.equal(f.doc.querySelector('[name="sampleIntervalSeconds"]').value,'60');
});
test('range reads keep existing curves visible, reject late responses and preserve the last successful chart after an error',async t=>{
 let finishSix;
 const f=await fixture(t,{handle(url){if(url==='/api/admin/monitoring?range=6h')return new Promise(resolve=>{finishSix=resolve;});if(url==='/api/admin/monitoring?range=24h')return {status:503,body:{error:'历史暂不可用'}};}});
 const old=f.doc.querySelector('[data-monitor-chart="diskPercent"]');f.doc.querySelector('[data-monitor-range="6h"]').click();await settle(()=>Boolean(finishSix));assert.equal(f.doc.querySelector('[data-monitor-chart="diskPercent"]'),old);assert.equal(f.doc.querySelector('#monitor-history-loading').hidden,false);
 f.doc.querySelector('[data-monitor-range="24h"]').click();await settle(()=>f.doc.querySelector('#admin-toast')?.textContent.includes('历史暂不可用'));assert.equal(f.doc.querySelector('[data-monitor-range="1h"]').getAttribute('aria-pressed'),'true');
 finishSix({body:structuredClone(data)});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.doc.querySelector('[data-monitor-range="1h"]').getAttribute('aria-pressed'),'true');assert.equal(f.doc.querySelector('[data-monitor-chart="diskPercent"]'),old);assert.equal(f.doc.querySelector('#monitor-history-loading').hidden,true);
});
