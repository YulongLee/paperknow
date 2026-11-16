import test from 'node:test';
import assert from 'node:assert/strict';
import {supplementCrossTableContext} from '../backend/supplement-cross-context.mjs';
import {runSupplementCheck,parseSupplementCheck} from '../backend/supplement-check.mjs';
import {createWritingQualityRunner} from '../backend/writing-quality-runner.mjs';

const table='表 1 两组算例权重\n| 查询 | 权重一 | 权重二 |\n| --- | --- | --- |\n| q1 | 0.669762 | 0.330238 |\n| q2 | 0.330238 | 0.669762 |';
const method={id:'chapter-2',title:'第二章 方法',text:'基于所列算例进行演示。\n复算值分别为 0.669761549327 与 0.330238450673。\n\n'+table+'\n\n只用于二维算例，不能证明模型性能。'};
const result={id:'chapter-3',title:'第三章 结果',text:'从数值精度看，表 1 展示六位小数，第二章列出十二位小数的复算值。'};
test('referenced unique table comes from the actual saved chapter with exact offsets and nearby calculation',()=>{
 const context=supplementCrossTableContext([result],[method,result]);assert.equal(context.tables.length,1);const entry=context.tables[0];
 assert.equal(entry.chapterId,'chapter-2');assert.equal(entry.number,'1');assert.equal(entry.entireTable,true);assert.equal(entry.text,method.text.slice(entry.offset,entry.end));assert.match(entry.text,/0\.669761549327/);assert.match(entry.text,/0\.669762/);assert.match(context.scope,/非外部证据/);
});
test('duplicate, absent and clipped tables are not presented as complete',()=>{
 const duplicate=supplementCrossTableContext([result],[method,{...method,id:'other'}]);assert.deepEqual(duplicate.tables,[]);assert.equal(duplicate.unavailable[0].reason,'ambiguous');
 const missing=supplementCrossTableContext([result],[result]);assert.equal(missing.unavailable[0].reason,'not_located');
 const clipped=supplementCrossTableContext([result],[method,result],{maxCharacters:90});assert.equal(clipped.tables[0].entireTable,false);assert.ok(clipped.tables[0].text.length<=90);
 const long={...method,text:method.text+'额外上下文'.repeat(1000)+'表后远端数据'};const limited=supplementCrossTableContext([result],[long,result]);assert.equal(limited.tables[0].followingTextTruncated,true);assert.doesNotMatch(limited.tables[0].text,/表后远端数据/);
});
test('bounded cross-table context cannot be passed off as the current chapter or as a research source',async()=>{
 const actual={id:'record',name:'作者资料',confirmed:true,text:'本次公开合成资料只用于核对演示目的，不含未提供的实验数据。'},calls=[],snapshot={materials:[actual],references:[]};
 const report=await runSupplementCheck({snapshot,chapters:[method,result],kind:'thesis',runtime:{maxTurns:3,maxOutputTokens:600,timeoutMs:30000},dispatch:async({task})=>{
  const section=task.context.chapters[0];if(section.title===result.title){calls.push(task);const cross=task.context.crossChapterTables.tables[0];assert.match(cross.text,/0\.669761549327/);assert.equal(task.materials.some(x=>x.id===cross.chapterId),false);
   const fake={items:[{id:section.id,status:'sufficient',requirement:'结果依据',reason:'有表格。',manuscriptQuote:cross.text.slice(0,30),evidence:[{sourceId:cross.chapterId,quote:cross.text.slice(0,30)}],missing:[]}]};assert.throws(()=>parseSupplementCheck({text:JSON.stringify(fake)},task));
  }
  const payload={items:task.context.chapters.map(row=>({id:row.id,status:'missing',requirement:'实际记录',reason:'未取得来源。',manuscriptQuote:row.text.slice(0,30),evidence:[],missing:['缺少实验记录']}))};return{text:JSON.stringify(payload),usage:{input:10,output:10},costUsd:.001,trace:[]};
 }});
 assert.equal(calls.length,1);assert.equal(report.status,'needs_materials');assert.equal(report.coverage.complete,true);
});
test('independent manuscript review sees actual cross-chapter tables without silencing precision warnings',async()=>{
 const run=createWritingQualityRunner({citationVerifier:{verify:async()=>({items:[],summary:{},limitations:[]})}});let checked=false;const chapters=[method,result];
 const quality=await run({snapshot:{materials:[],references:[]},chapters,kind:'thesis',checkSupplements:false,runtime:{maxTurns:3,maxOutputTokens:4096,timeoutMs:30000},dispatch:async({task})=>{const excerpt=task.context.manuscriptExcerpts.find(row=>row.title===result.title);if(excerpt){checked=true;const table=task.context.crossChapterTables.tables.find(row=>row.number==='1');assert.equal(table.text,method.text.slice(table.offset,table.end));assert.match(table.text,/0\.669761549327/);assert.match(task.instructions,/全篇或正文统一某一精度/);assert.match(task.instructions,/不是外部研究资料/);return{text:JSON.stringify({complete:true,findings:[{sectionId:excerpt.id,quote:excerpt.text,category:'terminology',severity:'warning',explanation:'精度范围仍有歧义。',suggestion:'明确各章节适用的精度口径。'}],limitations:[]})};}return{text:JSON.stringify({complete:true,findings:[],limitations:[]})};}});
 assert.equal(checked,true);assert.ok(quality.reviews.flatMap(row=>row.findings).some(finding=>finding.severity==='warning'&&finding.category==='terminology'));
});

test('an abstract receives its single saved table without inventing a table reference or guessing between tables',()=>{
 const abstract={id:'front-abstract_zh',title:'摘要',text:'两组案例的权重互补，仅讨论当前算例。'};
 const context=supplementCrossTableContext([abstract],[abstract,method]);assert.equal(context.selection,'single_table_abstract_context');assert.equal(context.tables.length,1);assert.equal(context.tables[0].entireTable,true);assert.match(context.tables[0].text,/0\.669762/);
 assert.equal(supplementCrossTableContext([abstract],[abstract,method,{...method,id:'duplicate'}]),null);
 assert.equal(supplementCrossTableContext([{id:'ordinary',title:'其他正文',text:abstract.text}],[method]),null);
 const clipped=supplementCrossTableContext([abstract],[method],{maxCharacters:90});assert.equal(clipped.tables[0].entireTable,false);
});
