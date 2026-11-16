import test from 'node:test';
import assert from 'node:assert/strict';
import {authorReviewedFinding} from '../dist/workspace/thesis-author-review-model.mjs';
const finding={sectionId:'c1',offset:0,quote:'本研究只报告作者所定义的三个案例。',category:'claim_scope',severity:'warning',explanation:'核对案例边界。',suggestion:'核对作者记录。'};
function quality(f=finding){return {coverage:{complete:true},authorReview:{version:1,scope:'author_confirmation_not_independent_verification',items:[{...f,chapterId:f.sectionId,source:'review',confirmed:true,id:'record',basis:'a'.repeat(64),reason:'作者核对了三组构造的案例记录，本文仅报告这三组案例的几何判定。',sourceId:'s1',sourceQuote:'本文限定三个矩形案例，不涉及真实用户试验。'}]}};}
test('author evidence records cannot waive numerical categories, errors, incomplete coverage or different findings',()=>{
 const q=quality();assert.equal(authorReviewedFinding(q,finding),true);
 for(const change of [{category:'logic'},{category:'table_consistency'},{category:'figure_consistency'},{category:'data_support'},{severity:'error'}]){const f={...finding,...change};assert.equal(authorReviewedFinding(quality(f),f),false);}
 for(const change of [{offset:1},{quote:'不同句子。'},{sectionId:'c2'},{explanation:'同一原文另一项事实问题。'},{suggestion:'需要补充其他独立证据。'}])assert.equal(authorReviewedFinding(q,{...finding,...change}),false);
 assert.equal(authorReviewedFinding({...q,stale:true},finding),false);assert.equal(authorReviewedFinding({...q,coverage:{complete:false}},finding),false);assert.equal(authorReviewedFinding({...q,authorReview:{...q.authorReview,scope:'ai_approved'}},finding),false);
});
