import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {createWritingService} from '../backend/writing-service.mjs';
import {startWritingWorker} from '../backend/writing-worker.mjs';
import {createThesisService} from '../backend/thesis-service.mjs';
import {startThesisWorker} from '../backend/thesis-worker.mjs';
import {supplementCheckTask,parseSupplementCheck,runSupplementCheck} from '../backend/supplement-check.mjs';
import {supplementCheckPanel,supplementCheckReady} from '../dist/workspace/supplement-check-panel.mjs';
import {assessWritingDelivery} from '../dist/workspace/writing-delivery.mjs';
import {bindDocumentExports,documentExportButtons} from '../dist/workspace/document-export.mjs';
import {beginDraftScope,endDraftScope} from '../dist/workspace/state.mjs';
const runtime={enabled:true,engine:'claude-agent-sdk',baseURL:'https://synthetic.invalid',model:'fixture-model',apiKey:'synthetic-private',version:'supplement-v1',maxTurns:6,maxOutputTokens:4096,maxCostUsd:.5,timeoutMs:30000};
const material={id:'record',name:'合成实践记录',text:'合成验收资料：按预设流程完成十次观察，记录原始数据，并明确本例不能用于真实研究。',confirmed:true};
const snapshot=()=>({title:'合成材料核查测试',profile:{level:'本科',language:'中文',targetWords:200},requirements:{instructions:'按当前文档目的核对真实材料，不编造研究结果。'},materials:[{...material}],references:[],outline:[{id:'c',title:'研究计划',targetWords:200}]});
const response=items=>({text:JSON.stringify({items}),usage:{input:100,output:100},costUsd:.001,trace:[],finishReason:'end_turn'});
function checkResponse(task,{missing=false}={}){return response(task.context.chapters.map(row=>({id:row.id,status:missing?'missing':task.context.evidence.length?'sufficient':'not_required',requirement:'当前章节所需的事实依据',reason:missing?'尚缺本节实际观察记录。':'已按本节目的核对提供的资料。',manuscriptQuote:row.text.slice(0,Math.min(30,row.text.length)),evidence:missing||!task.context.evidence.length?[]:[{sourceId:task.context.evidence[0].id,quote:task.context.evidence[0].text.slice(0,30)}],missing:missing?['实际观察记录和记录范围']:[]})));}
const task=()=>supplementCheckTask({snapshot:snapshot(),chapters:[{id:'s',title:'研究结果',text:'实际观察已经完成，需要相应记录。'}],materials:[material]});
test('semantic report rejects unknown sources, invented quotes, duplicate or omitted requirements and truncated output',()=>{
 const input=task(),good=checkResponse(input);assert.equal(parseSupplementCheck(good,input)[0].status,'sufficient');
 for(const mutate of [v=>v.items=[],v=>v.items.push(v.items[0]),v=>v.items[0].id='foreign',v=>v.items[0].evidence[0].sourceId='other-account',v=>v.items[0].evidence[0].quote='并不存在的研究记录',v=>v.items[0].manuscriptQuote='不存在的原稿',v=>v.items[0].evidence=[]]){const value=JSON.parse(good.text);mutate(value);assert.throws(()=>parseSupplementCheck(response(value.items),input),error=>error.code==='invalid_supplement_check');}
 assert.throws(()=>parseSupplementCheck({...good,truncated:true},input));
});
test('an explicit missing item cannot be dismissed as not_required; proposal plans do not require completed experiments',()=>{
 const explicit=task();explicit.context.chapters[0].text='【待补充：实际观察记录】';const value=JSON.parse(checkResponse(explicit).text);value.items[0]={...value.items[0],status:'not_required',evidence:[]};assert.throws(()=>parseSupplementCheck(response(value.items),explicit));
 const plan=supplementCheckTask({kind:'proposal',chapters:[{id:'s',title:'拟研究方案',text:'拟在下一阶段开展观察，目前尚未实施。'}]});assert.equal(parseSupplementCheck(checkResponse(plan),plan)[0].status,'not_required');assert.match(plan.instructions,/开题报告.*不要求尚未实施/);assert.match(plan.instructions,/AI建议.*不能证明研究已经实施/);
});
test('full report is derived from all returned section items; incomplete, cancelled and stale checks never unlock a final',async()=>{
 const chapters=Array.from({length:9},(_,i)=>({id:'c'+i,title:'章节'+i,text:'研究文本。'.repeat(500)})),calls=[];
 const report=await runSupplementCheck({snapshot:snapshot(),chapters,runtime,dispatch:async request=>{calls.push(request);return checkResponse(request.task);}});
 assert.equal(report.status,'final_ready');assert.equal(report.coverage.complete,true);assert.equal(report.coverage.checked,9);assert.ok(calls.length>1);assert.ok(calls.every(row=>JSON.stringify(row.task.context).length<39000));
 const quality={coverage:{complete:true},supplementCheck:report};assert.equal(supplementCheckReady(quality),true);for(const change of [{stale:true},{coverage:{complete:false}},{supplementCheck:{...report,status:'unavailable'}},{supplementCheck:{...report,phase:'materials'}}])assert.equal(supplementCheckReady({...quality,...change}),false);
 assert.equal(supplementCheckReady(quality,{current:false}),false);
 const incomplete=await runSupplementCheck({snapshot:snapshot(),chapters,runtime,dispatch:async()=>{throw Error('synthetic connection failure');}});assert.equal(incomplete.status,'unavailable');assert.equal(incomplete.coverage.complete,false);
 const controller=new AbortController();await assert.rejects(runSupplementCheck({chapters,runtime,signal:controller.signal,dispatch:async request=>{controller.abort();return checkResponse(request.task);}}),error=>error.name==='AbortError');
});
test('long material uses labelled relevant excerpts, and a retrieval label cannot masquerade as supplied evidence',async()=>{
 const snap=snapshot();snap.materials[0].text=('研究计划 合成观察记录。'+material.text).repeat(1000);let captured;
 const report=await runSupplementCheck({snapshot:snap,chapters:[{id:'c',title:'研究计划',text:'需要核查记录。'}],runtime,dispatch:async({task})=>{captured=task;const value=JSON.parse(checkResponse(task).text);value.items[0].evidence[0].quote=material.text.slice(0,20);return response(value.items);}});
 assert.equal(report.status,'final_ready');assert.equal(report.evidenceScope,'relevant_excerpts');assert.ok(report.limitations.some(row=>row.includes('不表示全部原文件')));const forged=JSON.parse(checkResponse(captured).text);forged.items[0].evidence[0].quote=captured.context.evidence[0].text.split('\n')[0];assert.throws(()=>parseSupplementCheck(response(forged.items),captured));
});
test('large valid manuscripts use bounded batches without consuming all 24 thesis review slots',async()=>{
 const chapters=Array.from({length:120},(_,i)=>({id:'unit-'+i,title:'合成单元'+i,text:'合成内容。'.repeat(160)}));let calls=0;
 const report=await runSupplementCheck({snapshot:snapshot(),chapters,runtime,dispatch:async({task})=>{calls++;assert.ok(task.context.chapters.length<=10);assert.ok(JSON.stringify(task.context).length<39000);return checkResponse(task);}});
 assert.equal(report.coverage.checked,120);assert.equal(report.status,'final_ready');assert.ok(calls+Math.ceil(chapters.length/12)<=24,'supplement and existing manuscript review batches fit the persisted review allowance');
});
test('supplement batching preserves emoji at text boundaries without dropping or duplicating manuscript characters',async()=>{
 const text='文'.repeat(7999)+'🧪'+'后续内容。'.repeat(40),parts=[];
 const report=await runSupplementCheck({snapshot:snapshot(),chapters:[{id:'emoji',title:'边界',text}],runtime,dispatch:async({task})=>{parts.push(...task.context.chapters.map(row=>row.text));return checkResponse(task);}});
 assert.equal(report.status,'final_ready');assert.equal(parts.join(''),text);assert.ok(parts.every(part=>part.isWellFormed()));assert.equal(parts[1].slice(0,2),'🧪');
 assert.match(supplementCheckPanel({status:'materials_ready',coverage:{checked:1,total:1},items:[]}),/资料已齐，可继续完善正文/);
});
function fixture(t,{kind='proposal',thesis=false}={}){
 const db=database(':memory:'),user={id:'owner'},at=new Date().toISOString();db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user.id,'合成验收','user',at);let missing=false;const calls=[];
 const config={supplementCheckEnabled:true,writingQualityEnabled:true,thesisContinuousEnabled:true,writingPollMs:60000,thesisPollMs:60000,getAgentSettings:()=>({...runtime}),citationVerifier:{verify:async()=>({items:[],summary:{},limitations:[]})},agentTaskRunner:async args=>{calls.push(args);const {task}=args;if(task.context.operation==='supplement-check')return checkResponse(task,{missing});if(task.skill==='writing-review')return{text:JSON.stringify({complete:true,findings:[],limitations:[]}),usage:{input:50,output:50},costUsd:.001};if(thesis&&task.context.unit.frontMatter){const english=task.context.unit.frontMatter==='abstract_en',text=english?'English title: A Synthetic Evidence Test\n'+('This synthetic study describes the supplied methods and evidence with clearly stated limitations. '.repeat(17))+'\nKey words: feedback; study; evidence':'研究方法和材料以用户实际提供的记录为依据，并说明证据范围。'.repeat(14)+'\n关键词：课堂反馈；研究；证据';return{text:JSON.stringify({text,source_ids:[],missing_evidence:[],complete:true,figures:[],draft:false}),usage:{input:100,output:300},costUsd:.001};}return{text:JSON.stringify({text:'研'.repeat(task.context.unit.targetWords)+'[source:record]',source_ids:['record'],missing_evidence:[],complete:true}),trace:[{tool:'read_material',status:'completed',materialId:'record'}],usage:{input:100,output:200},costUsd:.001};}};
 const billing=createBillingService(db,config);config.billing=billing;billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});const order=randomUUID();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order,user.id,'credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,user.id,'credits-200',200,'purchase',at);
 const service=thesis?createThesisService(db,config):createWritingService(db,config),worker=thesis?startThesisWorker(db,config):startWritingWorker(db,config);t.after(async()=>{await worker.stop();db.close();});
 const request=async(path,body)=>(await service.handle({path,method:body===undefined?'GET':'POST',user,readBody:async()=>body})).value;
 const submit=async(snap=snapshot(),completion)=>{const data={kind,operation:'draft',snapshot:snap,...(completion?{completion}:{})},quote=await request('/api/writing/quote',data);return(await request('/api/writing/jobs',{...data,clientKey:randomUUID(),billingToken:quote.token,consent:true})).item;};
 return{db,user,billing,calls,worker,request,submit,setMissing:value=>{missing=value;},get:id=>service.get(id,user)};
}
for(const kind of ['proposal','summary','taskbook','article','course','practice'])test(kind+' includes a real supplemental check and a full body review in one settlement',async t=>{
 const f=fixture(t,{kind}),item=await f.submit();await f.worker.tick();const done=f.get(item.id);assert.equal(done.status,'completed',done.error);assert.equal(done.output.quality.supplementCheck.status,'final_ready');assert.equal(supplementCheckReady(done.output.quality),true);assert.ok(f.calls.some(row=>row.task.context.operation==='supplement-check'));assert.equal(f.billing.balance('owner').balance,190);assert.equal(f.billing.balance('owner').held,0);
});
test('insufficient supplements stop before rewriting, release the fee, persist the report and can resume from the exact original draft',async t=>{
 const f=fixture(t),base=await f.submit();await f.worker.tick();const original=f.get(base.id),before=f.calls.length;f.setMissing(true);const child=await f.submit(snapshot(),{baseJobId:base.id,text:original.output.text});await f.worker.tick();const failed=f.get(child.id);assert.equal(failed.status,'failed');assert.equal(failed.output.quality.supplementCheck.status,'needs_materials');assert.equal(f.calls.length,before+1,'no rewrite is dispatched when required evidence is absent');assert.equal(f.billing.balance('owner').balance,190);assert.equal(f.billing.balance('owner').held,0);assert.equal(f.get(base.id).output.text,original.output.text);
 f.setMissing(false);const next=await f.submit(snapshot(),{baseJobId:child.id});await f.worker.tick();const done=f.get(next.id);assert.equal(done.status,'completed',done.error);assert.ok(f.calls.some(row=>row.task.context.revisionOriginal===original.output.sections[0].text));assert.equal(done.output.quality.supplementCheck.status,'final_ready');assert.equal(f.billing.balance('owner').balance,180,'successful automatic improvement is billed once, never once per checker');
});
test('user-written drafts can enter the same check and improvement flow without a fabricated base job',async t=>{
 const f=fixture(t),text='用户实际写下的待核对正文。'.repeat(18),item=await f.submit(snapshot(),{text});await f.worker.tick();const done=f.get(item.id);assert.equal(done.status,'completed',done.error);assert.ok(f.calls.some(row=>row.task.context.revisionOriginal===text));assert.equal(done.output.quality.supplementCheck.status,'final_ready');assert.equal(f.billing.balance('owner').balance,190);
});
test('already queued legacy jobs retain their execution contract and cannot be mistaken for checked finals',async t=>{
 const f=fixture(t),item=await f.submit();const saved=JSON.parse(f.db.prepare('SELECT input FROM jobs WHERE id=?').get(item.id).input);delete saved.supplementCheck;f.db.prepare('UPDATE jobs SET input=? WHERE id=?').run(JSON.stringify(saved),item.id);await f.worker.tick();const done=f.get(item.id);assert.equal(done.status,'completed',done.error);assert.equal(f.calls.some(row=>row.task.context.operation==='supplement-check'),false);assert.equal(supplementCheckReady(done.output.quality),false);
});
test('legacy theses without placeholder markers still have a route through the new final check',async t=>{
 const f=fixture(t,{thesis:true}),snap=snapshot();snap.profile.targetWords=500;snap.outline=[{id:'c',title:'研究设计',targetWords:500}];let item=(await f.request('/api/theses',{clientKey:randomUUID(),snapshot:snap})).item;for(const chapter of item.chapters)item=(await f.request('/api/theses/'+item.id+'/chapters/'+chapter.id,{version:item.version,text:'作者已保存的合成内容，尚未完成新的资料完整性检查。'})).item;const quote=await f.request('/api/theses/'+item.id+'/quote',{version:item.version,action:'generate',completion:true,issueCodes:[]});assert.ok(quote.completion.chapterTitles.includes('研究设计'));
});
test('thesis supplemental preflight is durable, uses its budget ledger and leaves every original chapter intact when evidence is missing',async t=>{
 const f=fixture(t,{thesis:true}),snap=snapshot();snap.profile.targetWords=500;snap.outline=[{id:'c',title:'第一章 研究结果',targetWords:500}];let item=(await f.request('/api/theses',{clientKey:randomUUID(),snapshot:snap})).item;
 for(const chapter of item.chapters)item=(await f.request('/api/theses/'+item.id+'/chapters/'+chapter.id,{version:item.version,text:chapter.id==='c'?'已有正文【待补充：实际观察记录】':'作者已保存的合成内容。'})).item;
 const original=item.chapters.map(row=>({id:row.id,text:row.text,version:row.version}));f.setMissing(true);const quote=await f.request('/api/theses/'+item.id+'/quote',{version:item.version,action:'generate',completion:true});await f.request('/api/theses/'+item.id+'/generate',{version:item.version,completion:true,clientKey:randomUUID(),consent:true,billingToken:quote.token});await f.worker.tick();const done=f.get(item.id);assert.equal(done.job.status,'needs_materials',done.job.error);assert.equal(done.quality.supplementCheck.status,'needs_materials');assert.deepEqual(done.chapters.map(row=>({id:row.id,text:row.text,version:row.version})),original);assert.equal(f.billing.balance('owner').balance,200);assert.equal(f.billing.balance('owner').held,0);assert.ok(f.db.prepare("SELECT count(*) n FROM thesis_execution_dispatches WHERE kind='review'").get().n>0);
});
test('a thesis with sufficient supplements passes preflight, rewrites, rechecks all chapters and invalidates the report after a manual change',async t=>{
 const f=fixture(t,{thesis:true}),snap=snapshot();snap.profile.targetWords=500;snap.outline=[{id:'c',title:'第一章 研究结果',targetWords:500}];let item=(await f.request('/api/theses',{clientKey:randomUUID(),snapshot:snap})).item;
 for(const chapter of item.chapters)item=(await f.request('/api/theses/'+item.id+'/chapters/'+chapter.id,{version:item.version,text:chapter.id==='c'?'已有正文【待补充：实际观察记录】':'作者已保存的合成内容。'})).item;
 const quote=await f.request('/api/theses/'+item.id+'/quote',{version:item.version,action:'generate',completion:true});await f.request('/api/theses/'+item.id+'/generate',{version:item.version,completion:true,clientKey:randomUUID(),consent:true,billingToken:quote.token});await f.worker.tick();let done=f.get(item.id);assert.equal(done.job.status,'completed',done.job.error);assert.equal(done.quality.supplementCheck.status,'final_ready');assert.equal(supplementCheckReady(done.quality),true);assert.equal(f.billing.balance('owner').balance,190);
 done=(await f.request('/api/theses/'+done.id+'/chapters/c',{version:done.version,text:done.chapters.find(row=>row.id==='c').text+'作者新增未检查内容。'})).item;assert.equal(done.quality.stale,true);assert.equal(supplementCheckReady(done.quality),false);
});
test('formal export cannot bypass missing or stale checks; draft download stays available',async()=>{
 const dom=new JSDOM('<main>'+documentExportButtons('s',{submission:true})+'<p id="status"></p></main>',{url:'https://paperknow.test/workspace.html'});for(const key of ['window','document','location'])globalThis[key]=dom.window[key];let downloads=0,needs=0;beginDraftScope({ownerId:'owner',drafts:[]});
 try{bindDocumentExports('s',()=> '合成正文',()=> '合成文档',document.querySelector('#status'),{docxOnly:true,getDocumentOptions:()=>({documentKind:'writing',writingKind:'proposal',requireSupplementCheck:true}),loadDocument:async()=>({defaultWritingTemplateProfile:()=>({}),createWritingDocx:async()=>new Uint8Array([1]),runThesisLayoutAgent:async bytes=>({bytes,report:{unresolved:[]}}),inspectThesisExportContent:async()=>({unresolvedPlaceholders:0})}),onNeedsCompletion:()=>{needs++;},downloadFile:async()=>{downloads++;return{message:'已下载'};}});document.querySelector('#s-docx').click();for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));assert.equal(downloads,0);assert.equal(needs,1);assert.match(document.querySelector('#status').textContent,/补充内容检查/);document.querySelector('#s-draft').click();for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));assert.equal(downloads,1);
 }finally{endDraftScope();dom.window.close();}
});
test('UI escapes user material, exposes precise missing items and makes stale evidence explicit',()=>{
 const report={status:'needs_materials',coverage:{total:2,checked:2,complete:true},items:[{title:'<img src=x>',status:'missing',requirement:'观察记录',reason:'尚未提供',missing:['原始记录'],evidence:[]}]},html=supplementCheckPanel(report,{stale:true});assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.match(html,/原始记录/);assert.match(html,/需要重新检查/);
 const quality={coverage:{complete:true},supplementCheck:{...report,status:'final_ready',phase:'final',version:1,items:[{status:'not_required'},{status:'sufficient'}]}};assert.equal(assessWritingDelivery({kind:'proposal',text:'计划性正文。',quality,requireSupplementCheck:true}).ready,true);assert.equal(assessWritingDelivery({kind:'proposal',text:'已经修改的正文。',quality,qualityCurrent:false,requireSupplementCheck:true}).ready,false);
});
