// Bind the validated, current-run diagnosis to the original chapter identity.
// Titles alone are not unique; a repeated heading must not inherit another
// chapter's missing facts. The original quote-bound writing plan is immutable.
export function completionDiagnosis(report,chapters,units=[]){
 const items=(report?.items||[]).flatMap(item=>{
  const match=/^check-(\d+)-(\d+)(?:-recovery-\d+){0,8}$/.exec(item.id||''),chapter=match?chapters[Number(match[1])]:null;
  if(!chapter||String(chapter.title).slice(0,200)!==item.title)return [];
  const quote=typeof item.manuscriptQuote==='string'?item.manuscriptQuote:'';
  const text=String(chapter.text||''),offset=quote.length>=8?text.indexOf(quote):-1;
  const unique=offset>=0&&text.indexOf(quote,offset+1)<0;
  const matched=unique?units.filter(unit=>unit.chapterId===chapter.id&&String(unit.completion?.originalText||'').includes(quote)):[];
  const unitId=matched.length===1?matched[0].id:undefined;
  const evidence=(Array.isArray(item.evidence)?item.evidence:[]).filter(entry=>typeof entry?.sourceId==='string'&&entry.sourceId.length<=150&&typeof entry.quote==='string'&&entry.quote.length>=4).slice(0,4).map(entry=>({sourceId:entry.sourceId,quote:entry.quote.slice(0,160)}));
  return [{chapterId:chapter.id,...(unitId?{unitId}:{}),title:item.title,status:item.status,requirement:item.requirement,reason:item.reason,...(quote?{manuscriptQuote:quote.slice(0,200)}:{}),missing:(item.missing||[]).slice(0,4),...(evidence.length?{evidence}:{})}];
 });
 return {version:1,status:report?.coverage?.complete===true?'checked':'unavailable',coverage:report?.coverage||{total:0,checked:0,complete:false},items};
}
export function withCompletionDiagnosis(unit,diagnosis){
 if(!unit.completion||unit.personalMatter||!diagnosis)return unit;
 const items=diagnosis.items.filter(item=>item.chapterId===unit.chapterId&&(!item.unitId||item.unitId===unit.id)),missing=[...new Set([...items.flatMap(item=>item.missing),...(unit.completion.missingInformation||[])])].slice(0,10).map(text=>String(text).slice(0,400));
 const sourceIds=[...new Set(items.filter(item=>item.unitId===unit.id).flatMap(item=>(item.evidence||[]).map(entry=>entry.sourceId)))];
 return {...unit,completionSourceIds:[...new Set([...sourceIds,...(unit.completionSourceIds||[])])],completion:{...unit.completion,missingInformation:missing,assessment:{status:diagnosis.status,items:items.slice(0,4).map(({status,requirement,manuscriptQuote,missing,evidence,unitId})=>({status,requirement,...(manuscriptQuote?{manuscriptQuote}:{}),missing,...(unitId===unit.id&&evidence?.length?{evidence}:{})}))}}};
}
export function completionResolutions(diagnosis,report,chapters,{current=false}={}){
 if(!diagnosis)return null;
 const final=completionDiagnosis(report,chapters),complete=current&&report?.phase==='final'&&report?.coverage?.complete===true;
 return {...diagnosis,items:diagnosis.items.map(item=>{
  const checked=final.items.filter(row=>row.chapterId===item.chapterId),passed=checked.length&&checked.every(row=>['sufficient','not_required'].includes(row.status));
  return {...item,resolution:!complete?'pending':passed?'resolved':'needs_materials',remaining:complete?[...new Set(checked.flatMap(row=>row.missing))]:[]};
 })};
}
