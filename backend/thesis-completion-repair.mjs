import {thesisAgentTask} from './thesis-model.mjs';

// Only exact, server-located review findings can request another rewrite. Missing
// facts are not repair instructions. All passes share the original job budget.
export function completionRepairs(snapshot,plan,checkpoints,quality,pass,{expressionOnly=false}={}){
 const findings=[...(quality?.consistency?.findings||[]),...(quality?.reviews||[]).flatMap(review=>review.findings||[])];
 return checkpoints.flatMap(checkpoint=>{
  if(JSON.parse(checkpoint.trace||'[]').some(row=>row.stage==='completion_repair_'+pass))return [];
  const unit=plan.find(unit=>unit.id===checkpoint.unit_id);if(!unit)return [];
  const checks=(quality?.supplementCheck?.items||[]).filter(row=>row.title===unit.chapterTitle),supported=checks.length&&checks.every(row=>['sufficient','not_required'].includes(row.status));
  const matched=findings.filter(finding=>finding.sectionId===unit.chapterId&&typeof finding.quote==='string'&&finding.quote.length>=6&&checkpoint.text.includes(finding.quote)&&(!expressionOnly||finding.category==='language_expression')&&(finding.category!=='unresolved_placeholder'||supported));
  const located=[...matched.filter(finding=>finding.category==='language_expression').slice(0,2),...matched.filter(finding=>finding.category!=='language_expression')].filter((finding,index,rows)=>rows.findIndex(row=>row.category===finding.category&&row.quote===finding.quote)===index).slice(0,6);
  for(const issue of expressionOnly?[]:quality?.completionAudit?.issues||[]){
   const front=unit.frontMatter,applies=front==='abstract_zh'&&/^abstract_zh$|^keywords_zh$/.test(issue.code)||front==='abstract_en'&&/^abstract_en$|^keywords_en$|^english_title$/.test(issue.code)||issue.code==='raw_formula'&&/\\(?:frac|sum|sqrt|begin|tilde|exp|phi)\b/.test(checkpoint.text)||/^table_/.test(issue.code)&&/^\s*\|/m.test(checkpoint.text);
   if(applies&&located.length<6&&checkpoint.text.trim().length>=6)located.push({quote:checkpoint.text.trim().slice(0,80),category:'structure',explanation:issue.message,suggestion:'直接补齐本节缺少的文字或数学格式，保留有依据的研究事实。'});
  }
  if(!expressionOnly&&supported)for(const match of checkpoint.text.matchAll(/【(?:待补充|待核对)[：:][^】]{1,500}】/g))if(located.length<6)located.push({quote:match[0],category:'structure',explanation:'资料检查已找到对应依据，需据此补齐本处正文。',suggestion:'读取对应资料并补写，不能只删除标记。'});
  if(!located.length)return [];
  const repairUnit={...unit,completion:{...unit.completion,originalText:checkpoint.text,originalFigures:JSON.parse(checkpoint.figures||'[]'),excerpted:false,findings:located}};
  let task;try{task=thesisAgentTask(snapshot,repairUnit,[]);}catch(error){if(/原稿对象位置超出当前可核对范围/.test(String(error?.message||'')))return [];throw error;}
  // Do not let an excerpt replace an entire saved checkpoint. Keeping the
  // finding unresolved makes the final assessment block delivery safely.
  if(task.context?.revision?.excerpted)return [];
  task.context.completionRepairPass=pass+1;
  const expression=located.every(finding=>finding.category==='language_expression');
  if(expression){
   task.context.expressionOnly=true;task.context.revision.originalFigures=JSON.parse(checkpoint.figures||'[]');
   task.context.outline=(task.context.outline||[]).filter(chapter=>chapter.id===unit.chapterId).map(chapter=>({...chapter,sections:(chapter.sections||[]).filter(section=>section.id===unit.sectionId)}));task.context.completedSections=[];
   task.instructions+='本次只做已定位的表达修正，直接将修正写入完整正文，不返回建议清单。revision.originalExcerpt 是本单元完整原文。保留研究事实、数字、引用、公式、代码、表格、图表和全部待补充标记，不补造资料，不因资料检查尚未结束而跳过表达修正。不改变数值或其出现顺序，不改变来源标记及其顺序。输出与原文完全相同不会被视为完成。';
  }
  return [{unit:repairUnit,checkpoint,task,expressionOnly:expression,unitId:'completion-repair-'+pass+'::'+unit.id}];
 });
}
