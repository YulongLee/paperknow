import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {createThesisService} from '../backend/thesis-service.mjs';
import {startThesisWorker} from '../backend/thesis-worker.mjs';
import {createThesisContinuity} from '../backend/thesis-continuity.mjs';
import {assertThesisAccountQuota} from '../backend/thesis-model.mjs';
import {prepareThesisDeliverySnapshot} from '../dist/workspace/thesis-delivery.mjs';

const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://fixture.example.com',model:'fixture',apiKey:'synthetic-only',version:'continuous-fixture-v1',maxTurns:12,maxOutputTokens:4096,maxCostUsd:.5,timeoutMs:30000};
function snapshot(target=500,units=2){return {title:'合成验收：课堂反馈研究',profile:{level:'本科',language:'中文',targetWords:target},materials:[],references:[],outline:Array.from({length:units},(_,i)=>({id:'c'+i,title:'研究单元'+i,targetWords:Math.floor(target/units)+(i<target%units?1:0)}))};}
function result(task,extra={}){return {text:JSON.stringify({complete:true,draft:true,text:'研'.repeat(task.context.unit.targetWords-20)+'【待核对：来源与实际研究信息】',source_ids:[],missing_evidence:['请核对实际研究资料']}),usage:{input:1000,output:300},costUsd:.01,trace:[],...extra};}
function usedThesisBytes(f){let low=1000,high=50*1024*1024;while(low<high){const mid=Math.floor((low+high)/2);try{assertThesisAccountQuota(f.db,f.user.id,1,{thesisAccountStorageBytes:mid});high=mid;}catch(error){if(error.status!==413)throw error;low=mid+1;}}return low-1;}
function fixture(t,extra={}){
 const db=database(':memory:'),user={id:randomUUID()},at=new Date().toISOString();db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user.id,'合成连续生成验收','user',at);
 const config={thesisContinuousEnabled:true,writingQualityEnabled:false,thesisPollMs:60000,getAgentSettings:()=>({...settings}),agentTaskRunner:async({task})=>result(task),...extra},billing=createBillingService(db,config);config.billing=billing;
 billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});
 const order=randomUUID();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order,user.id,'credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,user.id,'credits-200',200,'purchase',at);
 const service=createThesisService(db,config),workers=[];
 const api=async(path,body)=> (await service.handle({path,method:body?'POST':'GET',user,readBody:async()=>body})).value;
 const create=async(value=snapshot())=>(await api('/api/theses',{snapshot:value,clientKey:randomUUID()})).item;
 async function generate(item){const quote=await api('/api/theses/'+item.id+'/quote',{version:item.version,action:'generate'});return(await api('/api/theses/'+item.id+'/generate',{version:item.version,clientKey:randomUUID(),consent:true,billingToken:quote.token})).item;}
 function start(){const worker=startThesisWorker(db,config);workers.push(worker);config.cancelThesisRun=id=>worker.cancel(id);return worker;}
 t.after(async()=>{for(const worker of workers)await worker.stop();db.close();});
 return {db,user,config,billing,service,api,create,generate,start,get:id=>service.get(id,user)};
}

test('one submission repairs a failed section and settles one original purchase with the configured 12 turns',async t=>{
 let calls=0;const seen=[],f=fixture(t,{agentTaskRunner:async args=>{calls++;seen.push(args);if(calls===1)throw Object.assign(new Error('synthetic turn boundary'),{status:502,code:'turn_limit',usage:{input:1100,output:100},costUsd:.01});return result(args.task);}});
 const item=await f.generate(await f.create());await f.start().tick();const done=f.get(item.id);
 assert.equal(done.status,'completed');assert.equal(done.job.attempt,1);assert.equal(done.job.continuous,true);assert.equal(done.job.recovery.automaticRetries,1);assert.equal(calls,3);
 assert.ok(seen.every(args=>args.settings.maxTurns===12&&typeof args.validateThesisOutput==='function'));
 assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts').get().n,1);
 assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='reserve'").get().n,1);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);
 assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.billing.balance(f.user.id).held,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_chapter_versions').get().n,2);
});

