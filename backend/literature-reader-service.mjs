import {randomUUID} from 'node:crypto';
import {digest} from './auth.mjs';
import {createArtifactService,serializeArtifact} from './artifact-service.mjs';
import {createThesisDocumentRenderer} from './thesis-document-renderer.mjs';
import {prepareTranslationPreview} from './document-translation-document.mjs';
import {initializeDocumentTranslationSchema,documentTranslationReady} from './document-translation-service.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(v);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
export const annotationColors=Object.freeze(['yellow','green','blue','pink']);
export function validatePdfAnnotation(value){
 if(!plain(value)||!Number.isInteger(value.page)||value.page<1||value.page>100||!annotationColors.includes(value.color)||typeof value.quote!=='string'||!value.quote.trim()||value.quote.length>6000||typeof value.note!=='string'||value.note.length>3000||!Array.isArray(value.rects)||!value.rects.length||value.rects.length>100)fail(400,'标注内容无效，请缩短选中文字或备注后重试');
 const rects=value.rects.map(r=>{if(!plain(r)||Object.keys(r).some(k=>!['x','y','width','height'].includes(k))||['x','y','width','height'].some(k=>typeof r[k]!=='number'||!Number.isFinite(r[k]))||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>1.00001||r.y+r.height>1.00001)fail(400,'标注位置无效，请重新选中文字');return Object.fromEntries(['x','y','width','height'].map(k=>[k,Math.round(r[k]*1000000)/1000000]));});
 return{page:value.page,color:value.color,quote:value.quote.trim(),note:value.note.trim(),rects};
}
export function createLiteratureReaderService(db,config={}){
 initializeDocumentTranslationSchema(db);
 db.exec(`CREATE TABLE IF NOT EXISTS literature_pdf_annotations(id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),resource_kind TEXT NOT NULL,resource_id TEXT NOT NULL,source_sha256 TEXT NOT NULL,page INTEGER NOT NULL,color TEXT NOT NULL,quote TEXT NOT NULL,note TEXT NOT NULL,rects TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,resource_kind,resource_id,id));CREATE INDEX IF NOT EXISTS literature_pdf_annotations_resource ON literature_pdf_annotations(user_id,resource_kind,resource_id,source_sha256,deleted);CREATE TABLE IF NOT EXISTS literature_translation_previews(job_id TEXT PRIMARY KEY REFERENCES jobs(id),user_id TEXT NOT NULL REFERENCES users(id),source_sha256 TEXT NOT NULL,artifact_id TEXT NOT NULL,pages INTEGER NOT NULL,created_at TEXT NOT NULL);`);
 const renderer=config.literatureTranslationRenderer||createThesisDocumentRenderer({commandPath:config.thesisDocumentRenderCommand,enabled:config.thesisDocumentRenderEnabled,maxInputBytes:20*1024*1024,prepareDocument:prepareTranslationPreview,preserveConvertedDocument:false});
 const artifacts=createArtifactService(db,config),pending=new Map();
 function resource(kind,id,user){
  const row=db.prepare(`SELECT * FROM ${kind==='file'?'files':'artifacts'} WHERE id=? AND user_id=?`).get(id,user.id);
  if(!row||row.kind!=='pdf'||kind==='artifact'&&row.status!=='ready')fail(404,'PDF 文献不存在或已删除');
  if(kind==='file'&&db.prepare("SELECT 1 FROM workspace_file_deletions WHERE file_id=? AND status='pending'").get(id))fail(409,'文献正在删除，请重新选择');
  return row;
 }
 const serialize=row=>({id:row.id,page:row.page,color:row.color,quote:row.quote,note:row.note,rects:JSON.parse(row.rects),version:row.version,createdAt:row.created_at,updatedAt:row.updated_at});
 function ownedJob(id,user){const row=db.prepare("SELECT j.status,j.project_id,d.* FROM document_translation_runs d JOIN jobs j ON j.id=d.id WHERE d.id=? AND d.user_id=?").get(id,user.id);if(!row)fail(404,'译文任务不存在');const source=resource('file',row.file_id,user);if(source.sha256!==row.source_sha256)fail(409,'原文已经变化，请重新选择文献');return row;}
 function cachedPreview(job,user){const row=db.prepare("SELECT a.*,p.pages FROM literature_translation_previews p JOIN artifacts a ON a.id=p.artifact_id AND a.user_id=p.user_id WHERE p.job_id=? AND p.user_id=? AND p.source_sha256=? AND a.status='ready'").get(job.id,user.id,job.source_sha256);return row?{artifact:serializeArtifact(row),pages:row.pages,sourcePages:job.page_count,alignment:'unverified'}:null;}
 async function makePreview(job,user){
  const existing=cachedPreview(job,user);if(existing)return existing;
  if(job.status!=='completed')fail(409,'译文仍在生成，请等待完成');
  const source=JSON.parse(job.artifacts).filter(validId).map(id=>db.prepare("SELECT * FROM artifacts WHERE id=? AND user_id=? AND status='ready' AND kind='docx'").get(id,user.id)).find(Boolean);if(!source)fail(404,'译文文件已删除，请重新翻译');
  if(!(await renderer.status()).available)fail(503,'译文 PDF 服务暂不可用，请稍后重试');
  const bytes=await config.storage.readArtifact(source);if(!Buffer.isBuffer(bytes)||bytes.length!==source.bytes||digest(bytes)!==source.sha256)fail(503,'译文完整性核对未通过，请稍后重试');
  const output=await renderer.convert({bytes:new Uint8Array(bytes)});
  if(!output?.bytes||!Number.isInteger(output.pages)||output.pages<1||output.pages>100||Buffer.from(output.bytes).subarray(0,5).toString()!=='%PDF-')fail(422,'译文 PDF 超过 100 页或未能完整生成');
  // Recheck ownership and original before committing a long-running conversion.
  ownedJob(job.id,user);
  const saved=await artifacts({path:'/api/artifacts',method:'POST',user,readBody:async()=>({name:source.name.replace(/\.docx$/i,'.pdf'),data:Buffer.from(output.bytes).toString('base64'),sha256:digest(Buffer.from(output.bytes)),sourceType:'literature',sourceId:job.id,projectId:job.project_id,expectedUserId:user.id})});
  db.prepare('INSERT INTO literature_translation_previews VALUES(?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET artifact_id=excluded.artifact_id,pages=excluded.pages,created_at=excluded.created_at').run(job.id,user.id,job.source_sha256,saved.value.item.id,output.pages,new Date().toISOString());
  return cachedPreview(job,user);
 }
 return{async handle({path,method,user,readBody}){
  if(!path.startsWith('/api/literature/reader/'))return null;if(!validId(user?.id))fail(401,'请先登录服务账户');
  const annotation=path.match(/^\/api\/literature\/reader\/(file|artifact)\/([A-Za-z0-9_-]{1,120})\/annotations$/),translations=path.match(/^\/api\/literature\/reader\/files\/([A-Za-z0-9_-]{1,120})\/translations$/),preview=path.match(/^\/api\/literature\/reader\/translations\/([A-Za-z0-9_-]{1,120})\/pdf$/);
  if(annotation){
   const [,kind,id]=annotation,file=resource(kind,id,user),values=[user.id,kind,id,file.sha256];
   if(method==='GET')return{value:{items:db.prepare('SELECT * FROM literature_pdf_annotations WHERE user_id=? AND resource_kind=? AND resource_id=? AND source_sha256=? AND deleted=0 ORDER BY page,created_at,id LIMIT 1000').all(...values).map(serialize)}};
   if(method!=='POST')fail(405,'不支持的标注操作');const input=await readBody();if(!plain(input)||input.expectedUserId!==user.id)fail(409,'登录账户已变化，请重新打开文献');
   if(Object.keys(input).some(k=>!['id','action','version','page','color','quote','note','rects','expectedUserId'].includes(k))||!validId(input.id)||!['create','update','delete'].includes(input.action))fail(400,'标注请求无效');
   const old=db.prepare('SELECT * FROM literature_pdf_annotations WHERE user_id=? AND resource_kind=? AND resource_id=? AND id=?').get(user.id,kind,id,input.id),at=new Date().toISOString();
   if(input.action==='create'){
    const value=validatePdfAnnotation(input);if(old){if(!old.deleted&&old.source_sha256===file.sha256&&JSON.stringify(serialize(old).rects)===JSON.stringify(value.rects)&&old.quote===value.quote&&old.note===value.note&&old.color===value.color&&old.page===value.page)return{value:{item:serialize(old)}};fail(409,'这条标注已存在，请刷新标注列表');}
    if(db.prepare('SELECT count(*) n FROM literature_pdf_annotations WHERE user_id=? AND resource_kind=? AND resource_id=? AND deleted=0').get(user.id,kind,id).n>=1000)fail(409,'每份文献最多保存 1000 条标注');
    db.prepare('INSERT INTO literature_pdf_annotations VALUES(?,?,?,?,?,?,?,?,?,?,1,0,?,?)').run(input.id,...values,value.page,value.color,value.quote,value.note,JSON.stringify(value.rects),at,at);
   }else{
    if(!old||old.source_sha256!==file.sha256||old.deleted)fail(404,'标注不存在或已删除');if(!Number.isSafeInteger(input.version)||input.version!==old.version)fail(409,'标注已在其他页面更新，请重新读取后编辑');
    if(input.action==='delete')db.prepare('UPDATE literature_pdf_annotations SET deleted=1,version=version+1,updated_at=? WHERE user_id=? AND resource_kind=? AND resource_id=? AND id=? AND version=?').run(at,user.id,kind,id,input.id,input.version);
    else{const value=validatePdfAnnotation(input);db.prepare('UPDATE literature_pdf_annotations SET page=?,color=?,quote=?,note=?,rects=?,version=version+1,updated_at=? WHERE user_id=? AND resource_kind=? AND resource_id=? AND id=? AND version=?').run(value.page,value.color,value.quote,value.note,JSON.stringify(value.rects),at,user.id,kind,id,input.id,input.version);}
   }
   return{value:input.action==='delete'?{ok:true}:{item:serialize(db.prepare('SELECT * FROM literature_pdf_annotations WHERE user_id=? AND resource_kind=? AND resource_id=? AND id=?').get(user.id,kind,id,input.id))}};
  }
  if(translations){const file=resource('file',translations[1],user);if(method!=='GET')fail(405,'不支持的译文操作');return{value:{ready:documentTranslationReady(config)&&(await renderer.status()).available,items:db.prepare("SELECT j.id,j.status,j.stage,j.error,d.target_language targetLanguage,d.source_language sourceLanguage,j.created_at createdAt FROM jobs j JOIN document_translation_runs d ON d.id=j.id WHERE j.user_id=? AND d.file_id=? AND d.source_sha256=? ORDER BY j.created_at DESC,j.id DESC LIMIT 20").all(user.id,file.id,file.sha256)}};}
  if(preview){if(method!=='POST')fail(405,'不支持的 PDF 操作');const input=await readBody();if(!plain(input)||Object.keys(input).some(k=>k!=='expectedUserId')||input.expectedUserId!==user.id)fail(409,'账户状态已变化，请重新打开文献');const job=ownedJob(preview[1],user),key=user.id+':'+job.id;if(!pending.has(key)){if(pending.size>=2)fail(429,'译文 PDF 正在处理，请稍后重试');const promise=makePreview(job,user).finally(()=>pending.delete(key));pending.set(key,promise);}return{value:await pending.get(key)};}
  fail(404,'阅读操作不存在');
 }};
}
