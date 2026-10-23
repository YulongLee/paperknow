import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountOnlineThesis,disposeOnlineThesis,thesisOnlineSessionChanged} from '../dist/workspace/thesis-online.mjs';

const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
const figure=id=>({id,title:'拟开展步骤 '+id,kind:'flowchart',nodes:[{id:'a',label:'界定研究问题'},{id:'b',label:'拟收集资料验证'}],edges:[{from:'a',to:'b'}],caption:'这是待验证方案。'});
const oldFigure=figure('oldfig'),newFigure=figure('newfig'),oldText='历史方案正文\n[figure:oldfig]\n后续研究论述。';
const key=(actor='u1',id='t1')=>`paperknow-thesis-edits-v1:${actor}:${id}`;
function record(id='t1'){
 const snapshot={title:'合成图形恢复验收',profile:{level:'本科',language:'中文',targetWords:1000},requirements:{},materials:[],references:[{id:'r1',title:'已确认题录',confirmed:true}],outline:[{id:'c1',title:'第一章 研究方案',targetWords:500},{id:'c2',title:'第二章 局限',targetWords:500}]};
 return {id,version:3,title:snapshot.title,profile:snapshot.profile,snapshot,outline:snapshot.outline,status:'completed',job:null,chapters:[{id:'c1',title:'第一章 研究方案',version:2,status:'saved',text:'当前方案\n[figure:newfig]\n',sourceIds:[],figures:[newFigure]},{id:'c2',title:'第二章 局限',version:1,status:'saved',text:'局限正文',sourceIds:[],figures:[]}]};
}
function fixture(t){
 disposeOnlineThesis();const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.cn/workspace.html#thesis/t1'}),win=dom.window;
 for(const name of ['window','document','location','AbortController'])globalThis[name]=win[name];win.confirm=()=>true;
 let actor={id:'u1'},saved=record(),history={id:'history1',chapterId:'c1',version:1,text:oldText,figures:[oldFigure],sourceIds:[]};const calls=[];
 const ctx={session:async()=>({status:'ready',user:actor}),api:async(path,data)=>{
  calls.push({path,data});if(path==='/auth/me')return {user:actor};if(path==='/capabilities')return {thesis:{ready:true}};
  if(path==='/theses/'+saved.id&&!data)return {item:structuredClone(saved)};
  if(path===`/theses/${saved.id}/chapters/c1/versions`)return {items:[{version:1,source:'generated',createdAt:'2026-10-24'}]};
  if(path===`/theses/${saved.id}/chapters/c1/versions/1`)return {item:structuredClone(history)};
  if(path===`/theses/${saved.id}/chapters/c1`&&data){assert.deepEqual(Object.keys(data).sort(),['text','version']);saved={...saved,version:saved.version+1,chapters:saved.chapters.map(chapter=>chapter.id==='c1'?{...chapter,version:chapter.version+1,text:data.text,figures:data.text.includes('[figure:oldfig]')?[oldFigure]:[]}:chapter)};return {item:structuredClone(saved)};}
  throw Error('Unexpected '+path);
 }};
 const f={win,ctx,calls,storage:win.localStorage,$:selector=>win.document.querySelector(selector),setRecord:value=>{saved=structuredClone(value);},setActor:value=>{actor=value;},getRecord:()=>structuredClone(saved),setHistory:value=>{history=value;},async mount(){const stop=mountOnlineThesis({id:saved.id,ctx,container:f.$('.dashboard')});await stop.ready;return stop;},stored:()=>JSON.parse(win.localStorage.getItem(key())),edit(value){const editor=f.$('[data-thesis-editor]');editor.value=value;editor.dispatchEvent(new win.Event('input',{bubbles:true}));},switch(id){f.$(`[data-thesis-chapter="${id}"]`).click();},async restoreHistory(){f.$('[data-thesis-history]').click();await settle();f.$('[data-thesis-history-version="1"]').click();await settle();f.$('[data-thesis-history-use]').click();await settle();}};
 t.after(()=>{disposeOnlineThesis();win.close();});return f;
}

