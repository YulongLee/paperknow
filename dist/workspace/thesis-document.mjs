import {normalizeThesisFigures} from './thesis-figure.mjs';
import {isOutlineReferenceChapter} from './outline-word-budget.mjs';
import {thesisFrontMatterKind,stripThesisOwnedHeadings} from './thesis-delivery.mjs';

const bibliographyFields=['id','title','authors','year','doi','url','documentType','journal','publisher','publicationSource','volume','issue','pages','venue','accessedAt','sourceLabel'];
export function thesisReferenceMetadata(row={}){
 return Object.fromEntries(bibliographyFields.filter(key=>typeof row[key]==='string'&&row[key].trim()).map(key=>[key,row[key].trim()]));
}
export function formatThesisReference(row={}){
 const codes={journal:'J',article:'J','journal-article':'J',book:'M',thesis:'D',dissertation:'D',conference:'C',patent:'P',standard:'S',yearbook:'M',newspaper:'N',preprint:'Z',report:'R',chapter:'M'},kind=row.documentType||row.type,code=Object.hasOwn(codes,kind)?codes[kind]:null;
 const title=(row.title||'文献信息待补全')+(code?'['+code+']':''),locator=[row.volume||'',row.issue?'('+row.issue+')':'',row.pages?': '+row.pages:''].join('');
 const publicationName=row.journal||row.venue||row.publicationSource,book=code==='M'||code==='D'||code==='R'||code==='S';
 const publication=book&&row.publisher?[row.publisher,row.year].filter(Boolean).join(', ')+(row.pages?': '+row.pages:''):publicationName?[publicationName,row.year,locator].filter(Boolean).join(', '):row.publisher?[row.publisher,row.year,locator].filter(Boolean).join(', '):[row.year,locator].filter(Boolean).join('. ');
 return [row.authors,title,publication,row.doi?'DOI: '+row.doi:'',row.url].filter(Boolean).join('. ');
}

// Numeric citations are assigned only by markers in prose, never by the order
// of a reference chapter, selected catalog rows, or a stale sourceIds array.
// Offsets refer to the unchanged UTF-16 chapter text for editor selection.
export function buildThesisBibliography(snapshot={},chapters=[]){
 const rows=Array.isArray(chapters)?chapters:[],references=new Map(),materials=new Map(),ambiguous=new Set();
 for(const row of Array.isArray(snapshot.references)?snapshot.references:[])if(row?.confirmed===true&&typeof row.id==='string'){if(references.has(row.id))ambiguous.add(row.id);references.set(row.id,row);}
 for(const row of Array.isArray(snapshot.materials)?snapshot.materials:[])if(row?.confirmed===true&&typeof row.id==='string'){if(materials.has(row.id)||references.has(row.id))ambiguous.add(row.id);materials.set(row.id,row);}
 for(const id of ambiguous){references.delete(id);materials.delete(id);}
 const usedReferences=new Map(),usedMaterials=new Map(),unresolved=[],associated=new Set();
 for(const chapter of rows.filter(row=>row&&!isOutlineReferenceChapter(row))){
  for(const id of Array.isArray(chapter.sourceIds)?chapter.sourceIds:[])associated.add(id);
  for(const match of String(chapter.text||'').matchAll(/\[source:([^\]]+)\]/g)){
   const id=match[1],occurrence={chapterId:String(chapter.id||''),chapterTitle:String(chapter.title||''),start:match.index,end:match.index+match[0].length};
   if(references.has(id)){
    if(!usedReferences.has(id)){const row=references.get(id),number=usedReferences.size+1;usedReferences.set(id,{...thesisReferenceMetadata(row),id,number,label:'['+number+']',text:formatThesisReference(row),readableSource:typeof row.text==='string'&&Boolean(row.text.trim()),occurrences:[]});}
    usedReferences.get(id).occurrences.push(occurrence);
   }else if(materials.has(id)){
    if(!usedMaterials.has(id)){const row=materials.get(id),number=usedMaterials.size+1;usedMaterials.set(id,{id,number,label:'[材料'+number+']',name:String(row.name||'用户研究资料'),purpose:String(row.purpose||''),occurrences:[]});}
    usedMaterials.get(id).occurrences.push(occurrence);
   }else unresolved.push({sourceId:id,...occurrence});
  }
 }
 const associatedMaterials=[...associated].filter(id=>materials.has(id)&&!usedMaterials.has(id)).map((id,index)=>{const row=materials.get(id);return {id,label:'[关联材料'+(index+1)+']',name:String(row.name||'用户研究资料'),purpose:String(row.purpose||''),associated:true,occurrences:[]};});
 const uncitedReferences=[...references].filter(([id])=>!usedReferences.has(id)).map(([id,row],index)=>({...thesisReferenceMetadata(row),id,label:'[待引用'+(index+1)+']',text:formatThesisReference(row),readableSource:typeof row.text==='string'&&Boolean(row.text.trim()),associated:associated.has(id)}));
 return {references:[...usedReferences.values()],uncitedReferences,materials:[...usedMaterials.values()],associatedMaterials,unresolved,counts:{references:usedReferences.size,uncitedReferences:uncitedReferences.length,materials:usedMaterials.size,associatedMaterials:associatedMaterials.length,citations:[...usedReferences.values()].reduce((sum,row)=>sum+row.occurrences.length,0),unresolved:unresolved.length}};
}
export function renderThesisCitations(text,bibliography){
 const labels=new Map([...(bibliography?.references||[]),...(bibliography?.materials||[])].map(row=>[row.id,row.label])),uncited=new Set((bibliography?.uncitedReferences||[]).map(row=>row.id));
 return String(text??'').replace(/\[source:([^\]]+)\]/g,(_,id)=>labels.get(id)||(uncited.has(id)?'[未在正文引用]':'[来源待核对]'));
}


