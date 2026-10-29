import {randomUUID} from 'node:crypto';
import {digest} from './auth.mjs';
import {initializeArtifactSchema} from './artifact-service.mjs';
import {isMineruConfigurationValid} from './mineru-client.mjs';

export const documentParseLimits=Object.freeze({maxFileBytes:20*1024*1024,maxPages:100,maxCharacters:200000,userDaily:10,globalDaily:100});
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const idValid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(v);
export function initializeDocumentParseSchema(db){
 initializeArtifactSchema(db);
 db.exec(`CREATE TABLE IF NOT EXISTS document_parse_runs(
  id TEXT PRIMARY KEY REFERENCES jobs(id),user_id TEXT NOT NULL REFERENCES users(id),
  file_id TEXT NOT NULL,source_sha256 TEXT NOT NULL,file_name TEXT NOT NULL,
  expected_pages INTEGER,provider_state TEXT NOT NULL DEFAULT 'new',provider_batch_id TEXT,
  extracted_pages INTEGER,total_pages INTEGER,next_poll_at TEXT,started_at TEXT,
  structured_artifact_id TEXT REFERENCES artifacts(id),artifacts TEXT NOT NULL DEFAULT '[]',created_artifacts TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL
 );CREATE INDEX IF NOT EXISTS document_parse_owner ON document_parse_runs(user_id,created_at);
 CREATE INDEX IF NOT EXISTS document_parse_poll ON document_parse_runs(next_poll_at);`);
}
export const documentParsingReady=(config={})=>Boolean(config.mineruEnabled===true&&isMineruConfigurationValid({token:config.mineruToken,baseURL:config.mineruBaseURL})&&config.storage?.provider==='aliyun_oss'&&typeof config.storage.read==='function'&&typeof config.storage.putArtifact==='function'&&typeof config.storage.readArtifact==='function'&&typeof config.storage.removeArtifact==='function');
export function documentParsingCapabilities(config={}){return{ready:documentParsingReady(config),maxFileBytes:documentParseLimits.maxFileBytes,maxPages:documentParseLimits.maxPages,maxCharacters:documentParseLimits.maxCharacters,userDailyLimit:documentParseLimits.userDaily,consentRequired:true,storage:'private_account',reason:documentParsingReady(config)?'':'云端 PDF 解析暂未开放，可使用文本型文档或粘贴正文。'};}
export function createDocumentParseService(db,config={}){
 initializeDocumentParseSchema(db);
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}};
 const own=(id,user)=>{const row=db.prepare("SELECT j.*,d.file_id,d.source_sha256,d.file_name,d.extracted_pages,d.total_pages,d.structured_artifact_id,d.artifacts FROM jobs j JOIN document_parse_runs d ON d.id=j.id WHERE j.id=? AND j.user_id=? AND j.type='document_parse'").get(id,user.id);if(!row)fail(404,'解析任务不存在');return row;};
 const summary=row=>({id:row.id,status:row.status,stage:row.stage,error:row.error||null,fileName:row.file_name,resultId:row.result_id||null,progress:{extractedPages:row.extracted_pages||0,totalPages:row.total_pages||null},createdAt:row.created_at,updatedAt:row.updated_at});
 async function result(row,user){
  const artifact=db.prepare("SELECT * FROM artifacts WHERE id=? AND user_id=? AND status='ready'").get(row.structured_artifact_id,user.id);
  if(!artifact)fail(409,'解析结果文件已移除或尚未就绪，可从任务中心查看记录后重新解析');
  if(!config.storage?.readArtifact)fail(503,'解析结果云存储暂不可用，请稍后查看');
  let buffer;try{buffer=await config.storage.readArtifact(artifact);}catch{fail(503,'解析结果读取未完成，请稍后查看，无需重新提交解析');}
  if(!Buffer.isBuffer(buffer)||buffer.length>8*1024*1024||buffer.length!==artifact.bytes||digest(buffer)!==artifact.sha256)fail(503,'解析结果完整性校验未通过，请联系支持');
  let value;try{value=JSON.parse(buffer.toString('utf8'));}catch{fail(503,'解析结果格式不可读取，请联系支持');}
  if(value.version!==1||typeof value.text!=='string'||value.text.length>documentParseLimits.maxCharacters||!Array.isArray(value.pages)||value.pages.length>documentParseLimits.maxPages)fail(503,'解析结果结构校验未通过，请联系支持');
  const indexed=JSON.parse(row.artifacts).filter(id=>typeof id==='string').map(id=>db.prepare("SELECT id,name,kind,bytes FROM artifacts WHERE id=? AND user_id=? AND status='ready'").get(id,user.id)).filter(Boolean).map(x=>({...x,downloadUrl:'/api/artifacts/'+x.id+'/download'}));
  return{text:value.text,characters:Array.from(value.text).length,fileName:row.file_name,pages:value.pages.length,pageMap:value.pages.map(({pageIndex,text})=>({pageIndex,text})),warnings:value.warnings||[],artifacts:indexed,scope:'用户确认上传的 PDF；云端识别结果需核对，保留页码来源。'};
 }
 return{capabilities:()=>documentParsingCapabilities(config),async handle({path,method,user,readBody}){
  const item=path.match(/^\/api\/document-parses\/([A-Za-z0-9_-]{1,120})(\/cancel)?$/);if(path!=='/api/document-parses'&&!item)return null;
  if(!idValid(user?.id))fail(401,'请先登录服务账户');
  if(item){
   const row=own(item[1],user);
   if(method==='GET'&&!item[2])return{value:{...summary(row),...(row.status==='completed'?{result:await result(row,user)}:{})}};
   if(method!=='POST'||!item[2])fail(405,'不支持的解析操作');const input=await readBody();if(Object.keys(input).length)fail(400,'取消解析不需要其他字段');
   tx(()=>{const current=own(row.id,user);if(!['queued','running'].includes(current.status))fail(409,'解析任务已经结束');db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled',error=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(),row.id);});config.cancelDocumentParse?.(row.id);
   return{value:{ok:true,id:row.id}};
  }
  if(method!=='POST')fail(405,'不支持的解析操作');
  const input=await readBody();if(Object.keys(input).some(k=>!['fileId','idempotencyKey','consent','expectedUserId'].includes(k)))fail(400,'解析请求包含不支持的字段');
  if(input.expectedUserId!==user.id)fail(409,'登录账户已变化，请刷新后重新选择文件');
  if(input.consent!==true)fail(400,'请确认将此 PDF 发送至云端文档解析服务');
  if(!idValid(input.fileId)||typeof input.idempotencyKey!=='string'||!/^[-A-Za-z0-9_]{8,100}$/.test(input.idempotencyKey))fail(400,'解析文件或请求编号无效');
  const file=db.prepare('SELECT * FROM files WHERE id=? AND user_id=?').get(input.fileId,user.id);if(!file)fail(404,'PDF 原件不存在');
  if(file.kind!=='pdf'||file.bytes<1||file.bytes>documentParseLimits.maxFileBytes)fail(400,'云端解析支持不超过 20MB、100 页的 PDF');
  if(file.storage_provider!=='aliyun_oss')fail(409,'此原件尚未保存到云端，请重新上传后解析。');
  if(db.prepare("SELECT 1 FROM workspace_file_deletions WHERE file_id=? AND status='pending'").get(file.id))fail(409,'原件正在删除，请选择其他文件');
  const hash=digest(JSON.stringify({fileId:file.id,sha256:file.sha256,consent:true}));
  const created=tx(()=>{
   const existing=db.prepare('SELECT * FROM jobs WHERE user_id=? AND idempotency_key=?').get(user.id,input.idempotencyKey);
   if(existing){if(existing.type!=='document_parse'||existing.input_hash!==hash)fail(409,'请求编号已用于其他内容，请重新选择文件');return{id:existing.id,status:200};}
   const completed=db.prepare("SELECT j.id FROM jobs j JOIN document_parse_runs d ON d.id=j.id JOIN artifacts a ON a.id=d.structured_artifact_id AND a.user_id=j.user_id AND a.status='ready' WHERE j.user_id=? AND j.type='document_parse' AND j.status='completed' AND j.input_hash=? AND d.source_sha256=? ORDER BY j.created_at DESC LIMIT 1").get(user.id,hash,file.sha256);if(completed)return{id:completed.id,status:200};
   if(!documentParsingReady(config))fail(503,documentParsingCapabilities(config).reason);
   const active=db.prepare("SELECT id FROM jobs WHERE user_id=? AND type='document_parse' AND status IN ('queued','running') AND input_hash=?").get(user.id,hash);if(active)return{id:active.id,status:200};
   if(db.prepare("SELECT count(*) n FROM jobs WHERE user_id=? AND status IN ('queued','running')").get(user.id).n>=3)fail(409,'最多同时处理 3 项任务，请等待当前任务完成');
   if(db.prepare("SELECT count(*) n FROM jobs WHERE type='document_parse' AND status IN ('queued','running')").get().n>=20)fail(429,'云端文档解析当前繁忙，请稍后再试');
   const since=new Date();since.setUTCHours(0,0,0,0);const today=since.toISOString();
   if(db.prepare('SELECT count(*) n FROM document_parse_runs WHERE user_id=? AND created_at>=?').get(user.id,today).n>=documentParseLimits.userDaily)fail(429,'今日云端文档解析次数已用完，请明天再试');
   if(db.prepare('SELECT count(*) n FROM document_parse_runs WHERE created_at>=?').get(today).n>=documentParseLimits.globalDaily)fail(429,'云端文档解析今日额度已用完，请稍后再试');
   const id=randomUUID(),at=new Date().toISOString();db.prepare("INSERT INTO jobs(id,user_id,project_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,'document_parse','queued','queued',?,?,?,?,?)").run(id,user.id,file.project_id,JSON.stringify({fileId:file.id,consent:true}),input.idempotencyKey,hash,at,at);
   db.prepare('INSERT INTO document_parse_runs(id,user_id,file_id,source_sha256,file_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,user.id,file.id,file.sha256,file.name,at,at);
   return{id,status:201};
  });return{status:created.status,value:{id:created.id}};
 }};
}
