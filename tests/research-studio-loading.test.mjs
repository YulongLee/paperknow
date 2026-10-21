import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import * as researchModel from '../dist/workspace/research-model.mjs';
import * as deliveryModel from '../dist/workspace/research-delivery-model.mjs';
import * as state from '../dist/workspace/state.mjs';
import {mountFormulaOcr} from '../dist/workspace/formula-ocr.mjs';
import {toolBanner} from '../dist/workspace/tool-banner.mjs';
import {withStableView} from '../dist/workspace/view-stability.mjs';
import {esc,icon,download,formatDate} from '../dist/workspace/ui.mjs';

const moduleSource=await readFile(new URL('../dist/workspace/research.mjs',import.meta.url),'utf8');
// Keep the production loader, lifecycle guards, renderers and event handlers intact.
// Substitute only lazy module import boundaries with controlled promises.
const source=moduleSource.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')
 .replace("import('./research-formula-studio.mjs')",'loadFormulaStudioModule()')
 .replace("import('./research-drawing-studio.mjs')",'loadDrawingStudioModule()')
 .replace("import('./tool-job-panel.mjs')",'loadToolJobPanelModule()');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};

function harness(t,{mode='formula',session,drafts=[],ownerId,loadFormula,loadDrawing}={}){
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.cn/workspace.html#category/research?mode='+mode,runScripts:'outside-only'}),w=dom.window;
 const priorStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{value:w.localStorage,configurable:true});
 state.endDraftScope();
 if(ownerId)state.beginDraftScope({ownerId,drafts});
 else if(drafts.length)w.localStorage.setItem(state.keys.drafts,JSON.stringify(drafts));
 if(session)w.localStorage.setItem(deliveryModel.researchSessionKey,JSON.stringify(session));
 const calls={formulaLoads:0,drawingLoads:0,mounts:[],disposals:[],toolPanels:[]},notices=[];
 function mounted(kind,container,options){
  const lifecycle={dispose(){calls.disposals.push({kind,container});},hasUnsaved:()=>false,saveDraft:()=>true};
  calls.mounts.push({kind,container,options,lifecycle});
  container.innerHTML='<div data-mounted-studio="'+kind+'"></div>';
  return lifecycle;
 }
 const modules={
  formula:{mountResearchFormulaStudio:options=>mounted('formula',options.container,options)},
  drawing:{mountResearchDrawing:(container,ctx,options)=>mounted('drawing',container,{...options,ctx})}
 };
 Object.assign(w,researchModel,deliveryModel,state,{structuredClone,mountFormulaOcr,toolBanner,withStableView,esc,icon,download,formatDate,
  loadToolJobPanelModule:async()=>({mountToolJobPanel:options=>{let value={};const panel={setState(next){value=next;return options.onStateChange(next);},options};calls.toolPanels.push(panel);return{open(){},getState:()=>value,inputChanged(){},dispose(){}};}}),
  loadFormulaStudioModule:()=>{calls.formulaLoads++;return loadFormula?loadFormula(modules.formula,calls.formulaLoads):Promise.resolve(modules.formula);},
  loadDrawingStudioModule:()=>{calls.drawingLoads++;return loadDrawing?loadDrawing(modules.drawing,calls.drawingLoads):Promise.resolve(modules.drawing);}
 });
 w.eval(source+'\nwindow.lifecycle={mountResearch,disposeResearch,researchHasWork,researchRouteGuard};');
 const context={notify:value=>notices.push(value),api:async()=>{throw Error('Loading a studio must not call the service.');}};
 const h={w,dom,calls,modules,notices,context,q:selector=>w.document.querySelector(selector),
  mount:id=>w.lifecycle.mountResearch(context,id),dispose:()=>w.lifecycle.disposeResearch(),
  click(selector){const button=this.q(selector);assert.ok(button,selector);assert.equal(button.disabled,false,selector+' must remain enabled');button.click();}
 };
 t.after(()=>{h.dispose();state.endDraftScope();dom.window.close();if(priorStorage)Object.defineProperty(globalThis,'localStorage',priorStorage);else delete globalThis.localStorage;});
 return h;
}

