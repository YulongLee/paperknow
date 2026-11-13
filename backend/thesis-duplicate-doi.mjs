import {isOutlineReferenceChapter} from '../dist/workspace/outline-word-budget.mjs';

// Treat only explicit, well-formed DOI identifiers as comparable. A match is
// a reason to review the bibliography, never proof that two entries or their
// cited passages are interchangeable.
export function comparableDoi(value){
 let doi=String(value||'').trim();
 if(/^https?:\/\//iu.test(doi)){
  try{const url=new URL(doi);if(!['doi.org','dx.doi.org'].includes(url.hostname.toLowerCase())||url.username||url.password||url.search||url.hash||url.port)return '';doi=decodeURIComponent(url.pathname.slice(1));}catch{return '';}
 }else doi=doi.replace(/^doi\s*:\s*/iu,'');
 return /^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/iu.test(doi)?doi.toLowerCase():'';
}
export function citedDuplicateDoiIssues(snapshot={},chapters=[]){
 const sources=Array.isArray(snapshot.references)?snapshot.references:[],materials=Array.isArray(snapshot.materials)?snapshot.materials:[],counts=new Map();
 for(const row of [...sources,...materials])if(typeof row?.id==='string')counts.set(row.id,(counts.get(row.id)||0)+1);
 const cited=new Set();for(const chapter of chapters)if(chapter&&!isOutlineReferenceChapter(chapter))for(const match of String(chapter.text||'').matchAll(/\[source:([^\]\r\n]+)\]/gu))cited.add(match[1]);
 const groups=new Map();for(const row of sources){if(row?.confirmed!==true||counts.get(row.id)!==1||!cited.has(row.id))continue;const doi=comparableDoi(row.doi);if(!doi)continue;const list=groups.get(doi)||[];list.push(row);groups.set(doi,list);}
 return [...groups].filter(([,rows])=>rows.length>1).map(([doi,rows])=>({title:'参考文献',text:`${rows.length} 条已引用题录的 DOI 相同（${doi}），可能是重复题录或题录信息存在差异。请核对出处和正文引用；系统保留原有引用，不自动合并。`}));
}
