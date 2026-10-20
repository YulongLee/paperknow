import {captureDraftScope} from '../dist/workspace/state.mjs';
import {workspaceJobLabel,workspaceJobStatusLabel,workspaceJobActive,workspaceJobHref} from '../dist/workspace/workspace-job-model.mjs';
import {accountOverviewItems} from '../dist/workspace/home-account-model.mjs';
import {thesisEditorPresentation,restoreThesisEditorText,thesisEditorWordCount} from '../dist/workspace/thesis-editor-presentation.mjs';
import {isOutlineReferenceChapter} from '../dist/workspace/outline-word-budget.mjs';
import {presentThesisDocument} from '../dist/workspace/thesis-document.mjs';
import {publicBackupCopy,publicDraftCopy,publicTaskCopy} from '../dist/workspace/public-draft.mjs';
import {withStableView,resetStableView,keepsWorkspacePosition,installStableDisclosures} from '../dist/workspace/view-stability.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {esc,icon,empty,formatDate} from '../dist/workspace/ui.mjs';
import {toolBanner} from '../dist/workspace/tool-banner.mjs';
import {mountAigcDetection,ensureAigcStyle} from '../dist/workspace/aigc-detection.mjs';
import {revisionStrategy} from '../dist/workspace/revision-strategy.mjs';
import {revisionBundleOffersMarkup,mountRevisionBundleOffers as mountBundleOffers} from '../dist/workspace/revision-bundle-offers.mjs';
const mountRevisionBundleOffers=options=>mountBundleOffers({...options,fetchOptions:async()=>({ok:true,json:async()=>({products:[],channels:[]})})});
import {openRevisionReport} from '../dist/workspace/revision-report.mjs';
import {normalizeConfirmedRevisionReport,reportSources} from '../dist/workspace/revision-report-model.mjs';
import {validateRevisionProtection} from '../dist/workspace/revision-protection.mjs';
import {workspaceLinks} from '../dist/workspace/interface.mjs';
import * as revisionModel from '../dist/workspace/revision-model.mjs';
import * as taskModel from '../dist/workspace/task-model.mjs';
import * as projectModel from '../dist/workspace/project-model.mjs';
import * as assetModel from '../dist/workspace/asset-model.mjs';
import * as overviewModel from '../dist/workspace/overview-model.mjs';
import {homeLayout,fitHomeRows,continuationAssets} from '../dist/workspace/home-layout.mjs';

