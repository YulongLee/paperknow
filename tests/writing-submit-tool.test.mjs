import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentTask} from '../backend/agent-runtime.mjs';
import {normalizeWritingSnapshot,writingPlan,writingTask,validateWritingCandidate,parseWritingOutput} from '../backend/writing-model.mjs';

const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://provider.example.com/anthropic',model:'submit-fixture',apiKey:'test-only-submit-secret',version:'v-submit',maxTurns:10,maxOutputTokens:256,maxCostUsd:.1,timeoutMs:5000};
const lookup=async()=>[{address:'8.8.8.8',family:4}];
const success={type:'result',subtype:'success',is_error:false,stop_reason:'end_turn',total_cost_usd:.001,modelUsage:{fixture:{inputTokens:10,outputTokens:20}},permission_denials:[]};
const decode=value=>JSON.parse(value.content[0].text);
function fixture(){
 const snapshot=normalizeWritingSnapshot({title:'合成数字阅读方案',profile:{language:'中文',targetWords:200},requirements:{instructions:'只用于合成验收'},materials:[{id:'source-1',name:'确认的合成资料',text:'这是明确标注的合成演示案例，不能当作真实调查。',confirmed:true}],references:[{id:'metadata-only',title:'只有题录',confirmed:true}],outline:[{id:'c1',title:'目的',targetWords:70},{id:'c2',title:'计划',targetWords:70},{id:'c3',title:'边界',targetWords:60}]}),unit=writingPlan(snapshot,'draft')[0];
 const task=writingTask('quick','draft',snapshot,unit);
 const candidate=(count=200,source=false)=>({complete:true,sections:unit.sections.map((row,index)=>({id:row.id,text:'研'.repeat(index===0?count-2:1)+(source&&index===0?'[source:source-1]':''),source_ids:source&&index===0?['source-1']:[]})),source_ids:source?['source-1']:[],missing_evidence:[]});
 const validator=result=>validateWritingCandidate(result,'quick','draft',snapshot,unit);
 return{snapshot,unit,task,candidate,validator};
}
async function execute(script,{runtime=settings,signal,validate=true,task:otherTask}={}){
 const f=fixture();return runAgentTask({settings:runtime,task:otherTask||f.task,signal,...(validate?{validateWritingOutput:f.validator}:{}),dependencies:{lookup,query:({options})=>(async function*(){yield*script(options,f);})()}});
}

test('writing submit atomically validates complete structure, actual read sources and whole-document length',async()=>{
 let callbackCount=0;
 const output=await execute(async function*(options,f){
  const tools=options.mcpServers.paperknow.instance._registeredTools;
  assert.deepEqual(Object.keys(tools).sort(),['read_material','submit_writing_output']);
  assert.equal((await options.canUseTool('mcp__paperknow__submit_writing_output',{})).behavior,'allow');
  for(const name of ['Bash','Read','mcp__foreign__submit_writing_output','mcp__paperknow__check_text_length'])assert.equal((await options.canUseTool(name,{})).behavior,'deny');
  assert.match(options.systemPrompt,/唯一提交通道是 submit_writing_output/);
  let rejected=decode(await tools.submit_writing_output.handler({candidate:f.candidate(363)}));
  assert.equal(rejected.accepted,false);assert.equal(rejected.code,'word_limit');assert.equal(rejected.count,363);assert.equal(rejected.min,160);assert.equal(rejected.max,240);assert.equal(rejected.nextAction,'revise');
  rejected=decode(await tools.submit_writing_output.handler({candidate:f.candidate(200,true)}));assert.equal(rejected.code,'source_attribution');assert.deepEqual(rejected.allowedAlreadyReadSourceIds,[]);
  await tools.read_material.handler({id:'source-1'});
  const accepted=decode(await tools.submit_writing_output.handler({candidate:f.candidate(200,true)}));assert.equal(accepted.accepted,true);assert.equal(accepted.frozen,true);assert.equal(accepted.length.count,200);callbackCount++;
  // Neither a second candidate nor a later response can mutate the accepted one.
  assert.equal(decode(await tools.submit_writing_output.handler({candidate:f.candidate(500)})).accepted,true);
  yield{...success,result:JSON.stringify(f.candidate(999))};
 });
 const f=fixture(),parsed=parseWritingOutput(output,'quick','draft',f.snapshot,f.unit);
 assert.equal(parsed.wordCount,200);assert.deepEqual(parsed.sourceIds,['source-1']);assert.equal(output.submitted,true);assert.equal(output.finishReason,'submitted');assert.equal(callbackCount,1);assert.deepEqual(output.usage,{input:10,output:20});
 assert.doesNotMatch(JSON.stringify(output.trace),/研|合成资料/);
});

