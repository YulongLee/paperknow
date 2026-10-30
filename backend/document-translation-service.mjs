import {v1CommercialEnabled} from './v1-commercial-policy.mjs';
import {commercialDocumentPages} from './commercial-resources.mjs';
import {createBillingService} from './billing-service.mjs';
import {documentTranslationReady} from './document-translation-readiness.mjs';
import {randomUUID} from 'node:crypto';
import {digest} from './auth.mjs';
import {initializeArtifactSchema} from './artifact-service.mjs';

export const documentTranslationLimits=Object.freeze({maxFileBytes:10*1024*1024,maxPages:100,maxDocxCharacters:100000,userDaily:3,globalDaily:20,userDailyPages:100,globalDailyPages:500});
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const idValid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(v);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function initializeDocumentTranslationSchema(db){
 initializeArtifactSchema(db);
 db.exec(`CREATE TABLE IF NOT EXISTS document_translation_runs(
  id TEXT PRIMARY KEY REFERENCES jobs(id),user_id TEXT NOT NULL REFERENCES users(id),file_id TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,file_name TEXT NOT NULL,source_language TEXT NOT NULL,target_language TEXT NOT NULL,
  expected_pages INTEGER,page_count INTEGER,provider_state TEXT NOT NULL DEFAULT 'new',provider_task_id TEXT,
  next_poll_at TEXT,started_at TEXT,artifacts TEXT NOT NULL DEFAULT '[]',created_artifacts TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL
 );CREATE INDEX IF NOT EXISTS document_translation_owner ON document_translation_runs(user_id,created_at);
 CREATE INDEX IF NOT EXISTS document_translation_poll ON document_translation_runs(next_poll_at);CREATE TABLE IF NOT EXISTS document_translation_quotes(token TEXT PRIMARY KEY REFERENCES billing_quotes(token) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),input_hash TEXT NOT NULL,created_at TEXT NOT NULL);`);
}
export {documentTranslationReady} from './document-translation-readiness.mjs';
export function documentTranslationCapabilities(config={}){return{ready:documentTranslationReady(config),maxFileBytes:documentTranslationLimits.maxFileBytes,maxPages:documentTranslationLimits.maxPages,maxDocxFileBytes:2*1024*1024,maxDocxCharacters:documentTranslationLimits.maxDocxCharacters,formats:['pdf','docx'],sourceLanguages:['zh','en'],targetLanguages:['zh','en'],outputFormat:'docx',consentRequired:true,pointsCharged:true,billingService:'literature-read',storage:'private_account',reason:documentTranslationReady(config)?'':'整篇文档翻译暂未开放，可继续使用正文翻译。'};}
export function createDocumentTranslationService(db,config={}){
 const billing=config.billing||createBillingService(db,config);initializeDocumentTranslationSchema(db);
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 const own=(id,user)=>{const row=db.prepare("SELECT j.*,d.file_id,d.file_name,d.source_language,d.target_language,d.page_count,d.artifacts FROM jobs j JOIN document_translation_runs d ON d.id=j.id WHERE j.id=? AND j.user_id=? AND j.type='document_translation'").get(id,user.id);if(!row)fail(404,'文档翻译任务不存在');return row;};
 const summary=row=>({id:row.id,status:row.status,stage:row.stage,error:row.error||null,fileName:row.file_name,sourceLanguage:row.source_language,targetLanguage:row.target_language,pageCount:row.page_count??null,resultId:row.result_id||null,createdAt:row.created_at,updatedAt:row.updated_at});
 const completed=row=>{const items=JSON.parse(row.artifacts).filter(idValid).map(id=>db.prepare("SELECT id,name,kind,bytes FROM artifacts WHERE id=? AND user_id=? AND status='ready'").get(id,row.user_id)).filter(Boolean).map(item=>({...item,downloadUrl:'/api/artifacts/'+item.id+'/download'}));return{artifacts:items,sourceLanguage:row.source_language,targetLanguage:row.target_language,pageCount:row.page_count??null,warnings:['译文为 Word（DOCX）格式；可在阅读工作区打开对照 PDF。专业术语、表格与公式请对照原文核对。',...(items.length?[]:['译文文件已移除，可从任务记录查看后重新翻译。'])]};};
 function normalized(input,user,quoting){
  const allowed=quoting?['fileId','sourceLanguage','targetLanguage','expectedUserId']:['fileId','sourceLanguage','targetLanguage','idempotencyKey','consent','expectedUserId','billingToken'];
  if(!plain(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail(400,'文档翻译请求包含不支持的字段');
  if(input.expectedUserId!==user.id)fail(409,'登录账户已变化，请刷新后重新选择文件');
  if(!quoting&&input.consent!==true)fail(400,'请确认将原件发送至云端文档翻译服务');
  if(!idValid(input.fileId)||!quoting&&(typeof input.idempotencyKey!=='string'||!/^[-A-Za-z0-9_]{8,100}$/.test(input.idempotencyKey)))fail(400,'翻译文件或请求编号无效');
  if(!['zh','en'].includes(input.sourceLanguage)||!['zh','en'].includes(input.targetLanguage)||input.sourceLanguage===input.targetLanguage)fail(400,'请选择不同的原文和译文语言，当前支持中英互译');
  const file=db.prepare('SELECT * FROM files WHERE id=? AND user_id=?').get(input.fileId,user.id);if(!file)fail(404,'文档原件不存在');
  if(!['pdf','docx'].includes(file.kind)||file.bytes<1||file.bytes>documentTranslationLimits.maxFileBytes)fail(400,'整篇翻译支持不超过10MB的PDF或DOCX文档');
  if(file.storage_provider!=='aliyun_oss')fail(409,'此原件尚未保存到云端，请重新上传后翻译');
  if(db.prepare("SELECT 1 FROM workspace_file_deletions WHERE file_id=? AND status='pending'").get(file.id))fail(409,'原件正在删除，请选择其他文件');
  return{file,hash:digest(JSON.stringify({fileId:file.id,sha256:file.sha256,sourceLanguage:input.sourceLanguage,targetLanguage:input.targetLanguage,consent:true}))};
 }
 function reusable(user,hash){return db.prepare("SELECT j.id FROM jobs j JOIN document_translation_runs d ON d.id=j.id WHERE j.user_id=? AND j.type='document_translation' AND j.input_hash=? AND (j.status IN ('queued','running') OR j.status='completed' AND EXISTS(SELECT 1 FROM json_each(d.artifacts) a JOIN artifacts f ON f.id=a.value WHERE f.user_id=j.user_id AND f.status='ready' AND f.kind='docx')) ORDER BY CASE WHEN j.status='completed' THEN 1 ELSE 0 END,j.created_at DESC,j.id DESC LIMIT 1").get(user.id,hash);}
 function freeDaily(user){const since=new Date();since.setUTCHours(0,0,0,0);const today=since.toISOString(),sql=" FROM document_translation_runs d JOIN jobs j ON j.id=d.id LEFT JOIN billing_reservations b ON b.job_id=j.id AND b.attempt=1 WHERE (b.source='free' OR b.id IS NULL) AND d.created_at>=?";if(db.prepare('SELECT count(*) n'+sql+' AND d.user_id=?').get(today,user.id).n>=documentTranslationLimits.userDaily)fail(429,'今日免费文档翻译次数已用完，请明天再试');if(db.prepare('SELECT count(*) n'+sql).get(today).n>=documentTranslationLimits.globalDaily)fail(429,'免费文档翻译今日额度已用完，请稍后再试');}
 return{capabilities:()=>({...documentTranslationCapabilities(config),...(v1CommercialEnabled(db)?{maxPages:50,billingService:'literature-document'}:{})}),async handle({path,method,user,readBody}){
  const quoting=path==='/api/document-translations/quote',item=quoting?null:path.match(/^\/api\/document-translations\/([A-Za-z0-9_-]{1,120})(\/cancel)?$/);if(path!=='/api/document-translations'&&!item&&!quoting)return null;
  if(!idValid(user?.id))fail(401,'请先登录服务账户');
  if(item){const row=own(item[1],user);if(method==='GET'&&!item[2])return{value:{...summary(row),...(row.status==='completed'?{result:completed(row)}:{})}};if(method!=='POST'||!item[2])fail(405,'不支持的文档翻译操作');const input=await readBody();if(!plain(input)||Object.keys(input).length)fail(400,'取消任务不需要其他字段');tx(()=>{const current=own(row.id,user);if(!['queued','running'].includes(current.status))fail(409,'文档翻译任务已经结束');db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled',error=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(),row.id);billing.release(row.id);});config.cancelDocumentTranslation?.(row.id);return{value:{ok:true,id:row.id}};}
  if(!quoting&&method==='GET')return{value:{items:db.prepare("SELECT j.*,d.file_name,d.source_language,d.target_language,d.page_count FROM jobs j JOIN document_translation_runs d ON d.id=j.id WHERE j.user_id=? AND j.type='document_translation' ORDER BY j.created_at DESC,j.id DESC LIMIT 20").all(user.id).map(summary)}};
  if(method!=='POST')fail(405,'不支持的文档翻译操作');const input=await readBody(),{file,hash}=normalized(input,user,quoting);
  const v1=v1CommercialEnabled(db),pages=v1?await commercialDocumentPages(db,file,config):null;
  if(v1&&pages>50)fail(400,'整篇翻译每次最多 50 页，请拆分文档；尚未扣费。');
  const serviceKey=v1?(pages>20?'literature-document-long':'literature-document'):'literature-translate';
  if(quoting)return{value:tx(()=>{const reused=reusable(user,hash);if(reused)return{existingJobId:reused.id,reused:true};if(!documentTranslationReady(config))fail(503,documentTranslationCapabilities(config).reason);const quote=billing.quote(user,{type:'agent',serviceKey,context:{pages}});if(quote.source==='free')freeDaily(user);db.prepare('INSERT INTO document_translation_quotes VALUES(?,?,?,?)').run(quote.token,user.id,hash,new Date().toISOString());return{...quote,title:v1?'整篇文档翻译':'文献研读',pageCount:pages,pricingBasis:file.kind==='docx'?'每 2,000 字符折算一页':'原文实际页数'};})};
  const created=tx(()=>{
   const existing=db.prepare('SELECT * FROM jobs WHERE user_id=? AND idempotency_key=?').get(user.id,input.idempotencyKey);if(existing){if(existing.type!=='document_translation'||existing.input_hash!==hash)fail(409,'请求编号已用于其他内容，请重新提交');return{id:existing.id,status:200};}
   const reused=reusable(user,hash);if(reused)return{id:reused.id,status:200};
   if(!documentTranslationReady(config))fail(503,documentTranslationCapabilities(config).reason);
   const quote=db.prepare('SELECT q.source,d.input_hash FROM document_translation_quotes d JOIN billing_quotes q ON q.token=d.token AND q.user_id=d.user_id WHERE d.token=? AND d.user_id=?').get(typeof input.billingToken==='string'?input.billingToken:'',user.id);if(!quote||quote.input_hash!==hash)fail(409,'文献研读计费已更新，请刷新后重新提交');
   if(db.prepare("SELECT count(*) n FROM jobs WHERE user_id=? AND type='document_translation' AND status IN ('queued','running')").get(user.id).n>=1)fail(409,'请等待当前文档翻译任务完成后继续');
   if(db.prepare("SELECT count(*) n FROM jobs WHERE user_id=? AND status IN ('queued','running')").get(user.id).n>=3)fail(409,'最多同时处理3项任务，请等待当前任务完成');
   if(db.prepare("SELECT count(*) n FROM jobs WHERE type='document_translation' AND status IN ('queued','running')").get().n>=3)fail(429,'文档翻译当前繁忙，请稍后再试');
   if(quote.source==='free')freeDaily(user);
   const id=randomUUID(),at=new Date().toISOString();db.prepare("INSERT INTO jobs(id,user_id,project_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,'document_translation','queued','queued',?,?,?,?,?)").run(id,user.id,file.project_id,JSON.stringify({fileId:file.id,sourceLanguage:input.sourceLanguage,targetLanguage:input.targetLanguage,consent:true,billingRequired:true,quotedPages:pages}),input.idempotencyKey,hash,at,at);
   db.prepare('INSERT INTO document_translation_runs(id,user_id,file_id,source_sha256,file_name,source_language,target_language,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,user.id,file.id,file.sha256,file.name,input.sourceLanguage,input.targetLanguage,at,at);
   billing.reserve(user,id,1,'agent',input.billingToken,serviceKey);return{id,status:201};
  });return{status:created.status,value:{id:created.id}};
 }};
}
