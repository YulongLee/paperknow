import {v1CommercialEnabled} from './v1-commercial-policy.mjs';
import {randomUUID} from 'node:crypto';
import {resolveTaskProject,projectTaskHash,taskProjectId} from './task-project-context.mjs';
import {createBillingService} from './billing-service.mjs';
import {createModelBudget} from './model-budget.mjs';
import {initializeThesisSchema,thesisHash,thesisError,thesisTransaction,assertThesisAccountQuota} from './thesis-model.mjs';
import {assertThesisSettings} from './thesis-service.mjs';
import {normalizeThesisOutlineSnapshot,thesisOutlineTask} from './thesis-outline-model.mjs';

const fail=(status,message)=>{throw thesisError(status,message);};
const active=status=>['queued','running'].includes(status);
const clientKey=value=>{if(typeof value!=='string'||value.length<8||value.length>100||!value.trim()||/[\u0000-\u001f\u007f]/.test(value))fail(400,'请提供 8～100 字符的唯一提交标识');return value;};
export function serializeThesisOutline(row,db){return {id:row.id,projectId:db?taskProjectId(db,row):row.project_id??null,userId:row.user_id,title:JSON.parse(row.snapshot).title,inputHash:row.input_hash,status:row.status,stage:row.stage,error:row.error,output:row.output?JSON.parse(row.output):null,resultId:row.result_id,model:JSON.parse(row.settings_meta).model,settingsVersion:row.settings_version,usage:{input:row.usage_known?row.input_tokens:null,output:row.usage_known?row.output_tokens:null,incomplete:!row.usage_known},createdAt:row.created_at,updatedAt:row.updated_at,billingService:'agent',billingServiceKey:v1CommercialEnabled(db)?'writing-planning':null,requiresReview:true};}
export function createThesisOutlineService(db,config={}){
 initializeThesisSchema(db);
 const billing=config.billing||createBillingService(db,config),modelBudget=config.modelBudget||createModelBudget(db,config),clock=()=>new Date(config.thesisNow?.()??Date.now()).toISOString();
 const own=(id,user)=>{if(!user?.id)fail(401,'请先登录');const row=db.prepare('SELECT * FROM thesis_outline_runs WHERE id=? AND user_id=?').get(id,user.id);if(!row)fail(404,'提纲任务不存在');return row;};
 const settings=async version=>assertThesisSettings(await config.getAgentSettings?.(version));
 async function capabilities(){try{await settings();return{ready:true,reason:'',billingService:'agent',billingServiceKey:v1CommercialEnabled(db)?'writing-planning':null,requiresEvidenceConfirmation:false};}catch(error){return{ready:false,reason:error.message.replace(/毕业论文生成/g,'AI 提纲生成'),billingService:'agent',billingServiceKey:v1CommercialEnabled(db)?'writing-planning':null,requiresEvidenceConfirmation:false};}}
 function admission(user,billingToken){const budget=modelBudget.check(user.id,{billingToken,billingType:'agent',serviceKey:v1CommercialEnabled(db)?'writing-planning':null});if(db.prepare("SELECT count(*) n FROM jobs WHERE user_id=? AND status IN ('queued','running')").get(user.id).n>=3)fail(429,'当前账户已有 3 个待处理任务，请先等待完成');if(db.prepare("SELECT count(*) n FROM thesis_outline_runs WHERE status IN ('queued','running')").get().n>=50)fail(429,'提纲生成队列较忙，请稍后再试');if(db.prepare('SELECT count(*) n FROM thesis_outline_runs WHERE user_id=?').get(user.id).n>=1000)fail(409,'账户提纲任务已达到保存上限，请导出备份并联系支持整理');const since=new Date(Date.parse(clock())-86400000).toISOString();if(budget?.paid!==true&&db.prepare("SELECT count(*) n FROM thesis_outline_runs m WHERE m.user_id=? AND m.created_at>=? AND NOT EXISTS(SELECT 1 FROM billing_reservations r WHERE r.job_id=m.id AND r.user_id=m.user_id AND r.type='agent' AND r.attempt=1 AND r.status IN ('held','settled','released') AND ((r.source='credits' AND r.credits>0) OR (r.source IN ('membership','bundle') AND r.credits=0)))").get(user.id,since).n>=(config.thesisOutlineUserDailyLimit||20))fail(429,'今日提纲生成提交次数已用完，请稍后再试');}
 async function handle({path,method,user,readBody}){
  if(path!=='/api/theses/outlines'&&!path.startsWith('/api/theses/outlines/'))return null;
  if(!user?.id)fail(401,'请先登录');const response=(value,status=200)=>({value,status});
  if(path==='/api/theses/outlines/capabilities'&&method==='GET')return response(await capabilities());
  const byKey=path.match(/^\/api\/theses\/outlines\/by-key\/([^/]+)$/);
  if(byKey){if(method!=='GET')fail(405,'提交标识仅支持查询');let key;try{key=decodeURIComponent(byKey[1]);}catch{fail(400,'提交标识无效');}clientKey(key);const row=db.prepare('SELECT * FROM thesis_outline_runs WHERE user_id=? AND client_key=?').get(user.id,key);if(!row)fail(404,'提纲任务不存在');return response({item:serializeThesisOutline(row,db)});}
  if(path==='/api/theses/outlines'){
   if(method!=='POST')fail(405,'不支持的提纲操作');
   const input=await readBody();if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['snapshot','projectId','clientKey','billingToken','consent'].includes(key)))fail(400,'提纲提交包含不支持的字段');
   if(input.consent!==true)fail(400,'请先确认本次 AI 提纲生成与权益或积分费用');
   clientKey(input.clientKey);
   const projectId=resolveTaskProject(db,input.projectId,user),snapshot=normalizeThesisOutlineSnapshot(input.snapshot,config),hash=projectTaskHash(thesisHash(snapshot),projectId),existing=()=>db.prepare('SELECT * FROM thesis_outline_runs WHERE user_id=? AND client_key=?').get(user.id,input.clientKey);
   const old=existing();if(old){if(old.input_hash!==hash)fail(409,'此提交标识已用于其他提纲内容');return response({item:serializeThesisOutline(old,db)});}
   const task=thesisOutlineTask(snapshot);if(JSON.stringify(task.context).length>35000)fail(400,'提纲要求和参考文献信息过长，请精简后再生成');
   const runtime=await settings();
   return response(thesisTransaction(db,()=>{resolveTaskProject(db,projectId,user);const repeated=existing();if(repeated){if(repeated.input_hash!==hash)fail(409,'此提交标识已用于其他提纲内容');return{item:serializeThesisOutline(repeated,db)};}admission(user,input.billingToken);const json=JSON.stringify(snapshot);assertThesisAccountQuota(db,user.id,Math.max(512,Buffer.byteLength(json))+512,config);const id=randomUUID(),at=clock(),meta={model:String(runtime.model),engine:String(runtime.engine||'claude-agent-sdk'),version:runtime.version};
    db.prepare('INSERT INTO jobs(id,user_id,project_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,user.id,projectId,'thesis_outline','queued','queued',JSON.stringify({title:snapshot.title,settingsVersion:runtime.version}),`thesis-outline:${input.clientKey}`,hash,at,at);
    db.prepare('INSERT INTO thesis_outline_runs(id,user_id,snapshot,input_hash,client_key,settings_version,settings_meta,status,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,user.id,json,hash,input.clientKey,runtime.version,JSON.stringify(meta),'queued','queued',at,at);
    billing.reserve(user,id,1,'agent',input.billingToken,v1CommercialEnabled(db)?'writing-planning':null);return{item:serializeThesisOutline(own(id,user),db)};}),202);
  }
  const match=path.match(/^\/api\/theses\/outlines\/([^/]+)(?:\/(cancel))?$/);if(!match)return null;
  const row=own(match[1],user);if(method==='GET'&&!match[2])return response({item:serializeThesisOutline(row,db)});
  if(method!=='POST'||match[2]!=='cancel')fail(405,'不支持的提纲操作');const input=await readBody();if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)fail(400,'取消提纲任务不需要附加字段');
  if(active(row.status)){thesisTransaction(db,()=>{db.prepare("UPDATE thesis_outline_runs SET status='cancelled',stage='cancelled',error='已取消提纲生成，预占权益已释放',updated_at=? WHERE id=? AND status IN ('queued','running')").run(clock(),row.id);db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled',error='已取消提纲生成，预占权益已释放',updated_at=? WHERE id=? AND status IN ('queued','running')").run(clock(),row.id);billing.release(row.id);});config.cancelThesisOutline?.(row.id);}
  return response({item:serializeThesisOutline(own(row.id,user),db)});
 }
 return{handle,capabilities,get:(id,user)=>serializeThesisOutline(own(id,user),db)};
}
