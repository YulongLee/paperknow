import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountLiteratureLanding,disposeLiteraturePages} from '../dist/workspace/literature-pages.mjs';
import {mountLiteratureReader,disposeLiterature} from '../dist/workspace/literature.mjs';
import {mountLiteratureOriginalPreview} from '../dist/workspace/literature-original-preview.mjs';
import {saveLiteratureOriginal} from '../dist/workspace/literature-upload.mjs';
import {literatureKey,validatePaper} from '../dist/workspace/literature-model.mjs';
import {clearEditor} from '../dist/workspace/edit-guard.mjs';
import {bindStoredFile} from '../dist/workspace/file-selection.mjs';
import {readingResultMarkup} from '../dist/workspace/literature-result-view.mjs';
import {readingHeadings} from '../dist/workspace/literature-reader-tools.mjs';

const source='A verified synthetic paragraph describes the research method and its observed evidence.\n\nA second synthetic paragraph explains the limitations and the scope of those observations.';
const paper=(extra={})=>validatePaper({id:'saved-paper',title:'Existing research <img src=x>',scope:'full',text:source,authors:'Original Author',year:'2026',notes:[{id:'note-one',text:'Keep my research note.'}],...extra});
const reply=(value,status=200)=>({ok:status<400,status,json:async()=>structuredClone(value)});
const until=async check=>{for(let n=0;n<150;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,3));}assert.fail('Reading desk did not settle');};
function fixture(t,{papers=[paper()],fetcher}={}){
 const dom=new JSDOM('<div id="app"><main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog></div>',{url:'https://reading.test/workspace.html#category/literature'}),w=dom.window,old={};
 for(const name of ['window','document','location','localStorage','FormData','AbortController','MutationObserver','DOMParser','XMLSerializer','fetch']){old[name]=globalThis[name];globalThis[name]=name==='window'?w:name==='fetch'?async()=>{throw Error('No external API allowed');}:w[name];}
 const calls=[],notices=[],jobs=new Map(),scrolls=[],$=s=>w.document.querySelector(s);
 w.HTMLElement.prototype.scrollIntoView=function(){scrolls.push(this.id);};$('dialog').close=function(){this.open=false;};
 const api=async(path,data)=>{calls.push({path,data});if(path==='/auth/me')return {user:{id:'owner'}};if(path==='/tool-runs/capabilities')return {ready:true};if(path==='/tool-runs/quote')return {type:'agent',source:'credits',title:'Reading',token:'quote-'+calls.length,creditCost:10,expiresAt:new Date(Date.now()+60000).toISOString()};if(path==='/tool-runs/jobs'){const materials=data.snapshot.materials,item={id:'job-'+jobs.size,kind:'literature',operation:data.operation,status:'completed',completedUnits:1,totalUnits:1,output:{text:'Verified answer grounded in the selected source.',sourceIds:materials.map(m=>m.id),citations:materials.map(m=>({sourceId:m.id,quote:m.text.slice(0,25)})),...(data.operation==='translate'?{targetLanguage:data.snapshot.language,segments:materials.map(m=>({id:m.id,source:m.text,translation:'A synthetic translation.'}))}:{})}};jobs.set(item.id,item);return {item};}if(path.startsWith('/tool-runs/jobs/'))return {item:jobs.get(path.split('/').at(-1))};throw Error('Unexpected '+path);};
 const ctx={api,notify:message=>notices.push(message),modal:(_,html)=>{$('#workspace-dialog-body').innerHTML=html;$('dialog').open=true;}};
 const fetchImpl=async(url,init)=>{calls.push({url,init});return fetcher?fetcher(url,init):reply({academicSearchSources:['crossref']});};
 localStorage.setItem(literatureKey,JSON.stringify(papers));
 t.after(()=>{disposeLiteraturePages();disposeLiterature();clearEditor();Object.assign(globalThis,old);w.close();});
 return {w,$,ctx,calls,notices,jobs,scrolls,fetcher:fetchImpl,papers:()=>JSON.parse(localStorage.getItem(literatureKey)),input(selector,value){const node=$(selector);node.value=value;node.dispatchEvent(new w.Event('input',{bubbles:true}));}};
}

