// Locations refer only to the exact submitted version. They do not add new
// similarity matches or promote a chunk-level AI label to a sentence verdict.
export const MAX_AI_LOCATIONS=300;
export function originalParagraphs(text){
 const chars=Array.from(String(text||'')),rows=[];let start=0;
 const append=end=>{if(chars.slice(start,end).join('').trim())rows.push({number:rows.length+1,start,end,text:chars.slice(start,end).join('')});};
 for(let i=0;i<chars.length;i++)if(chars[i]==='\n'||chars[i]==='\r'){append(i);if(chars[i]==='\r'&&chars[i+1]==='\n')i++;start=i+1;}
 append(chars.length);return rows;
}
export function locationExcerpt(text,start=0,end=Array.from(text).length,max=150){
 const chars=Array.from(String(text)),from=Math.max(0,start-25),to=Math.min(chars.length,from+max);
 return{start:from,end:to,text:(from?'…':'')+chars.slice(from,to).join('')+(to<chars.length?'…':'')};
}
export function similarityLocations(report){
 const rows=[];let number=0;
 for(const section of report.sections||[])for(const [index,paragraph] of (section.paragraphs||[]).entries()){
  number++;const size=Array.from(String(paragraph.text||'')).length;
  const matches=section.included?(paragraph.matches||[]).filter(m=>Array.isArray(m.range)&&m.range.length===2&&m.range.every(Number.isSafeInteger)&&m.range[0]>=0&&m.range[1]>m.range[0]&&m.range[1]<=size):[];
  rows.push({number,index:index+1,section,paragraph,matches,target:'original-paragraph-'+number,comparisonTarget:'comparison-paragraph-'+number});
 }
 return rows;
}
export function aigcLocations(text,parts){
 const paragraphs=originalParagraphs(text),findings=[];
 for(const paragraph of paragraphs){const hits=parts.filter(part=>!part.skipped&&part.label==='aigc'&&part.start<paragraph.end&&part.end>paragraph.start);if(!hits.length)continue;
  const first=hits[0],start=Math.max(paragraph.start,first.start),end=Math.min(paragraph.end,first.end);
  findings.push({...paragraph,startOfRisk:start,endOfRisk:end,partIndex:first.index,target:`ai-original-${paragraph.number}-${first.index+1}`,partIndices:hits.map(part=>part.index),excerpt:locationExcerpt(paragraph.text,start-paragraph.start,end-paragraph.start).text});
 }
 return{paragraphs,findings,total:findings.length,visible:findings.slice(0,MAX_AI_LOCATIONS)};
}
