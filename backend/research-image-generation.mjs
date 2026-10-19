import {createArtifactService} from './artifact-service.mjs';
import {digest} from './auth.mjs';
import {assertResearchImageSettings,createResearchImageClient,validateResearchImage} from './research-image-client.mjs';
import {moderateTextOrFail} from './moderated-agent.mjs';
const MANIFEST='research-image-delivery';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const safeName=title=>String(title||'科研绘图').replace(/[\x00-\x1f\x7f/\\:*?"<>|\u202a-\u202e\u2066-\u2069]/g,'_').slice(0,110)||'科研绘图';
export function initializeResearchImageUsage(db){db.exec(`CREATE TABLE IF NOT EXISTS research_image_usage(job_id TEXT PRIMARY KEY REFERENCES jobs(id),user_id TEXT NOT NULL REFERENCES users(id),provider TEXT NOT NULL,model TEXT NOT NULL,attempted_images INTEGER NOT NULL DEFAULT 1 CHECK(attempted_images=1),generated_images INTEGER NOT NULL DEFAULT 0 CHECK(generated_images IN (0,1)),delivered_images INTEGER NOT NULL DEFAULT 0 CHECK(delivered_images IN (0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS research_image_usage_owner ON research_image_usage(user_id,created_at);`);}
export function researchImageGenerationStatus(config={},settings){
 const storage=config.storage,storageReady=storage?.provider==='aliyun_oss'&&typeof storage.bucket==='string'&&typeof storage.prefix==='string'&&typeof storage.putArtifact==='function'&&typeof storage.readArtifact==='function'&&typeof storage.removeArtifact==='function';
 const moderated=config.moderationEnabled===true&&config.moderation?.ready===true&&typeof config.moderation.checkText==='function';let configured=false;try{assertResearchImageSettings(settings);configured=true;}catch{}
 return{ready:configured&&storageReady&&moderated,reason:!storageReady?'科研图片云存储暂不可用，请稍后重试':!moderated?'科研绘图安全审核正在准备，请稍后重试':!configured?'科研绘图服务暂未就绪，请稍后重试':null,maxPromptCharacters:6000,requiresReview:true};
}
function manifest(db,id){const row=db.prepare('SELECT output FROM tool_checkpoints WHERE run_id=? AND unit_id=?').get(id,MANIFEST);return row?JSON.parse(row.output):{createdIds:[]};}
export async function cleanupResearchImageDelivery(db,config,runId,userId,additional=[]){
 const artifacts=createArtifactService(db,config),saved=manifest(db,runId),remaining=[];
 const orphan=db.prepare("SELECT id FROM artifacts WHERE user_id=? AND source_type='research' AND source_id=? AND status!='deleted'").all(userId,runId).map(row=>row.id);
 for(const id of new Set([...saved.createdIds,...additional,...orphan])){const row=db.prepare("SELECT id,sha256 FROM artifacts WHERE id=? AND user_id=? AND source_type='research' AND source_id=? AND status!='deleted'").get(id,userId,runId);if(!row)continue;try{await artifacts({path:'/api/artifacts/'+id+'/delete',method:'POST',user:{id:userId},readBody:async()=>({expectedSha256:row.sha256,expectedUserId:userId})});}catch{remaining.push(id);}}
 if(orphan.length||saved.createdIds.length||additional.length)db.prepare('INSERT INTO tool_checkpoints VALUES(?,?,?,?,?) ON CONFLICT(run_id,unit_id) DO UPDATE SET output=excluded.output,created_at=excluded.created_at').run(runId,MANIFEST,3000,JSON.stringify({createdIds:remaining}),new Date().toISOString());return remaining;
}
export async function generateResearchImage(db,config,{row,value,settings,signal,isActive,onStage}){
 const status=researchImageGenerationStatus(config,settings);if(!status.ready)fail(503,status.reason);
 const check=()=>{if(signal?.aborted||!isActive())fail(499,'科研绘图任务已停止');};check();onStage?.('checking_input');
 await moderateTextOrFail(config,JSON.stringify({title:value.snapshot.title,prompt:value.snapshot.text,requirements:value.snapshot.requirements,language:value.snapshot.language,mode:value.snapshot.mode,options:value.snapshot.context}),{kind:'input',signal});check();
 const at=new Date().toISOString();db.prepare('INSERT INTO research_image_usage(job_id,user_id,provider,model,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(row.id,row.user_id,'bailian-image',settings.model,at,at);
 onStage?.('generating');const run=config.researchImageRunner||((snapshot,options)=>createResearchImageClient(settings).generate(snapshot,options));
 const generated=await run(value.snapshot,{settings,signal});check();const image=validateResearchImage(generated?.buffer);if(generated.imageCount!==1)fail(502,'绘图服务返回的图片数量与本次确认不一致');
 db.prepare('UPDATE research_image_usage SET generated_images=1,updated_at=? WHERE job_id=?').run(new Date().toISOString(),row.id);onStage?.('storing');
 const artifacts=createArtifactService(db,config),name=safeName(value.snapshot.title)+'.'+image.kind;let item,created=[];
 try{
  const response=await artifacts({path:'/api/artifacts',method:'POST',user:{id:row.user_id},readBody:async()=>({name,data:image.buffer.toString('base64'),sha256:digest(image.buffer),sourceType:'research',sourceId:row.id,expectedUserId:row.user_id})});
  item=response.value.item;if(!response.value.deduplicated)created.push(item.id);
  db.prepare('INSERT INTO tool_checkpoints VALUES(?,?,?,?,?) ON CONFLICT(run_id,unit_id) DO UPDATE SET output=excluded.output,created_at=excluded.created_at').run(row.id,MANIFEST,3000,JSON.stringify({createdIds:created}),new Date().toISOString());check();
  // Verify the private object before committing a result or consuming credits.
  const saved=db.prepare("SELECT * FROM artifacts WHERE id=? AND user_id=? AND status='ready'").get(item.id,row.user_id),bytes=saved?await config.storage.readArtifact(saved):null;check();if(!Buffer.isBuffer(bytes)||bytes.length!==image.buffer.length||digest(bytes)!==item.sha256)fail(503,'科研图片云端完整性校验未完成，本次未结算');
  return{text:'科研绘图已生成，请核对图中文字、关系与数值后使用。',sourceIds:[],requiresReview:true,image:{artifactId:item.id,downloadUrl:item.downloadUrl,fileName:item.name,width:image.width,height:image.height,mimeType:image.mimeType},artifacts:[{...item,role:'image'}]};
 }catch(error){await cleanupResearchImageDelivery(db,config,row.id,row.user_id,created);throw error;}
}
