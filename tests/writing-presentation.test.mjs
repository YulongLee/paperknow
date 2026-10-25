import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWritingSnapshot,writingPlan,writingTask,parseWritingOutput,validateWritingCandidate} from '../backend/writing-model.mjs';
import {flowOutlineRows,flowRecommendOutline,writingFlowSnapshot,migrateWritingFlow} from '../dist/workspace/writing-flow-model.mjs';
import {researchWordCount} from '../backend/text-length.mjs';
const flags={table:true,image:true,formula:true,code:true},none={table:false,image:false,formula:false,code:false};
const figure=()=>({id:'flow',title:'拟开展的方法流程',kind:'flowchart',nodes:[{id:'a',label:'整理研究问题'},{id:'b',label:'拟比较与验证'}],edges:[{from:'a',to:'b'}],caption:'方案示意，尚未开展真实验证。'});
const make=(extra={})=>normalizeWritingSnapshot({title:'算法参数对比与研究方案',profile:{level:'本科',major:'计算机',language:'中文',targetWords:1000},requirements:{contentMode:'rich'},materials:[],references:[],outline:[{id:'a',title:'算法设计与参数比较',targetWords:500,presentation:flags},{id:'b',title:'局限与结论',targetWords:500,presentation:none}],...extra});
const respond=body=>({text:JSON.stringify({complete:true,source_ids:[],missing_evidence:[],...body})});
function candidate(unit,extra=''){return {text:'研'.repeat(Math.max(0,unit.targetWords-researchWordCount(extra)))+extra};}

for(const kind of ['article','proposal','summary','course','practice','quick','taskbook'])test(kind+' carries the selected chapter forms into the actual generation contract',()=>{
 const snapshot=make();if(kind==='summary')snapshot.materials=[{id:'source',name:'用户摘要',text:'可读摘要与论证边界。'.repeat(15),confirmed:true}];
 const plan=writingPlan(snapshot,'draft'),first=writingTask(kind,'draft',snapshot,plan[0]),second=writingTask(kind,'draft',snapshot,plan[1]);assert.deepEqual(first.context.presentation,flags);assert.equal(first.context.figureContract.allowed,true);assert.match(first.instructions,/figures 数组/);assert.deepEqual(second.context.presentation,none);assert.equal(second.context.figureContract.allowed,false);assert.match(second.instructions,/本节未开启任何扩展项目/);
});

test('selected tables, math, code and figures validate together and retain stable namespaced image references',()=>{
 const snapshot=make(),unit=writingPlan(snapshot,'draft')[0],extra='\n\n| 参数 | 说明 |\n| --- | --- |\n| k | 待确定 |\n\n$$x = y$$\n\n```python\nk = 1\n```\n\n[figure:flow]\n',body={...candidate(unit,extra),figures:[figure()]},result=respond(body),parsed=parseWritingOutput(result,'article','draft',snapshot,unit);
 assert.equal(parsed.figures.length,1);assert.match(parsed.figures[0].id,/^fig-[a-f0-9]{20}$/);assert.ok(parsed.text.includes('[figure:'+parsed.figures[0].id+']'));assert.equal(parsed.wordCount,500);assert.equal(validateWritingCandidate(result,'article','draft',snapshot,unit).valid,true);assert.deepEqual(parseWritingOutput(result,'article','draft',snapshot,unit),parsed);
});

for(const [key,extra]of [['table','\n| 指标 | 说明 |\n| --- | --- |\n| k | 定义 |'],['formula','\n$$x=y$$'],['code','\n```python\nx=1\n```'],['image','\n[figure:flow]\n']])test('turning off '+key+' rejects unauthorized output without granting sibling permissions',()=>{
 const snapshot=make(),unit=writingPlan(snapshot,'draft')[1],body={...candidate(unit,extra),...(key==='image'?{figures:[figure()]}:{})};assert.throws(()=>parseWritingOutput(respond(body),'article','draft',snapshot,unit),error=>error.code==='presentation_not_selected');
});

