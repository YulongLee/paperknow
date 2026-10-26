import {normalizeThesisFigures} from './thesis-figure.mjs';
import {isOutlineReferenceChapter} from './outline-word-budget.mjs';
import {thesisFrontMatterKind,stripThesisOwnedHeadings} from './thesis-delivery.mjs';
import {citationMetadataFields,recoverCitationMetadata} from './citation-import.mjs';

const bibliographyFields=[...new Set(['id','title','authors','year','doi','url','venue','sourceLabel',...citationMetadataFields])];
export function thesisReferenceMetadata(row={}){
 const restored=recoverCitationMetadata(row),result={...restored,...Object.fromEntries(bibliographyFields.filter(key=>typeof row[key]==='string'&&row[key].trim()).map(key=>[key,row[key].trim()]))};
 if(restored.citationText)result.citationText=restored.citationText;else delete result.citationText;
 if(Array.isArray(row.authorNames))result.authorNames=row.authorNames.slice(0,100).flatMap(name=>{if(typeof name==='string'&&name.trim())return[{literal:name.trim().slice(0,1000)}];if(!name||typeof name!=='object'||Array.isArray(name))return[];const value=Object.fromEntries(['literal','family','given'].filter(key=>typeof name[key]==='string'&&name[key].trim()).map(key=>[key,name[key].trim().slice(0,1000)]));return value.literal||value.family?[value]:[];});
 return result;
}
function legacyThesisReference(row={}){
 const codes={journal:'J',article:'J','journal-article':'J',book:'M',thesis:'D',dissertation:'D',conference:'C',patent:'P',standard:'S',yearbook:'M',newspaper:'N',preprint:'Z',report:'R',chapter:'M'},kind=row.documentType||row.type,code=Object.hasOwn(codes,kind)?codes[kind]:null;
 const title=(row.title||'文献信息待补全')+(code?'['+code+']':''),locator=[row.volume||'',row.issue?'('+row.issue+')':'',row.pages?': '+row.pages:''].join('');
 const publicationName=row.journal||row.venue||row.publicationSource,book=code==='M'||code==='D'||code==='R'||code==='S';
 const publication=book&&row.publisher?[row.publisher,row.year].filter(Boolean).join(', ')+(row.pages?': '+row.pages:''):publicationName?[publicationName,row.year,locator].filter(Boolean).join(', '):row.publisher?[row.publisher,row.year,locator].filter(Boolean).join(', '):[row.year,locator].filter(Boolean).join('. ');
 return [row.authors,title,publication,row.doi?'DOI: '+row.doi:'',row.url].filter(Boolean).join('. ');
}
function referenceAuthors(row){
 const raw=Array.isArray(row.authorNames)&&row.authorNames.length?row.authorNames:String(row.authors||'').split(/[;；、]|(?<=[\p{Script=Han}]),\s*(?=[\p{Script=Han}])/u).filter(Boolean);
 const names=raw.map(value=>{const name=typeof value==='string'?{literal:value.trim()}:value;if(name.literal){const parts=name.literal.match(/^([^,]+),\s*(.+)$/);if(!parts||/[\p{Script=Han}]/u.test(name.literal))return name.literal;return western(parts[1],parts[2]);}if(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test((name.family||'')+(name.given||'')))return(name.family||'')+(name.given||'');return western(name.family,name.given);});
 function western(family='',given=''){return [family,given.split(/[\s-]+/u).map(part=>part.match(/\p{L}/u)?.[0]?.toUpperCase()||'').filter(Boolean).join(' ')].filter(Boolean).join(' ');}
 return names.slice(0,3).join(', ')+(names.length>3?(/[\p{Script=Han}]/u.test(names.join(''))?', 等':', et al.'):'');
}
// One numeric bibliography formatter serves the thesis and every manuscript
// workflow. Valid imported GB/T entries retain their complete supplied record.
export function formatThesisReference(input={}){
 const row=thesisReferenceMetadata(input);if(row.citationText)return row.citationText;
 const codes={journal:'J',article:'J','journal-article':'J','article-journal':'J',book:'M',thesis:'D',dissertation:'D',conference:'C','conference-paper':'C','paper-conference':'C',patent:'P',standard:'S',yearbook:'M',newspaper:'N',preprint:'PP',report:'R',chapter:'M',webpage:'EB',dataset:'DS',database:'DB',archive:'A',map:'CM',collection:'G',software:'CP'};
 const kind=row.documentType||input.type,code=Object.hasOwn(codes,kind)?codes[kind]:null,year=/^\d{4}$/.test(row.year||'')?row.year:'',online=row.medium==='OL'||['preprint','webpage','dataset','database','software'].includes(kind)&&!!row.url,medium=online?'/OL':'',title=(row.title||'文献信息待补全')+(code?'['+code+medium+']':''),author=referenceAuthors({...input,...row}),part=['conference','chapter'].includes(kind),container=part?row.publicationSource||row.journal||row.venue:'',locator=(row.volume||'')+(row.issue?'('+row.issue+')':'')+(row.pages?': '+row.pages:'');
 const publication=kind==='journal'||code==='J'?[row.journal||row.venue||row.publicationSource,year,locator].filter(Boolean).join(', ').replace(/, : /,': '):[row.publicationPlace?(row.publicationPlace+(row.publisher?': '+row.publisher:'')):row.publisher||(!part?row.publicationSource||row.journal||row.venue:''),year].filter(Boolean).join(', ')+(row.pages?': '+row.pages:'');
 let edition=row.edition||'';if(/^\d+$/.test(edition)){const n=Number(edition),suffix=n%100>=11&&n%100<=13?'th':({1:'st',2:'nd',3:'rd'}[n%10]||'th');edition=/[\p{Script=Han}]/u.test((row.title||'')+(row.publisher||''))?edition+'版':edition+suffix+' ed.';}
 const doi=String(row.doi||'').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi\s*:\s*/i,'');let url='';try{const parsed=new URL(row.url);if(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password&&(!doi||!parsed.href.toLowerCase().endsWith('/'+doi.toLowerCase())))url=parsed.href;}catch{}
 const date=online&&/^\d{4}-\d{2}-\d{2}$/.test(row.accessedAt||'')?'['+row.accessedAt+']':'',parts=[author,part?title+(container?'// '+container:''):title,edition,publication+date,doi?'DOI: '+doi:'',url],values=parts.filter(Boolean);
 return values.length===1&&!code?values[0]:values.map(value=>/[.。!?！？]$/.test(value)?value:value+'.').join(' ');
}

