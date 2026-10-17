import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {createThesisService} from '../backend/thesis-service.mjs';
import {startThesisWorker} from '../backend/thesis-worker.mjs';
import {normalizeThesisSnapshot,thesisPlan,thesisAgentTask,parseThesisSection,selectThesisEvidence} from '../backend/thesis-model.mjs';
import {thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';

const snapshot=(extra={})=>({title:'课堂学习反馈的研究',profile:{level:'本科',discipline:'教育学',major:'教育技术',method:'基于已提供案例进行分析',researchQuestion:'课堂反馈如何支持学习',language:'中文',targetWords:500},requirements:{institution:'所有结论须有真实依据'},materials:[{id:'source-1',name:'用户提供的真实研究记录',text:'案例材料：课堂反馈记录。研究者应核对这些材料，不据此编造实验或结果。',confirmed:true}],references:[],outline:[{id:'chapter-1',title:'研究背景',targetWords:250},{id:'chapter-2',title:'案例分析',targetWords:250}],...extra});
const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://agent.example.test',model:'test-model',apiKey:'test-secret-never-persist',version:'agent-version-1',maxTurns:3,maxOutputTokens:4096,maxCostUsd:.5,timeoutMs:30000};
function output(task,extra={}){const source=task.materials[0]?.id;return {text:JSON.stringify({text:'这是基于用户所提供材料形成的待核对研究草稿。'.repeat(Math.ceil(task.context.unit.targetWords/24))+`[source:${source}]`,source_ids:[source],missing_evidence:[],complete:true}),usage:{input:100,output:300},engine:settings.engine,model:settings.model,finishReason:'end_turn',trace:[{tool:'read_material',status:'completed',materialId:source}],...extra};}
function fixture(t,extra={}){
 const db=database(':memory:'),user={id:'thesis-owner'},other={id:'thesis-other'};
 for(const person of [user,other])db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(person.id,'研究测试账户','user',new Date().toISOString());
 const config={getAgentSettings:version=>!version||version===settings.version?{...settings}:null,agentTaskRunner:async({task})=>output(task),thesisPollMs:60000,...extra};
 const billing=createBillingService(db,config);config.billing=billing;const service=createThesisService(db,config);let worker;
 function start(){worker=startThesisWorker(db,config);config.cancelThesisRun=id=>worker.cancel(id);return worker;}
 async function request(path,method='GET',body,userOverride=user){return (await service.handle({path,method,user:userOverride,readBody:async()=>body}))?.value;}
 async function create(body=snapshot()){return (await request('/api/theses','POST',{snapshot:body,clientKey:randomUUID()})).item;}
 async function generate(item,extra={}){return (await request(`/api/theses/${item.id}/generate`,'POST',{version:item.version,clientKey:randomUUID(),consent:true,billingToken:billing.quote(user,{type:'agent'}).token,...extra})).item;}
 async function resume(item,extra={}){return (await request(`/api/theses/${item.id}/resume`,'POST',{version:item.version,clientKey:randomUUID(),consent:true,billingToken:billing.quote(user,{type:'agent'}).token,...extra})).item;}
 function pay(){billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});const at=new Date().toISOString(),order=randomUUID();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order,user.id,'credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,user.id,'credits-200',200,'purchase',at);}
 t.after(async()=>{if(worker)await worker.stop();db.close();});return {db,config,billing,service,user,other,request,create,generate,resume,start,pay,get:id=>service.get(id,user)};
}

test('snapshot supports all study levels and arbitrary/interdisciplinary domains without granting paid flags',()=>{
 for(const level of ['专科','本科','硕士','博士','研究工作者']){const value=normalizeThesisSnapshot(snapshot({profile:{...snapshot().profile,level,discipline:'交叉学科：设计学与量子材料'},exportUnlocked:true,apiKey:'ignored'}));assert.equal(value.profile.level,level);assert.equal(value.profile.discipline,'交叉学科：设计学与量子材料');assert.equal(value.exportUnlocked,undefined);assert.equal(value.apiKey,undefined);}
 const legacy=normalizeThesisSnapshot({title:'已有论文',degree:'硕士',major:'文学',targetWords:500,knowledgeFiles:[{id:'m-1',name:'旧资料',text:'正文'}],writingReferences:[],outlineRows:[{id:'c-1',title:'第一章',level:1,words:500},{id:'s-1',title:'1.1 背景',level:2,words:500}]});assert.equal(legacy.materials[0].confirmed,false);assert.equal(legacy.outline[0].sections[0].id,'s-1');
});