test('the entrance combines search, upload and saved papers without another operation picker or automatic AI task',async t=>{
 const f=fixture(t),ui=mountLiteratureLanding(f.ctx,{fetcher:f.fetcher});await ui.ready;
 assert.ok(f.$('#ld-query'));assert.ok(f.$('[data-desk-upload]'));assert.ok(f.$('[data-desk-cloud]'));assert.equal(f.$('.lit-feature-grid'),null);assert.equal(f.$('[data-reading-workflow]'),null);assert.equal(f.$('.lit-desk-file a').getAttribute('href'),'#literature/saved-paper?tab=answer');assert.equal(f.$('.lit-desk-file img'),null);assert.equal(f.calls.filter(c=>c.url?.includes('/literature/search')||c.path).length,0);
 const filter=f.$('[data-desk-filter]');filter.focus();f.input('[data-desk-filter]','missing');assert.equal(f.$('.lit-desk-file'),null);assert.equal(f.w.document.activeElement,filter);f.input('[data-desk-filter]','Original Author');assert.ok(f.$('.lit-desk-file'));assert.equal(f.papers()[0].notes[0].text,'Keep my research note.');
});

test('direct upload keeps existing notes, persists the verified original and opens its own reader exactly once',async t=>{
 const f=fixture(t);let release,reads=0,stores=0;const pending=new Promise(resolve=>release=resolve),file={name:'New research.txt',size:source.length};
 const ui=mountLiteratureLanding(f.ctx,{fetcher:f.fetcher,importDocument:async()=>{reads++;await pending;return {text:source,warnings:[]};},saveOriginal:async()=>{stores++;return {originalFileId:'original-id',originalOwnerId:'owner'};}});await ui.ready;
 const one=ui.upload(file),two=ui.upload(file);assert.equal(f.$('[data-desk-import]').hidden,false);assert.equal(f.$('[data-desk-upload]').disabled,true);release();await Promise.all([one,two]);
 assert.equal(reads,1);assert.equal(stores,1);assert.equal(f.papers().length,2);assert.equal(f.papers()[0].title,'New research');assert.equal(f.papers()[0].originalFileId,'original-id');assert.equal(f.papers()[0].text,source);assert.equal(f.papers()[1].notes[0].text,'Keep my research note.');assert.match(f.w.location.hash,/^#literature\/.+\?tab=answer$/);assert.equal(f.calls.some(c=>c.path),false);
});

test('leaving during import cannot append a late paper, and an original-save failure cannot create a phantom upload',async t=>{
 const f=fixture(t);let release,stores=0;const held=new Promise(resolve=>release=resolve),file={name:'Pending.txt',size:120};
 let ui=mountLiteratureLanding(f.ctx,{fetcher:f.fetcher,importDocument:async()=>{await held;return {text:source};},saveOriginal:async()=>{stores++;return {originalFileId:'id',originalOwnerId:'owner'};}});await ui.ready;const pending=ui.upload(file);f.w.history.replaceState(null,'','#home');ui.dispose();release();await pending;assert.equal(f.papers().length,1);assert.equal(stores,0);
 f.w.history.replaceState(null,'','#category/literature');ui=mountLiteratureLanding(f.ctx,{fetcher:f.fetcher,importDocument:async()=>({text:source}),saveOriginal:async()=>{throw Error('Original save failed');}});await ui.ready;await ui.upload(file);assert.equal(f.papers().length,1);assert.match(f.$('[data-desk-import-message]').textContent,/Original save failed/);assert.equal(f.$('[data-desk-upload]').disabled,false);
});

test('a slow original upload cannot overwrite a different tab’s newer literature or notes',async t=>{
 const f=fixture(t);let release,started=false;const pending=new Promise(resolve=>release=resolve);
 const ui=mountLiteratureLanding(f.ctx,{fetcher:f.fetcher,importDocument:async()=>({text:source}),saveOriginal:async()=>{started=true;await pending;return {originalFileId:'new-original',originalOwnerId:'owner'};}});await ui.ready;
 const uploading=ui.upload({name:'New.txt',size:source.length});await until(()=>started);
 const changed=paper({notes:[{id:'note-one',text:'Newer note from a second tab.'}]}),other=paper({id:'second-tab-paper',title:'Another saved paper'});f.w.localStorage.setItem(literatureKey,JSON.stringify([other,changed]));release();await uploading;
 assert.equal(f.papers().length,3);assert.equal(f.papers().find(p=>p.id==='saved-paper').notes[0].text,'Newer note from a second tab.');assert.equal(f.papers().find(p=>p.id==='second-tab-paper').title,'Another saved paper');
});

test('compact search has a stable pending state and opens an explicitly labelled abstract without another confirmation form',async t=>{
 let release;const result={id:'database-result',source:'crossref',sourceId:'10.1000/reader',title:'Actual database paper',authors:'Author',year:'2026',doi:'10.1000/reader',abstract:source};
 const f=fixture(t,{fetcher:async url=>['/api/capabilities','/api/literature/capabilities'].includes(url)?reply({academicSearchSources:['crossref']}):new Promise(resolve=>release=resolve)}),ui=mountLiteratureLanding(f.ctx,{fetcher:f.fetcher});await ui.ready;f.input('#ld-query','research method');f.$('.ld-form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!!release);
 const query=f.$('#ld-query');assert.equal(f.$('[data-ld-wait]').hidden,false);assert.match(f.$('[data-ld-status]').textContent,/正在检索/);release(reply({items:[result],page:1,hasMore:false}));await until(()=>!!f.$('[data-ld-open]'));assert.equal(f.$('#ld-query'),query);f.$('[data-ld-open]').click();await until(()=>f.w.location.hash.includes('#literature/'));
 assert.match(f.w.location.hash,/\?tab=answer$/);assert.equal(f.papers()[0].scope,'abstract');assert.equal(f.papers()[0].text,source.replace(/\s+/g,' '));assert.equal(f.$('[data-ld-confirm-abstract]'),null);assert.equal(f.papers().find(p=>p.id==='saved-paper').notes[0].text,'Keep my research note.');
});

test('the reader keeps the original on the left, all assistance on the right and selected-paragraph questions do not submit',t=>{
 const f=fixture(t);f.w.history.replaceState(null,'','#literature/saved-paper?tab=answer');mountLiteratureReader('saved-paper',f.ctx,'answer');
 assert.ok(f.$('.lit-reader-columns>.lit-reading-main .lit-read-text'));assert.ok(f.$('.lit-reader-columns>.lit-reader-assistant [data-reader-ai]'));assert.equal(f.w.document.querySelectorAll('[data-lit-assistant-mode]').length,5);assert.equal(f.$('[data-reader-ai] .lit-ai-workspace'),null);assert.equal(f.calls.length,0);
 f.$('[data-reader-ask="2"]').click();assert.equal(f.$('[data-lit-ai-start]').value,'2');assert.equal(f.$('[data-lit-ai-end]').value,'2');assert.match(f.$('[data-lit-ai-question]').value,/解释这一段/);assert.equal(f.calls.length,0);assert.equal(f.papers()[0].notes[0].text,'Keep my research note.');assert.equal(f.$('.lit-read-text img'),null);
});

test('mobile reading switches the same document between original and assistant without navigation or AI submission',t=>{
 const f=fixture(t);f.w.history.replaceState(null,'','#literature/saved-paper?tab=answer');mountLiteratureReader('saved-paper',f.ctx,'answer');
 const route=f.w.location.hash;f.$('[data-reader-mobile-view="assistant"]').click();assert.equal(f.$('.lit-reader-studio').dataset.mobilePane,'assistant');assert.equal(f.$('[data-reader-mobile-view="assistant"]').getAttribute('aria-pressed'),'true');assert.equal(f.w.location.hash,route);assert.equal(f.calls.length,0);
 f.$('[data-reader-mobile-view="source"]').click();assert.equal(f.$('.lit-reader-studio').dataset.mobilePane,'source');assert.equal(f.$('[data-reader-mobile-view="source"]').getAttribute('aria-pressed'),'true');assert.equal(f.w.location.hash,route);assert.equal(f.papers()[0].text,source);
});

test('summary and knowledge modes submit their own snapshots, keep separate recovery records and preserve source citations',async t=>{
 const f=fixture(t);mountLiteratureReader('saved-paper',f.ctx,'answer');
 for(const mode of ['summary','keypoints']){
  f.$('[data-lit-assistant-mode="'+mode+'"]').click();assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,mode==='summary'?0:1);f.$('[data-lit-ai-open]').click();await until(()=>f.papers()[0].aiResults.some(r=>r.mode===mode));
  assert.equal(f.calls.filter(c=>c.path==='/tool-runs/quote').at(-1).data.snapshot.mode,mode);assert.ok(f.papers()[0].aiJobStates['read:'+mode]?.itemId);assert.equal(f.papers()[0].text,source);
 }
 assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,2);f.$('[data-lit-source]').click();assert.equal(f.$('#reader-text-pane').hidden,false);assert.equal(f.$('#reader-pdf-pane').hidden,true);assert.equal(f.$('#lit-source-p1').classList.contains('lit-ai-source-highlight'),true);assert.equal(f.w.scrollY,0);assert.equal(f.papers()[0].notes[0].text,'Keep my research note.');
});

