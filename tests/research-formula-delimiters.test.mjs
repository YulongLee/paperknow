import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {formulaSvgMarkup,formulaMathMLMarkup,unwrapFormulaDelimiters} from '../src/research-formula-core.js';
import {unwrapFormulaDelimiters as browserUnwrap,renderFormulaMathML} from '../src/research-formula.js';

test('four matching outer LaTeX delimiters compile the same genuine mathematical tree and preserve the source for copy',()=>{
 const body=String.raw`\frac{x_1^2}{\sqrt y}`,plain=formulaMathMLMarkup(body).markup;
 for(const source of ['$'+body+'$','$$'+body+'$$',String.raw`\(`+body+String.raw`\)`,String.raw`\[`+body+String.raw`\]`]){
  assert.equal(unwrapFormulaDelimiters(source),body);assert.equal(browserUnwrap(' \n'+source+' \n'),body);
  assert.equal(formulaMathMLMarkup(source).markup,plain);assert.equal(formulaMathMLMarkup(source).latex,source);assert.equal(formulaSvgMarkup(source).latex,source);assert.match(formulaSvgMarkup(source).markup,/<svg/);
 }
});

test('unmatched, empty, nested and mixed wrappers fail before a generated result can be adopted',()=>{
 for(const source of ['$x','x$','$$x$','$x$$',String.raw`\(x\]`,String.raw`x\)`,String.raw`\[x\)`,String.raw`\[x`,String.raw`x\]`,'$$ $$$','$$$$','$$$x$$$','$ $','$$ $$',String.raw`\(\)`,String.raw`\[\]`,String.raw`\($x$\)`]){
  assert.throws(()=>unwrapFormulaDelimiters(source),source);assert.throws(()=>formulaSvgMarkup(source),source);assert.throws(()=>formulaMathMLMarkup(source),source);
 }
 assert.equal(unwrapFormulaDelimiters(String.raw`x\$`),String.raw`x\$`);
});

test('wrapping cannot bypass source length, prohibited commands or safe MathML escaping',()=>{
 for(const source of [String.raw`$\href{https://example.test}{x}$`,String.raw`$$\newcommand{\x}{x}$$`,String.raw`\(\require{html}\)`,String.raw`\[\htmlClass{x}{y}\]`,'$'+'x'.repeat(2000)+'$'])assert.throws(()=>unwrapFormulaDelimiters(source));
 for(const source of [String.raw`$\mmlToken{mi}[href="https://example.test"]{x}$`,String.raw`\[\mmlToken{mglyph}[src="https://example.test/x"]{x}\]`])assert.throws(()=>renderFormulaMathML(source));
 const dom=new JSDOM();try{const xml=new dom.window.DOMParser().parseFromString(renderFormulaMathML(String.raw`\(\text{<script> & text}\)`),'application/xml');assert.equal(xml.querySelector('parsererror,script'),null);assert.equal(xml.querySelector('mtext').textContent,'<script> & text');}finally{dom.window.close();}
 for(const invalid of ['\uD800','\uDC00','\uFFFE','\uFFFF']){assert.throws(()=>unwrapFormulaDelimiters('x'+invalid));assert.throws(()=>formulaMathMLMarkup('x'+invalid));assert.throws(()=>formulaSvgMarkup('x'+invalid));}
 assert.doesNotThrow(()=>formulaMathMLMarkup(String.raw`\text{研究 α 𝑥}`));
});