test('generation requires confirmed body evidence with bounded chapters and output plan',()=>{
 assert.throws(()=>thesisPlan(normalizeThesisSnapshot(snapshot({materials:[{...snapshot().materials[0],confirmed:false}]}))),/确认至少一份/);
 assert.throws(()=>normalizeThesisSnapshot(snapshot({outline:Array.from({length:31},(_,i)=>({id:'c-'+i,title:'章'}))})),/30/);
 const huge=normalizeThesisSnapshot(snapshot({profile:{...snapshot().profile,targetWords:80000},outline:[{id:'c-1',title:'文献分析'}]}));const plan=thesisPlan(huge);assert.ok(plan.length>30);assert.ok(plan.every(unit=>unit.targetWords<=1800));assert.ok(plan.reduce((n,row)=>n+row.targetWords,0)>=80000);
 assert.throws(()=>normalizeThesisSnapshot(snapshot({profile:{...snapshot().profile,targetWords:80001}})),/80000/);
});

test('all study levels can plan with optional discipline and research fields omitted without inventing profile values',()=>{
 for(const level of ['专科','本科','硕士','博士','研究工作者']){
  const value=normalizeThesisSnapshot(snapshot({profile:{level,language:'中文',targetWords:500}})),plan=thesisPlan(value);
  for(const key of ['discipline','major','direction','researchQuestion','method'])assert.equal(value.profile[key],'');
  assert.equal(plan.length,2);const task=thesisAgentTask(value,plan[0],[]);assert.deepEqual(task.context.profile,value.profile);assert.equal(task.materials[0].id,'source-1');
  assert.match(task.instructions,/学科专业、研究方向、核心研究问题和研究方法允许留空/);assert.match(task.instructions,/方法只可依据资料中明确记载的内容描述/);assert.match(task.instructions,/不能从题目或空字段假定已经采用某种方法/);assert.match(task.instructions,/不得编造文献、作者、DOI、访谈、实验、数据、结果或研究结论/);
  assert.throws(()=>thesisPlan({...value,materials:[]}),/确认至少一份含正文/);
  assert.throws(()=>thesisPlan({...value,outline:[]}),/确认至少一个论文章节/);
 }
 const legacy=normalizeThesisSnapshot(snapshot({profile:{...snapshot().profile,discipline:'人文学科',major:'比较文学',method:''}}));assert.equal(legacy.profile.discipline,'人文学科');assert.equal(legacy.profile.major,'比较文学');assert.equal(legacy.profile.method,'');assert.equal(thesisPlan(legacy).length,2);
});

test('blank optional profile fields pass cloud saving, generation and worker execution for all study levels with normal billing',async t=>{
 const seen=[],f=fixture(t,{agentTaskRunner:async({task})=>{seen.push(task.context.profile);return output(task);}});f.pay();const worker=f.start();
 for(const [index,level] of ['专科','本科','硕士','博士','研究工作者'].entries()){
  const item=await f.create(snapshot({profile:{level,language:'中文',targetWords:500}}));for(const key of ['discipline','major','direction','researchQuestion','method'])assert.equal(item.profile[key],'');
  const queued=await f.generate(item);assert.equal(queued.job.totalSections,2);assert.equal(f.billing.balance(f.user.id).held,10);
  await worker.tick();const done=f.get(item.id);assert.equal(done.status,'completed');assert.equal(done.job.completedSections,2);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.billing.balance(f.user.id).balance,200-(index+1)*10);
 }
 assert.equal(seen.length,10);assert.ok(seen.every(profile=>['discipline','major','direction','researchQuestion','method'].every(key=>profile[key]==='')));assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,5);
});

