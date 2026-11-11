import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {researchSessionKey,researchSessionStorageKey} from '../dist/workspace/research-delivery-model.mjs';
import {setEditingIdentity} from '../dist/workspace/state.mjs';

test('research session recovery is isolated by account and never imports the legacy shared session',async()=>{
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.test/workspace.html#category/research?mode=data'}),w=dom.window;
 for(const key of ['window','document','localStorage','FormData','location','AbortController','DOMParser','XMLSerializer'])globalThis[key]=w[key];
 Object.defineProperty(globalThis,'navigator',{value:w.navigator,configurable:true});
 const {mountResearch,disposeResearch,researchRouteGuard}=await import('../dist/workspace/research.mjs');
 const ctx={notify(){}},q=selector=>w.document.querySelector(selector),enter=(selector,value)=>{const el=q(selector);assert.ok(el);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 try{
  w.localStorage.setItem(researchSessionKey,JSON.stringify({chart:{title:'旧共享私密标题'}}));
  setEditingIdentity({id:'alice'});await mountResearch(ctx);assert.notEqual(q('[data-option="title"]').value,'旧共享私密标题');
  enter('[data-option="title"]','Alice 私密图表');assert.equal(researchRouteGuard(),true);disposeResearch();
  const aliceKey=researchSessionStorageKey({mode:'account',ownerId:'alice'});assert.match(w.localStorage.getItem(aliceKey),/Alice 私密图表/);
  setEditingIdentity({id:'bob'});await mountResearch(ctx);assert.notEqual(q('[data-option="title"]').value,'Alice 私密图表');assert.notEqual(q('[data-option="title"]').value,'旧共享私密标题');
  enter('[data-option="title"]','Bob 私密图表');assert.equal(researchRouteGuard(),true);disposeResearch();
  setEditingIdentity({id:'alice'});await mountResearch(ctx);assert.equal(q('[data-option="title"]').value,'Alice 私密图表');
  assert.match(w.localStorage.getItem(researchSessionKey),/旧共享私密标题/);
  setEditingIdentity({id:'bob'});disposeResearch();assert.doesNotMatch(w.localStorage.getItem(researchSessionStorageKey({mode:'account',ownerId:'bob'})),/Alice 私密图表/);
 }finally{disposeResearch();w.close();}
});

test('pending identity has no recovery storage and guest storage is separate',()=>{
 assert.equal(researchSessionStorageKey({mode:'pending'}),null);
 assert.notEqual(researchSessionStorageKey({mode:'guest'}),researchSessionKey);
 assert.notEqual(researchSessionStorageKey({mode:'guest'}),researchSessionStorageKey({mode:'account',ownerId:'guest'}));
});
