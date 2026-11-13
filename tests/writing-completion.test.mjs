import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createWritingService} from '../backend/writing-service.mjs';
import {startWritingWorker} from '../backend/writing-worker.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {normalizeWritingSnapshot,writingTask,validateWritingCandidate,writingLengthFeedback,writingSourceFeedback} from '../backend/writing-model.mjs';
import {prepareWritingCompletion,writingCompletionTask} from '../backend/writing-completion.mjs';
const runtime={enabled:true,engine:'claude-agent-sdk',baseURL:'https://fixture.invalid',model:'fixture',apiKey:'fixture-private',version:'completion-v1',maxTurns:6,maxOutputTokens:4096,maxCostUsd:.1,timeoutMs:30000};
const snapshot=()=>({title:'合成材料补充验收',profile:{level:'本科',language:'中文',targetWords:1000},materials:[],references:[],outline:[{id:'a',title:'研究范围',targetWords:500},{id:'b',title:'研究讨论',targetWords:500}]});
function fixture(t,{kind='proposal'}={}){const db=database(':memory:'),at=new Date().toISOString(),user={id:'alice'};for(const id of ['alice','bob'])db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(id,id,'user',at);const calls=[];let runner=async({task})=>{const id=task.materials[0]?.id;return{text:JSON.stringify({complete:true,text:(task.context.revisionOriginal?'改':'原').repeat(task.context.unit.targetWords)+(id?'[source:'+id+']':''),source_ids:id?[id]:[],missing_evidence:[]}),trace:id?[{tool:'read_material',status:'completed',materialId:id}]:[],usage:{input:100,output:600},costUsd:.001};};const config={getAgentSettings:()=>({...runtime}),writingPollMs:60000,agentTaskRunner:async args=>{calls.push(args);return runner(args);}},billing=createBillingService(db,config);config.billing=billing;billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});const order=randomUUID();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order,'alice','credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,'alice','credits-200',200,'purchase',at);const service=createWritingService(db,config),worker=startWritingWorker(db,config);t.after(async()=>{await worker.stop();db.close();});const request=async(path,data,owner=user)=>{try{return await service.handle({path:'/api/writing'+path,method:data===undefined?'GET':'POST',user:owner,readBody:async()=>data});}catch(error){return{status:error.status||500,value:{error:error.message}};}};const quote=(snap=snapshot(),completion)=>request('/quote',{kind,operation:'draft',snapshot:snap,...(completion?{completion}:{})});const submit=async(snap=snapshot(),completion,extra={})=>{const q=await quote(snap,completion);assert.equal(q.status,200,JSON.stringify(q));const response=await request('/jobs',{kind,operation:'draft',snapshot:snap,...(completion?{completion}:{}),clientKey:randomUUID(),billingToken:q.value.token,consent:true,...extra});assert.equal(response.status,202,JSON.stringify(response));return response.value.item;};return{db,user,billing,worker,calls,request,quote,submit,setRunner:value=>{runner=value;},get:id=>service.get(id,user)};}
const supplement=()=>({...snapshot(),materials:[{id:'new-evidence',name:'补充研究资料',text:'这里是作者补充的真实范围和实际观察记录，供当前单元读取后完善，不能凭空编造数据。',confirmed:true}]});
function flagSecond(f,id){const row=f.db.prepare('SELECT output FROM writing_runs WHERE id=?').get(id),output=JSON.parse(row.output),second=output.sections[1];output.quality={consistency:{findings:[{sectionId:second.id,quote:second.text.slice(0,20),category:'logic'}]},reviews:[]};f.db.prepare('UPDATE writing_runs SET output=? WHERE id=?').run(JSON.stringify(output),id);}

