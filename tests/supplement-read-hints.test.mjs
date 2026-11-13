import test from 'node:test';
import assert from 'node:assert/strict';
import {supplementReadHints,runSupplementCheck,supplementCheckTask} from '../backend/supplement-check.mjs';

test('user-provided literature excerpts keep a precise but unverified reference association in review',async()=>{
 const refs=[{id:'r1',title:'同名论文',text:'第一篇摘要正文。',confirmed:true},{id:'r2',title:'同名论文',text:'第二篇摘要正文。',confirmed:true}],materials=[{id:'m',name:'文献片段：同名论文',text:'用户提供的第3.2.1节方法片段。',confirmed:true,relatedReferenceId:'r2'},{id:'bad',name:'文献片段',text:'另一个用户片段。',confirmed:true,relatedReferenceId:'not-authorized'}],snapshot={title:'研究',profile:{},requirements:{},materials,references:refs};const direct=supplementCheckTask({snapshot,materials,chapters:[]});assert.equal(direct.context.evidence.find(row=>row.id==='m').relatedReferenceId,'r2');assert.equal(direct.context.evidence.find(row=>row.id==='bad').relatedReferenceId,undefined);assert.match(direct.instructions,/不能证明片段出处或完整性/);assert.match(direct.instructions,/不能将片段当作另一来源已读正文/);
 let observed=false;await runSupplementCheck({snapshot,chapters:[{id:'c',title:'方法',text:'本节讨论方法说明。'}],kind:'thesis',phase:'final',runtime:{maxOutputTokens:1024},dispatch:async({task})=>{observed=true;assert.equal(task.context.evidence.find(row=>row.id==='m').relatedReferenceId,'r2');assert.equal(task.context.evidence.find(row=>row.id==='bad').relatedReferenceId,undefined);return {text:JSON.stringify({items:[{id:task.context.chapters[0].id,status:'not_required',requirement:'一般说明',reason:'无具体事实断言',evidence:[],missing:[]}]})};}});assert.equal(observed,true);
});

test('precise source locations include matching model rows and a later original feature record without inventing evidence',()=>{
 const filler='备注，不相关。\n'.repeat(200),model='MODEL_X,SAMPLE-073,预测类别B,真实类别A\n',feature='SAMPLE-073,6.3,2.5,4.9,1.5\n';
 const source='【逐折结果】\nMODEL_X,1,0.9\n'+filler+'MODEL_Y,SAMPLE-073,预测类别A\n'+model+filler+feature;
 const chapter='检查 MODEL_X 对 SAMPLE-073 的逐条预测和四项特征，核查逐折记录。';
 const hints=supplementReadHints(source,[{text:chapter}]);assert.ok(hints.length<=24);
 assert.ok(hints.some(h=>h.term==='SAMPLE-073'&&source.slice(h.offset,h.offset+250).includes(model)));
 assert.ok(hints.some(h=>h.term==='SAMPLE-073'&&source.slice(h.offset,h.offset+250).includes(feature)));
 assert.ok(hints.every(h=>h.offset>=0&&h.offset<source.length&&source.slice(h.offset,h.offset+250).toLowerCase().includes(h.term.toLowerCase())));
 assert.ok(!supplementReadHints(source,[{text:'无具体相关编号[source:NOT-A-SAMPLE]'}]).some(h=>h.term==='NOT-A-SAMPLE'));
});

test('available locations are only hints: an unrelated or contradictory record cannot turn into a completed review',async()=>{
 const source='MODEL_X,SAMPLE-073,真实A,预测B\nMODEL_Y,SAMPLE-073,真实A,预测A\n',text='实际测试中 MODEL_X 对 SAMPLE-073 的预测结果有待核对。',snapshot={title:'研究',profile:{},requirements:{},materials:[{id:'m',name:'记录',text:source,confirmed:true}],references:[]};
 const report=await runSupplementCheck({snapshot,chapters:[{id:'c',title:'结果',text}],kind:'thesis',phase:'final',runtime:{maxOutputTokens:1024},dispatch:async({task})=>{assert.ok(task.context.evidence[0].readHints.some(h=>h.term==='SAMPLE-073'));return {text:JSON.stringify({items:task.context.chapters.map(c=>({id:c.id,status:'missing',requirement:'模型预测结果',reason:'模型结果存在差异',manuscriptQuote:c.text,evidence:[{sourceId:'m',quote:'MODEL_X,SAMPLE-073,真实A,预测B'}],missing:['核对 MODEL_X 的预测类别']}))})};}});
 assert.equal(report.status,'needs_materials');assert.equal(report.coverage.complete,true);assert.ok(report.items[0].missing.length);
});

test('English paper and Chinese source get multilingual locations, and a missing finding must inspect relevant readable ranges',async()=>{
 const filler='无关原始记录。'.repeat(1000),source=filler+'\n【逐条预测】\nMODEL_A,SAMPLE-007,真实A,预测B\n'+filler+'\n【混淆矩阵】\nA,0,1\n'+filler+'\n【置换重要性】\nfeature_a,0.2,0.1\n';
 const manuscript='The predictions, confusion matrix, and permutation importance for the experiment require evidence.';
 const snapshot={title:'test',profile:{},requirements:{},materials:[{id:'m',name:'记录',text:source,confirmed:true}],references:[]};let called=false;
 const report=await runSupplementCheck({snapshot,chapters:[{id:'c',title:'Abstract',text:manuscript}],kind:'thesis',phase:'final',runtime:{maxOutputTokens:1024},dispatch:async({task,validateReviewOutput})=>{
  called=true;const hints=task.context.evidence[0].readHints;for(const term of ['预测','混淆矩阵','置换'])assert.ok(hints.some(h=>h.term===term),term);
  const row={id:task.context.chapters[0].id,status:'missing',requirement:'预测、混淆矩阵和置换记录',reason:'未提供预测、混淆矩阵和置换记录',manuscriptQuote:manuscript,evidence:[],missing:['核对预测、混淆矩阵、置换记录']};
  const candidate=trace=>({text:JSON.stringify({items:[row]}),trace});const validate=value=>validateReviewOutput(value);
  assert.equal(validate(candidate([])).valid,false);
  assert.equal(validate(candidate([{tool:'read_material',status:'completed',materialId:'m',offset:0,limit:100}])).valid,false);
  const trace=['预测','混淆矩阵','置换'].map(term=>({tool:'read_material',status:'completed',materialId:'m',offset:hints.find(h=>h.term===term).offset,limit:6000}));
  assert.equal(validate(candidate(trace)).valid,true);return candidate(trace);
 }});
 assert.equal(called,true);assert.equal(report.status,'needs_materials');assert.equal(report.coverage.complete,true);assert.match(report.items[0].reason,/尚未在已核对范围内定位/);
});
