import test from 'node:test';
import assert from 'node:assert/strict';
import {agentToolResponsePacketLimit,normalizeAgentToolResponseJSON,createAgentToolResponseAdapter} from '../backend/agent-tool-response.mjs';

const full=name=>'mcp__paperknow__'+name,tools=['read_material','submit_writing_output'].map(name=>({name:full(name),input_schema:{type:'object'}}));
const normalize=(value,options={})=>normalizeAgentToolResponseJSON(Buffer.from(value),{tools,...options});
const event=(value,eol='\n',name=value.type)=>`event: ${name}${eol}data: ${JSON.stringify(value)}${eol}${eol}`;
const start=name=>({type:'content_block_start',index:0,content_block:{type:'tool_use',id:'synthetic-call',name,input:{text:'中文正文 read_material',nested:{type:'tool_use',name:'read_material'}}}});
function stream(input,{chunks=[Buffer.from(input)],...options}={}){const adapter=createAgentToolResponseAdapter({tools,contentType:'text/event-stream',...options}),output=[];for(const chunk of chunks)output.push(...adapter.write(chunk));output.push(...adapter.end());return Buffer.concat(output);}

test('JSON adaptation changes only names of declared tools in a top-level Anthropic message and preserves every other byte',()=>{
 const raw='{\n  "type" : "message", "content" : [\n'+
  ' {"type":"text","text":"中文正文里 read_material 和 name 不变 🌱"},\n'+
  ' {"type":"tool_use", "name" : "read_material", "input":{"name":"read_material","text":"submit_writing_output","nested":{"type":"tool_use","name":"read_material"}}},\n'+
  ' {"type":"tool_use","name":"submit_writing_output","input":{"candidate":"正文 论文\\nread_material"}}\n'+
  ' ], "usage":{"input_tokens":10,"output_tokens":20}, "number":1.000e+02\n}\n';
 const expected=raw.replace('"name" : "read_material"','"name" : "'+full('read_material')+'"').replace('"type":"tool_use","name":"submit_writing_output"','"type":"tool_use","name":"'+full('submit_writing_output')+'"');
 assert.deepEqual(normalize(raw),Buffer.from(expected));assert.equal(JSON.parse(normalize(raw)).content[1].input.name,'read_material');
});

test('complete names, undeclared names, foreign names and tool input remain unchanged',()=>{
 for(const name of [full('read_material'),'mcp__foreign__read_material','mcp__paperknow__unknown','read_material_extra','Read','Bash','submit_output','mcp__read_material']){
  const raw=Buffer.from(JSON.stringify({type:'message',content:[{type:'tool_use',name,input:{name:'read_material'}}]}));assert.strictEqual(normalizeAgentToolResponseJSON(raw,{tools}),raw);
 }
 const raw=Buffer.from('{"type":"message","content":[{"type":"text","name":"read_material","text":"read_material"}]}');assert.strictEqual(normalizeAgentToolResponseJSON(raw,{tools}),raw);
});

test('only complete PaperKnow tools declared for this exact request create aliases; ambiguous declarations never adapt',()=>{
 const raw='{"type":"message","content":[{"type":"tool_use","name":"read_material","input":{}}]}';
 for(const declared of [[],undefined,null,['mcp__paperknow__read_material'],[{name:'read_material'}],[{name:'mcp__foreign__read_material'}],[{name:full('read_material')},{name:full('read_material')}],[{name:full('read_material')},{name:'read_material'}],[{name:full('read_material')},{name:'mcp__foreign__read_material'}],[{name:full('read_material')+'\n'}]])assert.deepEqual(normalize(raw,{tools:declared}),Buffer.from(raw));
 assert.equal(JSON.parse(normalize(raw,{tools:[{name:full('read_material')}]})).content[0].name,full('read_material'));
});

test('optional server authorization limits candidates but keeps every request declaration for ambiguity checks',()=>{
 const raw='{"type":"message","content":[{"type":"tool_use","name":"read_material","input":{}}]}';
 for(const allowedToolNames of [[],null,{},'mcp__paperknow__read_material',['read_material'],[full('submit_writing_output')]])assert.deepEqual(normalize(raw,{allowedToolNames}),Buffer.from(raw));
 assert.equal(JSON.parse(normalize(raw,{allowedToolNames:[full('read_material')]})).content[0].name,full('read_material'));
 assert.deepEqual(normalize(raw,{tools:[],allowedToolNames:[full('read_material')]}),Buffer.from(raw));
 for(const name of ['read_material','mcp__foreign__read_material']){
  const declared=[{name:full('read_material')},{name}],allowedToolNames=[full('read_material')];assert.deepEqual(normalize(raw,{tools:declared,allowedToolNames}),Buffer.from(raw));
  assert.deepEqual(stream(event(start('read_material')),{tools:declared,allowedToolNames}),Buffer.from(event(start('read_material'))));
 }
 const allowedToolNames=[],adapter=createAgentToolResponseAdapter({tools,allowedToolNames,contentType:'application/json'});allowedToolNames.push(full('read_material'));assert.equal(adapter.enabled,false);assert.deepEqual(adapter.write(Buffer.from(raw)),[Buffer.from(raw)]);assert.deepEqual(adapter.end(),[]);
});

