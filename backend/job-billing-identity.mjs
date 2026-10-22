// Only server-authored task metadata can select a legacy revision charge. Old
// tool jobs keep their original agent identity, including their paid audit use.
export function jobBillingType(job){
 if(job.type==='tool_run'){
  let input;try{input=JSON.parse(job.input);}catch{}
  return ['polish','review'].includes(input?.billingType)?input.billingType:'agent';
 }
 return ['thesis','thesis_outline','thesis_method','writing'].includes(job.type)?'agent':job.type;
}
export function jobBillingTypeExpression(alias){
 if(!/^[a-z][a-z0-9_]*$/i.test(alias))throw new TypeError('Invalid task alias');
 return `CASE WHEN ${alias}.type='tool_run' THEN CASE WHEN json_valid(${alias}.input) THEN CASE WHEN json_extract(${alias}.input,'$.billingType') IN ('polish','review') THEN json_extract(${alias}.input,'$.billingType') ELSE 'agent' END ELSE 'agent' END WHEN ${alias}.type IN ('thesis','thesis_outline','thesis_method','writing') THEN 'agent' ELSE ${alias}.type END`;
}
