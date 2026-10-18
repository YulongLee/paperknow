import {randomUUID} from 'node:crypto';
import {createMineruClient} from './mineru-client.mjs';
import {createArtifactService} from './artifact-service.mjs';
import {fileBytes} from './storage.mjs';
import {digest} from './auth.mjs';
import {documentParseLimits,documentParsingReady,initializeDocumentParseSchema} from './document-parse-service.mjs';
import {compute} from './compute.mjs';

// Remote submissions are never replayed on restart. A known batch may be polled
// and its immutable result downloaded again; an unknown submit needs user review.
export function startDocumentParseWorker(db,config={}){
 initializeDocumentParseSchema(db);
 const clock=()=>new Date().toISOString(),tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}};
 const artifacts=createArtifactService(db,config),controllers=new Map(),cleanups=new Set();let busy=false,stopped=false;
 const client=config.documentParseClient||(documentParsingReady(config)?createMineruClient({token:config.mineruToken,baseURL:config.mineruBaseURL||'https://mineru.net/api/v4'}):null);
 const stillActive=id=>!stopped&&db.prepare("SELECT 1 FROM jobs WHERE id=? AND type='document_parse' AND status='running'").get(id);
 const stage=(id,value)=>db.prepare("UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND status='running'").run(value,clock(),id);
 const schedule=id=>db.prepare('UPDATE document_parse_runs SET next_poll_at=?,updated_at=? WHERE id=?').run(new Date(Date.now()+(config.documentParsePollDelayMs??6000)).toISOString(),clock(),id);
 async function removeOwnedArtifacts(id){
  const run=db.prepare('SELECT user_id,created_artifacts FROM document_parse_runs WHERE id=?').get(id);if(!run)return;
  const rows=JSON.parse(run.created_artifacts).map(artifactId=>db.prepare("SELECT id,sha256 FROM artifacts WHERE id=? AND user_id=? AND status IN ('ready','failed','deleting')").get(artifactId,run.user_id)).filter(Boolean);
  for(const row of rows){const user=db.prepare('SELECT user_id FROM jobs WHERE id=?').get(id);if(!user)continue;try{await artifacts({path:'/api/artifacts/'+row.id+'/delete',method:'POST',user:{id:user.user_id},readBody:async()=>({expectedSha256:row.sha256,expectedUserId:user.user_id})});}catch{/* indexed failures remain visible and retryable; never delete untracked or deduplicated content */}}
  tx(()=>{const current=db.prepare('SELECT created_artifacts FROM document_parse_runs WHERE id=?').get(id);if(!current)return;const remaining=JSON.parse(current.created_artifacts).filter(artifactId=>db.prepare("SELECT 1 FROM artifacts WHERE id=? AND user_id=? AND status!='deleted'").get(artifactId,run.user_id));db.prepare('UPDATE document_parse_runs SET created_artifacts=?,updated_at=? WHERE id=?').run(JSON.stringify(remaining),clock(),id);});
 }
 function cleanup(id){const task=removeOwnedArtifacts(id).catch(()=>{}).finally(()=>cleanups.delete(task));cleanups.add(task);return task;}
 tx(()=>{
  db.prepare("UPDATE jobs SET status='failed',stage='submission_unconfirmed',error='云端提交在服务切换时未获确认，未自动重复解析。请核对任务后从原件重新提交。',updated_at=? WHERE id IN (SELECT id FROM document_parse_runs WHERE provider_state='requesting_upload' AND provider_batch_id IS NULL) AND status='running'").run(clock());
 });
 async function pageCount(buffer,signal){
  if(config.documentPageCount)return config.documentPageCount(buffer,signal);
  try{return(await compute('pdfMetadata',{body:buffer},signal)).pages;}catch{throw Object.assign(new Error('PDF 无法读取、已加密或结构超过限制，请另存为可读取的 PDF 后重试。'),{documentSafe:true});}
 }
 async function saveArtifact(job,buffer,suffix){
  const safe=job.file_name.replace(/\.pdf$/i,'').replace(/[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/g,'_').slice(0,125)||'PDF文档';
  const response=await artifacts({path:'/api/artifacts',method:'POST',user:{id:job.user_id},readBody:async()=>({name:safe+suffix,data:buffer.toString('base64'),sha256:digest(buffer),projectId:job.project_id,sourceType:'other',sourceId:job.id,expectedUserId:job.user_id})});
  const item=response.value.item;
  tx(()=>{const row=db.prepare('SELECT artifacts,created_artifacts FROM document_parse_runs WHERE id=?').get(job.id),ids=JSON.parse(row.artifacts),owned=JSON.parse(row.created_artifacts);if(!ids.includes(item.id))ids.push(item.id);if(!response.value.deduplicated&&!owned.includes(item.id))owned.push(item.id);db.prepare('UPDATE document_parse_runs SET artifacts=?,created_artifacts=?,updated_at=? WHERE id=?').run(JSON.stringify(ids),JSON.stringify(owned),clock(),job.id);});
  return item.id;
 }
 async function finish(job,parsed){
  if(!stillActive(job.id))return;
  if(parsed.pageCount!==job.expected_pages||!Array.isArray(parsed.pages)||parsed.pages.length!==job.expected_pages||parsed.pages.some((p,i)=>p.pageIndex!==i)||typeof parsed.text!=='string'||!parsed.text.trim()||parsed.text.length>documentParseLimits.maxCharacters)throw Object.assign(new Error('解析内容或页数不完整，请分章节处理或联系支持；未保存为完成结果'),{documentSafe:true});
  stage(job.id,'saving');
  const warnings=['云端识别可能存在文字、表格或公式误差，请对照原件核对。'];
  const structured={version:1,text:parsed.text,markdown:parsed.markdown,pages:parsed.pages,warnings,contentList:parsed.contentList??null,layout:parsed.layout??null};
  const json=Buffer.from(JSON.stringify(structured));if(json.length>8*1024*1024)throw Object.assign(new Error('解析结构超过保存限制，请分章节上传。'),{documentSafe:true});
  if(!Buffer.isBuffer(parsed.rawZip)||parsed.rawZip.length>20*1024*1024)throw Object.assign(new Error('解析资源包超过 20MB，请分章节上传。'),{documentSafe:true});
  await saveArtifact(job,Buffer.from(parsed.markdown),'_解析.md');if(!stillActive(job.id)){await removeOwnedArtifacts(job.id);return;}
  const structuredId=await saveArtifact(job,json,'_解析结构.json');if(!stillActive(job.id)){await removeOwnedArtifacts(job.id);return;}
  await saveArtifact(job,parsed.rawZip,'_解析资源.zip');if(!stillActive(job.id)){await removeOwnedArtifacts(job.id);return;}
  tx(()=>{
   if(!stillActive(job.id))return;
   const ids=JSON.parse(db.prepare('SELECT artifacts FROM document_parse_runs WHERE id=?').get(job.id).artifacts),id=randomUUID(),at=clock();
   db.prepare('UPDATE document_parse_runs SET structured_artifact_id=?,provider_state=\'done\',extracted_pages=?,total_pages=?,updated_at=? WHERE id=?').run(structuredId,parsed.pageCount,parsed.pageCount,at,job.id);
   // Parsed files live only in private OSS; SQLite contains metadata and indexes.
   db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run(id,job.user_id,job.project_id,job.id,'document_parse',job.file_name+' · PDF解析',JSON.stringify({documentParseId:job.id,fileName:job.file_name,characters:Array.from(parsed.text).length,pages:parsed.pageCount,artifacts:ids,scope:'云端 PDF 解析，正文与结构保存在账户私有云存储。'}),at);
   db.prepare("UPDATE jobs SET status='completed',stage='completed',result_id=?,updated_at=? WHERE id=? AND status='running'").run(id,at,job.id);
  });
 }
 async function tick(){
  if(busy||stopped||!client)return;
  const row=db.prepare("SELECT j.*,d.file_id,d.source_sha256,d.file_name,d.expected_pages,d.provider_state,d.provider_batch_id,d.started_at FROM jobs j JOIN document_parse_runs d ON d.id=j.id WHERE j.type='document_parse' AND j.status IN ('queued','running') AND (d.next_poll_at IS NULL OR d.next_poll_at<=?) ORDER BY j.created_at LIMIT 1").get(clock());if(!row){const pending=db.prepare("SELECT d.id FROM document_parse_runs d JOIN jobs j ON j.id=d.id WHERE j.status IN ('failed','cancelled') AND d.created_artifacts!='[]' AND d.updated_at<? ORDER BY d.updated_at LIMIT 1").get(new Date(Date.now()-60000).toISOString());if(pending){busy=true;try{await cleanup(pending.id);}finally{busy=false;}}return;}
  busy=true;const controller=new AbortController();controllers.set(row.id,controller);
  const timer=setTimeout(()=>controller.abort(),90000);timer.unref?.();
  try{
   if(row.status==='queued'&&!tx(()=>{const at=clock();if(!db.prepare("UPDATE jobs SET status='running',stage='reading',attempt=attempt+1,updated_at=? WHERE id=? AND status='queued'").run(at,row.id).changes)return false;db.prepare('UPDATE document_parse_runs SET started_at=coalesce(started_at,?),updated_at=? WHERE id=?').run(at,at,row.id);return true;}))return;
   if(!stillActive(row.id))return;
   if(row.started_at&&Date.now()-Date.parse(row.started_at)>30*60000)throw Object.assign(new Error('云端解析等待超过30分钟，请稍后查看原件并重新提交。'),{documentSafe:true});
   if(!row.provider_batch_id){
    const file=db.prepare('SELECT * FROM files WHERE id=? AND user_id=?').get(row.file_id,row.user_id);
    if(!file||file.kind!=='pdf'||file.sha256!==row.source_sha256||file.storage_provider!=='aliyun_oss')throw Object.assign(new Error('PDF 原件已变化或云存储不可用，请重新选择文件。'),{documentSafe:true});
    const source=await fileBytes(file,config.storage);if(source.length!==file.bytes||digest(source)!==row.source_sha256)throw Object.assign(new Error('原件完整性校验未通过，请重新上传 PDF。'),{documentSafe:true});if(source.length>documentParseLimits.maxFileBytes)throw Object.assign(new Error('PDF 超过20MB，请分章节上传。'),{documentSafe:true});
    const count=await pageCount(source,controller.signal);if(!Number.isInteger(count)||count<1||count>documentParseLimits.maxPages)throw Object.assign(new Error('PDF 云端解析最多支持100页，请分章节上传。'),{documentSafe:true});
    if(!stillActive(row.id))return;
    db.prepare("UPDATE document_parse_runs SET expected_pages=?,total_pages=?,provider_state='requesting_upload',updated_at=? WHERE id=?").run(count,count,clock(),row.id);stage(row.id,'uploading');
    const created=await client.createUpload({name:'document.pdf',dataId:row.id,pageRanges:'1-'+count},controller.signal);
    // Retain an acknowledged batch even after local cancellation. Never POST a
    // second create request to compensate for an unknown or interrupted result.
    db.prepare("UPDATE document_parse_runs SET provider_batch_id=?,provider_state='awaiting_upload',updated_at=? WHERE id=?").run(created.batchId,clock(),row.id);
    if(!stillActive(row.id))return;
    await client.upload(created.uploadURL,source,controller.signal);
    if(!stillActive(row.id))return;
    db.prepare("UPDATE document_parse_runs SET provider_state='uploaded',updated_at=? WHERE id=?").run(clock(),row.id);stage(row.id,'pending');schedule(row.id);return;
   }
   const polled=await client.poll(row.provider_batch_id,controller.signal,{dataId:row.id});if(!stillActive(row.id))return;
   const p=polled.progress||{};db.prepare('UPDATE document_parse_runs SET extracted_pages=?,total_pages=coalesce(?,total_pages),updated_at=? WHERE id=?').run(p.extractedPages??null,p.totalPages??null,clock(),row.id);
   if(polled.state==='failed')throw Object.assign(new Error('云端服务未能完成此 PDF 的解析，请检查文件后重新提交。'),{documentSafe:true});
   if(polled.state==='done'){stage(row.id,'downloading');const parsed=await client.downloadResult(polled.zipURL,controller.signal);if(stillActive(row.id))await finish(row,parsed);return;}
   if(polled.state==='waiting-file'&&row.provider_state==='awaiting_upload')throw Object.assign(new Error('文件上传在服务切换时未完成，未自动重复上传。请从原件重新提交解析。'),{documentSafe:true});
   stage(row.id,polled.state==='running'?'recognizing':polled.state==='converting'?'converting':'pending');schedule(row.id);
  }catch(error){
   // Read-only status/result requests may safely be repeated against the same
   // acknowledged batch. Never repeat a create or upload after an unknown outcome.
   if(stillActive(row.id)&&row.provider_batch_id&&error.mineruSafe&&['mineru_transport_failed','mineru_timeout','mineru_dns_failed','mineru_unavailable','mineru_rate_limited'].includes(error.code)&&row.started_at&&Date.now()-Date.parse(row.started_at)<30*60000){
    stage(row.id,'reconnecting');db.prepare('UPDATE document_parse_runs SET next_poll_at=?,updated_at=? WHERE id=?').run(new Date(Date.now()+15000).toISOString(),clock(),row.id);return;
   }
   if(stillActive(row.id)&&row.provider_batch_id&&error.status===409&&/相同成果正在保存/.test(error.message)){
    stage(row.id,'saving_wait');db.prepare('UPDATE document_parse_runs SET next_poll_at=?,updated_at=? WHERE id=?').run(new Date(Date.now()+15000).toISOString(),clock(),row.id);return;
   }
   if(stillActive(row.id)){
    const message=error.mineruSafe||error.documentSafe?error.message:controller.signal.aborted?'本次文档解析连接超时，请稍后查看任务；未自动重复提交。':'PDF解析暂未完成，请检查原件或联系支持；未自动重复提交。';
    db.prepare("UPDATE jobs SET status='failed',stage='failed',error=?,updated_at=? WHERE id=? AND status='running'").run(message.slice(0,300),clock(),row.id);
   }
   if(db.prepare('SELECT status FROM jobs WHERE id=?').get(row.id)?.status!=='completed')await removeOwnedArtifacts(row.id);
  }finally{clearTimeout(timer);controllers.delete(row.id);busy=false;}
 }
 const interval=setInterval(()=>void tick(),config.documentParseTickMs??1000);interval.unref?.();
 return{tick,cancel(id){controllers.get(id)?.abort();void cleanup(id);},async stop(){stopped=true;clearInterval(interval);for(const c of controllers.values())c.abort();while(busy)await new Promise(resolve=>setTimeout(resolve,10));await Promise.allSettled([...cleanups]);}};
}
