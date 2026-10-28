import test from 'node:test';
import assert from 'node:assert/strict';
import {computeThesisRunBudget,sectionWordsForRuntime,classifyThesisRetry,thesisExecutionSettings,thesisRunTokenCeiling} from '../backend/thesis-execution-policy.mjs';
import {environmentConfig} from '../backend/config.mjs';

const settings={maxTurns:12,maxOutputTokens:4096};
const snapshot={title:'用于预算规划的合成论文',profile:{language:'中文',targetWords:8000},requirements:{},outline:[{title:'背景'},{title:'方法'},{title:'讨论'}],materials:[],references:[]};
const plan=count=>Array.from({length:count},(_,position)=>({id:'unit-'+position,targetWords:1000,position}));

test('a thesis-specific dollar ceiling changes only a copied runtime and rejects invalid configuration',()=>{
 const shared={...settings,maxCostUsd:.5,version:'frozen-model',model:'synthetic',apiKey:'synthetic-only'};
 assert.equal(thesisExecutionSettings(shared),shared);
 assert.deepEqual(thesisExecutionSettings(shared,1),{...shared,maxCostUsd:1});assert.equal(shared.maxCostUsd,.5);
 assert.equal(environmentConfig({PK_THESIS_MAX_CALL_COST_USD:'1',PK_AGENT_MAX_COST_USD:'.5'}).thesisMaxCallCostUsd,1);
 assert.equal(environmentConfig({}).thesisMaxCallCostUsd,undefined);
 for(const limit of [0,-1,5.01,NaN,Infinity,'1',null])assert.throws(()=>thesisExecutionSettings(shared,limit),error=>error.status===400);
});

test('a complete multi-unit thesis gets a bounded run budget instead of the same fixed short-task window',()=>{
 const small=computeThesisRunBudget({snapshot,plan:plan(2),settings}),large=computeThesisRunBudget({snapshot,plan:plan(20),settings});
 assert.equal(small,400000);assert.ok(large>small);assert.ok(large>2000000&&large<=thesisRunTokenCeiling);
 assert.ok(computeThesisRunBudget({snapshot,plan:plan(120),settings})>large);
});

test('operator-specified run caps are exact and invalid caps cannot silently widen to a default',()=>{
 for(const cap of [1000,10000,400000,750000,2000000,10000000,thesisRunTokenCeiling])assert.equal(computeThesisRunBudget({snapshot,plan:plan(120),settings,config:{thesisMaxRunTokens:cap}}),cap);
 for(const cap of [999,thesisRunTokenCeiling+1,-1,NaN,Infinity,'not-a-budget'])assert.throws(()=>computeThesisRunBudget({snapshot,plan:plan(20),settings,config:{thesisMaxRunTokens:cap}}),error=>error.status===400);
});

test('evidence and context inform admission estimates without incorporating unconfirmed materials or whole source files',()=>{
 const sparse=computeThesisRunBudget({snapshot,plan:plan(6),settings});
 const confirmed={...snapshot,materials:[{id:'synthetic',confirmed:true,text:'合成研究材料。'.repeat(100000)}]};
 const full=computeThesisRunBudget({snapshot:confirmed,plan:plan(6),settings});
 assert.ok(full>sparse);assert.ok(full<=thesisRunTokenCeiling);
 assert.equal(computeThesisRunBudget({snapshot:{...confirmed,materials:[{...confirmed.materials[0],confirmed:false}]},plan:plan(6),settings}),sparse);
 assert.equal(computeThesisRunBudget({snapshot:{...confirmed,materials:[{...confirmed.materials[0],text:confirmed.materials[0].text.slice(0,2400)}]},plan:plan(6),settings}),full);
 assert.throws(()=>computeThesisRunBudget({snapshot,plan:[],settings}),error=>error.status===400);
});

