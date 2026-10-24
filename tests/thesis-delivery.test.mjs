import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {prepareThesisDeliverySnapshot} from '../dist/workspace/thesis-delivery.mjs';
import {normalizeThesisSnapshot,thesisPlan,thesisAgentTask,parseThesisSection,selectThesisEvidence} from '../backend/thesis-model.mjs';
import {thesisDocumentPresentation} from '../dist/workspace/thesis-document.mjs';
import {thesisExportMetadata} from '../dist/workspace/thesis-template.mjs';
import {auditThesisSubmission,createWritingDocx,inspectThesisDocxTemplate,inspectThesisExportContent} from '../src/writing-document.js';

const seed={title:'合成羊脸识别研究',profile:{language:'中文',targetWords:500},outline:[{id:'body',title:'第一章 研究设计',targetWords:500}],materials:[],references:[]};
const snapshot=()=>normalizeThesisSnapshot(prepareThesisDeliverySnapshot(structuredClone(seed)));
const candidate=text=>({text:JSON.stringify({text,complete:true,draft:false,source_ids:[],missing_evidence:[]}),trace:[]});

test('new delivery plans preserve the complete body budget and summarize only after all body units',()=>{
 const value=snapshot(),plan=thesisPlan(value);assert.deepEqual(value,normalizeThesisSnapshot(value));
 assert.equal(plan.filter(row=>!row.frontMatter).reduce((sum,row)=>sum+row.targetWords,0),500);
 assert.deepEqual(plan.map(row=>row.frontMatter||'body'),['body','abstract_zh','abstract_en']);
 const task=thesisAgentTask(value,plan.at(-1),[{chapter_id:'body',unit_id:'body::body::1',text:'已经保存的设计方案，没有实测数据。'}]);
 assert.equal(task.context.manuscriptExcerpts[0].text,'已经保存的设计方案，没有实测数据。');assert.deepEqual(task.materials,[]);assert.match(task.instructions,/不能把其中的计划写成已完成/);
 const historical=normalizeThesisSnapshot(seed);assert.equal(thesisPlan(historical).length,1);
});

test('abstracts require real summary text and keywords and count English as words despite Chinese body language',()=>{
 const value=snapshot(),plan=thesisPlan(value),zh=plan.at(-2),en=plan.at(-1);
 const chinese='这是一项设计方案研究。'.repeat(35)+'\n\n关键词：羊脸；分类；方案';
 assert.ok(parseThesisSection(candidate(chinese),value,zh).text.includes('关键词'));
 const english='English title: A Sheep Face Recognition Design\n\n'+('This study describes a proposed design without measured results. '.repeat(25))+'\n\nKey words: sheep; recognition; design';
 const parsed=parseThesisSection(candidate(english),value,en);assert.ok(parsed.wordCount>=200&&parsed.wordCount<=300);
 assert.throws(()=>parseThesisSection(candidate(english.replace(/Key words:.*/,'')),value,en),/关键词/);
 assert.throws(()=>parseThesisSection(candidate(english.replace(/English title:.*/,'')),value,en),/英文题目/);
});

test('submission checks reject an apparently completed manuscript with placeholders, no abstracts and no citations',()=>{
 const report=auditThesisSubmission({text:'合成论文\n第一章 绪论\n已经写完的框架【待补充：真实实验结果】',metadata:{citationRanges:[]}});
 assert.equal(report.submission.ready,false);for(const code of ['unresolved_placeholders','abstract_zh','abstract_en','citations_missing'])assert.ok(report.submission.issues.some(row=>row.code===code));
});

