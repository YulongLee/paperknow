import {attachCombinedChild,reconcileCombinedParents} from './combined-detection-ledger.mjs';
import {v1CommercialEnabled} from './v1-commercial-policy.mjs';
import {concurrentDetection,detectionSlots} from './detection-concurrency.mjs';
import {aigcInputHash} from './aigc-input-hash.mjs';
import {AIGC_PARAGRAPH_VERSION,MAX_AIGC_PARTS} from '../dist/reports/aigc-partitions.mjs';
import {createAigcReportArchive,aigcReportStorageReady} from './aigc-detection-report.mjs';
import {randomUUID} from 'node:crypto';
import {createAigcDetectionClient,aigcDetectionConfigured,aigcDetectionDefaults,aigcDetectionLimits,aigcDetectionError,prepareAigcText} from './aigc-detection-client.mjs';
import {detectionEntryReady,detectionPricing,assertDetectionPrice,reserveDetection,includedDetectionHeld,detectionTrialUsage} from './detection-entitlements.mjs';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validId=value=>typeof value==='string'&&/^[-A-Za-z0-9_]{1,120}$/.test(value);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const notice='本报告按本次分段标签统计疑似 AI 片段占比，分段置信分不代表 AI 字数占比；不能替代学校指定的检测报告。';
export function initializeAigcDetectionSchema(db){
 db.exec(`CREATE TABLE IF NOT EXISTS aigc_detections(
  id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),characters INTEGER NOT NULL,
  part_count INTEGER NOT NULL,reserved_calls INTEGER NOT NULL,reserved_billing_units INTEGER NOT NULL,
  attempted_parts INTEGER NOT NULL DEFAULT 0,completed_parts INTEGER NOT NULL DEFAULT 0,
  parts TEXT NOT NULL,request_ids TEXT NOT NULL DEFAULT '[]',error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
  UNIQUE(user_id,input_hash)
 );CREATE INDEX IF NOT EXISTS aigc_detection_owner ON aigc_detections(user_id,created_at);
 CREATE TABLE IF NOT EXISTS aigc_detection_requests(
  user_id TEXT NOT NULL REFERENCES users(id),idempotency_key TEXT NOT NULL,
  detection_id TEXT NOT NULL REFERENCES aigc_detections(id),input_hash TEXT NOT NULL,
  PRIMARY KEY(user_id,idempotency_key)
 );`);
 for(const [name,type]of [['title',"TEXT NOT NULL DEFAULT '送检论文'"],['input_artifact_id','TEXT'],['html_artifact_id','TEXT'],['report_error','TEXT'],['partition_version',"TEXT NOT NULL DEFAULT 'length-v1'"]])if(!db.prepare('PRAGMA table_info(aigc_detections)').all().some(row=>row.name===name))db.exec('ALTER TABLE aigc_detections ADD COLUMN '+name+' '+type);
 if(!db.prepare('PRAGMA table_info(aigc_detections)').all().some(row=>row.name==='billing_job_id'))db.exec('ALTER TABLE aigc_detections ADD COLUMN billing_job_id TEXT'+(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").get()?' REFERENCES jobs(id)':''));
}
export function aigcDetectionCapabilities(config={}){
 const ready=aigcDetectionConfigured(config)&&detectionEntryReady(config.billing,'detection-aigc'),limits=aigcDetectionLimits(config)||aigcDetectionDefaults;
 return{ready,maxCharacters:limits.maxCharacters,maxPartCharacters:limits.maxPartCharacters,maxCalls:MAX_AIGC_PARTS,maxParagraphs:limits.maxParagraphs,paragraphAnalysis:true,userDailyLimit:limits.userDailyLimit,userDailyCharacters:limits.userDailyCharacters,consentRequired:false,...detectionPricing(config.billing,'detection-aigc'),bundleUsageSupported:Boolean(config.billing),reason:ready?'':'文本鉴别暂未开放，请稍后再试。'};
}
export function createAigcDetectionService(db,config={}, {client}={}){
 initializeAigcDetectionSchema(db);
 const cloud=client||config.aigcDetectionClient||createAigcDetectionClient(config),limits=aigcDetectionLimits(config)||aigcDetectionDefaults,pending=new Set();
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 const atomic=fn=>db.isTransaction?fn():transaction(fn);
 const billing=config.billing,withDetectorSlot=detectionSlots(limits.maxConcurrent);
 const own=(id,user)=>{const row=db.prepare('SELECT * FROM aigc_detections WHERE id=? AND user_id=?').get(id,user.id);if(!row)fail(404,'文本鉴别记录不存在');return row;};
 const summarize=(row,cached=false)=>{
  const parts=JSON.parse(row.parts),counts={aigc:0,ugc:0,undetermined:0};for(const part of parts)if(part.skipped!==true)counts[part.label||'undetermined']++;
  const complete=row.status==='completed',verdict=!complete||counts.undetermined||!counts.aigc&&!counts.ugc?'undetermined':counts.aigc&&counts.ugc?'mixed':counts.aigc?'aigc':'ugc';
  return{id:row.id,analysisVersion:row.partition_version||'length-v1',title:row.title||'送检论文',reportAvailable:Boolean(row.input_artifact_id),reportReady:Boolean(row.html_artifact_id),...(row.report_error?{reportError:row.report_error}:{}),status:row.status,characters:row.characters,partCount:row.part_count,completedParts:row.completed_parts,parts,counts,verdict,conclusive:complete&&verdict!=='undetermined',...(row.error?{error:row.error}:{}),createdAt:row.created_at,updatedAt:row.updated_at,notice,...(cached?{cached:true}:{})};
 };
 const archive=createAigcReportArchive(db,config,row=>summarize(row));
 function finish(id,status,{message,requestIds}={}){return atomic(()=>{
  const row=db.prepare('SELECT status,billing_job_id FROM aigc_detections WHERE id=?').get(id);if(!row||row.status!=='running')return false;
  const at=new Date().toISOString();
  db.prepare("UPDATE aigc_detections SET status=?,error=?,request_ids=COALESCE(?,request_ids),updated_at=? WHERE id=? AND status='running'").run(status,message||null,requestIds?JSON.stringify(requestIds):null,at,id);
  if(row.billing_job_id){db.prepare("UPDATE jobs SET status=?,stage=?,error=?,updated_at=? WHERE id=? AND status='running'").run(status,status,message||null,at,row.billing_job_id);if(status==='completed')billing?.settle(row.billing_job_id);else billing?.release(row.billing_job_id);}
  reconcileCombinedParents(db,billing,id);
  return true;
 });}
 function expireStale(){const before=new Date(Date.now()-120000).toISOString();for(const row of db.prepare("SELECT id FROM aigc_detections WHERE status='running' AND updated_at<?").all(before))finish(row.id,'failed',{message:'此文本鉴别未完成确认，为避免重复调用不会自动重新提交，请联系支持。'});}
 // A service restart cannot replay a request whose upstream outcome is unknown.
 // Only new metered rows have mirrors; historical detection records are untouched.
 if(billing)for(const row of db.prepare("SELECT id FROM aigc_detections WHERE status='running' AND billing_job_id IS NOT NULL").all())finish(row.id,'failed',{message:'服务切换中断了本次鉴别，套餐预占次数已释放；不会自动重复提交。'});
 async function process(id,prepared,text){
  const started=Date.now(),parts=prepared.parts.map(({content,...part})=>({...part,...(part.effectiveCharacters===0?{skipped:true,skipReason:content.trim()?'non_text':'whitespace'}:{}),label:'undetermined',confidence:null})),requestIds=[];let stopped=false;
  try{
   await archive.storeInput(id,text);
   await concurrentDetection(prepared.parts,limits.maxConcurrent,async part=>withDetectorSlot(async()=>{
    if(stopped||db.isOpen===false)return;
    try{
    const funding=db.prepare('SELECT status,billing_job_id,user_id FROM aigc_detections WHERE id=?').get(id);if(funding?.status!=='running')return;if(funding.billing_job_id&&!includedDetectionHeld(db,funding.user_id,id,'detection-aigc'))throw aigcDetectionError('detection_hold_missing',409,'本次检测费用预占已失效，未继续调用检测。');
    if(part.effectiveCharacters===0){db.prepare('UPDATE aigc_detections SET completed_parts=completed_parts+1,updated_at=? WHERE id=?').run(new Date().toISOString(),id);return;}
    const remainingMs=limits.totalTimeoutMs-(Date.now()-started);if(remainingMs<=0)throw aigcDetectionError('aigc_detection_timeout',504,'本次文本鉴别暂未完成，已保留记录，不会自动重复提交。');
    // Mark attempted before the potentially billed call. A timeout or a missing
    // business verdict never releases the provider-side operational allowance.
    db.prepare('UPDATE aigc_detections SET attempted_parts=attempted_parts+1,updated_at=? WHERE id=?').run(new Date().toISOString(),id);
    const result=await cloud.detect(part.content,{remainingMs,dataId:'pk-'+id+'-'+part.index});
    if(db.isOpen===false)return;
    if(!plain(result)||!['aigc','ugc','undetermined'].includes(result.label)||result.label!=='undetermined'&&(!Number.isFinite(result.confidence)||result.confidence<0||result.confidence>100))throw aigcDetectionError('aigc_detection_unavailable',503,'文本鉴别暂未完成，已保留处理记录，不会自动重复提交。');
    parts[part.index]={...parts[part.index],label:result.label,confidence:result.label==='undetermined'?null:result.confidence};
    if(typeof result.requestId==='string'&&/^[-A-Za-z0-9_.]{1,150}$/.test(result.requestId))requestIds.push(result.requestId);
    db.prepare("UPDATE aigc_detections SET completed_parts=completed_parts+1,parts=?,request_ids=?,updated_at=? WHERE id=? AND status='running'").run(JSON.stringify(parts),JSON.stringify(requestIds),new Date().toISOString(),id);
    if(result.label==='undetermined')throw aigcDetectionError('aigc_detection_inconclusive',502,'部分正文未取得有效鉴别结论，已保留分段记录，本次未结算。');
    }catch(error){stopped=true;throw error;}
    }));
   if(prepared.parts.some(part=>part.effectiveCharacters>0&&parts[part.index].label==='undetermined'))throw aigcDetectionError('aigc_detection_inconclusive',502,'部分正文未取得有效鉴别结论，已保留分段记录，本次未结算。');
   if(db.isOpen!==false&&finish(id,'completed')&&aigcReportStorageReady(config)){try{await archive.report(id);}catch{/* The original remains in OSS. Report reads repair publication without another detector call. */}}
  }catch(error){
   const safe=error?.aigcDetectionSafe?error:aigcDetectionError('aigc_detection_unavailable',503,'文本鉴别暂未完成，已保留处理记录，不会自动重复提交。');
   if(typeof safe.aigcRequestId==='string'&&/^[-A-Za-z0-9_.]{1,150}$/.test(safe.aigcRequestId))requestIds.push(safe.aigcRequestId);
   if(db.isOpen!==false)finish(id,'failed',{message:safe.message,requestIds});
  }
 }
 return{capabilities:()=>{const cap=aigcDetectionCapabilities(config),ready=cap.ready&&cloud.ready!==false&&typeof cloud.detect==='function';return{...cap,maxCharacters:v1CommercialEnabled(db)?Math.min(cap.maxCharacters,20000):cap.maxCharacters,ready,reason:ready?'':'文本鉴别暂未开放，请稍后再试。'};},waitForIdle:()=>Promise.allSettled([...pending]),async handle({path,method,user,fundingParent=null,readBody}){
  const item=path.match(/^\/api\/aigc-detections\/([-A-Za-z0-9_]{1,120})(\/(?:cancel|report))?$/);
  if(path!=='/api/aigc-detections'&&!item)return null;
  if(!validId(user?.id))fail(401,'请先登录后使用文本鉴别');
  if(item){
   if(item[2]==='/report'){if(method!=='GET')fail(405,'不支持的检测报告操作');const row=own(item[1],user);if(!row.input_artifact_id)fail(404,'此历史记录未保存原文，仅可查看已有分段结果。');if(!aigcReportStorageReady(config))fail(503,'检测报告存储暂不可用，请稍后读取原报告。');return{value:await archive.report(row.id)};}
   if(item[2]){if(method!=='POST')fail(405,'不支持的文本鉴别操作');const input=await readBody();if(!plain(input)||Object.keys(input).some(key=>key!=='expectedUserId')||input.expectedUserId!==user.id)fail(409,'登录账户已变化，请刷新后操作');const row=own(item[1],user);if(row.status!=='running')fail(409,'本次鉴别已经结束');atomic(()=>{finish(row.id,'failed',{message:'已取消本次鉴别，套餐预占次数已释放。'});if(row.billing_job_id)db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled' WHERE id=?").run(row.billing_job_id);});return{value:summarize(own(row.id,user))};}
   if(method!=='GET')fail(405,'不支持的文本鉴别操作');expireStale();return{value:summarize(own(item[1],user))};
  }
  if(method==='GET'){expireStale();return{value:{items:db.prepare('SELECT * FROM aigc_detections WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 10').all(user.id).map(row=>summarize(row))}};}
  if(method!=='POST')fail(405,'不支持的文本鉴别操作');
  const input=await readBody();
  if(!plain(input)||Object.keys(input).some(key=>!['text','title','consent','expectedUserId','idempotencyKey','pricingVersion','expectedCreditCost'].includes(key)))fail(400,'文本鉴别请求包含不支持的内容');
  if(input.expectedUserId!==user.id)fail(409,'登录账户已变化，请刷新后重新确认提交');
  if(input.consent!==true)fail(400,'请确认将本次文本发送至云端鉴别服务');
  if(typeof input.idempotencyKey!=='string'||!/^[-A-Za-z0-9_]{8,100}$/.test(input.idempotencyKey))fail(400,'文本鉴别请求编号无效');
  if(input.title!==undefined&&(typeof input.title!=='string'||input.title.length>200||/[\u0000-\u001f\u007f]/.test(input.title)))fail(400,'论文标题格式无效，请使用 200 字以内的标题');
  const prepared=prepareAigcText(input.text,limits),hash=aigcInputHash(input.text,AIGC_PARAGRAPH_VERSION);
  const admission=transaction(()=>{
   expireStale();
   const alias=db.prepare('SELECT * FROM aigc_detection_requests WHERE user_id=? AND idempotency_key=?').get(user.id,input.idempotencyKey);
   if(alias){if(alias.input_hash!==hash&&alias.input_hash!==aigcInputHash(input.text,'length-v1'))fail(409,'此请求编号已用于其他文本，请重新确认提交');return{row:own(alias.detection_id,user),cached:true};}
   const prior=db.prepare('SELECT * FROM aigc_detections WHERE user_id=? AND input_hash=?').get(user.id,hash);
   if(prior){db.prepare('INSERT INTO aigc_detection_requests VALUES(?,?,?,?)').run(user.id,input.idempotencyKey,prior.id,hash);return{row:prior,cached:true};}
   if(v1CommercialEnabled(db)&&Array.from(input.text||'').length>20000)fail(400,'单次检测最多 20,000 字符，请分章节提交；尚未扣费。');
   assertDetectionPrice(input,billing,'detection-aigc');
   if(!aigcDetectionConfigured(config)||cloud.ready===false||typeof cloud.detect!=='function')fail(503,'文本鉴别暂未开放，请稍后再试。');
   if(db.prepare("SELECT count(*) n FROM aigc_detections WHERE user_id=? AND status='running'").get(user.id).n)fail(409,'已有文本正在鉴别，请等待完成后再提交');
   if(db.prepare("SELECT count(*) n FROM aigc_detections WHERE status='running'").get().n>=limits.maxConcurrent)fail(429,'文本鉴别当前繁忙，请稍后再试');
   const id=randomUUID(),created=new Date().toISOString(),parts=prepared.parts.map(({content,...part})=>({...part,...(part.effectiveCharacters===0?{skipped:true,skipReason:content.trim()?'non_text':'whitespace'}:{}),label:'undetermined',confidence:null}));
   db.prepare("INSERT INTO aigc_detections(id,user_id,input_hash,status,characters,part_count,reserved_calls,reserved_billing_units,parts,created_at,updated_at) VALUES(?,?,?,'running',?,?,?,?,?,?,?)").run(id,user.id,hash,prepared.characters,parts.length,prepared.calls,prepared.billingUnits,JSON.stringify(parts),created,created);
   db.prepare('UPDATE aigc_detections SET title=?,partition_version=? WHERE id=?').run(input.title?.trim()||'送检论文',AIGC_PARAGRAPH_VERSION,id);
   db.prepare('INSERT INTO aigc_detection_requests VALUES(?,?,?,?)').run(user.id,input.idempotencyKey,id,hash);
   if(fundingParent){db.prepare("INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,attempt,created_at,updated_at) VALUES(?,?,'aigc_detection','running','detecting','{}',?,?,1,?,?)").run(id,user.id,'aigc:'+id,hash,created,created);db.prepare('UPDATE aigc_detections SET billing_job_id=? WHERE id=?').run(id,id);attachCombinedChild(db,{parentId:fundingParent,userId:user.id,childId:id,key:'detection-aigc',text:input.text});}else reserveDetection(billing,user,id,'detection-aigc',{createJob:()=>{
    db.prepare("INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,attempt,created_at,updated_at) VALUES(?,?,'aigc_detection','running','detecting','{}',?,?,1,?,?)").run(id,user.id,'aigc:'+id,hash,created,created);
    db.prepare('UPDATE aigc_detections SET billing_job_id=? WHERE id=?').run(id,id);
   }});
   if(!includedDetectionHeld(db,user.id,id,'detection-aigc')){
    const today=new Date();today.setUTCHours(0,0,0,0);const window={since:today.toISOString(),until:new Date(today.getTime()+86400000).toISOString(),excludeId:id};
    const userBudget=detectionTrialUsage(db,'detection-aigc',{...window,userId:user.id});
    if(userBudget.n>=limits.userDailyLimit||userBudget.characters+prepared.characters>limits.userDailyCharacters)fail(429,'今日文本鉴别额度已用完，请明天再试');
    const budget=detectionTrialUsage(db,'detection-aigc',window);
    if(budget.calls+prepared.calls>limits.globalDailyCalls||budget.billingUnits+prepared.billingUnits>limits.globalDailyBillingUnits)fail(429,'文本鉴别今日额度已用完，请稍后再试');
   }
   return{row:own(id,user),cached:false};
  });
  if(fundingParent&&admission.cached)transaction(()=>attachCombinedChild(db,{parentId:fundingParent,userId:user.id,childId:admission.row.id,key:'detection-aigc',text:input.text}));
  if(admission.cached)return{value:summarize(admission.row,true)};
  // The private original is a report artifact, never a replayable paid queue.
  // A restart cannot repeat a detector call whose upstream outcome is unknown.
  const task=process(admission.row.id,prepared,input.text);pending.add(task);task.finally(()=>pending.delete(task));
  return{status:202,value:summarize(admission.row)};
 }};
}
