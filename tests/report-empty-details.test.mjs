import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {parseDocument,analyzeDocument} from '../dist/precheck/engine.mjs';
import {reportHtml} from '../dist/precheck/export.mjs';
import {similarityReview} from '../dist/reports/similarity-review.mjs';
import {aigcParagraphReview} from '../dist/reports/aigc-review.mjs';
import {aigcReportHtml} from '../dist/workspace/aigc-report.mjs';
import {prepareAigcText} from '../backend/aigc-detection-client.mjs';
import {effectiveAigcCharacters} from '../dist/reports/aigc-partitions.mjs';
const matched='本研究比较不同识别方法在相同测试数据上的表现，使用独立样本记录真实结果，并分析方法的适用条件。';
const unmatched='论文另外讨论设备部署的约束，描述实际场景中的照明和采集条件，明确后续需要核实的问题。';
test('unmatched and excluded paragraphs keep their complete left text and a truly empty right cell',()=>{
 const report=analyzeDocument(parseDocument('第一章 方法\n'+matched+'\n\n'+unmatched+'\n参考文献\n[1] 独立参考来源。'),[{id:'s1',title:'实际来源',text:matched}]),before=JSON.stringify(report),dom=new JSDOM(reportHtml(report));
 try{const doc=dom.window.document,rows=[...doc.querySelectorAll('.report-review-row')];assert.ok(rows.length>=3);
  const match=rows.find(row=>row.querySelector('.report-text').textContent===matched),clear=rows.find(row=>row.querySelector('.report-text').textContent===unmatched),excluded=rows.find(row=>row.querySelector('.report-excluded'));
  assert.ok(match.querySelector('.report-source-match'));assert.ok(match.querySelector('mark'));for(const row of [clear,excluded]){assert.ok(row);const cells=row.querySelectorAll('td');assert.equal(cells.length,2);assert.equal(cells[1].innerHTML,'');assert.ok(cells[0].textContent.trim());}
  assert.doesNotMatch(doc.querySelector('#report-text').textContent,/本段未发现匹配|此章节未参与检测/);assert.equal(JSON.stringify(report),before);
 }finally{dom.window.close();}
});
test('missing evidence is kept distinct from a clean paragraph and still has an actionable explanation',()=>{
 const paragraph={text:matched,matches:[{sourceId:'missing',range:[0,20],sourceRange:[0,20]}]},html=similarityReview({sections:[{title:'正文',included:true,paragraphs:[paragraph]}]},new Map()),dom=new JSDOM(html);
 try{assert.match(dom.window.document.querySelector('.report-review-detail').textContent,/匹配依据暂不可读取/);assert.ok(dom.window.document.querySelector('mark'));}finally{dom.window.close();}
});
test('overlapping matches from one source share a card and use the longest real excerpt',()=>{
 const source={id:'s1',number:1,title:'来源一',text:'短句先出现。这里是更长的原文证据片段。'},paragraph={text:'短句先出现。这里是更长的原文证据片段。',matches:[{sourceId:'s1',range:[0,2],sourceRange:[0,2]},{sourceId:'s1',range:[6,18],sourceRange:[6,18]},{sourceId:'s2',range:[0,2],sourceRange:[0,2]}]},report={mode:'web',sections:[{title:'正文',included:true,paragraphs:[paragraph]}]},before=JSON.stringify(report),sources=new Map([['s1',source],['s2',{id:'s2',number:2,title:'来源二',text:'短句'}]]),dom=new JSDOM(similarityReview(report,sources));
 try{const cards=[...dom.window.document.querySelectorAll('.report-source-match')];assert.equal(cards.length,2);assert.match(cards[0].querySelector('.report-source-excerpt').textContent,/更长的原文证据/);assert.equal(JSON.stringify(report),before);}finally{dom.window.close();}
});
test('human-labelled paragraphs retain original text and summary but have no right-side advice',()=>{
 const text=matched+'\n\n'+unmatched,p=prepareAigcText(text),item={id:'human-report',analysisVersion:'paragraph-v2',status:'completed',characters:p.characters,partCount:p.parts.length,completedParts:p.parts.length,parts:p.parts.map(({content,...part})=>({...part,label:'ugc',confidence:94})),verdict:'ugc'},before=JSON.stringify(item),dom=new JSDOM(aigcReportHtml(item,{text}));
 try{const doc=dom.window.document;assert.ok([...doc.querySelectorAll('.report-review-detail')].every(node=>node.innerHTML===''));assert.equal(doc.querySelectorAll('.report-sentence-card').length,0);assert.equal([...doc.querySelectorAll('.report-review-original .report-text')].map(n=>n.textContent).join(''),text);assert.match(doc.querySelector('#report-summary').textContent,/0.0%/);assert.match(doc.querySelector('#report-parts').textContent,/偏人工表达/);assert.equal(JSON.stringify(item),before);}finally{dom.window.close();}
});

test('an unresolved AI range retains its explanation rather than appearing as a clean paragraph',()=>{
 const text=unmatched,p=prepareAigcText(text),item={analysisVersion:'paragraph-v2',parts:p.parts.map(({content,...part})=>({...part,label:'undetermined',confidence:null}))},dom=new JSDOM('<table><tbody>'+aigcParagraphReview(text,item)+'</tbody></table>');
 try{assert.match(dom.window.document.querySelector('.report-review-detail').textContent,/本段尚无明确结论/);assert.equal(dom.window.document.querySelectorAll('.aigc-report-text-risk').length,0);assert.equal(dom.window.document.querySelectorAll('.report-sentence-card').length,0);assert.doesNotMatch(dom.window.document.querySelector('.report-review-detail').textContent,/逐句修改建议/);}finally{dom.window.close();}
});
test('sentence advice is limited to fully assessed AI ranges in a mixed paragraph',()=>{
 const a='第一句可能具有人工智能生成的表达特征。', b='第二句暂时没有足够依据做出判断。', c='第三句由人工撰写。',text=a+b+c;
 const al=Array.from(a).length,bl=Array.from(b).length,cl=Array.from(c).length;
 const parts=[[0,al,'aigc',a],[al,al+bl,'undetermined',b],[al+bl,al+bl+cl,'ugc',c]].map(([start,end,label,value],index)=>({index,start,end,label,paragraphNumber:1,confidence:label==='undetermined'?null:90,effectiveCharacters:effectiveAigcCharacters(value)}));
 const dom=new JSDOM('<table><tbody>'+aigcParagraphReview(text,{analysisVersion:'paragraph-v2',parts})+'</tbody></table>');
 try{const cards=[...dom.window.document.querySelectorAll('.report-sentence-card')];assert.equal(cards.length,1);assert.match(cards[0].textContent,/第 1 句/);assert.match(dom.window.document.body.textContent,/本段尚无明确结论/);assert.equal([...dom.window.document.querySelectorAll('.report-review-original .report-text')].map(n=>n.textContent).join(''),text);}finally{dom.window.close();}
 // When an uncertain span intersects even part of a sentence, do not present
 // that sentence as independently identified AI content.
 const split=al-3,cross=[[0,split,'aigc',a.slice(0,split)],[split,al,'undetermined',a.slice(split)]].map(([start,end,label,value],index)=>({index,start,end,label,paragraphNumber:1,confidence:null,effectiveCharacters:effectiveAigcCharacters(value)}));
 const mixed=new JSDOM('<table><tbody>'+aigcParagraphReview(a,{analysisVersion:'paragraph-v2',parts:cross})+'</tbody></table>');try{assert.equal(mixed.window.document.querySelectorAll('.report-sentence-card').length,0);}finally{mixed.window.close();}
});
