import {thesisResearchText,confirmThesisMaterials} from './helpers/thesis-flow.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {normalizeThesisSnapshot,thesisPlan} from '../backend/thesis-model.mjs';
import {thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(source='crossref',abstract='An abstract is not a full text.'){
 const dom=new JSDOM('<aside class="sidebar"></aside><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://example.test/workspace.html#tool/writing'});
 const previousFetch=globalThis.fetch,calls=[];for(const k of ['window','document','localStorage','FormData','location','AbortController'])globalThis[k]=dom.window[k];
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{};const $=s=>document.querySelector(s);
 const dialog=$('dialog');dialog.close=()=>{dialog.removeAttribute('open');dialog.dispatchEvent(new window.Event('close'));};
 globalThis.fetch=async(url,options)=>{if(url==='/api/capabilities')return {ok:true,status:200,json:async()=>({academicSearchSources:['aminer','arxiv'].includes(source)?['crossref','europepmc',source]:['crossref','europepmc']})};calls.push({url,options});assert.match(url,/^\/api\/literature\/search\?/);return {ok:true,status:200,json:async()=>({items:[{id:source+':fixture',source,sourceId:source==='aminer'?'507f1f77bcf86cd799439011':source==='arxiv'?'2610.12345':'10.1234/fixture',title:'Public metadata fixture',authors:'Test Author',year:2024,doi:source==='arxiv'?'':'10.1234/fixture',...(source==='arxiv'?{arxivId:'2610.12345v2',publishedDate:'2026-10-18T09:30:00Z',updatedDate:'2026-10-19T10:00:00Z',categories:['cs.AI']}:{}),url:'https://doi.org/10.1234/fixture',abstract}],sources:[{id:source,status:'ok'}],partial:false})};};
 const ctx={notify(){},modal(_title,html){$('#workspace-dialog-body').innerHTML=html;dialog.setAttribute('open','');}};
 const input=(s,v)=>{$(s).value=v;$(s).dispatchEvent(new window.Event('input',{bubbles:true}));};
 return {dom,$,ctx,input,calls,close(){clearEditor();globalThis.fetch=previousFetch;dom.window.close();}};
}
const bootstrap=fixture();
const {mountWriting}=await import('../dist/workspace/writing.mjs');
const {clearEditor}=await import('../dist/workspace/edit-guard.mjs');
bootstrap.close();
for(const source of ['crossref','aminer','arxiv'])test(source+' reference actions import safe pending metadata, retain source attribution and survive explicit confirmation/save/reopen',async()=>{
 const f=fixture(source),label=source==='aminer'?'AMiner':source==='arxiv'?'arXiv':'Crossref';try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','graph neural networks');f.$('#writing-generate').click();confirmThesisMaterials();await settle();assert.equal(f.calls.length,0);
  f.$('[data-reference-mode="recommend"]').click();await settle();assert.equal(f.calls.length,1);assert.equal(new URL(f.calls[0].url,'https://example.test').searchParams.get('q'),'graph neural networks');
  const choice=f.$('[data-ref-select]');choice.checked=true;choice.dispatchEvent(new window.Event('change',{bubbles:true}));f.$('[data-ref-import]').click();await settle();f.$('[data-ref-done]').click();
  assert.ok(f.$('#writing-reference-list').textContent.includes(label+' · 在线题录，未读取全文'));f.$('#writing-save').click();let draft=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];
  assert.equal(draft.writingReferences.length,1);assert.equal(draft.writingReferences[0].confirmed,false);assert.equal(draft.writingReferences[0].text,'');assert.equal(draft.writingReferences[0].fullTextRead,false);if(source==='arxiv'){const row=draft.writingReferences[0];assert.equal(row.arxivId,'2610.12345v2');assert.equal(row.sourceId,'2610.12345');assert.equal(row.publishedDate,'2026-10-18T09:30:00.000Z');assert.equal(row.updatedDate,'2026-10-19T10:00:00.000Z');assert.equal(row.pdfUrl,'https://arxiv.org/pdf/2610.12345v2');assert.deepEqual(row.categories,['cs.AI']);}
  f.$('[data-reference-mode="search"]').click();await settle();assert.equal(f.calls.length,1,'opening search does not transmit query before submission');f.$('.wrs-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await settle();assert.equal(f.calls.length,2);assert.equal(f.$('[data-ref-select]').disabled,true,'same identifier cannot be added twice');f.$('[data-ref-done]').click();
  f.$('#writing-reference-confirm').click();await settle();f.$('#writing-save').click();draft=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];assert.equal(draft.workflowStage,4);assert.equal(draft.writingReferences[0].confirmed,true);
  const snapshot=thesisSnapshotFromDraft(draft);assert.ok(snapshot.references[0].sourceLabel.includes(label));assert.equal(snapshot.references[0].text,'');assert.equal(snapshot.materials.length,1);assert.equal(snapshot.materials[0].text,thesisResearchText);
  clearEditor();mountWriting(draft.id,undefined,f.ctx);f.$('[data-writing-step="3"]').click();await settle();assert.match(f.$('#writing-reference-list').textContent,/Public metadata fixture/);assert.match(f.$('#writing-reference-list').textContent,/未读取全文/);
 }finally{f.close();}
});

