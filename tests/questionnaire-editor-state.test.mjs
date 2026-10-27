import test from 'node:test';
import assert from 'node:assert/strict';
import {questionnaireEditorKey} from '../dist/workspace/questionnaire-model.mjs';
import {normalizeQuestionnaireContent} from '../backend/questionnaire-service.mjs';

test('editor guards detect text, options and introduction changes while staying compact for sixty full questions',()=>{
 const content={introduction:'匿名自愿参与',questions:Array.from({length:60},(_,i)=>({id:'q'+i,title:'研'.repeat(500),type:'text',options:[],required:false}))},key=questionnaireEditorKey(content),before=structuredClone(content);
 assert.ok(key.length<80);assert.match(key,/^q1:\d+:[0-9a-f]+:[0-9a-f]+$/);assert.equal(questionnaireEditorKey(structuredClone(content)),key);
 for(const mutate of [c=>{c.questions[20].title+='a';},c=>{c.questions[20].options=['A','B'];},c=>{c.introduction+='说明';}]){const changed=structuredClone(content);mutate(changed);assert.notEqual(questionnaireEditorKey(changed),key);}
 const reordered={...content,questions:content.questions.map(q=>({required:q.required,options:q.options,title:q.title,type:q.type,id:q.id}))};assert.equal(questionnaireEditorKey(reordered),key);assert.deepEqual(content,before);assert.doesNotMatch(key,/匿名|研/);
});

test('questionnaire recovery accepts only a bounded editor guard and retains the existing private-state size ceiling',()=>{
 const content={title:'合成问卷',audience:'合成人群',purpose:'检查恢复信息',introduction:'匿名自愿',questions:[]},adoptionKey=questionnaireEditorKey(content);
 assert.equal(normalizeQuestionnaireContent({...content,aiState:{adoptionKey}}).aiState.adoptionKey,adoptionKey);
 for(const key of ['raw private editor text','q1:10:secret:aa','x'.repeat(81),null])assert.throws(()=>normalizeQuestionnaireContent({...content,aiState:{adoptionKey:key}}));
 assert.throws(()=>normalizeQuestionnaireContent({...content,aiState:{adoptionKey,contextKey:'x'.repeat(21000)}}),/任务状态过长/);
});
