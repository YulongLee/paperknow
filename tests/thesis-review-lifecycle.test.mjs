import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../backend/database.mjs';
import {initializeThesisSchema,thesisHash} from '../backend/thesis-model.mjs';
import {createBillingService} from '../backend/billing-service.mjs';
import {createThesisContinuity} from '../backend/thesis-continuity.mjs';
import {createThesisReviewSessions} from '../backend/thesis-review-session.mjs';
import {createThesisReviewLifecycle} from '../backend/thesis-review-lifecycle.mjs';
import {createThesisService} from '../backend/thesis-service.mjs';
import {startThesisWorker} from '../backend/thesis-worker.mjs';
import {environmentConfig} from '../backend/config.mjs';

function fixture(t,enabled=true){
 const db=database(':memory:');t.after(()=>db.close());const config={thesisReviewOnlyEnabled:enabled};initializeThesisSchema(db);createBillingService(db,config);createThesisContinuity(db,config);
 const at=new Date().toISOString(),snapshot={title:'研究',profile:{level:'本科',discipline:'计算机',major:'软件',language:'中文'},requirements:{deliveryVersion:1},materials:[],references:[],outline:[{id:'c',title:'第一章',level:1}]},serialized=JSON.stringify(snapshot),hash=thesisHash(snapshot),settings={version:'v1',model:'model',engine:'claude-agent-sdk',maxCostUsd:1,enabled:true,baseURL:'https://example.test',apiKey:'fake',maxTurns:3,maxOutputTokens:2048,timeoutMs:30000};
 for(const id of ['u','other'])db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(id,id,'user',at);
 db.prepare("INSERT INTO theses(id,user_id,title,snapshot,snapshot_hash,version,status,input_hash,created_at,updated_at) VALUES('t','u','研究',?,?,1,'completed','input',?,?)").run(serialized,hash,at,at);
 db.prepare("INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES('paid','u','thesis','completed','completed','{}','paid-key','hash',?,?)").run(at,at);
 db.prepare("INSERT INTO thesis_runs(id,thesis_id,user_id,snapshot,snapshot_hash,plan,settings_version,settings_meta,status,stage,created_at,updated_at) VALUES('paid','t','u',?,?,'[]','v1',?,'completed','completed',?,?)").run(serialized,hash,JSON.stringify({...settings,completion:{scope:'full',purpose:'completion',baseline:[]}}),at,at);
 db.prepare("INSERT INTO thesis_chapter_versions(id,thesis_id,chapter_id,version,run_id,source,text,source_ids,created_at,figures) VALUES('ver','t','c',1,'paid','generated','原始正文','[]',?,'[]')").run(at);
 db.prepare("INSERT INTO billing_reservations(id,job_id,attempt,user_id,type,source,credits,status,created_at,updated_at) VALUES('charge','paid',1,'u','agent','credits',10,'settled',?,?)").run(at,at);
 db.prepare("INSERT INTO thesis_execution_budgets(run_id,attempt,user_id,settings_version,unit_ids,review_allowance,token_limit,cost_limit_micros,unit_cost_micros,created_at,updated_at) VALUES('paid',1,'u','v1','[]',1,10000,1000000,1000000,?,?)").run(at,at);
 db.prepare("INSERT INTO thesis_execution_dispatches(id,run_id,attempt,user_id,unit_id,kind,unit_attempt,status,reserved_tokens,reserved_cost_micros,charged_tokens,charged_cost_micros,input_tokens,output_tokens,cost_micros,created_at,finished_at) VALUES('prev','paid',1,'u','unit','section',1,'completed',2000,300000,1000,100000,700,300,100000,?,?)").run(at,at);
 const sessions=createThesisReviewSessions(db,config),life=createThesisReviewLifecycle(db,config,{sessions}),request={userId:'u',thesisId:'t',version:1,paidRunId:'paid',clientKey:'client-key-1',settings};return {db,life,request,snapshot,at,config};
}
function start(f,id){f.db.prepare("UPDATE thesis_runs SET status='running',stage='running' WHERE id=?").run(id);f.db.prepare("UPDATE jobs SET status='running',stage='running',attempt=1 WHERE id=?").run(id);return f.db.prepare('SELECT * FROM thesis_runs WHERE id=?').get(id);}