test('a one-dollar thesis execution accepts a 75-cent section and freezes that ceiling without changing the shared Agent',async t=>{
 const seen=[],f=fixture(t,{thesisMaxCallCostUsd:1,agentTaskRunner:async args=>{seen.push(args.settings.maxCostUsd);return result(args.task,{costUsd:.75});}});
 const item=await f.generate(await f.create());f.config.thesisMaxCallCostUsd=.2;
 await f.start().tick();assert.equal(f.get(item.id).status,'completed');assert.deepEqual(seen,[1,1]);assert.equal(f.config.getAgentSettings().maxCostUsd,.5);
 assert.equal(JSON.parse(f.db.prepare('SELECT settings_meta FROM thesis_runs WHERE id=?').get(item.job.id).settings_meta).executionMaxCostUsd,1);
 assert.equal(f.db.prepare('SELECT unit_cost_micros FROM thesis_execution_budgets WHERE run_id=?').get(item.job.id).unit_cost_micros,1000000);
 assert.equal(f.billing.balance(f.user.id).balance,190);
});

test('raising a thesis execution to one dollar does not remove the new cost ceiling or create an automatic paid retry beyond it',async t=>{
 let calls=0;const f=fixture(t,{thesisMaxCallCostUsd:1,agentTaskRunner:async args=>{calls++;return result(args.task,{costUsd:1.01});}});
 const item=await f.generate(await f.create());await f.start().tick();assert.equal(f.get(item.id).status,'failed');assert.equal(calls,1);
 assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);
});

test('explicit resume adopts the new thesis-only ceiling, preserves the old budget and completed units, and settles once',async t=>{
 let calls=0;const seen=[],f=fixture(t,{agentTaskRunner:async args=>{
  calls++;seen.push({unit:args.task.context.unit.id,cost:args.settings.maxCostUsd});
  if(calls===2)throw Object.assign(Error('Synthetic old cost boundary'),{code:'cost_budget',status:502,usage:{input:1000,output:100},costUsd:.51});
  return result(args.task,{costUsd:calls>2?.75:.1});
 }});
 const item=await f.generate(await f.create()),worker=f.start();await worker.tick();let current=f.get(item.id);
 assert.equal(current.status,'failed');assert.equal(current.job.completedSections,1);assert.equal(f.billing.balance(f.user.id).balance,200);
 f.config.thesisMaxCallCostUsd=1;
 const quote=await f.api('/api/theses/'+item.id+'/quote',{version:current.version,action:'resume'});
 await f.api('/api/theses/'+item.id+'/resume',{version:current.version,clientKey:randomUUID(),consent:true,billingToken:quote.token});
 await worker.tick();current=f.get(item.id);assert.equal(current.status,'completed');assert.equal(calls,3);
 assert.deepEqual(seen.map(row=>row.cost),[.5,.5,1]);assert.equal(seen[1].unit,seen[2].unit);assert.notEqual(seen[0].unit,seen[2].unit);
 assert.deepEqual(f.db.prepare('SELECT attempt,unit_cost_micros FROM thesis_execution_budgets ORDER BY attempt').all().map(row=>({...row})),[{attempt:1,unit_cost_micros:500000},{attempt:2,unit_cost_micros:1000000}]);
 assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);assert.equal(f.billing.balance(f.user.id).balance,190);
});

