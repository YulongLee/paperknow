import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateOutlineWordBudget,isOutlineReferenceTitle} from '../dist/workspace/outline-word-budget.mjs';
import {normalizeThesisOutlineSnapshot,thesisOutlineTask,parseThesisOutline} from '../backend/thesis-outline-model.mjs';

const chapter=(title,count=2,extra={})=>({id:title,title,sections:Array.from({length:count},(_,i)=>({id:title+'-'+i,title:'主题论证环节 '+(i+1)})),...extra});
const outline=()=>[chapter('绪论'),chapter('文献综述与理论基础'),chapter('研究方法与设计'),chapter('实证分析与方案优化',4),chapter('研究结论与展望'),chapter('参考文献',0)];
function exact(chapters,target){
 const writing=chapters.filter(row=>row.kind!=='references'&&!isOutlineReferenceTitle(row.title));
 assert.equal(writing.reduce((sum,row)=>sum+row.targetWords,0),target);
 assert.equal(writing.reduce((sum,row)=>sum+(row.sections.length?row.sections.reduce((n,child)=>n+child.targetWords,0):row.targetWords),0),target);
 for(const row of writing){assert.ok(Number.isInteger(row.targetWords));if(row.sections.length){assert.equal(row.sections.reduce((sum,child)=>sum+child.targetWords,0),row.targetWords);for(const child of row.sections)assert.ok(Number.isInteger(child.targetWords)&&child.targetWords>=20);}else assert.ok(row.targetWords>=20);}
}

