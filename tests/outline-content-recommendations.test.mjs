import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOutlinePresentationRecommendations} from '../dist/workspace/outline-content-recommendations.mjs';

const keys=['table','image','formula','code'],off=()=>Object.fromEntries(keys.map(key=>[key,false])),all=()=>Object.fromEntries(keys.map(key=>[key,true]));
const leaf=(id,title,extra={})=>({id,title,targetWords:800,sections:[],...extra});
const computing={title:'计算机软件中的可核对算法与研究设计',profile:{major:'软件工程',discipline:'计算机科学',method:'算法设计与定量模型分析',targetWords:8000}};
const flatten=chapters=>chapters.flatMap(chapter=>chapter.sections?.length?chapter.sections:[chapter]);
const count=(chapters,key)=>flatten(chapters).filter(row=>row.presentation[key]).length;
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}

test('recommendations return an immutable deep copy without changing identifiers, word budgets or extra metadata',()=>{
 const input=freeze([leaf('own-route','研究技术路线',{targetWords:1300,sourceIds:['evidence-a'],presentationNote:{label:'待本人核对',tags:['only-synthetic']},nested:{child:{value:3}}}),{id:'parent',title:'研究设计',targetWords:2700,extra:{keep:true},sections:[{id:'own-comparison',title:'不同方法比较',targetWords:2700,wordWeight:7,sourceIds:['evidence-b']}]}]),before=structuredClone(input),snapshot=freeze(structuredClone(computing)),result=applyOutlinePresentationRecommendations(input,snapshot);
 assert.deepEqual(input,before);assert.notEqual(result,input);assert.notEqual(result[0],input[0]);assert.notEqual(result[1].sections,input[1].sections);assert.notEqual(result[1].sections[0],input[1].sections[0]);assert.equal(result[0].id,'own-route');assert.equal(result[0].targetWords,1300);assert.equal(result[1].targetWords,2700);assert.equal(result[1].sections[0].targetWords,2700);assert.equal(result[1].sections[0].wordWeight,7);assert.deepEqual(result[0].sourceIds,['evidence-a']);result[0].nested.child.value=20;result[0].presentationNote.tags.push('changed-copy');assert.equal(input[0].nested.child.value,3);assert.deepEqual(input[0].presentationNote.tags,['only-synthetic']);assert.deepEqual(snapshot,computing);
});

test('explicit selections including all-false and partial records are preserved rather than replaced by heuristics',()=>{
 const input=[leaf('plain-route','研究技术路线',{presentation:off()}),leaf('own-formula','数学公式推导',{presentation:{formula:true}}),leaf('own-refusal','算法实现',{presentation:{code:false}}),leaf('own-rich','方案比较',{presentation:all()})],result=applyOutlinePresentationRecommendations(input,computing);
 assert.deepEqual(result[0].presentation,off());assert.deepEqual(result[1].presentation,{...off(),formula:true});assert.deepEqual(result[2].presentation,off());assert.deepEqual(result[3].presentation,all());assert.deepEqual(input[1].presentation,{formula:true});assert.deepEqual(input[2].presentation,{code:false});
});

test('parents with sections and reference chapters never receive permission or pass it to their children',()=>{
 const result=applyOutlinePresentationRecommendations([{id:'parent',title:'数学模型与系统架构',targetWords:1600,presentation:all(),sections:[{id:'child',title:'指标公式推导',targetWords:1600,presentation:{formula:true}}]},{id:'references',title:'3. 参考文献',targetWords:0,presentation:all(),sections:[{id:'reference-child',title:'算法方法比较',targetWords:0,presentation:all()}]},{id:'kind-reference',kind:'references',title:'Source list',presentation:all(),sections:[]},leaf('section-reference','References')],computing);
 assert.deepEqual(result[0].presentation,off());assert.deepEqual(result[0].sections[0].presentation,{...off(),formula:true});assert.deepEqual(result[1].presentation,off());assert.deepEqual(result[1].sections[0].presentation,off());assert.deepEqual(result[2].presentation,off());assert.deepEqual(result[3].presentation,off());
});

