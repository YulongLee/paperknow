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
test('supplement evidence is readable through the authorized material tool and short responses use smaller complete batches',async()=>{
 const chapters=Array.from({length:10},(_,i)=>({id:'chapter-'+i,title:'章节'+i,text:'本节核对已提供的合成记录。'})),calls=[];
 const report=await runSupplementCheck({snapshot:snapshot(),chapters,runtime:{...runtime,maxOutputTokens:1024},dispatch:async request=>{calls.push(request);assert.ok(request.task.context.chapters.length<=2);assert.deepEqual(request.task.materials.map(row=>row.id),request.task.context.evidence.map(row=>row.id));assert.equal(request.task.materials[0].text,material.text);assert.equal(request.settings.maxOutputTokens,1024);return checkResponse(request.task);}});
 assert.equal(report.status,'final_ready');assert.equal(report.coverage.checked,10);assert.equal(calls.length,5);
});
test('a checker execution failure is not reported as a confirmed material deficiency',async()=>{
 const report=await runSupplementCheck({snapshot:snapshot(),chapters:[{id:'c',title:'研究',text:'需要核查的合成说明。'}],runtime,dispatch:async()=>{throw Object.assign(Error('bounded execution failed'),{code:'turn_limit'});}});
 assert.equal(report.status,'unavailable');assert.equal(report.reasonCode,'turn_limit');assert.equal(report.coverage.checked,0);assert.match(report.reason,/不能据此判定材料缺失/);assert.match(report.reason,/无需重复上传/);
});
test('semantic report rejects unknown sources, invented quotes, duplicate or omitted requirements and truncated output',()=>{
 const input=task(),good=checkResponse(input);assert.equal(parseSupplementCheck(good,input)[0].status,'sufficient');
 for(const mutate of [v=>v.items=[],v=>v.items.push(v.items[0]),v=>v.items[0].id='foreign',v=>v.items[0].evidence[0].sourceId='other-account',v=>v.items[0].evidence[0].quote='并不存在的研究记录',v=>v.items[0].manuscriptQuote='不存在的原稿',v=>v.items[0].evidence=[]]){const value=JSON.parse(good.text);mutate(value);assert.throws(()=>parseSupplementCheck(response(value.items),input),error=>error.code==='invalid_supplement_check');}
 assert.throws(()=>parseSupplementCheck({...good,truncated:true},input));
});
test('an explicit missing item cannot be dismissed as not_required; proposal plans do not require completed experiments',()=>{
 const explicit=task();explicit.context.chapters[0].text='【待补充：实际观察记录】';const value=JSON.parse(checkResponse(explicit).text);value.items[0]={...value.items[0],status:'not_required',evidence:[]};assert.throws(()=>parseSupplementCheck(response(value.items),explicit));
 const plan=supplementCheckTask({kind:'proposal',chapters:[{id:'s',title:'拟研究方案',text:'拟在下一阶段开展观察，目前尚未实施。'}]});assert.equal(parseSupplementCheck(checkResponse(plan),plan)[0].status,'not_required');assert.match(plan.instructions,/开题报告.*不要求尚未实施/);assert.match(plan.instructions,/AI建议.*不能证明研究已经实施/);
});

