import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOutline,reconcileSections,composeBody,thesisWordCountSuggestions,thesisDefaultTargetWords,thesisTargetWordsState,changeThesisTargetDegree,thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';
const info={title:'课堂反馈研究',mode:'毕业论文',degree:'本科',major:'教育学',targetWords:'8000',method:'访谈',requirements:'使用真实数据'};
test('template includes user requirements but makes no claim to AI or reference analysis',()=>{const text=buildOutline(info);assert.ok(text.includes('目标字数：8000 字'));assert.ok(text.includes('研究方法：访谈'));assert.ok(text.includes('未调用 AI 或分析参考材料'));});
test('reordered outline retains exact chapter text and removed written chapters stay recoverable',()=>{const old=[{id:'a',title:'第一章 绪论',text:'已有背景内容'},{id:'b',title:'第二章 方法',text:'真实方法'},{id:'c',title:'第三章 结果',text:''}];const result=reconcileSections('第二章 方法\n第一章 研究背景',old);assert.equal(result[0].id,'b');assert.equal(result[0].text,'真实方法');assert.equal(result.at(-1).id,'a');assert.equal(result.at(-1).retained,true);assert.equal(result.at(-1).text,'已有背景内容');assert.equal(old[0].retained,undefined);});
test('export contains only written chapters without fabricating empty research results',()=>{const text=composeBody(info,[{title:'第一章 绪论',text:'用户填写的正文'},{title:'第二章 结果',text:''}]);assert.ok(text.includes('用户填写的正文'));assert.ok(!text.includes('第二章 结果'));assert.equal(reconcileSections('自定义大纲')[0].title,'正文');});

test('body-stage writing assets stay in the writing research stage',async()=>{const {researchStage}=await import('../dist/workspace/overview-model.mjs');assert.equal(researchStage({type:'draft',tool:'writing',data:{stage:'body',text:'已写正文'}}),'writing');});

test('degree word suggestions use the prescribed budgets and remain independent between calls',()=>{
 for(const [degree,expected] of [['专科',[4000,6000,8000,10000]],['本科',[8000,12000,15000,20000]],['硕士',[20000,30000,40000,50000]],['博士',[60000,80000]],['科研人员',[]],['研究工作者',[]]]){
  assert.deepEqual(thesisWordCountSuggestions(degree),expected);
  assert.equal(thesisDefaultTargetWords(degree),expected[0]||8000);
 }
 assert.deepEqual(thesisWordCountSuggestions(' 硕士论文 '),[20000,30000,40000,50000]);
 assert.deepEqual(thesisWordCountSuggestions('toString'),[]);
 assert.equal(thesisDefaultTargetWords('自定义研究身份'),8000);
 const changed=thesisWordCountSuggestions('本科');changed[0]=500;
 assert.equal(thesisDefaultTargetWords('本科'),8000);
});

test('new drafts follow degree defaults while historical targets are treated as manual',()=>{
 for(const [degree,words] of [['专科',4000],['本科',8000],['硕士',20000],['博士',60000],['科研人员',8000]])assert.deepEqual(thesisTargetWordsState({},degree),{targetWords:String(words),targetWordsMode:'degree'});
 assert.deepEqual(thesisTargetWordsState({degree:'硕士',targetWords:''}),{targetWords:'20000',targetWordsMode:'degree'});
 for(const words of [8000,12000,30000]){
  const original={degree:'本科',targetWords:words};
  const state=thesisTargetWordsState(original,'硕士');
  assert.deepEqual(state,{targetWords:String(words),targetWordsMode:'manual'});
  assert.equal(changeThesisTargetDegree(state,'博士').targetWords,String(words));
  assert.deepEqual(original,{degree:'本科',targetWords:words});
 }
});

test('saved degree defaults can follow a new level but explicit or inconsistent manual targets stay unchanged',()=>{
 assert.deepEqual(thesisTargetWordsState({degree:'本科',targetWords:8000,targetWordsMode:'degree'},'硕士'),{targetWords:'20000',targetWordsMode:'degree'});
 for(const draft of [{degree:'本科',targetWords:8000,targetWordsMode:'manual'},{degree:'本科',targetWords:12000,targetWordsMode:'degree'}]){
  const state=thesisTargetWordsState(draft,'硕士');
  assert.equal(state.targetWords,String(draft.targetWords));
  assert.equal(state.targetWordsMode,'manual');
  assert.deepEqual(changeThesisTargetDegree(state,'博士'),state);
 }
 const manualBlank={targetWords:'',targetWordsMode:'manual'};
 assert.deepEqual(thesisTargetWordsState(manualBlank,'博士'),manualBlank);
 assert.deepEqual(changeThesisTargetDegree(manualBlank,'硕士'),manualBlank);
 let state=thesisTargetWordsState({},'本科');
 for(const [degree,words] of [['专科',4000],['硕士',20000],['博士',60000],['研究工作者',8000]]){state=changeThesisTargetDegree(state,degree);assert.deepEqual(state,{targetWords:String(words),targetWordsMode:'degree'});}
});

test('execution snapshots use the same missing-target defaults and retain manually supplied budgets within the existing cap',()=>{
 const draft={title:'论文字数建议验收',outlineRows:[{id:'chapter',title:'研究设计',level:1,words:1000}]};
 for(const [degree,words] of [['专科',4000],['本科',8000],['硕士',20000],['博士',60000],['科研人员',8000]])assert.equal(thesisSnapshotFromDraft({...draft,degree}).profile.targetWords,words);
 assert.equal(thesisSnapshotFromDraft({...draft,degree:'博士',targetWords:12000}).profile.targetWords,12000);
 assert.equal(thesisSnapshotFromDraft({...draft,degree:'科研人员',targetWords:80000}).profile.targetWords,80000);
 for(const targetWords of [499,80001,60000.5])assert.throws(()=>thesisSnapshotFromDraft({...draft,degree:'博士',targetWords}),/500–80,000/);
});
