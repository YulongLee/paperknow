// Reading ranges are resolved by the server before model execution. The model
// cannot expand them or grant itself new source access through prompt content.
export function preloadLiteratureRanges(task){
 if(task?.skill!=='tool-task'||!['read','answer'].includes(task.context?.operation)||!Array.isArray(task.context?.unit?.ranges))return null;
 const ranges=task.context.unit.ranges;if(!ranges.length||ranges.length>20)return null;
 let size=0;const materials=[],trace=[];
 for(const range of ranges){
  const source=task.materials?.find(m=>m.id===range.sourceId),{start,end}=range;
  if(!source||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>source.text.length||end-start>8000)throw Error('授权原文范围无效');
  const text=source.text.slice(start,end);size+=text.length;if(size>18000)throw Error('授权原文超过本次研读范围');
  materials.push({id:source.id,name:source.name,text,offset:start});
  trace.push({tool:'read_material',status:'completed',materialId:source.id,offset:start,limit:end-start,preloaded:true});
 }
 const evidence=new Map(),citationSources=materials.map(material=>{
  const excerpts=[];let start=0;
  while(start<material.text.length){
   let end=Math.min(start+480,material.text.length);
   if(end<material.text.length){const part=material.text.slice(start,end),breaks=[...part.matchAll(/[.!?。！？\n](?:\s|$)/g)],boundary=breaks.at(-1);if(boundary&&boundary.index>=160)end=start+boundary.index+1;}
   if(material.text.length-end<5)end=material.text.length;
   if(/[\uD800-\uDBFF]/.test(material.text[end-1]||'')&&/[\uDC00-\uDFFF]/.test(material.text[end]||''))end--;
   const text=material.text.slice(start,end).trim(),excerptId='e'+(evidence.size+1);
   if(text){const excerpt={excerptId,text};excerpts.push(excerpt);evidence.set(excerptId,{sourceId:material.id,quote:text});}start=end;
  }
  return{id:material.id,name:material.name,offset:material.offset,excerpts};
 });
 return{materials,trace,citationSources,evidence};
}

// A model selects a server-created excerpt ID. The exact source characters are
// inserted here before the unchanged scope/quote validator runs. Unknown IDs,
// mismatched sources and conflicting supplied quotes are never repaired by guess.
export function resolveReadingCitations(candidate,preloaded){
 if(!preloaded||!Array.isArray(candidate?.citations))return candidate;
 return{...candidate,citations:candidate.citations.map(c=>{
  if(c?.excerptId===undefined)return c;
  const excerpt=preloaded.evidence.get(c.excerptId);
  if(!excerpt||excerpt.sourceId!==c.sourceId||c.quote!==undefined&&c.quote!==excerpt.quote)throw Error('摘录编号与本次授权原文不一致，请从 authorizedSourceExcerpts 选择对应来源的 excerptId。');
  return{sourceId:excerpt.sourceId,quote:excerpt.quote};
 })};
}

// Decode only the submission candidate's text string. An incomplete JSON token
// or escape is held until the next event; no eval, regex-based JSON repair or
// presentation of arbitrary tool arguments is used.
export function readingPreviewText(json){
 const match=/^\s*\{\s*"candidate"\s*:\s*\{[\s\S]*?"text"\s*:\s*"/.exec(json);
 if(!match)return '';let text='';
 for(let i=match[0].length;i<json.length&&text.length<12000;i++){
  const c=json[i];if(c==='"')return text;if(c!=='\\'){if(c<' ')return '';text+=c;continue;}
  const next=json[++i];if(next===undefined)break;
  if(next==='u'){const code=json.slice(i+1,i+5);if(code.length<4)break;if(!/^[0-9a-f]{4}$/i.test(code))return '';text+=String.fromCharCode(parseInt(code,16));i+=4;}
  else if(Object.hasOwn({'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'},next))text+=({'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'})[next];
  else return '';
 }
 if(/[\uD800-\uDBFF]$/.test(text))text=text.slice(0,-1);return text;
}

export function createReadingPreviewObserver(onText){
 const blocks=new Map();let last='';const emit=text=>{if(typeof text==='string'&&text.length>=12&&text!==last){last=text;onText?.(text.slice(0,12000));}};
 return message=>{
  if(message.type==='assistant')for(const b of message.message?.content||[])if(b.type==='tool_use'&&b.name==='mcp__paperknow__submit_writing_output')emit(b.input?.candidate?.text);
  const e=message.type==='stream_event'?message.event:null;if(!e)return;
  if(e.type==='content_block_start'&&e.content_block?.type==='tool_use'&&e.content_block.name==='mcp__paperknow__submit_writing_output')blocks.set(e.index,'');
  if(e.type==='content_block_delta'&&e.delta?.type==='input_json_delta'&&blocks.has(e.index)){
   const json=blocks.get(e.index)+String(e.delta.partial_json||'');if(json.length>100000){blocks.delete(e.index);return;}blocks.set(e.index,json);emit(readingPreviewText(json));
  }
  if(e.type==='content_block_stop')blocks.delete(e.index);
 };
}

// Observe normalized upstream packets before SDK delivery: some SDK versions
// aggregate tool arguments before yielding their assistant event. This does not
// publish anything; the preview publisher still moderates every visible snapshot.
export function createReadingWireObserver(contentType,onText){
 const observer=createReadingPreviewObserver(onText),decoder=new TextDecoder();let buffer='',disabled=false;
 const streaming=/text\/event-stream/i.test(contentType),json=/application\/(?:[\w.+-]*\+)?json/i.test(contentType);
 function consume(){let match;while((match=/\r?\n\r?\n/.exec(buffer))){const packet=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const data=packet.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');if(!data||data==='[DONE]')continue;try{observer({type:'stream_event',event:JSON.parse(data)});}catch{/* Incomplete/invalid preview never changes execution or accounting. */}}}
 return{write(bytes){if(disabled||!streaming&&!json)return;buffer+=decoder.decode(bytes,{stream:true});if(buffer.length>2000000){disabled=true;buffer='';return;}if(streaming)consume();},end(){if(disabled)return;buffer+=decoder.decode();if(streaming)consume();else if(json)try{observer({type:'assistant',message:JSON.parse(buffer)});}catch{}buffer='';}};
}