test('evidence extraction is deterministic, source-linked, bounded and explicitly excerpts',()=>{
 const value=normalizeThesisSnapshot(snapshot({materials:Array.from({length:30},(_,i)=>({id:'m-'+i,name:i===29?'课堂反馈研究':'其他资料',text:('其他研究内容。'.repeat(100)+(i===29?'课堂学习反馈记录。':'')).repeat(3),confirmed:true}))}));
 const unit=thesisPlan(value)[0],first=selectThesisEvidence(value,unit),second=selectThesisEvidence(value,unit);assert.deepEqual(first,second);assert.equal(first.sources.length,10);assert.equal(first.excludedCount,20);assert.ok(first.sources.some(source=>source.id==='m-29'));assert.ok(first.sources.every(source=>source.fragments.every(fragment=>fragment.end<=value.materials.find(row=>row.id===source.id).text.length)));
 const task=thesisAgentTask(value,unit,[]);assert.ok(task.materials.reduce((n,row)=>n+row.text.length,0)<80000);assert.equal(task.context.evidenceSelection.excerpted,true);assert.equal(task.context.evidenceSelection.onlineVerification,false);assert.match(task.materials[0].text,/原文字符/);
});

test('strict section validation rejects unknown/unread sources, shortages, truncation and missing research evidence',()=>{
 const value=normalizeThesisSnapshot(snapshot()),unit=thesisPlan(value)[0],task=thesisAgentTask(value,unit,[]),good=output(task);assert.ok(parseThesisSection(good,value,unit).text);
 assert.throws(()=>parseThesisSection({...good,finishReason:'max_tokens'},value,unit),/截断/);
 assert.throws(()=>parseThesisSection({...good,text:'{"text":"broken'},value,unit),/完整性/);
 for(const body of [{text:'短文',source_ids:['source-1'],missing_evidence:[],complete:true},{text:'草稿'.repeat(200),source_ids:['invented'],missing_evidence:[],complete:true},{text:'',source_ids:[],missing_evidence:['缺少实验记录'],complete:false}])assert.throws(()=>parseThesisSection({...good,text:JSON.stringify(body)},value,unit));
 assert.throws(()=>parseThesisSection({...good,trace:[]},value,unit),/尚未实际读取/);
});

test('cloud CRUD is owner-isolated, optimistic, idempotent and preserves imported/manual chapter history',async t=>{
 const f=fixture(t),body=snapshot({bodySections:[{id:'chapter-1',title:'研究背景',text:'用户已写的原文'}]}),key=randomUUID();
 const item=(await f.request('/api/theses','POST',{snapshot:body,clientKey:key})).item;
 assert.equal((await f.request('/api/theses','POST',{snapshot:body,clientKey:key})).item.id,item.id);assert.equal(item.chapters[0].text,'用户已写的原文');
 assert.equal((await f.request('/api/theses','GET',undefined,f.other)).items.length,0);await assert.rejects(f.request('/api/theses/'+item.id,'GET',undefined,f.other),{status:404});
 const updated=(await f.request(`/api/theses/${item.id}/chapters/chapter-1`,'POST',{version:item.version,text:'用户修改后的研究背景'})).item;
 assert.equal(updated.chapters[0].version,2);assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_chapter_versions WHERE thesis_id=?').get(item.id).n,2);
 await assert.rejects(f.request(`/api/theses/${item.id}`,'POST',{version:item.version,snapshot:body}),{status:409});
 assert.throws(()=>f.db.exec("UPDATE thesis_chapter_versions SET text='覆盖历史'"),/不可覆盖/);
 await assert.rejects(f.request('/api/theses','POST',{snapshot:{...body,bodySections:[{id:'chapter-1',title:'研究背景',text:'同一保存标识下改变了原文'}]},clientKey:key}),{status:409});
 await assert.rejects(f.create(snapshot({bodySections:[{id:'unmatched',title:'不在提纲中的章节',text:'不得静默丢弃正文'}]})),/未匹配当前提纲/);
});

