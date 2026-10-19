import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWritingSnapshot,writingPlan,writingLengthFeedback,validateWritingCandidate} from '../backend/writing-model.mjs';

const snapshot=language=>normalizeWritingSnapshot({title:'阅读服务证据综述',profile:{level:'本科',language,targetWords:600},materials:[{id:'source',name:'已确认资料',text:'此为用户确认的可读研究材料，包含明确研究范围与研究局限。',confirmed:true}],references:[],outline:[{id:'section',title:'研究证据与边界',targetWords:600}]});
const candidate=text=>({text:JSON.stringify({complete:true,text,source_ids:['source'],missing_evidence:[]}),trace:[{tool:'read_material',status:'completed',materialId:'source'}]});

test('overlong feedback computes a concrete one-revision target and reduction ratio from the same submitted prose',()=>{
 const value=snapshot('中文'),unit=writingPlan(value,'draft')[0],output=candidate('研'.repeat(1382)+'[source:source]'),feedback=writingLengthFeedback(output,value,unit);
 assert.equal(feedback.count,1382);assert.equal(feedback.target,600);assert.equal(feedback.min,480);assert.equal(feedback.max,720);
 assert.equal(feedback.revisionTarget,600);assert.equal(feedback.nextTarget,600);assert.equal(feedback.retainRatio,.4342);assert.equal(feedback.removeAtLeast,662);assert.equal(feedback.removeToTarget,782);
 assert.match(feedback.rule,/43.4%/);assert.match(feedback.rule,/不逐句保留原稿细节/);assert.match(feedback.rule,/必要证据及 \[source:ID\]/);assert.match(feedback.rule,/不能为凑篇幅删掉必要引用、补入未知事实/);
 const rejected=validateWritingCandidate(output,'summary','draft',value,unit);assert.equal(rejected.valid,false);assert.equal(rejected.feedback.retainRatio,.4342);assert.deepEqual(rejected.feedback.allowedAlreadyReadSourceIds,['source']);
});

test('short feedback provides both minimum addition and an interior target without inventing material or dividing by zero',()=>{
 const value=snapshot('中文'),unit=writingPlan(value,'draft')[0],feedback=writingLengthFeedback(candidate('研'.repeat(400)+'[source:source]'),value,unit);
 assert.equal(feedback.expandRatio,1.5);assert.equal(feedback.requiredAdditional,80);assert.equal(feedback.additionalToTarget,200);assert.equal(feedback.nextTarget,600);assert.equal(feedback.revisionTarget,600);
 assert.match(feedback.rule,/已读证据/);assert.match(feedback.rule,/保持未完成，不能编造结果/);
 const empty=writingLengthFeedback(candidate(''),value,unit);assert.equal(empty.expandRatio,null);assert.equal(empty.requiredAdditional,480);assert.equal(empty.additionalToTarget,600);assert.doesNotThrow(()=>JSON.stringify(empty));
});

test('concrete feedback uses language-aware counts and the entire structured short document, excluding source markers',()=>{
 const english=snapshot('English'),unit=writingPlan(english,'draft')[0],feedback=writingLengthFeedback(candidate('research '.repeat(900)+'[source:source]'),english,unit);
 assert.equal(feedback.count,900);assert.equal(feedback.retainRatio,.6667);assert.equal(feedback.removeAtLeast,180);
 const chinese=snapshot('中文'),batch={...writingPlan(chinese,'draft')[0],batch:true},result={text:JSON.stringify({sections:[{text:'研'.repeat(700)+'[source:source]'},{text:'究'.repeat(682)}]})};
 assert.equal(writingLengthFeedback(result,chinese,batch).count,1382);assert.equal(writingLengthFeedback(result,chinese,batch).revisionTarget,600);
 assert.equal(writingLengthFeedback({text:'invalid'},chinese,batch),null);assert.equal(writingLengthFeedback({text:'{}'},chinese,batch),null);
});

test('the original actual-prose acceptance boundaries remain strict and unchanged',()=>{
 const value=snapshot('中文'),unit=writingPlan(value,'draft')[0];
 for(const count of [480,600,720]){const result=validateWritingCandidate(candidate('研'.repeat(count)+'[source:source]'),'summary','draft',value,unit);assert.equal(result.valid,true,String(count));assert.equal(result.length.withinRange,true);assert.equal(result.length.retainRatio,undefined);assert.equal(result.length.expandRatio,undefined);}
 for(const count of [479,721]){const result=validateWritingCandidate(candidate('研'.repeat(count)+'[source:source]'),'summary','draft',value,unit);assert.equal(result.valid,false,String(count));assert.equal(result.feedback.count,count);assert.equal(result.feedback.min,480);assert.equal(result.feedback.max,720);}
});

