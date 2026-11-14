import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewSavedThesis} from '../backend/thesis-review-only.mjs';
import {completionManuscriptHash} from '../backend/thesis-completion.mjs';

const fixture=()=>({snapshot:{title:'测试论文',profile:{},requirements:{},references:[],materials:[],outline:[{id:'one',title:'正文'}]},chapters:[{id:'one',title:'正文',text:'这是已保存的正文。',figures:[]}],row:{export_metadata:'{}'},runtime:{},runId:'test-run',dispatch:async()=>({text:'ok'}),isCurrent:async()=>true});

test('只读检查使用全部已保存正文，不执行正文生成并保留调用方数据',async()=>{
 const input=fixture(),before=structuredClone(input.chapters);let seen;
 const report=await reviewSavedThesis({...input,qualityRunner:async args=>{seen=args;args.chapters[0].text='模型不能覆盖已保存正文';return {status:'partial',coverage:{complete:false},supplementCheck:{coverage:{complete:false}}};}});
 assert.deepEqual(input.chapters,before);assert.equal(seen.kind,'thesis');assert.equal(seen.checkSupplements,true);assert.equal(report.manuscriptHash,completionManuscriptHash(before));assert.equal(report.status,'partial');assert.equal(report.completionAudit.ready,false);
});

test('论文变动或取消后不得提交检查结果',async()=>{
 const input=fixture();let current=true;
 await assert.rejects(reviewSavedThesis({...input,isCurrent:async()=>current,qualityRunner:async()=>{current=false;return {status:'completed'};}}),error=>error.code==='review_changed');
 const controller=new AbortController();controller.abort();await assert.rejects(reviewSavedThesis({...input,signal:controller.signal,qualityRunner:async()=>({})}),error=>error.code==='review_changed');
});

test('任何模型调用必须经过调用方提供的调度器',async()=>{
 const input=fixture();let called=0;
 const report=await reviewSavedThesis({...input,dispatch:async()=>{called++;return {text:'checked'};},qualityRunner:async args=>{await args.dispatch({task:{}});return {status:'partial',coverage:{complete:false},supplementCheck:{coverage:{complete:false}}};}});
 assert.equal(called,1);assert.equal(report.status,'partial');
 await assert.rejects(reviewSavedThesis({...input,dispatch:null,qualityRunner:async()=>({})}),/信息不完整/);
});

test('材料和章节检查过程中变更都不能产生结果',async()=>{
 for(const field of ['snapshot','chapters']){
  const input=fixture(),original=JSON.stringify(input[field]);let state=input[field];
  await assert.rejects(reviewSavedThesis({...input,isCurrent:async()=>JSON.stringify(state)===original,qualityRunner:async()=>{state=structuredClone(state);if(field==='snapshot')state.title='新资料';else state[0].text='修改后的正文';return {status:'completed'};}}),error=>error.code==='review_changed');
 }
});

test('模型失败或取消不返回任何报告，覆盖不全不能标记完成',async()=>{
 const input=fixture();
 await assert.rejects(reviewSavedThesis({...input,qualityRunner:async()=>{throw new Error('provider error');}}),/provider error/);
 const incomplete=await reviewSavedThesis({...input,qualityRunner:async()=>({status:'completed',coverage:{complete:true},supplementCheck:{coverage:{complete:false}}})});
 assert.equal(incomplete.status,'partial');assert.equal(incomplete.completionAudit.ready,false);
});

const {createSessionReviewDispatch}=await import('../backend/thesis-review-only.mjs');
const identity={userId:'u',thesisId:'p',sessionId:'s',reviewRunId:'r',attempt:1,isCurrent:async()=>true};
const request={task:{skill:'writing-review',context:{operation:'review'}},settings:{version:'v1',model:'test',engine:'engine',maxTotalTokens:3000,maxCostUsd:.1},unitId:'part-1',validateReviewOutput:async()=>({valid:true})};

