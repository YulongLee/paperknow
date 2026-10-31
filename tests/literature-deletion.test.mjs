import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountLiterature,disposeLiterature,mountLiteratureReader} from '../dist/workspace/literature.mjs';
import {mountLiteratureLanding,disposeLiteraturePages} from '../dist/workspace/literature-pages.mjs';
import {mountArtifactLibrary} from '../dist/workspace/artifact-library.mjs';
import {literatureKey,validatePaper} from '../dist/workspace/literature-model.mjs';
import {publishFileDeleted,reconcileLiteratureDeletions} from '../dist/workspace/literature-file-sync.mjs';
import {mountLiteratureOriginalPreview} from '../dist/workspace/literature-original-preview.mjs';
import {clearEditor} from '../dist/workspace/edit-guard.mjs';
const sha='a'.repeat(64),paper=(id,extra={})=>validatePaper({id,title:'Research '+id,scope:'full',text:'A synthetic source describing the research method and its limitations.',notes:[{id:'note-'+id,text:'Keep source notes for '+id}],tags:[],...extra});
const linked=(id,fileId=id,extra={})=>paper(id,{originalFileId:fileId,originalOwnerId:'alice',fileName:id+'.pdf',...extra});
async function settle(check){for(let n=0;n<200;n++){if(check())return;await new Promise(r=>setTimeout(r,3));}assert.fail('Deletion did not settle');}
function fixture(t,{papers=[paper('one'),paper('two')],remove,files,deleted=[]}={}){
 const dom=new JSDOM('<main class="dashboard"></main><div id="files"></div><dialog id="workspace-dialog"><h2></h2><div id="workspace-dialog-body"></div></dialog>',{url:'https://reading.test/workspace.html#category/literature?view=library'}),w=dom.window,before={};
 for(const key of ['window','document','localStorage','location','FormData','AbortController','MutationObserver','DOMParser','XMLSerializer','fetch'])before[key]=globalThis[key];
 let account='alice',stored=files||papers.filter(p=>p.originalOwnerId==='alice').map(p=>({id:p.originalFileId,name:p.fileName,kind:'pdf',sha256:sha,bytes:100}));stored=[...new Map(stored.map(row=>[row.id,row])).values()];const tombstones=new Set(deleted),calls=[],notices=[];
 const fetcher=async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):undefined;calls.push({path,options,body});
  if(path==='/api/auth/me')return Response.json({user:{id:account}});
  if(options.headers?.['X-PaperKnow-User']&&options.headers['X-PaperKnow-User']!==account)return Response.json({error:'登录账户已变化',code:'ACCOUNT_CHANGED'},{status:409});
  if(path==='/api/files'||path.startsWith('/api/files?'))return Response.json({items:stored});
  if(path==='/api/files/deletions/check')return Response.json({ownerId:account,deletedIds:body.fileIds.filter(id=>tombstones.has(id))});
  if(path.startsWith('/api/files/')&&path.endsWith('/delete')){const id=path.split('/')[3],reply=await remove?.(id);if(reply)return reply;stored=stored.filter(row=>row.id!==id);tombstones.add(id);return Response.json({ok:true,id,deleted:true});}
  if(path.startsWith('/api/artifacts?'))return Response.json({items:[],total:0,usedBytes:0,quotaBytes:1000000,storageReady:true});
  if(path==='/api/projects')return Response.json({items:[]});
  if(path==='/api/literature/capabilities'||path==='/api/capabilities')return Response.json({academicSearchSources:[]});
  throw Error('Unexpected request '+path);
 };
 for(const key of Object.keys(before))globalThis[key]=key==='window'?w:key==='fetch'?fetcher:w[key];
 const $=selector=>w.document.querySelector(selector);w.HTMLElement.prototype.scrollIntoView=()=>{};$('dialog').close=function(){this.open=false;};
 const ctx={notify:message=>notices.push(message),modal:(title,markup)=>{$('dialog h2').textContent=title;$('#workspace-dialog-body').innerHTML=markup;$('dialog').open=true;}};
 w.localStorage.setItem(literatureKey,JSON.stringify(papers));
 t.after(()=>{disposeLiteraturePages();disposeLiterature();clearEditor();Object.assign(globalThis,before);w.close();});
 return {w,$,ctx,calls,notices,fetcher,rows:()=>JSON.parse(w.localStorage.getItem(literatureKey)),files:()=>stored,account:id=>account=id};
}
const deletions=f=>f.calls.filter(c=>c.path.endsWith('/delete'));

