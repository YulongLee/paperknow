import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {formulaMathMLMarkup} from '../src/research-formula-core.js';
import {renderFormulaMathML} from '../src/research-formula.js';
import {formulaTemplates} from '../dist/workspace/research-formula-catalog.mjs';
const namespace='http://www.w3.org/1998/Math/MathML';
const dom=new JSDOM();
const parse=markup=>new dom.window.DOMParser().parseFromString(markup,'application/xml');
test.after(()=>dom.window.close());

test('MathML export compiles the actual fraction, root and script tree instead of wrapping source text or SVG',()=>{
 const latex=String.raw`\frac{x_1^2}{\sqrt{y}}`,result=formulaMathMLMarkup(latex),xml=parse(result.markup);
 assert.equal(result.latex,latex);assert.equal(xml.querySelector('parsererror'),null);assert.equal(xml.documentElement.localName,'math');assert.equal(xml.documentElement.namespaceURI,namespace);
 assert.equal(xml.documentElement.getAttribute('display'),'block');assert.equal(xml.querySelectorAll('mfrac').length,1);assert.equal(xml.querySelectorAll('msubsup').length,1);assert.equal(xml.querySelectorAll('msqrt').length,1);
 assert.equal(xml.querySelector('mfrac > msubsup > mi').textContent,'x');assert.equal(xml.querySelector('mfrac > msqrt > mi').textContent,'y');assert.equal(xml.querySelector('svg,annotation,script,foreignObject'),null);
 assert.equal(renderFormulaMathML(latex),result.markup);
});

test('matrix and chemistry export preserve editable mathematical structure and Unicode operators',()=>{
 const matrix=parse(renderFormulaMathML(String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`));assert.equal(matrix.querySelectorAll('mtable').length,1);assert.equal(matrix.querySelectorAll('mtr').length,2);assert.equal(matrix.querySelectorAll('mtd').length,4);assert.deepEqual([...matrix.querySelectorAll('mtd')].map(node=>node.textContent.trim()),['a','b','c','d']);
 const chemistry=parse(renderFormulaMathML(String.raw`\ce{2H2 + O2 -> 2H2O}`));assert.equal(chemistry.querySelector('parsererror'),null);assert.ok(chemistry.querySelectorAll('msub').length>=3);assert.ok([...chemistry.querySelectorAll('mi')].some(node=>node.textContent==='H'));assert.ok([...chemistry.querySelectorAll('mo')].some(node=>node.textContent==='⟶'));
});

test('all curated formulas produce bounded namespace-correct MathML with no external or active content',()=>{
 for(const item of formulaTemplates){
  const markup=renderFormulaMathML(item.formula),xml=parse(markup);assert.ok(markup.length<=512000,item.id);assert.equal(xml.querySelector('parsererror'),null,item.id);
  for(const node of xml.querySelectorAll('*')){assert.equal(node.namespaceURI,namespace,item.id);assert.ok(!['script','foreignObject','image','img','a','mglyph','maction','annotation-xml'].includes(node.localName),item.id);for(const attr of node.attributes)assert.ok(!/^(?:on|href$|src$|style$|class$|id$)/i.test(attr.name),item.id+' '+attr.name);}
 }
});

test('MathML text is XML escaped while external resources and dynamic TeX extensions fail closed',()=>{
 const xml=parse(renderFormulaMathML(String.raw`\text{A < B & C <script>}`));assert.equal(xml.querySelector('script'),null);assert.equal(xml.querySelector('mtext').textContent,'A < B & C <script>');
 for(const latex of [String.raw`\href{https://example.test}{x}`,String.raw`\require{html}`,String.raw`\newcommand{\x}{x}`,String.raw`\mmlToken{mi}[href="https://example.test"]{x}`,String.raw`\mmlToken{mi}[style="color:red"]{x}`,String.raw`\mmlToken{mglyph}[src="https://example.test/x"]{x}`,String.raw`\mmlToken{mi}[onclick="alert(1)"]{x}`,String.raw`\frac{1}`,String.raw`\unknown{x}`])assert.throws(()=>renderFormulaMathML(latex));
 assert.throws(()=>renderFormulaMathML('x'.repeat(2001)),/2000/);
});

test('separate MathML exports cannot share equation labels or compiler state',()=>{
 for(let i=0;i<3;i++){const xml=parse(renderFormulaMathML(String.raw`\boldsymbol{x}_i+\cancel{y}`));assert.equal(xml.querySelector('parsererror'),null);assert.ok(xml.querySelector('menclose'));}
 for(const latex of [String.raw`x\label{same}`,String.raw`\ref{same}`,String.raw`x\tag{1}`])assert.throws(()=>renderFormulaMathML(latex),/跨公式引用/);
});