test('one charged delivery job saves body then both abstracts, and free cover updates do not invalidate manuscript review or settle again',async t=>{
 const sequence=[],f=fixture(t,{agentTaskRunner:async({task})=>{
  const unit=task.context.unit;sequence.push(unit.frontMatter||'body');if(!unit.frontMatter)return result(task);
  assert.ok(task.context.manuscriptExcerpts.length>=2,'summaries receive saved body evidence');
  const text=unit.frontMatter==='abstract_en'?'English title: A Proposed Classroom Feedback Design\n\n'+('This study describes a proposed design without measured results. '.repeat(25))+'\n\nKey words: classroom; feedback; design':'这是一项课堂反馈方案设计研究。'.repeat(30)+'\n\n关键词：课堂；反馈；设计';
  return {text:JSON.stringify({complete:true,draft:false,text,source_ids:[],missing_evidence:[]}),usage:{input:1000,output:300},costUsd:.01,trace:[]};
 }});
 const item=await f.generate(await f.create(prepareThesisDeliverySnapshot(snapshot())));await f.start().tick();const done=f.get(item.id);
 assert.equal(done.status,'completed');assert.deepEqual(sequence,['body','body','abstract_zh','abstract_en']);assert.equal(done.job.completedSections,4);assert.match(done.fullText,/关键词：课堂/);assert.match(done.fullText,/Key words: classroom/);assert.equal(f.billing.balance(f.user.id).balance,190);
 const hash=f.db.prepare('SELECT snapshot_hash FROM theses WHERE id=?').get(item.id).snapshot_hash,updated=(await f.api('/api/theses/'+item.id+'/export-metadata',{version:done.version,metadata:{author:'合成作者',studentId:'SYNTHETIC-001',institution:'合成学校'}})).item;
 assert.equal(updated.exportMetadata.author,'合成作者');assert.equal(updated.status,'completed');assert.equal(f.db.prepare('SELECT snapshot_hash FROM theses WHERE id=?').get(item.id).snapshot_hash,hash);assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);
 await assert.rejects(()=>f.api('/api/theses/'+item.id+'/export-metadata',{version:done.version,metadata:{author:'过期编辑'}}),error=>error.status===409);
});

test('a summary failure resumes only its unfinished summary and never writes or charges the body twice',async t=>{
 const seen=[],f=fixture(t,{agentTaskRunner:async({task})=>{const kind=task.context.unit.frontMatter||'body';seen.push(kind);if(kind==='body')return result(task);if(kind==='abstract_en')return {text:'{incomplete',usage:{input:1000,output:300},costUsd:.01};return {text:JSON.stringify({complete:true,draft:false,text:'这是一项课堂反馈方案设计研究。'.repeat(30)+'\n关键词：课堂；反馈；设计',source_ids:[],missing_evidence:[]}),usage:{input:1000,output:300},costUsd:.01,trace:[]};}});
 const item=await f.generate(await f.create(prepareThesisDeliverySnapshot(snapshot()))),worker=f.start();await worker.tick();let current=f.get(item.id);assert.equal(current.status,'failed');assert.equal(current.job.completedSections,3);assert.equal(f.billing.balance(f.user.id).balance,200);
 f.config.agentTaskRunner=async({task})=>{seen.push(task.context.unit.frontMatter);return {text:JSON.stringify({complete:true,draft:false,text:'English title: A Proposed Classroom Feedback Design\n\n'+('This study describes a proposed design without measured results. '.repeat(25))+'\nKey words: classroom; feedback; design',source_ids:[],missing_evidence:[]}),usage:{input:1000,output:300},costUsd:.01,trace:[]};};
 const quote=await f.api('/api/theses/'+item.id+'/quote',{version:current.version,action:'resume'});await f.api('/api/theses/'+item.id+'/resume',{version:current.version,clientKey:randomUUID(),consent:true,billingToken:quote.token});await worker.tick();current=f.get(item.id);assert.equal(current.status,'completed');assert.equal(seen.filter(kind=>kind==='body').length,2);assert.equal(seen.filter(kind=>kind==='abstract_zh').length,1);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);assert.equal(f.billing.balance(f.user.id).balance,190);
});

test('an 8000-character manuscript can finish beyond the former 400k window without manual resume',async t=>{
 let calls=0;const f=fixture(t,{agentTaskRunner:async({task})=>{calls++;return result(task,{usage:{input:30000,output:1500}});}});
 const item=await f.generate(await f.create(snapshot(8000,20)));await f.start().tick();const done=f.get(item.id);
 assert.equal(done.status,'completed');assert.equal(done.job.attempt,1);assert.equal(calls,20);assert.equal(done.job.completedSections,20);assert.ok(done.job.inputTokens>400000);
 const budget=f.db.prepare('SELECT token_limit FROM thesis_execution_budgets WHERE run_id=?').get(item.job.id);assert.ok(budget.token_limit>400000&&budget.token_limit<=100000000);
});

