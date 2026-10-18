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
 const requestImpl=(_options,callback)=>{const request=new PassThrough();request.on('data',()=>{});request.on('end',()=>{upstreamCalls++;const response=Readable.from(['{}']);response.statusCode=200;response.headers={'content-type':'application/json'};callback(response);});return request;};
 const relay=await createAgentRelay(settings,{resolver:async()=>[{address:'8.8.8.8',family:4}],requestImpl}),messages=[{role:'user',content:JSON.stringify({instructions:task.instructions,context:task.context})}],report=[];
 try{
  const send=async stage=>{const response=await fetch(relay.baseURL+'/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':relay.token},body:JSON.stringify({model:settings.model,max_tokens:settings.maxOutputTokens,messages})});await response.text();report.push({stage,status:response.status,reserved:relay.reservedTokens});return response.status===200;};
  if(!await send('start'))return{report,upstreamCalls};
  for(let part=0;part<5;part++){
   messages.push({role:'assistant',content:[{type:'tool_use',id:'read-'+part,name:'mcp__paperknow__read_material',input:{id:'original',offset:part*8000,limit:8000}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'read-'+part,content:'研'.repeat(8000)}]});
   if(!await send('read-'+((part+1)*8000)))return{report,upstreamCalls};
  }
  const candidate={complete:true,sourceIds:['original'],slides:Array.from({length:6},(_,index)=>({id:'slide-'+(index+1),title:'合成页面 '+(index+1),body:'研'.repeat(100),layout:index?'content':'cover',notes:'合成预算测试。'}))};
  messages.push({role:'assistant',content:[{type:'tool_use',id:'submit',name:'mcp__paperknow__submit_writing_output',input:{candidate}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'submit',content:JSON.stringify({accepted:true,frozen:true,nextAction:'finish'})}]});
  await send('submitted');return{report,upstreamCalls};
 }finally{await relay.close();}
}

test('PPT dedicated default admits full 40000-character source history and submission under relay bounds',async()=>{
 const previous=await sourceHistory(toolRunTokenLimit('rewrite'));assert.equal(previous.report.at(-1).status,429);assert.equal(previous.report.at(-1).stage,'read-32000');
 const expanded=await sourceHistory(toolRunTokenLimit('ppt'));assert.equal(expanded.report.at(-1).stage,'submitted');assert.ok(expanded.report.every(row=>row.status===200));assert.equal(expanded.upstreamCalls,7);assert.ok(expanded.report.at(-1).reserved<1000000);
});