test('feature 默认关闭；启用后用已付权益入队且幂等，不新扣积分',t=>{const f=fixture(t,false);assert.throws(()=>f.life.enqueue(f.request),{code:'review_disabled'});f.config.thesisReviewOnlyEnabled=true;const run=f.life.enqueue(f.request);assert.equal(run.created,true);assert.equal(f.life.enqueue(f.request).runId,run.runId);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_chapter_versions').get().n,1);});
test('跨账号、研究身份、版本和模型不一致不得复查',t=>{const f=fixture(t);assert.throws(()=>f.life.enqueue({...f.request,userId:'other'}),{status:404});assert.throws(()=>f.life.enqueue({...f.request,version:2}),{status:409});assert.throws(()=>f.life.enqueue({...f.request,settings:{...f.request.settings,model:'other'}}),{code:'review_settings_changed'});const changed={...f.snapshot,title:'另一篇论文'};f.db.prepare('UPDATE theses SET snapshot=?,snapshot_hash=? WHERE id=?').run(JSON.stringify(changed),thesisHash(changed),'t');assert.throws(()=>f.life.enqueue(f.request),{code:'review_study_changed'});assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,1);});
test('完整检查可保存，检查不全或正文变化不写结果',t=>{const f=fixture(t),created=f.life.enqueue(f.request),run=start(f,created.runId);assert.equal(f.life.current(run),true);assert.throws(()=>f.life.finish(run,{status:'partial',coverage:{complete:false}}),{code:'review_incomplete'});f.db.prepare("INSERT INTO thesis_chapter_versions(id,thesis_id,chapter_id,version,source,text,created_at) VALUES('new','t','c',2,'manual','用户新正文',?)").run(f.at);assert.equal(f.life.current(run),false);assert.throws(()=>f.life.finish(run,{status:'completed',coverage:{complete:true},supplementCheck:{coverage:{complete:true}}}),{code:'review_changed'});assert.equal(f.db.prepare('SELECT quality FROM thesis_runs WHERE id=?').get(run.id).quality,null);});
test('取消仅结束复查，原已付权益及原章节不变',t=>{const f=fixture(t),created=f.life.enqueue(f.request),run=start(f,created.runId);assert.equal(f.life.stop(run,'cancelled'),true);assert.equal(f.life.stop(run,'cancelled'),false);assert.equal(f.db.prepare("SELECT status FROM billing_reservations WHERE id='charge'").get().status,'settled');assert.equal(f.db.prepare("SELECT text FROM thesis_chapter_versions WHERE id='ver'").get().text,'原始正文');});
test('复查失败分类仅可追加、只保存白名单且不改变原权益',t=>{
 const f=fixture(t),created=f.life.enqueue(f.request),run=start(f,created.runId);
 assert.equal(f.life.stop(run,'failed','review_budget_exhausted'),true);
 assert.equal(f.life.stop(run,'failed','review_budget_exhausted'),false);
 const rows=f.db.prepare('SELECT run_id,user_id,thesis_id,attempt,reason FROM thesis_review_failure_reasons').all();
 assert.deepEqual({...rows[0]},{run_id:run.id,user_id:'u',thesis_id:'t',attempt:1,reason:'review_budget_exhausted'});assert.equal(rows.length,1);
 assert.throws(()=>f.db.prepare('UPDATE thesis_review_failure_reasons SET reason=? WHERE run_id=?').run('other',run.id),/不可修改/);
 assert.throws(()=>f.db.prepare('DELETE FROM thesis_review_failure_reasons WHERE run_id=?').run(run.id),/不可删除/);
 assert.throws(()=>f.db.prepare('INSERT OR REPLACE INTO thesis_review_failure_reasons SELECT run_id,user_id,thesis_id,attempt,?,created_at FROM thesis_review_failure_reasons WHERE run_id=?').run('other',run.id),/不可替换/);
 assert.equal(f.db.prepare("SELECT status FROM billing_reservations WHERE id='charge'").get().status,'settled');
 assert.equal(f.db.prepare("SELECT text FROM thesis_chapter_versions WHERE id='ver'").get().text,'原始正文');
});
test('未知故障内容不得进入复查诊断',t=>{
 const f=fixture(t),created=f.life.enqueue(f.request),run=start(f,created.runId);
 assert.equal(f.life.stop(run,'failed','敏感正文与服务商凭证'),true);
 assert.equal(f.db.prepare('SELECT reason FROM thesis_review_failure_reasons WHERE run_id=?').get(run.id).reason,'other');
});
test('旧数据库兼容升级：仅创建新诊断表，不回填或修改历史记录，可重复初始化',t=>{
 const f=fixture(t),created=f.life.enqueue(f.request),run=start(f,created.runId);
 f.db.exec('DROP TABLE thesis_review_failure_reasons');
 const before={...f.db.prepare("SELECT * FROM billing_reservations WHERE id='charge'").get()};
 const sessions=createThesisReviewSessions(f.db,f.config),upgraded=createThesisReviewLifecycle(f.db,f.config,{sessions});
 createThesisReviewLifecycle(f.db,f.config,{sessions});
 assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_review_failure_reasons').get().n,0);
 assert.deepEqual({...f.db.prepare("SELECT * FROM billing_reservations WHERE id='charge'").get()},before);
 assert.equal(upgraded.stop(run,'failed','review_usage_unknown'),true);
 assert.equal(f.db.prepare('SELECT reason FROM thesis_review_failure_reasons').get().reason,'review_usage_unknown');
});
test('诊断拒绝跨账号与重放，注入字符只会被归类为其他',t=>{
 const f=fixture(t),created=f.life.enqueue(f.request),run=start(f,created.runId);
 assert.throws(()=>f.life.stop({...run,user_id:'other'},'failed','review_budget_exhausted'),{status:404});
 assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_review_failure_reasons').get().n,0);
 assert.equal(f.life.stop(run,'failed',"other'); DROP TABLE users; --"),true);
 assert.equal(f.life.stop(run,'failed','review_budget_exhausted'),false);
 assert.equal(f.db.prepare('SELECT reason FROM thesis_review_failure_reasons').get().reason,'other');
 assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,2);
});
test('模型和额度故障保留安全分类',t=>{
 for(const code of ['cost_budget','budget_exceeded','truncated','runtime_error']){
  const f=fixture(t),created=f.life.enqueue(f.request),run=start(f,created.runId);
  assert.equal(f.life.stop(run,'failed',code),true);
  assert.equal(f.db.prepare('SELECT reason FROM thesis_review_failure_reasons').get().reason,code);
 }
});
test('诊断写入触发回滚也不影响终止和费用恢复',async t=>{
 for(const failure of ['ABORT','ROLLBACK'])for(const outer of [false,true]){
  const f=fixture(t),created=f.life.enqueue(f.request),run=start(f,created.runId),ledger=createThesisReviewSessions(f.db,f.config),session=ledger.open({userId:'u',thesisId:'t',paidRunId:'paid'}),identity={userId:'u',thesisId:'t',sessionId:session.id,reviewRunId:run.id,attempt:1};
  const reservation=ledger.reserve({...identity,unitId:'check-diagnostic',requestKey:'request-diagnostic',reservedTokens:1000,reservedCostUsd:.1});ledger.markStarted({...identity,dispatchId:reservation.id});
  f.db.exec(`CREATE TRIGGER fail_diagnostic BEFORE INSERT ON thesis_review_failure_reasons BEGIN SELECT RAISE(${failure},'injected failure'); END`);
  if(outer)f.db.exec('BEGIN');assert.equal(f.life.stop(run,'failed','runtime_error'),true);if(outer)f.db.exec('COMMIT');await Promise.resolve();
  assert.equal(f.db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(run.id).status,'failed');
  assert.equal(f.db.prepare('SELECT status FROM thesis_review_session_dispatches').get().status,'interrupted');
  assert.equal(f.db.prepare("SELECT status FROM billing_reservations WHERE id='charge'").get().status,'settled');
  assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);
 }
});
test('外围事务回滚时不会留下虚假的复查诊断',async t=>{
 const f=fixture(t),created=f.life.enqueue(f.request),run=start(f,created.runId);
 f.db.exec('BEGIN');assert.equal(f.life.stop(run,'failed','runtime_error'),true);f.db.exec('ROLLBACK');await Promise.resolve();
 assert.equal(f.db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(run.id).status,'running');
 assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_review_failure_reasons').get().n,0);
});
test('外层事务异步未结束时不会在事务中执行诊断写入',async t=>{
 const f=fixture(t),created=f.life.enqueue(f.request),run=start(f,created.runId);
 f.db.exec("CREATE TRIGGER fail_diagnostic BEFORE INSERT ON thesis_review_failure_reasons BEGIN SELECT RAISE(ROLLBACK,'injected failure'); END");
 f.db.exec('BEGIN');assert.equal(f.life.stop(run,'failed','runtime_error'),true);await Promise.resolve();f.db.exec('COMMIT');
 assert.equal(f.db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(run.id).status,'failed');
 assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_review_failure_reasons').get().n,0);
 assert.equal(f.db.prepare("SELECT status FROM billing_reservations WHERE id='charge'").get().status,'settled');
});
test('worker 复查失败传递安全原因，未重新收费',async t=>{
 const f=fixture(t);f.config.getAgentSettings=()=>({...f.request.settings});
 f.config.thesisReviewQualityRunner=async()=>{throw Object.assign(new Error('不应记录的用户内容'),{code:'review_budget_exhausted'});};
 const service=createThesisService(f.db,f.config),opened=await service.handle({path:'/api/theses/t/completion/recheck',method:'POST',user:{id:'u'},readBody:async()=>({version:1,clientKey:'diagnostic-review'})}),id=opened.value.item.job.id;
 const worker=startThesisWorker(f.db,f.config);t.after(()=>worker.stop());await worker.tick();
 assert.equal(f.db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(id).status,'failed');
 assert.equal(f.db.prepare('SELECT reason FROM thesis_review_failure_reasons WHERE run_id=?').get(id).reason,'review_budget_exhausted');
 assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);
});
test('unfinished review shows its actual blocked state without changing the ledger or charging again',t=>{
 for(const mode of ['limit_reached','usage_pending']){
  const f=fixture(t),created=f.life.enqueue(f.request),run=start(f,created.runId),ledger=createThesisReviewSessions(f.db,f.config),session=ledger.open({userId:'u',thesisId:'t',paidRunId:'paid'}),identity={userId:'u',thesisId:'t',sessionId:session.id,reviewRunId:run.id,attempt:1};
  const reservation=ledger.reserve({...identity,unitId:'check-1',requestKey:'request-1',reservedTokens:9000,reservedCostUsd:.9});ledger.markStarted({...identity,dispatchId:reservation.id});
  ledger.finish({...identity,dispatchId:reservation.id,usage:{input:8700,output:300},costUsd:mode==='usage_pending'?undefined:.9,errorCode:'synthetic_failure'});f.life.stop(run);
  const item=createThesisService(f.db,f.config).get('t',{id:'u'});assert.equal(item.recheck.eligible,false);assert.equal(item.recheck.reason,mode);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);assert.equal(f.db.prepare('SELECT status FROM thesis_review_session_dispatches').get().status,'failed');assert.equal(f.db.prepare('SELECT text FROM thesis_chapter_versions').get().text,'原始正文');
 }
});
test('a separately completed and settled paid completion receives a separate review pool',t=>{
 const f=fixture(t),ledger=createThesisReviewSessions(f.db,f.config),original=ledger.open({userId:'u',thesisId:'t',paidRunId:'paid'});
 f.db.prepare("INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES('paid2','u','thesis','completed','completed','{}','paid-key-2','hash',?,?)").run(f.at,f.at);
 f.db.prepare("INSERT INTO thesis_runs(id,thesis_id,user_id,snapshot,snapshot_hash,plan,settings_version,settings_meta,status,stage,created_at,updated_at) SELECT 'paid2',thesis_id,user_id,snapshot,snapshot_hash,plan,settings_version,settings_meta,status,stage,?,? FROM thesis_runs WHERE id='paid'").run(f.at,f.at);
 f.db.prepare("INSERT INTO billing_reservations(id,job_id,attempt,user_id,type,source,credits,status,created_at,updated_at) VALUES('charge2','paid2',1,'u','agent','credits',10,'settled',?,?)").run(f.at,f.at);
 f.db.prepare("INSERT INTO thesis_execution_budgets(run_id,attempt,user_id,settings_version,unit_ids,review_allowance,token_limit,cost_limit_micros,unit_cost_micros,created_at,updated_at) VALUES('paid2',1,'u','v1','[]',1,10000,1000000,1000000,?,?)").run(f.at,f.at);
 f.db.prepare("INSERT INTO thesis_execution_dispatches(id,run_id,attempt,user_id,unit_id,kind,unit_attempt,status,reserved_tokens,reserved_cost_micros,charged_tokens,charged_cost_micros,input_tokens,output_tokens,cost_micros,created_at,finished_at) VALUES('prev2','paid2',1,'u','unit','section',1,'completed',2000,300000,1500,120000,1200,300,120000,?,?)").run(f.at,f.at);
 const next=ledger.open({userId:'u',thesisId:'t',paidRunId:'paid2'});assert.notEqual(next.id,original.id);assert.equal(next.usedTokens,1500);assert.equal(next.remainingTokens,8500);assert.equal(ledger.open({userId:'u',thesisId:'t',paidRunId:'paid'}).id,original.id);
});