test('a 32-unit source-backed manuscript finishes realistic late-chapter usage, two repairs and full review with one settlement',async t=>{
 const seen=[],failed=new Set();let reviews=0;
 const f=fixture(t,{writingQualityEnabled:true,thesisMaxCallCostUsd:1,citationVerifier:{verify:async()=>({items:[],summary:{},limitations:[],requests:0})},agentTaskRunner:async args=>{
  const {task,settings:runtime}=args;assert.ok(runtime.maxTotalTokens<=2000000);
  if(task.skill==='writing-review'){reviews++;return {text:JSON.stringify({complete:true,findings:[],limitations:['合成用量回放不评估真实模型质量']}),usage:{input:70000,output:1000},costUsd:.15,trace:[]};}
  const unit=task.context.unit;seen.push({id:unit.id,window:runtime.maxTotalTokens});
  if([9,25].includes(seen.length)&&!failed.has(unit.id)){failed.add(unit.id);throw Object.assign(Error('Synthetic turn limit'),{status:502,code:'turn_limit',usage:{input:170687,output:11617},costUsd:.4});}
  const output=result(task,{usage:{input:149006,output:7795},costUsd:.368722});
  if(unit.frontMatter){const text=unit.frontMatter==='abstract_en'?'English title: A Synthetic Classroom Design\n\n'+('This study describes a proposed design without measured results. '.repeat(25))+'\nKey words: classroom; feedback; design':'这是一项课堂反馈方案设计研究。'.repeat(30)+'\n关键词：课堂；反馈；设计';output.text=JSON.stringify({complete:true,draft:false,text,source_ids:[],missing_evidence:[]});}
  return output;
 }});
 const value=snapshot(20000,15);value.outline=value.outline.map((chapter,index)=>({...chapter,sections:[{id:'s'+index+'a',title:'研究单元甲'+index,targetWords:Math.ceil(chapter.targetWords/2)},{id:'s'+index+'b',title:'研究单元乙'+index,targetWords:Math.floor(chapter.targetWords/2)}]}));value.materials=[{id:'synthetic-evidence',name:'合成事实材料',text:'这是合成测试资料。'.repeat(1600),confirmed:true}];
 const item=await f.generate(await f.create(prepareThesisDeliverySnapshot(value)));await f.start().tick();const done=f.get(item.id);
 assert.equal(done.status,'completed');assert.equal(done.job.attempt,1);assert.equal(done.job.completedSections,32);assert.equal(done.job.recovery.automaticRetries,2);
 assert.ok(done.job.inputTokens>4000000);assert.equal(seen.length,34);assert.equal(new Set(seen.map(row=>row.id)).size,32);
 assert.ok(seen.every(row=>row.window===480000));assert.ok(reviews>0);assert.equal(done.quality.coverage.complete,true);
 assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='reserve'").get().n,1);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.billing.balance(f.user.id).held,0);
});

test('an automatic retry receives the actual server validation feedback instead of repeating a blind fresh prompt',async t=>{
 let calls=0;const f=fixture(t,{agentTaskRunner:async args=>{
  calls++;if(calls===1){const tooShort=result(args.task),body=JSON.parse(tooShort.text);body.text='短【待核对：文献依据】';const checked=args.validateThesisOutput({...tooShort,text:JSON.stringify(body)});assert.equal(checked.valid,false);assert.ok(checked.feedback.count<checked.feedback.min);throw Object.assign(Error('Synthetic turn limit after a short candidate'),{status:502,code:'turn_limit',usage:{input:1000,output:100},costUsd:.01});}
  if(calls===2){assert.equal(args.task.context.retryFeedback.code,'incomplete');assert.ok(args.task.context.retryFeedback.count<args.task.context.retryFeedback.min);assert.match(args.task.instructions,/过短补足论证/);}
  return result(args.task);
 }});
 const item=await f.generate(await f.create());await f.start().tick();assert.equal(f.get(item.id).status,'completed');assert.equal(calls,3);assert.equal(f.billing.balance(f.user.id).balance,190);
});

