import test from 'node:test';
import assert from 'node:assert/strict';
import {createRevision,editParagraph,acceptParagraph} from '../dist/workspace/revision-model.mjs';
import {countChars} from '../dist/precheck/engine.mjs';
import {normalizeRevisionComparison,compareRevisionDocument,revisionComparisonSnapshot} from '../dist/workspace/revision-comparison-model.mjs';
import {revisionAiSnapshot,applyRevisionAiOutput} from '../dist/workspace/revision-ai-model.mjs';

const overlapping='研究采用分层采样策略获取区域污染浓度变化数据，并据此分析城市交通活动对空气质量的影响。';
const unique='讨论部分另行说明样本覆盖范围和资料缺口，这些限制不能根据语言改写直接消除，最终结论仍需要真实研究证据。';
const improved='本研究先按区域层级确定样本，再汇集污染物观测资料，随后讨论交通活动与城市空气状态之间的关联，解释范围限定于已有记录。';
const comparison=()=>({version:1,sources:[{id:'article-1',name:'合成对照文章',url:'https://example.org/paper',text:'这是用于验证来源比对的合成文章，正文如下。'+overlapping+'它不代表真实研究结论。'}]});
const make=()=>({...createRevision({title:'来源修改测试',text:overlapping+'\n\n'+unique,mode:'rewrite'},'comparison-test','2026-10-22T00:00:00Z'),comparison:comparison(),reductionPath:'sources'});

test('other-article comparison measures original and accepted revision against identical external text, never against each other',()=>{
 const doc=make(),before=structuredClone(doc),result=compareRevisionDocument(doc);
 assert.equal(result.before.similarChars,countChars(overlapping));assert.equal(result.before.totalChars,countChars(overlapping)+countChars(unique));assert.equal(result.before.ratio,result.before.similarChars/result.before.totalChars);
 assert.deepEqual(result.after,result.before);assert.deepEqual(doc,before);assert.equal(result.paragraphs[0].paragraphId,'p0');assert.equal(result.paragraphs[0].matches[0].originalExcerpt,overlapping.slice(0,-1));assert.equal(result.paragraphs[0].matches[0].sourceExcerpt,overlapping.slice(0,-1));assert.equal(result.paragraphs[1].matches.length,0);
 const pending=editParagraph(doc,0,{suggestion:improved});assert.deepEqual(compareRevisionDocument(pending).after,result.after,'unaccepted wording is not a new export result');
 const accepted=acceptParagraph(pending,0),after=compareRevisionDocument(accepted);assert.deepEqual(after.before,result.before);assert.equal(after.after.similarChars,0);assert.equal(after.after.ratio,0);assert.equal(after.after.totalChars,countChars(improved)+countChars(unique));assert.equal(accepted.original,doc.original);
});
test('no external materials yields no percentage instead of treating the manuscript as its own source',()=>{
 const doc=make();delete doc.comparison;assert.equal(compareRevisionDocument(doc),null);assert.deepEqual(revisionComparisonSnapshot(doc,doc.paragraphs),{materials:[],comparisonContext:undefined});
});
test('comparison normalization is bounded, immutable and rejects report-shaped, unsafe or missing evidence',()=>{
 const value=comparison(),before=structuredClone(value),normalized=normalizeRevisionComparison(value);assert.deepEqual(normalized,value);assert.deepEqual(value,before);normalized.sources[0].text='changed';assert.deepEqual(value,before);
 for(const patch of [{version:2},{sources:[]},{sources:[{...value.sources[0],text:'仅名称'}]},{sources:[value.sources[0],value.sources[0]]},{sources:[{...value.sources[0],url:'javascript:alert(1)'}]},{sources:[{...value.sources[0],id:'__proto__'}]},{sources:[{...value.sources[0],text:'x'.repeat(12001)}]},{text:'entire raw report'}])assert.throws(()=>normalizeRevisionComparison({...value,...patch}));
 assert.throws(()=>normalizeRevisionComparison({version:1,sources:[0,1,2].map(i=>({id:'s'+i,name:'source'+i,text:'文'.repeat(9000)}))}),/24,000/);
});
test('snapshots target actual matched original paragraphs and send independent source material only',()=>{
 const doc=make(),before=structuredClone(doc),source=revisionAiSnapshot(doc,{scope:'selected',paragraphIds:['p0']});
 assert.deepEqual(source.materials,[{id:'comparison:article-1',name:'合成对照文章',text:doc.comparison.sources[0].text}]);assert.deepEqual(source.context.comparison,{version:1,paragraphs:[{paragraphId:'p0',sourceIds:['comparison:article-1']}]});assert.equal(source.text,overlapping);assert.deepEqual(doc,before);
 assert.throws(()=>revisionAiSnapshot(doc,{scope:'all'}),/第 2 段未命中/);assert.throws(()=>revisionAiSnapshot(doc,{scope:'selected',paragraphIds:['p1']}),/未命中/);
 assert.throws(()=>revisionComparisonSnapshot(doc,[{...doc.paragraphs[0],original:'现在已变更的段落'}]),/已变化/);
});
test('an explicit general rewrite keeps saved sources but does not claim a source-targeted request',()=>{
 const doc=make();doc.reductionPath='direct';const result=revisionAiSnapshot(doc,{scope:'all'});assert.deepEqual(result.materials,[]);assert.equal(Object.hasOwn(result.context,'comparison'),false);assert.equal(doc.comparison.sources.length,1);
 doc.reductionPath='sources';doc.mode='reduce';const aigc=revisionAiSnapshot(doc,{scope:'all'});assert.deepEqual(aigc.materials,[]);assert.equal(Object.hasOwn(aigc.context,'comparison'),false);
});
test('combined selected manuscript and actual source budget rejects without truncating either input',()=>{
 const doc=make(),original=overlapping+'甲'.repeat(1750);doc.comparison.sources[0].text=overlapping+'独'.repeat(12000-overlapping.length);doc.paragraphs=Array.from({length:16},(_,index)=>({id:'budget-'+index,original,suggestion:original,accepted:false}));const before=structuredClone(doc);
 assert.throws(()=>revisionAiSnapshot(doc,{scope:'all'}),/40,000/);assert.deepEqual(doc,before);
});
test('changing the source text or processing path prevents adopting an old source-specific candidate',()=>{
 const doc=make(),source=revisionAiSnapshot(doc,{scope:'current'}),output={paragraphs:[{id:'p0',original:overlapping,revised:improved,action:'revise',reason:'根据对照文章重组论述，保留研究含义。'}]};
 assert.doesNotThrow(()=>applyRevisionAiOutput(doc,output,source));
 const changed=structuredClone(doc);changed.comparison.sources[0].text+=' 新增待核对背景。';assert.throws(()=>applyRevisionAiOutput(changed,output,source),/对照文章/);
 assert.throws(()=>applyRevisionAiOutput({...doc,reductionPath:'direct'},output,source),/处理路径/);
});
