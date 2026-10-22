import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseDocument,analyzeDocument,sliceCp} from '../dist/precheck/engine.mjs';
import {compareRevisionDocument} from '../dist/workspace/revision-comparison-model.mjs';
import {createRevision} from '../dist/workspace/revision-model.mjs';
import {hasRevisionComparisonHandoff,loadRevisionComparisonHandoff,revisionComparisonInputFromReport} from '../dist/workspace/revision-comparison-handoff.mjs';

const hit='共享科研文字片段需要结合真实来源进行逐字核对并确认规范引用';
const original=['作者独立完成的前置说明，所有正文内容均应保留。','第一章 绪论','😀'+hit+'。','这段是作者自己补充的分析，其内容与对照材料没有文字相同。','参考文献','张某某，文献列表及附加说明必须完整保留。'].join('\n\n');
function fixture(){return analyzeDocument(parseDocument(original,'我的测试论文'),[{id:'actual-source',title:'另一篇文章',url:'https://example.org/article',text:'UNRELATED-SOURCE-HEADER'+ '前'.repeat(260)+'😀'+hit+'😀'+'后'.repeat(260)+'UNRELATED-SOURCE-FOOTER'}],{id:'report-1',mode:'local'});}
const win=hash=>({location:{hash}});
const cloudContext=(report,options={})=>{const calls=[];let auth=0;return{calls,api:async path=>{calls.push(path);if(path==='/auth/me')return{user:{id:options.owners?.[auth++]||'u1'}};if(path==='/web-similarity/job-1/report'){options.onReport?.();if(options.error)throw options.error;return{ownerId:options.responseOwner||'u1',report:{...report,mode:'web'}};}throw Error('Unexpected '+path);}};};

test('report handoff keeps all paper sections separate from bounded real source context and copies no reported score',()=>{
 const report=fixture(),before=structuredClone(report),input=revisionComparisonInputFromReport(report);
 assert.equal(input.title,'我的测试论文');assert.equal(input.text,original);assert.doesNotMatch(input.text,/正文概述|UNRELATED-SOURCE/);
 assert.equal(input.comparison.sources.length,1);const source=input.comparison.sources[0];
 assert.equal(source.name,'另一篇文章 · 来源摘录 1');assert.equal(source.url,'https://example.org/article');assert.match(source.text,new RegExp(hit));assert.match(source.text,/😀/);assert.doesNotMatch(source.text,/UNRELATED-SOURCE-HEADER|UNRELATED-SOURCE-FOOTER/);
 const actualMatch=report.sections.flatMap(section=>section.paragraphs).flatMap(paragraph=>paragraph.matches)[0];
 assert.ok(source.text.includes(sliceCp(report.sources[0].text,...actualMatch.sourceRange)));
 assert.equal(input.ratio,undefined);assert.equal(input.comparison.ratio,undefined);assert.deepEqual(report,before);
});

test('handoff validates codepoint ranges and rejects stale, incomplete, demonstration or score-only reports',()=>{
 const report=fixture();for(const input of [{...report,complete:false},{...report,mode:'demo'},{...report,sections:[]},{...report,sources:[]},{...report,sections:report.sections.map(section=>({...section,paragraphs:section.paragraphs.map(paragraph=>({...paragraph,matches:[]}))}))}])assert.throws(()=>revisionComparisonInputFromReport(input));
 const changed=structuredClone(report),row=changed.sections.flatMap(section=>section.paragraphs).find(paragraph=>paragraph.matches.length);row.matches[0].sourceRange[0]++;
 assert.throws(()=>revisionComparisonInputFromReport(changed),/不一致/);
 const bad=structuredClone(report);bad.sources[0].text='来源已经被完全替换，不能采用原报告的坐标或分数。';assert.throws(()=>revisionComparisonInputFromReport(bad),/不一致/);
});

