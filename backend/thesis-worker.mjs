import {runSupplementCheck} from './supplement-check.mjs';
import {completionBaseline,completionManuscriptHash} from './thesis-completion.mjs';
import {randomUUID} from 'node:crypto';
import {buildThesisBibliography,thesisReferenceMetadata} from '../dist/workspace/thesis-document.mjs';
import {createBillingService} from './billing-service.mjs';
import {createModelBudget} from './model-budget.mjs';
import {initializeThesisSchema,thesisAgentTask,parseThesisSection,validateThesisCandidate,thesisFullText,thesisLimits,thesisHash,thesisError,thesisPublicError,thesisTransaction,assertThesisAccountQuota,assertThesisChapterCapacity,isThesisReferenceChapter,compileThesisReferences} from './thesis-model.mjs';
import {assertThesisSettings} from './thesis-service.mjs';
import {runAgentTask} from './agent-runtime.mjs';
import {createThesisContinuity} from './thesis-continuity.mjs';
import {classifyThesisRetry} from './thesis-execution-policy.mjs';
import {createWritingQualityRunner} from './writing-quality-runner.mjs';
import {fitOptionalWritingQuality} from './writing-quality-storage.mjs';
import {thesisManualBackMatter} from '../dist/workspace/thesis-delivery.mjs';

const active=status=>status==='running'||status==='queued';
const validUsage=value=>Number.isSafeInteger(value)&&value>=0;
const knownUsage=usage=>validUsage(usage?.input)&&validUsage(usage?.output)&&Number.isSafeInteger(usage.input+usage.output)&&usage.input+usage.output>0;
const safeStage=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,60}$/i.test(value)?value:'agent_running';
const cleanTrace=value=>(Array.isArray(value)?value:[]).slice(-50).map(row=>({stage:safeStage(typeof row==='string'?row:row?.stage||row?.tool||row?.type),...(row?.tool==='read_material'&&row.status==='completed'&&typeof row.materialId==='string'?{tool:'read_material',status:'completed',materialId:row.materialId.slice(0,100)}:{})}));

// Denied tool names are operational diagnostics. Keep neither arguments nor
// content, and omit the public tool field so account archives project them out.
const failureDiagnostics=error=>(Array.isArray(error?.agentTrace)?error.agentTrace:[]).filter(row=>row?.status==='denied'&&typeof row.tool==='string'&&/^[A-Za-z_][A-Za-z0-9_-]{0,119}$/.test(row.tool)).slice(-2).map(row=>({stage:'tool_denied',status:'denied',requestedTool:row.tool,code:error.code==='permission_denied'?'permission_denied':'unauthorized_tool'}));

