import {digest} from './auth.mjs';
import {createArtifactService} from './artifact-service.mjs';
import {aigcReportHtml} from '../dist/workspace/aigc-report.mjs';

const unavailable=message=>Object.assign(Error(message),{status:503,aigcDetectionSafe:true});
export const aigcReportStorageReady=config=>config.storage?.provider==='aliyun_oss'&&typeof config.storage.bucket==='string'&&typeof config.storage.prefix==='string'&&['putArtifact','readArtifact','removeArtifact'].every(key=>typeof config.storage[key]==='function');

// Store the submitted version once. Retrieving or repairing a report never
// calls the detector again, and never borrows the current editor's text.
export function createAigcReportArchive(db,config,serialize){
 const publishing=new Map();
 const owned=id=>db.prepare('SELECT * FROM aigc_detections WHERE id=?').get(id);
 async function save(row,name,content){
  const buffer=Buffer.from(content),service=createArtifactService(db,config);
  const result=await service({path:'/api/artifacts',method:'POST',user:{id:row.user_id},readBody:async()=>({name,data:buffer.toString('base64'),sha256:digest(buffer),sourceType:'detection',sourceId:row.id,expectedUserId:row.user_id})});
  return result.value.item.id;
 }
 async function input(row){
  const file=db.prepare("SELECT * FROM artifacts WHERE id=? AND user_id=? AND kind='json' AND status='ready'").get(row.input_artifact_id,row.user_id);
  if(!file)throw unavailable('本次送检原文暂时无法读取，请在文件管理核对后重试；无需重新检测。');
  let bytes;try{bytes=await config.storage.readArtifact(file);}catch{throw unavailable('本次送检原文暂时读取失败，请稍后读取原报告；无需重新检测。');}
  if(!Buffer.isBuffer(bytes)||bytes.length>2*1024*1024||bytes.length!==file.bytes||digest(bytes)!==file.sha256)throw unavailable('送检原文完整性无法核对，请联系支持；不会重新检测。');
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw unavailable('送检原文格式无法核对，请联系支持。');}
  if(value.version!==1||value.id!==row.id||typeof value.text!=='string'||Array.from(value.text).length!==row.characters||value.title!==row.title||digest('aigc-v1\0'+value.text)!==row.input_hash)throw unavailable('送检原文与检测记录不一致，已停止报告导出。');
  return value;
 }
 async function storeInput(id,text){
  if(!aigcReportStorageReady(config))return;
  const row=owned(id);
  try{const fileId=await save(row,`论文AI检测原文-${id}.json`,JSON.stringify({version:1,id,title:row.title,text}));db.prepare('UPDATE aigc_detections SET input_artifact_id=? WHERE id=?').run(fileId,id);}
  catch{throw unavailable('送检原文未能保存到账户，未开始 AI 检测；本次预占次数将释放，请稍后重试。');}
 }
 async function build(id){
  const row=owned(id);if(row?.status!=='completed')throw Object.assign(Error('本次检测尚未完成，暂不能生成检测报告。'),{status:409});
  const source=await input(row),item=serialize(row),html=aigcReportHtml(item,{text:source.text,title:source.title});
  const file=row.html_artifact_id&&db.prepare("SELECT id FROM artifacts WHERE id=? AND user_id=? AND status='ready'").get(row.html_artifact_id,row.user_id);
  if(!file){
   try{const fileId=await save(row,`论文AI率检测报告-${id}.html`,html);db.prepare('UPDATE aigc_detections SET html_artifact_id=?,report_error=NULL WHERE id=?').run(fileId,id);}
   catch{db.prepare('UPDATE aigc_detections SET report_error=? WHERE id=?').run('检测已完成，报告暂未保存成功；请读取原报告重试，无需重新检测。',id);throw unavailable('检测已完成，报告暂未保存成功；请读取原报告重试，无需重新检测。');}
  }
  return {item:serialize(owned(id)),title:source.title,text:source.text};
 }
 function report(id){
  if(publishing.has(id))return publishing.get(id);
  const task=build(id);publishing.set(id,task);task.finally(()=>publishing.delete(id)).catch(()=>{});return task;
 }
 return {storeInput,report};
}
