import {computeThesisRunBudget,classifyThesisRetry} from './thesis-execution-policy.mjs';

// Plan the whole document before dispatch. The saved per-call dollar ceiling
// remains unchanged; a fresh provider call cannot expand the frozen run budget.
export function computeWritingRunBudget({snapshot={},plan,settings={},config={}}={}){
 const explicit=config.writingMaxRunTokens??config.writingMaxTokens;
 return computeThesisRunBudget({snapshot,plan,settings,config:explicit!==undefined?{thesisMaxRunTokens:explicit}:{}});
}
export function classifyWritingRetry(error){
 // A source-attribution repair has its own single bounded path. It must not
 // become an outer retry of evidence, permissions or other validation failures.
 if(error?.validationCode==='source_attribution')return{retryable:false,reason:'non_recoverable'};
 const known=Number.isSafeInteger(error?.usage?.input)&&error.usage.input>=0&&Number.isSafeInteger(error?.usage?.output)&&error.usage.output>=0&&error.usage.input+error.usage.output>0;
 const blocked=[401,403,409,422,429,499].includes(error?.status)||error?.agentTrace?.some(row=>row.status==='denied');
 if(known&&!blocked){
  if(error?.code==='word_limit'&&Number.isSafeInteger(error?.wordStats?.count))return{retryable:true,reason:'length'};
  if(error?.code==='invalid_writing_output'&&/JSON|截断/.test(error.message||''))return{retryable:true,reason:'invalid_json'};
  if(['provider_error','upstream_error','timeout'].includes(error?.code)&&[502,503,504].includes(error?.status))return{retryable:true,reason:'provider_error'};
 }
 return classifyThesisRetry(error);
}