test('invalid JSON, duplicate or escaped duplicate keys, unexpected shapes and excessive nesting fail through unchanged',()=>{
 const examples=['{"type":"message","content":[{"type":"tool_use","name":"read_material"}]',
  '{"type":"message","content":[{"type":"tool_use","name":"unknown","name":"read_material"}]}',
  '{"type":"message","content":[{"type":"text","type":"tool_use","name":"read_material"}]}',
  '{"type":"message","content":[{"type":"tool_use","na\\u006de":"unknown","name":"read_material"}]}',
  '{"type":"other","content":[{"type":"tool_use","name":"read_material"}]}',
  '{"type":"assistant","message":{"type":"message","content":[{"type":"tool_use","name":"read_material"}]}}',
  '[{"type":"message","content":[{"type":"tool_use","name":"read_material"}]}]',
  '{"type":"message","content":[{"type":"tool_use","name":"read_material","input":'+ '['.repeat(140)+'0'+']'.repeat(140)+'}]}'];
 for(const raw of examples)assert.deepEqual(normalize(raw),Buffer.from(raw));
});

test('escaped known name values are normalized without rewriting escaped field names or unrelated Unicode spelling',()=>{
 const raw='{"type":"message","content":[{"type":"tool_use","na\\u006de":"read_\\u006daterial","input":{"text":"\\u4e2d文 🌱","name":"read_\\u006daterial"}}]}';
 const expected=raw.replace('"na\\u006de":"read_\\u006daterial"','"na\\u006de":"'+full('read_material')+'"');assert.deepEqual(normalize(raw),Buffer.from(expected));
});

test('invalid UTF-8 is passed through verbatim instead of replacement-decoding or silently dropping bytes',()=>{
 const raw=Buffer.concat([Buffer.from('{"type":"message","content":[{"type":"tool_use","name":"read_material","input":{"text":"'),Buffer.from([0xc0,0xaf,0xff]),Buffer.from('"}}]}')]);
 assert.strictEqual(normalizeAgentToolResponseJSON(raw,{tools}),raw);assert.deepEqual(stream(Buffer.concat([Buffer.from('data: '),raw,Buffer.from('\n\n')])),Buffer.concat([Buffer.from('data: '),raw,Buffer.from('\n\n')]));
});

test('JSON streaming buffers split UTF-8 and syntax until end and never changes non-name bytes',()=>{
 const raw=Buffer.from(JSON.stringify({type:'message',content:[{type:'tool_use',name:'read_material',input:{text:'中文 🌱'}}]})),adapter=createAgentToolResponseAdapter({tools,contentType:'application/json; charset=utf-8'});
 for(const byte of raw)assert.deepEqual(adapter.write(Buffer.from([byte])),[]);const output=adapter.end();assert.deepEqual(Buffer.concat(output),normalizeAgentToolResponseJSON(raw,{tools}));assert.deepEqual(adapter.end(),[]);assert.throws(()=>adapter.write(Buffer.from('x')),/ended/);
});

test('SSE adaptation preserves comments, event fields, CRLF and multiline data while replacing only the content-block tool name',()=>{
 const raw=': 心跳 🌱\r\nevent: content_block_start\r\nid: 17\r\nretry: 3000\r\ndata: {"type":"content_block_start",\r\ndata:  "index":0, "content_block":{"type":"tool_use","name" : "read_material", "input":{"name":"read_material","text":"论文 🌱"}}}\r\n\r\n';
 const expected=raw.replace('"name" : "read_material"','"name" : "'+full('read_material')+'"');assert.deepEqual(stream(raw),Buffer.from(expected));
});

test('SSE byte fragments across every name, UTF-8 and delimiter boundary produce the same exact response',()=>{
 const original=event({type:'message_start',message:{type:'message',content:[{type:'tool_use',name:'read_material'}]}},'\r\n')+
  event(start('read_material'),'\r\n')+event({type:'content_block_delta',delta:{type:'input_json_delta',partial_json:'{"name":"read_material","text":"中文 🌱"}'}},'\n')+
  ':中文 🌱\n\n'+event(start('submit_writing_output'),'\n')+'data: [DONE]\n\n';
 const raw=Buffer.from(original),expected=Buffer.from(original.replace('"id":"synthetic-call","name":"read_material"','"id":"synthetic-call","name":"'+full('read_material')+'"').replace('"id":"synthetic-call","name":"submit_writing_output"','"id":"synthetic-call","name":"'+full('submit_writing_output')+'"'));
 assert.deepEqual(stream(raw,{chunks:[...raw].map(byte=>Buffer.from([byte]))}),expected);
 for(const split of [1,2,3,7,17,raw.length-1])assert.deepEqual(stream(raw,{chunks:[raw.subarray(0,split),raw.subarray(split)]}),expected);
});