test('a material completion quotes affected chapters, preserves other checkpoints and settles once',async t=>{const f=fixture(t),base=await f.submit();await f.worker.tick();flagSecond(f,base.id);const before=f.get(base.id),completion={baseJobId:base.id,text:before.output.text},q=await f.quote(supplement(),completion);assert.equal(q.status,200,JSON.stringify(q));assert.deepEqual(q.value.completion.chapterTitles,['研究讨论']);assert.equal(q.value.completion.retainedUnits,1);assert.equal(f.billing.balance('alice').held,0,'reading a quote cannot reserve credits');const key=randomUUID(),body={kind:'proposal',operation:'draft',snapshot:supplement(),completion,clientKey:key,billingToken:q.value.token,consent:true},created=await f.request('/jobs',body);assert.equal(created.status,202,JSON.stringify(created));assert.equal(created.value.item.completedUnits,1);assert.equal(created.value.item.completion,true);await f.worker.tick();const done=f.get(created.value.item.id);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(f.calls.length,3,'only the affected unit dispatches');assert.equal(done.output.sections[0].text,before.output.sections[0].text);assert.match(done.output.sections[1].text,/改/);assert.deepEqual(done.output.sections[1].sourceIds,['new-evidence']);assert.deepEqual(f.get(base.id),before,'the original version is immutable');assert.match(f.calls[2].task.context.revisionOriginal,/原/);assert.equal(f.calls[2].task.context.unit.revisionOriginal,undefined,'original text appears only once in task context');assert.doesNotMatch(JSON.stringify(done),/revisionOriginal|fixture-private/);const replay=await f.request('/jobs',{...body,billingToken:'expired'});assert.equal(replay.value.item.id,done.id);await f.worker.tick();assert.equal(f.calls.length,3);assert.equal(f.billing.balance('alice').balance,180);assert.equal(f.billing.balance('alice').held,0);});

test('completion quotes cannot be swapped with regular generation, another owner, or changed source facts',async t=>{const f=fixture(t),base=await f.submit();await f.worker.tick();const completion={baseJobId:base.id},q=await f.quote(supplement(),completion),body={kind:'proposal',operation:'draft',snapshot:supplement(),clientKey:randomUUID(),consent:true,billingToken:q.value.token};assert.equal((await f.request('/jobs',body)).status,409);assert.equal((await f.request('/quote',{...body,completion},{id:'bob'})).status,400);const foreign=await f.request('/quote',{kind:'proposal',operation:'draft',snapshot:supplement(),completion},{id:'bob'});assert.equal(foreign.status,404);assert.equal((await f.quote({...supplement(),title:'已经变化的题目'},completion)).status,409);for(const change of [{level:'专科'},{major:'变更后的专业'}])assert.equal((await f.quote({...supplement(),profile:{...supplement().profile,...change}},completion)).status,409);assert.equal((await f.request('/jobs',{...body,completion,snapshot:{...supplement(),materials:[{...supplement().materials[0],text:'已修改的资料'}]}})).status,409);assert.equal(f.billing.balance('alice').held,0);});

test('an interrupted draft continues with new materials and does not repeat accepted units',async t=>{const f=fixture(t);let count=0;f.setRunner(async({task})=>{if(++count===2)throw Object.assign(Error('尚缺生成本单元所需的真实资料：实际观察记录'),{code:'needs_materials',usage:{input:30,output:20},costUsd:.001});return{text:JSON.stringify({complete:true,text:'已'.repeat(task.context.unit.targetWords),source_ids:[],missing_evidence:[]}),usage:{input:100,output:600},costUsd:.001};});const first=await f.submit();await f.worker.tick();assert.equal(f.get(first.id).status,'failed');assert.equal(f.get(first.id).completedUnits,1);assert.equal(f.billing.balance('alice').balance,200);f.setRunner(async({task})=>({text:JSON.stringify({complete:true,text:'续'.repeat(task.context.unit.targetWords)+'[source:new-evidence]',source_ids:['new-evidence'],missing_evidence:[]}),trace:[{tool:'read_material',status:'completed',materialId:'new-evidence'}],usage:{input:100,output:600},costUsd:.001}));const next=await f.submit(supplement(),{baseJobId:first.id});await f.worker.tick();const done=f.get(next.id);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(done.output.sections[0].text,'已'.repeat(500));assert.equal(f.calls.length,3);assert.equal(f.billing.balance('alice').balance,190);});

test('updated confirmed materials are prioritised and sections that used them are revised',async t=>{
 const f=fixture(t),initial={...snapshot(),materials:[{id:'study-plan',name:'研究计划',text:'计划邀请十位参与者进行观察。',confirmed:true}]};
 const base=await f.submit(initial);await f.worker.tick();flagSecond(f,base.id);
 const revised={...initial,materials:[{...initial.materials[0],text:'计划邀请十二位参与者进行观察，计划于第六周整理。'}]};
 const prepared=prepareWritingCompletion(f.db,f.user,{kind:'proposal',operation:'draft',snapshot:normalizeWritingSnapshot(revised),projectId:null},{baseJobId:base.id});
 assert.equal(prepared.retained.length,0,'all sections citing the changed source must be revisited');
 assert.ok(prepared.plan.every(unit=>unit.completionSourceIds.includes('study-plan')));
 for(const unit of prepared.plan){const task=writingTask('proposal','draft',normalizeWritingSnapshot(revised),unit);assert.ok(task.materials.some(source=>source.id==='study-plan'&&source.text.includes('十二位')));}
 assert.equal(f.get(base.id).status,'completed','the saved original remains immutable');
});

