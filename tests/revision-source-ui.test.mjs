import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {openRevisionSources,revisionComparisonMarkup} from '../dist/workspace/revision-source-ui.mjs';
import {createRevision} from '../dist/workspace/revision-model.mjs';

const text='本合成研究将论文与获得授权的其他文章正文进行逐字比对，仅描述本次实际取得材料的匹配范围。';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.ok(predicate(),'source dialog did not settle');};
function fixture(t,{importDocument,onConfirm}={}){
 const dom=new JSDOM('<dialog><div id="body"></div></dialog>',{url:'https://paperknow.test/workspace.html#category/reduce'}),document=dom.window.document,doc=createRevision({title:'合成论文',text,mode:'rewrite'},'r1','2026-10-22T00:00:00Z'),saved=[];globalThis.document=document;document.querySelector('dialog').close=()=>{const dialog=document.querySelector('dialog');dialog.removeAttribute('open');dialog.dispatchEvent(new dom.window.Event('close'));};
 const api=openRevisionSources({doc,modal:(_title,html)=>{document.querySelector('#body').innerHTML=html;document.querySelector('dialog').setAttribute('open','');},importDocument,onConfirm:onConfirm||((value)=>saved.push(value))});
 t.after(()=>{api.dispose();dom.window.close();});const q=selector=>document.querySelector(selector);
 return{dom,doc,saved,q,fill(selector,value){q(selector).value=value;q(selector).dispatchEvent(new dom.window.Event('input',{bubbles:true}));},select(file){Object.defineProperty(q('[data-source-file]'),'files',{value:[file],configurable:true});q('[data-source-file]').dispatchEvent(new dom.window.Event('change',{bubbles:true}));}};
}

test('source dialog retains typed content after a file read and only explicitly adopts extracted source text',async t=>{
 const read=deferred(),f=fixture(t,{importDocument:async()=>read.promise});f.fill('#rev-source-name','已填文章');f.fill('#rev-source-text','用户已经填写且有权使用的对照正文，应保留当前输入。');f.select({name:'其他文章.txt',size:100});read.resolve({text,warnings:[]});await until(()=>!f.q('[data-source-confirm]').disabled);assert.match(f.q('#rev-source-text').value,/用户已经填写/);assert.equal(f.saved.length,0);const adopt=f.q('[data-source-import-status] button');assert.ok(adopt);adopt.click();assert.equal(f.q('#rev-source-text').value,text);assert.equal(f.q('#rev-source-name').value,'已填文章');f.q('[data-source-confirm]').click();await until(()=>f.saved.length===1);assert.equal(f.saved[0].sources[0].text,text);assert.equal(f.doc.original,text);
});

test('closing the source dialog invalidates late file extraction and cannot save or repaint a different window',async t=>{
 const read=deferred(),f=fixture(t,{importDocument:async()=>read.promise});f.select({name:'迟到文章.txt',size:100});f.q('dialog').close();f.q('#body').innerHTML='<p id="next">其他页面</p>';read.resolve({text,warnings:[]});await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.q('#next').textContent,'其他页面');assert.equal(f.saved.length,0);assert.equal(f.doc.comparison,undefined);
});

test('unsafe source URLs and oversized source text never persist a misleading comparison',async t=>{
 const f=fixture(t);f.fill('#rev-source-name','有名字的真实来源');f.fill('#rev-source-url','javascript:alert(1)');f.fill('#rev-source-text',text);f.q('[data-source-confirm]').click();assert.equal(f.saved.length,0);assert.match(f.q('[data-source-error]').textContent,/网址|来源|URL|公开/);f.fill('#rev-source-url','');f.fill('#rev-source-text',text.repeat(300));f.q('[data-source-confirm]').click();assert.equal(f.saved.length,0);assert.match(f.q('[data-source-error]').textContent,/12,000|12000|字符/);assert.equal(f.doc.comparison,undefined);
});

test('source evidence displays actual article snippets as inert text and does not show fabricated scores without sources',()=>{
 const doc={...createRevision({title:'论文',text,mode:'rewrite'},'r1','2026-10-22T00:00:00Z'),reductionPath:'sources'},empty=revisionComparisonMarkup(doc,0);assert.match(empty,/尚未添加对照文章/);assert.doesNotMatch(empty,/原稿相似占比/);
 const html=revisionComparisonMarkup({...doc,comparison:{version:1,sources:[{id:'s1',name:'<img src=x onerror=alert(1)>',text}]}},0),rendered=new JSDOM(html).window.document;assert.equal(rendered.querySelector('img'),null);assert.match(rendered.querySelector('.rev-source-evidence').textContent,/<img src=x onerror=alert\(1\)>/);assert.match(rendered.querySelector('.rev-source-metrics').textContent,/100.0%/);assert.match(rendered.querySelector('.rev-source-boundary').textContent,/不是学校数据库/);
});
