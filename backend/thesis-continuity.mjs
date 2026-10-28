import {randomUUID} from 'node:crypto';
import {computeThesisRunBudget,thesisCallTokenCeiling,thesisRunTokenCeiling} from './thesis-execution-policy.mjs';
import {migrateThesisTokenCeiling} from './thesis-continuity-schema.mjs';

const scale=1000000,maxCost=50;
const fail=(status,message,code)=>{throw Object.assign(new Error(message),{status,code});};
const micros=value=>Math.ceil(value*scale);
const amount=value=>value/scale;
const reasons=new Set(['completed','process_interrupted','truncated','turn_limit','invalid_json','invalid_output','incomplete','word_limit_exceeded','usage_unknown','budget_exceeded','cost_budget','needs_materials','unknown_source','unread_source','draft_disclosure_missing','presentation_not_selected','unsupported_image','moderation_rejected','content_rejected','cancelled','timeout','provider_error','execution_failed']);
const reason=value=>reasons.has(value)?value:'execution_failed';
const validUsage=value=>Boolean(value&&Number.isSafeInteger(value.input)&&value.input>=0&&Number.isSafeInteger(value.output)&&value.output>=0&&Number.isSafeInteger(value.input+value.output)&&value.input+value.output>0);
const validCost=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&Number.isSafeInteger(micros(value));
const unitName=value=>{if(typeof value!=='string'||!value||value.length>400||/[\x00-\x1f\x7f]/.test(value))fail(400,'论文执行单元标识无效','invalid_execution_unit');return value;};

