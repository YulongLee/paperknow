import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createWritingDocx} from '../src/writing-document.js';

test('built-in proposal avoids blanket field refresh but retains an editable page number',async()=>{
 const bytes=await createWritingDocx('研究方案\n研究背景\n正文内容。',{documentKind:'writing',writingKind:'proposal',metadata:{title:'研究方案'}});
 const zip=await JSZip.loadAsync(bytes),settings=await zip.file('word/settings.xml').async('string'),footer=await zip.file('word/pk-footer.xml').async('string');
 assert.doesNotMatch(settings,/<w:updateFields\b/);
 assert.match(footer,/<w:instrText[^>]*>\s*PAGE\s*<\/w:instrText>/);
 for(const file of Object.values(zip.files).filter(f=>f.name.endsWith('.rels'))){const xml=await file.async('string');assert.doesNotMatch(xml,/TargetMode=["']External["']/i);}
});

test('thesis retains automatic table of contents refresh',async()=>{
 const bytes=await createWritingDocx('研究论文\n第一章 绪论\n正文内容。',{documentKind:'thesis',metadata:{title:'研究论文'}});
 const zip=await JSZip.loadAsync(bytes),settings=await zip.file('word/settings.xml').async('string'),document=await zip.file('word/document.xml').async('string');
 assert.match(settings,/<w:updateFields\b[^>]*w:val="true"/);
 assert.match(document,/TOC/);
});