test('a 23-unit manuscript automatically recovers a preflight window failure after nine saved units and charges once',async t=>{
 const seen=[],f=fixture(t,{agentTaskRunner:async({task,settings:runtime})=>{
  const id=task.context.unit.id;seen.push({id,window:runtime.maxTotalTokens});
  if(seen.length===10)throw Object.assign(new Error('Synthetic full-history preflight denial'),{status:429,code:'budget_exceeded',usage:{input:170687,output:11617},costUsd:.1,executionBudget:{reason:'request_reservation',limitTokens:runtime.maxTotalTokens,usedTokens:182304,inFlightTokens:0,requestTokens:runtime.maxTotalTokens-182304+10000}});
  return result(task,{usage:{input:30000,output:1500}});
 }});
 const item=await f.generate(await f.create(snapshot(8000,23)));await f.start().tick();const done=f.get(item.id);
 assert.equal(done.status,'completed');assert.equal(done.job.completedSections,23);assert.equal(done.job.attempt,1);assert.equal(done.job.recovery.automaticRetries,1);assert.equal(seen.length,24);
 assert.equal(seen[9].id,seen[10].id);assert.ok(seen[10].window>seen[9].window,'Fresh recovery must receive the admitted larger window');
 assert.ok(seen.slice(0,9).every(row=>seen.filter(other=>other.id===row.id).length===1),'Previously completed units are never regenerated');
 assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_execution_budgets').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_chapter_versions').get().n,23);
 assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='reserve'").get().n,1);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.billing.balance(f.user.id).held,0);
});

test('an actual token ceiling or unknown accounting cannot masquerade as a fresh context window',async t=>{
 for(const kind of ['plain-budget','actual-overrun','unknown-usage','whole-paper-cap']){
  let calls=0;const extra=kind==='whole-paper-cap'?{thesisMaxRunTokens:400000}:{},f=fixture(t,{...extra,agentTaskRunner:async({settings:runtime})=>{
   calls++;const usage=kind==='unknown-usage'?null:kind==='actual-overrun'?{input:runtime.maxTotalTokens,output:1}:{input:170687,output:11617};
   throw Object.assign(new Error('Synthetic protected stop'),{status:429,code:'budget_exceeded',usage,costUsd:.01,...(kind==='plain-budget'?{}:{executionBudget:{reason:'request_reservation',limitTokens:runtime.maxTotalTokens,usedTokens:usage?usage.input+usage.output:0,inFlightTokens:0,requestTokens:runtime.maxTotalTokens}})});
  }});
  const item=await f.generate(await f.create());await f.start().tick();assert.equal(f.get(item.id).status,'failed',kind);assert.equal(calls,1,kind);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);
 }
});

test('repeated request-window failures stay inside three attempts and release the original purchase',async t=>{
 let calls=0;const f=fixture(t,{agentTaskRunner:async({settings:runtime})=>{
  calls++;throw Object.assign(new Error('Synthetic persistent preflight denial'),{status:429,code:'budget_exceeded',usage:{input:100,output:20},costUsd:.001,executionBudget:{reason:'request_reservation',limitTokens:runtime.maxTotalTokens,usedTokens:120,inFlightTokens:0,requestTokens:runtime.maxTotalTokens}});
 }});
 const item=await f.generate(await f.create());await f.start().tick();const stopped=f.get(item.id);
 assert.equal(stopped.status,'failed');assert.equal(calls,3);assert.equal(stopped.job.attempt,1);assert.equal(stopped.job.recovery.automaticRetries,2);
 assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_execution_budgets').get().n,1);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='reserve'").get().n,1);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,0);
 assert.match(stopped.job.error,/不是积分不足/);assert.doesNotMatch(stopped.job.error,/Token|Agent|request_reservation|maxTotalTokens/);
});

test('an operator token ceiling stays effective without automatic budget reset',async t=>{
 let calls=0;const f=fixture(t,{thesisMaxRunTokens:1000,agentTaskRunner:async({task})=>{calls++;return result(task,{usage:{input:1500,output:300}});}});
 const item=await f.generate(await f.create());await f.start().tick();assert.equal(f.get(item.id).status,'failed');assert.equal(calls,1);assert.equal(f.get(item.id).job.attempt,1);assert.equal(f.billing.balance(f.user.id).balance,200);
 assert.equal(f.db.prepare('SELECT token_limit FROM thesis_execution_budgets').get().token_limit,1000);
});