const source=(await readFile(new URL('../dist/workspace/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const homeSource=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const onlineSource=(await readFile(new URL('../dist/workspace/online-workspace.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const revisionSource=(await readFile(new URL('../dist/workspace/revision.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const thesisSource=(await readFile(new URL('../dist/workspace/thesis-online.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const documentExportSource=(await readFile(new URL('../dist/workspace/document-export.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const keys={profile:'paperknow-local-profile',preferences:'paperknow-preferences',drafts:'paperknow-drafts',projects:'paperknow-projects',tasks:'paperknow-local-tasks'};
const response=(status,user)=>({status,ok:status>=200&&status<300,json:async()=>({user})});
const signedIn={id:'researcher-1',name:'服务账户',email:null,phone:'+8613800000000',phoneVerifiedAt:'2026-10-15T00:00:00Z',hasPassword:false};

async function fixture(fetcher,{hash='#account',allReports=async()=>[],setup}={}){
 const dom=new JSDOM('<div id="app"></div>',{url:'https://paperknow.cn/workspace.html'+hash,runScripts:'outside-only'});
 const paymentCalls=[];
 const timers=new Set();const setTimer=(callback,delay)=>{const timer=setTimeout(()=>{timers.delete(timer);callback();},delay);timers.add(timer);return timer;};
 const storage=dom.window.localStorage;
 storage.setItem(keys.profile,JSON.stringify({name:'本地昵称',degree:'硕士',major:'教育学'}));
 storage.setItem(keys.drafts,JSON.stringify([{id:'draft-one',title:'未上传的研究草稿'}]));
 const reads=[];const read=(key,fallback)=>{reads.push(key);return JSON.parse(storage.getItem(key)||'null')??fallback;};
 Object.assign(dom.window,{captureDraftScope,workspaceJobLabel,workspaceJobStatusLabel,workspaceJobActive,workspaceJobHref,accountOverviewItems,mountArtifactLibrary:()=>({refresh(){},dispose(){}}),thesisEditorPresentation,restoreThesisEditorText,thesisEditorWordCount,isOutlineReferenceChapter,presentThesisDocument,publicBackupCopy,publicDraftCopy,publicTaskCopy,withStableView,resetStableView,keepsWorkspacePosition,installStableDisclosures,fetch:fetcher,AbortController,structuredClone,setTimeout:setTimer,clearTimeout:timer=>{timers.delete(timer);clearTimeout(timer);},matchMedia:()=>({matches:false}),scrollTo:()=>{},requestAnimationFrame:()=>{},keys,esc,icon,empty,toolBanner,toolConfigs:{writing:['AI 写作','整理研究内容']},
  ...taskModel,...projectModel,...assetModel,...overviewModel,homeLayout,fitHomeRows,continuationAssets,readHomeService:async()=>({cap:{},user:null}),preferences:()=>({degree:'本科',...read(keys.preferences,{})}),profile:()=>({name:'研究者',...read(keys.profile,{})}),read,list:key=>read(key,[]),write:(key,value)=>storage.setItem(key,JSON.stringify(value)),projects:()=>read(keys.projects,[]),repository:{all:allReports},formatDate:()=>'',mountNavigation:()=>({close(){}}),
  disposeWritingFlows:()=>{},disposeDataAnalysis:()=>{},disposeQuestionnaire:()=>{},questionnaireRouteGuard:async()=>true,questionnaireSessionChanged:()=>{},disposeFormat:()=>{},disposeResearch:()=>{},disposePresentation:()=>{},disposeRevision:()=>{},disposeAccountDraft:()=>{},accountDraftEditing:()=>false,accountDraftHasWork:()=>false,accountDraftConfirmLeave:async()=>true,accountDraftSessionChanged:()=>{},accountDraftRouteGuard:()=>true,
  disposePayment:()=>{paymentCalls.push({type:'dispose'});},renderPaymentOrders:async()=>{paymentCalls.push({type:'orders'});},renderPaymentCheckout:async options=>{paymentCalls.push({type:'checkout',productId:options.productId,orderId:options.orderId});},clearEditor:()=>{},clearHelpWork:()=>{},clearSettingsWork:()=>{},clearMoreWork:()=>{},trackDialogForm:()=>()=>{},retainWritingCatalog:()=>{},isCurrentRouteChange:()=>false,
  editorIsActive:()=>false,editorRouteGuard:()=>true,helpHasWork:()=>false,helpRouteGuard:()=>true,settingsHasWork:()=>false,settingsRouteGuard:()=>true,moreHasWork:()=>false,moreRouteGuard:()=>true,formatHasWork:()=>false,formatRouteGuard:()=>true,researchHasWork:()=>false,researchRouteGuard:()=>true,presentationHasWork:()=>false,presentationRouteGuard:()=>true,revisionHasWork:()=>false,revisionRouteGuard:()=>true,detectionRouteGuard:()=>true,
 });
 vm.runInContext('(function(){'+documentExportSource+'\nObject.assign(globalThis,{documentExportButtons,bindDocumentExports});})()',dom.getInternalVMContext());
 vm.runInContext('(function(){'+thesisSource+'\nObject.assign(globalThis,{mountOnlineThesis,mountThesisLibrary,disposeOnlineThesis,thesisOnlineHasWork,thesisOnlineRouteGuard,thesisOnlineSessionChanged});})()',dom.getInternalVMContext());
 vm.runInContext('(function(){'+onlineSource+'\nObject.assign(globalThis,{mountOnlineWorkspace,disposeOnlineWorkspace,onlineWorkspaceRouteGuard,onlineWorkspaceHasWork,onlineWorkspaceSessionChanged,onlineWorkspaceConfirmLeave,onlineWorkspaceHref});})()',dom.getInternalVMContext());
 setup?.(dom.window);
 await vm.runInContext('(async()=>{'+source+'\nglobalThis.workspaceAuthTest={loadWorkspaceSession,workspaceServiceFetch,signOutWorkspace,renderAccount,authHref,render};})()',dom.getInternalVMContext());
 for(let i=0;i<8;i++)await Promise.resolve();
 return {dom,document:dom.window.document,storage,paymentCalls,reads,api:dom.window.workspaceAuthTest,close(){dom.window.disposeOnlineThesis();timers.forEach(clearTimeout);dom.window.close();}};
}

test('tool and account navigation avoids local asset summaries while lists still read newly saved drafts',async()=>{
 const f=await fixture(async()=>response(401));
 try{
  await f.api.loadWorkspaceSession();
  Object.assign(f.dom.window,{...assetModel,mountResearch:()=>{f.document.querySelector('.dashboard').innerHTML='<p>科研工具</p>';},mountTool:()=>true});
  for(const hash of ['#category/research','#tool/writing','#account']){
   f.reads.length=0;f.dom.window.history.replaceState(null,'','/workspace.html'+hash);f.api.render();
   assert.equal(f.reads.filter(key=>key===keys.drafts).length,0,hash+' should not parse unrelated local drafts');
  }
  f.storage.setItem(keys.drafts,JSON.stringify([{id:'new-draft',title:'新保存的本地研究',tool:'writing',updatedAt:'2026-10-19T04:00:00Z',stage:'draft'}]));
  f.reads.length=0;f.dom.window.history.replaceState(null,'','/workspace.html#assets?scope=local');f.api.render();
  assert.equal(f.reads.filter(key=>key===keys.drafts).length,1);assert.match(f.document.querySelector('#asset-table-body').textContent,/新保存的本地研究/);
  f.storage.setItem(keys.drafts,JSON.stringify([{id:'newer-draft',title:'搜索前刚保存的研究',tool:'writing',updatedAt:'2026-10-19T05:00:00Z',stage:'draft'}]));
  f.dom.window.history.replaceState(null,'','/workspace.html#search/研究');f.api.render();
  assert.match(f.document.querySelector('.dashboard').textContent,/搜索前刚保存的研究/);assert.doesNotMatch(f.document.querySelector('.dashboard').textContent,/新保存的本地研究/);
 }finally{f.close();}
});

function deferredReports(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const lateReport={id:'late-report',title:'稍后读取的比对报告',createdAt:'2026-10-19T04:00:00Z',totalChars:120,sourceCount:1};
const settleReports=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};

async function assetPageFixture({draftCount=45,reportRows=[]}={}){
 const drafts=Array.from({length:draftCount},(_,index)=>({id:'page-'+String(index+1).padStart(2,'0'),title:'分页成果 '+String(index+1).padStart(2,'0'),tool:index===44?'ppt':'writing',stage:'draft',text:'第 '+(index+1)+' 份完整正文',updatedAt:new Date(Date.UTC(2026,9,19,4,draftCount-index)).toISOString()})),downloads=[];
 let reports=structuredClone(reportRows);
 const f=await fixture(async()=>response(401),{hash:'#assets?scope=local',allReports:async()=>structuredClone(reports),setup:w=>{
  w.localStorage.setItem(keys.drafts,JSON.stringify(drafts));w.localStorage.setItem(keys.projects,JSON.stringify([{id:'page-project',name:'分页归属项目'}]));w.formatDate=formatDate;
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
  w.download=async(...args)=>{downloads.push(args);return {message:'已下载'};};w.repository.save=async(store,item)=>{assert.equal(store,'reports');reports=reports.map(row=>row.id===item.id?structuredClone(item):row);};
 }});
 return {...f,drafts,downloads,getReports:()=>reports,q:selector=>f.document.querySelector(selector),click:selector=>{const button=f.document.querySelector(selector);assert.ok(button,selector);button.click();},change:(selector,value,type='change')=>{const field=f.document.querySelector(selector);field.value=value;field.dispatchEvent(new f.dom.window.Event(type,{bubbles:true}));}};
}

test('local assets paginate twenty rows while totals, full-library filters, bounds and keyboard focus remain accurate',async()=>{
 const f=await assetPageFixture();
 try{
  assert.equal(f.q('#asset-count').textContent,'共 45 份成果');assert.equal(f.document.querySelectorAll('[data-asset-select]').length,20);assert.equal(f.q('[data-asset-select-all]').getAttribute('aria-label'),'全选本页 20 份成果');assert.equal(f.q('[data-asset-page="previous"]').disabled,true);assert.match(f.q('#asset-table-body .asset-time').textContent,/10\/19 12:45/);
  const all=f.q('[data-asset-select-all]');all.checked=true;all.dispatchEvent(new f.dom.window.Event('change'));assert.equal(f.document.querySelectorAll('[data-asset-select]:checked').length,20);
  f.q('[data-asset-page="next"]').focus();f.click('[data-asset-page="next"]');assert.match(f.q('#asset-pagination').textContent,/第 2 \/ 3 页/);assert.equal(f.q('[data-asset-select]').dataset.assetSelect,'draft:page-21');assert.equal(f.document.querySelectorAll('[data-asset-select]:checked').length,0);assert.equal(f.document.activeElement,f.q('[data-asset-page="next"]'));
  f.click('[data-asset-page="next"]');assert.equal(f.document.querySelectorAll('[data-asset-select]').length,5);assert.equal(f.q('[data-asset-page="next"]').disabled,true);assert.equal(f.document.activeElement,f.q('[data-asset-page="previous"]'));f.click('[data-asset-page="next"]');assert.match(f.q('#asset-pagination').textContent,/第 3 \/ 3 页/);
  f.change('#asset-query','分页成果 45','input');assert.equal(f.q('#asset-count').textContent,'共 1 份成果');assert.equal(f.q('[data-asset-select]').dataset.assetSelect,'draft:page-45');assert.equal(f.q('#asset-pagination').hidden,true);
  f.change('#asset-query','','input');f.click('[data-asset-page="next"]');f.change('#asset-type-filter','presentation');assert.equal(f.q('#asset-count').textContent,'共 1 份成果');assert.equal(f.q('[data-asset-select]').dataset.assetSelect,'draft:page-45');
  f.change('#asset-type-filter','all');f.click('[data-asset-page="next"]');f.change('#asset-sort','name');assert.match(f.q('#asset-pagination').textContent,/第 1 \/ 3 页/);assert.equal(f.q('#asset-count').textContent,'共 45 份成果');assert.deepEqual(JSON.parse(f.storage.getItem(keys.drafts)),f.drafts);
 }finally{f.close();}
});

test('page-two archive and individual export act on the clicked record and preserve all other saved content',async()=>{
 const f=await assetPageFixture();
 try{
  f.click('[data-asset-page="next"]');f.click('[data-asset-archive="draft:page-25"]');assert.match(f.q('#asset-pagination').textContent,/第 2 \/ 3 页/);assert.equal(f.q('#asset-count').textContent,'共 45 份成果');
  const changed=JSON.parse(f.storage.getItem(keys.drafts));assert.equal(changed.find(row=>row.id==='page-25').archived,true);assert.deepEqual(changed.filter(row=>row.id!=='page-25'),f.drafts.filter(row=>row.id!=='page-25'));
  f.click('[data-asset-export="draft:page-25"]');f.click('[data-export-draft="page-25"]');await settleReports();assert.equal(f.downloads.length,1);assert.match(f.downloads[0][0],/分页成果 25/);assert.equal(f.downloads[0][1],'第 25 份完整正文');
  f.click('[data-asset-filter="archived"]');assert.equal(f.q('#asset-count').textContent,'共 1 份成果');assert.equal(f.q('[data-asset-select]').dataset.assetSelect,'draft:page-25');assert.equal(f.q('#asset-pagination').hidden,true);
  f.click('[data-asset-archive="draft:page-25"]');assert.equal(f.q('#asset-count').textContent,'共 0 份成果');assert.equal(f.q('[data-asset-select-all]').disabled,true);assert.equal(f.document.querySelectorAll('[data-asset-select]').length,0);assert.equal(JSON.parse(f.storage.getItem(keys.drafts)).length,45);
 }finally{f.close();}
});

test('page-two mixed draft/report bulk export and move touch only selected visible rows and clear selection on paging',async()=>{
 const reportRows=Array.from({length:5},(_,index)=>({...lateReport,id:'page-report-'+(index+1),title:'分页报告 '+(index+1),createdAt:'2026-10-18T04:00:00Z'})),f=await assetPageFixture({draftCount:26,reportRows});
 try{
  f.click('[data-asset-page="next"]');assert.equal(f.q('#asset-count').textContent,'共 31 份成果');assert.equal(f.document.querySelectorAll('[data-asset-select]').length,11);
  for(const token of ['draft:page-21','report:page-report-1'])f.q('[data-asset-select="'+token+'"]').checked=true;
  f.click('[data-asset-bulk]');assert.match(f.q('#workspace-dialog-body').textContent,/已选择 2 份成果/);f.click('#asset-export-selected');await settleReports();const backup=JSON.parse(f.downloads[0][1]);assert.deepEqual(backup.drafts.map(row=>row.id),['page-21']);assert.deepEqual(backup.reports.map(row=>row.id),['page-report-1']);
  f.change('#asset-batch-project','page-project');const form=f.q('#asset-batch-move'),button=form.querySelector('button');form.dispatchEvent(new f.dom.window.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:button}));await settleReports();
  const saved=JSON.parse(f.storage.getItem(keys.drafts));assert.equal(saved.find(row=>row.id==='page-21').projectId,'page-project');assert.deepEqual(saved.filter(row=>row.id!=='page-21'),f.drafts.filter(row=>row.id!=='page-21'));assert.equal(f.getReports().find(row=>row.id==='page-report-1').projectId,'page-project');assert.deepEqual(f.getReports().filter(row=>row.id!=='page-report-1'),reportRows.filter(row=>row.id!=='page-report-1'));assert.match(f.q('#asset-pagination').textContent,/第 2 \/ 2 页/);
  f.q('[data-asset-select]').checked=true;f.click('[data-asset-page="previous"]');assert.equal(f.document.querySelectorAll('[data-asset-select]:checked').length,0);f.click('[data-asset-bulk]');assert.equal(f.q('#workspace-dialog').open,false);assert.match(f.q('#hub-toast').textContent,/请先选择/);
  f.change('#asset-type-filter','detection');assert.equal(f.q('#asset-count').textContent,'共 5 份成果');assert.equal(f.document.querySelectorAll('[data-asset-select]').length,5);assert.equal(f.q('#asset-pagination').hidden,true);
 }finally{f.close();}
});

test('a category renders while report history is pending and its active editor survives report completion',async()=>{
 const pending=deferredReports();let mounts=0;
 const f=await fixture(async()=>response(401),{hash:'#category/research',allReports:()=>pending.promise,setup:w=>{w.mountResearch=()=>{mounts++;w.document.querySelector('.dashboard').innerHTML='<input id="early-research" value="">';};}});
 try{
  const input=f.document.querySelector('#early-research');assert.ok(input,'the initial category must render before the report read resolves');input.value='正在编辑的科研需求';input.focus();input.setSelectionRange(2,5);
  pending.resolve([lateReport]);await settleReports();
  assert.equal(mounts,1);assert.equal(f.document.querySelector('#early-research'),input);assert.equal(input.value,'正在编辑的科研需求');assert.equal(input.selectionStart,2);assert.equal(f.document.activeElement,input);
 }finally{f.close();}
});

test('home renders immediately and late reports update its local panels without restarting service loading or moving the viewport',async()=>{
 const pending=deferredReports();let serviceReads=0;
 const f=await fixture(async()=>response(401),{hash:'#home?scope=local',allReports:()=>pending.promise,setup:w=>{w.readHomeService=async()=>{serviceReads++;return {cap:{},user:null};};}});
 try{
  assert.ok(f.document.querySelector('.home-refresh'));assert.ok(f.document.querySelector('[data-local-reports-status]'));assert.match(f.document.querySelector('#home-result-list').textContent,/未上传的研究草稿/);
  await settleReports();const readsBefore=serviceReads;let y=320;const scrolls=[];Object.defineProperty(f.dom.window,'scrollY',{configurable:true,get:()=>y});f.dom.window.scrollTo=options=>{scrolls.push(options);y=options.top;};
  const home=f.document.querySelector('.home-refresh');pending.resolve([lateReport]);await settleReports();
  assert.equal(f.document.querySelector('.home-refresh'),home);assert.match(f.document.querySelector('#home-result-list').textContent,/稍后读取的比对报告/);assert.equal(f.document.querySelector('[data-local-reports-status]'),null);assert.equal(serviceReads,readsBefore);assert.equal(y,320);assert.equal(scrolls.length,0);
 }finally{f.close();}
});

test('local assets and search populate delayed report rows and accurate counts',async()=>{
 for(const hash of ['#assets?scope=local','#search/比对报告']){
  const pending=deferredReports(),f=await fixture(async()=>response(401),{hash,allReports:()=>pending.promise});
  try{
   assert.ok(f.document.querySelector('[data-local-reports-status]'));assert.doesNotMatch(f.document.querySelector('.dashboard').textContent,/稍后读取的比对报告/);
   pending.resolve([lateReport]);await settleReports();
   assert.match(f.document.querySelector('.dashboard').textContent,/稍后读取的比对报告/);assert.equal(f.document.querySelector('[data-local-reports-status]'),null);
   if(hash.startsWith('#assets'))assert.equal(f.document.querySelector('#asset-count').textContent,'共 2 份成果');
  }finally{f.close();}
 }
});

test('late local reports update account scope counts without remounting the account workspace',async()=>{
 const pending=deferredReports(),f=await fixture(async path=>path==='/api/auth/me'?response(200,signedIn):{ok:true,status:200,json:async()=>({items:[]})},{hash:'#assets?scope=account',allReports:()=>pending.promise});
 try{
  await settleReports();const workspace=f.document.querySelector('#online-workspace'),content=workspace.firstElementChild;assert.ok(content);assert.match(f.document.querySelector('.workspace-scope-tabs').textContent,/本地内容 · 1/);
  pending.resolve([lateReport]);await settleReports();
  assert.equal(f.document.querySelector('#online-workspace'),workspace);assert.equal(workspace.firstElementChild,content);assert.match(f.document.querySelector('.workspace-scope-tabs').textContent,/本地内容 · 2/);assert.equal(f.document.querySelector('.workspace-scope-tabs a.active').getAttribute('href'),'#assets?scope=account');assert.equal(f.document.querySelector('[data-local-reports-status]'),null);
 }finally{f.close();}
});

test('a late report read cannot replace an editor opened after the initial list or act on a queued destination URL',async()=>{
 for(const changeRenderedRoute of [true,false]){
  const pending=deferredReports();let active=false;
  const f=await fixture(async()=>response(401),{hash:'#assets?scope=local',allReports:()=>pending.promise,setup:w=>{w.editorIsActive=()=>active;w.clearEditor=()=>{active=false;};w.mountTool=()=>{active=true;w.document.querySelector('.dashboard').innerHTML='<input id="late-report-editor" value="">';return true;};}});
  try{
   f.dom.window.history.replaceState(null,'','/workspace.html#tool/writing');f.api.render();const editor=f.document.querySelector('#late-report-editor');editor.value='待保存的正文';editor.focus();
   if(!changeRenderedRoute)f.dom.window.history.replaceState(null,'','/workspace.html#search/比对报告');
   pending.resolve([lateReport]);await settleReports();
   assert.equal(f.document.querySelector('#late-report-editor'),editor);assert.equal(editor.value,'待保存的正文');assert.equal(f.document.activeElement,editor);assert.equal(active,true);
   f.dom.window.history.replaceState(null,'','/workspace.html#assets?scope=local');f.api.render();assert.match(f.document.querySelector('#asset-table-body').textContent,/稍后读取的比对报告/);
  }finally{f.close();}
 }
});

test('report completion preserves an open project dialog and updates its list after the dialog closes',async()=>{
 const pending=deferredReports(),f=await fixture(async()=>response(401),{hash:'#assets?scope=local',allReports:()=>pending.promise});
 try{
  const dialog=f.document.querySelector('#workspace-dialog');f.document.querySelector('#workspace-dialog-body').innerHTML='<input id="pending-project-name" value="研究项目草稿">';dialog.setAttribute('open','');const input=f.document.querySelector('#pending-project-name');input.focus();
  pending.resolve([lateReport]);await settleReports();
  assert.equal(dialog.open,true);assert.equal(f.document.querySelector('#pending-project-name'),input);assert.equal(input.value,'研究项目草稿');assert.doesNotMatch(f.document.querySelector('#asset-table-body').textContent,/稍后读取的比对报告/);
  dialog.removeAttribute('open');dialog.dispatchEvent(new f.dom.window.Event('close'));await settleReports();assert.match(f.document.querySelector('#asset-table-body').textContent,/稍后读取的比对报告/);
 }finally{f.close();}
});

test('an initial report failure keeps local drafts available and displays the existing recoverable report error',async()=>{
 const pending=deferredReports(),f=await fixture(async()=>response(401),{hash:'#assets?scope=local',allReports:()=>pending.promise});
 try{
  assert.match(f.document.querySelector('#asset-table-body').textContent,/未上传的研究草稿/);pending.reject(new Error('IndexedDB unavailable'));await settleReports();
  assert.match(f.document.querySelector('.hub-error').textContent,/查重报告读取失败/);assert.match(f.document.querySelector('#asset-table-body').textContent,/未上传的研究草稿/);assert.equal(f.document.querySelector('#asset-count').textContent,'共 1 份成果');assert.equal(f.document.querySelector('[data-local-reports-status]'),null);
 }finally{f.close();}
});

test('a late initial report snapshot cannot overwrite a newer explicit report reload',async()=>{
 const pending=deferredReports();let reads=0,restored;
 const f=await fixture(async()=>response(401),{allReports:()=>++reads===1?pending.promise:Promise.resolve([lateReport]),setup:w=>{w.mountSettings=context=>{restored=context.restored;w.document.querySelector('.dashboard').innerHTML='<p>备份已恢复</p>';};}});
 try{
  f.dom.window.history.replaceState(null,'','/workspace.html#settings');f.api.render();await restored();pending.resolve([]);await settleReports();
  f.dom.window.history.replaceState(null,'','/workspace.html#assets?scope=local');f.api.render();assert.match(f.document.querySelector('#asset-table-body').textContent,/稍后读取的比对报告/);
 }finally{f.close();}
});

test('main workspace thesis routes autosave chapter text before navigation and restore it on return',async()=>{
 const seen=[],item={id:'cloud-thesis',version:2,title:'跨设备账户论文',profile:{level:'硕士',discipline:'社会学',method:'案例研究'},snapshot:{title:'跨设备账户论文',profile:{level:'硕士',discipline:'社会学',method:'案例研究'},materials:[],references:[],outline:[]},status:'completed',chapters:[{id:'chapter-1',title:'第一章',text:'已保存账户正文',version:1,status:'saved'}],job:null};
 const json=data=>({ok:true,status:200,json:async()=>data});
 const f=await fixture(async path=>{seen.push(path);if(path==='/api/auth/me')return response(200,signedIn);if(path==='/api/theses')return json({items:[item]});if(path==='/api/theses/cloud-thesis')return json({item});if(path==='/api/capabilities')return json({thesis:{ready:false,reason:'未配置模型'}});return json({items:[]});});
 const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
 try{
  assert.equal(f.document.querySelectorAll('#menu-toggle').length,1);assert.equal(f.document.querySelector('#navigation-collapse'),null);assert.equal(f.document.querySelector('.breadcrumb strong').hidden,true);
  await f.api.loadWorkspaceSession();f.dom.window.history.replaceState(null,'','/workspace.html#theses');f.api.render();await settle();
  assert.equal(f.document.querySelector('.thesis-library a').getAttribute('href'),'#thesis/cloud-thesis');assert.equal(f.document.querySelector('.breadcrumb strong').textContent,'账户论文');
  f.dom.window.history.replaceState(null,'','/workspace.html#thesis/cloud-thesis');f.api.render();await settle();
  assert.equal(f.document.querySelector('[data-thesis-editor]').value,'已保存账户正文');assert.match(f.document.querySelector('.thesis-run-controls').textContent,/未配置模型/);
  const editor=f.document.querySelector('[data-thesis-editor]');editor.value='本次未保存的修改';editor.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));assert.equal(f.dom.window.thesisOnlineHasWork(),true);
  f.dom.window.isCurrentRouteChange=()=>true;f.dom.window.confirm=()=>false;const oldURL=f.dom.window.location.href,newURL='https://paperknow.cn/workspace.html#account';f.dom.window.history.replaceState(null,'',newURL);f.dom.window.dispatchEvent(new f.dom.window.HashChangeEvent('hashchange',{oldURL,newURL}));await settle();
  assert.equal(f.dom.window.location.hash,'#account');assert.ok(f.document.querySelector('#profile-form'));assert.equal(f.dom.window.thesisOnlineHasWork(),false);
  f.dom.window.history.replaceState(null,'','/workspace.html#thesis/cloud-thesis');f.api.render();await settle();assert.equal(f.document.querySelector('[data-thesis-editor]').value,'本次未保存的修改');assert.match(f.document.querySelector('[data-thesis-notice]').textContent,/已恢复此账户/);assert.equal(f.dom.window.thesisOnlineHasWork(),true);
  assert.ok(seen.includes('/api/theses'));assert.ok(seen.includes('/api/theses/cloud-thesis'));assert.equal(seen.some(path=>path.endsWith('/generate')),false);
 }finally{f.close();}
});

test('workspace payment and order routes mount the account payment modules with parsed server identifiers',async()=>{
 const f=await fixture(async()=>response(401));
 try{
  f.paymentCalls.length=0;
  const localBefore=f.storage.getItem(keys.drafts);
  f.dom.window.history.replaceState(null,'','/workspace.html#membership/pay?product=published-member');f.api.render();
  assert.deepEqual(f.paymentCalls,[{type:'dispose'},{type:'checkout',productId:'published-member',orderId:null}]);
  assert.equal(f.document.querySelector('.breadcrumb strong').textContent,'安全支付');
  f.dom.window.history.replaceState(null,'','/workspace.html#membership/pay?order=existing%2Faccount-order');f.api.render();
  assert.deepEqual(f.paymentCalls.slice(-2),[{type:'dispose'},{type:'checkout',productId:null,orderId:'existing/account-order'}]);
  f.dom.window.history.replaceState(null,'','/workspace.html#orders');f.api.render();
  assert.deepEqual(f.paymentCalls.slice(-2),[{type:'dispose'},{type:'orders'}]);
  assert.equal(f.document.querySelector('.breadcrumb strong').textContent,'订单记录');
  assert.equal(f.storage.getItem(keys.drafts),localBefore);
 }finally{f.close();}
});

test('leaving a payment or order route disposes the previous payment lifecycle before rendering another page',async()=>{
 const f=await fixture(async()=>response(401));
 try{
  f.paymentCalls.length=0;
  f.dom.window.history.replaceState(null,'','/workspace.html#membership/pay?product=basic');f.api.render();
  assert.equal(f.paymentCalls.at(-1).type,'checkout');
  f.dom.window.history.replaceState(null,'','/workspace.html#account');f.api.render();
  assert.deepEqual(f.paymentCalls.slice(-2),[{type:'checkout',productId:'basic',orderId:null},{type:'dispose'}]);
  assert.ok(f.document.querySelector('#profile-form'));
  f.dom.window.history.replaceState(null,'','/workspace.html#orders');f.api.render();
  assert.equal(f.paymentCalls.at(-1).type,'orders');
  f.dom.window.history.replaceState(null,'','/workspace.html#account');f.api.render();
  assert.deepEqual(f.paymentCalls.slice(-2),[{type:'orders'},{type:'dispose'}]);
  assert.equal(f.document.querySelector('.breadcrumb strong').textContent,'账户中心');
 }finally{f.close();}
});

test('sidebar exposes three purchase modes without inferring membership or creating a purchase',async()=>{
 const seen=[];const f=await fixture(async path=>{seen.push(path);return response(401);});
 try{
  await f.api.loadWorkspaceSession();
  const card=f.document.querySelector('.hub-commerce-card');
  assert.ok(card);
  assert.deepEqual([...card.querySelectorAll('a')].map(a=>a.hash),['#membership/plans','#membership/recharge','#membership/bundles']);
  assert.match(card.textContent,/查看权益与最新方案/);
  assert.doesNotMatch(card.textContent,/已开通|余额|剩余.*积分/);
  assert.ok(f.document.querySelector('.hub-sidebar-profile'));
  assert.ok(seen.every(path=>path==='/api/auth/me'));
  assert.equal(JSON.parse(f.storage.getItem(keys.drafts))[0].title,'未上传的研究草稿');
 }finally{f.close();}
});

test('homepage research navigation matches the rendered workspace and report sidebar without missing capabilities',async()=>{
 const f=await fixture(async()=>response(401));
 const home=new JSDOM(homeSource,{url:'https://paperknow.cn/'});
 try{
  const expected=[['writing','AI 写作'],['literature','AI 研读'],['reduce','降重复率'],['aigc','降AI率'],['detection','免费查重'],['ppt','PPT 创作'],['format','格式排版'],['research','科研工具']]
   .map(([key,label])=>({key,label,path:`/workspace.html#category/${key}`}));
  const homepage=[...home.window.document.querySelectorAll('#main-nav [data-research-category]')]
   .map(link=>({key:link.dataset.researchCategory,label:link.textContent.trim(),path:link.pathname+link.hash}));
  const sidebar=[...f.document.querySelectorAll('.sidebar nav .nav-link[href^="#category/"]')]
   .map(link=>({key:link.hash.slice('#category/'.length),label:link.textContent.trim(),path:link.pathname+link.hash}));
  const reportSidebar=workspaceLinks.find(([group])=>group==='论文与科研')[1]
   .map(([path,label])=>({key:path.slice('category/'.length),label,path:`/workspace.html#${path}`}));
  assert.deepEqual(homepage,expected,'all eight capabilities must remain directly linked in the homepage navigation');
  assert.deepEqual(sidebar,expected,'homepage labels, order and links must match the actual workspace sidebar');
  assert.deepEqual(reportSidebar,expected,'opening a detection report must not restore the old sidebar');
 }finally{home.window.close();f.close();}
});

test('direct AI-rate navigation mounts the AI reduction service and updates the active sidebar link',async()=>{
 const f=await fixture(async()=>response(401));
 const calls=[];
 try{
  f.dom.window.mountDetection=options=>calls.push({module:'detection',tab:options.tab,projectId:options.projectId});
  f.dom.window.mountRevision=options=>calls.push({module:'revision',mode:options.mode});
  const navigate=hash=>{f.dom.window.history.replaceState(null,'','/workspace.html'+hash);f.api.render();};
  navigate('#category/detection');
  assert.equal(f.document.querySelector('.sidebar .nav-link[aria-current="page"]')?.hash,'#category/detection');
  navigate('#category/aigc?project=project-123');
  assert.deepEqual(calls,[{module:'detection',tab:'check',projectId:null},{module:'revision',mode:'reduce'}]);
  assert.equal(f.document.querySelector('.breadcrumb strong').textContent,'降AI率');
  const active=[...f.document.querySelectorAll('.sidebar .nav-link.active')];
  assert.equal(active.length,1);
  assert.equal(active[0].hash,'#category/aigc');
  assert.equal(active[0].getAttribute('aria-current'),'page');
  assert.equal(f.document.querySelector('.sidebar .nav-link[href="#category/detection"]').hasAttribute('aria-current'),false);
 }finally{f.close();}
});

test('real AI reduction entry keeps its own heading, theme and selection across shared revision routes',()=>{
 const dom=new JSDOM('<div class="breadcrumb"><strong></strong></div><main class="dashboard"></main>',{url:'https://paperknow.cn/workspace.html#category/aigc',runScripts:'outside-only'});
 Object.assign(dom.window,{captureDraftScope,workspaceJobLabel,workspaceJobStatusLabel,workspaceJobActive,workspaceJobHref,accountOverviewItems,mountArtifactLibrary:()=>({refresh(){},dispose(){}}),mountAigcDetection,ensureAigcStyle,revisionStrategy,revisionBundleOffersMarkup,mountRevisionBundleOffers,openRevisionReport,normalizeConfirmedRevisionReport,reportSources,validateRevisionProtection,thesisEditorPresentation,restoreThesisEditorText,thesisEditorWordCount,isOutlineReferenceChapter,presentThesisDocument,publicBackupCopy,publicDraftCopy,publicTaskCopy,withStableView,resetStableView,keepsWorkspacePosition,installStableDisclosures,...revisionModel,keys,esc,icon,toolBanner,list:()=>[],projects:()=>[],formatDate:()=>''});
 try{
  vm.runInContext('(function(){'+revisionSource+'\nglobalThis.mountActualRevision=mountRevision;})()',dom.getInternalVMContext());
  const query=selector=>dom.window.document.querySelector(selector);
  const mount=hash=>{dom.window.history.replaceState(null,'',hash);dom.window.mountActualRevision({mode:'reduce',modal:()=>{},notify:()=>{}});};
  const assertAIPage=()=>{
   assert.ok(query('#revision-service.aigc-commerce'));
   assert.equal(query('#revision-service').dataset.revisionKind,'aigc');
   assert.equal(query('.dashboard').dataset.revisionTheme,'aigc');
   assert.equal(query('.tool-banner h1').textContent,'降 AI 率');
   assert.equal(query('.revision-entry-summary [data-revision-selection-title]').textContent,'自然学术表达精修');
   assert.equal(query('.revision-plan-card[aria-pressed="true"]').dataset.revisionPlan,'strong');
   assert.match(query('[data-revision-plan-status]').textContent,/可生成逐段候选修改.*不预测或承诺/);
   assert.ok(query('#revision-entry-form'));assert.equal(query('#revision-space'),null);
  };
  mount('#category/aigc');assertAIPage();
  mount('#category/reduce');
  assert.equal(query('.aigc-commerce'),null);
  assert.equal(query('#revision-service').dataset.revisionKind,'reduce');
  assert.equal(query('.dashboard').dataset.revisionTheme,'reduce');
  assert.equal(query('.tool-banner h1').textContent,'降重复率');
  assert.equal(query('.revision-entry-summary [data-revision-selection-title]').textContent,'重复表达精修');
  query('[data-revision-plan="dual"]').click();
  assert.equal(query('.tool-banner h1').textContent,'降重复率');
  assert.equal(query('.revision-plan-card[aria-pressed="true"]').dataset.revisionPlan,'dual');
  assert.equal(query('.revision-entry-summary [data-revision-selection-title]').textContent,'表达与引用综合优化');
  assert.match(query('[data-revision-plan-status]').textContent,/生成逐段候选/);
  assert.match(query('[data-revision-plan-status]').textContent,/审核后采纳/);
  assert.ok(query('#revision-entry-form'));assert.equal(query('#revision-space'),null);
  mount('#category/aigc');assertAIPage();
  assert.equal(query('[data-revision-plan="dual"]').getAttribute('aria-pressed'),'false');
 }finally{dom.window.close();}
});

test('workspace rerenders and same-feature scope changes stay in place while a new feature starts at the top',async()=>{
 const f=await fixture(async path=>path==='/api/auth/me'?response(401):({ok:true,status:200,json:async()=>({items:[]})}));
 const w=f.dom.window,calls=[];let y=370;
 Object.assign(w,taskModel,projectModel,assetModel);
 Object.defineProperty(w,'scrollY',{configurable:true,get:()=>y});
 w.scrollTo=options=>{calls.push(options);y=options.top;};
 const go=hash=>{w.history.replaceState(null,'',hash);f.api.render();};
 try{
  go('#projects?scope=local');assert.equal(y,0);
  y=240;calls.length=0;f.api.render();assert.equal(y,240);assert.equal(calls.length,0);
  go('#projects?scope=account');for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(y,240);assert.equal(calls.length,0);
  assert.ok(f.document.querySelector('.account-login-required'));
  go('#tasks?scope=local');assert.equal(y,0);assert.equal(calls.length,1);
  y=180;calls.length=0;go('#tasks?scope=local&view=agent');
  assert.equal(y,180);assert.equal(calls.length,0);
 }finally{f.close();}
});

test('cross-tab storage updates preserve an autosaved local editor and its current creation route',async()=>{
 const f=await fixture(async()=>response(401));
 const w=f.dom.window;let active=false,mounts=0;
 await f.api.loadWorkspaceSession();
 Object.assign(w,{workspaceJobLabel,workspaceJobActive,workspaceJobStatusLabel,
  clearEditor:()=>{active=false;},editorIsActive:()=>active,editorHasWork:()=>false,
  mountTool:()=>{mounts++;active=true;f.document.querySelector('.dashboard').innerHTML='<input id="storage-test-title" value="">';return true;}
 });
 try{
  w.history.replaceState(null,'','#tool/writing');f.api.render();
  const input=f.document.querySelector('#storage-test-title');
  input.value='已经自动保存的论文主题';input.focus();input.setSelectionRange(5,5);
  f.storage.setItem(keys.drafts,JSON.stringify([{id:'autosaved-draft',tool:'writing',title:input.value}]));
  const saved=f.storage.getItem(keys.drafts);
  w.dispatchEvent(new w.StorageEvent('storage',{key:keys.tasks,newValue:'[]',url:'https://paperknow.cn/workspace.html#tasks',storageArea:f.storage}));
  assert.equal(mounts,1,'a saved editor still has a live editing context');
  assert.equal(f.document.querySelector('#storage-test-title'),input);
  assert.equal(input.value,'已经自动保存的论文主题');
  assert.equal(f.document.activeElement,input);assert.equal(input.selectionStart,5);
  assert.equal(w.location.hash,'#tool/writing');assert.equal(f.storage.getItem(keys.drafts),saved);
 }finally{f.close();}
});

test('phone account identity stays separate from browser preferences and password actions return to the current route',async()=>{
 const seen=[];const f=await fixture(async(path,options)=>{seen.push(path);assert.equal(options.credentials,'same-origin');return response(200,signedIn);});
 try{
  await f.api.loadWorkspaceSession();
  assert.equal(f.document.querySelector('.hub-profile-name').textContent,'服务账户');
  assert.match(f.document.querySelector('#workspace-account-session').textContent,/\+8613800000000/);
  assert.equal(f.document.querySelector('#profile-name').value,'本地昵称');
  assert.match(f.document.querySelector('#account-security').textContent,/已验证/);
  const reset=f.document.querySelector('#account-security a');
  assert.equal(reset.textContent.trim(),'设置密码');
  assert.equal(new URL(reset.href).searchParams.get('next'),'/workspace.html#account');
  assert.equal(new URL(reset.href).searchParams.get('mode'),'reset');
  f.document.querySelector('#profile-name').value='新的本地昵称';
  f.document.querySelector('#profile-form').dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(JSON.parse(f.storage.getItem(keys.profile)).name,'新的本地昵称');
  assert.equal(f.document.querySelector('.hub-profile-name').textContent,'服务账户');
  assert.deepEqual(seen,['/api/auth/me']);
 }finally{f.close();}
});

test('workspace exposes administration only for the actual administrator role and removes separate workspace links',async()=>{
 const f=await fixture(async()=>response(200,{...signedIn,role:'admin'}));
 try{await f.api.loadWorkspaceSession();assert.equal(f.document.querySelector('#account-menu a[href="/admin.html"]')?.textContent,'管理后台');assert.equal(f.document.querySelector('a[href*="service.html"]'),null);}finally{f.close();}
 const ordinary=await fixture(async()=>response(200,{...signedIn,role:'user'}));
 try{await ordinary.api.loadWorkspaceSession();assert.equal(ordinary.document.querySelector('a[href="/admin.html"]'),null);}finally{ordinary.close();}
});

test('guest links preserve the current workspace location and local data is available before auth resolves',async()=>{
 let resolve;let calls=0;
 const f=await fixture(()=>{calls++;return new Promise(done=>resolve=done);});
 try{
  assert.equal(f.document.querySelector('#profile-name').value,'本地昵称');
  f.document.querySelector('#profile-name').value='尚未保存的修改';
  const shared=f.api.workspaceServiceFetch('/api/auth/me',{});
  resolve(response(401));await shared;
  assert.equal(calls,1);
  assert.equal(f.document.querySelector('#profile-name').value,'尚未保存的修改');
  assert.equal(f.document.querySelector('.hub-profile-name').textContent,'未登录');
  f.dom.window.history.replaceState(null,'','/workspace.html?preview=1#category/literature?view=reading');
  f.document.querySelector('[data-account-menu]').click();
  const links=[...f.document.querySelectorAll('#account-menu a')].filter(link=>link.pathname==='/auth.html');
  assert.equal(links.length,2);
  assert.deepEqual(links.map(link=>new URL(link.href).searchParams.get('mode')),['login','register']);
  links.forEach(link=>assert.equal(new URL(link.href).searchParams.get('next'),'/workspace.html?preview=1#category/literature?view=reading'));
  assert.match(f.storage.getItem(keys.drafts),/未上传的研究草稿/);
 }finally{f.close();}
});

test('connection failures stay recoverable without claiming the account is connected or clearing local content',async()=>{
 let available=false;
 const f=await fixture(async()=>{if(!available)throw new Error('offline');return response(200,signedIn);});
 try{
  await f.api.loadWorkspaceSession();
  assert.match(f.document.querySelector('#workspace-account-session').textContent,/暂时无法连接账户/);
  assert.ok(f.document.querySelector('[data-session-retry]'));
  assert.equal(f.document.querySelector('#profile-major').value,'教育学');
  available=true;await f.api.loadWorkspaceSession(true);
  assert.equal(f.document.querySelector('.hub-profile-name').textContent,'服务账户');
  assert.match(f.storage.getItem(keys.drafts),/未上传的研究草稿/);
 }finally{f.close();}
});

test('logout preserves the local workspace and late session responses cannot restore a signed-out account',async()=>{
 let resolve;let requests=0;let logoutFails=true;
 const f=await fixture(async(path,options)=>{
  if(path==='/api/auth/logout'){assert.equal(options.method,'POST');assert.equal(options.body,'{}');return response(logoutFails?503:200);}
  if(++requests===1)return response(200,signedIn);
  return new Promise(done=>resolve=done);
 });
 try{
  await f.api.loadWorkspaceSession();const localBefore=f.storage.getItem(keys.drafts);
  await f.api.signOutWorkspace();
  assert.equal(f.document.querySelector('.hub-profile-name').textContent,'服务账户');
  assert.match(f.document.querySelector('#hub-toast').textContent,/暂时无法退出/);
  const pending=f.api.loadWorkspaceSession(true);logoutFails=false;
  await f.api.signOutWorkspace();resolve(response(200,signedIn));await pending;
  assert.equal(f.document.querySelector('.hub-profile-name').textContent,'未登录');
  assert.equal(f.storage.getItem(keys.drafts),localBefore);
  assert.equal(JSON.parse(f.storage.getItem(keys.profile)).name,'本地昵称');
  assert.equal(f.document.querySelector('[data-session-logout]'),null);
 }finally{f.close();}
});


test('workspace search finds account projects, drafts, task results and originals with correct direct routes',async()=>{
 const f=await fixture(async path=>{if(path==='/api/auth/me')return response(200,signedIn);const items=path==='/api/projects'?[{id:'p1',title:'课堂研究项目'}]:path==='/api/workspace/drafts'?[{id:'d1',title:'课堂研究草稿'}]:path==='/api/results'?[{id:'r1',title:'课堂研究成果'}]:path==='/api/files'?[{id:'f1',name:'课堂研究原件.txt'}]:null;return {ok:true,status:200,json:async()=>({items})};});
 try{f.dom.window.location.hash='#search/'+encodeURIComponent('课堂');f.api.render();await new Promise(resolve=>setTimeout(resolve,15));const panel=f.document.querySelector('#account-search-panel');assert.match(panel.textContent,/课堂研究项目/);assert.match(panel.textContent,/课堂研究草稿/);assert.match(panel.textContent,/课堂研究成果/);assert.deepEqual([...panel.querySelectorAll('a')].map(a=>a.getAttribute('href')),['#projects?scope=account&project=p1','#account-draft/d1','#assets?scope=account&result=r1','/api/files/f1/download']);assert.ok(panel.querySelector('a[href="#account-draft/d1"]'));assert.ok(panel.querySelector('a[href="/api/files/f1/download"]'));}finally{f.close();}
});

test('a failed account search shows an unavailable state rather than claiming zero matches',async()=>{
 const f=await fixture(async path=>path==='/api/auth/me'?response(200,signedIn):{ok:false,status:503,json:async()=>({error:'暂时不可用'})});try{f.dom.window.location.hash='#search/'+encodeURIComponent('课堂');f.api.render();await new Promise(resolve=>setTimeout(resolve,15));const panel=f.document.querySelector('#account-search-panel');assert.match(panel.textContent,/无法确认匹配数量/);assert.doesNotMatch(panel.textContent,/没有匹配的记录/);}finally{f.close();}
});


test('native thesis-library link navigation renders the thesis when the clicked link retains focus',async()=>{
 const item={id:'cloud-thesis',version:2,title:'真实路由测试论文',profile:{level:'本科'},snapshot:{title:'真实路由测试论文',profile:{level:'本科'},materials:[],references:[],outline:[]},status:'draft',chapters:[{id:'c1',title:'第一章',text:'已保存正文',version:1,status:'saved'}],job:null},json=data=>({ok:true,status:200,json:async()=>data});
 const f=await fixture(async path=>{if(path==='/api/auth/me')return response(200,signedIn);if(path==='/api/theses')return json({items:[item]});if(path==='/api/theses/cloud-thesis')return json({item});if(path==='/api/capabilities')return json({thesis:{ready:true}});return json({items:[]});});
 try{await f.api.loadWorkspaceSession();f.dom.window.history.replaceState(null,'','/workspace.html#theses');f.api.render();for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));f.dom.window.isCurrentRouteChange=(event,url)=>event.newURL===url;const link=f.document.querySelector('.thesis-library a');link.focus();assert.equal(f.document.activeElement,link);link.click();for(let i=0;i<12;i++)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(f.dom.window.location.hash,'#thesis/cloud-thesis');assert.equal(f.document.querySelector('.thesis-library'),null);assert.equal(f.document.querySelector('[data-thesis-editor]').value,'已保存正文');assert.match(f.document.querySelector('.thesis-summary').textContent,/真实路由测试论文/);const back=f.document.querySelector('.thesis-bottom-actions a[href="#theses"]');back.focus();back.click();for(let i=0;i<12;i++)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(f.dom.window.location.hash,'#theses');assert.ok(f.document.querySelector('.thesis-library'));assert.equal(f.document.querySelector('[data-thesis-editor]'),null);}finally{f.close();}
});

for(const lateSaveResult of [false,true])test(`a delayed questionnaire route save returning ${lateSaveResult} cannot overwrite a newer navigation`,async()=>{
 const f=await fixture(async()=>response(401)),w=f.dom.window;
 const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
 try{
  await f.api.loadWorkspaceSession();const draftBefore=f.storage.getItem(keys.drafts);let releaseSave;const pending=new Promise(resolve=>releaseSave=resolve),guards=[];
  w.isCurrentRouteChange=(event,url)=>event.newURL===url;
  w.questionnaireRouteGuard=async target=>{guards.push(target);return target==='#orders'?pending:true;};
  const navigate=hash=>{const oldURL=w.location.href,newURL=new URL(hash,oldURL).href;w.history.replaceState(null,'',newURL);w.dispatchEvent(new w.HashChangeEvent('hashchange',{oldURL,newURL}));};
  f.paymentCalls.length=0;navigate('#orders');await settle();
  assert.ok(f.document.querySelector('#profile-form'),'the current editor remains until its async save resolves');assert.equal(f.paymentCalls.some(call=>call.type==='orders'),false);
  navigate('#membership/pay?product=newer-choice');await settle();
  assert.equal(w.location.hash,'#membership/pay?product=newer-choice');assert.equal(f.document.querySelector('.breadcrumb strong').textContent,'安全支付');
  assert.deepEqual(f.paymentCalls.filter(call=>call.type==='checkout'),[{type:'checkout',productId:'newer-choice',orderId:null}]);
  releaseSave(lateSaveResult);await settle();
  assert.equal(w.location.hash,'#membership/pay?product=newer-choice','a stale save result must not rewind the later URL');assert.equal(f.document.querySelector('.breadcrumb strong').textContent,'安全支付');
  assert.equal(f.paymentCalls.some(call=>call.type==='orders'),false);assert.equal(f.paymentCalls.filter(call=>call.type==='checkout').length,1);assert.deepEqual(guards,['#orders','#membership/pay?product=newer-choice']);assert.equal(f.storage.getItem(keys.drafts),draftBefore);
 }finally{f.close();}
});

test('a questionnaire save failure blocks its current navigation and leaves the editor intact',async()=>{
 const f=await fixture(async()=>response(401)),w=f.dom.window;
 try{await f.api.loadWorkspaceSession();w.isCurrentRouteChange=(event,url)=>event.newURL===url;w.questionnaireRouteGuard=async()=>false;f.paymentCalls.length=0;const oldURL=w.location.href,newURL='https://paperknow.cn/workspace.html#orders';w.history.replaceState(null,'',newURL);w.dispatchEvent(new w.HashChangeEvent('hashchange',{oldURL,newURL}));for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(w.location.hash,'#account');assert.ok(f.document.querySelector('#profile-form'));assert.equal(f.paymentCalls.some(call=>call.type==='orders'),false);}finally{f.close();}
});

for(const dirty of [false,true])test(`storage updates preserve an active ${dirty?'unsaved':'saved'} questionnaire without remounting or moving its editor`,async()=>{
 const f=await fixture(async()=>response(401)),w=f.dom.window;let mounts=0,disposed=0;
 try{await f.api.loadWorkspaceSession();w.mountTool=id=>{assert.equal(id,'questionnaire');mounts++;f.document.querySelector('.dashboard').innerHTML='<section class="questionnaire-space"><input id="questionnaire-storage-title" value="已保存的问卷主题"></section>';return true;};w.disposeQuestionnaire=()=>disposed++;w.history.replaceState(null,'','#tool/questionnaire?survey=owned-survey');f.api.render();const input=f.document.querySelector('#questionnaire-storage-title');if(dirty)input.value='尚未提交到服务器的新编辑';input.focus();input.setSelectionRange(5,5);const beforeDisposes=disposed,localBefore=f.storage.getItem(keys.drafts);w.dispatchEvent(new w.StorageEvent('storage',{key:keys.preferences,newValue:'{"density":"comfortable"}',url:'https://paperknow.cn/workspace.html#settings',storageArea:f.storage}));assert.equal(mounts,1);assert.equal(disposed,beforeDisposes);assert.equal(f.document.querySelector('#questionnaire-storage-title'),input);assert.equal(input.value,dirty?'尚未提交到服务器的新编辑':'已保存的问卷主题');assert.equal(f.document.activeElement,input);assert.equal(input.selectionStart,5);assert.equal(w.location.hash,'#tool/questionnaire?survey=owned-survey');assert.equal(f.storage.getItem(keys.drafts),localBefore);}finally{f.close();}
});

test('storage cannot bypass an in-flight questionnaire save after the requested route URL has already changed',async()=>{
 const f=await fixture(async()=>response(401)),w=f.dom.window;const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};let release;
 try{await f.api.loadWorkspaceSession();w.mountTool=()=>{f.document.querySelector('.dashboard').innerHTML='<section class="questionnaire-space"><input id="questionnaire-pending-title" value="待保存的问卷"></section>';return true;};w.history.replaceState(null,'','#tool/questionnaire?survey=owned-survey');f.api.render();const input=f.document.querySelector('#questionnaire-pending-title'),waiting=new Promise(resolve=>release=resolve);w.isCurrentRouteChange=(event,url)=>event.newURL===url;w.questionnaireRouteGuard=()=>waiting;const oldURL=w.location.href,newURL='https://paperknow.cn/workspace.html#orders';w.history.replaceState(null,'',newURL);w.dispatchEvent(new w.HashChangeEvent('hashchange',{oldURL,newURL}));await settle();w.dispatchEvent(new w.StorageEvent('storage',{key:keys.tasks,newValue:'[]',storageArea:f.storage}));assert.equal(f.document.querySelector('#questionnaire-pending-title'),input);assert.equal(f.paymentCalls.some(call=>call.type==='orders'),false);release(true);await settle();assert.equal(w.location.hash,'#orders');assert.equal(f.document.querySelector('.breadcrumb strong').textContent,'订单记录');assert.equal(f.paymentCalls.filter(call=>call.type==='orders').length,1);}finally{f.close();}
});

test('questionnaire storage protection does not suppress account session updates',async()=>{
 let user=signedIn;const f=await fixture(async()=>response(200,user)),w=f.dom.window,observed=[];
 try{await f.api.loadWorkspaceSession();w.questionnaireSessionChanged=account=>observed.push(account?.id??null);w.mountTool=()=>{f.document.querySelector('.dashboard').innerHTML='<section class="questionnaire-space">账户问卷编辑页</section>';return true;};w.history.replaceState(null,'','#tool/questionnaire');f.api.render();user={...signedIn,id:'another-account',name:'另一个账户'};await f.api.loadWorkspaceSession(true);assert.deepEqual(observed,['another-account']);assert.equal(f.document.querySelector('.hub-profile-name').textContent,'另一个账户');assert.ok(f.document.querySelector('.questionnaire-space'));}finally{f.close();}
});
