import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCitationImport} from '../dist/workspace/citation-import.mjs';
test('GB/T imports metadata separately from explicitly supplied abstracts',()=>{
 const result=parseCitationImport('[1] 张三,李四. 数字阅读支持研究[J]. 合成教学期刊,2026,1:1-3. DOI:10.1234/example\n摘要:这是用户提供的合成摘要。\n[2] 王五. 文献阅读方法[D]. 合成大学,2025.');
 assert.equal(result.items.length,2);assert.equal(result.items[0].title,'数字阅读支持研究');assert.equal(result.items[0].authors,'张三,李四');assert.equal(result.items[0].year,'2026');assert.equal(result.items[0].doi,'10.1234/example');assert.equal(result.items[0].text,'这是用户提供的合成摘要。');assert.equal(result.items[1].text,'');assert.equal(result.items[0].confirmed,false);assert.match(result.items[0].rawCitation,/摘要/);
});
test('RIS handles repeated authors and continuation without assuming full text',()=>{
 const result=parseCitationImport('TY  - JOUR\nTI  - A synthetic title\nAU  - Author A\nAU  - Author B\nPY  - 2026/10/19\nDO  - https://doi.org/10.1234/example\nAB  - Supplied abstract\n      continued.\nUR  - https://example.org/paper\nER  -\n');
 assert.equal(result.format,'ris');assert.equal(result.items[0].authors,'Author A; Author B');assert.equal(result.items[0].year,'2026');assert.equal(result.items[0].text,'Supplied abstract continued.');assert.equal(result.items[0].url,'https://example.org/paper');
});
test('BibTeX nested braces and quoted values preserve content safely',()=>{
 const result=parseCitationImport('@article{synthetic, title={A {Nested} title}, author="A and B", year=2026, doi={10.1234/example}, abstract={Supplied {nested} abstract}}\n@book{b,title="Second title",year={2025}}');
 assert.equal(result.items.length,2);assert.equal(result.items[0].title,'A Nested title');assert.equal(result.items[0].authors,'A; B');assert.equal(result.items[0].text,'Supplied nested abstract');assert.equal(result.items[1].text,'');
});
test('unbalanced/macro/concatenated BibTeX rejects without partial import',()=>{
 for(const text of ['@article{x,title={unclosed}', '@article{x,title=unknown}', '@article{x,title={a} # {b}}'])assert.throws(()=>parseCitationImport(text));
});
test('duplicates by normalized DOI or title retain first ordering',()=>{
 const result=parseCitationImport('[1] 张三. 首篇[J]. 刊,2026. DOI:10.1234/First\n[2] 张三. 首篇[J]. 刊,2026.\n[3] 张三. 新篇[J]. 刊,2026. DOI:10.1234/existing',{existing:[{title:'已选文献',doi:'10.1234/existing'}]});
 assert.equal(result.items.length,1);assert.equal(result.items[0].title,'首篇');assert.equal(result.warnings.length,2);
});
test('invalid URL credentials and script schemes cannot enter links',()=>{
 const r=parseCitationImport('@article{x,title={Example},year={2026},url={https://user:password@example.org/a}}');assert.equal(r.items[0].url,'');
 assert.throws(()=>parseCitationImport('not a citation'));assert.throws(()=>parseCitationImport('x'.repeat(100001)));
});
test('fifty citations import in order and fifty one rejects all',()=>{
 const lines=Array.from({length:51},(_,i)=>`[${i+1}] 作者. 标题${i+1}[J]. 期刊,2026.`);
 assert.equal(parseCitationImport(lines.slice(0,50).join('\n')).items.length,50);assert.throws(()=>parseCitationImport(lines.join('\n')),/50/);
});
