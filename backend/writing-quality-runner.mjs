import {createCitationVerifier,auditWritingConsistency,writingReviewTask,parseWritingReview} from './writing-quality.mjs';

const aborted=()=>Object.assign(new Error('写作质量检查已取消或任务已变化'),{name:'AbortError',code:'quality_cancelled',status:499});
const bounded=(value,fallback,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max?value:fallback;
const publicReason=Object.freeze({unavailable:'本批辅助审校尚未完成，已生成的正文已保留。',budget_exhausted:'辅助审校已达到本次执行预算，剩余检查尚未完成；已生成的正文已保留。',not_configured:'辅助审校执行器尚未启用，已生成的正文已保留。'});
const budgetFailure=error=>error?.status===429||/budget|usage_unknown|unknown_usage|unknown_cost|cost_unknown/i.test(String(error?.code||''))||/预算|额度|用量.*(?:未知|核算|未返回)/.test(String(error?.message||''));

// Only the worker-owned dispatch can spend model budget or touch task records.
// This coordinator never creates jobs, acquires extra credit or invokes an LLM.
export function createWritingQualityRunner(config={}){
 const clock=config.writingQualityNow||Date.now;
 const verifier=config.citationVerifier||createCitationVerifier({fetchImpl:config.fetchImpl||globalThis.fetch,openAlexApiKey:config.openAlexApiKey||'',timeoutMs:bounded(config.writingQualityTimeoutMs,7000,50,7000),maxRequests:bounded(config.writingQualityMaxRequests,30,1,30),dailyLimit:bounded(config.writingQualityDailyLimit,200,0,10000),clock});
 const timestamp=()=>new Date(clock()).toISOString();
 async function guarded(operation,signal){
  if(signal?.aborted)throw aborted();let listener;
  try{return await Promise.race([operation,new Promise((_,reject)=>{listener=()=>reject(aborted());signal?.addEventListener('abort',listener,{once:true});if(signal?.aborted)listener();})]);}finally{signal?.removeEventListener('abort',listener);}
 }
 function batchesFor(chapters){
  if(!Array.isArray(chapters)||chapters.length>200)throw Object.assign(new Error('审校章节数量无效'),{status:400});
  const batches=[];let batch=[],characters=0;
  const flush=()=>{if(batch.length)batches.push(batch);batch=[];characters=0;};
  for(const [index,chapter]of chapters.entries()){
   if(!chapter||typeof chapter.id!=='string'||!chapter.id||chapter.id.length>160||typeof chapter.text!=='string'||chapter.text.length>200000)throw Object.assign(new Error('审校章节内容无效'),{status:400});
   if(!chapter.text.trim())continue;
   let start=0,part=0;
   while(start<chapter.text.length){
    let end=Math.min(chapter.text.length,start+22000);
    if(end<chapter.text.length&&/[\uD800-\uDBFF]/.test(chapter.text[end-1]))end--;
    const text=chapter.text.slice(start,end),piece={id:'quality-section-'+(index+1)+'-part-'+(++part),title:typeof chapter.title==='string'?chapter.title.slice(0,300):'章节 '+(index+1),text,originalSectionId:chapter.id,originalOffset:start,totalCharacters:chapter.text.length,partialChapter:start>0||end<chapter.text.length};
    if(batch.length>=12||characters+text.length>22000)flush();batch.push(piece);characters+=text.length;start=end;
   }
  }
  flush();return batches;
 }
 return async function runWritingQuality({snapshot={},chapters=[],runtime={},runId='',signal,onStage,isCurrent=()=>true,dispatch}={}){
  const active=async()=>{if(signal?.aborted)throw aborted();if(await isCurrent()!==true||signal?.aborted)throw aborted();};
  const stage=async value=>{await active();await onStage?.(value);await active();};
  await active();const batches=batchesFor(chapters),quality={status:'completed',checkedAt:timestamp(),citations:null,consistency:null,reviews:[],limitations:[]};let partial=false;
  await stage('verifying_citations');
  try{
   quality.citations=await guarded(verifier.verify(Array.isArray(snapshot.references)?snapshot.references:[],{signal}),signal);await active();
   if(quality.citations.items?.some(item=>item.metadataStatus==='unavailable'||item.reasonCode==='budget_exhausted'))partial=true;
  }catch(error){await active();partial=true;quality.citations={version:1,status:'unavailable',checkedAt:timestamp(),scope:'public_identifier_metadata_only',claimSupport:'not_checked',items:[],summary:{matched:0,conflict:0,not_found:0,unverified:0,unavailable:0},limitations:['题录来源核验未完成，不能据此认定引用真实或虚假。']};}
  await stage('checking_consistency');
  try{quality.consistency=auditWritingConsistency({chapters,references:snapshot.references||[],materials:snapshot.materials||[]});}catch(error){await active();partial=true;quality.consistency={version:1,status:'unavailable',checkedSections:0,findings:[],totalFindings:0,truncated:false,limitations:['正文一致性检查未完成。']};}
  let stoppedReason=typeof dispatch==='function'?'':'not_configured';
  for(const [index,batch]of batches.entries()){
   await active();const unitId='quality-review::'+(index+1),sectionIds=[...new Set(batch.map(piece=>piece.originalSectionId))];
   if(stoppedReason){partial=true;quality.reviews.push({unitId,status:'not_started',sectionIds,reasonCode:stoppedReason,reason:publicReason[stoppedReason],findings:[],checkedSections:0});continue;}
   await stage('reviewing_manuscript');
   const ids=new Set(sectionIds),audit={...quality.consistency,findings:(quality.consistency.findings||[]).filter(finding=>ids.has(finding.sectionId))};
   const task=writingReviewTask({snapshot,chapters:batch,audit,citationVerification:quality.citations});
   // The model sees and returns bounded synthetic segment IDs. Original section
   // IDs/offsets are server-owned mappings and never accepted from its output.
   task.context.manuscriptExcerpts=task.context.manuscriptExcerpts.map(piece=>{const origin=batch.find(row=>row.id===piece.id);return {...piece,partialChapter:origin.partialChapter,originalOffset:origin.originalOffset,totalCharacters:origin.totalCharacters};});
   task.context.scope={...task.context.scope,batch:index+1,totalBatches:batches.length,batchOnly:true};
   if(JSON.stringify(task.context).length>39000){partial=true;quality.reviews.push({unitId,status:'unavailable',sectionIds,reasonCode:'context_limit',reason:publicReason.unavailable,findings:[],checkedSections:0});continue;}
   const validateReviewOutput=candidate=>{try{parseWritingReview(candidate,task);return {valid:true};}catch{return {valid:false,feedback:{code:'review_grounding',rule:'只提交实际提供的章节ID、逐字原句和完整JSON检查项；没有可定位问题时findings=[]，不得伪造原文或检查结论。'}};}};
   try{
    const settings={...runtime,maxTurns:Math.min(4,bounded(runtime.maxTurns,3,1,12)),maxOutputTokens:Math.min(4096,bounded(runtime.maxOutputTokens,2048,32,16384)),timeoutMs:Math.min(90000,bounded(runtime.timeoutMs,60000,5000,300000))};
    // Dispatch owns model-budget accounting and may write task state in its
    // finally path. Cancellation must await that cleanup before worker.stop()
    // can finish or its database can close; never race this owned operation.
    const result=await dispatch({task,settings,validateReviewOutput,unitId,signal});await active();
    const parsed=parseWritingReview(result,task),mapped=parsed.findings.map(finding=>{const piece=batch.find(row=>row.id===finding.sectionId);return {...finding,sectionId:piece.originalSectionId,offset:piece.originalOffset+finding.offset};});
    quality.reviews.push({...parsed,outcome:parsed.status,status:'completed',unitId,sectionIds,findings:mapped,checkedAt:timestamp(),batchOnly:true,checkedCharacters:batch.reduce((sum,piece)=>sum+piece.text.length,0),segments:batch.map(({originalSectionId,originalOffset,text,totalCharacters})=>({sectionId:originalSectionId,offset:originalOffset,characters:text.length,totalCharacters}))});
   }catch(error){
    await active();partial=true;const reasonCode=budgetFailure(error)?'budget_exhausted':'unavailable';if(reasonCode==='budget_exhausted')stoppedReason=reasonCode;
    quality.reviews.push({unitId,status:'unavailable',sectionIds,reasonCode,reason:publicReason[reasonCode],findings:[],checkedSections:0});
   }
  }
  await active();
  const successful=quality.reviews.filter(review=>review.status==='completed'),checkedCharacters=successful.reduce((sum,review)=>sum+review.checkedCharacters,0),totalCharacters=chapters.reduce((sum,chapter)=>sum+chapter.text.length,0);
  quality.status=partial?'partial':'completed';if(!successful.length&&quality.consistency.status==='unavailable'&&(!quality.citations.items?.length||quality.citations.status==='unavailable'))quality.status='unavailable';
  quality.checkedAt=timestamp();quality.coverage={totalSections:chapters.length,totalCharacters,reviewedCharacters:checkedCharacters,reviewedBatches:successful.length,totalBatches:batches.length,complete:successful.length===batches.length&&checkedCharacters===totalCharacters};
  quality.limitations=[...new Set([...(chapters.some(row=>row.figures?.length)?['图片仅通过结构与位置校验；图中逻辑、来源含义与科学准确性仍需作者核对。']:[]),...(quality.citations.limitations||[]),...(quality.consistency.limitations||[]),'自动检查不能替代作者对研究事实、来源含义和院校要求的核对。',...(quality.coverage.complete?[]:['AI 辅助审校未覆盖全部正文；请查看未完成批次及检查范围。']),...(batches.length>1?['长文按片段审校；跨批次的逻辑和术语关系仍需全文人工复核。']:[])])];
  return quality;
 };
}
