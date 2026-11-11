import test from 'node:test';import assert from 'node:assert/strict';import JSZip from 'jszip';import {DOMParser} from '@xmldom/xmldom';
import {createWritingDocx,createWritingTemplateDocx} from '../src/writing-document.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const direct=(node,name)=>Array.from(node?.childNodes||[]).filter(child=>child.namespaceURI===W&&child.localName===name);
const descendants=(node,name)=>[...node.getElementsByTagNameNS(W,name)];
const bodyTable=(doc)=>[...doc.getElementsByTagNameNS(W,'tbl')].find(table=>descendants(table,'t').some(node=>node.textContent==='HEADER_A'));
const input='表格分页合成验收\n表1 研究数据\n\n| HEADER_A | HEADER_B |\n| --- | --- |\n'+Array.from({length:80},(_,i)=>`| ROW_${i} | 条目${i} |`).join('\n');
async function document(options){const zip=await JSZip.loadAsync(await createWritingDocx(input,options));return new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');}
for(const [name,options] of [['plain',{}],['practice',{documentKind:'writing',writingKind:'practice',metadata:{title:'表格分页合成验收'}}],['thesis',{documentKind:'thesis',metadata:{title:'表格分页合成验收'}}]])test(name+' keeps only the repeated header row together with its following row',async()=>{
 const doc=await document(options),table=bodyTable(doc);assert.ok(table);const rows=direct(table,'tr');assert.equal(rows.length,81);assert.equal(descendants(direct(rows[0],'trPr')[0],'tblHeader').length,1);
 for(const p of descendants(rows[0],'p'))assert.equal(direct(direct(p,'pPr')[0],'keepNext').length,1);
 for(const row of rows.slice(1))for(const p of descendants(row,'p')){const keep=direct(direct(p,'pPr')[0],'keepNext');assert.ok(!keep.length||keep[0].getAttributeNS(W,'val')==='0');}
 assert.equal(descendants(table,'cantSplit').length,0,'do not prohibit multi-page tables or oversized rows from splitting');
});
test('uploaded template styles cannot erase the generated header pagination setting',async()=>{
 const bytes=await createWritingTemplateDocx('practice'),doc=await document({documentKind:'writing',writingKind:'practice',metadata:{title:'表格分页合成验收'},template:{status:'ready',bytes}}),table=bodyTable(doc);assert.ok(table);const rows=direct(table,'tr');for(const p of descendants(rows[0],'p'))assert.equal(direct(direct(p,'pPr')[0],'keepNext').length,1);assert.equal(descendants(table,'cantSplit').length,0);
});

test('uploaded template inherited keepNext cannot chain generated data rows',async()=>{
 const zip=await JSZip.loadAsync(await createWritingTemplateDocx('practice'));for(const path of ['word/document.xml','word/styles.xml']){const part=zip.file(path);if(!part)continue;let text=await part.async('string');text=text.replace(/<w:keepNext(?:\s[^>]*)?\s*\/>/g,'').replace(/<w:pPr>/g,'<w:pPr><w:keepNext/>');zip.file(path,text);}
 const bytes=await zip.generateAsync({type:'uint8array'}),doc=await document({documentKind:'writing',writingKind:'practice',metadata:{title:'表格分页合成验收'},template:{status:'ready',bytes}}),rows=direct(bodyTable(doc),'tr');
 for(const p of descendants(rows[0],'p'))assert.notEqual(direct(direct(p,'pPr')[0],'keepNext')[0]?.getAttributeNS(W,'val'),'0');
 for(const row of rows.slice(1))for(const p of descendants(row,'p'))assert.equal(direct(direct(p,'pPr')[0],'keepNext')[0]?.getAttributeNS(W,'val'),'0');
});