test('unselected front matter, introduction, conclusion and short sections remain plain even in a technical topic',()=>{
 const input=['摘要','Abstract','关键词','Keywords','目录','Table of Contents','致谢','Acknowledgements','第一章 绪论','研究背景与意义','讨论与结论','Conclusion and outlook'].map((name,index)=>leaf('plain-'+index,name));input.push(leaf('short-route','技术路线与算法实现',{targetWords:249}));const result=applyOutlinePresentationRecommendations(input,computing);for(const row of result)assert.deepEqual(row.presentation,off(),row.title);
 const selected=applyOutlinePresentationRecommendations([leaf('explicit-abstract','摘要',{presentation:{image:true}}),leaf('explicit-short','代码示例',{targetWords:100,presentation:{code:true}})],computing);assert.equal(selected[0].presentation.image,true);assert.equal(selected[1].presentation.code,true,'An existing explicit choice is not a fallback recommendation to trim');
});

test('specific route, comparison, mathematical and implementation headings receive relevant independent permissions',()=>{
 const result=applyOutlinePresentationRecommendations([leaf('route','研究技术路线与处理流程'),leaf('comparison','不同研究方案对比'),leaf('formula','指标计算公式推导'),leaf('code','算法实现与数据预处理'),leaf('results','结果分析与变量定义'),leaf('neutral','研究范围与工作安排')],computing),byId=Object.fromEntries(result.map(row=>[row.id,row.presentation]));
 assert.equal(byId.route.image,true);assert.equal(byId.comparison.table,true);assert.equal(byId.formula.formula,true);assert.equal(byId.code.code,true);assert.equal(byId.results.table,true);assert.deepEqual(byId.neutral,off());assert.equal(byId.route.code,false);assert.equal(byId.comparison.formula,false);assert.equal(byId.results.code,false);
});

test('humanities relationships and comparisons can use concepts without acquiring quantitative formulas or code',()=>{
 const snapshot={title:'鲁迅小说叙事视角与人物关系研究',profile:{level:'本科',major:'中国语言文学',targetWords:8000}},result=applyOutlinePresentationRecommendations([leaf('intro','小说叙事研究背景'),{id:'narrative',title:'人物关系与叙事结构分析',targetWords:5000,sections:[{id:'relationships',title:'主要人物关系',targetWords:2500},{id:'perspectives',title:'不同叙事视角的比较',targetWords:2500}]},leaf('conclusion','讨论与结论'),leaf('refs','参考文献')],snapshot);
 assert.equal(result[1].sections[0].presentation.image,true);assert.equal(result[1].sections[1].presentation.table,true);for(const row of flatten(result)){assert.equal(row.presentation.formula,false);assert.equal(row.presentation.code,false);}assert.deepEqual(result[0].presentation,off());assert.deepEqual(result.at(-1).presentation,off());
});

test('professional context enables a quantitative model or computing implementation without applying those formats to every chapter',()=>{
 const headings=[leaf('model','模型设计'),leaf('preprocessing','数据预处理'),leaf('discussion','研究方案的实现'),leaf('neutral','研究对象说明')],human=applyOutlinePresentationRecommendations(headings,{title:'文化表达研究',profile:{major:'中国语言文学',targetWords:8000}}),technical=applyOutlinePresentationRecommendations(headings,computing);
 assert.equal(human[0].presentation.formula,false);assert.equal(human[1].presentation.code,false);assert.equal(human[2].presentation.code,false);assert.equal(technical[0].presentation.formula,true);assert.equal(technical[1].presentation.code,true);assert.deepEqual(technical[3].presentation,off());
});

test('literary cultural codes and narrative functions do not imply executable code or mathematical formulas',()=>{
 const snapshot={title:'文化代码、符号体系与叙事函数研究',profile:{major:'中国语言文学',discipline:'文学',targetWords:8000}},headings=['文化代码','符号代码阐释','叙事函数','Narrative functions and cultural code'],result=applyOutlinePresentationRecommendations(headings.map((heading,index)=>leaf('literary-'+index,heading)),snapshot);
 for(const row of result){assert.equal(row.presentation.code,false,row.title);assert.equal(row.presentation.formula,false,row.title);}
 for(const heading of ['代码示例','伪代码','程序实现','sourcecode','source code','pseudocode'])assert.equal(applyOutlinePresentationRecommendations([leaf('explicit-code',heading)],snapshot)[0].presentation.code,true,heading+' is an explicit request');
 assert.equal(applyOutlinePresentationRecommendations([leaf('technical-code','代码结构')],computing)[0].presentation.code,true);
 assert.equal(applyOutlinePresentationRecommendations([leaf('technical-function','函数设计')],computing)[0].presentation.formula,true);
 assert.equal(applyOutlinePresentationRecommendations([leaf('explicit-math','目标函数推导')],snapshot)[0].presentation.formula,true);
});

