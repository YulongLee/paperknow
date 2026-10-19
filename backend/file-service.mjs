import {randomUUID} from 'node:crypto';
import {digest} from './auth.mjs';
import {fileBytes} from './storage.mjs';

const maxFileBytes=2*1024*1024,maxAccountBytes=50*1024*1024;
// Count request bodies as well as storage writes: a PDF body is already large
// before it can be decoded, validated or reserved against account quota.
let activeUploads=0;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const text=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)fail(400,'文件资料无效');return value.trim();};
export function createFileService(db,config={}){
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 const file=(id,user)=>{const row=db.prepare('SELECT * FROM files WHERE id=? AND user_id=?').get(id,user.id);if(!row)fail(404,'记录不存在');return row;};
 const removeObject=async row=>{if(row.storage_provider==='aliyun_oss'){if(!config.storage||typeof config.storage.remove!=='function')fail(503,'文件存储暂不可用，原件未完成删除，请稍后重试');await config.storage.remove(row);}};
 const pending=id=>db.prepare("SELECT 1 FROM workspace_file_deletions WHERE file_id=? AND status='pending'").get(id);
 const quota=(user,bytes,exclude='')=>{
  const stored=db.prepare('SELECT coalesce(sum(bytes),0) n FROM files WHERE user_id=?').get(user.id).n;
  const reserved=db.prepare('SELECT coalesce(sum(bytes),0) n FROM workspace_file_uploads WHERE user_id=? AND id!=? AND expires_at>?').get(user.id,exclude,new Date().toISOString()).n;
  if(stored+reserved+bytes>maxAccountBytes)fail(409,'账户原件总量最多 50MB，请下载备份后删除不再需要的原件，或等待正在上传的文件完成');
 };
 return async({path,method,user,readBody,query})=>{
  const deletion=path.match(/^\/api\/files\/([^/]+)\/delete$/),download=path.match(/^\/api\/files\/([^/]+)\/download$/);
  if(path!=='/api/files'&&!deletion&&!download)return null;
  db.prepare('DELETE FROM workspace_file_uploads WHERE expires_at<=?').run(new Date().toISOString());
  if(path==='/api/files'&&method==='GET')return {value:{items:db.prepare("SELECT f.id,f.project_id,f.name,f.kind,f.bytes,f.sha256,f.created_at,CASE WHEN d.status='pending' THEN 'pending' ELSE NULL END AS deletionStatus FROM files f LEFT JOIN workspace_file_deletions d ON d.file_id=f.id WHERE f.user_id=? ORDER BY f.created_at DESC,f.id DESC").all(user.id)}};
  if(download){
   if(method!=='GET')fail(405,'不支持的文件操作');
   if(query!==undefined){
    if(!(query instanceof URLSearchParams)||query.getAll('expectedUserId').length>1)fail(400,'下载账户核验参数不正确');
    const expected=query.get('expectedUserId');
    if(expected!==null){if(!/^[A-Za-z0-9_-]{1,160}$/.test(expected))fail(400,'下载账户核验参数不正确');if(expected!==user.id)fail(409,'登录账户已变化，请重新核验原件所属账户后下载');}
   }
   const row=file(download[1],user);if(pending(row.id))fail(409,'原件正在删除，请完成删除或刷新文件列表');
   return {body:await fileBytes(row,config.storage),headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="document.'+row.kind+'"; filename*=UTF-8\'\''+encodeURIComponent(row.name)}};
  }
  if(method!=='POST')fail(405,'不支持的文件操作');
  if(!deletion&&config.requireRemoteStorage&&(!config.storage||config.storage.provider!=='aliyun_oss'||typeof config.storage.put!=='function'))fail(503,'原件云存储暂不可用，请稍后重试；文件不会写入服务器');
  const uploadSlot=!deletion;if(uploadSlot){if(activeUploads>=2)fail(429,'当前上传较多，请稍后重试');activeUploads++;}
  try{
  const input=await readBody();
  if(deletion){
   if(Object.keys(input).some(k=>k!=='expectedSha256')||typeof input.expectedSha256!=='string')fail(400,'请确认需要删除的原件');
   const id=deletion[1];
   const row=transaction(()=>{
    const old=db.prepare('SELECT * FROM workspace_file_deletions WHERE file_id=?').get(id);
    if(old&&old.user_id!==user.id)fail(404,'记录不存在');
    if(old&&old.expected_sha256!==input.expectedSha256)fail(409,'原件已变化，请刷新后再删除');
    if(old?.status==='completed')return null;
    const row=file(id,user);if(row.sha256!==input.expectedSha256)fail(409,'原件已变化，请刷新后再删除');
    const active=db.prepare("SELECT input FROM jobs WHERE user_id=? AND status IN ('queued','running') AND type IN ('parse','agent','document_parse','document_translation')").all(user.id);
    if(active.some(job=>{try{const v=JSON.parse(job.input);return v.fileId===id||(Array.isArray(v.fileIds)&&v.fileIds.includes(id));}catch{return true;}}))fail(409,'仍有进行中的任务正在使用此原件，请等待完成或取消任务后再删除');
    const at=new Date().toISOString();
    db.prepare("INSERT INTO workspace_file_deletions(file_id,user_id,expected_sha256,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?) ON CONFLICT(file_id) DO NOTHING").run(id,user.id,row.sha256,at,at);
    return row;
   });
   if(!row)return {value:{ok:true,id,deleted:true}};
   await removeObject(row);
   transaction(()=>{
    if(db.prepare("SELECT 1 FROM workspace_file_deletions WHERE file_id=? AND user_id=? AND status='completed'").get(id,user.id))return;
    const current=file(id,user);if(current.sha256!==input.expectedSha256)fail(409,'原件已变化，请刷新后继续');
    db.prepare('DELETE FROM files WHERE id=? AND user_id=?').run(id,user.id);
    db.prepare("UPDATE workspace_file_deletions SET status='completed',updated_at=? WHERE file_id=? AND user_id=?").run(new Date().toISOString(),id,user.id);
   });
   return {value:{ok:true,id,deleted:true}};
  }
  if(Object.keys(input).some(k=>!['name','data','projectId','expectedUserId'].includes(k)))fail(400,'包含不支持的文件字段');
  if(input.expectedUserId!==undefined&&input.expectedUserId!==user.id)fail(409,'登录账户已变化，请重新确认文件上传');
  const name=text(input.name,200),kind=name.split('.').at(-1).toLowerCase();
  if(!['txt','docx','pdf'].includes(kind))fail(400,'支持 TXT、DOCX 和 PDF');
  if(typeof input.data!=='string'||!input.data.length||input.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))fail(400,'文件编码无效');
  const buffer=Buffer.from(input.data,'base64');
  if(buffer.toString('base64')!==input.data)fail(400,'文件编码无效');
  if(!buffer.length||buffer.length>(kind==='pdf'?20*1024*1024:maxFileBytes))fail(413,kind==='pdf'?'PDF 文件最大 20MB':'TXT、DOCX 文件最大 2MB');
  if(kind==='pdf'&&!buffer.subarray(0,5).equals(Buffer.from('%PDF-')))fail(400,'PDF 文件格式无效');
  if(kind==='docx'&&!buffer.subarray(0,2).equals(Buffer.from('PK')))fail(400,'DOCX 文件格式无效');
  const id=randomUUID(),pid=input.projectId||null,at=new Date().toISOString();
  if(pid&&typeof pid!=='string')fail(400,'项目编号无效');
  transaction(()=>{
   if(pid&&!db.prepare('SELECT 1 FROM projects WHERE id=? AND user_id=?').get(pid,user.id))fail(404,'记录不存在');
   quota(user,buffer.length);
   db.prepare('INSERT INTO workspace_file_uploads(id,user_id,project_id,bytes,expires_at) VALUES(?,?,?,?,?)').run(id,user.id,pid,buffer.length,new Date(Date.now()+120000).toISOString());
  });
  let storageKey=null,persisted=false;
  try{
   if(config.storage){storageKey=await config.storage.put(id,user.id,kind,buffer);if(typeof storageKey!=='string'||!storageKey)fail(503,'文件存储未确认保存，请稍后重试');}
   transaction(()=>{
    quota(user,buffer.length,id);
    if(pid&&!db.prepare('SELECT 1 FROM projects WHERE id=? AND user_id=?').get(pid,user.id))fail(409,'所属项目已变化，请重新选择项目');
    db.prepare('INSERT INTO files(id,user_id,project_id,name,kind,bytes,sha256,body,created_at,storage_provider,storage_key,storage_bucket) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,user.id,pid,name,kind,buffer.length,digest(buffer),storageKey?Buffer.alloc(0):buffer,at,config.storage?.provider||'local_server_sqlite',storageKey,config.storage?.bucket||null);
    db.prepare('DELETE FROM workspace_file_uploads WHERE id=? AND user_id=?').run(id,user.id);
   });
   persisted=true;return {status:201,value:{id}};
  }catch(error){
   if(storageKey&&!persisted){try{await removeObject({id,user_id:user.id,kind,storage_provider:config.storage.provider,storage_key:storageKey,storage_bucket:config.storage.bucket});}catch{/* A failed cleanup never reports a saved file; the private object has no downloadable record. */}}
   throw error;
  }finally{db.prepare('DELETE FROM workspace_file_uploads WHERE id=? AND user_id=?').run(id,user.id);}
  }finally{if(uploadSlot)activeUploads--;}
 };
}
