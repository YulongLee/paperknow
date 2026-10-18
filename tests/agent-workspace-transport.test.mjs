import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createAgentRelay,testAgentConnection} from '../backend/agent-runtime.mjs';
const lookup=async()=>[{address:'8.8.8.8',family:4}];
const settings={baseURL:'https://dashscope.aliyuncs.com/apps/anthropic',workspaceId:'ws-synthetic123',model:'fixture-model',apiKey:'fixture-secret',maxTurns:2,maxOutputTokens:128};

test('workspace header is server-owned on both SDK message and token-count requests',async()=>{
 const upstream=[];
 const relay=await createAgentRelay(settings,{resolver:lookup,requestImpl:(options,callback)=>{
  const request=new EventEmitter();request.destroy=()=>request.emit('close');
  request.end=body=>{upstream.push({options,body:JSON.parse(body)});queueMicrotask(()=>{const response=Readable.from([JSON.stringify({type:'message',content:[],usage:{input_tokens:1}})]);response.statusCode=200;response.headers={'content-type':'application/json'};response.once('end',()=>request.emit('close'));callback(response);});};
  return request;
 }});
 try{for(const suffix of ['/v1/messages','/v1/messages/count_tokens']){
  const r=await fetch(relay.baseURL+suffix,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':relay.token,'X-DashScope-WorkSpace':'ws-attacker'},body:JSON.stringify({model:settings.model,max_tokens:64,messages:[]})});assert.equal(r.status,200);await r.text();
 }}finally{await relay.close();}
 assert.equal(upstream.length,2);
 for(const r of upstream){assert.equal(r.options.headers['X-DashScope-WorkSpace'],settings.workspaceId);assert.equal(r.options.headers['x-api-key'],settings.apiKey);assert.equal(r.options.hostname,'dashscope.aliyuncs.com');assert.equal(r.options.headers['x-dashscope-workspace'],undefined);}
});

test('connection test sends the saved workspace without putting it into user content',async()=>{
 let captured;const result=await testAgentConnection(settings,{lookupImpl:lookup,fetchImpl:async(url,init)=>{captured={url,init};return new Response(JSON.stringify({type:'message',stop_reason:'end_turn',content:[{type:'text',text:'OK'}],usage:{input_tokens:2,output_tokens:1}}));}});
 assert.equal(captured.init.headers['X-DashScope-WorkSpace'],settings.workspaceId);
 assert.equal(captured.init.body.includes(settings.workspaceId),false);
 assert.equal(result.ok,true);assert.equal(result.sdkVerified,false);
 assert.equal(JSON.stringify(result).includes(settings.apiKey),false);
});

test('workspace-bearing runtime and probes reject third-party endpoints before dispatch',async()=>{
 let called=false;const foreign={...settings,baseURL:'https://model.example.com'};
 await assert.rejects(()=>createAgentRelay(foreign,{resolver:async()=>{called=true;return lookup();}}));
 await assert.rejects(()=>testAgentConnection(foreign,{lookupImpl:lookup,fetchImpl:async()=>{called=true;return new Response('{}');}}));
 assert.equal(called,false);
});

test('old configurations omit the workspace header',async()=>{
 const old={...settings};delete old.workspaceId;let headers;
 await testAgentConnection(old,{lookupImpl:lookup,fetchImpl:async(_url,init)=>{headers=init.headers;return new Response(JSON.stringify({type:'message',stop_reason:'end_turn',content:[{type:'text',text:'OK'}]}));}});
 assert.equal(Object.hasOwn(headers,'X-DashScope-WorkSpace'),false);
});
