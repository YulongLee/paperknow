import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {createWritingService,writingStorageCheck} from '../backend/writing-service.mjs';
import {startWritingWorker} from '../backend/writing-worker.mjs';
import JSZip from 'jszip';
import {parseCitationImport} from '../dist/workspace/citation-import.mjs';
import {thesisDocumentPresentation} from '../dist/workspace/thesis-document.mjs';
import {createWritingDocx} from '../src/writing-document.js';

const runtime={enabled:true,engine:'claude-agent-sdk',baseURL:'https://synthetic.example.test',model:'synthetic-model',apiKey:'not-a-real-credential',version:'writing-quality-v1',maxTurns:6,maxOutputTokens:4096,maxCostUsd:.1,timeoutMs:30000};
const snapshot=()=>({title:'合成验收：数字阅读服务的拟改进计划',profile:{level:'本科',language:'中文',targetWords:200},materials:[{id:'source',name:'合成授权材料',text:'这是测试用研究材料，仅描述拟开展的数字阅读服务分析，不能用于推断已经实施或证明真实效果。',confirmed:true}],references:[],outline:[{id:'plan',title:'拟开展研究计划',targetWords:200,sections:[]}]});
const draft=task=>({text:JSON.stringify({complete:true,text:'拟'.repeat(task.context.unit.targetWords)+'[source:source]',source_ids:['source'],missing_evidence:[]}),usage:{input:200,output:100},costUsd:.001,trace:[{tool:'read_material',status:'completed',materialId:'source'}],finishReason:'end_turn'});
const review=task=>({text:JSON.stringify({complete:true,findings:[{sectionId:task.context.manuscriptExcerpts[0].id,quote:task.context.manuscriptExcerpts[0].text.slice(0,8),category:'structure',severity:'info',explanation:'合成正文用于验证检查项定位。',suggestion:'正式写作时请核对论证层次。'}],limitations:['仅用于合成流程验收，不判断研究事实。']}),usage:{input:80,output:20},costUsd:.002,trace:[],finishReason:'end_turn'});
function largeReview(task){const value=review(task),body=JSON.parse(value.text);body.findings=Array.from({length:12},(_,index)=>({...body.findings[0],quote:task.context.manuscriptExcerpts[0].text.slice(0,8+index),explanation:'论证'.repeat(400),suggestion:'修改'.repeat(400)}));return {...value,text:JSON.stringify(body)};}
function usedWritingBytes(f){let low=1,high=50*1024*1024;while(low<high){const mid=Math.floor((low+high)/2);try{writingStorageCheck(f.db,f.user.id,1,{writingAccountStorageBytes:mid});high=mid;}catch(error){if(error.status!==413)throw error;low=mid+1;}}return low-1;}
function fixture(t,extra={}){
 const db=database(':memory:'),user={id:randomUUID()},at=new Date().toISOString();db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user.id,'合成写作质量验收','user',at);
 const config={writingQualityEnabled:true,writingPollMs:60000,getAgentSettings:version=>!version||version===runtime.version?{...runtime}:null,citationVerifier:{verify:async()=>({items:[],summary:{},limitations:[],requests:0})},agentTaskRunner:async({task})=>task.skill==='writing-review'?review(task):draft(task),...extra};
 const billing=createBillingService(db,config);config.billing=billing;billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});
 const order=randomUUID();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order,user.id,'credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,user.id,'credits-200',200,'purchase',at);
 const service=createWritingService(db,config),worker=startWritingWorker(db,config);config.cancelWriting=id=>worker.cancel(id);
 const request=async(path,data)=> (await service.handle({path,method:data===undefined?'GET':'POST',user,readBody:async()=>data})).value;
 const submit=async(kind='proposal',value=snapshot())=>{const quote=await request('/api/writing/quote',{kind,operation:'draft',snapshot:value});return(await request('/api/writing/jobs',{kind,operation:'draft',snapshot:value,clientKey:randomUUID(),billingToken:quote.token,consent:true})).item;};
 t.after(async()=>{await worker.stop();db.close();});
 return {db,user,billing,worker,service,config,request,submit,get:id=>service.get(id,user)};
}

