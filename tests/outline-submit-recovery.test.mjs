import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Readable} from 'node:stream';
import {runAgentTask} from '../backend/agent-runtime.mjs';
import {normalizeWritingSnapshot,writingPlan,writingTask,parseWritingOutput,validateWritingCandidate} from '../backend/writing-model.mjs';
import {validateThesisOutlineCandidate} from '../backend/thesis-outline-model.mjs';
import {providerFixture,primeProvider} from './fixtures/agent-provider.mjs';

const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://outline-repair.example.com/anthropic',apiKey:'synthetic-outline-repair-secret',model:'outline-repair-fixture',version:'repair-v1',maxTurns:3,maxOutputTokens:4096,timeoutMs:5000,maxCostUsd:.1,maxTotalTokens:200000};
const lookup=async()=>[{address:'8.8.8.8',family:4}],decode=value=>JSON.parse(value.content[0].text);
const complete=()=>({complete:true,chapters:[{title:'羊脸识别研究的文献范围与问题',wordWeight:3,presentation:{},sections:[]},{title:'羊脸识别方法的证据比较与局限',wordWeight:7,presentation:{table:true},sections:[]}]});
function fixture({source=false,target=1000}={}){
 const snapshot=normalizeWritingSnapshot({title:'基于深度学习的羊脸识别系统',profile:{level:'本科',language:'中文',targetWords:target},materials:[],references:[{id:'ref-a',title:'合成的识别方法研究摘要',...(source?{text:'这是一份明确标注的合成摘要，仅用于协议测试，描述识别方法的适用范围和待验证问题。'}:{}),confirmed:true},{id:'ref-b',title:'合成的识别研究题录',confirmed:true}],outline:[]}),unit=writingPlan(snapshot,'outline')[0],task=writingTask('summary','outline',snapshot,unit);
 return {snapshot,unit,task,validator:result=>validateWritingCandidate(result,'summary','outline',snapshot,unit)};
}
const success={type:'result',subtype:'success',is_error:false,result:'ACK',stop_reason:'end_turn',permission_denials:[],total_cost_usd:.001,modelUsage:{fixture:{inputTokens:10,outputTokens:20}}};
async function execute(script,{validate=true,task:providedTask,validator,signal,providerUsage}={}){
 const f=fixture(),provider=providerFixture({usage:providerUsage});return runAgentTask({settings,task:providedTask||f.task,signal,...(validate?{validateOutlineOutput:validator||f.validator}:{}),dependencies:{lookup,httpsRequest:provider.requestImpl,query:({options})=>(async function*(){await primeProvider(options);yield*script(options,f);})()}});
}

for(const [label,change,field,reason] of [
 ['missing complete',body=>{delete body.complete;},'complete','not_complete'],
 ['missing chapters',body=>{delete body.chapters;},'chapters','chapter_count'],
 ['missing sections',body=>{delete body.chapters[0].sections;},'chapters[0].sections','invalid_sections'],
 ['duplicate headings',body=>{body.chapters[1].title=body.chapters[0].title;},'chapters[1].title','duplicate_title'],
 ['invalid presentation',body=>{body.chapters[1].presentation={table:'true'};},'chapters[1].presentation','invalid_presentation'],
 ['only one body chapter',body=>{body.chapters[1].title='参考文献';},'chapters','body_chapter_count'],
 ['unsafe heading',body=>{body.chapters[0].title='<script>private input</script>';},'chapters[0].title','invalid_title']
])test('outline repair feedback locates '+label+' without saving or changing the candidate',()=>{
 const f=fixture(),candidate=complete();change(candidate);const before=JSON.stringify(candidate),response=f.validator({text:before});assert.equal(response.valid,false);assert.equal(response.feedback.code,'invalid_outline');assert.equal(response.feedback.field,field);assert.equal(response.feedback.reason,reason);assert.equal(JSON.stringify(candidate),before);assert.doesNotMatch(JSON.stringify(response),/private input|synthetic-outline-repair-secret/);assert.equal(response.feedback.contract.complete,true);
});