test('a plan or demonstration is not automatically accepted as proof of an asserted real-world problem',()=>{
 const input=supplementCheckTask({kind:'proposal',chapters:[{id:'s',title:'研究背景',text:'高校图书馆数字阅读服务存在检索引导不清与移动界面体验不佳的问题。'}],materials:[{id:'m',name:'用户资料',text:'拟改善检索引导和移动端界面，演示人员完成三次模拟检索。'}]});
 const row={id:'s',status:'sufficient',requirement:'研究背景',reason:'提供研究方案。',manuscriptQuote:input.context.chapters[0].text,evidence:[{sourceId:'m',quote:input.context.evidence[0].text}],missing:[]};
 const flagged=parseSupplementCheck(response([row]),input)[0];assert.equal(flagged.status,'missing');assert.match(flagged.missing[0],/调查|观察/);
 const noEvidence={...row,status:'not_required',evidence:[]};assert.equal(parseSupplementCheck(response([noEvidence]),input)[0].status,'missing');
 const hypothesis={...input,context:{...input.context,chapters:[{...input.context.chapters[0],text:'高校图书馆可能存在检索引导不清的问题，有待验证。'}]}};
 const hypothesisRow={...noEvidence,manuscriptQuote:hypothesis.context.chapters[0].text};assert.equal(parseSupplementCheck(response([hypothesisRow]),hypothesis)[0].status,'not_required');
 const observed={...input,context:{...input.context,evidence:[{id:'m',name:'调查报告',text:'实际调查结果显示读者反馈存在检索困难。'}]}};
 const observedRow={...row,evidence:[{sourceId:'m',quote:observed.context.evidence[0].text}]};assert.equal(parseSupplementCheck(response([observedRow]),observed)[0].status,'sufficient');
 const shortQuote={...row,evidence:[{sourceId:'m',quote:'检索引导和移动端界面'}]};assert.equal(parseSupplementCheck(response([shortQuote]),input)[0].status,'missing','generic excerpt does not discard immediate plan/simulation context');
 for(const text of ['尚无证据证明存在检索引导不清的问题。','不能证明存在检索引导不清的问题。','不存在检索引导不清的问题。']){const safe={...input,context:{...input.context,chapters:[{...input.context.chapters[0],text}]}};assert.equal(parseSupplementCheck(response([{...noEvidence,manuscriptQuote:text}]),safe)[0].status,'not_required');}
 const mixed={...input,context:{...input.context,evidence:[{id:'m',name:'调查材料',text:'研究者拟定后续改进方案。十名读者反馈检索步骤不清晰。模拟检索作为补充演示。'}]}};
 const realQuote={...row,evidence:[{sourceId:'m',quote:'十名读者反馈检索步骤不清晰'}]};assert.equal(parseSupplementCheck(response([realQuote]),mixed)[0].status,'sufficient','explicit observed feedback is not rejected just because a plan occurs nearby');
});