export function startThesisWorker(db,config={}){
 initializeThesisSchema(db);
 const billing=config.billing||createBillingService(db,config),modelBudget=config.modelBudget||createModelBudget(db,config),limits=thesisLimits(config);
 const continuity=createThesisContinuity(db,config),qualityRunner=createWritingQualityRunner(config);
 const clock=()=>new Date(config.thesisNow?.()??Date.now()).toISOString();
 let busy=false,stopped=false,currentPromise=null;const controllers=new Map();
 const transaction=fn=>thesisTransaction(db,fn);
 const isContinuous=run=>config.thesisContinuousEnabled!==false&&JSON.parse(run.settings_meta||'{}').continuous===true;
 // An explicit resume keeps the run ID but replaces its execution attempt.
 // Every callback retains the attempt it claimed, never the latest row's identity.
 const ownsAttempt=run=>Boolean(run&&db.prepare('SELECT 1 FROM thesis_runs r JOIN jobs j ON j.id=r.id JOIN theses t ON t.id=r.thesis_id WHERE r.id=? AND r.user_id=? AND r.attempt=? AND j.user_id=r.user_id AND t.current_run_id=r.id').get(run.id,run.user_id,run.attempt));
 function requeue(run){
  if(!ownsAttempt(run)||!isContinuous(run))return false;
  const job=db.prepare('SELECT status FROM jobs WHERE id=?').get(run.id);
  if(job?.status!=='running'||!db.prepare("SELECT 1 FROM thesis_runs WHERE id=? AND attempt=? AND status='running'").get(run.id,run.attempt)||!db.prepare("SELECT 1 FROM billing_reservations WHERE job_id=? AND attempt=? AND user_id=? AND status='held'").get(run.id,run.attempt,run.user_id))return false;
  const recovered=continuity.recover(run);if(recovered.recoveredDispatches>0)db.prepare('UPDATE thesis_runs SET usage_known=0 WHERE id=? AND attempt=?').run(run.id,run.attempt);if(!recovered.ready)return false;
  const at=clock();db.prepare("UPDATE thesis_runs SET status='queued',stage='auto_recovering',error=NULL,updated_at=? WHERE id=? AND attempt=? AND status='running'").run(at,run.id,run.attempt);db.prepare("UPDATE jobs SET status='queued',stage='auto_recovering',error=NULL,updated_at=? WHERE id=? AND status='running'").run(at,run.id);db.prepare("UPDATE thesis_checkpoints SET status='pending',error=NULL,updated_at=? WHERE run_id=? AND status='running'").run(at,run.id);db.prepare("UPDATE theses SET status='queued',version=version+1,updated_at=? WHERE id=? AND current_run_id=?").run(at,run.thesis_id,run.id);return true;
 }
 function markStopped(runId,attempt,status,message){
  if(!Number.isSafeInteger(attempt)||attempt<1)return;
  const run=db.prepare('SELECT * FROM thesis_runs WHERE id=? AND attempt=?').get(runId,attempt);if(!run||!active(run.status)||!ownsAttempt(run))return;
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
    db.prepare("UPDATE theses SET status='running',version=version+1,updated_at=? WHERE id=? AND current_run_id=?").run(clock(),run.thesis_id,run.id);modelBudget.start(run.id,run.attempt);return true;});
   if(!claimed)return;
   assertThesisSettings(await config.getAgentSettings?.());
   runtime=assertThesisSettings(await config.getAgentSettings?.(run.settings_version));
   if(!running())return;
   if(runtime.version!==run.settings_version)throw thesisError(503,'原生成配置版本不可用，请联系管理员');
   const snapshot=JSON.parse(run.snapshot),plan=JSON.parse(run.plan),baseline=run.input_tokens+run.output_tokens;
   const savedBaseline=completionBaseline(db,run),completionMode=Boolean(JSON.parse(run.settings_meta||'{}').completion),targetChapters=new Set(plan.map(unit=>unit.chapterId));
   const manuscriptVersions=()=>snapshot.outline.map(chapter=>{const generated=db.prepare("SELECT * FROM thesis_chapter_versions WHERE run_id=? AND chapter_id=? AND source='generated' ORDER BY version DESC LIMIT 1").get(run.id,chapter.id);return {...chapter,record:generated||(!targetChapters.has(chapter.id)?savedBaseline.find(row=>row.chapter_id===chapter.id):null)};});
   const completionReviewChapters=()=>{const versions=manuscriptVersions(),used=[...new Set(versions.flatMap(row=>[...(row.record?.text||'').matchAll(/\[source:([^\]]+)\]/g)].map(match=>match[1])))],references=compileThesisReferences(snapshot,used);return versions.map(row=>({id:row.id,title:row.title,text:isThesisReferenceChapter(row)?references:row.record?.text||'',sourceIds:row.record?JSON.parse(row.record.source_ids):[],figures:row.record?JSON.parse(row.record.figures||'[]'):[]}));};

   if(continuous&&!writeRunning(()=>continuity.ensure(run,snapshot,plan,runtime)))return;
   const checkSupplements=config.supplementCheckEnabled===true&&JSON.parse(run.settings_meta||'{}').supplementCheck===true;
   const runner=config.agentTaskRunner||runAgentTask;
   if(typeof runner!=='function')throw thesisError(503,'毕业论文 Agent 执行器尚未接入');
   const reviewDispatch=async({task,settings,validateReviewOutput,unitId})=>{
     if(!running()||stopped)throw thesisError(499,'任务已停止','cancelled');
     const hash=thesisHash(task),cached=db.prepare('SELECT task_hash,result FROM thesis_review_checkpoints WHERE run_id=? AND attempt=? AND unit_id=?').get(run.id,run.attempt,unitId);
     if(cached){if(cached.task_hash!==hash)throw thesisError(409,'审校资料已变化','review_changed');return JSON.parse(cached.result);}
     if(!continuous)throw thesisError(429,'本次未配置审校执行预算','budget_exceeded');
     assertThesisSettings(await config.getAgentSettings?.());
     if(!running()||stopped)throw thesisError(499,'任务已停止或执行批次已变化','cancelled');
     const reservation=transaction(()=>continuity.reserve(run,unitId,{remainingUnits:1,settings:runtime,kind:'review'}));let output,accounted=false;
     const account=usage=>writeAttempt(()=>{if(knownUsage(usage))db.prepare('UPDATE thesis_runs SET input_tokens=input_tokens+?,output_tokens=output_tokens+?,updated_at=? WHERE id=? AND attempt=?').run(usage.input,usage.output,clock(),run.id,run.attempt);else db.prepare('UPDATE thesis_runs SET usage_known=0 WHERE id=? AND attempt=?').run(run.id,run.attempt);});
     try{
      if(!writeRunning(()=>db.prepare('UPDATE thesis_runs SET provider_calls=provider_calls+1 WHERE id=? AND attempt=?').run(run.id,run.attempt)))throw thesisError(499,'任务已停止或执行批次已变化','cancelled');
      output=await runner({settings:{...settings,maxTotalTokens:reservation.maxTotalTokens,maxCostUsd:reservation.maxCostUsd},task,validateReviewOutput,signal:controller.signal,onStage:()=>stage(task.context.operation==='supplement-check'?'checking_supplements':'reviewing_manuscript')});
      account(output?.usage);accounted=true;
      if(!knownUsage(output?.usage))throw thesisError(502,'审校未返回可核算用量','usage_unknown');
      if(!running()||stopped)throw thesisError(499,'任务已停止','cancelled');
      const validation=await validateReviewOutput(output);if(validation?.valid!==true)throw thesisError(502,'审校内容未通过定位检查','invalid_review_output');
      if(!writeRunning(()=>{const finished=continuity.finish(reservation.id,{usage:output.usage,costUsd:output.costUsd});if(finished.budgetExceeded)throw thesisError(429,'审校达到执行预算','budget_exceeded');const saved=JSON.stringify({text:output.text,trace:[],usage:output.usage});assertThesisAccountQuota(db,run.user_id,Buffer.byteLength(saved),config);db.prepare('INSERT INTO thesis_review_checkpoints VALUES(?,?,?,?,?,?)').run(run.id,run.attempt,unitId,hash,saved,clock());}))throw thesisError(499,'任务已停止或执行批次已变化','cancelled');
      return output;
     }catch(error){if(!accounted)account(error.usage);transaction(()=>continuity.finish(reservation.id,{usage:output?.usage||error.usage,costUsd:output?.costUsd??error.costUsd,errorCode:error.code||'execution_failed'}));throw error;}
    };
   if(checkSupplements&&completionMode){
    const chapters=snapshot.outline.map(chapter=>({id:chapter.id,title:chapter.title,text:savedBaseline.find(row=>row.chapter_id===chapter.id)?.text||'本节尚未生成，按已确认的章节目的核对所需资料。'}));
    const supplementCheck=await runSupplementCheck({snapshot,chapters,kind:'thesis',phase:'materials',runtime,dispatch:reviewDispatch,signal:controller.signal,isCurrent:running,onStage:stage});
    if(!writeRunning(()=>{const json=JSON.stringify({status:'partial',supplementCheck,manuscriptHash:completionManuscriptHash(chapters)});assertThesisAccountQuota(db,run.user_id,Buffer.byteLength(json),config);db.prepare('UPDATE thesis_runs SET quality=?,updated_at=? WHERE id=? AND attempt=?').run(json,clock(),run.id,run.attempt);}))return;
    if(supplementCheck.status!=='materials_ready')throw thesisError(422,supplementCheck.status==='needs_materials'?'补充资料仍有缺项，请查看补充内容检查；原稿与已上传资料已保留。':'补充资料检查尚未完成，请稍后重试；原稿与材料已保留。','needs_materials');
   }
   for(const unit of plan){
    let retries=0,minimumTokens=0;
    while(true){
    if(stopped)throw thesisError(503,'服务停止中断了任务');
    if(!running())return;
    const checkpoint=db.prepare('SELECT * FROM thesis_checkpoints WHERE run_id=? AND unit_id=?').get(run.id,unit.id);if(checkpoint.status==='completed')break;
    assertThesisSettings(await config.getAgentSettings?.());
    if(!running())return;
    const complete=db.prepare("SELECT * FROM thesis_checkpoints WHERE run_id=? AND status='completed' ORDER BY position").all(run.id);
    const contextSections=completionMode?[...savedBaseline.filter(row=>!targetChapters.has(row.chapter_id)).map(row=>({...row,unit_id:'saved::'+row.chapter_id})),...complete]:complete;const task=thesisAgentTask(snapshot,unit,contextSections),maxTurns=Math.min(continuous?12:6,Math.max(1,Number(runtime.maxTurns)||3)),maxOutputTokens=Math.min(continuous?16384:8000,Math.max(32,Number(runtime.maxOutputTokens)||4096));
    if(retries)task.instructions+='上一次输出未通过本节校验。本次按既定字数范围一次提交紧凑、完整的候选；不要重复字数检查后再输出全文，不追求精确等于目标，不编造依据。';
    // The runtime relay enforces maxTotalTokens against the complete actual SDK
    // request, including system instructions, tool schemas and growing history.
    const totals=db.prepare('SELECT input_tokens,output_tokens FROM thesis_runs WHERE id=?').get(run.id),spent=totals.input_tokens+totals.output_tokens-baseline;
    if(!continuous&&spent+maxOutputTokens>=limits.maxRunTokens)throw thesisError(429,'本次生成已达到模型预算边界，已保留完成章节；请确认新报价后续跑','budget_exceeded');
    if(!writeRunning(()=>{db.prepare("UPDATE thesis_checkpoints SET status='running',error=NULL,updated_at=? WHERE run_id=? AND unit_id=? AND status!='completed'").run(clock(),run.id,unit.id);const step=unit.frontMatter?'generating_abstracts':'generating_section';db.prepare('UPDATE thesis_runs SET stage=?,updated_at=? WHERE id=? AND attempt=?').run(step,clock(),run.id,run.attempt);db.prepare('UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND attempt=?').run(step,clock(),run.id,run.attempt);}))return;
    let result,accounted=false,reservation=null,dispatched=false,finishedReservation=false;
    try{
     if(continuous)reservation=transaction(()=>continuity.reserve(run,unit.id,{remainingUnits:plan.length-complete.length,settings:runtime,minimumTokens}));
     if(!writeRunning(()=>db.prepare('UPDATE thesis_runs SET provider_calls=provider_calls+1 WHERE id=? AND attempt=?').run(run.id,run.attempt)))throw thesisError(499,'任务已停止或执行批次已变化','cancelled');
     dispatched=true;result=await runner({settings:{...runtime,maxTurns,maxOutputTokens,...(reservation?{maxTotalTokens:reservation.maxTotalTokens,maxCostUsd:reservation.maxCostUsd}:{maxTotalTokens:limits.maxRunTokens-spent})},task,validateThesisOutput:candidate=>validateThesisCandidate(candidate,snapshot,unit),signal:controller.signal,onStage:stage});
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
      if(chapterUnits.every(row=>row.status==='completed')&&!db.prepare("SELECT id FROM thesis_chapter_versions WHERE run_id=? AND chapter_id=? AND source='generated'").get(run.id,unit.chapterId)){
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
     if(reservation&&!finishedReservation){const finished=transaction(()=>continuity.finish(reservation.id,{usage:error.usage,costUsd:result?.costUsd??error.costUsd,errorCode:error.code}));if(finished.budgetExceeded)error=Object.assign(thesisError(429,'本次生成达到执行预算，已保留完成章节','budget_exceeded'),{usage:error.usage});}
     if(!accounted&&dispatched){const usage=error.usage;writeAttempt(()=>{if(knownUsage(usage)){db.prepare('UPDATE thesis_runs SET input_tokens=input_tokens+?,output_tokens=output_tokens+? WHERE id=? AND attempt=?').run(usage.input,usage.output,run.id,run.attempt);db.prepare('UPDATE thesis_checkpoints SET input_tokens=input_tokens+?,output_tokens=output_tokens+? WHERE run_id=? AND unit_id=?').run(usage.input,usage.output,run.id,unit.id);}else db.prepare('UPDATE thesis_runs SET usage_known=0 WHERE id=? AND attempt=?').run(run.id,run.attempt);});}
     const retry=classifyThesisRetry(error);
     if(continuous&&!stopped&&running()&&retries<2&&retry.retryable){retries++;minimumTokens=Math.max(minimumTokens,retry.minimumTokens||0);stage('auto_recovering');continue;}
     writeRunning(()=>{const diagnostics=failureDiagnostics(error);db.prepare("UPDATE thesis_checkpoints SET status='failed',error=?,missing_evidence=?,trace=CASE WHEN ?='[]' THEN trace ELSE ? END,updated_at=? WHERE run_id=? AND unit_id=? AND status!='completed'").run(thesisPublicError(error,runtime),JSON.stringify(error.missingEvidence||[]),JSON.stringify(diagnostics),JSON.stringify(diagnostics),clock(),run.id,unit.id);});
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
    quality=await qualityRunner({snapshot,kind:'thesis',checkSupplements,chapters:reviewChapters,runtime,runId:run.id,signal:controller.signal,onStage:stage,isCurrent:running,dispatch:reviewDispatch});
    if(completionMode&&quality)quality.manuscriptHash=completionManuscriptHash(completionReviewChapters());
    if(!writeRunning(()=>{const previous=db.prepare("SELECT length(CAST(coalesce(quality,'') AS BLOB)) bytes FROM thesis_runs WHERE id=? AND attempt=?").get(run.id,run.attempt).bytes;const saved=fitOptionalWritingQuality(quality,{build:candidate=>candidate?JSON.stringify(candidate):null,check:json=>assertThesisAccountQuota(db,run.user_id,Math.max(0,(json?Buffer.byteLength(json):0)-previous+pendingReferenceBytes),config)});quality=saved.quality;db.prepare('UPDATE thesis_runs SET quality=?,updated_at=? WHERE id=? AND attempt=?').run(saved.value,clock(),run.id,run.attempt);}))return;
   }
   writeRunning(()=>{
    const checkpoints=db.prepare('SELECT * FROM thesis_checkpoints WHERE run_id=? ORDER BY position').all(run.id);
    if(checkpoints.length!==plan.length||checkpoints.some(row=>row.status!=='completed'))throw thesisError(409,'章节尚未全部完成，未将任务标为成功');
    const sourceChapters=completionMode?completionReviewChapters():checkpoints;const usedSources=[...new Set(sourceChapters.flatMap(row=>[...row.text.matchAll(/\[source:([^\]]+)\]/g)].map(match=>match[1])))],bibliography=compileThesisReferences(snapshot,usedSources);
    for(const chapter of snapshot.outline.filter(isThesisReferenceChapter))if(bibliography&&!db.prepare("SELECT id FROM thesis_chapter_versions WHERE run_id=? AND chapter_id=? AND source='generated'").get(run.id,chapter.id)){
     assertThesisChapterCapacity(db,run.thesis_id,chapter.id);assertThesisAccountQuota(db,run.user_id,Math.max(512,Buffer.byteLength(bibliography)),config);
     const previous=db.prepare('SELECT coalesce(max(version),0) version FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=?').get(run.thesis_id,chapter.id).version;
     db.prepare('INSERT INTO thesis_chapter_versions(id,thesis_id,chapter_id,version,run_id,source,text,source_ids,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),run.thesis_id,chapter.id,previous+1,run.id,'generated',bibliography,JSON.stringify(snapshot.references.filter(row=>row.confirmed&&usedSources.includes(row.id)).map(row=>row.id)),clock());
    }
    const completionRecords=completionMode?manuscriptVersions():null;const chapters=snapshot.outline.map(chapter=>{const personal=snapshot.requirements.deliveryVersion===1&&thesisManualBackMatter(chapter),version=completionMode?completionRecords.find(row=>row.id===chapter.id)?.record:personal?db.prepare('SELECT * FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=? ORDER BY version DESC LIMIT 1').get(run.thesis_id,chapter.id):db.prepare("SELECT * FROM thesis_chapter_versions WHERE run_id=? AND chapter_id=? AND source='generated'").get(run.id,chapter.id);if(!version&&!isThesisReferenceChapter(chapter)&&!personal)throw thesisError(409,'章节检查点尚未完整保存');return {...chapter,text:version?.text||'',sourceIds:version?JSON.parse(version.source_ids):[],figures:version?JSON.parse(version.figures||'[]'):[],source:isThesisReferenceChapter(chapter)?'confirmed_reference_list':'agent_draft'};});
    const suggestion=thesisFullText(snapshot,chapters),resultId=randomUUID(),at=clock(),totals=db.prepare('SELECT input_tokens,output_tokens,usage_known FROM thesis_runs WHERE id=?').get(run.id);
    billing.settle(run.id);
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