test('new automatic evidence selection does not treat generic deep-learning or recognition keywords as topic evidence',()=>{
 const value=snapshot();value.title='基于深度学习的羊脸识别系统';value.references=[{id:'sheep',title:'羊脸个体识别',text:'羊脸样本与特征的讨论。',confirmed:true},{id:'village',title:'传统村落景观基因识别',text:'传统村落文化遗产研究。',confirmed:true},{id:'campus',title:'基于深度学习的校园安防人脸识别系统',text:'校园安防的人脸识别研究。',confirmed:true}];
 const selected=selectThesisEvidence(value,{chapterTitle:'第一章 绪论',title:'研究背景与意义',sourceIds:[]});assert.deepEqual(selected.sources.map(row=>row.id),['sheep']);
 assert.ok(selectThesisEvidence(value,{chapterTitle:'研究',title:'资料',sourceIds:['campus']}).sources.some(row=>row.id==='campus'),'explicit user source assignment remains available for a justified comparison');
});

test('formal presentation omits unused catalog rows while retaining actual citations and all unresolved body markers',()=>{
 const value={title:'合成研究',references:[{id:'used',title:'羊脸识别',confirmed:true,text:'原文'},{id:'unrelated',title:'传统村落文化研究',confirmed:true}],outline:[]};
 const chapters=[{id:'body',title:'第一章 方法',text:'第一章 方法\n\n依据[source:used]。\n【待补充：真实数据】'}];
 const formal=thesisDocumentPresentation(value,chapters,{submission:true});assert.match(formal.text,/依据\[1\]/);assert.match(formal.text,/待补充：真实数据/);assert.doesNotMatch(formal.text,/传统村落|待引用文献/);assert.equal(formal.text.match(/第一章 方法/g).length,1);assert.equal(formal.citationRanges.length,1);
 assert.match(thesisDocumentPresentation(value,chapters).text,/传统村落/);
});

test('a structurally complete cited document passes while school-specific minimum counts remain enforceable',()=>{
 const text='合成研究\n摘要\n'+('研究设计与验证。'.repeat(35))+'\n关键词：研究；设计；验证\nAbstract\n'+('This study reports the supplied design and evaluation. '.repeat(25))+'\nKey words: study; design; evaluation\n第一章 研究方法\n已经保存的实际方法和来源[1]。\n参考文献\n[1] A. Author. A verified study[J]. Journal, 2025.';
 const pos=text.indexOf('[1]'),metadata={englishTitle:'A Study Design',citationRanges:[{start:pos,end:pos+3,number:1}]};
 assert.equal(auditThesisSubmission({text,metadata}).submission.ready,true);
 const report=auditThesisSubmission({text,metadata,templateProfile:{submission:{minimumReferences:10,minimumForeignReferences:3}}});assert.equal(report.submission.ready,false);assert.ok(report.submission.issues.some(row=>row.code==='reference_minimum'));assert.ok(report.submission.issues.some(row=>row.code==='foreign_references'));
});

