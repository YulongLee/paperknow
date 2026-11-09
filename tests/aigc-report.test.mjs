import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {aigcReportHtml} from '../dist/workspace/aigc-report.mjs';
import {normalizeAigcResult} from '../dist/workspace/aigc-detection-model.mjs';

const result=(extra={})=>({id:'aigc-report-1',status:'completed',characters:8,partCount:2,completedParts:2,createdAt:'2026-10-18T22:00:00.000Z',updatedAt:'2026-10-18T22:00:15.000Z',verdict:'mixed',parts:[{index:0,start:0,end:4,characters:4,label:'aigc',confidence:87.5},{index:1,start:4,end:8,characters:4,label:'ugc',confidence:95}],...extra});

test('AI report retains actual chunk labels and never invents a whole-paper percentage from scores',()=>{
 const html=aigcReportHtml(result({overallScore:91,aiPercent:70,provider:'private-provider',model:'private-model',requestIds:['private-request']}),{text:'研究😀。真实原稿'}),dom=new JSDOM(html),$=selector=>dom.window.document.querySelector(selector);
 try{assert.equal($('.report-metrics').children.length,4);assert.equal($('.report-verdict').textContent,'分段倾向不一致');assert.match(dom.window.document.body.textContent,/87.5 \/ 100/);assert.match(dom.window.document.body.textContent,/95 \/ 100/);assert.doesNotMatch(dom.window.document.body.textContent,/87.5%|95%|70%|91%/);assert.equal($('.aigc-report-text-risk').textContent,'研究😀。');assert.equal($('.aigc-report-text-human').textContent,'真实原稿');assert.match(html,/不作逐句判定/);assert.match(html,/2026\/10\/19 06:00/);assert.doesNotMatch(html,/private-provider|private-model|private-request/);assert.equal($('script'),null);assert.equal($('img'),null);assert.equal($('link'),null);assert.match($('meta[http-equiv="Content-Security-Policy"]').content,/default-src 'none'/);}finally{dom.window.close();}
});

test('AI report escapes manuscript and user-controlled titles without removing academic content',()=>{
 const text='<script>alert(1)</script>本研究比较 Claude 和 OpenAI 的公开文献。',count=Array.from(text).length,item=result({characters:count,partCount:1,completedParts:1,verdict:'ugc',parts:[{index:0,start:0,end:count,characters:count,label:'ugc',confidence:99}]}),html=aigcReportHtml(item,{text,title:'<img src=x onerror=alert(1)>'}),dom=new JSDOM(html);
 try{assert.equal(dom.window.document.querySelector('script'),null);assert.equal(dom.window.document.querySelector('img'),null);assert.equal(dom.window.document.querySelector('.aigc-report-text').textContent,text);assert.match(html,/&lt;img src=x/);assert.match(html,/Claude 和 OpenAI/);assert.doesNotMatch(html,/99%/);}finally{dom.window.close();}
});

