import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {createThesisService} from '../backend/thesis-service.mjs';
import {startThesisWorker} from '../backend/thesis-worker.mjs';
import {normalizeThesisSnapshot,thesisPlan,thesisAgentTask,parseThesisSection} from '../backend/thesis-model.mjs';

const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://agent.example.test',model:'synthetic-model',apiKey:'synthetic-test-key',version:'draft-policy-test',maxTurns:3,maxOutputTokens:4096,maxCostUsd:.5,timeoutMs:30000};
const sourceGap='当前仅有题录，文献论点与实际研究数据尚待核对和补充。';
const warning='【待补充：真实研究记录和数据尚未提供，本节为可编辑的研究框架。】';
const snapshot=()=>({title:'课堂学习反馈的研究',profile:{level:'本科',major:'教育技术学',language:'中文',targetWords:500},requirements:{},materials:[],references:Array.from({length:5},(_,index)=>({id:'reference-'+(index+1),title:'合成测试候选题录 '+(index+1),authors:'合成测试作者 '+(index+1),year:'2025',doi:'10.9999/synthetic-'+(index+1),url:'https://example.invalid/reference-'+(index+1),sourceLabel:'合成测试题录，未读取正文',text:'',confirmed:true})),outline:[{id:'background',title:'研究背景与问题',targetWords:250},{id:'results',title:'结果分析与待验证框架',targetWords:250},{id:'references',title:'参考文献',targetWords:0}]});
function prose(target,marker=warning){let text=marker;const paragraph='本节说明研究问题、拟采用的分析路径和后续资料核对方式，不声称已经完成实验或取得效果结论。';while(Array.from(text).length<target)text+=paragraph;return text;}
function response(unit,body={}){return {text:JSON.stringify({text:prose(unit.targetWords),source_ids:[],draft:true,missing_evidence:[sourceGap],complete:true,...body}),usage:{input:100,output:300},trace:[],finishReason:'end_turn'};}
function modelCase(){const value=normalizeThesisSnapshot(snapshot()),unit={id:'background::background::1',chapterId:'background',chapterTitle:'研究背景与问题',sectionId:'background',title:'研究背景与问题',part:1,parts:1,targetWords:250,position:0,sourceIds:[]};return {value,unit};}
function fixture(t,{runner=async({task})=>response(task.context.unit)}={}){
 const db=database(':memory:'),user={id:'initial-draft-owner'};db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user.id,'合成测试用户','user',new Date().toISOString());
 const config={getAgentSettings:version=>!version||version===settings.version?{...settings}:null,agentTaskRunner:runner,thesisPollMs:60000},billing=createBillingService(db,config);config.billing=billing;const service=createThesisService(db,config);let worker;
 const request=async(path,method='GET',body)=>(await service.handle({path,method,user,readBody:async()=>body})).value;
 const create=async(body=snapshot())=>(await request('/api/theses','POST',{snapshot:body,clientKey:randomUUID()})).item;
 const generate=async(item,{clientKey=randomUUID(),consent=true}={})=>{const quote=await request(`/api/theses/${item.id}/quote`,'POST',{version:item.version,action:'generate'});return {item:(await request(`/api/theses/${item.id}/generate`,'POST',{version:item.version,clientKey,billingToken:quote.token,consent})).item,clientKey};};
 const start=()=>worker??=(startThesisWorker(db,config));
 const pay=()=>{billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});const at=new Date().toISOString(),order=randomUUID();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order,user.id,'credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,user.id,'credits-200',200,'purchase',at);};
 t.after(async()=>{if(worker)await worker.stop();db.close();});return {db,user,billing,request,create,generate,start,pay,get:id=>service.get(id,user)};
}

test('only-topic and confirmed-catalog snapshots can plan initial drafts without manufacturing readable evidence',()=>{
 for(const references of [snapshot().references,[]]){
  const value=normalizeThesisSnapshot({...snapshot(),references}),plan=thesisPlan(value);assert.equal(plan.length,2);assert.equal(plan.reduce((sum,unit)=>sum+unit.targetWords,0),500);
  for(const unit of plan){const task=thesisAgentTask(value,unit,[]);assert.deepEqual(task.materials,[]);assert.match(task.instructions,/待补充|待核对/);const context=JSON.stringify(task.context);for(const row of references)assert.ok(context.includes(row.title),'confirmed catalog metadata should be visible without becoming material text');}
  assert.deepEqual(value.materials,[]);assert.ok(value.references.every(row=>row.text===''));
 }
});

test('a source-free reviewable draft retains visible gaps and permits no invented bibliography citations',()=>{
 const {value,unit}=modelCase(),parsed=parseThesisSection(response(unit),value,unit);assert.deepEqual(parsed.sourceIds,[]);assert.deepEqual(parsed.missingEvidence,[sourceGap]);assert.match(parsed.text,/【待补充：/);assert.equal(parsed.text.includes('[source:'),false);
 for(const id of ['invented-source','reference-1']){const fake=response(unit,{text:prose(unit.targetWords)+'[source:'+id+']',source_ids:[id]});fake.trace=[{tool:'read_material',status:'completed',materialId:id}];assert.throws(()=>parseThesisSection(fake,value,unit),'a confirmed metadata ID cannot be cited as actually read source text');}
});

test('source-free prose without an explicit draft contract or visible qualification is rejected',()=>{
 const {value,unit}=modelCase();
 for(const changes of [{draft:false},{draft:undefined},{text:prose(unit.targetWords,'')},{text:prose(unit.targetWords,''),missing_evidence:[]}])assert.throws(()=>parseThesisSection(response(unit,changes),value,unit));
 assert.throws(()=>parseThesisSection(response(unit,{complete:false}),value,unit));
 assert.throws(()=>parseThesisSection({...response(unit),finishReason:'length'},value,unit));
});