test('only a complete strictly accepted candidate survives an SDK max-turns acknowledgement',async()=>{
 const result=await execute(async function*(options,f){await options.mcpServers.paperknow.instance._registeredTools.submit_writing_output.handler({candidate:f.candidate()});yield{...success,subtype:'error_max_turns',is_error:true,stop_reason:null,result:''};});
 assert.equal(result.submitted,true);assert.equal(JSON.parse(result.text).sections.length,3);
 await assert.rejects(()=>execute(async function*(options,f){const response=decode(await options.mcpServers.paperknow.instance._registeredTools.submit_writing_output.handler({candidate:f.candidate(310)}));assert.equal(response.accepted,false);yield{...success,subtype:'error_max_turns',is_error:true,result:''};}),/回合上限/);
});

test('a controlled writing task cannot fall back to a successful direct final without submission',async()=>{
 for(const amend of [{},{total_cost_usd:undefined},{modelUsage:{fixture:{inputTokens:0,outputTokens:0}}}]){
  await assert.rejects(()=>execute(async function*(_options,f){yield{...success,result:JSON.stringify(f.candidate()),...amend};}),/未通过完整结果提交校验/);
 }
});

test('a rejected complete candidate cannot be replaced by an unchecked successful final',async()=>{
 await assert.rejects(()=>execute(async function*(options,f){const tools=options.mcpServers.paperknow.instance._registeredTools;assert.equal(decode(await tools.submit_writing_output.handler({candidate:f.candidate(400)})).accepted,false);yield{...success,result:JSON.stringify(f.candidate(200))};}),/未通过完整结果提交校验/);
});

test('parallel valid submissions cannot overwrite the first accepted complete candidate',async()=>{
 const output=await execute(async function*(options,f){const handler=options.mcpServers.paperknow.instance._registeredTools.submit_writing_output.handler;const responses=await Promise.all([handler({candidate:f.candidate(180)}),handler({candidate:f.candidate(220)})]);assert.ok(responses.every(value=>decode(value).accepted===true));yield{...success,result:'ACK'};});
 const f=fixture();assert.equal(parseWritingOutput(output,'quick','draft',f.snapshot,f.unit).wordCount,180);
});

for(const [label,amend,pattern] of [
 ['unknown usage',{modelUsage:{},usage:undefined},/真实用量/],
 ['zero usage',{modelUsage:{fixture:{inputTokens:0,outputTokens:0}}},/真实用量/],
 ['unknown cost',{total_cost_usd:undefined},/真实用量/],
 ['over cost',{total_cost_usd:.2},/执行预算/],
 ['over output budget',{modelUsage:{fixture:{inputTokens:10,outputTokens:2561}}},/执行预算/],
 ['truncation',{stop_reason:'max_tokens'},/截断/],
 ['SDK budget error',{subtype:'error_max_budget_usd',is_error:true},/预算上限/],
 ['generic SDK error',{subtype:'error_during_execution',is_error:true},/执行失败/],
 ['permission denial',{permission_denials:[{tool_name:'Bash'}]},/未授权工具/]
])test('an accepted candidate still fails on '+label,async()=>{
 await assert.rejects(()=>execute(async function*(options,f){await options.mcpServers.paperknow.instance._registeredTools.submit_writing_output.handler({candidate:f.candidate()});yield{...success,result:'ACK',...amend};}),pattern);
});

test('accepted candidates respect actual total-token ceiling and cancellation without synthetic usage',async()=>{
 await assert.rejects(()=>execute(async function*(options,f){await options.mcpServers.paperknow.instance._registeredTools.submit_writing_output.handler({candidate:f.candidate()});yield{...success,result:'ACK'};},{runtime:{...settings,maxTotalTokens:25}}),/执行预算/);
 const controller=new AbortController();await assert.rejects(()=>execute(async function*(options,f){await options.mcpServers.paperknow.instance._registeredTools.submit_writing_output.handler({candidate:f.candidate()});controller.abort();yield{...success,result:'ACK'};},{signal:controller.signal}),/取消/);
});

