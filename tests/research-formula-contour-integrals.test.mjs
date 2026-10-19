import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {formulaSvgMarkup,formulaMathMLMarkup} from '../src/research-formula-core.js';
import {renderFormulaSvg} from '../src/research-formula.js';
import {mathmlToOmml} from '../src/research-formula-document.js';
import {validateFormulaArtifact} from '../backend/artifact-formula-validation.mjs';

test('closed surface and closed triple integrals have semantic operators and portable local SVG glyphs in both sizes',()=>{
 const dom=new JSDOM();
 try{
  for(const [command,code]of [['\\oiint','222F'],['\\oiiint','2230']])for(const [style,variant]of [['','LO'],['\\textstyle ','SO'],['\\scriptstyle ','SO']]){
   const source=style+command+'_{D}f\\,dV',svg=formulaSvgMarkup(source).markup;
   const xml=new dom.window.DOMParser().parseFromString(svg,'image/svg+xml');
   assert.equal(xml.querySelector('parsererror,text,foreignObject,image,script'),null,source);
   const path=[...xml.querySelectorAll('path')].find(node=>node.id.endsWith('-'+variant+'-'+code));
   assert.ok(path,source);assert.match(path.getAttribute('d'),/C/,'the enclosing ring is a bundled vector contour');
   assert.ok(path.getAttribute('d').length>1000,source);
   for(const use of xml.querySelectorAll('use'))assert.match(use.getAttribute('xlink:href')||use.getAttribute('href'),/^#/);
   const mathml=formulaMathMLMarkup(source).markup,tree=new dom.window.DOMParser().parseFromString(mathml,'application/xml');
   assert.equal(tree.querySelector('parsererror'),null);assert.equal(tree.querySelector('mo').textContent,String.fromCodePoint(parseInt(code,16)));
   assert.doesNotThrow(()=>validateFormulaArtifact('tex',Buffer.from(source)));
   assert.doesNotThrow(()=>validateFormulaArtifact('mml',Buffer.from(mathml)));
   assert.ok(mathmlToOmml(mathml).includes(String.fromCodePoint(parseInt(code,16))),'native Word math keeps the actual operator');
  }
 }finally{dom.window.close();}
});

test('closed double/triple operators remain distinct from the genuine fourfold integral, including pasted Unicode',()=>{
 const dom=new JSDOM();
 try{
  const xml=new dom.window.DOMParser().parseFromString(formulaMathMLMarkup('\\oiint+\\oiiint+\\iiiint').markup,'application/xml');
  assert.deepEqual([...xml.querySelectorAll('mo')].map(node=>node.textContent),['∯','+','∰','+','⨌']);
  const pasted=formulaSvgMarkup('∯+∰').markup;assert.doesNotMatch(pasted,/<text\b|data-mjx-unknown/);assert.match(pasted,/-LO-222F/);assert.match(pasted,/-LO-2230/);
 }finally{dom.window.close();}
});

test('new local contours survive browser sanitation without enabling user macros or external fonts',()=>{
 const dom=new JSDOM(),previous={DOMParser:globalThis.DOMParser,XMLSerializer:globalThis.XMLSerializer};
 try{
  globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
  const svg=renderFormulaSvg('\\oiint_{\\partial V}\\mathbf{F}\\cdot\\mathbf{n}\\,dS');
  assert.match(svg,/<path/);assert.doesNotMatch(svg,/<text\b|<image\b|@font-face|https?:\/\/(?!www\.w3\.org)/);
  for(const unsafe of ['\\newcommand{\\oiint}{x}\\oiint','\\def\\oiint{x}\\oiint','\\require{esint}\\oiint','\\mmlToken{mo}[href="https://example.test"]{∯}']){
   assert.throws(()=>formulaMathMLMarkup(unsafe),unsafe);
  }
  assert.equal(formulaMathMLMarkup('\\oiint').markup,formulaMathMLMarkup('\\oiint').markup);
 }finally{for(const key of Object.keys(previous))if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];dom.window.close();}
});