test('three invalid outputs stop safely, while unauthorized evidence and unknown usage never auto-retry',async t=>{
 for(const mode of ['json','source','usage']){let calls=0;const f=fixture(t,{agentTaskRunner:async({task})=>{calls++;if(mode==='json')return result(task,{text:'{broken'});if(mode==='usage')return result(task,{usage:{input:null,output:null}});const value=JSON.parse(result(task).text);value.source_ids=['invented'];value.text+='[source:invented]';return result(task,{text:JSON.stringify(value)});}});
  const item=await f.generate(await f.create());await f.start().tick();assert.equal(f.get(item.id).status,'failed');assert.equal(calls,mode==='json'?3:1);assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);
 }
});

test('maintenance restart automatically resumes only unfinished sections and keeps the same held entitlement',async t=>{
 let entered;const ready=new Promise(resolve=>entered=resolve);let calls=0;
 const f=fixture(t,{agentTaskRunner:async({task,signal})=>{calls++;if(calls===2){entered();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('synthetic shutdown'),{status:499,code:'cancelled'})),{once:true}));}return result(task);}});
 const item=await f.generate(await f.create()),first=f.start(),pending=first.tick();await ready;assert.equal(f.get(item.id).job.completedSections,1);await first.stop();await pending;
 let state=f.get(item.id);assert.equal(state.status,'queued');assert.equal(state.job.attempt,1);assert.equal(f.billing.balance(f.user.id).held,10);
 const second=f.start();await second.tick();state=f.get(item.id);assert.equal(state.status,'completed');assert.equal(calls,3);assert.equal(state.job.attempt,1);assert.equal(f.billing.balance(f.user.id).balance,190);
 assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_chapter_versions').get().n,2);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='reserve'").get().n,1);
});

