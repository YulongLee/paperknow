import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {validatePaper,literatureTypes,selectLiterature,mergeLiteratureBackup,literatureKey} from '../dist/workspace/literature-model.mjs';
import {availableLiteratureGroups,changeLiteratureGroup,saveLiteratureGroups,literatureGroupsKey} from '../dist/workspace/literature-groups.mjs';
import {mountLiterature,mountLiteratureReader} from '../dist/workspace/literature.mjs';
import {clearEditor} from '../dist/workspace/edit-guard.mjs';
const base=()=>({id:'p1',title:'Saved paper',scope:'metadata',text:'',tags:[],notes:[],authors:'Author A;Author B',year:'2025'});
const journal=()=>({...base(),documentType:'journal',journal:'Actual journal',publisher:'Actual publisher',abstract:'An actual supplied abstract.',keywords:'first；second;first',publicationSource:'User supplied index',volume:'12',issue:'3',pages:'45-59',group:'Methods'});
class Storage{constructor(){this.rows=new Map();this.fail=null;}getItem(key){return this.rows.get(key)??null;}setItem(key,value){if(this.fail===key){this.fail=null;throw Error('quota');}this.rows.set(key,value);}removeItem(key){this.rows.delete(key);}}
function setup(t){const dom=new JSDOM('<main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://audit.test/workspace.html#category/literature'}),w=dom.window,names=['window','document','localStorage','FormData','location','AbortController','DOMParser','XMLSerializer','MutationObserver'],before=Object.fromEntries(names.map(key=>[key,globalThis[key]]));for(const key of names)globalThis[key]=key==='window'?w:w[key];w.HTMLElement.prototype.scrollIntoView=()=>{};w.confirm=()=>true;w.document.querySelector('dialog').close=()=>{};const $=s=>w.document.querySelector(s),notices=[],ctx={notify:msg=>notices.push(msg),modal:(_,html)=>{$('#workspace-dialog-body').innerHTML=html;}};t.after(()=>{clearEditor();Object.assign(globalThis,before);w.close();});return{w,$,ctx,notices};}