test('history diagram metadata survives editing, citation insertion, chapter switching and a full remount without entering save payloads',async t=>{
 const f=fixture(t);let stop=await f.mount();await f.restoreHistory();assert.match(f.$('[data-thesis-editor]').value,/〔图片1〕/);assert.match(f.$('.thesis-editor > .thesis-figure-gallery').textContent,/oldfig/);assert.deepEqual(f.stored().chapters[0].figures,[oldFigure]);
 f.edit(f.$('[data-thesis-editor]').value+' 人工补充。');const editor=f.$('[data-thesis-editor]');editor.setSelectionRange(editor.value.length,editor.value.length);f.$('[data-thesis-cite-insert="r1"]').click();
 assert.deepEqual(f.stored().chapters[0].figures,[oldFigure]);assert.match(f.stored().chapters[0].text,/\[source:r1\]/);assert.match(f.stored().chapters[0].text,/\[figure:oldfig\]/);
 f.switch('c2');f.switch('c1');assert.match(f.$('[data-thesis-editor]').value,/〔图片1〕/);assert.doesNotMatch(f.$('[data-thesis-editor]').value,/\[figure:/);assert.match(f.$('.thesis-editor > .thesis-figure-gallery').textContent,/oldfig/);
 const historyReads=f.calls.filter(call=>call.path.includes('/versions')).length;stop();stop=await f.mount();assert.equal(f.calls.filter(call=>call.path.includes('/versions')).length,historyReads);assert.match(f.$('[data-thesis-editor]').value,/〔图片1〕/);assert.match(f.$('.thesis-editor > .thesis-figure-gallery').textContent,/oldfig/);assert.equal(f.calls.some(call=>call.data),false);
 f.$('[data-thesis-save-chapter]').click();await settle();const request=f.calls.find(call=>call.data);assert.deepEqual(Object.keys(request.data).sort(),['text','version']);assert.match(request.data.text,/\[figure:oldfig\]/);assert.deepEqual(f.getRecord().chapters[0].figures,[oldFigure]);assert.equal(f.storage.getItem(key()),null);
});

test('restored history diagrams remain isolated by account and thesis, and session changes clear their private preview',async t=>{
 const f=fixture(t);let stop=await f.mount();await f.restoreHistory();thesisOnlineSessionChanged({id:'u2'});assert.equal(f.$('.thesis-figure-gallery'),null);assert.doesNotMatch(f.$('.dashboard').textContent,/oldfig/);assert.deepEqual(f.stored().chapters[0].figures,[oldFigure]);
 f.setActor({id:'u2'});stop=await f.mount();assert.doesNotMatch(f.$('[data-thesis-editor]').value,/oldfig|历史方案/);assert.doesNotMatch(f.$('.thesis-editor > .thesis-figure-gallery').textContent,/oldfig/);stop();
 f.setActor({id:'u1'});f.setRecord(record('t2'));stop=await f.mount();assert.doesNotMatch(f.$('[data-thesis-editor]').value,/oldfig|历史方案/);stop();f.setRecord(record());await f.mount();assert.match(f.$('[data-thesis-editor]').value,/〔图片1〕/);assert.match(f.$('.thesis-editor > .thesis-figure-gallery').textContent,/oldfig/);assert.equal(f.calls.some(call=>call.data),false);
});

test('version conflicts and explicit rebasing preserve a recovered diagram cache without automatically saving or generating',async t=>{
 const f=fixture(t);const stop=await f.mount();await f.restoreHistory();stop();const latest=record();latest.version=5;latest.chapters[0].version=3;latest.chapters[0].text+='其他设备修改';f.setRecord(latest);await f.mount();
 assert.match(f.$('.thesis-editor > .thesis-figure-gallery').textContent,/oldfig/);assert.ok(f.$('[data-thesis-rebase]'));f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.calls.some(call=>call.data),false);
 f.$('[data-thesis-rebase]').click();assert.deepEqual(f.stored().chapters[0].figures,[oldFigure]);f.switch('c2');f.switch('c1');assert.match(f.$('.thesis-editor > .thesis-figure-gallery').textContent,/oldfig/);f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.calls.filter(call=>call.data).length,1);assert.deepEqual(f.getRecord().chapters[0].figures,[oldFigure]);assert.equal(f.calls.some(call=>/generate|resume|quote/.test(call.path)),false);
});

test('malformed and oversized local diagram caches are preserved for recovery and never inserted into the page or submitted',async t=>{
 const f=fixture(t),chapter={id:'c1',text:oldText,baseText:'当前方案\n[figure:newfig]\n',baseVersion:2};
 for(const figures of [[{...oldFigure,svg:'<svg onload="alert(1)">'}],[{...oldFigure,nodes:[{id:'a',label:'<img src=x>'},{id:'b',label:'正常'}]}],Array.from({length:129},(_,i)=>figure('fig'+i))]){
  const value=JSON.stringify({schema:1,actorId:'u1',thesisId:'t1',revision:'invalid-cache',chapters:[{...chapter,figures}],research:null});f.storage.setItem(key(),value);const stop=await f.mount();assert.equal(f.$('[data-thesis-editor]').value,'当前方案\n〔图片1〕\n');assert.match(f.$('[data-thesis-notice]').textContent,/本地章节草稿格式不完整/);assert.equal(f.$('img'),null);assert.equal(f.$('script'),null);assert.equal(f.storage.getItem(key()),value);assert.equal(f.calls.some(call=>call.data),false);stop();f.storage.removeItem(key());
 }
 const metadata=Array.from({length:128},(_,i)=>figure('fig'+i)),overflow=JSON.stringify({schema:1,actorId:'u1',thesisId:'t1',revision:'total-too-large',chapters:[{...chapter,figures:metadata},{...chapter,id:'c2',figures:[figure('extra')]}],research:null});f.storage.setItem(key(),overflow);await f.mount();assert.match(f.$('[data-thesis-notice]').textContent,/图片记录过多/);assert.equal(f.storage.getItem(key()),overflow);assert.equal(f.calls.some(call=>call.data),false);
});

test('current owned chapter metadata takes precedence over a conflicting local preview with the same figure ID',async t=>{
 const f=fixture(t),value={schema:1,actorId:'u1',thesisId:'t1',revision:'preview-only',chapters:[{id:'c1',text:'待保存的补充\n[figure:newfig]\n',baseText:'当前方案\n[figure:newfig]\n',baseVersion:2,figures:[{...newFigure,title:'本机修改的同编号图题'}]}],research:null};f.storage.setItem(key(),JSON.stringify(value));await f.mount();assert.match(f.$('.thesis-editor > .thesis-figure-gallery').textContent,/拟开展步骤 newfig/);assert.doesNotMatch(f.$('.thesis-editor > .thesis-figure-gallery').textContent,/本机修改的同编号图题/);assert.equal(f.calls.some(call=>call.data),false);
});