test('localized completion preserves unrelated facts and source attribution with one settlement',async t=>{
 const f=fixture(t),snap=supplement(),original='第3周保留。需要补充方案。'+'研'.repeat(470)+'[source:new-evidence]';
 f.setRunner(async({task})=>({text:JSON.stringify({complete:true,...(task.context.localRevisionAnchors?{edits:[{index:1,replacement:'计划开展方案。'}]}:{text:original}),source_ids:['new-evidence'],missing_evidence:[]}),trace:[{tool:'read_material',status:'completed',materialId:'new-evidence'}],usage:{input:100,output:600},costUsd:.001}));
 const base=await f.submit(snap);await f.worker.tick();const row=f.db.prepare('SELECT output,plan FROM writing_runs WHERE id=?').get(base.id),output=JSON.parse(row.output),plan=JSON.parse(row.plan);
 output.quality={consistency:{findings:[{sectionId:plan[0].id,quote:'需要补充方案。',category:'logic'}]},reviews:[]};f.db.prepare('UPDATE writing_runs SET output=? WHERE id=?').run(JSON.stringify(output),base.id);
 const prepared=prepareWritingCompletion(f.db,f.user,{kind:'proposal',operation:'draft',snapshot:normalizeWritingSnapshot(snap),projectId:null},{baseJobId:base.id});assert.equal(prepared.plan[0].localRevisionQuotes?.[0].quote,'需要补充方案。');assert.equal(prepared.plan[1].retained,true);
 const next=await f.submit(snap,{baseJobId:base.id});await f.worker.tick();const done=f.get(next.id);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(done.output.sections[0].text,original.replace('需要补充方案。','计划开展方案。'));assert.deepEqual(done.output.sections[0].sourceIds,['new-evidence']);assert.equal(done.output.sections[1].text,original);assert.equal(f.billing.balance('alice').balance,180);assert.equal(f.billing.balance('alice').held,0);
});

test('localized completion fails safely if the candidate changes an unrelated confirmed condition',async t=>{
 const f=fixture(t),snap=supplement(),original='第3周保留。需要补充方案。'+'研'.repeat(470)+'\n[source:new-evidence]';
 f.setRunner(async({task})=>({text:JSON.stringify({complete:true,text:task.context.revisionOriginal?task.context.revisionOriginal.replace('第3周','第4周').replace('需要补充方案。','计划开展方案。'):original,source_ids:['new-evidence'],missing_evidence:[]}),trace:[{tool:'read_material',status:'completed',materialId:'new-evidence'}],usage:{input:100,output:600},costUsd:.001}));
 const base=await f.submit(snap);await f.worker.tick();const row=f.db.prepare('SELECT output,plan FROM writing_runs WHERE id=?').get(base.id),output=JSON.parse(row.output),plan=JSON.parse(row.plan);output.quality={consistency:{findings:[{sectionId:plan[0].id,quote:'需要补充方案。'}]},reviews:[]};f.db.prepare('UPDATE writing_runs SET output=? WHERE id=?').run(JSON.stringify(output),base.id);
 const next=await f.submit(snap,{baseJobId:base.id});await f.worker.tick();const failed=f.get(next.id);assert.equal(failed.status,'failed',JSON.stringify(failed));assert.equal(f.get(base.id).output.sections[0].text,original);assert.equal(f.billing.balance('alice').balance,190);assert.equal(f.billing.balance('alice').held,0);
});

test('localized completion still refuses unread or forged sources and releases its reservation',async t=>{
 const f=fixture(t),snap=supplement(),original='计划条件不变。需要补充方案。'+'研'.repeat(470)+'[source:new-evidence]';
 f.setRunner(async({task})=>({text:JSON.stringify({complete:true,...(task.context.localRevisionAnchors?{edits:[{index:1,replacement:'计划开展方案。'}]}:{text:original}),source_ids:['new-evidence'],missing_evidence:[]}),trace:task.context.revisionOriginal?[]:[{tool:'read_material',status:'completed',materialId:'new-evidence'}],usage:{input:100,output:600},costUsd:.001}));
 const base=await f.submit(snap);await f.worker.tick();const row=f.db.prepare('SELECT output,plan FROM writing_runs WHERE id=?').get(base.id),output=JSON.parse(row.output),plan=JSON.parse(row.plan);output.quality={consistency:{findings:[{sectionId:plan[0].id,quote:'需要补充方案。'}]},reviews:[]};f.db.prepare('UPDATE writing_runs SET output=? WHERE id=?').run(JSON.stringify(output),base.id);
 const next=await f.submit(snap,{baseJobId:base.id});await f.worker.tick();assert.equal(f.get(next.id).status,'failed');assert.equal(f.get(base.id).output.sections[0].text,original);assert.equal(f.billing.balance('alice').balance,190);assert.equal(f.billing.balance('alice').held,0);
});