test('generate freezes credits atomically, blocks active snapshot edits and completes full result once',async t=>{
 const f=fixture(t);f.pay();const item=await f.create(),key=randomUUID(),queued=await f.generate(item,{clientKey:key});
 assert.equal(f.billing.balance(f.user.id).held,10);assert.equal(queued.billingService,'agent');
 const again=await f.generate(item,{clientKey:key});assert.equal(again.job.id,queued.job.id);assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_runs').get().n,1);
 await assert.rejects(f.request('/api/theses/'+item.id,'POST',{version:queued.version,snapshot:snapshot()}),{status:409});
 const worker=f.start();await Promise.all([worker.tick(),worker.tick()]);const done=f.get(item.id);
 assert.equal(done.status,'completed');assert.equal(done.job.completedSections,2);assert.equal(done.chapters.length,2);assert.ok(done.fullText.includes('[source:source-1]'));
 assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM usage').get().n,1);await worker.tick();assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,1);
 const stored=f.db.prepare('SELECT input FROM jobs WHERE id=?').get(done.job.id).input;assert.equal(stored.includes(settings.apiKey),false);assert.equal(f.db.prepare('SELECT settings_meta FROM thesis_runs WHERE id=?').get(done.job.id).settings_meta.includes(settings.apiKey),false);
});

test('failed later sections preserve checkpoints, release charges and resume only unfinished work',async t=>{
 let calls=0,failOnce=true;const f=fixture(t,{agentTaskRunner:async({task})=>{calls++;if(task.context.unit.chapterId==='chapter-2'&&failOnce){failOnce=false;throw Object.assign(new Error('temporary failure'),{usage:{input:50,output:0}});}return output(task);}});f.pay();const queued=await f.generate(await f.create()),worker=f.start();await worker.tick();const failed=f.get(queued.id);
 assert.equal(failed.status,'failed');assert.equal(failed.job.completedSections,1);assert.ok(failed.chapters[0].text);assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.billing.balance(f.user.id).held,0);
 const resumed=await f.resume(failed),key=f.db.prepare('SELECT client_key FROM thesis_commands WHERE run_id=? ORDER BY rowid DESC LIMIT 1').get(resumed.job.id).client_key;assert.equal(resumed.job.id,failed.job.id);await worker.tick();assert.equal(calls,3);assert.equal(f.get(queued.id).status,'completed');assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.db.prepare('SELECT input_tokens FROM usage').get().input_tokens,250);
 const retry=await f.resume(failed,{clientKey:key});assert.equal(retry.status,'completed');assert.equal(f.billing.balance(f.user.id).balance,190);
});

test('cancel aborts an in-flight call, retains completed sections and cannot settle after cancellation',async t=>{
 let entered,release;const ready=new Promise(resolve=>entered=resolve);const f=fixture(t,{agentTaskRunner:async({task,signal})=>{if(task.context.unit.chapterId==='chapter-1')return output(task);entered();await new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(new Error('abort')),{once:true});});return output(task);}});f.pay();const queued=await f.generate(await f.create()),worker=f.start(),running=worker.tick();await ready;
 const latest=f.get(queued.id),cancelled=(await f.request(`/api/theses/${queued.id}/cancel`,'POST',{version:latest.version})).item;release();await running;assert.equal(cancelled.status,'cancelled');assert.equal(f.get(queued.id).job.completedSections,1);assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);
});

test('server interruption is recoverable and immutable config pin survives runtime changes',async t=>{
 const f=fixture(t),queued=await f.generate(await f.create());f.db.prepare("UPDATE thesis_runs SET status='running' WHERE id=?").run(queued.job.id);f.db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(queued.job.id);const worker=f.start();assert.equal(f.get(queued.id).status,'interrupted');assert.equal(f.billing.balance(f.user.id).held,0);
 const old=f.config.getAgentSettings;f.config.getAgentSettings=version=>version?null:{...settings,version:'new-config'};await assert.rejects(f.resume(f.get(queued.id)),{status:503});f.config.getAgentSettings=old;await f.resume(f.get(queued.id));await worker.tick();assert.equal(f.get(queued.id).status,'completed');
});

