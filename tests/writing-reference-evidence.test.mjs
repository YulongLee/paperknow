import test from 'node:test';
import assert from 'node:assert/strict';
import {adoptReferenceAbstract,canAdoptReferenceAbstract,referenceAbstractAvailability} from '../dist/workspace/writing-reference-evidence.mjs';
import {normalizeReferenceSearchItem} from '../dist/workspace/writing-reference-search.mjs';
import {thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';
import {assessThesisEvidence} from '../dist/workspace/thesis-evidence.mjs';
import {normalizeThesisSnapshot} from '../backend/thesis-model.mjs';

const abstract='  提供数据库实际返回的研究摘要。\n\n包含研究背景、研究问题与论证范围；只依据摘要，不推断未读取的全文结果。'.repeat(3)+'  ';
const metadata=()=>({id:'online-paper',source:'openalex',sourceId:'W1234567',sourceLabel:'OpenAlex · 在线题录，未读取全文',title:'论文题目',authors:'真实作者',authorNames:[{family:'Li',given:'X'}],year:'2025',doi:'10.1234/paper',url:'https://doi.org/10.1234/paper',fullTextUrl:'https://example.org/paper.pdf',openAccess:true,text:'',abstract,scope:'metadata',fullTextRead:false,confirmed:false,sourceProvenance:[{source:'openalex',sourceId:'W1234567'}]});

test('a database abstract requires explicit adoption and preserves the original record and exact source text',()=>{
 const row=metadata(),before=structuredClone(row);assert.equal(canAdoptReferenceAbstract(row),true);assert.equal(referenceAbstractAvailability(row).characters,Array.from(abstract.replace(/[\s\p{Cf}]/gu,'')).length);
 const adopted=adoptReferenceAbstract(row);assert.deepEqual(row,before);assert.notEqual(adopted,row);assert.equal(row.text,'');assert.equal(row.scope,'metadata');assert.equal(adopted.text,abstract);assert.equal(adopted.scope,'abstract');assert.equal(adopted.confirmed,false);assert.equal(adopted.fullTextRead,false);assert.equal(adopted.sourceLabel,'OpenAlex · 来源摘要，未读取全文');
 for(const key of ['id','title','authors','authorNames','year','doi','url','fullTextUrl','openAccess','source','sourceId','abstract','sourceProvenance'])assert.deepEqual(adopted[key],before[key],key+' must remain unchanged');
});

test('existing user body or an already adopted abstract is never replaced',()=>{
 for(const text of ['用户手写原文。','\n  已导入的正文  \n']){const row={...metadata(),text},before=structuredClone(row);assert.equal(canAdoptReferenceAbstract(row),false);assert.match(referenceAbstractAvailability(row).reason,/不.*覆盖/);assert.throws(()=>adoptReferenceAbstract(row),/不.*覆盖/);assert.deepEqual(row,before);}
 assert.throws(()=>adoptReferenceAbstract(adoptReferenceAbstract(metadata())),/不会覆盖/);
});

test('empty, malformed, non-database and oversized abstracts cannot become readable source text',()=>{
 for(const row of [null,undefined,[],{}, {...metadata(),source:'ai'},{...metadata(),source:'import'}, {...metadata(),abstract:''}, {...metadata(),abstract:' \n\t\u200b\u200d\ufeff '},{...metadata(),abstract:123},{...metadata(),text:{body:'existing'}}]){const before=row===undefined?undefined:structuredClone(row);assert.equal(canAdoptReferenceAbstract(row),false);assert.throws(()=>adoptReferenceAbstract(row));assert.deepEqual(row,before);}
 const tooLong={...metadata(),abstract:'研'.repeat(12001)};assert.match(referenceAbstractAvailability(tooLong).reason,/12,000/);assert.throws(()=>adoptReferenceAbstract(tooLong),/12,000/);
 const maximum={...metadata(),abstract:'研'.repeat(12000)};assert.equal(adoptReferenceAbstract(maximum).text.length,12000);
});

test('adoption preserves HTML-like source characters and never synthesizes or strips the source text',()=>{
 const row={...metadata(),abstract:'<math>x & y</math>\n研究原始摘要的符号与空白保持不变。'};assert.equal(adoptReferenceAbstract(row).text,row.abstract);
});

test('search metadata stays unread until adopted and confirmed abstract can support later thesis evidence',()=>{
 const searched=normalizeReferenceSearchItem(metadata());assert.equal(searched.text,'');assert.equal(searched.scope,'metadata');assert.equal(searched.fullTextRead,false);
 const draft={title:'基于真实摘要的研究',degree:'本科',language:'中文',targetWords:1000,knowledgeFiles:[],writingReferences:[searched],outlineRows:[{id:'chapter-one',title:'第一章 研究背景',level:1,words:1000}]};
 const metadataSnapshot=thesisSnapshotFromDraft(draft);assert.equal(assessThesisEvidence(metadataSnapshot).characters,0);
 const adopted=adoptReferenceAbstract(searched);assert.equal(adopted.confirmed,false);assert.equal(assessThesisEvidence({references:[adopted]}).characters,0);
 const snapshot=thesisSnapshotFromDraft({...draft,writingReferences:[{...adopted,confirmed:true}]});assert.equal(snapshot.materials.length,0);assert.equal(snapshot.references[0].text,searched.abstract);assert.match(snapshot.references[0].sourceLabel,/来源摘要，未读取全文/);assert.equal(assessThesisEvidence(snapshot).ready,true);
 const normalized=normalizeThesisSnapshot(snapshot);assert.equal(normalized.references[0].text,searched.abstract);assert.match(normalized.references[0].sourceLabel,/来源摘要，未读取全文/);
});