test('optional knowledge can be skipped and an explicitly adopted database abstract reaches thesis planning without uploads',async()=>{
 const abstract='【合成验收摘要】This source abstract describes classroom feedback, the stated research scope, the documented comparison and its limitations. Only the supplied abstract is available; the full text has not been read.',f=fixture('crossref',abstract);
 try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','classroom feedback');f.$('#writing-generate').click();f.$('#writing-material-skip').click();await settle();
  assert.equal(f.$('.dashboard').dataset.writingStage,'3');assert.doesNotMatch(f.$('#writing-evidence-progress').textContent,/0\s*\/\s*100/);
  f.$('[data-reference-mode="recommend"]').click();await settle();const choice=f.$('[data-ref-select]');choice.checked=true;choice.dispatchEvent(new window.Event('change',{bubbles:true}));f.$('[data-ref-import]').click();await settle();f.$('[data-ref-done]').click();
  f.$('#writing-save').click();let saved=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];assert.equal(saved.writingReferences[0].text,'');assert.equal(saved.knowledgeFiles.length,0);
  const adopt=f.$('[data-reference-abstract]');assert.ok(adopt);f.$('.reference-evidence-preview').open=true;f.$('.reference-evidence-preview pre').scrollTop=27;adopt.click();await settle();saved=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];
  assert.equal(saved.writingReferences[0].text,abstract);assert.equal(saved.writingReferences[0].scope,'abstract');assert.equal(f.$('.reference-evidence-preview').open,true);assert.equal(f.$('.reference-evidence-preview pre').scrollTop,27);assert.equal(saved.writingReferences[0].confirmed,false);assert.equal(saved.writingReferences[0].fullTextRead,false);assert.match(saved.writingReferences[0].sourceLabel,/来源摘要，未读取全文/);assert.equal(f.$('[data-reference-abstract]'),null,'adopted content is not offered an overwrite action');
  f.$('#writing-reference-confirm').click();await settle();f.$('#writing-save').click();saved=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];assert.equal(saved.workflowStage,4);assert.equal(saved.writingReferences[0].confirmed,true);
  const snapshot=normalizeThesisSnapshot(thesisSnapshotFromDraft({...saved,outlineRows:[{id:'body',title:'第一章 文献背景',level:1,words:8000}]}));assert.equal(snapshot.materials.length,0);assert.equal(snapshot.references[0].text,abstract);assert.ok(thesisPlan(snapshot).length>0);
  clearEditor();mountWriting(saved.id,undefined,f.ctx);f.$('[data-writing-step="3"]').click();await settle();assert.match(f.$('#writing-reference-list').textContent,/已采用来源摘要/);assert.equal(f.$('[data-reference-abstract]'),null);assert.equal(f.calls.length,1,'adoption, confirmation and reopening never make a paid model call or repeat search');
 }finally{f.close();}
});