for(const kind of ['proposal','summary','taskbook','article','course','practice','idea'])test(kind+' result retains imported publication metadata for later Word export without retaining source bodies',async t=>{
 const ris='TY  - JOUR\nTI  - Synthetic bibliographic study\nAU  - Smith, Jane Mary\nPY  - 2026\nJO  - Synthetic Journal\nVL  - 18\nIS  - 2\nSP  - 101\nEP  - 112\nDO  - 10.1234/synthetic-bibliography\nAB  - Private supplied reading text, not part of the bibliography.\nER  -\n';
 const reference={...parseCitationImport(ris).items[0],id:'r1',confirmed:true},data={...snapshot(),materials:[],references:[reference]},f=fixture(t,{writingQualityEnabled:false,agentTaskRunner:async({task})=>({text:JSON.stringify({complete:true,text:'拟'.repeat(task.context.unit.targetWords)+'[source:r1]',source_ids:['r1'],missing_evidence:[]}),usage:{input:200,output:100},costUsd:.001,trace:[{tool:'read_material',status:'completed',materialId:'r1'}],finishReason:'end_turn'})});
 const item=await f.submit(kind,data);await f.worker.tick();assert.equal(f.get(item.id).status,'completed',JSON.stringify(f.get(item.id)));
 const saved=JSON.parse(f.db.prepare('SELECT body FROM results WHERE job_id=?').get(item.id).body),row=saved.sourceSnapshot.references[0];
 assert.equal(row.documentType,'journal');assert.equal(row.journal,'Synthetic Journal');assert.equal(row.volume,'18');assert.equal(row.issue,'2');assert.equal(row.pages,'101-112');assert.deepEqual(row.authorNames,[{family:'Smith',given:'Jane Mary'}]);assert.equal(row.confirmed,true);
 for(const key of ['text','abstract','rawCitation','sourceLabel','objectKey','userId'])assert.equal(Object.hasOwn(row,key),false);assert.doesNotMatch(JSON.stringify(saved),/Private supplied reading text/);
 const presentation=thesisDocumentPresentation(saved.sourceSnapshot,saved.sections),citation='[1] Smith J M. Synthetic bibliographic study[J]. Synthetic Journal, 2026, 18(2): 101-112. DOI: 10.1234/synthetic-bibliography.';
 assert.ok(presentation.text.includes(citation));assert.deepEqual(presentation.citationRanges.map(row=>row.number),[1]);
 const bytes=await createWritingDocx(presentation.text,{documentKind:'writing',writingKind:kind,metadata:{title:data.title,chapterTitles:saved.sections.map(row=>row.title),citationRanges:presentation.citationRanges}}),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
 assert.ok(xml.includes(citation));assert.match(xml,/w:anchor="PKRef_1"/);assert.doesNotMatch(xml,/\[source:|Private supplied reading text/);
});

for(const kind of ['proposal','article','taskbook','course','practice','summary'])test(kind+' draft and independent review complete within one purchase without changing the manuscript',async t=>{
 const skills=[],seen=[],f=fixture(t,{agentTaskRunner:async args=>{skills.push(args.task.skill);seen.push(args.settings);if(args.task.skill==='writing-review'){const output=review(args.task);assert.equal(typeof args.validateReviewOutput,'function');assert.equal((await args.validateReviewOutput(output)).valid,true);return output;}const output=draft(args.task);assert.equal(typeof args.validateWritingOutput,'function');assert.equal((await args.validateWritingOutput(output)).valid,true);return output;}});
 const item=await f.submit(kind);assert.equal(f.billing.balance(f.user.id).held,10);await f.worker.tick();const done=f.get(item.id);
 assert.equal(done.status,'completed',JSON.stringify(done));assert.deepEqual(skills,['writing-task','writing-review']);assert.equal(done.output.quality.status,'completed');assert.equal(done.output.quality.coverage.complete,true);assert.equal(done.output.quality.reviews[0].findings[0].grounding,'exact_manuscript_quote');
 const checkpoint=JSON.parse(f.db.prepare('SELECT output FROM writing_checkpoints WHERE run_id=?').get(item.id).output);assert.equal(checkpoint.text,'拟'.repeat(200)+'[source:source]');assert.equal(done.output.sections[0].text,checkpoint.text);assert.ok(done.output.text.includes(checkpoint.text));
 assert.ok(seen[1].maxCostUsd<=runtime.maxCostUsd-.001);assert.deepEqual(done.usage,{input:280,output:120,incomplete:false});
 const result=JSON.parse(f.db.prepare('SELECT body FROM results WHERE job_id=?').get(item.id).body);assert.equal(result.quality.coverage.complete,true);assert.equal(result.sections[0].text,checkpoint.text);
 assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='reserve'").get().n,1);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts').get().n,1);
 await f.worker.tick();assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,1);
});

