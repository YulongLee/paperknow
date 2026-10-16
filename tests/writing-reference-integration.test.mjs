import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(){
 const dom=new JSDOM('<aside class="sidebar"></aside><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://example.test/workspace.html#tool/writing'});
 const previousFetch=globalThis.fetch,calls=[];for(const k of ['window','document','localStorage','FormData','location','AbortController'])globalThis[k]=dom.window[k];
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{};const $=s=>document.querySelector(s);
 const dialog=$('dialog');dialog.close=()=>{dialog.removeAttribute('open');dialog.dispatchEvent(new window.Event('close'));};
 globalThis.fetch=async(url,options)=>{calls.push({url,options});assert.match(url,/^\/api\/literature\/search\?/);return {ok:true,status:200,json:async()=>({items:[{id:'crossref:fixture',source:'crossref',sourceId:'10.1234/fixture',title:'Public metadata fixture',authors:'Test Author',year:2024,doi:'10.1234/fixture',url:'https://doi.org/10.1234/fixture',abstract:'An abstract is not a full text.'}],sources:[{id:'crossref',status:'ok'}],partial:false})};};
 const ctx={notify(){},modal(_title,html){$('#workspace-dialog-body').innerHTML=html;dialog.setAttribute('open','');}};
 const input=(s,v)=>{$(s).value=v;$(s).dispatchEvent(new window.Event('input',{bubbles:true}));};
 return {dom,$,ctx,input,calls,close(){clearEditor();globalThis.fetch=previousFetch;dom.window.close();}};
}
const bootstrap=fixture();
const {mountWriting}=await import('../dist/workspace/writing.mjs');
const {clearEditor}=await import('../dist/workspace/edit-guard.mjs');
bootstrap.close();
test('online reference actions import safe pending metadata, retain source attribution and survive explicit confirmation/save/reopen',async()=>{
 const f=fixture();try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','graph neural networks');f.$('#writing-generate').click();f.$('#writing-material-confirm').click();await settle();assert.equal(f.calls.length,0);
  f.$('[data-reference-mode="recommend"]').click();await settle();assert.equal(f.calls.length,1);assert.equal(new URL(f.calls[0].url,'https://example.test').searchParams.get('q'),'graph neural networks');
  const choice=f.$('[data-ref-select]');choice.checked=true;choice.dispatchEvent(new window.Event('change',{bubbles:true}));f.$('[data-ref-import]').click();await settle();f.$('[data-ref-done]').click();
  assert.match(f.$('#writing-reference-list').textContent,/Crossref · 在线题录，未读取全文/);f.$('#writing-save').click();let draft=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];
  assert.equal(draft.writingReferences.length,1);assert.equal(draft.writingReferences[0].confirmed,false);assert.equal(draft.writingReferences[0].text,'');assert.equal(draft.writingReferences[0].fullTextRead,false);
  f.$('[data-reference-mode="search"]').click();await settle();assert.equal(f.calls.length,1,'opening search does not transmit query before submission');f.$('.wrs-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await settle();assert.equal(f.calls.length,2);assert.equal(f.$('[data-ref-select]').disabled,true,'same DOI cannot be added twice');f.$('[data-ref-done]').click();
  f.$('#writing-reference-confirm').click();await settle();f.$('#writing-save').click();draft=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];assert.equal(draft.workflowStage,4);assert.equal(draft.writingReferences[0].confirmed,true);
  const snapshot=thesisSnapshotFromDraft(draft);assert.match(snapshot.references[0].sourceLabel,/Crossref/);assert.equal(snapshot.references[0].text,'');assert.equal(snapshot.materials.length,0);
  clearEditor();mountWriting(draft.id,undefined,f.ctx);f.$('[data-writing-step="3"]').click();await settle();assert.match(f.$('#writing-reference-list').textContent,/Public metadata fixture/);assert.match(f.$('#writing-reference-list').textContent,/未读取全文/);
 }finally{f.close();}
});
