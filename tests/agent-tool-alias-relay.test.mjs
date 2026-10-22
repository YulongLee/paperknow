import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Readable} from 'node:stream';
import {createAgentRelay} from '../backend/agent-runtime.mjs';
const settings={baseURL:'https://fixture.example.com/anthropic',model:'synthetic-model',apiKey:'synthetic-only',maxOutputTokens:128,maxTurns:4};
const resolver=async()=>[{address:'8.8.8.8',family:4}],read='mcp__paperknow__read_material',submit='mcp__paperknow__submit_writing_output';
const schema=name=>({name,input_schema:{type:'object'}});
const message=(name,{id='fixture-message',text='submit_writing_output 研究正文',input={candidate:{name:'read_material',text:'submit_writing_output'}}}={})=>({id,type:'message',role:'assistant',content:[{type:'text',text},{type:'tool_use',id:'call-1',name,input}],stop_reason:'tool_use',usage:{input_tokens:10,output_tokens:7,cache_read_input_tokens:3,cache_creation_input_tokens:2}});
function provider(responses){let calls=0;return{get calls(){return calls;},requestImpl:(_options,callback)=>{const request=new PassThrough();request.resume();request.once('end',()=>{const row=responses[calls++];const response=Readable.from(row.chunks||[JSON.stringify(row.value)]);response.statusCode=200;response.headers={'content-type':row.contentType||'application/json'};callback(response);});return request;}};}
async function send(relay,tools){const response=await fetch(relay.baseURL+'/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':relay.token},body:JSON.stringify({model:settings.model,max_tokens:128,tools})});assert.equal(response.status,200);return response;}

test('relay normalizes only the intersection of server registration and this request tool declarations',async t=>{
 const original=message('submit_writing_output'),p=provider([{value:original},{value:message('submit_writing_output',{id:'second'})},{value:message('load_skill',{id:'third'})}]);
 const relay=await createAgentRelay(settings,{resolver,requestImpl:p.requestImpl,allowedToolNames:[read,submit]});t.after(()=>relay.close());
 const one=await(await send(relay,[schema(read),schema(submit),schema('mcp__paperknow__load_skill')])).json();assert.deepEqual(one,{...original,content:[original.content[0],{...original.content[1],name:submit}]});
 const two=await(await send(relay,[schema(read)])).json();assert.equal(two.content[1].name,'submit_writing_output');
 const three=await(await send(relay,[schema('mcp__paperknow__load_skill')])).json();assert.equal(three.content[1].name,'load_skill');
 assert.deepEqual(relay.providerUsage.usage,{input:45,output:21});assert.equal(relay.providerUsage.complete,true);assert.equal(p.calls,3);
});

test('bare aliases remain unchanged without server-owned authorized tool context',async t=>{
 const original=message('submit_writing_output'),p=provider([{value:original}]),relay=await createAgentRelay(settings,{resolver,requestImpl:p.requestImpl});t.after(()=>relay.close());
 assert.deepEqual(await(await send(relay,[schema(submit)])).json(),original);assert.equal(relay.providerUsage.complete,true);
});

test('accounting fingerprints use raw provider responses even when normalized SDK messages become identical',async t=>{
 const p=provider([{value:message('submit_writing_output')},{value:message(submit)}]),relay=await createAgentRelay(settings,{resolver,requestImpl:p.requestImpl,allowedToolNames:[submit]});t.after(()=>relay.close());
 const one=await(await send(relay,[schema(submit)])).json(),two=await(await send(relay,[schema(submit)])).json();assert.deepEqual(one,two);
 assert.equal(relay.providerUsage.complete,false);assert.equal(relay.providerUsage.usage,null);assert.equal(relay.providerUsage.requests,2);
});

test('SSE relay normalization retains final provider tokens, cache totals and truncation across byte-sized chunks',async t=>{
 const events=[{type:'message_start',message:{id:'sse-usage',type:'message',role:'assistant',content:[],usage:{input_tokens:9,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'sse-call',name:'submit_writing_output',input:{}}},{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify({candidate:{text:'科研正文 submit_writing_output'}})}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'max_tokens',stop_sequence:null},usage:{input_tokens:10,output_tokens:7,cache_read_input_tokens:3,cache_creation_input_tokens:2}},{type:'message_stop'}];
 const bytes=Buffer.from(events.map(row=>'event: '+row.type+'\r\ndata: '+JSON.stringify(row)+'\r\n\r\n').join('')),p=provider([{contentType:'text/event-stream',chunks:[...bytes].map(value=>Buffer.from([value]))}]),relay=await createAgentRelay(settings,{resolver,requestImpl:p.requestImpl,allowedToolNames:[submit]});t.after(()=>relay.close());
 const output=await(await send(relay,[schema(submit)])).text(),parsed=output.split('\r\n\r\n').filter(Boolean).map(packet=>JSON.parse(packet.split('\r\n').find(line=>line.startsWith('data: ')).slice(6)));
 assert.deepEqual(parsed,events.map(row=>row.type==='content_block_start'?{...row,content_block:{...row.content_block,name:submit}}:row));assert.deepEqual(relay.providerUsage.usage,{input:15,output:7});assert.equal(relay.providerUsage.complete,true);assert.equal(relay.providerUsage.truncated,true);
});

test('a declared foreign tool with the same suffix makes the response alias ambiguous even when only PaperKnow is registered',async t=>{
 const original=message('submit_writing_output'),p=provider([{value:original}]),relay=await createAgentRelay(settings,{resolver,requestImpl:p.requestImpl,allowedToolNames:[submit]});t.after(()=>relay.close());
 const response=await(await send(relay,[schema(submit),schema('mcp__foreign__submit_writing_output')])).json();assert.deepEqual(response,original);assert.equal(relay.providerUsage.complete,true);
});
