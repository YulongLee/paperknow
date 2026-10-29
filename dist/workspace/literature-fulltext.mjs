export async function saveLiteratureFullText(row,{fetcher=(...args)=>fetch(...args),signal}={}){
 const timeout=AbortSignal.timeout(65000),combined=signal?AbortSignal.any([timeout,signal]):timeout;
 async function api(path,body){
  const response=await fetcher('/api'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:combined,...(body?{headers:{'Content-Type':'application/json','X-PaperKnow-User':body.expectedUserId},body:JSON.stringify(body)}:{})});
  let value;try{value=await response.json();}catch{throw Error('全文服务暂时无法连接，请稍后重试。');}
  if(!response.ok)throw Object.assign(Error(response.status===401?'请先登录，再将全文保存到云端。':typeof value.error==='string'?value.error:value.error?.message||'全文暂未取得，请前往原文页面下载后上传。'),{status:response.status});return value;
 }
 try{
  if(!row?.downloadToken)throw Error('这篇文献暂未提供可直接获取的全文，请前往原文页面获取。');
  const session=await api('/auth/me');if(!session.user?.id)throw Error('请先登录，再将全文保存到云端。');
  const result=await api('/literature/files',{token:row.downloadToken,expectedUserId:session.user.id});
  if(!result.id||result.ownerId!==session.user.id)throw Error('全文保存信息未确认，请到文件管理核对。');
  const checked=await api('/auth/me');if(checked.user?.id!==session.user.id)throw Error('登录账户已变化，文件已保存在原账户，请重新打开页面。');return result;
 }catch(error){if(signal?.aborted)throw Object.assign(Error('已停止等待全文获取，可在文件管理核对已保存的文件。'),{name:'AbortError'});if(timeout.aborted)throw Error('获取全文超时，请稍后重试；已保存的文件可在文件管理查看。');throw error;}
}

export async function readSavedLiteratureFullText(paper,{fetcher=(...args)=>fetch(...args),signal,onJob=()=>{},onProgress=()=>{},pollInterval=1800,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 if(!paper.originalFileId||!paper.originalOwnerId)throw Error('请先保存文献全文。');
 const started=Date.now();
 async function api(path,body){const response=await fetcher('/api'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000),headers:{'X-PaperKnow-User':paper.originalOwnerId,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Error(typeof value.error==='string'?value.error:value.error?.message||'原文暂时无法处理，请稍后重试。');return value;}
 let jobId=paper.documentParseId;
 if(!jobId){onProgress('正在准备全文研读…');const job=await api('/document-parses',{fileId:paper.originalFileId,idempotencyKey:crypto.randomUUID(),consent:true,expectedUserId:paper.originalOwnerId});jobId=job.id;if(!jobId)throw Error('未取得原文处理任务，请到任务中心核对。');onJob(jobId);}
 for(;;){
  if(signal?.aborted)throw Object.assign(Error('页面已切换，原文处理可在任务中心继续查看。'),{name:'AbortError'});
  if(Date.now()-started>15*60000)throw Error('原文仍在处理中，可稍后重新打开或在任务中心查看，无需重复提交。');
  const job=await api('/document-parses/'+encodeURIComponent(jobId));
  if(job.status==='completed'){if(!job.result?.text?.trim())throw Error('未取得可研读的正文，请在任务中心核对。');return {...job.result,documentParseId:jobId};}
  if(['failed','cancelled'].includes(job.status))throw Object.assign(Error(typeof job.error==='string'?job.error:'全文处理尚未完成，请在任务中心查看。'),{parseJobFailed:true});
  const done=Number(job.progress?.extractedPages)||0,total=Number(job.progress?.totalPages)||0;onProgress(total?'正在准备全文研读 · '+done+' / '+total+' 页':'正在准备全文研读，请稍候…');await sleep(pollInterval);
 }
}