test('伪造完整报告和取消中的任务都不接受',t=>{const f=fixture(t);f.db.exec("UPDATE theses SET status='cancelling' WHERE id='t'");assert.throws(()=>f.life.enqueue(f.request),{status:409});f.db.exec("UPDATE theses SET status='completed' WHERE id='t'");const created=f.life.enqueue(f.request),run=start(f,created.runId);const forged={status:'completed',coverage:{complete:true},supplementCheck:{coverage:{complete:true}},snapshotHash:run.snapshot_hash,manuscriptHash:'fake'};assert.throws(()=>f.life.finish(run,forged),{code:'review_incomplete'});f.db.prepare("UPDATE jobs SET attempt=2 WHERE id=?").run(run.id);assert.equal(f.life.current(run),false);});

test('默认关闭的公开接口只接受版本/幂等键，启用后服务与 worker 只读完成且不重复收费',async t=>{
 const f=fixture(t),user={id:'u'};let calls=0;
 f.config.getAgentSettings=version=>!version||version==='v1'?{...f.request.settings}:null;
 f.config.agentTaskRunner=async()=>{calls++;return {text:'{}',usage:{input:100,output:100},costUsd:.01}};
 f.config.thesisReviewQualityRunner=async args=>{await args.dispatch({task:{skill:'writing-review',context:{}},settings:{...args.runtime,maxTotalTokens:2000},unitId:'check-1',validateReviewOutput:async()=>({valid:true})});return {status:'completed',coverage:{complete:true},supplementCheck:{status:'final_ready',coverage:{complete:true},items:[]},reviews:[],consistency:{findings:[]}};};
 const service=createThesisService(f.db,f.config),request=async(body,u=user)=>service.handle({path:'/api/theses/t/completion/recheck',method:'POST',user:u,readBody:async()=>body});
 await assert.rejects(request({version:1,clientKey:'review-key',task:{}}),{status:400});await assert.rejects(request({version:1,clientKey:'review-key'}, {id:'other'}),{status:404});
 const opened=await request({version:1,clientKey:'review-key'});const id=opened.value.item.job.id;assert.equal(opened.status,202);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);
 const worker=startThesisWorker(f.db,f.config);t.after(()=>worker.stop());await worker.tick();
 const run=f.db.prepare('SELECT * FROM thesis_runs WHERE id=?').get(id);assert.equal(run.status,'completed');assert.equal(calls,1);assert.equal(run.provider_calls,1);assert.equal(run.input_tokens,100);assert.equal(run.output_tokens,100);assert.equal(run.usage_known,1);assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_chapter_versions').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts WHERE job_id=?').get(id).n,0);assert.equal(service.get('t',user).completionReview.billingStatus,'included');assert.equal(f.db.prepare("SELECT status FROM thesis_runs WHERE id='paid'").get().status,'completed');
});

