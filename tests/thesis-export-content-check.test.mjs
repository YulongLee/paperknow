import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {createWritingDocx,inspectThesisExportContent,auditThesisExport} from '../src/writing-document.js';
import {thesisDocumentPresentation} from '../dist/workspace/thesis-document.mjs';
import {thesisExportMetadata} from '../dist/workspace/thesis-template.mjs';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const readText=node=>[...node.getElementsByTagNameNS(W,'t')].map(part=>part.textContent).join('');
const attr=(node,key)=>node.getAttributeNS(W,key);
const anchors=doc=>[...doc.getElementsByTagNameNS(W,'bookmarkStart')].filter(node=>/^PKInput_\d+$/.test(attr(node,'name')));
const input=(doc,index)=>anchors(doc).find(node=>attr(node,'name')==='PKInput_'+index);
const endFor=(doc,start)=>[...doc.getElementsByTagNameNS(W,'bookmarkEnd')].find(node=>attr(node,'id')===attr(start,'id'));
const paragraph=node=>{while(node&&!(node.namespaceURI===W&&node.localName==='p'))node=node.parentNode;return node;};
const rejected=error=>/正文完整性核对未通过|正文定位标记(?:无效|重复)/.test(error.message);
async function rewrite(bytes,change){const zip=await JSZip.loadAsync(bytes),doc=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');await change(doc);zip.file('word/document.xml',new XMLSerializer().serializeToString(doc));return zip.generateAsync({type:'uint8array'});}
const simpleText='合成正文定位验收\n第一章 研究方法\n唯一的研究方法段落必须位于结果段落之前。\n第二章 研究结果\n唯一的研究结果段落必须完整保留。';
const write=(text=simpleText,options={})=>createWritingDocx(text,{documentKind:'thesis',metadata:{title:text.split('\n')[0]},...options});
async function inlineAbstract(body='摘要正文包含“摘要”两个字，不能替代丢失的摘要标题。'){
 const template=await createWritingDocx('某某大学本科毕业论文\n论文题目：{{论文题目}}\n学生：测试\n摘要：这里是模板原有摘要示例，必须被本次实际摘要替换。\n目录\n第一章 模板第一章\n这里是模板正文示例，用于确认正文样本不是单独标题。\n参考文献\n[1] 模板原有参考文献示例。');
 const text='合成论文题目\n摘要\n'+body+'\n第一章 研究方法\n研究方法真实正文必须保留。';
 return{text,bytes:await write(text,{template:{status:'ready',bytes:template}})};
}
function clearRange(doc,index){const start=input(doc,index),end=endFor(doc,start);assert.ok(start&&end);for(let node=start.nextSibling;node&&node!==end;){const next=node.nextSibling;node.parentNode.removeChild(node);node=next;}}

test('actual writer output passes ordered source-block validation without mutating exported bytes or manuscript',async()=>{
 const bytes=await write(),before=Buffer.from(bytes),result=await inspectThesisExportContent(bytes,simpleText);
 assert.equal(result.status,'passed');assert.equal(result.scope,'ordered_block_text_segments');assert.equal(result.checkedBlocks,4);assert.equal(result.checkedSegments,5);assert.equal(result.formulaSegments,0);assert.deepEqual(Buffer.from(bytes),before);assert.equal(simpleText.split('\n')[2],'唯一的研究方法段落必须位于结果段落之前。');
});

test('deleting one of two identical actual paragraphs is rejected even when the same text remains elsewhere',async()=>{
 const repeated='这段相同正文必须保留两次，不能因另一处仍存在就漏掉已丢失的一段。',text='重复内容次数验收\n第一章 研究背景\n'+repeated+'\n第二章 研究方法\n'+repeated,bytes=await write(text);
 assert.equal((await inspectThesisExportContent(bytes,text)).status,'passed');
 const corrupted=await rewrite(bytes,doc=>{const matches=[...doc.getElementsByTagNameNS(W,'p')].filter(node=>readText(node)===repeated);assert.equal(matches.length,2);matches[1].parentNode.removeChild(matches[1]);assert.equal([...doc.getElementsByTagNameNS(W,'p')].filter(node=>readText(node)===repeated).length,1);});
 await assert.rejects(()=>inspectThesisExportContent(corrupted,text),rejected);
});

test('reordering two intact actual source paragraphs is rejected although every source sentence is still present',async()=>{
 const corrupted=await rewrite(await write(),doc=>{const first=paragraph(input(doc,2)),second=paragraph(input(doc,4));assert.equal(first.parentNode,second.parentNode);first.parentNode.insertBefore(second,first);assert.match(readText(doc),/唯一的研究方法段落/);assert.match(readText(doc),/唯一的研究结果段落/);});
 await assert.rejects(()=>inspectThesisExportContent(corrupted,simpleText),rejected);
});

test('recognized school templates can place abstract label and body on one paragraph with separately validated ranges',async()=>{
 const fixture=await inlineAbstract();const result=await inspectThesisExportContent(fixture.bytes,fixture.text);assert.equal(result.status,'passed');
 await rewrite(fixture.bytes,doc=>{const label=input(doc,1),body=input(doc,2);assert.equal(label.parentNode,body.parentNode);assert.match(readText(paragraph(label)),/^摘要：摘要正文/);assert.ok(endFor(doc,label));assert.ok(endFor(doc,body));});
});

test('deleting an inline abstract label is rejected even when its body still contains the same label words',async()=>{
 const fixture=await inlineAbstract(),corrupted=await rewrite(fixture.bytes,doc=>{const original=paragraph(input(doc,1));clearRange(doc,1);assert.match(readText(original),/摘要/);assert.match(readText(original),/不能替代丢失/);});
 await assert.rejects(()=>inspectThesisExportContent(corrupted,fixture.text),rejected);
});

test('deleting an inline abstract body is rejected even when the external label still has exactly the expected body text',async()=>{
 const fixture=await inlineAbstract('摘要：');assert.equal((await inspectThesisExportContent(fixture.bytes,fixture.text)).status,'passed');
 const corrupted=await rewrite(fixture.bytes,doc=>{const original=paragraph(input(doc,2));clearRange(doc,2);assert.equal(readText(original),'摘要：','only text outside the body bookmark remains');});
 await assert.rejects(()=>inspectThesisExportContent(corrupted,fixture.text),rejected);
});

for(const [name,change]of [
 ['missing bookmark end',(doc,start,end)=>end.parentNode.removeChild(end)],
 ['duplicate bookmark ends',(doc,start,end)=>end.parentNode.insertBefore(end.cloneNode(true),end)],
 ['bookmark end before its start',(doc,start,end)=>start.parentNode.insertBefore(end,start)],
 ['bookmark end in another paragraph',(doc,start,end)=>paragraph(input(doc,4)).appendChild(end)],
 ['duplicate reserved bookmark start',(doc,start)=>start.parentNode.insertBefore(start.cloneNode(true),start)],
])test(`${name} is rejected on otherwise intact real writer bytes`,async()=>{
 const corrupted=await rewrite(await write(),doc=>{const start=input(doc,2),end=endFor(doc,start);assert.ok(start&&end);change(doc,start,end);assert.match(readText(doc),/唯一的研究方法段落必须位于结果段落之前/);});
 await assert.rejects(()=>inspectThesisExportContent(corrupted,simpleText),rejected);
});

test('a reserved source bookmark unexpectedly inserted into the document is rejected instead of silently ignored',async()=>{
 const corrupted=await rewrite(await write(),doc=>{const target=paragraph(input(doc,4)),start=doc.createElementNS(W,'w:bookmarkStart'),end=doc.createElementNS(W,'w:bookmarkEnd');start.setAttributeNS(W,'w:name','PKInput_9999');start.setAttributeNS(W,'w:id','99999');end.setAttributeNS(W,'w:id','99999');target.appendChild(start);target.appendChild(end);});
 await assert.rejects(()=>inspectThesisExportContent(corrupted,simpleText),rejected);
});

test('moving source text outside its unchanged bookmarks cannot satisfy that block from nearby text',async()=>{
 const corrupted=await rewrite(await write(),doc=>{const start=input(doc,2),end=endFor(doc,start),p=paragraph(start),runs=[];for(let node=start.nextSibling;node&&node!==end;node=node.nextSibling)runs.push(node);for(const node of runs)p.appendChild(node);assert.match(readText(p),/唯一的研究方法段落/);});
 await assert.rejects(()=>inspectThesisExportContent(corrupted,simpleText),rejected);
});

test('final document checks include explicit pending items introduced by school-template regions',async()=>{
 const template=await createWritingDocx('合成大学本科毕业论文\n论文题目：{{论文题目}}\n摘要\n这里是模板摘要示例，需要被实际论文摘要替换。\nAbstract\nThis is an English abstract example, not author supplied prose.\n目录\n第一章 模板示例\n这里是模板正文示例，需要被实际正文替换且含足够字符。\n参考文献\n[1] 模板参考文献示例。\n致谢\n模板致谢样例，需要被实际内容替换。');
 const text='检查占位符的合成论文\n摘要\n这里是实际中文摘要，没有提供英文摘要。\n第一章 研究方法\n这里是实际正文，需要核对模板在缺少资料时生成的占位符。',inputReport=auditThesisExport({text,metadata:{citationRanges:[]}});
 assert.equal(inputReport.counts.unresolvedPlaceholders,0);
 const bytes=await write(text,{template:{bytes:template,status:'ready'}}),before=Buffer.from(bytes),result=await inspectThesisExportContent(bytes,text);
 assert.equal(result.status,'passed','content-preservation checks do not block delivery over a pending item');assert.equal(result.unresolvedPlaceholders,3);assert.deepEqual(Buffer.from(bytes),before);assert.doesNotMatch(JSON.stringify(result),/这里是实际正文|This is an English/);
});

test('final placeholder scanning joins same-paragraph formatted runs while retaining paragraph boundaries',async()=>{
 const bytes=await write(),changed=await rewrite(bytes,doc=>{const body=doc.getElementsByTagNameNS(W,'body')[0],p=doc.createElementNS(W,'w:p');for(const value of ['【待','补充：英文','摘要】']){const run=doc.createElementNS(W,'w:r'),text=doc.createElementNS(W,'w:t');text.textContent=value;run.appendChild(text);p.appendChild(run);}body.appendChild(p);});
 const result=await inspectThesisExportContent(changed,simpleText);assert.equal(result.unresolvedPlaceholders,1);
});

test('editable partial drafts omit workflow disclosures and preserve abstracts, citations and every paragraph in default and school templates',async()=>{
 const snapshot={title:'合成初稿导出顺序验收',outline:[{id:'zh',title:'摘要'},{id:'en',title:'Abstract'},{id:'body',title:'第一章 研究方法'},{id:'pending',title:'第二章 研究结果'},{id:'ack',title:'致谢'}],materials:[],references:[{id:'r1',title:'合成来源',authors:'合成作者',year:'2026',confirmed:true}]};
 const chapters=[{id:'zh',title:'摘要',text:'中文摘要内容完整保留。\n关键词：初稿；导出；验证'},{id:'en',title:'Abstract',text:'An English abstract for a synthetic export test.\nKey words: draft; export; validation'},{id:'body',title:'第一章 研究方法',text:'这一段正文必须保留[source:r1]。\n【待补充：真实研究记录】\n| 项目 | 说明 |\n| --- | --- |\n| 方法 | 拟开展方案 |\n```python\ndef draft(x):\n    return x + 1\n```\n正文中的数学表达式 $x^2+1$ 保留。'}],item={title:snapshot.title,snapshot,chapters},before=structuredClone(item),presentation=thesisDocumentPresentation(snapshot,chapters),metadata=thesisExportMetadata(item);
 const template=await createWritingDocx('合成大学本科毕业论文\n论文题目：{{论文题目}}\n摘要\n这里是学校模板的中文摘要样例，需要用论文内容替换。\nAbstract\nThis is the school abstract example, to be replaced by the author.\n目录\n第一章 模板正文\n这里是学校模板正文样例，包含待替换内容。\n参考文献\n[1] 模板参考文献。\n致谢\n模板原有致谢样例。');
 for(const templateOption of [null,{status:'ready',bytes:template}]){
  const bytes=await write(presentation.text,{metadata,template:templateOption}),result=await inspectThesisExportContent(bytes,presentation.text,{metadata});
  assert.equal(result.status,'passed');assert.ok(result.unresolvedPlaceholders>0,'Pending evidence remains visible without blocking an editable draft');
 }
 assert.doesNotMatch(presentation.text,/部分章节尚未完成|本文仅包含当前已保存的章节草稿|不代表完整论文|尚未完成：/);
 assert.ok(presentation.text.indexOf('Abstract')<presentation.text.indexOf('第一章 研究方法\n\n'));
 assert.ok(presentation.text.indexOf('第一章 研究方法\n\n')<presentation.text.indexOf('这一段正文必须保留'));
 assert.deepEqual(metadata.chapterCompletion.missing.map(row=>row.title),['第二章 研究结果','致谢']);
 for(const range of presentation.citationRanges)assert.equal(presentation.text.slice(range.start,range.end),'['+range.number+']');
 assert.deepEqual(item,before,'Export ordering must never change saved chapters or research sources');
});

test('an unchanged populated example title gets a specific cover-title remedy instead of a generic body-region error',async()=>{
 const template=await createWritingDocx('合成大学本科毕业论文\n论文题目：模板原有示例题名\n学生：已有签名\n摘要\n模板摘要样例正文需要被替换，不应被保留。\n目录\n第一章 模板示例\n模板中的正文需要被实际论文替换，且具备足够长度。\n参考文献\n[1] 模板原有题录。');
 const bytes=await write(simpleText,{template:{bytes:template,status:'ready'}});
 await assert.rejects(()=>inspectThesisExportContent(bytes,simpleText),error=>/论文题目未与当前题目对应/.test(error.message)&&/模板封面题名/.test(error.message)&&/\{\{论文题目\}\}/.test(error.message));
});
