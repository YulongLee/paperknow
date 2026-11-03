// Bind the validated, current-run diagnosis to the original chapter identity.
// Titles alone are not unique; a repeated heading must not inherit another
// chapter's missing facts. The original quote-bound writing plan is immutable.
export function completionDiagnosis(report,chapters){
 const items=(report?.items||[]).flatMap(item=>{
  const match=/^check-(\d+)-(\d+)$/.exec(item.id||''),chapter=match?chapters[Number(match[1])]:null;
  if(!chapter||String(chapter.title).slice(0,200)!==item.title)return [];
  return [{chapterId:chapter.id,title:item.title,status:item.status,requirement:item.requirement,reason:item.reason,missing:(item.missing||[]).slice(0,4)}];
 });
 return {version:1,status:report?.coverage?.complete===true?'checked':'unavailable',coverage:report?.coverage||{total:0,checked:0,complete:false},items};
}
export function withCompletionDiagnosis(unit,diagnosis){
 if(!unit.completion||unit.personalMatter||!diagnosis)return unit;
 const items=diagnosis.items.filter(item=>item.chapterId===unit.chapterId),missing=[...new Set([...items.flatMap(item=>item.missing),...(unit.completion.missingInformation||[])])].slice(0,10).map(text=>String(text).slice(0,400));
 return {...unit,completion:{...unit.completion,missingInformation:missing,assessment:{status:diagnosis.status,items:items.slice(0,4).map(({status,requirement,missing})=>({status,requirement,missing}))}}};
}
export function completionResolutions(diagnosis,report,chapters,{current=false}={}){
 if(!diagnosis)return null;
 const final=completionDiagnosis(report,chapters),complete=current&&report?.phase==='final'&&report?.coverage?.complete===true;
 return {...diagnosis,items:diagnosis.items.map(item=>{
  const checked=final.items.filter(row=>row.chapterId===item.chapterId),passed=checked.length&&checked.every(row=>['sufficient','not_required'].includes(row.status));
  return {...item,resolution:!complete?'pending':passed?'resolved':'needs_materials',remaining:complete?[...new Set(checked.flatMap(row=>row.missing))]:[]};
 })};
}
