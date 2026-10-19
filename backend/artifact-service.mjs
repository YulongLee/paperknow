import {randomUUID} from 'node:crypto';
import {digest} from './auth.mjs';
import {artifactKinds,artifactMimeType} from './artifact-formats.mjs';
import {validateFormulaArtifact} from './artifact-formula-validation.mjs';
import {validateCitationArtifact} from './artifact-citation-validation.mjs';

export const artifactLimits=Object.freeze({maxFileBytes:20*1024*1024,maxAccountBytes:500*1024*1024,maxFiles:2000});
export {artifactKinds} from './artifact-formats.mjs';
const sourceTypes=['writing','thesis','literature','revision','detection','presentation','format','research','backup','other'];
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const fields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail(400,'成果请求包含不支持的字段');};
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
const shaValid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const downloadHeaders=row=>({'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="artifact.${row.kind}"; filename*=UTF-8''${encodeURIComponent(row.name)}`,'Content-Length':String(row.bytes),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"});

export function initializeArtifactSchema(db){db.exec(`
 CREATE TABLE IF NOT EXISTS artifacts(
  id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,kind TEXT NOT NULL,bytes INTEGER NOT NULL CHECK(bytes>0),sha256 TEXT NOT NULL,
  source_type TEXT NOT NULL,source_id TEXT,storage_provider TEXT NOT NULL CHECK(storage_provider='aliyun_oss'),
  storage_bucket TEXT NOT NULL,storage_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('uploading','ready','deleting','failed','deleted')),
  lease_token TEXT,lease_until TEXT,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS artifacts_owner ON artifacts(user_id,created_at DESC,id DESC);
 CREATE INDEX IF NOT EXISTS artifacts_state ON artifacts(status,updated_at);
 CREATE UNIQUE INDEX IF NOT EXISTS artifacts_owned_content ON artifacts(user_id,sha256,kind) WHERE status!='deleted';
 `);}

export function createArtifactService(db,config={}){
 initializeArtifactSchema(db);
 const limits={...artifactLimits};
 for(const key of Object.keys(limits))if(Number.isSafeInteger(config.artifactLimits?.[key])&&config.artifactLimits[key]>0)limits[key]=Math.min(limits[key],config.artifactLimits[key]);
 let activeWrites=0,activeReads=0;
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 const clock=()=>new Date(config.artifactNow?.()??Date.now()).toISOString();
 const storageReady=()=>config.storage?.provider==='aliyun_oss'&&typeof config.storage.putArtifact==='function'&&typeof config.storage.readArtifact==='function'&&typeof config.storage.removeArtifact==='function'&&typeof config.storage.bucket==='string'&&typeof config.storage.prefix==='string';
 const requireStorage=()=>{if(!storageReady())fail(503,'成果云存储暂不可用，请稍后重试；文件不会写入服务器');return config.storage;};
 const own=(id,user)=>{const row=db.prepare('SELECT * FROM artifacts WHERE id=? AND user_id=?').get(id,user.id);if(!row)fail(404,'成果文件不存在');return row;};
 const hasToolRuns=()=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tool_runs'").get());
 const hasWebRuns=()=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='web_similarity_runs'").get());
 const pendingPresentation=row=>row.source_type==='research'&&hasToolRuns()&&Boolean(db.prepare("SELECT 1 FROM tool_runs WHERE id=? AND user_id=? AND operation='image' AND status!='completed'").get(row.source_id,row.user_id))||row.source_type==='presentation'&&hasToolRuns()&&Boolean(db.prepare("SELECT 1 FROM tool_runs WHERE id=? AND user_id=? AND operation='ppt' AND status!='completed'").get(row.source_id,row.user_id))||row.source_type==='detection'&&hasWebRuns()&&Boolean(db.prepare("SELECT 1 FROM web_similarity_runs r JOIN jobs j ON j.id=r.id WHERE r.id=? AND r.user_id=? AND (j.status!='completed' OR r.input_artifact_id=?)").get(row.source_id,row.user_id,row.id));
 const serialize=row=>({id:row.id,name:row.name,kind:row.kind,mimeType:artifactMimeType(row.kind),bytes:row.bytes,sha256:row.sha256,sourceType:row.source_type,sourceId:row.source_id,projectId:row.project_id,status:row.status,createdAt:row.created_at,source_type:row.source_type,source_id:row.source_id,project_id:row.project_id,created_at:row.created_at,downloadUrl:row.status==='ready'?`/api/artifacts/${row.id}/download`:null});
 const usage=user=>{const row=db.prepare("SELECT coalesce(sum(bytes),0) bytes,count(*) count FROM artifacts WHERE user_id=? AND status!='deleted'").get(user.id);return {...row,maxBytes:limits.maxAccountBytes,maxFiles:limits.maxFiles,maxFileBytes:limits.maxFileBytes};};
 const checkAccount=(expected,user)=>{if(expected!==undefined&&expected!==user.id)fail(409,'登录账户已变化，请刷新后重新导出');};
 const checkSignature=(kind,buffer)=>{
  validateFormulaArtifact(kind,buffer);
  validateCitationArtifact(kind,buffer);
  if(kind==='pdf'&&!buffer.subarray(0,5).equals(Buffer.from('%PDF-')))fail(400,'PDF 文件格式无效');
  if(['docx','pptx','xlsx','zip'].includes(kind)&&!buffer.subarray(0,2).equals(Buffer.from('PK')))fail(400,'压缩文档格式无效');
  if(kind==='png'&&!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail(400,'PNG 文件格式无效');
  if(['jpg','jpeg'].includes(kind)&&(buffer[0]!==255||buffer[1]!==216||buffer[2]!==255))fail(400,'JPEG 文件格式无效');
 };

 return async function artifacts({path,method,user,query=new URLSearchParams(),readBody}){
  const download=path.match(/^\/api\/artifacts\/([A-Za-z0-9_-]{1,120})\/download$/),deletion=path.match(/^\/api\/artifacts\/([A-Za-z0-9_-]{1,120})\/delete$/);
  if(path!=='/api/artifacts'&&!download&&!deletion)return null;
  if(!safeId(user?.id))fail(401,'请先登录服务账户');
  if(method==='GET')checkAccount(query.get('expectedUserId')??undefined,user);
  if(path==='/api/artifacts'&&method==='GET'){
   const numbered=query.has('page')||query.has('pageSize'),rawLimit=numbered?(query.get('pageSize')??'20'):(query.get('limit')??'20'),rawPage=query.get('page')??'1';
   if(!/^[1-9]\d?$|^100$/.test(rawLimit)||numbered&&Number(rawLimit)>50)fail(400,numbered?'成果列表每页支持 1～50 条':'成果列表每页支持 1～100 条');
   if(!/^[1-9]\d{0,5}$/.test(rawPage)||numbered&&query.has('cursor'))fail(400,'成果列表页码无效');
   const limit=Number(rawLimit),page=Number(rawPage),source=query.get('sourceType'),search=query.get('q')?.trim()??'';
   if(search.length>120||/[\x00-\x1f\x7f]/.test(search))fail(400,'成果搜索内容无效');
   if(source&&!sourceTypes.includes(source))fail(400,'成果类型无效');
   let cursor=null;
   if(query.has('cursor')){try{const encoded=query.get('cursor');if(!encoded||encoded.length>400||!/^[A-Za-z0-9_-]+$/.test(encoded))throw 0;cursor=JSON.parse(Buffer.from(encoded,'base64url').toString());if(!Array.isArray(cursor)||cursor.length!==2||typeof cursor[0]!=='string'||new Date(cursor[0]).toISOString()!==cursor[0]||!safeId(cursor[1]))throw 0;}catch{fail(400,'成果列表页码无效，请刷新列表');}}
   const params=[user.id],conditions=["user_id=?","status!='deleted'"];
   // Generated delivery files publish atomically with successful settlement,
   // rather than appearing during the multi-file upload/validation window.
   if(hasToolRuns())conditions.push("NOT (source_type='research' AND EXISTS (SELECT 1 FROM tool_runs r WHERE r.id=artifacts.source_id AND r.user_id=artifacts.user_id AND r.operation='image' AND r.status!='completed'))");
   if(hasToolRuns())conditions.push("NOT (source_type='presentation' AND EXISTS (SELECT 1 FROM tool_runs r WHERE r.id=artifacts.source_id AND r.user_id=artifacts.user_id AND r.operation='ppt' AND r.status!='completed'))");
   if(hasWebRuns())conditions.push("NOT (source_type='detection' AND EXISTS (SELECT 1 FROM web_similarity_runs r JOIN jobs j ON j.id=r.id WHERE r.id=artifacts.source_id AND r.user_id=artifacts.user_id AND (j.status!='completed' OR r.input_artifact_id=artifacts.id)))");
   if(source){conditions.push('source_type=?');params.push(source);}
   if(search){conditions.push("name LIKE ? ESCAPE '\\'");params.push('%'+search.replace(/[\\%_]/g,'\\$&')+'%');}
   const total=db.prepare(`SELECT count(*) n FROM artifacts WHERE ${conditions.join(' AND ')}`).get(...params).n;
   if(cursor){conditions.push('(created_at<? OR (created_at=? AND id<?))');params.push(cursor[0],cursor[0],cursor[1]);}
   const rows=db.prepare(`SELECT * FROM artifacts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...params,limit+1,numbered?(page-1)*limit:0),items=rows.slice(0,limit),last=items.at(-1),used=usage(user),ready=storageReady();
   return {value:{items:items.map(serialize),total,page,pageSize:limit,nextCursor:rows.length>limit?Buffer.from(JSON.stringify([last.created_at,last.id])).toString('base64url'):null,usage:used,storageReady:ready,storage:{provider:ready?'aliyun_oss':null,ready},quotaBytes:limits.maxAccountBytes,usedBytes:used.bytes,maxFileBytes:limits.maxFileBytes}};
  }
  if(download){
   if(method!=='GET')fail(405,'不支持的成果操作');
   const row=own(download[1],user);if(row.status==='deleted')fail(404,'成果文件不存在');if(row.status!=='ready')fail(409,'成果文件尚未就绪或正在删除，请刷新列表');
   if(pendingPresentation(row))fail(409,row.source_type==='research'?'科研图片仍在生成与结算中，请等待任务完成后下载':row.source_type==='detection'?'查重报告尚未完整保存，请等待任务完成后下载':'演示文件仍在生成与结算中，请等待任务完成后下载');
   const store=requireStorage();if(activeReads>=2)fail(429,'当前下载较多，请稍后重试');activeReads++;
   let released=false;const release=()=>{if(!released){released=true;activeReads--;}};
   try{
    let buffer;try{buffer=await store.readArtifact(row);}catch{fail(503,'成果文件读取或完整性校验未通过，请稍后重试');}
    if(!Buffer.isBuffer(buffer)||buffer.length!==row.bytes||digest(buffer)!==row.sha256)fail(503,'成果文件完整性校验未通过，请联系支持');
    // The HTTP adapter retains this Buffer until finish/close. Its slot must
    // cover slow client transmission, rather than just the preceding OSS read.
    return {body:buffer,headers:downloadHeaders(row),release};
   }catch(error){release();throw error;}
  }
  if(method!=='POST')fail(405,'不支持的成果操作');
  const uploadSlot=path==='/api/artifacts';if(uploadSlot){if(activeWrites>=2)fail(429,'当前导出保存较多，请稍后重试');activeWrites++;}
  try{
  const input=await readBody();
  if(deletion){
   fields(input,['expectedSha256','expectedUserId']);checkAccount(input.expectedUserId,user);if(!shaValid(input.expectedSha256))fail(400,'请确认需要删除的成果文件');
   const existing=own(deletion[1],user);if(existing.sha256!==input.expectedSha256)fail(409,'成果文件已变化，请刷新后删除');
   if(existing.status==='deleted')return {value:{ok:true,id:existing.id,deleted:true}};
   const store=requireStorage(),row=transaction(()=>{const row=own(existing.id,user);if(row.status==='uploading'&&row.lease_until>clock())fail(409,'成果仍在保存中，请完成后删除');if(row.status!=='deleted')db.prepare("UPDATE artifacts SET status='deleting',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(clock(),row.id);return {...row,status:row.status==='deleted'?'deleted':'deleting'};});
   if(row.status!=='deleted'){
    try{await store.removeArtifact(row);}catch{db.prepare("UPDATE artifacts SET last_error='成果删除待重试',updated_at=? WHERE id=? AND status='deleting'").run(clock(),row.id);fail(503,'成果云端删除未完成，已保留记录供重试');}
    db.prepare("UPDATE artifacts SET status='deleted',last_error=NULL,updated_at=? WHERE id=? AND user_id=? AND status='deleting'").run(clock(),row.id,user.id);
   }
   return {value:{ok:true,id:row.id,deleted:true}};
  }
  fields(input,['name','data','sha256','projectId','sourceType','sourceId','expectedUserId']);checkAccount(input.expectedUserId,user);
  const store=requireStorage(),name=typeof input.name==='string'?input.name.trim():'';
  if(!name||name.length>180||/[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/.test(name))fail(400,'成果文件名称无效');
  const kind=name.split('.').at(-1).toLowerCase();if(!artifactKinds.includes(kind))fail(400,'暂不支持此成果文件格式');
  const sourceType=input.sourceType??'other',sourceId=input.sourceId??null,pid=input.projectId??null;
  if(!sourceTypes.includes(sourceType)||sourceId!==null&&(typeof sourceId!=='string'||!sourceId.trim()||sourceId.length>120||/[\x00-\x1f\x7f]/.test(sourceId)))fail(400,'成果来源信息无效');
  if(pid!==null&&!safeId(pid))fail(400,'项目编号无效');
  if(typeof input.data!=='string'||!input.data.length||input.data.length>4*Math.ceil(limits.maxFileBytes/3))fail(413,`成果文件最大 ${Math.floor(limits.maxFileBytes/1024/1024)}MB`);
  if(input.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))fail(400,'成果文件编码无效');
  const buffer=Buffer.from(input.data,'base64');if(!buffer.length||buffer.length>limits.maxFileBytes)fail(413,'成果文件超过大小限制');
  if(buffer.toString('base64')!==input.data)fail(400,'成果文件编码无效');
  checkSignature(kind,buffer);const sha256=digest(buffer);if(input.sha256!==undefined&&(!shaValid(input.sha256)||input.sha256!==sha256))fail(400,'成果文件完整性校验未通过');
  const at=clock(),token=randomUUID(),leaseUntil=new Date(Date.parse(at)+120000).toISOString();
  const reservation=transaction(()=>{
   if(pid&&!db.prepare('SELECT 1 FROM projects WHERE id=? AND user_id=?').get(pid,user.id))fail(404,'所属项目不存在');
   const existing=db.prepare("SELECT * FROM artifacts WHERE user_id=? AND sha256=? AND kind=? AND status!='deleted'").get(user.id,sha256,kind);
   if(existing?.status==='ready'){if(pendingPresentation(existing))fail(409,'相同成果仍在生成或清理中，请等待任务状态更新后重试');return {row:existing,duplicate:true};}
   if(existing?.status==='deleting')fail(409,'相同成果正在删除，请完成删除后重新导出');
   if(existing?.status==='uploading'&&existing.lease_until>at)fail(409,'相同成果正在保存，请稍后刷新列表');
   const current=usage(user);if(!existing&&(current.bytes+buffer.length>limits.maxAccountBytes||current.count>=limits.maxFiles))fail(409,'成果云存储空间或文件数量已达上限，请删除不再需要的成果后继续');
   const id=existing?.id||randomUUID(),storageKey=`${store.prefix}users/${user.id}/exports/${id}.${kind}`;
   if(existing){
    // The same owned immutable content is safe to overwrite after an expired upload.
    if(existing.storage_key!==storageKey||existing.storage_bucket!==store.bucket)fail(503,'成果存储配置已变化，请联系支持处理待完成文件');
    db.prepare("UPDATE artifacts SET status='uploading',lease_token=?,lease_until=?,last_error=NULL,updated_at=? WHERE id=?").run(token,leaseUntil,at,id);
   }else db.prepare("INSERT INTO artifacts(id,user_id,project_id,name,kind,bytes,sha256,source_type,source_id,storage_provider,storage_bucket,storage_key,status,lease_token,lease_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'aliyun_oss',?,?,'uploading',?,?,?,?)").run(id,user.id,pid,name,kind,buffer.length,sha256,sourceType,sourceId,store.bucket,storageKey,token,leaseUntil,at,at);
   return {row:own(id,user),duplicate:false};
  });
  if(reservation.duplicate)return {value:{item:serialize(reservation.row),deduplicated:true}};
  const row=reservation.row;
  try{
   const key=await store.putArtifact(row.id,user.id,kind,buffer,sha256);if(key!==row.storage_key)fail(503,'成果存储未确认保存，请重试');
   transaction(()=>{
    const current=own(row.id,user);if(current.status!=='uploading'||current.lease_token!==token)fail(409,'成果保存状态已变化，请刷新列表');
    db.prepare("UPDATE artifacts SET status='ready',lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=? WHERE id=?").run(clock(),row.id);
   });
   return {status:201,value:{item:serialize(own(row.id,user)),deduplicated:false}};
  }catch(error){
   const current=own(row.id,user);
   // A newer lease owns the same immutable object. Never remove its upload.
   if(current.lease_token===token&&current.status==='uploading'){
    // Keep an exclusive lease during asynchronous compensation: a retry must not
    // overwrite the same key while its preceding failed upload is being removed.
    db.prepare("UPDATE artifacts SET lease_until=?,last_error='成果保存待重试',updated_at=? WHERE id=? AND lease_token=?").run(new Date(Date.parse(clock())+120000).toISOString(),clock(),row.id,token);
    try{await store.removeArtifact(row);db.prepare("UPDATE artifacts SET status='deleted',lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=? WHERE id=? AND status='uploading' AND lease_token=?").run(clock(),row.id,token);}catch{db.prepare("UPDATE artifacts SET status='failed',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='uploading' AND lease_token=?").run(clock(),row.id,token);}
   }
   if(error.status)throw error;fail(503,'成果云存储保存未完成，请稍后重试；未写入服务器文件');
  }
  }finally{if(uploadSlot)activeWrites--;}
 };
}
