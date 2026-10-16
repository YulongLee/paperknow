import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {buildReferenceSearchQuery,normalizeReferenceSearchItem,newReferenceSearchItems,safeReferenceURL,mountWritingReferenceSearch,openWritingReferenceSearch} from '../dist/workspace/writing-reference-search.mjs';
import {literatureKey} from '../dist/workspace/literature-model.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{for(let i=0;i<4;i++)await tick();};
const paper=(extra={})=>({id:'cr-1',source:'crossref',sourceId:'10.1234/real-source',title:'Research methods in education',authors:'A. Researcher',year:2024,doi:'10.1234/real-source',url:'https://doi.org/10.1234/real-source',abstract:'Database abstract only.',...extra});
const reply=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const results=(items=[paper()],extra={})=>({items,sources:[{id:'crossref',label:'Crossref',status:'ok'},{id:'europepmc',label:'Europe PMC',status:'ok'}],query:{q:'education'},partial:false,...extra});
function fixture(options={}){
 const dom=new JSDOM('<dialog id="workspace-dialog" open><h1 id="workspace-dialog-title"></h1><div id="workspace-dialog-body"><div id="search-host"></div></div></dialog>',{url:'https://example.test/workspace.html#tool/writing'});
 for(const key of ['window','document','location','AbortController'])globalThis[key]=dom.window[key];
 const calls=[],imports=[];let stop;
 const base={container:document.getElementById('search-host'),context:{title:'Education feedback',keywords:'learning, education'},getExisting:()=>[],onImport:rows=>imports.push(rows),fetcher:async(url,init)=>{calls.push({url,init});return reply(results());}};
 const setup=extra=>stop=mountWritingReferenceSearch({...base,...options,...extra});
 const $=selector=>document.querySelector(selector);
 return {dom,calls,imports,$,setup,close(){stop?.();document.querySelector('#workspace-dialog')?.dispatchEvent(new dom.window.Event('close'));dom.window.close();}};
}
function input(f,selector,value){const target=f.$(selector);target.value=value;target.dispatchEvent(new window.Event('input',{bubbles:true}));}
function submit(f){f.$('.wrs-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));}
function choose(f,index=0){const target=f.$('.wrs-results').querySelectorAll('[data-ref-select]')[index];target.checked=true;target.dispatchEvent(new window.Event('change',{bubbles:true}));return target;}
const bootstrap=fixture();
const {openLiteratureSearch}=await import('../dist/workspace/literature.mjs');
bootstrap.close();

test('recommendation query uses only the supplied title and keywords and keeps a bounded editable query',()=>{
 assert.equal(buildReferenceSearchQuery({title:'  AI feedback  ',keywords:'AI feedback, learning、learning'}),'AI feedback learning');
 assert.equal(buildReferenceSearchQuery({major:'艺术学'}),'艺术学');assert.equal(buildReferenceSearchQuery({}), '');
 assert.equal(buildReferenceSearchQuery({title:'x'.repeat(240),keywords:['another']} ).length,200);
});
test('search metadata never claims a read or confirmed full text and unsafe links are discarded',()=>{
 const value=normalizeReferenceSearchItem(paper({url:'javascript:alert(1)',fullTextUrl:'https://user:secret@example.test/private',text:'Do not import unrequested full text.',scope:'full',confirmed:true,fullTextRead:true}));
 assert.equal(value.scope,'metadata');assert.equal(value.text,'');assert.equal(value.confirmed,false);assert.equal(value.fullTextRead,false);assert.equal(value.fullTextUrl,'');assert.match(value.url,/^https:\/\/doi.org\//);assert.match(value.sourceLabel,/未读取全文/);
 assert.equal(safeReferenceURL('data:text/html,content'),'');assert.equal(safeReferenceURL('https://example.test/paper'),'https://example.test/paper');assert.equal(normalizeReferenceSearchItem({title:''}),null);
});
test('deduplication uses DOI and normalized title plus year without replacing existing notes or text',()=>{
 const original={id:'local-1',title:'Research methods in education',year:'2024',doi:'https://doi.org/10.1234/REAL-SOURCE',notes:[{text:'my note'}],text:'user text'};
 assert.equal(newReferenceSearchItems([paper()], [original]).length,0);
 assert.equal(newReferenceSearchItems([paper({doi:'',source:'europepmc',sourceId:'pm1',title:'Research Methods — in Education'})], [original]).length,0);
 assert.equal(newReferenceSearchItems([paper(),paper({source:'europepmc',sourceId:'pm1',id:'pm1'})]).length,1);
 assert.equal(original.text,'user text');assert.equal(original.notes[0].text,'my note');
});
test('keyword search is explicit, uses only GET metadata filters and shows partial provider availability',async()=>{
 const f=fixture({fetcher:async(url,init)=>{f.calls.push({url,init});return reply(results([paper()],{partial:true,sources:[{id:'crossref',label:'Crossref',status:'unsupported_filter',reason:'该来源不支持开放获取筛选。'},{id:'europepmc',label:'Europe PMC',status:'ok'}]}));}});
 const stop=f.setup();await stop.ready;assert.equal(f.calls.length,0);
 input(f,'[name=q]','feedback learning');input(f,'[name=yearFrom]','2020');input(f,'[name=yearTo]','2025');f.$('[name=openAccess]').checked=true;submit(f);await settle();
 const request=f.calls[0],url=new URL(request.url,'https://example.test');assert.equal(url.pathname,'/api/literature/search');assert.equal(url.searchParams.get('q'),'feedback learning');assert.equal(url.searchParams.get('yearFrom'),'2020');assert.equal(url.searchParams.get('yearTo'),'2025');assert.equal(url.searchParams.get('openAccess'),'true');assert.equal(url.searchParams.get('limit'),'10');assert.equal(request.init.method,'GET');assert.equal(request.init.body,undefined);
 assert.match(f.$('[data-ref-status]').textContent,/部分来源/);assert.match(f.$('[data-ref-sources]').textContent,/不支持当前筛选/);assert.equal(f.imports.length,0);assert.match(f.$('.wrs-results').textContent,/未读全文/);f.close();
});
test('recommended results are real metadata, require selection to import, and remain pending confirmation',async()=>{
 const f=fixture({mode:'recommend'}),stop=f.setup();await stop.ready;assert.equal(f.calls.length,1);assert.match(new URL(f.calls[0].url,'https://example.test').searchParams.get('q'),/Education feedback/);
 assert.equal(f.$('[data-ref-import]').disabled,true);choose(f);f.$('[data-ref-import]').click();await settle();assert.equal(f.imports.length,1);const row=f.imports[0][0];assert.equal(row.confirmed,false);assert.equal(row.fullTextRead,false);assert.equal(row.text,'');assert.equal(row.scope,'metadata');assert.equal(row.abstract,'Database abstract only.');assert.match(f.$('[data-ref-status]').textContent,/引用仍待核对确认/);assert.equal(f.$('[data-ref-select]').disabled,true);
 f.$('[data-ref-import]').click();await settle();assert.equal(f.imports.length,1);f.close();
});
test('late duplicate detection blocks re-adding an item introduced while the results were open',async()=>{
 let existing=[];const f=fixture({getExisting:()=>existing}),stop=f.setup({mode:'recommend'});await stop.ready;choose(f);existing=[paper({id:'existing-local'})];f.$('[data-ref-import]').click();await settle();assert.equal(f.imports.length,0);assert.match(f.$('[data-ref-status]').textContent,/无需重复添加/);f.close();
});
test('failed import retains the selection for an explicit retry and never creates a fake success',async()=>{
 let attempts=0;const f=fixture({mode:'recommend',onImport:rows=>{attempts++;if(attempts===1)throw Error('草稿保存失败，请保留现有内容。');f.imports.push(rows);}}),stop=f.setup();await stop.ready;choose(f);f.$('[data-ref-import]').click();await settle();assert.match(f.$('[data-ref-error]').textContent,/草稿保存失败/);assert.equal(f.$('[data-ref-select]').checked,true);assert.equal(f.$('[data-ref-import]').disabled,false);assert.equal(f.imports.length,0);
 f.$('[data-ref-import]').click();await settle();assert.equal(f.imports.length,1);assert.equal(f.$('[data-ref-error]').textContent,'');f.close();
});
test('untrusted titles, abstracts and source messages are escaped and all external links are safe',async()=>{
 const f=fixture({mode:'recommend',fetcher:async()=>reply(results([paper({title:'<img src=x onerror=alert(1)>',abstract:'<script>unsafe()</script>',url:'javascript:alert(1)',doi:'',fullTextUrl:'data:text/html,unsafe'})],{sources:[{id:'crossref',status:'error',reason:'<img src=x onerror=1>'}]}))}),stop=f.setup();await stop.ready;
 assert.equal(f.$('img'),null);assert.equal(f.$('script'),null);assert.equal(f.$('.wrs-result-links a'),null);assert.match(f.$('.wrs-result').textContent,/<script>unsafe/);assert.match(f.$('.wrs-source-states').textContent,/<img/);f.close();
});
test('an older request cannot replace newer results even if the network ignores abort',async()=>{
 const pending=[];const f=fixture({fetcher:(url,init)=>new Promise(resolve=>{pending.push({url,init,resolve});})}),stop=f.setup();await stop.ready;
 input(f,'[name=q]','first query');submit(f);input(f,'[name=q]','second query');submit(f);assert.equal(pending[0].init.signal.aborted,true);
 pending[1].resolve(reply(results([paper({title:'Newer result',id:'new',sourceId:'new'})])));await settle();pending[0].resolve(reply(results([paper({title:'Older result'})])));await settle();assert.match(f.$('.wrs-results').textContent,/Newer result/);assert.doesNotMatch(f.$('.wrs-results').textContent,/Older result/);f.close();
});
test('cancel clears loading immediately and ignored-abort results cannot be imported',async()=>{
 let complete,signal;const f=fixture({fetcher:(url,init)=>new Promise(resolve=>{complete=resolve;signal=init.signal;})}),stop=f.setup();await stop.ready;submit(f);f.$('[data-ref-cancel]').click();assert.equal(signal.aborted,true);assert.equal(f.$('[data-ref-results]').getAttribute('aria-busy'),'false');assert.match(f.$('[data-ref-status]').textContent,/已取消/);complete(reply(results()));await settle();assert.equal(f.$('[data-ref-select]'),null);assert.equal(f.imports.length,0);f.close();
});
test('route changes and removal of the modal abort requests without painting another page',async()=>{
 let complete,signal;const f=fixture({fetcher:(url,init)=>new Promise(resolve=>{complete=resolve;signal=init.signal;})}),stop=f.setup();await stop.ready;submit(f);location.hash='#home';window.dispatchEvent(new window.HashChangeEvent('hashchange'));assert.equal(signal.aborted,true);f.$('#workspace-dialog-body').innerHTML='<h2>其他页面</h2>';complete(reply(results()));await settle();assert.equal(f.$('#workspace-dialog-body').textContent,'其他页面');assert.equal(f.imports.length,0);f.close();
});
test('provider failures show retry and empty results remain honest without invented references',async()=>{
 let requests=0;const f=fixture({fetcher:async()=>{requests++;return requests===1?reply({error:'数据库暂时不可用',sources:[{id:'crossref',status:'error',reason:'连接超时'}]},503):reply(results([]));}}),stop=f.setup();await stop.ready;submit(f);await settle();assert.match(f.$('[data-ref-error]').textContent,/数据库暂时不可用/);assert.match(f.$('[data-ref-sources]').textContent,/连接超时/);f.$('[data-ref-retry]').click();await settle();assert.equal(requests,2);assert.equal(f.$('[data-ref-error]').textContent,'');assert.match(f.$('.wrs-results').textContent,/暂未找到匹配文献/);assert.equal(f.$('[data-ref-import]').disabled,true);assert.equal(f.imports.length,0);f.close();
});
test('invalid terms and inverted years cannot trigger a network request',async()=>{
 const f=fixture(),stop=f.setup();await stop.ready;input(f,'[name=q]','x');submit(f);await settle();assert.match(f.$('[data-ref-error]').textContent,/2–200/);assert.equal(f.calls.length,0);input(f,'[name=q]','education');input(f,'[name=yearFrom]','2025');input(f,'[name=yearTo]','2020');submit(f);await settle();assert.match(f.$('[data-ref-error]').textContent,/起始年份不能晚于/);assert.equal(f.calls.length,0);f.close();
});
test('modal integration reuses the shared accessible dialog and disposes on close',async()=>{
 const f=fixture();let title;const dispose=openWritingReferenceSearch({modal:(label,html)=>{title=label;f.$('#workspace-dialog-body').innerHTML=html;},onImport:()=>{},context:{},mode:'recommend'});await dispose.ready;assert.equal(title,'推荐参考文献');assert.match(f.$('[data-ref-status]').textContent,/先填写论文题目/);assert.ok(f.$('.writing-reference-search[aria-labelledby]'));f.$('#workspace-dialog').dispatchEvent(new window.Event('close'));assert.equal(f.$('[data-ref-select]'),null);dispose();f.close();
});
test('the shared library search saves metadata atomically and preserves existing full text and notes',async()=>{
 const f=fixture(),previousFetch=globalThis.fetch;let dispose;
 try{
  globalThis.localStorage=f.dom.window.localStorage;
  const existing={id:'local-paper',title:'My imported source',year:'2022',doi:'10.9999/local',text:'User-provided full text.',scope:'full',notes:[{id:'note1',text:'My original note.'}],tags:[],status:'reading'};
  localStorage.setItem(literatureKey,JSON.stringify([existing]));globalThis.fetch=async()=>reply(results());
  const ctx={modal:(_,html)=>{f.$('#workspace-dialog-body').innerHTML=html;},notify:()=>{}};
  dispose=openLiteratureSearch(ctx);await dispose.ready;input(f,'[name=q]','education methods');submit(f);await settle();choose(f);f.$('[data-ref-import]').click();await settle();
  const saved=JSON.parse(localStorage.getItem(literatureKey));assert.equal(saved.length,2);assert.deepEqual(saved[1],existing);assert.equal(saved[0].scope,'metadata');assert.equal(saved[0].text,'');assert.equal(saved[0].confirmed,false);assert.equal(saved[0].status,'unread');assert.equal(saved[0].abstract,'Database abstract only.');assert.equal(saved[0].fullTextRead,false);
  f.$('[data-ref-local]').click();assert.ok(f.$('#lit-search-form'));input(f,'#lit-search-query','My imported');f.$('#lit-search-form').dispatchEvent(new window.Event('submit',{cancelable:true}));assert.match(f.$('#lit-search-results').textContent,/My imported source/);f.$('[data-lit-online-search]').click();assert.ok(f.$('.writing-reference-search'));assert.equal(JSON.parse(localStorage.getItem(literatureKey)).length,2);
 }finally{dispose?.();globalThis.fetch=previousFetch;f.close();}
});
test('a full local library rejects the entire addition and retains the selected search results',async()=>{
 const f=fixture(),previousFetch=globalThis.fetch;let dispose;
 try{
  globalThis.localStorage=f.dom.window.localStorage;
  const before=Array.from({length:200},(_,i)=>({id:'local-'+i,title:'Existing paper '+i,year:'2020',scope:'metadata',text:'',tags:[],notes:[]}));localStorage.setItem(literatureKey,JSON.stringify(before));globalThis.fetch=async()=>reply(results());
  dispose=openLiteratureSearch({modal:(_,html)=>{f.$('#workspace-dialog-body').innerHTML=html;},notify:()=>{}});await dispose.ready;input(f,'[name=q]','education methods');submit(f);await settle();choose(f);f.$('[data-ref-import]').click();await settle();assert.match(f.$('[data-ref-error]').textContent,/最多保存 200 篇/);assert.equal(f.$('[data-ref-select]').checked,true);assert.deepEqual(JSON.parse(localStorage.getItem(literatureKey)),before);
 }finally{dispose?.();globalThis.fetch=previousFetch;f.close();}
});
