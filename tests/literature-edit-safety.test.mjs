import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountLiterature,mountLiteratureReader} from '../dist/workspace/literature.mjs';
import {mountLiteratureAi} from '../dist/workspace/literature-ai.mjs';
import {validatePaper,literatureKey} from '../dist/workspace/literature-model.mjs';
import {requireReadingCitationCoverage,selectReadingMaterials} from '../dist/workspace/literature-ai-model.mjs';
import {clearEditor,editorHasWork,editorRouteGuard,flushEditorDraft} from '../dist/workspace/edit-guard.mjs';
import {createLiteratureAccountStore} from '../dist/workspace/literature-account-store.mjs';
import {list,stateStoreStatus} from '../dist/workspace/state.mjs';

const source='A complete source paragraph with verifiable information.';
test('an open literature form cannot save its original account content after the session switches',async t=>{const f=setup(t);let owner='alice',writes=0;const store=createLiteratureAccountStore({win:f.w,fetchImpl:async(_path,options)=>{if(options.method==='POST')writes++;return Response.json({ownerId:owner,entries:[],projectIds:[],fileIds:[]});}});t.after(()=>store.dispose());store.setUser({id:owner});for(let i=0;i<20&&stateStoreStatus(literatureKey)!=='ready';i++)await new Promise(r=>setTimeout(r,5));mountLiterature(f.ctx);f.$('[data-lit-add]').click();f.$('#lit-title').value='Private account A title';owner='bob';store.setUser({id:owner});for(let i=0;i<20&&stateStoreStatus(literatureKey)!=='ready';i++)await new Promise(r=>setTimeout(r,5));f.$('#lit-form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));assert.match(f.$('#lit-error').textContent,/账户已变化/);assert.equal(list(literatureKey).length,0);assert.equal(writes,0);});
function setup(t){
 const dom=new JSDOM('<main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://audit.test/workspace.html#category/literature'}),w=dom.window;
 const names=['window','document','localStorage','FormData','location','AbortController','DOMParser','XMLSerializer','MutationObserver','fetch'],before=Object.fromEntries(names.map(key=>[key,globalThis[key]]));
 for(const key of names.filter(key=>key!=='fetch'))globalThis[key]=key==='window'?w:w[key];
 const calls=[],notices=[];globalThis.fetch=async(...args)=>{calls.push(args);if(args[0]==='/api/payments/options'){assert.equal(args[1]?.method||'GET','GET');assert.equal(args[1]?.body,undefined);return Response.json({toolBilling:{services:[]}});}throw Error('Unexpected external request');};
 w.HTMLElement.prototype.scrollIntoView=()=>{};w.document.querySelector('dialog').close=()=>{};
 const $=s=>w.document.querySelector(s),ctx={notify:message=>notices.push(message),modal:(_,html)=>{$('#workspace-dialog-body').innerHTML=html;}};
 const input=(selector,value)=>{const el=$(selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const saved=()=>JSON.parse(w.localStorage.getItem(literatureKey))[0];
 const originalSet=w.Storage.prototype.setItem;
 t.after(()=>{clearEditor();w.Storage.prototype.setItem=originalSet;Object.assign(globalThis,before);w.close();});
 return {w,$,ctx,input,saved,calls,notices,originalSet};
}
function result(operation='read'){
 const materials=[{id:'p1',name:'paragraph 1',text:source}];
 return {id:'r1',jobId:'j1',operation,sourceScope:'full',materials,language:operation==='translate'?'en':'',output:operation==='translate'?{text:'Saved translation',targetLanguage:'en',sourceIds:[],segments:[{id:'p1',source,translation:'Saved translation'}]}:{text:'Saved reading result',sourceIds:['p1'],citations:[{sourceId:'p1',quote:'complete source paragraph'}]},createdAt:'2026-10-20'};
}
function seed(f,operation='read'){
 const p=validatePaper({id:'audit-paper',title:'Offline audit paper',scope:'full',text:source,tags:[],notes:[],aiResults:[result(operation)]});
 f.w.localStorage.setItem(literatureKey,JSON.stringify([p]));return p;
}
const until=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.fail('UI did not settle');};

test('late document extraction preserves in-flight manual text until explicit adoption',async t=>{
 const f=setup(t);mountLiterature(f.ctx);f.$('[data-lit-import]').click();let release;const pending=new Promise(resolve=>{release=resolve;});
 Object.defineProperty(f.$('#lit-upload'),'files',{value:[{name:'source.txt',size:40,text:()=>pending}]});
 f.$('#lit-upload').dispatchEvent(new f.w.Event('change',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.$('#lit-submit').disabled,true);f.input('#lit-text-input','Manual text typed during extraction');release('Imported complete source text');await until(()=>!f.$('#lit-submit').disabled);
 assert.equal(f.$('#lit-text-input').value,'Manual text typed during extraction');assert.equal(f.$('#lit-scope-input').value,'metadata');assert.ok(f.$('[data-lit-use-parsed]'));
 f.$('[data-lit-use-parsed]').click();assert.equal(f.$('#lit-text-input').value,'Imported complete source text');assert.equal(f.$('#lit-scope-input').value,'full');assert.equal(f.$('[data-lit-use-parsed]'),null);
 f.$('#lit-form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(f.saved().text,'Imported complete source text');assert.equal(f.saved().fileName,'source.txt');assert.equal(f.calls.length,0);
});

test('unchanged text still adopts an extracted document directly',async t=>{
 const f=setup(t);mountLiterature(f.ctx);f.$('[data-lit-import]').click();Object.defineProperty(f.$('#lit-upload'),'files',{value:[{name:'normal.txt',size:20,text:async()=>source}]});
 f.$('#lit-upload').dispatchEvent(new f.w.Event('change',{bubbles:true}));await until(()=>!f.$('#lit-submit').disabled);
 assert.equal(f.$('#lit-text-input').value,source);assert.equal(f.$('#lit-scope-input').value,'full');assert.equal(f.$('[data-lit-use-parsed]'),null);
});

test('failed reading edits survive redraw, block stale exports and guard navigation until retry saves',async t=>{
 const f=setup(t),p=seed(f);mountLiteratureReader(p.id,f.ctx);f.w.Storage.prototype.setItem=()=>{throw Error('quota');};
 f.input('[data-lit-ai-text]','Unsaved revised reading result');assert.equal(f.saved().aiResults[0].output.text,'Saved reading result');assert.equal(editorHasWork(),true);assert.equal(f.$('[data-lit-ai-save]').hidden,false);
 f.$('[data-lit-ai-operation="answer"]').click();f.$('[data-lit-ai-operation="read"]').click();assert.equal(f.$('[data-lit-ai-text]').value,'Unsaved revised reading result');
 assert.equal(editorRouteGuard('#home'),false);assert.ok(f.$('#editor-save-leave'));
 f.$('#lit-ai-r1-docx').click();assert.match(f.$('#lit-ai-r1-status').textContent,/停止导出旧内容/);
 f.$('[data-lit-ai-export]').click();await new Promise(resolve=>setImmediate(resolve));assert.ok(f.notices.some(message=>/停止导出旧内容/.test(message)));assert.equal(f.calls.filter(([url])=>url!=='/api/payments/options').length,0);
 f.w.Storage.prototype.setItem=f.originalSet;f.$('[data-lit-ai-save]').click();assert.equal(f.$('[data-lit-ai-save]').hidden,true);assert.equal(flushEditorDraft(),true);assert.equal(f.saved().aiResults[0].output.text,'Unsaved revised reading result');assert.equal(f.saved().aiResults[0].materials[0].text,source);assert.equal(editorHasWork(),false);assert.equal(editorRouteGuard('#home'),true);
});

test('saving a separate note cannot mark a failed translation edit as durable',t=>{
 const f=setup(t),p=seed(f,'translate');mountLiteratureReader(p.id,f.ctx,'translation');
 f.w.Storage.prototype.setItem=function(key,value){if(key===literatureKey&&JSON.parse(value)[0].aiResults[0].output.segments[0].translation!=='Saved translation')throw Error('quota for revised result');return f.originalSet.call(this,key,value);};
 f.input('[data-lit-ai-segment="p1"]','Revised translation not yet saved');f.input('#note-text','A separately saved note');f.$('#lit-note-form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal(f.saved().notes[0].text,'A separately saved note');assert.equal(f.saved().aiResults[0].output.segments[0].translation,'Saved translation');assert.equal(editorHasWork(),true);assert.equal(editorRouteGuard('#home'),false);
 f.w.Storage.prototype.setItem=f.originalSet;assert.equal(flushEditorDraft(),true);assert.equal(f.saved().aiResults[0].output.segments[0].translation,'Revised translation not yet saved');assert.equal(f.saved().aiResults[0].output.segments[0].source,source);assert.equal(f.saved().notes[0].text,'A separately saved note');
});

test('empty revised results remain visibly pending instead of exporting their old saved text',t=>{
 const f=setup(t),p=seed(f);mountLiteratureReader(p.id,f.ctx);f.input('[data-lit-ai-text]','   ');
 assert.equal(editorHasWork(),true);assert.equal(flushEditorDraft(),false);assert.equal(f.saved().aiResults[0].output.text,'Saved reading result');assert.equal(editorRouteGuard('#home'),false);
 f.input('[data-lit-ai-text]','Corrected nonempty text');assert.equal(f.saved().aiResults[0].output.text,'Corrected nonempty text');assert.equal(flushEditorDraft(),true);
});

test('a valid long aggregate remains editable within the same saved-result limit',t=>{
 const f=setup(t),p=seed(f);p.aiResults[0].output.text='A'.repeat(12000);localStorage.setItem(literatureKey,JSON.stringify([p]));mountLiteratureReader(p.id,f.ctx);assert.equal(f.$('[data-lit-ai-text]').maxLength,100000);f.input('[data-lit-ai-text]',p.aiResults[0].output.text+' checked');assert.equal(f.saved().aiResults[0].output.text.length,12008);assert.equal(f.saved().aiResults[0].output.text.endsWith(' checked'),true);
});

test('reading admission checks quote feasibility for each actual unit rather than total input length',()=>{
 assert.throws(()=>requireReadingCitationCoverage([{text:'abc'}]),/至少 5 字符/);
 assert.throws(()=>requireReadingCitationCoverage(['a','b','c','d','e'].map(text=>({text}))),/至少 5 字符/);
 assert.doesNotThrow(()=>requireReadingCitationCoverage([{text:'12345'},{text:'abc'}]));
 assert.throws(()=>requireReadingCitationCoverage(['12345','a','b','c','d','e','f'].map(text=>({text}))),/至少 5 字符/);
 const materials=selectReadingMaterials({title:'Tail boundary',scope:'full',text:'x'.repeat(6000)+'\n\nabc'});assert.throws(()=>requireReadingCitationCoverage(materials),/至少 5 字符/);
});

test('short reading ranges are disabled before a quote while short translation remains available',async t=>{
 const f=setup(t);f.$('.dashboard').innerHTML='<div id="ai"></div>';let p={id:'short',title:'Short source',scope:'full',text:'abc\n\nA complete paragraph'};
 f.ctx.api=async(path,data)=>{if(path==='/auth/me')return {user:{id:'alice'}};if(path==='/tool-runs/quote-preview')return {type:'agent',source:'credits',title:'研读',creditCost:10,token:'test',expiresAt:new Date(Date.now()+60000).toISOString()};throw Error('Unexpected '+path);};const ui=mountLiteratureAi({container:f.$('#ai'),ctx:f.ctx,getPaper:()=>p,updatePaper:updater=>{p=updater(p);}});t.after(()=>ui.dispose());
 const waitPrice=async()=>{for(let i=0;i<800;i++){if(/本次消耗/.test(f.$('[data-lit-price]').textContent))return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('价格未就绪');};f.input('[data-lit-ai-end]','1');assert.equal(f.$('[data-lit-ai-open]').disabled,true);assert.match(f.$('[data-lit-ai-range-status]').textContent,/至少 5 字符/);
 f.$('[data-lit-ai-operation="translate"]').click();await waitPrice();assert.equal(f.$('[data-lit-ai-open]').disabled,false);
 f.$('[data-lit-ai-operation="read"]').click();assert.equal(f.$('[data-lit-ai-open]').disabled,true);f.input('[data-lit-ai-end]','2');await waitPrice();assert.equal(f.$('[data-lit-ai-open]').disabled,false);assert.equal(f.calls.filter(([url])=>url!=='/api/payments/options').length,0);
});

test('a citation clicked while viewing notes restores the original PDF pane before locating evidence',async t=>{
 const f=setup(t),p=seed(f);Object.assign(p,{fileName:'source.pdf',originalFileId:'owned-pdf',originalOwnerId:'alice'});localStorage.setItem(literatureKey,JSON.stringify([p]));mountLiteratureReader(p.id,f.ctx,'notes');
 assert.equal(f.$('#reader-pdf-pane').hidden,true);assert.equal(f.$('#reader-notes-pane').hidden,false);f.$('[data-lit-source]').click();await new Promise(r=>setImmediate(r));
 assert.equal(f.$('#reader-pdf-pane').hidden,false);assert.equal(f.$('#reader-notes-pane').hidden,true);assert.equal(f.$('[data-read-tab="pdf"]').classList.contains('active'),true);
});
