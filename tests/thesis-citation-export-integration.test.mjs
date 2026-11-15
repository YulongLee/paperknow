import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {thesisDocumentText} from '../dist/workspace/thesis-online.mjs';
import {thesisExportMetadata} from '../dist/workspace/thesis-template.mjs';
import {createWritingDocx} from '../src/writing-document.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';

test('account manuscript metadata links only canonical source citations through the actual Word renderer',async()=>{
 const snapshot={title:'索引与引用贯通验收',references:[{id:'r1',title:'合成研究来源',authors:'测试作者',year:'2026',documentType:'journal',journal:'合成期刊',confirmed:true}],materials:[],outline:[{id:'c1',title:'第一章 方法'}]},item={title:snapshot.title,snapshot,chapters:[{id:'c1',title:'第一章 方法',text:'第一章 方法\r\n\r\n📖\t数组array[1]和普通端点[1]均是原始文字。公式 $x_{[1]}+1$ 后引用[source:r1]。\r\n\r\n再次核对来源[source:r1]。'}]},before=structuredClone(item),text=thesisDocumentText(item),metadata=thesisExportMetadata(item);
 assert.equal(metadata.citationRanges.length,2);for(const range of metadata.citationRanges)assert.equal(text.slice(range.start,range.end),'[1]');assert.ok(metadata.citationRanges[0].start>text.indexOf('公式'));
 const zip=await JSZip.loadAsync(await createWritingDocx(text,{documentKind:'thesis',metadata})),xml=await zip.file('word/document.xml').async('string'),document=new DOMParser().parseFromString(xml,'application/xml'),links=[...document.getElementsByTagNameNS(W,'hyperlink')].filter(node=>node.getAttributeNS(W,'anchor').startsWith('PKRef_'));
 assert.deepEqual(links.map(node=>node.textContent),['[1]','[1]']);for(const link of links)assert.equal(link.getElementsByTagNameNS(W,'vertAlign')[0]?.getAttributeNS(W,'val'),'superscript');assert.match(xml,/数组array\[1\]和普通端点\[1\]均是原始文字/);assert.doesNotMatch(xml,/\[source:/);assert.deepEqual(item,before);
});

test('adjacent linked excerpts of the same source render one citation while preserving distinct citations and source text',async()=>{
 const snapshot={title:'关联引文',references:[{id:'r1',title:'来源一',authors:'作者一',year:'2025',confirmed:true},{id:'r2',title:'来源二',authors:'作者二',year:'2025',confirmed:true}],materials:[{id:'part1',relatedReferenceId:'r1',referenceSegment:true,confirmed:true}],outline:[{id:'c',title:'正文'}]},item={title:snapshot.title,snapshot,chapters:[{id:'c',title:'正文',text:'关联片段[source:part1][source:r1]。不同来源[source:r1][source:r2]。另一句[source:r1]。'}]},before=structuredClone(item),text=thesisDocumentText(item),metadata=thesisExportMetadata(item);
 assert.match(text,/关联片段\[1\]。不同来源\[1\]\[2\]。另一句\[1\]/);assert.equal(metadata.citationRanges.length,4);assert.deepEqual(item,before);
 const zip=await JSZip.loadAsync(await createWritingDocx(text,{documentKind:'thesis',metadata})),doc=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml'),links=[...doc.getElementsByTagNameNS(W,'hyperlink')].filter(node=>node.getAttributeNS(W,'anchor').startsWith('PKRef_'));
 assert.deepEqual(links.map(node=>node.textContent),['[1]','[1]','[2]','[1]']);assert.ok(links.every(link=>link.getElementsByTagNameNS(W,'vertAlign')[0]?.getAttributeNS(W,'val')==='superscript'));
});
