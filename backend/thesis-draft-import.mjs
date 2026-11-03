import {randomUUID,createHash} from 'node:crypto';
import {fileBytes} from './storage.mjs';
import {parseThesisDraftDocx} from './thesis-draft-docx.mjs';
import {normalizeThesisSnapshot,thesisError,thesisHash,thesisTransaction,assertThesisAccountQuota,assertThesisChapterCapacity,thesisManualSourceIds,thesisPlan} from './thesis-model.mjs';
const fail=(status,message)=>{throw thesisError(status,message);};
const fields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))fail(400,'初稿导入参数无效');};
const expected=(input,row)=>{if(!Number.isSafeInteger(input.version)||input.version<1)fail(400,'请提供当前论文版本');if(input.version!==row.version)fail(409,'论文已更新，请读取最新状态后重新导入');if(['queued','running'].includes(row.status))fail(409,'请等待当前论文任务结束后再导入或恢复初稿');};
const commandKey=input=>{if(typeof input.clientKey!=='string'||input.clientKey.length<8||input.clientKey.length>100)fail(400,'请提供有效的初稿提交标识');};
export function createThesisDraftImporter(db,config,{own,serialize,clock}){
 db.exec(`CREATE TABLE IF NOT EXISTS thesis_draft_imports(id TEXT PRIMARY KEY,thesis_id TEXT NOT NULL REFERENCES theses(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),client_key TEXT NOT NULL,file_id TEXT NOT NULL,file_sha256 TEXT NOT NULL,input_hash TEXT NOT NULL,baseline TEXT NOT NULL,created_at TEXT NOT NULL,restored_at TEXT,UNIQUE(user_id,client_key));CREATE INDEX IF NOT EXISTS thesis_draft_imports_owner ON thesis_draft_imports(user_id,thesis_id,created_at);`);
 const chapter=(id,chapterId)=>db.prepare('SELECT * FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=? ORDER BY version DESC LIMIT 1').get(id,chapterId);
 const available=(fileId,user)=>{const file=db.prepare('SELECT * FROM files WHERE id=? AND user_id=?').get(fileId,user.id);if(!file)fail(404,'初稿原件不存在，请重新上传或从文件管理选择');if(file.kind!=='docx'||file.bytes>2*1024*1024)fail(400,'初稿仅支持不超过 2MB 的 DOCX 文档');if(db.prepare("SELECT 1 FROM workspace_file_deletions WHERE file_id=? AND status='pending'").get(file.id))fail(409,'原件正在删除，请重新选择文件');return file;};
 async function prepare(row,input,user){
  if(typeof input.fileId!=='string'||input.fileId.length>120)fail(400,'请选择有效的初稿文件');const file=available(input.fileId,user);let bytes;try{bytes=await fileBytes(file,config.storage);}catch{fail(503,'初稿原件暂时无法读取，请稍后重试');}
  if(!Buffer.isBuffer(bytes)||bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)fail(409,'初稿文件完整性核对未通过，请重新选择文件');
  let parsed;try{parsed=await parseThesisDraftDocx(bytes,{name:file.name,snapshot:JSON.parse(row.snapshot)});}catch(error){if(error.status)throw error;fail(422,'初稿无法完整识别，请在 Word 中另存为普通 DOCX 后重试；当前正文未改变。');}
  const snapshot=normalizeThesisSnapshot({...JSON.parse(row.snapshot),requirements:{...JSON.parse(row.snapshot).requirements,deliveryVersion:1},outline:parsed.chapters.map(({text,...outline})=>outline),references:parsed.references},config);
  thesisPlan(snapshot,config);
  const current=own(row.id,user);expected(input,current);if(available(file.id,user).sha256!==file.sha256)fail(409,'原件已变化，请重新选择');
  return {parsed,snapshot,file,previewHash:thesisHash({thesisId:row.id,version:row.version,fileId:file.id,fileSha256:file.sha256,snapshot,chapters:parsed.chapters})};
 }
 return async function handle({path,method,user,readBody}){
  const match=path.match(/^\/api\/theses\/([^/]+)\/draft-import(?:\/(preview|restore))?$/);if(!match)return null;
  const [,id,operation]=match,row=own(id,user);if(method!=='POST')fail(405,'请提交初稿导入或恢复操作');const input=await readBody();
  if(operation==='restore'){
   fields(input,['version','importId']);const imported=db.prepare('SELECT * FROM thesis_draft_imports WHERE id=? AND thesis_id=? AND user_id=?').get(input.importId,id,user.id);if(!imported)fail(404,'本次初稿导入记录不存在');if(imported.restored_at)return {value:{item:serialize(row)}};expected(input,row);
   return {value:thesisTransaction(db,()=>{const current=own(id,user);expected(input,current);const baseline=JSON.parse(imported.baseline);if(current.version!==baseline.version+1)fail(409,'导入后论文已修改，为保留新增内容，无法直接撤销；可在章节历史中查看导入前版本。');const at=clock(),records=baseline.chapters.map(reference=>({reference,record:reference.versionId?db.prepare('SELECT * FROM thesis_chapter_versions WHERE id=? AND thesis_id=? AND chapter_id=?').get(reference.versionId,id,reference.chapterId):null}));if(records.some(({reference,record})=>reference.versionId&&!record))fail(409,'原章节版本暂不可读取，当前初稿未改变');
    assertThesisAccountQuota(db,user.id,Buffer.byteLength(baseline.snapshot)+records.reduce((sum,{record})=>sum+Math.max(512,Buffer.byteLength(record?.text||'')+Buffer.byteLength(record?.figures||'[]')),0)+512,config);
    for(const {reference,record} of records){const latest=chapter(id,reference.chapterId);assertThesisChapterCapacity(db,id,reference.chapterId);db.prepare('INSERT INTO thesis_chapter_versions(id,thesis_id,chapter_id,version,run_id,source,text,source_ids,created_at,figures) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,reference.chapterId,(latest?.version||0)+1,null,'imported',record?.text||'',record?.source_ids||'[]',at,record?.figures||'[]');}
    db.prepare("UPDATE theses SET snapshot=?,snapshot_hash=?,status='draft',current_run_id=NULL,version=version+1,updated_at=? WHERE id=? AND user_id=?").run(baseline.snapshot,thesisHash(JSON.parse(baseline.snapshot)),at,id,user.id);db.prepare('UPDATE thesis_draft_imports SET restored_at=? WHERE id=? AND user_id=?').run(at,imported.id,user.id);return {item:serialize(own(id,user))};})};
  }
  fields(input,operation==='preview'?['version','fileId']:['version','fileId','previewHash','clientKey','replaceExisting']);
  const hash=thesisHash({thesisId:id,fileId:input.fileId,previewHash:input.previewHash,replaceExisting:input.replaceExisting});
  if(operation!=='preview'){commandKey(input);const prior=db.prepare('SELECT * FROM thesis_draft_imports WHERE user_id=? AND client_key=?').get(user.id,input.clientKey);if(prior){if(prior.thesis_id!==id||prior.input_hash!==hash)fail(409,'此导入标识已用于其他内容');return {value:{item:serialize(row)}};}}
  expected(input,row);const prepared=await prepare(row,input,user);
  if(operation==='preview')return {value:{preview:{fileId:prepared.file.id,name:prepared.file.name,sha256:prepared.file.sha256,previewHash:prepared.previewHash,version:row.version,characters:prepared.parsed.characters,tableCount:prepared.parsed.tableCount,referenceCount:prepared.parsed.referenceCount,warnings:prepared.parsed.warnings,chapters:prepared.parsed.chapters.map(chapter=>({id:chapter.id,title:chapter.title,characters:chapter.text.length,excerpt:chapter.text.slice(0,180)})),replacesExisting:JSON.parse(row.snapshot).outline.some(outline=>chapter(id,outline.id)?.text?.trim())}}};
  if(typeof input.previewHash!=='string'||input.previewHash!==prepared.previewHash)fail(409,'初稿识别结果或论文版本已变化，请重新识别后确认');
  return {value:thesisTransaction(db,()=>{const current=own(id,user);expected(input,current);available(prepared.file.id,user);const prior=db.prepare('SELECT * FROM thesis_draft_imports WHERE user_id=? AND client_key=?').get(user.id,input.clientKey);if(prior){if(prior.input_hash!==hash||prior.thesis_id!==id)fail(409,'导入标识已用于其他内容');return {item:serialize(current)};}
   const baseline={version:current.version,snapshot:current.snapshot,chapters:JSON.parse(current.snapshot).outline.map(outline=>({chapterId:outline.id,versionId:chapter(id,outline.id)?.id||null}))};
   if(input.replaceExisting!==true&&baseline.chapters.some(reference=>chapter(id,reference.chapterId)?.text?.trim()))fail(409,'当前已有正文，请在识别预览中确认替换，原章节版本会保留');
   const encoded=JSON.stringify(prepared.snapshot),backup=JSON.stringify(baseline),at=clock();assertThesisAccountQuota(db,user.id,Buffer.byteLength(encoded)+Buffer.byteLength(backup)+prepared.parsed.chapters.reduce((sum,chapter)=>sum+Math.max(512,Buffer.byteLength(chapter.text)),0)+512,config);
   for(const imported of prepared.parsed.chapters){const latest=chapter(id,imported.id);assertThesisChapterCapacity(db,id,imported.id);db.prepare('INSERT INTO thesis_chapter_versions(id,thesis_id,chapter_id,version,run_id,source,text,source_ids,created_at,figures) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,imported.id,(latest?.version||0)+1,null,'imported',imported.text,JSON.stringify(thesisManualSourceIds(imported.text,prepared.snapshot)),at,'[]');}
   db.prepare("UPDATE theses SET snapshot=?,snapshot_hash=?,status='draft',current_run_id=NULL,version=version+1,updated_at=? WHERE id=? AND user_id=?").run(encoded,thesisHash(prepared.snapshot),at,id,user.id);
   db.prepare('INSERT INTO thesis_draft_imports(id,thesis_id,user_id,client_key,file_id,file_sha256,input_hash,baseline,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,user.id,input.clientKey,prepared.file.id,prepared.file.sha256,hash,backup,at);return {item:serialize(own(id,user))};})};
 };
}