test('a malformed optional writing review preserves the original text and settles once with a partial quality report',async t=>{
 const f=fixture(t,{agentTaskRunner:async({task})=>task.skill==='writing-review'?{...review(task),text:'{malformed'}:draft(task)}),item=await f.submit();await f.worker.tick();const done=f.get(item.id);
 assert.equal(done.status,'completed');assert.equal(done.output.quality.status,'partial');assert.equal(done.output.quality.coverage.complete,false);assert.equal(done.output.quality.reviews[0].status,'unavailable');assert.equal(done.output.sections[0].text,'拟'.repeat(200)+'[source:source]');assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);
});

test('unknown review cost consumes its allocated ceiling and leaves later batches partial without buying another task',async t=>{
 let drafting=0,reviewing=0;const f=fixture(t,{agentTaskRunner:async({task})=>{if(task.skill==='writing-review'){reviewing++;return {...review(task),costUsd:null};}drafting++;return draft(task);}}),data={...snapshot(),profile:{level:'本科',language:'中文',targetWords:8000},outline:Array.from({length:20},(_,index)=>({id:'c-'+index,title:'拟分析单元'+index,targetWords:400,sections:[]}))},item=await f.submit('proposal',data);
 await f.worker.tick();const done=f.get(item.id);assert.equal(done.status,'completed');assert.equal(drafting,20);assert.equal(reviewing,1);assert.equal(done.output.quality.status,'partial');assert.equal(done.output.quality.coverage.reviewedBatches,1);assert.equal(done.output.quality.coverage.totalBatches,2);assert.equal(done.output.quality.reviews[1].reasonCode,'budget_exhausted');assert.equal(done.completedUnits,20);
 const metrics=JSON.parse(f.db.prepare('SELECT metrics FROM writing_diagnostics WHERE run_id=?').get(item.id).metrics).costAccounting;assert.equal(metrics.sdkEstimatedCostUsd,null);assert.equal(metrics.unknownCostAttempts.length,1);assert.ok(metrics.reservedUnknownCostBudgetUsd>0);assert.ok(metrics.costConsumedBudget<=runtime.maxCostUsd);
 assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,1);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='reserve'").get().n,1);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);
});

test('cancelling ordinary writing during review aborts and cleans up the owned dispatch, preserves the draft and releases its only hold',async t=>{
 let entered,cleaned=false;const ready=new Promise(resolve=>entered=resolve),f=fixture(t,{agentTaskRunner:async({task,signal})=>{if(task.skill!=='writing-review')return draft(task);entered();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{cleaned=true;reject(Object.assign(new Error('synthetic cancellation'),{status:499,usage:{input:10,output:2},costUsd:.001}));},{once:true}));return review(task);}}),item=await f.submit(),pending=f.worker.tick();await ready;
 await f.request('/api/writing/jobs/'+item.id+'/cancel',{});await pending;const cancelled=f.get(item.id);
 assert.equal(cleaned,true);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.completedUnits,1);assert.equal(cancelled.sections[0].text,'拟'.repeat(200)+'[source:source]');assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='release'").get().n,1);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,0);
 await f.worker.tick();assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);
});