// This is a document presentation only. Stored chapter text and its source IDs
// remain unchanged so edits, evidence checks and historic versions stay traceable.
export function presentThesisDocument(snapshot={},chapters=[],options={}){return thesisDocumentPresentation(snapshot,chapters,options).text;}
export function thesisDocumentPresentation(snapshot={},chapters=[],{title=snapshot.title,submission=false}={}){
 const rows=chapters.filter(row=>String(row?.text||'').trim()).slice().sort((a,b)=>(thesisFrontMatterKind(a)==='abstract_zh'?-2:thesisFrontMatterKind(a)==='abstract_en'?-1:0)-(thesisFrontMatterKind(b)==='abstract_zh'?-2:thesisFrontMatterKind(b)==='abstract_en'?-1:0));
 const figures=normalizeThesisFigures(rows.flatMap(row=>{const used=new Set([...String(row.text||'').matchAll(/\[figure:([^\]]+)\]/g)].map(match=>match[1]));return (row.figures||[]).filter(figure=>used.has(figure.id));}));
 if(!rows.length)return {text:'',citationRanges:[]};
 const missingChapters=(Array.isArray(snapshot.outline)?snapshot.outline:[]).filter(chapter=>!isOutlineReferenceChapter(chapter)&&!rows.some(row=>chapter.id&&row.id?chapter.id===row.id:String(chapter.title||'').trim()===String(row.title||'').trim()));
 const bibliographyModel=buildThesisBibliography(snapshot,chapters),references=new Map((snapshot.references||[]).filter(row=>row?.confirmed===true).map(row=>[row.id,row]));
 const render=text=>renderThesisCitations(text,bibliographyModel),unknown=bibliographyModel.unresolved.length>0;
 const referenceChapters=rows.filter(isOutlineReferenceChapter),normalize=value=>String(value??'').replace(/\s+/g,' ').trim();
 const canonicalReferenceChapter=row=>{
  const lines=String(row.text).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);if(!lines.length)return false;
  return lines.every(line=>{const match=line.match(/^\[source:([^\]]+)\]\s*(.*)$/);return match&&references.has(match[1])&&normalize(match[2])===normalize(formatThesisReference(references.get(match[1])));});
 };
 const referenceNumbers=new Map(bibliographyModel.references.map(row=>[row.id,row.number]));
 const semanticBody=text=>{const raw=String(text),citationRanges=[];let value='',cursor=0;for(const match of raw.matchAll(/\[source:([^\]]+)\]/g)){value+=raw.slice(cursor,match.index);const label=render(match[0]),start=value.length;value+=label;if(referenceNumbers.has(match[1]))citationRanges.push({start,end:value.length,number:referenceNumbers.get(match[1])});cursor=match.index+match[0].length;}value+=raw.slice(cursor);return {text:value,citationRanges};};
 const renderChapter=row=>{const title=String(row.title||'');let text=stripThesisOwnedHeadings(row.text,[title]);if(thesisFrontMatterKind(row)==='abstract_en')text=text.replace(/^(?:英文题目|English title)\s*[:：].*\n*/im,'');return [title,semanticBody(text)];};
 const manuscript=rows.filter(row=>!isOutlineReferenceChapter(row)),front=manuscript.filter(thesisFrontMatterKind).flatMap(renderChapter),body=manuscript.filter(row=>!thesisFrontMatterKind(row)).flatMap(renderChapter);
 // Keep the disclosure in the body, after its first heading. Placing it
 // before abstracts caused the template renderer to move intact paragraphs
 // across source anchors and correctly fail the strict order check.
 const disclosure=missingChapters.length?['部分章节尚未完成','本文仅包含当前已保存的章节草稿，不代表完整论文。尚未完成：'+missingChapters.map(row=>row.title||'未命名章节').join('、')+'。']:[];
 const bibliography=bibliographyModel.references.map(row=>row.label+' '+row.text);
 const bibliographyTitle=referenceChapters.some(canonicalReferenceChapter)?'参考文献':'已使用的参考文献（用户确认，待核对原文）';
 // Canonical references always follow citation order. Keep differing manual
 // bibliography text as clearly separate notes, never as a second numeric list.
 const referenceNotes=referenceChapters.filter(row=>!canonicalReferenceChapter(row)).map(row=>render(row.text).replace(/\[(\d+)\]/g,'〔文献$1〕'));
 const materialList=submission?[]:[...bibliographyModel.materials.map(row=>row.label+' '+row.name+(row.purpose?'（'+row.purpose+'）':'')),...bibliographyModel.associatedMaterials.map(row=>row.label+' '+row.name+(row.purpose?'（'+row.purpose+'）':'')+'（关联来源，当前正文未标注）')];
 const uncitedList=submission?[]:bibliographyModel.uncitedReferences.map(row=>row.label+' '+row.text);
 const parts=[title,...front,...(body.length?[body[0],...disclosure,...body.slice(1)]:disclosure),...(bibliography.length?[bibliographyTitle,...bibliography]:[]),...(materialList.length?['研究材料来源（用户提供，待人工核对）',...materialList]:[]),...(uncitedList.length?['待引用文献（尚未在正文引用）','以下为已选题录，尚未建立正文引用；未因选中而认定已读取或已支持正文论断。',...uncitedList]:[]),...(referenceNotes.length?['参考文献整理原文（待核对）',...referenceNotes]:[]),...(unknown?['引用核对提示','正文含有未匹配的来源标记，请补充并核对来源后再用于提交。']:[])].filter(part=>part&&typeof part==='object'?Boolean(part.text):Boolean(part));
 let rawText='';const rawRanges=[];for(const part of parts){if(rawText)rawText+='\n\n';const offset=rawText.length;rawText+=typeof part==='object'?part.text:String(part);if(typeof part==='object')rawRanges.push(...part.citationRanges.map(range=>({...range,start:range.start+offset,end:range.end+offset})));}
 // Match writing-document.documentLines before exposing UTF-16 offsets. Only
 // characters removed before a range change its position; ordinary [n] text,
 // bibliography labels and repeated paragraphs never create semantic ranges.
 const reductions=[];const text=rawText.replace(/\r\n?|[\x00-\x08\x0b\x0c\x0e-\x1f]/g,(match,offset)=>{const replacement=match[0]==='\r'?'\n':'';if(match.length>replacement.length)reductions.push({end:offset+match.length,size:match.length-replacement.length});return replacement;});
 let removed=0,reduction=0;const mapped=point=>{while(reduction<reductions.length&&reductions[reduction].end<=point)removed+=reductions[reduction++].size;return point-removed;};
 const citationRanges=rawRanges.map(range=>({start:mapped(range.start),end:mapped(range.end),number:range.number}));return {text,citationRanges,...(figures.length?{figures}:{})};
}