test('运行中取消会回收会话并保留未知用量，不影响原付款与正文',async t=>{
 const f=fixture(t),user={id:'u'};let started;const startedPromise=new Promise(resolve=>{started=resolve});
 f.config.getAgentSettings=()=>({...f.request.settings});f.config.agentTaskRunner=({signal})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{code:'cancelled'})),{once:true});});
 f.config.thesisReviewQualityRunner=async args=>{await args.dispatch({task:{skill:'writing-review',context:{}},settings:{...args.runtime,maxTotalTokens:2000},unitId:'check-1',validateReviewOutput:async()=>({valid:true})});return {status:'completed',coverage:{complete:true},supplementCheck:{coverage:{complete:true}}};};
 const service=createThesisService(f.db,f.config),send=(path,body)=>service.handle({path,method:'POST',user,readBody:async()=>body});const opened=await send('/api/theses/t/completion/recheck',{version:1,clientKey:'cancel-review-key'}),id=opened.value.item.job.id,worker=startThesisWorker(f.db,f.config);f.config.cancelThesisRun=x=>worker.cancel(x);t.after(()=>worker.stop());const working=worker.tick();await startedPromise;
 const current=service.get('t',user);await send('/api/theses/t/cancel',{version:current.version});await working;
 assert.equal(f.db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(id).status,'cancelled');assert.equal(f.db.prepare('SELECT status FROM thesis_review_session_dispatches').get().status,'interrupted');assert.equal(f.db.prepare("SELECT status FROM billing_reservations WHERE id='charge'").get().status,'settled');assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);assert.equal(f.db.prepare("SELECT text FROM thesis_chapter_versions WHERE id='ver'").get().text,'原始正文');
});

