import test from 'node:test';
import assert from 'node:assert/strict';
import {completionDiagnosisPanel,completionMissingPresentation,completionReviewPanel} from '../dist/workspace/thesis-completion-review.mjs';
const missing='参考文献：无DOI/URL核验记录',claim='第二章：核对实验记录';
const review={reportCurrent:true,status:'needs_materials',missing:[missing,missing,claim],issues:[],checks:{},changes:[]};
const quality={stale:false,citations:{items:[{id:'r1',metadataStatus:'conflict'},{id:'r2',metadataStatus:'not_found'},{id:'r3',metadataStatus:'unverified'}]},supplementCheck:{items:[{title:'第二章',status:'missing',missing:['核对实验记录'],manuscriptQuote:'需要核对的原句'}]}};
const chapters=[{id:'c2',title:'第二章',text:'前文。需要核对的原句。'}],references=[{id:'r1',title:'A <危险>'},{id:'r2',title:'B'},{id:'r3',title:'C'}];
test('existing citation verification is displayed truthfully without removing the blocking status',()=>{
 const v=completionMissingPresentation(review,{quality,chapters,references});assert.equal(v.rows.length,2);assert.match(v.rows[0].text,/已有题录核验结果/);assert.deepEqual(v.citationRows.map(x=>x.status),['字段不一致','本次未查到','待核验']);assert.match(v.rows[1].quote,/前文。需要核对的原句。/);assert.equal(v.rows[1].chapterId,'c2');
 const html=completionReviewPanel(review,{quality,chapters,references});assert.match(html,/需要核对的原句/);assert.match(html,/data-completion-view="c2"/);assert.match(html,/A &lt;危险&gt;/);assert.doesNotMatch(html,/确认补充内容，编排并导出终稿/);assert.match(html,/文献对正文论断的支持/);
});
test('stale or unavailable verification never claims a current citation check',()=>{
 for(const q of [{...quality,stale:true},{citations:{items:[{id:'r3',metadataStatus:'unverified'}]}}]){const v=completionMissingPresentation(review,{quality:q,chapters,references});assert.equal(v.rows[0].text,missing);assert.equal(v.citationRows.length,0);}
 const v=completionMissingPresentation({...review,reportCurrent:false},{quality,chapters,references});assert.equal(v.rows[0].text,missing);assert.equal(v.citationRows.length,0);
});
test('distinct genuinely pending citation requirements are not collapsed or hidden',()=>{
 const a='参考文献：9条参考文献的DOI/URL结构化核验记录',b='参考文献：期刊卷期页待核对',v=completionMissingPresentation({...review,missing:[a,b]},{quality,chapters,references});assert.deepEqual(v.rows.map(row=>row.text),[a,b]);assert.ok(v.citationRows.length);
});
test('ambiguous or missing chapter quotes are not fabricated as locations',()=>{
 const v=completionMissingPresentation(review,{quality,chapters:[...chapters,{id:'other',title:'第二章',text:'需要核对的原句'}],references});assert.equal(v.rows[1].quote,'');assert.equal(v.rows[1].chapterId,null);
 const v2=completionMissingPresentation(review,{quality,chapters:[{...chapters[0],text:'不同正文'}],references});assert.equal(v2.rows[1].quote,'');
});
test('initial incomplete diagnosis is distinguished from final review and deduplicated',()=>{
 const row={chapterId:'c',title:'第一章',status:'missing',missing:['需核对'],resolution:'pending'},html=completionDiagnosisPanel({status:'unavailable',items:[row,row],coverage:{checked:2}});assert.match(html,/初稿部分内容未完成审查，本版请以最终检查为准/);assert.match(html,/发现 1 项缺项/);
});


test('source markers are user-friendly without changing unique chapter navigation or leaking markup',()=>{
 const quote='irst fold records 29 samples. [source:r1]';const text='The first fold records 29 samples. [source:r1] It was checked.';
 const q={supplementCheck:{items:[{title:'Abstract',status:'missing',missing:['核对 [source:r1]'],manuscriptQuote:quote}]}};
 const r={status:'needs_materials',reportCurrent:true,checks:{},changes:[],missing:['Abstract：核对 [source:r1]'],issues:[],billingStatus:'settled'};
 const html=completionReviewPanel(r,{quality:q,chapters:[{id:'chapter-1',title:'Abstract',text}],references:[{id:'r1',title:'Source <A>'}]});
 assert.doesNotMatch(html,/\[source:/);assert.match(html,/文献：Source &lt;A&gt;/);assert.match(html,/The first fold records/);assert.match(html,/data-completion-view="chapter-1"/);assert.match(html,/费用已结算/);assert.equal(text,'The first fold records 29 samples. [source:r1] It was checked.');
});

test('all displayed billing states use only the authoritative status',()=>{
 const base={status:'needs_materials',checks:{},missing:[],changes:[]};
 assert.match(completionReviewPanel({...base,billingStatus:'released'}),/未扣积分或套餐次数/);
 assert.match(completionReviewPanel({...base,billingStatus:'held'}),/费用正在处理中/);
 assert.doesNotMatch(completionReviewPanel(base),/未扣积分|费用已结算/);
});

test('incomplete source token in the report never leaks its internal ID',async()=>{
 const {supplementCheckPanel}=await import('../dist/workspace/supplement-check-panel.mjs');const report={items:[{title:'第五章',status:'missing',requirement:'核对',reason:'核对 [source:secret-id]',missing:['位置 [source:secret-id；若为模拟案例，请确认。'],evidence:[{name:'材料',quote:'原文 [source:material:private]'}]}]};
 const html=supplementCheckPanel(report);assert.doesNotMatch(html,/secret-id|material:private|\[source:/);assert.match(html,/来源信息/);assert.match(html,/研究资料/);assert.match(html,/若为模拟案例，请确认。/);assert.match(html,/请核对或补充/);
});


test('a truncated duplicate in the missing instruction is replaced only when actual unique context is available',()=>{
 const detail='核对该句的模型、数据范围与数值：irst fold produ',full='The first fold produced 29 test records and is the first split.';
 const r={reportCurrent:true,status:'needs_materials',missing:['Abstract：'+detail],issues:[],checks:{},changes:[]},q={supplementCheck:{items:[{status:'missing',title:'Abstract',missing:[detail],manuscriptQuote:'irst fold produ'}]}};
 const good=completionReviewPanel(r,{quality:q,chapters:[{id:'c',title:'Abstract',text:full}]});assert.match(good,/请查看下方原文/);assert.match(good,/The first fold produced 29 test records/);assert.doesNotMatch(good,/数值：irst fold produ/);
 const bad=completionReviewPanel(r,{quality:q,chapters:[{id:'c',title:'Abstract',text:'unrelated'}]});assert.match(bad,/数值：irst fold produ/);assert.doesNotMatch(bad,/请查看下方原文/);
});
