import {validatePaperUpload} from '../dist/workspace/paper-upload-policy.mjs';
import {mountRevisionReportEntry} from '../dist/workspace/revision-report-entry.mjs';
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
import {revisionComparisonMarkup,openRevisionSources} from '../dist/workspace/revision-source-ui.mjs';
import {normalizeRevisionComparison,compareRevisionDocument} from '../dist/workspace/revision-comparison-model.mjs';
import {loadRevisionComparisonHandoff,hasRevisionComparisonHandoff} from '../dist/workspace/revision-comparison-handoff.mjs';
import {normalizeConfirmedRevisionReport,reportSources} from '../dist/workspace/revision-report-model.mjs';
import {validateRevisionProtection} from '../dist/workspace/revision-protection.mjs';
import {mountAigcDetection,ensureAigcStyle} from '../dist/workspace/aigc-detection.mjs';
import * as model from '../dist/workspace/revision-model.mjs';
import {revisionAiSnapshot} from '../dist/workspace/revision-ai-model.mjs';
import {normalizeToolRequest} from '../backend/tool-run-model.mjs';

const source=(await readFile(new URL('../dist/workspace/revision.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const until=async check=>{for(let i=0;i<100;i++){if(check())return;await tick();}assert.ok(check(),'UI did not settle');};
function fixture(t,{entry=true,extract=async()=>({text:'Parsed source.',warnings:[]})}={}){
 const dom=new JSDOM('<main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.test/workspace.html'+(entry?'#category/reduce':'#tool/rewrite'),runScripts:'outside-only'}),w=dom.window,$=selector=>w.document.querySelector(selector),notices=[],downloads=[],requests=[];let fail=false,entryFail=false;const storageCalls={reads:0,writes:0,entryWrites:0};
 globalThis.document=w.document;
 const originalSet=w.Storage.prototype.setItem;
 w.Storage.prototype.setItem=function(key,value){if(key==='paperknow-revision-entry')storageCalls.entryWrites++;if(entryFail&&key==='paperknow-revision-entry')throw Error('Synthetic entry quota');return originalSet.call(this,key,value);};
 // Legacy editor/import safety cases explicitly exercise expression-only preparation.
 Object.assign(w,{validatePaperUpload,mountRevisionReportEntry:options=>mountRevisionReportEntry({...options,initialMode:"direct"})},{projectPickerOptions},{withStableView,esc,icon,formatDate,toolBanner,mountRevisionAi,revisionStrategy,openRevisionReport,revisionComparisonMarkup,openRevisionSources,normalizeRevisionComparison,compareRevisionDocument,loadRevisionComparisonHandoff,hasRevisionComparisonHandoff,normalizeConfirmedRevisionReport,reportSources,validateRevisionProtection,mountAigcDetection,ensureAigcStyle,documentExportButtons,bindDocumentExports,...model,importWorkspaceDocument:extract,documentImportContinuesInBackground:()=>false,keys:{drafts:'test-drafts'},projects:()=>[],list:key=>{storageCalls.reads++;return JSON.parse(w.localStorage.getItem(key)||'[]');},write:(key,rows)=>{storageCalls.writes++;if(fail)throw Error('Synthetic storage failure');w.localStorage.setItem(key,JSON.stringify(rows));},recordTask:()=>{},download:(...args)=>downloads.push(args)});
 w.confirm=()=>false;
 const closeDialog=()=>{$('dialog').removeAttribute('open');$('dialog').dispatchEvent(new w.Event('close'));};$('dialog').close=closeDialog;
 const ctx={mode:entry?'reduce':'rewrite',notify:text=>notices.push(text),modal:(_title,html)=>{$('#workspace-dialog-body').innerHTML=html;$('dialog').setAttribute('open','');},api:async(...args)=>{requests.push(args);throw Error('Unexpected API request');}};
 w.eval(source+'\nwindow.revisionSafety={mountRevision,disposeRevision,revisionHasWork,revisionRouteGuard};');w.revisionSafety.mountRevision(ctx);
 t.after(()=>{fail=false;entryFail=false;w.revisionSafety.disposeRevision();w.Storage.prototype.setItem=originalSet;dom.window.close();});
 return{w,$,ctx,notices,downloads,requests,storageCalls,closeDialog,fail:value=>{fail=value;},failEntry:value=>{entryFail=value;},drafts:()=>JSON.parse(w.localStorage.getItem('test-drafts')||'[]'),input(selector,value){const node=$(selector);assert.ok(node,selector);node.value=value;node.dispatchEvent(new w.Event('input',{bubbles:true}));},click(selector){assert.ok($(selector),selector);$(selector).click();},submit(selector){$(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));},file(selector,name){const node=$(selector),file={name,size:100};Object.defineProperty(node,'files',{configurable:true,value:[file]});node.dispatchEvent(new w.Event('change',{bubbles:true}));return file;}};
}
function create(f,text='FIRST original paragraph.\n\nSECOND original paragraph.'){
 f.click('[data-revision-input="paste"]');f.input('#revision-service-title','Existing document');f.input('#revision-service-text',text);f.submit('#revision-entry-form');assert.ok(f.$('#revision-space'));
}

test('R-FILE-LATE-OVERWRITE: the selected newer file wins even when an ignored-abort older parse finishes last',async t=>{
 const pending=new Map(),f=fixture(t,{extract:(file,_status,options)=>new Promise(resolve=>pending.set(file.name,{resolve,signal:options.signal}))});
 f.input('#revision-service-title','Synthetic file race');f.file('#revision-service-file','older.docx');f.file('#revision-service-file','newer.docx');assert.equal(pending.get('older.docx').signal.aborted,true);
 pending.get('newer.docx').resolve({text:'NEWER selected source.',warnings:['Newer warning']});await until(()=>/newer.docx.*已提取/.test(f.$('#revision-service-file-status').textContent));pending.get('older.docx').resolve({text:'OLDER late source.',warnings:['Old warning']});await tick();
 assert.match(f.$('#revision-service-file-status').textContent,/newer.docx/);f.submit('#revision-entry-form');const saved=f.drafts()[0];assert.equal(saved.fileName,'newer.docx');assert.equal(saved.original,'NEWER selected source.');assert.deepEqual(saved.warnings,['Newer warning']);
});

test('an old import cannot clear the current busy state or enable creation before the newer source is ready',async t=>{
 const pending=new Map(),f=fixture(t,{extract:file=>new Promise(resolve=>pending.set(file.name,resolve))});f.input('#revision-service-title','Current source');f.file('#revision-service-file','older.docx');f.file('#revision-service-file','current.docx');pending.get('older.docx')({text:'Stale source.',warnings:[]});await tick();
 assert.equal(f.$('[data-revision-service-action="start"]').disabled,true);assert.equal(f.w.revisionSafety.revisionRouteGuard(),false);f.submit('#revision-entry-form');assert.equal(f.drafts().length,0);pending.get('current.docx')({text:'Current complete source.',warnings:[]});await until(()=>!f.$('[data-revision-service-action="start"]').disabled);f.submit('#revision-entry-form');assert.equal(f.drafts()[0].original,'Current complete source.');
});

test('a route-changed import cannot adopt text or leave its original form permanently busy if navigation is reverted',async t=>{
 const pending=[],f=fixture(t,{extract:()=>new Promise(resolve=>pending.push(resolve))});f.input('#revision-service-title','Route guard source');f.file('#revision-service-file','source.docx');f.w.history.replaceState(null,'','#home');pending[0]({text:'Ignored during the route transition.',warnings:[]});await tick();assert.equal(f.$('[data-revision-service-action="start"]').disabled,false);assert.equal(f.w.localStorage.getItem('paperknow-revision-entry'),null);f.w.history.replaceState(null,'','#category/reduce');f.submit('#revision-entry-form');assert.equal(pending.length,2);pending[1]({text:'Explicitly retried source.',warnings:[]});await until(()=>f.drafts().length===1);assert.equal(f.drafts()[0].original,'Explicitly retried source.');
});

test('R-MODAL-LATE-OVERWRITE: manual text entered during parsing remains until the explicit replacement is chosen',async t=>{
 let resolve;const f=fixture(t,{entry:false,extract:()=>new Promise(done=>{resolve=done;})});f.click('[data-rev-action="new"]');f.file('#rev-file','source.docx');f.input('#rev-input-text','Manual text entered while parsing.');resolve({text:'Complete parsed original.',warnings:['Review the actual source.']});await until(()=>!!f.$('[data-rev-use-parsed]'));
 assert.equal(f.$('#rev-input-text').value,'Manual text entered while parsing.');assert.equal(JSON.parse(f.w.localStorage.getItem('paperknow-revision-entry'))['modal-rewrite'].text,'Manual text entered while parsing.');f.click('[data-rev-use-parsed]');assert.equal(f.$('#rev-input-text').value,'Complete parsed original.');assert.equal(f.$('[data-rev-use-parsed]'),null);f.submit('#rev-create');assert.equal(f.drafts()[0].original,'Complete parsed original.');assert.equal(f.drafts()[0].fileName,'source.docx');assert.deepEqual(f.drafts()[0].warnings,['Review the actual source.']);
});

test('a pending explicit parsed replacement belongs only to its file generation and cannot apply after reselection',async t=>{
 const pending=new Map(),f=fixture(t,{entry:false,extract:file=>new Promise(resolve=>pending.set(file.name,resolve))});f.click('[data-rev-action="new"]');f.file('#rev-file','older.docx');f.input('#rev-input-text','Manual source to keep.');pending.get('older.docx')({text:'Older parsed replacement.',warnings:[]});await until(()=>!!f.$('[data-rev-use-parsed]'));const oldButton=f.$('[data-rev-use-parsed]');f.w.confirm=()=>true;f.file('#rev-file','newer.docx');oldButton.click();assert.equal(f.$('#rev-input-text').value,'Manual source to keep.');pending.get('newer.docx')({text:'Newest parsed original.',warnings:[]});await until(()=>f.$('#rev-input-text').value==='Newest parsed original.');assert.equal(f.$('[data-rev-use-parsed]'),null);
});

test('closing the create dialog invalidates its parser even when the removed form has not been reused',async t=>{
 let resolve,signal;const f=fixture(t,{entry:false,extract:(_file,_status,options)=>{signal=options.signal;return new Promise(done=>{resolve=done;});}});f.click('[data-rev-action="new"]');f.input('#rev-title','Prepared title');f.file('#rev-file','late.docx');f.closeDialog();assert.equal(signal.aborted,true);const before=f.w.localStorage.getItem('paperknow-revision-entry');resolve({text:'Late result must not be adopted.',warnings:[]});await tick();assert.equal(f.w.localStorage.getItem('paperknow-revision-entry'),before);assert.equal(f.$('#rev-input-text').value,'');assert.equal(f.drafts().length,0);
});

test('R-FAILED-CREATE-INDEX: failed new-document persistence restores the old selected paragraph, plan and export text',t=>{
 const f=fixture(t);f.click('[data-revision-plan="dual"]');create(f);const original=f.drafts()[0],select=f.$('#rev-paragraph');select.value='1';select.dispatchEvent(new f.w.Event('change',{bubbles:true}));f.input('#rev-suggestion','SECOND manually revised candidate.');f.click('[data-rev-action="new"]');f.input('#rev-title','New document');f.input('#rev-input-text','New original.');f.fail(true);f.submit('#rev-create');assert.match(f.$('#rev-form-error').textContent,/旧稿均保留/);assert.equal(f.$('#rev-paragraph').value,'1');assert.equal(f.$('#rev-suggestion').value,'SECOND manually revised candidate.');f.closeDialog();f.fail(false);f.click('[data-rev-action="accept"]');
 const saved=f.drafts()[0];assert.equal(saved.id,original.id);assert.equal(saved.mode,'rewrite');assert.equal(saved.plan,'dual');assert.equal(saved.original,original.original);assert.equal(saved.paragraphs[0].accepted,false);assert.equal(saved.paragraphs[0].suggestion,'FIRST original paragraph.');assert.equal(saved.paragraphs[1].accepted,true);assert.equal(saved.versions[0].paragraphs[1].original,'SECOND original paragraph.');assert.equal(model.revisedText(saved),'FIRST original paragraph.\n\nSECOND manually revised candidate.');
});

test('R-MODAL-FAILED-SAVE-LEAVE: failed preparation persistence blocks navigation and unload, then restores after storage recovers',t=>{
 const f=fixture(t,{entry:false});f.click('[data-rev-action="new"]');f.failEntry(true);f.input('#rev-title','Unsaved preparation');f.input('#rev-input-text','Manual original must survive.');assert.match(f.$('#rev-create-draft-state').textContent,/保存失败/);assert.equal(f.w.revisionSafety.revisionHasWork(),true);assert.equal(f.w.revisionSafety.revisionRouteGuard(),false);const unload=new f.w.Event('beforeunload',{cancelable:true});f.w.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);assert.equal(f.$('#rev-input-text').value,'Manual original must survive.');
 f.failEntry(false);assert.equal(f.w.revisionSafety.revisionRouteGuard(),true);const saved=JSON.parse(f.w.localStorage.getItem('paperknow-revision-entry'))['modal-rewrite'];assert.equal(saved.title,'Unsaved preparation');assert.equal(saved.text,'Manual original must survive.');f.closeDialog();f.click('[data-rev-action="new"]');assert.equal(f.$('#rev-input-text').value,'Manual original must survive.');
});

