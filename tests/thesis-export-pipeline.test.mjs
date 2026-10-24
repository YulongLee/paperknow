import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import * as writingDocument from '../src/writing-document.js';
import {bindDocumentExports,documentExportButtons} from '../dist/workspace/document-export.mjs';
import {renderThesisDocument} from '../dist/workspace/thesis-export-render.mjs';
import {beginDraftScope,endDraftScope} from '../dist/workspace/state.mjs';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const text='合成导出管线验收\n\n摘要\n\n这是一份仅用于自动验收的合成论文，不包含真实用户资料。\n\n第一章 研究背景\n\n引用已确认的公开题录[1]，并说明来源需要作者核对。\n\n第二章 研究方法\n\nFINAL_BODY_PARAGRAPH_20261023：研究方法与结论按原文保留。\n\n参考文献\n\n[1] 合成作者. 已确认的测试题录[J]. 合成期刊, 2026.';
const citationStart=text.indexOf('[1]');
const metadata={title:'合成导出管线验收',citationRanges:[{start:citationStart,end:citationStart+3,number:1}]};
const quality=(overrides={})=>({status:'completed',stale:false,coverage:{totalCharacters:text.length,reviewedCharacters:text.length,complete:true},reviews:[{status:'completed',outcome:'no_ai_findings',findings:[]}],consistency:{status:'no_deterministic_issues',findings:[]},...overrides});
const syntheticPdf=Uint8Array.from(Buffer.from('%PDF-1.7\n% synthetic renderer response, not a native conversion\n'));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const settle=async()=>{for(let index=0;index<8;index++)await new Promise(resolve=>setImmediate(resolve));};
async function until(predicate,message='operation did not settle',timeout=8000){const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)assert.fail(message);await new Promise(resolve=>setTimeout(resolve,5));}}