test('explicit user cancellation never requeues and cannot publish after an in-flight response',async t=>{
 let entered;const ready=new Promise(resolve=>entered=resolve);let calls=0;
 const f=fixture(t,{agentTaskRunner:async({task,signal})=>{calls++;if(calls===2){entered();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancel'),{status:499,code:'cancelled'})),{once:true}));}return result(task);}});
 const item=await f.generate(await f.create()),worker=f.start(),pending=worker.tick();await ready;
 await f.api('/api/theses/'+item.id+'/cancel',{version:f.get(item.id).version});await pending;await worker.tick();assert.equal(f.get(item.id).status,'cancelled');assert.equal(calls,2);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.billing.balance(f.user.id).balance,200);
});

test('writing skills and metadata checks lead into an independent review without editing the generated text',async t=>{
 const stages=[],tasks=[],f=fixture(t,{writingQualityEnabled:true,citationVerifier:{verify:async()=>({items:[],summary:{},limitations:[],requests:0})},agentTaskRunner:async args=>{tasks.push(args.task.skill);args.onStage?.('agent_running');stages.push(args.task.skill);if(args.task.skill==='writing-review'){const text=JSON.stringify({complete:true,findings:[],limitations:['合成验收不判断研究事实']});assert.equal((await args.validateReviewOutput({text})).valid,true);return {text,usage:{input:700,output:100},costUsd:.01,trace:[]};}return result(args.task);}});
 const item=await f.generate(await f.create());await f.start().tick();const done=f.get(item.id);
 assert.equal(done.status,'completed');assert.deepEqual(tasks,['thesis-section','thesis-section','writing-review']);assert.equal(done.quality.status,'completed');assert.equal(done.quality.coverage.complete,true);assert.equal(done.quality.stale,false);assert.ok(done.chapters.every(chapter=>chapter.text.startsWith('研')));
 const updated=(await f.api('/api/theses/'+item.id+'/chapters/c0',{version:done.version,text:'用户修改后的正文'})).item;assert.equal(updated.quality.stale,true);
});

test('optional review failure preserves the whole manuscript and a truthful incomplete report',async t=>{
 const f=fixture(t,{writingQualityEnabled:true,citationVerifier:{verify:async()=>({items:[],summary:{},limitations:[]})},agentTaskRunner:async({task})=>task.skill==='writing-review'?{text:'{broken',usage:{input:700,output:100},costUsd:.01}:result(task)});
 const item=await f.generate(await f.create());await f.start().tick();const done=f.get(item.id);assert.equal(done.status,'completed');assert.equal(done.quality.status,'partial');assert.equal(done.job.completedSections,2);assert.equal(done.quality.reviews[0].status,'unavailable');assert.equal(f.billing.balance(f.user.id).balance,190);
});

test('a large optional thesis report is compacted without blocking saved chapters or settling the purchase twice',async t=>{
 let f;f=fixture(t,{writingQualityEnabled:true,citationVerifier:{verify:async()=>({items:[],summary:{},limitations:[]})},agentTaskRunner:async({task})=>{
  if(task.skill!=='writing-review')return result(task);
  const excerpt=task.context.manuscriptExcerpts[0],output={text:JSON.stringify({complete:true,findings:Array.from({length:12},(_,index)=>({sectionId:excerpt.id,quote:excerpt.text.slice(0,8+index),category:'structure',severity:'info',explanation:'论证'.repeat(400),suggestion:'修改'.repeat(400)})),limitations:['仅为合成检查']}),usage:{input:700,output:100},costUsd:.01,trace:[]};
  const cacheBytes=Buffer.byteLength(JSON.stringify({text:output.text,trace:[],usage:output.usage}));f.config.thesisAccountStorageBytes=usedThesisBytes(f)+cacheBytes+700;return output;
 }});
 const item=await f.generate(await f.create());await f.start().tick();const done=f.get(item.id);assert.equal(done.status,'completed');assert.equal(done.quality.status,'unavailable');assert.equal(done.quality.reasonCode,'storage_limit');assert.equal(done.job.completedSections,2);assert.ok(done.chapters.every(chapter=>chapter.text.startsWith('研')));assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);assert.doesNotThrow(()=>assertThesisAccountQuota(f.db,f.user.id,1,f.config));
});

test('thesis report fallback does not bypass a quota that cannot save the actual chapter manuscript',async t=>{
 let f;f=fixture(t,{writingQualityEnabled:true,agentTaskRunner:async({task})=>{f.config.thesisAccountStorageBytes=usedThesisBytes(f)+1;return result(task);}});
 const item=await f.generate(await f.create());await f.start().tick();const done=f.get(item.id);assert.equal(done.status,'failed');assert.equal(done.job.completedSections,0);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(f.billing.balance(f.user.id).balance,200);
});

test('all-zero section and review usage stays unknown and never releases dispatched token reserves',async t=>{
 for(const phase of ['section','review']){
  const f=fixture(t,{writingQualityEnabled:phase==='review',citationVerifier:{verify:async()=>({items:[],summary:{},limitations:[]})},agentTaskRunner:async({task})=>task.skill==='writing-review'?{text:JSON.stringify({complete:true,findings:[],limitations:[]}),usage:{input:0,output:0},costUsd:.01}:result(task,phase==='section'?{usage:{input:0,output:0}}:{})});
  const item=await f.generate(await f.create());await f.start().tick();const done=f.get(item.id);
  assert.equal(done.status,phase==='review'?'completed':'failed');assert.equal(done.job.usageIncomplete,true);
  const dispatch=f.db.prepare("SELECT * FROM thesis_execution_dispatches WHERE error_code='usage_unknown'").get();assert.ok(dispatch);assert.equal(dispatch.charged_tokens,dispatch.reserved_tokens);assert.equal(dispatch.input_tokens,null);assert.equal(dispatch.output_tokens,null);
  if(phase==='review'){assert.equal(done.quality.status,'partial');assert.equal(f.db.prepare('SELECT input_tokens FROM usage WHERE job_id=?').get(item.job.id).input_tokens,null);}
 }
});

test('startup recovery preserves an orphaned dispatch and keeps its lost usage unknown after successful completion',async t=>{
 let calls=0;const f=fixture(t,{agentTaskRunner:async({task})=>{calls++;return result(task);}}),item=await f.generate(await f.create());
 f.db.prepare("UPDATE thesis_runs SET status='running' WHERE id=?").run(item.job.id);f.db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(item.job.id);f.db.prepare("UPDATE theses SET status='running' WHERE id=?").run(item.id);
 const run=f.db.prepare('SELECT * FROM thesis_runs WHERE id=?').get(item.job.id),ledger=createThesisContinuity(f.db,f.config),stored=JSON.parse(run.snapshot),plan=JSON.parse(run.plan);
 ledger.ensure(run,stored,plan,settings);const orphan=ledger.reserve(run,plan[0].id,{remainingUnits:plan.length,settings});
 assert.equal(f.get(item.id).job.usageIncomplete,false);
 const worker=f.start(),queued=f.get(item.id);assert.equal(queued.status,'queued');assert.equal(queued.job.usageIncomplete,true);assert.equal(queued.job.inputTokens,null);assert.equal(f.billing.balance(f.user.id).held,10);
 const frozen=f.db.prepare('SELECT status,input_tokens,output_tokens,cost_micros,charged_tokens,reserved_tokens FROM thesis_execution_dispatches WHERE id=?').get(orphan.id);assert.equal(frozen.status,'interrupted');assert.equal(frozen.input_tokens,null);assert.equal(frozen.output_tokens,null);assert.equal(frozen.cost_micros,null);assert.equal(frozen.charged_tokens,frozen.reserved_tokens);
 await worker.tick();const done=f.get(item.id);assert.equal(done.status,'completed');assert.equal(calls,2);assert.equal(done.job.attempt,1);assert.equal(done.job.usageIncomplete,true);assert.equal(done.job.inputTokens,null);assert.equal(done.job.outputTokens,null);assert.equal(f.db.prepare('SELECT input_tokens FROM usage WHERE job_id=?').get(item.job.id).input_tokens,null);
 assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='reserve'").get().n,1);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);
});

test('a legal chapter and section identifier exceeding 160 characters still completes quality review',async t=>{
 const chapterId='c'+'a'.repeat(99),sectionId='s'+'b'.repeat(99),tasks=[];
 const f=fixture(t,{writingQualityEnabled:true,citationVerifier:{verify:async()=>({items:[],summary:{},limitations:[],requests:0})},agentTaskRunner:async({task})=>{tasks.push(task.skill);if(task.skill==='writing-review')return {text:JSON.stringify({complete:true,findings:[],limitations:['合成定位检查']}),usage:{input:100,output:100},costUsd:.01,trace:[]};assert.ok(task.context.unit.id.length>160);return result(task);}});
 const value={...snapshot(),outline:[{id:chapterId,title:'合法长编号章节',targetWords:500,sections:[{id:sectionId,title:'合法长编号小节',targetWords:500}]}]},item=await f.generate(await f.create(value));await f.start().tick();const done=f.get(item.id);
 assert.equal(done.status,'completed');assert.deepEqual(tasks,['thesis-section','writing-review']);assert.equal(done.quality.status,'completed');assert.equal(done.quality.coverage.complete,true);assert.equal(done.job.completedSections,1);assert.equal(f.billing.balance(f.user.id).balance,190);
});

test('a twenty-unit 8000-character thesis completes both bounded review batches in its original purchase',async t=>{
 let reviews=0;const f=fixture(t,{writingQualityEnabled:true,citationVerifier:{verify:async()=>({items:[],summary:{},limitations:[],requests:0})},agentTaskRunner:async({task})=>{if(task.skill==='writing-review'){reviews++;return {text:JSON.stringify({complete:true,findings:[],limitations:['合成分批检查']}),usage:{input:100,output:100},costUsd:.01,trace:[]};}return result(task);}});
 const item=await f.generate(await f.create(snapshot(8000,20)));await f.start().tick();const done=f.get(item.id);assert.equal(done.status,'completed');assert.equal(reviews,2);assert.equal(done.quality.status,'completed');assert.equal(done.quality.coverage.complete,true);assert.equal(done.quality.coverage.reviewedBatches,2);assert.equal(done.quality.coverage.totalBatches,2);assert.equal(done.job.attempt,1);assert.equal(f.billing.balance(f.user.id).balance,190);
});
