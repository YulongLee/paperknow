import {TextDecoder} from 'node:util';

export const agentToolResponsePacketLimit=2*1024*1024;
const prefix='mcp__paperknow__',utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const bytes=value=>{if(Buffer.isBuffer(value))return value;if(value instanceof Uint8Array)return Buffer.from(value.buffer,value.byteOffset,value.byteLength);throw new TypeError('Agent response chunks must be Buffer or Uint8Array');};
const packetLimit=value=>{if(!Number.isSafeInteger(value)||value<1||value>agentToolResponsePacketLimit)throw new RangeError('Agent response packet limit must be between 1 byte and 2 MiB');return value;};
const oversized=()=>Object.assign(new Error('Agent response packet exceeds its buffer limit'),{status:502,code:'agent_tool_response_packet_limit',agentSafe:true});

function aliasesFor(tools,allowedToolNames){
 const names=Array.isArray(tools)?tools.filter(record).map(tool=>tool.name).filter(name=>typeof name==='string'):[],allowed=allowedToolNames===undefined?null:new Set(Array.isArray(allowedToolNames)?allowedToolNames:[]),aliases=new Map();
 for(const full of names){
  if(!full.startsWith(prefix)||allowed&&!allowed.has(full))continue;const short=full.slice(prefix.length);
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(short)||names.filter(name=>name===full).length!==1)continue;
  // A separately declared short tool, or another MCP namespace exposing the
  // same suffix, makes a bare response name ambiguous. Never guess its origin.
  if(names.some(name=>name!==full&&(name===short||name.startsWith('mcp__')&&name.endsWith('__'+short))))continue;
  aliases.set(short,full);
 }
 return aliases;
}

// Parse the protocol structure, then locate its string tokens in the original
// JSON spelling. Re-serializing the full object would alter unrelated bytes.
// Malformed JSON, duplicate keys or excessive nesting are passed through;
// downstream protocol/authorization validation remains responsible for refusal.
function namePatches(source,aliases,format){
 try{
  const root=JSON.parse(source);if(!record(root))return [];
  const selected=new Map();
  if(format==='message'){
   if(root.type!=='message'||!Array.isArray(root.content))return [];
   root.content.forEach((block,index)=>{if(record(block)&&block.type==='tool_use'&&typeof block.name==='string'&&aliases.has(block.name))selected.set(index,aliases.get(block.name));});
  }else{
   if(root.type!=='content_block_start'||!record(root.content_block)||root.content_block.type!=='tool_use'||typeof root.content_block.name!=='string'||!aliases.has(root.content_block.name))return [];
   selected.set('block',aliases.get(root.content_block.name));
  }
  if(!selected.size)return [];
  let offset=0,duplicate=false;const patches=[];
  const whitespace=()=>{while(/[\x20\t\r\n]/.test(source[offset]||'!'))offset++;};
  const string=()=>{const start=offset++;while(offset<source.length){const char=source[offset++];if(char==='\\')offset++;else if(char==='"')return {start,end:offset,value:JSON.parse(source.slice(start,offset))};}throw new Error('Unclosed JSON string');};
  function scan(path,depth){
   if(depth>128)throw new Error('JSON nesting exceeds adapter inspection');whitespace();const char=source[offset];
   if(char==='"'){
    const token=string();let full;
    if(format==='message'&&path.length===3&&path[0]==='content'&&Number.isSafeInteger(path[1])&&path[2]==='name')full=selected.get(path[1]);
    if(format==='sse'&&path.length===2&&path[0]==='content_block'&&path[1]==='name')full=selected.get('block');
    if(full)patches.push({start:token.start,end:token.end,text:JSON.stringify(full)});return;
   }
   if(char==='{'){
    offset++;whitespace();if(source[offset]==='}'){offset++;return;}const keys=new Set();
    while(offset<source.length){const key=string().value;if(keys.has(key))duplicate=true;keys.add(key);whitespace();offset++;scan([...path,key],depth+1);whitespace();if(source[offset++]==='}')return;whitespace();}
   }else if(char==='['){
    offset++;whitespace();if(source[offset]===']'){offset++;return;}let index=0;
    while(offset<source.length){scan([...path,index++],depth+1);whitespace();if(source[offset++]===']')return;}
   }else{while(offset<source.length&&!/[\x20\t\r\n,}\]]/.test(source[offset]))offset++;return;}
   throw new Error('Incomplete JSON structure');
  }
  scan([],0);return duplicate?[]:patches;
 }catch{return [];}
}

function applyPatches(source,patches){let output=source;for(const patch of [...patches].sort((a,b)=>b.start-a.start))output=output.slice(0,patch.start)+patch.text+output.slice(patch.end);return Buffer.from(output,'utf8');}
function normalizeJSON(raw,aliases,format){
 if(!aliases.size)return raw;let source;try{source=utf8.decode(raw);}catch{return raw;}
 const patches=namePatches(source,aliases,format);return patches.length?applyPatches(source,patches):raw;
}