// Export-only recovery fills missing catalog fields from the same confirmed
// source. It never adds citations, replaces known facts or edits a task snapshot.
export function withBibliographicMetadata(snapshot={},candidates=[]){
 if(!Array.isArray(candidates)||!candidates.length)return snapshot;
 const rows=new Map(),ambiguous=new Set(),identity=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase(),doi=value=>identity(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//,'').replace(/^doi\s*:\s*/,'');
 for(const row of candidates)if(row?.confirmed===true&&typeof row.id==='string'){if(rows.has(row.id))ambiguous.add(row.id);rows.set(row.id,row);}
 return {...snapshot,references:(snapshot.references||[]).map(row=>{const candidate=rows.get(row.id);if(!candidate||ambiguous.has(row.id)||identity(row.title)!==identity(candidate.title)||row.doi&&candidate.doi&&doi(row.doi)!==doi(candidate.doi))return row;const extra=thesisReferenceMetadata(candidate),next={...row};for(const key of ['authors','year','doi','url',...citationMetadataFields])if(!String(next[key]||'').trim()&&extra[key])next[key]=extra[key];return next;})};
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
export function thesisChapterCompletion(snapshot={},chapters=[]){
 const expected=(Array.isArray(snapshot.outline)?snapshot.outline:[]).filter(chapter=>chapter&&!isOutlineReferenceChapter(chapter));
 const written=(Array.isArray(chapters)?chapters:[]).filter(row=>row&&stripThesisOwnedHeadings(String(row.text||''),[String(row.title||'')]).trim());
 const missing=expected.filter(chapter=>!written.some(row=>chapter.id&&row.id?chapter.id===row.id:String(chapter.title||'').trim()===String(row.title||'').trim())).map(chapter=>({id:String(chapter.id||''),title:String(chapter.title||'未命名章节')}));
 return {expected:expected.length,completed:expected.length-missing.length,missing};
}
export function presentThesisDocument(snapshot={},chapters=[],options={}){return thesisDocumentPresentation(snapshot,chapters,options).text;}
export function thesisDocumentPresentation(snapshot={},chapters=[],{title=snapshot.title,submission=false}={}){
 const rows=chapters.filter(row=>String(row?.text||'').trim()).slice().sort((a,b)=>(thesisFrontMatterKind(a)==='abstract_zh'?-2:thesisFrontMatterKind(a)==='abstract_en'?-1:0)-(thesisFrontMatterKind(b)==='abstract_zh'?-2:thesisFrontMatterKind(b)==='abstract_en'?-1:0));
 const figures=normalizeThesisFigures(rows.flatMap(row=>{const used=new Set([...String(row.text||'').matchAll(/\[figure:([^\]]+)\]/g)].map(match=>match[1]));return (row.figures||[]).filter(figure=>used.has(figure.id));}));
 if(!rows.length)return {text:'',citationRanges:[]};
 const bibliographyModel=buildThesisBibliography(snapshot,chapters),references=new Map((snapshot.references||[]).filter(row=>row?.confirmed===true).map(row=>[row.id,row]));
 const render=text=>renderThesisCitations(text,bibliographyModel),unknown=bibliographyModel.unresolved.length>0;
 const referenceChapters=rows.filter(isOutlineReferenceChapter),normalize=value=>String(value??'').replace(/\s+/g,' ').trim();
 const canonicalReferenceChapter=row=>{
  const lines=String(row.text).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);if(!lines.length)return false;
  return lines.every(line=>{const match=line.match(/^\[source:([^\]]+)\]\s*(.*)$/);return match&&references.has(match[1])&&[formatThesisReference(references.get(match[1])),legacyThesisReference(references.get(match[1])),legacyThesisReference(Object.fromEntries(['title','authors','year','doi','url'].map(key=>[key,references.get(match[1])[key]])))].some(value=>normalize(match[2])===normalize(value));});
 };
 const referenceNumbers=new Map(bibliographyModel.references.map(row=>[row.id,row.number]));
 const semanticBody=text=>{const raw=String(text),citationRanges=[];let value='',cursor=0;for(const match of raw.matchAll(/\[source:([^\]]+)\]/g)){value+=raw.slice(cursor,match.index);const label=render(match[0]),start=value.length;value+=label;if(referenceNumbers.has(match[1]))citationRanges.push({start,end:value.length,number:referenceNumbers.get(match[1])});cursor=match.index+match[0].length;}value+=raw.slice(cursor);return {text:value,citationRanges};};
 const renderChapter=row=>{const title=String(row.title||'');let text=stripThesisOwnedHeadings(row.text,[title]);if(thesisFrontMatterKind(row)==='abstract_en')text=text.replace(/^(?:英文题目|English title)\s*[:：].*\n*/im,'');return [title,semanticBody(text)];};
 const manuscript=rows.filter(row=>!isOutlineReferenceChapter(row)),front=manuscript.filter(thesisFrontMatterKind).flatMap(renderChapter),body=manuscript.filter(row=>!thesisFrontMatterKind(row)).flatMap(renderChapter);
 const bibliography=bibliographyModel.references.map(row=>row.label+' '+row.text);
 const bibliographyTitle=snapshot.profile?.language==='English'?'References':'参考文献';
 // Canonical references always follow citation order. Keep differing manual
 // bibliography text as clearly separate notes, never as a second numeric list.
 const referenceNotes=referenceChapters.filter(row=>!canonicalReferenceChapter(row)).map(row=>render(row.text).replace(/\[(\d+)\]/g,'〔文献$1〕'));
 const materialList=submission?[]:[...bibliographyModel.materials.map(row=>row.label+' '+row.name+(row.purpose?'（'+row.purpose+'）':'')),...bibliographyModel.associatedMaterials.map(row=>row.label+' '+row.name+(row.purpose?'（'+row.purpose+'）':'')+'（关联来源，当前正文未标注）')];
 const uncitedList=submission?[]:bibliographyModel.uncitedReferences.map(row=>row.label+' '+row.text);
 // Workflow diagnostics belong to export metadata and the completion panel,
 // never to manuscript paragraphs or the generated table of contents.
 const parts=[title,...front,...body,...(bibliography.length?[bibliographyTitle,...bibliography]:[]),...(materialList.length?['研究材料来源（用户提供，待人工核对）',...materialList]:[]),...(uncitedList.length?['待引用文献（尚未在正文引用）','以下为已选题录，尚未建立正文引用；未因选中而认定已读取或已支持正文论断。',...uncitedList]:[]),...(referenceNotes.length?['参考文献整理原文（待核对）',...referenceNotes]:[]),...(unknown?['引用核对提示','正文含有未匹配的来源标记，请补充并核对来源后再用于提交。']:[])].filter(part=>part&&typeof part==='object'?Boolean(part.text):Boolean(part));
 let rawText='';const rawRanges=[];for(const part of parts){if(rawText)rawText+='\n\n';const offset=rawText.length;rawText+=typeof part==='object'?part.text:String(part);if(typeof part==='object')rawRanges.push(...part.citationRanges.map(range=>({...range,start:range.start+offset,end:range.end+offset})));}
 // Match writing-document.documentLines before exposing UTF-16 offsets. Only
 // characters removed before a range change its position; ordinary [n] text,
 // bibliography labels and repeated paragraphs never create semantic ranges.
 const reductions=[];const text=rawText.replace(/\r\n?|[\x00-\x08\x0b\x0c\x0e-\x1f]/g,(match,offset)=>{const replacement=match[0]==='\r'?'\n':'';if(match.length>replacement.length)reductions.push({end:offset+match.length,size:match.length-replacement.length});return replacement;});
 let removed=0,reduction=0;const mapped=point=>{while(reduction<reductions.length&&reductions[reduction].end<=point)removed+=reductions[reduction++].size;return point-removed;};
 const citationRanges=rawRanges.map(range=>({start:mapped(range.start),end:mapped(range.end),number:range.number}));return {text,citationRanges,...(figures.length?{figures}:{})};
}
