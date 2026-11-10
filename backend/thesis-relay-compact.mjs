// Compact repeated, byte-identical successful reads in one thesis execution.
// The original tool result stays in the history; preserve every tool ID and
// never collapse a different range, source, result, or error.
export function compactRepeatedThesisReads(body){
 if(!body||!Array.isArray(body.messages))return 0;
 const requests=new Map(),seen=new Set();let removedBytes=0;
 for(const message of body.messages){
  if(!Array.isArray(message?.content))continue;
  if(message.role==='assistant')for(const block of message.content){
   if(block?.type==='tool_use'&&block.name==='mcp__paperknow__read_material'&&typeof block.id==='string'&&block.input&&typeof block.input==='object'){
    try{requests.set(block.id,JSON.stringify(block.input));}catch{}
   }
  }
  if(message.role!=='user')continue;
  for(const block of message.content){
   if(block?.type!=='tool_result'||block.is_error===true||!requests.has(block.tool_use_id)||!Array.isArray(block.content)||block.content.length!==1||block.content[0]?.type!=='text'||typeof block.content[0].text!=='string')continue;
   const text=block.content[0].text;let parsed;try{parsed=JSON.parse(text);}catch{continue;}
   if(!parsed||typeof parsed.text!=='string'||typeof parsed.id!=='string')continue;
   const key=JSON.stringify([requests.get(block.tool_use_id),text]);
   if(!seen.has(key)){seen.add(key);continue;}
   const replacement=JSON.stringify({id:parsed.id,alreadyRead:true,note:'与本次先前读取结果完全相同；原始内容仍在前文。',nextOffset:parsed.nextOffset??null});
   if(Buffer.byteLength(replacement)>=Buffer.byteLength(text))continue;
   removedBytes+=Buffer.byteLength(text)-Buffer.byteLength(replacement);block.content=[{type:'text',text:replacement}];
  }
 }
 return removedBytes;
}

// Old rejected full drafts are not evidence and can dominate every later
// provider request. Retain the two latest full candidates and every response,
// preserving tool IDs and all other candidate fields. Only edit the relay's
// request copy: stored checkpoints and the actual validator are untouched.
export function compactRejectedThesisCandidates(body){
 if(!body||!Array.isArray(body.messages))return 0;
 const calls=[],rejected=new Set();
 for(const message of body.messages){
  if(!Array.isArray(message?.content))continue;
  for(const block of message.content){
   if(message.role==='assistant'&&block?.type==='tool_use'&&block.name==='mcp__paperknow__submit_writing_output'&&typeof block.id==='string'&&typeof block.input?.candidate?.text==='string')calls.push(block);
   if(message.role==='user'&&block?.type==='tool_result'&&!block.is_error&&typeof block.tool_use_id==='string'&&Array.isArray(block.content)&&block.content.length===1&&block.content[0]?.type==='text'){
    try{if(JSON.parse(block.content[0].text)?.accepted===false)rejected.add(block.tool_use_id);}catch{}
   }
  }
 }
 let removed=0;
 for(const block of calls.slice(0,-2)){
  if(!rejected.has(block.id)||block.input.candidate.text.length<1000)continue;
  const before=block.input.candidate.text;
  block.input.candidate.text='[此前候选已被拒绝；请以最近完整候选及各次校验反馈为准。]';
  removed+=Buffer.byteLength(before)-Buffer.byteLength(block.input.candidate.text);
 }
 return removed;
}