test('original preview verifies the owner before loading the PDF renderer and disposes the private view',async t=>{
 const f=fixture(t);f.$('.dashboard').innerHTML='<section id="preview"><p data-reader-pdf-status></p><div data-reader-pdf-pages></div></section>';const calls=[],disposed=[],bytes=new TextEncoder().encode('%PDF-1.4\nsynthetic PDF').buffer;
 const ui=mountLiteratureOriginalPreview({container:f.$('#preview'),paper:{title:'Paper',originalFileId:'file-1',originalOwnerId:'owner'},loadViewer:async()=>({mountPdfViewer:async value=>{assert.deepEqual(new Uint8Array(value.bytes),new Uint8Array(bytes));return {pageCount:1,dispose:()=>disposed.push('done')};}}),fetchImpl:async(url,init)=>{calls.push({url,init});return url==='/api/auth/me'?reply({user:{id:'owner'}}):{ok:true,status:200,headers:new Headers(),arrayBuffer:async()=>bytes};}});
 assert.deepEqual(await Promise.all([ui.load(),ui.load()]),[true,true]);assert.equal(calls.filter(c=>c.url.includes('/download')).length,1);assert.match(calls[1].url,/expectedUserId=owner$/);assert.match(f.$('[data-reader-pdf-status]').textContent,/1 页/);ui.dispose();assert.deepEqual(disposed,['done']);assert.equal(f.$('[data-reader-pdf-pages]').childElementCount,0);
});