test('运行中流水污染仍可取消，保留未知成本并提示联系支持',async t=>{
 const f=fixture(t),user={id:'u'};let started;const startedPromise=new Promise(resolve=>{started=resolve});
 f.config.getAgentSettings=()=>({...f.request.settings});f.config.agentTaskRunner=({signal})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{code:'cancelled'})),{once:true});});
 f.config.thesisReviewQualityRunner=async args=>{await args.dispatch({task:{skill:'writing-review',context:{}},settings:{...args.runtime,maxTotalTokens:2000},unitId:'check-1',validateReviewOutput:async()=>({valid:true})});return {status:'completed',coverage:{complete:true},supplementCheck:{coverage:{complete:true}}};};
 const service=createThesisService(f.db,f.config),send=(path,body)=>service.handle({path,method:'POST',user,readBody:async()=>body}),opened=await send('/api/theses/t/completion/recheck',{version:1,clientKey:'corrupt-cancel-key'}),id=opened.value.item.job.id,worker=startThesisWorker(f.db,f.config);f.config.cancelThesisRun=x=>worker.cancel(x);t.after(()=>worker.stop());const working=worker.tick();await startedPromise;f.db.prepare('UPDATE usage SET user_id=?,billable=1,input_tokens=123 WHERE job_id=?').run('other',id);const current=service.get('t',user);const cancelled=await send('/api/theses/t/cancel',{version:current.version});await working;
 assert.equal(cancelled.value.item.job.status,'cancelled');assert.match(cancelled.value.item.job.error,/联系支持.*未额外扣费/);assert.equal(f.db.prepare('SELECT status FROM thesis_review_session_dispatches').get().status,'interrupted');assert.deepEqual({...f.db.prepare('SELECT user_id,billable,input_tokens FROM usage WHERE job_id=?').get(id)},{user_id:'other',billable:1,input_tokens:123});assert.equal(f.db.prepare("SELECT status FROM billing_reservations WHERE id='charge'").get().status,'settled');assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);
});

