import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {thesisDocumentPresentation,thesisChapterCompletion} from '../dist/workspace/thesis-document.mjs';
import {thesisExportMetadata} from '../dist/workspace/thesis-template.mjs';
import {createCompletionDraft,setCompletionIssues,completionPanelHTML} from '../dist/workspace/thesis-completion-panel.mjs';
import {createWritingDocx,auditThesisSubmission,auditThesisExport,inspectThesisExportContent} from '../src/writing-document.js';
const fixture=()=>{
 const snapshot={title:'文稿完整性验收',profile:{language:'中文'},materials:[],references:[{id:'r1',title:'合成方法资料',authors:'合成作者',year:'2026',confirmed:true}],outline:[{id:'zh',title:'摘要'},{id:'en',title:'Abstract'},{id:'body',title:'第一章 研究设计'},{id:'ack',title:'致谢'},{id:'refs',title:'参考文献',kind:'references'}]};
 const chapters=[{id:'zh',title:'摘要',text:'本研究围绕资料组织与信息检索展开分析，以明确研究对象、术语和方法的对应关系。研究设计将文献梳理、记录分类和案例分析结合，形成可核对的处理步骤，并说明资料范围、比较方式及适用条件，避免将设计目标混同为实际测量结果。\n关键词：资料组织；信息检索；研究设计'}, {id:'en',title:'Abstract',text:'English title: A Study of Information Organization\nThis study describes an approach to information organization, document review and systematic comparison. It defines the scope of materials, identifies the planned evaluation steps and explains how research statements can be traced to their sources.\nKey words: information; documents; research'}, {id:'body',title:'第一章 研究设计',text:'研究按照明确的资料范围整理信息，并对方法依据建立引用[source:r1]。'}, {id:'ack',title:'致谢',text:''},{id:'refs',title:'参考文献',kind:'references',text:''}];
 return {snapshot,chapters};
};
const report=item=>auditThesisSubmission({text:thesisDocumentPresentation(item.snapshot,item.chapters,{submission:true}).text,metadata:thesisExportMetadata(item,{submission:true})});

test('a clean manuscript still blocks final delivery when acknowledgements are missing, and passes this check after completion',()=>{
 const item=fixture(),before=structuredClone(item),presentation=thesisDocumentPresentation(item.snapshot,item.chapters),audit=report(item);
 assert.doesNotMatch(presentation.text,/部分章节尚未完成|本文仅包含当前已保存的章节草稿|不代表完整论文|尚未完成：/);
 assert.deepEqual(audit.submission.issues,[{code:'incomplete_manuscript',message:'还有 1 个章节需要完善：致谢。请在补充窗口提供所需信息，由系统完善后重新检查。'}]);assert.equal(audit.submission.ready,false);assert.deepEqual(item,before);
 const draft=createCompletionDraft();setCompletionIssues(draft,{report:audit});assert.ok(draft.open);assert.match(completionPanelHTML(item,draft),/data-completion-field="acknowledgements"/);assert.ok(draft.messages.some(message=>/致谢/.test(message)));
 item.chapters.find(row=>row.id==='ack').text='感谢导师在研究思路梳理和文稿修改中给予的实际帮助。';assert.equal(report(item).submission.ready,true);
});

test('missing chapter records include omitted and title-only chapters while reference-only sections remain excluded',()=>{
 const item=fixture();item.chapters=item.chapters.filter(row=>!['en','ack'].includes(row.id));item.chapters.find(row=>row.id==='body').text='第一章 研究设计\n\n';
 assert.deepEqual(thesisChapterCompletion(item.snapshot,item.chapters).missing.map(row=>row.id),['en','body','ack']);
 assert.deepEqual(thesisChapterCompletion({outline:[{title:'旧版方法章'}]},[{title:'旧版方法章',text:'已保存正文。'}]),{expected:1,completed:1,missing:[]});
});

test('default draft DOCX has no injected completion warning or warning heading in the table of contents',async()=>{
 const item=fixture(),presentation=thesisDocumentPresentation(item.snapshot,item.chapters),metadata=thesisExportMetadata(item),bytes=await createWritingDocx(presentation.text,{documentKind:'thesis',metadata}),zip=await JSZip.loadAsync(bytes),doc=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml'),text=[...doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','t')].map(n=>n.textContent).join('');
 assert.doesNotMatch(text,/部分章节尚未完成|本文仅包含当前已保存的章节草稿|不代表完整论文|尚未完成：/);assert.match(text,/研究按照明确的资料范围整理信息/);assert.equal((await inspectThesisExportContent(bytes,presentation.text,{metadata})).status,'passed');
 for(const range of metadata.citationRanges)assert.equal(presentation.text.slice(range.start,range.end),'['+range.number+']');
});

test('invalid completion metadata cannot silently mark an unfinished manuscript as complete',()=>{
 for(const chapterCompletion of [{expected:2,completed:2,missing:[{title:'致谢'}]},{expected:2,completed:3,missing:[]},{expected:2,completed:1,missing:null},{expected:2,completed:1,missing:[{}]}]){
  const result=auditThesisExport({text:'第一章 方法\n已保存正文。',metadata:{chapterCompletion}});assert.equal(result.checks.find(row=>row.id==='incomplete_manuscript').status,'review_required');
 }
});

test('explicit authored prose containing similar phrases is preserved verbatim',()=>{
 const item=fixture();item.chapters.find(row=>row.id==='body').text='本文分析“部分章节尚未完成”这一界面措辞，不代表完整论文就是一个可独立衡量的研究指标。';
 assert.match(thesisDocumentPresentation(item.snapshot,item.chapters).text,/本文分析“部分章节尚未完成”这一界面措辞，不代表完整论文就是一个可独立衡量的研究指标。/);
});
