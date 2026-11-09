import {countChars} from './engine.mjs';
// Shared by the admission preview and server planner: the preview cannot promise
// a search window that the server will reject. Sampling never means full coverage.
export function publicWebQueryPlan(parsed,maxQueries=12){
 const paragraphs=parsed.sections.filter(s=>!s.excluded).flatMap(s=>s.paragraphs),windows=[];
 for(const p of paragraphs){
  const chars=Array.from(p.text);
  if(countChars(p.text)<32)continue;
  const size=Math.min(100,chars.length);
  // Spread the finite search budget over long paragraphs, instead of only
  // looking at their start/middle/end. The cap keeps planning predictable and
  // does not increase the number of remote searches.
  const requested=Number.isSafeInteger(maxQueries)&&maxQueries>0?maxQueries:0;
  const windowCount=chars.length>200?Math.min(Math.ceil(chars.length/size),Math.max(3,Math.min(requested*2,24))):1;
  const starts=Array.from({length:windowCount},(_,i)=>windowCount===1?0:Math.round(i*(chars.length-size)/(windowCount-1)));
  for(const start of [...new Set(starts)]){
   const excerpt=chars.slice(start,start+size).join('').replace(/[\x00-\x1f\x7f]/g,' ').trim();
   if(countChars(excerpt)>=24)windows.push({paragraphId:p.id,start,end:start+size,excerpt});
  }
 }
 const chosen=[],seen=new Set(),count=Number.isSafeInteger(maxQueries)&&maxQueries>0?Math.min(maxQueries,windows.length):0;
 // Sample paragraph positions rather than window positions: a long paragraph
 // may contribute many windows but should not crowd out later short paragraphs.
 const grouped=new Map();for(const window of windows){if(!grouped.has(window.paragraphId))grouped.set(window.paragraphId,[]);grouped.get(window.paragraphId).push(window);}
 const groups=[...grouped.values()];
 const select=window=>{const key=window.excerpt.normalize('NFKC').toLowerCase();if(seen.has(key))return false;chosen.push(window);seen.add(key);return true;};
 const evenly=(length,n)=>Array.from({length:n},(_,i)=>n===1?0:Math.round(i*(length-1)/(n-1)));
 const groupOrder=[...new Set([...evenly(groups.length,Math.min(count,groups.length)),...groups.keys()])];
 for(const index of groupOrder){if(chosen.length>=count)break;for(const window of groups[index])if(select(window))break;}
 // After covering distinct paragraphs, distribute spare queries over windows.
 const windowOrder=[...new Set([...evenly(windows.length,count),...windows.keys()])];
 for(const index of windowOrder){if(chosen.length>=count)break;select(windows[index]);}
 return{queries:chosen,totalParagraphs:paragraphs.length,sampledParagraphs:new Set(chosen.map(x=>x.paragraphId)).size};
}
