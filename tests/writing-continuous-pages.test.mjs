import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {createWritingDocx} from '../src/writing-document.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const input='合成开题报告\n研究背景与问题\n合成资料内容用于验证模板分页。';
test('built-in proposal cover and body use continuous pagination without a forced odd-page restart',async()=>{
 const bytes=await createWritingDocx(input,{documentKind:'writing',writingKind:'proposal',metadata:{title:'合成开题报告'}}),zip=await JSZip.loadAsync(bytes),doc=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml'),sections=[...doc.getElementsByTagNameNS(W,'sectPr')];
 assert.equal(sections.length,2);const types=[...sections[1].getElementsByTagNameNS(W,'pgNumType')];assert.equal(types.length,1);assert.equal(types[0].hasAttributeNS(W,'start'),false);assert.equal(types[0].getAttributeNS(W,'fmt'),'decimal');
 const footer=await zip.file('word/pk-footer.xml').async('string');assert.match(footer,/ PAGE /);
});
test('a supplied DOCX template keeps its own explicit page numbering rule',async()=>{
 const initial=await createWritingDocx('{{论文题目}}\n{{正文}}',{documentKind:'writing',writingKind:'proposal',templateBlank:true,metadata:{title:'{{论文题目}}'}}),template=await JSZip.loadAsync(initial);
 const document=await template.file('word/document.xml').async('string');template.file('word/document.xml',document.replace(/<w:pgNumType w:fmt="decimal"\/>/,'<w:pgNumType w:fmt="decimal" w:start="7"/>'));
 const bytes=await template.generateAsync({type:'uint8array'}),result=await createWritingDocx(input,{documentKind:'writing',writingKind:'proposal',metadata:{title:'合成开题报告'},template:{status:'ready',bytes}}),zip=await JSZip.loadAsync(result),xml=await zip.file('word/document.xml').async('string');
 assert.match(xml,/<w:pgNumType[^>]*w:start="7"/);
});
