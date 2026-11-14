import {thesisDocxObjects} from './thesis-docx-objects.mjs';
import {createThesisReviewSessions} from './thesis-review-session.mjs';
import {createThesisReviewLifecycle} from './thesis-review-lifecycle.mjs';
import {reviewSavedThesis,createSessionReviewDispatch} from './thesis-review-only.mjs';
import {savedThesisChapters} from './thesis-completion.mjs';
import {withThesisRetryCandidate,safeThesisValidation} from './thesis-retry-context.mjs';
import {completionDiagnosis,withCompletionDiagnosis} from './thesis-completion-guidance.mjs';
import {completionContentAudit} from './thesis-completion-audit.mjs';
import {assertExpressionRepairUnchanged,normalizeExpressionPatch,safeExpressionReplacement} from './thesis-expression-repair.mjs';
import {normalizeSourceRepair} from './thesis-source-repair.mjs';
import {completionRepairs} from './thesis-completion-repair.mjs';
import {thesisFactView,currentThesisFactView} from './thesis-fact-view.mjs';
import {runSupplementCheck} from './supplement-check.mjs';
import {completionBaseline,completionManuscriptHash} from './thesis-completion.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,relative} from 'node:path';
import {buildThesisBibliography,thesisReferenceMetadata} from '../dist/workspace/thesis-document.mjs';
import {createBillingService} from './billing-service.mjs';
import {createModelBudget} from './model-budget.mjs';
import {initializeThesisSchema,thesisAgentTask,parseThesisSection,validateThesisCandidate,thesisFullText,thesisLimits,thesisHash,thesisError,thesisPublicError,thesisTransaction,assertThesisAccountQuota,assertThesisChapterCapacity,assertThesisSourceIdsUnique,isThesisReferenceChapter,compileThesisReferences} from './thesis-model.mjs';
import {assertThesisSettings} from './thesis-service.mjs';
import {runAgentTask,safeProviderNetworkFailure} from './agent-runtime.mjs';
import {createThesisContinuity} from './thesis-continuity.mjs';
import {classifyThesisRetry,thesisExecutionSettings,thesisCallTokenCeiling} from './thesis-execution-policy.mjs';
import {createWritingQualityRunner} from './writing-quality-runner.mjs';
import {fitOptionalWritingQuality} from './writing-quality-storage.mjs';
import {thesisManualBackMatter} from '../dist/workspace/thesis-delivery.mjs';

const active=status=>status==='running'||status==='queued';
const validUsage=value=>Number.isSafeInteger(value)&&value>=0;
const knownUsage=usage=>validUsage(usage?.input)&&validUsage(usage?.output)&&Number.isSafeInteger(usage.input+usage.output)&&usage.input+usage.output>0;
const safeStage=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,60}$/i.test(value)?value:'agent_running';
export function hasCompletionChanges(chapters,savedBaseline,targetChapters){
 const comparable=text=>String(text||'').replace(/\s+/gu,' ').trim();
 const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
 return chapters.filter(chapter=>targetChapters.has(chapter.id)||isThesisReferenceChapter(chapter)).some(chapter=>{const before=savedBaseline.find(row=>row.chapter_id===chapter.id);return comparable(chapter.text)!==comparable(before?.text)||canonical(chapter.figures||[])!==canonical(JSON.parse(before?.figures||'[]'));});
}
// A deployment that changes any prompt, validator or runtime cannot inherit
// a prior semantic review just because its JSON still parses.
export function reviewRulesFingerprint(root=fileURLToPath(new URL('../',import.meta.url))){try{const hash=createHash('sha256'),files=[];const walk=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(dir,entry.name);if(entry.isSymbolicLink())throw Error('unverifiable build');if(entry.isDirectory())walk(path);else if(entry.isFile()&&/\.(?:js|mjs|cjs|json|md|html|css|sql|wasm)$/i.test(entry.name))files.push(path);}};for(const dir of ['backend','src','dist'])walk(join(root,dir));for(const name of ['server.mjs','package.json','package-lock.json'])files.push(join(root,name));files.sort();for(const file of files){hash.update(relative(root,file));hash.update('\0');hash.update(readFileSync(file));hash.update('\0');}return hash.digest('hex');}catch{return null;}}
const reviewRulesVersion=reviewRulesFingerprint();
// Conservative same-run review reuse: any input, manuscript, model or review
// configuration change invalidates the cache. Credentials are never stored.
export function reviewBatchReuseKey({task,snapshot,chapters,settings,validatorVersion=reviewRulesVersion}){
 const {engine,model,version,baseURL,workspaceId,maxTurns,maxOutputTokens,timeoutMs,maxCostUsd,maxTotalTokens}=settings||{};
 if(!validatorVersion)return null;
 return thesisHash({schema:'review-batch-v3',validatorVersion,task,snapshot,chapters,settings:{engine,model,version,baseURL,workspaceId,maxTurns,maxOutputTokens,timeoutMs,maxCostUsd,maxTotalTokens}});
}
// Failed, unpriced or corrupt results are never reused. The current validator
// must re-check original trace and exact quotations before a cache hit.
export async function reusableReviewBatch(rows,reuseKey,validator){
 if(!reuseKey||typeof validator!=='function')return null;
 for(const row of rows){let prior;try{prior=JSON.parse(row.result);}catch{continue;}if(prior.reuseKey!==reuseKey||prior.costKnown!==true||!knownUsage(prior.usage))continue;try{const checked=await validator(prior);if(checked?.valid===true)return typeof checked.normalizedText==='string'?{...prior,text:checked.normalizedText,trace:checked.normalizedTrace||prior.trace}:prior;}catch{}}
 return null;
}
// Only completed terminal review batches belonging to the current account and
// run can be considered, and never a future attempt or an initial diagnosis.
export function eligibleReviewCheckpoints(db,{runId,userId,attempt,taskHash}){
 return db.prepare('SELECT c.result FROM thesis_review_checkpoints c JOIN thesis_runs r ON r.id=c.run_id WHERE c.run_id=? AND r.user_id=? AND c.attempt<=? AND c.task_hash=? AND (c.unit_id LIKE ? OR c.unit_id LIKE ?) ORDER BY c.attempt DESC,c.created_at DESC').all(runId,userId,attempt,taskHash,'completion-quality-%::supplement-final::%','completion-quality-%::quality-review::%');
}
export function reviewCheckpointUnitId(unitId,key){if(!key)throw thesisError(503,'审校规则暂不可核实，已保存内容保留，请稍后再试。','review_version_unknown');return unitId+'::key-'+key.slice(0,16);}
export async function restoreReviewCheckpoint(cached,hash,checkpointKey,validator){
 if(!cached)return null;if(cached.task_hash!==hash)throw thesisError(409,'审校资料已变化','review_changed');
 const prior=JSON.parse(cached.result);
 if(prior.costKnown!==true||!knownUsage(prior.usage))throw thesisError(409,'本次审校用量或费用暂未核实，已保存的内容保留；请稍后联系支持核对，避免重复处理。','cost_unknown');
 const verified=await validator(prior);if(!checkpointKey||prior.checkpointKey!==checkpointKey||verified?.valid!==true)throw thesisError(502,'已保存的审校结果未通过当前核验','invalid_review_output');return typeof verified.normalizedText==='string'?{...prior,text:verified.normalizedText,trace:verified.normalizedTrace||prior.trace}:prior;
}
// Whole reports are not restored across worker restarts: even identical text
// cannot prove the same sources, object metadata or review rules were used.
export const cleanThesisTrace=value=>(Array.isArray(value)?value:[]).slice(-50).map(row=>({stage:safeStage(typeof row==='string'?row:row?.stage||row?.tool||row?.type),...(safeThesisValidation(row?.validation)?{validation:safeThesisValidation(row.validation)}:{}),...(row?.tool==='read_material'&&row.status==='completed'&&typeof row.materialId==='string'?{tool:'read_material',status:'completed',materialId:row.materialId.slice(0,160),...(Number.isSafeInteger(row.offset)&&row.offset>=0&&Number.isSafeInteger(row.limit)&&row.limit>0?{offset:row.offset,limit:row.limit}:{})}:{})}));
const cleanTrace=cleanThesisTrace;

