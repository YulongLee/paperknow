import {isOutlineReferenceChapter} from './outline-word-budget.mjs';

// This is a document presentation only. Stored chapter text and its source IDs
// remain unchanged so edits, evidence checks and historic versions stay traceable.
export function presentThesisDocument(snapshot={},chapters=[],{title=snapshot.title}={}){
 const rows=chapters.filter(row=>String(row?.text||'').trim());
 if(!rows.length)return '';
 const missingChapters=(Array.isArray(snapshot.outline)?snapshot.outline:[]).filter(chapter=>!isOutlineReferenceChapter(chapter)&&!rows.some(row=>chapter.id&&row.id?chapter.id===row.id:String(chapter.title||'').trim()===String(row.title||'').trim()));
 const references=new Map((snapshot.references||[]).filter(row=>row?.confirmed===true).map(row=>[row.id,row]));
 const materials=new Map((snapshot.materials||[]).filter(row=>row?.confirmed===true).map(row=>[row.id,row]));
 for(const id of references.keys())if(materials.has(id)){references.delete(id);materials.delete(id);}
 const referenceNumbers=new Map(),materialNumbers=new Map();
 const identify=id=>{
  if(references.has(id)){if(!referenceNumbers.has(id))referenceNumbers.set(id,referenceNumbers.size+1);return `[${referenceNumbers.get(id)}]`;}
  if(materials.has(id)){if(!materialNumbers.has(id))materialNumbers.set(id,materialNumbers.size+1);return `[材料${materialNumbers.get(id)}]`;}
  return null;
 };
 // Assign numbers in first-citation order, then retain any associated sources
 // from saved versions even when a manual edit has removed its inline marker.
 for(const row of rows)for(const match of String(row.text).matchAll(/\[source:([^\]]+)\]/g))identify(match[1]);
 for(const row of rows)for(const id of row.sourceIds||[])identify(id);
 let unknown=false;
 const render=text=>String(text).replace(/\[source:([^\]]+)\]/g,(_,id)=>{const label=identify(id);if(label)return label;unknown=true;return '[来源待核对]';});
 const body=rows.flatMap(row=>{const title=String(row.title||''),lines=String(row.text).split(/\r?\n/),text=title.trim()&&lines[0].trim()===title.trim()?lines.slice(1).join('\n'):row.text;return [title,render(text)];});
 const listedReferences=new Set(),normalize=value=>String(value??'').replace(/\s+/g,' ').trim();
 for(const row of rows.filter(isOutlineReferenceChapter)){
  const text=String(row.text),markers=[...text.matchAll(/\[source:([^\]]+)\]/g)];
  for(let index=0;index<markers.length;index++){
   const marker=markers[index],reference=references.get(marker[1]);if(!reference||!normalize(reference.title))continue;
   const entry=normalize(text.slice(marker.index+marker[0].length,markers[index+1]?.index??text.length));
   // A marker alone is not a bibliography. Suppress the canonical inventory
   // only when this entry retains every available bibliographic field.
   if([reference.authors,reference.title,reference.year,reference.doi,reference.url].map(normalize).filter(Boolean).every(field=>entry.includes(field)))listedReferences.add(marker[1]);
  }
 }
 const bibliography=[...referenceNumbers].filter(([id])=>!listedReferences.has(id)).map(([id,number])=>{
  const row=references.get(id);
  return `[${number}] ${[row.authors,row.title||'文献信息待补全',row.year,row.doi?'DOI: '+row.doi:'',row.url].filter(Boolean).join('. ')}`;
 });
 const materialList=[...materialNumbers].map(([id,number])=>{const row=materials.get(id);return `[材料${number}] ${row.name||'用户研究资料'}${row.purpose?'（'+row.purpose+'）':''}`;});
 return [title,...(missingChapters.length?['部分章节尚未完成','本文仅包含当前已保存的章节草稿，不代表完整论文。尚未完成：'+missingChapters.map(row=>row.title||'未命名章节').join('、')+'。']:[]),...body,...(bibliography.length?['已使用的参考文献（用户确认，待核对原文）',...bibliography]:[]),...(materialList.length?['研究材料来源（用户提供，待人工核对）',...materialList]:[]),...(unknown?['引用核对提示','正文含有未匹配的来源标记，请补充并核对来源后再用于提交。']:[])].filter(Boolean).join('\n\n');
}
