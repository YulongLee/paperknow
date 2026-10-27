import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDetectionProgress} from '../dist/workspace/detection-progress.mjs';
import {reportStatistics} from '../dist/precheck/report-statistics.mjs';
import {parseDocument,analyzeDocument} from '../dist/precheck/engine.mjs';
import {reportHtml} from '../dist/precheck/export.mjs';

test('progress preserves the same DOM across queue and running updates without fake percentages',()=>{
 const dom=new JSDOM('<section id="host" hidden></section>'),target=dom.window.document.querySelector('#host');let cancels=0;
 const progress=createDetectionProgress(target,{onCancel:()=>cancels++});
 try{progress.update({state:'submitting'});const root=target.firstElementChild,bar=target.querySelector('[role=progressbar]');progress.update({state:'queued'});progress.update({state:'running'});progress.update({state:'running'});assert.equal(target.firstElementChild,root);assert.equal(target.querySelector('[role=progressbar]'),bar);assert.equal(bar.hasAttribute('aria-valuenow'),false);assert.match(target.textContent,/检测中/);assert.doesNotMatch(target.textContent,/检索|分块|片段|置信|\d+%/);target.querySelector('[data-detection-cancel]').click();assert.equal(cancels,1);progress.dispose();assert.equal(target.hidden,true);assert.equal(target.children.length,0);}finally{progress.dispose();dom.window.close();}
});

test('single-source and longest-match statistics merge real positions and leave source objects unchanged',()=>{
 const text='研究结果表明不同数据来源之间需要进行系统性的对照分析并保留可核验的证据材料。',report=analyzeDocument(parseDocument('第1章 研究设计\n'+text),[{id:'s1',title:'来源一',text},{id:'s2',title:'来源二',text}]);
 const before=JSON.stringify(report),stats=reportStatistics(report);assert.equal(stats.maximum.characters,report.totalChars);assert.equal(stats.maximumRatio,1);assert.equal(stats.matchedParagraphs,1);assert.equal(stats.longestMatch,report.totalChars);assert.equal(JSON.stringify(report),before);
 const dom=new JSDOM(reportHtml({...report,mode:'web'})),doc=dom.window.document;
 try{assert.match(doc.querySelector('.report-statistics').textContent,/去除引用后相似占比未计算/);assert.match(doc.querySelector('.report-statistics').textContent,/去除本人文献后相似占比未计算/);for(const link of doc.querySelectorAll('a[href^="#"]'))assert.ok(doc.getElementById(link.hash.slice(1)));assert.ok(doc.querySelector('#report-summary .report-metrics'));assert.ok(doc.querySelector('#report-text mark'));}finally{dom.window.close();}
});
