import test from 'node:test';import assert from 'node:assert/strict';import {aggregateWritingQuestionnaire} from '../backend/writing-model.mjs';
test('two questionnaire batches keep global references to a question in the second batch',()=>{
 const snapshot={requirements:{outputCount:6}},plan=[{id:'a',questionStart:1,questionCount:3},{id:'b',questionStart:4,questionCount:3}];
 const q=(id,title)=>({id,type:'text',title,options:[],required:false});
 const common={title:'调查',introduction:'参与自愿，请按实际情况填写。',sourceIds:[]};
 const done=[{id:'a',...common,questions:[q('q1','问题一'),q('q2','问题二'),q('q3','问题三')]},{id:'b',...common,questions:[q('q4','问题四'),q('q5','如果 q4 选择A，请说明原因。'),q('q6','问题六')]}];
 const result=aggregateWritingQuestionnaire(snapshot,plan,done);assert.equal(result.questions[4].title,'如果 第4题 选择A，请说明原因。');assert.doesNotMatch(result.questions[4].title,/第1题/);
});