test('unsupported asserted problem stops the final readiness gate even if the model marks it not required',async()=>{
 const snapshot={materials:[{id:'m',name:'模拟材料',confirmed:true,text:'拟改善检索引导，演示人员完成三次模拟检索。'}],references:[]};
 const chapters=[{id:'c1',title:'研究背景',text:'高校图书馆数字阅读服务存在检索引导不清与移动界面体验不佳的问题。'}];
 const result=await runSupplementCheck({snapshot,chapters,kind:'proposal',dispatch:async({task})=>response(task.context.chapters.map(chapter=>({id:chapter.id,status:'not_required',requirement:'研究背景',reason:'无需补充。',manuscriptQuote:chapter.text,evidence:[],missing:[]})))});
 assert.equal(result.coverage.complete,true);assert.equal(result.status,'needs_materials');assert.equal(result.items[0].status,'missing');assert.ok(chapters[0].text.includes(result.items[0].manuscriptQuote));
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
function fixture(t,{kind='proposal',thesis=false,checkError=null,continuous=false}={}){
 const db=database(':memory:'),user={id:'owner'},at=new Date().toISOString();db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user.id,'合成验收','user',at);let missing=false;const calls=[];
 const config={supplementCheckEnabled:true,writingQualityEnabled:true,writingContinuousEnabled:continuous,thesisContinuousEnabled:true,writingPollMs:60000,thesisPollMs:60000,getAgentSettings:()=>({...runtime}),citationVerifier:{verify:async()=>({items:[],summary:{},limitations:[]})},agentTaskRunner:async args=>{calls.push(args);const {task}=args;if(task.context.operation==='supplement-check'){if(checkError){const error=typeof checkError==='function'?checkError(task):checkError;if(error)throw error;}return checkResponse(task,{missing});}if(task.skill==='writing-review')return{text:JSON.stringify({complete:true,findings:[],limitations:[]}),usage:{input:50,output:50},costUsd:.001};if(thesis&&task.context.unit.frontMatter){const english=task.context.unit.frontMatter==='abstract_en',text=english?'English title: A Synthetic Evidence Test\n'+('This synthetic study describes the supplied methods and evidence with clearly stated limitations. '.repeat(17))+'\nKey words: feedback; study; evidence':'研究方法和材料以用户实际提供的记录为依据，并说明证据范围。'.repeat(14)+'\n关键词：课堂反馈；研究；证据';return{text:JSON.stringify({text,source_ids:[],missing_evidence:[],complete:true,figures:[],draft:false}),usage:{input:100,output:300},costUsd:.001};}return{text:JSON.stringify({text:'研'.repeat(task.context.unit.targetWords)+'[source:record]',source_ids:['record'],missing_evidence:[],complete:true}),trace:[{tool:'read_material',status:'completed',materialId:'record'}],usage:{input:100,output:200},costUsd:.001};}};
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
test('missing thesis evidence permits supported draft completion, preserves prior versions and still blocks final delivery',async t=>{
 const f=fixture(t,{thesis:true}),snap=snapshot();snap.profile.targetWords=500;snap.outline=[{id:'c',title:'第一章 研究结果',targetWords:500}];let item=(await f.request('/api/theses',{clientKey:randomUUID(),snapshot:snap})).item;
 for(const chapter of item.chapters)item=(await f.request('/api/theses/'+item.id+'/chapters/'+chapter.id,{version:item.version,text:chapter.id==='c'?'已有正文【待补充：实际观察记录】':'作者已保存的合成内容。'})).item;
 const original=item.chapters.map(row=>({id:row.id,text:row.text,version:row.version}));f.setMissing(true);const quote=await f.request('/api/theses/'+item.id+'/quote',{version:item.version,action:'generate',completion:true});await f.request('/api/theses/'+item.id+'/generate',{version:item.version,completion:true,clientKey:randomUUID(),consent:true,billingToken:quote.token});await f.worker.tick();const done=f.get(item.id);
 assert.equal(done.job.status,'completed',done.job.error);assert.equal(done.job.completedSections,done.job.totalSections);assert.ok(f.calls.some(call=>call.task.skill==='thesis-section'),'missing facts must not stop all supported writing');assert.equal(done.quality.supplementCheck.status,'needs_materials');assert.equal(done.quality.supplementCheck.phase,'final');assert.equal(supplementCheckReady(done.quality),false);assert.ok(done.fullText.trim());
 for(const old of original)assert.equal(f.db.prepare('SELECT text FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=? AND version=?').get(item.id,old.id,old.version).text,old.text);
 assert.equal(f.billing.balance('owner').balance,190);assert.equal(f.billing.balance('owner').held,0);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);assert.ok(f.db.prepare("SELECT count(*) n FROM thesis_execution_dispatches WHERE kind='review'").get().n>0);
});
test('a thesis with sufficient supplements passes preflight, rewrites, rechecks all chapters and invalidates the report after a manual change',async t=>{
 const f=fixture(t,{thesis:true}),snap=snapshot();snap.profile.targetWords=500;snap.outline=[{id:'c',title:'第一章 研究结果',targetWords:500}];let item=(await f.request('/api/theses',{clientKey:randomUUID(),snapshot:snap})).item;
 for(const chapter of item.chapters)item=(await f.request('/api/theses/'+item.id+'/chapters/'+chapter.id,{version:item.version,text:chapter.id==='c'?'已有正文【待补充：实际观察记录】':'作者已保存的合成内容。'})).item;
 const quote=await f.request('/api/theses/'+item.id+'/quote',{version:item.version,action:'generate',completion:true});await f.request('/api/theses/'+item.id+'/generate',{version:item.version,completion:true,clientKey:randomUUID(),consent:true,billingToken:quote.token});await f.worker.tick();let done=f.get(item.id);assert.equal(done.job.status,'completed',done.job.error);assert.equal(done.quality.supplementCheck.status,'final_ready');assert.equal(supplementCheckReady(done.quality),true);assert.equal(f.billing.balance('owner').balance,190);
 done=(await f.request('/api/theses/'+done.id+'/chapters/c',{version:done.version,text:done.chapters.find(row=>row.id==='c').text+'作者新增未检查内容。'})).item;assert.equal(done.quality.stale,true);assert.equal(supplementCheckReady(done.quality),false);
});
test('resuming a zero-progress legacy completion without scope keeps its plan and baseline but no longer blocks draft writing on missing facts',async t=>{
 const f=fixture(t,{thesis:true}),snap=snapshot();snap.profile.targetWords=500;snap.outline=[{id:'c',title:'第一章 研究结果',targetWords:500}];let item=(await f.request('/api/theses',{clientKey:randomUUID(),snapshot:snap})).item;
 for(const chapter of item.chapters)item=(await f.request('/api/theses/'+item.id+'/chapters/'+chapter.id,{version:item.version,text:chapter.id==='c'?'已有初稿【待补充：实际观察记录】':'作者已保存的合成内容。'})).item;
 const q=await f.request('/api/theses/'+item.id+'/quote',{version:item.version,action:'generate',completion:true});item=(await f.request('/api/theses/'+item.id+'/generate',{version:item.version,completion:true,clientKey:randomUUID(),consent:true,billingToken:q.token})).item;
 const run=f.db.prepare('SELECT * FROM thesis_runs WHERE id=?').get(item.job.id),meta=JSON.parse(run.settings_meta);delete meta.completion.scope;
 f.db.prepare("UPDATE thesis_runs SET settings_meta=?,status='needs_materials',stage='needs_materials',error='补充资料仍有缺项' WHERE id=?").run(JSON.stringify(meta),run.id);
 f.db.prepare("UPDATE jobs SET status='needs_materials',stage='needs_materials' WHERE id=?").run(run.id);f.db.prepare("UPDATE theses SET status='needs_materials' WHERE id=?").run(item.id);f.billing.release(run.id);f.setMissing(true);
 const preflight=await runSupplementCheck({snapshot:item.snapshot,chapters:item.chapters,runtime,phase:'materials',dispatch:async({task})=>checkResponse(task,{missing:true})});
 f.db.prepare('UPDATE thesis_runs SET quality=? WHERE id=?').run(JSON.stringify({status:'partial',supplementCheck:preflight,manuscriptHash:'0'.repeat(64)}),run.id);
 const prior=f.db.prepare('SELECT count(*) n FROM thesis_chapter_versions WHERE thesis_id=?').get(item.id).n;item=f.get(item.id);assert.equal(item.job.completedSections,0);assert.equal(item.job.canResume,true);assert.equal(f.billing.balance('owner').balance,200);
 assert.equal(item.quality.stale,false,'preflight freshness binds to the saved baseline, not old placeholder anchors');assert.equal(supplementCheckReady(item.quality),false,'a current material preflight is still not a final-delivery approval');
 const resume=await f.request('/api/theses/'+item.id+'/quote',{version:item.version,action:'resume'});await f.request('/api/theses/'+item.id+'/resume',{version:item.version,clientKey:randomUUID(),consent:true,billingToken:resume.token});await f.worker.tick();const done=f.get(item.id),finished=f.db.prepare('SELECT * FROM thesis_runs WHERE id=?').get(run.id);
 assert.equal(done.job.id,run.id);assert.equal(done.job.status,'completed',done.job.error);assert.equal(done.job.completedSections,done.job.totalSections);assert.equal(finished.plan,run.plan);assert.deepEqual(JSON.parse(finished.settings_meta).completion.baseline,meta.completion.baseline);assert.equal(finished.attempt,2);
 assert.ok(f.db.prepare('SELECT count(*) n FROM thesis_chapter_versions WHERE thesis_id=?').get(item.id).n>prior);assert.equal(done.quality.supplementCheck.status,'needs_materials');assert.equal(supplementCheckReady(done.quality),false);assert.ok(done.fullText.trim());
 assert.equal(f.billing.balance('owner').balance,190);assert.equal(f.billing.balance('owner').held,0);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);
});
test('a manual chapter change makes a legacy material preflight stale and still prevents resuming over the edit',async t=>{
 const f=fixture(t,{thesis:true}),snap=snapshot();snap.profile.targetWords=500;snap.outline=[{id:'c',title:'研究结果',targetWords:500}];let item=(await f.request('/api/theses',{clientKey:randomUUID(),snapshot:snap})).item;
 for(const chapter of item.chapters)item=(await f.request('/api/theses/'+item.id+'/chapters/'+chapter.id,{version:item.version,text:'原有初稿【待补充：实际记录】'})).item;
 const quote=await f.request('/api/theses/'+item.id+'/quote',{version:item.version,action:'generate',completion:true});item=(await f.request('/api/theses/'+item.id+'/generate',{version:item.version,completion:true,clientKey:randomUUID(),consent:true,billingToken:quote.token})).item;
 const report=await runSupplementCheck({snapshot:item.snapshot,chapters:item.chapters,runtime,phase:'materials',dispatch:async({task})=>checkResponse(task,{missing:true})});
 f.db.prepare("UPDATE thesis_runs SET status='needs_materials',quality=? WHERE id=?").run(JSON.stringify({status:'partial',supplementCheck:report,manuscriptHash:'0'.repeat(64)}),item.job.id);f.db.prepare("UPDATE jobs SET status='needs_materials' WHERE id=?").run(item.job.id);f.db.prepare("UPDATE theses SET status='needs_materials' WHERE id=?").run(item.id);f.billing.release(item.job.id);
 item=f.get(item.id);assert.equal(item.quality.stale,false);item=(await f.request('/api/theses/'+item.id+'/chapters/c',{version:item.version,text:'作者在暂停后确认的新初稿内容。'})).item;assert.equal(item.quality.stale,true);assert.equal(supplementCheckReady(item.quality),false);
 await assert.rejects(f.request('/api/theses/'+item.id+'/quote',{version:item.version,action:'resume'}),error=>error.status===409);assert.equal(f.get(item.id).chapters.find(row=>row.id==='c').text,'作者在暂停后确认的新初稿内容。');assert.equal(f.billing.balance('owner').balance,200);
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


test('an unavailable optional thesis preflight does not block draft writing and never unlocks a final document',async t=>{
 const error=Object.assign(Error('synthetic bounded checker failure'),{code:'turn_limit',usage:{input:100,output:50},costUsd:.001}),f=fixture(t,{thesis:true,checkError:error}),snap=snapshot();snap.profile.targetWords=500;snap.outline[0].targetWords=500;let item=(await f.request('/api/theses',{clientKey:randomUUID(),snapshot:snap})).item;
 for(const chapter of item.chapters)item=(await f.request('/api/theses/'+item.id+'/chapters/'+chapter.id,{version:item.version,text:'已保存的合成说明。'})).item;
 const original=item.chapters.map(({id,text,version})=>({id,text,version})),quote=await f.request('/api/theses/'+item.id+'/quote',{version:item.version,action:'generate',completion:true});await f.request('/api/theses/'+item.id+'/generate',{version:item.version,completion:true,clientKey:randomUUID(),consent:true,billingToken:quote.token});await f.worker.tick();const done=f.get(item.id);
 assert.equal(done.job.status,'completed',done.job.error);assert.equal(done.job.completedSections,done.job.totalSections);assert.equal(done.quality.supplementCheck.status,'unavailable');assert.match(done.quality.supplementCheck.reason,/不能据此判定材料缺失/);assert.equal(supplementCheckReady(done.quality),false);assert.ok(f.calls.some(call=>call.task.skill==='thesis-section'));
 for(const old of original)assert.equal(f.db.prepare('SELECT text FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=? AND version=?').get(item.id,old.id,old.version).text,old.text);
 assert.equal(f.billing.balance('owner').balance,190);assert.equal(f.billing.balance('owner').held,0);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);
});


test('real observed elided manuscript quotations resolve to a continuous original span without relaxing source evidence',()=>{
 const text='本节只分析明确披露的计算机模拟。采用固定随机种子42、样本数100、线性关系加噪声，噪声标准差0.05。结果不能代表实测性能，应结合线性假设与噪声范围解释。',input=supplementCheckTask({chapters:[{id:'check',title:'仿真研究',text}],materials:[material]}),value=JSON.parse(checkResponse(input).text);
 value.items[0].manuscriptQuote='采用固定随机种子42、样本数100、线性关系加噪声，噪声标准差0.05。应结合线性假设与噪声范围解释';const parsed=parseSupplementCheck(response(value.items),input)[0];assert.equal(parsed.locationNormalized,true);assert.ok(text.includes(parsed.manuscriptQuote));assert.match(parsed.manuscriptQuote,/结果不能代表实测性能/);
 for(const quote of ['采用固定随机种子42，凭空编造的实验结论','应结合线性假设与噪声范围解释。采用固定随机种子42']){value.items[0].manuscriptQuote=quote;assert.throws(()=>parseSupplementCheck(response(value.items),input));}
 value.items[0].manuscriptQuote=text;value.items[0].evidence[0].quote='合成验收资料，记录原始数据';assert.throws(()=>parseSupplementCheck(response(value.items),input),'source evidence must still be an exact contiguous original quote');
});

test('thesis completion recovers an audit timeout by splitting its batch while retaining completed checks',async()=>{
 const chapters=Array.from({length:6},(_,i)=>({id:'chapter-'+i,title:'章节'+i,text:'本节核对已提供的合成记录。'})),calls=[];
 const report=await runSupplementCheck({snapshot:snapshot(),chapters,kind:'thesis',phase:'materials',recover:true,runtime:{...runtime,timeoutMs:300000},dispatch:async request=>{
  calls.push(request);assert.equal(request.settings.timeoutMs,180000);assert.ok(request.task.context.chapters.length<=4);
  if(calls.length===1)throw Object.assign(Error('Synthetic timeout'),{status:504,code:'timeout'});
  return checkResponse(request.task);
 }});
 assert.equal(report.status,'materials_ready');assert.equal(report.coverage.checked,6);assert.equal(new Set(report.items.map(row=>row.id)).size,6);assert.equal(report.recovery.automaticRetries,1);assert.ok(calls[1].task.context.chapters.length<calls[0].task.context.chapters.length);assert.equal(new Set(calls.map(row=>row.unitId)).size,calls.length);
});
test('audit recovery is bounded, never retries missing facts, denied access or cancellation, and never marks an unfinished check ready',async()=>{
 const chapters=[{id:'c',title:'研究',text:'需要核查的合成说明。'}];let calls=0;
 const failed=await runSupplementCheck({snapshot:snapshot(),chapters,recover:true,runtime,dispatch:async()=>{calls++;throw Object.assign(Error('Persistent timeout'),{status:504,code:'timeout'});}});assert.equal(calls,3);assert.equal(failed.status,'unavailable');assert.equal(failed.coverage.checked,0);
 for(const error of [{status:403,code:'timeout'},{status:429,code:'cost_budget'},{status:502,code:'turn_limit',agentTrace:[{status:'denied',tool:'Bash'}]}]){calls=0;await runSupplementCheck({snapshot:snapshot(),chapters,recover:true,runtime,dispatch:async()=>{calls++;throw error;}});assert.equal(calls,1);}
 calls=0;const missing=await runSupplementCheck({snapshot:snapshot(),chapters,recover:true,runtime,dispatch:async({task})=>{calls++;return checkResponse(task,{missing:true});}});assert.equal(calls,1);assert.equal(missing.status,'needs_materials');
});

test('continuous writing automatically recovers a transient supplement check without an extra purchase',async t=>{
 let failures=0;
 const f=fixture(t,{continuous:true,checkError:()=>failures++===0?Object.assign(Error('temporary timeout'),{status:504,code:'timeout',usage:{input:10,output:10},costUsd:.001}):null});
 const item=await f.submit();await f.worker.tick();const done=f.get(item.id);
 assert.equal(done.status,'completed',done.error);
 assert.equal(done.output.quality.supplementCheck.status,'final_ready');
 assert.equal(done.output.quality.supplementCheck.recovery.automaticRetries,1);
 assert.equal(f.calls.filter(call=>call.task.context.operation==='supplement-check').length,2);
 assert.equal(f.billing.balance('owner').balance,190);assert.equal(f.billing.balance('owner').held,0);
});

test('continuous completion recovers a transient materials preflight before rewriting and settles once',async t=>{
 let failures=0;
 const f=fixture(t,{continuous:true,checkError:()=>failures++===0?Object.assign(Error('temporary timeout'),{status:504,code:'timeout',usage:{input:10,output:10},costUsd:.001}):null});
 const text='用户实际写下的待核对正文。'.repeat(18),item=await f.submit(snapshot(),{text});await f.worker.tick();const done=f.get(item.id);
 assert.equal(done.status,'completed',done.error);
 assert.equal(done.output.quality.supplementCheck.status,'final_ready');
 assert.ok(f.calls.filter(call=>call.task.context.operation==='supplement-check').length>=3);
 assert.equal(f.billing.balance('owner').balance,190);assert.equal(f.billing.balance('owner').held,0);
 assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);
});
