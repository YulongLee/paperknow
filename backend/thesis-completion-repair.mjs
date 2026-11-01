import {thesisAgentTask} from './thesis-model.mjs';

// Only exact, server-located review findings can request another rewrite. Missing
// facts are not repair instructions. All passes share the original job budget.
export function completionRepairs(snapshot,plan,checkpoints,quality,pass){
 const findings=[...(quality?.consistency?.findings||[]),...(quality?.reviews||[]).flatMap(review=>review.findings||[])];
 return checkpoints.flatMap(checkpoint=>{
  if(JSON.parse(checkpoint.trace||'[]').some(row=>row.stage==='completion_repair_'+pass))return [];
  const unit=plan.find(unit=>unit.id===checkpoint.unit_id);if(!unit)return [];
  const checks=(quality?.supplementCheck?.items||[]).filter(row=>row.title===unit.chapterTitle),supported=checks.length&&checks.every(row=>['sufficient','not_required'].includes(row.status));
  const located=findings.filter(finding=>finding.sectionId===unit.chapterId&&typeof finding.quote==='string'&&finding.quote.length>=6&&checkpoint.text.includes(finding.quote)&&(finding.category!=='unresolved_placeholder'||supported)).slice(0,6);
  for(const issue of quality?.completionAudit?.issues||[]){
   const front=unit.frontMatter,applies=front==='abstract_zh'&&/^abstract_zh$|^keywords_zh$/.test(issue.code)||front==='abstract_en'&&/^abstract_en$|^keywords_en$|^english_title$/.test(issue.code)||issue.code==='raw_formula'&&/\\(?:frac|sum|sqrt|begin|tilde|exp|phi)\b/.test(checkpoint.text)||/^table_/.test(issue.code)&&/^\s*\|/m.test(checkpoint.text);
   if(applies&&located.length<6&&checkpoint.text.trim().length>=6)located.push({quote:checkpoint.text.trim().slice(0,80),category:'structure',explanation:issue.message,suggestion:'直接补齐本节缺少的文字或数学格式，保留有依据的研究事实。'});
  }
  if(supported)for(const match of checkpoint.text.matchAll(/【(?:待补充|待核对)[：:][^】]{1,500}】/g))if(located.length<6)located.push({quote:match[0],category:'structure',explanation:'资料检查已找到对应依据，需据此补齐本处正文。',suggestion:'读取对应资料并补写，不能只删除标记。'});
  if(!located.length)return [];
  const task=thesisAgentTask(snapshot,{...unit,completion:{...unit.completion,originalText:checkpoint.text,originalFigures:JSON.parse(checkpoint.figures||'[]'),excerpted:false,findings:located}},[]);
  task.context.completionRepairPass=pass+1;
  return [{unit,checkpoint,task,unitId:'completion-repair-'+pass+'::'+unit.id}];
 });
}
