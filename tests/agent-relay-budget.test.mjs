import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {createAgentRelay} from '../backend/agent-runtime.mjs';

const defaults={baseURL:'https://provider.example.com/anthropic',model:'budget-fixture',apiKey:'synthetic-only-key',maxTurns:12,maxOutputTokens:256,maxTotalTokens:2000};
const body=content=>({model:defaults.model,max_tokens:32,messages:[{role:'user',content}]});
const inputHold=(request,settings=defaults)=>{const normalized={...request,max_tokens:Math.min(Number.isSafeInteger(request.max_tokens)&&request.max_tokens>0?request.max_tokens:settings.maxOutputTokens,settings.maxOutputTokens),thinking:{type:'disabled'}};return Buffer.byteLength(JSON.stringify(normalized))+normalized.max_tokens;};
const message=(id,usage={input_tokens:10,output_tokens:2},text='Controlled synthetic response')=>({id,type:'message',role:'assistant',content:[{type:'text',text}],stop_reason:'end_turn',usage});
const until=async check=>{for(let attempt=0;attempt<100;attempt++){if(check())return;await new Promise(resolve=>setImmediate(resolve));}assert.ok(check(),'Synthetic relay did not reach the expected state');};

async function fixture(t,{settings={},plans=[]}={}){
 const calls=[],config={...defaults,...settings};
 const requestImpl=(options,callback)=>{
  const request=new PassThrough(),parts=[];request.on('data',part=>parts.push(part));
  request.once('end',()=>{
   const index=calls.length,plan=plans[index]||{},response=new PassThrough();response.statusCode=plan.status??200;response.headers={'content-type':'application/json'};
   const call={options,body:JSON.parse(Buffer.concat(parts).toString()),response,finish(value=message('synthetic-message-'+(index+1))){if(!response.destroyed&&!response.writableEnded)response.end(typeof value==='string'?value:JSON.stringify(value));}};calls.push(call);callback(response);
   if(plan.abort){response.write('{"id":"interrupted-synthetic-message",');setImmediate(()=>response.destroy(Error('Synthetic upstream interruption')));}
   else if(!plan.hold)call.finish(plan.value??message('synthetic-message-'+(index+1)));
  });return request;
 };
 const relay=await createAgentRelay(config,{resolver:async()=>[{address:'8.8.8.8',family:4}],requestImpl});
 t.after(async()=>{for(const call of calls)call.response.destroy();await relay.close();});
 return{relay,calls,config,send(request=body('Short')){return fetch(relay.baseURL+'/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':relay.token},body:JSON.stringify(request)});}};
}

test('known provider usage settles the first Chinese request so the next full input fits a 60,000-token budget',async t=>{
 const f=await fixture(t,{settings:{maxTotalTokens:60000,maxOutputTokens:8000},plans:[{value:message('chinese-first',{input_tokens:5000,output_tokens:400})},{value:message('chinese-second',{input_tokens:7000,output_tokens:500})}]}),first={...body('测'.repeat(8000)),max_tokens:8000},second={...body('测'.repeat(12000)),max_tokens:8000};
 assert.ok(inputHold(first,f.config)+inputHold(second,f.config)>60000,'The old cumulative request ceilings would reject this sequence');assert.ok(5400+inputHold(second,f.config)<60000,'Settled actual usage plus the complete next reservation still fits');
 const initial=await f.send(first);assert.equal(initial.status,200);await initial.text();assert.deepEqual(f.relay.providerUsage.usage,{input:5000,output:400});assert.equal(f.relay.reservedTokens,5400,'Unused output and conservative input reservations must be released after complete accounting');
 const next=await f.send(second);assert.equal(next.status,200);await next.text();assert.equal(f.calls.length,2);assert.equal(f.relay.reservedTokens,12900);assert.deepEqual(f.relay.providerUsage.usage,{input:12000,output:900});assert.equal(f.relay.budgetExceeded,false);
});

test('a growing conversation reserves its entire new request and is rejected before dispatch when actual spend plus that hold exceeds the budget',async t=>{
 const f=await fixture(t,{settings:{maxTotalTokens:400}}),first=body('Short');const response=await f.send(first);assert.equal(response.status,200);await response.text();assert.equal(f.relay.reservedTokens,12);
 const next={...first,messages:[...first.messages,{role:'assistant',content:'Previous generated output '.repeat(30)},{role:'user',content:'Tool evidence '.repeat(20)}]};assert.ok(inputHold(next,f.config)+12>400);const denied=await f.send(next);assert.equal(denied.status,429);await denied.text();assert.equal(f.calls.length,1);assert.equal(f.relay.reservedTokens,12);assert.equal(f.relay.budgetExceeded,true);assert.deepEqual(f.relay.providerUsage.usage,{input:10,output:2});
});