test('initial-draft mode does not weaken read-source identity or citation-marker validation',()=>{
 const base=snapshot(),value=normalizeThesisSnapshot({...base,materials:[{id:'actual-source',name:'合成测试实际提供的文本',text:'这是一份用于验证引用约束的合成文本材料，并不是一份真实研究数据。'.repeat(5),confirmed:true}]}),unit=thesisPlan(value)[0];
 const cited=response(unit,{text:prose(unit.targetWords)+'[source:actual-source]',source_ids:['actual-source']});assert.throws(()=>parseThesisSection(cited,value,unit));
 cited.trace=[{tool:'read_material',status:'completed',materialId:'actual-source'}];assert.deepEqual(parseThesisSection(cited,value,unit).sourceIds,['actual-source']);
 assert.throws(()=>parseThesisSection({...cited,text:JSON.stringify({text:prose(unit.targetWords)+'[source:reference-1]',source_ids:['actual-source'],draft:true,missing_evidence:[sourceGap],complete:true})},value,unit));
});

test('zero materials and five metadata references complete through the real service and worker with one settlement',async t=>{
 const tasks=[],f=fixture(t,{runner:async({task})=>{tasks.push(task);assert.deepEqual(task.materials,[]);return response(task.context.unit);}});f.pay();const created=await f.create(),{item:queued,clientKey}=await f.generate(created);assert.equal(f.billing.balance(f.user.id).held,10);assert.equal(queued.job.totalSections,2);
 const worker=f.start();await worker.tick();const done=f.get(created.id);assert.equal(done.status,'completed');assert.equal(done.job.completedSections,2);assert.equal(done.requiresReview,true);assert.equal(tasks.length,2);assert.equal(done.snapshot.materials.length,0);assert.equal(done.snapshot.references.length,5);assert.ok(done.snapshot.references.every(row=>row.text===''));
 for(const id of ['background','results']){const chapter=done.chapters.find(row=>row.id===id);assert.match(chapter.text,/【待补充：/);assert.deepEqual(chapter.sourceIds,[]);}
 assert.ok(done.sections.every(row=>row.status==='completed'&&row.missingEvidence.includes(sourceGap)));assert.ok(done.job.missingEvidence.includes(sourceGap));assert.match(done.fullText,/【待补充：/);assert.doesNotMatch(done.fullText,/\[source:/);
 assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM usage').get().n,1);
 const stored=JSON.parse(f.db.prepare('SELECT body FROM results').get().body);assert.equal(stored.requiresReview,true);assert.equal(stored.draft,true);assert.equal(stored.references.length,5);assert.ok(stored.missingEvidence.includes(sourceGap));assert.equal(stored.referenceListIncomplete,true);assert.equal(stored.chapters.find(row=>row.id==='references').text,'');
 await worker.tick();await f.request(`/api/theses/${created.id}/generate`,'POST',{version:created.version,clientKey,billingToken:'already-used-idempotent-command',consent:true});assert.equal(tasks.length,2);assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);
});

test('a zero-progress legacy evidence interruption can resume as a qualified draft without a second charge',async t=>{
 let interrupted=true,calls=0;const f=fixture(t,{runner:async({task})=>{calls++;return response(task.context.unit,interrupted?{draft:false,complete:false}:{});}});f.pay();const created=await f.create(),{item:queued}=await f.generate(created);const worker=f.start();await worker.tick();const waiting=f.get(created.id);
 assert.equal(waiting.status,'needs_materials');assert.equal(waiting.job.completedSections,0);assert.equal(waiting.job.canResume,true);assert.equal(waiting.job.snapshotChanged,false);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);
 interrupted=false;const quote=await f.request(`/api/theses/${created.id}/quote`,'POST',{version:waiting.version,action:'resume'}),resumed=await f.request(`/api/theses/${created.id}/resume`,'POST',{version:waiting.version,clientKey:randomUUID(),billingToken:quote.token,consent:true});assert.equal(resumed.item.job.id,queued.job.id);assert.equal(f.billing.balance(f.user.id).held,10);await worker.tick();const done=f.get(created.id);
 assert.equal(done.status,'completed');assert.equal(done.job.id,queued.job.id);assert.equal(done.job.completedSections,2);assert.equal(calls,3);assert.equal(f.db.prepare('SELECT attempt FROM thesis_runs WHERE id=?').get(queued.job.id).attempt,2);assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,1);assert.ok(done.sections.every(row=>row.missingEvidence.includes(sourceGap)));
});

test('a worker result lacking the visible review qualification never settles or overwrites prior chapters',async t=>{
 const f=fixture(t,{runner:async({task})=>response(task.context.unit,{text:prose(task.context.unit.targetWords,'')})});f.pay();const created=await f.create({...snapshot(),bodySections:[{id:'background',title:'研究背景与问题',text:'原有的用户研究草稿需要继续保留。'}]}),{item:queued}=await f.generate(created);const worker=f.start();await worker.tick();const failed=f.get(created.id);
 assert.notEqual(failed.status,'completed');assert.equal(failed.job.completedSections,0);assert.equal(failed.chapters.find(row=>row.id==='background').text,'原有的用户研究草稿需要继续保留。');assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_chapter_versions WHERE run_id=?').get(queued.job.id).n,0);
});

test('allowing optional research materials never bypasses explicit generation consent or credit reservation rules',async t=>{
 let calls=0;const f=fixture(t,{runner:async()=>{calls++;throw Error('must not dispatch');}});f.pay();const created=await f.create();await assert.rejects(f.generate(created,{consent:false}),{status:400});assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_runs').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);await f.start().tick();assert.equal(calls,0);assert.equal(f.billing.balance(f.user.id).balance,200);
});