export function normalizeAgentToolResponseJSON(value,{tools=[],allowedToolNames,format='message',maxPacketBytes=agentToolResponsePacketLimit}={}){
 if(!['message','sse'].includes(format))throw new TypeError('Unsupported Agent response JSON format');
 const raw=bytes(value);if(raw.length>packetLimit(maxPacketBytes))throw oversized();return normalizeJSON(raw,aliasesFor(tools,allowedToolNames),format);
}

function normalizeSSE(raw,aliases){
 let source;try{source=utf8.decode(raw);}catch{return raw;}
 const segments=[];let cursor=0,logical=0,event=null;
 while(cursor<source.length){
  const start=cursor;while(cursor<source.length&&source[cursor]!=='\r'&&source[cursor]!=='\n')cursor++;const end=cursor,line=source.slice(start,end);
  if(source[cursor]==='\r')cursor++;if(source[cursor]==='\n')cursor++;
  const colon=line.indexOf(':'),field=colon<0?line:line.slice(0,colon),valueStart=colon<0?end:start+colon+1+(source[start+colon+1]===' '?1:0);
  if(field==='event'){const name=source.slice(valueStart,end);if(event!==null&&event!==name)return raw;event=name;}
  if(field==='data'){const text=source.slice(valueStart,end);segments.push({start:logical,end:logical+text.length,original:valueStart,text});logical+=text.length+1;}
 }
 if(event!==null&&event!=='content_block_start'||!segments.length)return raw;
 const data=segments.map(segment=>segment.text).join('\n'),patches=namePatches(data,aliases,'sse');if(!patches.length)return raw;
 const mapped=[];for(const patch of patches){const segment=segments.find(segment=>patch.start>=segment.start&&patch.end<=segment.end);if(!segment)return raw;mapped.push({...patch,start:segment.original+patch.start-segment.start,end:segment.original+patch.end-segment.start});}
 return applyPatches(source,mapped);
}

// Relay integration: feed original chunks separately to usage/fingerprint
// accounting, and write only these returned chunks to the SDK connection.
// Pass server-owned allowedToolNames on the relay; [] disables adaptation when
// no registered-tool context exists. Keep all request tools for ambiguity checks.
// JSON is buffered until end(); SSE is buffered through each blank-line packet.
// Unsupported content types or missing declarations stream through immediately.
// Invalid JSON/UTF-8 and unfinished SSE tails remain byte-for-byte unchanged.
// Oversized packets throw an explicit 502; callers must fail/close the relay,
// never truncate, silently discard, or retry the response as a successful one.
export function createAgentToolResponseAdapter({tools=[],allowedToolNames,contentType='',maxPacketBytes=agentToolResponsePacketLimit}={}){
 const limit=packetLimit(maxPacketBytes),aliases=aliasesFor(tools,allowedToolNames),type=typeof contentType==='string'?contentType.split(';',1)[0].trim().toLowerCase():'',format=type==='text/event-stream'?'sse':/^application\/(?:[a-z0-9.+-]+\+)?json$/.test(type)?'message':null,enabled=Boolean(format&&aliases.size);
 const pending=enabled?Buffer.allocUnsafe(limit):null;let length=0,ended=false,failure=null,lineHasData=false,afterCR=false,completeAtCR=false;
 const assertOpen=()=>{if(failure)throw failure;if(ended)throw new Error('Agent response adapter has ended');};
 function append(byte){if(length===limit){failure=oversized();throw failure;}pending[length++]=byte;}
 function packet(output){const raw=Buffer.from(pending.subarray(0,length));length=0;output.push(normalizeSSE(raw,aliases));}
 return {enabled,
  write(value){
   assertOpen();const chunk=bytes(value);if(!chunk.length)return [];if(!enabled)return [chunk];
   if(format==='message'){if(length+chunk.length>limit){failure=oversized();throw failure;}chunk.copy(pending,length);length+=chunk.length;return [];}
   const output=[];
   for(const byte of chunk){
    if(afterCR){afterCR=false;if(byte===10){append(byte);if(completeAtCR)packet(output);completeAtCR=false;continue;}if(completeAtCR){packet(output);completeAtCR=false;}}
    append(byte);
    if(byte===13){afterCR=true;completeAtCR=!lineHasData;lineHasData=false;}
    else if(byte===10){if(!lineHasData)packet(output);lineHasData=false;}
    else lineHasData=true;
   }
   return output;
  },
  end(){
   if(failure)throw failure;if(ended)return [];ended=true;if(!enabled||!length)return [];
   const raw=Buffer.from(pending.subarray(0,length));length=0;
   return [format==='message'?normalizeJSON(raw,aliases,'message'):afterCR&&completeAtCR?normalizeSSE(raw,aliases):raw];
  }
 };
}
