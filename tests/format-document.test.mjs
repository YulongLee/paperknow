import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import JSZip from 'jszip';
import {defaultRules,checkFormatting,validateRules,headingLevel} from '../dist/workspace/format-model.mjs';
globalThis.DOMParser=DOMParser;globalThis.XMLSerializer=XMLSerializer;
const {exampleDocx,parseDocx,applyDocx}=await import('../src/format-document.js');
const NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
test('deterministic checks distinguish known differences from unknown inherited format',()=>{const r=defaultRules(),d={sections:[],paragraphs:[{level:0,format:{font:['宋体'],size:[12],line:[1],indent:[]}}]};const issues=checkFormatting(d,r);assert.equal(issues.length,6);assert.equal(issues.filter(i=>i.section===0&&i.status==='unknown').length,4);assert.equal(issues[0].status,'fix');assert.equal(issues[1].status,'unknown');assert.throws(()=>validateRules({...r,top:0}));assert.throws(()=>validateRules({...r,body:false,headings:false,margins:false}));assert.equal(headingLevel('1.2.3 数据来源'),3);});
test('DOCX formatting changes actual XML while preserving text and original file',async()=>{const input=await exampleDocx(),before=await parseDocx(input),r=defaultRules();assert.ok(checkFormatting(before,r).length>0);const output=await applyDocx(input,before,r),after=await parseDocx(output);assert.equal(after.paragraphs.map(p=>p.text).join(''),before.paragraphs.map(p=>p.text).join(''));assert.equal(checkFormatting(after,r).length,0);assert.ok(checkFormatting(await parseDocx(input),r).length>0);});
test('unselected scopes and table/image package contents remain untouched',async()=>{const zip=await JSZip.loadAsync(await exampleDocx());let xml=await zip.file('word/document.xml').async('string');const table='<w:tbl><w:tr><w:tc><w:p><w:r><w:t>table-content</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';xml=xml.replace('<w:sectPr>',table+'<w:sectPr>');zip.file('word/document.xml',xml);zip.file('word/media/image.png',new Uint8Array([1,2,3,4]));const input=await zip.generateAsync({type:'uint8array'}),doc=await parseDocx(input);assert.ok(doc.warnings.some(w=>w.includes('表格')));const out=await applyDocx(input,doc,{...defaultRules(),body:false,headings:false,margins:true}),z=await JSZip.loadAsync(out);assert.deepEqual(await z.file('word/media/image.png').async('uint8array'),new Uint8Array([1,2,3,4]));const d=new DOMParser().parseFromString(await z.file('word/document.xml').async('string'),'application/xml');assert.equal(d.getElementsByTagNameNS(NS,'tbl')[0].textContent,'table-content');assert.equal((await parseDocx(out)).paragraphs[2].format.line[0],1);});
test('tracked revisions block export; corrupt zip data is rejected',async()=>{const z=await JSZip.loadAsync(await exampleDocx());z.file('word/document.xml',(await z.file('word/document.xml').async('string')).replace('<w:body>','<w:body><w:ins/>'));const bytes=await z.generateAsync({type:'uint8array'}),doc=await parseDocx(bytes);assert.equal(doc.blocked,true);await assert.rejects(()=>applyDocx(bytes,doc,defaultRules()));await assert.rejects(()=>parseDocx(new Uint8Array([1,2])));});

test('fine formatting imports actual sample styles and identifies unresolved requirements',async()=>{
 const {rulesFromTemplate}=await import('../dist/workspace/format-model.mjs');const formatted=await applyDocx(await exampleDocx(),await parseDocx(await exampleDocx()),{...defaultRules(),line:2,left:3}),doc=await parseDocx(formatted),result=rulesFromTemplate(doc);assert.equal(result.rules.line,2);assert.equal(result.rules.left,3);assert.ok(result.imported.includes('font'));assert.ok(result.imported.includes('h1'));const unresolved=rulesFromTemplate({paragraphs:[],sections:[]});assert.ok(unresolved.unresolved.includes('font'));assert.equal(unresolved.rules.font,'宋体');
});

test('explicit paragraph demotion remains body on round trip and direct formats override character style uncertainty',async()=>{
 const input=await exampleDocx(),doc=await parseDocx(input);doc.paragraphs[0].level=0;const out=await applyDocx(input,doc,defaultRules()),after=await parseDocx(out);assert.equal(after.paragraphs[0].level,0);assert.equal(checkFormatting(after,defaultRules()).length,0);
 const z=await JSZip.loadAsync(input);z.file('word/document.xml',(await z.file('word/document.xml').async('string')).replaceAll('<w:rPr>','<w:rPr><w:rStyle w:val="UnknownStyle"/>'));const styled=await z.generateAsync({type:'uint8array'}),styledDoc=await parseDocx(styled),fixed=await applyDocx(styled,styledDoc,defaultRules());assert.equal(checkFormatting(await parseDocx(fixed),defaultRules()).length,0);
});

