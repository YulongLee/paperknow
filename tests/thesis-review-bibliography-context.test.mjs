import test from 'node:test';
import assert from 'node:assert/strict';
import {thesisReviewBibliographyContext} from '../backend/thesis-review-bibliography-context.mjs';
import {createWritingQualityRunner} from '../backend/writing-quality-runner.mjs';
import {parseWritingReview} from '../backend/writing-quality.mjs';
import {reviewBatchReuseKey} from '../backend/thesis-worker.mjs';
import {presentThesisDocument} from '../dist/workspace/thesis-document.mjs';

function fixture(){
 const references=Array.from({length:10},(_,i)=>({id:'ref-'+i,title:'文献 '+i,authors:'作者 '+i,year:'2020',confirmed:true,text:'文献正文 '+i}));
 const snapshot={title:'合成论文',outline:[{id:'c1',title:'正文'},{id:'refs',title:'参考文献'},{id:'ack',title:'致谢'}],materials:[],references};
 const chapters=[{id:'c1',title:'正文',text:references.map(row=>'论述[source:'+row.id+']。').join('')},{id:'refs',title:'参考文献',text:'[source:ref-0] 作者 0. 文献 0[J]. 2020.'},{id:'ack',title:'致谢',text:'谨向文献作者表达感谢。'}];return{snapshot,chapters};
}
test('inventory distinguishes ten real body references from one saved entry and an export candidate',()=>{
 const {snapshot,chapters}=fixture(),value=thesisReviewBibliographyContext(snapshot,chapters);assert.equal(value.coverage,'provided_body_chapters');assert.equal(value.bodyCitedReferenceCount,10);assert.equal(value.bodyCitationOccurrences,10);assert.equal(value.savedReferenceChapters[0].sourceEntries,1);assert.match(value.savedReferenceChapters[0].preview,/作者 0/);assert.equal(value.savedListMatchesBodyCitations,false);assert.equal(value.exportListCandidateCount,10);assert.match(value.scope,/不证明文献真实/);
 const exportText=presentThesisDocument(snapshot,chapters,{submission:true});assert.equal([...exportText.matchAll(/^\[\d+\]\s/gm)].length,10);const mismatched=structuredClone(chapters);mismatched[1].text+=' 与题录不一致的附加说明';assert.match(presentThesisDocument(snapshot,mismatched,{submission:true}),/参考文献整理原文（待核对）/);assert.equal(value.savedListReconciliation,'not_checked');
});
test('unresolved, duplicated, uncited, unconfirmed and missing versions never become verified bibliography',()=>{
 const {snapshot,chapters}=fixture();snapshot.references.push({id:'uncited',title:'未引用私人题录',confirmed:true,text:'未引用私人正文'},{id:'hidden',title:'未确认文献',confirmed:false});chapters[0].text+='[source:unknown] [source:hidden]';let value=thesisReviewBibliographyContext(snapshot,chapters);assert.equal(value.uncitedReferenceCount,1);assert.equal(value.unresolvedCitationCount,2);assert.equal(value.exportListCandidateCount,null);assert.doesNotMatch(JSON.stringify(value),/未引用私人题录|未引用私人正文|未确认文献/);
 snapshot.references.push({...snapshot.references[0]});value=thesisReviewBibliographyContext(snapshot,chapters);assert.equal(value.coverage,'incomplete_or_ambiguous');assert.ok(value.ambiguousSourceIds>0);assert.equal(value.exportListCandidateCount,null);
 const missing=fixture();missing.chapters=missing.chapters.filter(row=>row.id!=='c1');assert.equal(thesisReviewBibliographyContext(missing.snapshot,missing.chapters).coverage,'incomplete_or_ambiguous');
 const duplicate=fixture();duplicate.chapters.push({...duplicate.chapters[0]});assert.equal(thesisReviewBibliographyContext(duplicate.snapshot,duplicate.chapters),null);
});
test('long or unparseable reference chapters advertise their limitations',()=>{
 const {snapshot,chapters}=fixture();chapters[1].text='作者备注无法解析\n'+'未解析'.repeat(500);const value=thesisReviewBibliographyContext(snapshot,chapters);assert.equal(value.savedReferenceChapters[0].entryCountReliable,false);assert.equal(value.savedReferenceChapters[0].previewTruncated,true);
 chapters[0].text='长'.repeat(600001);assert.equal(thesisReviewBibliographyContext(snapshot,chapters).coverage,'unavailable');
});
test('unmapped numeric brackets make the index partial without assuming they are citations',()=>{
 const {snapshot,chapters}=fixture();assert.equal(thesisReviewBibliographyContext(snapshot,chapters).unmappedNumericBrackets,0);
 chapters[0].text+='另见 [1, 2]；数组 x[3]；另见 [4–6]。';const value=thesisReviewBibliographyContext(snapshot,chapters);assert.equal(value.unmappedNumericBrackets,3);assert.equal(value.indexStatus,'partial');assert.equal(value.savedListMatchesBodyCitations,null);assert.equal(value.exportListCandidateCount,null);assert.match(value.scope,/可能是引文或数组/);
});
test('duplicate saved entries and changed manuscript versions remain explicit and invalidate review reuse',()=>{
 const {snapshot,chapters}=fixture();chapters[1].text+='\n'+chapters[1].text;const first=thesisReviewBibliographyContext(snapshot,chapters);assert.equal(first.savedReferenceChapters[0].duplicateEntries,true);assert.equal(first.savedReferenceChapters[0].entryCountReliable,false);assert.equal(first.savedListMatchesBodyCitations,null);
 const args={task:{skill:'writing-review',context:{bibliographyIndex:first},materials:[]},snapshot,chapters,settings:{engine:'sdk',model:'model',version:'v1',maxTurns:4,maxOutputTokens:2048,timeoutMs:60000,maxCostUsd:.5},validatorVersion:'fixture-v1'},key=reviewBatchReuseKey(args);
 const changed=structuredClone(chapters);changed[0].text=changed[0].text.replace('[source:ref-9]','');const second=thesisReviewBibliographyContext(snapshot,changed);assert.equal(second.bodyCitedReferenceCount,9);assert.notEqual(reviewBatchReuseKey({...args,chapters:changed,task:{...args.task,context:{bibliographyIndex:second}}}),key);
});
test('all thesis review batches see the bound inventory but cannot cite other batches as their own prose',async()=>{
 const {snapshot,chapters}=fixture();chapters[0].text+='正文。'.repeat(3500);const privateRow={id:'private',title:'未引用私人题录',confirmed:true,text:'未引用私人全文'};snapshot.references.push(privateRow);
 const seen=[],quality=await createWritingQualityRunner({citationVerifier:{verify:async()=>({status:'completed',items:[],limitations:[]})}})({kind:'thesis',snapshot,chapters,checkSupplements:false,runtime:{maxTurns:3,maxOutputTokens:2048,timeoutMs:30000},dispatch:async({task})=>{
  seen.push(task);assert.ok(JSON.stringify(task.context).length<=39000);assert.equal(task.context.bibliographyIndex.bodyCitedReferenceCount,10);assert.equal(task.context.bibliographyIndex.savedReferenceChapters[0].sourceEntries,1);assert.doesNotMatch(JSON.stringify(task),/未引用私人题录|未引用私人全文/);
  const wrong={complete:true,findings:[{sectionId:task.context.manuscriptExcerpts[0].id,quote:'不存在于本批的完整原句',category:'source_support',severity:'warning',explanation:'检查依据。',suggestion:'核对来源。'}],limitations:[]};assert.throws(()=>parseWritingReview({text:JSON.stringify(wrong)},task));
  return{text:JSON.stringify({complete:true,findings:[],limitations:[]}),usage:{input:10,output:10},costUsd:.001};
 }});assert.ok(seen.length>=2);assert.equal(quality.coverage.complete,true);
});
