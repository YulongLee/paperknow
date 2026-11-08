import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {keys,list,write,setEditingIdentity,captureDraftScope,beginDraftScope,endDraftScope} from '../dist/workspace/state.mjs';

test('ordinary writing and analysis caches follow verified browser account and never claim legacy data',()=>{
 const dom=new JSDOM('',{url:'https://paperknow.cn'});
 globalThis.localStorage=dom.window.localStorage;
 localStorage.setItem(keys.drafts,JSON.stringify([{id:'unattributed',title:'旧资料'}]));
 setEditingIdentity(null,{status:'loading'});
 assert.deepEqual(list(keys.drafts),[]);
 assert.throws(()=>write(keys.drafts,[]),/确认账户/);
 setEditingIdentity({id:'account-A'});
 write(keys.drafts,[{id:'a',title:'仅 A 的写作',analysisState:{dataset:{rows:[['A 私有']]}}}]);
 write(keys.tasks,[{id:'a-task'}]);
 const prior=captureDraftScope();
 assert.equal(prior.ownerId,'account-A');
 setEditingIdentity({id:'account-B'});
 assert.equal(prior.isCurrent(),false);
 assert.deepEqual(list(keys.drafts),[]);
 assert.deepEqual(list(keys.tasks),[]);
 write(keys.drafts,[{id:'b',title:'B 的写作'}]);
 setEditingIdentity(null,{status:'guest'});
 assert.deepEqual(list(keys.drafts),[]);
 setEditingIdentity({id:'account-A'});
 assert.equal(list(keys.drafts)[0].analysisState.dataset.rows[0][0],'A 私有');
 assert.deepEqual(JSON.parse(localStorage.getItem(keys.drafts)),[{id:'unattributed',title:'旧资料'}]);
 setEditingIdentity({id:'account-B'});
 assert.equal(list(keys.drafts)[0].title,'B 的写作');
 beginDraftScope({ownerId:'account-B',drafts:[{id:'cloud',title:'云草稿'}]});
 assert.equal(list(keys.drafts)[0].id,'cloud');
 endDraftScope();
 assert.equal(list(keys.drafts)[0].id,'b');
 dom.window.close();
});

test('all ordinary writing editors and analysis refuse another account’s resumable content',async()=>{
 const {mountWriting,disposeWriting}=await import('../dist/workspace/writing.mjs');
 const {mountWritingFlow,disposeWritingFlows}=await import('../dist/workspace/writing-flows.mjs');
 const {mountDataAnalysis,disposeDataAnalysis}=await import('../dist/workspace/data-analysis.mjs');
 const {clearEditor}=await import('../dist/workspace/edit-guard.mjs');
 const dom=new JSDOM('<div class="breadcrumb"><strong></strong></div><main class="dashboard"></main>',{url:'https://paperknow.cn/workspace.html#tool/writing'});
 for(const key of ['window','document','localStorage','location','AbortController','MutationObserver','FormData'])globalThis[key]=dom.window[key];
 const kinds=['writing','proposal','summary','taskbook','article','course','practice','idea','analysis'];
 try{
  setEditingIdentity({id:'A'});
  write(keys.drafts,kinds.map(kind=>({id:'a-'+kind,tool:kind==='idea'?'topic':kind,title:'A 私有题目 '+kind,writingResume:true,analysisResume:true,updatedAt:'2026-11-08',writingFlow:{version:1,title:'A 私有题目 '+kind},analysisState:{form:{title:'A 私有题目 analysis'},dataset:{headers:['类别'],rows:[['A 私有数据']]}}})));
  setEditingIdentity({id:'B'});
  for(const kind of kinds){
   dom.window.history.replaceState(null,'','#tool/'+kind);
   if(kind==='writing')mountWriting(undefined,undefined,{});
   else if(kind==='analysis')mountDataAnalysis({});
   else mountWritingFlow({kind});
   assert.doesNotMatch(document.querySelector('.dashboard').textContent,/A 私有题目|A 私有数据/,kind);
   assert.doesNotMatch(document.querySelector('#writing-title')?.value||'',/A 私有题目/,kind);
   disposeWriting?.();disposeWritingFlows();disposeDataAnalysis();clearEditor();
  }
 }finally{disposeWriting?.();disposeWritingFlows();disposeDataAnalysis();clearEditor();dom.window.close();}
});
