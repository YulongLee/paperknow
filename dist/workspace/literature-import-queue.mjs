const queues=new WeakMap();
export function literatureImportQueue(win,options){let queue=queues.get(win);if(!queue){queue=createLiteratureImportQueue({...options,win});queues.set(win,queue);}return queue;}
const pending=row=>['waiting','processing'].includes(row.state);
const limitBytes=100*1024*1024;
export function createLiteratureImportQueue({win,getOwner,approveBatch=async()=>null,processFile}={}){
 const rows=[],listeners=new Set(),files=new Map(),seen=new WeakMap();let owner=null,running=false,paused=false,seq=0,adding=Promise.resolve();
 const snapshot=()=>({ownerId:owner,rows:rows.map(({id,name,size,state,message,progress,paperId,cancel})=>({id,name,size,state,message,progress,paperId,canCancel:typeof cancel==='function'})),busy:rows.some(pending),paused});
 const emit=()=>{for(const fn of listeners)fn(snapshot());};
 const unload=event=>{if(rows.some(pending)){event.preventDefault();event.returnValue='';}};win?.addEventListener('beforeunload',unload);
 async function checkOwner(){const id=await getOwner();if(!id)throw Error('请先登录，再上传文献。');if(owner&&id!==owner)throw Object.assign(Error('登录账户已变化，请返回原账户后继续此上传队列。'),{queueOwnerChanged:true});owner=id;return id;}
 async function drain(){
  if(running||paused)return;running=true;
  try{for(;;){const row=rows.find(r=>r.state==='waiting');if(!row||paused)break;row.state='processing';row.message='正在准备文献…';emit();
   try{await checkOwner();const item=files.get(row.id);const paper=await processFile(item.file,{ownerId:owner,batchConsent:item.batchConsent,retryFailed:!!item.retry,onProgress:event=>{row.message=event.message||'正在处理文献…';row.progress=Number.isFinite(event.progress)?event.progress:null;row.cancel=event.cancel;emit();}});await checkOwner();row.paperId=paper.id;row.state='completed';row.message='已就绪，可以开始研读';row.progress=100;files.delete(row.id);}
   catch(error){row.state=error.name==='DocumentImportCancelled'?'cancelled':'failed';row.message=error.message||'未能完成，请重试。';if(error.queueOwnerChanged)paused=true;}
   finally{row.cancel=null;emit();}
  }}finally{running=false;emit();}
 }
 async function add(values){
  const selected=Array.from(values||[]);if(!selected.length)return;
  const id=await checkOwner(),unique=selected.filter(file=>file&&typeof file==='object'&&!seen.has(file));
  const retained=[...files.values()].reduce((n,item)=>n+item.file.size,0);
  if(unique.length+files.size>20)throw Error('当前队列最多保留 20 份待处理或待重试文献，请先完成或移除部分文件。');
  if(unique.reduce((n,f)=>n+(Number(f.size)||0),retained)>limitBytes)throw Error('待处理文献合计最多 100MB，请分批添加。');
  const valid=file=>/\.(pdf|docx|txt)$/i.test(file.name||'')&&file.size>0&&file.size<=(/\.pdf$/i.test(file.name)?20:2)*1024*1024;
  const accepted=unique.filter(valid),batchConsent=await approveBatch(accepted,id);await checkOwner();
  for(const file of unique){const ok=valid(file),row={id:'literature-import-'+(++seq),name:String(file.name||'未命名文件'),size:file.size,state:ok?'waiting':'invalid',message:ok?'等待处理':!/^.+\.(pdf|docx|txt)$/i.test(file.name||'')?'仅支持 PDF、DOCX、TXT':file.size===0?'文件为空，请重新选择':'文件过大：PDF 最大 20MB，DOCX / TXT 最大 2MB',progress:null};rows.push(row);seen.set(file,row.id);if(ok)files.set(row.id,{file,batchConsent});}
  if(rows.length>100){let excess=rows.length-100;for(let n=0;n<rows.length&&excess>0;)if(!pending(rows[n])&&!files.has(rows[n].id)){rows.splice(n,1);excess--;}else n++;}
  emit();void drain();
 }
 function enqueue(values){const next=adding.then(()=>add(values));adding=next.catch(()=>{});return next;}
 return {snapshot,subscribe(fn){listeners.add(fn);fn(snapshot());return()=>listeners.delete(fn);},enqueue,
  whenIdle(){if(!rows.some(pending))return Promise.resolve();return new Promise(resolve=>{const off=this.subscribe(state=>{if(!state.busy){off();resolve();}});});},
  async retry(id){const row=rows.find(r=>r.id===id),item=files.get(id);if(!row||!item||!['failed','cancelled'].includes(row.state))return;await checkOwner();item.retry=true;row.state='waiting';row.progress=null;row.message='等待重试';paused=false;emit();void drain();},
  async resume(){await checkOwner();paused=false;emit();void drain();},
  remove(id){const row=rows.find(r=>r.id===id);if(!row||row.state==='processing')return;if(files.has(id))seen.delete(files.get(id).file);files.delete(id);rows.splice(rows.indexOf(row),1);if(!rows.length){owner=null;paused=false;}emit();},
  async cancel(id){const row=rows.find(r=>r.id===id);if(row?.state!=='processing'||typeof row.cancel!=='function')return;const cancel=row.cancel;row.cancel=null;emit();try{await cancel();}catch(error){if(row.state==='processing'){row.cancel=cancel;row.message=error.message||'停止未确认，请稍后重试。';emit();}}},
  clear(){for(let i=rows.length-1;i>=0;i--)if(!pending(rows[i])){const item=files.get(rows[i].id);if(item)seen.delete(item.file);files.delete(rows[i].id);rows.splice(i,1);}if(!rows.length){owner=null;paused=false;}emit();},
  dispose(){if(rows.some(pending))throw Error('Queue is still active');listeners.clear();win?.removeEventListener('beforeunload',unload);}
 };
}