test('the data view renders real charts without loading either studio, and studios load only when selected',async t=>{
 assert.doesNotMatch(moduleSource,/^import .*from ['"]\.\/research-(?:formula|drawing)-studio\.mjs['"]/m);
 assert.equal((moduleSource.match(/import\('\.\/research-formula-studio\.mjs'\)/g)||[]).length,1);
 assert.equal((moduleSource.match(/import\('\.\/research-drawing-studio\.mjs'\)/g)||[]).length,1);
 const formula=deferred(),drawing=deferred(),h=harness(t,{mode:'data',loadFormula:()=>formula.promise,loadDrawing:()=>drawing.promise});
 assert.deepEqual([h.calls.formulaLoads,h.calls.drawingLoads],[0,0]);h.mount();
 assert.ok(h.q('.research-table'));assert.ok(h.q('#research-chart svg'));
 assert.deepEqual([h.calls.formulaLoads,h.calls.drawingLoads],[0,0]);
 h.click('[data-mode="formula"]');assert.deepEqual([h.calls.formulaLoads,h.calls.drawingLoads],[1,0]);
 assert.match(h.q('[data-research-formula-host] [role="status"]').textContent,/正在加载/);
 h.click('[data-mode="basic"]');assert.deepEqual([h.calls.formulaLoads,h.calls.drawingLoads],[1,1]);
 formula.resolve(h.modules.formula);drawing.resolve(h.modules.drawing);await flush();
 assert.equal(h.calls.mounts.length,1);assert.equal(h.calls.mounts[0].kind,'drawing');
});

test('overlapping formula entries share one module load and cached redraws mount synchronously',async t=>{
 const loading=deferred(),h=harness(t,{loadFormula:()=>loading.promise});
 const first=h.mount(),oldHost=h.q('[data-research-formula-host]'),second=h.mount(),currentHost=h.q('[data-research-formula-host]');
 assert.equal(typeof first.then,'function');assert.equal(typeof second.then,'function');
 assert.notEqual(currentHost,oldHost);assert.equal(h.calls.formulaLoads,1);assert.equal(h.calls.mounts.length,0);
 loading.resolve(h.modules.formula);const [firstResult,currentResult]=await Promise.all([first,second]);
 assert.equal(firstResult,null);assert.equal(h.calls.mounts.length,1);
 assert.equal(h.calls.mounts[0].container,currentHost);assert.equal(currentResult,h.calls.mounts[0].lifecycle);
 h.click('[data-mode="formula"]');
 assert.equal(h.calls.formulaLoads,1);assert.equal(h.calls.mounts.length,2);
 assert.ok(h.q('[data-mounted-studio="formula"]'));assert.equal(h.calls.disposals.length,1);
});

test('pending basic and professional drawing entries share the drawing module and mount only the current mode',async t=>{
 const loading=deferred(),h=harness(t,{mode:'basic',loadDrawing:()=>loading.promise});
 const ready=h.mount(),oldHost=h.q('[data-research-drawing-host]');h.click('[data-mode="pro"]');
 const currentHost=h.q('[data-research-drawing-host]');assert.notEqual(currentHost,oldHost);
 assert.equal(h.calls.drawingLoads,1);assert.equal(h.calls.formulaLoads,0);
 assert.equal(h.w.lifecycle.researchRouteGuard(),true);assert.equal(!!h.w.lifecycle.researchHasWork(),false);
 loading.resolve(h.modules.drawing);await ready;await flush();
 assert.equal(h.calls.mounts.length,1);assert.equal(h.calls.mounts[0].container,currentHost);
 assert.equal(h.calls.mounts[0].options.mode,'professional');
 h.click('[data-mode="basic"]');assert.equal(h.calls.mounts.length,2);
 assert.equal(h.calls.mounts[1].options.mode,'basic');assert.equal(h.calls.drawingLoads,1);
});

for(const kind of ['formula','drawing']){
 test(kind+' module failures show a working retry without losing navigation or the saved formula seed',async t=>{
  const first=deferred(),retry=deferred(),option=kind==='formula'?'loadFormula':'loadDrawing';
  const seed={mode:kind==='formula'?'formula':'basic',formula:String.raw`x=\frac{a}{b}`,formulaId:'saved-formula',requirements:'保留符号说明'};
  const h=harness(t,{mode:seed.mode,session:seed,[option]:(_,attempt)=>attempt===1?first.promise:retry.promise}),ready=h.mount();
  first.reject(Error('Simulated module download failure'));assert.equal(await ready,null);
  const retryButton=h.q('[data-research-studio-retry="'+kind+'"]');assert.ok(retryButton);
  assert.match(h.q('[role="alert"]').textContent,/保留当前草稿/);
  assert.equal(h.w.lifecycle.researchRouteGuard(),true);assert.equal(h.q('[data-mode="data"]').disabled,false);
  const saved=JSON.parse(h.w.localStorage.getItem(deliveryModel.researchSessionKey));
  assert.equal(saved.formula,seed.formula);assert.equal(saved.formulaId,seed.formulaId);assert.equal(saved.requirements,seed.requirements);
  h.click('[data-research-studio-retry="'+kind+'"]');assert.equal(h.calls[kind+'Loads'],2);
  assert.match(h.q('[data-research-'+kind+'-host] [role="status"]').textContent,/正在加载/);
  retry.resolve(h.modules[kind]);await flush();
  assert.equal(h.calls.mounts.length,1);assert.ok(h.q('[data-mounted-studio="'+kind+'"]'));
  assert.equal(h.q('[data-research-studio-retry]'),null);assert.deepEqual(h.notices,[]);
 });

 test(kind+' resolution after leaving its mode cannot mount over the current data view',async t=>{
  const loading=deferred(),option=kind==='formula'?'loadFormula':'loadDrawing';
  const h=harness(t,{mode:kind==='formula'?'formula':'basic',[option]:()=>loading.promise}),ready=h.mount();
  assert.equal(h.w.lifecycle.researchRouteGuard(),true);assert.equal(!!h.w.lifecycle.researchHasWork(),false);
  h.click('[data-mode="data"]');const table=h.q('.research-table');assert.ok(table);
  loading.resolve(h.modules[kind]);assert.equal(await ready,null);
  assert.equal(h.calls.mounts.length,0);assert.equal(h.q('.research-table'),table);assert.equal(h.q('[role="alert"]').textContent,'');
  h.click('[data-mode="'+(kind==='formula'?'formula':'basic')+'"]');
  assert.equal(h.calls.mounts.length,1);assert.equal(h.calls[kind+'Loads'],1);assert.ok(h.q('[data-mounted-studio="'+kind+'"]'));
 });

 test(kind+' resolution after disposal cannot repaint a replacement page',async t=>{
  const loading=deferred(),option=kind==='formula'?'loadFormula':'loadDrawing';
  const h=harness(t,{mode:kind==='formula'?'formula':'basic',[option]:()=>loading.promise}),ready=h.mount();
  h.dispose();h.q('.dashboard').innerHTML='<h1>另一账户的页面</h1>';
  loading.resolve(h.modules[kind]);assert.equal(await ready,null);
  assert.equal(h.calls.mounts.length,0);assert.equal(h.q('.dashboard').textContent,'另一账户的页面');
 });

 test(kind+' module resolution respects a changed account draft scope',async t=>{
  const loading=deferred(),option=kind==='formula'?'loadFormula':'loadDrawing';
  const alice={id:'alice-formula',tool:'research',formula:'a+b',requirements:'Alice 的公式说明'};
  const h=harness(t,{mode:kind==='formula'?'formula':'basic',drafts:kind==='formula'?[alice]:[],ownerId:'alice',[option]:()=>loading.promise});
  const ready=h.mount(kind==='formula'?alice.id:undefined),oldHost=h.q('[data-research-'+kind+'-host]');
  assert.ok(oldHost);state.beginDraftScope({ownerId:'bob',drafts:[]});
  loading.resolve(h.modules[kind]);assert.equal(await ready,null);
  assert.equal(h.calls.mounts.length,0);assert.equal(oldHost.querySelector('[data-mounted-studio]'),null);
 });

 test(kind+' module resolution cannot use a replaced host that remains connected outside its owning dashboard',async t=>{
  const loading=deferred(),option=kind==='formula'?'loadFormula':'loadDrawing';
  const h=harness(t,{mode:kind==='formula'?'formula':'basic',[option]:()=>loading.promise}),ready=h.mount();
  const original=h.q('[data-research-'+kind+'-host]'),replacement=h.w.document.createElement('div');
  replacement.setAttribute('data-research-'+kind+'-host','');replacement.textContent='新的编辑器容器';
  original.replaceWith(replacement);h.w.document.body.append(original);assert.equal(original.isConnected,true);
  loading.resolve(h.modules[kind]);assert.equal(await ready,null);
  assert.equal(h.calls.mounts.length,0);assert.equal(replacement.textContent,'新的编辑器容器');
 });
}

test('a delayed account formula mount returns its lifecycle and preserves its formula, identifier and requirements',async t=>{
 const loading=deferred(),draft={id:'account-formula',tool:'research',formula:String.raw`E=mc^2+\alpha`,requirements:'保留原始量纲与符号说明'};
 const h=harness(t,{drafts:[draft],ownerId:'alice',loadFormula:()=>loading.promise}),ready=h.mount(draft.id);
 assert.equal(typeof ready.then,'function');assert.equal(h.w.lifecycle.researchRouteGuard(),true);
 loading.resolve(h.modules.formula);const lifecycle=await ready,mount=h.calls.mounts[0];
 assert.equal(lifecycle,mount.lifecycle);assert.equal(mount.options.initialFormula,draft.formula);
 assert.equal(mount.options.initialId,draft.id);assert.equal(mount.options.initialRequirements,draft.requirements);
 const changed={formula:String.raw`E=mc^2+\beta`,formulaId:draft.id,requirements:'修改后的符号说明'};
 mount.options.onChange(changed);h.click('[data-mode="data"]');h.click('[data-mode="formula"]');
 assert.equal(h.calls.formulaLoads,1);assert.equal(h.calls.mounts.length,2);
 assert.equal(h.calls.mounts[1].options.initialFormula,changed.formula);
 assert.equal(h.calls.mounts[1].options.initialId,changed.formulaId);
 assert.equal(h.calls.mounts[1].options.initialRequirements,changed.requirements);
});

test('a stale rejected load after navigation cannot add a retry panel to the current view',async t=>{
 const loading=deferred(),h=harness(t,{loadFormula:()=>loading.promise}),ready=h.mount();
 h.click('[data-mode="data"]');const table=h.q('.research-table');
 loading.reject(Error('Late download failure'));assert.equal(await ready,null);
 assert.equal(h.q('.research-table'),table);assert.equal(h.q('[data-research-studio-retry]'),null);assert.equal(h.calls.mounts.length,0);
});


test('clean research navigation and disposal avoid synchronously writing unchanged session data',async t=>{
 const h=harness(t,{mode:'data'});h.mount();let writes=0;const original=h.w.Storage.prototype.setItem;
 h.w.Storage.prototype.setItem=function(key,value){if(key===deliveryModel.researchSessionKey)writes++;return original.call(this,key,value);};
 assert.equal(h.w.lifecycle.researchRouteGuard(),true);assert.equal(h.w.lifecycle.researchRouteGuard(),true);h.dispose();assert.equal(writes,0);
});
test('research changes persist once and identical formula disposal callbacks do not rewrite the session',async t=>{
 const h=harness(t,{mode:'formula'});await h.mount();let writes=0;const original=h.w.Storage.prototype.setItem;
 h.w.Storage.prototype.setItem=function(key,value){if(key===deliveryModel.researchSessionKey)writes++;return original.call(this,key,value);};
 const change={formula:'x=17',formulaId:'existing-formula',requirements:'保留单位与定义'};h.calls.mounts[0].options.onChange(change);assert.equal(writes,1);
 assert.equal(h.w.lifecycle.researchRouteGuard(),true);h.calls.mounts[0].options.onChange({...change});h.dispose();assert.equal(writes,1);assert.equal(JSON.parse(h.w.localStorage.getItem(deliveryModel.researchSessionKey)).formula,'x=17');
});
test('research recovery commands are persisted even without visible input changes, and failures block leaving until recovery succeeds',async t=>{
 const h=harness(t,{mode:'data'});h.mount();h.click('[data-action="chart-generate"]');await flush();const panel=h.calls.toolPanels[0];assert.ok(panel);
 let writes=0,fail=false;const original=h.w.Storage.prototype.setItem;
 h.w.Storage.prototype.setItem=function(key,value){if(key===deliveryModel.researchSessionKey){writes++;if(fail)throw Error('synthetic session quota');}return original.call(this,key,value);};
 const before={ownerId:'alice',commandKey:'command-one',snapshot:{title:'Frozen research table'},itemId:'existing-task'};panel.setState(before);assert.equal(writes,1);panel.setState({...before});assert.equal(writes,1);
 fail=true;const next={...before,commandKey:'command-two',resumeFromJobId:'existing-task'};assert.throws(()=>panel.setState(next),/未能保存任务草稿/);assert.equal(!!h.w.lifecycle.researchHasWork(),true);assert.equal(h.w.lifecycle.researchRouteGuard(),false);
 fail=false;assert.equal(h.w.lifecycle.researchRouteGuard(),true);const after=JSON.parse(h.w.localStorage.getItem(deliveryModel.researchSessionKey));assert.deepEqual(after.jobStates.data,next);const settled=writes;h.dispose();assert.equal(writes,settled);
});
