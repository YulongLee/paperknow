import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateOutlineWordBudget} from '../dist/workspace/outline-word-budget.mjs';
import {thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';
import {normalizeThesisSnapshot,thesisPlan} from '../backend/thesis-model.mjs';

const chapters=[
 {id:'intro',title:'第一章 研究背景',sections:[{id:'intro-a',title:'研究背景与意义'}]},
 {id:'method',title:'第二章 研究设计与方法',sections:[{id:'method-a',title:'研究对象'},{id:'method-b',title:'研究方法'}]},
 {id:'core',title:'第三章 案例分析',sections:[{id:'core-a',title:'案例论证'},{id:'core-b',title:'问题与分析'}]},
 {id:'conclusion',title:'第四章 结论与展望',sections:[]},
 {id:'references',kind:'references',title:'本研究已使用来源',sections:[]}
];
function draftWithBudget(targetWords){
 const allocated=allocateOutlineWordBudget(chapters,targetWords);
 return {title:'跨学科研究流程的案例分析',degree:'硕士',targetWords,knowledgeFiles:[{id:'source',name:'流程案例记录（测试材料）',text:'仅用于字数计划验证的人工测试材料，不是真实研究结果。'}],outlineRows:allocated.flatMap(chapter=>[
  {id:chapter.id,title:chapter.title,kind:chapter.kind,level:1,words:chapter.sections.length?0:chapter.targetWords},
  ...chapter.sections.map(section=>({id:section.id,title:section.title,level:2,words:section.targetWords}))
 ])};
}

for(const target of [8000,30001,80000])test(`outline editor budget reaches the body generation plan unchanged at ${target} words`,()=>{
 const draft=draftWithBudget(target),snapshot=normalizeThesisSnapshot(thesisSnapshotFromDraft(draft)),plan=thesisPlan(snapshot);
 assert.equal(draft.outlineRows.reduce((sum,row)=>sum+row.words,0),target);
 assert.equal(snapshot.outline.reduce((sum,chapter)=>sum+chapter.targetWords,0),target);
 assert.equal(plan.reduce((sum,unit)=>sum+unit.targetWords,0),target);
 assert.ok(plan.every(unit=>unit.targetWords>0&&unit.targetWords<=1800));
 assert.ok(!plan.some(unit=>unit.chapterId==='references'));
 for(const chapter of snapshot.outline.filter(row=>row.kind!=='references')){
  assert.equal(plan.filter(unit=>unit.chapterId===chapter.id).reduce((sum,unit)=>sum+unit.targetWords,0),chapter.targetWords);
  for(const section of chapter.sections)assert.equal(plan.filter(unit=>unit.sectionId===section.id).reduce((sum,unit)=>sum+unit.targetWords,0),section.targetWords);
 }
 assert.equal(snapshot.outline.at(-1).kind,'references');
});

test('body splits preserve odd section budgets without adding rounding words',()=>{
 const snapshot=normalizeThesisSnapshot({title:'预算测试',profile:{targetWords:3501},materials:[{id:'evidence',name:'测试材料',text:'验证字数分段的测试材料。',confirmed:true}],outline:[{id:'chapter',title:'研究分析',targetWords:3501}]});
 const plan=thesisPlan(snapshot);
 assert.deepEqual(plan.map(unit=>unit.targetWords),[1751,1750]);
});

test('legacy unspecified chapters and sections receive all remaining integer words',()=>{
 const input={title:'旧快照预算测试',profile:{targetWords:8000},materials:[{id:'evidence',name:'测试材料',text:'验证旧提纲字数分配的测试材料。',confirmed:true}]};
 const chapterPlan=thesisPlan(normalizeThesisSnapshot({...input,outline:[{id:'a',title:'研究背景'},{id:'b',title:'研究方法'},{id:'c',title:'案例分析'}]}));
 assert.equal(chapterPlan.reduce((sum,unit)=>sum+unit.targetWords,0),8000);
 assert.deepEqual(['a','b','c'].map(id=>chapterPlan.filter(unit=>unit.chapterId===id).reduce((sum,unit)=>sum+unit.targetWords,0)),[2667,2667,2666]);
 const sectionPlan=thesisPlan(normalizeThesisSnapshot({...input,outline:[{id:'a',title:'研究分析',targetWords:8000,sections:[{id:'a1',title:'分析一',targetWords:1000},{id:'a2',title:'分析二'},{id:'a3',title:'分析三'},{id:'a4',title:'分析四'}]}]}));
 assert.equal(sectionPlan.reduce((sum,unit)=>sum+unit.targetWords,0),8000);
 assert.deepEqual(['a1','a2','a3','a4'].map(id=>sectionPlan.filter(unit=>unit.sectionId===id).reduce((sum,unit)=>sum+unit.targetWords,0)),[1000,2334,2333,2333]);
});

test('a zero or undersized section cannot silently add words to an exhausted chapter budget',()=>{
 const input={title:'小节最小预算测试',profile:{targetWords:500},materials:[{id:'evidence',name:'测试材料',text:'验证预算最小值的测试材料。',confirmed:true}]};
 for(const words of [0,19]){
  const snapshot=normalizeThesisSnapshot({...input,outline:[{id:'a',title:'案例分析',targetWords:500,sections:[{id:'a1',title:'分析一',targetWords:500-words},{id:'a2',title:'分析二',targetWords:words}]}]});
  assert.throws(()=>thesisPlan(snapshot),/至少需要.*20 字/);
 }
});

test('numbered reference chapters are excluded consistently on both snapshot paths',()=>{
 for(const title of ['第六章 参考文献','6. References','Chapter VI: Bibliography']){
  const draft=draftWithBudget(8000);draft.outlineRows.at(-1).title=title;delete draft.outlineRows.at(-1).kind;
  const snapshot=normalizeThesisSnapshot(thesisSnapshotFromDraft(draft));
  assert.equal(snapshot.outline.at(-1).kind,'references');
  assert.equal(thesisPlan(snapshot).reduce((sum,unit)=>sum+unit.targetWords,0),8000);
  const direct=normalizeThesisSnapshot({...snapshot,outline:snapshot.outline.map(chapter=>({...chapter,kind:undefined}))});
  assert.equal(direct.outline.at(-1).kind,'references');
 }
});

test('a missing master budget uses 20,000 while an explicit invalid value remains invalid',()=>{
 const draft=draftWithBudget(8000);
 for(const targetWords of ['',undefined,null])assert.equal(thesisSnapshotFromDraft({...draft,targetWords}).profile.targetWords,20000);
 for(const targetWords of [0,-1,499,80001,'not-a-number'])assert.throws(()=>thesisSnapshotFromDraft({...draft,targetWords}),/500–80,000/);
});