test('local patch reports real missing evidence and releases the reservation',async t=>{
 const f=fixture(t),snap=supplement(),original='计划条件不变。需要补充方案。'+'研'.repeat(470)+'[source:new-evidence]';
 f.setRunner(async({task})=>({text:JSON.stringify(task.context.localRevisionAnchors?{complete:false,missing_evidence:['补充真实研究计划']}:{complete:true,text:original,source_ids:['new-evidence'],missing_evidence:[]}),trace:[{tool:'read_material',status:'completed',materialId:'new-evidence'}],usage:{input:100,output:600},costUsd:.001}));
 const base=await f.submit(snap);await f.worker.tick();const row=f.db.prepare('SELECT output,plan FROM writing_runs WHERE id=?').get(base.id),output=JSON.parse(row.output),plan=JSON.parse(row.plan);output.quality={consistency:{findings:[{sectionId:plan[0].id,quote:'需要补充方案。'}]},reviews:[]};f.db.prepare('UPDATE writing_runs SET output=? WHERE id=?').run(JSON.stringify(output),base.id);
 const next=await f.submit(snap,{baseJobId:base.id});await f.worker.tick();const failed=f.get(next.id);assert.equal(failed.status,'failed');assert.match(failed.error,/补充真实研究计划/);assert.equal(f.db.prepare('SELECT code FROM writing_diagnostics WHERE run_id=?').get(next.id).code,'needs_materials');assert.equal(f.get(base.id).output.sections[0].text,original);assert.equal(f.billing.balance('alice').balance,190);assert.equal(f.billing.balance('alice').held,0);
});
test('a patch introducing duplicate punctuation is rejected without charging or replacing the original',async t=>{
 const f=fixture(t),snap=supplement(),original='计划条件不变。需要补充方案。'+'研'.repeat(470)+'[source:new-evidence]';
 f.setRunner(async({task})=>({text:JSON.stringify({complete:true,...(task.context.localRevisionAnchors?{edits:[{index:1,replacement:'计划开展。。'}]}:{text:original}),source_ids:['new-evidence'],missing_evidence:[]}),trace:[{tool:'read_material',status:'completed',materialId:'new-evidence'}],usage:{input:100,output:600},costUsd:.001}));
 const base=await f.submit(snap);await f.worker.tick();const row=f.db.prepare('SELECT output,plan FROM writing_runs WHERE id=?').get(base.id),output=JSON.parse(row.output),plan=JSON.parse(row.plan);output.quality={consistency:{findings:[{sectionId:plan[0].id,quote:'需要补充方案。'}]},reviews:[]};f.db.prepare('UPDATE writing_runs SET output=? WHERE id=?').run(JSON.stringify(output),base.id);
 const next=await f.submit(snap,{baseJobId:base.id});await f.worker.tick();assert.equal(f.get(next.id).status,'failed');assert.equal(f.get(base.id).output.sections[0].text,original);assert.equal(f.billing.balance('alice').balance,190);assert.equal(f.billing.balance('alice').held,0);
});

test('patch validator measures the merged original, checks reads, and keeps the legacy contract',()=>{
 const snap=normalizeWritingSnapshot(supplement()),original='原条件。待补说明。'+'研'.repeat(490)+'[source:new-evidence]',unit={id:'a',title:'研究范围',targetWords:500,completion:true,completionSourceIds:[],revisionOriginal:original,localRevisionQuotes:[{quote:'待补说明。'}],localRevisionMode:'patch-v1'};
 const candidate={text:JSON.stringify({complete:true,edits:[{index:1,replacement:'计划说明。'}],source_ids:['new-evidence'],missing_evidence:[]}),trace:[{tool:'read_material',status:'completed',materialId:'new-evidence'}]};
 assert.equal(validateWritingCandidate(candidate,'proposal','draft',snap,unit).valid,true);
 assert.equal(writingLengthFeedback(candidate,snap,unit,'proposal').withinRange,true);
 assert.deepEqual(writingSourceFeedback(candidate,'proposal',snap,unit).unlistedMarkerIds,[]);
 assert.equal(validateWritingCandidate({...candidate,trace:[]},'proposal','draft',snap,unit).valid,false);
 const legacy={...unit};delete legacy.localRevisionMode;
 assert.equal(validateWritingCandidate({text:JSON.stringify({complete:true,text:original.replace('待补说明。','计划说明。'),source_ids:['new-evidence'],missing_evidence:[]}),trace:candidate.trace},'proposal','draft',snap,legacy).valid,true);
});

