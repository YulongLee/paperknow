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
