import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAIQuestionnaire} from '../dist/workspace/questionnaire-model.mjs';
import {normalizeWritingSnapshot,writingPlan,aggregateWritingQuestionnaire,validateWritingCandidate} from '../backend/writing-model.mjs';

const scale=['非常不满意','不满意','一般','满意','非常满意'];
const make=questions=>({title:'阅读调查',introduction:'匿名自愿参与',questions});
const nonuser={id:'q1',type:'single',title:'是否使用过数字阅读服务？',options:['从未使用过','使用过'],required:true};
const experience={id:'q2',type:'scale',title:'您对服务的使用体验满意吗？',options:scale,required:true};
const general={id:'q3',type:'single',title:'您的年级是？',options:['一年级','二年级'],required:true};
test('non-users can skip required experience items while their scale and unrelated required questions are preserved',()=>{
 const input=make([nonuser,experience,general]),before=structuredClone(input);
 const out=normalizeAIQuestionnaire(input,{outputCount:3,scalePoints:5});
 assert.equal(out.questions[0].required,true);assert.equal(out.questions[1].required,false);
 assert.match(out.questions[1].title,/未使用者可跳过/);assert.deepEqual(out.questions[1].options,scale);
 assert.equal(out.questions[2].required,true);assert.deepEqual(input,before);
 assert.deepEqual(normalizeAIQuestionnaire(out,{outputCount:3,scalePoints:5}),out);
});
test('without explicit non-user option experience items remain unchanged',()=>{
 const out=normalizeAIQuestionnaire(make([{...nonuser,options:['使用过','曾经使用']},experience,general]),{outputCount:3,scalePoints:5});
 assert.equal(out.questions[1].required,true);
});
test('direct convenience ratings reject agree-disagree labels without rejecting agreement with statements',()=>{
 const agreement=['非常不同意','不同意','一般','同意','非常同意'];
 const rating={...experience,title:'请评价校内外访问的便利程度',options:agreement};
 assert.throws(()=>normalizeAIQuestionnaire(make([nonuser,rating,general]),{outputCount:3,scalePoints:5}),error=>error.validationCode==='questionnaire_options'&&error.validationIssues.some(i=>i.code==='scale_dimension_mismatch'&&i.questionIndex===2));
 const statement={...rating,title:'您是否同意该服务访问便利？'};
 assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([nonuser,statement,general]),{outputCount:3,scalePoints:5}));
 const corrected={...rating,options:['非常不便利','不便利','一般','便利','非常便利']};
 assert.equal(normalizeAIQuestionnaire(make([nonuser,corrected,general]),{outputCount:3,scalePoints:5}).questions[1].required,false);
});
test('incorrect convenience scale produces actionable safe feedback for model repair',()=>{
 const snap=normalizeWritingSnapshot({title:'阅读调查',profile:{level:'本科',language:'中文',targetWords:500},requirements:{outputCount:3,scalePoints:5},materials:[],references:[],outline:[]}),unit=writingPlan(snap,'questionnaire')[0];
 const candidate=make([nonuser,{...experience,title:'请评价访问的便利程度',options:['非常不同意','不同意','一般','同意','非常同意']},general]);
 const result=validateWritingCandidate({text:JSON.stringify({...candidate,complete:true,source_ids:[]}),trace:[]},'questionnaire','questionnaire',snap,unit);
 assert.equal(result.valid,false);assert.equal(result.feedback.code,'questionnaire_options');assert.equal(result.feedback.issues[0].code,'scale_dimension_mismatch');assert.match(result.feedback.rule,/从不便利到便利/);assert.doesNotMatch(JSON.stringify(result.feedback),/请评价访问/);
});
test('direct experience-and-ability question does not use agreement labels, while agreement statements remain valid',()=>{
 const agree=['非常不同意','不同意','一般','同意','非常同意'];
 const q={...experience,title:'请评价您在资源发现方面的体验：能否方便地找到自己想读的数字资源',options:agree};
 assert.throws(()=>normalizeAIQuestionnaire(make([nonuser,q,general]),{outputCount:3,scalePoints:5}),e=>e.validationCode==='questionnaire_options'&&e.validationIssues[0].code==='scale_dimension_mismatch');
 assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([nonuser,{...q,title:'请评价您是否同意以下陈述：我能方便地找到自己想读的数字资源'},general]),{outputCount:3,scalePoints:5}));
 assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([nonuser,{...q,options:['非常差','较差','一般','较好','非常好']},general]),{outputCount:3,scalePoints:5}));
});
test('non-user screening and experience questions from different batches are reconciled in the final output',()=>{
 const snap=normalizeWritingSnapshot({title:'阅读调查',profile:{level:'本科',language:'中文',targetWords:500},requirements:{outputCount:16,scalePoints:5},materials:[],references:[],outline:[]}), plan=writingPlan(snap,'questionnaire');
 const completed=plan.map(unit=>({id:unit.id,...make(Array.from({length:unit.questionCount},(_,i)=>{let n=unit.questionStart+i;if(n===1)return nonuser;if(n===9)return {...experience,id:'q9'};return {...general,id:'q'+n,title:'您的年级 '+n+' 是？'};})),sourceIds:[]}));
 const out=aggregateWritingQuestionnaire(snap,plan,completed);
 assert.equal(out.questions[8].required,false);assert.match(out.questions[8].title,/未使用者可跳过/);assert.match(out.text,/未使用者可跳过/);
});