test('a hash navigation guard still sees a failed create draft after location already changed',t=>{
 const f=fixture(t,{entry:false});f.click('[data-rev-action="new"]');f.failEntry(true);f.input('#rev-input-text','Unsaved draft at route transition.');f.w.history.replaceState(null,'','#home');assert.equal(f.w.revisionSafety.revisionHasWork(),true);assert.equal(f.w.revisionSafety.revisionRouteGuard(),false);assert.equal(f.$('#rev-input-text').value,'Unsaved draft at route transition.');
});

test('export never substitutes the previously saved document when the latest accepted edits cannot be persisted',t=>{
 const f=fixture(t);create(f);f.input('#rev-suggestion','Latest manually checked FIRST paragraph.');f.fail(true);f.click('[data-rev-action="accept"]');f.click('[data-rev-action="export"]');f.click('#rev-export-confirm');f.click('#rev-result-docx');assert.equal(f.downloads.length,0);assert.equal(f.drafts()[0].text,'FIRST original paragraph.\n\nSECOND original paragraph.');f.fail(false);f.click('#rev-export-confirm');assert.equal(f.downloads.length,1);assert.equal(f.downloads[0][1],'Latest manually checked FIRST paragraph.\n\nSECOND original paragraph.');
});

test('R-ALL-COUNT-MISMATCH: 120 paragraphs and exact 32,000/3,500 boundaries agree with server admission',()=>{
 const make=text=>model.createRevision({title:'Bounded original',mode:'rewrite',text},'r','now'),snapshot=text=>revisionAiSnapshot(make(text),{scope:'all'}),validate=value=>normalizeToolRequest({kind:'revision',operation:'rewrite',snapshot:value});
 const paragraphs=Array.from({length:120},(_,i)=>'Paragraph '+i+'.').join('\n\n');assert.equal(snapshot(paragraphs).context.paragraphIds.length,120);assert.doesNotThrow(()=>validate(snapshot(paragraphs)));assert.throws(()=>snapshot(paragraphs+'\n\nExtra paragraph.'),/120 段/);
 assert.doesNotThrow(()=>validate(snapshot('x'.repeat(3500))));assert.throws(()=>snapshot('x'.repeat(3501)),/3,500/);assert.doesNotThrow(()=>validate(snapshot('  '+'x'.repeat(3500)+'  ')));
 const exact=Array(9).fill('x'.repeat(3200)).concat('y'.repeat(3182)).join('\n\n');assert.equal(exact.length,32000);assert.doesNotThrow(()=>validate(snapshot(exact)));assert.throws(()=>snapshot(exact+'z'),/32,000/);
});

