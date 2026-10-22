import {projectPickerOptions} from '../dist/workspace/project-directory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {esc,icon,formatDate} from '../dist/workspace/ui.mjs';
import {toolBanner} from '../dist/workspace/tool-banner.mjs';
import {withStableView} from '../dist/workspace/view-stability.mjs';
import {documentExportButtons,bindDocumentExports} from '../dist/workspace/document-export.mjs';
import {mountRevisionAi} from '../dist/workspace/revision-ai.mjs';
import {revisionStrategy} from '../dist/workspace/revision-strategy.mjs';
import {openRevisionReport} from '../dist/workspace/revision-report.mjs';
import {normalizeConfirmedRevisionReport,reportSources} from '../dist/workspace/revision-report-model.mjs';
import {validateRevisionProtection} from '../dist/workspace/revision-protection.mjs';
import {mountAigcDetection,ensureAigcStyle} from '../dist/workspace/aigc-detection.mjs';
import * as revisionModel from '../dist/workspace/revision-model.mjs';
import * as detectionModel from '../dist/workspace/detection-model.mjs';
import * as detectionEngine from '../dist/precheck/engine.mjs';
const clean=source=>source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replaceAll("await import('/precheck/assets/parsers.js')","({extractFile:window.__extractFile})");
const revisionSource=clean(await readFile(new URL('../dist/workspace/revision.mjs',import.meta.url),'utf8'));
const detectionSource=clean(await readFile(new URL('../dist/workspace/detection.mjs',import.meta.url),'utf8'));
function fixture(t,{hash='#category/reduce',failSave=false,extractFile=async()=>({text:'真正提取的第一段正文。\n\n真正提取的第二段正文。',warnings:[]})}={}){
 const dom=new JSDOM('<nav class="sidebar"><a class="nav-link" href="#category/reduce">降重</a><a class="nav-link" href="#category/aigc">表达</a></nav><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.cn/workspace.html'+hash,runScripts:'outside-only'}),w=dom.window,notices=[],downloads=[],requests=[];
 globalThis.document=w.document;const qs=selector=>w.document.querySelector(selector);qs('dialog').close=()=>{};
 Object.assign(w,{projectPickerOptions,selectableProjects:()=>[],subscribeProjectDirectory:()=>()=>{},withStableView,esc,icon,formatDate,toolBanner,mountRevisionAi,revisionStrategy,openRevisionReport,normalizeConfirmedRevisionReport,reportSources,validateRevisionProtection,mountAigcDetection,ensureAigcStyle,documentExportButtons,bindDocumentExports,...revisionModel,...detectionModel,...detectionEngine,__extractFile:extractFile,importWorkspaceDocument:extractFile,documentImportContinuesInBackground:()=>false,keys:{drafts:'test-drafts'},projects:()=>[{id:'p1',name:'真实项目'}],list:key=>JSON.parse(w.localStorage.getItem(key)||'[]'),write:(key,rows)=>{if(failSave)throw Error('模拟保存空间不足');w.localStorage.setItem(key,JSON.stringify(rows));},recordTask:record=>requests.push(record),download:(...args)=>downloads.push(args)});
 w.confirm=()=>false;
 const ctx={mode:'reduce',notify:text=>notices.push(text),modal:(_title,html)=>{qs('#workspace-dialog-body').innerHTML=html;}};
 const click=selector=>{const target=qs(selector);assert.ok(target,'Missing '+selector);target.click();};
 const input=(selector,value)=>{qs(selector).value=value;qs(selector).dispatchEvent(new w.Event('input',{bubbles:true}));};
 const submit=selector=>qs(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 const settle=async check=>{for(let n=0;n<100;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('did not settle');};
 t.after(()=>w.close());return {w,qs,ctx,notices,downloads,requests,click,input,submit,settle};
}
function mountRevision(f){f.w.eval(revisionSource+'\nwindow.revisionTest={mountRevision,revisionHasWork,revisionRouteGuard};');f.w.revisionTest.mountRevision(f.ctx);}
const original='第一段是真实研究内容，需要核对术语与引用。\n\n第二段为保留原文的论证内容。';
test('reduction paste flows into the real editor without losing title, requirements, project or original and preserves export acceptance',async t=>{
 const f=fixture(t);mountRevision(f);assert.equal(f.qs('.dashboard').classList.contains('revision-refresh'),true);assert.equal(f.qs('[data-revision-kind]').dataset.revisionKind,'reduce');assert.equal(f.qs('.dashboard').dataset.revisionTheme,'reduce');f.click('[data-revision-input="paste"]');f.input('#revision-service-title','真实题目 <b>标题</b>');f.input('#revision-service-text',original);f.input('#revision-service-requirements','请保留研究数据');f.qs('#revision-service-project').value='p1';
 assert.equal(f.w.revisionTest.revisionHasWork(),true);assert.equal(f.w.revisionTest.revisionRouteGuard(),true);assert.equal(f.w.revisionTest.revisionHasWork(),false);assert.equal(f.qs('#revision-service-text').value,original);f.click('[data-revision-plan="dual"]');assert.match(f.qs('[data-revision-plan-status]').textContent,/审核后采纳/);assert.equal(f.qs('#revision-service-text').value,original);f.submit('#revision-entry-form');
 assert.ok(f.qs('#revision-space'));assert.equal(f.qs('#revision-service'),null);const saved=JSON.parse(f.w.localStorage.getItem('test-drafts'))[0];assert.equal(saved.mode,'rewrite');assert.equal(saved.original,original);assert.equal(saved.requirements,'请保留研究数据');assert.equal(saved.projectId,'p1');assert.equal(f.qs('.rev-document b').textContent,'真实题目 <b>标题</b>');assert.equal(f.qs('.rev-document b b'),null);assert.equal(f.w.revisionTest.revisionHasWork(),false);
 assert.equal(f.qs('.doc-detail-work-title h2').textContent,'真实题目 <b>标题</b>');assert.equal(f.qs('.doc-detail-work-title h2 b'),null);assert.match(f.qs('.doc-detail-metrics').textContent,/当前段落1\s*\/ 2/);assert.equal(f.qs('.doc-detail-metrics>div:nth-child(2) dd').textContent.trim(),'0 段');
 f.input('#rev-suggestion','第一段为已核对事实的修改表达。');f.input('#rev-comment','此处需核对真实来源');f.click('[data-rev-action="accept"]');assert.equal(f.qs('.doc-detail-metrics>div:nth-child(2) dd').textContent.trim(),'1 段');assert.equal(f.qs('.doc-detail-metrics>div:nth-child(3) dd').textContent.trim(),'1 项');f.click('[data-rev-action="save"]');f.click('[data-rev-action="export"]');f.click('#rev-export-confirm');assert.equal(f.downloads.length,1);assert.equal(f.downloads[0][1],'第一段为已核对事实的修改表达。\n\n第二段为保留原文的论证内容。');assert.equal(JSON.parse(f.w.localStorage.getItem('test-drafts'))[0].original,original);
});
test('AIGC entry creates an actual local editing document and keeps its AI-expression identity when reopened by draft URL',t=>{
 const f=fixture(t,{hash:'#category/aigc'});mountRevision(f);f.click('[data-revision-input="paste"]');f.input('#revision-service-title','表达精修');f.input('#revision-service-text',original);f.submit('#revision-entry-form');assert.ok(f.qs('#revision-space'));assert.equal(f.qs('#revision-service'),null);assert.equal(f.qs('.tool-banner h1').textContent,'降 AI 率');assert.equal(f.qs('.dashboard').dataset.revisionTheme,'aigc');const saved=JSON.parse(f.w.localStorage.getItem('test-drafts'))[0];assert.equal(saved.mode,'reduce');
 f.w.history.replaceState(null,'','#draft/'+saved.id);f.w.revisionTest.mountRevision({...f.ctx},saved.id);assert.ok(f.qs('#rev-suggestion'));assert.equal(f.qs('.tool-banner h1').textContent,'降 AI 率');assert.equal(f.qs('.dashboard').dataset.revisionTheme,'aigc');assert.equal(f.qs('.rev-editors pre').textContent,original.split('\n\n')[0]);assert.doesNotMatch(f.qs('.dashboard').textContent,/99%|降至|通过率/);
});
test('selected file is parsed into a saved original and an async parser from an old route cannot repaint the next page',async t=>{
 const f=fixture(t);mountRevision(f);const file={name:'我的原稿.txt',size:100};Object.defineProperty(f.qs('#revision-service-file'),'files',{configurable:true,value:[file]});f.qs('#revision-service-file').dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(f.qs('#revision-service-title').value,'我的原稿');assert.equal(f.w.revisionTest.revisionHasWork(),true);await f.settle(()=>/已提取/.test(f.qs('#revision-service-file-status').textContent));f.submit('#revision-entry-form');await f.settle(()=>!!f.qs('#revision-space'));assert.equal(JSON.parse(f.w.localStorage.getItem('test-drafts'))[0].fileName,'我的原稿.txt');assert.match(f.qs('.rev-editors pre').textContent,/真正提取/);
 let resolve;const g=fixture(t,{extractFile:()=>new Promise(done=>{resolve=done;})});mountRevision(g);Object.defineProperty(g.qs('#revision-service-file'),'files',{value:[file]});g.qs('#revision-service-file').dispatchEvent(new g.w.Event('change'));g.submit('#revision-entry-form');await g.settle(()=>!!resolve);g.qs('.dashboard').innerHTML='<p id="next-page">另一个功能</p>';resolve({text:original,warnings:[]});await new Promise(done=>setTimeout(done,5));assert.equal(g.qs('.dashboard').textContent,'另一个功能');assert.equal(g.w.localStorage.length,0);
});
test('invalid or unsaved revision input cannot create a fake document or discard the entered text',t=>{
 const f=fixture(t,{failSave:true});mountRevision(f);f.submit('#revision-entry-form');assert.match(f.qs('#revision-service-file-status').textContent,/请先选择/);assert.equal(f.w.localStorage.length,0);f.click('[data-revision-input="paste"]');f.input('#revision-service-title','保留的题目');f.input('#revision-service-text',original);f.submit('#revision-entry-form');assert.equal(f.qs('#revision-service-text').value,original);assert.equal(f.qs('#revision-service-title').value,'保留的题目');assert.equal(f.qs('#revision-space'),null);assert.equal(f.w.localStorage.length,0);assert.match(f.notices.join(''),/保存空间不足/);
});
async function mountDetection(f,{sources=[]}={}){
 f.w.history.replaceState(null,'','#category/detection?view=local');f.w.ensureWebSimilarityStyle=()=>{};f.w.mountWebSimilarity=()=>({dispose(){}});
 const store={sources:[...sources],reports:[]};f.w.repository={all:async key=>store[key],save:async(key,row)=>{store[key].push(row);}};f.w.reportHtml=report=>'<p>'+esc(report.title)+'</p>';f.w.eval(detectionSource+'\nwindow.detectionTest={mountDetection,detectionRouteGuard};');await f.w.detectionTest.mountDetection(f.ctx);return store;
}
test('local detection retains paste, real chapter confirmation and source-bound reports without enabling absent AI services',async t=>{
 const f=fixture(t,{hash:'#category/detection'}),source={id:'s1',title:'用户提供的实际正文',text:original,kind:'user',provider:'user_provided'},store=await mountDetection(f,{sources:[source]});assert.equal(f.qs('#det-next').disabled,true);assert.ok(f.qs('a[href="#category/reduce"]'));assert.equal(f.qs('.dashboard').classList.contains('detection-refresh'),true);f.click('[data-det-action="paste"]');f.input('#det-paste',original);f.submit('#det-paste-form');assert.equal(f.qs('#det-next').disabled,false);f.click('#det-next');assert.ok(f.qs('[data-det-section]'));assert.equal(f.qs('.det-steps [aria-current="step"]').textContent.includes('确认范围'),true);f.click('#det-next');await f.settle(()=>store.reports.length===1);assert.equal(store.reports[0].scope,'user-local-sources');assert.equal(store.reports[0].sources[0].id,'s1');assert.match(f.qs('#workspace-dialog-body').textContent,/不代表全网重复率/);f.click('[data-det-tab="ai"]');assert.equal(f.qs('.det-ai-empty a.btn.primary').getAttribute('href'),'#category/aigc?view=detection');assert.equal(f.qs('[data-det-action="run"]'),null);assert.doesNotMatch(f.qs('.det-ai-empty').textContent,/已通过|99%/);
});
test('without actual source materials the detection flow creates no invented report',async t=>{
 const f=fixture(t,{hash:'#category/detection'}),store=await mountDetection(f);assert.equal(f.qs('.doc-detail-readiness').querySelectorAll('[data-ready="true"]').length,0);assert.equal(f.qs('#detection-space').dataset.detectionState,'empty');f.click('[data-det-action="paste"]');f.input('#det-paste',original);f.submit('#det-paste-form');assert.equal(f.qs('.doc-detail-readiness').querySelectorAll('[data-ready="true"]').length,1);f.click('#det-next');assert.equal(f.qs('#detection-space').dataset.detectionState,'scope');assert.match(f.qs('.doc-detail-readiness').textContent,/待添加对照材料/);f.click('#det-next');await f.settle(()=>f.notices.some(message=>/没有实际对照正文/.test(message)));assert.equal(store.reports.length,0);assert.match(f.qs('.det-history-empty').textContent,/暂无检测报告/);
});

test('revision import modes, paragraph choice and acceptance keep the initiating control in place',t=>{
 const f=fixture(t);mountRevision(f);const paste=f.qs('[data-revision-input="paste"]');paste.focus({preventScroll:true});paste.click();assert.equal(f.w.document.activeElement,paste);assert.ok(f.qs('#revision-service').style.minHeight);
 f.input('#revision-service-title','原位编辑的文稿');f.input('#revision-service-text',original);f.submit('#revision-entry-form');
 const select=f.qs('#rev-paragraph');select.value='1';select.focus({preventScroll:true});select.dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(f.w.document.activeElement,f.qs('#rev-paragraph'));assert.equal(f.qs('#rev-paragraph').value,'1');
 const accept=f.qs('[data-rev-action="accept"]');accept.focus({preventScroll:true});accept.click();assert.equal(f.w.document.activeElement,f.qs('[data-rev-action="accept"]'));assert.match(f.qs('.doc-detail-metrics').textContent,/已采纳修改1/);
});

test('detection tabs and report filters preserve keyboard focus without resetting entered query text',async t=>{
 const f=fixture(t,{hash:'#category/detection'});await mountDetection(f);
 for(const value of ['ai','check']){const button=f.qs('.det-tabs [data-det-tab="'+value+'"]');button.focus({preventScroll:true});button.click();assert.equal(f.w.document.activeElement,f.qs('.det-tabs [data-det-tab="'+value+'"]'));}
 const query=f.qs('#det-query');query.focus({preventScroll:true});query.value='尚无匹配的真实论文';query.dispatchEvent(new f.w.Event('input',{bubbles:true}));assert.equal(f.w.document.activeElement,query);assert.equal(query.value,'尚无匹配的真实论文');assert.ok(f.qs('.dashboard').style.minHeight);
});
