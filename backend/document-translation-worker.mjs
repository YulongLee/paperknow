import {createBillingService} from './billing-service.mjs';
import {randomUUID} from 'node:crypto';
import {validateTranslationDocument as docxSize} from './document-translation-document.mjs';
const safe=message=>Object.assign(new Error(message),{documentTranslationSafe:true});
import {digest} from './auth.mjs';
import {fileBytes} from './storage.mjs';
import {compute} from './compute.mjs';
import {createArtifactService} from './artifact-service.mjs';
import {createDocumentTranslationClient} from './document-translation-client.mjs';
import {documentTranslationLimits,documentTranslationReady,initializeDocumentTranslationSchema} from './document-translation-service.mjs';


export function startDocumentTranslationWorker(db,config={}){
 const billing=config.billing||createBillingService(db,config);initializeDocumentTranslationSchema(db);
 const clock=()=>new Date().toISOString(),tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 const artifacts=createArtifactService(db,config),controllers=new Map(),cleanups=new Set();let busy=false,stopped=false;
 const client=config.documentTranslationClient||(documentTranslationReady(config)?createDocumentTranslationClient(config):null);
 const active=id=>!stopped&&Boolean(db.prepare("SELECT 1 FROM jobs WHERE id=? AND type='document_translation' AND status='running'").get(id));
 const stage=(id,value)=>db.prepare("UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND status='running'").run(value,clock(),id);
 const schedule=(id,delay=config.documentTranslationPollDelayMs??6000)=>db.prepare('UPDATE document_translation_runs SET next_poll_at=?,updated_at=? WHERE id=?').run(new Date(Date.now()+delay).toISOString(),clock(),id);
 async function removeOwned(id){
  const run=db.prepare('SELECT user_id,created_artifacts FROM document_translation_runs WHERE id=?').get(id);if(!run)return;
  for(const artifactId of JSON.parse(run.created_artifacts)){
   const item=db.prepare("SELECT id,sha256 FROM artifacts WHERE id=? AND user_id=? AND status IN ('ready','failed','deleting')").get(artifactId,run.user_id);if(!item)continue;
   try{await artifacts({path:'/api/artifacts/'+item.id+'/delete',method:'POST',user:{id:run.user_id},readBody:async()=>({expectedSha256:item.sha256,expectedUserId:run.user_id})});}catch{/* Keep indexed cleanup failures for retry, never touch another user's content. */}
  }
  tx(()=>{const current=db.prepare('SELECT created_artifacts FROM document_translation_runs WHERE id=?').get(id);if(!current)return;const remaining=JSON.parse(current.created_artifacts).filter(artifactId=>db.prepare("SELECT 1 FROM artifacts WHERE id=? AND user_id=? AND status!='deleted'").get(artifactId,run.user_id));db.prepare('UPDATE document_translation_runs SET created_artifacts=?,updated_at=? WHERE id=?').run(JSON.stringify(remaining),clock(),id);});
 }
 function cleanup(id){const work=removeOwned(id).catch(()=>{}).finally(()=>cleanups.delete(work));cleanups.add(work);return work;}
 // A remote create might have succeeded even if the process died before its ID
 // was persisted. Never automatically create another paid task in that state.
 tx(()=>{const interrupted=db.prepare("SELECT j.id FROM jobs j JOIN document_translation_runs d ON d.id=j.id WHERE d.provider_state='submitting' AND d.provider_task_id IS NULL AND j.status='running'").all();for(const row of interrupted){db.prepare("UPDATE jobs SET status='failed',stage='submission_unconfirmed',error='文档翻译提交未获确认，未自动重复提交，预占权益已释放；请核对任务后重新提交。',updated_at=? WHERE id=?").run(clock(),row.id);billing.release(row.id);}});
 async function preflight(file,source,signal){
  if(source.length!==file.bytes||source.length>documentTranslationLimits.maxFileBytes||digest(source)!==file.sha256)throw safe('文档原件完整性校验未通过，请重新上传');
  if(file.kind==='docx')return docxSize(source);
  let pages;try{pages=config.documentTranslationPageCount?await config.documentTranslationPageCount(source,signal):(await compute('pdfMetadata',{body:source},signal)).pages;}catch{throw safe('PDF无法读取或已加密，请另存为可读取的PDF后重试');}
  if(!Number.isInteger(pages)||pages<1||pages>documentTranslationLimits.maxPages)throw safe('整篇文档翻译最多支持100页，请分章节上传');return pages;
 }
 function reservePages(job,pages){
  tx(()=>{
   if(billing.isBillable(job.id)){db.prepare('UPDATE document_translation_runs SET expected_pages=?,updated_at=? WHERE id=?').run(pages,clock(),job.id);return;}
   const day=new Date(job.created_at);day.setUTCHours(0,0,0,0);const from=day.toISOString(),to=new Date(day.getTime()+86400000).toISOString();
   const freePages=" FROM document_translation_runs d LEFT JOIN billing_reservations b ON b.job_id=d.id AND b.attempt=1 WHERE (b.source='free' OR b.id IS NULL) AND d.id!=? AND d.created_at>=? AND d.created_at<?";
   const owner=db.prepare('SELECT coalesce(sum(d.expected_pages),0) n'+freePages+' AND d.user_id=?').get(job.id,from,to,job.user_id).n;
   const all=db.prepare('SELECT coalesce(sum(d.expected_pages),0) n'+freePages).get(job.id,from,to).n;
   if(owner+pages>documentTranslationLimits.userDailyPages)throw safe('今日文档翻译页数额度不足，请分章节或明天再试');
   if(all+pages>documentTranslationLimits.globalDailyPages)throw safe('文档翻译今日页数额度已用完，请明天再试');
   db.prepare('UPDATE document_translation_runs SET expected_pages=?,updated_at=? WHERE id=?').run(pages,clock(),job.id);
  });
 }
 async function finish(job,buffer,pageCount){
  if(!active(job.id))return;
  if(!Buffer.isBuffer(buffer)||buffer.length<4||buffer.length>20*1024*1024)throw safe('译文文件大小不受支持，请分章节翻译');
  await docxSize(buffer,{source:false});if(!active(job.id))return;stage(job.id,'saving');
  const stem=job.file_name.replace(/\.(?:pdf|docx)$/i,'').replace(/[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/g,'_').slice(0,130)||'文档';
  const response=await artifacts({path:'/api/artifacts',method:'POST',user:{id:job.user_id},readBody:async()=>({name:stem+'_译文_'+job.target_language+'.docx',data:buffer.toString('base64'),sha256:digest(buffer),projectId:job.project_id,sourceType:'literature',sourceId:job.id,expectedUserId:job.user_id})});
  const item=response.value.item;
  tx(()=>{const row=db.prepare('SELECT artifacts,created_artifacts FROM document_translation_runs WHERE id=?').get(job.id),ids=JSON.parse(row.artifacts),owned=JSON.parse(row.created_artifacts);if(!ids.includes(item.id))ids.push(item.id);if(!response.value.deduplicated&&!owned.includes(item.id))owned.push(item.id);db.prepare('UPDATE document_translation_runs SET artifacts=?,created_artifacts=?,updated_at=? WHERE id=?').run(JSON.stringify(ids),JSON.stringify(owned),clock(),job.id);});
  if(!active(job.id)){await removeOwned(job.id);return;}
  tx(()=>{
   if(!active(job.id))return;const id=randomUUID(),at=clock();billing.settle(job.id);
   db.prepare("UPDATE document_translation_runs SET page_count=?,provider_state='done',updated_at=? WHERE id=?").run(pageCount,at,job.id);
   db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run(id,job.user_id,job.project_id,job.id,'document_translation',job.file_name+' · 文档翻译',JSON.stringify({documentTranslationId:job.id,fileName:job.file_name,sourceLanguage:job.source_language,targetLanguage:job.target_language,pageCount,artifacts:[item.id],scope:'整篇文档译文保存在账户私有云存储，下载为DOCX；专业术语、公式、表格及排版需核对。'}),at);
   db.prepare("UPDATE jobs SET status='completed',stage='completed',result_id=?,error=NULL,updated_at=? WHERE id=? AND status='running'").run(id,at,job.id);
  });
 }
 async function tick(){
  if(busy||stopped||!client)return;
  const job=db.prepare("SELECT j.*,d.file_id,d.source_sha256,d.file_name,d.source_language,d.target_language,d.expected_pages,d.provider_state,d.provider_task_id,d.started_at FROM jobs j JOIN document_translation_runs d ON d.id=j.id WHERE j.type='document_translation' AND j.status IN ('queued','running') AND (d.next_poll_at IS NULL OR d.next_poll_at<=?) ORDER BY j.created_at,j.id LIMIT 1").get(clock());
  if(!job){const pending=db.prepare("SELECT d.id FROM document_translation_runs d JOIN jobs j ON j.id=d.id WHERE j.status IN ('failed','cancelled') AND d.created_artifacts!='[]' AND d.updated_at<? ORDER BY d.updated_at LIMIT 1").get(new Date(Date.now()-60000).toISOString());if(pending){busy=true;try{await cleanup(pending.id);}finally{busy=false;}}return;}
  busy=true;const controller=new AbortController();controllers.set(job.id,controller);const timer=setTimeout(()=>controller.abort(),90000);timer.unref?.();
  try{
   if(job.status==='queued'&&!tx(()=>{const at=clock();if(!db.prepare("UPDATE jobs SET status='running',stage='reading',attempt=attempt+1,updated_at=? WHERE id=? AND status='queued'").run(at,job.id).changes)return false;db.prepare('UPDATE document_translation_runs SET started_at=coalesce(started_at,?),updated_at=? WHERE id=?').run(at,at,job.id);return true;}))return;
   if(!active(job.id))return;
   if(JSON.parse(job.input).billingRequired===true&&!db.prepare("SELECT 1 FROM billing_reservations WHERE job_id=? AND status='held'").get(job.id))throw safe('本次文献研读权益预占无效，请重新提交');
   if(job.started_at&&Date.now()-Date.parse(job.started_at)>30*60000)throw safe('文档翻译等待超过30分钟，请检查原件后重新确认提交');
   if(!job.provider_task_id){
    const file=db.prepare('SELECT * FROM files WHERE id=? AND user_id=?').get(job.file_id,job.user_id);
    if(!file||!['pdf','docx'].includes(file.kind)||file.sha256!==job.source_sha256||file.storage_provider!=='aliyun_oss'||db.prepare("SELECT 1 FROM workspace_file_deletions WHERE file_id=? AND status='pending'").get(file.id))throw safe('文档原件已变化或正在删除，请重新选择');
    const source=await fileBytes(file,config.storage),pages=await preflight(file,source,controller.signal);if(!active(job.id))return;
    reservePages(job,pages);
    const fileURL=await config.storage.signedOriginalURL(file,600);if(!active(job.id))return;
    db.prepare("UPDATE document_translation_runs SET provider_state='submitting',updated_at=? WHERE id=?").run(clock(),job.id);stage(job.id,'submitting');
    const created=await client.create({fileURL,sourceLanguage:job.source_language,targetLanguage:job.target_language,clientToken:job.id},controller.signal);
    // Persist an acknowledged task even if cancellation arrived during create.
    db.prepare("UPDATE document_translation_runs SET provider_task_id=?,provider_state='submitted',updated_at=? WHERE id=?").run(created.taskId,clock(),job.id);
    if(active(job.id)){stage(job.id,'pending');schedule(job.id);}return;
   }
   const polled=await client.poll(job.provider_task_id,controller.signal);if(!active(job.id))return;
   if(polled.state==='error')throw safe('云端文档翻译未完成，请检查文件是否可读取并联系支持');
   if(polled.state==='translated'){
    if(polled.pageCount!==null&&(!Number.isInteger(polled.pageCount)||polled.pageCount<1||polled.pageCount>documentTranslationLimits.maxPages))throw safe('译文页数超过处理限制，请联系支持');
    stage(job.id,'downloading');const buffer=await client.downloadResult(polled.downloadURL,controller.signal);if(active(job.id))await finish(job,buffer,polled.pageCount??job.expected_pages);return;
   }
   if(!['ready','translating'].includes(polled.state))throw safe('文档翻译任务状态无效，请联系支持');
   stage(job.id,polled.state==='translating'?'translating':'pending');schedule(job.id);
  }catch(error){
   if(active(job.id)&&job.provider_task_id&&error.documentTranslationSafe&&['document_translation_unavailable','document_translation_timeout','document_translation_busy'].includes(error.code)){
    stage(job.id,'reconnecting');schedule(job.id,15000);return;
   }
   if(active(job.id)&&job.provider_task_id&&error.status===409&&/相同成果正在保存/.test(error.message)){stage(job.id,'saving_wait');schedule(job.id,15000);return;}
   if(active(job.id)){
    const message=error.documentTranslationSafe?error.message:controller.signal.aborted?'本次文档翻译连接超时，未自动重复提交，请稍后查看任务。':'文档翻译暂未完成，未自动重复提交，请核对文件或联系支持。';
    tx(()=>{db.prepare("UPDATE jobs SET status='failed',stage='failed',error=?,updated_at=? WHERE id=? AND status='running'").run(message.slice(0,300),clock(),job.id);billing.release(job.id);});
   }
   if(db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id)?.status!=='completed')await removeOwned(job.id);
  }finally{clearTimeout(timer);controllers.delete(job.id);busy=false;}
 }
 const interval=setInterval(()=>void tick(),config.documentTranslationTickMs??1000);interval.unref?.();
 return{tick,cancel(id){controllers.get(id)?.abort();void cleanup(id);},async stop(){stopped=true;clearInterval(interval);for(const controller of controllers.values())controller.abort();while(busy)await new Promise(resolve=>setTimeout(resolve,10));await Promise.allSettled([...cleanups]);}};
}
