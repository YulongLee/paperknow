import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {advancedMathTemplates} from '../dist/workspace/research-formula-advanced-math.mjs';
import {formulaSvgMarkup} from '../src/research-formula-core.js';
import {renderFormulaSvg} from '../src/research-formula.js';

test('advanced math library contains independent identifiable formulas with original conditions',()=>{
 assert.ok(advancedMathTemplates.length>=120&&advancedMathTemplates.length<=180);
 assert.equal(new Set(advancedMathTemplates.map(row=>row.id)).size,advancedMathTemplates.length);
 assert.equal(new Set(advancedMathTemplates.map(row=>row.formula)).size,advancedMathTemplates.length);
 for(const row of advancedMathTemplates){assert.match(row.id,/^advanced-[a-z0-9-]+$/);assert.equal(row.subject,'math');assert.equal(row.level,'university');assert.ok(row.title.length>3);assert.ok(row.description.trim().length>=8,row.id);assert.ok(row.formula.length<=2000);assert.ok(row.category);assert.ok(Array.isArray(row.topics));assert.doesNotMatch(row.description,/已验证所有数值|运行仿真|保证正确/);}
});

test('advanced formulas cover every special function family observed in the competitor taxonomy',()=>{
 const categories=new Set(advancedMathTemplates.map(row=>row.category));
 for(const category of ['3j、6j、9j 符号','Airy 函数及相关函数','Gamma 函数','q-超几何函数及相关函数','Theta 函数','Zeta 函数及相关函数','不完全 Gamma 函数及相关函数','亨函数','伯努利多项式与欧拉多项式','合并鞍点积分','勒让德函数及相关函数','合流超几何函数','多维 Theta 函数','广义超几何函数与梅耶尔 G 函数','库仑函数','抛物柱函数','拉梅函数','指数、对数、正弦和余弦积分','数值方法','数论函数','斯特鲁夫函数及相关函数','椭圆积分','正交多项式','渐近逼近','球面波函数','Painlevé 超越函数（潘勒韦）','矩阵参数函数','维尔斯特拉斯椭圆函数与模函数','误差函数、道森函数与菲涅尔积分','贝塞尔函数','超几何函数','雅可比椭圆函数','马蒂厄函数与希尔方程'])assert.ok(categories.has(category),category);
});

test('every advanced formula is accepted by the real bounded compiler without remote resources',()=>{
 const dom=new JSDOM();const previous={DOMParser:globalThis.DOMParser,XMLSerializer:globalThis.XMLSerializer};
 try{globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
  for(const row of advancedMathTemplates){const result=formulaSvgMarkup(row.formula);assert.equal(result.latex,row.formula);assert.match(result.markup,/<svg/,row.id);const markup=renderFormulaSvg(row.formula),svg=new DOMParser().parseFromString(markup,'image/svg+xml');assert.equal(svg.querySelector('parsererror,script,foreignObject,image,a'),null,row.id);assert.ok(svg.querySelector('path'),row.id);for(const element of svg.querySelectorAll('*'))for(const attribute of element.attributes)if(/href$/.test(attribute.name))assert.match(attribute.value,/^#[A-Za-z0-9_-]+$/,row.id);}
 }finally{for(const key of Object.keys(previous))if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];dom.window.close();}
});

test('specialized conventions retain the necessary branch, normalization and non-equality cautions',()=>{
 const get=id=>advancedMathTemplates.find(row=>row.id==='advanced-'+id);
 for(const id of ['gamma-integral','gauss-series','tricomi-integral','q-binomial','matrix-gamma','elliptic-third'])assert.match(get(id).description,/>|<|≥|≤|非零|正|收敛/);
 assert.match(get('theta-one').description,/e\^\{?iπτ|q=e/);assert.match(get('modular-discriminant').description,/不同/);
 for(const id of ['airy-asymptotic','stirling-gamma'])assert.match(get(id).description,/精确|有限/);
 assert.match(get('airy-canonical-integral').description,/振荡.*积分/);assert.match(get('pearcey-model').description,/振荡.*积分/);
 assert.match(get('painleve-one').description,/不是 Peano/);
 assert.match(get('bessel-y').description,/不是整数/);assert.match(get('bessel-k').description,/不是整数/);
 assert.match(get('associated-legendre').description,/Condon/);assert.match(get('parabolic-cylinder-hermite').description,/物理学家/);
 assert.match(get('bisection-bound').description,/n 次.*中点/);
});
