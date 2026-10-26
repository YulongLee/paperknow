import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {createWritingDocx,inspectThesisExportContent} from '../src/writing-document.js';
import {highlightDraftReviewMarkers} from '../src/writing-draft-review.js';
import {renderFormulaMathML,mathmlToOmml} from '../src/research-formula.js';
import {runThesisLayoutAgent} from '../src/thesis-layout-agent.js';
import {defaultThesisTemplateProfile} from '../src/thesis-template-profile.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',M='http://schemas.openxmlformats.org/officeDocument/2006/math';
const read=async bytes=>new DOMParser().parseFromString(await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string'),'application/xml');
const ns=(node,name,space=W)=>[...node.getElementsByTagNameNS(space,name)];
const text=node=>ns(node,'t').map(n=>n.textContent).join('');

test('the reported loss equation exports as editable Word math, with exponent on the complete norm',async()=>{
 const source=String.raw`公式验收
2.1 卷积神经网络与迁移学习原理
$$a^{(l)}=\phi(W^{(l)}*a^{(l-1)}+b^{(l)})$$
$$L=\sum_{(x,y)\in D_t}\ell(f_\theta(x),y)+\lambda\|\theta\|^2$$
其中 $D_t$ 为目标域，$\theta$ 为预训练参数。`;
 const options={documentKind:'thesis',metadata:{title:'公式验收'}},bytes=await createWritingDocx(source,options),doc=await read(bytes);
 assert.equal(ns(doc,'oMath',M).length,4);assert.doesNotMatch(text(doc),/\$\$|\\sum|\\theta|\\lambda/);
 const norm=ns(doc,'d',M).find(n=>ns(n,'begChr',M)[0]?.getAttributeNS(M,'val')==='‖');assert.ok(norm);assert.equal(norm.parentNode.localName,'e');assert.equal(norm.parentNode.parentNode.localName,'sSup');assert.equal(ns(norm.parentNode.parentNode,'sup',M)[0].textContent,'2');assert.ok(ns(norm,'t',M).some(n=>n.textContent==='θ'));
 assert.equal((await inspectThesisExportContent(bytes,source,options)).status,'passed');
});

test('absolute values, determinants, subscripted norms and conditional bars retain separate native semantics',()=>{
 const doc=value=>new DOMParser().parseFromString(mathmlToOmml(renderFormulaMathML(value)),'application/xml');
 for(const value of [String.raw`|x|+|y|`,String.raw`\left|\frac{x}{y}\right|+\left\lVert z\right\rVert_2`])assert.equal(ns(doc(value),'d',M).length,2);
 const determinant=doc(String.raw`\begin{vmatrix}a&b\\c&d\end{vmatrix}`);assert.equal(ns(determinant,'d',M).length,1);assert.equal(ns(determinant,'m',M).length,1);
 const conditional=doc(String.raw`P(A|B)+P(C|D)+P(E\mid F)`);assert.equal(ns(conditional,'d',M).length,0);assert.ok(ns(conditional,'t',M).some(n=>/[|∣]/.test(n.textContent)));
 const multiple=doc(String.raw`\|x\|_2^2`);assert.equal(ns(multiple,'sSubSup',M).length,1);assert.equal(ns(multiple,'d',M).length,1);
 assert.equal(ns(ns(conditional,'r',M).find(n=>n.textContent==='|'),'nor',M).length,1,'an unpaired bar is literal math text, never an OR operator');
});

test('Markdown table unescaping preserves TeX norms and editable math in table cells',async()=>{
 const source=String.raw`表格公式
| 参数 | 说明 |
| --- | --- |
| $\|\theta\|_2^2$ | 普通转义 a\|b |`;
 const doc=await read(await createWritingDocx(source,{documentKind:'writing',writingKind:'article',metadata:{title:'表格公式'}}));
 assert.equal(ns(doc,'tc').length,4);const delimiter=ns(doc,'d',M)[0];assert.ok(delimiter);assert.equal(ns(delimiter,'begChr',M)[0].getAttributeNS(M,'val'),'‖');assert.equal(ns(delimiter,'endChr',M)[0].getAttributeNS(M,'val'),'‖');assert.match(text(doc),/普通转义 a\|b/);
});

test('draft markers are red, normal prose stays unchanged, and final mode does not add review coloring',async()=>{
 const source='检查样稿\n第一章 研究方法\n正常正文。【待核对：教材依据】后续正文。\n【待补充：实证文献】\n```text\n【待补充：这是代码里的原样文本】\n```';
 for(const documentKind of ['thesis','writing']){
  const options={documentKind,writingKind:'proposal',metadata:{title:'检查样稿'}},bytes=await createWritingDocx(source,options),doc=await read(bytes),body=ns(doc,'r').filter(n=>/教材依据|实证文献/.test(text(n)));
  assert.equal(body.length,2);for(const run of body)assert.equal(ns(run,'color')[0]?.getAttributeNS(W,'val'),'C00000');
  const ordinary=ns(doc,'r').find(n=>text(n)==='正常正文。');assert.ok(ordinary);assert.notEqual(ns(ordinary,'color')[0]?.getAttributeNS(W,'val'),'C00000');
  const code=ns(doc,'r').find(n=>text(n).includes('这是代码'));assert.notEqual(ns(code,'color')[0]?.getAttributeNS(W,'val'),'C00000');
  const finalDoc=await read(await createWritingDocx(source,{...options,submission:true}));assert.equal(ns(finalDoc,'color').filter(n=>n.getAttributeNS(W,'val')==='C00000').length,0);
  const repaired=await runThesisLayoutAgent(bytes,{profile:defaultThesisTemplateProfile(),verifyContent:result=>inspectThesisExportContent(result,source,options)});assert.equal(ns(await read(repaired.bytes),'color').filter(n=>n.getAttributeNS(W,'val')==='C00000').length,2);
 }
});

test('markers split across styled runs and citation links preserve surrounding run properties and anchors',async()=>{
 const zip=new JSZip();zip.file('word/document.xml',`<w:document xmlns:w="${W}"><w:body><w:p><w:bookmarkStart w:id="1" w:name="PKInput_1"/><w:r><w:rPr><w:b/><w:color w:themeColor="accent1" w:val="112233"/></w:rPr><w:t>正文【待</w:t></w:r><w:hyperlink w:anchor="ref1"><w:r><w:rPr><w:i/></w:rPr><w:t>补充：来源】结束</w:t></w:r></w:hyperlink><w:bookmarkEnd w:id="1"/></w:p></w:body></w:document>`);
 const doc=await read(await highlightDraftReviewMarkers(await zip.generateAsync({type:'uint8array'}))),runs=ns(doc,'r');assert.equal(text(doc),'正文【待补充：来源】结束');assert.equal(ns(doc,'bookmarkStart').length,1);assert.equal(ns(doc,'bookmarkEnd').length,1);assert.equal(ns(doc,'hyperlink')[0].getAttributeNS(W,'anchor'),'ref1');
 const red=runs.filter(n=>ns(n,'color')[0]?.getAttributeNS(W,'val')==='C00000');assert.equal(red.map(text).join(''),'【待补充：来源】');assert.equal(ns(red[0],'b').length,1);assert.equal(ns(red[1],'i').length,1);assert.equal(ns(red[0],'color')[0].hasAttributeNS(W,'themeColor'),false);assert.equal(ns(runs[0],'color')[0].getAttributeNS(W,'val'),'112233');
});
