import {randomUUID} from 'node:crypto';
import {digest} from './auth.mjs';
import {createArtifactService,initializeArtifactSchema} from './artifact-service.mjs';
import {webSearchConfigured} from './web-similarity-search.mjs';
import {detectionFreeEntryReady,reserveIncludedDetection,includedDetectionHeld,detectionTrialUsage} from './detection-entitlements.mjs';
import {webSimilarityLimits,webSimilarityVersion,webSimilarityInput,planWebQueries,webSimilarityDay,webSimilarityFileName,webSimilarityFail as fail} from './web-similarity-model.mjs';

export function initializeWebSimilaritySchema(db){
 initializeArtifactSchema(db);
 db.exec(`CREATE TABLE IF NOT EXISTS web_similarity_runs(
  id TEXT PRIMARY KEY REFERENCES jobs(id),user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,
  characters INTEGER NOT NULL,input_artifact_id TEXT REFERENCES artifacts(id),report_artifact_id TEXT REFERENCES artifacts(id),
  html_artifact_id TEXT REFERENCES artifacts(id),coverage TEXT NOT NULL DEFAULT '{}',queries_reserved INTEGER NOT NULL,
  queries_attempted INTEGER NOT NULL DEFAULT 0,usage TEXT NOT NULL DEFAULT '[]',created_artifacts TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL
 );CREATE INDEX IF NOT EXISTS web_similarity_owner ON web_similarity_runs(user_id,created_at);
 CREATE INDEX IF NOT EXISTS web_similarity_day ON web_similarity_runs(created_at);
 CREATE TABLE IF NOT EXISTS web_similarity_attempts(
  job_id TEXT NOT NULL REFERENCES jobs(id),query_index INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
  PRIMARY KEY(job_id,query_index)
 );CREATE INDEX IF NOT EXISTS web_similarity_attempt_day ON web_similarity_attempts(created_at,user_id);`);
}
const storageReady=config=>config.storage?.provider==='aliyun_oss'&&typeof config.storage.bucket==='string'&&typeof config.storage.prefix==='string'&&typeof config.storage.putArtifact==='function'&&typeof config.storage.readArtifact==='function'&&typeof config.storage.removeArtifact==='function';
export const webSimilarityReady=config=>webSearchConfigured(config)&&storageReady(config);
export function webSimilarityCapabilities(config){const ready=webSimilarityReady(config)&&detectionFreeEntryReady(config.billing,'detection-similarity');return{ready,...webSimilarityLimits,pointsCharged:false,bundleUsageSupported:Boolean(config.billing),consentRequired:true,reason:ready?'':'联网来源查重暂未开放，可先使用本地材料比对。'};}
const safeId=value=>typeof value==='string'&&/^[-A-Za-z0-9_]{1,120}$/.test(value);
const readingByStorage=new WeakMap();
export async function readWebSimilarityArtifact(db,config,id,userId){
 const row=db.prepare("SELECT * FROM artifacts WHERE id=? AND user_id=? AND status='ready' AND kind='json'").get(id,userId);
 if(!row)fail(409,'查重文件已移除或尚未保存完成，请查看任务记录。');
 const storage=config.storage;if(!storage||typeof storage.readArtifact!=='function')fail(503,'查重云存储暂不可用，请稍后查看。');
 const active=readingByStorage.get(storage)||0;if(active>=2)fail(429,'当前报告读取较多，请稍后查看，无需重新检索。');readingByStorage.set(storage,active+1);
 try{
  let buffer;try{buffer=await storage.readArtifact(row);}catch{fail(503,'查重文件暂时读取失败，请稍后查看，无需重新检索。');}
  if(!Buffer.isBuffer(buffer)||buffer.length>20*1024*1024||buffer.length!==row.bytes||digest(buffer)!==row.sha256)fail(503,'查重文件完整性校验未通过，请联系支持。');
  try{return JSON.parse(buffer.toString('utf8'));}catch{fail(503,'查重文件格式暂不可读取，请联系支持。');}
 }finally{readingByStorage.set(storage,(readingByStorage.get(storage)||1)-1);}
}
export async function saveWebSimilarityArtifact(db,config,job,buffer,name){
 const artifactService=createArtifactService(db,config);
 let response;
 try{response=await artifactService({path:'/api/artifacts',method:'POST',user:{id:job.user_id},readBody:async()=>({name,data:buffer.toString('base64'),sha256:digest(buffer),sourceType:'detection',sourceId:job.id,expectedUserId:job.user_id})});}
 catch(error){
  // Ambiguous put + failed compensation leaves an indexed private object. Track
  // only objects originally created for this job, never a deduplicated old file.
  const row=db.prepare('SELECT created_artifacts FROM web_similarity_runs WHERE id=? AND user_id=?').get(job.id,job.user_id);
  if(row){const ids=new Set(JSON.parse(row.created_artifacts));for(const file of db.prepare("SELECT id FROM artifacts WHERE user_id=? AND source_type='detection' AND source_id=? AND status!='deleted'").all(job.user_id,job.id))ids.add(file.id);db.prepare('UPDATE web_similarity_runs SET created_artifacts=?,updated_at=? WHERE id=?').run(JSON.stringify([...ids]),new Date().toISOString(),job.id);}
  throw error;
 }
 const id=response.value.item.id;
 if(!response.value.deduplicated){const row=db.prepare('SELECT created_artifacts FROM web_similarity_runs WHERE id=?').get(job.id),ids=JSON.parse(row.created_artifacts);if(!ids.includes(id)){ids.push(id);db.prepare('UPDATE web_similarity_runs SET created_artifacts=?,updated_at=? WHERE id=?').run(JSON.stringify(ids),new Date().toISOString(),job.id);}}
 return id;
}
export async function removeWebSimilarityArtifacts(db,config,job,{inputOnly=false}={}){
 const row=db.prepare('SELECT * FROM web_similarity_runs WHERE id=? AND user_id=?').get(job.id,job.user_id);if(!row)return;
 const service=createArtifactService(db,config),ids=JSON.parse(row.created_artifacts),remaining=[];
 for(const id of ids){
  if(inputOnly&&id!==row.input_artifact_id){remaining.push(id);continue;}
  const artifact=db.prepare("SELECT id,sha256,status FROM artifacts WHERE id=? AND user_id=?").get(id,job.user_id);
  if(!artifact||artifact.status==='deleted')continue;
  try{await service({path:'/api/artifacts/'+id+'/delete',method:'POST',user:{id:job.user_id},readBody:async()=>({expectedSha256:artifact.sha256,expectedUserId:job.user_id})});}catch{remaining.push(id);}
 }
 db.prepare('UPDATE web_similarity_runs SET created_artifacts=?,updated_at=? WHERE id=?').run(JSON.stringify(remaining),new Date().toISOString(),job.id);
}

