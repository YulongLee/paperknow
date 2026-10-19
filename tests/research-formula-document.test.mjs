import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {createFormulaDocx,mathmlToOmml} from '../src/research-formula-document.js';
import {formulaMathMLMarkup} from '../src/research-formula-core.js';
import {expandedChemistryTemplates} from '../dist/workspace/research-formula-chemistry-expanded.mjs';
const mathNS='http://www.w3.org/1998/Math/MathML',m='http://schemas.openxmlformats.org/officeDocument/2006/math',w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const math=body=>`<math xmlns="${mathNS}">${body}</math>`,parse=value=>new DOMParser({onError:()=>{throw Error('invalid XML');}}).parseFromString(value,'application/xml'),nodes=(doc,name)=>Array.from(doc.getElementsByTagNameNS(m,name)),raw=value=>formulaMathMLMarkup(value).markup;
const convert=value=>parse(mathmlToOmml(raw(value)));

test('Word exporter creates a native editable package without image, HTML, external links, macros or embedded source MathML',async()=>{
 const bytes=await createFormulaDocx(raw('x=\\frac{a+b}{c}'),{title:'研究公式 <alpha> & β'});assert.ok(bytes instanceof Uint8Array);assert.deepEqual([...bytes.slice(0,2)],[80,75]);
 const zip=await JSZip.loadAsync(bytes);assert.deepEqual(Object.keys(zip.files).sort(),['[Content_Types].xml','_rels/.rels','word/_rels/document.xml.rels','word/document.xml','word/styles.xml'].sort());
 for(const file of Object.values(zip.files)){const xml=await file.async('string');assert.ok(parse(xml).documentElement);assert.doesNotMatch(xml,/TargetMode|altChunk|oleObject|vbaProject|a:blip|<math\b|<html\b|DOCTYPE|ENTITY/i);}
 const xml=await zip.file('word/document.xml').async('string'),doc=parse(xml);assert.equal(doc.documentElement.namespaceURI,w);assert.equal(nodes(doc,'oMath').length,1);assert.equal(nodes(doc,'f').length,1);assert.equal(nodes(doc,'num')[0].textContent,'a+b');assert.equal(nodes(doc,'den')[0].textContent,'c');assert.equal(doc.getElementsByTagNameNS(w,'t')[0].textContent,'研究公式 <alpha> & β');assert.equal(doc.getElementsByTagNameNS(w,'drawing').length,0);
});

test('fractions, independent superscripts/subscripts and indexed roots remain structured OfficeMath objects',()=>{
 const doc=convert('\\frac{x_i^2}{\\sqrt[3]{a+b}}+y^n+z_k');
 assert.equal(nodes(doc,'f').length,1);assert.equal(nodes(doc,'sSubSup').length,1);assert.equal(nodes(doc,'sSubSup')[0].getElementsByTagNameNS(m,'e')[0].textContent,'x');assert.equal(nodes(doc,'sSubSup')[0].getElementsByTagNameNS(m,'sub')[0].textContent,'i');assert.equal(nodes(doc,'sSubSup')[0].getElementsByTagNameNS(m,'sup')[0].textContent,'2');
 assert.equal(nodes(doc,'sSup').length,1);assert.equal(nodes(doc,'sSub').length,1);assert.equal(nodes(doc,'rad').length,1);assert.equal(nodes(doc,'deg')[0].textContent,'3');assert.equal(nodes(doc,'rad')[0].getElementsByTagNameNS(m,'e')[0].textContent,'a+b');
 const root=convert('\\sqrt{x}');assert.equal(nodes(root,'degHide')[0].getAttributeNS(m,'val'),'1');
});