test('进程停止时复查任务中断并保留已启动调用成本',async t=>{
 const f=fixture(t),user={id:'u'};let started;const startedPromise=new Promise(resolve=>{started=resolve});
 f.config.getAgentSettings=()=>({...f.request.settings});f.config.agentTaskRunner=({signal})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(Object.assign(Error('stopped'),{code:'cancelled'})),{once:true});});
 f.config.thesisReviewQualityRunner=async args=>{await args.dispatch({task:{skill:'writing-review',context:{}},settings:{...args.runtime,maxTotalTokens:2000},unitId:'check-1',validateReviewOutput:async()=>({valid:true})});return {status:'completed',coverage:{complete:true},supplementCheck:{coverage:{complete:true}}};};
 const service=createThesisService(f.db,f.config),opened=await service.handle({path:'/api/theses/t/completion/recheck',method:'POST',user,readBody:async()=>({version:1,clientKey:'stop-review-key'})}),id=opened.value.item.job.id,worker=startThesisWorker(f.db,f.config),running=worker.tick();await startedPromise;await worker.stop();await running;
 assert.equal(f.db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(id).status,'interrupted');const dispatch=f.db.prepare('SELECT status,input_tokens,cost_micros,charged_tokens FROM thesis_review_session_dispatches').get();assert.ok(['interrupted','failed'].includes(dispatch.status));assert.equal(dispatch.input_tokens,null);assert.equal(dispatch.cost_micros,null);assert.ok(dispatch.charged_tokens>0);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);
});

