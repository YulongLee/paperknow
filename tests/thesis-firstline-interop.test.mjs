import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {createWritingDocx} from '../src/writing-document.js';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
test('default first-line indentation has matching character and twip values for Word and LibreOffice',async()=>{
 const bytes=await createWritingDocx('跨设备论文排版\n第一章 研究背景\n第一段正文使用两字符缩进。',{documentKind:'thesis',metadata:{title:'跨设备论文排版'}});
 const zip=await JSZip.loadAsync(bytes),doc=new DOMParser().parseFromString(await zip.file('word/styles.xml').async('string'),'application/xml');
 const style=id=>[...doc.getElementsByTagNameNS(W,'style')].find(n=>n.getAttributeNS(W,'styleId')===id);
 const normal=style('PKNormal').getElementsByTagNameNS(W,'ind')[0];assert.equal(normal.getAttributeNS(W,'firstLineChars'),'200');assert.equal(normal.getAttributeNS(W,'firstLine'),'480');
 const heading=style('PKHeading1').getElementsByTagNameNS(W,'ind')[0];assert.equal(heading.getAttributeNS(W,'firstLineChars'),'0');assert.equal(heading.getAttributeNS(W,'firstLine'),'0');
});