export function createThesisContinuity(db,config={}){
 migrateThesisTokenCeiling(db);
 db.exec(`CREATE TABLE IF NOT EXISTS thesis_execution_budgets(
  run_id TEXT NOT NULL REFERENCES thesis_runs(id),attempt INTEGER NOT NULL CHECK(attempt>=1),
  user_id TEXT NOT NULL REFERENCES users(id),settings_version TEXT NOT NULL,unit_ids TEXT NOT NULL,review_allowance INTEGER NOT NULL CHECK(review_allowance>=1 AND review_allowance<=24),
  token_limit INTEGER NOT NULL CHECK(token_limit>=1000 AND token_limit<=${thesisRunTokenCeiling}),
  cost_limit_micros INTEGER NOT NULL CHECK(cost_limit_micros>=10000 AND cost_limit_micros<=50000000),unit_cost_micros INTEGER NOT NULL CHECK(unit_cost_micros>=10000 AND unit_cost_micros<=5000000),
  recoveries INTEGER NOT NULL DEFAULT 0,last_recovery_dispatch_count INTEGER NOT NULL DEFAULT -1,
  last_reason TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(run_id,attempt)
 );
 CREATE TABLE IF NOT EXISTS thesis_execution_dispatches(
  id TEXT PRIMARY KEY,run_id TEXT NOT NULL,attempt INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),
  unit_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('section','review')),unit_attempt INTEGER NOT NULL CHECK(unit_attempt>=1 AND unit_attempt<=3),
  status TEXT NOT NULL CHECK(status IN ('reserved','completed','failed','interrupted')),
  reserved_tokens INTEGER NOT NULL CHECK(reserved_tokens>=1),reserved_cost_micros INTEGER NOT NULL CHECK(reserved_cost_micros>=1),
  charged_tokens INTEGER NOT NULL CHECK(charged_tokens>=0),charged_cost_micros INTEGER NOT NULL CHECK(charged_cost_micros>=0),
  input_tokens INTEGER,output_tokens INTEGER,cost_micros INTEGER,error_code TEXT,
  created_at TEXT NOT NULL,finished_at TEXT,
  FOREIGN KEY(run_id,attempt) REFERENCES thesis_execution_budgets(run_id,attempt),
  UNIQUE(run_id,attempt,kind,unit_id,unit_attempt)
 );
 CREATE INDEX IF NOT EXISTS thesis_execution_dispatches_run ON thesis_execution_dispatches(run_id,attempt,status);
 CREATE TRIGGER IF NOT EXISTS thesis_execution_budgets_identity BEFORE UPDATE ON thesis_execution_budgets
 WHEN NEW.run_id IS NOT OLD.run_id OR NEW.attempt IS NOT OLD.attempt OR NEW.user_id IS NOT OLD.user_id
 OR NEW.settings_version IS NOT OLD.settings_version OR NEW.unit_ids IS NOT OLD.unit_ids OR NEW.review_allowance IS NOT OLD.review_allowance
 OR NEW.token_limit IS NOT OLD.token_limit OR NEW.cost_limit_micros IS NOT OLD.cost_limit_micros OR NEW.unit_cost_micros IS NOT OLD.unit_cost_micros
 BEGIN SELECT RAISE(ABORT,'论文连续执行预算不可扩展或改换账户'); END;
 CREATE TRIGGER IF NOT EXISTS thesis_execution_dispatches_identity BEFORE UPDATE ON thesis_execution_dispatches
 WHEN NEW.id IS NOT OLD.id OR NEW.run_id IS NOT OLD.run_id OR NEW.attempt IS NOT OLD.attempt OR NEW.user_id IS NOT OLD.user_id
 OR NEW.unit_id IS NOT OLD.unit_id OR NEW.kind IS NOT OLD.kind OR NEW.unit_attempt IS NOT OLD.unit_attempt
 OR NEW.reserved_tokens IS NOT OLD.reserved_tokens OR NEW.reserved_cost_micros IS NOT OLD.reserved_cost_micros
 OR OLD.status!='reserved'
 BEGIN SELECT RAISE(ABORT,'论文执行预留身份或已完成记录不可修改'); END;
 CREATE TRIGGER IF NOT EXISTS thesis_execution_budgets_no_delete BEFORE DELETE ON thesis_execution_budgets BEGIN SELECT RAISE(ABORT,'论文连续执行预算不可删除'); END;
 CREATE TRIGGER IF NOT EXISTS thesis_execution_dispatches_no_delete BEFORE DELETE ON thesis_execution_dispatches BEGIN SELECT RAISE(ABORT,'论文执行预留不可删除'); END;`);
 const clock=()=>new Date(config.thesisNow?.()??Date.now()).toISOString();
 const transaction=fn=>{if(db.isTransaction)return fn();db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 function own(run){
  if(typeof run?.id!=='string'||typeof run.user_id!=='string'||!Number.isSafeInteger(run.attempt)||run.attempt<1)fail(400,'论文执行身份无效','invalid_execution_identity');
  const row=db.prepare('SELECT * FROM thesis_runs WHERE id=? AND user_id=?').get(run.id,run.user_id);
  if(!row)fail(404,'论文执行任务不存在','execution_not_found');
  if(row.attempt!==run.attempt)fail(409,'论文执行批次已变化','execution_attempt_changed');
  return row;
 }
 function budget(run){
  const row=own(run),saved=db.prepare('SELECT * FROM thesis_execution_budgets WHERE run_id=? AND attempt=? AND user_id=?').get(row.id,row.attempt,row.user_id);
  if(!saved)fail(409,'当前论文没有已固化的连续执行预算','continuity_unavailable');
  if(saved.settings_version!==row.settings_version)fail(409,'论文执行配置版本已变化','execution_settings_changed');
  return saved;
 }
 function summarize(saved){
  const used=db.prepare('SELECT coalesce(sum(charged_tokens),0) tokens,coalesce(sum(charged_cost_micros),0) cost,count(*) dispatches,sum(CASE WHEN status=\'reserved\' THEN 1 ELSE 0 END) inflight FROM thesis_execution_dispatches WHERE run_id=? AND attempt=?').get(saved.run_id,saved.attempt);
  const repeats=db.prepare('SELECT coalesce(sum(n-1),0) n FROM (SELECT count(*) n FROM thesis_execution_dispatches WHERE run_id=? AND attempt=? GROUP BY kind,unit_id)').get(saved.run_id,saved.attempt).n;
  const waitingRecovery=db.prepare("SELECT count(*) n FROM thesis_execution_dispatches d WHERE d.run_id=? AND d.attempt=? AND d.status='interrupted' AND NOT EXISTS(SELECT 1 FROM thesis_execution_dispatches later WHERE later.run_id=d.run_id AND later.attempt=d.attempt AND later.kind=d.kind AND later.unit_id=d.unit_id AND later.unit_attempt>d.unit_attempt)").get(saved.run_id,saved.attempt).n;
  return {tokenLimit:saved.token_limit,remainingTokens:Math.max(0,saved.token_limit-used.tokens),costLimit:amount(saved.cost_limit_micros),remainingCostUsd:amount(Math.max(0,saved.cost_limit_micros-used.cost)),automaticRetries:repeats+waitingRecovery,recoveries:saved.recoveries,inFlight:used.inflight||0,lastReason:saved.last_reason||null,usedTokens:used.tokens,usedCostUsd:amount(used.cost),dispatches:used.dispatches,reviewBatchAllowance:saved.review_allowance};
 }
 function summary(run){const row=own(run),saved=db.prepare('SELECT * FROM thesis_execution_budgets WHERE run_id=? AND attempt=? AND user_id=?').get(row.id,row.attempt,row.user_id);return saved?summarize(saved):null;}
 function ensure(run,snapshot,plan,settings){return transaction(()=>{
  const row=own(run),existing=db.prepare('SELECT * FROM thesis_execution_budgets WHERE run_id=? AND attempt=?').get(row.id,row.attempt);
  if(existing){if(existing.user_id!==row.user_id||existing.settings_version!==row.settings_version)fail(409,'论文执行预算身份不一致','execution_settings_changed');return {...summarize(existing),created:false};}
  if(typeof settings?.version!=='string'||settings.version!==row.settings_version)fail(409,'论文原始执行配置不可用','execution_settings_changed');
  if(!Array.isArray(plan)||!plan.length||plan.length>120||new Set(plan.map(unit=>unitName(unit?.id))).size!==plan.length)fail(400,'论文执行计划无效','invalid_execution_unit');
  const perUnit=settings.maxCostUsd;
  if(typeof perUnit!=='number'||!Number.isFinite(perUnit)||perUnit<.01||perUnit>5)fail(400,'论文单节成本预算无效','invalid_execution_budget');
  const words=Number.isSafeInteger(snapshot.profile?.targetWords)&&snapshot.profile.targetWords>0?snapshot.profile.targetWords:plan.reduce((sum,unit)=>sum+(Number.isSafeInteger(unit.targetWords)&&unit.targetWords>0?unit.targetWords:0),0)||500;
  const baseReviews=Math.max(1,Math.ceil(words*(/english|英文|英语/i.test(snapshot.profile?.language||'中文')?6:1.2)/22000),Math.ceil(plan.length/12));
  const supplementReviews=config.supplementCheckEnabled===true&&JSON.parse(row.settings_meta||'{}').supplementCheck===true?Math.ceil(words*(/english|英文|英语/i.test(snapshot.profile?.language||'中文')?6:1.5)/10000)+Math.ceil(plan.length/6):0;
  const reviewAllowance=Math.min(24,baseReviews+supplementReviews*(JSON.parse(row.settings_meta||'{}').completion?2:1));
  const tokenLimit=computeThesisRunBudget({snapshot,plan,settings,config,reviewAllowance});
  let costLimit=Math.min(maxCost,perUnit*(plan.length*1.25+reviewAllowance));
  if(config.thesisMaxRunCostUsd!==undefined&&config.thesisMaxRunCostUsd!==null){const cap=Number(config.thesisMaxRunCostUsd);if(!Number.isFinite(cap)||cap<.01||cap>maxCost)fail(400,'论文总成本上限应为 0.01～50 美元','invalid_execution_budget');costLimit=Math.min(costLimit,cap);}
  const at=clock();db.prepare('INSERT INTO thesis_execution_budgets(run_id,attempt,user_id,settings_version,unit_ids,review_allowance,token_limit,cost_limit_micros,unit_cost_micros,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(row.id,row.attempt,row.user_id,row.settings_version,JSON.stringify(plan.map(unit=>unit.id)),reviewAllowance,tokenLimit,micros(costLimit),micros(perUnit),at,at);
  return {...summary(row),created:true};
 });}
 function reserve(run,unitId,{remainingUnits,settings,kind='section',minimumTokens=0}={}){return transaction(()=>{
  const saved=budget(run),row=own(run),current=db.prepare('SELECT current_run_id FROM theses WHERE id=? AND user_id=?').get(row.thesis_id,row.user_id);
  if(row.status!=='running'||current?.current_run_id!==row.id)fail(409,'论文已停止或执行任务已变化','execution_not_running');
  if(settings?.version!==saved.settings_version)fail(409,'论文原始执行配置不可用','execution_settings_changed');
  if(!['section','review'].includes(kind)||!Number.isSafeInteger(remainingUnits)||remainingUnits<1||remainingUnits>120)fail(400,'论文执行单元或剩余数量无效','invalid_execution_unit');
  unitName(unitId);if(kind==='section'&&!JSON.parse(saved.unit_ids).includes(unitId))fail(400,'执行单元不属于本次论文计划','invalid_execution_unit');
  const used=db.prepare('SELECT count(*) n FROM thesis_execution_dispatches WHERE run_id=? AND attempt=? AND kind=? AND unit_id=?').get(row.id,row.attempt,kind,unitId).n;
  if(used>=(kind==='review'?1:3))fail(429,'本节自动恢复次数已用完，已保留完成章节','retry_limit');
  if(kind==='review'&&db.prepare("SELECT count(*) n FROM thesis_execution_dispatches WHERE run_id=? AND attempt=? AND kind='review'").get(row.id,row.attempt).n>=saved.review_allowance)fail(429,'本篇论文已达到预先确认的审校批次数量','retry_limit');
  const state=summarize(saved);
  if(state.inFlight)fail(409,'当前论文已有尚未结束的模型调用','execution_in_flight');
  if(!Number.isSafeInteger(minimumTokens)||minimumTokens<0||minimumTokens>thesisCallTokenCeiling)fail(400,'论文执行单元的请求空间无效','invalid_execution_budget');
  if(minimumTokens>state.remainingTokens)fail(429,'本篇论文剩余执行额度不足以继续当前章节，已保留完成章节','budget_exceeded');
  if(state.remainingTokens<1000)fail(429,'本篇论文已达到执行预算，已保留完成章节','budget_exceeded');
  const unitCost=settings.maxCostUsd;
  if(typeof unitCost!=='number'||!Number.isFinite(unitCost)||unitCost<.01||unitCost>5)fail(400,'论文单节成本预算无效','invalid_execution_budget');
  const cost=Math.min(saved.unit_cost_micros,micros(unitCost),Math.round(state.remainingCostUsd*scale));
  if(cost<10000)fail(429,'本篇论文已达到成本预算，已保留完成章节','cost_budget');
  // A 12-turn section must not inherit the same window as a short tool task.
  // Request history is conservatively reserved in UTF-8 bytes by the relay;
  // this headroom is released in favour of real usage after each dispatch.
  // Unknown usage still holds this bounded reservation. Neither a retry nor
  // extra context may widen the frozen whole-paper or per-call dollar caps.
  const turns=Number.isSafeInteger(settings.maxTurns)&&settings.maxTurns>=1&&settings.maxTurns<=12?settings.maxTurns:6;
  // Late chapters need the same request-history space as early ones. Derive
  // the normal window from the frozen original pool, never the shrinking
  // balance. A larger whole-paper pool must not exceed the relay's call cap.
  // A review reads a multi-section manuscript batch even when it has fewer
  // allowed turns. Leave room for a grounded-candidate correction as well.
  const contextHeadroom=Math.min((kind==='review'?12:turns)*40000,Math.ceil(saved.token_limit/4*2.5));
  const tokens=Math.min(state.remainingTokens,thesisCallTokenCeiling,Math.max(120000,contextHeadroom,minimumTokens));
  const id=randomUUID(),at=clock();db.prepare("INSERT INTO thesis_execution_dispatches(id,run_id,attempt,user_id,unit_id,kind,unit_attempt,status,reserved_tokens,reserved_cost_micros,charged_tokens,charged_cost_micros,created_at) VALUES(?,?,?,?,?,?,?,'reserved',?,?,?,?,?)").run(id,row.id,row.attempt,row.user_id,unitId,kind,used+1,tokens,cost,tokens,cost,at);
  db.prepare('UPDATE thesis_execution_budgets SET updated_at=? WHERE run_id=? AND attempt=?').run(at,row.id,row.attempt);
  return {id,maxTotalTokens:tokens,maxCostUsd:amount(cost),unitAttempt:used+1,kind,unitId};
 });}
 function finish(id,{usage,costUsd,errorCode}={}){return transaction(()=>{
  if(typeof id!=='string')fail(400,'论文执行预留标识无效','invalid_execution_identity');
  const dispatch=db.prepare('SELECT * FROM thesis_execution_dispatches WHERE id=?').get(id);
  if(!dispatch)fail(404,'论文执行预留不存在','execution_not_found');
  const saved=db.prepare('SELECT * FROM thesis_execution_budgets WHERE run_id=? AND attempt=? AND user_id=?').get(dispatch.run_id,dispatch.attempt,dispatch.user_id),row=db.prepare('SELECT user_id FROM thesis_runs WHERE id=?').get(dispatch.run_id);
  if(!saved||row?.user_id!==dispatch.user_id)fail(409,'论文执行预留身份不一致','invalid_execution_identity');
  if(dispatch.status!=='reserved'){const state=summarize(saved),budgetExceeded=dispatch.charged_tokens>dispatch.reserved_tokens||dispatch.charged_cost_micros>dispatch.reserved_cost_micros||state.usedTokens>state.tokenLimit||state.usedCostUsd>state.costLimit;return {id,status:dispatch.status,usageKnown:dispatch.input_tokens!==null,costKnown:dispatch.cost_micros!==null,budgetExceeded,exceeded:budgetExceeded,...state};}
  const usageKnown=validUsage(usage),costKnown=validCost(costUsd),tokens=usageKnown?usage.input+usage.output:dispatch.reserved_tokens,cost=costKnown?micros(costUsd):dispatch.reserved_cost_micros;
  const code=errorCode?reason(errorCode):usageKnown?'completed':'usage_unknown',status=errorCode||!usageKnown?'failed':'completed',at=clock();
  db.prepare('UPDATE thesis_execution_dispatches SET status=?,charged_tokens=?,charged_cost_micros=?,input_tokens=?,output_tokens=?,cost_micros=?,error_code=?,finished_at=? WHERE id=? AND status=\'reserved\'').run(status,tokens,cost,usageKnown?usage.input:null,usageKnown?usage.output:null,costKnown?cost:null,code,at,id);
  db.prepare('UPDATE thesis_execution_budgets SET last_reason=?,updated_at=? WHERE run_id=? AND attempt=?').run(code,at,dispatch.run_id,dispatch.attempt);
  const state=summarize(db.prepare('SELECT * FROM thesis_execution_budgets WHERE run_id=? AND attempt=?').get(dispatch.run_id,dispatch.attempt));
  const budgetExceeded=tokens>dispatch.reserved_tokens||cost>dispatch.reserved_cost_micros||state.usedTokens>state.tokenLimit||state.usedCostUsd>state.costLimit;
  return {id,status,usageKnown,costKnown,budgetExceeded,exceeded:budgetExceeded,...state};
 });}
 function recover(run){return transaction(()=>{
  const row=own(run),saved=db.prepare('SELECT * FROM thesis_execution_budgets WHERE run_id=? AND attempt=? AND user_id=?').get(row.id,row.attempt,row.user_id);
  if(!saved)return {ready:false,recoveredDispatches:0,lastReason:'continuity_unavailable'};
  const at=clock(),active=db.prepare("SELECT id FROM thesis_execution_dispatches WHERE run_id=? AND attempt=? AND status='reserved'").all(row.id,row.attempt);
  for(const dispatch of active)db.prepare("UPDATE thesis_execution_dispatches SET status='interrupted',error_code='process_interrupted',finished_at=? WHERE id=? AND status='reserved'").run(at,dispatch.id);
  const total=db.prepare('SELECT count(*) n FROM thesis_execution_dispatches WHERE run_id=? AND attempt=?').get(row.id,row.attempt).n;
  if(saved.last_recovery_dispatch_count!==total)db.prepare("UPDATE thesis_execution_budgets SET recoveries=recoveries+1,last_recovery_dispatch_count=?,last_reason='process_interrupted',updated_at=? WHERE run_id=? AND attempt=?").run(total,at,row.id,row.attempt);
  const state=summary(row),exhausted=db.prepare("SELECT 1 FROM thesis_execution_dispatches d WHERE d.run_id=? AND d.attempt=? AND d.kind='section' AND d.unit_attempt>=3 AND d.status IN ('failed','interrupted') AND NOT EXISTS(SELECT 1 FROM thesis_execution_dispatches later WHERE later.run_id=d.run_id AND later.attempt=d.attempt AND later.kind=d.kind AND later.unit_id=d.unit_id AND later.unit_attempt>d.unit_attempt) LIMIT 1").get(row.id,row.attempt);
  const current=db.prepare('SELECT current_run_id FROM theses WHERE id=? AND user_id=?').get(row.thesis_id,row.user_id);
  return {ready:row.status==='running'&&current?.current_run_id===row.id&&!exhausted&&state.remainingTokens>=1000&&state.remainingCostUsd>=.01,recoveredDispatches:active.length,...state};
 });}
 return {ensure,summary,reserve,finish,recover};
}
