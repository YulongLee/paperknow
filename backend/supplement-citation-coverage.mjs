import {isOutlineReferenceChapter} from '../dist/workspace/outline-word-budget.mjs';

// Reports source-level excerpt coverage only. Evidence has already passed the
// supplement parser's source/quotation checks. An excerpt is not proof that a
// source supports every assertion or that its complete text was reviewed.
export function markSupplementCitationCoverage(item,section,sources,{phase='final'}={}){
 if(phase!=='final'||!item||!section||isOutlineReferenceChapter(section))return item;
 const required=[...new Set([...String(section.text||'').matchAll(/\[source:([^\]\r\n]+)\]/gu)].map(match=>match[1]))];
 if(!required.length)return item;
 const proofs=new Set((Array.isArray(item.evidence)?item.evidence:[]).filter(row=>typeof row?.sourceId==='string'&&typeof row?.quote==='string'&&row.quote.trim().length>=4).map(row=>row.sourceId));
 const missing=required.filter(id=>!proofs.has(id)),coverage={total:required.length,withExcerpt:required.length-missing.length,complete:missing.length===0,missingSourceIds:missing,scope:'每来源至少一段已提供的原文摘录；不表示全文已读或逐句论断已获证实'};
 if(!missing.length)return {...item,citationCoverage:coverage};
 const labels=missing.slice(0,20).map(id=>{const matches=(sources||[]).filter(source=>source.id===id);return matches.length===1?String(matches[0].name||matches[0].title||'未命名来源').slice(0,100):'未能唯一识别的来源';});
 const message='尚需逐项核对引用来源原文：'+labels.join('、')+(missing.length>labels.length?'等 '+missing.length+' 项':'')+'。';
 return {...item,status:'missing',citationCoverage:coverage,reason:item.status==='missing'?item.reason:'部分正文引用尚未逐项提供可核对的原文摘录。',missing:[...(Array.isArray(item.missing)?item.missing:[]),message]};
}
