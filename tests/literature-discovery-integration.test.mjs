import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {unzipSync,strFromU8} from 'fflate';
import {mountLiterature,mountLiteratureDiscoveryPage,mountLiteratureReader} from '../dist/workspace/literature.mjs';
import {validatePaper,literatureKey} from '../dist/workspace/literature-model.mjs';
import {clearEditor} from '../dist/workspace/edit-guard.mjs';
const item=()=>({id:'crossref:10.1234/audit',source:'crossref',sourceId:'10.1234/audit',title:'An actual database title',authors:'Database author',year:'2025',doi:'10.1234/audit',url:'https://doi.org/10.1234/audit',abstract:'The actual supplied database abstract. Full text was not acquired.'});
const until=async check=>{for(let i=0;i<150;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.fail('UI did not settle');};
function setup(t,{existing=[],owner=null}={}){
 const dom=new JSDOM('<main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://audit.test/workspace.html#category/literature?view=search'}),w=dom.window,names=['window','document','localStorage','FormData','location','AbortController','DOMParser','XMLSerializer','MutationObserver','fetch'],before=Object.fromEntries(names.map(key=>[key,globalThis[key]]));
 for(const key of names.filter(key=>key!=='fetch'))globalThis[key]=key==='window'?w:w[key];const calls=[],notices=[],$=s=>w.document.querySelector(s);let rows=[item()];
 const fetcher=async(url,init)=>{calls.push({url,init});if(url==='/api/capabilities')return Response.json({academicSearchSources:['crossref']});if(url.startsWith('/api/literature/search?'))return Response.json({items:rows,sources:[{id:'crossref',status:'ok'}],page:1,hasMore:false});if(url==='/api/auth/me')return Response.json({user:owner?{id:owner}:null});throw Error('Unexpected external request '+url);};globalThis.fetch=fetcher;w.fetch=fetcher;
 w.HTMLElement.prototype.scrollIntoView=()=>{};w.document.querySelector('dialog').close=function(){this.open=false;};const ctx={notify:msg=>notices.push(msg),modal:(_,html)=>{$('#workspace-dialog-body').innerHTML=html;$('#workspace-dialog').open=true;}};
 localStorage.setItem(literatureKey,JSON.stringify(existing));let ui;const mount=()=>{ui=mountLiteratureDiscoveryPage(ctx,{fetcher});return ui;};
 t.after(()=>{ui?.dispose();clearEditor();Object.assign(globalThis,before);w.close();});
 return {w,$,ctx,calls,notices,fetcher,mount,setRows:value=>{rows=value;},saved:()=>JSON.parse(w.localStorage.getItem(literatureKey)),search:async()=>{await ui.ready;$('#ld-query').value='actual research';await ui.search();},readAbstract:async()=>{$('[data-ld-abstract-read]').click();assert.ok($('[data-ld-confirm-abstract]'));$('[data-ld-confirm-abstract]').click();await new Promise(resolve=>setImmediate(resolve));}};
}