// Denied tool names are operational diagnostics. Keep neither arguments nor
// content, and omit the public tool field so account archives project them out.
export const failureDiagnostics=error=>{
 const denied=(Array.isArray(error?.agentTrace)?error.agentTrace:[]).filter(row=>row?.status==='denied'&&typeof row.tool==='string'&&/^[A-Za-z_][A-Za-z0-9_-]{0,119}$/.test(row.tool)).slice(-2).map(row=>({stage:'tool_denied',status:'denied',requestedTool:row.tool,code:error.code==='permission_denied'?'permission_denied':'unauthorized_tool'}));
 const fields=['providerRequests','requestBodyBytes','maxRequestBodyBytes','compactedBytes','toolCalls'];
 const m=error?.requestMetrics,metrics=m&&fields.every(k=>Number.isSafeInteger(m[k])&&m[k]>=0&&m[k]<=1000000000)?Object.fromEntries(fields.map(k=>[k,m[k]])):null;
 const category=['dns_error','rate_limit','upstream_timeout','provider_auth','provider_unavailable','provider_rejected','network_error','response_incomplete','response_interrupted','local_tool_unavailable','sdk_result_failure','sdk_result_missing'].includes(error?.providerDiagnostic)?error.providerDiagnostic:null;
 const networkFailure=safeProviderNetworkFailure(error?.providerNetworkFailure);return [...denied,...(metrics||category||networkFailure?[{stage:'execution_metrics',...(metrics?{metrics}:{}),...(category?{providerDiagnostic:category}:{}),...(networkFailure?{networkFailure}:{})}]:[])];
};

