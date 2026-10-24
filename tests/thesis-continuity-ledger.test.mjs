import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createThesisContinuity} from '../backend/thesis-continuity.mjs';

const settings={version:'synthetic-runtime-v1',maxTurns:12,maxOutputTokens:4096,maxCostUsd:.5};
const snapshot={title:'连续写作合成测试',profile:{language:'中文',targetWords:8000},outline:[],materials:[],references:[],requirements:{}};
const plan=Array.from({length:20},(_,position)=>({id:'u-'+position,targetWords:400,position}));
function fixture(t,config={}){
 const folder=mkdtempSync(join(tmpdir(),'paperknow-ledger-')),path=join(folder,'ledger.sqlite');let db=new DatabaseSync(path);
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY);
 CREATE TABLE theses(id TEXT PRIMARY KEY,user_id TEXT,current_run_id TEXT,status TEXT);
 CREATE TABLE thesis_runs(id TEXT PRIMARY KEY,thesis_id TEXT,user_id TEXT,attempt INTEGER,status TEXT,settings_version TEXT);
 INSERT INTO users VALUES('alice'),('bob');
 INSERT INTO theses VALUES('thesis-a','alice','run-a','running'),('thesis-b','bob','run-b','running');
 INSERT INTO thesis_runs VALUES('run-a','thesis-a','alice',1,'running','synthetic-runtime-v1'),('run-b','thesis-b','bob',1,'running','synthetic-runtime-v1');`);
 let ledger=createThesisContinuity(db,config);
 const current=()=>db.prepare("SELECT * FROM thesis_runs WHERE id='run-a'").get();
 const init=(options=settings)=>ledger.ensure(current(),snapshot,plan,options);
 const reserve=(unit='u-0',options={})=>ledger.reserve(current(),unit,{remainingUnits:20,settings,...options});
 t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
 return {get db(){return db;},get ledger(){return ledger;},run:current,init,reserve,reopen(){db.close();db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON');ledger=createThesisContinuity(db,config);}};
}

test('the original run and attempt freeze whole-paper token and cost ceilings durably',t=>{
 const f=fixture(t),first=f.init();assert.equal(first.created,true);assert.ok(first.tokenLimit>400000);assert.equal(first.costLimit,13.5);assert.equal(first.reviewBatchAllowance,2);assert.equal(first.remainingTokens,first.tokenLimit);
 const changed=createThesisContinuity(f.db,{thesisMaxRunTokens:2000000,thesisMaxRunCostUsd:50}).ensure(f.run(),snapshot,plan,{...settings,maxCostUsd:5});
 assert.equal(changed.created,false);assert.equal(changed.tokenLimit,first.tokenLimit);assert.equal(changed.costLimit,first.costLimit);
 assert.throws(()=>f.db.prepare("UPDATE thesis_execution_budgets SET token_limit=2000000 WHERE run_id='run-a'").run(),/不可扩展/);
 assert.throws(()=>f.ledger.ensure({...f.run(),user_id:'bob'},snapshot,plan,settings),error=>error.status===404);
 assert.throws(()=>f.reserve('unplanned-unit'),error=>error.code==='invalid_execution_unit');
 assert.throws(()=>f.ledger.reserve(f.run(),'u-0',{remainingUnits:20,settings:{...settings,version:'changed-runtime'}}),error=>error.code==='execution_settings_changed');
 assert.equal(f.reserve('u-0',{settings:{...settings,maxCostUsd:5}}).maxCostUsd,.5,'reconstructing the same configuration version cannot widen the frozen per-dispatch cap');
});

test('each dispatch reserves before execution and known actual usage replaces the reservation exactly once',t=>{
 const f=fixture(t),initial=f.init(),dispatch=f.reserve(),held=f.ledger.summary(f.run());
 assert.equal(held.remainingTokens,initial.tokenLimit-dispatch.maxTotalTokens);assert.equal(held.remainingCostUsd,13);assert.equal(held.inFlight,1);
 assert.throws(()=>f.reserve('u-1'),error=>error.code==='execution_in_flight');
 const done=f.ledger.finish(dispatch.id,{usage:{input:1200,output:800},costUsd:.003});assert.equal(done.usageKnown,true);assert.equal(done.costKnown,true);assert.equal(done.exceeded,false);assert.equal(done.remainingTokens,initial.tokenLimit-2000);assert.equal(done.remainingCostUsd,13.497);
 const repeated=f.ledger.finish(dispatch.id,{usage:{input:1,output:1},costUsd:0,errorCode:'invalid_json'});assert.equal(repeated.status,'completed');assert.equal(repeated.remainingTokens,done.remainingTokens);assert.equal(repeated.remainingCostUsd,done.remainingCostUsd);
 assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_execution_dispatches').get().n,1);
});

test('unknown usage and unknown cost independently retain their full reservations instead of becoming zero',t=>{
 const f=fixture(t),initial=f.init(),one=f.reserve();
 const tokenUnknown=f.ledger.finish(one.id,{usage:null,costUsd:.002,errorCode:'provider_error'});assert.equal(tokenUnknown.usageKnown,false);assert.equal(tokenUnknown.remainingTokens,initial.tokenLimit-one.maxTotalTokens);assert.equal(tokenUnknown.remainingCostUsd,13.498);
 const two=f.reserve('u-1'),costUnknown=f.ledger.finish(two.id,{usage:{input:10,output:20},costUsd:null});assert.equal(costUnknown.costKnown,false);assert.equal(costUnknown.remainingCostUsd,12.998);assert.equal(costUnknown.remainingTokens,initial.tokenLimit-one.maxTotalTokens-30);
 const three=f.reserve('u-2'),bothUnknown=f.ledger.finish(three.id,{usage:{input:-1,output:2},costUsd:NaN,errorCode:'upstream-secret-should-not-be-stored'});
 assert.equal(bothUnknown.lastReason,'execution_failed');assert.equal(bothUnknown.remainingTokens,costUnknown.remainingTokens-three.maxTotalTokens);assert.equal(bothUnknown.remainingCostUsd,12.498);
 const row=f.db.prepare('SELECT input_tokens,output_tokens,cost_micros,error_code FROM thesis_execution_dispatches WHERE id=?').get(three.id);assert.equal(row.input_tokens,null);assert.equal(row.output_tokens,null);assert.equal(row.cost_micros,null);assert.equal(row.error_code,'execution_failed');
});

test('all-zero provider usage is unverified and cannot release the token reservation or create a completed dispatch',t=>{
 const f=fixture(t),initial=f.init(),dispatch=f.reserve(),finished=f.ledger.finish(dispatch.id,{usage:{input:0,output:0},costUsd:.001,errorCode:'usage_unknown'});
 assert.equal(finished.status,'failed');assert.equal(finished.usageKnown,false);assert.equal(finished.costKnown,true);assert.equal(finished.remainingTokens,initial.tokenLimit-dispatch.maxTotalTokens);assert.equal(finished.usedTokens,dispatch.maxTotalTokens);assert.equal(finished.usedCostUsd,.001);
 const row=f.db.prepare('SELECT status,input_tokens,output_tokens,charged_tokens,reserved_tokens FROM thesis_execution_dispatches WHERE id=?').get(dispatch.id);assert.equal(row.status,'failed');assert.equal(row.input_tokens,null);assert.equal(row.output_tokens,null);assert.equal(row.charged_tokens,row.reserved_tokens);
 const repeated=f.ledger.finish(dispatch.id,{usage:{input:10,output:10},costUsd:0});assert.equal(repeated.usageKnown,false);assert.equal(repeated.remainingTokens,finished.remainingTokens);
});

test('a real database reopen recovers unfinished dispatches without releasing their unknown spend or replaying them twice',t=>{
 const f=fixture(t),initial=f.init(),one=f.reserve();f.reopen();
 const recovered=f.ledger.recover(f.run());assert.equal(recovered.ready,true);assert.equal(recovered.recoveredDispatches,1);assert.equal(recovered.recoveries,1);assert.equal(recovered.automaticRetries,1);assert.equal(recovered.remainingTokens,initial.tokenLimit-one.maxTotalTokens);assert.equal(recovered.remainingCostUsd,13);assert.equal(recovered.inFlight,0);
 const again=f.ledger.recover(f.run());assert.equal(again.recoveredDispatches,0);assert.equal(again.recoveries,1);assert.equal(again.remainingCostUsd,recovered.remainingCostUsd);
 const late=f.ledger.finish(one.id,{usage:{input:1,output:1},costUsd:0});assert.equal(late.status,'interrupted');assert.equal(late.costKnown,false);assert.equal(late.remainingTokens,recovered.remainingTokens,'a late callback cannot reclaim an already frozen interrupted reservation');
 const retry=f.reserve();assert.equal(retry.unitAttempt,2);const done=f.ledger.finish(retry.id,{usage:{input:100,output:100},costUsd:.002});assert.equal(done.automaticRetries,1,'the recovery and its redispatch count as one automatic retry');
});

test('a section has at most three dispatches and review batches also cover the twelve-section grouping limit',t=>{
 const f=fixture(t);f.init();
 for(let attempt=1;attempt<=3;attempt++){const call=f.reserve();assert.equal(call.unitAttempt,attempt);f.ledger.finish(call.id,{usage:{input:10,output:10},costUsd:.001,errorCode:'invalid_json'});}
 assert.throws(()=>f.reserve(),error=>error.status===429&&error.code==='retry_limit');assert.equal(f.ledger.summary(f.run()).automaticRetries,2);
 assert.equal(f.ledger.recover(f.run()).ready,false,'a crash between a final failed dispatch and worker termination cannot grant a fourth dispatch');
 const review=f.reserve('final-review',{kind:'review'});f.ledger.finish(review.id,{usage:{input:10,output:10},costUsd:.001});
 assert.throws(()=>f.reserve('final-review',{kind:'review'}),error=>error.code==='retry_limit');
 const another=f.reserve('another-review-name',{kind:'review'});f.ledger.finish(another.id,{usage:{input:10,output:10},costUsd:.001});
 assert.throws(()=>f.reserve('third-review-name',{kind:'review'}),error=>error.code==='retry_limit');
});

test('long English manuscripts freeze enough review batches for complete coverage without widening per-call or total cost limits',t=>{
 const f=fixture(t),long={...snapshot,profile:{language:'English',targetWords:80000}},initial=f.ledger.ensure(f.run(),long,plan,settings);
 assert.equal(initial.reviewBatchAllowance,22);assert.equal(initial.costLimit,23.5);
 for(let index=0;index<22;index++){
  const review=f.reserve('review-'+index,{kind:'review',remainingUnits:22-index});assert.equal(review.maxCostUsd,.5);assert.equal(review.unitAttempt,1);f.ledger.finish(review.id,{usage:{input:10,output:10},costUsd:.001});
  if(!index)assert.throws(()=>f.reserve('review-0',{kind:'review'}),error=>error.code==='retry_limit');
 }
 assert.throws(()=>f.reserve('review-22',{kind:'review'}),error=>error.code==='retry_limit');
 assert.throws(()=>f.db.prepare("UPDATE thesis_execution_budgets SET review_allowance=24 WHERE run_id='run-a'").run(),/不可扩展/);
 const unchanged=f.ledger.ensure(f.run(),{...long,profile:{language:'English',targetWords:1000000}},plan,{...settings,maxCostUsd:5});assert.equal(unchanged.reviewBatchAllowance,22);assert.equal(unchanged.costLimit,23.5);
});

test('an 8000-character thesis with seventeen or twenty writing units preallocates both review batches',t=>{
 for(const units of [17,20]){const f=fixture(t),state=f.ledger.ensure(f.run(),snapshot,plan.slice(0,units),settings);assert.equal(state.reviewBatchAllowance,2);assert.equal(state.costLimit,.5*(units*1.25+2));}
});

test('review planning respects explicit lower cost ceilings and the global 50-dollar ceiling',t=>{
 const f=fixture(t,{thesisMaxRunCostUsd:.02}),long={...snapshot,profile:{language:'English',targetWords:80000}};
 assert.equal(f.ledger.ensure(f.run(),long,plan,settings).costLimit,.02);
 const other=fixture(t),largePlan=Array.from({length:120},(_,position)=>({id:'long-'+position,targetWords:700})),value=other.ledger.ensure(other.run(),long,largePlan,settings);assert.equal(value.reviewBatchAllowance,22);assert.equal(value.costLimit,50);
 const clamped=fixture(t),huge={...snapshot,profile:{language:'English',targetWords:1000000}};assert.equal(clamped.ledger.ensure(clamped.run(),huge,plan,settings).reviewBatchAllowance,24);
});

test('an interrupted optional review preserves its reservation and allows the manuscript to resume with a partial review',t=>{
 const f=fixture(t),initial=f.init(),review=f.reserve('review-0',{kind:'review'});f.reopen();
 const recovered=f.ledger.recover(f.run());assert.equal(recovered.ready,true);assert.equal(recovered.recoveredDispatches,1);assert.equal(recovered.remainingTokens,initial.tokenLimit-review.maxTotalTokens);
 assert.throws(()=>f.reserve('review-0',{kind:'review'}),error=>error.code==='retry_limit');
 const section=f.reserve('u-0');assert.equal(section.unitAttempt,1);assert.equal(f.ledger.finish(section.id,{usage:{input:10,output:10},costUsd:.001}).status,'completed');
});

test('unknown per-call costs consume the frozen whole-paper dollar pool and cannot create unlimited retries',t=>{
 const f=fixture(t);assert.equal(f.init().costLimit,13.5);
 for(let index=0;index<27;index++){const dispatch=f.reserve('u-'+(index%20));f.ledger.finish(dispatch.id,{usage:{input:1,output:1},costUsd:null});}
 const state=f.ledger.summary(f.run());assert.equal(state.usedCostUsd,13.5);assert.equal(state.remainingCostUsd,0);assert.ok(state.remainingTokens>1000);
 assert.throws(()=>f.reserve('u-10'),error=>error.code==='cost_budget');
});

test('explicit small budgets stop additional dispatches and an observed overrun is accounted without widening the ceiling',t=>{
 const f=fixture(t,{thesisMaxRunTokens:1000,thesisMaxRunCostUsd:.02}),initial=f.init();assert.equal(initial.tokenLimit,1000);assert.equal(initial.costLimit,.02);
 const dispatch=f.reserve();assert.equal(dispatch.maxTotalTokens,1000);assert.equal(dispatch.maxCostUsd,.02);
 const done=f.ledger.finish(dispatch.id,{usage:{input:900,output:200},costUsd:.021});assert.equal(done.budgetExceeded,true);assert.equal(done.exceeded,true);assert.equal(done.usedTokens,1100);assert.equal(done.usedCostUsd,.021);assert.equal(done.remainingTokens,0);assert.equal(done.remainingCostUsd,0);assert.equal(done.tokenLimit,1000);assert.equal(done.costLimit,.02);
 assert.equal(f.ledger.finish(dispatch.id,{usage:{input:0,output:0},costUsd:0}).budgetExceeded,true);
 assert.throws(()=>f.reserve('u-1'),error=>error.code==='budget_exceeded');
});

test('the global cost cap, exhausted recovery and cancellation forbid further automatic work',t=>{
 const f=fixture(t),wide={...settings,maxCostUsd:5};assert.equal(f.init(wide).costLimit,50);
 for(let count=0;count<3;count++){const call=f.reserve('u-0',{settings:wide});const restored=f.ledger.recover(f.run());if(count<2)assert.equal(restored.ready,true);else assert.equal(restored.ready,false);assert.equal(f.db.prepare('SELECT status FROM thesis_execution_dispatches WHERE id=?').get(call.id).status,'interrupted');}
 assert.throws(()=>f.reserve('u-0',{settings:wide}),error=>error.code==='retry_limit');
 f.db.prepare("UPDATE thesis_runs SET status='cancelled' WHERE id='run-a'").run();assert.equal(f.ledger.recover(f.run()).ready,false);assert.throws(()=>f.reserve('u-1',{settings:wide}),error=>error.code==='execution_not_running');
});

test('manual continuation has a separate immutable attempt and stale or foreign identities cannot reuse it',t=>{
 const f=fixture(t),legacy=f.ledger.recover(f.run());assert.equal(f.ledger.summary(f.run()),null);assert.equal(legacy.ready,false);assert.equal(legacy.lastReason,'continuity_unavailable');f.init();
 const old=f.run(),one=f.reserve();f.ledger.finish(one.id,{usage:{input:10,output:20},costUsd:.001});
 f.db.prepare("UPDATE thesis_runs SET attempt=2 WHERE id='run-a'").run();
 assert.throws(()=>f.ledger.summary(old),error=>error.code==='execution_attempt_changed');
 const next=f.init();assert.equal(next.created,true);assert.equal(next.usedTokens,0);assert.equal(next.dispatches,0);assert.equal(next.automaticRetries,0);
 assert.throws(()=>f.ledger.summary({...f.run(),user_id:'bob'}),error=>error.status===404);
 assert.equal(f.db.prepare("SELECT count(*) n FROM thesis_execution_budgets WHERE run_id='run-a'").get().n,2);
});

test('fresh context headroom uses the original pool and a rejected window can be funded without changing its completed reservation',t=>{
 const f=fixture(t),initial=f.init(),one=f.reserve();
 assert.ok(one.maxTotalTokens>=480000);assert.ok(one.maxTotalTokens<initial.tokenLimit);
 f.ledger.finish(one.id,{usage:{input:170687,output:11617},costUsd:.1,errorCode:'budget_exceeded'});
 const row=f.db.prepare('SELECT * FROM thesis_execution_dispatches WHERE id=?').get(one.id);
 const next=f.reserve('u-0',{minimumTokens:700000});assert.ok(next.maxTotalTokens>=700000);
 assert.equal(next.unitAttempt,2);assert.equal(next.maxCostUsd,.5);assert.equal(f.ledger.summary(f.run()).tokenLimit,initial.tokenLimit);
 assert.deepEqual(f.db.prepare('SELECT * FROM thesis_execution_dispatches WHERE id=?').get(one.id),row);
 f.ledger.finish(next.id,{usage:{input:100,output:100},costUsd:.001});
 const remaining=f.ledger.summary(f.run()).remainingTokens;
 assert.throws(()=>f.reserve('u-1',{minimumTokens:remaining+1}),error=>error.code==='budget_exceeded');
 for(const minimumTokens of [-1,1.5,2000001,NaN])assert.throws(()=>f.reserve('u-1',{minimumTokens}),error=>error.code==='invalid_execution_budget');
 assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_execution_dispatches').get().n,2,'Denied headroom must not dispatch or create a reservation');
});
