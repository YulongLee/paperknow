import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {PassThrough} from 'node:stream';
import {runAgentTask} from '../backend/agent-runtime.mjs';
import {providerFixture,primeProvider} from './fixtures/agent-provider.mjs';
const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://provider.example.com/anthropic',model:'fixture-model',apiKey:'not-a-real-key',maxTurns:1,maxOutputTokens:256,maxCostUsd:.1,timeoutMs:5000,maxTotalTokens:1000},lookup=async()=>[{address:'8.8.8.8',family:4}];
const task={skill:'writing-task',instructions:'Return the complete controlled candidate.',context:{},materials:[{id:'source-A',name:'合成资料',text:'这是一份用于受控测试的合成材料，不是事实研究。'}]};
const candidate={complete:true,text:'这是合成示例的受控正文。[source:source-A]',source_ids:['source-A'],missing_evidence:[]};
const result={type:'result',subtype:'success',is_error:false,stop_reason:'end_turn',modelUsage:{fixture:{inputTokens:9999,outputTokens:9999}},permission_denials:[]};
const validator=async({text,trace})=>({valid:JSON.stringify(JSON.parse(text))===JSON.stringify(candidate)&&trace.some(x=>x.tool==='read_material'&&x.status==='completed'&&x.materialId==='source-A')});

test('presentation submissions retain controlled tools and completion while excluding prose length compression instructions',async()=>{
 for(const operation of ['ppt','ppt-master-slide']){
  const provider=providerFixture(),presentation={...task,skill:'tool-task',context:{operation}},submission={complete:true,slides:[]};let options;
  const output=await runAgentTask({settings,task:presentation,validateToolOutput:({text,trace})=>({valid:JSON.parse(text).complete===true&&trace.some(r=>r.tool==='read_material')}),dependencies:{lookup,httpsRequest:provider.requestImpl,query:args=>{options=args.options;return(async function*(){await primeProvider(options);const tools=options.mcpServers.paperknow.instance._registeredTools;await tools.read_material.handler({id:'source-A'});assert.equal(JSON.parse((await tools.submit_writing_output.handler({candidate:submission})).content[0].text).accepted,true);yield{...result,total_cost_usd:.001,result:'ACK'};})();}}});
  assert.match(options.systemPrompt,/按 presentationRequirements.batch/);assert.match(options.systemPrompt,/已有读取记录继续有效/);assert.doesNotMatch(options.systemPrompt,/按 target\/count 比例压缩到区间中部/);
  assert.deepEqual(options.allowedTools,['mcp__paperknow__read_material','mcp__paperknow__submit_writing_output']);assert.equal(options.maxTurns,1);assert.equal(options.maxBudgetUsd,.1);assert.equal(provider.calls.length,1);assert.equal(output.text,JSON.stringify(submission));
 }
});