test('library exposes deletion and cancellation does not remove data; names remain escaped',async t=>{
 const f=fixture(t,{papers:[paper('one',{title:'Unsafe <img src=x>'}),paper('two')]});mountLiterature(f.ctx);
 assert.ok(f.$('[data-lit-delete="one"]'));assert.ok(f.$('[data-lit-delete-selected]').disabled);
 f.$('[data-lit-delete="one"]').click();assert.equal(f.$('.lit-delete-dialog img'),null);assert.match(f.$('.lit-delete-dialog').textContent,/Unsafe <img/);
 f.$('[data-lit-delete-cancel]').click();assert.equal(f.$('dialog').open,false);assert.equal(f.rows().length,2);assert.equal(deletions(f).length,0);
 f.$('[data-lit-delete="one"]').click();f.$('[data-lit-delete-confirm]').click();await settle(()=>f.rows().length===1);
 assert.equal(f.rows()[0].id,'two');assert.equal(f.rows()[0].notes[0].text,'Keep source notes for two');assert.equal(f.$('[data-lit-delete="one"]'),null);assert.match(f.$('#lit-count').textContent,/1 篇/);
});

test('deleting literature removes its confirmed cloud original once, all matching reading entries, and no foreign-owner entry',async t=>{
 const f=fixture(t,{papers:[linked('one','same'),linked('alias','same'),linked('foreign','same',{originalOwnerId:'bob'}),paper('keep')]});mountLiterature(f.ctx);
 f.$('[data-lit-delete="one"]').click();assert.match(f.$('.lit-delete-dialog').textContent,/文件管理同步移除原件/);f.$('[data-lit-delete-confirm]').click();await settle(()=>deletions(f).length===1&&f.rows().length===2);
 assert.equal(f.files().length,0);assert.deepEqual(f.rows().map(row=>row.id),['foreign','keep']);assert.equal(deletions(f)[0].options.headers['X-PaperKnow-User'],'alice');assert.equal(deletions(f)[0].body.expectedSha256,sha);
});

test('failed originals retain notes and selected rows; a bulk retry only repeats failed deletions',async t=>{
 let fail=true;const f=fixture(t,{papers:[linked('one'),linked('two')],remove:id=>id==='two'&&fail?Response.json({error:'任务正在使用这份原文'},{status:409}):null});mountLiterature(f.ctx);
 f.$('#lit-select-all').click();assert.equal(f.$('[data-lit-delete-selected]').disabled,false);f.$('[data-lit-delete-selected]').click();f.$('[data-lit-delete-confirm]').click();
 await settle(()=>f.$('[data-lit-delete-errors]').textContent.includes('任务正在使用'));
 assert.deepEqual(f.rows().map(row=>row.id),['two']);assert.equal(f.rows()[0].notes[0].text,'Keep source notes for two');assert.equal(f.$('[data-lit-select="two"]').checked,true);
 fail=false;f.$('[data-lit-delete-confirm]').click();await settle(()=>f.rows().length===0);assert.deepEqual(deletions(f).map(c=>c.path.split('/')[3]),['one','two','two']);
});

test('an unconfirmed response never discards a literature record or claims successful deletion',async t=>{
 const f=fixture(t,{papers:[linked('one')],remove:()=>Response.json({ok:true})});mountLiterature(f.ctx);f.$('[data-lit-delete="one"]').click();f.$('[data-lit-delete-confirm]').click();await settle(()=>f.$('[data-lit-delete-errors]').textContent.includes('删除结果未确认'));
 assert.equal(f.rows().length,1);assert.equal(f.files().length,1);assert.equal(f.notices.some(message=>message.startsWith('已删除')),false);
});

test('switching accounts before confirming cannot delete the original or its literature',async t=>{
 const f=fixture(t,{papers:[linked('one')]});mountLiterature(f.ctx);f.$('[data-lit-delete="one"]').click();f.account('bob');f.$('[data-lit-delete-confirm]').click();await settle(()=>f.$('[data-lit-delete-errors]').textContent.includes('请登录上传'));
 assert.equal(deletions(f).length,0);assert.equal(f.rows().length,1);
});

test('another tab updating source notes during confirmation blocks the stale deletion',async t=>{
 const f=fixture(t,{papers:[linked('one')]});mountLiterature(f.ctx);f.$('[data-lit-delete="one"]').click();const rows=f.rows();rows[0].notes[0].text='A newer note';f.w.localStorage.setItem(literatureKey,JSON.stringify(rows));f.$('[data-lit-delete-confirm]').click();await settle(()=>f.$('[data-lit-delete-errors]').textContent.includes('其他页面更新'));
 assert.equal(deletions(f).length,0);assert.equal(f.rows()[0].notes[0].text,'A newer note');
});