test('one overlong rejection includes missing actual-read citations without changing its primary length statistics',()=>{
 const value=snapshot('中文'),unit=writingPlan(value,'draft')[0],output={text:JSON.stringify({complete:true,text:'研'.repeat(1382),source_ids:[],missing_evidence:[]}),trace:[]},before=structuredClone(output),rejected=validateWritingCandidate(output,'proposal','draft',value,unit);
 assert.equal(rejected.valid,false);assert.equal(rejected.feedback.code,'word_limit');assert.equal(rejected.feedback.count,1382);assert.equal(rejected.feedback.retainRatio,.4342);assert.equal(rejected.feedback.min,480);assert.equal(rejected.feedback.max,720);
 const sources=rejected.feedback.source_attribution;assert.equal(sources.code,'source_attribution');assert.equal(sources.field,'source_ids');assert.deepEqual(sources.requiredSourceIds,['source']);assert.equal(sources.minimumRequiredCitations,1);assert.equal(sources.missingRequiredCitation,true);assert.deepEqual(sources.allowedAlreadyReadSourceIds,[]);assert.deepEqual(sources.unmarkedSourceIds,[]);assert.deepEqual(sources.unlistedMarkerIds,[]);assert.match(sources.rule,/read_material/);assert.match(rejected.feedback.rule,/source_attribution/);assert.match(rejected.feedback.rule,/一次同时修正篇幅与/);assert.doesNotMatch(JSON.stringify(sources),/包含明确研究范围与研究局限/);assert.deepEqual(output,before);
 const corrected=validateWritingCandidate(candidate('研'.repeat(600)+'[source:source]'),'proposal','draft',value,unit);assert.equal(corrected.valid,true);assert.equal(corrected.length.count,600);
});

test('one short rejection reports read-but-unmarked source IDs together with its original expansion target',()=>{
 const value=snapshot('中文'),unit=writingPlan(value,'draft')[0],rejected=validateWritingCandidate(candidate('研'.repeat(400)),'proposal','draft',value,unit);
 assert.equal(rejected.valid,false);assert.equal(rejected.feedback.code,'word_limit');assert.equal(rejected.feedback.count,400);assert.equal(rejected.feedback.expandRatio,1.5);assert.equal(rejected.feedback.requiredAdditional,80);assert.equal(rejected.feedback.additionalToTarget,200);
 const sources=rejected.feedback.source_attribution;assert.equal(sources.code,'source_attribution');assert.equal(sources.missingRequiredCitation,true);assert.deepEqual(sources.allowedAlreadyReadSourceIds,['source']);assert.deepEqual(sources.unmarkedSourceIds,['source']);assert.deepEqual(sources.unlistedMarkerIds,[]);assert.match(rejected.feedback.rule,/一次同时修正篇幅与/);
});

test('length-only failures attach no source problem when actual reads and citation sets are already valid',()=>{
 const value=snapshot('中文'),unit=writingPlan(value,'draft')[0];for(const words of [400,1382]){const rejected=validateWritingCandidate(candidate('研'.repeat(words)+'[source:source]'),'proposal','draft',value,unit);assert.equal(rejected.valid,false);assert.equal(rejected.feedback.code,'word_limit');assert.equal(rejected.feedback.count,words);assert.equal(Object.hasOwn(rejected.feedback,'source_attribution'),false);}
 const conceptual=normalizeWritingSnapshot({title:'仅拟开展的概念计划',profile:{targetWords:600},materials:[],references:[{id:'metadata',title:'只有题录不代表可读全文',confirmed:true}],outline:[{id:'plan',title:'研究计划',targetWords:600}]}),plain={text:JSON.stringify({complete:true,text:'研'.repeat(1382),source_ids:[],missing_evidence:[]}),trace:[]},rejected=validateWritingCandidate(plain,'proposal','draft',conceptual,writingPlan(conceptual,'draft')[0]);assert.equal(rejected.feedback.code,'word_limit');assert.equal(Object.hasOwn(rejected.feedback,'source_attribution'),false);
});

test('unknown or unread sources keep primary attribution priority regardless of an otherwise invalid word count',()=>{
 const value=snapshot('中文'),unit=writingPlan(value,'draft')[0];for(const words of [400,1382])for(const id of ['source','invented']){const output={text:JSON.stringify({complete:true,text:'研'.repeat(words)+'[source:'+id+']',source_ids:[id],missing_evidence:[]}),trace:[]},rejected=validateWritingCandidate(output,'proposal','draft',value,unit);assert.equal(rejected.valid,false);assert.equal(rejected.feedback.code,'source_attribution');assert.equal(Object.hasOwn(rejected.feedback,'source_attribution'),false);assert.equal(rejected.feedback.count,undefined);assert.deepEqual(rejected.feedback.allowedAlreadyReadSourceIds,[]);}
});
