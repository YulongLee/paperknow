import test from 'node:test';
import assert from 'node:assert/strict';
import {supplementReadHints,runSupplementCheck,supplementCheckTask,parseSupplementCheck} from '../backend/supplement-check.mjs';

test('an unverified linked fragment is acknowledged but cannot become the cited source',async()=>{
 const snapshot={references:[{id:'r',title:'已导入题录',confirmed:true}],materials:[{id:'m',name:'用户提供文献片段',text:'一段用户提供的片段，来源尚未核实。',relatedReferenceId:'r',confirmed:true}]};let called=false;
 const report=await runSupplementCheck({snapshot,chapters:[{id:'c',title:'背景',text:'引用某文献的论断[source:r]。'}],kind:'thesis',dispatch:async()=>{called=true;throw Error('must not dispatch');}});
 assert.equal(called,false);assert.equal(report.coverage.complete,false);assert.match(report.reason,/已保存作者提供的独立文献片段/);assert.match(report.reason,/尚未核验其文献出处/);
});
test('author-provided reference text retains its unverified provenance in the review prompt',()=>{
 const reference={id:'r',title:'论文',text:'作者提供的摘要片段。',sourceLabel:'作者提供原文或摘要，文献出处未独立核验',confirmed:true},task=supplementCheckTask({snapshot:{references:[reference]},materials:[{...reference,name:reference.title}],chapters:[]});assert.equal(task.context.evidence[0].sourceLabel,reference.sourceLabel);assert.match(task.instructions,/未经独立核验出处/);assert.match(task.instructions,/不能假定其为全文/);
});

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

test('linked English paper locations must be read before a Chinese missing claim, without treating the link as proof',async()=>{
 const prefix='Unrelated article text. '.repeat(300),sentence='The sequential nature precludes parallelization within training examples.';
 const source=prefix+sentence+'\n'+'More article text. '.repeat(2000),other=prefix+'Parallelization is described for a different model.'+' Extra. '.repeat(500);
 const text='循环模型的顺序计算限制并行化[source:r1]。',refs=[{id:'r1',title:'英文论文',text:'摘要文字足够阅读。',confirmed:true},{id:'r2',title:'其他论文',text:'另一篇摘要文字。',confirmed:true}],materials=[{id:'m1',name:'作者关联片段',text:source,confirmed:true,relatedReferenceId:'r1'},{id:'m2',name:'其他关联片段',text:other,confirmed:true,relatedReferenceId:'r2'}];
 const snapshot={title:'研究',profile:{},requirements:{},references:refs,materials};let observed=false;
 const report=await runSupplementCheck({snapshot,chapters:[{id:'c',title:'背景',text}],kind:'thesis',phase:'final',runtime:{maxOutputTokens:1024},dispatch:async({task,validateReviewOutput})=>{
  observed=true;const m=task.context.evidence.find(s=>s.id==='m1'),hint=m.readHints.find(h=>h.term==='parallelization');assert.ok(hint);assert.match(task.instructions,/不能证明片段出处或完整性/);
  const row={id:task.context.chapters[0].id,status:'missing',requirement:'循环顺序限制并行的依据',reason:'授权资料仅有摘要句',manuscriptQuote:text,evidence:[],missing:['提供循环计算限制并行的依据']};const candidate=trace=>({text:JSON.stringify({items:[row]}),trace});
  const entry=(materialId,offset,limit=200)=>({tool:'read_material',status:'completed',materialId,offset,limit});
  assert.equal(validateReviewOutput(candidate([])).valid,false);assert.equal(validateReviewOutput(candidate([entry('m1',0,20)])).valid,false);assert.equal(validateReviewOutput(candidate([entry('m2',hint.offset)])).valid,false);
  const trace=[entry('m1',hint.offset,600)];assert.equal(validateReviewOutput(candidate(trace)).valid,true);return candidate(trace);
 }});
 assert.ok(observed);assert.equal(report.status,'needs_materials');assert.match(report.items[0].reason,/已核对范围内仅定位到摘要/);
});
test('a cited English gradient passage is read before declaring the Chinese claim missing',async()=>{
 const text='原论文指出缩放可缓解 softmax 梯度趋平[source:r]。',passage='large values push the softmax function into regions with extremely small gradients',source='Background material. '.repeat(500)+passage+' Further material. '.repeat(1200),snapshot={title:'研究',profile:{},requirements:{},materials:[],references:[{id:'r',title:'论文',text:source,confirmed:true}]};let observed=false;
 const report=await runSupplementCheck({snapshot,chapters:[{id:'c',title:'结论',text}],kind:'thesis',phase:'final',runtime:{maxOutputTokens:1024},dispatch:async({task,validateReviewOutput})=>{observed=true;const entry=task.context.evidence.find(x=>x.id==='r'),hint=entry.readHints?.find(x=>x.term==='gradient');assert.ok(hint);const row={id:task.context.chapters[0].id,status:'missing',requirement:'缩放与 softmax 梯度依据',reason:'本次尚未找到 gradients 依据',manuscriptQuote:text,evidence:[],missing:['核对缩放和梯度的原文']},candidate=trace=>({text:JSON.stringify({items:[row]}),trace});assert.equal(validateReviewOutput(candidate([])).valid,false);const trace=[{tool:'read_material',status:'completed',materialId:'r',offset:hint.offset,limit:1000}];assert.equal(validateReviewOutput(candidate(trace)).valid,true);return candidate(trace);}});assert.ok(observed);assert.equal(report.status,'needs_materials');
});