test('plain text, reference chapters, malformed diagrams and later split parts cannot acquire image permissions',()=>{
 const plain=make({requirements:{contentMode:'text'}});assert.deepEqual(writingTask('article','draft',plain,writingPlan(plain,'draft')[0]).context.presentation,none);
 const snapshot=make({profile:{level:'本科',language:'中文',targetWords:3000},outline:[{id:'a',title:'研究设计',targetWords:3000,presentation:flags},{id:'refs',title:'参考文献',presentation:flags}]}),plan=writingPlan(snapshot,'draft');assert.equal(plan.length,3);assert.ok(plan.every(row=>row.chapterId==='a'));assert.equal(writingTask('article','draft',snapshot,plan[1]).context.figureContract.allowed,false);
 const broken=figure();broken.edges=[{from:'a',to:'unknown'}];assert.throws(()=>parseWritingOutput(respond({...candidate(plan[0],'\n[figure:flow]\n'),figures:[broken]}),'article','draft',snapshot,plan[0]),error=>error.code==='invalid_figure');
});

test('short articles enforce separate image contracts and identities for each batched section',()=>{
 const snapshot=make({profile:{level:'本科',language:'中文',targetWords:400},outline:[{id:'a',title:'研究设计',targetWords:200,presentation:flags},{id:'b',title:'讨论',targetWords:200,presentation:none}]}),unit=writingPlan(snapshot,'draft')[0],task=writingTask('article','draft',snapshot,unit),body={sections:unit.sections.map((row,index)=>({id:row.id,...candidate(row,index?'':'\n[figure:flow]\n'),source_ids:[],figures:index?[]:[figure()]}))};assert.ok(unit.batch);assert.equal(task.context.presentationBySection[0].figureContract.allowed,true);assert.equal(task.context.presentationBySection[1].figureContract.allowed,false);assert.ok(task.instructions.length<12000);const output=parseWritingOutput(respond(body),'article','draft',snapshot,unit);assert.equal(output.figures.length,1);assert.equal(output.sections[0].figures[0].id,output.figures[0].id);body.sections[1].text+='\n[figure:flow]\n';body.sections[1].figures=[figure()];assert.throws(()=>parseWritingOutput(respond(body),'article','draft',snapshot,unit),error=>error.code==='presentation_not_selected');
});

test('flow snapshots retain recommendations and explicit opt-outs while old snapshots stay stable',()=>{
 const old={version:1,title:'旧研究',targetWords:1000,outline:[{id:'a',title:'比较方法',targetWords:1000}]},migrated=migrateWritingFlow('article',{writingFlow:old});assert.equal(writingFlowSnapshot('article',migrated).requirements.contentMode,undefined);
 const outline=flowRecommendOutline([{id:'a',title:'参数比较',targetWords:1000},{id:'b',title:'算法实现',targetWords:1000},{id:'r',title:'参考文献',kind:'references',presentation:flags}],{title:'计算机算法研究',profile:{major:'计算机',targetWords:2000}});assert.ok(outline[0].presentation.table);assert.ok(outline[1].presentation.code);assert.deepEqual(outline[2].presentation,none);
 const stopped=flowRecommendOutline([{id:'a',title:'参数比较',targetWords:1000,presentation:none}],{profile:{targetWords:1000}});assert.deepEqual(stopped[0].presentation,none);const snap=writingFlowSnapshot('article',{title:'用户确认的研究',targetWords:2000,contentMode:'rich',outline});assert.equal(snap.outline[0].presentation.table,true);assert.equal(normalizeWritingSnapshot(snap).outline[0].presentation.table,true);
 const nested=flowOutlineRows([{id:'a',title:'研究方法',sections:[{title:'参数比较',presentation:{table:true}},{title:'模型设计',presentation:{formula:true}}],presentation:none}]);assert.equal(nested[0].presentation.table,true);assert.equal(nested[0].presentation.formula,true);
});
