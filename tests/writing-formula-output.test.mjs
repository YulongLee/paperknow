import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {normalizeWritingSnapshot,writingPlan,parseWritingOutput,validateWritingCandidate} from '../backend/writing-model.mjs';
import {createWritingDocx} from '../src/writing-document.js';
import {formulaOutputIssue} from '../backend/writing-formula-output.mjs';

const make=(formula=true)=>normalizeWritingSnapshot({title:'数学研究',profile:{level:'本科',language:'中文',targetWords:500},requirements:{contentMode:'rich'},materials:[],references:[],outline:[{id:'c',title:'数学分析',targetWords:500,presentation:{formula}}]});
const result=text=>({text:JSON.stringify({complete:true,text,source_ids:[],missing_evidence:[],figures:[]}),trace:[]});
const fill=text=>'研'.repeat(450)+text;

test('a selected formula written as a plain function equation requests a formatted candidate',()=>{
 const snapshot=make(),unit=writingPlan(snapshot,'draft')[0],r=validateWritingCandidate(result(fill('计数关系 C(n)=n²。')),'course','draft',snapshot,unit);
 assert.equal(r.valid,false);assert.equal(r.feedback.code,'formula_format');assert.match(r.feedback.rule,/不得编造/);
});

test('a selected explicitly marked formula is accepted and unavailable evidence does not force creation',()=>{
 const snapshot=make(),unit=writingPlan(snapshot,'draft')[0];
 assert.equal(validateWritingCandidate(result(fill('计数关系 $C(n)=n^{2}$。')),'course','draft',snapshot,unit).valid,true);
 assert.equal(validateWritingCandidate(result(fill('本节尚无可核对的公式依据，不引入公式。')),'course','draft',snapshot,unit).valid,true);
});

test('selected formulas that cannot become editable Word equations are not accepted',()=>{
 const snapshot=make(),unit=writingPlan(snapshot,'draft')[0],r=validateWritingCandidate(result(fill('公式 $\\notARealCommand{x}$。')),'course','draft',snapshot,unit);assert.equal(r.valid,false);assert.equal(r.feedback.code,'formula_format');assert.match(r.feedback.rule,/不得编造/);
 const inlineBlock=validateWritingCandidate(result(fill('公式 \\[C(n)=n^{2}\\] 在这里。')),'course','draft',snapshot,unit);assert.equal(inlineBlock.valid,false);assert.equal(inlineBlock.feedback.code,'formula_format');
});

test('accepted mathematical markup reaches an editable equation in exported course Word',async()=>{
 const snapshot=make(),unit=writingPlan(snapshot,'draft')[0],parsed=parseWritingOutput(result(fill('计数关系 $C(n)=n^{2}$。')),'course','draft',snapshot,unit),bytes=await createWritingDocx('数学研究\n'+parsed.text,{documentKind:'writing',writingKind:'course',metadata:{title:'数学研究'}}),zip=await JSZip.loadAsync(bytes),doc=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');assert.ok(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math','oMath').length>0);
});

test('escaped delimiters are rejected when Word would render them as plain text',async()=>{
 const snapshot=make(),unit=writingPlan(snapshot,'draft')[0];
 const malformed=String.raw`计数关系 \\(C(n)=n^2\\)。`;
 const candidate=validateWritingCandidate(result(fill(malformed)),'course','draft',snapshot,unit);
 assert.equal(candidate.valid,false);assert.equal(candidate.feedback.code,'formula_format');
 const nativeCount=async text=>{const bytes=await createWritingDocx('数学研究\n'+fill(text),{documentKind:'writing',writingKind:'course',metadata:{title:'数学研究'}});const zip=await JSZip.loadAsync(bytes);const doc=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');return doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math','oMath').length;};
 assert.equal(await nativeCount(malformed),0);
 const valid=String.raw`计数关系 \(C(n)=n^2\)。`;
 assert.equal(validateWritingCandidate(result(fill(valid)),'course','draft',snapshot,unit).valid,true);
 assert.ok(await nativeCount(valid)>0);
});

test('a plain function assignment is not presumed to be a formula',()=>{
 const snapshot=make(),unit=writingPlan(snapshot,'draft')[0];
 assert.equal(validateWritingCandidate(result(fill('代码示例 C(n)=test。')),'course','draft',snapshot,unit).valid,true);
});

test('long unfinished or escaped delimiters are handled without repeated rescanning',()=>{
 const start=performance.now();
 for(const input of [String.raw`\[`.repeat(30000),String.raw`\[`.repeat(30000)+String.raw`\\]`,'\\'.repeat(60000)+'('])assert.equal(formulaOutputIssue(input),'');
 assert.ok(performance.now()-start<1000,'unfinished delimiters must not monopolize the worker');
});

test('unselected formula keeps ordinary prose and code fences are not reinterpreted as mathematics',()=>{
 const snapshot=make(false),unit=writingPlan(snapshot,'draft')[0];assert.equal(parseWritingOutput(result(fill('计数关系 C(n)=n²。')),'course','draft',snapshot,unit).text.includes('C(n)=n²'),true);
 const selected=make(),selectedUnit=writingPlan(selected,'draft')[0];assert.equal(validateWritingCandidate(result(fill('代码说明 `C(n)=n²`。')),'course','draft',selected,selectedUnit).valid,true);
});

test('truncated formula candidate is never marked complete',()=>{
 const snapshot=make(),unit=writingPlan(snapshot,'draft')[0],r=validateWritingCandidate({...result(fill('公式 $C(n)=n^2$。')),truncated:true},'course','draft',snapshot,unit);assert.equal(r.valid,false);
});