test('changed snapshot prohibits checkpoint resume and keeps prior chapters for manual review',async t=>{
 let calls=0;const f=fixture(t,{agentTaskRunner:async({task})=>{if(++calls===2)throw new Error('fail');return output(task);}});const queued=await f.generate(await f.create()),worker=f.start();await worker.tick();const failed=f.get(queued.id),changed=(await f.request(`/api/theses/${queued.id}`,'POST',{version:failed.version,snapshot:snapshot({title:'调整后的研究问题'})})).item;assert.ok(changed.chapters[0].text);assert.equal(changed.job.canResume,false);await assert.rejects(f.resume(changed),/研究资料或提纲已变化/);
});

test('bad or missing generation consent cannot reserve credits and foreign billing tokens cannot pay',async t=>{
 const f=fixture(t);f.pay();const item=await f.create();await assert.rejects(f.generate(item,{consent:false}),{status:400});await assert.rejects(f.generate(item,{billingToken:'another-owner-token'}),{status:409});assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_runs').get().n,0);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
});

test('missing model usage, truncated output and insufficient evidence cannot become completed/paid work',async t=>{
 for(const failure of ['usage','truncated','evidence']){
  const f=fixture(t,{agentTaskRunner:async({task})=>failure==='usage'?output(task,{usage:{input:null,output:null}}):failure==='truncated'?output(task,{finishReason:'length'}):output(task,{text:JSON.stringify({text:'',source_ids:[],missing_evidence:['请提供真实实验结果'],complete:false})})});f.pay();const queued=await f.generate(await f.create()),worker=f.start();await worker.tick();const item=f.get(queued.id);assert.equal(item.status,failure==='evidence'?'needs_materials':'failed');assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(item.job.id).status,'failed');assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(item.job.completedSections,0);
 }
});

test('pre-dispatch budget blocks provider work and exposes a resumable failure without fake usage',async t=>{
 let calls=0;const f=fixture(t,{thesisMaxRunTokens:1000,agentTaskRunner:async({task})=>{calls++;return output(task);}});f.pay();const queued=await f.generate(await f.create()),worker=f.start();await worker.tick();assert.equal(calls,0);const item=f.get(queued.id);assert.equal(item.status,'failed');assert.match(item.job.error,/预算/);assert.equal(item.job.canResume,true);assert.equal(f.billing.balance(f.user.id).held,0);
});

test('runtime readiness never blocks saving and rejects unversioned/incomplete credentials',async t=>{
 const f=fixture(t,{getAgentSettings:()=>({...settings,version:null})});assert.equal((await f.service.capabilities()).ready,false);const item=await f.create();await assert.rejects(f.generate(item),{status:503});assert.equal(f.get(item.id).status,'draft');
});

test('per-attempt token budget is passed to the relay and an explicit resume grants a fresh bounded attempt',async t=>{
 const remaining=[];const f=fixture(t,{thesisMaxRunTokens:10000,agentTaskRunner:async({task,settings:limits})=>{remaining.push(limits.maxTotalTokens);return output(task,{usage:{input:3000,output:4000}});}});f.pay();const queued=await f.generate(await f.create()),worker=f.start();await worker.tick();const paused=f.get(queued.id);assert.equal(paused.status,'failed');assert.equal(paused.job.completedSections,1);assert.deepEqual(remaining,[10000]);assert.equal(f.billing.balance(f.user.id).balance,200);
 await f.resume(paused);await worker.tick();assert.equal(f.get(queued.id).status,'completed');assert.deepEqual(remaining,[10000,10000]);assert.equal(f.db.prepare('SELECT input_tokens FROM usage').get().input_tokens,6000);assert.equal(f.billing.balance(f.user.id).balance,190);
});

test('admin shutdown blocks later sections while resume retains the immutable original configuration',async t=>{
 let enabled=true,calls=0;const seen=[];const f=fixture(t,{getAgentSettings:version=>version?{...settings}:{...settings,enabled,version:enabled&&calls?'new-config':settings.version},agentTaskRunner:async({task,settings:runtime})=>{calls++;seen.push(runtime.version);enabled=false;return output(task);}});
 const queued=await f.generate(await f.create()),worker=f.start();await worker.tick();assert.equal(calls,1);assert.equal(f.get(queued.id).status,'failed');assert.equal(f.get(queued.id).job.completedSections,1);enabled=true;await f.resume(f.get(queued.id));await worker.tick();assert.equal(calls,2);assert.deepEqual(seen,[settings.version,settings.version]);assert.equal(f.get(queued.id).status,'completed');
});

