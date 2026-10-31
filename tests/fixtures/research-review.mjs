import {createScientificFigure} from '../../backend/research-figure-quality.mjs';
// Older content-review fixtures supply all six keys. Adapt their requested key
// set explicitly; target-coordinate tests use the production entry point directly.
export function createFigureWithReviewFixture(snapshot,options){
 const runner=options.jsonRunner;
 return createScientificFigure(snapshot,{...options,jsonRunner:async(messages,opts)=>{
  const request=JSON.parse(messages[1].content?.[0]?.text||'null');
  if(opts.phase==='label_targets')return{value:{passed:true,checks:request.labels.map(a=>({index:a.index,passed:true,scope:'annotation',detail:'Fixture target verified'}))}};
  const r=await runner(messages,opts);
  if(request?.requestedChecks&&r.value?.checks){r.value.checks=r.value.checks.filter(c=>request.requestedChecks.includes(c.key));r.value.passed=r.value.checks.every(c=>c.passed);}
  return r;
 }});
}