test('复查必须原子预留预算，重复请求不会再次调用模型',async()=>{
 let calls=0,first=true,finished=0;
 const sessions={summary:()=>({remainingTokens:5000,remainingCostUsd:.5,settingsVersion:'v1',settingsModel:'test',settingsEngine:'engine'}),markStarted:()=>{},cancelBeforeDispatch:()=>{},reserve:()=>({id:'dispatch',created:first?(first=false,true):false}),finish:()=>{finished++;return {status:'completed',budgetExceeded:false}}};
 const dispatch=createSessionReviewDispatch({...identity,sessions,runner:async()=>{calls++;return {text:'ok',usage:{input:20,output:30},costUsd:.01};}});
 await dispatch(request);await assert.rejects(dispatch(request),error=>error.code==='review_dispatch_exists');assert.equal(calls,1);assert.equal(finished,1);
});

test('失败、取消和未知用量都交账本核算，不返回结果',async()=>{
 let received;const sessions={summary:()=>({remainingTokens:5000,remainingCostUsd:.5,settingsVersion:'v1',settingsModel:'test',settingsEngine:'engine'}),markStarted:()=>{},cancelBeforeDispatch:()=>{},reserve:()=>({id:'dispatch',created:true}),finish:args=>{received=args;return {status:'failed',budgetExceeded:false}}};
 const dispatch=createSessionReviewDispatch({...identity,sessions,runner:async()=>{throw Object.assign(new Error('failed'),{code:'provider_error'});}});
 await assert.rejects(dispatch(request),/failed/);assert.equal(received.errorCode,'provider_error');assert.equal(received.usage,undefined);
 const unknown=createSessionReviewDispatch({...identity,sessions,runner:async()=>({text:'bad'})});await assert.rejects(unknown(request),error=>error.code==='review_usage_unknown');
});

test('只能运行检查任务且超出预算或内容校验失败不得提交',async()=>{
 const sessions={summary:()=>({remainingTokens:5000,remainingCostUsd:.5,settingsVersion:'v1',settingsModel:'test',settingsEngine:'engine'}),markStarted:()=>{},cancelBeforeDispatch:()=>{},reserve:()=>({id:'dispatch',created:true}),finish:()=>({status:'completed',budgetExceeded:true})};
 const dispatch=createSessionReviewDispatch({...identity,sessions,runner:async()=>({text:'ok',usage:{input:20,output:30},costUsd:.01})});
 await assert.rejects(dispatch({...request,validateThesisOutput:async()=>({valid:true})}),/只读/);
 await assert.rejects(dispatch(request),error=>error.code==='review_budget_exhausted');
});

