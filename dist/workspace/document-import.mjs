import {readFileBytes} from './file-bytes.mjs';
import {reuseStoredOriginal,storedFileSource} from './file-selection.mjs';
const PDF_BYTES=20*1024*1024,PDF_PAGES=100;
const abortError=()=>Object.assign(new Error('已停止等待；已提交的云端解析仍可在任务中心查看。'),{name:'AbortError'});
const checkSignal=signal=>{if(signal?.aborted)throw abortError();};
const stageMessages={uploading:'正在上传 PDF 原件',queued:'PDF 已加入解析队列',pending:'PDF 已加入解析队列',reading:'正在读取 PDF 原件',running:'正在识别 PDF 正文、表格与公式',recognizing:'正在识别 PDF 正文、表格与公式',parsing:'正在识别 PDF 正文、表格与公式',ocr:'正在识别扫描文字',converting:'正在整理解析结果',downloading:'正在整理并读取解析结果',saving:'正在保存解析成果',saving_wait:'解析完成，正在等待成果保存',completed:'PDF 云端解析已完成',cancelled:'已停止本站解析任务，上游可能仍在处理'};
const wait=(ms,signal)=>new Promise((resolve,reject)=>{checkSignal(signal);const timer=setTimeout(done,ms);function done(){signal?.removeEventListener('abort',cancel);resolve();}function cancel(){clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(abortError());}signal?.addEventListener('abort',cancel,{once:true});});
const localExtract=async file=>{if(/\.txt$/i.test(file.name)&&typeof file.arrayBuffer!=='function'&&typeof file.text==='function')return {text:await file.text(),warnings:[]};const bytes=await readFileBytes(file),snapshot=new File([bytes],file.name,{type:file.type,lastModified:file.lastModified});return /\.txt$/i.test(file.name)?{text:await snapshot.text(),warnings:[]}:(await import('/precheck/assets/parsers.js')).extractFile(snapshot);};
async function base64File(file,signal){const bytes=await readFileBytes(file,{signal,maxBytes:PDF_BYTES});checkSignal(signal);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}

