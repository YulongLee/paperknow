import {simulationResearchDisclosure} from './simulation-data.mjs';
import {normalizeThesisFigures} from './thesis-figure.mjs';
import {isOutlineReferenceChapter} from './outline-word-budget.mjs';
import {thesisFrontMatterKind,stripThesisOwnedHeadings} from './thesis-delivery.mjs';
import {citationMetadataFields,recoverCitationMetadata,preservedUnparsedCitation,parseCitationImport} from './citation-import.mjs';

const bibliographyFields=[...new Set(['id','title','authors','year','doi','url','venue','sourceLabel',...citationMetadataFields])];
export function thesisReferenceMetadata(row={}){
 const preserved=preservedUnparsedCitation(row),restored=preserved?{}:recoverCitationMetadata(row),result={...restored,...Object.fromEntries(bibliographyFields.filter(key=>typeof row[key]==='string'&&row[key].trim()).map(key=>[key,row[key].trim()]))};
 if(preserved)result.citationText=preserved;else if(restored.citationText)result.citationText=restored.citationText;else delete result.citationText;
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
 const input=String(row.authors||''),structured=Array.isArray(row.authorNames)&&row.authorNames.length>0;let raw;
 if(structured)raw=row.authorNames;
 else if(!/[;；、\p{Script=Han}]/u.test(input)&&input.includes(',')){
  const pieces=input.split(',').map(value=>value.trim()).filter(Boolean);
  // A manually entered list of three or more unambiguous Western full names
  // must not be interpreted as one "family, given" name. Keep ambiguous
  // comma-separated forms intact rather than inventing author boundaries.
  const fullName=/^(\p{Script=Latin}+(?:[-’']\p{Script=Latin}+)*)(?:\s+((?:\p{Script=Latin}\.?\s+)*))?\s+(\p{Script=Latin}+(?:[-’']\p{Script=Latin}+)*)$/u;
  const parsed=pieces.map(value=>value.match(fullName));
  if(pieces.length>=3&&parsed.every(Boolean))raw=pieces.map(literal=>({literal,preserve:true}));
  else if(pieces.length>2||pieces.length===2&&pieces.every(value=>/\s/u.test(value)))raw=[{literal:input.trim(),preserve:true}];
  else raw=[input];
 }else raw=input.split(/[;；、]|(?<=[\p{Script=Han}]),\s*(?=[\p{Script=Han}])/u).filter(Boolean);
 const names=raw.map(value=>{const name=typeof value==='string'?{literal:value.trim()}:value;if(name.literal){if(name.preserve||structured)return name.literal;const parts=name.literal.match(/^([^,]+),\s*([^,]+)$/);if(!parts||/[\p{Script=Han}]/u.test(name.literal))return name.literal;return western(parts[1],parts[2]);}if(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test((name.family||'')+(name.given||'')))return(name.family||'')+(name.given||'');return western(name.family,name.given);});
 function western(family='',given=''){return [family,given.split(/[\s-]+/u).map(part=>part.match(/\p{L}/u)?.[0]?.toUpperCase()||'').filter(Boolean).join(' ')].filter(Boolean).join(' ');}
 return structured?names.slice(0,3).join(', ')+(names.length>3?(/[\p{Script=Han}]/u.test(names.join(''))?', 等':', et al.'):''):names.join(', ');
}
// One numeric bibliography formatter serves the thesis and every manuscript
// workflow. Valid imported GB/T entries retain their complete supplied record.
export function formatThesisReference(input={}){
 const row=thesisReferenceMetadata(input);if(row.citationText)return row.citationText;
 const codes={journal:'J',article:'J','journal-article':'J','article-journal':'J',book:'M',thesis:'D',dissertation:'D',conference:'C','conference-paper':'C','paper-conference':'C',patent:'P',standard:'S',yearbook:'M',newspaper:'N',preprint:'PP',report:'R',chapter:'M',webpage:'EB',dataset:'DS',database:'DB',archive:'A',map:'CM',collection:'G',software:'CP'};
 let kind=row.documentType||input.type;
 const legacyArxiv=/^arxiv\s+preprint\s+(?:arxiv\s*:\s*)?((?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})(?:v\d+)?)$/i.exec(row.journal||'');
 if(legacyArxiv&&['journal','article','journal-article','article-journal'].includes(kind)&&!row.venue&&!row.publicationSource){kind='preprint';row.journal='';if(!row.url)row.url='https://arxiv.org/abs/'+legacyArxiv[1];}
 // When only an arXiv preprint is identified, an old @article import must
 // not claim a journal publication that the source did not supply.
 let arxivURL=false;try{const u=new URL(row.url);arxivURL=['arxiv.org','www.arxiv.org','export.arxiv.org'].includes(u.hostname)&&/^\/(?:abs|pdf)\/(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})(?:v\d+)?(?:\.pdf)?$/i.test(u.pathname);}catch{}
 if(arxivURL&&['journal','article','journal-article','article-journal'].includes(kind)&&!row.journal&&!row.venue&&!row.publicationSource)kind='preprint';
 const code=Object.hasOwn(codes,kind)?codes[kind]:null,year=/^\d{4}$/.test(row.year||'')?row.year:'',online=row.medium==='OL'||['preprint','webpage','dataset','database','software'].includes(kind)&&!!row.url,medium=online?'/OL':'',title=(row.title||'文献信息待补全')+(code?'['+code+medium+']':''),author=referenceAuthors({...input,...row}),part=['conference','chapter'].includes(kind),container=part?row.publicationSource||row.journal||row.venue:'',locator=(row.volume||'')+(row.issue?'('+row.issue+')':'')+(row.pages?': '+row.pages:'');
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
 // A chapter entry can be removed only if that exact source will actually be
 // printed. Formal exports omit uncited sources; do not discard their text.
 const printedReferenceIds=new Set([...bibliographyModel.references,...(!submission?bibliographyModel.uncitedReferences:[])].map(row=>row.id));
 const canonicalReferenceChapter=row=>{
  const lines=String(row.text).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);if(!lines.length)return false;
  return lines.every(line=>{const match=line.match(/^\[source:([^\]]+)\]\s*(.*)$/);return match&&printedReferenceIds.has(match[1])&&references.has(match[1])&&[formatThesisReference(references.get(match[1])),legacyThesisReference(references.get(match[1])),legacyThesisReference(Object.fromEntries(['title','authors','year','doi','url'].map(key=>[key,references.get(match[1])[key]])))].some(value=>normalize(match[2])===normalize(value));});
 };
 const referenceNumbers=new Map(bibliographyModel.references.map(row=>[row.id,row.number]));
 const semanticBody=text=>{const raw=String(text),citationRanges=[];let value='',cursor=0;for(const match of raw.matchAll(/\[source:([^\]]+)\]/g)){value+=raw.slice(cursor,match.index);const label=render(match[0]),start=value.length;value+=label;if(referenceNumbers.has(match[1]))citationRanges.push({start,end:value.length,number:referenceNumbers.get(match[1])});cursor=match.index+match[0].length;}value+=raw.slice(cursor);return {text:value,citationRanges};};
 const renderChapter=row=>{const title=String(row.title||'');let text=stripThesisOwnedHeadings(row.text,[title]);if(thesisFrontMatterKind(row)==='abstract_en')text=text.replace(/^(?:英文题目|English title)\s*[:：].*\n*/im,'');return [title,semanticBody(text)];};
 const manuscript=rows.filter(row=>!isOutlineReferenceChapter(row)),isAcknowledgements=row=>/^(?:致谢|acknowledg(?:e)?ments?)$/i.test(String(row.title||'').replace(/\s/g,'')),front=manuscript.filter(thesisFrontMatterKind).flatMap(renderChapter),body=manuscript.filter(row=>!thesisFrontMatterKind(row)&&!isAcknowledgements(row)).flatMap(renderChapter),acknowledgements=manuscript.filter(isAcknowledgements).flatMap(renderChapter);
 // The original bibliography may be an earlier but equivalent GB/T spelling
 // of the same explicit source IDs. Preserve that complete supplied entry
 // only when every identity and bibliographic field agrees; otherwise retain
 // the original notes for manual reconciliation rather than guessing.
 const authorKey=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/\./gu,'').replace(/\s+/gu,' ').trim(),fieldKey=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu,' ').trim(),same=(a,b)=>fieldKey(a)===fieldKey(b),sameURL=(a,b)=>{try{return new URL(a).href===new URL(b).href;}catch{return false;}},originalEntries=new Map();
 const equivalentEntry=(raw,reference)=>{try{
  const result=parseCitationImport(raw);if(result.items.length!==1)return false;const parsed=result.items[0],known=thesisReferenceMetadata(reference);if(!known.title||!known.year||!known.authors||!parsed.title||!parsed.year||!parsed.authors||!same(parsed.title,known.title)||!same(parsed.year,known.year))return false;
  for(const key of ['documentType','journal','publisher','publicationPlace','publicationSource','volume','issue','pages','edition','medium'])if(parsed[key]&&known[key]&&!same(parsed[key],known[key]))return false;
  for(const key of ['doi','url'])if(known[key]&&!parsed[key]||parsed[key]&&known[key]&&!(key==='url'?sameURL(parsed[key],known[key]):same(parsed[key],known[key])))return false;
  const date=raw.match(/\[((?:19|20|21)\d{2}[-/]\d{2}[-/]\d{2})\]/)?.[1]?.replaceAll('/','-');if(known.accessedAt&&(!date||!same(date,known.accessedAt)))return false;
  const author=parsed.authors.replace(/,?\s*(?:et\s+al\.?|等)\s*$/iu,''),hasEtAl=/(?:et\s+al\.?|等)\s*$/iu.test(parsed.authors),actual=author.split(/[,;，；、]/u).map(authorKey).filter(Boolean),expected=referenceAuthors(reference).split(/[,;，；、]/u).map(authorKey).filter(Boolean);if(!actual.length||!expected.length||actual.length>expected.length||actual.some((name,index)=>name!==expected[index])||!hasEtAl&&actual.length!==expected.length)return false;
  // When the earlier spelling lacks any structured publication detail, do not
  // lose it by substituting a shorter record. A parsed field absent from the
  // structured record is retained verbatim in the supplied entry.
  for(const key of ['documentType','journal','publisher','publicationPlace','publicationSource','volume','issue','pages','edition','medium'])if(known[key]&&!parsed[key])return false;
  // A parseable citation may still contain arbitrary appended prose. Only
  // accept a record whose remaining text consists of citation separators;
  // never smuggle unparsed words into the formal bibliography.
  let remaining=raw.replace(/\[(?:J|D|M|C|N|R|S|P|EB|DB|A|Z|PP|DS|CM|G|CP)(?:\/OL)?\]/ig,' ').replace(/\bDOI\s*[:：]/ig,' ');
  for(const token of [parsed.authors,parsed.title,parsed.journal,parsed.publisher,parsed.publicationPlace,parsed.publicationSource,parsed.year,parsed.volume,parsed.issue,parsed.pages,parsed.edition,parsed.doi,parsed.url,date].filter(Boolean).sort((a,b)=>b.length-a.length))remaining=remaining.replace(token,' ');
  if(/[\p{L}\p{N}]/u.test(remaining))return false;
  return true;
 }catch{return false;}};
 const equivalentReferenceChapter=row=>{const lines=String(row.text).split(/\r?\n/).map(line=>line.trim()).filter(Boolean),entries=[];if(!lines.length)return false;for(const line of lines){const match=line.match(/^\[source:([^\]]+)\]\s*(.*)$/),reference=match&&references.get(match[1]);if(!reference||!printedReferenceIds.has(match[1])||entries.some(entry=>entry.id===match[1])||!equivalentEntry(match[2],reference)||originalEntries.has(match[1])&&originalEntries.get(match[1])!==match[2])return false;entries.push({id:match[1],text:match[2]});}for(const entry of entries)originalEntries.set(entry.id,entry.text);return true;};
 const referenceNotes=referenceChapters.filter(row=>!canonicalReferenceChapter(row)&&!equivalentReferenceChapter(row)).map(row=>render(row.text).replace(/\[(\d+)\]/g,'〔文献$1〕'));
 const bibliography=[...bibliographyModel.references.map(row=>row.label+' '+(originalEntries.get(row.id)||row.text)),...(!submission?bibliographyModel.uncitedReferences.map((row,index)=>'['+(bibliographyModel.references.length+index+1)+'] '+(originalEntries.get(row.id)||row.text)):[])];
 const bibliographyTitle=snapshot.profile?.language==='English'?'References':'参考文献';
 // Canonical references always follow citation order. Keep differing manual
 // bibliography text as clearly separate notes, never as a second numeric list.
 // A formal manuscript can cite the author's own evidence. Preserve a
 // matching source entry for each material marker; these are research
 // materials, never invented journal publications. Uncited associations
 // remain a draft-only aid. Keep names and purposes on a single line.
 const inline=value=>String(value||'').replace(/[\r\n\x00-\x1f\x7f]+/g,' ').replace(/\s+/g,' ').trim();
 const materialList=[...bibliographyModel.materials.map(row=>row.label+' '+inline(row.name)+(row.purpose?'（'+inline(row.purpose)+'）':'')),...(!submission?bibliographyModel.associatedMaterials.map(row=>row.label+' '+inline(row.name)+(row.purpose?'（'+inline(row.purpose)+'）':'')+'（关联来源，当前正文未标注）'):[])];
 // Workflow diagnostics belong to export metadata and the completion panel,
 // never to manuscript paragraphs or the generated table of contents.
 const parts=[title,...front,...body,...simulationResearchDisclosure(snapshot,chapters).filter(note=>!chapters.some(chapter=>(String(chapter.title||'')+'\n'+String(chapter.text||'')).replace(/\s/g,'').includes(note.replace(/\s/g,'')))),...(bibliography.length?[bibliographyTitle,...bibliography]:[]),...(materialList.length?[(snapshot.materials||[]).some(row=>row.dataKind==='simulation')?'研究材料来源（含已标识的模拟数据）':submission?'研究材料来源':'研究材料来源（用户提供，待人工核对）',...materialList]:[]),...(referenceNotes.length?['参考文献整理原文（待核对）','【待核对：参考文献原始条目与当前题录存在差异，请核对并统一。】',...referenceNotes]:[]),...(unknown?['引用核对提示','正文含有未匹配的来源标记，请补充并核对来源后再用于提交。']:[]),...acknowledgements].filter(part=>part&&typeof part==='object'?Boolean(part.text):Boolean(part));
 let rawText='';const rawRanges=[];for(const part of parts){if(rawText)rawText+='\n\n';const offset=rawText.length;rawText+=typeof part==='object'?part.text:String(part);if(typeof part==='object')rawRanges.push(...part.citationRanges.map(range=>({...range,start:range.start+offset,end:range.end+offset})));}
 // Match writing-document.documentLines before exposing UTF-16 offsets. Only
 // characters removed before a range change its position; ordinary [n] text,
 // bibliography labels and repeated paragraphs never create semantic ranges.
 const reductions=[];const text=rawText.replace(/\r\n?|[\x00-\x08\x0b\x0c\x0e-\x1f]/g,(match,offset)=>{const replacement=match[0]==='\r'?'\n':'';if(match.length>replacement.length)reductions.push({end:offset+match.length,size:match.length-replacement.length});return replacement;});
 let removed=0,reduction=0;const mapped=point=>{while(reduction<reductions.length&&reductions[reduction].end<=point)removed+=reductions[reduction++].size;return point-removed;};
 const citationRanges=rawRanges.map(range=>({start:mapped(range.start),end:mapped(range.end),number:range.number}));return {text,citationRanges,...(figures.length?{figures}:{})};
}