export function createWebSimilarityService(db,config={}){
 initializeWebSimilaritySchema(db);
 const reportAttempts=new Map();
 const rateReport=user=>{const at=Date.now();if(reportAttempts.size>10000)for(const [id,row]of reportAttempts)if(row.until<at)reportAttempts.delete(id);const previous=reportAttempts.get(user.id),row=previous?.until>at?previous:{count:0,until:at+60000};if(++row.count>20)fail(429,'报告读取较频繁，请稍后查看，无需重新检索。');reportAttempts.set(user.id,row);};
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}};
 const own=(id,user)=>{const row=db.prepare("SELECT j.*,r.title,r.characters,r.report_artifact_id,r.html_artifact_id,r.coverage FROM jobs j JOIN web_similarity_runs r ON r.id=j.id WHERE j.id=? AND j.user_id=? AND j.type='web_similarity'").get(id,user.id);if(!row)fail(404,'查重任务不存在。');return row;};
 const summary=row=>({id:row.id,title:row.title,status:row.status==='preparing'?'queued':row.status,stage:row.stage,characters:row.characters,error:row.error||null,reportId:row.status==='completed'?row.id:null,coverage:JSON.parse(row.coverage),createdAt:row.created_at,updatedAt:row.updated_at});
 return{capabilities:()=>webSimilarityCapabilities(config),async handle({path,method,user,readBody,query=new URLSearchParams()}){
  const match=path.match(/^\/api\/web-similarity\/([-A-Za-z0-9_]{1,120})(\/(?:cancel|report))?$/);
  if(path!=='/api/web-similarity'&&!match)return null;
  if(!safeId(user?.id))fail(401,'请先登录服务账户。');
  if(method==='GET'&&query.has('expectedUserId')&&query.get('expectedUserId')!==user.id)fail(409,'登录账户已变化，请刷新后查看。');
  if(match){
   const row=own(match[1],user);
   if(method==='GET'&&match[2]==='/report'){
    if(row.status!=='completed')fail(409,'报告尚未完成，未提供不完整的相似度。');
    rateReport(user);
    const value=await readWebSimilarityArtifact(db,config,row.report_artifact_id,user.id);
    if(value.version!==1||value.report?.id!==row.id||value.report?.mode!=='web'||value.report?.scope!=='public-web-sources'||!value.report?.sources?.length)fail(503,'查重报告结构校验未通过，请联系支持。');
    return{value:{ownerId:user.id,report:value.report}};
   }
   if(method==='GET'&&!match[2])return{value:{ownerId:user.id,item:summary(row)}};
   if(method!=='POST'||match[2]!=='/cancel')fail(405,'不支持的查重操作。');
   const input=await readBody();if(!input||Object.keys(input).some(k=>k!=='expectedUserId')||input.expectedUserId!==user.id)fail(409,'登录账户已变化，请刷新后操作。');
   tx(()=>{const current=own(row.id,user);if(!['preparing','queued','running'].includes(current.status))fail(409,'本次查重已经结束。');db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled',error=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(),row.id);config.billing?.release(row.id);});
   config.cancelWebSimilarity?.(row.id);
   return{value:{ownerId:user.id,item:summary(own(row.id,user))}};
  }
  if(method==='GET')return{value:{ownerId:user.id,items:db.prepare("SELECT j.*,r.title,r.characters,r.coverage FROM jobs j JOIN web_similarity_runs r ON r.id=j.id WHERE j.user_id=? AND j.type='web_similarity' ORDER BY j.created_at DESC,j.id DESC LIMIT 30").all(user.id).map(summary)}};
  if(method!=='POST')fail(405,'不支持的查重操作。');
  const input=webSimilarityInput(await readBody(),user),plan=planWebQueries(input.parsed),hash=digest(JSON.stringify({version:webSimilarityVersion,text:input.text,title:input.title}));
  const reserved=tx(()=>{
   const existing=db.prepare('SELECT * FROM jobs WHERE user_id=? AND idempotency_key=?').get(user.id,input.idempotencyKey);
   if(existing){if(existing.type!=='web_similarity'||existing.input_hash!==hash)fail(409,'请求编号已用于其他内容，请重新确认正文。');return{id:existing.id,existing:true};}
   const duplicate=db.prepare("SELECT j.id FROM jobs j JOIN web_similarity_runs r ON r.id=j.id WHERE j.user_id=? AND j.type='web_similarity' AND j.input_hash=? AND (j.status IN ('preparing','queued','running','completed') OR r.queries_attempted>0) AND (j.status IN ('preparing','queued','running') OR j.created_at>=?) ORDER BY j.created_at DESC LIMIT 1").get(user.id,hash,new Date(Date.now()-86400000).toISOString());
   if(duplicate)return{id:duplicate.id,existing:true};
   if(!webSimilarityReady(config))fail(503,webSimilarityCapabilities(config).reason);
   if(db.prepare("SELECT 1 FROM jobs WHERE user_id=? AND type='web_similarity' AND status IN ('preparing','queued','running')").get(user.id))fail(409,'你已有一项联网查重正在处理，请完成后再提交。');
   if(db.prepare("SELECT count(*) n FROM jobs WHERE type='web_similarity' AND status IN ('preparing','queued','running')").get().n>=webSimilarityLimits.maxQueued)fail(429,'联网查重当前繁忙，请稍后再试。');
   const id=randomUUID(),at=new Date().toISOString();
   db.prepare("INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,'web_similarity','preparing','saving_input','{}',?,?,?,?)").run(id,user.id,input.idempotencyKey,hash,at,at);
   const coverage={sampledParagraphs:plan.sampledParagraphs,totalParagraphs:plan.totalParagraphs,queries:plan.queries.length,candidateSources:0,fetchedSources:0,failedSources:0,searchComplete:false};
   db.prepare('INSERT INTO web_similarity_runs(id,user_id,title,characters,queries_reserved,coverage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,user.id,input.title,input.characters,plan.queries.length,JSON.stringify(coverage),at,at);
   reserveIncludedDetection(config.billing,user,id,'detection-similarity');
   if(!includedDetectionHeld(db,user.id,id,'detection-similarity')){
    const day=webSimilarityDay(),window={since:day.start,until:day.end,excludeId:id};
    if(detectionTrialUsage(db,'detection-similarity',{...window,userId:user.id}).n>=webSimilarityLimits.userDailyLimit)fail(429,'今日联网查重次数已用完，请明日再试。');
    if(detectionTrialUsage(db,'detection-similarity',window).n>=webSimilarityLimits.globalDailyLimit)fail(429,'联网查重今日试运行额度已用完，请稍后再试。');
   }
   return{id,existing:false};
  });
  if(!reserved.existing){
   const job={id:reserved.id,user_id:user.id};
   try{
    const id=await saveWebSimilarityArtifact(db,config,job,Buffer.from(JSON.stringify({version:1,runId:reserved.id,text:input.text,title:input.title})),webSimilarityFileName(input.title,'_'+reserved.id+'_查重输入.json'));
    db.prepare('UPDATE web_similarity_runs SET input_artifact_id=?,updated_at=? WHERE id=?').run(id,new Date().toISOString(),reserved.id);
    db.prepare("UPDATE jobs SET status='queued',stage='queued',updated_at=? WHERE id=? AND status='preparing'").run(new Date().toISOString(),reserved.id);
    if(own(reserved.id,user).status==='cancelled')await removeWebSimilarityArtifacts(db,config,job);
   }catch{
    tx(()=>{db.prepare("UPDATE jobs SET status='failed',stage='input_failed',error='正文保存未完成，未执行联网检索，请稍后重新确认。',updated_at=? WHERE id=? AND status='preparing'").run(new Date().toISOString(),reserved.id);config.billing?.release(reserved.id);});
    await removeWebSimilarityArtifacts(db,config,job);
   }
  }
  return{status:reserved.existing?200:202,value:{ownerId:user.id,item:summary(own(reserved.id,user))}};
 }};
}