test('historical result exports real metadata only and never silently substitutes unrelated editor text',()=>{
 const html=aigcReportHtml(result());assert.match(html,/当前历史记录不保存正文/);assert.match(html,/历史摘要；未附原文/);assert.doesNotMatch(html,/<div class="report-text aigc-report-text/);assert.throws(()=>aigcReportHtml(result(),{text:'不同原文'}),/原文与鉴别字符数不一致/);
});

test('incomplete, failed and invalid chunk layouts cannot produce a completed report',()=>{
 for(const item of [result({status:'running'}),result({status:'failed'}),result({completedParts:1}),result({parts:result().parts.slice(0,1)})])assert.throws(()=>aigcReportHtml(item),/尚未完整结束/);
 for(const parts of [[{index:0,start:1,end:8,characters:7,label:'ugc',confidence:95}],[{index:0,start:0,end:8,characters:7,label:'ugc',confidence:95}],[{index:0,start:0,end:9,characters:9,label:'ugc',confidence:95}]])assert.throws(()=>aigcReportHtml(result({partCount:1,completedParts:1,parts})),/分段位置/);
});

test('unknown labels remain explicit and are not reported as human-written or zero-risk',()=>{
 const item=result({verdict:'undetermined',parts:[{index:0,start:0,end:4,characters:4,label:'unknown',confidence:99},{index:1,start:4,end:8,characters:4,label:'aigc',confidence:101}]}),html=aigcReportHtml(item),dom=new JSDOM(html);
 try{assert.equal(dom.window.document.querySelector('.report-verdict').textContent,'暂不能明确判定');assert.equal(dom.window.document.querySelectorAll('.report-table .report-tag-unknown').length,2);assert.doesNotMatch(dom.window.document.body.textContent,/99 \/ 100|101 \/ 100|0%|100%/);}finally{dom.window.close();}
});

test('partial report retains available labels, explicitly marks missing conclusions and never displays a whole-paper rate',()=>{
 const item=result({error:'部分正文暂无法判定，已展示可用结果，本次未扣费。',conclusive:false,parts:[{index:0,start:0,end:4,characters:4,label:'ugc',confidence:95},{index:1,start:4,end:8,characters:4,label:'undetermined',confidence:null}]});
 const dom=new JSDOM(aigcReportHtml(item,{text:'研究😀。真实原稿'}));
 try{const content=dom.window.document.body.textContent;assert.match(content,/部分结果/);assert.match(content,/部分正文暂无法判定.*本次未扣费/);assert.match(content,/已取得结果的范围中未标记疑似 AI 内容/);assert.match(content,/暂不能明确判定/);assert.match(content,/已判定内容中疑似 AI 片段字符占比/);assert.match(content,/0\.0%/);assert.match(content,/已判定 4 \/ 8 个有效字符，覆盖率 50\.0%/);assert.match(content,/4 个有效字符暂无法判定/);assert.match(content,/不是整篇 AI 率/);assert.doesNotMatch(content,/报告状态\s*检测完成/);}finally{dom.window.close();}
});

test('date normalization keeps only valid public record dates and omits internal fields',()=>{
 const item=normalizeAigcResult(result({createdAt:'2026-10-19T06:00:00+08:00',updatedAt:'<script>',model:'private-model'}));assert.equal(item.createdAt,'2026-10-18T22:00:00.000Z');assert.equal(item.updatedAt,'');assert.equal(item.model,undefined);
});

test('AI coverage is weighted by verified chunk characters and never by confidence',async()=>{
 const {aigcLabelCoverage}=await import('../dist/workspace/aigc-detection-model.mjs');
 const item=result({characters:10,parts:[{index:0,start:0,end:9,characters:9,label:'aigc',confidence:11},{index:1,start:9,end:10,characters:1,label:'ugc',confidence:99}]});
 assert.equal(aigcLabelCoverage(item).ratio,.9);assert.match(aigcReportHtml(item),/90\.0%/);assert.doesNotMatch(aigcReportHtml(item),/11%|55\.0%/);
 for(const invalid of [result({status:'running'}),result({verdict:'undetermined'}),result({parts:[{index:0,start:0,end:4,characters:4,label:'aigc',confidence:90},{index:1,start:5,end:8,characters:3,label:'ugc',confidence:91}]})])assert.equal(aigcLabelCoverage(invalid).available,false);
});

test('partial coverage uses only known effective characters and never assigns unknown text to human',async()=>{
 const {aigcLabelCoverage}=await import('../dist/workspace/aigc-detection-model.mjs');
 const item=result({analysisVersion:'paragraph-v2',characters:15,partCount:3,completedParts:3,conclusive:false,error:'部分正文暂无法判定，已展示可用结果，本次未扣费。',parts:[{index:0,start:0,end:5,characters:5,effectiveCharacters:4,label:'aigc',confidence:20},{index:1,start:5,end:10,characters:5,effectiveCharacters:2,label:'ugc',confidence:99},{index:2,start:10,end:15,characters:5,effectiveCharacters:3,label:'undetermined',confidence:null}]});
 const cov=aigcLabelCoverage(item);assert.equal(cov.available,false);assert.equal(cov.partialAvailable,true);assert.equal(cov.partialRatio,4/6);assert.equal(cov.coverageRatio,6/9);assert.equal(cov.unknownCharacters,3);
 const doc=new JSDOM(aigcReportHtml(item));try{const body=doc.window.document.body.textContent;assert.match(body,/66\.7%/);assert.match(body,/已判定 6 \/ 9 个有效字符，覆盖率 66\.7%/);assert.match(body,/3 个有效字符暂无法判定/);assert.match(body,/不是整篇 AI 率/);}finally{doc.window.close();}
 const invalid={...item,parts:item.parts.map((p,i)=>i===1?{...p,start:6}:p)};assert.equal(aigcLabelCoverage(invalid).partialAvailable,false);
});

test('partial statistics do not misrepresent unknown, skipped, low coverage or unfinished content',async()=>{
 const {aigcLabelCoverage}=await import('../dist/workspace/aigc-detection-model.mjs');
 const base=result({analysisVersion:'paragraph-v2',characters:102,partCount:3,completedParts:3,conclusive:false,parts:[{index:0,start:0,end:1,characters:1,effectiveCharacters:1,label:'aigc',confidence:99},{index:1,start:1,end:101,characters:100,effectiveCharacters:99,label:'undetermined',confidence:null},{index:2,start:101,end:102,characters:1,effectiveCharacters:0,label:'undetermined',confidence:null,skipped:true,skipReason:'whitespace'}]});
 const low=aigcLabelCoverage(base);assert.equal(low.partialRatio,1);assert.equal(low.coverageRatio,.01);assert.equal(low.unknownCharacters,99);assert.equal(low.testedCharacters,100);assert.match(aigcReportHtml(base),/100\.0%/);assert.match(aigcReportHtml(base),/覆盖率 1\.0%/);assert.match(aigcReportHtml(base),/不是整篇 AI 率/);
 const unknown={...base,parts:base.parts.map(p=>p.label==='aigc'?{...p,label:'undetermined',confidence:null}:p)};assert.equal(aigcLabelCoverage(unknown).partialAvailable,false);assert.equal(aigcLabelCoverage(unknown).partialRatio,null);assert.match(aigcReportHtml(unknown),/暂不能计算/);
 for(const invalid of [{...base,status:'running'},{...base,completedParts:2},{...base,parts:base.parts.map((p,i)=>i===1?{...p,start:2}:p)}])assert.equal(aigcLabelCoverage(invalid).partialAvailable,false);
});

test('partial report reproduces representative long-document statistics',async()=>{
 const item=result({analysisVersion:'paragraph-v2',characters:12484,partCount:3,completedParts:3,conclusive:false,error:'部分正文暂无法判定，已展示可用结果，本次未扣费。',parts:[{index:0,start:0,end:713,characters:713,effectiveCharacters:713,label:'aigc',confidence:85},{index:1,start:713,end:9124,characters:8411,effectiveCharacters:8411,label:'ugc',confidence:95},{index:2,start:9124,end:12484,characters:3360,effectiveCharacters:3360,label:'undetermined',confidence:null}]});
 const html=aigcReportHtml(item);assert.match(html,/7\.8%/);assert.match(html,/73\.1%/);assert.match(html,/已判定 9,124 \/ 12,484 个有效字符/);assert.match(html,/3,360 个有效字符暂无法判定/);assert.match(html,/不是整篇 AI 率/);
});
