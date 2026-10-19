import test from 'node:test';
import assert from 'node:assert/strict';
import {chemicalSymbolAdditions,chemicalSymbolReferenceMappings} from '../dist/workspace/research-formula-chemical-symbols.mjs';
import {formulaSvgMarkup,formulaMathMLMarkup} from '../src/research-formula-core.js';

function particle(token){
 assert.match(token,/^\\ce\{[A-Za-z0-9()[\]^+-]+\}$/);let source=token.slice(4,-1),charge=0;const chargePart=source.match(/\^(\d+)([+-])$|([+-])$/);
 if(chargePart){charge=(chargePart[2]==='-'||chargePart[3]==='-'?-1:1)*Number(chargePart[1]||1);source=source.slice(0,chargePart.index);}
 let cursor=0;function count(){const text=source.slice(cursor).match(/^\d+/)?.[0];if(!text)return 1;cursor+=text.length;return Number(text);}
 function atoms(end){const result={};while(cursor<source.length){const char=source[cursor];if(char===end){cursor++;return result;}if(char==='('||char==='['){cursor++;const group=atoms(char==='('?')':']'),n=count();for(const [key,value]of Object.entries(group))result[key]=(result[key]||0)+value*n;continue;}const symbol=source.slice(cursor).match(/^[A-Z][a-z]?/)?.[0];assert.ok(symbol,'无法解析 '+source.slice(cursor));cursor+=symbol.length;result[symbol]=(result[symbol]||0)+count();}assert.equal(end,undefined,'未闭合括号');return result;}
 const composition=atoms();return{atoms:composition,charge};
}

test('chemical symbol additions preserve independent meanings and map all 175 observed UI positions',()=>{
 assert.deepEqual(Object.keys(chemicalSymbolAdditions),['chem-compounds','chem-ions','chemistry']);
 for(const [group,tokens]of Object.entries(chemicalSymbolAdditions)){assert.ok(tokens.length>10,group);assert.equal(new Set(tokens.map(([label])=>label)).size,tokens.length,group);assert.equal(new Set(tokens.map(([,token])=>token)).size,tokens.length,group);}
 for(const [group,total]of [['CO化学物质',33],['Na⁺化学离子',35],['H化学元素',80],['化学符号',27]]){const rows=chemicalSymbolReferenceMappings.filter(item=>item.referenceGroup===group);assert.equal(rows.length,total);assert.deepEqual(rows.map(row=>row.referenceIndex),Array.from({length:total},(_,index)=>index));for(const row of rows){assert.ok(row.label&&row.token&&row.referenceLabel);assert.equal(typeof row.correctionNote,'string');}}
 assert.equal(chemicalSymbolReferenceMappings.length,175);
 const repeated=chemicalSymbolReferenceMappings.filter(row=>row.referenceGroup==='CO化学物质'&&row.referenceLabel==='氢氧化钙');assert.equal(repeated.length,2);assert.equal(repeated[0].token,repeated[1].token);
});

test('all new tokens and every existing target actually compile with the production MathJax mhchem renderer',()=>{
 for(const [label,token]of [...Object.values(chemicalSymbolAdditions).flat(),...chemicalSymbolReferenceMappings.map(row=>[row.label,row.token])]){const svg=formulaSvgMarkup(token);assert.match(svg.markup,/<svg\b/,label);assert.doesNotMatch(svg.markup,/data-mml-node="merror"/,label);assert.match(formulaMathMLMarkup(token).markup,/<math\b/,label);}
});

test('new compounds contain the correct elements and stoichiometric counts',()=>{
 const expected={氢气:{H:2},二氧化硫:{S:1,O:2},氧化铜:{Cu:1,O:1},氯酸钾:{K:1,Cl:1,O:3},硫酸铜:{Cu:1,S:1,O:4},碳酸氢钠:{Na:1,H:1,C:1,O:3},氧气:{O:2},硫化氢:{H:2,S:1},二氧化锰:{Mn:1,O:2},氢氧化铜:{Cu:1,O:2,H:2},高锰酸钾:{K:1,Mn:1,O:4},氧化钙:{Ca:1,O:1},氢氧化铁:{Fe:1,O:3,H:3},碳酸钠:{Na:2,C:1,O:3},氮气:{N:2},氯气:{Cl:2}};
 for(const [label,token]of chemicalSymbolAdditions['chem-compounds'])assert.deepEqual(particle(token),{atoms:expected[label],charge:0},label);
});

test('new ions retain atom composition, coordination count and signed net charge',()=>{
 const expected={锂离子:[{Li:1},1],锌离子:[{Zn:1},2],氟离子:[{F:1},-1],碘离子:[{I:1},-1],次氯酸根离子:[{Cl:1,O:1},-1],亚硫酸根离子:[{S:1,O:3},-2],乙酸根离子:[{C:2,H:3,O:2},-1],银氨络离子:[{Ag:1,N:2,H:6},1],氧离子:[{O:1},-2],铬酸根离子:[{Cr:1,O:4},-2],硫酸氢根离子:[{H:1,S:1,O:4},-1],氰根离子:[{C:1,N:1},-1],溴离子:[{Br:1},-1],硫离子:[{S:1},-2],硅酸根离子:[{Si:1,O:3},-2],硫代硫酸根离子:[{S:2,O:3},-2],硫氰根离子:[{S:1,C:1,N:1},-1]};
 for(const [label,token]of chemicalSymbolAdditions['chem-ions']){assert.ok(expected[label],label);assert.deepEqual(particle(token),{atoms:expected[label][0],charge:expected[label][1]},label);}
});

test('reference mistakes are corrected explicitly without inventing a particle charge or a chemical operator',()=>{
 const get=referenceLabel=>chemicalSymbolReferenceMappings.find(row=>row.referenceGroup==='化学符号'&&row.referenceLabel===referenceLabel);
 const neutron=get('中子（n⁻）');assert.equal(neutron.token,'{}^{1}_{0}\\mathrm{n}');assert.doesNotMatch(neutron.token,/-/);assert.match(neutron.correctionNote,/不带电/);
 const thorium=get('钍-227 离子');assert.equal(thorium.token,'{}^{227}_{90}\\mathrm{Th}');assert.match(thorium.correctionNote,/未指定电荷/);assert.doesNotMatch(thorium.token,/\^\{[+-]/);
 const water=get('氚化水（H³HO）');assert.equal(water.token,'{}^{3}_{1}\\mathrm{H}\\mathrm{H}\\mathrm{O}');assert.equal((water.token.match(/\\mathrm\{H\}/g)||[]).length,2);assert.match(water.correctionNote,/不是.*个数/);
 assert.equal(get('三线等号（反向）').token,get('三线等号（≡）').token);assert.match(get('三线等号（反向）').correctionNote,/没有单独/);
 assert.match(get('虚线等号').label,/近似排版/);assert.match(get('虚线等号').correctionNote,/不赋予.*化学意义/);
 const elements=chemicalSymbolReferenceMappings.filter(row=>row.referenceGroup==='H化学元素');assert.equal(new Set(elements.map(row=>row.token)).size,80);for(const [name,symbol]of [['氢','H'],['铝','Al'],['钾','K'],['铁','Fe'],['钴','Co'],['镍','Ni'],['铜','Cu'],['银','Ag'],['金','Au'],['汞','Hg']])assert.equal(elements.find(row=>row.referenceLabel===name).token,'\\mathrm{'+symbol+'}');
});
