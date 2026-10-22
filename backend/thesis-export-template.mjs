import {digest} from './auth.mjs';
import {fileBytes} from './storage.mjs';

const maxTemplateBytes=2*1024*1024,maxProfileBytes=64*1024;
let activeInspections=0;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fileId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
const validSource=value=>object(value)&&fileId(value.fileId)&&typeof value.name==='string'&&value.name.length>0&&value.name.length<=200&&/^[a-f0-9]{64}$/.test(value.sha256||'')&&Number.isSafeInteger(value.size)&&value.size>0&&value.size<=maxTemplateBytes;
function profile(value){
 if(!object(value)||value.version!==1||!object(value.rules))fail(422,'模板未能提取可用的排版规则，请核对文件后重新上传');
 for(const key of ['recognized','warnings','summary',...(value.unresolved===undefined?[]:['unresolved'])])if(!Array.isArray(value[key])||value[key].length>(['recognized','unresolved'].includes(key)?256:100)||value[key].some(text=>typeof text!=='string'||text.length>2000))fail(422,'模板解析结果无效，请重新上传');
 if(!value.recognized.length)fail(422,'未能识别模板的实际排版规则，请提供含样式的 DOCX 样例；尚未应用该模板');
 const clean={version:1,rules:value.rules,recognized:value.recognized,...(value.unresolved===undefined?{}:{unresolved:value.unresolved}),warnings:value.warnings,summary:value.summary};
 let json;try{json=JSON.stringify(clean);}catch{fail(422,'模板解析结果无效，请重新上传');}
 if(Buffer.byteLength(json)>maxProfileBytes)fail(413,'模板排版规则过多，请精简模板后重新上传');
 return JSON.parse(json);
}

// The reference is independent of the research snapshot. Only server-inspected
// rules are persisted, and no client URL or object-storage key is accepted.
export function createThesisExportTemplates(db,config={}){
 const pending=id=>Boolean(db.prepare("SELECT 1 FROM workspace_file_deletions WHERE file_id=? AND status='pending'").get(id));
 const ownFile=(id,ownerId)=>db.prepare('SELECT * FROM files WHERE id=? AND user_id=?').get(id,ownerId);
 function usable(row){return Boolean(row&&row.kind==='docx'&&Number.isSafeInteger(row.bytes)&&row.bytes>0&&row.bytes<=maxTemplateBytes&&/^[a-f0-9]{64}$/.test(row.sha256||'')&&!pending(row.id)&&(!config.requireRemoteStorage||row.storage_provider==='aliyun_oss'));}
 function stored(row){
  if(!row.export_template)return null;
  let value;try{value=JSON.parse(row.export_template);}catch{return {version:1,source:null,profile:null,status:'unavailable'};}
  if(!object(value)||value.version!==1||!validSource(value.source))return {version:1,source:null,profile:null,status:'unavailable'};
  let parsed;try{parsed=profile(value.profile);}catch{return {version:1,source:value.source,profile:null,status:'unavailable'};}
  const source=ownFile(value.source.fileId,row.user_id),available=usable(source)&&source.sha256===value.source.sha256&&source.bytes===value.source.size;
  return {version:1,source:{...value.source},profile:parsed,status:available?'ready':'unavailable'};
 }
 function assertReference(value,ownerId){
  if(value===null)return;
  if(!validSource(value?.source))fail(409,'模板关联信息已失效，请重新上传模板');
  const source=ownFile(value.source.fileId,ownerId);
  if(!usable(source)||source.sha256!==value.source.sha256||source.bytes!==value.source.size)fail(409,'模板原件已变化或不可用，请重新选择模板');
 }
 async function bytes(row){
  let data;try{data=Buffer.from(await fileBytes(row,config.storage));}catch{fail(503,'模板原件暂时无法读取，请稍后重试或重新上传；尚未应用该模板');}
  if(data.length!==row.bytes||digest(data)!==row.sha256||!data.subarray(0,2).equals(Buffer.from('PK')))fail(422,'模板原件完整性校验失败，请重新上传；尚未应用该模板');
  return data;
 }
 async function inspect(id,ownerId){
  if(id===null)return null;
  if(!fileId(id))fail(400,'请选择已上传的 DOCX 模板原件');
  const source=ownFile(id,ownerId);
  if(!source)fail(404,'模板原件不存在');
  if(source.kind!=='docx')fail(400,'Word 排版模板仅支持 DOCX；PDF 和文字规范请作为格式要求资料上传');
  if(!usable(source))fail(409,'模板原件不可用或超过 2MB，请重新上传');
  if(activeInspections>=2)fail(429,'当前模板解析较多，请稍后重试');
  activeInspections++;
  try{
  const data=await bytes(source),inspectTemplate=config.inspectThesisDocxTemplate||(async value=>(await import('../src/thesis-template-profile.js')).inspectThesisDocxTemplate(value));
  let inspected;try{inspected=profile(await inspectTemplate(data));}catch(error){if(error.status)throw error;fail(422,'未能读取 DOCX 模板的真实排版规则，请核对文件后重新上传；尚未应用该模板');}
  const result={version:1,source:{fileId:source.id,name:source.name,sha256:source.sha256,size:source.bytes},profile:inspected,status:'ready'};
  assertReference(result,ownerId);
  return result;
  }finally{activeInspections--;}
 }
 async function verified(row){
  const selected=stored(row);if(!selected||selected.status==='unavailable')return selected;
  try{await bytes(ownFile(selected.source.fileId,row.user_id));assertReference(selected,row.user_id);return selected;}
  catch{return {...selected,status:'unavailable'};}
 }
 return {inspect,stored,verified,assertReference};
}

export function assertThesisTemplateNotReferenced(db,id,ownerId){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='theses'").get()||!db.prepare('PRAGMA table_info(theses)').all().some(row=>row.name==='export_template'))return;
 const linked=db.prepare("SELECT 1 FROM theses WHERE user_id=? AND CASE WHEN json_valid(export_template) THEN json_extract(export_template,'$.source.fileId') ELSE NULL END=? LIMIT 1").get(ownerId,id);
 if(linked)fail(409,'该原件正在作为论文导出模板使用，请先在论文中更换模板或切换为通用模板后再删除');
}