test('leaving during a bulk deletion stops subsequent requests and preserves the replacement page',async t=>{
 let release,started=false;const gate=new Promise(r=>release=r),f=fixture(t,{papers:[linked('one'),linked('two')],remove:async()=>{started=true;await gate;}});mountLiterature(f.ctx);
 f.$('#lit-select-all').click();f.$('[data-lit-delete-selected]').click();f.$('[data-lit-delete-confirm]').click();await settle(()=>started);disposeLiterature();f.w.history.replaceState(null,'','#home');f.$('.dashboard').innerHTML='Another page';release();await settle(()=>f.rows().length===1);assert.equal(deletions(f).length,1);assert.equal(f.$('.dashboard').textContent,'Another page');
});

test('opening literature reconciles only server-confirmed completed deletions; pending and unknown originals remain',async t=>{
 const f=fixture(t,{papers:[linked('old'),linked('unknown'),linked('foreign','old',{originalOwnerId:'bob'}),paper('metadata')],files:[],deleted:['old']});
 const removed=await reconcileLiteratureDeletions({win:f.w,fetchImpl:f.fetcher});assert.deepEqual(removed,['old']);assert.deepEqual(f.rows().map(row=>row.id),['unknown','foreign','metadata']);
});

test('the reading desk exposes a secondary delete action and refreshes in place after deletion',async t=>{
 const f=fixture(t,{papers:[paper('one'),paper('two')]});f.w.history.replaceState(null,'','#category/literature');const ui=mountLiteratureLanding(f.ctx,{fetcher:f.fetcher});await ui.ready;
 const query=f.$('[data-desk-filter]');f.$('[data-lit-delete="one"]').click();f.$('[data-lit-delete-confirm]').click();await settle(()=>f.$('[data-desk-count]').textContent==='1');assert.equal(f.$('[data-desk-filter]'),query);assert.ok(f.$('[data-lit-delete="two"]'));
});

test('file management single deletion removes matching literature and an open library refreshes without navigation',async t=>{
 const f=fixture(t,{papers:[linked('one'),paper('keep')]});mountLiterature(f.ctx);
 const view=mountArtifactLibrary(f.$('#files'),{session:async()=>({user:{id:'alice'}}),fetchImpl:f.fetcher});t.after(()=>view.dispose());await settle(()=>f.$('[data-original-toggle]'));
 f.$('[data-original-toggle]').click();await settle(()=>f.$('[data-original-remove="one"]'));f.$('[data-original-remove="one"]').click();f.$('[data-original-remove-confirm="one"]').click();await settle(()=>f.rows().length===1);
 assert.equal(f.rows()[0].id,'keep');assert.equal(f.$('[data-lit-delete="one"]'),null);assert.equal(f.w.location.hash,'#category/literature?view=library');
});

test('a literature deletion refreshes an open file manager and original counts automatically',async t=>{
 const f=fixture(t,{papers:[linked('one')]});const view=mountArtifactLibrary(f.$('#files'),{session:async()=>({user:{id:'alice'}}),fetchImpl:f.fetcher});t.after(()=>view.dispose());await settle(()=>f.$('[data-original-toggle]'));f.$('[data-original-toggle]').click();await settle(()=>f.$('[data-original-file="one"]'));
 f.files().splice(0);publishFileDeleted({ownerId:'alice',fileId:'one'},{win:f.w});await settle(()=>f.$('.cloud-original-toggle').textContent.includes('0 份'));assert.equal(f.$('[data-original-file="one"]'),null);assert.equal(f.rows().length,0);
});

test('deleted PDF originals are evicted from preview cache and cannot be rendered again from memory',async t=>{
 const f=fixture(t,{papers:[]});f.$('.dashboard').innerHTML='<div id="preview"><p data-reader-pdf-status></p><div data-reader-pdf-pages></div></div>';let downloads=0,renders=0,removed=false;const bytes=new TextEncoder().encode('%PDF-1.4 synthetic').buffer;
 const fetchImpl=async path=>path==='/api/auth/me'?Response.json({user:{id:'alice'}}):(++downloads,removed?Response.json({error:'deleted'},{status:404}):new Response(bytes));
 const make=()=>mountLiteratureOriginalPreview({container:f.$('#preview'),paper:{originalOwnerId:'alice',originalFileId:'one'},fetchImpl,loadViewer:async()=>({mountPdfViewer:async()=>{renders++;return{pageCount:1,dispose(){}};}})});
 const first=make();t.after(()=>first.dispose());assert.equal(await first.load(),true);removed=true;publishFileDeleted({ownerId:'alice',fileId:'one'},{win:f.w});assert.equal(f.$('#preview').dataset.previewState,'deleted');first.dispose();
 const second=make();t.after(()=>second.dispose());assert.equal(await second.load(),false);assert.equal(downloads,2);assert.equal(renders,1);
});

test('originals with the same content hash stay independent unless they share the exact file and owner',async t=>{
 const f=fixture(t,{papers:[linked('one'),linked('two')]});mountLiterature(f.ctx);f.$('[data-lit-delete="one"]').click();f.$('[data-lit-delete-confirm]').click();await settle(()=>f.rows().length===1);
 assert.equal(f.rows()[0].id,'two');assert.equal(f.files()[0].id,'two');assert.equal(f.files()[0].sha256,sha);
});

