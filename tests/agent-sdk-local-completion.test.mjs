import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Readable} from 'node:stream';
import {runAgentTask} from '../backend/agent-runtime.mjs';
const packet=value=>'event: '+value.type+'\ndata: '+JSON.stringify(value)+'\n\n';

test('real Agent SDK consumes local control end_turn after two mocked upstream tool responses, never a paid finish',async()=>{
 const candidate={complete:true,text:'合成案例的来源已核对。[source:fixture-source]',source_ids:['fixture-source'],missing_evidence:[]},calls=[];
 const requestImpl=(options,callback)=>{const request=new PassThrough(),parts=[];request.on('data',p=>parts.push(p));request.on('end',()=>{const body=JSON.parse(Buffer.concat(parts));if(options.path.endsWith('/count_tokens')){const response=Readable.from(['{"input_tokens":10}']);response.statusCode=200;response.headers={'content-type':'application/json'};callback(response);return;}
  calls.push(body);if(calls.length>2){request.destroy(Error('A paid finish must not be dispatched'));return;}
  const second=calls.length===2,tool={id:'toolu_fixture_'+calls.length,name:second?'mcp__paperknow__submit_writing_output':'mcp__paperknow__read_material',input:second?{candidate}:{id:'fixture-source'}};
  const events=[{type:'message_start',message:{id:'provider_real_sdk_'+calls.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:99,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'tool_use',id:tool.id,name:tool.name,input:{}}},{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(tool.input)}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'tool_use',stop_sequence:null},usage:{input_tokens:10,cache_read_input_tokens:2,cache_creation_input_tokens:3,output_tokens:second?7:5}},{type:'message_stop'}];
  const response=Readable.from([events.map(packet).join('')]);response.statusCode=200;response.headers={'content-type':'text/event-stream'};callback(response);
 });return request;};
 const output=await runAgentTask({settings:{enabled:true,engine:'claude-agent-sdk',baseURL:'https://provider.example.com/anthropic',model:'fixture-model',apiKey:'not-a-real-provider-key',maxTurns:6,timeoutMs:20000,maxOutputTokens:256,maxCostUsd:.1,maxTotalTokens:100000},task:{skill:'writing-task',instructions:'Read fixture-source, then submit the full controlled JSON candidate.',context:{},materials:[{id:'fixture-source',name:'合成资料',text:'这是受控本地SDK验收材料，不是真实研究。'}]},validateWritingOutput:async({text,trace})=>({valid:text===JSON.stringify(candidate)&&trace.some(r=>r.tool==='read_material'&&r.status==='completed'&&r.materialId==='fixture-source')}),dependencies:{lookup:async()=>[{address:'8.8.8.8',family:4}],httpsRequest:requestImpl}});
 assert.equal(calls.length,2);assert.equal(output.submitted,true);assert.equal(output.text,JSON.stringify(candidate));assert.equal(output.completionSource,'local_control');assert.equal(output.usageSource,'provider_responses');assert.deepEqual(output.usage,{input:30,output:12});assert.equal(output.providerRequests,2);assert.equal(output.providerMessages,2);assert.ok(output.costUsd===null||output.costUsd>=0);assert.equal(output.trace.filter(r=>r.tool==='submit_writing_output').length,1);
});
