import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Readable} from 'node:stream';
import {runAgentTask} from '../backend/agent-runtime.mjs';
import {normalizeThesisSnapshot,thesisPlan,thesisAgentTask,validateThesisCandidate,parseThesisSection} from '../backend/thesis-model.mjs';

// The actual installed Agent SDK starts and dispatches MCP calls. Only its
// upstream HTTPS transport and DNS are synthetic; no fake query or real model.
const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://synthetic.example.com/anthropic',model:'synthetic-alias-model',apiKey:'synthetic-alias-key',maxTurns:4,timeoutMs:20000,maxOutputTokens:4096,maxCostUsd:.1,maxTotalTokens:200000};
const material={id:'owned-source',name:'合成研究记录',text:'仅供工具协议验收的合成材料。'.repeat(14),confirmed:true};
const snapshot=normalizeThesisSnapshot({title:'合成短名工具验收论文',profile:{level:'本科',language:'中文',targetWords:500},materials:[material],references:[],outline:[{id:'c1',title:'研究背景',targetWords:500}]}),unit=thesisPlan(snapshot)[0];
const candidate={complete:true,text:'研'.repeat(470)+'[source:owned-source]',source_ids:['owned-source'],missing_evidence:[]};
const lookup=async()=>[{address:'8.8.8.8',family:4}];

function provider(steps){
 const calls=[];
 return{calls,requestImpl(options,callback){
  const request=new PassThrough(),parts=[];request.on('data',part=>parts.push(part));request.on('end',()=>{
   const body=JSON.parse(Buffer.concat(parts));
   if(options.path.endsWith('/count_tokens')){const response=Readable.from(['{"input_tokens":10}']);response.statusCode=200;response.headers={'content-type':'application/json'};callback(response);return;}
   calls.push(body);const step=steps[calls.length-1];if(!step){request.destroy(Error('Unexpected synthetic provider request'));return;}
   const id='synthetic-message-'+calls.length,tool={id:'synthetic-tool-'+calls.length,type:'tool_use',name:step.name,input:step.input},usage={input_tokens:step.inputTokens??11,output_tokens:step.outputTokens??7,cache_read_input_tokens:step.cacheRead??2,cache_creation_input_tokens:step.cacheWrite??3};
   let content,contentType;
   if(body.stream===true){
    const events=[{type:'message_start',message:{id,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{...usage,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'tool_use',id:tool.id,name:tool.name,input:{}}},{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(tool.input)}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'tool_use',stop_sequence:null},usage},{type:'message_stop'}];
    content=events.map(value=>'event: '+value.type+'\ndata: '+JSON.stringify(value)+'\n\n').join('');contentType='text/event-stream';
   }else{content=JSON.stringify({id,type:'message',role:'assistant',model:body.model,content:[tool],stop_reason:'tool_use',stop_sequence:null,usage});contentType='application/json';}
   // Deliberately split protocol packets and UTF-8 data across transport chunks.
   const bytes=Buffer.from(content),response=Readable.from([bytes.subarray(0,23),bytes.subarray(23,113),bytes.subarray(113,193),bytes.subarray(193)]);response.statusCode=200;response.headers={'content-type':contentType};callback(response);
  });return request;
 }};
}
const steps=()=>[{name:'read_material',input:{id:material.id}},{name:'submit_writing_output',input:{candidate},inputTokens:13,outputTokens:9,cacheRead:1,cacheWrite:4}];

test('real SDK dispatches bare read and submit names, validates owned source, freezes candidate and retains raw provider usage', {timeout:30000},async()=>{
 const p=provider(steps()),validations=[];
 const result=await runAgentTask({settings,task:thesisAgentTask(snapshot,unit,[]),validateThesisOutput:value=>{
  assert.equal(value.trace.some(row=>row.tool==='read_material'&&row.status==='completed'&&row.materialId===material.id),true);
  assert.deepEqual(JSON.parse(value.text),candidate);const checked=validateThesisCandidate(value,snapshot,unit);validations.push(checked);return checked;
 },dependencies:{lookup,httpsRequest:p.requestImpl}});
 assert.equal(validations.length,1);assert.equal(validations[0].valid,true);assert.equal(result.submitted,true);assert.equal(result.finishReason,'submitted');assert.equal(result.completionSource,'local_control');assert.equal(result.usageSource,'provider_responses');assert.equal(result.providerRequests,2);assert.equal(result.providerMessages,2);assert.deepEqual(result.usage,{input:34,output:16});
 assert.equal(p.calls.length,2,'the frozen result must finish locally without another provider call');assert.deepEqual(JSON.parse(result.text),candidate);assert.deepEqual(parseThesisSection(result,snapshot,unit).sourceIds,[material.id]);
 assert.deepEqual(result.trace.map(row=>[row.tool,row.status]),[['read_material','completed'],['submit_writing_output','completed']]);
 for(const call of p.calls)assert.deepEqual(call.tools.map(tool=>tool.name).sort(),['mcp__paperknow__read_material','mcp__paperknow__submit_writing_output']);
 const readCall=p.calls[1].messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).find(block=>block.type==='tool_use');assert.equal(readCall.name,'mcp__paperknow__read_material');
 assert.match(JSON.stringify(p.calls[1].messages),/仅供工具协议验收的合成材料/);
});

test('real SDK still rejects a foreign tool with an otherwise familiar short suffix', {timeout:30000},async()=>{
 const p=provider([{name:'mcp__foreign__read_material',input:{id:material.id}}]);let validations=0;
 await assert.rejects(runAgentTask({settings:{...settings,maxTurns:1},task:thesisAgentTask(snapshot,unit,[]),validateThesisOutput:()=>{validations++;return{valid:true};},dependencies:{lookup,httpsRequest:p.requestImpl}}),error=>{
  assert.equal(error.code,'unauthorized_tool');assert.ok(error.agentTrace.some(row=>row.tool==='mcp__foreign__read_material'&&row.status==='denied'));return true;
 });assert.equal(validations,0);assert.equal(p.calls.length,1);
});

test('normalizing a short submit name cannot bypass a rejected server validator', {timeout:30000},async()=>{
 const p=provider(steps());let validations=0;
 await assert.rejects(runAgentTask({settings:{...settings,maxTurns:2},task:thesisAgentTask(snapshot,unit,[]),validateThesisOutput:value=>{
  validations++;assert.ok(value.trace.some(row=>row.materialId===material.id));return{valid:false,feedback:{code:'synthetic_rejection',rule:'Synthetic server validation refuses this candidate.'}};
 },dependencies:{lookup,httpsRequest:p.requestImpl}}),error=>{assert.equal(error.code,'turn_limit');return true;});assert.equal(validations,1);assert.equal(p.calls.length,2);
});