test('thesis DOCX exports code without Markdown fences and keeps each original code line in its source range',async()=>{
 const text='合成论文\n第一章 方法\n```python\ndef predict(x):\n    return x + 1\n```';
 const bytes=await createWritingDocx(text,{documentKind:'thesis'}),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
 assert.doesNotMatch(xml,/```/);assert.match(xml,/def predict/);assert.match(xml,/return x \+ 1/);assert.match(xml,/PKCode/);assert.equal((await inspectThesisExportContent(bytes,text)).status,'passed');
});

test('explicit school reference and three-line-table requirements are read and applied without modifying the uploaded template',async()=>{
 const template=await createWritingDocx('合成学校论文规范\n文献应在10种以上，且至少有3篇外文参考文献。\n表的编排采用国际通行的三线表。\n{{正文}}');
 const copy=Buffer.from(template),profile=await inspectThesisDocxTemplate(template);assert.equal(profile.submission.minimumReferences,10);assert.equal(profile.submission.minimumForeignReferences,3);assert.equal(profile.rules.tableFormat,'threeLine');
 const text='合成研究\n第一章 方案\n| 指标 | 定义 |\n|---|---|\n| 样本 | 实际记录 |',bytes=await createWritingDocx(text,{documentKind:'thesis',template:{status:'ready',bytes:template}}),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
 const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',doc=new DOMParser().parseFromString(xml,'application/xml'),border=doc.getElementsByTagNameNS(W,'tblBorders')[0];assert.equal(border.getElementsByTagNameNS(W,'insideV')[0].getAttributeNS(W,'val'),'nil');assert.equal(border.getElementsByTagNameNS(W,'top')[0].getAttributeNS(W,'val'),'single');assert.ok(doc.getElementsByTagNameNS(W,'tcBorders').length);assert.deepEqual(Buffer.from(template),copy);
});

test('an explicit body-page-number requirement replaces inherited Roman numbering with live page-count fields',async()=>{
 const template=await createWritingDocx('合成学校模板\n页码内容为：第X页，共XX页。页码从正文开始编排。\n目录\n第一章 方法\n{{正文}}');
 const profile=await inspectThesisDocxTemplate(template);assert.equal(profile.rules.bodyPageNumbers,true);
 const bytes=await createWritingDocx('合成测试\n第一章 方法\n用于验证正文页码的合成段落。',{documentKind:'thesis',metadata:{title:'合成测试',chapterTitles:['第一章 方法']},template:{bytes:template,status:'ready'}}),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
 assert.match(xml,/<w:pgNumType w:fmt="decimal" w:start="1"/);const part=Object.keys(zip.files).find(name=>/^word\/pkBodyPageNumbers.*\.xml$/.test(name));assert.ok(part);const footer=await zip.file(part).async('string');assert.match(footer,/w:instr="PAGE"/);assert.match(footer,/w:instr="PAGEREF PKBodyLastPage/);const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',doc=new DOMParser().parseFromString(xml,'application/xml'),body=doc.getElementsByTagNameNS(W,'body')[0],nodes=[...body.childNodes].filter(node=>node.nodeType===1),main=nodes.findIndex(node=>[...node.getElementsByTagNameNS(W,'bookmarkStart')].some(marker=>/^PKInput_\d+$/.test(marker.getAttributeNS(W,'name')))&&node.textContent==='第一章 方法');assert.ok(main>0);for(const node of nodes.slice(0,main))assert.equal(node.getElementsByTagNameNS(W,'footerReference').length,0,'a cached contents entry cannot start body page numbers');
});

test('the default export starts the English title and its abstract on the same page',async()=>{
 const bytes=await createWritingDocx('合成测试\n摘要\n中文摘要内容。\nAbstract\nAn English abstract.',{documentKind:'thesis',metadata:{title:'合成测试',englishTitle:'Synthetic English Title'}}),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string'),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',doc=new DOMParser().parseFromString(xml,'application/xml'),paragraphs=[...doc.getElementsByTagNameNS(W,'p')],title=paragraphs.findIndex(node=>node.textContent==='Synthetic English Title');assert.ok(title>0);assert.ok(paragraphs[title].getElementsByTagNameNS(W,'keepNext').length);assert.ok(paragraphs[title].getElementsByTagNameNS(W,'pageBreakBefore').length);assert.equal(paragraphs[title+1].textContent,'Abstract');assert.equal(paragraphs[title+1].getElementsByTagNameNS(W,'pageBreakBefore')[0].getAttributeNS(W,'val'),'0');
});

test('cross-language full-text references remain available for actual reading instead of being excluded by untranslated keywords',()=>{
 const value=snapshot();value.title='基于深度学习的羊脸识别系统';value.references=[{id:'english',title:'Individual Sheep Face Recognition',text:'This paper describes sheep face samples and animal identification.',confirmed:true}];
 const unit={chapterTitle:'第一章 绪论',title:'研究背景',sourceIds:[]};assert.deepEqual(selectThesisEvidence(value,unit).sources.map(row=>row.id),['english']);
 value.title='Individual Sheep Face Recognition';value.profile.language='English';value.references=[{id:'chinese',title:'羊脸个体识别研究',text:'羊脸样本与个体身份的讨论。',confirmed:true}];assert.deepEqual(selectThesisEvidence(value,{chapterTitle:'Introduction',title:'Motivation',sourceIds:[]}).sources.map(row=>row.id),['chinese']);
});