test('accepted complete candidate finishes locally with real upstream usage and no extra paid dispatch',async()=>{
 const provider=providerFixture({usage:{input_tokens:4,cache_creation_input_tokens:3,cache_read_input_tokens:7,output_tokens:5}});let options;
 const output=await runAgentTask({settings,task,validateWritingOutput:validator,dependencies:{lookup,httpsRequest:provider.requestImpl,query:args=>{options=args.options;return(async function*(){
  await primeProvider(options);const tools=options.mcpServers.paperknow.instance._registeredTools;await tools.read_material.handler({id:'source-A'});const response=await tools.submit_writing_output.handler({candidate});assert.equal(JSON.parse(response.content[0].text).accepted,true);
  const finish=await fetch(options.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':options.env.ANTHROPIC_API_KEY},body:JSON.stringify({model:settings.model,stream:true,messages:[{role:'user',content:'This growing history must not be reserved'.repeat(500)}]})});assert.equal(finish.status,200);assert.equal(finish.headers.get('x-paperknow-control'),'accepted-candidate');assert.match(await finish.text(),/event: message_stop/);yield{...result,result:'Local protocol text must never replace the frozen model candidate.'};})();}}});
 assert.equal(provider.calls.length,1);assert.deepEqual(output.usage,{input:14,output:5});assert.equal(output.usageSource,'provider_responses');assert.equal(output.completionSource,'local_control');assert.equal(output.providerRequests,1);assert.equal(output.providerMessages,1);assert.equal(output.costUsd,null);assert.equal(output.costSource,'unknown');assert.equal(output.text,JSON.stringify(candidate));assert.equal(output.finishReason,'submitted');assert.equal(existsSync(options.cwd),false);assert.equal(options.abortController.signal.aborted,true);
});

test('SDK accounting cannot replace a missing final provider usage value',async()=>{
 const provider=providerFixture({usage:{input_tokens:10}});
 await assert.rejects(()=>runAgentTask({settings,task,validateWritingOutput:validator,dependencies:{lookup,httpsRequest:provider.requestImpl,query:({options})=>(async function*(){await primeProvider(options);const tools=options.mcpServers.paperknow.instance._registeredTools;await tools.read_material.handler({id:'source-A'});await tools.submit_writing_output.handler({candidate});yield{...result,total_cost_usd:.001,result:'ACK'};})()}}),error=>/真实用量/.test(error.message)&&error.usage===null);
});

test('no upstream message means no established usage even if a fake SDK result claims tokens',async()=>{
 await assert.rejects(()=>runAgentTask({settings,task,validateWritingOutput:validator,dependencies:{lookup,query:({options})=>(async function*(){const tools=options.mcpServers.paperknow.instance._registeredTools;await tools.read_material.handler({id:'source-A'});await tools.submit_writing_output.handler({candidate});yield{...result,total_cost_usd:.001,result:'ACK'};})()}}),/真实用量/);
});

test('local control is unavailable before real read and complete validation; rejected output cannot be returned',async()=>{
 const provider=providerFixture();
 await assert.rejects(()=>runAgentTask({settings,task,validateWritingOutput:validator,dependencies:{lookup,httpsRequest:provider.requestImpl,query:({options})=>(async function*(){await primeProvider(options);const tools=options.mcpServers.paperknow.instance._registeredTools;const rejected=await tools.submit_writing_output.handler({candidate});assert.equal(JSON.parse(rejected.content[0].text).accepted,false);yield{...result,total_cost_usd:.001,result:JSON.stringify(candidate)};})()}}),/未通过完整结果提交校验/);assert.equal(provider.calls.length,1);
});

test('accepted final-turn result waits for complete upstream HTTP usage rather than trusting the SDK snapshot',async()=>{
 let response,ended=false;const requestImpl=(_options,callback)=>{const request=new PassThrough();request.resume();request.once('end',()=>{response=new PassThrough();response.statusCode=200;response.headers={'content-type':'application/json'};callback(response);response.write(JSON.stringify({id:'pending-provider',type:'message',stop_reason:'tool_use',usage:{input_tokens:6,output_tokens:9}}));});return request;};
 const output=await runAgentTask({settings,task,validateWritingOutput:validator,dependencies:{lookup,httpsRequest:requestImpl,query:({options})=>(async function*(){
  const body=fetch(options.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':options.env.ANTHROPIC_API_KEY},body:JSON.stringify({model:settings.model,tools:[{name:'mcp__paperknow__submit_writing_output'}]})}).then(r=>r.text());while(!response)await new Promise(setImmediate);
  const tools=options.mcpServers.paperknow.instance._registeredTools;await tools.read_material.handler({id:'source-A'});await tools.submit_writing_output.handler({candidate});setTimeout(()=>{ended=true;response.end();},20);body.catch(()=>{});
  yield{...result,subtype:'error_max_turns',is_error:true,result:'not the frozen candidate'};
 })()}});
 assert.equal(ended,true);assert.deepEqual(output.usage,{input:6,output:9});assert.equal(output.submitted,true);assert.equal(output.text,JSON.stringify(candidate));assert.equal(output.completionSource,'sdk_acknowledgement');
});

test('accepted candidate does not bypass invalid negative SDK cost metadata',async()=>{
 const provider=providerFixture();await assert.rejects(()=>runAgentTask({settings,task,validateWritingOutput:validator,dependencies:{lookup,httpsRequest:provider.requestImpl,query:({options})=>(async function*(){await primeProvider(options);const tools=options.mcpServers.paperknow.instance._registeredTools;await tools.read_material.handler({id:'source-A'});await tools.submit_writing_output.handler({candidate});yield{...result,total_cost_usd:-1};})()}}),/用量记录无效/);
});