async function fixture(t,{qualityRecord=quality(),template=null,changeDocx=null,renderResult=null,renderError=null,renderWait=null,getOptionsWait=null,documentWait=null,ownerId='alice',sourceText=text,submission=false,docxOnly=false,roguePdf=false}={}){
 endDraftScope();
 const dom=new JSDOM(`<main>${documentExportButtons('thesis-test',{submission,docxOnly})}<p id="status" role="status"></p></main>`,{url:'https://paperknow.test/workspace.html#thesis/synthetic-thesis'}),previous=Object.fromEntries(['window','document','location','fetch'].map(key=>[key,{own:Object.hasOwn(globalThis,key),value:globalThis[key]}]));
 for(const key of ['window','document','location'])globalThis[key]=dom.window[key];
 beginDraftScope({ownerId,drafts:[]});
 if(roguePdf&&!dom.window.document.querySelector('#thesis-test-pdf'))dom.window.document.querySelector('main').insertAdjacentHTML('afterbegin','<button id="thesis-test-pdf">旧版 PDF 按钮</button>');
 const generated=[],rendered=[],downloads=[],requests=[],checks=[],status=dom.window.document.querySelector('#status');
 let currentText=sourceText,currentTitle=metadata.title,optionsCalls=0,fontCalls=0,legacyPdfCalls=0,current=true,closed=false;
 const options={documentKind:'thesis',submission,metadata:structuredClone(metadata),quality:structuredClone(qualityRecord),template};
 const sourceCitation=sourceText.indexOf('[1]');options.metadata.citationRanges=sourceCitation>=0?[{start:sourceCitation,end:sourceCitation+3,number:1}]:[];
 const fetchImpl=async(path,request={})=>{
  requests.push({path,request});
  if(template&&String(path).startsWith('/api/files/'))return new Response(template.bytes,{headers:{'Content-Length':String(template.bytes.length)}});
  assert.equal(path,'/api/theses/document-render');
  if(renderWait)await renderWait.promise;
  if(renderError)throw renderError;
  const result=typeof renderResult==='function'?renderResult(JSON.parse(request.body)):renderResult||{data:Buffer.from(syntheticPdf).toString('base64'),pages:2,warnings:['自动分页需要核对。']};
  return Response.json(result);
 };
 globalThis.fetch=fetchImpl;
 const api={...writingDocument,
  createWritingDocx:async(value,documentOptions)=>{
   const bytes=await writingDocument.createWritingDocx(value,documentOptions),result=changeDocx?await changeDocx(bytes):bytes;
   generated.push({text:value,options:documentOptions,bytes:result});return result;
  },
  createWritingPdf:async()=>{legacyPdfCalls++;throw Error('legacy PDF must never run for a thesis');},
  auditThesisExport:input=>{const report=writingDocument.auditThesisExport(input);checks.push(report);return report;},
 };
 bindDocumentExports('thesis-test',()=>currentText,()=>currentTitle,status,{
  docxOnly,isCurrent:()=>current,
  loadDocument:async()=>{if(documentWait)await documentWait.promise;return api;},
  loadFont:async()=>{fontCalls++;throw Error('thesis export must not load legacy PDF font');},
  getDocumentOptions:async()=>{optionsCalls++;if(getOptionsWait)await getOptionsWait.promise;return options;},
  renderDocument:async(bytes,renderOptions)=>{rendered.push({bytes,options:renderOptions});return renderThesisDocument(bytes,{...renderOptions,fetchImpl});},
  downloadFile:async(name,bytes,mime,downloadOptions)=>{downloads.push({name,bytes,mime,options:downloadOptions});return{message:'已保存并下载'};},
 });
 const close=()=>{if(closed)return;closed=true;endDraftScope();for(const [key,prior]of Object.entries(previous))if(key==='fetch'?globalThis.fetch===fetchImpl:globalThis[key]===dom.window[key]){if(prior.own)globalThis[key]=prior.value;else delete globalThis[key];}dom.window.close();};
 t.after(close);
 return{dom,status,generated,rendered,downloads,requests,checks,options,close,
  get optionsCalls(){return optionsCalls;},get fontCalls(){return fontCalls;},get legacyPdfCalls(){return legacyPdfCalls;},get sourceText(){return currentText;},
  q:selector=>dom.window.document.querySelector(selector),
  click:format=>dom.window.document.querySelector('#thesis-test-'+format).click(),
  changeText:()=>{currentText='另一次编辑后的正文不应替代点击时的原文。';currentTitle='另一次修改后的标题';},
  leave:()=>{current=false;},
  switchOwner:owner=>{endDraftScope();beginDraftScope({ownerId:owner,drafts:[]});},
  complete:async()=>{await until(()=>!dom.window.document.querySelector('#thesis-test-docx').disabled,'document export did not finish');await settle();},
 };
}

async function withTemplate(){
 const bytes=await writingDocument.createWritingDocx('学校封面固定布局\n\n{{论文题目}}\n\n{{正文}}\n\n学校封底固定说明');
 return{version:1,status:'ready',source:{fileId:'synthetic-template',name:'合成学校模板.docx',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},bytes};
}
const xmlOf=async bytes=>{const zip=await JSZip.loadAsync(bytes);return zip.file('word/document.xml').async('string');};

