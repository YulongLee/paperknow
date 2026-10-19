import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {toolBanner} from '../dist/workspace/tool-banner.mjs';
import {withStableView} from '../dist/workspace/view-stability.mjs';
import {defaultRules,checkFormatting} from '../dist/workspace/format-model.mjs';

const source=(await readFile(new URL('../dist/workspace/format.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replace("import('./assets/format-document.js')",'loadFormatDocumentModule()');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function harness(load){
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.cn/workspace.html#category/format',runScripts:'outside-only'}),w=dom.window,messages=[],calls={load:0,example:0,parse:0,apply:0};
 const tools={exampleDocx:async()=>{calls.example++;return new Uint8Array([1,2]);},parseDocx:async()=>{calls.parse++;return {paragraphs:[{sourceIndex:0,text:'示例段落',level:0,format:{}}],sections:[],warnings:[],chars:4};},applyDocx:async bytes=>{calls.apply++;return bytes;}};
 Object.assign(w,{hasDraftScope:()=>false,withStableView,keys:{drafts:'drafts'},list:()=>[],projects:()=>[],defaultRules,checkFormatting,toolBanner,esc:value=>String(value),icon:()=>'',mountToolJobPanel:()=>({dispose(){}}),loadFormatDocumentModule:()=>{calls.load++;return load(tools,calls.load);}});
 w.eval(source+'\nwindow.lifecycle={mountFormat,disposeFormat};');
 return {dom,w,calls,tools,messages,mount:()=>w.lifecycle.mountFormat({notify:message=>messages.push(message)}),dispose:()=>w.lifecycle.disposeFormat()};
}

test('format document code loads only on entry and cancelled loading never processes or repaints a replacement page',async()=>{
 const loading=deferred(),h=harness(()=>loading.promise);
 try{
  assert.equal(h.calls.load,0);const pending=h.mount();assert.equal(h.calls.load,1);
  assert.match(h.w.document.querySelector('.dashboard').textContent,/正在读取本地文档/);
  h.dispose();h.w.document.querySelector('.dashboard').innerHTML='<h1>另一账户的页面</h1>';
  loading.resolve(h.tools);await pending;
  assert.equal(h.calls.example,0);assert.equal(h.calls.parse,0);assert.equal(h.calls.apply,0);
  assert.equal(h.w.document.querySelector('.dashboard').textContent,'另一账户的页面');assert.deepEqual(h.messages,[]);
 }finally{h.dispose();h.dom.window.close();}
});

test('concurrent format entries share one load and only the current entry starts document work',async()=>{
 const loading=deferred(),h=harness(()=>loading.promise);
 try{
  const first=h.mount(),second=h.mount();assert.equal(h.calls.load,1);
  loading.resolve(h.tools);await Promise.all([first,second]);
  assert.equal(h.calls.example,1);assert.equal(h.calls.parse,1);assert.ok(h.w.document.querySelector('.format-paper'));
  await h.mount();assert.equal(h.calls.load,1);assert.equal(h.calls.example,2);assert.equal(h.calls.parse,2);
 }finally{h.dispose();h.dom.window.close();}
});

test('failed document loading preserves the error page and a later format entry can retry',async()=>{
 const h=harness((tools,attempt)=>attempt===1?Promise.reject(Error('组件加载失败，请重试。')):Promise.resolve(tools));
 try{
  await h.mount();assert.match(h.w.document.querySelector('.hub-error').textContent,/组件加载失败/);assert.equal(h.calls.example,0);
  await h.mount();assert.equal(h.calls.load,2);assert.equal(h.calls.example,1);assert.equal(h.calls.parse,1);
  assert.equal(h.w.document.querySelector('.hub-error'),null);assert.ok(h.w.document.querySelector('.format-paper'));
 }finally{h.dispose();h.dom.window.close();}
});
