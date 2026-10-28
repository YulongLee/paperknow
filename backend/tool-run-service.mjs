import {randomUUID} from 'node:crypto';
import {resolveTaskProject,projectTaskHash,taskProjectId} from './task-project-context.mjs';
import {createBillingService} from './billing-service.mjs';
import {createModelBudget} from './model-budget.mjs';
import {jobBillingType} from './job-billing-identity.mjs';
import {thesisError,thesisTransaction} from './thesis-model.mjs';
import {assertThesisSettings} from './thesis-service.mjs';
import {normalizeToolRequest,toolRunPlan,toolOperations,toolOperationNames,toolBillingIdentity} from './tool-run-model.mjs';
import {assertResearchImageSettings} from './research-image-client.mjs';
import {researchImageGenerationStatus,initializeResearchImageUsage} from './research-image-generation.mjs';
import {presentationGenerationStatus} from './presentation-generation.mjs';
const fail=(status,message)=>{throw thesisError(status,message);};
const fields=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))fail(400,'请求包含不支持的字段');};
const commandKey=k=>{if(typeof k!=='string'||!/^[A-Za-z0-9_:.-]{8,100}$/.test(k))fail(400,'请提供有效的唯一提交标识');return k;};
export function initializeToolRunSchema(db){db.exec(`
 CREATE TABLE IF NOT EXISTS tool_runs(id TEXT PRIMARY KEY REFERENCES jobs(id),user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,operation TEXT NOT NULL,snapshot TEXT NOT NULL,input_hash TEXT NOT NULL,client_key TEXT NOT NULL,settings_version TEXT NOT NULL,status TEXT NOT NULL,stage TEXT NOT NULL,error TEXT,plan TEXT NOT NULL,output TEXT,result_id TEXT,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,usage_known INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,client_key));
 CREATE INDEX IF NOT EXISTS tool_runs_queue ON tool_runs(status,created_at);
 CREATE INDEX IF NOT EXISTS tool_runs_owner ON tool_runs(user_id,created_at);
 CREATE TABLE IF NOT EXISTS tool_checkpoints(run_id TEXT NOT NULL REFERENCES tool_runs(id),unit_id TEXT NOT NULL,position INTEGER NOT NULL,output TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(run_id,unit_id));
 CREATE TABLE IF NOT EXISTS tool_quotes(token TEXT PRIMARY KEY REFERENCES billing_quotes(token) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),input_hash TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS tool_diagnostics(run_id TEXT PRIMARY KEY REFERENCES tool_runs(id),code TEXT NOT NULL,metrics TEXT NOT NULL,created_at TEXT NOT NULL);
 `);}
