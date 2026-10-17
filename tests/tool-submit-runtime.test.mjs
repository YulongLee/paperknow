import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentTask} from '../backend/agent-runtime.mjs';
import {normalizeToolRequest,toolRunPlan,toolRunTask,validateToolCandidate,parseToolOutput} from '../backend/tool-run-model.mjs';

const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://provider.example.com/anthropic',model:'tool-runtime-fixture',apiKey:'test-only-tool-runtime-secret',version:'tool-runtime-v1',maxTurns:10,maxOutputTokens:256,maxCostUsd:.1,timeoutMs:5000};
const lookup=async()=>[{address:'8.8.8.8',family:4}];
const success={type:'result',subtype:'success',is_error:false,stop_reason:'end_turn',total_cost_usd:.001,modelUsage:{fixture:{inputTokens:10,outputTokens:20}},permission_denials:[]};
const decode=value=>JSON.parse(value.content[0].text);
function fixture(){
 const prefix='尚未阅读的前言。',quote='这是实际读取的合成研究资料。',suffix='这句位于本次读取范围之外，不能冒充已阅读。',text=prefix+quote+suffix;
 const value=normalizeToolRequest({kind:'literature',operation:'read',snapshot:{title:'【合成验收】原文范围测试',text:'',language:'中文',materials:[{id:'paper-1',name:'明确标注的合成原文',text}]}}),unit=toolRunPlan(value)[0],task=toolRunTask(value,unit);
 const candidate=(excerpt=quote,sourceId='paper-1')=>({complete:true,text:'原文明确说明这是一份合成研究资料。',sourceIds:[sourceId],citations:[{sourceId,quote:excerpt}]}),validator=result=>validateToolCandidate(result,value,unit);
 return {value,unit,task,prefix,quote,suffix,text,candidate,validator};
}
async function execute(script,{task,validateToolOutput=true,validateWritingOutput,signal,runtime=settings}={}){
 const f=fixture(),validator=validateToolOutput===true?f.validator:validateToolOutput;
 return runAgentTask({settings:runtime,task:task||f.task,signal,...(validator!==false?{validateToolOutput:validator}:{}),...(validateWritingOutput?{validateWritingOutput}:{}),dependencies:{lookup,query:({options})=>(async function*(){yield*script(options,f);})()}});
}

// The query double never contacts a model provider; it only invokes registered
// in-process MCP tools and emits an SDK acknowledgement with fixture accounting.
test('tool-task enables only source reading and full-candidate submission with a server-owned tool validator',async()=>{
 const result=await execute(async function*(options,f){
  const tools=options.mcpServers.paperknow.instance._registeredTools;assert.deepEqual(Object.keys(tools).sort(),['read_material','submit_writing_output']);
  assert.match(options.systemPrompt,/唯一提交通道是 submit_writing_output/);for(const name of ['Bash','Read','mcp__foreign__submit_writing_output','mcp__paperknow__list_materials','mcp__paperknow__load_skill','mcp__paperknow__check_text_length'])assert.equal((await options.canUseTool(name,{})).behavior,'deny');assert.equal((await options.canUseTool('mcp__paperknow__submit_writing_output',{})).behavior,'allow');
  await tools.read_material.handler({id:'paper-1'});const accepted=decode(await tools.submit_writing_output.handler({candidate:f.candidate()}));assert.equal(accepted.accepted,true);assert.equal(accepted.frozen,true);yield {...success,result:'SDK acknowledgement cannot replace the accepted content'};
 });
 const f=fixture();assert.equal(result.submitted,true);assert.equal(result.finishReason,'submitted');assert.deepEqual(result.usage,{input:10,output:20});assert.equal(parseToolOutput(result,f.value,f.unit).citations[0].quote,f.quote);assert.doesNotMatch(result.text,/SDK acknowledgement/);
});

for(const [label,amend]of [
 ['without a callback',{validateToolOutput:false}],
 ['with a truthy non-function callback',{validateToolOutput:{valid:true}}],
 ['with only a writing callback',{validateToolOutput:false,validateWritingOutput:()=>({valid:true})}],
 ['for a writing skill with only a tool callback',{skill:'writing-task'}],
 ['for a thesis skill with only a tool callback',{skill:'thesis-section'}]
])test('task flags cannot enable tool submission '+label,async()=>{
 const f=fixture(),task={...f.task,skill:amend.skill||'tool-task',context:{...f.task.context,validateToolOutput:true,submitWritingOutput:true,submitted:true}};
 const result=await execute(async function*(options){const tools=options.mcpServers.paperknow.instance._registeredTools;assert.equal(tools.submit_writing_output,undefined);assert.equal((await options.canUseTool('mcp__paperknow__submit_writing_output',{})).behavior,'deny');assert.ok(tools.read_material);yield{...success,result:'Legacy unsubmitted acknowledgement'};},{...amend,task});assert.equal(result.submitted,undefined);
});

test('a controlled tool task rejects successful direct finals that never passed complete submission validation',async()=>{
 for(const variant of [{},{total_cost_usd:undefined},{modelUsage:{fixture:{inputTokens:0,outputTokens:0}}}])await assert.rejects(()=>execute(async function*(_options,f){yield{...success,result:JSON.stringify(f.candidate()),...variant};}),/未通过完整结果提交校验/);
});

test('a rejected citation candidate cannot be replaced by a later unchecked successful SDK final',async()=>{
 await assert.rejects(()=>execute(async function*(options,f){const tools=options.mcpServers.paperknow.instance._registeredTools;const rejected=decode(await tools.submit_writing_output.handler({candidate:f.candidate()}));assert.equal(rejected.accepted,false);assert.match(rejected.rule,/未读取/);await tools.read_material.handler({id:'paper-1',offset:f.prefix.length,limit:f.quote.length});yield{...success,result:JSON.stringify(f.candidate())};}),/未通过完整结果提交校验/);
});

