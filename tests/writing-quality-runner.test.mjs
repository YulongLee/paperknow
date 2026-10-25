import test from 'node:test';
import assert from 'node:assert/strict';
import {createWritingQualityRunner} from '../backend/writing-quality-runner.mjs';

const citations=(extra={})=>({version:1,scope:'public_identifier_metadata_only',claimSupport:'not_checked',items:[],summary:{matched:0,conflict:0,not_found:0,unverified:0,unavailable:0},requests:0,cacheHits:0,limitations:['题录存在不代表支持正文论断。'],...extra});
const runtime={enabled:true,engine:'claude-agent-sdk',model:'configured-model',version:'runtime-version',maxTurns:6,maxOutputTokens:6000,timeoutMs:180000,maxCostUsd:.5};
const chapters=(count=3,words=100)=>Array.from({length:count},(_,index)=>({id:'chapter-'+(index+1),title:'章节 '+(index+1),text:'章节'+(index+1)+'研究论证。'+'文'.repeat(words)}));
const response=(findings=[])=>({text:JSON.stringify({complete:true,findings,limitations:['只核对已提供正文片段。']})});
const finding=excerpt=>({sectionId:excerpt.id,quote:excerpt.text.slice(0,Math.min(12,excerpt.text.length)),category:'logic',severity:'warning',explanation:'这是一项需要作者核对的论证衔接建议。',suggestion:'结合已有资料进一步明确论证范围。'});
const plainRunner=config=>createWritingQualityRunner({citationVerifier:{verify:async()=>citations()},...config});

test('quality runner performs metadata verification, deterministic audit and independent review in order without rewriting chapters',async()=>{
 const input=chapters(),before=structuredClone(input),stages=[],calls=[];const run=plainRunner({citationVerifier:{verify:async refs=>{calls.push({kind:'citations',refs});return citations();}}});
 const quality=await run({snapshot:{title:'论文',references:[{id:'reference',title:'内部题目',confirmed:true}]},chapters:input,runtime,runId:'run',onStage:value=>stages.push(value),dispatch:async request=>{calls.push({kind:'review',request});assert.deepEqual(request.validateReviewOutput(response()),{valid:true});return response();}});
 assert.equal(quality.status,'completed');assert.deepEqual(stages,['verifying_citations','checking_consistency','reviewing_manuscript']);assert.deepEqual(calls.map(row=>row.kind),['citations','review']);assert.equal(calls[1].request.task.skill,'writing-review');assert.equal(calls[1].request.unitId,'quality-review::1');assert.ok(calls[1].request.settings.maxTurns<=runtime.maxTurns);assert.ok(calls[1].request.settings.maxOutputTokens<=runtime.maxOutputTokens);assert.ok(calls[1].request.settings.timeoutMs<=runtime.timeoutMs);assert.deepEqual(input,before);assert.equal(quality.coverage.complete,true);assert.equal(quality.reviews[0].status,'completed');
});

test('all manuscript chapters are reviewed in bounded batches, including the end of a long manuscript',async()=>{
 const input=chapters(9,7000),captured=[];const quality=await plainRunner()({snapshot:{title:'长论文'},chapters:input,runtime,dispatch:async({task,validateReviewOutput})=>{captured.push(task);const result=response(task.context.manuscriptExcerpts.map(finding));assert.equal(validateReviewOutput(result).valid,true);return result;}});
 assert.ok(captured.length>=3);assert.deepEqual(new Set(quality.reviews.flatMap(row=>row.sectionIds)),new Set(input.map(row=>row.id)));assert.equal(quality.coverage.reviewedCharacters,input.reduce((sum,row)=>sum+row.text.length,0));assert.equal(quality.coverage.complete,true);
 assert.ok(captured.every(task=>JSON.stringify(task.context).length<=39000&&task.context.manuscriptExcerpts.reduce((sum,row)=>sum+row.text.length,0)<=22000));assert.match(quality.limitations.join(''),/跨批次/);
});

