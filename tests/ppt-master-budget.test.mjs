import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Readable} from 'node:stream';
import {createAgentRelay} from '../backend/agent-runtime.mjs';
import {toolRunTokenLimit} from '../backend/config.mjs';
import {normalizeToolRequest,toolRunPlan,toolRunTask} from '../backend/tool-run-model.mjs';

// Exercise the actual relay accounting with a growing legal source history.
// All upstream traffic is an in-memory stub. This is a lower-bound regression,
// not a claim that 30 actual model-authored pages fit every saved dollar cap.
async function sourceHistory(limit){
 const settings={baseURL:'https://synthetic.example.com/anthropic',model:'synthetic',apiKey:'synthetic',maxOutputTokens:4096,maxTurns:12,maxTotalTokens:limit};
 const value=normalizeToolRequest({kind:'presentation',operation:'ppt',snapshot:{title:'合成30页预算检查',text:'研'.repeat(40000),language:'中文',mode:'thesis',context:{pages:30}}}),task=toolRunTask(value,toolRunPlan(value)[0]);
 let upstreamCalls=0;
 const requestImpl=(_options,callback)=>{const request=new PassThrough(),parts=[];request.on('data',part=>parts.push(part));request.on('end',()=>{upstreamCalls++;const body=JSON.parse(Buffer.concat(parts).toString());
  // Controlled nonzero provider usage models each round's entire growing
  // history. It is synthetic accounting, not a production tokenizer estimate.
  const usage={input_tokens:JSON.stringify(body.messages).length,output_tokens:64,cache_creation_input_tokens:0,cache_read_input_tokens:0},message={id:'ppt-budget-message-'+upstreamCalls,type:'message',role:'assistant',model:settings.model,content:[{type:'text',text:'Controlled synthetic PPT response'}],stop_reason:'end_turn',usage};
  const response=Readable.from([JSON.stringify(message)]);response.statusCode=200;response.headers={'content-type':'application/json'};callback(response);});return request;};
 const relay=await createAgentRelay(settings,{resolver:async()=>[{address:'8.8.8.8',family:4}],requestImpl}),messages=[{role:'user',content:JSON.stringify({instructions:task.instructions,context:task.context})}],report=[];
 const result=()=>({report,upstreamCalls,budgetExceeded:relay.budgetExceeded,usage:relay.providerUsage});
 try{
  const send=async stage=>{const response=await fetch(relay.baseURL+'/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':relay.token},body:JSON.stringify({model:settings.model,max_tokens:settings.maxOutputTokens,messages})});await response.text();report.push({stage,status:response.status,reserved:relay.reservedTokens});return response.status===200;};
  if(!await send('start'))return result();
  for(let part=0;part<5;part++){
   messages.push({role:'assistant',content:[{type:'tool_use',id:'read-'+part,name:'mcp__paperknow__read_material',input:{id:'original',offset:part*8000,limit:8000}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'read-'+part,content:'研'.repeat(8000)}]});
   if(!await send('read-'+((part+1)*8000)))return result();
  }
  const candidate={complete:true,sourceIds:['original'],slides:Array.from({length:6},(_,index)=>({id:'slide-'+(index+1),title:'合成页面 '+(index+1),body:'研'.repeat(100),layout:index?'content':'cover',notes:'合成预算测试。'}))};
  messages.push({role:'assistant',content:[{type:'tool_use',id:'submit',name:'mcp__paperknow__submit_writing_output',input:{candidate}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'submit',content:JSON.stringify({accepted:true,frozen:true,nextAction:'finish'})}]});
  await send('submitted');return result();
 }finally{await relay.close();}
}

test('PPT dedicated default admits full 40000-character source history and submission under relay bounds',async()=>{
 const lowerLimit=toolRunTokenLimit('rewrite'),previous=await sourceHistory(lowerLimit);assert.equal(previous.report.at(-1).status,429);assert.match(previous.report.at(-1).stage,/^read-\d+$/);assert.ok(previous.report.slice(0,-1).every(row=>row.status===200));assert.equal(previous.upstreamCalls,previous.report.length-1,'The lower cap must reject a growing-history read before dispatch');assert.equal(previous.budgetExceeded,true);assert.equal(previous.usage.complete,true,'Valid settled provider usage, rather than missing usage, must establish the budget failure');assert.ok(previous.usage.usage.input>0&&previous.usage.usage.output>0);assert.ok(previous.report.at(-1).reserved<lowerLimit,'The next full-history reservation must be the part that no longer fits');
 const expanded=await sourceHistory(toolRunTokenLimit('ppt'));assert.equal(expanded.report.at(-1).stage,'submitted');assert.ok(expanded.report.every(row=>row.status===200));assert.equal(expanded.upstreamCalls,7);assert.equal(expanded.usage.complete,true);assert.equal(expanded.usage.messages,7);assert.equal(expanded.budgetExceeded,false);assert.ok(expanded.usage.usage.input>previous.usage.usage.input);assert.equal(expanded.usage.usage.output,7*64);assert.ok(expanded.report.at(-1).reserved<1000000);
});
