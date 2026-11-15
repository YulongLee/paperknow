import {buildThesisBibliography} from '../dist/workspace/thesis-document.mjs';
import {isOutlineReferenceChapter} from '../dist/workspace/outline-word-budget.mjs';

// This is a bounded inventory of the supplied manuscript version, not a source
// verification and not permission to infer the contents of missing chapters.
export function thesisReviewBibliographyContext(snapshot,chapters){
 if(!Array.isArray(chapters)||chapters.length>200||!chapters.every(row=>row&&typeof row.id==='string'&&typeof row.text==='string')||new Set(chapters.map(row=>row.id)).size!==chapters.length)return null;
 const totalCharacters=chapters.reduce((n,row)=>n+row.text.length,0);if(totalCharacters>600000)return {coverage:'unavailable',reason:'manuscript_limit',scope:'未完整建立索引，不能推断引用或参考文献不存在'};
 const outline=Array.isArray(snapshot?.outline)?snapshot.outline:[],bodyOutline=outline.filter(row=>!isOutlineReferenceChapter(row));
 const complete=bodyOutline.length>0&&bodyOutline.every(row=>{const chapter=chapters.find(item=>item.id===row.id);return chapter&&chapter.text.trim();});
 const sourceRows=[...(Array.isArray(snapshot?.references)?snapshot.references:[]),...(Array.isArray(snapshot?.materials)?snapshot.materials:[])].filter(row=>row?.confirmed===true&&typeof row.id==='string'),ids=new Set(),ambiguous=new Set();for(const row of sourceRows){if(ids.has(row.id))ambiguous.add(row.id);ids.add(row.id);}
 const parentIds=new Set((Array.isArray(snapshot?.references)?snapshot.references:[]).filter(row=>row?.confirmed===true&&!ambiguous.has(row.id)).map(row=>row.id)),unmappedReferenceSegments=sourceRows.filter(row=>row.referenceSegment===true&&!parentIds.has(row.relatedReferenceId)).length;
 // Numeric brackets in body text may be legacy citation labels, array indexes
 // or literal examples. We cannot disambiguate them from the canonical source
 // markers alone, so never claim the full bibliography index is complete.
 const numericBrackets=chapters.filter(row=>!isOutlineReferenceChapter(row)).reduce((sum,row)=>sum+[...row.text.matchAll(/\[\s*\d{1,4}(?:\s*[,，、;；\-–—]\s*\d{1,4})*\s*\]/gu)].length,0);
 const model=buildThesisBibliography(snapshot,chapters),referenceChapters=chapters.filter(isOutlineReferenceChapter),saved=referenceChapters.map(row=>{
  const text=row.text,lines=text.split(/\r?\n/u).map(line=>line.trim()).filter(Boolean),sourceLines=lines.filter(line=>/^\[source:[^\]\r\n]+\]\s+\S/u.test(line)),numberedLines=lines.filter(line=>/^\[\d+\]\s*\S/u.test(line)),unknown=lines.length-sourceLines.length-numberedLines.length;
  const sourceIds=sourceLines.map(line=>/^\[source:([^\]]+)\]/u.exec(line)[1]),numbers=numberedLines.map(line=>/^\[(\d+)\]/u.exec(line)[1]),duplicateEntries=new Set(sourceIds).size!==sourceIds.length||new Set(numbers).size!==numbers.length;
  return {chapterId:row.id,title:String(row.title||'参考文献').slice(0,100),characters:text.length,sourceEntries:sourceLines.length,numberedEntries:numberedLines.length,duplicateEntries,otherLines:unknown,preview:text.slice(0,1000),previewTruncated:text.length>1000,entryCountReliable:unknown===0&&!duplicateEntries&&!(sourceLines.length&&numberedLines.length)};
 });
 const references=model.references.slice(0,20).map(row=>({id:row.id,title:String(row.title||'').slice(0,120),bodyOccurrences:row.occurrences.length}));
 const savedIds=referenceChapters.flatMap(row=>[...row.text.matchAll(/^\s*\[source:([^\]\r\n]+)\]\s+\S/gmu)].map(match=>match[1])),uniqueSaved=new Set(savedIds),citedIds=new Set(model.references.map(row=>row.id));
 const comparable=complete&&!ambiguous.size&&!unmappedReferenceSegments&&!numericBrackets&&model.counts.unresolved===0&&saved.length>0&&saved.every(row=>row.entryCountReliable&&row.numberedEntries===0)&&uniqueSaved.size===savedIds.length;
 const savedListMatchesBodyCitations=comparable?uniqueSaved.size===citedIds.size&&[...uniqueSaved].every(id=>citedIds.has(id)):null;
 const partial=!complete||ambiguous.size>0||unmappedReferenceSegments>0||numericBrackets>0||model.counts.unresolved>0||model.references.length>references.length||saved.length>4||saved.some(row=>row.previewTruncated||!row.entryCountReliable);
 return {indexStatus:partial?'partial':'complete_for_supplied_text',coverage:complete&&!ambiguous.size&&!unmappedReferenceSegments?'provided_body_chapters':'incomplete_or_ambiguous',ambiguousSourceIds:ambiguous.size,unmappedReferenceSegments,unmappedNumericBrackets:numericBrackets,bodyCitedReferenceCount:model.counts.references,bodyCitationOccurrences:model.counts.citations,unresolvedCitationCount:model.counts.unresolved,uncitedReferenceCount:model.counts.uncitedReferences,references,referencesTruncated:model.references.length>references.length,savedReferenceChapters:saved.slice(0,4),savedChaptersTruncated:saved.length>4,savedListMatchesBodyCitations,exportListCandidateCount:complete&&!ambiguous.size&&!unmappedReferenceSegments&&!numericBrackets&&model.counts.unresolved===0?model.counts.references:null,savedListReconciliation:'not_checked',scope:'按当前提供正文引用标记和用户确认题录编制；未映射数字方括号可能是引文或数组等文字，需人工区分，不能计作已识别引用。保存的参考文献章节、正文引用与导出编排列表分别列示。导出候选不证明保存章节已核对或 DOCX 已生成；题录及引用不证明文献真实或支持正文。未覆盖或无法解析的内容不能推断不存在。'};
}