test('standalone discovery imports metadata only through the actual library adapter',async t=>{
 const f=setup(t);f.mount();await f.search();const pick=f.$('[data-ld-pick]');pick.checked=true;pick.dispatchEvent(new f.w.Event('change',{bubbles:true}));f.$('[data-ld-import]').click();await until(()=>f.saved().length===1);
 const p=f.saved()[0];assert.equal(p.scope,'metadata');assert.equal(p.text,'');assert.equal(p.status,'unread');assert.equal(p.abstract,item().abstract);assert.deepEqual(p.notes,[]);assert.ok(f.$('.lit-discovery'));assert.ok(f.calls.every(call=>!call.init?.method||call.init.method==='GET'));
});
test('explicit abstract confirmation creates only an abstract-scoped reading material',async t=>{
 const f=setup(t);f.mount();await f.search();assert.equal(f.saved().length,0);f.$('[data-ld-abstract-read]').click();assert.equal(f.saved().length,0);f.$('[data-ld-confirm-abstract]').click();await until(()=>f.saved().length===1);
 const p=f.saved()[0];assert.equal(p.scope,'abstract');assert.equal(p.text,item().abstract);assert.equal(p.status,'unread');assert.match(f.w.location.hash,/^#literature\//);assert.equal(f.calls.some(call=>call.url.includes('tool-runs')),false);
});
test('reading a duplicate abstract never replaces existing full text, notes or saved AI results',async t=>{
 const p=validatePaper({...item(),id:'local-existing',scope:'full',text:'User full text, never replace this.',status:'reading',notes:[{id:'n1',text:'User note'}],createdAt:'2025-01-01'}),f=setup(t,{existing:[p]});f.mount();await f.search();await f.readAbstract();assert.deepEqual(f.saved(),[p]);assert.match(f.w.location.hash,/#literature\/local-existing/);assert.ok(f.notices.some(msg=>/保留.*原文和笔记/.test(msg)));
});
test('adopting an abstract into an empty metadata record retains its local identity and notes',async t=>{
 const p=validatePaper({...item(),id:'local-metadata',title:'User amended title',scope:'metadata',text:'',group:'Saved group',projectId:'local-project',notes:[{id:'n1',text:'Keep this note'}]}),f=setup(t,{existing:[p]});f.mount();await f.search();await f.readAbstract();const saved=f.saved()[0];assert.equal(saved.id,p.id);assert.equal(saved.title,p.title);assert.equal(saved.scope,'abstract');assert.equal(saved.text,item().abstract);assert.deepEqual(saved.notes,p.notes);assert.equal(saved.group,p.group);assert.equal(saved.projectId,p.projectId);
});
test('storage failure keeps abstract confirmation and the existing library intact',async t=>{
 const p=validatePaper({...item(),id:'old',scope:'metadata',text:'',notes:[{id:'n1',text:'Keep note'}]}),f=setup(t,{existing:[p]});f.mount();await f.search();const set=f.w.Storage.prototype.setItem;f.w.Storage.prototype.setItem=function(key,value){if(key===literatureKey)throw Error('quota');return set.call(this,key,value);};t.after(()=>{f.w.Storage.prototype.setItem=set;});await f.readAbstract();assert.deepEqual(f.saved(),[p]);assert.ok(f.$('[data-ld-confirm-abstract]'));assert.equal(f.$('[data-ld-confirm-abstract]').disabled,false);assert.match(f.$('[data-ld-abstract-error]').textContent,/未能保存/);
});
test('old papers do not invent original links and tracked originals require the fixed owner without fetching the file',async t=>{
 const old=validatePaper({id:'old',title:'Old paper',scope:'full',text:'Old source text.',notes:[]}),f=setup(t,{existing:[old],owner:'owner1'});mountLiteratureReader(old.id,f.ctx);assert.equal(f.$('#lit-original-file'),null);
 const tracked=validatePaper({...old,id:'tracked',fileName:'real.pdf',originalFileId:'file1',originalOwnerId:'owner1'});localStorage.setItem(literatureKey,JSON.stringify([tracked]));mountLiteratureReader(tracked.id,f.ctx);assert.ok(f.$('#lit-original-file'));assert.equal(f.calls.length,0);f.$('#lit-original-file').click();await until(()=>!!f.$('#lit-original-file-status a'));assert.equal(f.$('#lit-original-file-status a').getAttribute('href'),'/api/files/file1/download?expectedUserId=owner1');assert.deepEqual(f.calls.map(c=>c.url),['/api/auth/me']);
});
test('a different signed-in account cannot obtain the tracked original link',async t=>{
 const p=validatePaper({id:'tracked',title:'Tracked source',scope:'full',text:'Source text.',notes:[],originalFileId:'file1',originalOwnerId:'owner1'}),f=setup(t,{existing:[p],owner:'other-owner'});mountLiteratureReader(p.id,f.ctx);f.$('#lit-original-file').click();await until(()=>!f.$('#lit-original-file').disabled);assert.equal(f.$('#lit-original-file-status a'),null);assert.match(f.$('#lit-original-file-status').textContent,/上传原件的账户/);assert.deepEqual(f.calls.map(c=>c.url),['/api/auth/me']);
});
test('extracted-text DOCX uses actual current text and makes no PDF layout claim',async t=>{
 const p=validatePaper({id:'export',title:'Extracted source',scope:'full',text:'An original paragraph.\n\nA second complete paragraph.',notes:[]}),f=setup(t,{existing:[p]}),originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL,files=[],blobs=new Map();URL.createObjectURL=blob=>{const url='blob:original-'+blobs.size;blobs.set(url,blob);return url;};URL.revokeObjectURL=()=>{};f.w.HTMLAnchorElement.prototype.click=function(){files.push({name:this.download,blob:blobs.get(this.href)});};t.after(()=>{URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;});
 mountLiteratureReader(p.id,f.ctx);assert.match(f.$('#lit-original-docx').textContent,/提取文本/);assert.match(f.$('#lit-original-status').textContent,/不重建.*PDF/);f.$('#lit-original-docx').click();await until(()=>files.length===1);assert.match(files[0].name,/\.docx$/);const zip=unzipSync(new Uint8Array(await files[0].blob.arrayBuffer())),xml=strFromU8(zip['word/document.xml']);assert.ok(xml.includes('An original paragraph.'));assert.ok(xml.includes('A second complete paragraph.'));assert.deepEqual(f.calls.map(c=>c.url),['/api/auth/me']);
});

test('the visible review entry creates a separate summary draft from selected original text without submitting AI',async t=>{
 const p=validatePaper({...item(),id:'review-source',scope:'full',text:'An actual original paper text long enough for source admission.',notes:[{id:'private-note',text:'A note is not source evidence.'}]}),f=setup(t,{existing:[p]});f.w.location.hash='#category/literature';localStorage.setItem('paperknow-drafts',JSON.stringify([{id:'prior-draft',tool:'summary',title:'Keep prior draft',text:'Prior text'}]));mountLiterature(f.ctx);assert.match(f.$('[data-lit-review]').textContent,/文献综述/);f.$('[data-lit-review]').click();await until(()=>!!f.$('#lit-review-bridge-form'));
 f.$('#lit-review-title').value='A source-grounded literature review';f.$('input[name="paperId"]').checked=true;f.$('#lit-review-bridge-form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));const drafts=JSON.parse(localStorage.getItem('paperknow-drafts'));assert.equal(drafts.length,2);assert.equal(drafts[1].id,'prior-draft');assert.equal(drafts[1].text,'Prior text');assert.equal(drafts[0].tool,'summary');assert.equal(drafts[0].writingFlow.references[0].text,p.text);assert.equal(drafts[0].writingFlow.references[0].scope,'full');assert.equal(drafts[0].writingFlow.references[0].confirmed,false);assert.ok(!JSON.stringify(drafts[0].writingFlow).includes('A note is not source evidence.'));assert.match(f.w.location.hash,/#draft\//);assert.equal(f.calls.length,0);
});
