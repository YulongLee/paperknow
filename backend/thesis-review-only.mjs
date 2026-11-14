import {completionManuscriptHash} from './thesis-completion.mjs';
import {completionContentAudit} from './thesis-completion-audit.mjs';
import {thesisHash,thesisError} from './thesis-model.mjs';

// A coordinator only: the caller must supply a session-budgeted dispatcher.
// It never creates a task, mutates chapters or performs model calls itself.
export async function reviewSavedThesis({snapshot,chapters,docxObjects=[],row,runtime,runId,qualityRunner,dispatch,isCurrent,signal,onStage=()=>{}}={}){
 if(!snapshot||!Array.isArray(chapters)||!row||typeof runId!=='string'||!runId||typeof qualityRunner!=='function'||typeof dispatch!=='function'||typeof isCurrent!=='function')throw thesisError(400,'终稿检查所需的信息不完整');
 const current=async()=>{if(signal?.aborted||await isCurrent()!==true)throw thesisError(409,'论文或资料已变化，请重新检查','review_changed');};
 await current();
 // Snapshot the caller-owned objects: even a faulty runner cannot rewrite them.
 const input=structuredClone({snapshot,chapters,docxObjects,row});
 const snapshotHash=thesisHash(input.snapshot),manuscriptHash=completionManuscriptHash(input.chapters);
 const quality=await qualityRunner({snapshot:structuredClone(input.snapshot),kind:'thesis',checkSupplements:true,recoverSupplements:true,chapters:structuredClone(input.chapters),docxObjects:structuredClone(input.docxObjects),runtime,runId,signal,isCurrent:async()=>{await current();return true;},onStage:async stage=>{await current();await onStage(stage);await current();},dispatch:async args=>{await current();const result=await dispatch(args);await current();return result;}});
 await current();
 if(!quality||typeof quality!=='object'||Array.isArray(quality))throw thesisError(502,'终稿检查未返回有效结果','invalid_review_output');
 // Incomplete checks remain incomplete even when an individual part is ready.
 const result=structuredClone(quality);
 if(result.coverage?.complete!==true||result.supplementCheck?.coverage?.complete!==true)result.status='partial';
 result.completionAudit=completionContentAudit(input.snapshot,input.chapters,result,input.row);
 result.manuscriptHash=manuscriptHash;
 result.snapshotHash=snapshotHash;
 await current();
 return result;
}

// The session ledger reserves provider cost before dispatch. A repeated or
// interrupted request is never silently sent again: callers may reuse only a
// separately persisted, independently validated result.
export function createSessionReviewDispatch({sessions,userId,thesisId,sessionId,reviewRunId,attempt,runner,isCurrent,signal,onStage=()=>{}}={}){
 if(!sessions||typeof sessions.reserve!=='function'||typeof sessions.finish!=='function'||typeof sessions.summary!=='function'||typeof sessions.markStarted!=='function'||typeof sessions.cancelBeforeDispatch!=='function'||typeof runner!=='function'||typeof isCurrent!=='function')throw thesisError(400,'复查调度配置不完整');
 const identity={userId,thesisId,sessionId};
 const current=async()=>{if(signal?.aborted||await isCurrent()!==true)throw thesisError(409,'论文或资料已变化，请重新检查','review_changed');};
 return async({task,settings,unitId,validateReviewOutput,validateThesisOutput})=>{
  if(!task||task.skill!=='writing-review'||typeof unitId!=='string'||!unitId||typeof validateReviewOutput!=='function'||validateThesisOutput)throw thesisError(400,'只读检查任务无效');
  const requestedTokens=settings?.maxTotalTokens,requestedCostUsd=settings?.maxCostUsd;
  if(!Number.isSafeInteger(requestedTokens)||requestedTokens<1||requestedTokens>2000000||typeof requestedCostUsd!=='number'||!Number.isFinite(requestedCostUsd)||requestedCostUsd<=0||requestedCostUsd>5)throw thesisError(400,'复查预算无效');
  await current();
  const available=sessions.summary(identity);
  if(!available.settingsVersion||!available.settingsModel||!available.settingsEngine||settings.version!==available.settingsVersion||settings.model!==available.settingsModel||settings.engine!==available.settingsEngine)throw thesisError(409,'原服务配置已变化，请联系支持','review_settings_changed');
  const reservedTokens=Math.min(requestedTokens,available.remainingTokens),reservedCostUsd=Math.min(requestedCostUsd,available.remainingCostUsd);
  if(!Number.isSafeInteger(reservedTokens)||reservedTokens<1||!Number.isFinite(reservedCostUsd)||reservedCostUsd<=0)throw thesisError(429,'本次复查暂未完成，请联系支持；本次未额外扣费','review_budget_exhausted');
  const boundedSettings={...settings,maxTotalTokens:reservedTokens,maxCostUsd:reservedCostUsd};
  const requestKey=thesisHash({reviewRunId,attempt,unitId,task,settings});
  const reservation=sessions.reserve({...identity,reviewRunId,attempt,unitId,requestKey,reservedTokens,reservedCostUsd});
  if(reservation.created!==true)throw thesisError(409,'此复查单元已提交，请核对已保存的检查记录','review_dispatch_exists');
  let output,settled=false,dispatched=false;
  try{
   await current();
   sessions.markStarted({...identity,dispatchId:reservation.id});dispatched=true;output=await runner({task,settings:boundedSettings,validateReviewOutput,signal,onStage});
   const usage=output?.usage,costUsd=output?.costUsd;
   const receipt=sessions.finish({...identity,dispatchId:reservation.id,usage,costUsd});settled=true;
   if(receipt.budgetExceeded)throw thesisError(429,'复查已达到本次处理上限，已保存内容保留','review_budget_exhausted');
   if(receipt.status!=='completed')throw thesisError(502,'复查用量暂无法核实，已保存内容保留','review_usage_unknown');
   await current();
   const validated=await validateReviewOutput(output);
   if(validated?.valid!==true)throw thesisError(502,'复查内容未通过核对，已保存内容保留','invalid_review_output');
   await current();
   return typeof validated.normalizedText==='string'?{...output,text:validated.normalizedText,trace:validated.normalizedTrace||output.trace}:output;
  }catch(error){if(!settled){if(!dispatched&&typeof sessions.cancelBeforeDispatch==='function')sessions.cancelBeforeDispatch({...identity,dispatchId:reservation.id});else sessions.finish({...identity,dispatchId:reservation.id,usage:output?.usage||error?.usage,costUsd:output?.costUsd??error?.costUsd,errorCode:error?.code||'execution_failed'});}throw error;}
 };
}
