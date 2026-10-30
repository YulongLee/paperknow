import {managedMemberships} from './admin-user-entitlements.mjs';
import {v1CommercialEnabled} from './v1-commercial-policy.mjs';
import {compute} from './compute.mjs';
import {fileBytes} from './storage.mjs';
import {digest} from './auth.mjs';
import {validateTranslationDocument} from './document-translation-document.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function activeResourceGrants(db,userId,at=new Date().toISOString()){
 return managedMemberships(db,userId,at).filter(m=>m.status==='active').sort((a,b)=>a.expiresAt.localeCompare(b.expiresAt));
}
export function cloudCapacity(db,userId){
 if(!v1CommercialEnabled(db))return null;
 return Math.max(500,...activeResourceGrants(db,userId).flatMap(m=>m.items.filter(i=>i.key==='cloud-mb').map(i=>i.quantity)))*1024*1024;
}
export function cloudUsage(db,userId,excludeUpload=''){
 const sum=(table,sql,args)=>db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)?db.prepare(sql).get(...args).n:0;
 return sum('files','SELECT coalesce(sum(bytes),0) n FROM files WHERE user_id=?',[userId])+
 sum('artifacts',"SELECT coalesce(sum(bytes),0) n FROM artifacts WHERE user_id=? AND status!='deleted'",[userId])+
 sum('workspace_file_uploads','SELECT coalesce(sum(bytes),0) n FROM workspace_file_uploads WHERE user_id=? AND id!=? AND expires_at>?',[userId,excludeUpload,new Date().toISOString()]);
}
export function assertCloudCapacity(db,userId,bytes,excludeUpload=''){
 const capacity=cloudCapacity(db,userId);if(capacity!==null&&cloudUsage(db,userId,excludeUpload)+bytes>capacity)fail(409,'云文件空间不足，请删除不再需要的文件或选择更大容量的会员；已保存文件仍可下载。');
 return capacity;
}
export async function commercialDocumentPages(db,file,config){
 db.exec('CREATE TABLE IF NOT EXISTS commercial_document_metrics(sha256 TEXT NOT NULL,kind TEXT NOT NULL,pages INTEGER NOT NULL,PRIMARY KEY(sha256,kind))');
 const old=db.prepare('SELECT pages FROM commercial_document_metrics WHERE sha256=? AND kind=?').get(file.sha256,file.kind);if(old)return old.pages;
 const bytes=await fileBytes(file,config.storage);if(bytes.length!==file.bytes||digest(bytes)!==file.sha256)fail(409,'原件完整性核验未通过，请重新上传');
 let pages;try{pages=file.kind==='docx'?await validateTranslationDocument(bytes):config.documentTranslationPageCount?await config.documentTranslationPageCount(bytes):(await compute('pdfMetadata',{body:bytes})).pages;}catch{fail(400,'无法识别文档页数，请检查文件是否加密或损坏');}
 if(!Number.isSafeInteger(pages)||pages<1||pages>100)fail(400,'当前文档最多支持 100 页，请拆分文档后处理；尚未扣费。');
 db.prepare('INSERT OR IGNORE INTO commercial_document_metrics VALUES(?,?,?)').run(file.sha256,file.kind,pages);return pages;
}
export function reserveParsePages(db,userId,jobId,pages){
 if(!v1CommercialEnabled(db))return;
 db.exec(`CREATE TABLE IF NOT EXISTS commercial_parse_reservations(job_id TEXT PRIMARY KEY REFERENCES jobs(id),user_id TEXT NOT NULL REFERENCES users(id),grant_key TEXT NOT NULL,pages INTEGER NOT NULL CHECK(pages>0),created_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS commercial_parse_no_update BEFORE UPDATE ON commercial_parse_reservations BEGIN SELECT RAISE(ABORT,'解析页数记录不可修改'); END;
 CREATE TRIGGER IF NOT EXISTS commercial_parse_no_delete BEFORE DELETE ON commercial_parse_reservations BEGIN SELECT RAISE(ABORT,'解析页数记录不可删除'); END;`);
 if(db.prepare('SELECT 1 FROM commercial_parse_reservations WHERE job_id=?').get(jobId))return;
 const consumed=key=>db.prepare("SELECT coalesce(sum(r.pages),0) n FROM commercial_parse_reservations r JOIN jobs j ON j.id=r.job_id WHERE r.user_id=? AND r.grant_key=? AND j.status IN ('queued','running','completed')").get(userId,key).n;
 const options=[...activeResourceGrants(db,userId).flatMap(g=>g.items.filter(i=>i.key==='parse-pages').map(i=>({key:g.id,quantity:i.quantity}))),{key:'free-trial',quantity:20}];
 const selected=options.find(o=>o.quantity-consumed(o.key)>=pages);if(!selected)fail(402,'PDF 解析页数额度不足；请使用适用会员或选择其他文献。本次未提交解析。');
 db.prepare('INSERT INTO commercial_parse_reservations VALUES(?,?,?,?,?)').run(jobId,userId,selected.key,pages,new Date().toISOString());
}
