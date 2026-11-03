import test from 'node:test';
import assert from 'node:assert/strict';
import {importDraftReferences,remapDraftCitations} from '../backend/thesis-draft-references.mjs';
import {normalizeThesisSnapshot} from '../backend/thesis-model.mjs';
import {formatThesisReference,thesisReferenceMetadata} from '../dist/workspace/thesis-document.mjs';
const sha='a'.repeat(64),group=texts=>({title:'参考文献',texts});
test('mixed reference styles preserve opaque records and never turn citations into source text or invented metadata',()=>{
 const raw='Smith, J. (2024). Learning from visual feedback. Synthetic Journal, 12, 21–30.',result=importDraftReferences([group(['[1] 张三. 图像识别[J]. 合成期刊, 2025, 3: 1-9.','[2] '+raw])],{sha});assert.equal(result.referenceCount,2);assert.equal(result.reviewCount,1);const record=result.references[1];assert.equal(record.documentType,'unparsed');assert.equal(record.text,'');assert.equal(record.authors,'');assert.equal(record.year,'');assert.equal(record.doi,'');assert.equal(formatThesisReference(record),raw);assert.equal(thesisReferenceMetadata(record).citationText,raw);
 const normalized=normalizeThesisSnapshot({title:'测试',profile:{targetWords:1000},references:result.references,materials:[],outline:[{id:'c',title:'正文',targetWords:1000}]});assert.equal(formatThesisReference(normalized.references[1]),raw);
});
test('fullwidth, parenthesized and dot numbering bind to their supplied numbers while continuation lines remain together',()=>{
 const result=importDraftReferences([group(['［１］ First author citation without a type.','continuation with pages 1–4.','2) Second author citation without a type.','3. Third author citation without a type.'])],{sha});assert.equal(result.referenceCount,3);assert.equal(result.references[0].citationText,'First author citation without a type. continuation with pages 1–4.');assert.equal(result.citationIds.size,3);const mapped=remapDraftCitations('见［１］及[1,2]与[1–3]。',result.citationIds);assert.ok(mapped.includes('[source:'+result.references[2].id+']'));assert.equal((mapped.match(/\[source:/g)||[]).length,6);
});
test('duplicate conflicting numbers stay visible and never attach a passage to the wrong work',()=>{
 const result=importDraftReferences([group(['[2] First unrelated item.','[2] Second unrelated item.'])],{sha});assert.equal(result.references.length,2);assert.equal(result.citationIds.has('2'),false);assert.equal(remapDraftCitations('原文[2]。',result.citationIds),'原文[2]。');assert.ok(result.warnings.some(row=>row.includes('重复编号')));
});
test('unmatched or excessively broad ranges remain unchanged and code or math indices are never remapped',()=>{
 const result=importDraftReferences([group(['[1] Original first item.','[2] Original second item.'])],{sha}),input='代码 `x[1]`、公式 $x[1]$、未知[3]、混合[1,3]、范围[1-9999]。'+String.raw`\(x[1]\) 与 \[x[2]\]`;assert.equal(remapDraftCitations(input,result.citationIds),input);
});
test('unnumbered Word paragraphs retain all supplied text without guessing a numeric citation relationship',()=>{
 const result=importDraftReferences([group(['First, A. (2023). One study.\nContinuation in the same Word paragraph.','Second, B. (2024). Another study.'])],{sha});assert.equal(result.references.length,2);assert.equal(result.citationIds.size,0);assert.equal(result.references[0].citationText,'First, A. (2023). One study. Continuation in the same Word paragraph.');assert.equal(remapDraftCitations('作者年份制与原文[1]保持。',result.citationIds),'作者年份制与原文[1]保持。');
});
test('opaque references from a previous import deduplicate by their actual raw citation rather than display labels',()=>{
 const first=importDraftReferences([group(['[1] First original record.'])],{sha}),second=importDraftReferences([group(['[1] Completely different record.','[2] First original record.'])],{sha:'b'.repeat(64),references:first.references});assert.equal(second.references.length,2);assert.notEqual(second.citationIds.get('1'),first.references[0].id);assert.equal(second.citationIds.get('2'),first.references[0].id);
});
test('reserved internal markers and bounded record limits cannot be bypassed by the raw fallback',()=>{
 for(const text of ['[1] [source:unknown]','[1] '+ 'x'.repeat(4001)])assert.throws(()=>importDraftReferences([group([text])],{sha}),error=>error.status===422);assert.throws(()=>importDraftReferences([group(Array.from({length:201},(_,i)=>`[${i+1}] Record ${i+1}.`))],{sha}),error=>error.status===422);
});
test('unlabelled publication years and continuation volumes are not mistaken for bibliography item numbers',()=>{
 const result=importDraftReferences([group(['Smith, J. (2024). Original study.\n12. Volume information belongs to this same citation.','2023. A supplied year-first record without list numbering.'])],{sha});assert.equal(result.references.length,2);assert.ok(result.references[0].citationText.includes('12. Volume information'));assert.ok(result.references[1].citationText.startsWith('2023.'));assert.equal(result.citationIds.size,0);
});
