import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {parseDocument,analyzeDocument} from '../dist/precheck/engine.mjs';
import {reportHtml} from '../dist/precheck/export.mjs';
import {aigcReportHtml} from '../dist/workspace/aigc-report.mjs';
import {originalParagraphs,aigcLocations} from '../dist/reports/report-locations.mjs';
import {evidencePreview} from '../dist/precheck/report-highlight.mjs';
const text='本研究使用独立的测试样本评估识别效果，核对实验记录与数据来源，并对不同设置下的结果进行分析。';
const ai=(raw,parts)=>({id:'test-ai',status:'completed',characters:Array.from(raw).length,partCount:parts.length,completedParts:parts.length,parts,verdict:'mixed'});
function anchors(doc){for(const a of doc.querySelectorAll('a[href^="#"]'))assert.ok(doc.getElementById(a.hash.slice(1)),a.hash);}

test('similarity report indexes actual problem paragraphs and provides original/source text side by side',()=>{
 const report=analyzeDocument(parseDocument('第1章 研究设计\n'+text+'\n参考文献\n不参与比对的参考资料'),[{id:'source',title:'公开对照材料',text,authors:['测试作者'],url:'https://example.org/paper'}],{mode:'web'}),before=JSON.stringify(report),dom=new JSDOM(reportHtml(report));
 try{const doc=dom.window.document;anchors(doc);assert.equal(doc.querySelectorAll('#report-findings tbody tr').length,1);assert.match(doc.querySelector('#report-findings').textContent,/第 1 段/);assert.equal(doc.querySelector('.report-pair>div:first-child .report-text').textContent,text.slice(0,-1));assert.equal(doc.querySelector('.report-pair>div:last-child .report-text').textContent,text.slice(0,-1));assert.ok(doc.querySelector('.report-pair>div:last-child mark'));assert.match(doc.querySelector('.report-source-info a[target=_blank]').textContent,/查看来源原文/);assert.equal(JSON.stringify(report),before);}finally{dom.window.close();}
});

test('repeated alignments for the same source and original range produce one comparison without altering evidence',()=>{
 const matches=[{id:'a',sourceId:'s1',range:[0,20],sourceRange:[0,20]},{id:'b',sourceId:'s1',range:[0,20],sourceRange:[25,45]},{id:'c',sourceId:'s2',range:[0,20],sourceRange:[0,20]}];const before=JSON.stringify(matches);assert.deepEqual(evidencePreview(matches).map(m=>m.id),['a','c']);assert.equal(JSON.stringify(matches),before);
});

test('AI original locations preserve Unicode and CRLF offsets and do not label individual sentences',()=>{
 const raw='研究😀背景\r\n\r\n原文需要核对的范围。\n人工部分。',chars=Array.from(raw),cut=chars.indexOf('人'),parts=[{index:0,start:0,end:cut,characters:cut,label:'aigc',confidence:86},{index:1,start:cut,end:chars.length,characters:chars.length-cut,label:'ugc',confidence:95}],rows=originalParagraphs(raw),dom=new JSDOM(aigcReportHtml(ai(raw,parts),{text:raw}));
 try{const doc=dom.window.document;anchors(doc);assert.equal(rows[1].start,9);assert.equal(rows[1].text,'原文需要核对的范围。');assert.equal(doc.querySelectorAll('#report-findings tbody tr').length,2);assert.match(doc.querySelector('#report-findings').textContent,/不表示其中每一句话/);assert.equal(doc.querySelector('.aigc-report-text-risk').textContent,chars.slice(0,cut).join('').replace(/\r\n?/g,'\n'));assert.equal(doc.querySelector('.aigc-report-text-human').textContent,'人工部分。');assert.equal(doc.querySelectorAll('script,img,iframe').length,0);}finally{dom.window.close();}
});

test('a paragraph spanning mixed chunks points to its actual risk fragment instead of the human fragment',()=>{
 const raw='原文😀原文原文原文原文',parts=[{index:0,start:0,end:5,characters:5,label:'ugc',confidence:91},{index:1,start:5,end:Array.from(raw).length,characters:Array.from(raw).length-5,label:'aigc',confidence:88}],locations=aigcLocations(raw,parts),dom=new JSDOM(aigcReportHtml(ai(raw,parts),{text:raw}));
 try{const doc=dom.window.document;anchors(doc);assert.equal(locations.total,1);assert.equal(locations.visible[0].startOfRisk,5);assert.equal(doc.querySelector('#ai-original-1-2').closest('.aigc-report-text').classList.contains('aigc-report-text-risk'),true);assert.equal([...doc.querySelectorAll('.aigc-report-text')].map(n=>n.textContent).join(''),raw);}finally{dom.window.close();}
});

test('many short paragraphs retain the complete original while bounding clickable index size',()=>{
 const raw='研究。\n'.repeat(700),size=Array.from(raw).length,parts=[{index:0,start:0,end:size,characters:size,label:'aigc',confidence:90}],html=aigcReportHtml(ai(raw,parts),{text:raw}),dom=new JSDOM(html);
 try{const doc=dom.window.document;anchors(doc);assert.equal(doc.querySelectorAll('#report-findings tbody tr').length,300);assert.match(doc.querySelector('#report-findings').textContent,/保留全部送检文字/);assert.equal(doc.querySelector('.aigc-report-text-risk').textContent,raw);assert.ok(Buffer.byteLength(html)<2*1024*1024);}finally{dom.window.close();}
});