test('accepted candidates still fail on a wall-clock timeout and cannot invent a completion result',async()=>{
 await assert.rejects(()=>execute(async function*(options,f){
  await options.mcpServers.paperknow.instance._registeredTools.submit_writing_output.handler({candidate:f.candidate()});
  await new Promise(resolve=>options.abortController.signal.addEventListener('abort',resolve,{once:true}));
  yield{...success,result:'ACK'};
 }),/超时/);
});

test('a server callback is required, and no complete candidate is reconstructed from length-only statistics',async()=>{
 const f=fixture();await assert.rejects(()=>runAgentTask({settings,task:f.task,validateWritingOutput:()=>{throw Error('private validator failure');},dependencies:{lookup,query:({options})=>(async function*(){await options.mcpServers.paperknow.instance._registeredTools.submit_writing_output.handler({candidate:f.candidate()});yield{...success,result:'ACK'};})()}}),error=>!/private validator failure/.test(error.message));
 await assert.rejects(()=>execute(async function*(){yield{...success,subtype:'error_max_turns',is_error:true,result:JSON.stringify({count:200,withinRange:true})};}),/回合上限/);
});

test('task flags and unrelated skills cannot enable the writing submit tool',async()=>{
 for(const [skill,validator] of [['writing-task',false],['thesis-section',true]]){
  const f=fixture(),task={...f.task,skill,context:{...f.task.context,validateWritingOutput:true,submitWritingOutput:true}};
  await execute(async function*(options){const tools=options.mcpServers.paperknow.instance._registeredTools;assert.equal(tools.submit_writing_output,undefined);assert.ok(tools.check_text_length);assert.equal((await options.canUseTool('mcp__paperknow__submit_writing_output',{})).behavior,'deny');yield{...success,result:'unchanged old response'};},{task,validate:validator});
 }
});

for(const operation of ['ideas','questionnaire'])test(operation+' has no length budget yet exposes only read and full-candidate submit tools',async()=>{
 const f=fixture(),kind=operation==='ideas'?'idea':'questionnaire',unit=writingPlan(f.snapshot,operation)[0],task=writingTask(kind,operation,f.snapshot,unit);
 assert.equal(task.context.lengthBudget,undefined);
 const candidate=operation==='ideas'?{complete:true,proposed:true,ideas:[1,2,3].map(index=>({title:'候选'+index,rationale:'用于比较范围',questions:['拟讨论入口'],methods:['拟比较案例'],limitations:['待补充材料']})),source_ids:[]}:{complete:true,title:'合成体验问卷',introduction:'自愿参与，仅用于合成验收。',questions:[1,2,3].map(index=>({id:'q'+index,type:'text',title:'建议'+index,options:[],required:false})),source_ids:[]};
 const output=await runAgentTask({settings,task,validateWritingOutput:result=>validateWritingCandidate(result,kind,operation,f.snapshot,unit),dependencies:{lookup,query:({options})=>(async function*(){const tools=options.mcpServers.paperknow.instance._registeredTools;assert.deepEqual(Object.keys(tools).sort(),['read_material','submit_writing_output']);for(const name of ['list_materials','load_skill','check_text_length'])assert.equal((await options.canUseTool('mcp__paperknow__'+name,{})).behavior,'deny');assert.equal(decode(await tools.submit_writing_output.handler({candidate})).accepted,true);yield{...success,result:'ACK'};})()}});
 const parsed=parseWritingOutput(output,kind,operation,f.snapshot,unit);assert.equal(parsed[operation==='ideas'?'ideas':'questions'].length,3);assert.equal(output.submitted,true);
});

test('validator rejects malformed batches, metadata evidence and missing actual results instead of freezing them',()=>{
 const f=fixture(),check=candidate=>f.validator({text:JSON.stringify(candidate),trace:[]});
 assert.equal(check({...f.candidate(),sections:f.candidate().sections.slice(1)}).valid,false);
 assert.equal(check({...f.candidate(),source_ids:['metadata-only']}).feedback.code,'source_attribution');
 assert.equal(check({...f.candidate(),complete:false,missing_evidence:['必须提供真实结果']}).feedback.code,'needs_materials');
 assert.equal(check({...f.candidate(),missing_evidence:['仍缺结果']}).valid,false);
 assert.equal(f.validator({text:'{"complete":',trace:[]}).valid,false);
 assert.equal(check(f.candidate()).valid,true);
});
