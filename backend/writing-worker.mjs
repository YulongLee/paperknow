import {runSupplementCheck} from './supplement-check.mjs';
import {writingCompletionTask} from './writing-completion.mjs';
import {randomUUID} from 'node:crypto';
import {taskProjectId} from './task-project-context.mjs';
import {createBillingService} from './billing-service.mjs';
import {createModelBudget} from './model-budget.mjs';
import {thesisTransaction,thesisError,thesisPublicError} from './thesis-model.mjs';
import {assertThesisSettings} from './thesis-service.mjs';
import {initializeWritingSchema,writingStorageCheck} from './writing-service.mjs';
import {writingTask,parseWritingOutput,validateWritingCandidate,writingSourceFeedback,writingLengthFeedback,writingKinds,aggregateWritingQuestionnaire} from './writing-model.mjs';
import {runAgentTask} from './agent-runtime.mjs';
import {publicAIError} from './public-ai-metadata.mjs';
import {createWritingQualityRunner} from './writing-quality-runner.mjs';
import {fitOptionalWritingQuality} from './writing-quality-storage.mjs';
const usageOK=value=>Number.isSafeInteger(value)&&value>=0;
export function startWritingWorker(db,config={}){initializeWritingSchema(db);const billing=config.billing||createBillingService(db,config),modelBudget=config.modelBudget||createModelBudget(db,config),clock=()=>new Date(config.writingNow?.()??Date.now()).toISOString(),transaction=fn=>thesisTransaction(db,fn);let stopped=false,busy=false,pending=null;const controllers=new Map();
 const qualityRunner=createWritingQualityRunner(config);
 function finish(id,status,message){if(!db.prepare("SELECT 1 FROM writing_runs WHERE id=? AND status IN ('queued','running')").get(id))return;db.prepare('UPDATE writing_runs SET status=?,stage=?,error=?,updated_at=? WHERE id=?').run(status,status,message,clock(),id);db.prepare('UPDATE jobs SET status=?,stage=?,error=?,updated_at=? WHERE id=?').run(status,status,message,clock(),id);billing.release(id);}
 transaction(()=>{for(const row of db.prepare("SELECT id FROM writing_runs WHERE status='running'").all())finish(row.id,'failed','服务重启中断了写作，预占权益已释放，已完成草稿保留；请确认后继续');});
 async function execute(){if(stopped||busy)return;const row=db.prepare("SELECT r.* FROM writing_runs r JOIN jobs j ON j.id=r.id WHERE r.status='queued' AND j.status='queued' ORDER BY r.created_at,r.id LIMIT 1").get();if(!row)return;busy=true;const controller=new AbortController();controllers.set(row.id,controller);let runtime={},inputTokens=0,outputTokens=0,usageKnown=true,knownSdkEstimatedCostUsd=0,reservedUnknownCostBudgetUsd=0,costConsumedBudget=0,invalidCost=false;const unknownCostAttempts=[],costAccounting=()=>({sdkEstimatedCostUsd:unknownCostAttempts.length||invalidCost?null:knownSdkEstimatedCostUsd,knownSdkEstimatedCostUsd,reservedUnknownCostBudgetUsd,costConsumedBudget,maxCostUsd:runtime.maxCostUsd??null,unknownCostAttempts,costBasis:'sdk_estimate_not_provider_invoice',...(unknownCostAttempts.length?{unknownCostBudgetPolicy:'consume_allocated_ceiling_without_estimating_actual_cost'}:{})});const running=()=>db.prepare("SELECT 1 FROM writing_runs r JOIN jobs j ON j.id=r.id WHERE r.id=? AND r.status='running' AND j.status='running'").get(row.id);const account=value=>{if(usageOK(value?.input)&&usageOK(value?.output)&&value.input+value.output>0){inputTokens+=value.input;outputTokens+=value.output;}else usageKnown=false;db.prepare('UPDATE writing_runs SET input_tokens=?,output_tokens=?,usage_known=?,updated_at=? WHERE id=?').run(inputTokens,outputTokens,usageKnown?1:0,clock(),row.id);};
 const accountCost=(value,allocatedMaxCostUsd,unit)=>{if(typeof value==='number'&&value<0){invalidCost=true;throw thesisError(502,'写作用量记录无效，未提交结果');}if(Number.isFinite(value)){knownSdkEstimatedCostUsd+=value;costConsumedBudget+=value;}else{reservedUnknownCostBudgetUsd+=allocatedMaxCostUsd;costConsumedBudget+=allocatedMaxCostUsd;unknownCostAttempts.push({unitId:unit.id,allocatedMaxCostUsd});db.prepare('INSERT INTO writing_diagnostics(run_id,code,metrics,created_at) VALUES(?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET code=excluded.code,metrics=excluded.metrics,created_at=excluded.created_at').run(row.id,'cost_unknown_reserved',JSON.stringify({costAccounting:costAccounting(),note:'SDK费用估算未知；仅按本次已分配上限保守消耗执行预算，实际供应商账单未核验，不把预算预留当作账单。'}),clock());}};
 try{const claimed=transaction(()=>{if(db.prepare("SELECT 1 FROM writing_runs WHERE status='running' AND id!=?").get(row.id))return false;if(!db.prepare("UPDATE writing_runs SET status='running',stage='preparing',updated_at=? WHERE id=? AND status='queued'").run(clock(),row.id).changes)return false;db.prepare("UPDATE jobs SET status='running',stage='preparing',attempt=1,updated_at=? WHERE id=? AND status='queued'").run(clock(),row.id);modelBudget.start(row.id,1);return true;});if(!claimed)return;assertThesisSettings(await config.getAgentSettings?.());runtime=assertThesisSettings(await config.getAgentSettings?.(row.settings_version));if(runtime.version!==row.settings_version)throw thesisError(503,'原写作配置版本不可用，请联系支持');
 // The administrator's maxTurns remains a hard total ceiling. Writing uses at
 // most 10 for generation and may use a remaining 2 for one validation repair only
 // when an administrator explicitly saved a 12-turn configuration. No config
 // record is upgraded here, and all token/cost/time ceilings still apply.
 if(!Number.isSafeInteger(runtime.maxTurns)||runtime.maxTurns<1||runtime.maxTurns>12)throw thesisError(503,'AI 写作执行预算未就绪，请联系支持');
 const checkSupplements=config.supplementCheckEnabled===true&&JSON.parse(db.prepare('SELECT input FROM jobs WHERE id=?').get(row.id).input).supplementCheck===true;
 const snapshot=JSON.parse(row.snapshot),plan=JSON.parse(row.plan),budget=Number.isSafeInteger(config.writingMaxTokens)&&config.writingMaxTokens>=1000&&config.writingMaxTokens<=400000?config.writingMaxTokens:200000,maxTurns=Math.min(10,runtime.maxTurns),repairTurns=Math.min(2,runtime.maxTurns-maxTurns),maxOutputTokens=Math.min(8000,Math.max(32,Number(runtime.maxOutputTokens)||4096));
 const completed=db.prepare('SELECT unit_id,output FROM writing_checkpoints WHERE run_id=? ORDER BY position').all(row.id).map(value=>({id:value.unit_id,...JSON.parse(value.output)}));
 async function dispatch(task,turns,timeoutMs,unit,priorTrace=[]){
  if(controller.signal.aborted||!running())return null;
  if(costConsumedBudget>runtime.maxCostUsd-.01)throw thesisError(429,'写作已达到本次费用预算，已完成草稿保留');
  if(inputTokens+outputTokens>=budget)throw thesisError(429,'写作已达到本次模型执行预算，已完成草稿保留，请确认后继续');
  const allocatedMaxCostUsd=runtime.maxCostUsd-costConsumedBudget;
  let output;try{output=await(config.agentTaskRunner||runAgentTask)({settings:{...runtime,maxTurns:turns,timeoutMs,maxOutputTokens,maxCostUsd:allocatedMaxCostUsd,maxTotalTokens:budget-inputTokens-outputTokens},task,...(task.skill==='writing-task'?{validateWritingOutput:candidate=>validateWritingCandidate({...candidate,trace:[...priorTrace,...candidate.trace]},row.kind,row.operation,snapshot,unit)}:task.skill==='thesis-outline'?{validateOutlineOutput:candidate=>validateWritingCandidate(candidate,row.kind,row.operation,snapshot,unit)}:{}),signal:controller.signal,onStage:stage=>{if(!running())return;const safe=typeof stage==='string'&&/^[a-z][a-z0-9_-]{0,60}$/i.test(stage)?stage:'agent_running';db.prepare('UPDATE writing_runs SET stage=?,updated_at=? WHERE id=?').run(safe,clock(),row.id);db.prepare("UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND status='running'").run(safe,clock(),row.id);}});}catch(error){account(error.usage);accountCost(error.costUsd,allocatedMaxCostUsd,unit);throw error;}
  account(output?.usage);accountCost(output?.costUsd,allocatedMaxCostUsd,unit);if(controller.signal.aborted||!running())return null;
  if(!usageKnown)throw thesisError(502,'写作服务未返回可核算用量，结果未标记完成');
  if(inputTokens+outputTokens>budget||output.usage.output>turns*maxOutputTokens||costConsumedBudget>runtime.maxCostUsd)throw thesisError(429,'写作超过本次执行预算，已完成草稿保留');
  return output;
 }
 const reviewDispatch=async({task,settings,validateReviewOutput,unitId})=>{
  if(controller.signal.aborted||!running())throw thesisError(499,'任务已停止','cancelled');
  const remainingCost=runtime.maxCostUsd-costConsumedBudget,remainingTokens=budget-inputTokens-outputTokens;if(remainingCost<.01||remainingTokens<1000)throw thesisError(429,'本次审校预算已用完','budget_exceeded');
  const allocation=Math.min(settings.maxCostUsd,remainingCost);let output;
  try{output=await(config.agentTaskRunner||runAgentTask)({settings:{...settings,maxCostUsd:allocation,maxTotalTokens:remainingTokens},task,validateReviewOutput,signal:controller.signal,onStage:()=>{}});}catch(error){account(error.usage);accountCost(error.costUsd,allocation,{id:unitId});throw error;}
  account(output?.usage);accountCost(output?.costUsd,allocation,{id:unitId});if(controller.signal.aborted||!running())throw thesisError(499,'任务已停止','cancelled');if((await validateReviewOutput(output))?.valid!==true)throw thesisError(502,'检查结果未通过依据核对','invalid_review_output');if(!usageOK(output?.usage?.input)||!usageOK(output?.usage?.output)||output.usage.input+output.usage.output===0)throw thesisError(502,'审校未返回可核算用量','usage_unknown');
  if(inputTokens+outputTokens>budget||costConsumedBudget>runtime.maxCostUsd)throw thesisError(429,'审校达到执行预算','budget_exceeded');return output;
 };
 const reportStage=value=>{if(!running()||controller.signal.aborted)return;db.prepare('UPDATE writing_runs SET stage=?,updated_at=? WHERE id=?').run(value,clock(),row.id);db.prepare("UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND status='running'").run(value,clock(),row.id);};
 if(checkSupplements&&plan.some(unit=>unit.completion===true)){
  const chapters=plan.map(unit=>({id:unit.id,title:unit.title,text:unit.revisionOriginal||completed.find(row=>row.id===unit.id)?.text||'本节尚未生成，按已确认的章节目的核对所需资料。'}));
  const supplementCheck=await runSupplementCheck({snapshot,chapters,kind:row.kind,phase:'materials',runtime,dispatch:reviewDispatch,signal:controller.signal,isCurrent:()=>Boolean(running()),onStage:reportStage});
  if(!running()||controller.signal.aborted)return;
  transaction(()=>{const json=JSON.stringify({quality:{status:'partial',supplementCheck}});writingStorageCheck(db,row.user_id,Buffer.byteLength(json),config);db.prepare('UPDATE writing_runs SET output=? WHERE id=?').run(json,row.id);});
  if(supplementCheck.status!=='materials_ready')throw thesisError(422,supplementCheck.status==='needs_materials'?'补充资料仍有缺项，请查看“补充内容检查”后继续补充；原稿与已上传资料已保留。':'补充资料检查尚未完成，请稍后重试；原稿与材料已保留。','supplement_incomplete');
 }
 for(const unit of plan){
  if(controller.signal.aborted||!running())return;if(completed.some(value=>value.id===unit.id))continue;
  const began=Date.now(),task=writingCompletionTask(writingTask(row.kind,row.operation,snapshot,unit,completed),unit);let output=await dispatch(task,maxTurns,runtime.timeoutMs,unit),parsed;if(!output)return;
  try{parsed=parseWritingOutput(output,row.kind,row.operation,snapshot,unit);}catch(error){
   const sourceIssue=error.validationCode==='source_attribution',lengthIssue=error.code==='word_limit';
   if(!sourceIssue&&!lengthIssue||repairTurns<2)throw error;
   const sourceFeedback=writingSourceFeedback(output,row.kind,snapshot,unit,row.operation),feedback=sourceIssue?sourceFeedback:{...writingLengthFeedback(output,snapshot,unit),allowedAlreadyReadSourceIds:sourceFeedback?.allowedAlreadyReadSourceIds||[]},remainingMs=Math.floor(runtime.timeoutMs-(Date.now()-began));
   if(!feedback||remainingMs<5000)throw error;
   const correction={...task,instructions:task.instructions+'服务器已对上一次最终候选做了明确校验，本次只允许一次受控修正。'+(sourceIssue?'请按 context.validationFeedback 删除未实际读取的题录 ID 或未知 ID，必要时重写无证据的对应表述；不能把未知证据换一个已读 ID 冒充依据。':'context.validationFeedback 是服务器对上次最终正文的实际字数统计；必须按 target/count 比例一次重组到区间中部，不能继续提交原长文，也不能冒用另外一段已合格的统计。保留当前契约要求的全部章节结构；将完整候选按本任务契约提交 submit_writing_output，服务器将核对正文长度、章节与来源；合格后结果冻结，不再更改任何正文文字。')+'allowedAlreadyReadSourceIds 是同一生成单元前一阶段确实读取过的授权正文，可以继续引用；将完整最终 JSON 提交 submit_writing_output，不解释修正过程，不添加新的来源。保留严格字数范围；如有正文改动，直接提交完整候选接受服务器校验，通过后立即结束。此阶段只有两个回合，不重复读取已经列明的来源、不调用 list_materials 或 load_skill。',context:{...task.context,validationFeedback:feedback,previousCandidate:output.text}};
   if(correction.instructions.length>12000||JSON.stringify(correction.context).length>40000)throw error;
   const repaired=await dispatch(correction,repairTurns,remainingMs,unit,output.trace||[]);if(!repaired)return;
   output={...repaired,trace:[...(output.trace||[]),...(repaired.trace||[])]};
   if(output.trace.length>20)throw thesisError(429,'当前写作单元已达到工具调用上限，原草稿保留');
   // The second candidate undergoes exactly the same strict parser. There is
   // deliberately no loop, new billing reservation or silent third attempt.
   parsed=parseWritingOutput(output,row.kind,row.operation,snapshot,unit);
  }
  if(row.operation==='questionnaire')aggregateWritingQuestionnaire(snapshot,plan,[...completed,{id:unit.id,...parsed}],{partial:true});
  transaction(()=>{if(!running())return;const json=JSON.stringify({...parsed,title:parsed.title||unit.title,targetWords:unit.targetWords});writingStorageCheck(db,row.user_id,Buffer.byteLength(json),config);db.prepare('INSERT INTO writing_checkpoints VALUES(?,?,?,?,?)').run(row.id,unit.id,unit.position,json,clock());});completed.push({id:unit.id,title:unit.title,targetWords:unit.targetWords,...parsed});
 }
 completed.sort((a,b)=>plan.findIndex(unit=>unit.id===a.id)-plan.findIndex(unit=>unit.id===b.id));
 let quality=null;
 if(config.writingQualityEnabled===true&&row.operation==='draft')quality=await qualityRunner({snapshot,kind:row.kind,checkSupplements,chapters:completed.map(unit=>({id:unit.id,title:unit.title||snapshot.title,text:unit.text,sourceIds:unit.sourceIds,...(unit.figures?.length?{figures:unit.figures}:{})})),runtime,runId:row.id,signal:controller.signal,isCurrent:()=>Boolean(running()),onStage:value=>{if(!running()||controller.signal.aborted)return;const name=/^[a-z][a-z0-9_]{0,60}$/i.test(value)?value:'reviewing_manuscript';db.prepare('UPDATE writing_runs SET stage=?,updated_at=? WHERE id=?').run(name,clock(),row.id);db.prepare("UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND status='running'").run(name,clock(),row.id);},dispatch:reviewDispatch});
 transaction(()=>{if(controller.signal.aborted||!running())return;const baseOutput=row.operation==='questionnaire'?aggregateWritingQuestionnaire(snapshot,plan,completed):row.operation==='draft'?{text:completed.map(unit=>unit.structured?unit.text:unit.title+'\n\n'+unit.text).join('\n\n'),sourceIds:[...new Set(completed.flatMap(unit=>unit.sourceIds||[]))],sections:completed,...(completed.some(unit=>unit.figures?.length)?{figures:completed.flatMap(unit=>unit.figures||[])}:{}),requiresReview:true}:completed[0];const used=new Set(baseOutput.sourceIds||[]),sourceSnapshot={title:snapshot.title,materials:snapshot.materials.filter(source=>used.has(source.id)).map(({id,name})=>({id,name,confirmed:true})),references:snapshot.references.filter(source=>used.has(source.id)).map(({id,title,authors,year,doi,url})=>({id,title,authors,year,doi,url,confirmed:true}))};
  const saved=fitOptionalWritingQuality(quality,{build:candidate=>{const output={...baseOutput,...(candidate?{quality:candidate}:{})};return {json:JSON.stringify(output),body:JSON.stringify({...output,sourceSnapshot,writingJobId:row.id,kind:row.kind,operation:row.operation})};},check:value=>writingStorageCheck(db,row.user_id,Buffer.byteLength(value.body)+Buffer.byteLength(value.json),config)});quality=saved.quality;const {body,json}=saved.value;
  const id=randomUUID(),at=clock();billing.settle(row.id);db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run(id,row.user_id,taskProjectId(db,row),row.id,'writing',snapshot.title+' · '+writingKinds[row.kind],body,at);db.prepare('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),row.user_id,row.id,runtime.engine||'claude-agent-sdk',runtime.model,usageKnown?inputTokens:null,usageKnown?outputTokens:null,billing.isBillable(row.id)?1:0,at);db.prepare("UPDATE writing_runs SET status='completed',stage='completed',output=?,result_id=?,error=NULL,updated_at=? WHERE id=?").run(json,id,at,row.id);db.prepare("UPDATE jobs SET status='completed',stage='completed',result_id=?,error=NULL,updated_at=? WHERE id=?").run(id,at,row.id);});
 }catch(error){
  const raw=String(error?.message||''),code=error.validationCode||error.code||(/Token|token/i.test(raw)?'token_budget':/回合上限/.test(raw)?'turn_limit':/费用预算/.test(raw)?'cost_budget':/超时|时限|timeout/i.test(raw)?'timeout':'generation_error');
  const internalCode=typeof code==='string'&&/^[a-z][a-z0-9_]{0,60}$/.test(code)?code:'generation_error';
  let message=publicAIError(thesisPublicError(error,runtime),[runtime.model,runtime.engine,runtime.baseURL].filter(value=>typeof value==='string'));
  if(['token_budget','turn_limit','cost_budget'].includes(internalCode))message='本次生成已达到执行上限，已完成内容仍保留，请核对后继续。';
  else if(internalCode==='timeout')message='本次生成未能在限定时间内完成，已完成内容仍保留，请核对后继续。';
  else if(/Token|SDK|模型/i.test(message))message='本次生成暂未完成，已保存内容仍保留，请稍后重试或联系支持。';
  const metrics={status:Number.isSafeInteger(error.status)?error.status:500,inputTokens,outputTokens,usageKnown,configuredMaxTurns:runtime.maxTurns??null,tokenLimit:Number.isSafeInteger(config.writingMaxTokens)?config.writingMaxTokens:200000,costAccounting:costAccounting(),...(error.wordStats?{wordStats:Object.fromEntries(['count','target','min','max','withinRange','delta'].map(key=>[key,error.wordStats[key]]))}:{})};
  transaction(()=>{db.prepare('INSERT INTO writing_diagnostics(run_id,code,metrics,created_at) VALUES(?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET code=excluded.code,metrics=excluded.metrics,created_at=excluded.created_at').run(row.id,internalCode,JSON.stringify(metrics),clock());finish(row.id,stopped?'failed':controller.signal.aborted?'cancelled':'failed',stopped?'服务停止中断了写作，预占权益已释放，已完成草稿保留':message);});
 }finally{if(stopped)transaction(()=>finish(row.id,'failed','服务停止中断了写作，预占权益已释放，已完成草稿保留'));controllers.delete(row.id);busy=false;}}
 function tick(){if(busy||stopped)return Promise.resolve();pending=execute();return pending;}const timer=setInterval(()=>void tick(),Math.max(100,config.writingPollMs||1000));timer.unref();return{tick,cancel(id){transaction(()=>finish(id,'cancelled','已取消，预占权益已释放，已完成草稿保留'));controllers.get(id)?.abort();},async stop(){stopped=true;clearInterval(timer);for(const controller of controllers.values())controller.abort();await pending;},async close(){await this.stop();}};
}