// Kept per importer: manual re-entry with the same File reuses the submitted task.
// POSTs are never retried automatically, even when the response was interrupted.
export function createWorkspaceDocumentImporter({fetchImpl=(...args)=>fetch(...args),extractFileImpl=localExtract,confirmImpl=message=>window.confirm(message),sleepImpl=wait,uuid=()=>crypto.randomUUID(),now=()=>Date.now(),pollInterval=1500,maxWait=15*60*1000}={}){
 const requests=new WeakMap();
 async function api(path,{body,signal}={}){checkSignal(signal);const requestController=new AbortController(),abort=()=>requestController.abort();signal?.addEventListener('abort',abort,{once:true});let timedOut=false;const timer=setTimeout(()=>{timedOut=true;requestController.abort();},body===undefined?30000:120000);try{const response=await fetchImpl('/api'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:requestController.signal,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});let value;try{value=await response.json();}catch{throw Error('文档服务返回异常，请在任务中心查看进度后再重试。');}if(!response.ok){const error=Object.assign(new Error(response.status===503&&body===undefined&&path.startsWith('/document-parses/')?'解析状态或正文暂时不可读取，请到任务中心稍后查看；无需重复提交。':value?.error?.message||value?.message||(typeof value?.error==='string'?value.error:'文档服务暂不可用，请稍后重试。')),{status:response.status});throw error;}return value;}catch(error){if(signal?.aborted)throw abortError();if(timedOut)throw Error('文档服务响应超时，请在任务中心核对处理进度；无需重复提交。');throw error;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}}
 return async function extractWorkspaceDocument(file,{onProgress=()=>{},signal,projectId}={}){
  if(!file||!/\.(txt|docx|pdf)$/i.test(file.name||''))throw Error('请选择 TXT、DOCX 或 PDF 文档；旧版 DOC 请先另存为 DOCX。');checkSignal(signal);
  const emit=value=>{if(!signal?.aborted)onProgress(value);};
  if(!/\.pdf$/i.test(file.name)){emit({stage:'local',message:'正在当前浏览器提取文档文字…',progress:null});const result=await extractFileImpl(file);checkSignal(signal);return {...result,warnings:Array.isArray(result.warnings)?result.warnings:[]};}
  if(file.size>PDF_BYTES)throw Error('PDF 最大 20MB、最多 100 页，请拆分后导入。');
  if(!storedFileSource(file)){emit({stage:'reading_file',message:'正在读取所选 PDF…',progress:null});await readFileBytes(file,{signal,maxBytes:PDF_BYTES});}
  const session=await api('/auth/me',{signal});if(!session.user?.id)throw Error('请先登录，再使用 PDF 云端解析；TXT / DOCX 仍可本地导入。');
  const capability=(await api('/capabilities',{signal})).documentParsing;
  if(!capability?.ready)throw Error('PDF 云端解析暂未开放，请稍后重试，或先导入 TXT / DOCX。');
  const limit=Math.min(PDF_BYTES,Number(capability.maxFileBytes)||PDF_BYTES),pages=Math.min(PDF_PAGES,Number(capability.maxPages)||PDF_PAGES);
  if(file.size>limit)throw Error(`PDF 超过当前解析上限 ${Math.floor(limit/1024/1024)}MB，最多 ${pages} 页，请拆分后导入。`);
  const key=String(session.user.id)+'\n'+(projectId||'');let records=requests.get(file);if(!records){records=new Map();requests.set(file,records);}let record=records.get(key);
  if(!record){record={idempotencyKey:uuid()};records.set(key,record);}
  if(record.result)return record.result;if(record.inFlight)return record.inFlight;
  record.inFlight=(async()=>{
  if(!record.id){const stored=storedFileSource(file),accepted=await confirmImpl(`PDF 云端解析确认\n\n「${file.name}」${stored?'将使用你在文件管理中选择的已有文件，无需重新上传':'将上传至你的账户原件'}，并提交第三方文档解析服务（MinerU）提取正文、表格和公式（包括扫描文字）。PDF 最大 ${Math.floor(limit/1024/1024)}MB、最多 ${pages} 页；请确认你有权处理此文件，避免上传不必要的敏感信息。\n\n解析结果需人工核对；离开页面只停止等待，任务可在任务中心继续查看。取消仅停止本站任务，上游可能仍在处理。是否${stored?'使用并解析':'上传并解析'}？`);checkSignal(signal);if(!accepted)throw Object.assign(new Error('已取消导入，文件未提交解析。'),{name:'DocumentImportCancelled'});
   emit({stage:'uploading',message:stageMessages.uploading+'…',progress:null});
   if(!record.fileId){const reused=await reuseStoredOriginal(file,{api:(path,body)=>api(path,{body,signal}),expectedUserId:session.user.id,projectId}),uploaded=reused||await api('/files',{body:{name:file.name,data:await base64File(file,signal),expectedUserId:session.user.id,...(projectId?{projectId}:{})},signal});if(!uploaded.id)throw Error('原件上传未返回文件编号，请到我的项目核对原件。');record.fileId=uploaded.id;}
   emit({stage:'queued',message:'原件已保存，正在提交 PDF 解析…',progress:null});
   const job=await api('/document-parses',{body:{fileId:record.fileId,idempotencyKey:record.idempotencyKey,consent:true,expectedUserId:session.user.id},signal});if(!job.id)throw Error('未取得解析任务编号，请先到任务中心核对。');record.id=job.id;
  }
  const started=now();let failures=0,cancelPending=false,cancelError='';
  const cancel=async()=>{if(cancelPending)return;cancelPending=true;try{await api('/document-parses/'+encodeURIComponent(record.id)+'/cancel',{body:{},signal});}catch(error){cancelPending=false;cancelError='取消未确认，请在任务中心核对。';throw error;}};
  while(true){checkSignal(signal);if(now()-started>maxWait)throw Error('本页等待已超时，解析可能仍在进行。请到任务中心查看，无需重复上传。');let job;
   try{job=await api('/document-parses/'+encodeURIComponent(record.id),{signal});failures=0;}catch(error){if(signal?.aborted||error.name==='AbortError')throw abortError();if(error.status||++failures>3)throw error;emit({stage:'reconnecting',message:'连接暂时中断，正在重新读取已有任务；不会重复提交。',jobId:record.id,progress:null,cancel});await sleepImpl(pollInterval*failures,signal);continue;}
   const stage=job.stage||job.status,pageProgress=job.progress&&typeof job.progress==='object'?job.progress:null,extractedPages=Number(pageProgress?.extractedPages),totalPages=Number(pageProgress?.totalPages),hasPageProgress=pageProgress&&Number.isFinite(extractedPages)&&Number.isFinite(totalPages)&&totalPages>0,progress=hasPageProgress?Math.max(0,Math.min(100,extractedPages/totalPages*100)):job.progress!==null&&typeof job.progress!=='object'&&Number.isFinite(Number(job.progress))?Math.max(0,Math.min(100,Number(job.progress))):null;
   emit({stage,progress,jobId:record.id,...(hasPageProgress?{extractedPages,totalPages}:{}),message:(stageMessages[stage]||stageMessages[job.status]||'PDF 正在解析')+(hasPageProgress?`，已识别 ${extractedPages} / ${totalPages} 页`:'')+'。'+(cancelError||'可在任务中心继续查看；离开页面仅停止等待。'),...(!['completed','failed','cancelled'].includes(job.status)?{cancel}:{})});
   if(job.status==='completed'){if(typeof job.result?.text!=='string'||!job.result.text.trim())throw Error('解析已完成但没有可导入的正文，请在任务中心查看解析提示。');if(Number(job.result.pages)>pages)throw Error('PDF 超过 '+pages+' 页，请拆分后导入。');record.result={...job.result,text:job.result.text,warnings:Array.isArray(job.result.warnings)?job.result.warnings:[],documentParseId:record.id,originalFileId:record.fileId,originalOwnerId:session.user.id};return record.result;}
   if(job.status==='cancelled')throw Object.assign(new Error('已停止本站解析任务；上游文档解析服务可能仍在处理，原件仍保留在账户中。'),{name:'DocumentImportCancelled'});
   if(job.status==='failed')throw Error(typeof job.error==='string'?job.error:job.error?.message||'PDF 解析失败，请在任务中心查看原因；不会自动重新提交。');
   await sleepImpl(pollInterval,signal);
  }
  })();try{return await record.inFlight;}finally{record.inFlight=null;}
 };
}
export const extractWorkspaceDocument=createWorkspaceDocumentImporter();
export const documentImportContinuesInBackground=container=>!!container?.querySelector?.('[data-document-import-job]');