test('all matched source ranges are carried and oversized context is rejected instead of silently dropping later matches',()=>{
 const report=fixture(),source=report.sources[0],row=report.sections.flatMap(section=>section.paragraphs).find(paragraph=>paragraph.matches.length),later='另一个实际命中片段同样需要完整进入来源依据并进行核对';
 source.text+='中'.repeat(600)+later;const start=Array.from(source.text).length-Array.from(later).length;row.text+='。'+later;const ownStart=Array.from(row.text).length-Array.from(later).length;
 row.matches.push({sourceId:source.id,range:[ownStart,Array.from(row.text).length],sourceRange:[start,Array.from(source.text).length]});
 const result=revisionComparisonInputFromReport(report);assert.equal(result.comparison.sources.length,2);assert.ok(result.comparison.sources[0].text.includes(hit));assert.ok(result.comparison.sources[1].text.includes(later));assert.match(result.comparison.sources[1].name,/来源摘录 2/);
 const long='长'.repeat(12100),oversize={id:'large',title:'大范围',mode:'local',complete:true,sources:[{id:'s',title:'完整长来源',text:long}],sections:[{id:'s1',title:'正文',included:true,paragraphs:[{id:'p1',text:long,matches:[{sourceId:'s',range:[0,long.length],sourceRange:[0,long.length]}]}]}]};
 assert.throws(()=>revisionComparisonInputFromReport(oversize),/12,000|不会自动截断/);
});

test('disconnected source excerpts stay separate so their boundaries cannot invent a new manuscript match',()=>{
 const a='FirstOriginMatchabcdefghijklmnop',b='SecondEvidenceqrstuvwxyzmnopqrst',boundary='A'.repeat(10)+'B'.repeat(10),text=[a,b,boundary].join('\n\n');
 const source={id:'gap-source',title:'来源有真实间隔',url:'https://example.org/gaps',text:a+'A'.repeat(250)+'C'.repeat(700)+'B'.repeat(250)+b};
 const report=analyzeDocument(parseDocument(text,'边界回归'),[source],{id:'gaps',mode:'local'});
 assert.equal(report.sections[0].paragraphs[2].matches.length,0,'完整原来源中没有 A10+B10 连续匹配');
 const input=revisionComparisonInputFromReport(report);assert.equal(input.comparison.sources.length,2);assert.ok(input.comparison.sources.every(row=>row.url===source.url));
 const document={...createRevision({title:input.title,text:input.text,mode:'rewrite'},'gap-doc','2026-10-22T00:00:00Z'),comparison:input.comparison,reductionPath:'sources'},comparison=compareRevisionDocument(document);
 assert.ok(comparison.paragraphs[0].matches.length);assert.ok(comparison.paragraphs[1].matches.length);assert.equal(comparison.paragraphs[2].matches.length,0,'不同摘录之间的空隙不能被白空格拼接成新的来源证据');
});

test('more than eight separated source windows fail explicitly instead of retaining only the first eight',()=>{
 let text='';const paragraphs=[];
 for(let index=0;index<9;index++){
  text+='Z'.repeat(700);const original='SourceWindow'+index+'RequiresItsExactMatchEvidence',start=Array.from(text).length;text+=original;
  paragraphs.push({id:'p'+index,text:original,matches:[{sourceId:'s',range:[0,original.length],sourceRange:[start,start+original.length]}]});
 }
 const report={id:'many-windows',title:'九个来源摘录',complete:true,mode:'local',sources:[{id:'s',title:'长文章',text}],sections:[{id:'s1',title:'正文',included:true,paragraphs}]};
 assert.throws(()=>revisionComparisonInputFromReport(report),/超过 8 处.*缩小.*不会丢弃/);
});

test('handoff routes carry one safe report ID only and do not encode paper text into navigation',()=>{
 assert.equal(hasRevisionComparisonHandoff('#category/reduce?comparisonReport=job-1'),true);assert.equal(hasRevisionComparisonHandoff('#category/reduce?localComparisonReport=report-1'),true);
 for(const hash of ['#category/reduce','#category/aigc?comparisonReport=job-1','#category/reduce?comparisonReport=job-1&localComparisonReport=report-1','#category/reduce?comparisonReport=job-1&comparisonReport=job-2','#category/reduce?comparisonReport=%3Cscript%3E','#category/reduce?comparisonReport=../other'])assert.equal(hasRevisionComparisonHandoff(hash),false,hash);
});

