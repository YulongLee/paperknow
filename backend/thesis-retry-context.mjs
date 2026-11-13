// A rejected candidate is private recovery data, not an accepted chapter or
// evidence. Every retry still uses the original unit validator and sources.
export function withThesisRetryCandidate(task,candidate){
 if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||typeof candidate.text!=='string')return task;
 let serialized;try{serialized=JSON.stringify(candidate);}catch{return task;}
 if(serialized.length>24000)return task;
 const context={...task.context,retryCandidate:JSON.parse(serialized)};
 if(JSON.stringify(context).length>39000)return task;
 const instructions=task.instructions+'context.retryCandidate 是上一轮未通过校验的完整候选，仅作修订起点，不是已通过的正文或事实依据。优先针对 retryFeedback 修正该候选，保留本单元有依据的内容和原稿对象；不要从头另写整章。来源仍须在本次执行中实际读取，修订后重新提交完整 candidate，不能跳过当前结构、来源、公式图片及篇幅校验。';
 if(instructions.length>12000)return task;
 return {...task,context,instructions};
}
export function safeThesisValidation(value){
 if(!value||typeof value.code!=='string'||!/^[a-z][a-z0-9_]{0,59}$/.test(value.code))return null;
 const safeRevisionCodes=new Set(['revision_action','revision_retain_changed','revision_unchanged','revision_report_scope','revision_protection']);
 const safeIssueCodes=new Set(['protected_spans_changed','too_short','malformed_original_math','malformed_revised_math','original_blank','revised_blank','invalid_original_input','invalid_revised_input','explicit_polarity_reversal']);
 const revision=value.revision,revisionCode=revision&&safeRevisionCodes.has(revision.code)?revision.code:null;
 return {code:value.code,...(value.code==='local_revision_scope'&&['anchor','structure','count','order','replacement','protected_content','length','scope','punctuation'].includes(value.localPatchReason)?{localPatchReason:value.localPatchReason}:{}),...Object.fromEntries(['count','target','min','max'].filter(key=>Number.isSafeInteger(value[key])&&value[key]>=0).map(key=>[key,value[key]])),...(revisionCode?{revision:{code:revisionCode,...(Number.isSafeInteger(revision.paragraphIndex)&&revision.paragraphIndex>0&&revision.paragraphIndex<=500?{paragraphIndex:revision.paragraphIndex}:{}),...(Array.isArray(revision.issues)?{issues:revision.issues.filter(issue=>safeIssueCodes.has(issue?.code)).map(issue=>({code:issue.code})).slice(0,10)}:{})}}:{})};
}
