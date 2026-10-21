import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountToolJobPanel} from '../dist/workspace/tool-job-panel.mjs';

test('presentation fee preview and consent never submit a paid job until the user explicitly starts',async t=>{
 const dom=new JSDOM('<main class="dashboard"><div id="job"></div></main>',{url:'https://paperknow.cn/workspace.html#category/ppt'});t.after(()=>dom.window.close());
 const requests=[],snapshot={title:'概念汇报',text:'',requirements:'介绍基础研究方法',mode:'ai',language:'中文',materials:[],context:{pages:6}},quote={type:'agent',source:'credits',creditCost:10,title:'演示文稿',token:'fixture-quote',expiresAt:new Date(Date.now()+60000).toISOString()};
 const panel=mountToolJobPanel({container:dom.window.document.querySelector('#job'),kind:'presentation',operation:'ppt',getSnapshot:()=>snapshot,onApply(){throw Error('This test must not adopt output');},ctx:{api:async(path,data)=>{requests.push({path,data});if(path==='/auth/me')return {user:{id:'fixture-user'}};if(path==='/tool-runs/capabilities')return {ready:true};if(path==='/tool-runs/quote')return quote;throw Error('Unexpected mutation '+path);}}});t.after(()=>panel.dispose());
 await panel.open();const doc=dom.window.document;assert.match(doc.querySelector('.tool-job-charge').textContent,/10 科研积分/);assert.equal(doc.querySelector('[data-tj-consent]').checked,true);assert.equal(doc.querySelector('[data-tj-start]').disabled,false);assert.equal(requests.some(r=>r.path==='/tool-runs/jobs'),false);
 const consent=doc.querySelector('[data-tj-consent]');consent.checked=false;consent.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(doc.querySelector('[data-tj-start]').disabled,true);assert.equal(requests.some(r=>r.path==='/tool-runs/jobs'),false);consent.checked=true;consent.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(doc.querySelector('[data-tj-start]').disabled,false);assert.equal(requests.some(r=>r.path==='/tool-runs/jobs'),false);doc.querySelector('[data-tj-close]').click();assert.equal(requests.some(r=>r.path==='/tool-runs/jobs'),false);assert.equal(requests.filter(r=>r.path==='/tool-runs/quote').length,1);
});