test('long single sections are split without losing any characters and review quotes map back to exact original offsets',async()=>{
 const text='第一段真实文本。'+'中'.repeat(22000)+'第二段真实文本。'+'尾'.repeat(22000)+'最后一段实际文字。',input=[{id:'one-section',title:'同一章节',text}],requests=[];
 const quality=await plainRunner()({chapters:input,runtime,dispatch:async request=>{requests.push(request);return response(request.task.context.manuscriptExcerpts.map(finding));}});
 assert.equal(requests.length,3);assert.equal(quality.coverage.complete,true);assert.equal(quality.coverage.reviewedCharacters,text.length);const allSegments=quality.reviews.flatMap(row=>row.segments);assert.deepEqual(allSegments.map(row=>row.offset),[0,22000,44000]);
 for(const item of quality.reviews.flatMap(row=>row.findings)){assert.equal(item.sectionId,'one-section');assert.equal(text.slice(item.offset,item.offset+item.quote.length),item.quote);}assert.ok(requests.every(({task})=>task.context.manuscriptExcerpts[0].partialChapter));
});

test('emoji surrogate pairs at chunk boundaries are preserved and all positions remain original UTF-16 offsets',async()=>{
 const text='文'.repeat(21999)+'🧪'+'续'.repeat(100),input=[{id:'emoji',title:'边界',text}];const quality=await plainRunner()({chapters:input,runtime,dispatch:async({task})=>response(task.context.manuscriptExcerpts.map(finding))});
 assert.equal(quality.coverage.complete,true);assert.equal(quality.coverage.reviewedCharacters,text.length);assert.equal(quality.reviews[0].segments[0].characters,21999);assert.equal(quality.reviews[1].segments[0].offset,21999);assert.equal(text.slice(quality.reviews[1].findings[0].offset,quality.reviews[1].findings[0].offset+2),'🧪');
});

test('a failed review batch does not discard completed checks and later batches can still finish',async()=>{
 const input=chapters(6,10000);let count=0;const quality=await plainRunner()({chapters:input,runtime,dispatch:async()=>{count++;if(count===2)throw new Error('PRIVATE upstream diagnostics');return response();}});
 assert.equal(quality.status,'partial');assert.deepEqual(quality.reviews.map(row=>row.status),['completed','unavailable','completed']);assert.equal(quality.coverage.complete,false);assert.equal(count,3);assert.doesNotMatch(JSON.stringify(quality),/PRIVATE|diagnostics/);assert.match(quality.limitations.join(''),/未覆盖全部正文/);
});

test('an internal model timeout named AbortError becomes a partial review without cancelling the owner task',async()=>{
 const quality=await plainRunner()({chapters:chapters(),runtime,dispatch:async()=>{throw Object.assign(new Error('SDK timed out'),{name:'AbortError'});}});assert.equal(quality.status,'partial');assert.equal(quality.reviews[0].status,'unavailable');
});

for(const error of [Object.assign(new Error('budget exhausted'),{code:'budget_exceeded'}),Object.assign(new Error('unknown usage'),{code:'usage_unknown'}),Object.assign(new Error('daily maximum'),{status:429}),Object.assign(new Error('预算达到上限'),{status:503})])test('budget failures stop later dispatches rather than opening additional calls: '+(error.code||error.message),async()=>{
 let calls=0;const quality=await plainRunner()({chapters:chapters(6,10000),runtime,dispatch:async()=>{calls++;throw error;}});assert.equal(calls,1);assert.equal(quality.status,'partial');assert.equal(quality.reviews[0].reasonCode,'budget_exhausted');assert.ok(quality.reviews.slice(1).every(row=>row.status==='not_started'&&row.reasonCode==='budget_exhausted'));
});

test('malformed or fabricated review output is rejected without changing the saved manuscript',async()=>{
 const input=chapters(),before=structuredClone(input);let feedback;
 const quality=await plainRunner()({chapters:input,runtime,dispatch:async request=>{const result=response([{...finding(request.task.context.manuscriptExcerpts[0]),quote:'这些原句在提供的稿件中根本不存在'}]);feedback=request.validateReviewOutput(result);return result;}});
 assert.equal(feedback.valid,false);assert.equal(feedback.feedback.code,'review_grounding');assert.equal(quality.status,'partial');assert.equal(quality.reviews[0].findings.length,0);assert.deepEqual(input,before);
});