export function toolStorageCheck(db,userId,bytes=0,config={}){const limit=Number.isSafeInteger(config.toolAccountStorageBytes)?config.toolAccountStorageBytes:50*1024*1024,used=db.prepare("SELECT coalesce(sum(length(CAST(snapshot AS BLOB))+length(CAST(coalesce(output,'') AS BLOB))),0) n FROM tool_runs WHERE user_id=?").get(userId).n+db.prepare('SELECT coalesce(sum(length(CAST(c.output AS BLOB))),0) n FROM tool_checkpoints c JOIN tool_runs r ON r.id=c.run_id WHERE r.user_id=?').get(userId).n;if(used+bytes>limit)fail(413,'科研工具资料已达到保存上限，请先导出备份并联系支持整理');}
export function serializeToolRun(db,row){
 const snapshot=JSON.parse(row.snapshot),ppt=row.operation==='ppt',plan=JSON.parse(row.plan),completedUnits=row.operation==='image'&&row.status==='completed'?1:db.prepare('SELECT count(*) n FROM tool_checkpoints WHERE run_id=? AND position<1000').get(row.id).n;
 const pages=ppt?db.prepare('SELECT count(*) n FROM tool_checkpoints WHERE run_id=? AND position>=1000 AND position<2000').get(row.id).n:0,stages=['planning','authoring','validating','exporting','storing'];
 let stage=stages.includes(row.stage)?row.stage:completedUnits>=plan.length?'authoring':'planning';
 if(ppt&&['failed','cancelled'].includes(row.status)){try{const metrics=JSON.parse(db.prepare('SELECT metrics FROM tool_diagnostics WHERE run_id=?').get(row.id)?.metrics||'{}');if(stages.includes(metrics.presentationPhase))stage=metrics.presentationPhase;}catch{}}
 return{id:row.id,projectId:taskProjectId(db,row),kind:row.kind,operation:row.operation,title:snapshot.title,inputHash:row.input_hash,status:row.status,stage:row.stage,error:row.error,output:row.output?JSON.parse(row.output):null,resultId:row.result_id,completedUnits,totalUnits:plan.length,...(ppt?{progress:{stage,completedPages:row.status==='completed'?snapshot.context.pages:pages,currentPage:Math.min(snapshot.context.pages,pages+1),totalPages:snapshot.context.pages}}:{}),createdAt:row.created_at,updatedAt:row.updated_at,billingService:jobBillingType(db.prepare('SELECT type,input FROM jobs WHERE id=?').get(row.id)||{type:'tool_run'}),requiresReview:true};
}
export function createToolRunService(db,config={}){
 const billing=config.billing||createBillingService(db,config),budget=config.modelBudget||createModelBudget(db,config);initializeToolRunSchema(db);initializeResearchImageUsage(db);
 const clock=()=>new Date(config.toolNow?.()??Date.now()).toISOString(),settings=async(version,value)=>value?.operation==='image'?assertResearchImageSettings(await config.getResearchImageSettings?.(version)):assertThesisSettings(await config.getAgentSettings?.(version));
 const normalize=(input,user)=>{const projectId=resolveTaskProject(db,input.projectId,user),value=normalizeToolRequest(input);return{...value,projectId,inputHash:projectTaskHash(value.inputHash,projectId)};};
 const own=(id,user)=>{const row=db.prepare('SELECT * FROM tool_runs WHERE id=? AND user_id=?').get(id,user.id);if(!row)fail(404,'科研工具任务不存在');return row;};
 const admission=(user,billingToken,charge)=>{budget.check(user.id,{billingToken,billingType:charge.type,serviceKey:charge.serviceKey});if(db.prepare("SELECT count(*) n FROM jobs WHERE user_id=? AND status IN ('queued','running')").get(user.id).n>=3)fail(429,'账户已有3个待处理任务，请等待完成');if(db.prepare("SELECT count(*) n FROM tool_runs WHERE status IN ('queued','running')").get().n>=50)fail(429,'当前任务较多，请稍后重试');if(db.prepare('SELECT count(*) n FROM tool_runs WHERE user_id=?').get(user.id).n>=1000)fail(409,'任务保存数量达到上限，请导出备份并联系支持整理');};
 async function checkImage(value,runtime){if(value.operation!=='image')return;const status=researchImageGenerationStatus(config,runtime);if(!status.ready)fail(503,status.reason);}
 function checkPresentation(value){if(value.operation!=='ppt')return;const status=presentationGenerationStatus(config);if(!status.ready)fail(503,status.reason);}
 async function capabilities(){
  let textReady=false,imageRuntime;try{await settings();textReady=true;}catch{}try{imageRuntime=await config.getResearchImageSettings?.();}catch{}
  const researchImages=researchImageGenerationStatus(config,imageRuntime);
  return{ready:textReady,textReady,reason:textReady?null:'科研工具生成服务暂不可用，请稍后重试或联系支持',operations:toolOperations,names:toolOperationNames,billingService:'agent',maxCharacters:40000,requiresReview:true,researchImages,presentation:textReady?presentationGenerationStatus(config):{ready:false,reason:'演示生成服务暂不可用'}};
 }
 async function handle({path,method,user,readBody}){
  if(path!=='/api/tool-runs'&&!path.startsWith('/api/tool-runs/'))return null;if(!user?.id)fail(401,'请先登录');const response=(value,status=200)=>({value,status});
  if(path==='/api/tool-runs/capabilities'&&method==='GET')return response(await capabilities());
  if(path==='/api/tool-runs/jobs'&&method==='GET')return response({items:db.prepare('SELECT * FROM tool_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(user.id).map(row=>serializeToolRun(db,row))});
  if(path==='/api/tool-runs/quote'&&method==='POST'){
   const input=await readBody();fields(input,['kind','operation','snapshot','projectId']);const value=normalize(input,user),runtime=await settings(undefined,value);await checkImage(value,runtime);checkPresentation(value);
   return response(thesisTransaction(db,()=>{resolveTaskProject(db,value.projectId,user);const charge=toolBillingIdentity(value),quote=billing.quote(user,charge);admission(user,quote.token,charge);db.prepare('INSERT INTO tool_quotes VALUES(?,?,?,?)').run(quote.token,user.id,value.inputHash,clock());return{...quote,inputHash:value.inputHash,projectId:value.projectId,kind:value.kind,operation:value.operation};}));
  }
  const byKey=path.match(/^\/api\/tool-runs\/jobs\/by-key\/([^/]+)$/);if(byKey&&method==='GET'){const key=commandKey(decodeURIComponent(byKey[1])),row=db.prepare('SELECT * FROM tool_runs WHERE user_id=? AND client_key=?').get(user.id,key);if(!row)fail(404,'科研工具任务不存在');return response({item:serializeToolRun(db,row)});}
  if(path==='/api/tool-runs/jobs'&&method==='POST'){
   const input=await readBody();fields(input,['kind','operation','snapshot','projectId','clientKey','billingToken','consent','resumeFromJobId']);if(input.consent!==true)fail(400,'请确认本次资料处理与费用');commandKey(input.clientKey);const value=normalize(input,user),previous=db.prepare('SELECT * FROM tool_runs WHERE user_id=? AND client_key=?').get(user.id,input.clientKey);
   if(previous){if(previous.input_hash!==value.inputHash)fail(409,'提交标识已用于其他内容');return response({item:serializeToolRun(db,previous)});}
   let resume;if(input.resumeFromJobId!==undefined){resume=own(input.resumeFromJobId,user);if(resume.input_hash!==value.inputHash||!['failed','cancelled'].includes(resume.status))fail(409,'只能从相同输入的失败或取消任务继续');}
   const runtime=await settings(undefined,value);await checkImage(value,runtime);checkPresentation(value);return response(thesisTransaction(db,()=>{
    resolveTaskProject(db,value.projectId,user);const again=db.prepare('SELECT * FROM tool_runs WHERE user_id=? AND client_key=?').get(user.id,input.clientKey);if(again){if(again.input_hash!==value.inputHash)fail(409,'提交标识已用于其他内容');return{item:serializeToolRun(db,again)};}
    const charge=toolBillingIdentity(value);admission(user,input.billingToken,charge);const quote=db.prepare('SELECT * FROM tool_quotes WHERE token=? AND user_id=?').get(typeof input.billingToken==='string'?input.billingToken:'',user.id);if(!quote||quote.input_hash!==value.inputHash)fail(409,'资料与费用确认不一致，请重新确认');
    const json=JSON.stringify(value.snapshot),plan=resume?JSON.parse(resume.plan):toolRunPlan(value),copies=resume?db.prepare('SELECT * FROM tool_checkpoints WHERE run_id=? AND position<2000 ORDER BY position').all(resume.id):[];toolStorageCheck(db,user.id,Buffer.byteLength(json)+50000+copies.reduce((n,c)=>n+Buffer.byteLength(c.output),0),config);const id=randomUUID(),at=clock();
    db.prepare('INSERT INTO jobs(id,user_id,project_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,user.id,value.projectId,'tool_run','queued','queued',JSON.stringify({title:value.snapshot.title,kind:value.kind,operation:value.operation,settingsVersion:runtime.version,billingType:charge.type}),'tool:'+input.clientKey,value.inputHash,at,at);
    db.prepare('INSERT INTO tool_runs(id,user_id,kind,operation,snapshot,input_hash,client_key,settings_version,status,stage,plan,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,user.id,value.kind,value.operation,json,value.inputHash,input.clientKey,runtime.version,'queued','queued',JSON.stringify(plan),at,at);
    for(const c of copies)db.prepare('INSERT INTO tool_checkpoints VALUES(?,?,?,?,?)').run(id,c.unit_id,c.position,c.output,at);
    billing.reserve(user,id,1,charge.type,input.billingToken,charge.serviceKey);return{item:serializeToolRun(db,own(id,user))};
   }),202);
  }
  const match=path.match(/^\/api\/tool-runs\/jobs\/([^/]+)(?:\/(cancel))?$/);if(!match)return null;const row=own(match[1],user);
  if(method==='GET'&&!match[2])return response({item:{...serializeToolRun(db,row),snapshot:JSON.parse(row.snapshot)}});
  if(method!=='POST'||match[2]!=='cancel')fail(405,'不支持的任务操作');fields(await readBody(),[]);
  if(['queued','running'].includes(row.status)){thesisTransaction(db,()=>{db.prepare("UPDATE tool_runs SET status='cancelled',stage='cancelled',error='已停止，预占权益已释放，已完成单元保留',updated_at=? WHERE id=? AND status IN ('queued','running')").run(clock(),row.id);db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled',error='已停止，预占权益已释放',updated_at=? WHERE id=? AND status IN ('queued','running')").run(clock(),row.id);billing.release(row.id);});config.cancelToolRun?.(row.id);}
  return response({item:serializeToolRun(db,own(row.id,user))});
 }
 return{handle,capabilities,get:(id,user)=>serializeToolRun(db,own(id,user))};
}
