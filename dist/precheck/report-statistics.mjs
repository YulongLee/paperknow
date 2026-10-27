import {rangeCount,unionRanges,countChars} from './engine.mjs';
// Read-only report statistics. Multiple hits in one source and hits shared by
// different sources are merged at the original paragraph's character offsets.
export function reportStatistics(report){
 const total=Math.max(0,Number(report.totalChars)||0),sources=report.sources||[],sourceCharacters=new Map(sources.map(s=>[s.id,0]));
 let paragraphs=0,matchedParagraphs=0,longestMatch=0;
 for(const section of report.sections||[]){if(!section.included)continue;
  for(const paragraph of section.paragraphs||[]){
   paragraphs++;const text=String(paragraph.text||''),size=Array.from(text).length;
   const matches=(paragraph.matches||[]).filter(m=>Array.isArray(m.range)&&m.range.length===2&&m.range.every(Number.isSafeInteger)&&m.range[0]>=0&&m.range[1]>m.range[0]&&m.range[1]<=size);
   if(matches.length)matchedParagraphs++;
   for(const [start,end] of unionRanges(matches.map(m=>m.range)))longestMatch=Math.max(longestMatch,countChars(Array.from(text).slice(start,end).join('')));
   for(const id of new Set(matches.map(m=>m.sourceId))){if(sourceCharacters.has(id))sourceCharacters.set(id,sourceCharacters.get(id)+rangeCount(text,matches.filter(m=>m.sourceId===id).map(m=>m.range)));}
  }
 }
 const ranked=sources.map(source=>({source,characters:Math.min(total,sourceCharacters.get(source.id)||0)})).sort((a,b)=>b.characters-a.characters);
 const maximum=ranked[0]?.characters>0?ranked[0]:{source:null,characters:0};
 return{paragraphs,matchedParagraphs,longestMatch,sourceCharacters,maximum,maximumRatio:total?maximum.characters/total:0};
}