test('content-aware budgets fill 8000, 30000 and 80000 exactly and prioritize core research over introduction/conclusion',()=>{
 for(const target of [8000,30000,80000]){const input=outline(),frozen=JSON.stringify(input),result=allocateOutlineWordBudget(input,target);exact(result,target);assert.equal(JSON.stringify(input),frozen);assert.ok(result[3].targetWords>result[0].targetWords);assert.ok(result[3].targetWords>result[4].targetWords);assert.ok(result[2].targetWords>result[4].targetWords);assert.equal(result.at(-1).targetWords,0);assert.deepEqual(result,allocateOutlineWordBudget(input,target));}
});
test('numbered Chinese and English reference chapters and their children are excluded without consuming words',()=>{
 for(const title of ['参考文献','第六章 参考文献','6. References','6 References','Chapter VI: Bibliography','参考资料（不计入正文）','References (Excluded from word count)','References:']){
  assert.equal(isOutlineReferenceTitle(title),true,title);const result=allocateOutlineWordBudget([chapter('Introduction'),chapter('Core empirical analysis'),chapter(title,2,{targetWords:8000})],8000);exact(result,8000);assert.equal(result[2].targetWords,0);assert.ok(result[2].sections.every(row=>row.targetWords===0));assert.ok(result[1].targetWords>result[0].targetWords);
 }
 assert.equal(isOutlineReferenceTitle('参考文献使用现状分析'),false);
});
test('model weights adjust relative emphasis while bounded semantic roles retain reasonable core budgets',()=>{
 const base=[chapter('Introduction',2,{wordWeight:3}),chapter('First core analysis',2,{wordWeight:5}),chapter('Second core analysis',2,{wordWeight:8}),chapter('Conclusion',2,{wordWeight:2})];
 base[2].sections=[{title:'研究背景',wordWeight:2},{title:'核心机制论证',wordWeight:8}];const result=allocateOutlineWordBudget(base,8001);exact(result,8001);assert.ok(result[2].targetWords>result[1].targetWords);assert.ok(result[2].sections[1].targetWords>result[2].sections[0].targetWords);assert.ok(result[2].targetWords>result[0].targetWords);
 const inverted=allocateOutlineWordBudget([chapter('Introduction',2,{wordWeight:10}),chapter('Core analysis',2,{wordWeight:1}),chapter('Conclusion',2,{wordWeight:10})],8000);exact(inverted,8000);assert.ok(inverted[1].targetWords>inverted[0].targetWords);assert.ok(inverted[1].targetWords>inverted[2].targetWords);
});
test('invalid model weights and hostile existing budgets cannot create NaN, overflow or negative budgets',()=>{
 for(const bad of [0,-1,11,1e308,Infinity,NaN,'10',{value:10},null]){
  const input=outline();input[0].wordWeight=bad;input[0].targetWords=bad;input[0].sections[0].wordWeight=bad;input[0].sections[0].targetWords=bad;
  for(const preserveWeights of [false,true]){const result=allocateOutlineWordBudget(input,8000,{preserveWeights});exact(result,8000);}
 }
});
test('rescaling preserves existing chapter and child proportions with exact target instead of fixed small leaf counts',()=>{
 const input=[chapter('Chapter one',0,{targetWords:2000}),chapter('Chapter two',0,{targetWords:4000}),chapter('Chapter three',0,{targetWords:2000})];
 assert.deepEqual(allocateOutlineWordBudget(input,30000,{preserveWeights:true}).map(row=>row.targetWords),[7500,15000,7500]);
 const hierarchical=[chapter('主题一',2,{targetWords:2000}),chapter('主题二',1,{targetWords:6000})];hierarchical[0].sections[0].targetWords=500;hierarchical[0].sections[1].targetWords=1500;hierarchical[1].sections[0].targetWords=6000;
 const result=allocateOutlineWordBudget(hierarchical,30000,{preserveWeights:true});exact(result,30000);assert.deepEqual(result.map(row=>row.targetWords),[7500,22500]);assert.deepEqual(result[0].sections.map(row=>row.targetWords),[1875,5625]);
});
test('minimum leaf budgets are protected and impossible short outlines fail clearly',()=>{
 const result=allocateOutlineWordBudget([chapter('绪论',10),chapter('实证分析',15)],500);exact(result,500);assert.ok(result.every(row=>row.sections.every(child=>child.targetWords===20)));
 assert.throws(()=>allocateOutlineWordBudget([chapter('绪论',11),chapter('实证分析',15)],500),/小节过多|目标字数不足/);
 for(const target of [0,499,80001,8000.5,'8000',undefined,NaN,Infinity])assert.throws(()=>allocateOutlineWordBudget(outline(),target),/目标字数/);
 assert.throws(()=>allocateOutlineWordBudget([chapter('References',0)],8000),/正文写作章节/);
});
test('parser accepts legacy title-only outlines, normalizes suggested weights and numbers references correctly',()=>{
 for(const weighted of [false,true]){const raw=[chapter('Introduction'),chapter('Core research analysis',3),chapter('Conclusion'),chapter('Chapter IV: References',0)].map((row,i)=>({...row,...(weighted?{wordWeight:[3,8,2,1][i]}:{})}));
  const snapshot=normalizeThesisOutlineSnapshot({title:'Topic-specific outline test',profile:{level:'博士',targetWords:30000,language:'English'},materials:[],references:[]}),result=parseThesisOutline({text:JSON.stringify({complete:true,chapters:raw})},snapshot);exact(result.chapters,30000);assert.equal(result.chapters.at(-1).kind,'references');assert.equal(result.chapters.at(-1).targetWords,0);assert.ok(result.chapters[1].targetWords>result.chapters[0].targetWords);
 }
});
test('parser rejects minimum-budget conflicts and never trusts model actual counts or unsafe headings',()=>{
 const snapshot=normalizeThesisOutlineSnapshot({title:'短论文测试',profile:{level:'专科',targetWords:500},materials:[],references:[]});
 assert.throws(()=>parseThesisOutline({text:JSON.stringify({complete:true,chapters:[chapter('绪论',15),chapter('分析',15)]})},snapshot),/小节过多/);
 const safe=parseThesisOutline({text:JSON.stringify({complete:true,chapters:[chapter('绪论',1,{wordWeight:1e100,targetWords:20}),chapter('研究分析',1,{wordWeight:'unsafe',targetWords:20})]})},snapshot);exact(safe.chapters,500);assert.equal(Object.hasOwn(safe.chapters[0],'wordWeight'),false);
 assert.throws(()=>parseThesisOutline({text:JSON.stringify({complete:true,chapters:[chapter('绪论'),chapter('<script>bad</script>')]})},snapshot),/无效标题/);
});
test('task requests relative weights against configured target and retains non-fabrication boundaries',()=>{
 const snapshot=normalizeThesisOutlineSnapshot({title:'科研方案',profile:{level:'研究工作者',targetWords:80000},materials:[],references:[]}),task=thesisOutlineTask(snapshot);assert.equal(task.context.profile.targetWords,80000);assert.match(task.instructions,/wordWeight.*相对篇幅权重/);assert.match(task.instructions,/context.profile.targetWords/);assert.match(task.instructions,/参考文献不参与正文篇幅/);assert.match(task.instructions,/不能伪称已经实施实验/);
});
