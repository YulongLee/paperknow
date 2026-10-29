import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountLiteratureLanding,mountLiteratureFeaturePage,readingFeatures,readingFeatureHref,disposeLiteraturePages} from '../dist/workspace/literature-pages.mjs';
import {mountLiteratureReader} from '../dist/workspace/literature.mjs';
import {literatureKey,validatePaper} from '../dist/workspace/literature-model.mjs';
import {clearEditor} from '../dist/workspace/edit-guard.mjs';
import {keepsWorkspacePosition} from '../dist/workspace/view-stability.mjs';
const material=(extra={})=>validatePaper({id:'paper-one',title:'An actual saved source <img src=x>',authors:'Original author',year:'2026',scope:'full',text:'An actual synthetic source paragraph with research methods and traceable results.',notes:[{id:'note-one',text:'Keep this private note.'}],...extra});
function fixture(t,kind='reading',papers=[material()]){
 const dom=new JSDOM('<div id="app"><main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog></div>',{url:'https://reading.test/workspace.html'+readingFeatureHref(kind)}),w=dom.window,before={};
 for(const key of ['window','document','localStorage','FormData','location','AbortController','DOMParser','XMLSerializer','MutationObserver','fetch']){before[key]=globalThis[key];globalThis[key]=key==='window'?w:key==='fetch'?async()=>{throw Error('Unexpected request');}:w[key];}
 w.HTMLElement.prototype.scrollIntoView=()=>{};const $=s=>w.document.querySelector(s),calls=[];w.document.querySelector('dialog').close=function(){this.open=false;};
 const ctx={notify:message=>calls.push({type:'notice',message}),modal:(title,html)=>{calls.push({type:'modal',title});$('#workspace-dialog-body').innerHTML=html;$('#workspace-dialog').open=true;}};
 w.localStorage.setItem(literatureKey,JSON.stringify(papers));t.after(()=>{disposeLiteraturePages();clearEditor();Object.assign(globalThis,before);w.close();});
 return {w,$,ctx,calls,papers:()=>JSON.parse(w.localStorage.getItem(literatureKey)),input(selector,value){const node=$(selector);node.value=value;node.dispatchEvent(new w.Event('input',{bubbles:true}));}};
}

test('reading home is a unified search and upload desk with direct saved-paper links',async t=>{
 const f=fixture(t);await mountLiteratureLanding(f.ctx).ready;assert.equal(f.$('h1').textContent,'文献研读');assert.ok(f.$('#ld-query'));assert.ok(f.$('[data-desk-upload]'));assert.equal(f.$('.lit-feature-grid'),null);assert.equal(f.$('[data-reading-workflow]'),null);assert.equal(f.$('.lit-desk-file>a').getAttribute('href'),'#literature/paper-one?tab=answer');assert.equal(f.calls.length,0);assert.deepEqual(f.papers(),[material()]);assert.equal(f.$('.lit-desk-file img'),null);
});

test('library is a distinct full page with management controls and a return to the reading home',t=>{
 const f=fixture(t,'library');mountLiteratureFeaturePage('library',f.ctx);assert.equal(f.$('h1').textContent,'我的文献');assert.equal(f.$('header.tool-banner').dataset.toolArt,'reading-library');assert.ok(f.$('#lit-library'));assert.ok(f.$('[data-lit-import]'));assert.equal(f.$('.lit-feature-grid'),null);assert.equal(f.$('.dashboard a[href="#category/literature"]').textContent,'返回文献研读');assert.equal(f.calls.length,0);
});