test('no lexical hit or no linked authorized source is not guessed to be evidence',async()=>{
 const text='循环模型的顺序计算限制并行化[source:r]。',snapshot={title:'研究',profile:{},requirements:{},references:[{id:'r',title:'论文',text:'本文摘要内容。',confirmed:true}],materials:[{id:'m',name:'作者关联片段',text:'Nothing related. '.repeat(500),confirmed:true,relatedReferenceId:'r'}]};
 const report=await runSupplementCheck({snapshot,chapters:[{id:'c',title:'背景',text}],kind:'thesis',runtime:{maxOutputTokens:1024},dispatch:async({task,validateReviewOutput})=>{const result={text:JSON.stringify({items:[{id:task.context.chapters[0].id,status:'missing',requirement:'循环顺序限制并行的依据',reason:'尚未定位对应段落',manuscriptQuote:text,evidence:[],missing:['核对对应来源']}]})};assert.equal(validateReviewOutput(result).valid,true);return result;}});
 assert.equal(report.status,'needs_materials');
});

test('a short source also requires reading when its selected preview omits the hit',()=>{
 const text='循环模型的顺序计算限制并行化[source:r]。',source='Unrelated text. '.repeat(220)+'sequential processing precludes parallelization.';assert.ok(source.length<6000);
 const snapshot={references:[{id:'r',confirmed:true}],materials:[]},task=supplementCheckTask({snapshot,chapters:[{id:'c',title:'背景',text}],materials:[{id:'m',name:'用户关联片段',text:source.slice(0,120),relatedReferenceId:'r'}]});
 task.materials=[{id:'m',name:'用户关联片段',text:source}];task.context.evidence[0].readHints=supplementReadHints(source,[{text}]);
 const row={id:'c',status:'missing',requirement:'循环顺序限制并行的依据',reason:'尚未定位对应段落',manuscriptQuote:text,evidence:[],missing:['核对对应来源']},candidate=trace=>({text:JSON.stringify({items:[row]}),trace});
 assert.throws(()=>parseSupplementCheck(candidate([]),task));const hint=task.context.evidence[0].readHints.find(h=>h.term==='parallelization');assert.ok(hint);assert.equal(parseSupplementCheck(candidate([{tool:'read_material',status:'completed',materialId:'m',offset:hint.offset,limit:600}]),task)[0].status,'missing');
});