test('the full current author edit is preserved as revision context instead of using stale generated prose',async t=>{const f=fixture(t),base=await f.submit();await f.worker.tick();const text='作者当前修改。'.repeat(250)+'最后一句需要保留。',value=prepareWritingCompletion(f.db,f.user,{kind:'proposal',operation:'draft',snapshot:normalizeWritingSnapshot(supplement()),projectId:null},{baseJobId:base.id,text});assert.equal(value.retained.length,0);assert.equal(value.plan.map(unit=>unit.revisionOriginal).join(''),text);assert.ok(value.plan.every(unit=>unit.completion));const task=writingCompletionTask({instructions:'原契约。',context:{unit:value.plan[0]}},value.plan[0]);assert.match(task.instructions,/不能当作证据/);assert.equal(task.context.unit.revisionOriginal,undefined);});

test('both imported and edited drafts preserve complete Unicode characters in every independently processed fragment',async t=>{
 const f=fixture(t),base=await f.submit();await f.worker.tick();
 // The equal-weight midpoint falls between the high and low surrogates.
 const text='甲'.repeat(499)+'🐑'+'乙'.repeat(499),normalized=normalizeWritingSnapshot(supplement());
 for(const completion of [{text},{baseJobId:base.id,text}]){
  const value=prepareWritingCompletion(f.db,f.user,{kind:'proposal',operation:'draft',snapshot:normalized,projectId:null},completion);
  const fragments=value.plan.map(unit=>unit.revisionOriginal);
  assert.equal(fragments.join(''),text);
  assert.ok(fragments.every(fragment=>fragment.isWellFormed()),JSON.stringify(fragments));
 }
});

test('a failed completion releases its fee and keeps the previous manuscript untouched',async t=>{const f=fixture(t),base=await f.submit();await f.worker.tick();const before=f.get(base.id);f.setRunner(async()=>{throw Object.assign(Error('模拟连接故障'),{usage:{input:20,output:10},costUsd:.001});});const next=await f.submit(supplement(),{baseJobId:base.id});await f.worker.tick();assert.equal(f.get(next.id).status,'failed');assert.deepEqual(f.get(base.id),before);assert.equal(f.billing.balance('alice').balance,190);assert.equal(f.billing.balance('alice').held,0);});

test('unchanged completion does not settle even when supplementary checking is disabled',async t=>{
 const f=fixture(t),base=await f.submit();await f.worker.tick();const before=f.get(base.id);
 f.setRunner(async({task})=>({text:JSON.stringify({complete:true,text:task.context.revisionOriginal,source_ids:[],missing_evidence:[]}),usage:{input:20,output:10},costUsd:.001}));
 const next=await f.submit(snapshot(),{baseJobId:base.id});await f.worker.tick();assert.equal(f.get(next.id).status,'failed');assert.match(f.get(next.id).error,/本次不扣费/);assert.deepEqual(f.get(base.id),before);assert.equal(f.billing.balance('alice').balance,190);assert.equal(f.billing.balance('alice').held,0);
});

test('failed local completion records only an approved validation category and never private text',async t=>{
 const f=fixture(t),base=await f.submit();await f.worker.tick();
 f.setRunner(async()=>{const error=Object.assign(Error('执行超时'),{code:'turn_limit',usage:{input:20,output:10},costUsd:.001});Object.defineProperty(error,'lastValidation',{value:{code:'local_revision_scope',rule:'PRIVATE-SYNTHETIC-MANUSCRIPT'}});Object.defineProperty(error,'agentTrace',{value:[{tool:'submit_writing_output',status:'completed',validation:{code:'local_revision_scope',private:'PRIVATE-SYNTHETIC-MANUSCRIPT'}},{tool:'read_material',status:'completed',materialId:'PRIVATE-SOURCE'}]});throw error;});
 const next=await f.submit(supplement(),{baseJobId:base.id});await f.worker.tick();
 const metrics=f.db.prepare('SELECT metrics FROM writing_diagnostics WHERE run_id=?').get(next.id).metrics,parsed=JSON.parse(metrics);assert.equal(parsed.lastValidationCode,'local_revision_scope');assert.deepEqual(parsed.toolActivity,{submissions:1,rejectedSubmissions:1,rejectionCodes:['local_revision_scope'],localPatchReasons:['other']});assert.doesNotMatch(metrics,/PRIVATE-SYNTHETIC-MANUSCRIPT|PRIVATE-SOURCE/);assert.equal(f.billing.balance('alice').held,0);
});


