import {thesisFrontMatterKind,thesisManualBackMatter} from './thesis-delivery.mjs';
const marker=/【(?:待补充|待核对|草稿说明)[：:]([^】]{1,1000})】|\[(?:待补充|待核对|草稿说明|To be supplied|To be verified|Draft note)[：:]([^\]]{1,1000})\]/gi;
export function thesisCompletionNeeds(item={}){
 const chapters=(item.chapters||[]).map(chapter=>{
  const text=String(chapter.text||''),requests=[...text.matchAll(marker)].map(match=>(match[1]||match[2]).trim());
  if(!text.trim())requests.push(thesisManualBackMatter(chapter)?'请补充希望感谢的人或机构，以及实际提供的帮助。':thesisFrontMatterKind(chapter)?'系统将根据补齐后的正文整理摘要和关键词。':'请提供本章所需的研究过程、记录或结果，系统将据此完善正文。');
  const tableCount=(text.match(/^\s*\|?\s*:?-{3,}:?\s*\|/gm)||[]).length,titleCount=(text.match(/^\s*表\s*\d+(?:[.－-]\d+)?\s+\S/gm)||[]).length;
  return {id:chapter.id,title:chapter.title,requests:[...new Set(requests)].slice(0,30),needsContent:!text.trim()||requests.length>0,needsTableTitles:tableCount>titleCount};
 });
 return {chapters:chapters.filter(row=>row.needsContent||row.needsTableTitles),hasSavedText:(item.chapters||[]).some(row=>String(row.text||'').trim()),hasReferenceText:(item.snapshot?.references||[]).some(row=>row.confirmed&&String(row.text||'').trim())};
}
export const completionIssueCodes=new Set(['abstract_zh','abstract_en','keywords_zh','keywords_en','english_title','reference_minimum','foreign_references','citations_missing','citation_provenance','references_not_cited','unresolved_sources','duplicate_paragraphs','duplicate_headings','review_findings','table_captions','table_numbers','raw_formula']);
export const safeCompletionIssues=value=>Array.isArray(value)?[...new Set(value.filter(code=>completionIssueCodes.has(code)))].sort():[];
