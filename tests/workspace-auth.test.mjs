import * as thesisCompletion from '../dist/workspace/thesis-completion-panel.mjs';
import {thesisCoverFields,thesisFrontMatterKind,thesisManualBackMatter} from '../dist/workspace/thesis-delivery.mjs';
import {helpKnowledgeMarkup,bindHelpKnowledge} from '../dist/workspace/help.mjs';
import {supportContactsMarkup,bindSupportContacts} from '../dist/workspace/support-contacts.mjs';
import {thesisTemplatePanel,uploadThesisTemplate,thesisExportMetadata} from '../dist/workspace/thesis-template.mjs';
import {downloadDefaultThesisTemplate} from '../dist/workspace/document-export.mjs';
import {renderThesisDocument,showThesisExportCheck} from '../dist/workspace/thesis-export-render.mjs';
import {assessThesisEvidence} from '../dist/workspace/thesis-evidence.mjs';
import {writingQualityPanel} from '../dist/workspace/writing-quality-panel.mjs';
import {resolveAccountProjectId,projectPickerOptions} from '../dist/workspace/project-directory.mjs';
import {captureDraftScope} from '../dist/workspace/state.mjs';
import {workspaceJobLabel,workspaceResultTitle,workspaceJobError,workspaceJobStatusLabel,workspaceJobActive,workspaceJobHref} from '../dist/workspace/workspace-job-model.mjs';
import {accountOverviewItems} from '../dist/workspace/home-account-model.mjs';
import {normalizeThesisFigures,thesisFigureTitle,renderThesisFigureSvg} from '../dist/workspace/thesis-figure.mjs';
import {thesisEditorPresentation,restoreThesisEditorText,thesisEditorWordCount} from '../dist/workspace/thesis-editor-presentation.mjs';
import {isOutlineReferenceChapter} from '../dist/workspace/outline-word-budget.mjs';
import {presentThesisDocument,buildThesisBibliography,withBibliographicMetadata} from '../dist/workspace/thesis-document.mjs';
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
import {openRevisionReport} from '../dist/workspace/revision-report.mjs';
import {normalizeConfirmedRevisionReport,reportSources} from '../dist/workspace/revision-report-model.mjs';
import {validateRevisionProtection} from '../dist/workspace/revision-protection.mjs';
import {normalizeRevisionComparison,compareRevisionDocument} from '../dist/workspace/revision-comparison-model.mjs';
import {revisionComparisonMarkup,openRevisionSources} from '../dist/workspace/revision-source-ui.mjs';
import {loadRevisionComparisonHandoff,hasRevisionComparisonHandoff} from '../dist/workspace/revision-comparison-handoff.mjs';
import {workspaceLinks} from '../dist/workspace/interface.mjs';
import * as revisionModel from '../dist/workspace/revision-model.mjs';
import * as taskModel from '../dist/workspace/task-model.mjs';
import * as projectModel from '../dist/workspace/project-model.mjs';
import * as assetModel from '../dist/workspace/asset-model.mjs';
import * as overviewModel from '../dist/workspace/overview-model.mjs';
import {homeLayout,fitHomeRows,continuationAssets} from '../dist/workspace/home-layout.mjs';