test('foreign-owner and late original responses never reach the PDF renderer',async t=>{
 const f=fixture(t);f.$('.dashboard').innerHTML='<section id="preview"><p data-reader-pdf-status></p><div data-reader-pdf-pages></div></section>';const calls=[];let renders=0;
 let ui=mountLiteratureOriginalPreview({container:f.$('#preview'),paper:{originalFileId:'file-1',originalOwnerId:'owner'},loadViewer:async()=>({mountPdfViewer:async()=>{renders++;throw Error('Should not render');}}),fetchImpl:async url=>{calls.push(url);return reply({user:{id:'other'}});}});assert.equal(await ui.load(),false);assert.deepEqual(calls,['/api/auth/me']);assert.equal(renders,0);ui.dispose();
 let release;ui=mountLiteratureOriginalPreview({container:f.$('#preview'),paper:{originalFileId:'file-1',originalOwnerId:'owner'},loadViewer:async()=>({mountPdfViewer:async()=>{renders++;throw Error('Should not render');}}),fetchImpl:async url=>url==='/api/auth/me'?reply({user:{id:'owner'}}):new Promise(resolve=>release=resolve)});const pending=ui.load();await until(()=>!!release);ui.dispose();release({ok:true,status:200,headers:new Headers(),arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.4\n').buffer});assert.equal(await pending,false);assert.equal(renders,0);
});

test('Word originals are reused from the verified file library and an account change blocks completion',async()=>{
 const file={name:'source.docx',size:20,arrayBuffer:async()=>new Uint8Array([80,75,1,2]).buffer},calls=[];bindStoredFile(file,{ownerId:'owner',sourceType:'original',id:'file-1',sha256:'a'.repeat(64)});
 const result=await saveLiteratureOriginal(file,{fetchImpl:async(url,init)=>{calls.push({url,init});return reply(url.endsWith('/reuse')?{id:'file-1'}:{user:{id:'owner'}});}});assert.deepEqual(result,{originalFileId:'file-1',originalOwnerId:'owner'});assert.equal(calls.filter(c=>c.url==='/api/files').length,0);assert.equal(JSON.parse(calls.find(c=>c.url.endsWith('/reuse')).init.body).expectedUserId,'owner');
 let checks=0;await assert.rejects(saveLiteratureOriginal({name:'other.txt',size:4,arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer},{fetchImpl:async url=>reply(url==='/api/files'?{id:'saved-original'}:{user:{id:++checks===1?'owner':'other'}})}),/账户已变化/);
});

test('saved-paper filtering uses a small index, limits the initial DOM and notices another tab’s updates',async t=>{
 const many=Array.from({length:60},(_,n)=>paper({id:'paper-'+n,title:'Research '+n,text:'Long source '.repeat(5000),status:n%2?'reading':'unread'})),f=fixture(t,{papers:many}),ui=mountLiteratureLanding(f.ctx,{fetcher:f.fetcher});await ui.ready;
 let reads=0;const native=f.w.Storage.prototype.getItem;f.w.Storage.prototype.getItem=function(key){if(key===literatureKey)reads++;return native.call(this,key);};t.after(()=>{f.w.Storage.prototype.getItem=native;});
 assert.equal(f.w.document.querySelectorAll('.lit-desk-file').length,12);f.input('[data-desk-filter]','Research 2');f.input('[data-desk-filter]','Research 20');assert.equal(reads,0);assert.equal(f.w.document.querySelectorAll('.lit-desk-file').length,1);f.input('[data-desk-filter]','');f.$('[data-desk-more]').click();assert.equal(f.w.document.querySelectorAll('.lit-desk-file').length,24);assert.equal(reads,0);
 f.w.localStorage.setItem(literatureKey,JSON.stringify([paper({id:'new-tab-paper',title:'A new source'})]));f.w.dispatchEvent(new f.w.StorageEvent('storage',{key:literatureKey}));assert.equal(reads,1);assert.equal(f.$('.lit-desk-file h3').textContent,'A new source');
});

test('reading results render headings, lists and code while keeping HTML, links and images inert',()=>{
 const html=readingResultMarkup('## Findings\n\n**Verified evidence**\n\n- First\n- Second\n\n```html\n<img src=x onerror=alert(1)>\n```\n<script>bad()</script>\n![tracking](https://external.test/x)');
 const dom=new JSDOM(html);assert.equal(dom.window.document.querySelector('h4').textContent,'Findings');assert.equal(dom.window.document.querySelectorAll('li').length,2);assert.equal(dom.window.document.querySelector('strong').textContent,'Verified evidence');assert.match(dom.window.document.querySelector('pre').textContent,/onerror/);assert.equal(dom.window.document.querySelector('img,script,a,iframe'),null);dom.window.close();
});

test('正文查找和目录定位不创建任务，专注阅读可以切回助手',t=>{
 const text='1 Introduction\n\nThe first verified method explains a synthetic dataset.\n\n2 Methods\n\nThe second method preserves the source evidence.',f=fixture(t,{papers:[paper({text})]});mountLiteratureReader('saved-paper',f.ctx,'answer');
 assert.equal(readingHeadings([{text:'1 Introduction',index:1},{text:'A long paragraph containing a word methods.',index:2},{text:'2 Methods',index:3}]).length,2);assert.equal(f.w.document.querySelectorAll('[data-reader-heading]').length,2);
 f.input('[data-reader-find]','method');assert.equal(f.$('[data-reader-find-count]').textContent,'1 / 3');f.$('[data-reader-find-next]').click();assert.equal(f.$('[data-reader-find-count]').textContent,'2 / 3');assert.equal(f.$('#reader-text-pane').hidden,false);assert.equal(f.calls.length,0);
 f.$('[data-reader-focus]').click();assert.equal(f.$('.lit-reader-studio').dataset.focus,'true');f.$('[data-reader-focus]').click();assert.equal(f.$('.lit-reader-studio').dataset.focus,'false');assert.equal(f.papers()[0].text,text);
});

test('rapid question typing avoids library reads and writes, then saves the latest draft before leaving',async t=>{
 const f=fixture(t);mountLiteratureReader('saved-paper',f.ctx,'answer');let reads=0,writes=0;const nativeGet=f.w.Storage.prototype.getItem,nativeSet=f.w.Storage.prototype.setItem;
 f.w.Storage.prototype.getItem=function(key){if(key===literatureKey)reads++;return nativeGet.call(this,key);};f.w.Storage.prototype.setItem=function(key,value){if(key===literatureKey)writes++;return nativeSet.call(this,key,value);};t.after(()=>{f.w.Storage.prototype.getItem=nativeGet;f.w.Storage.prototype.setItem=nativeSet;});
 for(let n=1;n<=30;n++)f.input('[data-lit-ai-question]','Question '+n);assert.equal(reads,0);assert.equal(writes,0);await new Promise(resolve=>setTimeout(resolve,390));assert.equal(writes,1);assert.equal(f.papers()[0].aiDraft.question,'Question 30');f.input('[data-lit-ai-question]','Final draft');disposeLiterature();assert.equal(f.papers()[0].aiDraft.question,'Final draft');
});

test('a generated answer can become a linked note without changing the original or discarding an existing note draft',async t=>{
 const f=fixture(t,{papers:[paper({noteDraft:{text:'An unfinished personal note',location:'p2'}})]});mountLiteratureReader('saved-paper',f.ctx,'answer');f.input('[data-lit-ai-question]','Explain the verified method');f.$('[data-lit-ai-open]').click();await until(()=>!!f.$('[data-lit-ai-note]'));f.$('[data-lit-ai-note]').click();
 const saved=f.papers()[0];assert.equal(saved.notes.length,2);assert.match(saved.notes[0].text,/Verified answer/);assert.match(saved.notes[0].location,/原文问答.*p1/);assert.equal(saved.noteDraft.text,'An unfinished personal note');assert.equal(f.$('#note-text').value,'An unfinished personal note');assert.equal(saved.text,source);f.$('[data-lit-ai-note]').click();assert.equal(f.papers()[0].notes.length,2);
});

test('another tab changing the source blocks stale edits and asks to reopen rather than overwriting that source',t=>{
 const f=fixture(t);mountLiteratureReader('saved-paper',f.ctx,'answer');const replacement=paper({text:'New source content from another tab, which must remain intact.'});f.w.localStorage.setItem(literatureKey,JSON.stringify([replacement]));f.w.dispatchEvent(new f.w.StorageEvent('storage',{key:literatureKey}));
 assert.equal(f.$('[data-reader-stale]').hidden,false);f.input('[data-lit-ai-question]','An old-source question');disposeLiterature();assert.equal(f.papers()[0].text,replacement.text);assert.equal(f.calls.length,0);
});

test('private PDF preview restores a saved page and forwards location changes without refetching its original',async t=>{
 const f=fixture(t);f.$('.dashboard').innerHTML='<section id="preview"><p data-reader-pdf-status></p><div data-reader-pdf-pages></div></section>';let mountOptions,downloads=0;const locations=[],bytes=new TextEncoder().encode('%PDF-1.4\nSynthetic PDF').buffer;
 const ui=mountLiteratureOriginalPreview({container:f.$('#preview'),paper:{originalFileId:'file-1',originalOwnerId:'owner',readingPosition:{pdfPage:6}},onLocation:page=>locations.push(page),loadViewer:async()=>({mountPdfViewer:async options=>{mountOptions=options;return {pageCount:8,dispose(){}};}}),fetchImpl:async url=>url==='/api/auth/me'?reply({user:{id:'owner'}}):(downloads++,{ok:true,status:200,headers:new Headers(),arrayBuffer:async()=>bytes})});await ui.load();assert.equal(mountOptions.initialPage,6);mountOptions.onLocation(7);await ui.load();assert.deepEqual(locations,[7]);assert.equal(downloads,1);ui.dispose();
});

test('quick prompts enable sending without a history checkbox; composition and Shift+Enter cannot submit a paid question',async t=>{
 const f=fixture(t);mountLiteratureReader('saved-paper',f.ctx,'answer');assert.equal(f.$('[data-lit-ai-open]').disabled,true);f.$('[data-lit-quick-question]').click();assert.equal(f.$('[data-lit-ai-open]').disabled,false);
 assert.equal(f.$('[data-lit-include-history]'),null);const question=f.$('[data-lit-ai-question]');question.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));question.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}));assert.equal(f.calls.length,0);
 question.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await until(()=>f.papers()[0].aiResults.length===1);assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,1);assert.equal(f.calls.find(c=>c.path==='/tool-runs/jobs').data.snapshot.context.chatHistory,undefined);
});