test('公开接口默认关闭且拒绝来自用户的费用、任务或身份字段',async t=>{const f=fixture(t,false),user={id:'u'},service=createThesisService(f.db,f.config);const call=body=>service.handle({path:'/api/theses/t/completion/recheck',method:'POST',user,readBody:async()=>body});await assert.rejects(call({version:1,clientKey:'disabled-key'}),{code:'review_disabled'});f.config.thesisReviewOnlyEnabled=true;const next=createThesisService(f.db,f.config);for(const key of ['task','runner','costUsd','usage','userId','paidRunId'])await assert.rejects(next.handle({path:'/api/theses/t/completion/recheck',method:'POST',user,readBody:async()=>({version:1,clientKey:'no-unsafe-key',[key]:'bad'})}),{status:400});assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_runs').get().n,1);});

test('服务重启时停止正在运行的复查并安全回收预算，历史报告保留',async t=>{const f=fixture(t),user={id:'u'};f.config.getAgentSettings=()=>({...f.request.settings});const service=createThesisService(f.db,f.config),opened=await service.handle({path:'/api/theses/t/completion/recheck',method:'POST',user,readBody:async()=>({version:1,clientKey:'restart-review'})}),id=opened.value.item.job.id;start(f,id);const worker=startThesisWorker(f.db,f.config);t.after(()=>worker.stop());assert.equal(f.db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(id).status,'interrupted');assert.equal(f.db.prepare("SELECT status FROM thesis_runs WHERE id='paid'").get().status,'completed');assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);});

test('同一论文补充研究问题、方法和资料后可沿用已付服务复查',t=>{const f=fixture(t);const changed={...f.snapshot,profile:{...f.snapshot.profile,researchQuestion:'修正后的研究问题',method:'补充的研究方法',direction:'细化研究方向',targetWords:9000},materials:[{id:'material',name:'补充资料',text:'尚待核实的用户说明',confirmed:true}],outline:[{...f.snapshot.outline[0],targetWords:500,sourceIds:['material']}]};f.db.prepare('UPDATE theses SET snapshot=?,snapshot_hash=? WHERE id=?').run(JSON.stringify(changed),thesisHash(changed),'t');const run=f.life.enqueue(f.request);assert.equal(run.created,true);const stored=JSON.parse(f.db.prepare('SELECT snapshot FROM thesis_runs WHERE id=?').get(run.runId).snapshot);assert.equal(stored.profile.method,'补充的研究方法');assert.equal(stored.materials[0].text,'尚待核实的用户说明');assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);});

test('不同题目、学位、写作模式或章节结构不能沿用原服务',t=>{for(const change of [s=>({...s,title:'另一篇论文'}),s=>({...s,profile:{...s.profile,level:'博士'}}),s=>({...s,requirements:{...s.requirements,contentMode:'rich'}}),s=>({...s,outline:[{...s.outline[0],title:'不同章节'}]}),s=>({...s,outline:[...s.outline,{id:'other',title:'新章节'}]}),s=>({...s,outline:[{...s.outline[0],sections:[{id:'s1',title:'新增小节'}]}]})]){const f=fixture(t),changed=change(f.snapshot);f.db.prepare('UPDATE theses SET snapshot=?,snapshot_hash=? WHERE id=?').run(JSON.stringify(changed),thesisHash(changed),'t');assert.throws(()=>f.life.enqueue(f.request),{code:'review_study_changed'});assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);}});