const source=(await readFile(new URL('../dist/workspace/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const homeSource=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const historySource=(await readFile(new URL('../dist/workspace/project-history-import.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
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
 Object.assign(dom.window,thesisCompletion,{thesisCoverFields,thesisFrontMatterKind,thesisManualBackMatter,helpKnowledgeMarkup,bindHelpKnowledge,supportContactsMarkup,bindSupportContacts,projectPickerOptions,hasDraftScope:()=>false,installStoredFilePickers:()=>({dispose(){}}),installProjectPickers:()=>()=>{},selectableProjects:()=>[],setProjectDirectorySession:()=>{},updateAccountProjects:()=>false,resolveAccountProjectId,captureDraftScope,workspaceJobLabel,workspaceResultTitle,workspaceJobError,workspaceJobStatusLabel,workspaceJobActive,workspaceJobHref,accountOverviewItems,mountArtifactLibrary:()=>({refresh(){},dispose(){}}),normalizeThesisFigures,thesisFigureTitle,renderThesisFigureSvg,thesisEditorPresentation,restoreThesisEditorText,thesisEditorWordCount,isOutlineReferenceChapter,presentThesisDocument,buildThesisBibliography,withBibliographicMetadata,assessThesisEvidence,writingQualityPanel,thesisTemplatePanel,uploadThesisTemplate,thesisExportMetadata,downloadDefaultThesisTemplate,renderThesisDocument,showThesisExportCheck,publicBackupCopy,publicDraftCopy,publicTaskCopy,withStableView,resetStableView,keepsWorkspacePosition,installStableDisclosures,fetch:fetcher,AbortController,structuredClone,setTimeout:setTimer,clearTimeout:timer=>{timers.delete(timer);clearTimeout(timer);},matchMedia:()=>({matches:false}),scrollTo:()=>{},requestAnimationFrame:()=>{},keys,esc,icon,empty,toolBanner,toolConfigs:{writing:['AI 写作','整理研究内容']},
  ...taskModel,...projectModel,...assetModel,...overviewModel,homeLayout,fitHomeRows,continuationAssets,readHomeService:async()=>({cap:{},user:null}),preferences:()=>({degree:'本科',...read(keys.preferences,{})}),profile:()=>({name:'研究者',...read(keys.profile,{})}),read,list:key=>read(key,[]),write:(key,value)=>storage.setItem(key,JSON.stringify(value)),projects:()=>read(keys.projects,[]),repository:{all:allReports},formatDate:()=>'',mountNavigation:()=>({close(){}}),
  disposeWritingFlows:()=>{},disposeDataAnalysis:()=>{},disposeQuestionnaire:()=>{},questionnaireRouteGuard:async()=>true,questionnaireSessionChanged:()=>{},disposeFormat:()=>{},disposeResearch:()=>{},disposePresentation:()=>{},disposeRevision:()=>{},disposeAccountDraft:()=>{},accountDraftEditing:()=>false,accountDraftHasWork:()=>false,accountDraftConfirmLeave:async()=>true,accountDraftSessionChanged:()=>{},accountDraftRouteGuard:()=>true,
  disposePayment:()=>{paymentCalls.push({type:'dispose'});},renderPaymentOrders:async()=>{paymentCalls.push({type:'orders'});},renderPaymentCheckout:async options=>{paymentCalls.push({type:'checkout',productId:options.productId,orderId:options.orderId});},clearEditor:()=>{},clearHelpWork:()=>{},clearSettingsWork:()=>{},clearMoreWork:()=>{},trackDialogForm:()=>()=>{},retainWritingCatalog:()=>{},isCurrentRouteChange:()=>false,
  editorIsActive:()=>false,editorRouteGuard:()=>true,helpHasWork:()=>false,helpRouteGuard:()=>true,settingsHasWork:()=>false,settingsRouteGuard:()=>true,moreHasWork:()=>false,moreRouteGuard:()=>true,formatHasWork:()=>false,formatRouteGuard:()=>true,researchHasWork:()=>false,researchRouteGuard:()=>true,presentationHasWork:()=>false,presentationRouteGuard:()=>true,revisionHasWork:()=>false,revisionRouteGuard:()=>true,detectionRouteGuard:()=>true,
 });
 vm.runInContext('(function(){'+documentExportSource+'\nObject.assign(globalThis,{documentExportButtons,bindDocumentExports});})()',dom.getInternalVMContext());
 vm.runInContext('(function(){'+thesisSource+'\nObject.assign(globalThis,{mountOnlineThesis,mountThesisLibrary,disposeOnlineThesis,thesisOnlineHasWork,thesisOnlineRouteGuard,thesisOnlineSessionChanged});})()',dom.getInternalVMContext());
 vm.runInContext('(function(){'+historySource+'\nObject.assign(globalThis,{mountProjectHistoryImport});})()',dom.getInternalVMContext());
 vm.runInContext('(function(){'+onlineSource+'\nObject.assign(globalThis,{mountOnlineWorkspace,disposeOnlineWorkspace,onlineWorkspaceRouteGuard,onlineWorkspaceHasWork,onlineWorkspaceSessionChanged,onlineWorkspaceConfirmLeave,onlineWorkspaceHref});})()',dom.getInternalVMContext());
 setup?.(dom.window);
 await vm.runInContext('(async()=>{'+source+'\nglobalThis.workspaceAuthTest={loadWorkspaceSession,workspaceServiceFetch,signOutWorkspace,renderAccount,authHref,render,loadHomeService};})()',dom.getInternalVMContext());
 for(let i=0;i<8;i++)await Promise.resolve();
 return {dom,document:dom.window.document,storage,paymentCalls,reads,api:dom.window.workspaceAuthTest,close(){dom.window.disposeOnlineThesis();timers.forEach(clearTimeout);dom.window.close();}};
}

for(const hash of ['#tool/agent?project=p1','#tasks?scope=account&view=agent&project=p1'])test('research assistant opens as a function and preserves project context from '+hash,async()=>{
 const calls=[],fetcher=async(path,options={})=>{calls.push({path,options});let value={items:[]};if(path==='/api/auth/me')value={user:signedIn};else if(path==='/api/capabilities')value={ai:true,agent:true};else if(path==='/api/projects')value={items:[{id:'p1',title:'研究项目'}]};else if(path==='/api/projects/p1')value={item:{id:'p1',title:'研究项目'},files:[],jobs:[],results:[],drafts:[],theses:[]};return{ok:true,status:200,json:async()=>value};};
 const f=await fixture(fetcher,{hash,setup:w=>{w.renderOnlinePersonal=async()=>false;w.isCurrentRouteChange=(event,url)=>event.newURL===url;}});try{
  for(let i=0;i<80&&!f.document.querySelector('#agent-form');i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(f.document.querySelector('#agent-form'),JSON.stringify({text:f.document.querySelector('.dashboard')?.textContent,calls:calls.map(row=>row.path),hash:f.dom.window.location.hash}));assert.equal(f.dom.window.location.hash,'#tool/agent?project=p1');assert.equal(f.document.querySelector('#agent-project').value,'p1');assert.equal(f.document.querySelector('.workspace-scope-tabs'),null);assert.equal(f.document.querySelector('[data-tool-category]').dataset.toolCategory,'literature');assert.equal(f.document.querySelector('#task-form'),null);assert.match(f.document.querySelector('.dashboard').textContent,/科研智能助手/);assert.equal(calls.some(call=>call.options.body||call.path==='/api/billing/quote'),false);
 }finally{f.close();}
});

test('tool, account and cloud-asset navigation avoid local summaries while search still reads newly saved drafts',async()=>{
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
  assert.equal(f.reads.filter(key=>key===keys.drafts).length,0);assert.equal(f.document.querySelector('#asset-table-body'),null);assert.ok(f.document.querySelector('#cloud-artifact-library'));assert.equal(f.dom.window.location.hash,'#assets');assert.match(f.storage.getItem(keys.drafts),/新保存的本地研究/);
  f.storage.setItem(keys.drafts,JSON.stringify([{id:'newer-draft',title:'搜索前刚保存的研究',tool:'writing',updatedAt:'2026-10-19T05:00:00Z',stage:'draft'}]));
  f.dom.window.history.replaceState(null,'','/workspace.html#search/研究');f.api.render();
  assert.match(f.document.querySelector('.dashboard').textContent,/搜索前刚保存的研究/);assert.doesNotMatch(f.document.querySelector('.dashboard').textContent,/新保存的本地研究/);
 }finally{f.close();}
});

function deferredReports(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const lateReport={id:'late-report',title:'稍后读取的比对报告',createdAt:'2026-10-19T04:00:00Z',totalChars:120,sourceCount:1};
const settleReports=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};

test('legacy asset scope and recent links resolve to one cloud route without losing deep-link parameters',async()=>{
 for(const [hash,expected] of [['#assets?scope=local','#assets'],['#assets?scope=account&project=p1&result=r1','#assets?project=p1&result=r1'],['#recent?scope=local&import=draft-one','#assets?import=draft-one']]){
  const f=await fixture(async()=>response(401),{hash});
  try{
   await settleReports();assert.equal(f.dom.window.location.hash,expected);
   assert.ok(f.document.querySelector('#cloud-artifact-library'));assert.equal(f.document.querySelector('.workspace-content-scope'),null);
   assert.equal(f.document.querySelector('#asset-table-body'),null);assert.match(f.storage.getItem(keys.drafts),/未上传的研究草稿/);
   assert.equal(f.document.querySelector('#online-workspace .account-login-required'),null,'the main cloud-file library owns the single login prompt');
  }finally{f.close();}
 }
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

test('local search still populates delayed report rows without reintroducing a local asset library',async()=>{
 for(const hash of ['#search/比对报告']){
  const pending=deferredReports(),f=await fixture(async()=>response(401),{hash,allReports:()=>pending.promise});
  try{
   assert.ok(f.document.querySelector('[data-local-reports-status]'));assert.doesNotMatch(f.document.querySelector('.dashboard').textContent,/稍后读取的比对报告/);
   pending.resolve([lateReport]);await settleReports();
   assert.match(f.document.querySelector('.dashboard').textContent,/稍后读取的比对报告/);assert.equal(f.document.querySelector('[data-local-reports-status]'),null);
   if(hash.startsWith('#assets'))assert.equal(f.document.querySelector('#asset-count').textContent,'共 2 份成果');
  }finally{f.close();}
 }
});

test('late local reports cannot remount cloud assets or recreate the removed scope switch',async()=>{
 const pending=deferredReports(),f=await fixture(async path=>path==='/api/auth/me'?response(200,signedIn):{ok:true,status:200,json:async()=>({items:[]})},{hash:'#assets?scope=account',allReports:()=>pending.promise});
 try{
  await settleReports();const workspace=f.document.querySelector('#online-workspace'),content=workspace.firstElementChild;assert.ok(content);assert.equal(f.document.querySelector('.workspace-scope-tabs'),null);
  pending.resolve([lateReport]);await settleReports();
  assert.equal(f.document.querySelector('#online-workspace'),workspace);assert.equal(workspace.firstElementChild,content);assert.equal(f.document.querySelector('.workspace-scope-tabs'),null);assert.equal(f.document.querySelector('#asset-table-body'),null);assert.equal(f.document.querySelector('[data-local-reports-status]'),null);
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
   f.dom.window.history.replaceState(null,'','/workspace.html#search/比对报告');f.api.render();assert.match(f.document.querySelector('.dashboard').textContent,/稍后读取的比对报告/);
  }finally{f.close();}
 }
});

test('report completion preserves an open dialog and updates search only after it closes',async()=>{
 const pending=deferredReports(),f=await fixture(async()=>response(401),{hash:'#search/比对报告',allReports:()=>pending.promise});
 try{
  const dialog=f.document.querySelector('#workspace-dialog');f.document.querySelector('#workspace-dialog-body').innerHTML='<input id="pending-project-name" value="研究项目草稿">';dialog.setAttribute('open','');const input=f.document.querySelector('#pending-project-name');input.focus();
  pending.resolve([lateReport]);await settleReports();
  assert.equal(dialog.open,true);assert.equal(f.document.querySelector('#pending-project-name'),input);assert.equal(input.value,'研究项目草稿');assert.doesNotMatch(f.document.querySelector('.dashboard').textContent,/稍后读取的比对报告/);
  dialog.removeAttribute('open');dialog.dispatchEvent(new f.dom.window.Event('close'));await settleReports();assert.match(f.document.querySelector('.dashboard').textContent,/稍后读取的比对报告/);
 }finally{f.close();}
});

test('an initial report failure preserves browser drafts and displays a recoverable search warning',async()=>{
 const pending=deferredReports(),f=await fixture(async()=>response(401),{hash:'#search/研究',allReports:()=>pending.promise});
 try{
  assert.match(f.document.querySelector('.dashboard').textContent,/未上传的研究草稿/);pending.reject(new Error('IndexedDB unavailable'));await settleReports();
  assert.match(f.document.querySelector('[data-local-reports-status]').textContent,/比对报告暂时无法读取/);assert.match(f.document.querySelector('.dashboard').textContent,/未上传的研究草稿/);assert.match(f.storage.getItem(keys.drafts),/未上传的研究草稿/);
 }finally{f.close();}
});

test('a late initial report snapshot cannot overwrite a newer explicit report reload',async()=>{
 const pending=deferredReports();let reads=0,restored;
 const f=await fixture(async()=>response(401),{allReports:()=>++reads===1?pending.promise:Promise.resolve([lateReport]),setup:w=>{w.mountSettings=context=>{restored=context.restored;w.document.querySelector('.dashboard').innerHTML='<p>备份已恢复</p>';};}});
 try{
  f.dom.window.history.replaceState(null,'','/workspace.html#settings');f.api.render();await restored();pending.resolve([]);await settleReports();
  f.dom.window.history.replaceState(null,'','/workspace.html#search/比对报告');f.api.render();assert.match(f.document.querySelector('.dashboard').textContent,/稍后读取的比对报告/);
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
  const expected=[['writing','AI 写作'],['literature','AI 研读'],['reduce','降重复率'],['aigc','降AI率'],['detection','论文检测'],['ppt','PPT 创作'],['format','格式排版'],['research','科研工具']]
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
 Object.assign(dom.window,{projectPickerOptions,captureDraftScope,workspaceJobLabel,workspaceResultTitle,workspaceJobError,workspaceJobStatusLabel,workspaceJobActive,workspaceJobHref,accountOverviewItems,mountArtifactLibrary:()=>({refresh(){},dispose(){}}),mountAigcDetection,ensureAigcStyle,revisionStrategy,openRevisionReport,normalizeConfirmedRevisionReport,reportSources,validateRevisionProtection,thesisEditorPresentation,restoreThesisEditorText,thesisEditorWordCount,isOutlineReferenceChapter,presentThesisDocument,buildThesisBibliography,withBibliographicMetadata,publicBackupCopy,publicDraftCopy,publicTaskCopy,withStableView,resetStableView,keepsWorkspacePosition,installStableDisclosures,...revisionModel,keys,esc,icon,toolBanner,list:()=>[],projects:()=>[],formatDate:()=>''});
 try{
  Object.assign(dom.window,{normalizeRevisionComparison,compareRevisionDocument,revisionComparisonMarkup,openRevisionSources,loadRevisionComparisonHandoff,hasRevisionComparisonHandoff});
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
   assert.ok(query('#revision-entry-form'));assert.equal(query('#revision-space'),null);assert.equal(query('[data-revision-bundle-offers]'),null);
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
  assert.ok(query('#revision-entry-form'));assert.equal(query('#revision-space'),null);assert.equal(query('[data-revision-bundle-offers]'),null);
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
 Object.assign(w,{workspaceJobLabel,workspaceResultTitle,workspaceJobError,workspaceJobActive,workspaceJobStatusLabel,
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
 try{f.dom.window.location.hash='#search/'+encodeURIComponent('课堂');f.api.render();await new Promise(resolve=>setTimeout(resolve,15));const panel=f.document.querySelector('#account-search-panel');assert.match(panel.textContent,/课堂研究项目/);assert.match(panel.textContent,/课堂研究草稿/);assert.match(panel.textContent,/课堂研究成果/);assert.deepEqual([...panel.querySelectorAll('a')].map(a=>a.getAttribute('href')),['#projects?project=p1','#account-draft/d1','#assets?result=r1','/api/files/f1/download']);assert.ok(panel.querySelector('a[href="#account-draft/d1"]'));assert.ok(panel.querySelector('a[href="/api/files/f1/download"]'));}finally{f.close();}
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


test('old local asset links preserve drafts and project associations while opening cloud management',async()=>{
 const encoded='account:'+encodeURIComponent(signedIn.id)+':remote-project',local=[{id:'local-project',name:'Local project'}],draft={id:'encoded-draft',title:'Linked account research draft',tool:'writing',stage:'draft',text:'Saved research content',projectId:encoded,updatedAt:'2026-10-21T00:00:00Z'};
 const calls=[],f=await fixture(async(path,options)=>{calls.push({path,options});return path==='/api/auth/me'?response(200,signedIn):{ok:true,status:200,json:async()=>({items:[]})};},{hash:'#assets?scope=local',setup:w=>{w.localStorage.setItem(keys.projects,JSON.stringify(local));w.localStorage.setItem(keys.drafts,JSON.stringify([draft]));}});
 try{await settleReports();assert.equal(f.dom.window.location.hash,'#assets');assert.ok(f.document.querySelector('#cloud-artifact-library'));assert.equal(f.document.querySelector('.workspace-content-scope'),null);assert.equal(f.document.querySelector('#asset-table-body'),null);assert.deepEqual(JSON.parse(f.storage.getItem(keys.projects)),local);assert.deepEqual(JSON.parse(f.storage.getItem(keys.drafts)),[draft]);assert.equal(calls.some(call=>call.options?.body),false);}finally{f.close();}
});

function accountHomeData(owner,title){return {cap:{},user:owner,jobs:[],files:[],usage:[],projects:[],results:[],theses:[],drafts:[{id:'home-'+owner.id,title,tool:'writing',updated_at:'2026-10-21T00:00:00Z'}],summary:{counts:{projects:0,drafts:1,results:0,queuedJobs:0,runningJobs:0}}};}
function showHomeFixtureRoute(f,hash){f.dom.window.history.replaceState(null,'','/workspace.html'+hash);f.api.render();}

test('home revisits reuse current account records immediately and share an in-flight read without forcing another session request',async()=>{
 const pending=deferredReports();let reads=0,auth=0;
 const f=await fixture(async()=>{auth++;return response(200,signedIn);},{hash:'#home',setup:w=>{w.readHomeService=async()=>{reads++;return pending.promise;};w.mountResearch=()=>{w.document.querySelector('.dashboard').innerHTML='<input id="research-cache-test">';};}});
 try{
  await settleReports();assert.equal(reads,1);assert.equal(auth,1);
  for(let i=0;i<3;i++){showHomeFixtureRoute(f,'#category/research');showHomeFixtureRoute(f,'#home');}
  await settleReports();assert.equal(reads,1,'concurrent home mounts share the same private read');assert.equal(auth,1);
  pending.resolve(accountHomeData(signedIn,'已保存的首页账户草稿'));await settleReports();
  showHomeFixtureRoute(f,'#category/research');showHomeFixtureRoute(f,'#home');
  assert.match(f.document.querySelector('#home-resume').textContent,/已保存的首页账户草稿/);assert.doesNotMatch(f.document.querySelector('#home-resume').textContent,/正在读取/);
  await settleReports();assert.equal(reads,1,'fresh home data survives switching away and back');assert.equal(auth,1);
 }finally{f.close();}
});

test('explicit local home does not request account overview lists and changing to account scope loads once',async()=>{
 let reads=0;const f=await fixture(async()=>response(200,signedIn),{hash:'#home?scope=local',setup:w=>{w.readHomeService=async()=>{reads++;return accountHomeData(signedIn,'账户范围草稿');};}});
 try{
  await settleReports();showHomeFixtureRoute(f,'#home?scope=local');await settleReports();assert.equal(reads,0);assert.match(f.document.querySelector('#home-resume').textContent,/未上传的研究草稿/);
  showHomeFixtureRoute(f,'#home?scope=account');await settleReports();assert.equal(reads,1);assert.match(f.document.querySelector('#home-resume').textContent,/账户范围草稿/);
  showHomeFixtureRoute(f,'#home?scope=local');assert.doesNotMatch(f.document.querySelector('#home-resume').textContent,/账户范围草稿/);await settleReports();assert.equal(reads,1);
 }finally{f.close();}
});

test('stale home data refreshes in the background while later responses leave another tool input untouched',async()=>{
 const pending=deferredReports();let reads=0,clock=Date.now();
 const f=await fixture(async()=>response(200,signedIn),{hash:'#home',setup:w=>{w.Date.now=()=>clock;w.readHomeService=async()=>++reads===1?accountHomeData(signedIn,'原先保存的账户内容'):pending.promise;w.mountResearch=()=>{w.document.querySelector('.dashboard').innerHTML='<input id="home-background-input">';};}});
 try{
  await settleReports();assert.equal(reads,1);clock+=15001;showHomeFixtureRoute(f,'#home');
  assert.match(f.document.querySelector('#home-resume').textContent,/原先保存的账户内容/);assert.doesNotMatch(f.document.querySelector('#home-resume').textContent,/正在读取/);await settleReports();assert.equal(reads,2);
  showHomeFixtureRoute(f,'#category/research');const input=f.document.querySelector('#home-background-input');input.value='正在编辑，不能替换';input.focus();
  pending.resolve(accountHomeData(signedIn,'后台更新后的账户内容'));await settleReports();assert.equal(f.document.querySelector('#home-background-input'),input);assert.equal(input.value,'正在编辑，不能替换');assert.equal(f.document.activeElement,input);
  showHomeFixtureRoute(f,'#home');assert.match(f.document.querySelector('#home-resume').textContent,/后台更新后的账户内容/);await settleReports();assert.equal(reads,2);
 }finally{f.close();}
});

test('changing account clears cached home records and ignores the previous account response arriving later',async()=>{
 const alice=signedIn,bob={...signedIn,id:'home-bob',name:'新账户'},oldPending=deferredReports(),newPending=deferredReports();let user=alice,reads=0,clock=Date.now();
 const f=await fixture(async()=>response(200,user),{hash:'#home',setup:w=>{w.Date.now=()=>clock;w.readHomeService=async()=>{reads++;return reads===1?accountHomeData(alice,'旧账户私人标题'):reads===2?oldPending.promise:newPending.promise;};}});
 try{
  await settleReports();assert.match(f.document.querySelector('#home-resume').textContent,/旧账户私人标题/);
  clock+=15001;void f.api.loadHomeService();await settleReports();assert.equal(reads,2);
  user=bob;await f.api.loadWorkspaceSession(true);await settleReports();assert.equal(reads,3);assert.doesNotMatch(f.document.querySelector('.home-refresh').textContent,/旧账户私人标题/);
  oldPending.resolve(accountHomeData(alice,'旧账户晚到结果'));await settleReports();assert.doesNotMatch(f.document.querySelector('.home-refresh').textContent,/旧账户晚到结果|旧账户私人标题/);
  newPending.resolve(accountHomeData(bob,'新账户安全内容'));await settleReports();assert.match(f.document.querySelector('#home-resume').textContent,/新账户安全内容/);assert.doesNotMatch(f.document.querySelector('.home-refresh').textContent,/旧账户/);
  await f.api.signOutWorkspace();await settleReports();assert.doesNotMatch(f.document.querySelector('.home-refresh').textContent,/新账户安全内容/);assert.match(f.document.querySelector('#home-resume').textContent,/未上传的研究草稿/);assert.equal(reads,3);
 }finally{oldPending.resolve(accountHomeData(alice,'旧账户晚到结果'));newPending.resolve(accountHomeData(bob,'新账户安全内容'));f.close();}
});


test('explicit home reload bypasses a fresh cache, retains current records on a transient failure, and recovers on retry',async()=>{
 let reads=0;const f=await fixture(async()=>response(200,signedIn),{hash:'#home',setup:w=>{w.readHomeService=async()=>{reads++;if(reads===2)throw Object.assign(Error('temporarily unavailable'),{status:503});return accountHomeData(signedIn,reads===1?'刷新前账户内容':'重新连接后的账户内容');};}});
 try{
  await settleReports();assert.equal(reads,1);await f.api.loadHomeService({force:true});assert.equal(reads,2);assert.match(f.document.querySelector('#home-resume').textContent,/刷新前账户内容/);assert.match(f.document.querySelector('#home-summary').textContent,/上次成功读取/);
  await f.api.loadHomeService();assert.equal(reads,3);assert.match(f.document.querySelector('#home-resume').textContent,/重新连接后的账户内容/);assert.doesNotMatch(f.document.querySelector('#home-summary').textContent,/上次成功读取/);
 }finally{f.close();}
});

test('home refresh authentication failures clear private cached records and recheck the current session',async()=>{
 let reads=0,user=signedIn,auth=0;const f=await fixture(async()=>{auth++;return response(user?200:401,user);},{hash:'#home',setup:w=>{w.readHomeService=async()=>{reads++;if(reads>1){user=null;throw Object.assign(Error('session expired'),{status:401});}return accountHomeData(signedIn,'会话失效前的私人草稿');};}});
 try{
  await settleReports();assert.match(f.document.querySelector('#home-resume').textContent,/会话失效前的私人草稿/);assert.equal(auth,1);
  await f.api.loadHomeService({force:true});await settleReports();assert.equal(auth,2);assert.doesNotMatch(f.document.querySelector('.home-refresh').textContent,/会话失效前的私人草稿/);assert.match(f.document.querySelector('#home-resume').textContent,/未上传的研究草稿/);
 }finally{f.close();}
});


test('project scopes and legacy detail links use one cloud project page while preserving historical records',async()=>{
 for(const [hash,expected] of [['#projects?scope=local','#projects'],['#projects?scope=account&project=p1','#projects?project=p1'],['#project/legacy-project','#projects?legacy=legacy-project']]){
  const f=await fixture(async()=>response(401),{hash,setup:w=>{w.localStorage.setItem(keys.projects,JSON.stringify([{id:'legacy-project',name:'历史研究项目'}]));}});
  try{
   await settleReports();assert.equal(f.dom.window.location.hash,expected);
   assert.equal(f.document.querySelector('.workspace-content-scope'),null);
   assert.equal(f.document.querySelector('.project-grid'),null);
   assert.match(f.document.querySelector('#online-workspace').textContent,/登录后管理我的项目/);
   assert.match(f.storage.getItem(keys.projects),/历史研究项目/);
  }finally{f.close();}
 }
});

test('new project shortcuts enter cloud creation without writing browser projects',async()=>{
 const f=await fixture(async()=>response(401));
 try{
  const prior=f.storage.getItem(keys.projects),button=f.document.createElement('button');button.dataset.newProject='';f.document.querySelector('.dashboard').append(button);button.click();
  assert.equal(f.dom.window.location.hash,'#projects?new=1');
  assert.equal(f.storage.getItem(keys.projects),prior);
  assert.equal(f.document.querySelector('#project-name'),null);
 }finally{f.close();}
});


test('all legacy help scope links open one canonical help page with public guidance',async()=>{
 for(const legacy of ['#help?scope=local','#help?scope=account','#help?scope=local&draft=local']){
  const calls=[],f=await fixture(async(path)=>{calls.push(path);return response(401);},{hash:legacy});
  try{
   await f.api.loadWorkspaceSession();f.api.render();
   for(let i=0;i<12;i++)await Promise.resolve();
   assert.equal(f.dom.window.location.hash,legacy.includes('draft=')?'#help?draft=local':'#help');
   assert.equal(f.document.querySelector('.workspace-content-scope'),null);
   assert.equal(f.document.querySelectorAll('.help-knowledge').length,1);
   assert.match(f.document.querySelector('.dashboard').textContent,/使用指南/);
   assert.match(f.document.querySelector('.dashboard').textContent,/登录后反馈/);
   assert.equal(f.document.querySelector('#help-feedback-form'),null);
   assert.equal(calls.includes('/api/feedback'),false);
  }finally{f.close();}
 }
});