test('metadata-only review can plan and allocate a complete specific outline without fabricating source text',()=>{
 const f=fixture({target:200}),body=complete(),response=f.validator({text:JSON.stringify(body)});assert.equal(f.task.materials.length,0);assert.equal(response.valid,true);const parsed=parseWritingOutput({text:JSON.stringify(body)},'summary','outline',f.snapshot,f.unit);assert.equal(parsed.chapters.reduce((sum,row)=>sum+row.targetWords,0),200);assert.match(f.task.instructions,/文档类型为“文献综述”/);assert.equal(validateThesisOutlineCandidate({text:'not JSON'},f.snapshot).feedback.reason,'invalid_json');
});

test('outline candidate rejection returns actionable feedback inside the original run and a corrected candidate freezes',async()=>{
 const stages=[],f=fixture(),provider=providerFixture();
 const output=await runAgentTask({settings,task:f.task,validateOutlineOutput:f.validator,onStage:stage=>stages.push(stage),dependencies:{lookup,httpsRequest:provider.requestImpl,query:({options})=>(async function*(){
  await primeProvider(options);const tools=options.mcpServers.paperknow.instance._registeredTools;assert.deepEqual(Object.keys(tools),['read_material','submit_writing_output']);assert.match(options.systemPrompt,/accepted=false 是当前候选的校验反馈，不代表任务结束/);
  const bad=complete();delete bad.chapters[0].sections;const rejected=decode(await tools.submit_writing_output.handler({candidate:bad}));assert.equal(rejected.accepted,false);assert.equal(rejected.field,'chapters[0].sections');assert.equal(rejected.nextAction,'revise');
  assert.equal(decode(await tools.submit_writing_output.handler({candidate:complete()})).accepted,true);const later=complete();later.chapters[0].title='不可覆盖已冻结结果';assert.equal(decode(await tools.submit_writing_output.handler({candidate:later})).frozen,true);yield{...success,subtype:'error_max_turns',is_error:true,result:'invalid later result'};
 })()}});
 assert.equal(output.submitted,true);assert.equal(output.text,JSON.stringify(complete()));assert.deepEqual(output.usage,{input:10,output:20});assert.deepEqual(stages,['agent_running','checking_outline','repairing_outline','checking_outline','outline_ready']);assert.equal(output.trace.filter(row=>row.tool==='submit_writing_output').length,3);assert.doesNotMatch(JSON.stringify(output.trace),/羊脸|合成|secret/);
});

test('an unchecked direct final cannot bypass a rejected outline or turn-limit protection',async()=>{
 await assert.rejects(()=>execute(async function*(options){const bad=complete();bad.chapters=[];assert.equal(decode(await options.mcpServers.paperknow.instance._registeredTools.submit_writing_output.handler({candidate:bad})).accepted,false);yield{...success,result:JSON.stringify(complete())};}),error=>error.code==='outline_validation_failed');
 await assert.rejects(()=>execute(async function*(options){const bad=complete();bad.complete=false;await options.mcpServers.paperknow.instance._registeredTools.submit_writing_output.handler({candidate:bad});yield{...success,subtype:'error_max_turns',is_error:true};}),error=>error.code==='turn_limit');
});

test('outline callback cannot grant tool access to an unrelated skill or come from task context',async()=>{
 const f=fixture();for(const enabled of [false,true])await execute(async function*(options){assert.equal(options.mcpServers.paperknow.instance._registeredTools.submit_writing_output,undefined);yield{...success,result:JSON.stringify(complete())};},{validate:enabled,task:{...f.task,...(enabled?{skill:'thesis-section'}:{}),context:{...f.task.context,validateOutlineOutput:true}}});
});

