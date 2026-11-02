import test from 'node:test';
import assert from 'node:assert/strict';
import {assertExpressionRepairUnchanged} from '../backend/thesis-expression-repair.mjs';
import {completionRepairs} from '../backend/thesis-completion-repair.mjs';
import {normalizeThesisSnapshot,thesisAgentTask} from '../backend/thesis-model.mjs';
import {completionPanelHTML,createCompletionDraft} from '../dist/workspace/thesis-completion-panel.mjs';
import {completionReviewPanel} from '../dist/workspace/thesis-completion-review.mjs';
const source='合成测试资料，记录了限定场景下的研究方法，不代表真实实验。'.repeat(10);
const value=()=>normalizeThesisSnapshot({title:'合成研究',profile:{level:'本科',language:'中文',targetWords:500},requirements:{deliveryVersion:1},materials:[{id:'m',name:'已知研究资料',text:source,confirmed:true}],references:[],outline:[{id:'c',title:'方法与分析',targetWords:500}]});
test('expression repair changes prose while preserving data, citations, math, code, tables and unresolved facts',()=>{
 const text='显而易见，本节讨论 60 条记录和 92.5% 的模拟比例。[source:m]\n【待补充：真实部署记录】\n$$x=1+2$$\n```python\nx=3\n```\n|组别|数量|\n|A|60|',checkpoint={text,figures:'[]'},fixed=text.replace('显而易见，本节讨论','本节仅分析');assert.doesNotThrow(()=>assertExpressionRepairUnchanged(checkpoint,{text:fixed,figures:[]}));
 for(const candidate of [text,fixed.replace('60','80'),fixed.replace('[source:m]','[source:other]'),fixed.replace('【待补充：真实部署记录】',''),fixed.replace('x=1+2','x=2+1'),fixed.replace('x=3','x=4'),fixed.replace('|A|60|','|B|60|')])assert.throws(()=>assertExpressionRepairUnchanged(checkpoint,{text:candidate,figures:[]}));
});
test('an incomplete materials check still allows grounded expression fixes without permitting missing-fact completion',()=>{
 const snapshot=value(),unit={id:'u',chapterId:'c',chapterTitle:'方法与分析',title:'方法与分析',targetWords:500,part:1,parts:1,presentation:{},completion:{scope:'full'}},text='显而易见，现有资料限定了本节的分析范围。【待补充：真实部署记录】',checkpoint={unit_id:'u',text,trace:'[]',figures:'[]'},quality={consistency:{findings:[{sectionId:'c',quote:'显而易见，现有资料限定了本节的分析范围。',category:'language_expression',severity:'info'},{sectionId:'c',quote:'【待补充：真实部署记录】',category:'unresolved_placeholder'}]},completionAudit:{issues:[{code:'unresolved_placeholders'}]},supplementCheck:{status:'unavailable',coverage:{complete:false}}};
 const repairs=completionRepairs(snapshot,[unit],[checkpoint],quality,0,{expressionOnly:true});assert.equal(repairs.length,1);assert.equal(repairs[0].expressionOnly,true);assert.deepEqual(repairs[0].task.context.revision.findings.map(row=>row.category),['language_expression']);assert.match(repairs[0].task.instructions,/直接将修正写入完整正文/);assert.match(repairs[0].task.instructions,/不补造资料/);
});
test('automatic writing receives the actual missing items instead of just a generic simulation request',()=>{
 const snapshot=value(),unit={id:'u',chapterId:'c',chapterTitle:'方法与分析',title:'方法与分析',targetWords:500,part:1,parts:1,presentation:{},completion:{scope:'full',originalText:'方法依据与分析说明尚待完善。',missingInformation:['本节的文献依据','已有模拟结果的分析说明']}};
 const task=thesisAgentTask(snapshot,unit,[]);assert.deepEqual(task.context.revision.missingInformation,unit.completion.missingInformation);assert.match(task.instructions,/逐项处理/);assert.match(task.instructions,/直接写入正文/);assert.match(task.instructions,/身份、真实实施记录及实测结果没有依据时，不得编造/);
});
test('expression editing receives the complete writing unit instead of silently omitting its ending',()=>{
 const snapshot=value(),text='Synthetic technical discussion. '.repeat(600)+'This ending must remain available for expression correction.',unit={id:'u',chapterId:'c',sectionId:'s',chapterTitle:'方法与分析',title:'方法与分析',targetWords:1800,part:1,parts:1,presentation:{},completion:{scope:'full'}},checkpoint={unit_id:'u',text,trace:'[]',figures:'[]'},quality={reviews:[{findings:[{sectionId:'c',category:'language_expression',quote:'This ending must remain available for expression correction.'}]}]};const [repair]=completionRepairs(snapshot,[unit],[checkpoint],quality,0,{expressionOnly:true});assert.equal(repair.task.context.revision.originalExcerpt,text);assert.equal(repair.task.context.revision.excerpted,false);assert.equal(repair.task.context.outline.length,1);
});
test('completion UI makes gap filling primary and keeps numeric simulation as a distinct secondary function',()=>{
 const snapshot=value(),item={snapshot,profile:snapshot.profile,chapters:[{id:'c',title:'方法与分析',text:'已有论述。【待补充：文献依据】'}]},markup=completionPanelHTML(item,createCompletionDraft());assert.match(markup,/AI自动补充缺失内容/);assert.match(markup,/AI自动补充并检查/);assert.match(markup,/仿真研究数据/);assert.match(markup,/生成仿真数据/);assert.doesNotMatch(markup,/AI模拟数据补充/);assert.equal((markup.match(/data-completion-prepare/g)||[]).length,1);
});
test('legacy expression advice cannot be displayed as a completed correction or approved final result',()=>{
 const markup=completionReviewPanel({status:'ready',changes:[],suggestions:[{title:'方法与分析',text:'需要直接修正的原句'}],checks:{materials:true,manuscript:true,content:true}});assert.doesNotMatch(markup,/表达建议（供确认时参考）|data-completion-confirm(?:\s|>)/);assert.match(markup,/待自动修正的表达问题/);
});
