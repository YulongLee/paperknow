import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import * as directory from '../dist/workspace/project-directory.mjs';
import {beginDraftScope,endDraftScope,keys,list} from '../dist/workspace/state.mjs';
import {clearEditor,flushEditorDraft} from '../dist/workspace/edit-guard.mjs';
import {repository} from '../dist/precheck/store.mjs';
import {validatePaper,literatureKey} from '../dist/workspace/literature-model.mjs';
import {mountLiterature} from '../dist/workspace/literature.mjs';
import {mountTool} from '../dist/workspace/tools.mjs';

// Detection owns browser event listeners at import time, as it does in the app.
const bootstrap=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.test/workspace.html'});
globalThis.window=bootstrap.window;globalThis.document=bootstrap.window.document;
const {mountDetection}=await import('../dist/workspace/detection.mjs');
bootstrap.window.close();
const body='这是用户自行提供的真实研究记录，核对研究方法和证据来源，保留原始文本并正确注明实际参考材料。';
const settle=async check=>{for(let n=0;n<100;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,3));}assert.fail('project selection did not settle');};
function fixture(t,{hash='#category/literature'}={}){
 const dom=new JSDOM('<aside class="sidebar"></aside><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.test/workspace.html'+hash,pretendToBeVisual:true}),w=dom.window;
 const names=['window','document','localStorage','FormData','location','AbortController','MutationObserver','fetch'],previous=new Map(names.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const key of names.filter(key=>key!=='fetch'))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='window'?w:w[key]});
 const calls=[],notices=[],store={sources:[],reports:[]},oldRepository={...repository};
 globalThis.fetch=async(path,options={})=>{calls.push({path,options});assert.equal(path,'/api/projects');assert.equal(options.method||'GET','GET');return {ok:true,status:200,json:async()=>({items:[{id:'p1',title:'云端研究项目'}]})};};
 repository.all=async key=>structuredClone(store[key]);repository.save=async(key,item)=>{store[key].push(structuredClone(item));};
 w.confirm=()=>true;w.document.querySelector('dialog').close=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 const $=selector=>w.document.querySelector(selector),ctx={notify:message=>notices.push(message),modal:(_,html)=>{$('#workspace-dialog-body').innerHTML=html;}};
 endDraftScope();directory.setProjectDirectorySession({id:'alice'});directory.updateAccountProjects('alice',[{id:'p1',title:'云端研究项目'}]);
 w.localStorage.setItem(keys.projects,JSON.stringify([{id:'p1',name:'不能混入的同名本地项目'},{id:'legacy',name:'历史本地项目'}]));
 const dispose=directory.installProjectPickers(w.document.body);
 t.after(()=>{clearEditor();endDraftScope();dispose();directory.setProjectDirectorySession(null);Object.assign(repository,oldRepository);w.close();for(const[key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 const input=(selector,value,type='input')=>{const node=$(selector);node.value=value;node.dispatchEvent(new w.Event(type,{bubbles:true}));};
 const submit=selector=>$(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 return {w,$,ctx,calls,notices,store,input,submit,ref:directory.projectReference('alice','p1')};
}

test('literature cloud-project filters, name refresh and edits retain the exact owner reference',async t=>{
 const f=fixture(t),paper=(id,title,projectId)=>validatePaper({id,title,scope:'full',text:body,projectId,tags:[],notes:[]});
 localStorage.setItem(literatureKey,JSON.stringify([paper('linked','云端关联文献',f.ref),paper('legacy-paper','历史关联文献','legacy')]));
 mountLiterature(f.ctx);await settle(()=>!!f.$('#lit-project option[value="account:alice:p1"]'));
 assert.deepEqual([...f.$('#lit-project').options].map(option=>option.value),['all','none',f.ref]);assert.equal(f.$('#lit-project optgroup'),null);
 f.input('#lit-project',f.ref,'change');assert.equal(f.w.document.querySelectorAll('[data-lit-select]').length,1);assert.match(f.$('#lit-rows').textContent,/云端关联文献/);
 directory.updateAccountProjects('alice',[{id:'p1',title:'重命名后的研究项目'}]);assert.match(f.$('#lit-rows').textContent,/重命名后的研究项目/);
 f.$('[data-lit-edit="linked"]').click();await settle(()=>f.$('#lit-association')?.value===f.ref);f.input('#lit-title','编辑后的文献');f.submit('#lit-form');
 assert.equal(JSON.parse(localStorage.getItem(literatureKey)).find(p=>p.id==='linked').projectId,f.ref);
 f.input('#lit-project','all','change');f.$('[data-lit-edit="legacy-paper"]').click();await settle(()=>f.$('#lit-association')?.selectedOptions[0]?.disabled);
 assert.equal(f.$('#lit-association').value,'legacy');assert.match(f.$('#lit-association').nextElementSibling.textContent,/历史项目/);
 f.input('#lit-title','保留旧关联的文献');f.submit('#lit-form');assert.equal(JSON.parse(localStorage.getItem(literatureKey)).find(p=>p.id==='legacy-paper').projectId,'legacy');
 assert.ok(f.calls.every(call=>(call.options.method||'GET')==='GET'),'local literature edits do not create cloud records');
});

test('local comparison persists the cloud reference through redraw and filters the saved report by it',async t=>{
 const f=fixture(t,{hash:'#category/detection?view=local'});f.store.sources=[{id:'actual-source',kind:'user',title:'实际对照材料',text:body,authors:[],provider:'用户材料'}];
 await mountDetection(f.ctx);await settle(()=>!!f.$('#det-project option[value="account:alice:p1"]'));
 f.input('#det-title','所属项目复用测试');f.input('#det-project',f.ref,'change');f.$('[data-det-action="paste"]').click();f.input('#det-paste',body);f.submit('#det-paste-form');
 assert.equal(f.$('#det-project').value,f.ref);f.$('#det-next').click();f.$('#det-next').click();await settle(()=>f.store.reports.length===1);
 assert.equal(f.store.reports[0].projectId,f.ref);assert.equal(JSON.parse(localStorage.getItem('paperknow-local-comparison-draft-v1')).input.projectId,f.ref);
 f.input('#det-history-project',f.ref,'change');assert.match(f.$('#det-history-rows').textContent,/所属项目复用测试/);
 directory.updateAccountProjects('alice',[{id:'p1',title:'云端改名后项目'}]);assert.match(f.$('#det-history-rows').textContent,/云端改名后项目/);
 assert.deepEqual([...f.$('#det-history-project').options].map(option=>option.value),['all','none',f.ref]);assert.ok(f.calls.every(call=>(call.options.method||'GET')==='GET'));
});

test('generic tool drafts preserve encoded cloud associations and fixed account draft-scope IDs',async t=>{
 const f=fixture(t,{hash:'#tool/translation'});mountTool('translation',undefined,undefined,f.ctx);await settle(()=>!!f.$('#integrated-project option[value="account:alice:p1"]'));
 f.input('#integrated-project',f.ref,'change');f.input('#integrated-title','归属保留测试');f.input('#integrated-text','用户填写的材料');assert.equal(flushEditorDraft(),true);
 const saved=JSON.parse(localStorage.getItem(keys.drafts))[0];assert.equal(saved.projectId,f.ref);
 clearEditor();mountTool('translation',saved.id,undefined,f.ctx);assert.equal(f.$('#integrated-project').value,f.ref);
 const legacy={...saved,id:'old-draft',projectId:'p1'};localStorage.setItem(keys.drafts,JSON.stringify([legacy]));clearEditor();mountTool('translation',legacy.id,undefined,f.ctx);
 assert.equal(f.$('#integrated-project').value,'p1');assert.equal(f.$('#integrated-project').selectedOptions[0].disabled,true);assert.equal(flushEditorDraft(),true);assert.equal(JSON.parse(localStorage.getItem(keys.drafts))[0].projectId,'p1');
 clearEditor();const before=localStorage.getItem(keys.drafts);beginDraftScope({ownerId:'alice',projectRows:[{id:'scoped-project',name:'固定归属项目'}]});mountTool('translation',undefined,'scoped-project',f.ctx);
 assert.equal(f.$('#integrated-project').value,'scoped-project');f.input('#integrated-text','账户适配器中的原始材料');assert.equal(flushEditorDraft(),true);assert.equal(list(keys.drafts)[0].projectId,'scoped-project');assert.equal(localStorage.getItem(keys.drafts),before);
});
