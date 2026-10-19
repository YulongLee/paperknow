import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {formulaSvgMarkup,formulaMathMLMarkup} from '../src/research-formula-core.js';

const normalizeIds=markup=>markup.replace(/MJX-paperknow-\d+-/g,'MJX-render-');

test('separate SVG formulas have distinct local glyph IDs and resolve every reference within their own SVG',()=>{
 const dom=new JSDOM('<main></main>');
 try{
  const source=String.raw`\oiint_{\partial V}\mathbf{F}\cdot\mathbf{n}\,dS+\frac{x^2}{\sqrt y}`;
  const markups=[formulaSvgMarkup(source).markup,formulaSvgMarkup(String.raw`\textstyle\oiint+\oiiint`).markup,formulaSvgMarkup(source).markup];
  dom.window.document.querySelector('main').innerHTML=markups.join('');
  const allIds=[...dom.window.document.querySelectorAll('[id]')].map(node=>node.id);
  assert.equal(new Set(allIds).size,allIds.length,'SVGs displayed together must not duplicate glyph IDs');
  for(const svg of dom.window.document.querySelectorAll('svg')){
   const ownIds=new Set([...svg.querySelectorAll('[id]')].map(node=>node.id));
   assert.ok(ownIds.size>0);
   for(const use of svg.querySelectorAll('use')){
    const href=use.getAttribute('xlink:href')||use.getAttribute('href');
    assert.match(href,/^#[A-Za-z0-9_-]+$/);assert.ok(ownIds.has(href.slice(1)),href);
   }
  }
  assert.equal(normalizeIds(markups[0]),normalizeIds(markups[2]),'render IDs do not alter the glyphs or geometry');
 }finally{dom.window.close();}
});

test('mixed SVG and MathML conversions cannot change later parser state, font variants or contour glyphs',()=>{
 const source=String.raw`\oiint+\oiiint+x+\boldsymbol{y}+\cancel{z}`;
 const initialSvg=normalizeIds(formulaSvgMarkup(source).markup),initialMathML=formulaMathMLMarkup(source).markup;
 for(const formula of [String.raw`\bf x`,String.raw`\textstyle\oiint`,String.raw`\scriptstyle\oiiint`,String.raw`\ce{2H2 + O2 -> 2H2O}`,String.raw`\begin{align}a&=b\\c&=d\end{align}`]){
  formulaSvgMarkup(formula);formulaMathMLMarkup(formula);
  assert.equal(normalizeIds(formulaSvgMarkup(source).markup),initialSvg);
  assert.equal(formulaMathMLMarkup(source).markup,initialMathML);
 }
});

test('rejected or incomplete formulas do not poison a subsequent conversion or retain a macro',()=>{
 const source=String.raw`\frac{x_1}{\sqrt y}+\ce{H2O}`;
 const initialSvg=normalizeIds(formulaSvgMarkup(source).markup),initialMathML=formulaMathMLMarkup(source).markup;
 for(const formula of [String.raw`\newcommand{\paperknowLeak}{x}`,String.raw`\def\paperknowLeak{x}`,String.raw`\frac{1}`,String.raw`\unknown{x}`,String.raw`\begin{align}x&=y`,String.raw`\mmlToken{mi}[style="color:red"]{x}`]){
  assert.throws(()=>formulaMathMLMarkup(formula),formula);
  assert.equal(formulaMathMLMarkup(source).markup,initialMathML);
  assert.equal(normalizeIds(formulaSvgMarkup(source).markup),initialSvg);
 }
 assert.throws(()=>formulaMathMLMarkup(String.raw`\paperknowLeak`));
 assert.throws(()=>formulaSvgMarkup(String.raw`\paperknowLeak`));
});
