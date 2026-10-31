import {validatePaper} from '../dist/workspace/literature-model.mjs';
import {normalizeLiteratureGroups} from '../dist/workspace/literature-groups.mjs';
import {createHash} from 'node:crypto';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
export function createLiteratureLibrary(db){
 db.exec(`CREATE TABLE IF NOT EXISTS literature_library(user_id TEXT NOT NULL REFERENCES users(id),id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,id));`);
 const entry=row=>({id:row.id,version:row.version,item:row.payload?JSON.parse(row.payload):null});
 return {
  etag(user){return '"'+createHash('sha256').update(user.id).update(JSON.stringify(db.prepare('SELECT id,version FROM literature_library WHERE user_id=? ORDER BY id').all(user.id))).digest('hex')+'"';},
  list(user){return {ownerId:user.id,projectIds:db.prepare('SELECT id FROM projects WHERE user_id=?').all(user.id).map(row=>row.id),fileIds:db.prepare('SELECT id FROM files WHERE user_id=?').all(user.id).map(row=>row.id),entries:db.prepare('SELECT id,version,payload FROM literature_library WHERE user_id=? ORDER BY updated_at DESC,id').all(user.id).map(entry)};},
  save(user,input){
   if(input.expectedUserId!==user.id)fail(409,'登录账户已变化，请重新打开文献研读');
   const {id,version,item}=input;
   if(typeof id!=='string'||!id||id.length>200||!Number.isSafeInteger(version)||version<0||item!==null&&(!item||Array.isArray(item)||typeof item!=='object'||item.id!==id))fail(400,'文献保存信息无效');
   let payload=null;
   if(item!==null){
    let checked;try{checked=id==='@groups'?{id,groups:normalizeLiteratureGroups(item.groups)}:validatePaper(item);}catch(error){fail(400,error.message);}
    if(checked.originalOwnerId&&checked.originalOwnerId!==user.id)fail(403,'不能保存其他账户的文献原件');
    if(checked.originalFileId&&!db.prepare('SELECT id FROM files WHERE id=? AND user_id=?').get(checked.originalFileId,user.id))fail(409,'文献原件已不存在，请重新选择原件');
    if(checked.projectId&&!db.prepare('SELECT id FROM projects WHERE id=? AND user_id=?').get(checked.projectId,user.id))fail(400,'所属项目不属于当前账户');
    payload=JSON.stringify(checked);if(Buffer.byteLength(payload)>2500*1024)fail(413,'单篇文献记录过大，请精简研读记录后保存');
   }
   db.exec('BEGIN IMMEDIATE');
   try{
    const old=db.prepare('SELECT * FROM literature_library WHERE user_id=? AND id=?').get(user.id,id);
    // Retrying a response lost in transit must not create another version.
    if(old&&(old.payload===payload)){db.exec('COMMIT');return {ownerId:user.id,entry:entry(old)};}
    if((old?.version||0)!==version)fail(409,'这篇文献已在其他页面更新，请重新读取后再保存');
    if(old&&old.payload===null&&payload!==null)fail(409,'这篇文献已删除，请重新添加文献');
    if(payload){const quota=db.prepare("SELECT count(CASE WHEN id!='@groups' THEN payload END) n,coalesce(sum(length(CAST(payload AS BLOB))),0) bytes FROM literature_library WHERE user_id=?").get(user.id);if(id!=='@groups'&&!old?.payload&&quota.n>=200)fail(409,'文献库最多保存 200 篇');if(quota.bytes-Buffer.byteLength(old?.payload||'')+Buffer.byteLength(payload)>50*1024*1024)fail(413,'文献记录空间已满，请整理后再保存');}
    const next={id,version:(old?.version||0)+1,payload,updated_at:new Date().toISOString()};
    db.prepare('INSERT INTO literature_library(user_id,id,version,payload,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET version=excluded.version,payload=excluded.payload,updated_at=excluded.updated_at').run(user.id,id,next.version,payload,next.updated_at);
    db.exec('COMMIT');return {ownerId:user.id,entry:entry(next)};
   }catch(error){db.exec('ROLLBACK');throw error;}
  }
 };
}