test('accepted outline retains real usage, cancellation, output truncation and cost boundaries',async()=>{
 for(const [change,usage,pattern]of [[{total_cost_usd:.2},undefined,/预算/],[{stop_reason:'max_tokens'},undefined,/截断/],[{}, {input_tokens:0,output_tokens:0},/真实用量/],[{}, {input_tokens:200001,output_tokens:10},/预算/]])await assert.rejects(()=>execute(async function*(options){await options.mcpServers.paperknow.instance._registeredTools.submit_writing_output.handler({candidate:complete()});yield{...success,...change};},{providerUsage:usage}),pattern);
 const controller=new AbortController();await assert.rejects(()=>execute(async function*(options){await options.mcpServers.paperknow.instance._registeredTools.submit_writing_output.handler({candidate:complete()});controller.abort();yield success;},{signal:controller.signal}),/取消/);
});

// Real SDK process and MCP tools, with a local synthetic provider transport.
// No production prompt, account or paid model call is used.
test('real SDK reads sources, gets exact rejection feedback and corrects an outline within one three-turn run',{timeout:30000},async()=>{
 const f=fixture({source:true}),calls=[],stages=[];
 const requestImpl=(options,callback)=>{const request=new PassThrough(),parts=[];request.on('data',part=>parts.push(part));request.on('end',()=>{
  const body=JSON.parse(Buffer.concat(parts));if(options.path.endsWith('/count_tokens')){const response=Readable.from(['{"input_tokens":10}']);response.statusCode=200;response.headers={'content-type':'application/json'};callback(response);return;}
  calls.push(body);if(calls.length>3){request.destroy(Error('Unexpected extra paid request'));return;}const step=calls.length,bad=complete();delete bad.chapters[0].sections;
  const content=step===1?f.task.materials.map((row,i)=>({type:'tool_use',id:'read-'+i,name:'mcp__paperknow__read_material',input:{id:row.id}})):[{type:'tool_use',id:'submit-'+step,name:'mcp__paperknow__submit_writing_output',input:{candidate:step===2?bad:complete()}}],id='repair-provider-'+step,usage={input_tokens:100*step,output_tokens:100,cache_read_input_tokens:0,cache_creation_input_tokens:0};
  let bytes,type;if(body.stream){const events=[{type:'message_start',message:{id,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{...usage,output_tokens:0}}}];for(const[index,block]of content.entries())events.push({type:'content_block_start',index,content_block:{type:'tool_use',id:block.id,name:block.name,input:{}}},{type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}},{type:'content_block_stop',index});events.push({type:'message_delta',delta:{stop_reason:'tool_use',stop_sequence:null},usage},{type:'message_stop'});bytes=events.map(value=>'event: '+value.type+'\ndata: '+JSON.stringify(value)+'\n\n').join('');type='text/event-stream';}else{bytes=JSON.stringify({id,type:'message',role:'assistant',model:body.model,content,stop_reason:'tool_use',stop_sequence:null,usage});type='application/json';}
  const response=Readable.from([bytes]);response.statusCode=200;response.headers={'content-type':type};callback(response);
 });return request;};
 const output=await runAgentTask({settings:{...settings,timeoutMs:20000},task:f.task,validateOutlineOutput:f.validator,onStage:stage=>stages.push(stage),dependencies:{lookup,httpsRequest:requestImpl}});
 assert.equal(calls.length,3);assert.equal(output.submitted,true);assert.equal(output.text,JSON.stringify(complete()));assert.deepEqual(output.usage,{input:600,output:300});assert.ok(stages.includes('repairing_outline'));assert.ok(stages.includes('outline_ready'));assert.equal(output.trace.filter(row=>row.tool==='submit_writing_output').length,2);assert.equal(output.trace.filter(row=>row.tool==='read_material').length,1);
 for(const call of calls){assert.deepEqual(call.tool_choice,{type:'any'});assert.deepEqual(call.tools.map(row=>row.name).sort(),['mcp__paperknow__read_material','mcp__paperknow__submit_writing_output']);}
 const feedback=calls[2].messages.flatMap(row=>Array.isArray(row.content)?row.content:[]).filter(row=>row.type==='tool_result');assert.match(JSON.stringify(feedback),/invalid_sections/);assert.match(JSON.stringify(feedback),/chapters\[0\]\.sections/);assert.equal(parseWritingOutput(output,'summary','outline',f.snapshot,f.unit).chapters.length,2);
});