test('PDF reading opens the original without extracted-text tabs, tools or exports, while AI retains grounded evidence',async t=>{
 const f=fixture(t,{papers:[paper({fileName:'original.pdf',originalFileId:'file-pdf',originalOwnerId:'owner'})]});
 globalThis.fetch=async url=>reply(url==='/api/auth/me'?{user:{id:'other-owner'}}:{});
 mountLiteratureReader('saved-paper',f.ctx,'text');
 assert.equal(f.$('[data-read-tab="text"]'),null);assert.equal(f.$('[data-reader-find]'),null);assert.equal(f.$('[data-reader-text-fallback]'),null);assert.equal(f.$('#lit-original-docx'),null);assert.equal(f.$('.lit-read-text'),null);assert.equal(f.$('#reader-pdf-pane').hidden,false);assert.equal(f.$('#reader-text-pane').hidden,true);
 f.$('[data-lit-assistant-mode="summary"]').click();f.$('[data-lit-ai-open]').click();await until(()=>f.papers()[0].aiResults.length===1);
 const task=f.calls.find(c=>c.path==='/tool-runs/jobs');assert.equal(task.data.snapshot.materials[0].text,source.split('\n\n')[0]);
 assert.equal(f.$('[data-lit-source]').textContent,'原文依据');f.$('[data-lit-source]').click();assert.equal(f.$('#reader-pdf-pane').hidden,false);assert.equal(f.$('#reader-text-pane').hidden,true);assert.ok(f.$('[data-lit-source]').closest('blockquote').classList.contains('lit-ai-source-highlight'));
 f.$('[data-read-tab="notes"]').click();assert.equal(f.$('#reader-notes-pane').hidden,false);f.$('[data-read-tab="pdf"]').click();assert.equal(f.$('#reader-pdf-pane').hidden,false);assert.equal(f.papers()[0].notes[0].text,'Keep my research note.');
});

