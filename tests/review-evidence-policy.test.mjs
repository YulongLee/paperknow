import test from 'node:test';
import assert from 'node:assert/strict';
import {supplementCheckTask,parseSupplementCheck} from '../backend/supplement-check.mjs';
import {writingReviewTask,parseWritingReview} from '../backend/writing-quality.mjs';
import {citationClaimBatches,validateCitationClaimBatch} from '../backend/supplement-claim-batches.mjs';
import {reviewEvidencePolicy} from '../backend/review-evidence-policy.mjs';

const quote='The dot products grow large in magnitude.';
const fragment={id:'fragment',confirmed:true,referenceSegment:true,relatedReferenceId:'reference',name:'作者提供片段',text:quote};
const chapter={id:'c',title:'方法',text:'作者解释点积幅度可能增大[source:fragment]。'};
const snapshot={materials:[fragment],references:[{id:'reference',confirmed:true,title:'原论文'}]};
const output=items=>({text:JSON.stringify({items})});

test('all independent review stages share evidence boundaries while retaining separate candidate contracts',()=>{
 const material=supplementCheckTask({snapshot,chapters:[chapter],materials:[fragment]});
 const review=writingReviewTask({snapshot,chapters:[chapter]});
 const [claim]=citationClaimBatches({sources:[{sectionId:'c',sourceId:'fragment',offset:chapter.text.indexOf('[source:'),status:'located',quote}],claims:[{id:'claim',sectionId:'c',sourceIndex:0,offset:chapter.text.indexOf('[source:')}]},[chapter]);
 for(const task of [material,review,claim.task])assert.ok(task.instructions.startsWith(reviewEvidencePolicy));
 assert.equal(material.context.operation,'supplement-check');
 assert.equal(review.context.sourceEvidence.items[0].id,'fragment');
 assert.equal(claim.review.sources[0].sourceId,'fragment');
});

test('an author-linked fragment remains its own evidence and cannot impersonate an unread parent or foreign source',()=>{
 const task=supplementCheckTask({snapshot,chapters:[chapter],materials:[fragment]});
 const row={id:'c',status:'sufficient',requirement:'引文支持',reason:'授权片段支持当前转述。',manuscriptQuote:chapter.text,evidence:[{sourceId:'fragment',quote}],missing:[]};
 assert.equal(parseSupplementCheck(output([row]),task)[0].evidence[0].sourceId,'fragment');
 for(const sourceId of ['reference','another-account'])assert.throws(()=>parseSupplementCheck(output([{...row,evidence:[{sourceId,quote}]}]),task),e=>e.code==='invalid_supplement_check');
 assert.throws(()=>parseSupplementCheck(output([{...row,evidence:[{sourceId:'fragment',quote:'未实际提供的原文内容'}]}]),task),e=>e.code==='invalid_supplement_check');
});

test('policy does not clear uncertain claim assessments or manuscript warnings',()=>{
 const [batch]=citationClaimBatches({sources:[{sectionId:'c',sourceId:'fragment',offset:chapter.text.indexOf('[source:'),status:'located',quote}],claims:[{id:'claim',sectionId:'c',sourceIndex:0,offset:chapter.text.indexOf('[source:')}]},[chapter]);
 const uncertain={id:'c',status:'missing',citationAssessments:[{id:'claim',status:'uncertain'}]};
 assert.equal(validateCitationClaimBatch(batch,output([uncertain]))[0].status,'uncertain');
 assert.throws(()=>validateCitationClaimBatch(batch,output([{...uncertain,status:'sufficient'}])));
 const task=writingReviewTask({snapshot,chapters:[chapter]});
 const result=parseWritingReview({text:JSON.stringify({complete:true,checkedFigureIds:[],findings:[{sectionId:'c',quote:chapter.text,category:'source_support',severity:'warning',explanation:'当前摘录不足以核对此处结论。',suggestion:'补充对应的原文依据。'}],limitations:[]})},task);
 assert.equal(result.findings[0].severity,'warning');
 assert.equal(result.findings[0].category,'source_support');
});
