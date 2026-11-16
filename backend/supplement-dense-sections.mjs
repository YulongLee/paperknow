import {manuscriptFigures} from '../dist/workspace/manuscript-figures.mjs';

const sourceIds=text=>new Set([...text.matchAll(/\[source:([^\]\r\n]+)\]/gu)].map(match=>match[1]));
// Split only at complete paragraph or Chinese-sentence boundaries, and never
// inside a fenced code block or display/inline math. An indivisible sentence
// stays unchanged: it
// must not be marked checked merely to fit the review budget.
function balanced(text){
 let fence=null;for(const match of text.matchAll(/^ {0,3}(`{3,}|~{3,})([^\n]*)$/gm)){const token=match[1];if(!fence)fence=token;else if(token[0]===fence[0]&&token.length>=fence.length&&!match[2].trim())fence=null;}if(fence)return false;
 let math='';for(const match of text.matchAll(/(?<!\\)\${1,2}/g)){if(!math)math=match[0];else if(math===match[0])math='';else return false;}
 if(math)return false;
 for(const [open,close] of [['\\(','\\)'],['\\[','\\]']]){let position=0,inside=false;while(position<text.length){const start=text.indexOf(open,position),end=text.indexOf(close,position);if(start<0&&end<0)break;if(end>=0&&(start<0||end<start)){if(!inside)return false;inside=false;position=end+close.length;}else{if(inside)return false;inside=true;position=start+open.length;}}if(inside)return false;}
 return true;
}

export function splitDenseSupplementPiece(piece,{maxSources=4,maxParts=20}={}){
 const text=String(piece?.text||'');if(!text||sourceIds(text).size<=maxSources||/\[(?:figure|docx):[^\]\r\n]+\]/u.test(text)||/^\s*\|.*\|\s*$/mu.test(text))return [{...piece,relativeOffset:0}];
 const boundaries=[...new Set([...text.matchAll(/\n[ \t]*\n|[。！？]/gu)].map(match=>match.index+match[0].length))].sort((a,b)=>a-b).filter(at=>at>0&&at<text.length&&!/^\s*(?:\[source:|[”’》」』】）\)])/u.test(text.slice(at))&&balanced(text.slice(0,at))&&balanced(text.slice(at)));
 const parts=[];let start=0;
 while(start<text.length){
  if(sourceIds(text.slice(start)).size<=maxSources){parts.push({start,end:text.length});break;}
  const candidates=boundaries.filter(end=>end>start&&sourceIds(text.slice(start,end)).size<=maxSources&&sourceIds(text.slice(start,end)).size>0);
  // If a single sentence itself exceeds the target, keep it intact instead
  // of discarding safe splits before or after it. The normal source and cost
  // limits still apply to that indivisible part.
  const end=candidates.at(-1)??boundaries.find(end=>end>start)??text.length;if(parts.length>=maxParts-1)return [{...piece,relativeOffset:0}];
  parts.push({start,end});start=end;
 }
 try{return parts.map(({start,end})=>{const value=text.slice(start,end);return {...piece,text:value,figures:manuscriptFigures(piece,value),relativeOffset:start};});}
 catch{return [{...piece,relativeOffset:0}];}
}