// Each import owns its status area. Removing the page/dialog only aborts waiting;
// an explicit Cancel button is the only path that cancels the server task.
export async function importWorkspaceDocument(file,target,options={}){
 const controller=new AbortController(),abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 const dialog=target?.closest?.('dialog'),opened=dialog?.open;
 const observer=typeof MutationObserver==='function'&&target?new MutationObserver(()=>{if(!target.isConnected||(opened&&!dialog.open))abort();}):null;observer?.observe(target.ownerDocument.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
 let previousCancel=null,cancelButton=null;
 const onProgress=event=>{if(!target?.isConnected||controller.signal.aborted)return;if(event.jobId)target.dataset.documentImportJob=event.jobId;target.replaceChildren();const label=target.ownerDocument.createElement('span');label.textContent=event.message+(event.progress===null||event.progress===undefined?'':` · ${Math.round(event.progress)}%`);target.append(label);if(event.cancel){cancelButton=target.ownerDocument.createElement('button');cancelButton.type='button';cancelButton.className='btn secondary';cancelButton.textContent='取消本站任务';cancelButton.style.marginLeft='8px';if(previousCancel===event.cancel&&previousCancel?.pending)cancelButton.disabled=true;previousCancel=event.cancel;cancelButton.onclick=async()=>{const button=cancelButton;button.disabled=true;event.cancel.pending=true;try{await event.cancel();if(button.isConnected)button.textContent='正在确认停止…';}catch{event.cancel.pending=false;if(button.isConnected){button.disabled=false;label.textContent='停止未确认，请在任务中心核对；上游可能仍在处理。';}}};target.append(cancelButton);}options.onProgress?.(event);};
 try{return await extractWorkspaceDocument(file,{...options,signal:controller.signal,onProgress});}finally{observer?.disconnect();options.signal?.removeEventListener('abort',abort);if(target?.dataset)delete target.dataset.documentImportJob;if(cancelButton?.isConnected)cancelButton.remove();}
}