test('missing model dispatch produces explicit not-started review state while preserving deterministic findings',async()=>{
 const quality=await plainRunner()({chapters:[{id:'one',title:'一',text:'【待补充：研究实际资料和实验记录】'}],runtime});assert.equal(quality.status,'partial');assert.equal(quality.consistency.findings[0].category,'unresolved_placeholder');assert.equal(quality.reviews[0].status,'not_started');assert.equal(quality.reviews[0].reasonCode,'not_configured');assert.equal(quality.coverage.complete,false);
});

test('citation service outages leave metadata verification explicitly incomplete without failing the manuscript review',async()=>{
 const run=plainRunner({citationVerifier:{verify:async()=>{throw Error('PRIVATE source diagnostics');}}}),quality=await run({chapters:chapters(),runtime,dispatch:async()=>response()});
 assert.equal(quality.status,'partial');assert.equal(quality.citations.status,'unavailable');assert.equal(quality.citations.claimSupport,'not_checked');assert.equal(quality.reviews[0].status,'completed');assert.doesNotMatch(JSON.stringify(quality),/PRIVATE/);
});

test('no-identifier references spend zero requests and factory-level verifier caching is reused across tasks',async()=>{
 let calls=0;const run=createWritingQualityRunner({fetchImpl:async()=>{calls++;return new Response(JSON.stringify({message:{DOI:'10.1234/test',title:['Public title'],published:{'date-parts':[[2025]]}}}),{headers:{'content-type':'application/json'}});}});
 const noId=await run({snapshot:{references:[{id:'private',title:'PRIVATE 中文题名',confirmed:true}]},chapters:chapters(),runtime,dispatch:async()=>response()});assert.equal(noId.status,'completed');assert.equal(noId.citations.requests,0);assert.equal(calls,0);
 const snapshot={references:[{id:'ref',title:'Public title',doi:'10.1234/test',year:'2025',confirmed:true}]};const first=await run({snapshot,chapters:chapters(),runtime,runId:'a',dispatch:async()=>response()}),second=await run({snapshot,chapters:chapters(),runtime,runId:'b',dispatch:async()=>response()});assert.equal(calls,1);assert.equal(first.citations.requests,1);assert.equal(second.citations.cacheHits,1);assert.equal(second.citations.requests,0);
});

test('factory-level metadata daily limits cannot be reset by starting a new writing task',async()=>{
 let calls=0;const run=createWritingQualityRunner({writingQualityDailyLimit:1,fetchImpl:async url=>{calls++;const identifier=decodeURIComponent(new URL(url).pathname.slice('/works/'.length));return new Response(JSON.stringify({message:{DOI:identifier,title:['Public title']}}),{headers:{'content-type':'application/json'}});}});
 const task=doi=>({snapshot:{references:[{id:doi,title:'Public title',doi,confirmed:true}]},chapters:chapters(),runtime,dispatch:async()=>response()});await run(task('10.1234/first'));const second=await run(task('10.1234/second'));assert.equal(calls,1);assert.equal(second.status,'partial');assert.equal(second.citations.items[0].reasonCode,'budget_exhausted');
});

test('an already aborted or superseded task cannot start citations, audit or model dispatch',async()=>{
 let calls=0;const run=plainRunner({citationVerifier:{verify:async()=>{calls++;return citations();}}}),controller=new AbortController();controller.abort();await assert.rejects(run({chapters:chapters(),runtime,signal:controller.signal,dispatch:async()=>{calls++;return response();}}),{name:'AbortError'});assert.equal(calls,0);
 await assert.rejects(run({chapters:chapters(),runtime,isCurrent:()=>false,dispatch:async()=>{calls++;return response();}}),{name:'AbortError'});assert.equal(calls,0);
});

