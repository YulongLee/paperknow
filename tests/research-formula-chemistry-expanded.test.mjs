import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {expandedChemistryTemplates,expandedChemistryCategoryTaxonomy} from '../dist/workspace/research-formula-chemistry-expanded.mjs';
import {formulaSvgMarkup} from '../src/research-formula-core.js';
import {renderFormulaSvg} from '../src/research-formula.js';

// A small independent stoichiometry checker for the explicit chemical notation
// used by this library. Unsupported syntax fails rather than silently skipping.
const elements=new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn'.split(' '));
function composition(raw){
 let value=raw.replace(/\((?:s|l|g|aq)\)$/,'');
 const coefficient=Number(value.match(/^\d+/)?.[0]||1);value=value.replace(/^\d+/,'');
 let charge=0;
 const chargeMatch=value.match(/\^(\d+)([+-])$|([+-])$/);
 if(chargeMatch){charge=(chargeMatch[2]==='-'||chargeMatch[3]==='-'?-1:1)*Number(chargeMatch[1]||1);value=value.slice(0,chargeMatch.index);}
 if(value==='e'){assert.equal(charge,-1,'电子必须带一个负电荷');return {atoms:{},charge:coefficient*charge};}
 let cursor=0;
 const number=()=>{const match=value.slice(cursor).match(/^\d+/);if(!match)return 1;cursor+=match[0].length;const n=Number(match[0]);assert.ok(n>0&&Number.isSafeInteger(n));return n;};
 function group(nested=false){const atoms={};while(cursor<value.length){if(value[cursor]===')'){assert.ok(nested,'意外右括号');cursor++;return atoms;}if(value[cursor]==='('){cursor++;const inner=group(true),n=number();for(const [key,count]of Object.entries(inner))atoms[key]=(atoms[key]||0)+count*n;continue;}const symbol=value.slice(cursor).match(/^[A-Z][a-z]?/)?.[0];assert.ok(symbol&&elements.has(symbol),'无法解析物种 '+raw+' 中 '+value.slice(cursor));cursor+=symbol.length;atoms[symbol]=(atoms[symbol]||0)+number();}assert.equal(nested,false,'未闭合括号');return atoms;}
 const atoms=group();return{atoms:Object.fromEntries(Object.entries(atoms).map(([key,count])=>[key,count*coefficient])),charge:coefficient*charge};
}
function side(value){const result={atoms:{},charge:0};for(const raw of value.trim().split(/\s+\+\s+/)){const species=composition(raw.trim());for(const [key,count]of Object.entries(species.atoms))result.atoms[key]=(result.atoms[key]||0)+count;result.charge+=species.charge;}result.atoms=Object.fromEntries(Object.entries(result.atoms).sort(([a],[b])=>a.localeCompare(b)));return result;}
function equationParts(row){assert.match(row.formula,/^\\ce\{.+\}$/);const equation=row.formula.slice(4,-1),parts=equation.split(/\s*(?:<=>|->)\s*/);assert.equal(parts.length,2,row.id);return parts;}

test('chemical equations have independent identifiers and cover all 41 observed chemistry classifications',()=>{
 assert.ok(expandedChemistryTemplates.length>=100&&expandedChemistryTemplates.length<=150);
 assert.equal(expandedChemistryCategoryTaxonomy.length,41);
 assert.equal(new Set(expandedChemistryTemplates.map(item=>item.id)).size,expandedChemistryTemplates.length);
 assert.equal(new Set(expandedChemistryTemplates.map(item=>item.formula)).size,expandedChemistryTemplates.length);
 for(const category of expandedChemistryCategoryTaxonomy)assert.ok(expandedChemistryTemplates.some(item=>item.topics.includes(category)),category);
 for(const item of expandedChemistryTemplates){assert.match(item.id,/^chem-expanded-[a-z0-9-]+$/);assert.equal(item.subject,'chemistry');assert.ok(['junior','high','university'].includes(item.level));assert.ok(expandedChemistryCategoryTaxonomy.includes(item.category));assert.ok(item.description.length>=12,item.id);assert.ok(item.topics.every(category=>expandedChemistryCategoryTaxonomy.includes(category)));}
});

test('every chemical equation conserves each element and net electric charge, including electrode half reactions',()=>{
 for(const row of expandedChemistryTemplates){const [left,right]=equationParts(row);assert.deepEqual(side(left),side(right),row.id+'：'+row.formula);}
 // These checks make sure a broken checker cannot simply accept everything.
 assert.notDeepEqual(side('H2 + O2'),side('H2O'));
 assert.notDeepEqual(side('Cu^2+(aq) + e-'),side('Cu(s)'));
 assert.deepEqual(side('2Al^3+(aq) + 3CO3^2-(aq) + 3H2O(l)'),side('2Al(OH)3(s) + 3CO2(g)'));
});

test('every chemistry formula compiles to a real safe SVG using the production mhchem renderer',()=>{
 const dom=new JSDOM(),previous={DOMParser:globalThis.DOMParser,XMLSerializer:globalThis.XMLSerializer};
 try{globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
  for(const row of expandedChemistryTemplates){const value=formulaSvgMarkup(row.formula);assert.equal(value.latex,row.formula);assert.match(value.markup,/<svg/,row.id);const markup=renderFormulaSvg(row.formula),svg=new DOMParser().parseFromString(markup,'image/svg+xml');assert.equal(svg.querySelector('parsererror,script,foreignObject,image,a,[data-mml-node="merror"]'),null,row.id);assert.ok(svg.querySelector('path'),row.id);}
 }finally{for(const key of Object.keys(previous))if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];dom.window.close();}
});

test('condition-sensitive relationships distinguish dilute/concentrated acids, cold/hot alkali, melt and aqueous ions',()=>{
 const get=id=>expandedChemistryTemplates.find(item=>item.id==='chem-expanded-'+id);
 assert.match(get('cu-concentrated-hno3').description,/浓硝酸/);assert.match(get('cu-dilute-hno3').description,/稀硝酸/);
 assert.match(get('cu-concentrated-h2so4').description,/不能套用于稀/);
 assert.match(get('chlorine-cold-base').description,/冷.*稀.*热浓碱/);assert.match(get('chlorine-hot-base').description,/热浓碱/);
 for(const id of ['molten-nacl-ionization','molten-mgcl2-ionization','molten-cacl2-ionization']){assert.doesNotMatch(get(id).formula,/\(aq\)/);assert.match(get(id).description,/熔/);}
 assert.match(get('molten-nacl-electrolysis').description,/不可套用于.*水溶液/);
 assert.match(get('permanganate-iron').description,/酸性.*中性.*碱性/);
 assert.match(get('al-first-hydrolysis').description,/配位水/);assert.match(get('aloh3-base').description,/四羟基合铝/);
 assert.match(get('ammonia-catalytic-oxidation').description,/催化条件/);
 assert.match(get('alumina-carbon-anode').description,/炭阳极/);
});
