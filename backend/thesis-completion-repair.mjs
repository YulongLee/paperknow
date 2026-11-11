import {canSafeExpressionEdit} from './thesis-expression-repair.mjs';
import {thesisAgentTask} from './thesis-model.mjs';

// Only exact, server-located review findings can request another rewrite. Missing
// facts are not repair instructions. All passes share the original job budget.
export function completionRepairs(snapshot,plan,checkpoints,quality,pass,{expressionOnly=false}={}){
 const findings=[...(quality?.consistency?.findings||[]),...(quality?.reviews||[]).flatMap(review=>review.findings||[])];
 return checkpoints.flatMap(checkpoint=>{
  if(JSON.parse(checkpoint.trace||'[]').some(row=>row.stage==='completion_repair_'+pass))return [];
  const unit=plan.find(unit=>unit.id===checkpoint.unit_id);if(!unit)return [];
  const matched=findings.filter(finding=>finding.category==='language_expression'&&canSafeExpressionEdit(checkpoint.text,finding.quote)&&finding.sectionId===unit.chapterId&&typeof finding.quote==='string'&&finding.quote.length>=6&&checkpoint.text.includes(finding.quote));
  const located=[...matched.filter(finding=>finding.category==='language_expression').slice(0,2),...matched.filter(finding=>finding.category!=='language_expression')].filter((finding,index,rows)=>rows.findIndex(row=>row.category===finding.category&&row.quote===finding.quote)===index).slice(0,6);
  // Substantive changes remain visible for author review. Only a narrowly
  // verifiable, unquoted discourse-filler deletion can be automated here.
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
   task.instructions+='仅提交局部替换：candidate 为 {complete:true,edits:[{old:原句,new:替换句}]}；old 必须逐字出自 revision.findings 的 quote 且在原文中唯一，最多两处。系统将修改合并到完整原文，不要重写其他段落。不能更改数字、引用、公式、代码、表格、图表或待补充标记。';task.instructions+='本次只做已定位的表达修正，直接将修正写入完整正文，不返回建议清单。revision.originalExcerpt 是本单元完整原文。保留研究事实、数字、引用、公式、代码、表格、图表和全部待补充标记，不补造资料，不因资料检查尚未结束而跳过表达修正。不改变数值或其出现顺序，不改变来源标记及其顺序。输出与原文完全相同不会被视为完成。';
  }
  return [{unit:repairUnit,checkpoint,task,expressionOnly:expression,unitId:'completion-repair-'+pass+'::'+unit.id}];
 });
}