test('original cache survives PDF worker buffer transfer and still verifies the owner before reuse',async t=>{
 const f=fixture(t);f.$('.dashboard').innerHTML='<section id="preview"><p data-reader-pdf-status></p><div data-reader-pdf-pages></div></section>';let downloads=0,checks=0,mounts=0;const bytes=new TextEncoder().encode('%PDF-1.4\nCached original').buffer;
 const options={container:f.$('#preview'),paper:{originalFileId:'immutable-file',originalOwnerId:'owner'},fetchImpl:async path=>path==='/api/auth/me'?(checks++,reply({user:{id:'owner'}})):(downloads++,{ok:true,headers:new Headers(),arrayBuffer:async()=>bytes.slice(0)}),loadViewer:async()=>({mountPdfViewer:async value=>{mounts++;const moved=structuredClone(value.bytes,{transfer:[value.bytes]});assert.equal(value.bytes.byteLength,0);assert.deepEqual(new Uint8Array(moved),new Uint8Array(bytes));return{pageCount:1,dispose(){}};}})};
 let ui=mountLiteratureOriginalPreview(options);assert.equal(await ui.load(),true);ui.dispose();ui=mountLiteratureOriginalPreview(options);assert.equal(await ui.load(),true);ui.dispose();assert.equal(downloads,1);assert.equal(mounts,2);assert.equal(checks,4);
});

test('reopening an already adopted completed answer does not fetch its task or flash a waiting panel',async t=>{
 const material={id:'p1',name:'Existing research <img src=x> · 第 1 段',text:source.split('\n\n')[0]},answer={id:'saved-answer',jobId:'saved-job',operation:'answer',question:'What method?',includeHistory:true,sourceScope:'full',language:'',createdAt:new Date().toISOString(),materials:[material],output:{text:'A saved answer grounded in the actual source.',sourceIds:['p1'],citations:[{sourceId:'p1',quote:material.text.slice(0,25)}]}};
 const f=fixture(t,{papers:[paper({aiDraft:{start:1,end:1,question:'What method?',includeHistory:true},aiResults:[answer],aiJobStates:{answer:{itemId:'saved-job'}}})]});mountLiteratureReader('saved-paper',f.ctx,'answer');for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,0);assert.equal(f.$('.lit-reader-assistant [data-lit-ai-panel]').hidden,true);assert.equal(f.$('.lit-assistant-response').textContent,answer.output.text);
});
