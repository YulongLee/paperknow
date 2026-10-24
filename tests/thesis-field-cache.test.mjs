import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createWritingDocx,inspectThesisExportContent} from '../src/writing-document.js';
import {mergeThesisFieldCaches} from '../backend/thesis-field-cache.mjs';
const manuscript='合成字段验收\n第一章 背景\n保留第一章的正文内容。\n第二章 结论\n保留最后的结论。';
test('field refresh transfers numeric caches without accepting native rewritten styles or package loss',async()=>{
 const input=await createWritingDocx(manuscript,{documentKind:'thesis'}),source=await JSZip.loadAsync(input);source.file('customXml/preserve.xml','<retained>unchanged</retained>');const original=await source.generateAsync({type:'uint8array'}),rendered=await JSZip.loadAsync(original);
 rendered.file('word/styles.xml','<styles>unrelated renderer rewrite</styles>');rendered.remove('customXml/preserve.xml');rendered.file('word/document.xml',(await rendered.file('word/document.xml').async('string')).replace(/(<w:fldChar w:fldCharType="separate"\s*\/>\s*<\/w:r>\s*<w:r><w:t[^>]*>) (<\/w:t>)/g,(_m,start,end)=>start+'9'+end));
 const result=await mergeThesisFieldCaches(original,await rendered.generateAsync({type:'uint8array'})),out=await JSZip.loadAsync(result.bytes);assert.equal(result.unresolved,0);assert.ok(result.updated>=2);assert.equal(await out.file('word/styles.xml').async('string'),await source.file('word/styles.xml').async('string'));assert.equal(await out.file('customXml/preserve.xml').async('string'),'<retained>unchanged</retained>');assert.match(await out.file('word/document.xml').async('string'),/>9<\/w:t>/);await inspectThesisExportContent(result.bytes,manuscript);
 for(const part of Object.keys(source.files).filter(name=>name!=='word/document.xml'&&!source.files[name].dir))assert.deepEqual(await out.file(part).async('uint8array'),await source.file(part).async('uint8array'),part);
});
test('missing numeric page evidence stays unresolved instead of inventing TOC numbers',async()=>{
 const input=await createWritingDocx(manuscript,{documentKind:'thesis'}),result=await mergeThesisFieldCaches(input,input);assert.ok(result.unresolved>=2);
});
test('native TOC links are resolved through co-located bookmarks without title text guessing',async()=>{
 const input=await createWritingDocx(manuscript,{documentKind:'thesis'}),rendered=await JSZip.loadAsync(input),source=await rendered.file('word/document.xml').async('string'),names=[...source.matchAll(/PAGEREF (PK_\d+)/g)].map(m=>m[1]);
 const paragraphs=names.map((name,i)=>`<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:hyperlink w:anchor="native_${i}"><w:r><w:t>相同标题</w:t></w:r><w:r><w:t>${i+3}</w:t></w:r></w:hyperlink></w:p>`).join(''),headings=names.map((name,i)=>`<w:p><w:bookmarkStart w:id="${i}" w:name="native_${i}"/><w:bookmarkStart w:id="${i+100}" w:name="${name}"/><w:r><w:t>相同标题</w:t></w:r></w:p>`).join('');
 rendered.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}${headings}</w:body></w:document>`);
 const result=await mergeThesisFieldCaches(input,await rendered.generateAsync({type:'uint8array'}));assert.equal(result.unresolved,0);const out=await JSZip.loadAsync(result.bytes),xml=await out.file('word/document.xml').async('string');assert.match(xml,/>3<\/w:t>/);assert.match(xml,/>4<\/w:t>/);await inspectThesisExportContent(result.bytes,manuscript);
});