test('simultaneous requests retain both pending upper bounds and cannot dispatch a third request through the shared budget',async t=>{
 const request=body('Concurrent synthetic request'),hold=inputHold(request),f=await fixture(t,{settings:{maxTotalTokens:hold*2+1},plans:[{hold:true},{hold:true}]});
 const first=f.send(request);await until(()=>f.calls.length===1);assert.equal(f.relay.reservedTokens,hold);const second=f.send(request);await until(()=>f.calls.length===2);assert.equal(f.relay.reservedTokens,hold*2);
 const denied=await f.send(request);assert.equal(denied.status,429);await denied.text();assert.equal(f.calls.length,2,'Both in-flight reservations must participate in admission');
 f.calls[0].finish(message('parallel-first',{input_tokens:10,output_tokens:2}));await(await first).text();assert.equal(f.relay.reservedTokens,hold+12);f.calls[1].finish(message('parallel-second',{input_tokens:20,output_tokens:3}));await(await second).text();assert.equal(f.relay.reservedTokens,35);assert.deepEqual(f.relay.providerUsage.usage,{input:30,output:5});
});

for(const [name,plan] of [
 ['missing output usage',{value:message('missing-output',{input_tokens:10})}],
 ['negative token usage',{value:message('negative-output',{input_tokens:10,output_tokens:-1})}],
 ['malformed JSON',{value:'{"id":"broken-message"'}],
 ['an HTTP failure',{status:503,value:{error:{message:'Synthetic provider error'}}}]
])test(`${name} never becomes a free continuation after its response ends`,async t=>{
 const f=await fixture(t,{plans:[plan]});await(await f.send()).text();assert.equal(f.calls.length,1);assert.equal(f.relay.providerUsage.complete,false);assert.equal(f.relay.providerUsage.usage,null);const denied=await f.send();assert.equal(denied.ok,false);await denied.text();assert.equal(f.calls.length,1,'Unknown upstream usage must prevent any later budgeted paid dispatch');assert.equal(f.relay.providerUsage.usage,null);
});

test('a transport-aborted provider response blocks further paid dispatch even if its pending hold is cleared',async t=>{
 const f=await fixture(t,{plans:[{abort:true}]});await assert.rejects(async()=>{const response=await f.send();await response.text();});assert.equal(f.calls.length,1);assert.equal(f.relay.providerUsage.complete,false);assert.equal(f.relay.providerUsage.usage,null);const denied=await f.send();assert.equal(denied.ok,false);await denied.text();assert.equal(f.calls.length,1);
});

test('conflicting records for one provider message ID invalidate accounting and block the next request',async t=>{
 const f=await fixture(t,{plans:[{value:message('conflicting-message',{input_tokens:10,output_tokens:2})},{value:message('conflicting-message',{input_tokens:11,output_tokens:2})}]});await(await f.send()).text();assert.equal(f.relay.reservedTokens,12);await(await f.send()).text();assert.equal(f.relay.providerUsage.complete,false);assert.equal(f.relay.providerUsage.usage,null);const denied=await f.send();assert.equal(denied.ok,false);await denied.text();assert.equal(f.calls.length,2,'A settled but conflicting response must not release a free next dispatch');
});

test('cache tokens are charged once and exact provider replays release their hold without charging a second copy',async t=>{
 const replay=message('cached-replay',{input_tokens:4,output_tokens:5,cache_creation_input_tokens:3,cache_read_input_tokens:7}),f=await fixture(t,{plans:[{value:replay},{hold:true},{value:message('cached-distinct',{input_tokens:8,output_tokens:6,cache_creation_input_tokens:2,cache_read_input_tokens:4})}]});
 await(await f.send()).text();assert.equal(f.relay.reservedTokens,19);assert.deepEqual(f.relay.providerUsage.usage,{input:14,output:5});const pending=f.send();await until(()=>f.calls.length===2);assert.equal(f.relay.reservedTokens,19+inputHold(body('Short'),f.config));f.calls[1].finish(replay);await(await pending).text();assert.equal(f.relay.reservedTokens,19);assert.deepEqual(f.relay.providerUsage,{complete:true,requests:2,messages:1,truncated:false,usage:{input:14,output:5}});
 await(await f.send()).text();assert.equal(f.relay.reservedTokens,39);assert.deepEqual(f.relay.providerUsage.usage,{input:28,output:11});assert.equal(f.relay.providerUsage.messages,2);
});

test('actual provider usage above the configured limit is retained, marks the budget exceeded and prevents another dispatch',async t=>{
 const request=body('Short'),f=await fixture(t,{settings:{maxTotalTokens:400},plans:[{value:message('actual-over-budget',{input_tokens:500,output_tokens:20})}]});assert.ok(inputHold(request,f.config)<400);await(await f.send(request)).text();assert.deepEqual(f.relay.providerUsage.usage,{input:500,output:20});assert.equal(f.relay.reservedTokens,520);assert.equal(f.relay.budgetExceeded,true);const denied=await f.send(request);assert.equal(denied.ok,false);await denied.text();assert.equal(f.calls.length,1);
});