test('template headings retain identified per-level font and report missing levels',async()=>{
 const {rulesFromTemplate}=await import('../dist/workspace/format-model.mjs');
 const input=await exampleDocx(),original=await parseDocx(input);
 const templated=await applyDocx(input,original,{...defaultRules(),h1Font:'宋体',h2Font:'仿宋'});
 const parsed=await parseDocx(templated),{rules,imported,unresolved}=rulesFromTemplate(parsed);
 assert.equal(rules.h1Font,'宋体');assert.equal(rules.h2Font,'仿宋');assert.ok(imported.includes('h1Font'));assert.ok(unresolved.includes('h3'));assert.ok(unresolved.includes('h3Font'));
 const output=await applyDocx(input,original,rules),after=await parseDocx(output);
 assert.equal(after.paragraphs.find(p=>p.level===1).format.font[0],'宋体');assert.equal(after.paragraphs.find(p=>p.level===2).format.font[0],'仿宋');assert.equal(checkFormatting(after,rules).filter(x=>x.status==='fix').length,0);
});

test('unidentified heading typography preserves the original instead of applying guessed defaults',async()=>{
 const {rulesFromTemplate}=await import('../dist/workspace/format-model.mjs'),input=await exampleDocx(),source=await parseDocx(input);
 const rules=rulesFromTemplate({paragraphs:[],sections:[]}).rules;
 assert.equal(rules.h1PreserveFont,true);assert.equal(rules.h1PreserveSize,true);
 const output=await applyDocx(input,source,rules),after=await parseDocx(output);
 assert.deepEqual(after.paragraphs[0].format.font,source.paragraphs[0].format.font);
 assert.deepEqual(after.paragraphs[0].format.size,source.paragraphs[0].format.size);
 assert.equal(checkFormatting(after,rules).filter(x=>x.status==='fix').length,0);
});

test('unknown body spacing and differing section margins retain original settings',async()=>{
 const {rulesFromTemplate}=await import('../dist/workspace/format-model.mjs');
 const input=await exampleDocx(),source=await parseDocx(input),sample={paragraphs:source.paragraphs.map(p=>({...p,format:{...p.format,line:[],indent:[]}})),sections:[{top:2,bottom:3,left:2.5,right:2.5},{top:3,bottom:3,left:2.5,right:null}]},result=rulesFromTemplate(sample);
 assert.ok(result.unresolved.includes('line'));assert.ok(result.unresolved.includes('indent'));assert.ok(result.unresolved.includes('top'));assert.ok(result.unresolved.includes('right'));assert.equal(result.rules.preserveTop,true);
 const output=await applyDocx(input,source,result.rules),after=await parseDocx(output);
 const index=source.paragraphs.findIndex(p=>p.level===0);assert.deepEqual(after.paragraphs[index].format.line,source.paragraphs[index].format.line);assert.deepEqual(after.paragraphs[index].format.indent,source.paragraphs[index].format.indent);assert.equal(after.sections[0].top,source.sections[0].top);
});
test('Latin-only font declarations do not establish Chinese font of template text',async()=>{
 const z=await JSZip.loadAsync(await exampleDocx());z.file('word/document.xml',(await z.file('word/document.xml').async('string')).replaceAll('w:ascii="宋体" w:eastAsia="宋体"','w:ascii="Times New Roman"'));
 const doc=await parseDocx(await z.generateAsync({type:'uint8array'}));assert.deepEqual(doc.paragraphs[0].format.font,[]);
 const {rulesFromTemplate}=await import('../dist/workspace/format-model.mjs');assert.ok(rulesFromTemplate(doc).unresolved.includes('h1Font'));
});

test('different section margins in a real template keep each source section intact',async()=>{
 const {rulesFromTemplate}=await import('../dist/workspace/format-model.mjs');
 const input=await exampleDocx(),z=await JSZip.loadAsync(input),xml=await z.file('word/document.xml').async('string');
 z.file('word/document.xml',xml.replace('<w:body>','<w:body><w:p><w:pPr><w:sectPr><w:pgMar w:top="2000" w:bottom="1200" w:left="1400" w:right="1400"/></w:sectPr></w:pPr></w:p>'));
 const multisect=await z.generateAsync({type:'uint8array'}),source=await parseDocx(multisect),rule=rulesFromTemplate(source);
 assert.equal(source.sections.length,2);assert.ok(rule.unresolved.includes('top'));assert.ok(rule.unresolved.includes('bottom'));
 const after=await parseDocx(await applyDocx(multisect,source,rule.rules));assert.deepEqual(after.sections.map(s=>s.top),source.sections.map(s=>s.top));assert.deepEqual(after.sections.map(s=>s.bottom),source.sections.map(s=>s.bottom));
});

test('AI review describes unidentified rules as preserved rather than applied defaults',async()=>{
 const {rulesFromTemplate,formatAdviceSnapshot}=await import('../dist/workspace/format-model.mjs');const input=await exampleDocx(),doc=await parseDocx(input),rules=rulesFromTemplate({paragraphs:[],sections:[]}).rules;
 const review=JSON.parse(formatAdviceSnapshot({title:'示例'},doc,rules).text);assert.equal(review.rules.h1,'模板未识别，保留原文');assert.equal(review.rules.h1Font,'模板未识别，保留原文');assert.equal(review.rules.line,'模板未识别，保留原文');assert.equal(review.rules.top,'模板未识别，保留原文');assert.equal(Object.hasOwn(review.rules,'preserveLine'),false);
});
