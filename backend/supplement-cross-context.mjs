import {numberedMarkdownTables} from '../dist/workspace/numbered-markdown-tables.mjs';

// Cross-chapter manuscript excerpts are context, not source evidence. Never
// infer a missing or unique table from truncated data or an ambiguous number.
export function supplementCrossTableIndex(chapters){return (chapters||[]).flatMap(chapter=>numberedMarkdownTables(chapter.text).map(table=>({chapter,table})));}
export function supplementCrossTableContext(batch,chapters,{maxCharacters=3200,tableIndex}={}){
 const numbers=[...new Set((batch||[]).flatMap(section=>[...String(section.text||'').matchAll(/(?:表\s*|\btable\s+)(\d+(?:[.\-－]\d+)*)/giu)].map(match=>match[1].replace(/[.－]/g,'-'))))].slice(0,12);
 const all=tableIndex||supplementCrossTableIndex(chapters);
 const abstract=(batch||[]).some(section=>/^front-abstract_/.test(section.id||'')||/^摘要$|^abstract$/iu.test(section.title||''));
 // An abstract may summarize its own one uniquely numbered complete table
 // without citing a table number. Never guess between multiple tables.
 const abstractSummary=!numbers.length&&abstract&&all.length===1;
 if(abstractSummary)numbers.push(all[0].table.number);
 if(!numbers.length)return null;
 const tables=[],unavailable=[];let remaining=Math.max(0,Math.min(3200,maxCharacters));
 for(const number of numbers){const matches=all.filter(row=>row.table.number===number);
  if(matches.length!==1){unavailable.push({number,reason:matches.length?'ambiguous':'not_located'});continue;}
  const {chapter,table}=matches[0],text=String(chapter.text||''),fullEnd=table.end;
  // Include surrounding calculation text only after preserving the actual
  // table first; if it will not fit, label the excerpt as incomplete.
  const limit=Math.min(remaining,2400),tableLength=fullEnd-table.offset,before=Math.min(500,table.offset,Math.max(0,Math.floor((limit-tableLength)/2))),start=table.offset-before,end=Math.min(text.length,fullEnd+700,start+limit);
  if(limit<80||end<=start){unavailable.push({number,reason:'context_limit'});continue;}
  const excerpt=text.slice(start,end);remaining-=excerpt.length;
  tables.push({number,chapterId:String(chapter.id||'').slice(0,160),title:String(chapter.title||'正文').slice(0,100),offset:start,end,totalCharacters:text.length,text:excerpt,entireTable:end>=fullEnd,precedingTextTruncated:start>0,followingTextTruncated:end<text.length,excerpted:end<text.length||start>0});
 }
 return {tables,unavailable,...(abstractSummary?{selection:'single_table_abstract_context'}:{}),scope:'已保存的本篇正文片段，非外部证据；未显示的内容不能推断不存在'};
}
