import test from 'node:test';
import assert from 'node:assert/strict';
import {supplementCheckTask,parseSupplementCheck} from '../backend/supplement-check.mjs';
const response=item=>({text:JSON.stringify({items:[item]})});
test('a numerical grid endpoint cannot be called off-boundary; other gaps are not silently cleared',()=>{
 const text='所选模型参数处于网格边界，另有数值待核对。',source='邻居数搜索3、5、7，权重搜索uniform、distance。',task=supplementCheckTask({phase:'final',chapters:[{id:'c',title:'摘要',text}],materials:[{id:'m',name:'参数记录',text:source}]});
 const row={id:'c',status:'missing',requirement:'核对结果',reason:'选定值未在网格边界，仍有数据待核对',manuscriptQuote:text,evidence:[{sourceId:'m',quote:source}],missing:['KNN取7（网格3、5、7）需改正','另有测试指标需要核对']};
 assert.throws(()=>parseSupplementCheck(response(row),task),error=>error.feedback?.field==='items[0].missing');
 const valid={...row,reason:'仍有测试指标待核对',missing:['另有测试指标需要核对']};assert.equal(parseSupplementCheck(response(valid),task)[0].status,'missing');
});
test('separate batch cannot claim user failed to provide other chapters while real missing facts remain',()=>{
 const text='当前资料需核查。',task=supplementCheckTask({phase:'final',chapters:[{id:'c',title:'参考文献',text}],materials:[]});task.context.documentScope={batchOnly:true,totalChapters:3};
 const row={id:'c',status:'missing',requirement:'资料',reason:'当前批次需核查',manuscriptQuote:text,evidence:[],missing:['正文各章引用标记不在本批章节，无法核对','真正缺少的 DOI']};
 assert.throws(()=>parseSupplementCheck(response(row),task),error=>error.feedback?.field==='items[0].missing');assert.equal(parseSupplementCheck(response({...row,missing:['真正缺少的 DOI']}),task)[0].status,'missing');
});