test('worker admin cancellation persists thesis state even when the shared job was already cancelled',async t=>{
 const f=fixture(t),queued=await f.generate(await f.create()),worker=f.start();f.db.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(queued.job.id);worker.cancel(queued.job.id);assert.equal(f.get(queued.id).status,'cancelled');assert.equal(f.get(queued.id).job.status,'cancelled');assert.equal(f.billing.balance(f.user.id).held,0);await worker.tick();assert.equal(f.get(queued.id).job.providerCalls,0);
});

test('account storage limit includes prior workspace drafts and failed writes preserve all current data',async t=>{
 const f=fixture(t,{thesisAccountStorageBytes:2000}),at=new Date().toISOString();f.db.prepare('INSERT INTO workspace_drafts(id,user_id,title,tool,payload,bytes,version,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('other-draft',f.user.id,'旧账户草稿','writing','{}',1800,1,'test-hash',at,at);await assert.rejects(f.create(),{status:413});assert.equal(f.db.prepare('SELECT count(*) n FROM theses').get().n,0);assert.equal(f.db.prepare('SELECT bytes FROM workspace_drafts').get().bytes,1800);
 const g=fixture(t,{thesisAccountStorageBytes:2000}),item=await g.create();await assert.rejects(g.request(`/api/theses/${item.id}/chapters/chapter-1`,'POST',{version:item.version,text:'正文'.repeat(1000)}),{status:413});assert.equal(g.get(item.id).version,item.version);assert.equal(g.get(item.id).chapters[0].text,'');
});

test('unknown failed usage is preserved as unknown after successful explicit resume rather than reported as zero',async t=>{
 let failed=false;const f=fixture(t,{agentTaskRunner:async({task})=>{if(!failed){failed=true;throw new Error('provider stopped without usage');}return output(task);}});const queued=await f.generate(await f.create()),worker=f.start();await worker.tick();let item=f.get(queued.id);assert.equal(item.job.usageIncomplete,true);assert.equal(item.job.inputTokens,null);await f.resume(item);await worker.tick();item=f.get(queued.id);assert.equal(item.status,'completed');assert.equal(item.job.inputTokens,null);assert.equal(f.db.prepare('SELECT input_tokens FROM usage').get().input_tokens,null);
});

test('the real frontend snapshot preserves old manual chapters, source consent and arbitrary research profiles',async t=>{
 const f=fixture(t);
 for(const degree of ['专科','本科','硕士','博士','科研人员']){
  const local={title:'跨领域研究与原文保留',degree,discipline:'交叉学科',major:'艺术设计与计算机科学',method:'需求分析与设计实践',researchQuestion:'怎样改善工作流',language:'英文',targetWords:1000,knowledgeFiles:[{id:'same-id',name:'已有研究过程',purpose:'研究背景',text:'用户自己记录的研究材料'}],writingReferences:[{id:'same-id',title:'用户确认题录',authors:'作者',year:'2024',text:'可供核对的文献片段'}],outlineRows:[{id:'new-outline-id',title:'第一章 研究设计',level:1,words:0},{id:'new-section-id',title:'1.1 需求边界',level:2,words:1000},{id:'refs',title:'参考文献（填写真实来源）',level:1,words:0}],bodySections:[{id:'old-body-id',title:'第一章 研究设计',text:'不能丢弃的已写正文'}]};
  const converted=thesisSnapshotFromDraft(local),item=await f.create(converted);assert.equal(item.profile.level,degree==='科研人员'?'研究工作者':degree);assert.equal(item.profile.discipline,'交叉学科');assert.equal(item.chapters[0].text,'不能丢弃的已写正文');assert.equal(item.snapshot.materials[0].purpose,'研究背景');assert.equal(item.snapshot.materials[0].confirmed,true);assert.notEqual(item.snapshot.materials[0].id,item.snapshot.references[0].id);assert.ok(thesisPlan(item.snapshot).every(unit=>unit.chapterId!=='refs'));
 }
});

test('reference chapters compile only actually cited confirmed bibliographic records without an extra model call',async t=>{
 let calls=0;const f=fixture(t,{agentTaskRunner:async({task})=>{calls++;const result=output(task);return {...result,text:JSON.stringify({text:'依据所给文献片段形成待核对的理论讨论。'.repeat(30)+'[source:ref-1]',source_ids:['ref-1'],missing_evidence:[],complete:true}),trace:[{tool:'read_material',status:'completed',materialId:'ref-1'}]};}});
 const body=snapshot({outline:[{id:'body',title:'理论讨论',targetWords:500},{id:'refs',title:'参考文献（填写真实来源）',targetWords:0}],references:[{id:'ref-1',title:'用户确认的文献题录（测试材料）',authors:'测试作者',year:'2024',text:'用户提供并确认的文献片段（测试材料）。',confirmed:true},{id:'ref-2',title:'未使用的题录不能混入结果',text:'未引用片段。',confirmed:true}]});
 const queued=await f.generate(await f.create(body)),worker=f.start();await worker.tick();const item=f.get(queued.id);assert.equal(item.status,'completed');assert.equal(calls,1);assert.equal(item.chapters[1].source,'compiled_references');assert.match(item.chapters[1].text,/测试作者/);assert.doesNotMatch(item.chapters[1].text,/未使用的题录/);assert.equal(item.job.totalSections,1);const history=await f.request(`/api/theses/${item.id}/chapters/refs/versions`);assert.equal(history.items[0].source,'compiled_references');
});

test('chapter history is paginated metadata, owner-bound, immutable, and restoring text recomputes source links',async t=>{
 const f=fixture(t),created=await f.create(snapshot({bodySections:[{id:'chapter-1',title:'研究背景',text:'旧文中引用了材料[source:source-1]'}]}));assert.deepEqual(created.chapters[0].sourceIds,['source-1']);
 const changed=(await f.request(`/api/theses/${created.id}/chapters/chapter-1`,'POST',{version:created.version,text:'新正文已经删除了旧引用'})).item;assert.deepEqual(changed.chapters[0].sourceIds,[]);
 const list=await f.request(`/api/theses/${created.id}/chapters/chapter-1/versions`);assert.deepEqual(list.items.map(row=>row.version),[2,1]);assert.equal(list.limit,50);assert.equal(list.items[0].text,undefined);
 const old=await f.request(`/api/theses/${created.id}/chapters/chapter-1/versions/1`);assert.equal(old.item.text,'旧文中引用了材料[source:source-1]');await assert.rejects(f.request(`/api/theses/${created.id}/chapters/chapter-1/versions/1`,'GET',undefined,f.other),{status:404});
 await assert.rejects(f.request(`/api/theses/${created.id}/chapters/chapter-1/versions/1`,'POST',{text:'不能覆盖历史'}),{status:405});
 const restored=(await f.request(`/api/theses/${created.id}/chapters/chapter-1`,'POST',{version:changed.version,text:old.item.text})).item;assert.equal(restored.chapters[0].version,3);assert.deepEqual(restored.chapters[0].sourceIds,['source-1']);
});

test('identical chapter saves are no-ops and the history cap bounds blank/metadata growth without deleting versions',async t=>{
 const f=fixture(t),item=await f.create(),at=new Date().toISOString();for(let version=1;version<=200;version++)f.db.prepare('INSERT INTO thesis_chapter_versions VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),item.id,'chapter-1',version,null,'manual','版本 '+version,'[]',at);
 const same=await f.request(`/api/theses/${item.id}/chapters/chapter-1`,'POST',{version:item.version,text:'版本 200'});assert.equal(same.item.version,item.version);assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_chapter_versions').get().n,200);
 await assert.rejects(f.request(`/api/theses/${item.id}/chapters/chapter-1`,'POST',{version:item.version,text:''}),/200/);const history=await f.request(`/api/theses/${item.id}/chapters/chapter-1/versions`);assert.equal(history.items.length,50);assert.equal(history.items.at(-1).version,151);assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_chapter_versions').get().n,200);
});