test('read_material records requested real offsets and limits and accepts only quotes inside an actually read slice',async()=>{
 const scoped=fixture();scoped.unit.ranges=[{sourceId:'paper-1',start:scoped.prefix.length,end:scoped.prefix.length+scoped.quote.length}];
 const result=await execute(async function*(options,f){const tools=options.mcpServers.paperknow.instance._registeredTools;
  const partial=decode(await tools.read_material.handler({id:'paper-1',offset:f.prefix.length,limit:6}));assert.equal(partial.text,f.quote.slice(0,6));assert.equal(partial.nextOffset,f.prefix.length+6);
  let rejected=decode(await tools.submit_writing_output.handler({candidate:f.candidate()}));assert.equal(rejected.accepted,false);assert.match(rejected.rule,/尚未完整读取/);
  const actual=decode(await tools.read_material.handler({id:'paper-1',offset:f.prefix.length,limit:f.quote.length}));assert.equal(actual.text,f.quote);
  rejected=decode(await tools.submit_writing_output.handler({candidate:f.candidate(f.suffix)}));assert.equal(rejected.accepted,false);assert.match(rejected.rule,/实际读取的范围/);
  rejected=decode(await tools.submit_writing_output.handler({candidate:f.candidate('原文中根本没有这个结论。')}));assert.equal(rejected.accepted,false);assert.match(rejected.rule,/无法核对/);
  assert.equal(decode(await tools.submit_writing_output.handler({candidate:f.candidate()})).accepted,true);yield{...success,result:'ACK'};
 },{task:toolRunTask(scoped.value,scoped.unit),validateToolOutput:scoped.validator});
 const f=scoped,reads=result.trace.filter(r=>r.tool==='read_material');assert.deepEqual(reads,[{tool:'read_material',status:'completed',materialId:'paper-1',offset:f.prefix.length,limit:6},{tool:'read_material',status:'completed',materialId:'paper-1',offset:f.prefix.length,limit:f.quote.length}]);assert.doesNotMatch(JSON.stringify(result.trace),/实际读取的合成研究资料|前言|读取范围之外/);assert.equal(parseToolOutput(result,f.value,f.unit).citations[0].quote,f.quote);
});

test('default read range is traceable and unauthorized material IDs do not become evidence',async()=>{
 const result=await execute(async function*(options,f){const tools=options.mcpServers.paperknow.instance._registeredTools;await assert.rejects(()=>tools.read_material.handler({id:'not-authorized'}),/未授权/);const read=decode(await tools.read_material.handler({id:'paper-1'}));assert.equal(read.text,f.text);assert.equal(read.nextOffset,null);const rejected=decode(await tools.submit_writing_output.handler({candidate:f.candidate(f.quote,'not-authorized')}));assert.equal(rejected.accepted,false);assert.match(rejected.rule,/未读取|不属于/);assert.equal(decode(await tools.submit_writing_output.handler({candidate:f.candidate()})).accepted,true);yield{...success,result:'ACK'};});
 assert.deepEqual(result.trace.filter(r=>r.tool==='read_material'),[{tool:'read_material',status:'failed'},{tool:'read_material',status:'completed',materialId:'paper-1',offset:0,limit:6000}]);
});

test('accepted tool candidates are frozen against duplicate submissions and direct final replacement',async()=>{
 const result=await execute(async function*(options,f){const tools=options.mcpServers.paperknow.instance._registeredTools;await tools.read_material.handler({id:'paper-1'});assert.equal(decode(await tools.submit_writing_output.handler({candidate:f.candidate()})).accepted,true);assert.equal(decode(await tools.submit_writing_output.handler({candidate:{complete:true,text:'替换失败',sourceIds:[],citations:[]}})).accepted,true);yield{...success,result:'第二份不应覆盖的自由输出'};});
 assert.equal(JSON.parse(result.text).text,'原文明确说明这是一份合成研究资料。');assert.equal(result.submitted,true);
});

test('only an accepted full tool candidate can survive SDK max-turns acknowledgement',async()=>{
 const result=await execute(async function*(options,f){const tools=options.mcpServers.paperknow.instance._registeredTools;await tools.read_material.handler({id:'paper-1'});await tools.submit_writing_output.handler({candidate:f.candidate()});yield{...success,subtype:'error_max_turns',is_error:true,stop_reason:null,result:''};});assert.equal(result.submitted,true);
 await assert.rejects(()=>execute(async function*(options,f){const tools=options.mcpServers.paperknow.instance._registeredTools;assert.equal(decode(await tools.submit_writing_output.handler({candidate:f.candidate()})).accepted,false);yield{...success,subtype:'error_max_turns',is_error:true,result:JSON.stringify(f.candidate())};}),/回合上限/);
});

for(const [label,amend,pattern]of [
 ['unknown usage',{modelUsage:{},usage:undefined},/真实用量/],
 ['zero usage',{modelUsage:{fixture:{inputTokens:0,outputTokens:0}}},/真实用量/],
 ['unknown cost',{total_cost_usd:undefined},/真实用量/],
 ['output truncation',{stop_reason:'max_tokens'},/截断/],
 ['budget violation',{total_cost_usd:.2},/执行预算/],
 ['permission denial',{permission_denials:[{tool_name:'Bash'}]},/未授权工具/]
])test('accepted tool candidate still rejects '+label,async()=>{
 await assert.rejects(()=>execute(async function*(options,f){const tools=options.mcpServers.paperknow.instance._registeredTools;await tools.read_material.handler({id:'paper-1'});await tools.submit_writing_output.handler({candidate:f.candidate()});yield{...success,result:'ACK',...amend};}),pattern);
});
