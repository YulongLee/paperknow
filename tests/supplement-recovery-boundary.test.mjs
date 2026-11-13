import test from 'node:test';
import assert from 'node:assert/strict';
import {runSupplementCheck} from '../backend/supplement-check.mjs';
const snapshot={title:'隔离合成研究',profile:{},requirements:{},materials:[],references:[]};
const runtime={maxOutputTokens:4096,maxTurns:6,timeoutMs:30000};
const answer=task=>({text:JSON.stringify({items:task.context.chapters.map(c=>({id:c.id,status:'not_required',requirement:'核对',reason:'没有外部事实',manuscriptQuote:c.text.slice(0,Math.min(80,c.text.length)),evidence:[],missing:[],checkedFigureIds:(c.figures||[]).map(f=>f.id)}))})});
test('independent batch failures recover within a bounded budget and retain checked chapters',async()=>{
 const chapters=Array.from({length:6},(_,i)=>({id:'c'+i,title:'章节'+i,text:'本节为理论介绍。'.repeat(500)})),seen=[],failed=new Set();
 const report=await runSupplementCheck({snapshot,chapters,kind:'thesis',recover:true,runtime,dispatch:async({task,unitId})=>{seen.push(unitId);if((unitId.endsWith('::1')||unitId.endsWith('::3'))&&!failed.has(unitId)){failed.add(unitId);throw Object.assign(Error('test timeout'),{status:504,code:'timeout'});}return answer(task);}});
 assert.equal(report.status,'final_ready');assert.equal(report.coverage.checked,report.coverage.total);assert.equal(report.recovery.automaticRetries,2);assert.equal(failed.size,2);assert.equal(new Set(report.items.map(row=>row.id)).size,report.items.length);assert.ok(seen.length<=chapters.length+3);
});
test('a truncated long section is split safely without skipping citation or text',async()=>{
 const content='首段说明。'.repeat(600)+'关键发现。[source:record]'+'另一段说明。'.repeat(600),source={id:'record',name:'记录',text:'关键发现来自记录。',confirmed:true},parts=[];
 const report=await runSupplementCheck({snapshot:{...snapshot,materials:[source]},chapters:[{id:'c',title:'长节',text:content}],kind:'thesis',recover:true,runtime,dispatch:async({task,unitId})=>{if(!unitId.includes('.part'))throw Object.assign(Error('synthetic truncation'),{status:502,code:'truncated'});parts.push(task.context.chapters[0].text);return answer(task);}});
 assert.equal(report.status,'final_ready');assert.ok(parts.length>=2);assert.equal(parts.join(''),content);assert.ok(parts.some(part=>part.includes('关键发现。[source:record]')));assert.equal(report.coverage.checked,report.coverage.total);assert.equal(report.recovery.automaticRetries,1);
});
test('an indivisible cited sentence cannot be counted as checked after repeated failure',async()=>{
 const content='甲'.repeat(3500)+'[source:record]',source={id:'record',name:'记录',text:'相关授权记录。',confirmed:true};let calls=0;
 const report=await runSupplementCheck({snapshot:{...snapshot,materials:[source]},chapters:[{id:'c',title:'长句',text:content}],kind:'thesis',recover:true,runtime,dispatch:async()=>{calls++;throw Object.assign(Error('synthetic truncation'),{status:502,code:'truncated'});}});
 assert.equal(report.status,'unavailable');assert.equal(report.coverage.complete,false);assert.equal(report.coverage.checked,0);assert.equal(calls,3);
});

test('one persistently failing section cannot consume the recovery allowance for the entire document',async()=>{
 const chapters=Array.from({length:8},(_,i)=>({id:'c'+i,title:'章节'+i,text:'需要审查。'.repeat(800)}));let calls=0;
 const report=await runSupplementCheck({snapshot,chapters,kind:'thesis',recover:true,runtime,dispatch:async()=>{calls++;throw Object.assign(Error('persistent'),{status:504,code:'timeout'});}});
 assert.equal(calls,4);assert.equal(report.status,'unavailable');assert.equal(report.coverage.complete,false);assert.equal(report.coverage.checked,0);
});

test('recovery splitting retains each figure with its marker and requires an explicit figure check',async()=>{
 const figure={id:'flow',title:'识别系统结构',kind:'flowchart',nodes:[{id:'a',label:'图像输入'},{id:'b',label:'识别输出'}],edges:[{from:'a',to:'b'}],caption:'展示输入与输出关系。'};const content='解释过程。'.repeat(600)+'\n[figure:flow]\n'+'补充说明。'.repeat(600);let calls=0,seen=[];
 const report=await runSupplementCheck({snapshot,chapters:[{id:'c',title:'图文',text:content,figures:[figure]}],kind:'thesis',recover:true,runtime,dispatch:async({task,unitId})=>{calls++;if(!unitId.includes('.part'))throw Object.assign(Error('truncated'),{status:502,code:'truncated'});const chapter=task.context.chapters[0];seen.push(chapter);return answer(task);}});
 assert.equal(report.status,'final_ready');assert.equal(seen.map(c=>c.text).join(''),content);assert.equal(seen.filter(c=>c.figures?.length).length,1);assert.ok(seen.find(c=>c.figures?.length).text.includes('[figure:flow]'));assert.equal(report.items.flatMap(row=>row.checkedFigureIds||[]).filter(id=>id==='flow').length,1);assert.equal(calls,1+seen.length);
});
