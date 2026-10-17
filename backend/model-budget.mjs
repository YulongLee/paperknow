const aiTypes=Object.freeze(['polish','review','agent','thesis','thesis_outline','thesis_method','writing']);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const limit=(value,fallback,max)=>Number.isSafeInteger(value)&&value>=1&&value<=max?value:fallback;

export function modelLimits(config={}){
 return {userDailyLimit:limit(config.aiUserDailyLimit,30,500),globalDailyLimit:limit(config.aiGlobalDailyLimit,300,10000)};
}

// This is a provider-cost ceiling, separate from the user's refundable task charge.
// A dispatched attempt stays counted even when it subsequently fails or is cancelled.
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
 function counts(userId,{includeQueued=true,excludeJobId=null}={},window=day()){
  const used=db.prepare('SELECT count(*) n FROM model_attempts WHERE created_at>=? AND created_at<? AND user_id=?').get(window.start,window.end,userId).n;
  const globalUsed=db.prepare('SELECT count(*) n FROM model_attempts WHERE created_at>=? AND created_at<?').get(window.start,window.end).n;
  let queued=0,globalQueued=0;
  if(includeQueued){
   queued=db.prepare("SELECT count(*) n FROM jobs WHERE status='queued' AND type IN ('polish','review','agent','thesis','thesis_outline','thesis_method','writing') AND user_id=? AND (? IS NULL OR id!=?)").get(userId,excludeJobId,excludeJobId).n;
   globalQueued=db.prepare("SELECT count(*) n FROM jobs WHERE status='queued' AND type IN ('polish','review','agent','thesis','thesis_outline','thesis_method','writing') AND (? IS NULL OR id!=?)").get(excludeJobId,excludeJobId).n;
  }
  return {used,queued,globalUsed,globalQueued};
 }
 function check(userId,options={}){
  userIdValid(userId);
  const value=counts(userId,options);
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
  check(job.user_id,{excludeJobId:job.id});
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
