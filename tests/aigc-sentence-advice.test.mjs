import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {reportSentences,sentenceEditAdvice} from '../dist/reports/sentence-advice.mjs';
import {aigcReportHtml} from '../dist/workspace/aigc-report.mjs';
import {prepareAigcText} from '../backend/aigc-detection-client.mjs';
const itemFor=text=>{const p=prepareAigcText(text);return{id:'advice-test',analysisVersion:'paragraph-v2',status:'completed',characters:p.characters,partCount:p.parts.length,completedParts:p.parts.length,parts:p.parts.map(({content,...p},index)=>({...p,label:index%2?'ugc':'aigc',confidence:91})),verdict:'mixed'};};
test('Chinese sentences retain exact Unicode positions, whitespace, quotes and incomplete final text',()=>{
 const text='  结果为98.6%，见式(2)。  “保留引文。以及其中的用词。”是说明！🙂下一句？ 末句尚无标点',rows=reportSentences(text),chars=Array.from(text);
 assert.equal(rows.length,4);assert.equal(rows.map(r=>r.text).join(''),text);let offset=0;
 for(const row of rows){assert.equal(row.start,offset);assert.equal(row.text,chars.slice(row.start,row.end).join(''));offset=row.end;}assert.equal(offset,chars.length);assert.match(rows[1].text,/“保留引文。以及其中的用词。”/);
});
test('English sentences do not break decimals, academic abbreviations, DOI or web addresses',()=>{
 const text='Dr. Li compared 3.14 with 2.71, e.g. Fig. 2 in the U.S. study. See https://example.org/a.b and DOI 10.1000/test.v2. The result follows Eq. 3.',rows=reportSentences(text);
 assert.equal(rows.length,3);assert.equal(rows.map(r=>r.text).join(''),text);assert.match(rows[0].text,/U.S. study\./);assert.match(rows[1].text,/10\.1000\/test\.v2\./);
});
test('formula, code and citation expressions remain intact while sentence boundaries stay exact',()=>{
 const text='损失为 $L=0.5\\sum_i x_i$，命令为 `a.b()`，见[1, 2]。下一句使用 \\(f(x)=1.2x\\\\+3\\) 的定义。';
 const rows=reportSentences(text);assert.equal(rows.length,2);assert.equal(rows.map(r=>r.text).join(''),text);assert.match(rows[0].text,/a\.b\(\)/);
 assert.equal(sentenceEditAdvice('“进行深入的分析”是原始引文。').revised,null);
 assert.equal(sentenceEditAdvice('代码 `in order to` 保持原样。').revised,null);
});
test('reference edits simplify expression without changing facts, data, negation, qualification or citations',()=>{
 const text='值得注意的是，2025年本研究对120份样本进行进一步的分析，未发现显著差异（P=0.25）[3]，仍可能受到样本范围限制。',advice=sentenceEditAdvice(text);
 assert.equal(advice.kind,'edit');assert.ok(advice.revised);for(const value of ['2025年','120份','未发现显著差异','P=0.25','[3]','仍可能受到样本范围限制'])assert.ok(advice.revised.includes(value));assert.doesNotMatch(advice.revised,/值得注意的是|进行进一步的分析/);
 assert.match(advice.issues.map(r=>r.detail).join(''),/120份/);assert.equal(sentenceEditAdvice('In order to compare methods, we retain the original test set.').revised,'To compare methods, we retain the original test set.');
});
test('suggestions cite actual expression concerns and do not invent a new result or external reference',()=>{
 const a=sentenceEditAdvice('研究表明该方案一定会导致性能显著提高。');assert.ok(a.issues.some(r=>r.title==='补全可核对的依据'));assert.ok(a.issues.some(r=>r.title==='核对推论强度'));assert.equal(a.revised,null);
 const b=sentenceEditAdvice('研究表明该方案具有一定适用范围[1]。');assert.equal(b.issues.some(r=>r.title==='补全可核对的依据'),false);
 const c=sentenceEditAdvice('本研究拟采用访谈法。');assert.ok(c.issues.some(r=>r.title==='核对研究状态'));assert.equal(c.revised,null);
 assert.equal(sentenceEditAdvice('数据集包含不同光照条件下的图像。').kind,'retain');
});
test('the right column gives sentence advice only for flagged paragraphs and keeps safe original anchors',()=>{
 const text='值得注意的是，本文进行进一步的分析。数据集包含不同光照条件下的图像。\n\n本研究使用独立测试集。结果仍需结合样本范围解释。',item=itemFor(text),before=JSON.stringify(item),dom=new JSDOM(aigcReportHtml(item,{text})),doc=dom.window.document;
 assert.equal(doc.querySelectorAll('.report-sentence-card').length,2);assert.equal(doc.querySelectorAll('[data-ai-sentence-row^="2-"] .report-sentence-card').length,0);assert.ok([...doc.querySelectorAll('[data-ai-sentence-row^="2-"] .report-review-detail')].every(node=>node.innerHTML===''));assert.equal([...doc.querySelectorAll('.report-review-original .report-text')].map(n=>n.textContent).join(''),text);
 for(const a of doc.querySelectorAll('.report-sentence-card a[href^="#"]')){const target=doc.getElementById(a.hash.slice(1));assert.ok(target);assert.ok(target.closest('.report-review-original'));assert.equal(target.closest('tr'),a.closest('tr'));}
 assert.equal(doc.querySelectorAll('.report-sentence-rewrite').length,1);assert.match(doc.body.textContent,/逐句修改建议/);assert.match(doc.body.textContent,/不代表逐句 AI 作者判定/);assert.equal(JSON.stringify(item),before);assert.equal(doc.querySelectorAll('script,button,details').length,0);dom.window.close();
});
test('one sentence crossing detector boundaries has one advice and one original anchor without changing labels',()=>{
 const text='🙂这是跨越两个原检测范围的同一句研究说明。',count=Array.from(text).length,item={id:'legacy-advice',status:'completed',characters:count,partCount:2,completedParts:2,verdict:'mixed',parts:[{index:0,start:0,end:12,characters:12,label:'aigc',confidence:95},{index:1,start:12,end:count,characters:count-12,label:'ugc',confidence:99}]},dom=new JSDOM(aigcReportHtml(item,{text})),doc=dom.window.document;
 assert.equal(doc.querySelectorAll('.report-sentence-card').length,1);assert.equal(doc.querySelectorAll('#ai-sentence-1-1').length,1);assert.equal(doc.querySelector('.aigc-report-text-risk').textContent,Array.from(text).slice(0,12).join(''));assert.match(doc.querySelector('#ai-analysis-1').textContent,/本段没有独立判断结果/);dom.window.close();
});
test('code fences, displayed equations and reference entries receive preservation guidance without rewrites',()=>{
 const text='```python\nx = a.b()\nprint("值得注意的是，")\n```\n\n[1] Li. A study. 2025. DOI: 10.1000/test.\n\n$$\nL = 0.5 + 1.2\n$$',dom=new JSDOM(aigcReportHtml(itemFor(text),{text})),doc=dom.window.document;
 assert.equal(doc.querySelectorAll('.report-sentence-rewrite').length,0);assert.equal(doc.querySelector('[data-ai-paragraph="2"] .report-review-detail').textContent,'');assert.match(doc.querySelector('[data-ai-paragraph="1"] .report-review-detail').textContent,/保留结构与符号/);assert.match(doc.querySelector('[data-ai-paragraph="5"] .report-review-detail').textContent,/核对参考文献信息/);assert.equal([...doc.querySelectorAll('.report-review-original .report-text')].map(n=>n.textContent).join(''),text);dom.window.close();
});
test('manuscript markup cannot become executable in a sentence quote or reference rewrite',()=>{
 const text='值得注意的是，<script>alert(1)</script>本研究进行详细的分析。',dom=new JSDOM(aigcReportHtml(itemFor(text),{text,title:'<img src=x onerror=alert(1)>'})),doc=dom.window.document;
 assert.equal(doc.querySelectorAll('script,img,[onerror],[onclick]').length,0);assert.ok(doc.querySelector('.report-review-original .report-text').textContent.includes('<script>'));assert.ok(doc.querySelector('.report-sentence-rewrite').textContent.includes('<script>'));dom.window.close();
});
test('maximal input with many tiny sentences remains complete and within the cloud file size bound',()=>{
 const text='字。'.repeat(25000),html=aigcReportHtml(itemFor(text),{text});assert.equal((html.match(/class="report-sentence-card"/g)||[]).length,25000);assert.ok(Buffer.byteLength(html)<20*1024*1024);
});