for(const [kind,tab,operation] of [['reading','text','read'],['answer','answer','answer'],['translation','translation','translate']])test(kind+' opens an explicit source page and the selected source enters its matching operation',t=>{
 const f=fixture(t,kind);mountLiteratureFeaturePage(kind,f.ctx);assert.equal(f.$('header.tool-banner').dataset.toolArt,'reading-'+kind);assert.equal(f.$('.dashboard').dataset.readingPage,kind);assert.equal(f.$('[data-reading-workflow]').dataset.currentStep,'1');assert.equal(f.calls.length,0);const link=f.$('.lit-source-picker-row a');assert.equal(link.getAttribute('href'),'#literature/paper-one?tab='+tab);assert.equal(f.$('img'),null);assert.equal(f.$('#workspace-dialog').open,false);
 const input=f.$('[data-reading-source-query]');input.focus();f.input('[data-reading-source-query]','not found');assert.equal(f.$('.lit-source-picker-row'),null);assert.equal(f.w.document.activeElement,input);f.input('[data-reading-source-query]','Original author');assert.ok(f.$('.lit-source-picker-row'));
 f.w.history.replaceState(null,'',link.getAttribute('href'));disposeLiteraturePages();mountLiteratureReader('paper-one',f.ctx,tab);assert.equal(f.$('[data-reading-workflow]').dataset.readingWorkflow,operation);assert.ok(f.$('.hub-heading-actions a[href="#category/literature"]'));assert.equal(f.papers()[0].text,material().text);assert.deepEqual(f.papers()[0].notes,material().notes);assert.equal(f.calls.some(c=>c.type==='modal'),false);
});

test('preparing a metadata-only source returns to the requesting page without losing notes',t=>{
 const f=fixture(t,'answer',[material({scope:'metadata',text:''})]);mountLiteratureFeaturePage('answer',f.ctx);assert.equal(f.$('.lit-source-picker-row a'),null);f.$('[data-reading-prepare]').click();f.input('#lit-text-input','A newly supplied actual original text for questions.');f.$('#lit-scope-input').value='full';f.$('#lit-form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(f.$('h1').textContent,'原文问答');assert.equal(f.$('#workspace-dialog').open,false);assert.ok(f.$('.lit-source-picker-row a[href$="tab=answer"]'));assert.equal(f.papers()[0].notes[0].text,'Keep this private note.');assert.equal(f.papers()[0].text,'A newly supplied actual original text for questions.');
});

test('source editing in a reader keeps the current operation and route',t=>{
 const f=fixture(t,'answer');f.w.history.replaceState(null,'','#literature/paper-one?tab=answer');mountLiteratureReader('paper-one',f.ctx,'answer');f.$('[data-lit-edit]').click();f.input('#lit-title','Corrected actual source title');f.$('#lit-form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(f.$('[data-reading-workflow]').dataset.readingWorkflow,'answer');assert.equal(f.$('#lit-library'),null);assert.equal(f.w.location.hash,'#literature/paper-one?tab=answer');assert.equal(f.papers()[0].title,'Corrected actual source title');assert.deepEqual(f.papers()[0].notes,material().notes);
});

test('retired review routes go to AI writing without creating or changing a draft or source',t=>{
 const f=fixture(t,'reading'),draft={id:'existing-summary',tool:'summary',title:'A saved review',text:'Saved original draft.'};f.w.localStorage.setItem('paperknow-drafts',JSON.stringify([draft]));f.w.history.replaceState(null,'','#category/literature?view=review');mountLiteratureFeaturePage('review',f.ctx);
 assert.equal(readingFeatureHref('review'),'#tool/summary');assert.equal(f.w.location.hash,'#tool/summary');assert.equal(f.$('#lit-review-bridge-form'),null);assert.deepEqual(JSON.parse(f.w.localStorage.getItem('paperknow-drafts')),[draft]);assert.deepEqual(f.papers(),[material()]);assert.equal(f.calls.length,0);
});

test('remaining source features can open after a retired review link',t=>{
 const f=fixture(t,'review');mountLiteratureFeaturePage('review',f.ctx);f.w.history.replaceState(null,'',readingFeatureHref('reading'));mountLiteratureFeaturePage('reading',f.ctx);assert.equal(f.$('h1').textContent,'文献研读');assert.ok(f.$('[data-reading-source-query]'));assert.equal(f.$('#lit-review-bridge-form'),null);
});

test('reading features reset page position independently and preserve filter changes within one feature',()=>{
 assert.equal(keepsWorkspacePosition('#category/literature',readingFeatureHref('library')),false);assert.equal(keepsWorkspacePosition(readingFeatureHref('reading'),readingFeatureHref('answer')),false);assert.equal(keepsWorkspacePosition(readingFeatureHref('translation'),readingFeatureHref('search')),false);assert.equal(keepsWorkspacePosition(readingFeatureHref('search')+'&q=one',readingFeatureHref('search')+'&q=two'),true);assert.equal(readingFeatureHref('unrecognized'),readingFeatureHref('library'));
});