test('DOCX-only thesis delivery retains formal checks and editable drafts without offering or downloading a PDF',async t=>{
 const f=await fixture(t,{submission:true,docxOnly:true});
 assert.equal(f.q('#thesis-test-pdf'),null);assert.ok(f.q('#thesis-test-docx'));assert.ok(f.q('#thesis-test-draft'));
 f.click('docx');await f.complete();assert.equal(f.generated.length,0);assert.equal(f.rendered.length,0);assert.match(f.status.textContent,/尚未满足终稿导出条件/);
 f.click('draft');await f.complete();assert.equal(f.downloads.length,1);assert.match(f.downloads[0].name,/（初稿）\.docx$/);assert.equal(f.downloads[0].mime,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 assert.equal(f.rendered.length,1,'Pagination checking is retained for Word delivery');assert.equal(f.legacyPdfCalls,0);assert.doesNotMatch(f.status.textContent,/PDF|TXT/);assert.doesNotMatch(f.q('[data-export-check]').textContent,/PDF/);
});

test('a stale PDF control cannot invoke generation, rendering or cloud download in a DOCX-only binding',async t=>{
 const f=await fixture(t,{submission:true,docxOnly:true,roguePdf:true});f.click('pdf');await settle();
 assert.equal(f.optionsCalls,0);assert.equal(f.generated.length,0);assert.equal(f.rendered.length,0);assert.equal(f.downloads.length,0);assert.equal(f.fontCalls,0);
});

test('formal export checks stop an incomplete manuscript before conversion while its editable draft remains downloadable',async t=>{
 const f=await fixture(t,{submission:true});f.click('docx');await f.complete();assert.equal(f.generated.length,0);assert.equal(f.downloads.length,0);assert.equal(f.rendered.length,0);assert.match(f.status.textContent,/尚未满足终稿导出条件/);assert.ok(f.q('[data-export-check]').open);
 f.click('draft');await f.complete();assert.equal(f.downloads.length,1);assert.match(f.downloads[0].name,/（初稿）\.docx$/);
});

test('formal Word delivery uses the source-verified refreshed Word copy after successful completeness and field checks',async t=>{
 const complete='合成研究\n摘要\n'+('研究设计与验证。'.repeat(35))+'\n关键词：研究；设计；验证\nAbstract\n'+('This study reports the supplied design and evaluation. '.repeat(25))+'\nKey words: study; design; evaluation\n第一章 研究方法\n实际研究与文献依据[1]。\n参考文献\n[1] A. Author. A Study[J]. Journal, 2025.';
 const f=await fixture(t,{submission:true,sourceText:complete,renderResult:payload=>({data:Buffer.from(syntheticPdf).toString('base64'),docxData:payload.data,fieldsRefreshed:true,pages:3,warnings:[]})});f.options.metadata.englishTitle='A Study Design';f.options.metadata.title='合成研究';f.click('docx');await f.complete();assert.equal(f.downloads.length,1,f.status.textContent);assert.equal(f.rendered.length,1);assert.deepEqual(f.downloads[0].bytes,f.generated[0].bytes);assert.match(f.status.textContent,/已保存并下载/);
});

for(const format of ['docx','pdf'])test(`real thesis ${format.toUpperCase()} pipeline uses DOCX content validation and the same document-render client`,async t=>{
 const template=await withTemplate(),original=Buffer.from(template.bytes),f=await fixture(t,{template});
 try{
  f.click(format);await f.complete();
  assert.equal(f.optionsCalls,1,'PDF and Word both resolve the actual thesis options');
  assert.equal(f.generated.length,1);assert.equal(f.generated[0].text,text);assert.equal(f.generated[0].options.documentKind,'thesis');
  assert.equal(f.rendered.length,1);assert.deepEqual(f.rendered[0].bytes,f.generated[0].bytes);
  assert.equal(f.legacyPdfCalls,0);assert.equal(f.fontCalls,0);assert.equal(f.downloads.length,1);
  assert.deepEqual(f.downloads[0].options,{expectedUserId:'alice'});assert.equal(f.downloads[0].name,metadata.title+'.'+format);
  assert.deepEqual(f.downloads[0].bytes,format==='pdf'?syntheticPdf:f.generated[0].bytes);
  assert.equal(f.downloads[0].mime,format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const xml=await xmlOf(f.generated[0].bytes);assert.match(xml,/学校封面固定布局/);assert.match(xml,/学校封底固定说明/);assert.match(xml,/FINAL_BODY_PARAGRAPH_20261023/);assert.doesNotMatch(xml,/\{\{正文\}\}/);
  assert.deepEqual(Buffer.from(template.bytes),original,'the uploaded template is unchanged');assert.equal(f.sourceText,text);
  const panel=f.q('[data-export-check]');assert.ok(panel);assert.equal(panel.hidden,false);panel.open=true;
  assert.match(panel.querySelector('summary').textContent,/本次导出检查/);assert.equal(panel.querySelector('summary').textContent.includes('有待核对事项'),f.checks[0].status==='review_required','template recognition caveats remain visible instead of being presented as a clean review');
  assert.match(panel.textContent,/按模板正文占位位置填入/);assert.match(panel.textContent,/正文文字检查：\d+ 项已按段落及顺序核对/);assert.match(panel.textContent,/已生成 2 页/);assert.match(panel.textContent,/页面边界与缺字检查未完成/);assert.match(panel.textContent,/不代表事实核验或人工逐页审定/);
  assert.match(f.status.textContent,/请核对 Word 中的最终版式/);assert.ok(f.checks[0].checks.some(row=>row.id==='existing_review'&&row.status==='passed'));
 }finally{f.close();}
});

test('the document-render client sends canonical DOCX base64 with the captured expected owner and decodes only the returned PDF',async t=>{
 const f=await fixture(t);
 try{
  f.click('pdf');await f.complete();
  assert.equal(f.requests.length,1);const {path,request}=f.requests[0];assert.equal(path,'/api/theses/document-render');assert.equal(request.method,'POST');assert.equal(request.credentials,'same-origin');assert.deepEqual(request.headers,{'Content-Type':'application/json','X-PaperKnow-User':'alice'});
  const payload=JSON.parse(request.body);assert.deepEqual(Object.keys(payload).sort(),['data','expectedUserId']);assert.equal(payload.expectedUserId,'alice');assert.equal(payload.data,Buffer.from(f.generated[0].bytes).toString('base64'));assert.deepEqual(Buffer.from(payload.data,'base64'),Buffer.from(f.generated[0].bytes));
  assert.equal(request.signal.aborted,false);assert.equal(f.rendered[0].options.signal.aborted,true,'completed UI operation releases its own abort controller');assert.deepEqual(f.downloads[0].bytes,syntheticPdf);
 }finally{f.close();}
});

test('the actual DOCX content inspector rejects a removed body paragraph before either render or download',async t=>{
 const changeDocx=async bytes=>{
  const zip=await JSZip.loadAsync(bytes),doc=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');let removed=0;
  for(const node of [...doc.getElementsByTagNameNS(W,'p')]){const value=[...node.getElementsByTagNameNS(W,'t')].map(part=>part.textContent).join('');if(value.includes('FINAL_BODY_PARAGRAPH_20261023')){node.parentNode.removeChild(node);removed++;}}
  assert.equal(removed,1);zip.file('word/document.xml',new XMLSerializer().serializeToString(doc));return zip.generateAsync({type:'uint8array'});
 };
 for(const format of ['docx','pdf']){
  const f=await fixture(t,{changeDocx});try{f.click(format);await f.complete();assert.equal(f.generated.length,1);assert.equal(f.rendered.length,0);assert.equal(f.downloads.length,0);assert.equal(f.legacyPdfCalls,0);assert.match(f.status.textContent,/正文完整性核对未通过/);assert.equal(f.sourceText,text);}finally{f.close();}
 }
});

for(const [label,qualityRecord,message]of [
 ['stale',quality({stale:true}),/不代表当前导出版本/],
 ['partial',quality({status:'partial',coverage:{totalCharacters:1000,reviewedCharacters:300,complete:false},reviews:[{status:'completed',findings:[]},{status:'not_started',reason:'PRIVATE provider internal diagnostic',findings:[]}]}),/300 \/ 1000/],
 ['missing',null,/尚无可用的全文辅助审校记录/],
])test(`${label} AI review stays visibly marked for review during an otherwise successful real export`,async t=>{
 const f=await fixture(t,{qualityRecord});
 try{f.click('docx');await f.complete();assert.equal(f.downloads.length,1);const panel=f.q('[data-export-check]');assert.ok(panel);panel.open=true;assert.match(panel.querySelector('summary').textContent,/有待核对事项/);assert.match(panel.textContent,message);assert.match(f.status.textContent,/存在待核对事项/);assert.equal(f.checks[0].status,'review_required');assert.notEqual(f.checks[0].checks.find(row=>row.id==='existing_review').status,'passed');assert.doesNotMatch(panel.textContent,/PRIVATE/);assert.equal(f.sourceText,text);}finally{f.close();}
});

test('PDF conversion failure stops download and never falls back to the unrelated plain-text PDF engine',async t=>{
 const f=await fixture(t,{renderError:Error('合成页面转换失败，请稍后重试。')});
 try{f.click('pdf');await f.complete();assert.equal(f.generated.length,1);assert.equal(f.rendered.length,1);assert.equal(f.downloads.length,0);assert.equal(f.legacyPdfCalls,0);assert.equal(f.fontCalls,0);assert.match(f.status.textContent,/合成页面转换失败/);assert.equal(f.sourceText,text);}finally{f.close();}
});

test('DOCX remains downloadable on conversion failure with an explicit unrendered-page warning and retained content checks',async t=>{
 const f=await fixture(t,{renderError:Error('合成页面转换失败，请稍后重试。')});
 try{f.click('docx');await f.complete();assert.equal(f.downloads.length,1);assert.deepEqual(f.downloads[0].bytes,f.generated[0].bytes);assert.equal(f.legacyPdfCalls,0);const panel=f.q('[data-export-check]');panel.open=true;assert.match(panel.textContent,/页面渲染尚未完成/);assert.match(panel.textContent,/合成页面转换失败/);assert.match(panel.textContent,/正文文字检查：\d+ 项已按段落及顺序核对/);assert.match(f.status.textContent,/页面渲染未完成.*可编辑 Word/);assert.equal(f.sourceText,text);}finally{f.close();}
});

test('invalid PDF envelopes are rejected by the client rather than becoming successful thesis downloads',async t=>{
 for(const renderResult of [{data:Buffer.from('NOT-PDF').toString('base64'),pages:2},{data:Buffer.from(syntheticPdf).toString('base64'),pages:0},{data:null,pages:1}]){
  const f=await fixture(t,{renderResult});try{f.click('pdf');await f.complete();assert.equal(f.downloads.length,0);assert.equal(f.legacyPdfCalls,0);assert.match(f.status.textContent,/页面(?:检查)?结果.*(?:格式无效|不完整)/);}finally{f.close();}
 }
});

test('the clicked manuscript and title remain immutable while options and rendering are asynchronous',async t=>{
 const getOptionsWait=deferred(),f=await fixture(t,{getOptionsWait});
 try{f.click('docx');await until(()=>f.optionsCalls===1);f.changeText();getOptionsWait.resolve();await f.complete();assert.equal(f.generated[0].text,text);assert.equal(f.downloads[0].name,metadata.title+'.docx');assert.match(await xmlOf(f.downloads[0].bytes),/FINAL_BODY_PARAGRAPH_20261023/);assert.doesNotMatch(await xmlOf(f.downloads[0].bytes),/另一次编辑后的正文/);}finally{f.close();}
});

test('a draft owner change during asynchronous document loading cannot generate or download the prior manuscript',async t=>{
 const documentWait=deferred(),f=await fixture(t,{documentWait});
 try{f.click('pdf');f.switchOwner('bob');documentWait.resolve();await settle();assert.equal(f.optionsCalls,0);assert.equal(f.generated.length,0);assert.equal(f.requests.length,0);assert.equal(f.downloads.length,0);}finally{f.close();}
});

for(const change of ['owner','view'])test(`${change} change aborts an in-flight native-render request and prevents any late PDF download`,async t=>{
 const renderWait=deferred(),f=await fixture(t,{renderWait});
 try{f.click('pdf');await until(()=>f.rendered.length===1&&f.requests.length===1);const signal=f.requests[0].request.signal;assert.equal(signal.aborted,false);if(change==='owner')f.switchOwner('bob');else f.leave();await until(()=>signal.aborted,'scope change did not abort the request',2000);renderWait.resolve();await settle();assert.equal(f.downloads.length,0);assert.equal(f.legacyPdfCalls,0);assert.equal(f.sourceText,text);}finally{renderWait.resolve();f.close();}
});

test('detached thesis export controls cannot download a completed conversion into a replacement page',async t=>{
 const renderWait=deferred(),f=await fixture(t,{renderWait});
 try{f.click('docx');await until(()=>f.requests.length===1);f.q('main').replaceChildren(f.dom.window.document.createElement('h1'));f.q('h1').textContent='另一账户页面';renderWait.resolve();await settle();assert.equal(f.downloads.length,0);assert.equal(f.q('main').textContent,'另一账户页面');}finally{renderWait.resolve();f.close();}
});

async function missingTemplateRegions(){
 const bytes=await writingDocument.createWritingDocx('合成大学本科毕业论文\n论文题目：{{论文题目}}\n摘要\n这里是模板中文摘要样例，必须用作者的实际摘要替换。\nAbstract\nThe example English abstract must not be used as the manuscript.\n目录\n第一章 模板示例\n这里是模板正文样例，需要用真实正文替换并确认长度。\n参考文献\n[1] 模板原有参考文献示例。\n致谢\n此处为模板致谢样例，不能冒充作者的实际致谢。');
 return{version:1,status:'ready',source:{fileId:'pending-regions-template',name:'带英文摘要和致谢的合成学校模板.docx',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},bytes};
}

for(const format of ['docx','pdf'])test(`final template-added pending fields are shown in the ${format.toUpperCase()} delivery report even when input had none`,async t=>{
 const template=await missingTemplateRegions(),f=await fixture(t,{template});
 try{
  assert.equal(writingDocument.auditThesisExport({text,metadata,quality:quality()}).counts.unresolvedPlaceholders,0);
  f.click(format);await f.complete();assert.equal(f.downloads.length,1,'a pending field is review guidance, not a download block');
  const content=await writingDocument.inspectThesisExportContent(f.generated[0].bytes,text),report=f.checks[0],row=report.checks.find(check=>check.id==='unresolved_placeholders');
  assert.equal(content.unresolvedPlaceholders,2);assert.equal(row.count,2);assert.equal(row.status,'review_required');assert.equal(report.counts.unresolvedPlaceholders,2);assert.equal(report.status,'review_required');
  assert.equal(report.warnings.filter(warning=>warning.code==='unresolved_placeholders').length,1);assert.match(row.message,/含模板补入的未填写项目/);
  const panel=f.q('[data-export-check]');panel.open=true;assert.match(panel.textContent,/导出文档有 2 处待补充或待核对标记/);assert.doesNotMatch(panel.textContent,/未发现明确的待补充或待核对占位标记/);assert.match(f.status.textContent,/存在待核对事项/);assert.equal(f.sourceText,text);
 }finally{f.close();}
});

test('final pending-marker count includes input and template fields exactly once instead of adding both audit totals',async t=>{
 const sourceText=text.replace('FINAL_BODY_PARAGRAPH_20261023：','【待补充：研究观察原件】FINAL_BODY_PARAGRAPH_20261023：'),f=await fixture(t,{template:await missingTemplateRegions(),sourceText});
 try{assert.equal(writingDocument.auditThesisExport({text:sourceText,metadata:{citationRanges:[]}}).counts.unresolvedPlaceholders,1);f.click('docx');await f.complete();assert.equal(f.downloads.length,1);const result=await writingDocument.inspectThesisExportContent(f.generated[0].bytes,sourceText);assert.equal(result.unresolvedPlaceholders,3);assert.equal(f.checks[0].counts.unresolvedPlaceholders,3);assert.equal(f.checks[0].checks.find(row=>row.id==='unresolved_placeholders').count,3);assert.equal(f.sourceText,sourceText);}finally{f.close();}
});