test('a missing original without a completed deletion is kept for investigation rather than silently discarded',async t=>{
 const f=fixture(t,{papers:[linked('one')],files:[]});mountLiterature(f.ctx);f.$('[data-lit-delete="one"]').click();f.$('[data-lit-delete-confirm]').click();await settle(()=>f.$('[data-lit-delete-errors]').textContent.includes('未能确认关联原文'));
 assert.equal(f.rows().length,1);assert.equal(deletions(f).length,0);
});

test('file management bulk deletion synchronizes only successes and preserves blocked source notes',async t=>{
 const f=fixture(t,{papers:[linked('one'),linked('two')],remove:id=>id==='two'?Response.json({error:'原文正在使用'},{status:409}):null});
 const view=mountArtifactLibrary(f.$('#files'),{session:async()=>({user:{id:'alice'}}),fetchImpl:f.fetcher});t.after(()=>view.dispose());await settle(()=>f.$('[data-original-toggle]'));f.$('[data-original-toggle]').click();await settle(()=>f.$('[data-bulk-all="original"]'));
 f.$('[data-bulk-all="original"]').click();f.$('[data-bulk-remove="original"]').click();f.$('[data-bulk-confirm="original"]').click();await settle(()=>f.$('.cloud-file-bulk-result')?.textContent.includes('未删除')||f.w.document.querySelectorAll('[data-original-file]').length===1);
 assert.deepEqual(f.rows().map(row=>row.id),['two']);assert.equal(f.rows()[0].notes[0].text,'Keep source notes for two');
});

test('account changes after a reconciliation reply prevent applying old-account deletion state',async t=>{
 const f=fixture(t,{papers:[linked('one')],deleted:['one']});
 const fetchImpl=async(path,options)=>{const reply=await f.fetcher(path,options);if(path==='/api/files/deletions/check')f.account('bob');return reply;};
 assert.deepEqual(await reconcileLiteratureDeletions({win:f.w,fetchImpl}),[]);assert.equal(f.rows().length,1);
});

test('deleting a source also evicts a PDF cached by an already closed reading view',async t=>{
 const f=fixture(t,{papers:[]});f.$('.dashboard').innerHTML='<div id="cached-preview"><p data-reader-pdf-status></p><div data-reader-pdf-pages></div></div>';let downloads=0,removed=false;const bytes=new TextEncoder().encode('%PDF-1.4 cached synthetic').buffer;
 const fetchImpl=async path=>path==='/api/auth/me'?Response.json({user:{id:'alice'}}):(++downloads,removed?Response.json({error:'deleted'},{status:404}):new Response(bytes));
 const make=()=>mountLiteratureOriginalPreview({container:f.$('#cached-preview'),paper:{originalOwnerId:'alice',originalFileId:'old-cache'},fetchImpl,loadViewer:async()=>({mountPdfViewer:async()=>({pageCount:1,dispose(){}})})});
 const first=make();assert.equal(await first.load(),true);first.dispose();removed=true;publishFileDeleted({ownerId:'alice',fileId:'old-cache'},{win:f.w});const second=make();t.after(()=>second.dispose());assert.equal(await second.load(),false);assert.equal(downloads,2);
});

test('an external deletion defers file-list synchronization while a rename is being edited',async t=>{
 const f=fixture(t,{papers:[]}),file={id:'cloud-one',name:'Original.docx',kind:'docx',bytes:10,sha256:sha,createdAt:new Date().toISOString(),status:'ready',version:1};let lists=0;
 const fetchImpl=async(path,options)=>{if(path.startsWith('/api/artifacts?')){lists++;return Response.json({items:[file],total:1,usedBytes:10,quotaBytes:1000000,storageReady:true});}return f.fetcher(path,options);};
 const view=mountArtifactLibrary(f.$('#files'),{session:async()=>({user:{id:'alice'}}),fetchImpl});t.after(()=>view.dispose());await settle(()=>f.$('[data-cloud-edit]'));f.$('[data-cloud-edit]').click();const input=f.$('.cloud-artifact-metadata input');input.value='Unsaved revised title.docx';const before=lists;
 publishFileDeleted({ownerId:'alice',fileId:'unrelated-original'},{win:f.w});await new Promise(r=>setTimeout(r,90));assert.equal(f.$('.cloud-artifact-metadata input'),input);assert.equal(input.value,'Unsaved revised title.docx');assert.equal(lists,before);
 f.$('[data-cloud-edit-cancel]').click();await settle(()=>lists>before);assert.ok(f.$('[data-cloud-file="cloud-one"]'));
});