test('owned cloud handoff only reads the selected report, rechecks identity, and never starts an AI or writes a draft',async()=>{
 const ctx=cloudContext(fixture()),result=await loadRevisionComparisonHandoff(ctx,{windowObject:win('#category/reduce?comparisonReport=job-1')});
 assert.equal(result.reportId,'job-1');assert.equal(result.text,original);assert.match(result.originLabel,/公开来源报告.*摘录/);assert.deepEqual(ctx.calls,['/auth/me','/web-similarity/job-1/report','/auth/me']);
});

test('cross-account and stale late responses cannot return any paper or source data',async()=>{
 for(const options of [{owners:['u1','u2']},{responseOwner:'u2'}]){const ctx=cloudContext(fixture(),options);await assert.rejects(loadRevisionComparisonHandoff(ctx,{windowObject:win('#category/reduce?comparisonReport=job-1')}),/账户/);}
 let current=true;const ctx=cloudContext(fixture(),{onReport:()=>{current=false;}});await assert.rejects(loadRevisionComparisonHandoff(ctx,{windowObject:win('#category/reduce?comparisonReport=job-1'),isCurrent:()=>current}),/页面或文稿已变化/);
 const location=win('#category/reduce?comparisonReport=job-1'),changed=cloudContext(fixture(),{onReport:()=>{location.location.hash='#home';}});await assert.rejects(loadRevisionComparisonHandoff(changed,{windowObject:location}),/页面或文稿已变化/);
 const failure=cloudContext(fixture(),{error:Error('private provider qwen sk-secret')});await assert.rejects(loadRevisionComparisonHandoff(failure,{windowObject:win('#category/reduce?comparisonReport=job-1')}),error=>/暂时无法读取/.test(error.message)&&!/qwen|sk-secret/.test(error.message));
});

test('local handoff reads an existing saved report and never copies raw report data to another storage',async()=>{
 const calls=[],result=await loadRevisionComparisonHandoff({api:()=>{throw Error('unexpected remote request');}},{windowObject:win('#category/reduce?localComparisonReport=report-1'),readLocalReport:async id=>{calls.push(id);return fixture();}});
 assert.deepEqual(calls,['report-1']);assert.equal(result.text,original);assert.match(result.originLabel,/材料比对报告/);
 await assert.rejects(loadRevisionComparisonHandoff(null,{windowObject:win('#category/reduce?localComparisonReport=report-1'),readLocalReport:async()=>undefined}),/完整的真实来源报告/);
});

test('precheck handoff saves its session-only report before navigation and failed or stale saves stay on the report',async()=>{
 const app=await readFile(new URL('../dist/precheck/app.mjs',import.meta.url),'utf8'),source=app.slice(app.indexOf('async function openSourceReduction()'),app.indexOf('async function action('));
 const make=(save)=>{const messages=[],location={href:''},context=vm.createContext({location,repository:{save},messages,formatDate:value=>String(value)});vm.runInContext('let report,viewToken=0;const sessionReports=new Map();const toast=value=>messages.push(value);'+source+'\nglobalThis.qa={set:value=>{report=value;sessionReports.set(value.id,value);},open:openSourceReduction,advance:()=>viewToken++,has:id=>sessionReports.has(id)};',context);return{context,messages,location,qa:context.qa};};
 const calls=[],ok=make(async(store,value)=>calls.push({store,id:value.id}));ok.qa.set(fixture());await ok.qa.open();assert.deepEqual(calls,[{store:'reports',id:'report-1'}]);assert.equal(ok.location.href,'/workspace.html#category/reduce?localComparisonReport=report-1');assert.equal(ok.qa.has('report-1'),false);
 const failed=make(async()=>{throw Error('quota');});failed.qa.set(fixture());await failed.qa.open();assert.equal(failed.location.href,'');assert.equal(failed.qa.has('report-1'),true);assert.match(failed.messages.join(''),/报告未能保存/);
 let finish;const stale=make(()=>new Promise(resolve=>finish=resolve));stale.qa.set(fixture());const pending=stale.qa.open();stale.qa.advance();finish();await pending;assert.equal(stale.location.href,'');assert.equal(stale.qa.has('report-1'),true);
});
