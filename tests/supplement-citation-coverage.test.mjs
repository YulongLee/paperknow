import test from 'node:test';
import assert from 'node:assert/strict';
import {markSupplementCitationCoverage} from '../backend/supplement-citation-coverage.mjs';
import {runSupplementCheck,parseSupplementCheck,supplementCheckTask} from '../backend/supplement-check.mjs';
import {supplementCheckPanel,supplementCheckReady} from '../dist/workspace/supplement-check-panel.mjs';

const sources=Array.from({length:10},(_,i)=>({id:'r'+i,name:'文献 '+i})),section={id:'c',title:'第一章',text:sources.map(row=>'论述[source:'+row.id+']。').join('')},proofs=count=>sources.slice(0,count).map(row=>({sourceId:row.id,quote:'已提供原文摘录'}));
test('four excerpts for ten cited sources cannot count as complete',()=>{
 const original={status:'sufficient',reason:'依据已检查',evidence:proofs(4),missing:[]},out=markSupplementCitationCoverage(original,section,sources);assert.equal(out.status,'missing');assert.deepEqual([out.citationCoverage.total,out.citationCoverage.withExcerpt,out.citationCoverage.complete],[10,4,false]);assert.deepEqual(out.citationCoverage.missingSourceIds,sources.slice(4).map(row=>row.id));assert.match(out.missing[0],/文献 4/);assert.equal(original.status,'sufficient');
});
test('every distinct source needs a verified excerpt; that still does not prove the assertion or full text',()=>{
 const out=markSupplementCitationCoverage({status:'sufficient',reason:'依据已检查',evidence:proofs(10),missing:[]},{...section,text:section.text+'再次引用[source:r0]。'},sources);assert.equal(out.status,'sufficient');assert.deepEqual([out.citationCoverage.total,out.citationCoverage.withExcerpt,out.citationCoverage.complete],[10,10,true]);assert.match(out.citationCoverage.scope,/不表示全文已读或逐句论断已获证实/);
});
test('existing missing facts stay missing; source-free and bibliography-only chapters are not relabelled',()=>{
 const original={status:'missing',reason:'缺真实记录',evidence:proofs(4),missing:['提供原始实验记录']},out=markSupplementCitationCoverage(original,section,sources);assert.equal(out.status,'missing');assert.equal(out.reason,'缺真实记录');assert.ok(out.missing.includes('提供原始实验记录'));
 assert.equal(markSupplementCitationCoverage(original,{id:'c',title:'参考文献',text:section.text},sources),original);assert.equal(markSupplementCitationCoverage(original,{id:'c',title:'正文',text:'不含来源'},sources),original);assert.equal(markSupplementCitationCoverage(original,section,sources,{phase:'materials'}),original);
});
test('the real supplement checker requires an exact excerpt for each of ten cited sources',async()=>{
 const refs=sources.map((row,i)=>({...row,title:row.name,text:'合成来源 '+i+' 的独立原文摘录。',confirmed:true})),snapshot={materials:[],references:refs},chapters=[section],runtime={maxOutputTokens:4096,maxTurns:6,timeoutMs:30000};
 const check=async count=>runSupplementCheck({snapshot,chapters,kind:'thesis',phase:'final',runtime,dispatch:async({task,validateReviewOutput})=>{assert.match(task.instructions,/每项最多14条证据/);const row=task.context.chapters[0],evidence=refs.slice(0,count).map(ref=>({sourceId:ref.id,quote:ref.text})),candidate={text:JSON.stringify({items:[{id:row.id,status:'sufficient',requirement:'核对论述',reason:'已查看材料。',manuscriptQuote:row.text.slice(0,30),evidence,missing:[]}]}),usage:{input:10,output:10},costUsd:.001,trace:[]};assert.equal(validateReviewOutput(candidate).valid,count===10);return candidate;}});
 const partial=await check(4);assert.equal(partial.status,'needs_materials');assert.equal(partial.coverage.complete,true);assert.deepEqual([partial.items[0].citationCoverage.withExcerpt,partial.items[0].citationCoverage.total],[4,10]);assert.equal(supplementCheckReady({coverage:{complete:true},supplementCheck:partial}),false);assert.match(supplementCheckPanel(partial),/4 \/ 10 个来源/);
 const complete=await check(10);assert.equal(complete.status,'final_ready');assert.equal(complete.items[0].citationCoverage.complete,true);assert.equal(supplementCheckReady({coverage:{complete:true},supplementCheck:complete}),true);
});
test('all cited excerpts and additional authorized research evidence fit in one check without bypassing coverage',async()=>{
 const refs=sources.map((row,i)=>({...row,title:row.name,text:'合成来源 '+i+' 的独立原文摘录。',confirmed:true})),extra={id:'research',name:'研究资料',text:'作者提供的对照研究资料。',confirmed:true};
 const result=await runSupplementCheck({snapshot:{materials:[extra],references:refs},chapters:[section],kind:'thesis',phase:'final',runtime:{maxOutputTokens:4096,maxTurns:6,timeoutMs:30000},dispatch:async({task,validateReviewOutput})=>{const row=task.context.chapters[0],evidence=[...refs,extra].map(ref=>({sourceId:ref.id,quote:ref.text})),candidate={text:JSON.stringify({items:[{id:row.id,status:'sufficient',requirement:'核对论述与研究资料',reason:'已检查提供的依据。',manuscriptQuote:row.text.slice(0,30),evidence,missing:[]}]}),trace:[]};assert.equal(validateReviewOutput(candidate).valid,true);return candidate;}});
 assert.equal(result.status,'final_ready');assert.equal(result.items[0].evidence.length,11);assert.equal(result.items[0].citationCoverage.withExcerpt,10);
});
test('format-only missing coverage is returned for targeted repair, while true missing facts stay blocked',async()=>{
 const refs=sources.map((row,i)=>({...row,title:row.name,text:'合成来源 '+i+' 的独立原文摘录。',confirmed:true}));let calls=0;
 const report=await runSupplementCheck({snapshot:{materials:[],references:refs},chapters:[section],kind:'thesis',phase:'final',runtime:{maxOutputTokens:4096,maxTurns:6,timeoutMs:30000},dispatch:async({task,validateReviewOutput})=>{
  const row=task.context.chapters[0],evidence=refs.slice(0,8).map(ref=>({sourceId:ref.id,quote:ref.text})),items=[{id:row.id,status:'missing',requirement:'研究记录',reason:'引用来源已读取，仅因 evidenceLimit=14 未列出。',manuscriptQuote:row.text.slice(0,30),evidence:[...evidence,evidence[0],evidence[1]],missing:['确有未提供的实测记录']}];
  const candidate=()=>({text:JSON.stringify({items}),trace:[]});const failed=validateReviewOutput(candidate());assert.equal(failed.valid,false);assert.match(failed.feedback.rule,/r8/);assert.match(failed.feedback.rule,/r9/);
  items[0].reason='实测记录尚需核对。';items[0].evidence=[...evidence,...refs.slice(8).map(ref=>({sourceId:ref.id,quote:ref.text}))];assert.equal(validateReviewOutput(candidate()).valid,true);calls++;return candidate();}});
 assert.equal(calls,1);assert.equal(report.status,'needs_materials');assert.equal(report.items[0].citationCoverage.withExcerpt,10);assert.ok(report.items[0].missing.includes('确有尚未在已核对范围内定位的实测记录'));
});
test('existing model diagnostics never expose internal IDs or evidence limits in displayed report',()=>{
 const report={status:'needs_materials',coverage:{checked:1,total:1},items:[{status:'missing',title:'第一章',requirement:'参考 reference:123e4567-e89b-12d3-a456-426614174000',reason:'两篇来源 evidenceLimit=16 未列出。还需核对真实记录。',missing:['请核对 123e4567-e89b-12d3-a456-426614174000 的原文。']} ]};const html=supplementCheckPanel(report);
 assert.doesNotMatch(html,/evidenceLimit|123e4567|reference:/);assert.match(html,/真实记录/);assert.match(html,/请继续核对引用来源及正文依据/);
});
test('an unavailable or unread truncated source cannot be manufactured as an excerpt',()=>{
 const full='前缀内容。'+'中'.repeat(50)+'只在末尾的证据内容。',task=supplementCheckTask({phase:'final',chapters:[{id:'s',title:'正文',text:'论文引用[source:r]。'}],materials:[{id:'r',name:'文献',text:'前缀内容。'}]});task.materials=[{id:'r',name:'文献',text:'前缀内容。'}];task.evidenceOriginals=[{id:'r',text:full}];
 const value={items:[{id:'s',status:'sufficient',requirement:'来源',reason:'已有依据。',manuscriptQuote:'论文引用[source:r]。',evidence:[{sourceId:'r',quote:'只在末尾的证据内容。'}],missing:[]}]};assert.throws(()=>parseSupplementCheck({text:JSON.stringify(value),trace:[{tool:'read_material',status:'completed',materialId:'r',offset:0,limit:4}]},task));
});
test('legacy thesis reports cannot pass the newer per-source gate without rechecking',()=>{
 const old={coverage:{complete:true},supplementCheck:{version:1,phase:'final',status:'final_ready',coverage:{complete:true,total:1,checked:1},items:[{status:'sufficient',evidence:proofs(4)}]}};
 assert.equal(supplementCheckReady(old),true);assert.equal(supplementCheckReady(old,{requireCitationCoverage:true}),false);
 const updated=structuredClone(old);updated.supplementCheck.citationCoverageVersion=1;updated.supplementCheck.items[0].citationCoverage={total:10,withExcerpt:4,complete:false};assert.equal(supplementCheckReady(updated,{requireCitationCoverage:true}),false);
 updated.supplementCheck.items[0].citationCoverage={total:10,withExcerpt:10,complete:true,missingSourceIds:[]};assert.equal(supplementCheckReady(updated,{requireCitationCoverage:true}),true);
});
test('twenty sources remain independently represented; twenty-one in one section fail closed',async()=>{
 const refs=Array.from({length:21},(_,i)=>({id:'r'+i,title:'文献'+i,text:'该合成文献的独立原文 '+i+'。',confirmed:true})),snapshot={materials:[],references:refs},runtime={maxOutputTokens:4096,maxTurns:6,timeoutMs:30000};
 const make=count=>({id:'c',title:'正文',text:refs.slice(0,count).map(row=>'来源论述[source:'+row.id+']。').join('')});let calls=0;
 const dispatch=async({task,validateReviewOutput})=>{calls++;const row=task.context.chapters[0],ids=[...new Set([...row.text.matchAll(/\[source:([^\]]+)\]/gu)].map(match=>match[1]))],evidence=ids.map(id=>({sourceId:id,quote:refs.find(ref=>ref.id===id).text})),candidate={text:JSON.stringify({items:[{id:row.id,status:'sufficient',requirement:'论述依据',reason:'逐项核对。',manuscriptQuote:row.text.slice(0,30),evidence,missing:[]}]}),usage:{input:10,output:10},costUsd:.001,trace:[]};assert.equal(validateReviewOutput(candidate).valid,true);return candidate;};
 const full=await runSupplementCheck({snapshot,chapters:[make(20)],kind:'thesis',phase:'final',runtime,dispatch});assert.equal(full.status,'final_ready');assert.equal(full.items[0].citationCoverage.withExcerpt,20);assert.equal(calls,1);
 calls=0;const tooMany=await runSupplementCheck({snapshot,chapters:[make(21)],kind:'thesis',phase:'final',runtime,dispatch});assert.equal(tooMany.status,'unavailable');assert.equal(tooMany.coverage.complete,false);assert.equal(calls,0);assert.match(tooMany.reason,/引用来源较多/);
});
test('separate chapters with more than twenty combined citations are checked in bounded batches',async()=>{
 const refs=Array.from({length:21},(_,i)=>({id:'r'+i,title:'文献'+i,text:'该合成文献的独立原文 '+i+'。',confirmed:true})),chapters=[refs.slice(0,11),refs.slice(11)].map((group,i)=>({id:'c'+i,title:'章节'+i,text:group.map(row=>'论述[source:'+row.id+']。').join('')})),snapshot={materials:[],references:refs},tasks=[];
 const report=await runSupplementCheck({snapshot,chapters,kind:'thesis',phase:'final',runtime:{maxOutputTokens:4096,maxTurns:6,timeoutMs:30000},dispatch:async({task})=>{tasks.push(task);const items=task.context.chapters.map(row=>{const ids=[...new Set([...row.text.matchAll(/\[source:([^\]]+)\]/gu)].map(match=>match[1]))];return{id:row.id,status:'sufficient',requirement:'来源',reason:'逐项核对。',manuscriptQuote:row.text.slice(0,30),evidence:ids.map(id=>({sourceId:id,quote:refs.find(ref=>ref.id===id).text})),missing:[]};});return{text:JSON.stringify({items}),usage:{input:10,output:10},costUsd:.001,trace:[]};}});
 assert.equal(tasks.length,2);assert.equal(report.status,'final_ready');assert.deepEqual(report.items.map(row=>row.citationCoverage.withExcerpt),[11,10]);
});
test('figure feedback gives exact per-section structural IDs while uploaded image objects remain separate',async()=>{
 const figure={id:'flow',title:'结构',kind:'flowchart',nodes:[{id:'a',label:'输入'},{id:'b',label:'输出'}],edges:[{from:'a',to:'b'}],caption:'输入到输出。'},objectId='obj-0123456789abcdef01234567',chapters=[{id:'a',title:'图文',text:'过程说明。[figure:flow]',figures:[figure]},{id:'b',title:'图片',text:'原稿图片位置。[docx:'+objectId+']'}];let checked=0;
 const report=await runSupplementCheck({snapshot:{materials:[],references:[]},chapters,docxObjects:[{id:objectId,kind:'image'}],kind:'thesis',phase:'final',runtime:{maxOutputTokens:4096,maxTurns:6,timeoutMs:30000},dispatch:async({task,validateReviewOutput})=>{
  const rows=task.context.chapters;assert.deepEqual(rows.map(row=>row.expectedFigureIds),[['flow'],[]]);assert.match(task.instructions,/不得把其 ID 填入 checkedFigureIds/);
  const items=rows.map(row=>({id:row.id,status:'not_required',requirement:'图文',reason:'无外部事实',manuscriptQuote:row.text,checkedFigureIds:row.expectedFigureIds,evidence:[],missing:[]}));
  items[0].checkedFigureIds=[];let rejected=validateReviewOutput({text:JSON.stringify({items}),trace:[]});assert.equal(rejected.valid,false);assert.match(rejected.feedback.rule,/\["flow"\]/);assert.match(rejected.feedback.rule,/importedDocxObjects/);
  items[0].checkedFigureIds=['flow'];items[1].checkedFigureIds=[objectId];rejected=validateReviewOutput({text:JSON.stringify({items}),trace:[]});assert.equal(rejected.valid,false);assert.match(rejected.feedback.rule,/\[\]/);
  items[1].checkedFigureIds=[];const candidate={text:JSON.stringify({items}),trace:[]};assert.equal(validateReviewOutput(candidate).valid,true);checked++;return candidate;
 }});assert.equal(checked,1);assert.equal(report.coverage.complete,true);
});
test('citation-heavy sections form bounded batches with individual evidence limits',async()=>{
 const refs=sources.map((row,i)=>({...row,title:row.name,text:'合成来源 '+i+' 的独立原文摘录。',confirmed:true}));
 const chapters=[{id:'a',title:'甲',text:'无引文的研究概述。'},{id:'b',title:'乙',text:refs.slice(0,7).map(row=>'论述[source:'+row.id+']。').join('')},{id:'c',title:'丙',text:'最后说明。'}],tasks=[];
 const report=await runSupplementCheck({snapshot:{materials:[],references:refs},chapters,kind:'thesis',phase:'final',runtime:{maxOutputTokens:4096,maxTurns:6,timeoutMs:30000},dispatch:async({task,validateReviewOutput})=>{tasks.push(task);const rows=task.context.chapters;assert.match(task.instructions,/不能混用/);for(const row of rows){const n=new Set([...row.text.matchAll(/\[source:([^\]]+)\]/gu)].map(match=>match[1])).size;assert.equal(row.evidenceLimit,4+n);}
  const items=rows.map(row=>({id:row.id,status:'not_required',requirement:'核对',reason:'根据已有资料。',manuscriptQuote:row.text.slice(0,30),checkedFigureIds:[],evidence:[...new Set([...row.text.matchAll(/\[source:([^\]]+)\]/gu)].map(match=>match[1]))].map(id=>({sourceId:id,quote:refs.find(ref=>ref.id===id).text})),missing:[]}));const candidate={text:JSON.stringify({items}),trace:[]};assert.equal(validateReviewOutput(candidate).valid,true);return candidate;}});
 assert.equal(report.status,'final_ready');assert.deepEqual(tasks.map(task=>task.context.chapters.length),[1,1,1]);assert.equal(report.items.find(item=>item.title==='乙').citationCoverage.withExcerpt,7);
});
test('invalid review structure receives the exact authorized current-batch IDs without accepting the candidate',async()=>{
 const report=await runSupplementCheck({snapshot:{materials:[],references:[]},chapters:[{id:'c',title:'章节',text:'仅说明研究设计。'}],kind:'thesis',phase:'final',runtime:{maxOutputTokens:4096,maxTurns:6,timeoutMs:30000},dispatch:async({task,validateReviewOutput})=>{const section=task.context.chapters[0],base={id:section.id,status:'not_required',requirement:'说明',reason:'无外部事实',manuscriptQuote:section.text,evidence:[],missing:[]};
  for(const items of [[],[{...base,id:'different'}],[{...base,status:'通过'}]]){const result=validateReviewOutput({text:JSON.stringify({items}),trace:[]});assert.equal(result.valid,false);if(items[0]?.status!=='通过')assert.match(result.feedback.rule,new RegExp(section.id));}
  const result={text:JSON.stringify({items:[base]}),trace:[]};assert.equal(validateReviewOutput(result).valid,true);return result;}});assert.equal(report.status,'final_ready');
});
