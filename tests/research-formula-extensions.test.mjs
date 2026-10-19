import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {formulaSvgMarkup} from '../src/research-formula-core.js';
import {renderFormulaSvg} from '../src/research-formula.js';
import {formulaSymbolGroups} from '../dist/workspace/research-formula-catalog.mjs';

const formulas=['\\ce{2H2 + O2 -> 2H2O}','\\ce{^{14}_{6}C}','\\ce{[Cu(NH3)4]^2+}','\\ce{CO2 + C <=> 2CO}','\\ce{A ->[heat] B}','\\pu{8.314 J mol-1 K-1}','\\cancel{x}','\\cancelto{0}{x}','90\\degree','\\boldsymbol{\\beta}=\\boldsymbol{X}'];
test('chemical equations, ions, isotopes, units and scientific editing symbols compile without dynamic packages',()=>{
 for(const latex of formulas){const result=formulaSvgMarkup(latex);assert.equal(result.latex,latex);assert.match(result.markup,/<svg/);assert.match(result.markup,/<path/);assert.doesNotMatch(result.markup,/<(?:script|foreignObject|image|a)\b/);assert.ok(result.markup.length<100000);}
});
test('every insertable symbol in the expanded toolbar is supported by the actual bounded compiler',()=>{
 for(const group of formulaSymbolGroups)for(const [label,token] of group.tokens){
  assert.ok(label&&token,group.id);const latex=/^[\^_]/.test(token)?'a'+token:token;
  assert.doesNotThrow(()=>formulaSvgMarkup(latex),group.id+' / '+label+' / '+token);
 }
});
test('extended chemistry and cancellation SVG survives the same strict browser sanitizer',()=>{
 const dom=new JSDOM();const previous={DOMParser:globalThis.DOMParser,XMLSerializer:globalThis.XMLSerializer};
 try{globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
  for(const latex of formulas){const markup=renderFormulaSvg(latex),parsed=new DOMParser().parseFromString(markup,'image/svg+xml');assert.equal(parsed.querySelector('parsererror,script,foreignObject,image,a'),null);assert.match(markup,/<path/);assert.equal(parsed.documentElement.getAttribute('aria-label'),latex);for(const element of parsed.querySelectorAll('*'))for(const attribute of element.attributes)if(/href$/.test(attribute.name))assert.match(attribute.value,/^#[A-Za-z0-9_-]+$/);}
 }finally{for(const key of Object.keys(previous))if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];dom.window.close();}
});
test('static scientific extensions do not enable external resources, executable markup or user macro definitions',()=>{
 for(const latex of ['\\require{mhchem}\\ce{H2O}','\\autoload{html}','\\href{https://example.test}{x}','\\htmlClass{x}{y}','\\includegraphics{private}','\\newcommand{\\steal}{x}\\steal','\\def\\steal{x}','\\ce{H2O}\\tag{1}','\\DeclarePairedDelimiter{\\abs}{|}{|}'])assert.throws(()=>formulaSvgMarkup(latex));
 assert.throws(()=>formulaSvgMarkup('a'.repeat(2001)),/2000/);
 for(let i=0;i<3;i++)assert.match(formulaSvgMarkup('\\ce{H2O}').markup,/<path/);
});