test('an oversized all-paragraph scope is rejected before auth, quote or chargeable submission',async t=>{
 const dom=new JSDOM('<main><div id="panel"></div></main>',{url:'https://paperknow.test/workspace.html#tool/rewrite'}),notices=[],calls=[],doc=model.createRevision({title:'Many short paragraphs',text:Array(121).fill('Short source.').join('\n\n'),mode:'rewrite'},'r','now');globalThis.document=dom.window.document;
 const ui=mountRevisionAi({container:dom.window.document.querySelector('#panel'),getDocument:()=>doc,updateDocument:()=>{},ctx:{notify:value=>notices.push(value),api:async(...args)=>{calls.push(args);throw Error('No request expected');}}});t.after(()=>{ui.dispose();dom.window.close();});const scope=dom.window.document.querySelector('[data-rev-ai-scope]');scope.value='all';scope.dispatchEvent(new dom.window.Event('change'));dom.window.document.querySelector('[data-rev-ai-open]').click();await tick();assert.match(notices.join(''),/120 段/);assert.equal(calls.length,0);assert.match(dom.window.document.querySelector('.rev-ai-note').textContent,/120 段/);
});


test('clean revision navigation and disposal do not read or rewrite the full draft collection',t=>{
 const f=fixture(t);create(f);Object.assign(f.storageCalls,{reads:0,writes:0,entryWrites:0});
 assert.equal(f.w.revisionSafety.revisionRouteGuard(),true);assert.equal(f.w.revisionSafety.revisionRouteGuard(),true);f.w.revisionSafety.disposeRevision();
 assert.deepEqual(f.storageCalls,{reads:0,writes:0,entryWrites:0});
});
test('an edited revision checkpoints once across repeated navigation guards and disposal',t=>{
 const f=fixture(t);create(f);Object.assign(f.storageCalls,{reads:0,writes:0,entryWrites:0});f.input('#rev-suggestion','The revised sentence still requires review.');
 assert.equal(f.w.revisionSafety.revisionRouteGuard(),true);assert.equal(f.w.revisionSafety.revisionRouteGuard(),true);f.w.revisionSafety.disposeRevision();
 assert.deepEqual(f.storageCalls,{reads:1,writes:1,entryWrites:0});assert.equal(f.drafts()[0].paragraphs[0].suggestion,'The revised sentence still requires review.');assert.equal(f.drafts()[0].paragraphs[0].accepted,false);
});
test('failed revision checkpoint remains dirty, blocks leaving and retries before becoming clean',t=>{
 const f=fixture(t);create(f);f.fail(true);f.input('#rev-suggestion','Keep this unsaved revised sentence.');
 assert.equal(f.w.revisionSafety.revisionRouteGuard(),false);assert.equal(f.w.revisionSafety.revisionHasWork(),true);assert.equal(f.$('#rev-suggestion').value,'Keep this unsaved revised sentence.');
 f.fail(false);Object.assign(f.storageCalls,{reads:0,writes:0,entryWrites:0});assert.equal(f.w.revisionSafety.revisionRouteGuard(),true);f.w.revisionSafety.disposeRevision();
 assert.deepEqual(f.storageCalls,{reads:1,writes:1,entryWrites:0});assert.equal(f.drafts()[0].paragraphs[0].suggestion,'Keep this unsaved revised sentence.');
});
test('a clean revision preparation page leaves without writing an empty preparation draft',t=>{
 const f=fixture(t);Object.assign(f.storageCalls,{reads:0,writes:0,entryWrites:0});assert.equal(f.w.revisionSafety.revisionRouteGuard(),true);f.w.revisionSafety.disposeRevision();assert.deepEqual(f.storageCalls,{reads:0,writes:0,entryWrites:0});
});