test('nine comparison types and three declared extensions retain metadata without treating abstracts as full text',()=>{
 assert.equal(Object.keys(literatureTypes).length,12);for(const documentType of Object.keys(literatureTypes)){const p=validatePaper({...journal(),documentType});assert.equal(p.documentType,documentType);assert.deepEqual(p.keywords,['first','second']);assert.equal(p.abstract,'An actual supplied abstract.');assert.equal(p.scope,'metadata');assert.equal(p.text,'');assert.equal(p.pages,'45-59');assert.equal(p.group,'Methods');}
});
test('legacy metadata and arXiv preprint type survive bibliography normalization',()=>{
 const legacy=validatePaper(base());assert.equal(legacy.documentType,'generic');assert.equal(legacy.group,'');assert.deepEqual(legacy.keywords,[]);
 const arxiv=validatePaper({...base(),source:'arxiv',type:'preprint',arxivId:'2610.12345v2'});assert.equal(arxiv.type,'preprint');assert.equal(arxiv.documentType,'generic');assert.match(arxiv.fullTextUrl,/arxiv.org\/pdf\/2610.12345v2/);
});
test('new bibliography fields reject invalid or overlong data rather than cropping it',()=>{
 for(const change of [{documentType:'invented'},{journal:'x'.repeat(501)},{publisher:'x'.repeat(501)},{abstract:'x'.repeat(20001)},{publicationSource:'x'.repeat(301)},{volume:'x'.repeat(101)},{issue:'x'.repeat(101)},{pages:'x'.repeat(101)},{group:'x'.repeat(81)},{keywords:Array.from({length:21},(_,i)=>'word'+i)},{keywords:['x'.repeat(81)]},{keywords:[{}]}])assert.throws(()=>validatePaper({...journal(),...change}));
});
test('group and bibliographic search combine with existing project, status and tag filters',()=>{
 const p=validatePaper({...journal(),projectId:'project1',tags:['tag1'],status:'reading'}),other=validatePaper({...base(),id:'p2'});
 assert.deepEqual(selectLiterature([p,other],{group:'group:Methods',query:'actual journal',project:'project1',tag:'tag1',status:'reading'}).map(p=>p.id),['p1']);assert.equal(selectLiterature([p,other],{group:'none'})[0].id,'p2');assert.equal(selectLiterature([p,other],{query:'second'})[0].id,'p1');
});
test('group rename and removal never remove papers or mutate their notes and source text',()=>{
 const p=validatePaper({...journal(),scope:'full',text:'A complete source paragraph.',notes:[{id:'n1',text:'Saved note'}]}),before=structuredClone(p),renamed=changeLiteratureGroup([p],['Methods'],{action:'rename',previous:'Methods',name:'Evidence'});
 assert.equal(renamed.papers[0].group,'Evidence');assert.equal(p.group,'Methods');const removed=changeLiteratureGroup(renamed.papers,renamed.groups,{action:'remove',previous:'Evidence'});assert.equal(removed.papers.length,1);assert.equal(removed.papers[0].group,'');assert.deepEqual({...removed.papers[0],group:'Methods'},before);assert.throws(()=>changeLiteratureGroup([p],['Methods','Other'],{action:'rename',previous:'Methods',name:'Other'}));
});
test('failed group persistence rolls back both local keys',()=>{
 const storage=new Storage(),before={papers:[validatePaper(journal())],groups:['Methods']};saveLiteratureGroups(before,{storage});const original=new Map(storage.rows),next=changeLiteratureGroup(before.papers,before.groups,{action:'rename',previous:'Methods',name:'Changed'});storage.fail=literatureGroupsKey;assert.throws(()=>saveLiteratureGroups(next,{storage}),/quota/);assert.deepEqual(storage.rows,original);
});
test('bibliography and empty groups survive document backup while legacy workspace papers recover their groups',()=>{
 const p=validatePaper(journal()),backup={format:'paperknow-literature-backup',version:1,papers:[p],groups:['Methods','Empty group']},merged=mergeLiteratureBackup([],backup,['Existing']);assert.deepEqual(merged.papers,[p]);assert.deepEqual(merged.groups,['Existing','Methods','Empty group']);
 const storage=new Storage();assert.deepEqual(availableLiteratureGroups([p],storage),['Methods']);saveLiteratureGroups(merged,{storage});assert.deepEqual(availableLiteratureGroups(merged.papers,storage),merged.groups);assert.throws(()=>mergeLiteratureBackup([],{...backup,groups:['x'.repeat(81)]}));
});
test('bibliographic form saves all visible fields and preserves metadata-only scope',t=>{
 const f=setup(t);mountLiterature(f.ctx);f.$('[data-lit-add]').click();assert.equal(f.$('#lit-documentType').options.length,12);assert.equal(f.$('#lit-journal-fields').hidden,true);
 for(const [key,value]of Object.entries({...journal(),title:'A journal item',keywords:'first；second'})){const input=f.$('#lit-'+key);if(input)input.value=value;}
 f.$('#lit-documentType').value='journal';f.$('#lit-documentType').dispatchEvent(new f.w.Event('change',{bubbles:true}));f.$('#lit-group-input').value='Methods';assert.equal(f.$('#lit-journal-fields').hidden,false);f.$('#lit-form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));
 const saved=JSON.parse(localStorage.getItem(literatureKey))[0];assert.equal(saved.documentType,'journal');assert.equal(saved.journal,'Actual journal');assert.equal(saved.publisher,'Actual publisher');assert.equal(saved.abstract,'An actual supplied abstract.');assert.deepEqual(saved.keywords,['first','second']);assert.equal(saved.volume,'12');assert.equal(saved.issue,'3');assert.equal(saved.pages,'45-59');assert.equal(saved.group,'Methods');assert.equal(saved.scope,'metadata');assert.equal(saved.text,'');
 mountLiteratureReader(saved.id,f.ctx);assert.match(f.$('.lit-source-info').textContent,/Actual journal/);assert.match(f.$('.lit-database-abstract').textContent,/An actual supplied abstract/);assert.equal(f.$('[data-lit-ai-open]'),null);
});
test('group management creates, renames and removes only associations through real UI',t=>{
 const f=setup(t),p=validatePaper(journal());localStorage.setItem(literatureKey,JSON.stringify([p]));mountLiterature(f.ctx);f.$('[data-lit-groups]').click();f.$('#lit-group-name').value='Empty group';f.$('#lit-group-form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));assert.ok(availableLiteratureGroups([p]).includes('Empty group'));
 f.$('[data-lit-group-edit="Methods"]').click();f.$('#lit-group-name').value='Evidence';f.$('#lit-group-form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(JSON.parse(localStorage.getItem(literatureKey))[0].group,'Evidence');f.$('[data-lit-group-remove="Evidence"]').click();const rows=JSON.parse(localStorage.getItem(literatureKey));assert.equal(rows.length,1);assert.equal(rows[0].group,'');assert.equal(rows[0].title,p.title);assert.deepEqual(rows[0].notes,p.notes);
});
test('citation selection follows visible filters and does not retain hidden papers',t=>{
 const f=setup(t);localStorage.setItem(literatureKey,JSON.stringify([validatePaper(journal()),validatePaper({...base(),id:'p2',title:'Other'})]));mountLiterature(f.ctx);const all=f.$('#lit-select-all');all.checked=true;all.dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(f.$('[data-lit-citations]').disabled,false);assert.match(f.$('#lit-selection-count').textContent,/2/);
 f.$('#lit-group').value='group:Methods';f.$('#lit-group').dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(f.w.document.querySelectorAll('[data-lit-select]').length,1);assert.match(f.$('#lit-selection-count').textContent,/1/);f.$('#lit-group').value='none';f.$('#lit-group').dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(f.$('[data-lit-citations]').disabled,true);assert.equal(f.$('#lit-selection-count').textContent,'');
});

test('actual library citation hooks preview seven formats and download only after an explicit click',async t=>{
 const f=setup(t),originalFetch=globalThis.fetch,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL,originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),files=[],blobs=new Map(),copied=[],requests=[];
 globalThis.fetch=async path=>{requests.push(path);assert.equal(path,'/api/auth/me');return Response.json({user:null});};
 URL.createObjectURL=blob=>{const url='blob:audit-'+blobs.size;blobs.set(url,blob);return url;};URL.revokeObjectURL=()=>{};
 f.w.HTMLAnchorElement.prototype.click=function(){files.push({name:this.download,blob:blobs.get(this.href)});};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>copied.push(text)}}});
 t.after(()=>{globalThis.fetch=originalFetch;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;});
 const p=validatePaper({...journal(),scope:'full',text:'Private original body must not enter citation export.',notes:[{id:'n1',text:'Private note must not enter citation export.'}]});localStorage.setItem(literatureKey,JSON.stringify([p]));mountLiterature(f.ctx);
 // The prior test deliberately ended with an unmatched filter; reset the real UI.
 f.$('#lit-group').value='all';f.$('#lit-group').dispatchEvent(new f.w.Event('change',{bubbles:true}));f.$('[data-lit-citation]').click();
 const until=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.fail('Citation UI did not settle');};await until(()=>!!f.$('[data-lc-preview]'));
 assert.equal(f.$('[data-lc-style]').options.length,7);assert.equal(files.length,0);assert.equal(requests.length,0);
 for(const style of ['gbt','apa','mla','ieee','vancouver','bibtex','ris']){const select=f.$('[data-lc-style]');select.value=style;select.dispatchEvent(new f.w.Event('change',{bubbles:true}));const text=f.$('[data-lc-preview]').value;assert.ok(text.includes('Saved paper'));assert.ok(!text.includes('Private original body'));assert.ok(!text.includes('Private note'));const before=files.length;f.$('[data-lc-download]').click();await until(()=>files.length===before+1);assert.equal(files.at(-1).name,'references-'+style+'.'+(style==='bibtex'?'bib':style==='ris'?'ris':'txt'));assert.equal(await files.at(-1).blob.text(),text);await until(()=>!f.$('[data-lc-copy]').disabled);}
 f.$('[data-lc-copy]').click();await until(()=>copied.length===1);assert.equal(copied[0],f.$('[data-lc-preview]').value);assert.equal(requests.length,7);
});
