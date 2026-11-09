import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountWritingLanding} from '../dist/workspace/writing.mjs';

const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(t,fetcher){
 const dom=new JSDOM('<div class="sidebar"></div><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main>',{url:'https://paperknow.test/workspace.html#category/writing'}),old={};
 for(const key of ['window','document','location','localStorage','fetch','AbortController']){old[key]=globalThis[key];globalThis[key]=key==='fetch'?fetcher:dom.window[key];}
 t.after(()=>{dom.window.dispatchEvent(new dom.window.Event('hashchange'));for(const key of Object.keys(old))globalThis[key]=old[key];dom.window.close();});
 return dom.window.document;
}
const reply=(data,status=200)=>({ok:status===200,status,json:async()=>data});
test('writing landing loads owner-bound cloud manuscripts and never displays local drafts',async t=>{
 const requests=[],doc=fixture(t,async(path,opt)=>{requests.push([path,opt]);if(path==='/api/auth/me')return reply({user:{id:'alice'}});if(path==='/api/workspace/drafts')return reply({items:[{id:'d1',title:'云端开题',tool:'proposal',updated_at:'2026-11-08T10:00:00Z'}]});if(path==='/api/theses')return reply({items:[{id:'t1',title:'云端论文',updated_at:'2026-11-08T11:00:00Z'}]});throw Error('unexpected');});
 localStorage.setItem('paperknow-drafts',JSON.stringify([{id:'private-local',tool:'writing',title:'不应直接展示的旧草稿'}]));mountWritingLanding();await settle();
 assert.match(doc.body.textContent,/云端开题/);assert.match(doc.body.textContent,/云端论文/);assert.doesNotMatch(doc.body.textContent,/不应直接展示|当前浏览器|本地成果|换设备前/);
 assert.ok(doc.querySelector('a[href="#account-draft/d1"]'));assert.ok(doc.querySelector('a[href="#thesis/t1"]'));
 assert.equal(requests.find(([path])=>path==='/api/workspace/drafts')[1].headers['X-PaperKnow-User'],'alice');assert.equal(requests.find(([path])=>path==='/api/theses')[1].headers['X-PaperKnow-User'],'alice');
 window.dispatchEvent(new window.Event('paperknow:session-invalidated'));assert.doesNotMatch(doc.body.textContent,/云端开题|云端论文/);
});
test('late response after identity changes cannot display a prior account',async t=>{
 let auth=0;const doc=fixture(t,async path=>path==='/api/auth/me'?reply({user:{id:++auth===1?'alice':'bob'}}):path==='/api/workspace/drafts'?reply({items:[{id:'d1',title:'前一账户草稿',tool:'proposal'}]}):reply({items:[]}));mountWritingLanding();await settle();assert.doesNotMatch(doc.body.textContent,/前一账户草稿/);assert.match(doc.body.textContent,/暂时无法读取/);
});
test('guest is asked to sign in without showing browser drafts',async t=>{const doc=fixture(t,async()=>reply({},401));localStorage.setItem('paperknow-drafts',JSON.stringify([{id:'local',tool:'writing',title:'旧草稿'}]));mountWritingLanding();await settle();assert.match(doc.body.textContent,/登录后继续写作/);assert.doesNotMatch(doc.body.textContent,/旧草稿|当前浏览器/);});