test('article rich content survives real worker checkpoints, settlement and editable Word export',async t=>{
 const {researchWordCount}=await import('../backend/text-length.mjs'),{createWritingDocx,inspectThesisExportContent}=await import('../src/writing-document.js'),{default:JSZip}=await import('jszip'),{pngFixture}=await import('./fixtures/research-image.mjs');
 const f=fixture(t,{kind:'article'}),snap=snapshot();snap.requirements={contentMode:'rich'};snap.materials=[{id:'evidence',name:'合成方法说明',text:'这是合成的研究方案说明，只整理拟开展流程与概念，不提供真实实验结果。'.repeat(8),confirmed:true}];snap.outline[0].presentation={table:true,image:true,formula:true,code:true};snap.outline[1].presentation={table:false,image:false,formula:false,code:false};
 f.setRunner(async({task})=>{const graph={id:'flow',title:'拟开展的方法流程',kind:'flowchart',nodes:[{id:'a',label:'整理问题'},{id:'b',label:'拟验证方案'}],edges:[{from:'a',to:'b'}],caption:'尚未开展真实验证。'},extra=task.context.presentation.image?'\n\n| 参数 | 说明 |\n| --- | --- |\n| k | 待确认 |\n\n$$x=y$$\n\n```python\nx=1\n```\n\n[figure:flow]\n':'';return {text:JSON.stringify({complete:true,text:'研'.repeat(task.context.unit.targetWords-researchWordCount(extra))+extra+'[source:evidence]',source_ids:['evidence'],missing_evidence:[],figures:task.context.presentation.image?[graph]:[]}),trace:[{tool:'read_material',status:'completed',materialId:'evidence'}],usage:{input:120,output:650},costUsd:.001};});
 const submitted=await f.submit(snap);await f.worker.tick();const done=f.get(submitted.id);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(done.output.figures.length,1);assert.deepEqual(done.output.sections[0].figures,done.output.figures);assert.equal(f.billing.balance('alice').balance,190);assert.equal(f.billing.balance('alice').held,0);const stored=JSON.parse(f.db.prepare('SELECT body FROM results WHERE job_id=?').get(submitted.id).body);assert.deepEqual(stored.figures,done.output.figures);assert.ok(JSON.parse(f.db.prepare('SELECT output FROM writing_checkpoints WHERE run_id=? ORDER BY position').get(submitted.id).output).figures.length);
 const completion=prepareWritingCompletion(f.db,f.user,{kind:'article',operation:'draft',snapshot:normalizeWritingSnapshot(snap),projectId:null},{baseJobId:submitted.id}),revised=writingCompletionTask(writingTask('article','draft',normalizeWritingSnapshot(snap),completion.plan[0]),completion.plan[0]);assert.deepEqual(revised.context.revisionFigures,stored.figures);
 const figureMarker='[figure:'+stored.figures[0].id+']',editedText='甲'.repeat(495)+figureMarker+'乙'.repeat(493),edited=prepareWritingCompletion(f.db,f.user,{kind:'article',operation:'draft',snapshot:normalizeWritingSnapshot(snap),projectId:null},{baseJobId:submitted.id,text:editedText});
 assert.equal(edited.plan.map(unit=>unit.revisionOriginal).join(''),editedText);const figureUnit=edited.plan.find(unit=>unit.revisionOriginal.includes(figureMarker));assert.ok(figureUnit);assert.ok(figureUnit.revisionFigures,JSON.stringify({figureUnit,storedFigures:stored.figures}));assert.equal(figureUnit.revisionFigures[0].id,stored.figures[0].id);assert.ok(edited.plan.every(unit=>!unit.revisionOriginal.includes('[figure:')||unit.revisionOriginal.includes(figureMarker)));
 const options={documentKind:'writing',metadata:{title:snap.title,chapterTitles:snap.outline.map(row=>row.title),figures:stored.figures},figureRasterizer:async()=>new Uint8Array(pngFixture(800,500))},{presentThesisDocument}=await import('../dist/workspace/thesis-document.mjs'),text=presentThesisDocument({...stored.sourceSnapshot,title:snap.title,outline:[]},[{title:'',text:stored.text,figures:stored.figures,sourceIds:stored.sourceIds}]),bytes=await createWritingDocx(text,options),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');assert.match(xml,/<w:drawing\b/);assert.match(xml,/<w:tbl\b/);assert.match(xml,/<m:oMath/);assert.match(xml,/x=1/);assert.match(xml,/拟开展的方法流程/);assert.doesNotMatch(xml,/\[figure:/);await inspectThesisExportContent(bytes,text,options);
});

