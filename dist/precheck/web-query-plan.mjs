import {countChars} from './engine.mjs';
// Shared by the admission preview and server planner: the preview cannot promise
// a search window that the server will reject. Sampling never means full coverage.
export function publicWebQueryPlan(parsed,maxQueries=3){
 const paragraphs=parsed.sections.filter(s=>!s.excluded).flatMap(s=>s.paragraphs),windows=[];
 for(const p of paragraphs){
  const chars=Array.from(p.text);
  if(countChars(p.text)<32)continue;
  const size=Math.min(100,chars.length),starts=[0];
  if(chars.length>200)starts.push(Math.floor((chars.length-size)/2),chars.length-size);
  for(const start of [...new Set(starts)]){
   const excerpt=chars.slice(start,start+size).join('').replace(/[\x00-\x1f\x7f]/g,' ').trim();
   if(countChars(excerpt)>=24)windows.push({paragraphId:p.id,start,end:start+size,excerpt});
  }
 }
 const chosen=[],seen=new Set(),count=Math.min(maxQueries,windows.length),priority=[];
 for(let i=0;i<count;i++)priority.push(count===1?0:Math.round(i*(windows.length-1)/(count-1)));
 // Keep the original evenly spaced priority, then fill duplicate slots from
 // remaining real windows without exceeding the existing query limit.
 for(const index of [...priority,...windows.keys()]){
  const window=windows[index],key=window.excerpt.normalize('NFKC').toLowerCase();
  if(!seen.has(key)){chosen.push(window);seen.add(key);}
  if(chosen.length>=count)break;
 }
 return{queries:chosen,totalParagraphs:paragraphs.length,sampledParagraphs:new Set(chosen.map(x=>x.paragraphId)).size};
}