export function startThesisWorker(db,config={}){
 initializeThesisSchema(db);
 const billing=config.billing||createBillingService(db,config),modelBudget=config.modelBudget||createModelBudget(db,config),limits=thesisLimits(config);
 const continuity=createThesisContinuity(db,config),qualityRunner=createWritingQualityRunner(config);
 const reviewSchema=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='thesis_review_sessions'").get()),reviewSessions=(config.thesisReviewOnlyEnabled===true||reviewSchema)?createThesisReviewSessions(db,config):null,reviewLifecycle=reviewSessions?createThesisReviewLifecycle(db,config,{sessions:reviewSessions}):null;
 const clock=()=>new Date(config.thesisNow?.()??Date.now()).toISOString();
 let busy=false,stopped=false,currentPromise=null;const controllers=new Map();
 const transaction=fn=>thesisTransaction(db,fn);
 const isContinuous=run=>config.thesisContinuousEnabled!==false&&JSON.parse(run.settings_meta||'{}').continuous===true;
 // An explicit resume keeps the run ID but replaces its execution attempt.
 // Every callback retains the attempt it claimed, never the latest row's identity.
 const ownsAttempt=run=>Boolean(run&&db.prepare('SELECT 1 FROM thesis_runs r JOIN jobs j ON j.id=r.id JOIN theses t ON t.id=r.thesis_id WHERE r.id=? AND r.user_id=? AND r.attempt=? AND j.user_id=r.user_id AND t.current_run_id=r.id').get(run.id,run.user_id,run.attempt));
 function requeue(run){
  if(!ownsAttempt(run)||!isContinuous(run)||JSON.parse(run.settings_meta||'{}').reviewOnly===true)return false;
  const job=db.prepare('SELECT status FROM jobs WHERE id=?').get(run.id);
  if(job?.status!=='running'||!db.prepare("SELECT 1 FROM thesis_runs WHERE id=? AND attempt=? AND status='running'").get(run.id,run.attempt)||!db.prepare("SELECT 1 FROM billing_reservations WHERE job_id=? AND attempt=? AND user_id=? AND status='held'").get(run.id,run.attempt,run.user_id))return false;
  const recovered=continuity.recover(run);if(recovered.recoveredDispatches>0)db.prepare('UPDATE thesis_runs SET usage_known=0 WHERE id=? AND attempt=?').run(run.id,run.attempt);if(!recovered.ready)return false;
  const at=clock();db.prepare("UPDATE thesis_runs SET status='queued',stage='auto_recovering',error=NULL,updated_at=? WHERE id=? AND attempt=? AND status='running'").run(at,run.id,run.attempt);db.prepare("UPDATE jobs SET status='queued',stage='auto_recovering',error=NULL,updated_at=? WHERE id=? AND status='running'").run(at,run.id);db.prepare("UPDATE thesis_checkpoints SET status='pending',error=NULL,updated_at=? WHERE run_id=? AND status='running'").run(at,run.id);db.prepare("UPDATE theses SET status='queued',version=version+1,updated_at=? WHERE id=? AND current_run_id=?").run(at,run.thesis_id,run.id);return true;
 }
 function markStopped(runId,attempt,status,message){
  if(!Number.isSafeInteger(attempt)||attempt<1)return;
  const run=db.prepare('SELECT * FROM thesis_runs WHERE id=? AND attempt=?').get(runId,attempt);if(!run||!active(run.status)||!ownsAttempt(run))return;
  if(JSON.parse(run.settings_meta||'{}').reviewOnly===true&&reviewLifecycle){reviewLifecycle.stop(run,status);return;}
  const at=clock();db.prepare('UPDATE thesis_runs SET status=?,stage=?,error=?,updated_at=? WHERE id=? AND attempt=?').run(status,status,message,at,runId,attempt);
  // The shared task centre uses its existing terminal states; the thesis run
  // retains the precise reason (missing evidence, interruption or cancellation).
  db.prepare('UPDATE jobs SET status=?,stage=?,error=?,updated_at=? WHERE id=?').run(status==='cancelled'?'cancelled':'failed',status,message,at,runId);
  db.prepare('UPDATE theses SET status=?,version=version+1,updated_at=? WHERE id=? AND current_run_id=?').run(status,at,run.thesis_id,runId);
  billing.release(runId);
 }
 transaction(()=>{for(const run of db.prepare("SELECT * FROM thesis_runs WHERE status='running'").all())if(!requeue(run))markStopped(run.id,run.attempt,'interrupted','服务重启中断了任务；已完成章节已保存，预占权益已释放，请确认后续跑');});
 async function execute(){
  if(busy||stopped)return;
  const run=db.prepare("SELECT r.* FROM thesis_runs r JOIN theses t ON t.id=r.thesis_id WHERE r.status='queued' AND t.current_run_id=r.id ORDER BY r.created_at,r.id LIMIT 1").get();
  if(!run)return;busy=true;const controller=new AbortController();controllers.set(run.id,{controller,attempt:run.attempt});let runtime={};const continuous=isContinuous(run);
  const running=()=>Boolean(!controller.signal.aborted&&db.prepare("SELECT 1 FROM thesis_runs r JOIN jobs j ON j.id=r.id JOIN theses t ON t.id=r.thesis_id WHERE r.id=? AND r.user_id=? AND r.attempt=? AND r.status='running' AND j.status='running' AND j.attempt=r.attempt AND j.user_id=r.user_id AND t.current_run_id=r.id").get(run.id,run.user_id,run.attempt));
  const writeRunning=fn=>transaction(()=>{if(!running())return false;fn();return true;});
  const writeAttempt=fn=>transaction(()=>{if(!ownsAttempt(run))return false;fn();return true;});
  const stage=value=>{const name=safeStage(value);writeRunning(()=>{db.prepare('UPDATE thesis_runs SET stage=?,updated_at=? WHERE id=? AND attempt=?').run(name,clock(),run.id,run.attempt);db.prepare("UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND attempt=? AND status='running'").run(name,clock(),run.id,run.attempt);});};
  try{
   const claimed=transaction(()=>{if(!ownsAttempt(run)||db.prepare("SELECT id FROM thesis_runs WHERE status='running' AND id!=? LIMIT 1").get(run.id))return false;if(!db.prepare("UPDATE thesis_runs SET status='running',stage='preparing',updated_at=? WHERE id=? AND attempt=? AND status='queued'").run(clock(),run.id,run.attempt).changes)return false;
    db.prepare("UPDATE jobs SET status='running',stage='preparing',attempt=?,updated_at=? WHERE id=? AND status='queued'").run(run.attempt,clock(),run.id);
    db.prepare("UPDATE theses SET status='running',version=version+1,updated_at=? WHERE id=? AND current_run_id=?").run(clock(),run.thesis_id,run.id);if(JSON.parse(run.settings_meta||'{}').reviewOnly!==true)modelBudget.start(run.id,run.attempt);return true;});
   if(!claimed)return;
   assertThesisSettings(await config.getAgentSettings?.());
   runtime=thesisExecutionSettings(assertThesisSettings(await config.getAgentSettings?.(run.settings_version)),JSON.parse(run.settings_meta||'{}').executionMaxCostUsd);
   if(!running())return;
   if(runtime.version!==run.settings_version)throw thesisError(503,'原生成配置版本不可用，请联系管理员');
   const snapshot=JSON.parse(run.snapshot),plan=JSON.parse(run.plan),baseline=run.input_tokens+run.output_tokens;assertThesisSourceIdsUnique(snapshot);
   const reviewMeta=JSON.parse(run.settings_meta||'{}');
   if(reviewMeta.reviewOnly===true){
    if(config.thesisReviewOnlyEnabled!==true||!reviewLifecycle||!reviewSessions)throw thesisError(503,'终稿复查暂未开放','review_disabled');
    const row=db.prepare('SELECT * FROM theses WHERE id=? AND user_id=?').get(run.thesis_id,run.user_id);
    const chapters=savedThesisChapters(db,row).map(({record,...chapter})=>({...chapter,text:record?.text||'',sourceIds:JSON.parse(record?.source_ids||'[]'),figures:JSON.parse(record?.figures||'[]')}));
    const isCurrent=()=>Boolean(running()&&reviewLifecycle.current(run));
    const dispatch=createSessionReviewDispatch({sessions:reviewSessions,userId:run.user_id,thesisId:run.thesis_id,sessionId:reviewMeta.reviewSessionId,reviewRunId:run.id,attempt:run.attempt,runner:config.agentTaskRunner||runAgentTask,isCurrent,signal:controller.signal,onStage:stage});
    const result=await reviewSavedThesis({snapshot,chapters,docxObjects:thesisDocxObjects(db,run.thesis_id,run.user_id,chapters),row,runtime:{...runtime,maxTotalTokens:thesisCallTokenCeiling},runId:run.id,qualityRunner:config.thesisReviewQualityRunner||qualityRunner,dispatch,isCurrent,signal:controller.signal,onStage:stage});
    if(!running())return;reviewLifecycle.finish(run,result);return;
   }
   const savedBaseline=completionBaseline(db,run),completionMode=Boolean(JSON.parse(run.settings_meta||'{}').completion),targetChapters=new Set(plan.map(unit=>unit.chapterId)),fullCompletion=JSON.parse(run.settings_meta||'{}').completion?.scope==='full';
   const manuscriptVersions=()=>snapshot.outline.map(chapter=>{let generated=db.prepare("SELECT * FROM thesis_chapter_versions WHERE run_id=? AND chapter_id=? AND source='generated' ORDER BY version DESC LIMIT 1").get(run.id,chapter.id);
    if(!generated&&fullCompletion&&targetChapters.has(chapter.id)){const units=db.prepare("SELECT * FROM thesis_checkpoints WHERE run_id=? AND chapter_id=? ORDER BY position").all(run.id,chapter.id);if(units.length&&units.every(unit=>unit.status==='completed'))generated={chapter_id:chapter.id,text:units.map(row=>{const unit=plan.find(unit=>unit.id===row.unit_id);return `${unit.part===1&&unit.title!==unit.chapterTitle?unit.title+'\n\n':''}${row.text}`;}).join('\n\n'),figures:JSON.stringify(units.flatMap(row=>JSON.parse(row.figures||'[]'))),source_ids:JSON.stringify([...new Set(units.flatMap(row=>JSON.parse(row.source_ids)))])};}
    return {...chapter,record:generated||(!targetChapters.has(chapter.id)?savedBaseline.find(row=>row.chapter_id===chapter.id):null)};});
   const completionReviewChapters=()=>{const versions=manuscriptVersions(),used=[...new Set(versions.flatMap(row=>[...(row.record?.text||'').matchAll(/\[source:([^\]]+)\]/g)].map(match=>match[1])))],references=compileThesisReferences(snapshot,used);return versions.map(row=>({id:row.id,title:row.title,text:isThesisReferenceChapter(row)?references:row.record?.text||'',sourceIds:isThesisReferenceChapter(row)?snapshot.references.filter(reference=>reference.confirmed&&used.includes(reference.id)).map(reference=>reference.id):row.record?JSON.parse(row.record.source_ids):[],figures:row.record?JSON.parse(row.record.figures||'[]'):[]}));};

   if(continuous&&!writeRunning(()=>continuity.ensure(run,snapshot,plan,runtime)))return;
   let diagnosis=JSON.parse(run.quality||'null')?.completionDiagnosis||null;
   const auditingDraft=fullCompletion&&JSON.parse(run.settings_meta||'{}').completion?.purpose!=='draft'&&savedBaseline.some(row=>row.text?.trim());
   const checkSupplements=config.supplementCheckEnabled===true&&JSON.parse(run.settings_meta||'{}').supplementCheck===true;
   const runner=config.agentTaskRunner||runAgentTask;
   if(typeof runner!=='function')throw thesisError(503,'毕业论文 Agent 执行器尚未接入');
   const reviewDispatch=async({task,settings,validateReviewOutput,validateThesisOutput,unitId})=>{
     if(!running()||stopped)throw thesisError(499,'任务已停止','cancelled');
     if(fullCompletion&&!validateThesisOutput&&/^completion-quality-\d+::(?:supplement-final|quality-review)::/.test(unitId)&&run.snapshot_hash===thesisHash(snapshot)){
      const chapters=completionReviewChapters().map(chapter=>({...chapter,versionId:manuscriptVersions().find(row=>row.id===chapter.id)?.record?.id||null})),batchIds=new Set((task.context.manuscriptExcerpts||[]).map(row=>row.id));for(const section of task.context.chapters||[]){const match=/^check-(\d+)-\d+/.exec(section.id||'');if(match&&chapters[Number(match[1])])batchIds.add(chapters[Number(match[1])].id);}
      const identity={ownerId:run.user_id,thesisId:run.thesis_id,runId:run.id,snapshotHash:run.snapshot_hash},views=[];for(const chapter of chapters){if(!batchIds.has(chapter.id)||views.length>=2)continue;const args={...identity,chapters,unit:{chapterId:chapter.id,completion:{originalText:chapter.text}},phase:'candidate',materials:[]},view=thesisFactView(args);if(view.numberChecks.length&&currentThesisFactView(view,args)){const {ownerId,thesisId,runId,...safe}=view;views.push(safe);}}
      if(views.length&&JSON.stringify(task.context).length+JSON.stringify(views).length<33500){task.context.factViews=views;task.instructions+='factViews 只针对当前候选稿指定章节的字面小数及覆盖范围，不能代替实际计算、来源核验或终稿检查；coverage 不完整时不能据此推断。保留真实缺项，判断问题必须定位本批原文。';}
     }
     const hash=thesisHash(task),checkpointKey=reviewBatchReuseKey({task,snapshot,chapters:completionReviewChapters(),settings});
     // An unverifiable build cannot safely identify or dispatch a review:
     // do not create a random retry identity that could spend twice.
     unitId=reviewCheckpointUnitId(unitId,checkpointKey);
     const cached=db.prepare('SELECT task_hash,result FROM thesis_review_checkpoints WHERE run_id=? AND attempt=? AND unit_id=?').get(run.id,run.attempt,unitId),validator=validateThesisOutput||validateReviewOutput;
     if(cached)return restoreReviewCheckpoint(cached,hash,checkpointKey,validator);
     const canReuse=typeof settings?.version==='string'&&!!settings.version&&!validateThesisOutput&&/^completion-quality-\d+::(?:supplement-final|quality-review)::/.test(unitId);
     const reuseKey=canReuse?checkpointKey:null;
     if(reuseKey){const candidates=eligibleReviewCheckpoints(db,{runId:run.id,userId:run.user_id,attempt:run.attempt,taskHash:hash});const prior=await reusableReviewBatch(candidates,reuseKey,validator);if(prior){if(!running()||stopped)throw thesisError(499,'任务已停止或执行批次已变化','cancelled');return prior;}}

     if(!continuous)throw thesisError(429,'本次未配置审校执行预算','budget_exceeded');
     assertThesisSettings(await config.getAgentSettings?.());
     if(!running()||stopped)throw thesisError(499,'任务已停止或执行批次已变化','cancelled');
     const reservation=transaction(()=>continuity.reserve(run,unitId,{remainingUnits:1,settings:runtime,kind:'review'}));let output,accounted=false;
     const account=usage=>writeAttempt(()=>{if(knownUsage(usage))db.prepare('UPDATE thesis_runs SET input_tokens=input_tokens+?,output_tokens=output_tokens+?,updated_at=? WHERE id=? AND attempt=?').run(usage.input,usage.output,clock(),run.id,run.attempt);else db.prepare('UPDATE thesis_runs SET usage_known=0 WHERE id=? AND attempt=?').run(run.id,run.attempt);});
     try{
      if(!writeRunning(()=>db.prepare('UPDATE thesis_runs SET provider_calls=provider_calls+1 WHERE id=? AND attempt=?').run(run.id,run.attempt)))throw thesisError(499,'任务已停止或执行批次已变化','cancelled');
      output=await runner({settings:{...settings,maxTotalTokens:reservation.maxTotalTokens,maxCostUsd:reservation.maxCostUsd},task,validateReviewOutput,validateThesisOutput,signal:controller.signal,onStage:()=>stage(validateThesisOutput?'repairing_completion':task.context.operation==='supplement-check'?(auditingDraft&&task.context.phase==='materials'?'reviewing_draft':'checking_supplements'):'reviewing_manuscript')});
      account(output?.usage);accounted=true;
      if(!knownUsage(output?.usage))throw thesisError(502,'审校未返回可核算用量','usage_unknown');
      if(!running()||stopped)throw thesisError(499,'任务已停止','cancelled');
      const validation=await (validateThesisOutput||validateReviewOutput)(output);if(validation?.valid!==true)throw thesisError(502,'审校内容未通过定位检查','invalid_review_output');const originalOutput=output;if(typeof validation.normalizedText==='string')output={...output,text:validation.normalizedText,trace:validation.normalizedTrace||output.trace};
      if(!writeRunning(()=>{const finished=continuity.finish(reservation.id,{usage:output.usage,costUsd:output.costUsd});if(finished.budgetExceeded)throw thesisError(429,'审校达到执行预算','budget_exceeded');const saved=JSON.stringify({text:originalOutput.text,trace:validateThesisOutput||task.context.operation==='supplement-check'?cleanTrace(originalOutput.trace):[],usage:output.usage,...(checkpointKey&&Number.isFinite(output.costUsd)&&output.costUsd>=0?{checkpointKey,costKnown:true,...(reuseKey?{reuseKey}:{})}: {})});assertThesisAccountQuota(db,run.user_id,Buffer.byteLength(saved),config);db.prepare('INSERT INTO thesis_review_checkpoints VALUES(?,?,?,?,?,?)').run(run.id,run.attempt,unitId,hash,saved,clock());}))throw thesisError(499,'任务已停止或执行批次已变化','cancelled');
      return output;
     }catch(error){if(!accounted)account(error.usage);transaction(()=>continuity.finish(reservation.id,{usage:output?.usage||error.usage,costUsd:output?.costUsd??error.costUsd,errorCode:error.code||'execution_failed'}));throw error;}
    };
   if(checkSupplements&&completionMode){
    const chapters=snapshot.outline.map(chapter=>({id:chapter.id,title:chapter.title,text:savedBaseline.find(row=>row.chapter_id===chapter.id)?.text||'本节尚未生成，按已确认的章节目的核对所需资料。',figures:JSON.parse(savedBaseline.find(row=>row.chapter_id===chapter.id)?.figures||'[]')}));
    const supplementCheck=await runSupplementCheck({snapshot,chapters,kind:'thesis',phase:'materials',recover:completionMode,runtime,dispatch:reviewDispatch,signal:controller.signal,isCurrent:running,onStage:()=>stage(auditingDraft?'reviewing_draft':'checking_supplements')});
    diagnosis=completionDiagnosis(supplementCheck,chapters,plan);
    if(!writeRunning(()=>{const json=JSON.stringify({status:'partial',supplementCheck,completionDiagnosis:diagnosis,manuscriptHash:completionManuscriptHash(chapters)});assertThesisAccountQuota(db,run.user_id,Buffer.byteLength(json),config);db.prepare('UPDATE thesis_runs SET quality=?,updated_at=? WHERE id=? AND attempt=?').run(json,clock(),run.id,run.attempt);}))return;
    // Missing research facts restrict final delivery, not draft writing. This
    // also applies to resumed legacy completion jobs with no scope metadata.
    // Keep the report and generate supported prose with explicit gaps; the
    // final, current-manuscript check still controls final DOCX delivery.
    // An unavailable optional preflight is retained as unfinished, never
    // as evidence approval. Writing still uses the normal admission ledger;
    // final delivery requires a completed, current final check.
   }
   for(const unit of plan){
    let retries=0,minimumTokens=0,retryFeedback=null,retryCandidate=null,deniedToolRetries=0;
    while(true){
    if(stopped)throw thesisError(503,'服务停止中断了任务');
    if(!running())return;
    const checkpoint=db.prepare('SELECT * FROM thesis_checkpoints WHERE run_id=? AND unit_id=?').get(run.id,unit.id);if(checkpoint.status==='completed')break;
    assertThesisSettings(await config.getAgentSettings?.());
    if(!running())return;
    const complete=db.prepare("SELECT * FROM thesis_checkpoints WHERE run_id=? AND status='completed' ORDER BY position").all(run.id);
    const contextSections=completionMode?[...savedBaseline.filter(row=>!targetChapters.has(row.chapter_id)).map(row=>({...row,unit_id:'saved::'+row.chapter_id})),...complete]:complete;let task=thesisAgentTask(snapshot,withCompletionDiagnosis(unit,diagnosis),contextSections);if(completionMode&&task.context?.revision?.excerpted)throw thesisError(422,'章节内容较长，当前无法完整处理，请拆分小节后重试；原稿已保留，本次未扣费。','completion_excerpt');
    if(fullCompletion&&unit.completion?.originalText&&run.snapshot_hash===thesisHash(snapshot)){
     // Both views are tied to this account/run and exact versions. Missing
     // candidate chapters remain incomplete instead of inheriting old text.
     const baseline=snapshot.outline.map(chapter=>{const record=savedBaseline.find(row=>row.chapter_id===chapter.id);return {id:chapter.id,title:chapter.title,kind:chapter.kind,text:record?.text||'',figures:JSON.parse(record?.figures||'[]'),versionId:record?.id||null};});
     const candidate=completionReviewChapters().map(chapter=>({...chapter,versionId:manuscriptVersions().find(row=>row.id===chapter.id)?.record?.id||null}));
     const confirmedIds=new Set(snapshot.materials.filter(row=>row.confirmed).map(row=>row.id)),materials=(task.materials||[]).filter(row=>confirmedIds.has(row.id)),identity={ownerId:run.user_id,thesisId:run.thesis_id,runId:run.id,snapshotHash:run.snapshot_hash},views=[['baseline',baseline],['candidate',candidate]].map(([phase,chapters])=>{const args={...identity,chapters,unit,phase,materials};const view=thesisFactView(args);return currentThesisFactView(view,args)?view:null;}).filter(view=>view?.numberChecks.length);
     if(views.length&&JSON.stringify(task.context).length+JSON.stringify(views).length<33500){task.context.factViews=views.map(({ownerId,thesisId,runId,...safe})=>safe);task.instructions+='factViews 是绑定当前论文、资料和章节版本的文字定位结果：baseline 为本轮开始前保存稿，candidate 仅为当前已完成内容，coverage 不全不能推断缺失。numberChecks 只统计指定章节文字中实际出现的小数，不核验研究含义、计算或图表，不证明旧占位已解决；作者声明仅为待读取的材料线索。须实际读取资料并对照当前完整正文后决定是否修改，保留无法核实的事项，最终由独立审校判断。';}
    }
    const maxTurns=Math.min(continuous?12:6,Math.max(1,Number(runtime.maxTurns)||3)),maxOutputTokens=Math.min(continuous?16384:8000,Math.max(32,Number(runtime.maxOutputTokens)||4096));
    if(retries){task.instructions+='上一次执行未完成。本次只处理当前单元：根据 retryFeedback 中服务器给出的校验反馈修正完整候选；过短补足论证，过长精简完整句段，不追求精确等于目标，不编造依据。';if(deniedToolRetries)task.instructions+='上次尝试调用了未提供的工具，该调用未执行。只使用本次明确提供的工具，不调用其他工具；直接通过已提供的提交工具提交完整结果。';if(retryFeedback)task.context.retryFeedback=retryFeedback;task=withThesisRetryCandidate(task,retryCandidate);}
    // The runtime relay enforces maxTotalTokens against the complete actual SDK
    // request, including system instructions, tool schemas and growing history.
    const totals=db.prepare('SELECT input_tokens,output_tokens FROM thesis_runs WHERE id=?').get(run.id),spent=totals.input_tokens+totals.output_tokens-baseline;
    if(!continuous&&spent+maxOutputTokens>=limits.maxRunTokens)throw thesisError(429,'本次生成已达到模型预算边界，已保留完成章节；请确认新报价后续跑','budget_exceeded');
    if(!writeRunning(()=>{db.prepare("UPDATE thesis_checkpoints SET status='running',error=NULL,updated_at=? WHERE run_id=? AND unit_id=? AND status!='completed'").run(clock(),run.id,unit.id);const step=unit.frontMatter?'generating_abstracts':'generating_section';db.prepare('UPDATE thesis_runs SET stage=?,updated_at=? WHERE id=? AND attempt=?').run(step,clock(),run.id,run.attempt);db.prepare('UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND attempt=?').run(step,clock(),run.id,run.attempt);}))return;
    let result,accounted=false,reservation=null,dispatched=false,finishedReservation=false,settledDispatch=null;
    try{
     if(continuous)reservation=transaction(()=>continuity.reserve(run,unit.id,{remainingUnits:plan.length-complete.length,settings:runtime,minimumTokens}));
     if(!writeRunning(()=>db.prepare('UPDATE thesis_runs SET provider_calls=provider_calls+1 WHERE id=? AND attempt=?').run(run.id,run.attempt)))throw thesisError(499,'任务已停止或执行批次已变化','cancelled');
     dispatched=true;result=await runner({settings:{...runtime,maxTurns,maxOutputTokens,...(reservation?{maxTotalTokens:reservation.maxTotalTokens,maxCostUsd:reservation.maxCostUsd}:{maxTotalTokens:Math.min(thesisCallTokenCeiling,limits.maxRunTokens-spent)})},task,validateThesisOutput:candidate=>{const checked=validateThesisCandidate(candidate,snapshot,unit);if(!checked.valid){const value=checked.feedback;retryFeedback={code:value.code,rule:value.rule,...Object.fromEntries(['count','target','min','max'].filter(key=>Number.isSafeInteger(value[key])&&value[key]>=0).map(key=>[key,value[key]]))};}return checked;},signal:controller.signal,onStage:stage});
     if(!ownsAttempt(run)){if(reservation){transaction(()=>continuity.finish(reservation.id,{usage:result?.usage,costUsd:result?.costUsd,errorCode:'cancelled'}));finishedReservation=true;}return;}
     if(!knownUsage(result?.usage))throw thesisError(502,'模型未返回可核算的用量，当前章节未标记完成，请联系管理员后重试','usage_unknown');
     writeAttempt(()=>{db.prepare('UPDATE thesis_runs SET input_tokens=input_tokens+?,output_tokens=output_tokens+?,updated_at=? WHERE id=? AND attempt=?').run(result.usage.input,result.usage.output,clock(),run.id,run.attempt);db.prepare('UPDATE thesis_checkpoints SET input_tokens=input_tokens+?,output_tokens=output_tokens+?,updated_at=? WHERE run_id=? AND unit_id=?').run(result.usage.input,result.usage.output,clock(),run.id,unit.id);});
     accounted=true;
     if(!running()){if(reservation){transaction(()=>continuity.finish(reservation.id,{usage:result.usage,costUsd:result.costUsd,errorCode:'cancelled'}));finishedReservation=true;}return;}
     if(!continuous&&spent+result.usage.input+result.usage.output>limits.maxRunTokens)throw thesisError(429,'模型实际用量达到本次预算上限，当前输出未作为完整章节提交，请确认后续跑','budget_exceeded');
     const content=parseThesisSection(result,snapshot,unit);
     const saved=writeRunning(()=>{
      if(reservation){const settled=continuity.finish(reservation.id,{usage:result?.usage,costUsd:result?.costUsd});if(settled.budgetExceeded)throw Object.assign(thesisError(429,'本次生成达到执行预算，已保留完成章节','budget_exceeded'),{usage:result?.usage});}
      assertThesisAccountQuota(db,run.user_id,Math.max(512,Buffer.byteLength(content.text)+Buffer.byteLength(JSON.stringify(content.figures||[]))+Buffer.byteLength(JSON.stringify(content.missingEvidence||[]))+Buffer.byteLength(JSON.stringify(cleanTrace(result.trace))))-Math.max(512,Buffer.byteLength(checkpoint.text)+Buffer.byteLength(checkpoint.figures||'[]')+Buffer.byteLength(checkpoint.missing_evidence||'[]')+Buffer.byteLength(checkpoint.trace)),config);
      db.prepare("UPDATE thesis_checkpoints SET status='completed',text=?,source_ids=?,missing_evidence=?,figures=?,error=NULL,engine=?,model=?,trace=?,updated_at=? WHERE run_id=? AND unit_id=? AND status='running'").run(content.text,JSON.stringify(content.sourceIds),JSON.stringify(content.missingEvidence||[]),JSON.stringify(content.figures||[]),runtime.engine||'claude-agent-sdk',runtime.model,JSON.stringify(cleanTrace(result.trace)),clock(),run.id,unit.id);
      const chapterUnits=db.prepare('SELECT * FROM thesis_checkpoints WHERE run_id=? AND chapter_id=? ORDER BY position').all(run.id,unit.chapterId);
      if(!fullCompletion&&chapterUnits.every(row=>row.status==='completed')&&!db.prepare("SELECT id FROM thesis_chapter_versions WHERE run_id=? AND chapter_id=? AND source='generated'").get(run.id,unit.chapterId)){
       const previous=db.prepare('SELECT coalesce(max(version),0) version FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=?').get(run.thesis_id,unit.chapterId).version;
       const text=chapterUnits.map(row=>{const part=plan.find(item=>item.id===row.unit_id);return `${part.part===1&&part.title!==part.chapterTitle?part.title+'\n\n':''}${row.text}`;}).join('\n\n');
       const sources=[...new Set(chapterUnits.flatMap(row=>JSON.parse(row.source_ids)))],figures=chapterUnits.flatMap(row=>JSON.parse(row.figures||'[]'));
       assertThesisChapterCapacity(db,run.thesis_id,unit.chapterId);assertThesisAccountQuota(db,run.user_id,Math.max(512,Buffer.byteLength(text)+Buffer.byteLength(JSON.stringify(figures))),config);
       db.prepare('INSERT INTO thesis_chapter_versions(id,thesis_id,chapter_id,version,run_id,source,text,source_ids,created_at,figures) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),run.thesis_id,unit.chapterId,previous+1,run.id,'generated',text,JSON.stringify(sources),clock(),JSON.stringify(figures));
      }
      db.prepare('UPDATE theses SET version=version+1,updated_at=? WHERE id=? AND current_run_id=?').run(clock(),run.thesis_id,run.id);
     });
     if(!saved){if(reservation)transaction(()=>continuity.finish(reservation.id,{usage:result?.usage,costUsd:result?.costUsd,errorCode:'cancelled'}));return;}
     finishedReservation=Boolean(reservation);
     break;
    }catch(error){
     if(result?.usage&&!error.usage)error.usage=result.usage;
     if(reservation&&!finishedReservation){const finished=transaction(()=>continuity.finish(reservation.id,{usage:error.usage,costUsd:result?.costUsd??error.costUsd,errorCode:error.code}));settledDispatch=finished;if(finished.budgetExceeded)error=Object.assign(thesisError(429,'本次生成达到执行预算，已保留完成章节','budget_exceeded'),{usage:error.usage});}
     if(!accounted&&dispatched){const usage=error.usage;writeAttempt(()=>{if(knownUsage(usage)){db.prepare('UPDATE thesis_runs SET input_tokens=input_tokens+?,output_tokens=output_tokens+? WHERE id=? AND attempt=?').run(usage.input,usage.output,run.id,run.attempt);db.prepare('UPDATE thesis_checkpoints SET input_tokens=input_tokens+?,output_tokens=output_tokens+? WHERE run_id=? AND unit_id=?').run(usage.input,usage.output,run.id,unit.id);}else db.prepare('UPDATE thesis_runs SET usage_known=0 WHERE id=? AND attempt=?').run(run.id,run.attempt);});}
     const retry=classifyThesisRetry(error,{settledDispatch});
     if(continuous&&!stopped&&running()&&retries<2&&retry.retryable&&(retry.reason!=='funded_denied_external_tool'||deniedToolRetries===0)){if(retry.reason==='funded_denied_external_tool')deniedToolRetries++;retries++;retryCandidate=error.retryCandidate||retryCandidate;minimumTokens=Math.max(minimumTokens,retry.minimumTokens||0);stage('auto_recovering');continue;}
     writeRunning(()=>{const validation=safeThesisValidation(error.lastValidation)||safeThesisValidation(retryFeedback),diagnostics=[...failureDiagnostics(error),...(validation?[{stage:'candidate_rejected',validation}]:[])];db.prepare("UPDATE thesis_checkpoints SET status='failed',error=?,missing_evidence=?,trace=CASE WHEN ?='[]' THEN trace ELSE ? END,updated_at=? WHERE run_id=? AND unit_id=? AND status!='completed'").run(thesisPublicError(error,runtime),JSON.stringify(error.missingEvidence||[]),JSON.stringify(diagnostics),JSON.stringify(diagnostics),clock(),run.id,unit.id);});
     throw error;
    }
    }
   }
   if(!running())return;
   const meta=JSON.parse(run.settings_meta||'{}');let quality=null;
   if(meta.qualityReview===true&&config.writingQualityEnabled!==false){
    const checkpoints=db.prepare("SELECT * FROM thesis_checkpoints WHERE run_id=? AND status='completed' ORDER BY position").all(run.id),reviewChapters=checkpoints.map(row=>{const unit=plan.find(unit=>unit.id===row.unit_id);return{id:'section-'+row.position,title:unit.chapterTitle===unit.title?unit.title:unit.chapterTitle+' · '+unit.title,text:row.text,sourceIds:JSON.parse(row.source_ids),figures:JSON.parse(row.figures||'[]')};});
    if(completionMode)reviewChapters.splice(0,reviewChapters.length,...completionReviewChapters());
    const referenceText=compileThesisReferences(snapshot,[...new Set(checkpoints.flatMap(row=>JSON.parse(row.source_ids)))]),pendingReferenceBytes=referenceText?snapshot.outline.filter(isThesisReferenceChapter).filter(chapter=>!db.prepare("SELECT 1 FROM thesis_chapter_versions WHERE run_id=? AND chapter_id=? AND source='generated'").get(run.id,chapter.id)).length*Math.max(512,Buffer.byteLength(referenceText)):0;
    if(fullCompletion){
     // Start a fresh set of checks on recovery; only independently validated
     // exact-input batch checkpoints may be reused by reviewDispatch.
     let pass=0,existing=null;
     for(;pass<=2;pass++){
      quality=existing||await qualityRunner({snapshot,kind:'thesis',checkSupplements,recoverSupplements:true,chapters:completionReviewChapters(),docxObjects:thesisDocxObjects(db,run.thesis_id,run.user_id,completionReviewChapters()),runtime,runId:run.id,signal:controller.signal,onStage:stage,isCurrent:running,dispatch:args=>reviewDispatch({...args,unitId:'completion-quality-'+pass+'::'+args.unitId+'::draft-'+completionManuscriptHash(completionReviewChapters()).slice(0,16)})});existing=null;
      if(diagnosis)quality.completionDiagnosis=diagnosis;
      quality.completionAudit=completionContentAudit(snapshot,completionReviewChapters(),quality,db.prepare('SELECT export_metadata FROM theses WHERE id=?').get(run.thesis_id));
      quality.completionPass=pass;quality.manuscriptHash=completionManuscriptHash(completionReviewChapters());
      if(!writeRunning(()=>{const json=JSON.stringify(quality),previous=db.prepare("SELECT length(CAST(coalesce(quality,'') AS BLOB)) bytes FROM thesis_runs WHERE id=?").get(run.id).bytes;assertThesisAccountQuota(db,run.user_id,Math.max(0,Buffer.byteLength(json)-previous),config);db.prepare('UPDATE thesis_runs SET quality=?,updated_at=? WHERE id=? AND attempt=?').run(json,clock(),run.id,run.attempt);}))return;
      if(pass===2)break;
      const current=db.prepare("SELECT * FROM thesis_checkpoints WHERE run_id=? AND status='completed' ORDER BY position").all(run.id),repairs=completionRepairs(snapshot,plan,current,quality,pass,{expressionOnly:quality.coverage?.complete!==true||quality.supplementCheck?.coverage?.complete!==true});
      let repaired=current.some(row=>JSON.parse(row.trace||'[]').some(entry=>entry.stage==='completion_repair_'+pass)),repairStopped=false;
      for(const {unit,checkpoint,task,unitId,expressionOnly,sourceSupport}of repairs){
       stage('repairing_completion');let result;
       try{if(expressionOnly){
        // The accepted edit is already a fixed, uniquely located substitution;
        // use the same strict validator directly rather than asking a model to
        // rediscover it. The subsequent independent review remains mandatory.
        const edits=task.context.revision.findings.map(({quote})=>({old:quote,new:safeExpressionReplacement(quote)}));
        result=normalizeExpressionPatch({text:JSON.stringify({complete:true,edits}),trace:[]},checkpoint,task.context.revision.findings);
        const verified=validateThesisCandidate(result,snapshot,unit);if(verified.valid!==true)throw thesisError(502,'表达修正未通过正文检查，原稿已保留。','invalid_output');
       }else result=await reviewDispatch({task,settings:{...runtime,maxTurns:Math.min(12,Math.max(6,runtime.maxTurns||3)),maxOutputTokens:Math.min(16384,runtime.maxOutputTokens||4096)},validateThesisOutput:candidate=>{try{const normalized=sourceSupport?normalizeSourceRepair(candidate,checkpoint,task.context.revision.findings[0],snapshot,task):candidate;const result=validateThesisCandidate(normalized,snapshot,unit);if(result.valid!==true||!sourceSupport)return result;assertExpressionRepairUnchanged(checkpoint,parseThesisSection(normalized,snapshot,unit));return {...result,normalizedText:normalized.text,normalizedTrace:normalized.trace};}catch(error){const allowed=new Set(['location','format','shape','evidence','read','quotation','research_status','protected_content']),code=sourceSupport&&allowed.has(error.repairReason)?'source_repair_'+error.repairReason:sourceSupport?'source_repair_integrity':'expression_integrity';return{valid:false,feedback:{code,rule:error.message}};}},unitId});}
       catch(error){if(!running()||stopped)throw error;
        // Operational-only diagnostic: no excerpts, model messages or tool args.
        const allowedCodes=new Set(['source_repair_integrity','source_repair_location','source_repair_format','source_repair_shape','source_repair_evidence','source_repair_read','source_repair_quotation','source_repair_research_status','source_repair_protected_content','expression_integrity','invalid_output','invalid_review_output','turn_limit','timeout','cost_budget','budget_exceeded','runtime_error']);
        const counts={};for(const row of Array.isArray(error.agentTrace)?error.agentTrace:[]){const code=row?.validation?.code;if(allowedCodes.has(code))counts[code]=(counts[code]||0)+1;}
        const diagnostic={stage:'completion_repair_failed',repairType:expressionOnly?'expression':sourceSupport?'source_support':'other',errorCode:allowedCodes.has(error.code)?error.code:'other',rejections:counts};
        writeRunning(()=>{const prior=JSON.parse(checkpoint.trace||'[]');const trace=JSON.stringify([...prior.slice(-49),diagnostic]);assertThesisAccountQuota(db,run.user_id,Math.max(0,Buffer.byteLength(trace)-Buffer.byteLength(checkpoint.trace||'[]')),config);db.prepare('UPDATE thesis_checkpoints SET trace=?,updated_at=? WHERE run_id=? AND unit_id=?').run(trace,clock(),run.id,unit.id);});
        throw thesisError(502,'自动修改未完成，原稿和已处理内容已保留，本次未扣费。','repair_incomplete');}
       const content=parseThesisSection(result,snapshot,unit);if(expressionOnly||sourceSupport)assertExpressionRepairUnchanged(checkpoint,content);
       if(!writeRunning(()=>{const figures=JSON.stringify(content.figures||[]),trace=JSON.stringify([...cleanTrace(result.trace),{stage:'completion_repair_'+pass}]);assertThesisAccountQuota(db,run.user_id,Math.max(0,Buffer.byteLength(content.text)+Buffer.byteLength(figures)+Buffer.byteLength(trace)-Buffer.byteLength(checkpoint.text)-Buffer.byteLength(checkpoint.figures||'[]')-Buffer.byteLength(checkpoint.trace||'[]')),config);db.prepare('UPDATE thesis_checkpoints SET text=?,source_ids=?,missing_evidence=?,figures=?,trace=?,updated_at=? WHERE run_id=? AND unit_id=?').run(content.text,JSON.stringify(content.sourceIds),JSON.stringify(content.missingEvidence||[]),figures,trace,clock(),run.id,unit.id);db.prepare('UPDATE theses SET version=version+1,updated_at=? WHERE id=? AND current_run_id=?').run(clock(),run.thesis_id,run.id);}))return;
       repaired=true;
      }
      if(repairStopped||!repaired)break;
     }
     // A failed repair must not make its previous checks current for new text.
     if(quality.manuscriptHash!==completionManuscriptHash(completionReviewChapters())){quality.coverage={...quality.coverage,complete:false};quality.status='partial';}
    }else quality=await qualityRunner({snapshot,kind:'thesis',checkSupplements,chapters:reviewChapters,docxObjects:thesisDocxObjects(db,run.thesis_id,run.user_id,reviewChapters),runtime,runId:run.id,signal:controller.signal,onStage:stage,isCurrent:running,dispatch:reviewDispatch});
    if(completionMode&&quality)quality.manuscriptHash=completionManuscriptHash(completionReviewChapters());
    if(!writeRunning(()=>{const previous=db.prepare("SELECT length(CAST(coalesce(quality,'') AS BLOB)) bytes FROM thesis_runs WHERE id=? AND attempt=?").get(run.id,run.attempt).bytes;const saved=fitOptionalWritingQuality(quality,{build:candidate=>candidate?JSON.stringify(candidate):null,check:json=>assertThesisAccountQuota(db,run.user_id,Math.max(0,(json?Buffer.byteLength(json):0)-previous+pendingReferenceBytes),config)});quality=saved.quality;db.prepare('UPDATE thesis_runs SET quality=?,updated_at=? WHERE id=? AND attempt=?').run(saved.value,clock(),run.id,run.attempt);}))return;
   }
   writeRunning(()=>{
    const checkpoints=db.prepare('SELECT * FROM thesis_checkpoints WHERE run_id=? ORDER BY position').all(run.id);
    if(checkpoints.length!==plan.length||checkpoints.some(row=>row.status!=='completed'))throw thesisError(409,'章节尚未全部完成，未将任务标为成功');
    if(fullCompletion)for(const {record,...chapter}of manuscriptVersions())if(targetChapters.has(chapter.id)&&record&&!db.prepare("SELECT 1 FROM thesis_chapter_versions WHERE run_id=? AND chapter_id=? AND source='generated'").get(run.id,chapter.id)){
     assertThesisChapterCapacity(db,run.thesis_id,chapter.id);assertThesisAccountQuota(db,run.user_id,Math.max(512,Buffer.byteLength(record.text)+Buffer.byteLength(record.figures||'[]')),config);
     const previous=db.prepare('SELECT coalesce(max(version),0) version FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=?').get(run.thesis_id,chapter.id).version;
     db.prepare('INSERT INTO thesis_chapter_versions(id,thesis_id,chapter_id,version,run_id,source,text,source_ids,created_at,figures) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),run.thesis_id,chapter.id,previous+1,run.id,'generated',record.text,record.source_ids,clock(),record.figures||'[]');
    }
    const sourceChapters=completionMode?completionReviewChapters():checkpoints;const usedSources=[...new Set(sourceChapters.flatMap(row=>[...row.text.matchAll(/\[source:([^\]]+)\]/g)].map(match=>match[1])))],bibliography=compileThesisReferences(snapshot,usedSources);
    for(const chapter of snapshot.outline.filter(isThesisReferenceChapter))if(bibliography&&!db.prepare("SELECT id FROM thesis_chapter_versions WHERE run_id=? AND chapter_id=? AND source='generated'").get(run.id,chapter.id)){
     assertThesisChapterCapacity(db,run.thesis_id,chapter.id);assertThesisAccountQuota(db,run.user_id,Math.max(512,Buffer.byteLength(bibliography)),config);
     const previous=db.prepare('SELECT coalesce(max(version),0) version FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=?').get(run.thesis_id,chapter.id).version;
     db.prepare('INSERT INTO thesis_chapter_versions(id,thesis_id,chapter_id,version,run_id,source,text,source_ids,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),run.thesis_id,chapter.id,previous+1,run.id,'generated',bibliography,JSON.stringify(snapshot.references.filter(row=>row.confirmed&&usedSources.includes(row.id)).map(row=>row.id)),clock());
    }
    const completionRecords=completionMode?manuscriptVersions():null;const chapters=snapshot.outline.map(chapter=>{const personal=snapshot.requirements.deliveryVersion===1&&thesisManualBackMatter(chapter),version=completionMode?completionRecords.find(row=>row.id===chapter.id)?.record:personal?db.prepare('SELECT * FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=? ORDER BY version DESC LIMIT 1').get(run.thesis_id,chapter.id):db.prepare("SELECT * FROM thesis_chapter_versions WHERE run_id=? AND chapter_id=? AND source='generated'").get(run.id,chapter.id);if(!version&&!isThesisReferenceChapter(chapter)&&!personal)throw thesisError(409,'章节检查点尚未完整保存');return {...chapter,text:version?.text||'',sourceIds:version?JSON.parse(version.source_ids):[],figures:version?JSON.parse(version.figures||'[]'):[],source:isThesisReferenceChapter(chapter)?'confirmed_reference_list':'agent_draft'};});
    const suggestion=thesisFullText(snapshot,chapters),resultId=randomUUID(),at=clock(),totals=db.prepare('SELECT input_tokens,output_tokens,usage_known FROM thesis_runs WHERE id=?').get(run.id);
    const checkIncomplete=fullCompletion&&meta.completion?.purpose!=='draft'&&(!quality||quality.status!=='completed'||quality.coverage?.complete!==true||quality.supplementCheck?.coverage?.complete!==true||(quality.figureReview&&quality.figureReview.status!=='completed')||(quality.completionAudit?.issues||[]).some(issue=>['review_not_run','review_partial','review_stale','figure_review'].includes(issue.code)));
    // A complete review that found real remaining gaps is still useful work
    // when it saved a substantive revision. A no-op is not a paid revision.
    const noCompletionChange=fullCompletion&&meta.completion?.purpose!=='draft'&&!hasCompletionChanges(chapters,savedBaseline,targetChapters);
    if(checkIncomplete||noCompletionChange)billing.release(run.id);else billing.settle(run.id);
    db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run(resultId,run.user_id,db.prepare('SELECT project_id FROM theses WHERE id=?').get(run.thesis_id).project_id,run.id,'agent',snapshot.title,JSON.stringify({original:'',suggestion,thesisId:run.thesis_id,engine:runtime.engine||'claude-agent-sdk',model:runtime.model,settingsVersion:run.settings_version,...(quality?{quality}:{}),chapters:chapters.map(({id,title,text,sourceIds,figures,source})=>({id,title,text,sourceIds,figures,source})),materials:snapshot.materials.filter(row=>row.confirmed).map(({id,name})=>({id,name})),references:snapshot.references.filter(row=>row.confirmed).map(thesisReferenceMetadata),bibliography:buildThesisBibliography(snapshot,chapters),trace:checkpoints.flatMap(row=>JSON.parse(row.trace)).slice(-100),referenceListIncomplete:(snapshot.outline.some(isThesisReferenceChapter)||snapshot.references.some(row=>row.confirmed))&&!bibliography,missingEvidence:[...new Set(checkpoints.flatMap(row=>JSON.parse(row.missing_evidence||'[]')))],draft:true,requiresReview:true}),at);
    db.prepare('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),run.user_id,run.id,runtime.engine||'claude-agent-sdk',runtime.model,totals.usage_known?totals.input_tokens:null,totals.usage_known?totals.output_tokens:null,billing.isBillable(run.id)?1:0,at);
    db.prepare("UPDATE thesis_runs SET status='completed',stage='completed',error=NULL,result_id=?,updated_at=? WHERE id=? AND attempt=?").run(resultId,at,run.id,run.attempt);
    db.prepare("UPDATE jobs SET status='completed',stage='completed',error=NULL,result_id=?,updated_at=? WHERE id=? AND attempt=?").run(resultId,at,run.id,run.attempt);
    db.prepare("UPDATE theses SET status='completed',version=version+1,updated_at=? WHERE id=? AND current_run_id=?").run(at,run.thesis_id,run.id);
   });
  }catch(error){
   if(stopped&&continuous){const requeued=transaction(()=>requeue(run));if(requeued)return;}
   const status=stopped?'interrupted':error.code==='needs_materials'?'needs_materials':'failed',message=stopped?'服务停止中断了任务；已完成章节已保存，预占权益已释放':thesisPublicError(error,runtime);
   transaction(()=>markStopped(run.id,run.attempt,status,message));
  }finally{if(stopped&&continuous)transaction(()=>{if(ownsAttempt(run)&&db.prepare("SELECT 1 FROM thesis_runs WHERE id=? AND attempt=? AND status='running'").get(run.id,run.attempt)&&!requeue(run))markStopped(run.id,run.attempt,'interrupted','服务维护中断了任务，已保留完成章节，请确认后继续');});if(controllers.get(run.id)?.controller===controller)controllers.delete(run.id);busy=false;}
 }
 function tick(){if(busy||stopped)return Promise.resolve();currentPromise=execute();return currentPromise;}
 const timer=setInterval(()=>void tick(),Math.max(100,config.thesisPollMs||1000));timer.unref();
 return {tick,cancel(id){const execution=controllers.get(id),attempt=execution?.attempt??db.prepare('SELECT attempt FROM thesis_runs WHERE id=?').get(id)?.attempt;transaction(()=>markStopped(id,attempt,'cancelled','用户取消了任务，已完成章节已保存，预占权益已释放'));execution?.controller.abort();},async stop(){stopped=true;clearInterval(timer);for(const {controller}of controllers.values())controller.abort();await currentPromise;},async close(){await this.stop();}};
}