test('unsupported background claims are revised without fabricating research evidence',()=>{
 const value=normalizeWritingSnapshot(snapshot());
 const unit={id:'a',title:'研究范围',targetWords:500,completion:true,revisionOriginal:'学生仅靠记公式难以体会。'};
 const task=writingCompletionTask(writingTask('article','draft',value,unit),unit);
 assert.match(task.instructions,/研究背景同样需要证据/);
 assert.match(task.instructions,/研究动机或待验证问题/);
 assert.match(task.instructions,/不得索取虚构证据/);
 assert.match(task.instructions,/实际数据、身份和研究结果/);
 assert.match(task.instructions,/仍须明确列出缺失资料/);
});

test('supplement gaps target their saved section even when a separate review also has findings',async t=>{
 const f=fixture(t),base=await f.submit();await f.worker.tick();
 const row=f.db.prepare('SELECT output,plan FROM writing_runs WHERE id=?').get(base.id),output=JSON.parse(row.output),plan=JSON.parse(row.plan);
 const first=f.db.prepare('SELECT output FROM writing_checkpoints WHERE run_id=? AND unit_id=?').get(base.id,plan[0].id);
 const second=f.db.prepare('SELECT output FROM writing_checkpoints WHERE run_id=? AND unit_id=?').get(base.id,plan[1].id);
 const firstText=JSON.parse(first.output).text,secondText=JSON.parse(second.output).text;
 output.quality={consistency:{findings:[{sectionId:plan[1].id,quote:secondText.slice(0,8)}]},supplementCheck:{items:[{id:'check-0-0',title:plan[0].title,status:'missing',manuscriptQuote:firstText.slice(0,8)}]}};
 f.db.prepare('UPDATE writing_runs SET output=? WHERE id=?').run(JSON.stringify(output),base.id);
 const prepared=prepareWritingCompletion(f.db,f.user,{kind:'proposal',operation:'draft',snapshot:normalizeWritingSnapshot(snapshot()),projectId:null},{baseJobId:base.id});
 assert.equal(prepared.retained.length,0);assert.ok(prepared.plan.every(unit=>unit.revisionOriginal));
});

test('automatic improvement receives only exact, still-current section findings as untrusted review suggestions',async t=>{
 const f=fixture(t),base=await f.submit();await f.worker.tick();
 const row=f.db.prepare('SELECT output,plan FROM writing_runs WHERE id=?').get(base.id),output=JSON.parse(row.output),plan=JSON.parse(row.plan);
 const first=JSON.parse(f.db.prepare('SELECT output FROM writing_checkpoints WHERE run_id=? AND unit_id=?').get(base.id,plan[0].id).output).text;
 const second=JSON.parse(f.db.prepare('SELECT output FROM writing_checkpoints WHERE run_id=? AND unit_id=?').get(base.id,plan[1].id).output).text;
 output.quality={consistency:{findings:[{sectionId:plan[1].id,quote:second.slice(0,12),category:'claim_scope',explanation:'可能超出资料范围',suggestion:'依据原文限定范围'},{sectionId:plan[0].id,quote:'不在原文中的句子',category:'logic',explanation:'不应传递'}]},supplementCheck:{items:[{id:'check-0-0',title:plan[0].title,status:'missing',manuscriptQuote:first.slice(0,12),reason:'依据不足',missing:['提供记录或改写为研究问题']} ]}};
 f.db.prepare('UPDATE writing_runs SET output=? WHERE id=?').run(JSON.stringify(output),base.id);
 const value=prepareWritingCompletion(f.db,f.user,{kind:'proposal',operation:'draft',snapshot:normalizeWritingSnapshot(snapshot()),projectId:null},{baseJobId:base.id});
 assert.ok(value.plan[0].revisionFindings.some(item=>item.category==='missing_evidence'));assert.ok(value.plan[1].revisionFindings.some(item=>item.category==='claim_scope'));assert.ok(value.plan.every(unit=>!JSON.stringify(unit.revisionFindings).includes('不在原文中的句子')));
 const task=writingCompletionTask(writingTask('proposal','draft',normalizeWritingSnapshot(snapshot()),value.plan[1]),value.plan[1]);
 assert.match(task.instructions,/审校建议，不是事实依据，可能有误/);assert.equal(task.context.unit.revisionFindings,undefined);assert.equal(task.context.revisionFindings[0].suggestion,'依据原文限定范围');
 const edited=prepareWritingCompletion(f.db,f.user,{kind:'proposal',operation:'draft',snapshot:normalizeWritingSnapshot(snapshot()),projectId:null},{baseJobId:base.id,text:'作者已重新撰写全部正文。'.repeat(20)});
 assert.ok(edited.plan.every(unit=>!unit.revisionFindings),'findings from an obsolete passage must not be supplied after the author rewrites it');
});

