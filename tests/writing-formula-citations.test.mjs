import test from 'node:test';
import assert from 'node:assert/strict';
import {auditWritingConsistency} from '../backend/writing-quality.mjs';
import {assessWritingDelivery} from '../dist/workspace/writing-delivery.mjs';

const inspect=(text,sources=[])=>auditWritingConsistency({chapters:[{id:'s',title:'方法',text}],materials:sources}).findings.filter(item=>item.category==='source_support'&&item.explanation.includes('公式'));

test('formula citations remain unverified for matching, denying, equivalent or incomplete sources',()=>{
 for(const text of ['定义 C(n)=n²。','该模型不满足 C(n)=n²。','C(n)=n²n。','定义 C(n)=n×n。','只描述研究边界。']){
  const items=inspect('资料定义 C(n)=n² [source:a]。',[{id:'a',confirmed:true,text}]);
  assert.equal(items.length,1,text);assert.equal(items[0].severity,'info');assert.match(items[0].explanation,/尚需.*核对/);assert.doesNotMatch(items[0].explanation,/已经核对|来源支持|错误/);
 }
});

test('before and after citation positions and unknown or duplicate sources never imply verification',()=>{
 for(const text of ['根据[source:a]，定义 C(n)=n²。','C(n)=n² [source:a]。','按定义 C(n)=n²；另见[source:a]。'])for(const sources of [[],[{id:'a',confirmed:true,text:'定义 C(n)=n²。'}],[{id:'a',text:'x'},{id:'a',text:'y'}]]){
  const items=inspect(text,sources);assert.equal(items.length,1,text);assert.equal(items[0].severity,'info');
 }
});

test('longer expressions and fenced code are not incorrectly treated as simple cited formulas',()=>{
 for(const text of ['C(n)=n²n [source:a]。','C(n)=n²+1 [source:a]。','C(n)=n²×n [source:a]。','C(n)=n^20 [source:a]。','```text\nC(n)=n² [source:a]\n```','C(n)=n²。边界见[source:a]。','公式为 x+y=z [source:a]。'])assert.equal(inspect(text).length,0,text);
});

test('a formula reminder alone does not block delivery, but a real source warning still does',()=>{
 const text='C(n)=n²，样本来自[source:a]。',snapshot={materials:[{id:'a',text:'样本来自公开数据集。'}],references:[]};
 const consistency=auditWritingConsistency({chapters:[{id:'s',title:'方法',text}],materials:snapshot.materials});
 assert.equal(consistency.findings[0].reasonCode,'formula_citation_manual_review');
 const assess=quality=>assessWritingDelivery({kind:'proposal',text,snapshot,quality});
 assert.equal(assess({consistency,reviews:[]}).ready,true);
 const real={category:'source_support',severity:'warning',quote:'样本来自',explanation:'来源不能核对样本事实。'};
 assert.equal(assess({consistency:{...consistency,findings:[...consistency.findings,real]},reviews:[]}).ready,false);
 const copied={...consistency.findings[0],severity:'warning'};
 assert.equal(assess({consistency:{...consistency,findings:[copied]},reviews:[]}).ready,false);
});
