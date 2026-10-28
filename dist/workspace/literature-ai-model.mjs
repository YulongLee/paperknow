import {readingModes} from './literature-reading-modes.mjs';
export const literatureAiLimit=32000;
// Match the server's read/answer unit grouping before preparing a paid task.
// Each unit needs at least one continuous, nonblank quote of five characters.
export function requireReadingCitationCoverage(materials){
 let ranges=0,size=0,quotable=false;
 const check=()=>{if(ranges&&!quotable)throw Error('本次原文范围中有一组片段不足以提供至少 5 字符的连续原文依据，请补充完整段落或调整范围后再研读。');};
 for(const material of materials)for(let start=0,text=String(material.text||'').trim();start<text.length;start+=5000){const end=Math.min(text.length,start+5000);if(ranges&&(size+end-start>6000||ranges>=6)){check();ranges=0;size=0;quotable=false;}ranges++;size+=end-start;quotable ||= text.slice(start,end).trim().length>=5;}
 check();
}
export function literatureParagraphs(text){
 const output=[];for(const block of String(text||'').replace(/\r\n?/g,'\n').split(/\n[ \t]*\n/).map(part=>part.trim()).filter(Boolean)){let rest=block;const split=block.length>3200;while(rest.length>3200){const prefix=rest.slice(0,3200);let cut=0;for(const match of prefix.matchAll(/[。！？.!?;；]\s*|\n/g))if(match.index+match[0].length>=1600)cut=match.index+match[0].length;if(!cut)cut=3200;if(/[\uD800-\uDBFF]/.test(rest[cut-1]))cut--;output.push({text:rest.slice(0,cut).trim(),split});rest=rest.slice(cut).trimStart();}if(rest.trim())output.push({text:rest.trim(),split});}
 return output.map((part,index)=>({...part,id:'p'+(index+1),index:index+1}));
}
export function selectReadingMaterials(paper,start=1,end){
 if(!paper||paper.scope==='metadata'||!String(paper.text||'').trim())throw Error('这篇文献只有题录，请先补充有权使用的正文或摘要。');
 const paragraphs=literatureParagraphs(paper.text),first=Number(start),last=Number(end??paragraphs.length);
 if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first||last>paragraphs.length)throw Error('请选择有效的原文段落范围。');
 const selected=paragraphs.slice(first-1,last);if(selected.length>20)throw Error('本次最多处理 20 段原文，请缩小范围后分次研读。');const characters=selected.reduce((n,p)=>n+p.text.length,0);
 if(characters>literatureAiLimit)throw Error('本次选中原文超过 32,000 字符，请缩小段落范围；不会自动截断原文。');
 return selected.map(p=>({id:p.id,name:`${String(paper.title).slice(0,180)} · 第 ${p.index} 段${paper.scope==='abstract'?'（摘要）':''}`,text:p.text}));
}
export function validateLiteratureAiOutput(output,snapshot,operation){
 if(!output||typeof output.text!=='string'||!output.text.trim()||output.text.length>100000)throw Error('生成内容为空或过长，请保留原文并重新读取任务状态。');
 const materials=snapshot.materials||[],sources=new Map(materials.map(m=>[m.id,m]));
 if(operation==='translate'){
  if(output.targetLanguage!==snapshot.language)throw Error('译文目标语言与本次选择不一致。');
  if(!Array.isArray(output.segments)||output.segments.length!==materials.length)throw Error('译文段落未与选中原文完整对应，不能采纳。');
  output.segments.forEach((part,i)=>{if(part.id!==materials[i].id||part.source!==materials[i].text||typeof part.translation!=='string'||!part.translation.trim())throw Error('译文中的原文或段落顺序不匹配，请重新核对。');});
 }else{
  if(!Array.isArray(output.citations)||!output.citations.length)throw Error('这份解读缺少原文依据，暂不能保存为研读结果。');
  for(const citation of output.citations){const source=sources.get(citation?.sourceId);if(!source||typeof citation.quote!=='string'||!citation.quote.trim()||!source.text.includes(citation.quote))throw Error('生成依据不能在本次原文中定位，暂不能采纳。');}
 }
 if(!Array.isArray(output.sourceIds)||(operation!=='translate'&&!output.sourceIds.length)||output.sourceIds.some(id=>!sources.has(id)))throw Error('结果来源不属于本次选中原文，请重新核对。');
 return structuredClone(output);
}
export function literatureAiExport(paper,result){
 const scope=result.sourceScope==='abstract'?'仅基于所选摘要':'仅基于所选导入正文';
 const head=[paper.title,result.operation==='translate'?'文献翻译':result.operation==='answer'?'文献问答':'文献研读',`材料范围：${scope}`,`保存时间：${result.createdAt}`,result.question?'问题：'+result.question:'',result.language?'目标语言：'+result.language:''].filter(Boolean).join('\n');
 if(result.operation==='translate')return head+'\n\n'+result.output.segments.map(part=>`【${part.id} 原文】\n${part.source}\n\n【译文】\n${part.translation}`).join('\n\n');
 const map=new Map(result.materials.map(m=>[m.id,m]));return head+'\n\n'+result.output.text+'\n\n原文依据\n'+result.output.citations.map(c=>`[${c.sourceId}] ${map.get(c.sourceId)?.name||c.sourceId}\n${c.quote}`).join('\n\n');
}
export function validateSavedLiteratureAiResults(value){
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>30)throw Error('每篇文献最多保留 30 份研读与翻译结果。');
 return value.map(record=>{if(!record||typeof record.id!=='string'||!['read','answer','translate'].includes(record.operation)||!Array.isArray(record.materials)||!record.materials.length||record.materials.length>20||!['full','abstract'].includes(record.sourceScope))throw Error('研读备份中的来源或结果格式无效。');const materials=record.materials.map(m=>{if(!m||typeof m.id!=='string'||typeof m.text!=='string'||!m.text.trim()||m.text.length>32000)throw Error('研读备份中的原文段落无效。');return {id:m.id,name:String(m.name||'').slice(0,500),text:m.text};});if(materials.reduce((n,m)=>n+m.text.length,0)>32000)throw Error('研读备份中的原文超过单次范围。');if(record.mode!==undefined&&(record.operation!=='read'||!Object.hasOwn(readingModes,record.mode)))throw Error('研读模式格式无效。');if(record.includeHistory!==undefined&&(record.operation!=='answer'||typeof record.includeHistory!=='boolean'))throw Error('问答设置格式无效。');const output=validateLiteratureAiOutput(record.output,{materials,language:record.language},record.operation);return {...(record.includeHistory!==undefined?{includeHistory:record.includeHistory}:{}),...(record.mode!==undefined?{mode:record.mode}:{}),...(Object.hasOwn(record,'editedAt')?{editedAt:String(record.editedAt||'').slice(0,100)}:{}),id:record.id.slice(0,200),jobId:String(record.jobId||'').slice(0,200),operation:record.operation,sourceScope:record.sourceScope,question:String(record.question||'').slice(0,2000),language:record.operation==='translate'?String(record.language||'').slice(0,30):'',materials,output,createdAt:String(record.createdAt||'').slice(0,100)};});
}