test('interrupted completion retains only bounded, located suggestions for its original owner',async t=>{
 const f=fixture(t),base=await f.submit();await f.worker.tick();const row=f.db.prepare('SELECT plan FROM writing_runs WHERE id=?').get(base.id),plan=JSON.parse(row.plan),first=JSON.parse(f.db.prepare('SELECT output FROM writing_checkpoints WHERE run_id=? AND unit_id=?').get(base.id,plan[0].id).output).text;
 plan[0]={...plan[0],completion:true,revisionOriginal:first,revisionFindings:[{quote:first.slice(0,12),category:'claim_scope',reason:'校对范围',suggestion:'核对材料',privateExtra:'不应进入模型'}, {quote:'这句已不存在',category:'stale',reason:'不应恢复'}]};
 f.db.prepare('UPDATE writing_runs SET plan=? WHERE id=?').run(JSON.stringify(plan),base.id);f.db.prepare('DELETE FROM writing_checkpoints WHERE run_id=? AND unit_id=?').run(base.id,plan[0].id);
 const input={kind:'proposal',operation:'draft',snapshot:normalizeWritingSnapshot(snapshot()),projectId:null};
 const resumed=prepareWritingCompletion(f.db,f.user,input,{baseJobId:base.id});const unit=resumed.plan[0];assert.equal(unit.revisionFindings.length,1);assert.equal(unit.revisionFindings[0].suggestion,'核对材料');assert.equal(unit.revisionFindings[0].privateExtra,undefined);
 const task=writingCompletionTask({instructions:'原契约。',context:{unit}},unit);assert.doesNotMatch(JSON.stringify(task),/不应进入模型|这句已不存在/);assert.match(task.instructions,/审校建议，不是事实依据，可能有误/);
 assert.throws(()=>prepareWritingCompletion(f.db,{id:'bob'},input,{baseJobId:base.id}),error=>error.status===404);
});

test('repeated text in different sections never moves a supplement finding to the wrong section',async t=>{
 const f=fixture(t),base=await f.submit();await f.worker.tick();const saved=f.db.prepare('SELECT output,plan FROM writing_runs WHERE id=?').get(base.id),output=JSON.parse(saved.output),plan=JSON.parse(saved.plan),text=JSON.parse(f.db.prepare('SELECT output FROM writing_checkpoints WHERE run_id=? AND unit_id=?').get(base.id,plan[0].id).output).text,quote=text.slice(0,12);
 output.quality={supplementCheck:{items:[{id:'check-0-0',title:plan[0].title,status:'missing',manuscriptQuote:quote,reason:'第一节缺少依据',missing:['补充相关资料']}]}};f.db.prepare('UPDATE writing_runs SET output=? WHERE id=?').run(JSON.stringify(output),base.id);
 const input={kind:'proposal',operation:'draft',snapshot:normalizeWritingSnapshot(snapshot()),projectId:null},result=prepareWritingCompletion(f.db,f.user,input,{baseJobId:base.id});assert.equal(result.plan[0].revisionFindings[0].reason,'第一节缺少依据');assert.equal(result.plan[1].revisionFindings,undefined);assert.equal(result.plan[1].retained,true);
 output.quality.supplementCheck.items[0].title='';f.db.prepare('UPDATE writing_runs SET output=? WHERE id=?').run(JSON.stringify(output),base.id);const ambiguous=prepareWritingCompletion(f.db,f.user,input,{baseJobId:base.id});assert.ok(ambiguous.plan.every(unit=>!unit.revisionFindings),'a legacy ambiguous quote must not be assigned to either section');
});

test('completion guidance requires explicit future tense on planned pretest itself',()=>{
 const task=writingCompletionTask({instructions:'',context:{}},{completion:true,revisionOriginal:'拟检查问卷措辞。'});assert.match(task.instructions,/访前拟进行模拟预测试以检查措辞/);assert.match(task.instructions,/不得将真实已经完成的预试改成未发生/);
});