test('matrix cells, fences and upright Greek/text are preserved rather than flattened into one text field',()=>{
 const doc=convert('\\begin{bmatrix}\\alpha&b\\\\c&\\text{样本}\\end{bmatrix}');assert.equal(nodes(doc,'m').length,1);assert.equal(nodes(doc,'mr').length,2);assert.equal(nodes(doc,'m')[0].getElementsByTagNameNS(m,'e').length,4);assert.deepEqual(nodes(doc,'mr').map(row=>Array.from(row.childNodes).filter(child=>child.nodeType===1).map(cell=>cell.textContent)),[['α','b'],['c','样本']]);assert.ok(nodes(doc,'nor').length);assert.match(doc.documentElement.textContent,/\[αbc样本\]/);
 const fenced=parse(mathmlToOmml(math('<mfenced open="[" close="]"><mi>x</mi><mi>y</mi></mfenced>')));assert.equal(nodes(fenced,'d').length,1);assert.equal(nodes(fenced,'begChr')[0].getAttributeNS(m,'val'),'[');assert.equal(nodes(fenced,'endChr')[0].getAttributeNS(m,'val'),']');
});

test('under/over limits, accents, bars, group braces and cancellation use editable OfficeMath objects',()=>{
 const doc=convert('\\sum_{i=1}^{n}x_i+\\hat{x}+\\overline{y}+\\underbrace{a+b}_{c}+\\cancel{z}');assert.ok(nodes(doc,'limLow').length>=2);assert.ok(nodes(doc,'limUpp').length>=1);assert.equal(nodes(doc,'acc').length,1);assert.equal(nodes(doc,'bar').length,1);assert.equal(nodes(doc,'groupChr').length,1);assert.equal(nodes(doc,'borderBox').length,1);assert.equal(nodes(doc,'strikeBLTR')[0].getAttributeNS(m,'val'),'1');
});

test('multiscript pre-indices retain their roles and unsupported irregular structures fail clearly',()=>{
 const doc=parse(mathmlToOmml(math('<mmultiscripts><mi>X</mi><mi>a</mi><mi>b</mi><mprescripts/><mn>6</mn><mn>14</mn></mmultiscripts>')));assert.equal(nodes(doc,'sPre').length,1);assert.equal(nodes(doc,'sPre')[0].getElementsByTagNameNS(m,'sub')[0].textContent,'6');assert.equal(nodes(doc,'sPre')[0].getElementsByTagNameNS(m,'sup')[0].textContent,'14');assert.equal(nodes(doc,'sSubSup').length,1);
 for(const source of [math('<mmultiscripts><mi>X</mi><mi>a</mi></mmultiscripts>'),math('<mtable><mtr><mtd columnspan="2"><mi>x</mi></mtd></mtr></mtable>'),math('<menclose notation="longdiv"><mi>x</mi></menclose>'),math('<mpadded lspace="-1width"><mi>x</mi></mpadded>')])assert.throws(()=>mathmlToOmml(source),/暂不支持.*MathML.*SVG/);
});

test('all curated chemistry equations export native charge/subscript/arrow math with invisible layout anchors still hidden',async()=>{
 for(const row of expandedChemistryTemplates){const doc=parse(mathmlToOmml(raw(row.formula)));assert.equal(nodes(doc,'oMath').length,1,row.id);assert.ok(nodes(doc,'r').length,row.id);for(const phantom of nodes(doc,'phant'))assert.equal(phantom.getElementsByTagNameNS(m,'show')[0].getAttributeNS(m,'val'),'0',row.id);const shown=nodes(doc,'t').filter(node=>{for(let parent=node.parentNode;parent;parent=parent.parentNode)if(parent.namespaceURI===m&&parent.localName==='phant')return false;return true;}).map(node=>node.textContent).join('');assert.doesNotMatch(shown,/(?:^|[^A-Za-z])A(?:$|[^A-Za-z])/,row.id);assert.ok(shown.includes('⟶')||shown.includes('⇌')||shown.includes('↽')||shown.includes('⇀'),row.id);}
 const bytes=await createFormulaDocx(raw('\\ce{Cu^2+ + 2e- -> Cu(s)}'));assert.ok(bytes.length>1000);
});