test('task replacement after a provider result is checked before any quality report can be completed',async()=>{
 let current=true,dispatches=0;const run=plainRunner();await assert.rejects(run({chapters:chapters(),runtime,isCurrent:()=>current,dispatch:async()=>{dispatches++;current=false;return response();}}),{name:'AbortError'});assert.equal(dispatches,1);
});

test('cancellation while a slow verification ignores its signal still exits without starting review',async()=>{
 const controller=new AbortController();let called=0;const run=plainRunner({citationVerifier:{verify:async()=>new Promise(()=>{})}}),pending=run({chapters:chapters(),runtime,signal:controller.signal,dispatch:async()=>{called++;return response();}});setTimeout(()=>controller.abort(),10);await assert.rejects(pending,{name:'AbortError'});assert.equal(called,0);
});

test('cancellation waits for the owned model dispatch to observe its signal before rejecting the quality run',async()=>{
 const controller=new AbortController();let started,observed=false;const began=new Promise(resolve=>{started=resolve;}),run=plainRunner();
 const pending=run({chapters:chapters(),runtime,signal:controller.signal,dispatch:async({signal})=>{assert.equal(signal,controller.signal);started();return new Promise((_,reject)=>{signal.addEventListener('abort',()=>{observed=true;reject(Object.assign(new Error('Model cancelled'),{name:'AbortError'}));},{once:true});});}});
 const rejected=assert.rejects(pending,{name:'AbortError'});await began;controller.abort();await rejected;assert.equal(observed,true);
});

test('quality cancellation cannot settle before owned dispatch accounting and cleanup have finished',async()=>{
 const controller=new AbortController(),events=[];let started,cleanupStarted,releaseCleanup,settled=false,dispatches=0;
 const began=new Promise(resolve=>{started=resolve;}),cleaning=new Promise(resolve=>{cleanupStarted=resolve;}),cleanupBarrier=new Promise(resolve=>{releaseCleanup=resolve;}),run=plainRunner();
 const pending=run({chapters:chapters(6,10000),runtime,signal:controller.signal,dispatch:async({signal})=>{
  dispatches++;started();
  try{await new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(Object.assign(new Error('Model cancelled'),{name:'AbortError'})),{once:true});});}
  finally{events.push('cleanup_started');cleanupStarted();await cleanupBarrier;events.push('accounted_and_cleaned');}
 }});
 const rejected=assert.rejects(pending,{name:'AbortError'}).then(()=>{settled=true;events.push('quality_settled');});
 await began;controller.abort();await cleaning;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false,'owned dispatch cleanup must remain awaited');assert.deepEqual(events,['cleanup_started']);
 releaseCleanup();await rejected;assert.deepEqual(events,['cleanup_started','accounted_and_cleaned','quality_settled']);assert.equal(dispatches,1,'cancellation must not dispatch another batch');
});

test('many tiny chapters keep the JSON context bounded and are all covered without hidden omissions',async()=>{
 const input=chapters(150,30).map(row=>({...row,title:'长标题'.repeat(100)})),contexts=[];const quality=await plainRunner()({chapters:input,runtime,dispatch:async({task})=>{contexts.push(task.context);return response();}});
 assert.equal(quality.status,'completed');assert.equal(quality.coverage.complete,true);assert.equal(new Set(quality.reviews.flatMap(row=>row.sectionIds)).size,150);assert.ok(contexts.every(context=>JSON.stringify(context).length<=39000));
});

test('long school requirements reduce each review batch without dropping manuscript text or exceeding context limits',async()=>{const source=chapters(4,16000),seen=[],run=plainRunner();const quality=await run({snapshot:{title:'开题报告',requirements:{instructions:'学校要求'.repeat(3000)}},chapters:source,runtime,runId:'school-review',dispatch:async({task})=>{seen.push(...task.context.manuscriptExcerpts.map(row=>row.text));assert.ok(JSON.stringify(task.context).length<35000);assert.equal(task.context.scope.excerpted,false);assert.equal(task.context.writingRequirements.length,12000);return response();}});assert.equal(seen.join(''),source.map(row=>row.text).join(''));assert.equal(quality.coverage.complete,true);});
