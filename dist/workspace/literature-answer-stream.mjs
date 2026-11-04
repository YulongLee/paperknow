// Incremental SSE consumption. Reopening this read-only stream never creates
// another generation or charge. Text is cumulative, so reconnects cannot append
// duplicate sentences and an internally revised candidate can replace its draft.
export async function streamLiteratureAnswer({id,ownerId,fetcher,signal,onText,onResult}){
 const response=await fetcher('/api/tool-runs/jobs/'+encodeURIComponent(id)+'/events',{credentials:'same-origin',cache:'no-store',headers:{Accept:'text/event-stream','X-PaperKnow-User':ownerId},signal});
 if(!response.ok){let message='回答连接暂时中断';try{const value=await response.json();if(typeof value.error==='string')message=value.error;}catch{}throw Object.assign(Error(message),{status:response.status});}
 if(!/text\/event-stream/i.test(response.headers.get('content-type')||'')||!response.body?.getReader)throw Error('回答连接暂不可用');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',done=false,received=0;
 try{while(!done){const part=await reader.read();if(part.done)break;received+=part.value.length;if(received>2000000)throw Error('回答连接需要重新打开');buffer+=decoder.decode(part.value,{stream:true});if(buffer.length>262144)throw Error('回答数据过大');let split;
  while((split=/\r?\n\r?\n/.exec(buffer))){const packet=buffer.slice(0,split.index);buffer=buffer.slice(split.index+split[0].length);let event='message';const data=[];for(const line of packet.split(/\r?\n/)){if(line.startsWith('event:'))event=line.slice(6).trim();else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));}if(!data.length)continue;const value=JSON.parse(data.join('\n'));
   if(event==='answer'&&typeof value.text==='string'&&value.text.length<=12000)onText?.(value.text);
   else if(event==='result'&&value.item){await onResult?.(value.item);done=true;break;}
   else if(event==='unavailable')throw Error(typeof value.message==='string'?value.message:'回答连接暂时中断');
  }
 }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}return done;
}
