import {literatureParagraphs,selectReadingMaterials} from './literature-ai-model.mjs';

const cache=new Map();
const heading=text=>/^#{1,6}\s+\S/.test(text)&&text.length<180;
const excluded=text=>/^(?:#{1,6}\s*)?(?:references|bibliography|参考文献|acknowledg(?:e)?ments?|致谢)\s*$/i.test(text.trim());
// Overview selection is independent of the question box and contains only
// complete, immutable paragraphs. It is section coverage, never a full-text claim.
export function selectLiteratureOverview(paper,mode='summary'){
 const key=paper.id+':'+mode,old=cache.get(key);if(old?.text===paper.text)return old.value;
 const parts=literatureParagraphs(paper.text),sections=[];let section=null,skip=false;
 const abstract=parts.findIndex(p=>/^#{1,6}\s*(?:abstract|摘要|摘\s*要)\s*$/i.test(p.text));
 for(const part of parts.slice(abstract<0?0:abstract)){
  if(heading(part.text)){skip=excluded(part.text);section=null;if(!skip){section={title:part.text.replace(/^#+\s*/,''),parts:[]};sections.push(section);}continue;}
  if(skip||part.text.trim().length<5)continue;
  if(!section){section={title:'正文',parts:[]};sections.push(section);}section.parts.push(part);
 }
 const grouped=new Map();for(const s of sections.filter(s=>s.parts.length)){const chapter=s.title.match(/^(\d+)(?:\.|\s)/)?.[1],key=chapter?'chapter:'+chapter:s.title;const group=grouped.get(key);if(group)group.parts.push(...s.parts);else grouped.set(key,{title:s.title,parts:[...s.parts]});}
 const usable=[...grouped.values()],selected=new Set();let chars=0;
 const add=part=>{if(!part||selected.has(part.index)||selected.size>=20||chars+part.text.length>18000)return false;selected.add(part.index);chars+=part.text.length;return true;};
 // Take a paragraph from each section before adding further detail. Always
 // reserve abstract and conclusion when unusually many subheadings exist.
 const priority=[...usable.filter(s=>/abstract|摘要|结论|conclusion/i.test(s.title)),...usable.filter(s=>!/abstract|摘要|结论|conclusion/i.test(s.title))];
 const ranked=s=>s.parts.map((p,i)=>({p,score:(i===0?3:0)+(/\d/.test(p.text)?1:0)+(/result|achieve|experiment|method|limitation|发现|结果|方法|局限/i.test(p.text)?2:0)})).sort((a,b)=>b.score-a.score||a.p.index-b.p.index).map(v=>v.p);
 const rows=new Map(usable.map(s=>[s,ranked(s)]));for(const s of priority)add(rows.get(s)[0]);
 for(let depth=1;depth<20&&selected.size<20;depth++)for(const s of usable)add(rows.get(s)[depth]);
 if(!selected.size)selectReadingMaterials(paper,1,1,parts); // preserve the shared unavailable-source error
 const materials=[...selected].sort((a,b)=>a-b).flatMap(i=>selectReadingMaterials(paper,i,i,parts));
 const covered=usable.filter(s=>s.parts.some(p=>selected.has(p.index))).length;
 const value={materials,coverage:{strategy:'section-overview-v2',sections:usable.length,coveredSections:covered,selectedParagraphs:materials.length,totalParagraphs:parts.length,characters:chars}};
 cache.set(key,{text:paper.text,value});while(cache.size>9)cache.delete(cache.keys().next().value);return value;
}

export function readingRangeLabel({operation,automatic,parts,materials,coverage}){
 if(operation==='answer'&&automatic)return '按问题定位 · '+materials.length+' / '+parts.length+' 段';
 if(coverage)return '按章节研读 · '+coverage.coveredSections+' / '+coverage.sections+' 节 · '+materials.length+' 段';
 const ids=materials.map(m=>Number(m.id.replace(/^p/,'')));
 return materials.length===parts.length?'全部 '+parts.length+' 段':'第 '+Math.min(...ids)+'—'+Math.max(...ids)+' 段 / 共 '+parts.length+' 段';
}
