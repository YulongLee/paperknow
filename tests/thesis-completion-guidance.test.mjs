import test from 'node:test';
import assert from 'node:assert/strict';
import {completionDiagnosis,withCompletionDiagnosis,completionResolutions} from '../backend/thesis-completion-guidance.mjs';
import {completionPanelHTML,createCompletionDraft,completionProgressText} from '../dist/workspace/thesis-completion-panel.mjs';
import {completionReviewPanel} from '../dist/workspace/thesis-completion-review.mjs';
const chapters=[{id:'a',title:'分析'},{id:'b',title:'分析'}],report={phase:'materials',coverage:{total:2,checked:2,complete:true},items:[{id:'check-0-0',title:'分析',status:'sufficient',requirement:'已有依据',reason:'已提供',missing:[]},{id:'check-1-0',title:'分析',status:'missing',requirement:'补写解释',reason:'未说明',missing:['补写第二章对照解释']}]};
test('current diagnosis is chapter-bound even with repeated titles and never mutates the authorized plan',()=>{
 const diagnosis=completionDiagnosis(report,chapters),unit={chapterId:'a',completion:{missingInformation:['已有缺项']}};
 assert.deepEqual(withCompletionDiagnosis(unit,diagnosis).completion.missingInformation,['已有缺项']);assert.deepEqual(unit.completion,{missingInformation:['已有缺项']});
 assert.ok(withCompletionDiagnosis({chapterId:'b',completion:{}},diagnosis).completion.missingInformation.includes('补写第二章对照解释'));
 assert.equal(completionDiagnosis({...report,items:[{...report.items[0],id:'check-999-0'}]},chapters).items.length,0);
});
test('gap resolutions require a current completed final check and cannot treat author confirmation as evidence',()=>{
 const diagnosis=completionDiagnosis(report,chapters),final={...report,phase:'final',items:report.items.map(row=>({...row,status:'not_required',missing:[]}))};
 assert.equal(completionResolutions(diagnosis,final,chapters,{current:true}).items[1].resolution,'resolved');
 for(const [value,current]of [[final,false],[{...final,phase:'materials'},true],[{...final,coverage:{complete:false}},true]])assert.equal(completionResolutions(diagnosis,value,chapters,{current}).items[1].resolution,'pending');
 const unresolved=completionResolutions(diagnosis,{...report,phase:'final'},chapters,{current:true});assert.equal(unresolved.items[1].resolution,'needs_materials');assert.ok(unresolved.items[1].remaining.includes('补写第二章对照解释'));
 const markup=completionReviewPanel({status:'needs_materials',diagnosis:unresolved,checks:{},missing:['真实记录'],changes:[]});assert.match(markup,/AI审查与补齐结果/);assert.match(markup,/需补充事实资料/);assert.doesNotMatch(markup,/data-completion-confirm(?:\s|>)/);
});
test('normal final writing offers a whole-manuscript primary action without a simulation generator, while retaining legacy recovery',()=>{
 const draft=createCompletionDraft(),item={snapshot:{requirements:{}},chapters:[{id:'a',title:'方法',text:'已有初稿'}]};
 const markup=completionPanelHTML(item,draft,{guided:true,embedded:true,showCover:false,showReview:false});
 assert.match(markup,/AI 审查并自动补齐/);assert.doesNotMatch(markup,/data-simulation-generate|生成仿真数据/);assert.ok(markup.indexOf('data-completion-prepare')<markup.indexOf('data-completion-field="supplement"'));
 const legacy=completionPanelHTML({...item,simulationRecovery:{id:'old',title:'已有结果',sampleSize:60}},draft,{guided:true});assert.match(legacy,/data-simulation-restore/);assert.doesNotMatch(legacy,/data-simulation-generate/);
 assert.match(completionProgressText({job:{status:'running',purpose:'completion',stage:'reviewing_draft'}}),/审查初稿/);
});