test('真实会话账本限定复查预算，不创建新站内扣费记录',async t=>{
 const {DatabaseSync}=await import('node:sqlite');const {createThesisReviewSessions}=await import('../backend/thesis-review-session.mjs');const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE thesis_runs(id TEXT PRIMARY KEY,thesis_id TEXT,user_id TEXT,status TEXT,attempt INTEGER,snapshot_hash TEXT,settings_version TEXT,settings_meta TEXT,provider_calls INTEGER NOT NULL DEFAULT 0,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,usage_known INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE theses(id TEXT PRIMARY KEY,user_id TEXT,current_run_id TEXT,snapshot_hash TEXT);
CREATE TABLE usage(id TEXT PRIMARY KEY,user_id TEXT,job_id TEXT UNIQUE,provider TEXT,model TEXT,input_tokens INTEGER,output_tokens INTEGER,billable INTEGER,created_at TEXT);
 CREATE TABLE billing_reservations(id TEXT PRIMARY KEY,job_id TEXT,user_id TEXT,status TEXT,source TEXT,type TEXT,attempt INTEGER);
 CREATE TABLE thesis_execution_budgets(run_id TEXT,attempt INTEGER,user_id TEXT,settings_version TEXT,token_limit INTEGER,cost_limit_micros INTEGER,unit_cost_micros INTEGER);
 CREATE TABLE thesis_execution_dispatches(run_id TEXT,attempt INTEGER,user_id TEXT,status TEXT,reserved_tokens INTEGER,reserved_cost_micros INTEGER,charged_tokens INTEGER,charged_cost_micros INTEGER,input_tokens INTEGER,output_tokens INTEGER,cost_micros INTEGER);
 INSERT INTO theses VALUES('p','u',NULL,'snapshot');
 INSERT INTO thesis_runs(id,thesis_id,user_id,status,attempt,snapshot_hash,settings_version,settings_meta) VALUES('paid','p','u','completed',1,'snapshot','v1','{"version":"v1","model":"test","engine":"engine","completion":{"scope":"full","purpose":"completion"}}');
 INSERT INTO billing_reservations VALUES('bill','paid','u','settled','credits','agent',1);
 INSERT INTO thesis_execution_budgets VALUES('paid',1,'u','v1',10000,1000000,1000000);
 INSERT INTO thesis_execution_dispatches VALUES('paid',1,'u','completed',2000,300000,1000,100000,700,300,100000);`);
 const sessions=createThesisReviewSessions(db),session=sessions.open({userId:'u',thesisId:'p',paidRunId:'paid'});
 const meta=JSON.stringify({reviewOnly:true,reviewSessionId:session.id,model:'test',engine:'engine'});db.prepare("INSERT INTO thesis_runs(id,thesis_id,user_id,status,attempt,snapshot_hash,settings_version,settings_meta) VALUES('r','p','u','running',1,'snapshot','v1',?)").run(meta);db.exec("UPDATE theses SET current_run_id='r'");
 const dispatch=createSessionReviewDispatch({...identity,sessionId:session.id,sessions,runner:async()=>({text:'ok',usage:{input:20,output:30},costUsd:.01})});
 await dispatch(request);const summary=sessions.summary({userId:'u',thesisId:'p',sessionId:session.id});assert.equal(summary.usedTokens,1050);assert.equal(summary.usedCostUsd,.11);assert.equal(db.prepare('SELECT count(*) n FROM billing_reservations').get().n,1);
 await assert.rejects(dispatch(request),error=>error.code==='review_dispatch_exists');assert.equal(db.prepare('SELECT count(*) n FROM thesis_review_session_dispatches').get().n,1);
});

test('单次预算按已付会话剩余额缩小，传给模型的上限不超过预留',async()=>{
 let reserved,passed;const sessions={summary:()=>({remainingTokens:1000,remainingCostUsd:.03,settingsVersion:'v1',settingsModel:'test',settingsEngine:'engine'}),markStarted:()=>{},cancelBeforeDispatch:()=>{},reserve:args=>{reserved=args;return {id:'x',created:true}},finish:()=>({status:'completed',budgetExceeded:false})};
 const dispatch=createSessionReviewDispatch({...identity,sessions,runner:async args=>{passed=args.settings;return {text:'ok',usage:{input:20,output:30},costUsd:.01}}});await dispatch(request);assert.equal(reserved.reservedTokens,1000);assert.equal(reserved.reservedCostUsd,.03);assert.equal(passed.maxTotalTokens,1000);assert.equal(passed.maxCostUsd,.03);
});

test('预留后未调用模型即状态变化，零成本取消且不调用模型',async()=>{
 let check=0,cancelled=0,calls=0;const sessions={summary:()=>({remainingTokens:5000,remainingCostUsd:.5,settingsVersion:'v1',settingsModel:'test',settingsEngine:'engine'}),markStarted:()=>{},cancelBeforeDispatch:()=>{cancelled++},reserve:()=>({id:'x',created:true}),finish:()=>{throw Error('不应结算')}};
 const dispatch=createSessionReviewDispatch({...identity,isCurrent:async()=>++check===1,sessions,runner:async()=>{calls++;}});await assert.rejects(dispatch(request),error=>error.code==='review_changed');assert.equal(cancelled,1);assert.equal(calls,0);
});

test('版本、模型或引擎发生变化不能调用或预留',async()=>{
 let calls=0,reserves=0;const sessions={summary:()=>({remainingTokens:5000,remainingCostUsd:.5,settingsVersion:'v1',settingsModel:'test',settingsEngine:'engine'}),markStarted:()=>{},cancelBeforeDispatch:()=>{},reserve:()=>{reserves++;return {id:'x',created:true}},finish:()=>({status:'completed',budgetExceeded:false})};
 const dispatch=createSessionReviewDispatch({...identity,sessions,runner:async()=>{calls++;}});
 for(const [name,value] of [['version','v2'],['model','other'],['engine','other']])await assert.rejects(dispatch({...request,settings:{...request.settings,[name]:value}}),error=>error.code==='review_settings_changed');
 assert.equal(calls,0);assert.equal(reserves,0);
});
