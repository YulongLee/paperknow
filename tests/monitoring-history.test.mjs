import test from 'node:test';import assert from 'node:assert/strict';
import {monitoringHistory,monitoringRange} from '../backend/monitoring-history.mjs';
import {monitoringCharts} from '../dist/admin-monitoring-charts.mjs';
const now=Date.parse('2026-11-17T04:00:00Z');
const row=(time,overrides={})=>({created_at:new Date(time).toISOString(),payload:JSON.stringify({metrics:{disk:{usedPercent:70},host:{memoryUsedPercent:35,loadPerCore:.4},process:{rssBytes:100*1024**2},jobs:{queued:0,running:1},http:{errorPercent:null,p95Ms:null},...overrides},alerts:[],private:'never-expose-this'})});
test('time ranges use timestamps rather than an arbitrary count and reject unsupported input',()=>{
 const rows=[row(now),row(now-2*3600000),row(now-8*3600000),row(now-2*86400000),row(now+1000)];
 for(const [range,count]of [['1h',1],['6h',2],['24h',3]]){const result=monitoringHistory(rows,{range,now});assert.equal(result.history.length,count);assert.equal(result.historyMeta.sampleCount,count);assert.equal(result.historyMeta.range,range);assert.ok(result.history.every(p=>Date.parse(p.at)<=now));}
 for(const range of ['7d','',null,'../../etc/passwd',{},'__proto__'])assert.throws(()=>monitoringRange(range),e=>e.status===400);
 assert.doesNotMatch(JSON.stringify(monitoringHistory(rows,{now})),/never-expose|private/);
});
test('missing, negative, string and invalid percentages stay unknown instead of becoming a healthy zero',()=>{
 const result=monitoringHistory([row(now,{host:{memoryUsedPercent:null,loadPerCore:-1},disk:{usedPercent:101},jobs:{queued:'5'},process:{rssBytes:null},http:{p95Ms:null,errorPercent:0}})],{now});
 const point=result.history[0];for(const key of ['hostMemoryPercent','loadPerCore','diskPercent','queue','running','processMemoryMiB','p95Ms'])assert.equal(point[key],null,key);assert.equal(point.errorPercent,0);
 const corrupt=monitoringHistory([{created_at:new Date(now).toISOString(),payload:'bad json'},row(now)],{now});assert.equal(corrupt.historyMeta.invalidSamples,1);assert.equal(corrupt.history.length,1);
});
test('bounded time aggregation preserves each metric peak instead of losing short spikes',()=>{
 const rows=Array.from({length:1000},(_,i)=>row(now-999000+i*1000));
 const spike=JSON.parse(rows[501].payload);spike.metrics.disk.usedPercent=99;spike.metrics.jobs.queued=99;rows[501].payload=JSON.stringify(spike);
 const result=monitoringHistory(rows,{now,maximumPoints:20});assert.ok(result.history.length<=20);assert.equal(result.historyMeta.aggregation,'max');assert.equal(result.historyMeta.sampleCount,1000);assert.equal(Math.max(...result.history.map(p=>p.diskPercent)),99);assert.equal(Math.max(...result.history.map(p=>p.queue)),99);
});
test('charts show eight real series, a visible single sample and no fabricated request curve',()=>{
 const history=monitoringHistory([row(now)],{now}),html=monitoringCharts({...history,settings:{sampleIntervalSeconds:60}});
 assert.equal((html.match(/data-monitor-chart=/g)||[]).length,8);assert.match(html,/is-single/);assert.match(html,/暂无有效请求采样/);assert.doesNotMatch(html,/NaN|Infinity|never-expose/);
 assert.match(html,/北京时间/);assert.match(html,/查看图表采样值/);
});
test('chart paths break over missing values or long interruptions, while stable zero values remain visible',()=>{
 const meta={range:'1h',from:new Date(now-3600000).toISOString(),to:new Date(now).toISOString(),intervalSeconds:60,sampleCount:3};
 const history=[{at:new Date(now-600000).toISOString(),queue:0,diskPercent:70},{at:new Date(now-300000).toISOString(),queue:null,diskPercent:null},{at:new Date(now).toISOString(),queue:0,diskPercent:70}];
 const html=monitoringCharts({history,historyMeta:meta});const section=html.split('data-monitor-chart="queue"')[1].split('</article>')[0];
 const path=section.match(/class="monitor-series-line" d="([^"]+)"/)[1];assert.equal((path.match(/M/g)||[]).length,2);assert.equal((path.match(/L/g)||[]).length,0);assert.match(section,/>0<\/strong>/);
 const flat=monitoringCharts({history:[0,1,2].map(i=>({at:new Date(now-120000+i*60000).toISOString(),diskPercent:70})),historyMeta:meta});const disk=flat.split('data-monitor-chart="diskPercent"')[1].split('</article>')[0];assert.equal((disk.match(/class="monitor-series-line" d="([^"]+)"/)[1].match(/L/g)||[]).length,2);
});
test('recent raw values remain distinct from an aggregated interval peak',()=>{
 const rows=Array.from({length:500},(_,i)=>row(now-499000+i*1000));const spike=JSON.parse(rows[498].payload);spike.metrics.disk.usedPercent=99;rows[498].payload=JSON.stringify(spike);
 const result=monitoringHistory(rows,{now,maximumPoints:2});assert.equal(result.historyMeta.latestMetrics.diskPercent.value,70);assert.equal(Math.max(...result.history.map(p=>p.diskPercent)),99);
 const html=monitoringCharts(result).split('data-monitor-chart="diskPercent"')[1].split('</article>')[0];assert.match(html,/>70<\/strong>/);assert.match(html,/时段峰值 99/);
});
