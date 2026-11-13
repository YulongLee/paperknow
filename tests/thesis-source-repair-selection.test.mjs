import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeThesisSnapshot} from '../backend/thesis-model.mjs';
import {completionRepairs} from '../backend/thesis-completion-repair.mjs';
const source='这里说明相关模型的基本原理与其适用范围，不能证明真实实验效果。';
const snapshot=normalizeThesisSnapshot({title:'合成研究',profile:{level:'本科',language:'中文',targetWords:500},requirements:{},materials:[],references:[{id:'r1',title:'测试来源',authors:'测试作者',year:'2024',confirmed:true,text:source}],outline:[{id:'c',title:'研究内容',targetWords:500}]});
const unit={id:'u',chapterId:'c',chapterTitle:'研究内容',title:'研究内容',targetWords:500,part:1,parts:1,presentation:{},completion:{scope:'full'}};
const quote='该文献证明模型适用于所有情境。[source:r1]',checkpoint={unit_id:'u',text:'前文。'+quote+'后文。',trace:'[]',figures:'[]',source_ids:'["r1"]',missing_evidence:'[]'};
const quality=(severity,status='final_ready')=>({coverage:{complete:true},supplementCheck:{coverage:{complete:true},status},reviews:[{findings:[{sectionId:'c',category:'source_support',severity,quote,explanation:'本项需按来源核对。'}]}]});
test('informational source observations never trigger mandatory automatic rewrite',()=>{assert.deepEqual(completionRepairs(snapshot,[unit],[checkpoint],quality('info'),0),[]);});
test('missing, partial or unavailable factual evidence does not trigger an unrelated source rewrite',()=>{for(const status of ['needs_materials','unavailable','checking'])assert.deepEqual(completionRepairs(snapshot,[unit],[checkpoint],quality('warning',status),0),[]);});
test('a source warning with complete factual review remains eligible for safe correction and subsequent review',()=>{const result=completionRepairs(snapshot,[unit],[checkpoint],quality('warning'),0);assert.equal(result.length,1);assert.equal(result[0].sourceSupport,true);});
test('a citation reattribution finding stays visible and never invokes an inapplicable same-source repair',()=>{
 for(const suggestion of ['将来源标记改为自设算例材料，或删除该处文献标记，由作者核对后确认。','把该结论的来源改为 material:other-record，或删去该处标记。','请改为引用 [source:r2] 的记录。','Replace the citation with the dataset record.','Remove the incorrect reference.']){const report=quality('warning');report.reviews[0].findings[0].suggestion=suggestion;const before=JSON.stringify(report);assert.deepEqual(completionRepairs(snapshot,[unit],[checkpoint],report,0),[],suggestion);assert.equal(JSON.stringify(report),before);assert.equal(report.reviews[0].findings[0].quote,quote);}
});
test('a claim revision under the original source remains eligible without silently changing a citation',()=>{const report=quality('warning');report.reviews[0].findings[0].suggestion='仅按当前来源的实际内容，缩小论断范围。';const result=completionRepairs(snapshot,[unit],[checkpoint],report,0);assert.equal(result.length,1);assert.equal(result[0].sourceSupport,true);assert.equal(result[0].task.context.sourceSupportSourceId,'r1');});
