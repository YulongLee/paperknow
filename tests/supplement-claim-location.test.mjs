import test from 'node:test';
import assert from 'node:assert/strict';
import {locateSupplementClaim} from '../backend/supplement-claim-location.mjs';

const source={id:'source-a',confirmed:true,text:'来源原文：作者提出一种方法。'};
const issue={status:'missing',missing:['请核对引用'],manuscriptQuote:'研究提出了一种方法[source:source-a]。',evidence:[{sourceId:'source-a',quote:'作者提出一种方法。'}]};
const chapter={id:'chapter-a',versionId:'version-a',text:'开始。研究提出了一种方法[source:source-a]。结束。',figures:[]};
const identity={userId:'user-a',thesisId:'paper-a',runId:'run-a',chapterId:'chapter-a',chapterVersion:'version-a'};
const snapshot={references:[source],materials:[]};
const trace=[{tool:'read_material',status:'completed',materialId:'source-a',offset:0,limit:100}];
const build=patch=>locateSupplementClaim({identity,chapters:[chapter],snapshot,ruleVersion:'v1',issue,source,trace,...patch});

test('locates a single direct citation only after its source was read; never grants confirmation',()=>{
 const out=build();assert.ok(out);assert.equal(out.chapterOffset,3);assert.equal(out.sourceOffset,5);assert.equal(out.confirmationAllowed,false);assert.equal(out.claim,issue.manuscriptQuote);
});
test('rejects mixed issues, multi-sentence claims, wrong or repeated citations',()=>{
 for(const next of [{...issue,missing:['核对','补实验']},{...issue,manuscriptQuote:'一句。二句。'},{...issue,manuscriptQuote:'研究提出了一种方法[source:other]。'},{...issue,evidence:[...issue.evidence,...issue.evidence]}])assert.equal(build({issue:next}),null);
});
test('rejects partial reads, failed reads, unknown sources, duplicate excerpts and ambiguous chapters',()=>{
 for(const next of [[],[{...trace[0],limit:8}],[{...trace[0],status:'failed'}],[{...trace[0],materialId:'other'}]])assert.equal(build({trace:next}),null);
 assert.equal(build({snapshot:{references:[],materials:[]}}),null);
 assert.equal(build({snapshot:{references:[source,source]}}),null);
 assert.equal(build({chapters:[chapter,chapter]}),null);
 assert.equal(build({chapters:[{...chapter,text:chapter.text+issue.manuscriptQuote}]}),null);
 const repeated={...source,text:source.text+'作者提出一种方法。'};assert.equal(build({source:repeated,snapshot:{references:[repeated]}}),null);
});
test('account, manuscript, figure, sources, run, chapter version and rules all bind the record',()=>{
 const original=build().binding;
 for(const change of [{identity:{...identity,userId:'user-b'}},{identity:{...identity,runId:'run-b'}},{identity:{...identity,chapterVersion:'version-b'},chapters:[{...chapter,versionId:'version-b'}]},{ruleVersion:'v2'},{chapters:[{...chapter,figures:[{id:'figure'}]}]},{snapshot:{...snapshot,materials:[{id:'m',text:'新资料'}]}}])assert.notEqual(build(change).binding,original);
 assert.equal(build({identity:{...identity,chapterVersion:'version-b'}}),null);
});
test('unconfirmed or different source text cannot be borrowed from another snapshot',()=>{
 assert.equal(build({source:{...source,confirmed:false}}),null);
 assert.equal(build({snapshot:{references:[{...source,text:'别的内容'}]}}),null);
 assert.equal(build({identity:{...identity,userId:''}}),null);
});