test('补充新方法后资料仍须检查，缺失证据不允许确认终稿',async t=>{const f=fixture(t),changed={...f.snapshot,profile:{...f.snapshot.profile,method:'用户自述尚无验证的实验方法'}};f.db.prepare('UPDATE theses SET snapshot=?,snapshot_hash=? WHERE id=?').run(JSON.stringify(changed),thesisHash(changed),'t');f.config.getAgentSettings=()=>({...f.request.settings});f.config.thesisReviewQualityRunner=async args=>{assert.equal(args.snapshot.profile.method,'用户自述尚无验证的实验方法');return {status:'completed',coverage:{complete:true},supplementCheck:{status:'needs_materials',coverage:{complete:true},items:[{id:'c',title:'第一章',status:'missing',missing:['方法的实际记录']}]},reviews:[],consistency:{findings:[]}};};const service=createThesisService(f.db,f.config),opened=await service.handle({path:'/api/theses/t/completion/recheck',method:'POST',user:{id:'u'},readBody:async()=>({version:1,clientKey:'new-method-review'})}),worker=startThesisWorker(f.db,f.config);t.after(()=>worker.stop());await worker.tick();assert.equal(f.db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(opened.value.item.job.id).status,'completed');const review=service.get('t',{id:'u'}).completionReview;assert.equal(review.status,'needs_materials');assert.equal(review.checks.materials,false);assert.equal(review.fingerprint,null);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);});

test('任务中心区分终稿检查和历史论文撰写，其他账户不可读取论文身份',async t=>{const {workspaceDocumentStates}=await import('../backend/workspace-document-state.mjs'),{workspaceJobLabel,workspaceJobHref}=await import('../dist/workspace/workspace-job-model.mjs');const f=fixture(t),created=f.life.enqueue(f.request);const jobs=f.db.prepare('SELECT id,type,status FROM jobs ORDER BY id').all(),owned=workspaceDocumentStates(f.db,jobs,'u'),review=owned.find(item=>item.id===created.runId),paid=owned.find(item=>item.id==='paid');assert.equal(workspaceJobLabel(review),'终稿检查');assert.equal(workspaceJobLabel(paid),'毕业论文撰写');assert.equal(review.thesis_operation,'final_review');assert.equal(workspaceJobHref({...review,thesis_id:'t'}),'#thesis/t');assert.equal(workspaceDocumentStates(f.db,jobs,'other').find(item=>item.id===created.runId).documentTitle,undefined);});

test('复查资格只对有正文和本账户已付终稿显示，旧版或关闭功能不暴露入口',t=>{const f=fixture(t),service=createThesisService(f.db,f.config),item=service.get('t',{id:'u'});assert.deepEqual(item.recheck,{enabled:true,eligible:true});assert.throws(()=>service.get('t',{id:'other'}),{status:404});const disabled=createThesisService(f.db,{...f.config,thesisReviewOnlyEnabled:false});assert.equal(disabled.get('t',{id:'u'}).recheck,undefined);});

test('环境配置关闭后遗留复查也可安全中止并回收，不开放入口',async t=>{const f=fixture(t),user={id:'u'};f.config.thesisReviewOnlyEnabled=environmentConfig({PK_THESIS_REVIEW_ONLY_ENABLED:'1'}).thesisReviewOnlyEnabled;f.config.getAgentSettings=()=>({...f.request.settings});const service=createThesisService(f.db,f.config),opened=await service.handle({path:'/api/theses/t/completion/recheck',method:'POST',user,readBody:async()=>({version:1,clientKey:'disable-queued'})}),id=opened.value.item.job.id;f.config.thesisReviewOnlyEnabled=environmentConfig({}).thesisReviewOnlyEnabled;const worker=startThesisWorker(f.db,f.config);t.after(()=>worker.stop());await worker.tick();assert.equal(f.db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(id).status,'failed');assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);const closed=createThesisService(f.db,f.config);await assert.rejects(closed.handle({path:'/api/theses/t/completion/recheck',method:'POST',user,readBody:async()=>({version:1,clientKey:'disable-again'})}),{code:'review_disabled'});});
