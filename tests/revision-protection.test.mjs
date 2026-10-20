import test from 'node:test';
import assert from 'node:assert/strict';
import {revisionProtectionVersion,revisionProtectionRequirements,protectedRevisionSpans,validateRevisionOriginal,validateRevisionProtection} from '../dist/workspace/revision-protection.mjs';

const check=(original,revised)=>validateRevisionProtection(original,revised);
const values=text=>protectedRevisionSpans(text).map(span=>span.value);
test('exports a fixed version and honest instructions with safe validation metadata',()=>{
 assert.equal(revisionProtectionVersion,'revision-protection-v1');assert.match(revisionProtectionRequirements,/不得新增/);assert.match(revisionProtectionRequirements,/不能验证事实/);
 const result=check('Private original dose 5 mg.','Private original dose 6 mg.');assert.equal(result.valid,false);assert.equal(result.requiresReview,true);assert.equal(result.factsVerified,false);assert.equal(typeof result.minimumCharacters,'number');assert.doesNotMatch(JSON.stringify(result),/Private|dose|5 mg|6 mg/);assert.ok(result.issues.every(issue=>typeof issue.code==='string'&&Object.entries(issue).every(([key,value])=>key==='code'||typeof value==='number')));
});
test('unchanged protected spans allow ordinary prose editing',()=>{
 assert.equal(check('The dose was -3 mg and the uncertainty was ±2%.','The measured dose was -3 mg; its uncertainty was ±2%.').valid,true);
 assert.equal(check('A study has a measured result.','The study reports a measured result.').valid,true);
});
test('signed and scientific numbers retain their complete exact strings',()=>{
 const original='Values were -3, +4.2, −0.5, 1e-3, -2.5E+6, .25, ±2% and ∓2%.';assert.deepEqual(values(original),['-3','+4.2','−0.5','1e-3','-2.5E+6','.25','±2%','∓2%']);
 for(const [from,to] of [['-3','3'],['+4.2','4.2'],['−0.5','0.5'],['1e-3','1e+3'],['-2.5E+6','2.5E+6'],['±2%','2%'],['∓2%','±2%']])assert.equal(check(original,original.replace(from,to)).valid,false,from);
 assert.equal(check('The value is 2.5 × 10^{-3} mol.','The value is 2.5 × 10^{-3} mol.').valid,true);
 assert.equal(check('The value is 2.5 × 10^{-3} mol.','The value is 2.5 × 10^{3} mol.').valid,false);
});
test('common SI and compound units are bound to values and preserve exact spelling',()=>{
 for(const measure of ['5 mg/(kg·d)','3 m/s^2','2 kg m−3','20 °C','2 mmol·L⁻¹','4 μg/mL','5 N·m','10 m²','7 kPa','3 mg/kg/day']){
  assert.ok(values('Measured '+measure+'.').includes(measure),measure);
  assert.equal(check('Measured '+measure+'.','Measured '+measure.replace(/mg|kg|m|°C|mmol|μg|N|kPa/,v=>v==='mg'?'g':v==='m'?'cm':'changed')+'.').valid,false,measure);
 }
 assert.equal(check('The unit is mg/(kg·d).','The unit is mg/(kg·h).').valid,false);
 assert.equal(check('The concentration was 5mg.','The concentration was 5 mg.').valid,false);
});
test('the combined raw order rejects numerical bags and moved measurements',()=>{
 assert.equal(check('A has 10 mg and B has 20 mg.','A has 20 mg and B has 10 mg.').valid,false);
 assert.equal(check('A has 10 and B has 20.','A has 20 and B has 10.').valid,false);
 assert.equal(check('First 2 mg, then [1].','First [1], then 2 mg.').valid,false);
 assert.equal(check('Value is 2 mg.','Value is 2 mg and 3 mg.').valid,false);
 assert.equal(check('No quantitative result was stated.','No quantitative result was stated: 20%.').valid,false);
});
test('full inline, display, environments and MathML are opaque exact spans',()=>{
 for(const formula of [String.raw`\(x=-3\)`,String.raw`\[x^2=4\]`,'$x=-3$','$$x^2=4$$',String.raw`\begin{equation}x^2=4\end{equation}`,String.raw`\begin{align*}a&=1\\b&=2\end{align*}`,'<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>=</mo><mn>3</mn></math>']){
  const spans=protectedRevisionSpans('Equation '+formula+' remains.');assert.deepEqual(spans.map(span=>span.type),['math'],formula);assert.deepEqual(spans.map(span=>span.value),[formula]);assert.equal(check('Equation '+formula+' remains.','Equation '+formula.replace(/x|a/,v=>v==='x'?'y':'b')+' remains.').valid,false,formula);
 }
 assert.deepEqual(values('Before \\(x=2\\) after 3.'),[String.raw`\(x=2\)`,'3']);
 assert.equal(check('The formula is $x=2$.','The formula is x=2.').valid,false);
});
test('math delimiters report malformed explicit source input without raw text',()=>{
 for(const value of [String.raw`Text \(x=2`,String.raw`Text \[x=2`,String.raw`Text \) x`,String.raw`Text \] x`,'Text $$x=2','Text <math><mi>x</mi>','Text </math>',String.raw`Text \begin{equation}x=2`]){
  const result=validateRevisionOriginal(value);assert.equal(result.valid,false,value);assert.ok(result.issues.some(issue=>issue.code==='malformed_original_math'),value);assert.doesNotMatch(JSON.stringify(result),/Text|x=2|<math>/);
 }
 for(const value of ['The price is $20.','The prices are $20 and $30.','A lone $ is currency notation.',String.raw`The literal symbol is \$20.`,String.raw`The path uses \\( not an inline opener.`])assert.equal(validateRevisionOriginal(value).valid,true,value);
 assert.equal(check('The statement is unchanged.','The statement has \\(broken math.').valid,false);
});
test('currency dollars never consume a following inline formula and numeric formulas remain supported',()=>{
 const original='Price $20 then $x=2$.';assert.deepEqual(values(original),['20','$x=2$']);
 assert.equal(check(original,'The price is $20; then $x=2$.').valid,true);
 assert.equal(check(original,'Price $20 then $y=2$.').valid,false);
 assert.deepEqual(values('Price $20 then$x=2$.'),['20','$x=2$']);
 assert.deepEqual(values('Calculate $2+3$ and $2 + 3 $.'),['$2+3$','$2 + 3 $']);
 assert.deepEqual(values('Costs $20 and $30; equation $x=2$.'),['20','30','$x=2$']);
});
test('source and numeric citations are complete spans with no nested numeric tokens',()=>{
 const text='Results [source:paper-12] follow [1, 3–5] and [7].';assert.deepEqual(values(text),['[source:paper-12]','[1, 3–5]','[7]']);
 for(const revised of [text.replace('paper-12','paper-21'),text.replace('[1, 3–5]','[1, 3–6]'),text.replace('[7]',''),text+' [8]'])assert.equal(check(text,revised).valid,false);
});
test('common author-year citations retain author, year, suffix and whole order',()=>{
 for(const citation of ['(Smith et al., 2020)','Smith (2020)','Smith and Jones (2021a)','(Smith, 2020; Jones, 2021)','张三等（2020）','（张三，2020）']){
  assert.deepEqual(values(citation),[citation],citation);assert.equal(check('Study '+citation+' supports this statement.','Study '+citation.replace('202','201')+' supports this statement.').valid,false,citation);
 }
 assert.equal(check('Smith (2020) precedes Jones (2021).','Jones (2021) precedes Smith (2020).').valid,false);
 assert.equal(check('(Smith, 2020) and (Jones, 2021).','(Jones, 2020) and (Smith, 2021).').valid,false);
});
test('cite/ref commands preserve complete optional and balanced mandatory arguments',()=>{
 for(const citation of [String.raw`\cite{Smith2020}`,String.raw`\citep[see][p. 2]{A2020,B2021}`,String.raw`\citet*{A2020}`,String.raw`\eqref{eq:3}`,String.raw`\cref{sec:1,sec:2}`,String.raw`\ref{outer{inner}3}`])assert.deepEqual(values(citation),[citation],citation);
 assert.equal(check(String.raw`See \citep[see][p. 2]{A2020}.`,String.raw`See \citep[see][p. 2]{B2020}.`).valid,false);
});
test('length floors count Unicode code points without whitespace and enforce threshold boundaries',()=>{
 for(const [original,minimum] of [['甲'.repeat(40),24],['甲'.repeat(39),20],['😀'.repeat(40),24],['abc def',3]]){
  assert.equal(check(original,'甲'.repeat(minimum)).minimumCharacters,minimum);assert.equal(check(original,'甲'.repeat(minimum)).valid,true);assert.equal(check(original,'甲'.repeat(minimum-1)).valid,false);
 }
 assert.equal(check('甲'.repeat(40),' \n\t'+ '甲'.repeat(23)).valid,false);
 assert.equal(check('甲'.repeat(40),'甲'.repeat(24)).factsVerified,false);
});
test('default invisible characters cannot pad a shortened candidate or form a blank source',()=>{
 const original='这是需要完整保留研究逻辑和限定条件的原文。'.repeat(4);
 for(const invisible of ['\u200b','\u2060','\u00ad','\u034f']){
  const result=check(original,'短句。'+invisible.repeat(100));assert.equal(result.valid,false);assert.equal(result.originalCharacters,84);assert.equal(result.revisedCharacters,3);assert.equal(result.minimumCharacters,51);assert.ok(result.issues.some(issue=>issue.code==='too_short'));
  assert.equal(validateRevisionOriginal(invisible.repeat(10)).valid,false);assert.equal(check('Visible original.',invisible.repeat(100)).valid,false);
 }
 assert.match(revisionProtectionRequirements,/排除空白及默认不可见格式字符/);
});
test('combining accents remain ordinary Unicode code points instead of being stripped as invisible',()=>{
 const accented='e\u0301'.repeat(20),result=check(accented,'e\u0301'.repeat(12));assert.equal(result.originalCharacters,40);assert.equal(result.revisedCharacters,24);assert.equal(result.minimumCharacters,24);assert.equal(result.valid,true);
 assert.equal(validateRevisionOriginal('\u0301').originalCharacters,1);assert.equal(validateRevisionOriginal('é').originalCharacters,1);assert.equal(validateRevisionOriginal('e\u0301').originalCharacters,2);
});
test('malformed types and excessively long text return safe errors instead of coercion',()=>{
 for(const value of [null,undefined,{},42,'',' \n', 'x'.repeat(200001)]){assert.equal(validateRevisionOriginal(value).valid,false);assert.equal(check(value,'Revised content.').valid,false);assert.equal(check('Original content.',value).valid,false);}
 assert.deepEqual(protectedRevisionSpans(null),[]);
});
test('bounded scanners handle repeated unmatched delimiters and currency without quadratic searches',()=>{
 const original=(String.raw`\( $20 <math `).repeat(3000);const result=validateRevisionOriginal(original);assert.equal(result.valid,false);assert.ok(result.issues.some(issue=>issue.code==='malformed_original_math'));
 const currencies=('$20 and ').repeat(10000);assert.equal(validateRevisionOriginal(currencies).valid,true);
 assert.equal(validateRevisionOriginal('\\'.repeat(100000)).valid,true);
});