test('section sizing preserves configured ceilings and leaves space for JSON and tolerated prose growth in both languages',()=>{
 const chinese=sectionWordsForRuntime(settings,'中文',1800),english=sectionWordsForRuntime(settings,'English',1800);
 assert.equal(chinese,1000);assert.equal(english,1700);assert.ok(chinese<english);
 assert.equal(sectionWordsForRuntime(settings,'中文',700),700);
 assert.equal(sectionWordsForRuntime({...settings,maxOutputTokens:16384},'中文',1800),1800);
 assert.ok(sectionWordsForRuntime({...settings,maxOutputTokens:2048},'中文',1800)<chinese);
 for(const maxOutputTokens of [32,128,768])assert.throws(()=>sectionWordsForRuntime({maxOutputTokens},'中文'),error=>error.status===400&&error.code==='output_budget_too_small');
});

test('a source-heavy 32-unit paper funds body repairs and its planned reviews before freezing',()=>{
 const full={...snapshot,profile:{language:'中文',targetWords:20000},materials:[{confirmed:true,text:'合成资料。'.repeat(3000)},{confirmed:true,text:'资料。'.repeat(800)}]};
 const body=computeThesisRunBudget({snapshot:full,plan:plan(32),settings,reviewAllowance:0});
 const reviewed=computeThesisRunBudget({snapshot:full,plan:plan(32),settings,reviewAllowance:12});
 assert.ok(body>32*(149006+7795)+2*(170687+11617));assert.ok(reviewed>body+12*100000);
 assert.ok(reviewed<=thesisRunTokenCeiling);
 assert.equal(computeThesisRunBudget({snapshot:full,plan:plan(32),settings,reviewAllowance:12,config:{thesisMaxRunTokens:2000000}}),2000000);
});

test('automatic repair is limited to explicit recoverable output failures with known positive usage',()=>{
 const usage={input:100,output:200};
 for(const code of ['truncated','turn_limit','invalid_json','incomplete','word_limit_exceeded'])assert.equal(classifyThesisRetry({status:502,code,usage}).retryable,true,code);
 assert.equal(classifyThesisRetry({status:502,code:'invalid_output',message:'章节响应未通过完整性检查',usage}).reason,'invalid_json');
 assert.equal(classifyThesisRetry({status:502,code:'invalid_output',message:'章节响应格式无效',usage}).retryable,false);
 for(const value of [null,{}, {input:-1,output:100},{input:100,output:null},{input:0,output:0},{input:NaN,output:100},{input:Number.MAX_SAFE_INTEGER,output:100}])assert.equal(classifyThesisRetry({status:502,code:'truncated',usage:value}).retryable,false);
});

test('cancellation, access, budget, moderation and evidence boundaries always stop automatic paid retries',()=>{
 const usage={input:100,output:200};
 for(const status of [401,403,409,422,429,499])assert.equal(classifyThesisRetry({status,code:'truncated',usage}).retryable,false);
 for(const code of ['budget_exceeded','cost_budget','token_budget','usage_unknown','needs_materials','unknown_source','unread_source','draft_disclosure_missing','presentation_not_selected','unsupported_image','moderation_rejected','content_rejected','permission_denied'])assert.equal(classifyThesisRetry({status:502,code,usage}).retryable,false,code);
 assert.equal(classifyThesisRetry({status:504,message:'timeout',usage}).retryable,false,'timeouts are not proof that an unknown provider dispatch can be paid again');
});

test('only a fully accounted relay preflight denial can request a fresh section window',()=>{
 const error={code:'budget_exceeded',status:429,usage:{input:170687,output:11617},executionBudget:{reason:'request_reservation',limitTokens:274598,usedTokens:182304,inFlightTokens:0,requestTokens:100000}};
 assert.deepEqual(classifyThesisRetry(error),{retryable:true,reason:'request_window',minimumTokens:352880});
 for(const patch of [{reason:'actual_usage'},{usedTokens:300000},{usedTokens:182303},{inFlightTokens:100},{requestTokens:10},{requestTokens:2000000},{requestTokens:NaN},{limitTokens:NaN}])assert.equal(classifyThesisRetry({...error,executionBudget:{...error.executionBudget,...patch}}).retryable,false,JSON.stringify(patch));
 for(const patch of [{status:499},{status:403},{code:'cost_budget'},{usage:null},{usage:{input:0,output:0}}, {executionBudget:null},{agentTrace:[{tool:'unauthorized',status:'denied'}]}])assert.equal(classifyThesisRetry({...error,...patch}).retryable,false);
});
