import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {PassThrough,Readable} from 'node:stream';
import {runAgentTask} from '../backend/agent-runtime.mjs';
import {normalizeThesisOutlineSnapshot,thesisOutlineTask,parseThesisOutline} from '../backend/thesis-outline-model.mjs';
import {loadAgentSkill} from '../backend/skills/index.mjs';
import {providerFixture} from './fixtures/agent-provider.mjs';

// Only the local relay is contacted. DNS, provider transport, SDK query and
// research materials are synthetic; no real model or account is involved.
const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://outline-fixture.example.com/anthropic',model:'outline-runtime-fixture',apiKey:'synthetic-outline-runtime-key',maxTurns:3,timeoutMs:5000,maxOutputTokens:256,maxCostUsd:.1,maxTotalTokens:60000};
const lookup=async()=>[{address:'8.8.8.8',family:4}];
const resultText=JSON.stringify({complete:true,chapters:[{title:'合成课堂反馈的研究设计',wordWeight:7,sections:[]},{title:'合成课堂反馈的核对与总结',wordWeight:3,sections:[]}]});
const success={type:'result',subtype:'success',is_error:false,result:resultText,stop_reason:'end_turn',total_cost_usd:.001,modelUsage:{fixture:{inputTokens:11,outputTokens:23,cacheReadInputTokens:2,cacheCreationInputTokens:3}},permission_denials:[]};
const source={id:'owned-outline-source',name:'合成研究设计记录',text:'这是用于提纲执行器验收的合成研究记录，尚未开展实验，也没有真实测量结论。',confirmed:true};
function fixture(withSource=true){
 const snapshot=normalizeThesisOutlineSnapshot({title:'课堂反馈机制研究（合成验收）',profile:{level:'本科',language:'中文',targetWords:800},materials:withSource?[source]:[],references:[]});
 return {snapshot,task:thesisOutlineTask(snapshot)};
}
async function relayRequest(options){
 const response=await fetch(options.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':options.env.ANTHROPIC_API_KEY},body:JSON.stringify({model:options.model,max_tokens:32,tools:[{name:'mcp__paperknow__read_material',input_schema:{type:'object'}}],messages:[{role:'user',content:'Synthetic outline accounting fixture.'}]})});
 const body=await response.text();assert.equal(response.status,200,body);return body;
}
async function providerRun({provider=providerFixture(),message=success,overrides={}}={}){
 let captured;
 const output=await runAgentTask({settings:{...settings,...overrides},task:fixture(false).task,dependencies:{lookup,httpsRequest:provider.requestImpl,query:({options})=>(async function*(){captured=options;await relayRequest(options);yield message;})()}});
 return {output,provider,options:captured};
}

test('outline prompt is indexed, server skill is already loaded and only read_material is registered and authorized',async()=>{
 const {task}=fixture(),skill=await loadAgentSkill('thesis-outline');let captured;
 const output=await runAgentTask({settings,task,dependencies:{lookup,query:args=>{captured=args;return(async function*(){yield success;})();}}});
 const {prompt,options}=captured,input=JSON.parse(prompt),tools=options.mcpServers.paperknow.instance._registeredTools;
 assert.deepEqual(input.context,JSON.parse(JSON.stringify(task.context)));
 assert.deepEqual(input.materials,task.materials.map(({id,name,text})=>({id,name,characters:text.length})));
 assert.equal(Object.hasOwn(input.materials[0],'text'),false,'the source index must not duplicate the full material body');
 assert.ok(options.systemPrompt.includes(skill.instructions));
 assert.deepEqual(Object.keys(tools),['read_material']);
 assert.deepEqual(options.allowedTools,['mcp__paperknow__read_material']);
 assert.deepEqual(options.tools,[]);assert.deepEqual(options.skills,[]);assert.deepEqual(options.settingSources,[]);
 assert.equal((await options.canUseTool('mcp__paperknow__read_material',{id:source.id})).behavior,'allow');
 for(const tool of ['mcp__paperknow__list_materials','mcp__paperknow__load_skill','mcp__paperknow__submit_writing_output','mcp__foreign__read_material','Bash'])assert.equal((await options.canUseTool(tool,{})).behavior,'deny');
 assert.equal(output.text,resultText);assert.equal(existsSync(options.cwd),false);
});

test('outline material access reads only the selected owned source and records actual handler calls',async()=>{
 const {task}=fixture(),selected=task.materials[0],stages=[];
 const output=await runAgentTask({settings,task,onStage:stage=>stages.push(stage),dependencies:{lookup,query:({options})=>(async function*(){
  const tool=options.mcpServers.paperknow.instance._registeredTools.read_material;
  await assert.rejects(()=>tool.handler({id:'foreign-outline-source'}),/未授权/);
  const response=JSON.parse((await tool.handler({id:selected.id,offset:0,limit:8})).content[0].text);
  assert.equal(response.id,selected.id);assert.equal(response.name,selected.name);assert.equal(response.text,selected.text.slice(0,8));assert.equal(response.nextOffset,8);
  yield {...success,trace:[{tool:'read_material',status:'completed',materialId:'fabricated-read'}]};
 })()}});
 assert.deepEqual(output.trace,[{tool:'read_material',status:'failed'},{tool:'read_material',status:'completed',materialId:selected.id}]);
 assert.doesNotMatch(JSON.stringify(output.trace),/foreign-outline-source|fabricated-read|合成研究记录/);
 assert.ok(stages.includes('agent_tools'));
});

test('source-free outline can return complete JSON directly without loading skills or making material calls',async()=>{
 const {snapshot,task}=fixture(false);
 const output=await runAgentTask({settings,task,dependencies:{lookup,query:({prompt,options})=>(async function*(){
  assert.deepEqual(JSON.parse(prompt).materials,[]);
  assert.deepEqual(Object.keys(options.mcpServers.paperknow.instance._registeredTools),['read_material']);
  yield success;
 })()}});
 assert.deepEqual(output.trace,[]);assert.equal(output.text,resultText);assert.equal(output.submitted,undefined);
 assert.equal(parseThesisOutline(output,snapshot).chapters.length,2);
});

test('ordinary outline uses actual provider input, cache and output counts instead of inflated SDK modelUsage',async()=>{
 const provider=providerFixture({usage:{input_tokens:31,output_tokens:17,cache_read_input_tokens:7,cache_creation_input_tokens:5},stopReason:'end_turn'});
 const {output}=await providerRun({provider,message:{...success,modelUsage:{fixture:{inputTokens:900000,outputTokens:900000,cacheReadInputTokens:900000,cacheCreationInputTokens:900000}}}});
 assert.equal(provider.calls.length,1);assert.deepEqual(output.usage,{input:43,output:17});assert.equal(output.text,resultText);assert.equal(output.submitted,undefined);
});

test('valid provider accounting remains authoritative when SDK success has no usable modelUsage',async()=>{
 const {output,provider}=await providerRun({provider:providerFixture({usage:{input_tokens:14,output_tokens:8},stopReason:'end_turn'}),message:{...success,modelUsage:{},usage:undefined}});
 assert.equal(provider.calls.length,1);assert.deepEqual(output.usage,{input:14,output:8});assert.equal(output.text,resultText);
});

for(const [label,usage] of [
 ['missing output',{input_tokens:10}],
 ['negative output',{input_tokens:10,output_tokens:-1}],
 ['zero totals',{input_tokens:0,output_tokens:0}]
])test('SDK success cannot substitute for '+label+' in actual provider usage',async()=>{
 const provider=providerFixture({usage,stopReason:'end_turn'});let completed=false;
 await assert.rejects(async()=>{await providerRun({provider});completed=true;},error=>{
  assert.match(error.message,/真实用量/);assert.equal(error.status,502);
  assert.notDeepEqual(error.usage,{input:16,output:23},'SDK estimates must not be used after an actual provider request');return true;
 });assert.equal(completed,false);assert.equal(provider.calls.length,1);
});

test('a truncated provider response cannot be published by an SDK end_turn success',async()=>{
 const provider=providerFixture({usage:{input_tokens:20,output_tokens:32},stopReason:'max_tokens'});
 await assert.rejects(()=>providerRun({provider}),error=>{assert.match(error.message,/截断/);assert.deepEqual(error.usage,{input:20,output:32});return true;});
 assert.equal(provider.calls.length,1);
});

test('ordinary outline refuses actual provider usage above the total execution limit and retains actual accounting',async()=>{
 const provider=providerFixture({usage:{input_tokens:1100,output_tokens:20},stopReason:'end_turn'});let completed=false;
 await assert.rejects(async()=>{await providerRun({provider,message:{...success,modelUsage:{fixture:{inputTokens:1,outputTokens:1}}},overrides:{maxTotalTokens:1000}});completed=true;},error=>{
  assert.equal(error.code,'budget_exceeded');assert.equal(error.status,429);assert.deepEqual(error.usage,{input:1100,output:20});return true;
 });assert.equal(completed,false);assert.equal(provider.calls.length,1);
});

test('ordinary outline also enforces its output ceiling against provider usage when SDK reports less output',async()=>{
 const provider=providerFixture({usage:{input_tokens:20,output_tokens:100},stopReason:'end_turn'});
 await assert.rejects(()=>providerRun({provider,message:{...success,modelUsage:{fixture:{inputTokens:1,outputTokens:1}}},overrides:{maxOutputTokens:32}}),error=>{assert.match(error.message,/预算/);assert.deepEqual(error.usage,{input:20,output:100});return true;});
});

test('source-free non-submitted outline enforces total execution limit even in a query-only fixture',async()=>{
 await assert.rejects(()=>runAgentTask({settings:{...settings,maxTotalTokens:1000},task:fixture(false).task,dependencies:{lookup,query:()=> (async function*(){yield {...success,modelUsage:{fixture:{inputTokens:990,outputTokens:20}}};})()}}),error=>{
  assert.equal(error.code,'budget_exceeded');assert.equal(error.status,429);assert.deepEqual(error.usage,{input:990,output:20});return true;
 });
});

test('real SDK reads ten indexed sources together and finishes JSON within the three-turn outline limit', {timeout:30000},async()=>{
 const materials=Array.from({length:10},(_,i)=>({id:'outline-owned-'+i,name:'合成提纲资料 '+i,text:('仅用于本地协议验收的合成材料。'+i).repeat(10),confirmed:true}));
 const snapshot=normalizeThesisOutlineSnapshot({title:'合成课堂反馈设计',profile:{level:'本科',language:'中文',targetWords:800},materials,references:[]}),task=thesisOutlineTask(snapshot),calls=[];
 const requestImpl=(options,callback)=>{
  const request=new PassThrough(),parts=[];request.on('data',part=>parts.push(part));request.on('end',()=>{
   const body=JSON.parse(Buffer.concat(parts));
   if(options.path.endsWith('/count_tokens')){const response=Readable.from(['{"input_tokens":10}']);response.statusCode=200;response.headers={'content-type':'application/json'};callback(response);return;}
   calls.push(body);if(calls.length>2){request.destroy(Error('Outline must finish without a third paid call'));return;}
   const reading=calls.length===1,id='outline-sdk-provider-'+calls.length,content=reading?materials.map((row,i)=>({type:'tool_use',id:'outline-read-'+i,name:'mcp__paperknow__read_material',input:{id:row.id}})):[{type:'text',text:resultText}],usage={input_tokens:reading?120:220,output_tokens:reading?80:100,cache_read_input_tokens:0,cache_creation_input_tokens:0},stopReason=reading?'tool_use':'end_turn';
   let bytes,contentType;
   if(body.stream){
    const events=[{type:'message_start',message:{id,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{...usage,output_tokens:0}}}];
    for(const [index,block] of content.entries())events.push({type:'content_block_start',index,content_block:block.type==='tool_use'?{type:block.type,id:block.id,name:block.name,input:{}}:{type:'text',text:''}},{type:'content_block_delta',index,delta:block.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:block.text}},{type:'content_block_stop',index});
    events.push({type:'message_delta',delta:{stop_reason:stopReason,stop_sequence:null},usage},{type:'message_stop'});bytes=events.map(value=>'event: '+value.type+'\ndata: '+JSON.stringify(value)+'\n\n').join('');contentType='text/event-stream';
   }else{bytes=JSON.stringify({id,type:'message',role:'assistant',model:body.model,content,stop_reason:stopReason,stop_sequence:null,usage});contentType='application/json';}
   const response=Readable.from([bytes]);response.statusCode=200;response.headers={'content-type':contentType};callback(response);
  });return request;
 };
 const output=await runAgentTask({settings:{...settings,maxTurns:3,maxOutputTokens:4096,timeoutMs:20000,maxTotalTokens:60000},task,dependencies:{lookup,httpsRequest:requestImpl}});
 assert.equal(calls.length,2);assert.equal(output.text,resultText);assert.deepEqual(output.usage,{input:340,output:180});
 assert.deepEqual(output.trace.map(row=>[row.tool,row.status,row.materialId]).sort(),materials.map(row=>['read_material','completed',row.id]).sort());
 for(const call of calls)assert.deepEqual(call.tools.map(row=>row.name),['mcp__paperknow__read_material']);
 const toolResults=calls[1].messages.flatMap(row=>Array.isArray(row.content)?row.content:[]).filter(row=>row.type==='tool_result');
 assert.equal(toolResults.length,10);for(const material of materials)assert.ok(JSON.stringify(toolResults).includes(material.text));
 assert.equal(parseThesisOutline(output,snapshot).chapters.length,2);
});