test('untrusted MathML cannot inject external resources, executable content, extra package relationships or XML entities',async()=>{
 const bad=['<!DOCTYPE math [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+math('<mi>&x;</mi>'),'<math><mi>x</mi></math>',math('<script>alert(1)</script>'),math('<mi href="https://evil.example">x</mi>'),math('<mi onclick="alert(1)">x</mi>'),math('<mi style="background:url(https://evil.example)">x</mi>'),math('<annotation-xml><svg xmlns="http://www.w3.org/2000/svg"/></annotation-xml>'),math('<mrow xmlns="https://evil.example"><mi>x</mi></mrow>'),math('<mfrac><mi>x</mi></mfrac>'),math('<mi>x</mi>')+'<more/>'];
 for(const source of bad)await assert.rejects(()=>createFormulaDocx(source),/公式|Word/);
 await assert.rejects(()=>createFormulaDocx(math('<mi>x</mi>'),{title:'bad\u0000'}),/字符/);
 await assert.rejects(()=>createFormulaDocx(math('<mi>x</mi>'),{fontSize:Infinity}),/范围/);
 await assert.rejects(()=>createFormulaDocx(math('<mi>x</mi>'),{color:'url(https://evil.example)'}),/范围/);
 assert.throws(()=>mathmlToOmml(math('<mrow>'.repeat(85)+'<mi>x</mi>'+'</mrow>'.repeat(85))),/复杂/);
});


test('MathML tables with missing trailing cells are padded as specified by MathML, preserving multiline alignments',()=>{
 const doc=parse(mathmlToOmml(math('<mtable><mtr><mtd><mi>x</mi></mtd></mtr><mtr><mtd><mi>y</mi></mtd><mtd><mi>z</mi></mtd></mtr></mtable>')));
 assert.deepEqual(nodes(doc,'mr').map(row=>Array.from(row.childNodes).filter(child=>child.nodeType===1).map(cell=>cell.textContent)),[['x',''],['y','z']]);
 assert.equal(nodes(doc,'mc').length,2);
});

test('aligned equations use OfficeMath equation arrays rather than isolated leading-operator matrix cells',()=>{
 const doc=convert('\\begin{aligned}x&=\\frac{a}{b}\\\\y&=x+1\\end{aligned}');assert.equal(nodes(doc,'eqArr').length,1);assert.equal(nodes(doc,'m').length,0);assert.equal(Array.from(nodes(doc,'eqArr')[0].childNodes).filter(node=>node.namespaceURI===m&&node.localName==='e').length,2);assert.equal(nodes(doc,'aln').length,2);assert.match(doc.documentElement.textContent,/x=aby=x\+1/);
});

test('chemical layout anchors become real atomic script bases and literal charges cannot swallow later terms',()=>{
 const doc=convert('\\ce{SO4^2- + Ba^2+ -> BaSO4(s)}');assert.equal(nodes(doc,'phant').length,0);assert.equal(nodes(doc,'sSub')[0].getElementsByTagNameNS(m,'e')[0].textContent,'SO');
 for(const upper of nodes(doc,'sup')){assert.match(upper.textContent,/^[0-9]*[+−-]+$/);const props=upper.getElementsByTagNameNS(m,'rPr')[0];assert.deepEqual(Array.from(props.childNodes).filter(node=>node.nodeType===1).map(node=>node.localName),['nor']);}
 assert.ok(nodes(doc,'t').some(node=>node.textContent==='⟶'));assert.equal(nodes(doc,'sSup').length,2);
});


test('plain TeX nuclear isotope notation becomes native prescripts with a real element base, not a visible empty placeholder',()=>{
 for(const [formula,mass,number,element]of [['{}^{227}_{90}\\mathrm{Th}','227','90','Th'],['{}^{1}_{0}\\mathrm{n}','1','0','n'],['{}^{3}_{1}\\mathrm{H}\\mathrm{H}\\mathrm{O}','3','1','H']]){
  const doc=convert(formula),pre=nodes(doc,'sPre');assert.equal(pre.length,1);assert.equal(pre[0].getElementsByTagNameNS(m,'sub')[0].textContent,number);assert.equal(pre[0].getElementsByTagNameNS(m,'sup')[0].textContent,mass);assert.equal(pre[0].getElementsByTagNameNS(m,'e')[0].textContent,element);assert.equal(nodes(doc,'phant').length,0);
 }
});