test('parent semantics help a concrete child step while unrelated children stay unselected',()=>{
 const result=applyOutlinePresentationRecommendations([{id:'route-parent',title:'系统架构与研究技术路线',targetWords:3000,sections:[{id:'step',title:'主要分析步骤',targetWords:1500},{id:'scope',title:'研究对象说明',targetWords:1500}]}],computing);assert.equal(result[0].sections[0].presentation.image,true);assert.deepEqual(result[0].sections[1].presentation,off());assert.deepEqual(result[0].presentation,off());
});

test('fallback density is bounded across a long outline rather than selecting every format in every leaf',()=>{
 const input=Array.from({length:40},(_,index)=>leaf('large-'+index,'变量比较与技术路线、数学公式和算法实现 '+index,{targetWords:1500})),result=applyOutlinePresentationRecommendations(input,{...computing,profile:{...computing.profile,targetWords:60000}}),caps={table:8,image:4,formula:6,code:4};
 for(const key of keys){assert.ok(count(result,key)>0,key+' should have useful candidates');assert.ok(count(result,key)<=caps[key],key+' fallback cap');}for(const row of result)assert.ok(keys.filter(key=>row.presentation[key]).length<=2);assert.ok(result.some(row=>keys.every(key=>!row.presentation[key])));assert.equal(input.some(row=>row.presentation!==undefined),false);
});

test('small leaf budgets allow fewer defaults and do not remove previously selected permissions to meet caps',()=>{
 const short=applyOutlinePresentationRecommendations([leaf('short-but-valid','变量比较与技术路线、指标公式和算法实现',{targetWords:300})],{...computing,profile:{...computing.profile,targetWords:500}});assert.equal(keys.filter(key=>short[0].presentation[key]).length,1);
 const explicit=Array.from({length:12},(_,index)=>leaf('chosen-'+index,'本人明确选中的流程图 '+index,{presentation:{image:true}})),extra=Array.from({length:8},(_,index)=>leaf('unselected-'+index,'研究流程 '+index)),result=applyOutlinePresentationRecommendations([...explicit,...extra],computing);for(let index=0;index<explicit.length;index++)assert.equal(result[index].presentation.image,true);assert.ok(result.slice(explicit.length).every(row=>!row.presentation.image));assert.equal(count(result,'image'),12,'Existing choices are not cut down to the fallback cap');
});

test('invalid explicit values fail conservatively without throwing, truthy coercion or extra permissions',()=>{
 const invalid=[null,[],true,'true',{table:'true',image:1,formula:null,code:[]},{unknown:true},{table:true,extra:'ignored'}],input=invalid.map((presentation,index)=>leaf('invalid-'+index,'算法流程与公式对比',{presentation})),result=applyOutlinePresentationRecommendations(input,computing);
 for(let index=0;index<invalid.length-1;index++)assert.deepEqual(result[index].presentation,off());assert.deepEqual(result.at(-1).presentation,{...off(),table:true});assert.deepEqual(Object.keys(result.at(-1).presentation),keys);assert.doesNotThrow(()=>applyOutlinePresentationRecommendations(input,null));assert.deepEqual(applyOutlinePresentationRecommendations(null),[]);
});

test('repeated explicit assignment is deterministic and cannot undo a user turning a recommended element off',()=>{
 const input=[leaf('route','研究流程'),leaf('comparison','概念比较'),leaf('formula','数学公式推导')],first=applyOutlinePresentationRecommendations(input,computing),again=applyOutlinePresentationRecommendations(first,computing);assert.deepEqual(again,first);assert.notEqual(again,first);const chosen=first.find(row=>row.presentation.image);assert.ok(chosen);chosen.presentation=off();const revised=applyOutlinePresentationRecommendations(first,computing);assert.deepEqual(revised.find(row=>row.id===chosen.id).presentation,off());assert.deepEqual(input.map(row=>row.targetWords),[800,800,800]);assert.equal(input.some(row=>row.presentation!==undefined),false);
});