test('SSE supports each newline spelling and incomplete tails are always emitted unchanged',()=>{
 for(const eol of ['\n','\r','\r\n']){
  const raw=event(start('read_material'),eol),expected=raw.replace('"id":"synthetic-call","name":"read_material"','"id":"synthetic-call","name":"'+full('read_material')+'"');assert.deepEqual(stream(raw,{chunks:[...Buffer.from(raw)].map(byte=>Buffer.from([byte]))}),Buffer.from(expected));
 }
 for(const raw of ['data: '+JSON.stringify(start('read_material')),'event: content_block_start\r\ndata: '+JSON.stringify(start('read_material'))+'\r\n','data: {broken\n\n','data: [DONE]\r\n\r\n',': 空事件\n\n'])assert.deepEqual(stream(raw),Buffer.from(raw));
});

test('SSE never normalizes message_start, deltas, errors, nested tool data or mismatched event envelopes',()=>{
 const examples=[event({type:'message_start',message:{type:'message',content:[{type:'tool_use',name:'read_material'}]}}),event({type:'content_block_delta',content_block:{type:'tool_use',name:'read_material'}}),event({type:'error',error:{type:'tool_use',name:'read_material'}}),event(start('read_material'),'\n','message_delta'),event({...start('read_material'),content_block:{type:'text',name:'read_material',text:'正文'}}),event(start('mcp__foreign__read_material')),event(start('unknown')),
  'event: content_block_start\nevent: message_delta\ndata: '+JSON.stringify(start('read_material'))+'\n\n','event\ndata: '+JSON.stringify(start('read_material'))+'\n\n'];
 for(const raw of examples)assert.deepEqual(stream(raw),Buffer.from(raw));
 assert.equal(JSON.parse(stream('data: '+JSON.stringify(start('read_material'))+'\n\n').toString().slice(6)).content_block.name,full('read_material'));
});

test('single-packet buffering has an explicit hard 2 MiB ceiling and fails rather than truncating',()=>{
 assert.equal(agentToolResponsePacketLimit,2097152);for(const limit of [0,-1,1.5,agentToolResponsePacketLimit+1])assert.throws(()=>createAgentToolResponseAdapter({tools,contentType:'application/json',maxPacketBytes:limit}),RangeError);
 for(const contentType of ['application/json','text/event-stream']){
  const adapter=createAgentToolResponseAdapter({tools,contentType,maxPacketBytes:16});assert.deepEqual(adapter.write(Buffer.alloc(16,120)),[]);assert.throws(()=>adapter.write(Buffer.from('x')),error=>error.status===502&&error.code==='agent_tool_response_packet_limit');assert.throws(()=>adapter.end(),{code:'agent_tool_response_packet_limit'});
 }
 assert.throws(()=>normalizeAgentToolResponseJSON(Buffer.alloc(17),{tools,maxPacketBytes:16}),{code:'agent_tool_response_packet_limit'});
});

test('packet limits reset between events, original chunks remain untouched, and returned packets do not alias reused buffer memory',()=>{
 const raw=Buffer.from(event(start('read_material'))),copy=Buffer.from(raw),adapter=createAgentToolResponseAdapter({tools,contentType:'text/event-stream',maxPacketBytes:raw.length});
 const first=adapter.write(raw);const frozen=Buffer.concat(first);assert.ok(first.length);adapter.write(raw);assert.deepEqual(Buffer.concat(first),frozen);assert.deepEqual(raw,copy);assert.deepEqual(adapter.end(),[]);
});

test('no authorized declaration or unsupported content type is a zero-buffer pass-through and declaration snapshots cannot expand later',()=>{
 for(const options of [{tools:[],contentType:'application/json'},{tools,contentType:'text/plain'},{tools,contentType:'application/octet-stream'},{tools}]){const adapter=createAgentToolResponseAdapter(options),raw=Buffer.alloc(agentToolResponsePacketLimit+1,120);assert.equal(adapter.enabled,false);assert.deepEqual(adapter.write(raw),[raw]);assert.deepEqual(adapter.end(),[]);}
 const declared=[{name:full('read_material')}],adapter=createAgentToolResponseAdapter({tools:declared,contentType:'application/json'});declared.push({name:full('submit_writing_output')});const raw=Buffer.from('{"type":"message","content":[{"type":"tool_use","name":"submit_writing_output"}]}');adapter.write(raw);assert.deepEqual(Buffer.concat(adapter.end()),raw);
});