test('maintenance stop waits for review runner cleanup before returning and does not publish a late result',async t=>{
 let entered,releaseCleanup,cleaned=false;const ready=new Promise(resolve=>entered=resolve),cleanup=new Promise(resolve=>releaseCleanup=resolve),f=fixture(t,{agentTaskRunner:async({task,signal})=>{if(task.skill!=='writing-review')return draft(task);entered();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));await cleanup;cleaned=true;throw Object.assign(new Error('synthetic shutdown'),{status:499,usage:{input:10,output:2},costUsd:.001});}}),item=await f.submit(),pending=f.worker.tick();await ready;
 let stopped=false;const stop=f.worker.stop().then(()=>stopped=true);await Promise.resolve();await Promise.resolve();assert.equal(stopped,false);assert.equal(cleaned,false);releaseCleanup();await stop;await pending;
 assert.equal(stopped,true);assert.equal(cleaned,true);assert.equal(f.get(item.id).status,'failed');assert.equal(f.get(item.id).completedUnits,1);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.billing.balance(f.user.id).held,0);
});

test('an oversized optional report is compacted within the real quota and the original writing purchase settles once',async t=>{
 let f;f=fixture(t,{agentTaskRunner:async({task})=>{if(task.skill!=='writing-review')return draft(task);const output=largeReview(task);f.config.writingAccountStorageBytes=usedWritingBytes(f)+12000;return output;}});
 const item=await f.submit();await f.worker.tick();const done=f.get(item.id);assert.equal(done.status,'completed');assert.equal(done.output.quality.status,'unavailable');assert.equal(done.output.quality.reasonCode,'storage_limit');assert.equal(done.output.sections[0].text,'拟'.repeat(200)+'[source:source]');assert.doesNotThrow(()=>writingStorageCheck(f.db,f.user.id,0,f.config));assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);
});

test('an exact manuscript-only quota can omit the optional report without dropping prose or exceeding its original guard',async t=>{
 let f;f=fixture(t,{agentTaskRunner:async({task})=>{
  if(task.skill!=='writing-review')return draft(task);
  const row=f.db.prepare('SELECT * FROM writing_runs WHERE status=\'running\'').get(),data=JSON.parse(row.snapshot),units=f.db.prepare('SELECT unit_id,output FROM writing_checkpoints WHERE run_id=? ORDER BY position').all(row.id).map(checkpoint=>({id:checkpoint.unit_id,...JSON.parse(checkpoint.output)}));
  const base={text:units.map(unit=>unit.title+'\n\n'+unit.text).join('\n\n'),sourceIds:[...new Set(units.flatMap(unit=>unit.sourceIds||[]))],sections:units,requiresReview:true},used=new Set(base.sourceIds),sourceSnapshot={title:data.title,materials:data.materials.filter(source=>used.has(source.id)).map(({id,name})=>({id,name,confirmed:true})),references:data.references.filter(source=>used.has(source.id)).map(({id,title,authors,year,doi,url})=>({id,title,authors,year,doi,url,confirmed:true}))};
  const bytes=Buffer.byteLength(JSON.stringify(base))+Buffer.byteLength(JSON.stringify({...base,sourceSnapshot,writingJobId:row.id,kind:row.kind,operation:row.operation}));f.config.writingAccountStorageBytes=usedWritingBytes(f)+bytes;return largeReview(task);
 }});
 const item=await f.submit();await f.worker.tick();const done=f.get(item.id);assert.equal(done.status,'completed');assert.equal(done.output.quality,undefined);assert.equal(done.output.sections[0].text,'拟'.repeat(200)+'[source:source]');assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);
});

test('optional report fallback still rejects the original manuscript when account space itself is insufficient',async t=>{
 let f;f=fixture(t,{agentTaskRunner:async({task})=>{if(task.skill!=='writing-review')return draft(task);f.config.writingAccountStorageBytes=usedWritingBytes(f)+1;return largeReview(task);}});
 const item=await f.submit();await f.worker.tick();const done=f.get(item.id);assert.equal(done.status,'failed');assert.equal(done.completedUnits,1);assert.equal(done.sections[0].text,'拟'.repeat(200)+'[source:source]');assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(f.billing.balance(f.user.id).balance,200);
});
