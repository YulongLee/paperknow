const aiTypes=Object.freeze(['polish','review','agent','thesis','thesis_outline','thesis_method','writing','tool_run']);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const limit=(value,fallback,max)=>Number.isSafeInteger(value)&&value>=1&&value<=max?value:fallback;

export function modelLimits(config={}){
 return {userDailyLimit:limit(config.aiUserDailyLimit,30,500),globalDailyLimit:limit(config.aiGlobalDailyLimit,300,10000)};
}

// Free/trial usage has a daily allowance. Server-verified paid quotes and held
// reservations use their own credit/entitlement and execution budgets instead.
// Every dispatched attempt remains in the immutable provider audit ledger.
// Call check and the queue insert, or start and the job claim, in one caller-owned
// BEGIN IMMEDIATE transaction so separate connections cannot admit excess work.
export function createModelBudget(db,config={}){
 db.exec(`CREATE TABLE IF NOT EXISTS model_attempts(
 job_id TEXT NOT NULL REFERENCES jobs(id),attempt INTEGER NOT NULL CHECK(attempt>=1),
 user_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 PRIMARY KEY(job_id,attempt)
 );
 CREATE INDEX IF NOT EXISTS model_attempts_day ON model_attempts(created_at,user_id);
 CREATE INDEX IF NOT EXISTS model_attempts_owner_day ON model_attempts(user_id,created_at);
 CREATE TRIGGER IF NOT EXISTS model_attempts_no_update BEFORE UPDATE ON model_attempts
 BEGIN SELECT RAISE(ABORT,'模型调用记录不可修改'); END;
 CREATE TRIGGER IF NOT EXISTS model_attempts_no_delete BEFORE DELETE ON model_attempts
 BEGIN SELECT RAISE(ABORT,'模型调用记录不可删除'); END;`);
 const limits=modelLimits(config);
 function day(){
  const value=config.modelBudgetNow?.()??new Date(),date=value instanceof Date?value:new Date(value),ms=date.getTime();
  if(!Number.isFinite(ms))throw new Error('模型预算时间无效');
  // Asia/Shanghai natural day. Queue reservations carry forward across midnight.
  const start=Math.floor((ms+8*3600000)/86400000)*86400000-8*3600000;
  return {now:date.toISOString(),start:new Date(start).toISOString(),end:new Date(start+86400000).toISOString()};
 }
 function userIdValid(userId){if(typeof userId!=='string'||!userId.trim())fail(400,'账户标识无效');}
 const hasTable=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
 const billingTypeForJob=type=>['thesis','thesis_outline','thesis_method','writing','tool_run'].includes(type)?'agent':type;
 const paidSource=row=>row?.source==='credits'?Number.isSafeInteger(row.credits)&&row.credits>0:['membership','bundle'].includes(row?.source)&&row.credits===0;
 function paidQuote(userId,{billingToken,billingType,serviceKey}={},window=day()){
  if(typeof billingToken!=='string'||!billingToken||billingToken.length>200||!['polish','review','agent'].includes(billingType)||serviceKey!==undefined&&serviceKey!==null&&(typeof serviceKey!=='string'||!serviceKey||serviceKey.length>160)||!hasTable('billing_quotes'))return false;
  const columns=new Set(db.prepare('PRAGMA table_info(billing_quotes)').all().map(row=>row.name));
  if(!columns.has('service_key')&&serviceKey!==undefined&&serviceKey!==null)return false;
  const row=db.prepare('SELECT *, '+(columns.has('service_key')?'service_key':'NULL')+' AS scoped_service_key FROM billing_quotes WHERE token=? AND user_id=? AND type=? AND used=0').get(billingToken,userId,billingType);
  return Boolean(row&&paidSource(row)&&(row.scoped_service_key??null)===(serviceKey??null)&&Number.isFinite(Date.parse(row.expires_at))&&Date.parse(row.expires_at)>Date.parse(window.now));
 }
 function heldPaidReservation(job,attempt){
  if(!hasTable('billing_reservations'))return false;
  const row=db.prepare("SELECT source,credits FROM billing_reservations WHERE job_id=? AND attempt=? AND user_id=? AND type=? AND status='held'").get(job.id,attempt,job.user_id,billingTypeForJob(job.type));
  return paidSource(row);
 }
 function counts(userId,{includeQueued=true,excludeJobId=null}={},window=day()){
  const reservations=hasTable('billing_reservations'),paidCondition="((r.source='credits' AND r.credits>0) OR (r.source IN ('membership','bundle') AND r.credits=0))",typeCondition="r.type=CASE WHEN j.type IN ('thesis','thesis_outline','thesis_method','writing','tool_run') THEN 'agent' ELSE j.type END";
  // Historical paid failures remain funded attempts for audit purposes even
  // after their refundable reservation is released; they never consume trial use.
  const unpaidAttempt=reservations?" AND NOT EXISTS(SELECT 1 FROM billing_reservations r WHERE r.job_id=a.job_id AND r.attempt=a.attempt AND r.user_id=a.user_id AND "+typeCondition+" AND r.status IN ('held','settled','released') AND "+paidCondition+")":'';
  const used=db.prepare('SELECT count(*) n FROM model_attempts a JOIN jobs j ON j.id=a.job_id WHERE a.created_at>=? AND a.created_at<? AND a.user_id=?'+unpaidAttempt).get(window.start,window.end,userId).n;
  const globalUsed=db.prepare('SELECT count(*) n FROM model_attempts a JOIN jobs j ON j.id=a.job_id WHERE a.created_at>=? AND a.created_at<?'+unpaidAttempt).get(window.start,window.end).n;
  let queued=0,globalQueued=0;
  if(includeQueued){
   // Continuous thesis maintenance resumes the already audited attempt. Only
   // its recovery queue and exact owner/attempt audit may reuse the held funding.
   const queuedAttempt="(r.attempt=j.attempt+1 OR (j.type='thesis' AND j.stage='auto_recovering' AND r.attempt=j.attempt AND EXISTS(SELECT 1 FROM model_attempts a WHERE a.job_id=j.id AND a.attempt=j.attempt AND a.user_id=j.user_id)))";
   const unpaidQueue=reservations?" AND NOT EXISTS(SELECT 1 FROM billing_reservations r WHERE r.job_id=j.id AND "+queuedAttempt+" AND r.user_id=j.user_id AND "+typeCondition+" AND r.status='held' AND "+paidCondition+")":'';
   const pending=" FROM jobs j WHERE j.status='queued' AND j.type IN ('polish','review','agent','thesis','thesis_outline','thesis_method','writing','tool_run') AND (? IS NULL OR j.id!=?)";
   queued=db.prepare('SELECT count(*) n'+pending+' AND j.user_id=?'+unpaidQueue).get(excludeJobId,excludeJobId,userId).n;
   globalQueued=db.prepare('SELECT count(*) n'+pending+unpaidQueue).get(excludeJobId,excludeJobId).n;
  }
  return {used,queued,globalUsed,globalQueued};
 }
 function check(userId,options={}){
  userIdValid(userId);const window=day(),value=counts(userId,options,window);
  if(paidQuote(userId,options,window))return {used:value.used,queued:value.queued,limit:null,remaining:null,paid:true};
  if(value.used+value.queued>=limits.userDailyLimit)fail(429,'今日 AI 任务额度已用完，请明日再试');
  if(value.globalUsed+value.globalQueued>=limits.globalDailyLimit)fail(429,'模型服务当前繁忙，请稍后再试');
  return {used:value.used,queued:value.queued,limit:limits.userDailyLimit,remaining:Math.max(0,limits.userDailyLimit-value.used-value.queued)};
 }
 function start(jobId,attempt){
  if(typeof jobId!=='string'||!jobId||!Number.isSafeInteger(attempt)||attempt<1)fail(400,'模型任务或执行次数无效');
  const job=db.prepare('SELECT id,user_id,type,status,attempt FROM jobs WHERE id=?').get(jobId);
  if(!job)fail(404,'模型任务不存在');
  if(!aiTypes.includes(job.type))fail(400,'该任务不调用模型');
  const existing=db.prepare('SELECT job_id AS jobId,attempt,user_id AS userId,created_at AS createdAt FROM model_attempts WHERE job_id=? AND attempt=?').get(jobId,attempt);
  if(existing){if(existing.userId!==job.user_id)fail(409,'模型调用记录与任务不一致');return {...existing};}
  if(job.status!=='running'||job.attempt!==attempt)fail(409,'模型任务执行状态已变化');
  if(!heldPaidReservation(job,attempt))check(job.user_id,{excludeJobId:job.id});
  const createdAt=day().now;
  db.prepare('INSERT INTO model_attempts(job_id,attempt,user_id,created_at) VALUES(?,?,?,?)').run(job.id,attempt,job.user_id,createdAt);
  return {jobId:job.id,attempt,userId:job.user_id,createdAt};
 }
 function summary(userId){
  userIdValid(userId);const {used,queued}=counts(userId);
  return {used,queued,limit:limits.userDailyLimit,remaining:Math.max(0,limits.userDailyLimit-used-queued)};
 }
 return {check,start,summary};
}
