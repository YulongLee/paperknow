import {parseCitationImport} from '../dist/workspace/citation-import.mjs';
import {thesisError} from './thesis-model.mjs';
const fail=message=>{throw thesisError(422,message,'draft_import_invalid');};
const identity=value=>String(value||'').normalize('NFKC').replace(/[\s\p{P}]/gu,'').toLowerCase();
function entryHead(line){
 const match=String(line).match(/^\s*(?:[\[［【]\s*([0-9０-９]{1,4})\s*[\]］】]|([0-9０-９]{1,4})(?:[.．、]\s+|[)）]\s*))\s*/u);
 if(match&&!match[1]&&Number(match[2].normalize('NFKC'))>200)return null;
 return match?{number:String(Number((match[1]||match[2]).normalize('NFKC'))),length:match[0].length,bracketed:Boolean(match[1])}:null;
}
export function importDraftReferences(groups,{sha,references:existing=[]}={}){
 const references=[...existing],entries=[],citationIds=new Map(),ambiguous=new Set(),groupEntries=new Map(),warnings=[];let reviewCount=0;
 for(const [groupIndex,group]of groups.entries()){
  const source=group.texts.join('\n').split(/\r?\n/).map(text=>text.trim()).filter(Boolean),numbered=source.some(line=>entryHead(line)?.bracketed)||Boolean(entryHead(source[0])),rows=[];if(!numbered)source.splice(0,source.length,...group.texts.map(text=>text.replace(/\s*\r?\n\s*/g,' ').trim()).filter(Boolean));
  for(const line of source){const head=numbered?entryHead(line):null;if(head||!rows.length||!numbered){rows.push({number:head?.number||null,original:head?line.slice(head.length).trim():line});}else rows.at(-1).original+=' '+line;}
  const converted=[];
  for(const row of rows){
   const original=row.original.trim(),ordinal=entries.length+1;if(!original)continue;if(ordinal>200)fail('初稿参考文献超过 200 条，请分开整理后重试；当前正文未改变。');if(original.length>4000)fail('单条参考文献内容超过 4,000 字符，请检查是否将多条文献连在一起；当前正文未改变。');if(/\[(?:source|figure|docx):/i.test(original))fail('参考文献含有无法确认的内部位置标记，请使用正常导出的 DOCX 初稿。');
   let parsed;try{const result=parseCitationImport(original);if(result.items.length!==1)throw Error('ambiguous');parsed=result.items[0];}catch{parsed={title:'原稿参考文献条目 '+ordinal,documentType:'unparsed',citationText:original,authors:'',year:'',doi:'',url:'',text:''};reviewCount++;}
   const opaque=parsed.documentType==='unparsed',reference=references.find(existing=>opaque?existing.documentType==='unparsed'&&existing.citationText===original:existing.documentType!=='unparsed'&&(existing.doi&&parsed.doi?identity(existing.doi)===identity(parsed.doi):identity(existing.title)===identity(parsed.title)&&(!existing.year||!parsed.year||String(existing.year)===String(parsed.year))&&(!existing.authors||!parsed.authors||identity(existing.authors)===identity(parsed.authors))))||{...parsed,id:'draft-ref-'+sha.slice(0,16)+'-'+ordinal,text:parsed.text||'',sourceLabel:opaque?'初稿原始条目，格式待核对；未读取文献正文':'初稿导入参考文献，待核对原文',confirmed:true};
   if(!references.includes(reference)){delete reference.rawCitation;const baseId=reference.id;for(let index=1;references.some(row=>row.id===reference.id);index++)reference.id=baseId+'-v'+index;references.push(reference);}const entry={...row,id:reference.id,needsReview:opaque};entries.push(entry);converted.push(entry);
   if(row.number){if(citationIds.has(row.number)&&citationIds.get(row.number)!==reference.id){citationIds.delete(row.number);ambiguous.add(row.number);}else if(!ambiguous.has(row.number))citationIds.set(row.number,reference.id);}
  }groupEntries.set(groupIndex,converted);
 }
 if(reviewCount){warnings.push('有 '+reviewCount+' 条参考文献已按原文保留，题录字段尚待核对，不影响本次导入。');for(const row of entries.filter(row=>row.needsReview).slice(0,3))warnings.push((row.number?'原稿 ['+row.number+']':'原稿第 '+(entries.indexOf(row)+1)+' 条')+'：'+row.original.slice(0,120)+(row.original.length>120?'…':'')+'（保留原文，待核对）');}
 if(ambiguous.size)warnings.push('原稿参考文献存在重复编号 '+[...ambiguous].join('、')+'，对应正文编号已保留，未自动指定到某一条。');
 return {references,citationIds,groupEntries,reviewCount,warnings,referenceCount:new Set(entries.map(row=>row.id)).size};
}
export function remapDraftCitations(text,citationIds,{onUnmatched=()=>{}}={}){
 return String(text).split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g).map((part,index)=>index%2?part:part.replace(/[\[［【]([0-9０-９\s,，、;；\-–—~～]+)[\]］】]/g,(match,raw)=>{
  const values=[];for(const term of raw.normalize('NFKC').split(/[,，、;；]/)){const token=term.trim(),range=token.match(/^(\d{1,4})\s*[-–—~～]\s*(\d{1,4})$/);if(range){const from=Number(range[1]),to=Number(range[2]);if(to<from||to-from>200){onUnmatched();return match;}for(let number=from;number<=to;number++)values.push(String(number));}else if(/^\d{1,4}$/.test(token))values.push(String(Number(token)));else return match;}
  const ids=[...new Set(values)];if(!ids.length||ids.some(id=>!citationIds.has(id))){onUnmatched();return match;}return ids.map(id=>'[source:'+citationIds.get(id)+']').join('');
 })).join('');
}
