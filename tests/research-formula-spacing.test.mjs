import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {insertFormulaToken,formulaSpacingRepair} from '../dist/workspace/research-formula-catalog.mjs';
import {formulaSvgMarkup,formulaMathMLMarkup} from '../src/research-formula-core.js';
import {createFormulaDocx} from '../src/research-formula-document.js';
const math=source=>formulaMathMLMarkup(source).markup;
test('inserting an intersection before S preserves the intersection operator in SVG, MathML and editable Word',async()=>{
 const result=insertFormulaToken('AS',String.raw`\cap`,1,1);assert.equal(result.value,String.raw`A\cap S`);assert.equal(result.start,6);
 assert.match(formulaSvgMarkup(result.value).markup,/<svg/);const markup=math(result.value);assert.equal(new DOMParser().parseFromString(markup,'application/xml').getElementsByTagName('mo')[0].textContent,'∩');assert.match(markup,/<mi>S<\/mi>/);
 const zip=await JSZip.loadAsync(await createFormulaDocx(markup)),xml=await zip.file('word/document.xml').async('string');assert.match(xml,/∩/);assert.doesNotMatch(xml,/\\capS/);assert.match(xml,/m:oMath/);
});
test('a command inserted at the end remains terminated when the next variable is typed',()=>{
 for(const command of [String.raw`\cap`,String.raw`\cup`,String.raw`\alpha`,String.raw`\sin`,String.raw`\log`,String.raw`\subseteq`]){
  const inserted=insertFormulaToken('A',command),typed=inserted.value.slice(0,inserted.start)+'S'+inserted.value.slice(inserted.end);
  assert.equal(typed,'A'+command+' S');assert.doesNotThrow(()=>formulaSvgMarkup(typed));
 }
});
test('letters inserted after existing control words receive a separator while ordinary variables and escaped slashes do not change',()=>{
 assert.equal(insertFormulaToken(String.raw`A\cap`,'S').value,String.raw`A\cap S`);
 assert.equal(insertFormulaToken('ab','c',1,1).value,'acb');
 assert.equal(insertFormulaToken(String.raw`\\cap`,'S').value,String.raw`\\capS`);
 const spaced=insertFormulaToken(' S',String.raw`\cap`,0,0);assert.equal(spaced.value,String.raw`\cap S`);assert.equal(spaced.start,5);
});
test('selection replacement and placeholder positioning retain their original behavior',()=>{
 assert.deepEqual(insertFormulaToken('x+y',String.raw`\frac{}{}`,2,3),{value:String.raw`x+\frac{}{}`,start:8,end:8});
 assert.deepEqual(insertFormulaToken(String.raw`\alpha`,String.raw`\sqrt{}`,0,6),{value:String.raw`\sqrt{}`,start:6,end:6});
});
test('spacing suggestions repair only a known command followed by one variable and respect escaped control sequences',()=>{
 const repaired=formulaSpacingRepair(String.raw`A\capS+B\capS`,String.raw`Undefined control sequence \capS`);assert.equal(repaired.value,String.raw`A\cap S+B\cap S`);assert.doesNotThrow(()=>math(repaired.value));
 assert.equal(formulaSpacingRepair(String.raw`\\capS+\capS`,String.raw`Undefined control sequence \capS`).value,String.raw`\\capS+\cap S`);
 for(const [source,error]of [[String.raw`\unknown`,String.raw`Undefined control sequence \unknown`],[String.raw`\capSS`,String.raw`Undefined control sequence \capSS`],[String.raw`\cosh`,String.raw`Undefined control sequence \cosh`],[String.raw`\verb|\capS|+\capS`,String.raw`Undefined control sequence \capS`],['x','Other renderer failure']])assert.equal(formulaSpacingRepair(source,error),null);
});
